import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseVitestReport, parseVitestSelection } from './capsule.mjs';
import {
  LIMITS,
  PERFORMANCE_SCHEMA_VERSION,
  isExcludedPath,
  repositoryRelative,
  validatePerformanceCapsule,
} from './contracts.mjs';
import { inspectGitDiff, rankRelevantChanges } from './git-diff.mjs';
import { createDetectorCoverageMatrix } from './detector-coverage-matrix.mjs';
import { collectV8FunctionCoverage, emptyFunctionCoverage } from './function-coverage.mjs';
import { redactText } from './redact.mjs';
import {
  compileGoBenchmarkBinary,
  inspectGoProfile,
  inspectGoRuntimeVersion,
  runClosedAdapter,
} from './runner.mjs';
import { collectNodeFlowEvents } from './flow-capture.mjs';
import {
  V8_HEAP_CANDIDATE_LIMIT,
  V8_HEAP_PROFILE_RUNS,
  collectV8HeapProfileEvidence,
  combineV8HeapProfileRuns,
  emptyV8HeapProfileEvidence,
  evaluateV8HeapRepeatability,
  repeatableV8HeapAllocationCandidates,
  v8HeapProfileRunSummary,
} from './v8-heap-profile.mjs';

const APPLICATION_HOTSPOT_SHARE = 0.05;
const APPLICATION_ALLOCATION_OBJECT_SHARE = 0.01;
const STARTUP_DOMINATED_SHARE_PERCENT = 10;
const V8_PROFILE_RUNS = 2;
const GO_PROFILE_TARGET_NS = 250_000_000;
const GO_PROFILE_MAXIMUM_ITERATIONS = 25_000;
const V8_MATERIALITY_POLICY = Object.freeze({
  minimum_samples: 5,
  minimum_self_time_ms: 10,
  minimum_sample_share: 0.1,
  minimum_file_sample_share: 0.2,
  minimum_application_sample_share: 0.02,
  minimum_application_file_share: 0.5,
});

