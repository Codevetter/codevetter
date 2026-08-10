import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import { repositoryRelative } from './contracts.mjs';
import { createPerformanceCapsule } from './performance.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import { verifyOptimizationCapsules } from './optimization-verification.mjs';
import { runClosedAdapter } from './runner.mjs';

const DIAGNOSTIC_ONLY_LIMITATIONS = new Set([
  'The runtime produced no V8 CPU profile.',
  'The CPU profile contained no repository-owned source samples.',
  'Go profiles contained no repository-owned source rows.',
]);

export async function verifyPairedRepositories({
  baselineRepositoryRoot,
  currentRepositoryRoot,
  adapter,
  target,
  name,
  timeoutMs,
  samples,
  warmups,
}) {
  const baselineRoot = await realpath(resolve(baselineRepositoryRoot));
  const currentRoot = await realpath(resolve(currentRepositoryRoot));
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

  const executions = { baseline: [], current: [] };
  const schedule = [];
  for (let index = 0; index < warmups; index += 1) {
    for (const side of index % 2 === 0 ? ['baseline', 'current'] : ['current', 'baseline']) {
      await runSide({
        side,
        phase: 'warmup',
        index,
        roots: { baseline: baselineRoot, current: currentRoot },
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
    for (const side of index % 2 === 0 ? ['baseline', 'current'] : ['current', 'baseline']) {
      await runSide({
        side,
        phase: 'measurement',
        index,
        roots: { baseline: baselineRoot, current: currentRoot },
        executions,
        schedule,
        adapter,
        target,
        name,
        timeoutMs,
      });
    }
  }

  const [baselineGit, currentGit] = await Promise.all([
    inspectGitDiff(baselineRoot),
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
  });
  const verification = verifyOptimizationCapsules(baseline, current);
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
  executions,
  schedule,
  adapter,
  target,
  name,
  timeoutMs,
}) {
  const execution = await runClosedAdapter({
    repositoryRoot: roots[side],
    adapter,
    target,
    name,
    timeoutMs,
    vitestReporter: adapter === 'vitest' ? 'verbose' : undefined,
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
}

function pairedCapsule({ root, git, adapter, target, name, samples, warmups, executions }) {
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
    profileEvidence: {
      kind: 'paired_timing_only',
      profile_files: 0,
      profile_bytes: 0,
      profile_samples: 0,
      hotspots: [],
      truncated: false,
      redaction_count: 0,
      failed_kinds: [],
    },
  });
  capsule.limitations = capsule.limitations.filter(
    (limitation) => !DIAGNOSTIC_ONLY_LIMITATIONS.has(limitation)
  );
  capsule.capture.profile_kind = 'paired_timing_only';
  return capsule;
}
