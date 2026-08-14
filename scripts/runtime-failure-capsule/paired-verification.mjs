import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { LIMITS, repositoryRelative } from './contracts.mjs';
import { verifyPairedPlaywrightRepositories } from './browser-paired-verification.mjs';
import {
  collectGoProfileEvidence,
  combineProfileRuns,
  createPerformanceCapsule,
  goProfileIterationCount,
  parseGoBenchmarks,
} from './performance.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import { verifyOptimizationCapsules } from './optimization-verification.mjs';
import { compileGoBenchmarkBinary, inspectGoRuntimeVersion, runClosedAdapter } from './runner.mjs';
import {
  V8_HEAP_PROFILE_RUNS,
  collectV8HeapProfileEvidence,
  combineV8HeapProfileRuns,
} from './v8-heap-profile.mjs';

const DIAGNOSTIC_ONLY_LIMITATIONS = new Set([
  'The runtime produced no V8 CPU profile.',
  'The CPU profile contained no repository-owned source samples.',
  'Go profiles contained no repository-owned source rows.',
]);

export async function verifyPairedRepositories({
  baselineRepositoryRoot,
  currentRepositoryRoot,
  baselineDependencyRoot = baselineRepositoryRoot,
  currentDependencyRoot = currentRepositoryRoot,
  baselineSubject = null,
  adapter,
  target,
  name,
  project,
  source,
  sources,
  nodeAllocationSource,
  timeoutMs,
  samples,
  warmups,
}) {
  if (adapter === 'playwright') {
    return verifyPairedPlaywrightRepositories({
      baselineRepositoryRoot,
      currentRepositoryRoot,
      target,
      name,
      project,
      source,
      sources,
      timeoutMs,
      samples,
      warmups,
    });
  }
  const baselineRoot = await realpath(resolve(baselineRepositoryRoot));
  const currentRoot = await realpath(resolve(currentRepositoryRoot));
  const dependencyRoots = {
    baseline: await realpath(resolve(baselineDependencyRoot)),
    current: await realpath(resolve(currentDependencyRoot)),
  };
  if (baselineRoot === currentRoot) {
    throw new Error('paired verification requires two distinct repository roots');
  }
  const [baselineWorkload, currentWorkload] = await Promise.all([
    workloadIdentity(baselineRoot, target),
    workloadIdentity(currentRoot, target),
  ]);
  if (baselineWorkload !== currentWorkload) {
    throw new Error('paired verification requires identical target file content');
  }
  const [baselineGoVersion, currentGoVersion] =
    adapter === 'go-bench'
      ? await Promise.all([
          inspectGoRuntimeVersion(baselineRoot),
          inspectGoRuntimeVersion(currentRoot),
        ])
      : [null, null];

  const executions = { baseline: [], current: [] };
  const goProfileRuns = { baseline: [], current: [] };
  const goMemoryBinaries = { baseline: null, current: null };
  const goProfileIterations = { baseline: null, current: null };
  const heapProfileRuns = { baseline: [], current: [] };
  const schedule = [];
  const roots = { baseline: baselineRoot, current: currentRoot };
  const nodeAdapter = ['node-test', 'node-script', 'vitest', 'jest'].includes(adapter);
  const memoryAdapter = nodeAdapter || adapter === 'go-bench';
  const temporaryDirectory = memoryAdapter
    ? await mkdtemp(join(tmpdir(), 'codevetter-paired-profile-'))
    : null;
  let cleanupFailed = false;
  try {
    for (let index = 0; index < warmups; index += 1) {
      for (const side of alternatingSides(index)) {
        await runSide({
          side,
          phase: 'warmup',
          index,
          roots,
          dependencyRoots,
          executions,
          schedule,
          adapter,
          target,
          name,
          timeoutMs,
        });
      }
    }
    for (let index = 0; index < samples; index += 1) {
      for (const side of alternatingSides(index)) {
        await runSide({
          side,
          phase: 'measurement',
          index,
          roots,
          dependencyRoots,
          executions,
          schedule,
          adapter,
          target,
          name,
          timeoutMs,
        });
      }
    }
    if (adapter === 'go-bench') {
      for (const side of ['baseline', 'current']) {
        const benchmark = parseGoBenchmarks(
          executions[side]
            .filter((entry) => entry.phase === 'measurement')
            .map((entry) => `${entry.execution.stdout}\n${entry.execution.stderr}`)
            .join('\n')
        )[0];
        goProfileIterations[side] = goProfileIterationCount(benchmark);
      }
      if (
        Number.isInteger(goProfileIterations.baseline) &&
        Number.isInteger(goProfileIterations.current)
      ) {
        const sharedIterations = Math.min(
          goProfileIterations.baseline,
          goProfileIterations.current
        );
        goProfileIterations.baseline = sharedIterations;
        goProfileIterations.current = sharedIterations;
      }
    }
    if (adapter === 'go-bench') {
      for (const side of ['baseline', 'current']) {
        const outputDirectory = join(temporaryDirectory, `${side}-go-memory-binary`);
        await mkdir(outputDirectory);
        const preparation = await compileGoBenchmarkBinary({
          repositoryRoot: roots[side],
          target,
          timeoutMs,
          outputDirectory,
        });
        if (!preparation.prepared_binary) {
          throw new Error(`the owned ${side} Go benchmark memory binary could not be compiled`);
        }
        goMemoryBinaries[side] = preparation.prepared_binary;
      }
    }
    if (memoryAdapter) {
      for (let index = 0; index < LIMITS.memorySamples; index += 1) {
        for (const side of alternatingSides(index)) {
          await runSide({
            side,
            phase: 'memory',
            index,
            roots,
            dependencyRoots,
            executions,
            schedule,
            adapter,
            target,
            name,
            timeoutMs,
            measureMemory: true,
            goBenchmarkBinary: goMemoryBinaries[side],
          });
        }
      }
    }
    if (adapter === 'go-bench') {
      for (let index = 0; index < 2; index += 1) {
        for (const side of alternatingSides(index)) {
          const profileDirectory = join(temporaryDirectory, `${side}-go-${index}`);
          await mkdir(profileDirectory);
          const execution = await runSide({
            side,
            phase: 'profile',
            index,
            roots,
            dependencyRoots,
            executions,
            schedule,
            adapter,
            target,
            name,
            timeoutMs,
            profileDirectory,
            goBenchmarkIterations: goProfileIterations[side],
          });
          const benchmark =
            parseGoBenchmarks(`${execution.stdout}\n${execution.stderr}`)[0] ?? null;
          goProfileRuns[side].push({
            ...(await collectGoProfileEvidence(profileDirectory, roots[side])),
            benchmark,
            fixed_benchmark_iterations: goProfileIterations[side],
          });
        }
      }
    }
    if (nodeAdapter) {
      for (let index = 0; index < V8_HEAP_PROFILE_RUNS; index += 1) {
        for (const side of alternatingSides(index)) {
          const heapProfileDirectory = join(temporaryDirectory, `${side}-${index}`);
          await mkdir(heapProfileDirectory);
          await runSide({
            side,
            phase: 'heap_profile',
            index,
            roots,
            dependencyRoots,
            executions,
            schedule,
            adapter,
            target,
            name,
            timeoutMs,
            heapProfileDirectory,
          });
          heapProfileRuns[side].push(
            await collectV8HeapProfileEvidence(heapProfileDirectory, roots[side])
          );
        }
      }
    }
  } finally {
    if (temporaryDirectory) {
      try {
        await rm(temporaryDirectory, { recursive: true, force: true });
      } catch {
        cleanupFailed = true;
      }
    }
  }

  const [baselineGit, currentGit] = await Promise.all([
    baselineSubject
      ? Promise.resolve(assertMaterializedSubject(baselineSubject))
      : inspectGitDiff(baselineRoot),
    inspectGitDiff(currentRoot),
  ]);
  const baseline = pairedCapsule({
    root: baselineRoot,
    git: baselineGit,
    adapter,
    target,
    name,
    samples,
    warmups,
    executions: executions.baseline,
    heapProfileRuns: heapProfileRuns.baseline,
    profileRuns: goProfileRuns.baseline,
    cleanupFailed,
    goVersion: baselineGoVersion,
  });
  const current = pairedCapsule({
    root: currentRoot,
    git: currentGit,
    adapter,
    target,
    name,
    samples,
    warmups,
    executions: executions.current,
    heapProfileRuns: heapProfileRuns.current,
    profileRuns: goProfileRuns.current,
    cleanupFailed,
    goVersion: currentGoVersion,
  });
  const verification = verifyOptimizationCapsules(
    baseline,
    current,
    {},
    nodeAllocationSource ? { nodeAllocationSource } : {}
  );
  return {
    ...verification,
    evidence_mode: 'paired_interleaved',
    workload_identity: { algorithm: 'sha256', digest: currentWorkload },
    paired_schedule: schedule,
  };
}