export async function profileRepository({
  repositoryRoot,
  adapter,
  target,
  name,
  timeoutMs,
  samples = LIMITS.defaultSamples,
  warmups = LIMITS.defaultWarmups,
  baselinePath,
  regressionPercent = 20,
  regressionMs = 25,
  captureFlow = false,
}) {
  const lexicalRoot = resolve(repositoryRoot);
  const root = await realpath(lexicalRoot);
  const goVersion = adapter === 'go-bench' ? await inspectGoRuntimeVersion(root) : null;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'codevetter-profile-'));
  const executions = [];
  let profileEvidence = emptyProfileEvidence(adapter);
  const profileRuns = [];
  let heapProfileEvidence = emptyV8HeapProfileEvidence();
  const heapProfileRuns = [];
  let goMemoryBinary = null;
  let flowEvidence = emptyFlowEvidence();
  let functionCoverage = emptyFunctionCoverage();
  let cleanupFailed = false;

  try {
    for (let index = 0; index < warmups; index += 1) {
      executions.push({
        phase: 'warmup',
        index,
        execution: await runClosedAdapter({
          repositoryRoot: root,
          adapter,
          target,
          name,
          timeoutMs,
        }),
      });
    }
    for (let index = 0; index < samples; index += 1) {
      executions.push({
        phase: 'measurement',
        index,
        execution: await runClosedAdapter({
          repositoryRoot: root,
          adapter,
          target,
          name,
          timeoutMs,
        }),
      });
    }
    if (adapter === 'go-bench') {
      const memoryBinaryDirectory = join(temporaryDirectory, 'go-memory-binary');
      await mkdir(memoryBinaryDirectory);
      const preparation = await compileGoBenchmarkBinary({
        repositoryRoot: root,
        target,
        timeoutMs,
        outputDirectory: memoryBinaryDirectory,
      });
      if (!preparation.prepared_binary) {
        throw new Error('the owned Go benchmark memory binary could not be compiled');
      }
      goMemoryBinary = preparation.prepared_binary;
    }
    if (['vitest', 'jest', 'node-test', 'node-script', 'go-bench'].includes(adapter)) {
      for (let index = 0; index < LIMITS.memorySamples; index += 1) {
        executions.push({
          phase: 'memory',
          index,
          execution: await runClosedAdapter({
            repositoryRoot: root,
            adapter,
            target,
            name,
            timeoutMs,
            measureMemory: true,
            goBenchmarkBinary: goMemoryBinary,
          }),
        });
      }
    }
    if (captureFlow && ['node-test', 'vitest', 'jest'].includes(adapter)) {
      const flowDirectory = join(temporaryDirectory, 'flow');
      await mkdir(flowDirectory);
      executions.push({
        phase: 'flow',
        index: 0,
        execution: await runClosedAdapter({
          repositoryRoot: root,
          adapter,
          target,
          name,
          timeoutMs,
          flowDirectory,
        }),
      });
      flowEvidence = await collectNodeFlowEvents(flowDirectory);

      const coverageDirectory = join(temporaryDirectory, 'coverage');
      await mkdir(coverageDirectory);
      executions.push({
        phase: 'coverage',
        index: 0,
        execution: await runClosedAdapter({
          repositoryRoot: root,
          adapter,
          target,
          name,
          timeoutMs,
          coverageDirectory,
          vitestReporter: adapter === 'vitest' ? 'dot' : undefined,
        }),
      });
      functionCoverage = await collectV8FunctionCoverage(coverageDirectory, root);
    }

    const goProfileIterations =
      adapter === 'go-bench'
        ? goProfileIterationCount(
            parseGoBenchmarks(
              executions
                .filter((entry) => entry.phase === 'measurement')
                .map((entry) => `${entry.execution.stdout}\n${entry.execution.stderr}`)
                .join('\n')
            )[0]
          )
        : null;
    const profileRunCount = V8_PROFILE_RUNS;
    for (let index = 0; index < profileRunCount; index += 1) {
      const profileDirectory = join(temporaryDirectory, `profile-${index}`);
      await mkdir(profileDirectory);
      const execution = await runClosedAdapter({
        repositoryRoot: root,
        adapter,
        target,
        name,
        timeoutMs,
        profileDirectory,
        goBenchmarkIterations: goProfileIterations,
      });
      executions.push({
        phase: 'profile',
        index,
        execution,
      });
      const profileRun =
        adapter === 'go-bench'
          ? await collectGoProfileEvidence(profileDirectory, root)
          : await collectV8ProfileEvidence(profileDirectory, root);
      profileRuns.push(
        adapter === 'go-bench'
          ? {
              ...profileRun,
              benchmark: parseGoBenchmarks(`${execution.stdout}\n${execution.stderr}`)[0] ?? null,
              fixed_benchmark_iterations: goProfileIterations,
            }
          : profileRun
      );
    }
    profileEvidence = combineProfileRuns(profileRuns, adapter);
    if (adapter !== 'go-bench') {
      for (let index = 0; index < V8_HEAP_PROFILE_RUNS; index += 1) {
        const heapProfileDirectory = join(temporaryDirectory, `heap-profile-${index}`);
        await mkdir(heapProfileDirectory);
        executions.push({
          phase: 'heap_profile',
          index,
          execution: await runClosedAdapter({
            repositoryRoot: root,
            adapter,
            target,
            name,
            timeoutMs,
            heapProfileDirectory,
          }),
        });
        heapProfileRuns.push(await collectV8HeapProfileEvidence(heapProfileDirectory, root));
      }
      heapProfileEvidence = combineV8HeapProfileRuns(heapProfileRuns);
    }
  } finally {
    try {
      await rm(temporaryDirectory, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
  }

  const git = await inspectGitDiff(root);
  const baseline = baselinePath ? await loadPerformanceCapsule(root, baselinePath) : null;
  return createPerformanceCapsule({
    root,
    lexicalRoot,
    git,
    adapter,
    target,
    name,
    samples,
    warmups,
    executions,
    profileEvidence,
    profileRuns,
    heapProfileEvidence,
    heapProfileRuns,
    flowEvidence,
    functionCoverage,
    cleanupFailed,
    baseline,
    regressionPercent,
    regressionMs,
    goVersion,
  });
}

export function createPerformanceCapsule({
  root,
  lexicalRoot = root,
  git,
  adapter,
  target,
  name,
  samples,
  warmups,
  executions,
  profileEvidence,
  profileRuns = [],
  heapProfileEvidence = emptyV8HeapProfileEvidence(),
  heapProfileRuns = [],
  flowEvidence = emptyFlowEvidence(),
  functionCoverage = emptyFunctionCoverage(),
  cleanupFailed = false,
  baseline = null,
  regressionPercent = 20,
  regressionMs = 25,
  goVersion = null,
}) {
  let redactionCount = 0;
  let outputTruncated = false;
  const sanitizedExecutions = executions.map(({ phase, index, execution }) => {
    const stdout = redactText(execution.stdout, {
      repositoryRoot: root,
      repositoryRoots: [lexicalRoot],
      environmentValues: execution.environmentValues,
      limit: LIMITS.summaryCharacters,
    });
    const stderr = redactText(execution.stderr, {
      repositoryRoot: root,
      repositoryRoots: [lexicalRoot],
      environmentValues: execution.environmentValues,
      limit: LIMITS.summaryCharacters,
    });
    const operationalError = redactText(execution.operationalError, {
      repositoryRoot: root,
      repositoryRoots: [lexicalRoot],
      environmentValues: execution.environmentValues,
      limit: 500,
    });
    redactionCount +=
      stdout.redaction_count + stderr.redaction_count + operationalError.redaction_count;
    outputTruncated ||= stdout.truncated || stderr.truncated || execution.truncated;
    return {
      phase,
      index,
      execution,
      stdout: stdout.text,
      stderr: stderr.text,
      operationalError: operationalError.text,
    };
  });
  const measured = sanitizedExecutions.filter((entry) => entry.phase === 'measurement');
  const timing = summarizeDistribution(measured.map((entry) => entry.execution.durationMs));
  const memoryPeakRss = summarizeDistribution(
    sanitizedExecutions
      .filter((entry) => entry.phase === 'memory')
      .map((entry) => entry.execution.memory?.peak_rss_bytes)
  );
  const goBenchmarks =
    adapter === 'go-bench'
      ? parseGoBenchmarks(measured.map((entry) => `${entry.stdout}\n${entry.stderr}`).join('\n'))
      : [];
  const vitestTests =
    adapter === 'vitest'
      ? parseVitestTimings(
          measured.map((entry) => entry.stdout),
          root
        )
      : [];
  const vitestExecutionShare = summarizeVitestExecutionShare(vitestTests, timing);
  const profileExecution = sanitizedExecutions.find((entry) => entry.phase === 'profile');
  const consoleMetrics =
    ['node-test', 'node-script', 'vitest', 'jest'].includes(adapter) && measured.length > 0
      ? summarizeConsoleBenchmarkMetrics(
          measured.map((entry) => `${entry.stdout}\n${entry.stderr}`),
          'unprofiled_measurement_execution_median'
        )
      : parseConsoleBenchmarkMetrics(
          profileExecution ? `${profileExecution.stdout}\n${profileExecution.stderr}` : '',
          'profile_execution_stdout'
        );
  const executionComplete = requiredExecutionsCompleted(sanitizedExecutions, adapter, name);
  const heapProfileExecutions = sanitizedExecutions.filter(
    (entry) => entry.phase === 'heap_profile'
  );
  const heapProfileExecutionComplete =
    adapter !== 'go-bench' &&
    heapProfileExecutions.length === V8_HEAP_PROFILE_RUNS &&
    heapProfileExecutions.every(
      (entry) =>
        entry.execution.status === 'exited' &&
        entry.execution.exitCode === 0 &&
        selectedWorkloadExecuted(entry, adapter, name)
    );
  const limitations = [];
  limitations.push(...functionCoverage.limitations);
  if (functionCoverage.truncated) {
    limitations.push('The bounded V8 function coverage evidence was truncated.');
  }
  if (!executionComplete)
    limitations.push('One or more required workload executions did not complete successfully.');
  for (const entry of sanitizedExecutions.filter(
    (candidate) =>
      candidate.phase === 'coverage' &&
      (candidate.execution.status !== 'exited' || candidate.execution.exitCode !== 0)
  )) {
    limitations.push(
      `Optional function coverage execution failed: ${entry.operationalError || `exit ${entry.execution.exitCode ?? 'unknown'}`}.`
    );
  }
  for (const entry of heapProfileExecutions.filter(
    (candidate) =>
      candidate.execution.status !== 'exited' ||
      candidate.execution.exitCode !== 0 ||
      !selectedWorkloadExecuted(candidate, adapter, name)
  )) {
    limitations.push(
      `Optional heap-allocation profile ${entry.index + 1} failed or did not select the exact workload: ${entry.operationalError || `exit ${entry.execution.exitCode ?? 'unknown'}`}.`
    );
  }
  for (const entry of sanitizedExecutions.filter(
    (candidate) =>
      !['coverage', 'heap_profile'].includes(candidate.phase) &&
      (candidate.execution.status !== 'exited' || candidate.execution.exitCode !== 0)
  )) {
    limitations.push(
      `${entry.phase} execution ${entry.index + 1} failed: ${entry.operationalError || `exit ${entry.execution.exitCode ?? 'unknown'}`}.`
    );
  }
  if (cleanupFailed)
    limitations.push('Owned temporary profiling artifacts could not be completely removed.');
  if (outputTruncated) limitations.push('Runner output was truncated before normalization.');
  if (adapter === 'go-bench' && goBenchmarks.length === 0) {
    limitations.push('No matching Go benchmark measurement was captured.');
  }
  if (adapter === 'go-bench' && profileEvidence.hotspots.length === 0) {
    limitations.push('Go profiles contained no repository-owned source rows.');
  }
  if (adapter === 'go-bench' && profileRuns.length > 0) {
    limitations.push(
      'Go pprof direct allocation values are normalized per benchmark operation; they do not represent retained heap or peak memory.'
    );
  }
  for (const kind of profileEvidence.failed_kinds ?? []) {
    limitations.push(`The ${kind} Go profile could not be normalized.`);
  }
  if (adapter !== 'go-bench' && profileEvidence.profile_files === 0) {
    limitations.push('The runtime produced no V8 CPU profile.');
  }
  if (adapter !== 'go-bench' && profileEvidence.hotspots.length === 0) {
    limitations.push('The CPU profile contained no repository-owned source samples.');
  }
  if (
    adapter !== 'go-bench' &&
    heapProfileExecutions.length > 0 &&
    heapProfileEvidence.profile_files === 0
  ) {
    limitations.push('The runtime produced no V8 heap-allocation profile.');
  }
  if (
    adapter !== 'go-bench' &&
    heapProfileExecutionComplete &&
    heapProfileEvidence.hotspots.every((hotspot) => hotspot.role !== 'application')
  ) {
    limitations.push(
      'The heap-allocation profiles contained no repository-owned application source.'
    );
  }
  if (
    adapter !== 'go-bench' &&
    heapProfileExecutionComplete &&
    !heapProfileEvidence.repeatability?.qualified
  ) {
    limitations.push(heapProfileEvidence.repeatability.reason);
  }
  if (heapProfileEvidence.truncated) {
    limitations.push('V8 heap-allocation profile evidence exceeded collection bounds.');
  }
  if (
    adapter !== 'go-bench' &&
    profileEvidence.hotspots.length > 0 &&
    !profileEvidence.hotspots.some((hotspot) => hotspot.role === 'application')
  ) {
    limitations.push('The CPU profile captured only test or benchmark harness source.');
  }
  if (profileEvidence.truncated)
    limitations.push('Runtime profile evidence exceeded collection bounds.');
  if (
    adapter !== 'go-bench' &&
    profileRuns.length >= V8_PROFILE_RUNS &&
    !profileEvidence.repeatability?.qualified
  ) {
    limitations.push(profileEvidence.repeatability.reason);
  }
  if (flowEvidence.truncated) limitations.push('Runtime flow evidence exceeded collection bounds.');
  if (adapter !== 'go-bench' && timing.spread_percent !== null && timing.spread_percent > 50) {
    limitations.push(
      `Wall-time samples varied by ${timing.spread_percent}%; host load or startup noise may dominate the comparison.`
    );
  }
  if (memoryPeakRss.count > 0) {
    limitations.push(
      adapter === 'go-bench'
        ? 'Peak RSS is sampled from an owned Go benchmark binary with compilation excluded; it is a regression guard and does not identify an allocation source.'
        : 'Peak RSS is sampled process-tree evidence; it includes runtime and test-runner memory and does not identify an allocation source.'
    );
  }
  if (vitestExecutionShare?.classification === 'startup_dominated') {
    limitations.push(
      `Vitest reported assertion time is ${vitestExecutionShare.assertion_share_percent}% of exact-scope wall time; runner startup dominates and no product bottleneck is attributed.`
    );
  }

  const comparison = baseline
    ? comparePerformanceCapsules(
        {
          schema_version: PERFORMANCE_SCHEMA_VERSION,
          subject: { repository_revision: git.repository_revision },
          adapter: { kind: adapter },
          scope: { target, name: name ?? null },
          sample_policy: { samples, warmups },
          observed: { wall_time_ms: timing, go_benchmarks: goBenchmarks },
        },
        baseline,
        { regressionPercent, regressionMs }
      )
    : null;
  if (comparison?.status === 'incompatible') limitations.push(comparison.reason);

  const complete =
    executionComplete &&
    !cleanupFailed &&
    timing.count >= LIMITS.minimumSamples &&
    (adapter !== 'go-bench' || goBenchmarks.length > 0) &&
    comparison?.status !== 'incompatible';
  const verdict = !complete
    ? 'no_confidence'
    : comparison?.status === 'regressed'
      ? 'regressed'
      : comparison?.status === 'improved'
        ? 'improved'
        : comparison
          ? 'stable'
          : 'profiled';

  const qualifiedV8Candidate = profileEvidence.repeatability?.qualified
    ? profileEvidence.repeatability.candidate
    : null;
  const qualifiedHeapAllocationSelections =
    heapProfileExecutionComplete && !heapProfileEvidence.truncated
      ? selectV8HeapAllocationCandidates(heapProfileEvidence, heapProfileRuns, qualifiedV8Candidate)
      : [];
  const qualifiedHeapAllocationSelection = qualifiedHeapAllocationSelections[0] ?? null;
  const qualifiedHeapAllocationCandidate = qualifiedHeapAllocationSelection?.candidate ?? null;
  const hotspotFrames = profileEvidence.hotspots.map((hotspot, index) => ({
    id: `hotspot-${index + 1}`,
    file: hotspot.file,
    line: hotspot.line,
  }));
  for (const [index, selection] of qualifiedHeapAllocationSelections.entries()) {
    hotspotFrames.push({
      id: `heap-allocation-hotspot-${index + 1}`,
      file: selection.candidate.file,
      line: selection.candidate.line,
    });
  }
  const relevantChanges = rankRelevantChanges(hotspotFrames, git.changed_lines).slice(
    0,
    LIMITS.changes
  );
  const findings = [];
  const commandIdentity = sanitizedExecutions[0]?.execution.command;
  if (comparison && ['regressed', 'improved', 'stable'].includes(comparison.status)) {
    findings.push({
      kind: `baseline_${comparison.status}`,
      basis: comparison.metric,
      comparison,
    });
  }
  if (vitestExecutionShare?.classification === 'startup_dominated') {
    findings.push({
      kind: 'startup_dominated_scope',
      basis: 'vitest_reported_assertion_time_vs_process_wall_time',
      assertion_median_total_ms: vitestExecutionShare.assertion_median_total_ms,
      wall_median_ms: vitestExecutionShare.wall_median_ms,
      assertion_share_percent: vitestExecutionShare.assertion_share_percent,
      threshold_percent: STARTUP_DOMINATED_SHARE_PERCENT,
    });
  }
  for (const hotspot of profileEvidence.hotspots
    .filter(
      (candidate) =>
        adapter !== 'go-bench' &&
        candidate.role === 'application' &&
        qualifiedV8Candidate &&
        candidate.file === qualifiedV8Candidate.file &&
        candidate.function === qualifiedV8Candidate.function
    )
    .slice(0, 5)) {
    findings.push({
      kind: 'application_hotspot_candidate',
      basis: 'repository_owned_v8_cpu_samples',
      source: { file: hotspot.file, line: hotspot.line, function: hotspot.function },
      self_time_ms: hotspot.self_time_ms,
      sample_share: hotspot.sample_share,
    });
  }
  for (const { candidate, basis } of qualifiedHeapAllocationSelections) {
    findings.push({
      kind: 'node_allocation_candidate',
      basis,
      source: {
        file: candidate.file,
        line: candidate.line,
        function: candidate.function,
      },
      sampled_bytes: candidate.sampled_bytes,
      per_run_sampled_bytes: candidate.per_run_sampled_bytes,
      sample_share: candidate.sample_share,
      provenance: candidate.provenance,
    });
  }
  const repeatedGoAllocations =
    adapter === 'go-bench' ? repeatableGoAllocationCandidates(profileRuns) : [];
  const repeatedGoAllocationKeys = new Set(
    repeatedGoAllocations.map(
      (candidate) => `${candidate.source.file}\0${candidate.source.function}`
    )
  );
  const cumulativeGoAllocations = profileEvidence.hotspots
    .filter(
      (candidate) =>
        adapter === 'go-bench' &&
        candidate.role === 'application' &&
        candidate.profile_kind === 'go_alloc_objects' &&
        candidate.cumulative_share >= APPLICATION_ALLOCATION_OBJECT_SHARE &&
        !repeatedGoAllocationKeys.has(`${candidate.file}\0${candidate.function}`)
    )
    .map((hotspot) => ({
      basis: 'repository_owned_go_alloc_objects_cumulative_path',
      profile_kind: hotspot.profile_kind,
      source: { file: hotspot.file, line: hotspot.line, function: hotspot.function },
      flat_profile_objects: hotspot.flat,
      cumulative_profile_objects: hotspot.cumulative,
      flat_share: hotspot.flat_share,
      cumulative_share: hotspot.cumulative_share,
    }));
  for (const candidate of [...repeatedGoAllocations, ...cumulativeGoAllocations].slice(0, 5)) {
    findings.push({
      kind: 'go_allocation_path_candidate',
      ...candidate,
    });
  }
  for (const hotspot of profileEvidence.hotspots
    .filter(
      (candidate) =>
        adapter === 'go-bench' &&
        candidate.role === 'application' &&
        candidate.profile_kind === 'go_cpu' &&
        candidate.flat_share >= APPLICATION_HOTSPOT_SHARE
    )
    .slice(0, 5)) {
    findings.push({
      kind: 'application_hotspot_candidate',
      basis: 'repository_owned_go_cpu_direct_path',
      profile_kind: hotspot.profile_kind,
      source: { file: hotspot.file, line: hotspot.line, function: hotspot.function },
      self_time_ms: hotspot.flat,
      sample_share: hotspot.flat_share,
    });
  }
  for (const change of relevantChanges) {
    findings.push({
      kind: 'changed_hotspot_relationship',
      basis: change.reason,
      source: { file: change.file, line: change.line },
      distance: change.distance,
    });
  }

  const capsule = {
    schema_version: PERFORMANCE_SCHEMA_VERSION,
    subject: {
      repository_revision: git.repository_revision,
      diff_identity: git.diff_identity,
      source_snapshot_sha256: git.source_snapshot_sha256,
      dirty: git.dirty,
      platform: process.platform,
      architecture: process.arch,
      node_version: process.version,
      go_version: goVersion,
      host_load: {
        logical_cpus: cpus().length,
        one_minute: round(loadavg()[0]),
        five_minutes: round(loadavg()[1]),
        fifteen_minutes: round(loadavg()[2]),
      },
    },
    adapter: {
      kind: adapter,
      executable_identity: commandIdentity?.executable_identity ?? `${adapter}:unavailable`,
      arguments: commandIdentity?.arguments ?? [],
      working_directory: commandIdentity?.working_directory ?? '.',
    },
    scope: { target, name: name ?? null },
    sample_policy: { samples, warmups },
    observed: {
      executions: sanitizedExecutions.map((entry) => summarizeExecution(entry, adapter, name)),
      wall_time_ms: timing,
      peak_rss_bytes: memoryPeakRss,
      hotspots: profileEvidence.hotspots,
      go_benchmarks: goBenchmarks,
      vitest_tests: vitestTests,
      vitest_execution_share: vitestExecutionShare,
      console_metrics: consoleMetrics,
      profile_runs: profileRuns.map(profileRunSummary),
      profile_repeatability: profileEvidence.repeatability ?? null,
      heap_allocation_hotspots: heapProfileEvidence.hotspots,
      heap_profile_runs: heapProfileRuns.map(v8HeapProfileRunSummary),
      heap_profile_repeatability: heapProfileEvidence.repeatability,
      flow_evidence: flowEvidence,
      function_coverage: functionCoverage,
    },
    findings,
    relationships: relevantChanges,
    unverified: [
      ...profileEvidence.hotspots
        .filter(
          (hotspot) =>
            hotspot.role === 'application' &&
            (adapter === 'go-bench' ||
              (qualifiedV8Candidate &&
                hotspot.file === qualifiedV8Candidate.file &&
                hotspot.function === qualifiedV8Candidate.function))
        )
        .slice(0, 1)
        .map((hotspot) => ({
          kind: 'optimization_hypothesis',
          summary: `Investigate ${hotspot.file}:${hotspot.line} because it received the largest repository-owned application CPU share.`,
          verification_required:
            'Change the candidate, capture a new capsule, and compare it with this baseline.',
        })),
      ...(qualifiedHeapAllocationCandidate
        ? [
            {
              kind: 'allocation_reduction_hypothesis',
              summary: `Investigate ${qualifiedHeapAllocationCandidate.file}:${qualifiedHeapAllocationCandidate.line} because two V8 heap profiles repeated it as the leading repository-owned sampled-allocation source.`,
              verification_required:
                'Rerun the identical workload and require lower repeated sampled-allocation evidence without correctness, latency, or peak-RSS regression.',
            },
          ]
        : []),
    ],
    comparison,
    limitations: [...new Set(limitations)],
    capture: {
      profile_kind: profileEvidence.kind,
      profile_files: profileEvidence.profile_files,
      profile_bytes: profileEvidence.profile_bytes,
      profile_samples: profileEvidence.profile_samples,
      heap_profile_files: heapProfileEvidence.profile_files,
      heap_profile_bytes: heapProfileEvidence.profile_bytes,
      heap_profile_samples: heapProfileEvidence.profile_samples,
      heap_sampled_bytes: heapProfileEvidence.sampled_bytes,
      heap_sampling_interval_bytes: heapProfileEvidence.sampling_interval_bytes,
      go_profile_iterations:
        adapter === 'go-bench' ? (profileRuns[0]?.fixed_benchmark_iterations ?? null) : null,
      heap_profile_truncated: heapProfileEvidence.truncated,
      truncated: profileEvidence.truncated || outputTruncated,
      redaction_count:
        redactionCount +
        profileEvidence.redaction_count +
        heapProfileEvidence.redaction_count +
        functionCoverage.redaction_count,
      temporary_artifacts_retained: cleanupFailed,
      flow_files: flowEvidence.files,
      flow_events: flowEvidence.events.length,
      coverage_files: functionCoverage.coverage_files,
      coverage_bytes: functionCoverage.coverage_bytes,
      coverage_functions: functionCoverage.functions.length,
    },
    verdict: {
      status: verdict,
      reason:
        verdict === 'no_confidence'
          ? 'Required performance evidence was incomplete.'
          : verdict === 'regressed'
            ? 'Compatible baseline thresholds demonstrate a wall-time regression.'
            : 'The exact workload completed with bounded performance evidence.',
    },
  };
  capsule.detector_coverage_matrix = createDetectorCoverageMatrix({
    adapter,
    performanceCapsule: capsule,
  });
  const errors = validatePerformanceCapsule(capsule);
  if (errors.length > 0) throw new Error(`invalid performance capsule: ${errors.join(', ')}`);
  return capsule;
}

function summarizeExecution(entry, adapter, name) {
  const summary = {
    phase: entry.phase,
    index: entry.index,
    status: entry.execution.status,
    exit_code: entry.execution.exitCode,
    signal: entry.execution.signal,
    duration_ms: entry.execution.durationMs,
    workload_selected: selectedWorkloadExecuted(entry, adapter, name),
    ...(entry.execution.memory ? { memory: entry.execution.memory } : {}),
  };
  if (entry.execution.status === 'exited' && entry.execution.exitCode === 0) return summary;
  return {
    ...summary,
    failure_evidence: {
      operational_error: compactFailureText(entry.operationalError),
      stdout: compactFailureText(entry.stdout),
      stderr: compactFailureText(entry.stderr),
    },
  };
}

function compactFailureText(value) {
  const normalized = String(value ?? '').trim();
  if (normalized.length === 0) return null;
  return normalized.length <= 1_000 ? normalized : `…${normalized.slice(-999)}`;
}

export function summarizeVitestExecutionShare(vitestTests, wallTime) {
  if (
    !Array.isArray(vitestTests) ||
    vitestTests.length === 0 ||
    !Number.isFinite(wallTime?.median) ||
    wallTime.median <= 0
  ) {
    return null;
  }
  const assertionMedianTotal = vitestTests.reduce(
    (total, test) => total + (Number(test?.duration_ms?.median) || 0),
    0
  );
  const sharePercent = round((assertionMedianTotal / wallTime.median) * 100);
  return {
    assertion_median_total_ms: round(assertionMedianTotal),
    wall_median_ms: wallTime.median,
    assertion_share_percent: sharePercent,
    classification:
      sharePercent < STARTUP_DOMINATED_SHARE_PERCENT
        ? 'startup_dominated'
        : 'application_time_material',
  };
}

export function summarizeDistribution(values) {
  const sorted = values.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (sorted.length === 0) {
    return {
      count: 0,
      min: null,
      median: null,
      p95: null,
      max: null,
      spread_percent: null,
    };
  }
  const median = percentile(sorted, 0.5);
  return {
    count: sorted.length,
    min: sorted[0],
    median,
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1),
    spread_percent: median > 0 ? round(((sorted.at(-1) - sorted[0]) / median) * 100) : null,
  };
}

