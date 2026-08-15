import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseVitestSelection } from './capsule.mjs';
import {
  LIMITS,
  PERFORMANCE_SCHEMA_VERSION,
  isExcludedPath,
  repositoryRelative,
  validatePerformanceCapsule,
} from './contracts.mjs';
import { inspectGitDiff, rankRelevantChanges } from './git-diff.mjs';
import {
  createPerformanceExecutionReceipt,
  planPerformanceExecution,
} from './execution-governance.mjs';
import { collectV8FunctionCoverage, emptyFunctionCoverage } from './function-coverage.mjs';
import { redactText } from './redact.mjs';
import { inspectGoProfile, runClosedAdapter } from './runner.mjs';
import { collectNodeFlowEvents } from './flow-capture.mjs';
import { inspectExistingViteArtifact } from './vite-artifact.mjs';

const APPLICATION_HOTSPOT_SHARE = 0.05;
const STARTUP_DOMINATED_SHARE_PERCENT = 10;
const V8_PROFILE_RUNS = 2;
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
  viteBuildDirectory,
  viteEntry,
}) {
  validateProfileScope(adapter, name);
  const lexicalRoot = resolve(repositoryRoot);
  const root = await realpath(lexicalRoot);
  const processCount = plannedProfileProcessCount({ adapter, samples, warmups, captureFlow });
  const executionPlan = await planPerformanceExecution({
    repositoryRoot: root,
    adapter,
    target,
    name,
    timeoutMs,
    processCount,
  });
  if (executionPlan.decision.status === 'blocked') {
    return createBlockedPerformanceCapsule({
      root,
      lexicalRoot,
      git: await inspectGitDiff(root),
      adapter,
      target,
      name,
      samples,
      warmups,
      executionPlan,
    });
  }
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'codevetter-profile-'));
  const executions = [];
  let profileEvidence = emptyProfileEvidence(adapter);
  const profileRuns = [];
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
          executionPlan,
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
          executionPlan,
        }),
      });
    }
    if (['vitest', 'node-test', 'node-script'].includes(adapter)) {
      for (let index = 0; index < samples; index += 1) {
        executions.push({
          phase: 'metrics',
          index,
          execution: await runClosedAdapter({
            repositoryRoot: root,
            adapter,
            target,
            name,
            timeoutMs,
            vitestReporter: adapter === 'vitest' ? 'verbose' : undefined,
            executionPlan,
          }),
        });
      }
    }
    if (captureFlow && ['node-test', 'vitest'].includes(adapter)) {
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
          executionPlan,
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
          executionPlan,
        }),
      });
      functionCoverage = await collectV8FunctionCoverage(coverageDirectory, root);
    }

    const profileRunCount = profileRunsFor(adapter);
    for (let index = 0; index < profileRunCount; index += 1) {
      const profileDirectory = join(temporaryDirectory, `profile-${index}`);
      await mkdir(profileDirectory);
      executions.push({
        phase: 'profile',
        index,
        execution: await runClosedAdapter({
          repositoryRoot: root,
          adapter,
          target,
          name,
          timeoutMs,
          profileDirectory,
          executionPlan,
        }),
      });
      profileRuns.push(
        adapter === 'go-bench'
          ? await collectGoProfileEvidence(profileDirectory, root)
          : await collectV8ProfileEvidence(profileDirectory, root)
      );
    }
    profileEvidence = combineProfileRuns(profileRuns, adapter);
  } finally {
    try {
      await rm(temporaryDirectory, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
  }

  const git = await inspectGitDiff(root);
  const viteArtifact = await inspectExistingViteArtifact(root, viteBuildDirectory, viteEntry);
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
    flowEvidence,
    functionCoverage,
    cleanupFailed,
    baseline,
    regressionPercent,
    regressionMs,
    viteArtifact,
    executionPlan,
    executionReceipt: createPerformanceExecutionReceipt(executionPlan, executions),
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
  flowEvidence = emptyFlowEvidence(),
  functionCoverage = emptyFunctionCoverage(),
  cleanupFailed = false,
  baseline = null,
  regressionPercent = 20,
  regressionMs = 25,
  viteArtifact = null,
  executionPlan = null,
  executionReceipt = null,
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
  const playwrightTest = playwrightTimingObservation(adapter, measured, name);
  const metricsExecutions = sanitizedExecutions.filter((entry) => entry.phase === 'metrics');
  const profileExecution = sanitizedExecutions.find((entry) => entry.phase === 'profile');
  const consoleMetrics =
    metricsExecutions.length > 0
      ? summarizeConsoleBenchmarkMetrics(
          metricsExecutions.map((entry) => `${entry.stdout}\n${entry.stderr}`)
        )
      : ['node-test', 'node-script', 'vitest'].includes(adapter) && measured.length > 0
        ? summarizeConsoleBenchmarkMetrics(
            measured.map((entry) => `${entry.stdout}\n${entry.stderr}`),
            'unprofiled_measurement_execution_median'
          )
        : parseConsoleBenchmarkMetrics(
            profileExecution ? `${profileExecution.stdout}\n${profileExecution.stderr}` : '',
            'profile_execution_stdout'
          );
  const executionComplete = requiredExecutionsCompleted(sanitizedExecutions, adapter, name);
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
  for (const entry of sanitizedExecutions.filter(
    (candidate) =>
      candidate.phase !== 'coverage' &&
      (candidate.execution.status !== 'exited' || candidate.execution.exitCode !== 0)
  )) {
    limitations.push(
      `${entry.phase} execution ${entry.index + 1} failed: ${entry.operationalError || `exit ${entry.execution.exitCode ?? 'unknown'}`}.`
    );
  }
  if (cleanupFailed)
    limitations.push('Owned temporary profiling artifacts could not be completely removed.');
  if (outputTruncated) limitations.push('Runner output was truncated before normalization.');
  limitations.push(...executionGovernanceLimitations(executionReceipt));
  limitations.push(...playwrightLimitations(adapter, playwrightTest));
  if (adapter === 'go-bench' && goBenchmarks.length === 0) {
    limitations.push('No matching Go benchmark measurement was captured.');
  }
  if (adapter === 'go-bench' && profileEvidence.hotspots.length === 0) {
    limitations.push('Go profiles contained no repository-owned source rows.');
  }
  for (const kind of profileEvidence.failed_kinds ?? []) {
    limitations.push(`The ${kind} Go profile could not be normalized.`);
  }
  if (
    ['node-test', 'node-script', 'vitest'].includes(adapter) &&
    profileEvidence.profile_files === 0
  ) {
    limitations.push('The runtime produced no V8 CPU profile.');
  }
  if (
    ['node-test', 'node-script', 'vitest'].includes(adapter) &&
    profileEvidence.hotspots.length === 0
  ) {
    limitations.push('The CPU profile contained no repository-owned source samples.');
  }
  if (
    ['node-test', 'node-script', 'vitest'].includes(adapter) &&
    profileEvidence.hotspots.length > 0 &&
    !profileEvidence.hotspots.some((hotspot) => hotspot.role === 'application')
  ) {
    limitations.push('The CPU profile captured only test or benchmark harness source.');
  }
  if (profileEvidence.truncated)
    limitations.push('Runtime profile evidence exceeded collection bounds.');
  if (
    ['node-test', 'node-script', 'vitest'].includes(adapter) &&
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
  if (vitestExecutionShare?.classification === 'startup_dominated') {
    limitations.push(
      `Vitest reported assertion time is ${vitestExecutionShare.assertion_share_percent}% of exact-scope wall time; runner startup dominates and no product bottleneck is attributed.`
    );
  }
  limitations.push(...viteArtifactLimitations(viteArtifact));

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
    playwrightEvidenceComplete(adapter, playwrightTest) &&
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

  const hotspotFrames = profileEvidence.hotspots.map((hotspot, index) => ({
    id: `hotspot-${index + 1}`,
    file: hotspot.file,
    line: hotspot.line,
  }));
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
  const qualifiedV8Candidate = profileEvidence.repeatability?.qualified
    ? profileEvidence.repeatability.candidate
    : null;
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
  for (const hotspot of profileEvidence.hotspots
    .filter(
      (candidate) =>
        adapter === 'go-bench' &&
        candidate.role === 'application' &&
        candidate.profile_kind === 'go_alloc_space' &&
        candidate.cumulative_share >= APPLICATION_HOTSPOT_SHARE
    )
    .slice(0, 5)) {
    findings.push({
      kind: 'go_allocation_path_candidate',
      basis: 'repository_owned_go_alloc_space_cumulative_path',
      source: { file: hotspot.file, line: hotspot.line, function: hotspot.function },
      flat_profile_bytes: hotspot.flat,
      cumulative_profile_bytes: hotspot.cumulative,
      flat_share: hotspot.flat_share,
      cumulative_share: hotspot.cumulative_share,
    });
  }
  for (const hotspot of profileEvidence.hotspots
    .filter(
      (candidate) =>
        adapter === 'go-bench' &&
        candidate.role === 'application' &&
        candidate.profile_kind === 'go_cpu' &&
        candidate.cumulative_share >= APPLICATION_HOTSPOT_SHARE
    )
    .slice(0, 5)) {
    findings.push({
      kind: 'application_hotspot_candidate',
      basis: 'repository_owned_go_cpu_cumulative_path',
      profile_kind: hotspot.profile_kind,
      source: { file: hotspot.file, line: hotspot.line, function: hotspot.function },
      self_time_ms: hotspot.cumulative,
      sample_share: hotspot.cumulative_share,
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
  const unverified = buildPerformanceUnverified({
    adapter,
    profileEvidence,
    qualifiedV8Candidate,
    viteArtifact,
  });

  const capsule = {
    schema_version: PERFORMANCE_SCHEMA_VERSION,
    subject: {
      repository_revision: git.repository_revision,
      diff_identity: git.diff_identity,
      dirty: git.dirty,
      platform: process.platform,
      architecture: process.arch,
      node_version: process.version,
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
      hotspots: profileEvidence.hotspots,
      go_benchmarks: goBenchmarks,
      vitest_tests: vitestTests,
      vitest_execution_share: vitestExecutionShare,
      playwright_test: playwrightTest,
      console_metrics: consoleMetrics,
      profile_runs: profileRuns.map(profileRunSummary),
      profile_repeatability: profileEvidence.repeatability ?? null,
      flow_evidence: flowEvidence,
      function_coverage: functionCoverage,
      vite_artifact: viteArtifact,
    },
    findings,
    relationships: relevantChanges,
    unverified,
    comparison,
    limitations: [...new Set(limitations)],
    capture: {
      profile_kind: profileEvidence.kind,
      profile_files: profileEvidence.profile_files,
      profile_bytes: profileEvidence.profile_bytes,
      profile_samples: profileEvidence.profile_samples,
      truncated: profileEvidence.truncated || outputTruncated,
      redaction_count:
        redactionCount + profileEvidence.redaction_count + functionCoverage.redaction_count,
      temporary_artifacts_retained: cleanupFailed,
      flow_files: flowEvidence.files,
      flow_events: flowEvidence.events.length,
      coverage_files: functionCoverage.coverage_files,
      coverage_bytes: functionCoverage.coverage_bytes,
      coverage_functions: functionCoverage.functions.length,
    },
    execution_governance: executionGovernance(executionPlan, executionReceipt),
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
  const errors = validatePerformanceCapsule(capsule);
  if (errors.length > 0) throw new Error(`invalid performance capsule: ${errors.join(', ')}`);
  return capsule;
}

function executionGovernance(plan, receipt) {
  if (!plan || !receipt) return null;
  return { plan, receipt };
}

function executionGovernanceLimitations(receipt) {
  return receipt?.status === 'policy_violation'
    ? ['The zero-egress boundary blocked a remote network attempt.']
    : [];
}

function createBlockedPerformanceCapsule({
  root,
  lexicalRoot,
  git,
  adapter,
  target,
  name,
  samples,
  warmups,
  executionPlan,
}) {
  const executionReceipt = createPerformanceExecutionReceipt(executionPlan);
  return createPerformanceCapsule({
    root,
    lexicalRoot,
    git,
    adapter,
    target,
    name,
    samples,
    warmups,
    executions: [],
    profileEvidence: emptyProfileEvidence(adapter),
    profileRuns: [],
    flowEvidence: emptyFlowEvidence(),
    functionCoverage: emptyFunctionCoverage(),
    cleanupFailed: false,
    baseline: null,
    viteArtifact: null,
    executionPlan,
    executionReceipt,
  });
}

export function plannedProfileProcessCount({ adapter, samples, warmups, captureFlow = false }) {
  const metrics = ['node-test', 'node-script', 'vitest'].includes(adapter) ? samples : 0;
  const flows = captureFlow && ['node-test', 'vitest'].includes(adapter) ? 2 : 0;
  return warmups + samples + metrics + flows + profileRunsFor(adapter);
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

export function parseVitestTimings(outputs, repositoryRoot) {
  const groups = new Map();
  for (const output of outputs) {
    let report;
    try {
      report = JSON.parse(output);
    } catch {
      continue;
    }
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

export function parsePlaywrightTimings(outputs, exactName) {
  const samples = outputs.map((output, index) =>
    parsePlaywrightSample(output, exactName, index + 1)
  );
  const durations = samples.flatMap((sample) => sample.duration ?? []);
  const limitations = samples.flatMap((sample) => sample.limitation ?? []);
  const complete = outputs.length > 0 && durations.length === outputs.length;
  return {
    exact_name: exactName ?? null,
    duration_ms: summarizeDistribution(durations),
    expected_samples: outputs.length,
    captured_samples: durations.length,
    complete,
    limitations: complete ? [] : [...new Set(limitations)],
    provenance: 'playwright_json_reporter',
  };
}

function parsePlaywrightSample(output, exactName, sampleNumber) {
  if (output?.truncated) {
    return { limitation: `Playwright reporter output for sample ${sampleNumber} was truncated.` };
  }
  let report;
  try {
    report = JSON.parse(output?.stdout ?? '');
  } catch {
    return {
      limitation: `Playwright reporter output for sample ${sampleNumber} was not valid JSON.`,
    };
  }
  const matches = [];
  visitPlaywrightSuites(report?.suites, (spec) => {
    if (spec?.title === exactName) matches.push(spec);
  });
  if (matches.length !== 1) {
    return {
      limitation: `Playwright sample ${sampleNumber} contained ${matches.length} exact matching specs; one was required.`,
    };
  }
  const tests = Array.isArray(matches[0].tests) ? matches[0].tests : [];
  if (tests.length !== 1) {
    return {
      limitation: `Playwright sample ${sampleNumber} contained ${tests.length} matching project tests; one was required.`,
    };
  }
  const results = Array.isArray(tests[0].results) ? tests[0].results : [];
  const result = results[0];
  const valid =
    results.length === 1 &&
    result?.status === 'passed' &&
    Number(result?.retry ?? 0) === 0 &&
    Number.isFinite(Number(result?.duration));
  return valid
    ? { duration: [Number(result.duration)] }
    : {
        limitation: `Playwright sample ${sampleNumber} did not contain one passing, unretried duration.`,
      };
}

function visitPlaywrightSuites(suites, visit) {
  for (const suite of Array.isArray(suites) ? suites : []) {
    for (const spec of Array.isArray(suite?.specs) ? suite.specs : []) visit(spec);
    visitPlaywrightSuites(suite?.suites, visit);
  }
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
  const unit = profileKind === 'go_cpu' ? 'ms' : 'bytes';
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
    .slice(0, LIMITS.hotspots);
}

async function collectGoProfileEvidence(directory, repositoryRoot) {
  const entries = await profileEntries(directory);
  const descriptors = [
    { name: 'go-cpu.pprof', kind: 'go_cpu', inspectKind: 'cpu' },
    { name: 'go-mem.pprof', kind: 'go_alloc_space', inspectKind: 'alloc_space' },
  ];
  const files = entries.filter((entry) => descriptors.some((item) => item.name === entry.name));
  const hotspots = [];
  const failedKinds = [];
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
    hotspots.push(...parseGoPprofTop(execution.stdout, repositoryRoot, descriptor.kind));
  }
  const selectedHotspots = [
    ...selectGoProfileRows(hotspots, 'go_alloc_space', 16),
    ...selectGoProfileRows(hotspots, 'go_cpu', 8),
  ];
  return {
    kind: 'go_cpu_and_alloc_space',
    profile_files: files.length,
    profile_bytes: files.reduce((total, entry) => total + entry.size, 0),
    profile_samples: hotspots.length,
    hotspots: selectedHotspots,
    failed_kinds: failedKinds,
    truncated: hotspots.length > selectedHotspots.length,
    redaction_count: 0,
  };
}

function selectGoProfileRows(rows, kind, limit) {
  return rows
    .filter((row) => row.profile_kind === kind)
    .sort(
      (left, right) =>
        Number(right.role === 'application') - Number(left.role === 'application') ||
        right.cumulative - left.cumulative ||
        right.flat - left.flat ||
        left.file.localeCompare(right.file) ||
        left.line - right.line
    )
    .slice(0, limit);
}

function parseGoPprofValue(value, unit) {
  if (value === '0') return 0;
  const suffix = unit === 'ms' ? 'ms' : 'B';
  if (!value.endsWith(suffix)) return Number.NaN;
  return Number(value.slice(0, -suffix.length));
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
  if (adapter === 'vitest') {
    const selection = parseVitestSelection(entry.stdout);
    if (selection) return name ? selection.executed_tests === 1 : selection.executed_tests > 0;
    if (name && output.includes(`"status":"passed","title":${JSON.stringify(name)}`)) {
      return true;
    }
    return /Test Files\s+[1-9]\d*\s+passed|Tests\s+[1-9]\d*\s+passed/.test(output);
  }
  if (adapter === 'go-bench') return parseGoBenchmarks(output).length > 0;
  if (adapter === 'playwright') {
    return parsePlaywrightTimings(
      [{ stdout: entry.execution.stdout, truncated: entry.execution.truncated }],
      name
    ).complete;
  }
  return !name || output.includes(name);
}

export function requiredExecutionsCompleted(entries, adapter, name) {
  const required = entries.filter((entry) => entry.phase !== 'coverage');
  const exitedSuccessfully = required.every(
    (entry) => entry.execution.status === 'exited' && entry.execution.exitCode === 0
  );
  if (!exitedSuccessfully) return false;
  if (adapter === 'vitest') {
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

function validateProfileScope(adapter, name) {
  if (adapter === 'playwright' && !name) {
    throw new Error('playwright performance profiling requires an exact test name');
  }
}

function profileRunsFor(adapter) {
  if (adapter === 'playwright') return 0;
  return adapter === 'go-bench' ? 1 : V8_PROFILE_RUNS;
}

function playwrightTimingObservation(adapter, measured, name) {
  if (adapter !== 'playwright') return null;
  return parsePlaywrightTimings(
    measured.map((entry) => ({
      stdout: entry.execution.stdout,
      truncated: entry.execution.truncated,
    })),
    name
  );
}

function playwrightLimitations(adapter, observation) {
  return adapter === 'playwright' && !observation.complete ? observation.limitations : [];
}

function viteArtifactLimitations(artifact) {
  return artifact?.limitations ?? [];
}

function playwrightEvidenceComplete(adapter, observation) {
  return adapter !== 'playwright' || observation.complete;
}

function buildPerformanceUnverified({
  adapter,
  profileEvidence,
  qualifiedV8Candidate,
  viteArtifact,
}) {
  const hypotheses = profileEvidence.hotspots
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
    }));
  if (viteArtifact) {
    hypotheses.push({
      kind: 'vite_artifact_observation',
      summary: `Existing initial JavaScript closure contains ${viteArtifact.file_count} files, ${viteArtifact.raw_bytes} raw bytes, and ${viteArtifact.gzip_bytes} gzip bytes.`,
      verification_required:
        'Rebuild both identical source snapshots under an attested build contract before comparing artifact movement.',
    });
  }
  if (adapter === 'playwright') {
    hypotheses.push({
      kind: 'playwright_coverage_gap',
      summary:
        'Exact local test duration does not measure production traffic, representative-device rendering, browser memory, React component attribution, network-scale behavior, or global application optimality.',
      verification_required:
        'Use separately authorized production and representative-device evidence for those claims.',
    });
  }
  return hypotheses;
}

function emptyProfileEvidence(adapter) {
  return {
    kind:
      adapter === 'go-bench'
        ? 'go_benchmark_cpu_artifact'
        : adapter === 'playwright'
          ? 'playwright_reporter_timing'
          : 'v8_cpu',
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

function combineProfileRuns(runs, adapter) {
  if (runs.length === 0) return emptyProfileEvidence(adapter);
  if (adapter === 'go-bench') return { ...runs[0], profile_runs: 1 };
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

function profileRunSummary(run, index) {
  return {
    index,
    profile_kind: run.kind,
    profile_files: run.profile_files,
    profile_bytes: run.profile_bytes,
    profile_samples: run.profile_samples,
    leading_application_hotspot:
      run.hotspots.find((hotspot) => hotspot.role === 'application') ?? null,
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