async function workloadIdentity(root, target) {
  const path = await realpath(resolve(root, target));
  if (repositoryRelative(root, path) === null) {
    throw new Error('paired target escapes repository');
  }
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function runSide({
  side,
  phase,
  index,
  roots,
  dependencyRoots,
  executions,
  schedule,
  adapter,
  target,
  name,
  timeoutMs,
  measureMemory = false,
  goBenchmarkBinary = null,
  profileDirectory = null,
  heapProfileDirectory = null,
  goBenchmarkIterations = null,
}) {
  const execution = await runClosedAdapter({
    repositoryRoot: roots[side],
    dependencyRepositoryRoot: dependencyRoots[side],
    adapter,
    target,
    name,
    timeoutMs,
    vitestReporter: adapter === 'vitest' ? 'verbose' : undefined,
    measureMemory,
    goBenchmarkBinary,
    profileDirectory,
    heapProfileDirectory,
    goBenchmarkIterations,
  });
  executions[side].push({ phase, index, execution });
  schedule.push({
    order: schedule.length + 1,
    side,
    phase,
    sample_index: index,
    status: execution.status,
    exit_code: execution.exitCode,
    duration_ms: execution.durationMs,
  });
  return execution;
}

function assertMaterializedSubject(value) {
  if (
    !value ||
    !/^[0-9a-f]{40,64}$/.test(value.repository_revision ?? '') ||
    !/^[0-9a-f]{64}$/.test(value.source_snapshot_sha256 ?? '') ||
    value.dirty !== false
  ) {
    throw new Error('materialized baseline subject is invalid');
  }
  return {
    repository_revision: value.repository_revision,
    source_snapshot_sha256: value.source_snapshot_sha256,
    diff_identity: 'materialized-clean-revision',
    dirty: false,
    changed_files: [],
    changed_lines: new Map(),
  };
}

function pairedCapsule({
  root,
  git,
  adapter,
  target,
  name,
  samples,
  warmups,
  executions,
  heapProfileRuns,
  profileRuns,
  cleanupFailed,
  goVersion,
}) {
  const capsule = createPerformanceCapsule({
    root,
    lexicalRoot: root,
    git,
    adapter,
    target,
    name,
    samples,
    warmups,
    executions,
    profileEvidence:
      adapter === 'go-bench'
        ? combineProfileRuns(profileRuns, adapter)
        : {
            kind: 'paired_timing_only',
            profile_files: 0,
            profile_bytes: 0,
            profile_samples: 0,
            hotspots: [],
            truncated: false,
            redaction_count: 0,
            failed_kinds: [],
          },
    profileRuns,
    heapProfileEvidence: combineV8HeapProfileRuns(heapProfileRuns),
    heapProfileRuns,
    cleanupFailed,
    goVersion,
  });
  capsule.limitations = capsule.limitations.filter(
    (limitation) => !DIAGNOSTIC_ONLY_LIMITATIONS.has(limitation)
  );
  if (adapter !== 'go-bench') capsule.capture.profile_kind = 'paired_timing_only';
  return capsule;
}

function alternatingSides(index) {
  return index % 2 === 0 ? ['baseline', 'current'] : ['current', 'baseline'];
}