export function parseGoBenchmarks(output) {
  const values = new Map();
  for (const line of String(output).split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (!fields[0]?.startsWith('Benchmark') || !/^\d+$/.test(fields[1] ?? '')) continue;
    const measurement = { name: fields[0], iterations: Number(fields[1]) };
    for (let index = 2; index < fields.length - 1; index += 1) {
      const value = Number(fields[index]);
      const unit = fields[index + 1];
      if (!Number.isFinite(value)) continue;
      if (unit === 'ns/op') measurement.ns_per_op = value;
      if (unit === 'B/op') measurement.bytes_per_op = value;
      if (unit === 'allocs/op') measurement.allocs_per_op = value;
    }
    if (!Number.isFinite(measurement.ns_per_op)) continue;
    const group = values.get(measurement.name) ?? [];
    group.push(measurement);
    values.set(measurement.name, group);
  }
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, LIMITS.hotspots)
    .map(([name, measurements]) => ({
      name,
      samples: measurements.length,
      iterations: summarizeDistribution(measurements.map((entry) => entry.iterations)),
      ns_per_op: summarizeDistribution(measurements.map((entry) => entry.ns_per_op)),
      bytes_per_op: optionalDistribution(measurements, 'bytes_per_op'),
      allocs_per_op: optionalDistribution(measurements, 'allocs_per_op'),
      provenance: 'go_test_benchmark_output',
    }));
}

