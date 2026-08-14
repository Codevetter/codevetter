import { OPTIMIZATION_POLICY } from './optimization-verification.mjs';
import {
  loadPerformanceFlowContract,
  performanceFlowIdentity,
  resolvePerformanceFlowBinding,
} from './performance-flow-contract.mjs';
import {
  boundedPerformanceCandidateExclusions,
  boundedPerformanceFindingExclusions,
} from './performance-lab-contracts.mjs';
import { listPlaywrightCaptureEvidence, qualifiedBrowserBaseUrl } from './playwright-capture.mjs';
import { qualifyRepository } from './qualification.mjs';
import { listSupervisedRunEvidence } from './supervision.mjs';

const SCHEMA_VERSION = 'runtime-performance-flow-coverage/v3';
const PROFILE_ADAPTERS = new Set(['node-test', 'node-script', 'vitest', 'jest', 'go-bench']);
const DIRECT_SIGNALS = new Set(['explicit_go_benchmark', 'timing_measurement_source']);
const SCREENING_SIGNALS = new Set([
  'benchmark_file_name',
  'benchmark_workload_name',
  'performance_workload_name',
]);

export async function reportPerformanceFlowCoverage(
  repositoryRoot,
  {
    qualify = qualifyRepository,
    listMeasurements = listSupervisedRunEvidence,
    listBrowserCaptures = listPlaywrightCaptureEvidence,
    loadFlowContract = loadPerformanceFlowContract,
    excludedFindingIds,
    excludedCandidateKeys,
  } = {}
) {
  const safeExclusions = boundedPerformanceFindingExclusions(excludedFindingIds);
  const safeCandidateExclusions = boundedPerformanceCandidateExclusions(excludedCandidateKeys);
  const [qualification, measurements, browserCaptures, flowContract] = await Promise.all([
    qualify(repositoryRoot),
    listMeasurements(repositoryRoot, {
      excludedFindingIds: safeExclusions,
      excludedCandidateKeys: safeCandidateExclusions,
    }),
    listBrowserCaptures(repositoryRoot),
    loadFlowContract(repositoryRoot),
  ]);
  return composePerformanceFlowCoverage({
    qualification,
    measurements,
    browserCaptures,
    flowContract,
  });
}