export function goProfileIterationCount(benchmark) {
  const nanoseconds = benchmark?.ns_per_op?.median;
  if (!Number.isFinite(nanoseconds) || nanoseconds <= 0) return null;
  return Math.max(
    1,
    Math.min(GO_PROFILE_MAXIMUM_ITERATIONS, Math.round(GO_PROFILE_TARGET_NS / nanoseconds))
  );
}

export function parseVitestTimings(outputs, repositoryRoot) {
  const groups = new Map();
  for (const output of outputs) {
    const report = parseVitestReport(output);
    if (!report) continue;
    for (const result of Array.isArray(report?.testResults) ? report.testResults : []) {
      const file = normalizeVitestFile(result?.name, repositoryRoot);
      for (const assertion of Array.isArray(result?.assertionResults)
        ? result.assertionResults
        : []) {
        if (
          assertion?.status !== 'passed' ||
          typeof assertion?.fullName !== 'string' ||
          !Number.isFinite(Number(assertion?.duration))
        ) {
          continue;
        }
        const key = `${file ?? '<unknown>'}:${assertion.fullName}`;
        const group = groups.get(key) ?? {
          name: assertion.fullName,
          file,
          durations: [],
        };
        group.durations.push(Number(assertion.duration));
        groups.set(key, group);
      }
    }
  }
  return [...groups.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, LIMITS.observations)
    .map((group) => ({
      name: group.name,
      file: group.file,
      duration_ms: summarizeDistribution(group.durations),
      provenance: 'vitest_json_reporter',
    }));
}

export function parseConsoleBenchmarkMetrics(output, provenance = 'profile_execution_stdout') {
  const observations = [];
  for (const line of String(output).split(/\r?\n/)) {
    if (!line.includes('[benchmark]')) continue;
    const metrics = [];
    const pattern = /([A-Za-z][\w.-]*)=(-?\d+(?:\.\d+)?)([A-Za-zµ/]+)/g;
    for (const match of line.matchAll(pattern)) {
      metrics.push({ name: match[1], value: Number(match[2]), unit: match[3] });
    }
    if (metrics.length === 0) continue;
    const iterations = /\((\d+)\s+iterations?\)/i.exec(line);
    observations.push({
      kind: 'console_benchmark_metrics',
      metrics: metrics.slice(0, LIMITS.hotspots),
      iterations: iterations ? Number(iterations[1]) : null,
      provenance,
    });
    if (observations.length >= LIMITS.observations) break;
  }
  return observations;
}

export function summarizeConsoleBenchmarkMetrics(
  outputs,
  provenance = 'unprofiled_metrics_execution_median'
) {
  const parsed = outputs.map((output) =>
    parseConsoleBenchmarkMetrics(output, 'unprofiled_metrics_execution_stdout')
  );
  const maximumObservations = Math.max(0, ...parsed.map((observations) => observations.length));
  const summaries = [];
  for (let observationIndex = 0; observationIndex < maximumObservations; observationIndex += 1) {
    const groups = new Map();
    const iterations = [];
    for (const observations of parsed) {
      const observation = observations[observationIndex];
      if (!observation) continue;
      if (Number.isFinite(observation.iterations)) iterations.push(observation.iterations);
      for (const metric of observation.metrics) {
        const key = `${metric.name}:${metric.unit}`;
        const group = groups.get(key) ?? { name: metric.name, unit: metric.unit, values: [] };
        group.values.push(metric.value);
        groups.set(key, group);
      }
    }
    if (groups.size === 0) continue;
    summaries.push({
      kind: 'console_benchmark_metrics',
      metrics: [...groups.values()].map((group) => ({
        name: group.name,
        value: summarizeDistribution(group.values).median,
        unit: group.unit,
        sample_count: group.values.length,
      })),
      iterations: iterations.length > 0 ? summarizeDistribution(iterations).median : null,
      provenance,
    });
  }
  return summaries.slice(0, LIMITS.observations);
}

export function parseV8CpuProfileDocuments(documents, repositoryRoot) {
  const root = resolve(repositoryRoot);
  const aggregates = new Map();
  let totalProfileMs = 0;
  let profileSamples = 0;
  let truncated = documents.length > LIMITS.profileFiles;
  let redactionCount = 0;

  for (const document of documents.slice(0, LIMITS.profileFiles)) {
    const nodes = new Map(
      (Array.isArray(document?.nodes) ? document.nodes : [])
        .slice(0, LIMITS.profileSamples)
        .map((node) => [node.id, node])
    );
    const samples = Array.isArray(document?.samples) ? document.samples : [];
    const deltas = Array.isArray(document?.timeDeltas) ? document.timeDeltas : [];
    const count = Math.min(samples.length, deltas.length, LIMITS.profileSamples);
    truncated ||= samples.length > count || deltas.length > count;
    for (let index = 0; index < count; index += 1) {
      const durationMs = Math.max(0, Number(deltas[index]) || 0) / 1000;
      totalProfileMs += durationMs;
      profileSamples += 1;
      const node = nodes.get(samples[index]);
      const normalized = normalizeV8Frame(node?.callFrame, root);
      if (!normalized) continue;
      const safeFunction = redactText(normalized.function, { limit: 200 });
      redactionCount += safeFunction.redaction_count;
      const key = `${normalized.file}:${normalized.line}:${safeFunction.text}`;
      const aggregate = aggregates.get(key) ?? {
        function: safeFunction.text || '<anonymous>',
        file: normalized.file,
        line: normalized.line,
        role: sourceRole(normalized.file),
        self_time_ms: 0,
        samples: 0,
      };
      aggregate.self_time_ms += durationMs;
      aggregate.samples += 1;
      aggregates.set(key, aggregate);
    }
  }

  const hotspots = [...aggregates.values()]
    .sort(
      (left, right) =>
        right.self_time_ms - left.self_time_ms ||
        left.file.localeCompare(right.file) ||
        left.line - right.line
    )
    .slice(0, LIMITS.hotspots)
    .map((entry) => ({
      ...entry,
      self_time_ms: round(entry.self_time_ms),
      sample_share: totalProfileMs > 0 ? round(entry.self_time_ms / totalProfileMs, 4) : 0,
    }));
  if (aggregates.size > LIMITS.hotspots) truncated = true;
  return { hotspots, profile_samples: profileSamples, truncated, redaction_count: redactionCount };
}

export function comparePerformanceCapsules(current, baseline, policy = {}) {
  const regressionPercent = policy.regressionPercent ?? 20;
  const regressionMs = policy.regressionMs ?? 25;
  const compatible =
    baseline?.schema_version === PERFORMANCE_SCHEMA_VERSION &&
    baseline?.adapter?.kind === current?.adapter?.kind &&
    baseline?.scope?.target === current?.scope?.target &&
    (baseline?.scope?.name ?? null) === (current?.scope?.name ?? null);
  if (!compatible) {
    return {
      status: 'incompatible',
      reason: 'Baseline schema, adapter, target, or exact workload identity is incompatible.',
    };
  }
  if (current.adapter.kind === 'go-bench') {
    return compareGoBenchmarkCapsules(current, baseline, regressionPercent);
  }
  const currentTiming = current?.observed?.wall_time_ms;
  const baselineTiming = baseline?.observed?.wall_time_ms;
  if (
    currentTiming?.count < LIMITS.minimumSamples ||
    baselineTiming?.count < LIMITS.minimumSamples ||
    !Number.isFinite(currentTiming?.median) ||
    !Number.isFinite(baselineTiming?.median) ||
    baselineTiming.median <= 0
  ) {
    return {
      status: 'incompatible',
      reason: 'Current or baseline timing evidence has insufficient compatible samples.',
    };
  }
  const currentSpread = distributionSpread(currentTiming);
  const baselineSpread = distributionSpread(baselineTiming);
  if (currentSpread > 50 || baselineSpread > 50) {
    return {
      status: 'incompatible',
      reason: 'Current or baseline wall-time samples are too variable for a regression claim.',
    };
  }
  const deltaMs = currentTiming.median - baselineTiming.median;
  const deltaPercent = (deltaMs / baselineTiming.median) * 100;
  const material = Math.abs(deltaMs) >= regressionMs && Math.abs(deltaPercent) >= regressionPercent;
  const status = !material ? 'stable' : deltaMs > 0 ? 'regressed' : 'improved';
  return {
    status,
    metric: 'median_wall_time_ms',
    baseline: { median: baselineTiming.median, samples: baselineTiming.count },
    current: { median: currentTiming.median, samples: currentTiming.count },
    delta_ms: round(deltaMs),
    delta_percent: round(deltaPercent),
    policy: { minimum_delta_ms: regressionMs, minimum_delta_percent: regressionPercent },
    baseline_revision: baseline.subject?.repository_revision ?? null,
    current_revision: current.subject?.repository_revision ?? null,
  };
}