export function composePerformanceFlowCoverage({
  qualification,
  measurements = [],
  browserCaptures = [],
  flowContract = { present: false, manifest_sha256: null, bindings: [] },
}) {
  const measurementsByScope = groupByScope(measurements);
  const capturesByScope = groupByScope(
    browserCaptures.filter(
      (capture) =>
        capture.subject?.repository_revision === qualification.subject.repository_revision &&
        capture.subject?.source_snapshot_sha256 === qualification.subject.source_snapshot_sha256
    )
  );
  const flows = (qualification.flows ?? qualification.candidates ?? []).map((declaration) => {
    const correctnessBinding = resolvePerformanceFlowBinding(flowContract, declaration);
    const matchingMeasurements = (measurementsByScope.get(scopeKey(declaration)) ?? [])
      .toSorted(compareEvidence)
      .filter((measurement) => sameSubject(measurement.subject, qualification.subject));
    const latestMeasurement = matchingMeasurements.at(-1) ?? null;
    const successfulMeasurement = matchingMeasurements
      .filter(
        (measurement) =>
          measurement.state === 'succeeded' &&
          measurement.policy?.samples >= OPTIMIZATION_POLICY.shipping_minimum_samples
      )
      .at(-1);
    const matchingCaptures = (capturesByScope.get(scopeKey(declaration)) ?? []).toSorted(
      compareEvidence
    );
    const latestCapture = matchingCaptures.at(-1) ?? null;
    const verifiedCapture = matchingCaptures
      .filter(
        (capture) =>
          capture.state === 'succeeded' &&
          capture.policy?.server_identity === 'verified_by_declared_process'
      )
      .at(-1);
    const diagnosedFailure = matchingCaptures
      .filter(
        (capture) =>
          capture.state === 'failed' &&
          capture.result !== null &&
          capture.diagnosis !== null &&
          capture.policy?.server_identity === 'verified_by_declared_process' &&
          capture.server_attestation?.state === 'verified_by_declared_process'
      )
      .at(-1);
    const profileCapable = PROFILE_ADAPTERS.has(declaration.adapter);
    const signals = declaration.signals ?? [];
    const directMeasurement = signals.some((signal) => DIRECT_SIGNALS.has(signal.kind));
    const safeToExecute = (declaration.safety_flags ?? []).length === 0;
    const screeningEligible =
      profileCapable &&
      safeToExecute &&
      !directMeasurement &&
      signals.some((signal) => SCREENING_SIGNALS.has(signal.kind));
    const browserCaptureEligible = Boolean(qualifiedBrowserBaseUrl(declaration));
    const actionable = (successfulMeasurement?.eligible_experiment_findings ?? 0) > 0;
    const candidateExhausted = successfulMeasurement?.candidate_exclusions_exhausted === true;
    const runtimeMeasured = Boolean(successfulMeasurement || verifiedCapture || diagnosedFailure);

    return {
      ...pick(declaration, ['id', 'adapter', 'target', 'name', 'package_scope', 'score']),
      ...(declaration.browser_profile ? { browser_profile: declaration.browser_profile } : {}),
      correctness_binding: correctnessBinding
        ? {
            scope: correctnessBinding.correctness,
            manifest_sha256: correctnessBinding.manifest_sha256,
          }
        : null,
      qualification_signals: signals,
      safety_flags: declaration.safety_flags ?? [],
      profile_capable: profileCapable,
      safe_to_execute: safeToExecute,
      direct_measurement: directMeasurement,
      screening_eligible: screeningEligible,
      browser_capture_eligible: browserCaptureEligible,
      runtime_measured: runtimeMeasured,
      evidence_status: actionable
        ? 'candidate_ready'
        : candidateExhausted
          ? 'candidate_exhausted'
          : successfulMeasurement
            ? 'measured'
            : latestMeasurement
              ? latestMeasurement.state === 'succeeded'
                ? 'measurement_unqualified'
                : 'measurement_failed'
              : verifiedCapture
                ? 'browser_traced'
                : diagnosedFailure
                  ? 'failure_diagnosed'
                  : latestCapture?.state === 'failed'
                    ? 'browser_capture_failed'
                    : profileCapable
                      ? directMeasurement
                        ? 'not_measured'
                        : 'measurement_required'
                      : 'trace_required',
      measurement_run_ids: matchingMeasurements.map((entry) => entry.run_id),
      latest_measurement: latestMeasurement,
      browser_capture_ids: matchingCaptures.map((entry) => entry.capture_id),
      latest_browser_capture: latestCapture,
      diagnosed_browser_capture: diagnosedFailure ?? null,
    };
  });
  const discoveredIdentities = new Set(flows.map(performanceFlowIdentity));
  const staleCorrectnessBindings = flowContract.bindings.filter(
    (binding) => !discoveredIdentities.has(performanceFlowIdentity(binding.performance))
  ).length;
  const summary = summarize(
    flows,
    qualification.scan?.truncated === true,
    staleCorrectnessBindings
  );
  return {
    schema_version: SCHEMA_VERSION,
    subject: qualification.subject,
    summary,
    flows,
    next_action: chooseNextAction(flows, qualification),
    limitations: [
      'Discovery covers only bounded repository-declared local flows; it does not prove route or production coverage.',
      'Successful exact-scope runs and validated exact browser diagnoses count as measured; failed browser correctness never becomes optimization success.',
      ...(staleCorrectnessBindings > 0
        ? [
            `${staleCorrectnessBindings} performance-flow correctness binding(s) match no discovered exact flow.`,
          ]
        : []),
      ...(summary.browser_capture_failures > 0
        ? [
            'Failed exact browser attempts remain durable negative evidence and are not retried autonomously on the same revision.',
          ]
        : []),
      'Local measurements do not establish production frequency, data volume, or impact.',
      ...(summary.discovery_truncated
        ? ['The bounded inventory truncated and cannot support a complete-coverage claim.']
        : []),
    ],
  };
}