function compareGoBenchmarkCapsules(current, baseline, regressionPercent) {
  const currentBenchmarks = current?.observed?.go_benchmarks ?? [];
  const baselineBenchmarks = baseline?.observed?.go_benchmarks ?? [];
  if (currentBenchmarks.length !== 1 || baselineBenchmarks.length !== 1) {
    return {
      status: 'incompatible',
      reason: 'Current and baseline must each contain one exact Go benchmark measurement.',
    };
  }
  const currentBenchmark = currentBenchmarks[0];
  const baselineBenchmark = baselineBenchmarks[0];
  const currentTiming = currentBenchmark.ns_per_op;
  const baselineTiming = baselineBenchmark.ns_per_op;
  if (
    currentBenchmark.name !== baselineBenchmark.name ||
    currentTiming?.count < LIMITS.minimumSamples ||
    baselineTiming?.count < LIMITS.minimumSamples ||
    !Number.isFinite(currentTiming?.median) ||
    !Number.isFinite(baselineTiming?.median) ||
    baselineTiming.median <= 0
  ) {
    return {
      status: 'incompatible',
      reason: 'Current or baseline Go benchmark evidence is not an exact compatible sample set.',
    };
  }
  if (distributionSpread(currentTiming) > 50 || distributionSpread(baselineTiming) > 50) {
    return {
      status: 'incompatible',
      reason: 'Current or baseline Go ns/op samples are too variable for a regression claim.',
    };
  }
  const deltaNs = currentTiming.median - baselineTiming.median;
  const deltaPercent = (deltaNs / baselineTiming.median) * 100;
  const material = Math.abs(deltaPercent) >= regressionPercent;
  return {
    status: !material ? 'stable' : deltaNs > 0 ? 'regressed' : 'improved',
    metric: 'median_ns_per_op',
    baseline: { median: baselineTiming.median, samples: baselineTiming.count },
    current: { median: currentTiming.median, samples: currentTiming.count },
    delta_ns: round(deltaNs),
    delta_percent: round(deltaPercent),
    policy: { minimum_delta_percent: regressionPercent },
    baseline_revision: baseline.subject?.repository_revision ?? null,
    current_revision: current.subject?.repository_revision ?? null,
  };
}

async function collectV8ProfileEvidence(directory, repositoryRoot) {
  const entries = await profileEntries(directory);
  const files = entries.filter((entry) => entry.name.endsWith('.cpuprofile'));
  const documents = [];
  let profileBytes = 0;
  let truncated = files.length > LIMITS.profileFiles;
  for (const entry of files.slice(0, LIMITS.profileFiles)) {
    profileBytes += entry.size;
    if (entry.size > LIMITS.profileBytes || profileBytes > LIMITS.profileBytes) {
      truncated = true;
      continue;
    }
    try {
      documents.push(JSON.parse(await readFile(join(directory, entry.name), 'utf8')));
    } catch {
      truncated = true;
    }
  }
  const parsed = parseV8CpuProfileDocuments(documents, repositoryRoot);
  return {
    kind: 'v8_cpu',
    profile_files: files.length,
    profile_bytes: profileBytes,
    ...parsed,
    truncated: truncated || parsed.truncated,
  };
}

export function parseGoPprofTop(output, repositoryRoot, profileKind) {
  const unit =
    profileKind === 'go_cpu' ? 'ms' : profileKind === 'go_alloc_objects' ? 'count' : 'bytes';
  const rows = [];
  for (const line of String(output).split(/\r?\n/)) {
    const sourceMatch = /\s+(\/[^\s]+\.go):(\d+)(?:\s+\(inline\))?$/.exec(line);
    if (!sourceMatch) continue;
    const file = repositoryRelative(repositoryRoot, sourceMatch[1]);
    if (file === null || isExcludedPath(file)) continue;
    const prefix = line.slice(0, sourceMatch.index).trim().split(/\s+/);
    if (prefix.length < 6) continue;
    const flat = parseGoPprofValue(prefix[0], unit);
    const cumulative = parseGoPprofValue(prefix[3], unit);
    const flatShare = parsePercent(prefix[1]);
    const cumulativeShare = parsePercent(prefix[4]);
    if (![flat, cumulative, flatShare, cumulativeShare].every(Number.isFinite)) continue;
    rows.push({
      function: prefix.slice(5).join(' '),
      file,
      line: Number(sourceMatch[2]),
      role: sourceRole(file),
      profile_kind: profileKind,
      unit,
      flat: round(flat),
      cumulative: round(cumulative),
      flat_share: round(flatShare, 4),
      cumulative_share: round(cumulativeShare, 4),
      sample_share: round(flatShare, 4),
    });
  }
  return rows
    .sort(
      (left, right) =>
        right.cumulative - left.cumulative ||
        right.flat - left.flat ||
        left.file.localeCompare(right.file) ||
        left.line - right.line
    )
    .slice(0, LIMITS.hotspots * 8);
}

export async function collectGoProfileEvidence(directory, repositoryRoot) {
  const entries = await profileEntries(directory);
  const descriptors = [
    { name: 'go-cpu.pprof', kind: 'go_cpu', inspectKind: 'cpu' },
    { name: 'go-mem.pprof', kind: 'go_alloc_space', inspectKind: 'alloc_space' },
    { name: 'go-mem.pprof', kind: 'go_alloc_objects', inspectKind: 'alloc_objects' },
  ];
  const files = entries.filter((entry) => descriptors.some((item) => item.name === entry.name));
  const hotspots = [];
  const failedKinds = [];
  let truncated = false;
  for (const descriptor of descriptors) {
    if (!files.some((file) => file.name === descriptor.name)) {
      failedKinds.push(descriptor.kind);
      continue;
    }
    const execution = await inspectGoProfile({
      profileDirectory: directory,
      profileName: descriptor.name,
      kind: descriptor.inspectKind,
    });
    if (execution.status !== 'exited' || execution.exitCode !== 0) {
      failedKinds.push(descriptor.kind);
      continue;
    }
    const rows = parseGoPprofTop(execution.stdout, repositoryRoot, descriptor.kind);
    hotspots.push(...rows);
    truncated ||= execution.truncated || rows.length >= LIMITS.hotspots * 8;
  }
  const selectedHotspots = [
    ...selectGoProfileRows(hotspots, 'go_alloc_objects', 12),
    ...selectGoProfileRows(hotspots, 'go_alloc_space', 4),
    ...selectGoProfileRows(hotspots, 'go_cpu', 8),
  ];
  return {
    kind: 'go_cpu_and_allocation',
    profile_files: files.length,
    profile_bytes: files.reduce((total, entry) => total + entry.size, 0),
    profile_samples: hotspots.length,
    hotspots: selectedHotspots,
    failed_kinds: failedKinds,
    truncated,
    redaction_count: 0,
  };
}

export function selectGoProfileRows(rows, kind, limit) {
  const matching = rows
    .filter((row) => row.profile_kind === kind)
    .sort(
      (left, right) =>
        Number(right.role === 'application') - Number(left.role === 'application') ||
        right.cumulative - left.cumulative ||
        right.flat - left.flat ||
        left.file.localeCompare(right.file) ||
        left.line - right.line
    );
  if (kind !== 'go_alloc_objects') return matching.slice(0, limit);
  const direct = matching
    .filter((row) => row.flat > 0)
    .toSorted(
      (left, right) =>
        Number(right.role === 'application') - Number(left.role === 'application') ||
        right.flat - left.flat ||
        right.cumulative - left.cumulative ||
        left.file.localeCompare(right.file) ||
        left.line - right.line
    )
    .slice(0, Math.ceil(limit * 0.67));
  const selected = new Set(direct.map((row) => `${row.file}\0${row.line}\0${row.function}`));
  return [
    ...direct,
    ...matching.filter((row) => !selected.has(`${row.file}\0${row.line}\0${row.function}`)),
  ].slice(0, limit);
}

export function repeatableGoAllocationCandidates(runs) {
  if (!Array.isArray(runs) || runs.length !== V8_PROFILE_RUNS) return [];
  const normalizedRuns = runs.map(normalizeGoAllocationRun);
  if (normalizedRuns.some((run) => run === null)) return [];
  const [first, second] = normalizedRuns;
  const candidates = [];
  for (const [key, leading] of first.candidates) {
    const repeated = second.candidates.get(key);
    if (!repeated) continue;
    const perRunFlatObjects = [leading.flat, repeated.flat];
    const perRunObjectsPerOperation = [
      round(leading.flat / first.iterations, 6),
      round(repeated.flat / second.iterations, 6),
    ];
    const flatShares = [leading.flat_share, repeated.flat_share];
    const cumulativeShares = [leading.cumulative_share, repeated.cumulative_share];
    candidates.push({
      basis: 'repository_owned_go_alloc_objects_repeated_direct_path',
      profile_kind: 'go_alloc_objects',
      source: {
        file: leading.file,
        line: leading.line,
        function: leading.function,
      },
      flat_profile_objects: round(summarizeDistribution(perRunFlatObjects).median),
      cumulative_profile_objects: round(
        summarizeDistribution([leading.cumulative, repeated.cumulative]).median
      ),
      flat_share: round(summarizeDistribution(flatShares).median, 4),
      cumulative_share: round(summarizeDistribution(cumulativeShares).median, 4),
      objects_per_op: round(summarizeDistribution(perRunObjectsPerOperation).median, 6),
      per_run_objects_per_op: perRunObjectsPerOperation,
      profile_runs: V8_PROFILE_RUNS,
    });
  }
  return candidates.toSorted(
    (left, right) =>
      right.objects_per_op - left.objects_per_op ||
      right.flat_share - left.flat_share ||
      left.source.file.localeCompare(right.source.file) ||
      left.source.function.localeCompare(right.source.function)
  );
}

function normalizeGoAllocationRun(run) {
  const iterations = run?.benchmark?.iterations?.median;
  if (
    run?.profile_files < 2 ||
    run?.failed_kinds?.includes('go_alloc_objects') ||
    !Number.isFinite(iterations) ||
    iterations <= 0 ||
    !Number.isInteger(run.fixed_benchmark_iterations) ||
    iterations !== run.fixed_benchmark_iterations ||
    !Array.isArray(run.hotspots)
  ) {
    return null;
  }
  const candidates = new Map();
  for (const hotspot of run.hotspots) {
    if (
      hotspot.role !== 'application' ||
      hotspot.profile_kind !== 'go_alloc_objects' ||
      !Number.isFinite(hotspot.flat) ||
      hotspot.flat <= 0
    ) {
      continue;
    }
    const key = `${hotspot.file}\0${hotspot.function}`;
    const candidate = candidates.get(key) ?? {
      file: hotspot.file,
      line: hotspot.line,
      function: hotspot.function,
      flat: 0,
      leading_flat: 0,
      cumulative: 0,
      flat_share: 0,
      cumulative_share: 0,
    };
    if (hotspot.flat > candidate.leading_flat) {
      candidate.line = hotspot.line;
      candidate.leading_flat = hotspot.flat;
    }
    candidate.flat += hotspot.flat;
    candidate.cumulative = Math.max(candidate.cumulative, hotspot.cumulative);
    candidate.flat_share += hotspot.flat_share;
    candidate.cumulative_share = Math.max(candidate.cumulative_share, hotspot.cumulative_share);
    candidates.set(key, candidate);
  }
  return { iterations, candidates };
}

function parseGoPprofValue(value, unit) {
  if (value === '0') return 0;
  if (unit === 'count') return parseScaledNumber(value);
  const suffix = unit === 'ms' ? 'ms' : 'B';
  if (!value.endsWith(suffix)) return Number.NaN;
  return parseScaledNumber(value.slice(0, -suffix.length));
}

function parseScaledNumber(value) {
  const match = /^(-?\d+(?:\.\d+)?)([kKmMgG]?)$/.exec(value);
  if (!match) return Number.NaN;
  const scale = { '': 1, k: 1e3, K: 1e3, m: 1e6, M: 1e6, g: 1e9, G: 1e9 }[match[2]];
  return Number(match[1]) * scale;
}

function parsePercent(value) {
  return value.endsWith('%') ? Number(value.slice(0, -1)) / 100 : Number.NaN;
}

async function profileEntries(directory) {
  const names = await readdir(directory);
  const entries = [];
  for (const name of names.slice(0, LIMITS.profileFiles * 2)) {
    const metadata = await stat(join(directory, name));
    if (metadata.isFile()) entries.push({ name, size: metadata.size });
  }
  return entries;
}

export async function loadPerformanceCapsule(root, baselinePath) {
  const containedRoot = await realpath(resolve(root));
  const lexical = resolve(containedRoot, baselinePath);
  const relative = repositoryRelative(containedRoot, lexical);
  if (relative === null) throw new Error('baseline path escapes repository');
  const path = await realpath(lexical);
  if (repositoryRelative(containedRoot, path) === null) {
    throw new Error('baseline path escapes repository');
  }
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > LIMITS.receiptBytes) {
    throw new Error(
      `baseline must be a regular JSON file no larger than ${LIMITS.receiptBytes} bytes`
    );
  }
  let document;
  try {
    document = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('baseline is not valid JSON');
  }
  const baseline = document?.performance_capsule ?? document;
  if (validatePerformanceCapsule(baseline).length > 0) {
    throw new Error('baseline is not a valid Runtime Performance Capsule');
  }
  return baseline;
}

export function selectedWorkloadExecuted(entry, adapter, name) {
  const output = `${entry.stdout}\n${entry.stderr}`;
  if (adapter === 'node-script') return true;
  if (['vitest', 'jest'].includes(adapter)) {
    const selection = parseVitestSelection(entry.stdout);
    if (selection) return name ? selection.executed_tests === 1 : selection.executed_tests > 0;
    if (name && output.includes(`"status":"passed","title":${JSON.stringify(name)}`)) {
      return true;
    }
    return /Test Files\s+[1-9]\d*\s+passed|Tests\s+[1-9]\d*\s+passed/.test(output);
  }
  if (adapter === 'go-bench') return parseGoBenchmarks(output).length > 0;
  return !name || output.includes(name);
}

export function requiredExecutionsCompleted(entries, adapter, name) {
  const required = entries.filter((entry) => !['coverage', 'heap_profile'].includes(entry.phase));
  const exitedSuccessfully = required.every(
    (entry) => entry.execution.status === 'exited' && entry.execution.exitCode === 0
  );
  if (!exitedSuccessfully) return false;
  if (['vitest', 'jest'].includes(adapter)) {
    return required.some((entry) => selectedWorkloadExecuted(entry, adapter, name));
  }
  return required.every((entry) => selectedWorkloadExecuted(entry, adapter, name));
}

function normalizeV8Frame(frame, root) {
  if (!frame || typeof frame.url !== 'string' || !frame.url.startsWith('file:')) return null;
  let path;
  try {
    path = fileURLToPath(frame.url);
  } catch {
    return null;
  }
  const file = repositoryRelative(root, path);
  if (file === null || isExcludedPath(file)) return null;
  return {
    function: typeof frame.functionName === 'string' ? frame.functionName : '<anonymous>',
    file,
    line: Math.max(1, Number(frame.lineNumber ?? 0) + 1),
  };
}

function normalizeVitestFile(value, repositoryRoot) {
  if (typeof value !== 'string') return null;
  if (value.startsWith('<repo>/')) return value.slice('<repo>/'.length);
  return repositoryRelative(repositoryRoot, value);
}

function sourceRole(file) {
  return /(?:^|\/)(?:test|tests|__tests__|benchmark)(?:\/|\.)|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.go$/.test(
    file
  )
    ? 'test_or_harness'
    : 'application';
}

function emptyProfileEvidence(adapter) {
  return {
    kind: adapter === 'go-bench' ? 'go_benchmark_cpu_artifact' : 'v8_cpu',
    profile_files: 0,
    profile_bytes: 0,
    profile_samples: 0,
    hotspots: [],
    truncated: false,
    redaction_count: 0,
    failed_kinds: [],
  };
}

function emptyFlowEvidence() {
  return { files: 0, bytes: 0, events: [], truncated: false, limitations: [] };
}

export function combineProfileRuns(runs, adapter) {
  if (runs.length === 0) return emptyProfileEvidence(adapter);
  if (adapter === 'go-bench') {
    return {
      ...runs[0],
      profile_runs: runs.length,
      profile_files: runs.reduce((total, run) => total + run.profile_files, 0),
      profile_bytes: runs.reduce((total, run) => total + run.profile_bytes, 0),
      profile_samples: runs.reduce((total, run) => total + run.profile_samples, 0),
      failed_kinds: [...new Set(runs.flatMap((run) => run.failed_kinds ?? []))],
      truncated: runs.some((run) => run.truncated),
      redaction_count: runs.reduce((total, run) => total + run.redaction_count, 0),
    };
  }
  const aggregates = new Map();
  for (const run of runs) {
    for (const hotspot of run.hotspots) {
      const key = `${hotspot.file}:${hotspot.line}:${hotspot.function}`;
      const aggregate = aggregates.get(key) ?? {
        ...hotspot,
        self_time_ms: 0,
        samples: 0,
        sample_share: 0,
        run_count: 0,
      };
      aggregate.self_time_ms += hotspot.self_time_ms;
      aggregate.samples += hotspot.samples;
      aggregate.sample_share += hotspot.sample_share;
      aggregate.run_count += 1;
      aggregates.set(key, aggregate);
    }
  }
  const hotspots = [...aggregates.values()]
    .map((hotspot) => ({
      ...hotspot,
      self_time_ms: round(hotspot.self_time_ms),
      sample_share: round(hotspot.sample_share / hotspot.run_count, 4),
    }))
    .sort(
      (left, right) =>
        right.self_time_ms - left.self_time_ms ||
        left.file.localeCompare(right.file) ||
        left.line - right.line
    )
    .slice(0, LIMITS.hotspots);
  return {
    kind: 'v8_cpu',
    profile_runs: runs.length,
    profile_files: runs.reduce((total, run) => total + run.profile_files, 0),
    profile_bytes: runs.reduce((total, run) => total + run.profile_bytes, 0),
    profile_samples: runs.reduce((total, run) => total + run.profile_samples, 0),
    hotspots,
    truncated: runs.some((run) => run.truncated) || aggregates.size > LIMITS.hotspots,
    redaction_count: runs.reduce((total, run) => total + run.redaction_count, 0),
    failed_kinds: [],
    repeatability: evaluateV8Repeatability(runs),
  };
}