function summarize(flows, discoveryTruncated, staleCorrectnessBindings) {
  const profile = flows.filter((flow) => flow.profile_capable);
  const direct = profile.filter((flow) => flow.direct_measurement);
  const screening = profile.filter((flow) => flow.screening_eligible);
  const browser = flows.filter((flow) => flow.adapter === 'playwright');
  return {
    discovered_flows: flows.length,
    profile_capable_flows: profile.length,
    measured_profile_flows: profile.filter((flow) => flow.runtime_measured).length,
    measurement_ready_flows: direct.length,
    measured_measurement_ready_flows: direct.filter((flow) => flow.runtime_measured).length,
    screening_eligible_flows: screening.length,
    screened_existing_flows: screening.filter((flow) => flow.runtime_measured).length,
    browser_capture_eligible_flows: browser.filter(
      (flow) =>
        flow.browser_capture_eligible &&
        !flow.runtime_measured &&
        flow.evidence_status !== 'browser_capture_failed'
    ).length,
    browser_traced_flows: browser.filter((flow) => flow.evidence_status === 'browser_traced')
      .length,
    browser_failure_diagnosed_flows: browser.filter(
      (flow) => flow.evidence_status === 'failure_diagnosed'
    ).length,
    browser_capture_failures: browser.filter(
      (flow) => flow.evidence_status === 'browser_capture_failed'
    ).length,
    candidate_ready_flows: flows.filter((flow) => flow.evidence_status === 'candidate_ready')
      .length,
    candidate_exhausted_flows: flows.filter(
      (flow) => flow.evidence_status === 'candidate_exhausted'
    ).length,
    correctness_bound_flows: flows.filter((flow) => flow.correctness_binding !== null).length,
    stale_correctness_bindings: staleCorrectnessBindings,
    discovery_truncated: discoveryTruncated,
  };
}

function chooseNextAction(flows, qualification) {
  const candidate = flows.find((flow) => flow.evidence_status === 'candidate_ready');
  if (candidate) {
    return {
      kind: 'inspect_profile_candidate',
      candidate_id: candidate.id,
      run_id: candidate.latest_measurement.run_id,
      scope: scope(candidate),
    };
  }
  const diagnosedFailure = flows.find((flow) => flow.evidence_status === 'failure_diagnosed');
  if (diagnosedFailure) {
    return {
      kind: 'inspect_failed_browser_diagnosis',
      candidate_id: diagnosedFailure.id,
      capture_id: diagnosedFailure.diagnosed_browser_capture.capture_id,
      scope: scope(diagnosedFailure),
      next_probe: diagnosedFailure.diagnosed_browser_capture.diagnosis.next_probe ?? null,
    };
  }
  const direct = flows.find(
    (flow) =>
      flow.profile_capable &&
      flow.safe_to_execute &&
      flow.direct_measurement &&
      !flow.runtime_measured
  );
  if (direct) return measurementAction('measure_unmeasured_flow', direct);
  const screen = flows.find((flow) => flow.screening_eligible && !flow.runtime_measured);
  if (screen) return measurementAction('screen_existing_flow', screen);
  const browser = flows.find(
    (flow) =>
      flow.adapter === 'playwright' &&
      flow.browser_capture_eligible &&
      flow.evidence_status === 'trace_required'
  );
  if (browser) {
    return {
      kind: 'capture_local_browser_flow',
      candidate_id: browser.id,
      scope: scope(browser),
    };
  }
  if (flows.some((flow) => flow.evidence_status === 'candidate_exhausted')) {
    return { kind: 'candidate_exclusions_exhausted' };
  }
  if (qualification.scan?.truncated) {
    return { kind: 'narrow_or_expand_flow_inventory' };
  }
  return qualification.status === 'inaccessible'
    ? { kind: 'repair_repository_access' }
    : { kind: 'add_representative_executable_flow' };
}

function measurementAction(kind, flow) {
  return { kind, candidate_id: flow.id, scope: scope(flow) };
}

function scope(value) {
  const base = { adapter: value.adapter, target: value.target, name: value.name ?? null };
  const project = value.project ?? value.browser_profile?.project_name ?? null;
  return project ? { ...base, project } : base;
}

function groupByScope(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const key = scopeKey(entry.scope ?? entry);
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }
  return grouped;
}

function scopeKey(value) {
  const project = value.project ?? value.browser_profile?.project_name ?? '';
  return `${value.adapter}\0${value.target}\0${value.name ?? ''}\0${project}`;
}

function compareEvidence(left, right) {
  const leftTime = left.completed_at ?? left.lifecycle?.completed_at ?? '';
  const rightTime = right.completed_at ?? right.lifecycle?.completed_at ?? '';
  return String(leftTime).localeCompare(String(rightTime));
}

function sameSubject(left, right) {
  return (
    left?.repository_revision === right?.repository_revision &&
    left?.source_snapshot_sha256 === right?.source_snapshot_sha256
  );
}

function pick(value, fields) {
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}