export function evaluateV8Repeatability(runs) {
  const candidates = runs.map((run) => run.hotspots.find((item) => item.role === 'application'));
  if (candidates.length < V8_PROFILE_RUNS || candidates.some((candidate) => !candidate)) {
    return {
      qualified: false,
      policy: V8_MATERIALITY_POLICY,
      candidates: candidates.filter(Boolean),
      reason: 'Independent V8 profiles did not all capture an application source candidate.',
    };
  }
  const [first, ...rest] = candidates;
  const repeated = rest.every(
    (candidate) => candidate.file === first.file && candidate.function === first.function
  );
  const candidateFileSampleShares = runs.map((run, index) =>
    round(
      run.hotspots
        .filter(
          (hotspot) => hotspot.role === 'application' && hotspot.file === candidates[index].file
        )
        .reduce((total, hotspot) => total + hotspot.sample_share, 0),
      4
    )
  );
  const applicationSampleShares = runs.map((run) =>
    round(
      run.hotspots
        .filter((hotspot) => hotspot.role === 'application')
        .reduce((total, hotspot) => total + hotspot.sample_share, 0),
      4
    )
  );
  const candidateApplicationFileShares = candidateFileSampleShares.map((share, index) =>
    applicationSampleShares[index] > 0 ? round(share / applicationSampleShares[index], 4) : 0
  );
  const material = candidates.every((candidate, index) => {
    const hasMaterialApplicationShare =
      applicationSampleShares[index] >= V8_MATERIALITY_POLICY.minimum_application_sample_share &&
      candidateApplicationFileShares[index] >= V8_MATERIALITY_POLICY.minimum_application_file_share;
    const hasMaterialShare =
      candidate.sample_share >= V8_MATERIALITY_POLICY.minimum_sample_share ||
      candidateFileSampleShares[index] >= V8_MATERIALITY_POLICY.minimum_file_sample_share ||
      hasMaterialApplicationShare;
    return (
      candidate.samples >= V8_MATERIALITY_POLICY.minimum_samples &&
      candidate.self_time_ms >= V8_MATERIALITY_POLICY.minimum_self_time_ms &&
      hasMaterialShare
    );
  });
  return {
    qualified: repeated && material,
    policy: V8_MATERIALITY_POLICY,
    candidates,
    candidate_file_sample_shares: candidateFileSampleShares,
    application_sample_shares: applicationSampleShares,
    candidate_application_file_shares: candidateApplicationFileShares,
    materiality_mode: candidates.every(
      (candidate) => candidate.sample_share >= V8_MATERIALITY_POLICY.minimum_sample_share
    )
      ? 'leading_frame_cpu'
      : candidates.every(
            (_candidate, index) =>
              candidateFileSampleShares[index] >= V8_MATERIALITY_POLICY.minimum_file_sample_share
          )
        ? 'distributed_file_cpu'
        : 'application_relative_file_cpu',
    ...(repeated ? { candidate: first } : {}),
    reason: !repeated
      ? 'Independent V8 profiles disagreed on the leading application source candidate.'
      : !material
        ? 'The repeated V8 source candidate did not cross the recorded sample, duration, total-profile, or application-relative share thresholds.'
        : 'Independent V8 profiles repeated a material application source candidate.',
  };
}

export function selectV8HeapAllocationCandidate(heapEvidence, heapRuns, cpuCandidate) {
  return selectV8HeapAllocationCandidates(heapEvidence, heapRuns, cpuCandidate)[0] ?? null;
}

export function selectV8HeapAllocationCandidates(heapEvidence, heapRuns, cpuCandidate) {
  const selections = [];
  const primary = selectPrimaryV8HeapAllocationCandidate(heapEvidence, heapRuns, cpuCandidate);
  if (primary) selections.push(primary);
  for (const candidate of repeatableV8HeapAllocationCandidates(heapRuns, {
    file: cpuCandidate?.file,
  })) {
    if (
      selections.some(
        (selection) =>
          selection.candidate.file === candidate.file &&
          selection.candidate.function === candidate.function
      )
    ) {
      continue;
    }
    selections.push({
      candidate,
      basis: 'repository_owned_v8_sampled_allocation_bytes',
    });
  }
  return selections.slice(0, V8_HEAP_CANDIDATE_LIMIT);
}

function selectPrimaryV8HeapAllocationCandidate(heapEvidence, heapRuns, cpuCandidate) {
  const fallback = heapEvidence?.repeatability?.qualified
    ? {
        candidate: {
          ...heapEvidence.repeatability.candidate,
          sample_share:
            heapEvidence.sampled_bytes > 0
              ? round(
                  heapEvidence.repeatability.candidate.sampled_bytes / heapEvidence.sampled_bytes,
                  6
                )
              : 0,
        },
        basis: 'repository_owned_v8_sampled_allocation_bytes',
      }
    : null;
  if (!cpuCandidate || heapRuns.length < V8_HEAP_PROFILE_RUNS) return fallback;

  const alignedRuns = [];
  for (const run of heapRuns) {
    const candidate = run.hotspots.find(
      (hotspot) =>
        hotspot.role === 'application' &&
        hotspot.file === cpuCandidate.file &&
        hotspot.function === cpuCandidate.function
    );
    if (!candidate) return fallback;
    alignedRuns.push({
      ...run,
      hotspots: [candidate, ...run.hotspots.filter((hotspot) => hotspot !== candidate)],
    });
  }
  const aligned = evaluateV8HeapRepeatability(alignedRuns);
  if (!aligned.qualified) return fallback;
  return {
    candidate: {
      ...aligned.candidate,
      sample_share:
        heapEvidence.sampled_bytes > 0
          ? round(aligned.candidate.sampled_bytes / heapEvidence.sampled_bytes, 6)
          : 0,
      provenance: 'repeated_v8_heap_source_intersecting_repeated_cpu_candidate',
    },
    basis: 'repository_owned_v8_sampled_allocation_bytes_intersecting_cpu_candidate',
  };
}

function profileRunSummary(run, index) {
  return {
    index,
    profile_kind: run.kind,
    profile_files: run.profile_files,
    profile_bytes: run.profile_bytes,
    profile_samples: run.profile_samples,
    leading_application_hotspot:
      run.hotspots.find((hotspot) => hotspot.role === 'application') ?? null,
    application_hotspots: run.hotspots
      .filter((hotspot) => hotspot.role === 'application')
      .slice(0, LIMITS.hotspots),
    benchmark: run.benchmark ?? null,
    fixed_benchmark_iterations: run.fixed_benchmark_iterations ?? null,
    failed_kinds: run.failed_kinds ?? [],
    truncated: run.truncated,
  };
}

function percentile(sorted, proportion) {
  const index = Math.max(0, Math.ceil(sorted.length * proportion) - 1);
  return sorted[index];
}

function optionalDistribution(measurements, key) {
  const values = measurements.map((entry) => entry[key]).filter(Number.isFinite);
  return values.length > 0 ? summarizeDistribution(values) : null;
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function distributionSpread(distribution) {
  if (Number.isFinite(distribution?.spread_percent)) return distribution.spread_percent;
  if (
    !Number.isFinite(distribution?.min) ||
    !Number.isFinite(distribution?.max) ||
    !Number.isFinite(distribution?.median) ||
    distribution.median <= 0
  ) {
    return 0;
  }
  return ((distribution.max - distribution.min) / distribution.median) * 100;
}
