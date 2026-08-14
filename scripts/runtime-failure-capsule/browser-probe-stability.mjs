import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  BROWSER_PROBE_RECAPTURE_LIMITS,
  assertBrowserProbeRecapture,
} from './browser-probe-recapture.mjs';
import { repositoryRelative } from './contracts.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import { loadPlaywrightCaptureResult } from './playwright-capture.mjs';
import {
  PLAYWRIGHT_CAPTURE_LIMITS,
  assertPlaywrightCaptureId,
  assertPlaywrightCaptureReceipt,
} from './playwright-capture-contracts.mjs';
import { TOOL_LED_DETECTOR_POLICY } from './tool-led-performance-diagnosis.mjs';
import { diagnoseRuntimeMechanisms } from './server-request-cpu.mjs';

export const BROWSER_PROBE_STABILITY_SCHEMA_VERSION = 'runtime-browser-probe-stability/v2';
export const BROWSER_PROBE_STABILITY_LEGACY_SCHEMA_VERSION = 'runtime-browser-probe-stability/v1';
export const BROWSER_PROBE_STABILITY_LIMITS = Object.freeze({
  minimumRuns: 2,
  stableRuns: 3,
  maximumRuns: 5,
});

const PROBE_RUNS_DIRECTORY = '.codevetter/browser-probe-runs';
const SELF_ROUTED_REQUEST_PROBES = new Set([
  'inspect_main_thread_runtime',
  'repeat_with_lower_overhead_cpu_measurement',
  'inspect_gc_pressure',
  'inspect_continuous_main_thread_source',
]);

export async function assessDurableBrowserProbeStability(
  repositoryRoot,
  input,
  { loadRun = loadDurableProbeRun, inspectCurrent = inspectGitDiff } = {}
) {
  const root = await realpath(resolve(repositoryRoot));
  const recaptureIds = assertRecaptureIds(input?.recapture_ids);
  const runs = [];
  for (const recaptureId of recaptureIds) runs.push(await loadRun(root, recaptureId));
  const current = await inspectCurrent(root);
  return createBrowserProbeStabilityAssessment(runs, current);
}

export async function loadDurableProbeRun(root, recaptureId) {
  const safeId = assertPlaywrightCaptureId(recaptureId);
  const probeReceiptPath = resolve(root, PROBE_RUNS_DIRECTORY, safeId, 'receipt.json');
  const probeBytes = await readContainedFile(
    root,
    probeReceiptPath,
    BROWSER_PROBE_RECAPTURE_LIMITS.receiptBytes,
    'browser probe receipt'
  );
  const probeReceipt = assertBrowserProbeRecapture(JSON.parse(probeBytes));
  if (
    probeReceipt.recapture_id !== safeId ||
    probeReceipt.state !== 'completed' ||
    probeReceipt.evidence.outcome !== 'evidence_completed' ||
    !probeReceipt.new_capture
  ) {
    throw new Error('browser probe receipt has no completed linked evidence');
  }

  const captureReceiptPath = resolve(
    root,
    '.codevetter/playwright-runs',
    probeReceipt.new_capture.capture_id,
    'receipt.json'
  );
  if (
    repositoryRelative(root, captureReceiptPath) !== probeReceipt.new_capture.receipt_path ||
    probeReceipt.new_capture.receipt_path !==
      `.codevetter/playwright-runs/${probeReceipt.new_capture.capture_id}/receipt.json`
  ) {
    throw new Error('browser probe linked capture path is invalid');
  }
  const captureBytes = await readContainedFile(
    root,
    captureReceiptPath,
    PLAYWRIGHT_CAPTURE_LIMITS.receiptBytes,
    'linked browser capture receipt'
  );
  if (sha256(captureBytes) !== probeReceipt.new_capture.receipt_sha256) {
    throw new Error('linked browser capture receipt integrity check failed');
  }
  const captureReceipt = assertPlaywrightCaptureReceipt(JSON.parse(captureBytes));
  if (
    captureReceipt.capture_id !== probeReceipt.new_capture.capture_id ||
    captureReceipt.state !== probeReceipt.new_capture.state ||
    captureReceipt.result?.path !== probeReceipt.new_capture.result_path ||
    captureReceipt.result?.sha256 !== probeReceipt.new_capture.result_sha256 ||
    captureReceipt.subject.repository_revision !== probeReceipt.subject.repository_revision ||
    captureReceipt.subject.source_snapshot_sha256 !== probeReceipt.subject.source_snapshot_sha256 ||
    captureReceipt.scope.target !== probeReceipt.scope.target ||
    (captureReceipt.scope.name ?? null) !== probeReceipt.scope.name ||
    (captureReceipt.scope.browser_profile?.project_name ?? null) !== probeReceipt.scope.project
  ) {
    throw new Error('linked browser capture identity does not match probe receipt');
  }
  const result = await loadPlaywrightCaptureResult(root, captureReceipt);
  const requests = (result.server?.requests ?? []).filter(
    (request) =>
      request.ordinal === probeReceipt.source_capture.server_request_ordinal &&
      request.method === probeReceipt.source_capture.method &&
      request.route === probeReceipt.source_capture.route
  );
  if (requests.length !== 1) throw new Error('linked browser capture request identity is invalid');
  const nextProbe = captureReceipt.diagnosis?.next_probe ?? null;
  const compatibleNextProbe = selectCompatibleLinkedNextProbe(
    probeReceipt.source_capture.probe,
    nextProbe,
    requests[0].ordinal
  );
  return compactRun(probeReceipt, requests[0], compatibleNextProbe);
}

export function selectCompatibleLinkedNextProbe(sourceProbe, nextProbe, requestOrdinal) {
  if (nextProbe === null || nextProbe === undefined) return null;
  if (nextProbe.server_request_ordinal === requestOrdinal) return nextProbe;
  if (SELF_ROUTED_REQUEST_PROBES.has(sourceProbe)) return null;
  throw new Error('linked browser next probe resolves a different request');
}

export function createBrowserProbeStabilityAssessment(runs, current) {
  if (
    !Array.isArray(runs) ||
    runs.length < BROWSER_PROBE_STABILITY_LIMITS.minimumRuns ||
    runs.length > BROWSER_PROBE_STABILITY_LIMITS.maximumRuns
  ) {
    throw new Error('browser probe stability requires two to five runs');
  }
  runs = runs.map((run) => ({
    ...run,
    upstream_recapture: run.upstream_recapture ?? null,
    route: { ...run.route, leading_source: run.route?.leading_source ?? null },
  }));
  if (runs.some((run) => run.evidence_outcome !== 'evidence_completed')) {
    throw new Error('browser probe stability requires completed evidence');
  }
  const compatibility = compatibilityIdentity(runs[0]);
  if (runs.some((run) => compatibilityIdentity(run) !== compatibility)) {
    throw new Error('browser probe recaptures are not exactly compatible');
  }
  const first = runs[0];
  const currentSnapshot =
    current.repository_revision === first.subject.repository_revision &&
    current.source_snapshot_sha256 === first.subject.source_snapshot_sha256;
  const routeCounts = new Map();
  for (const run of runs) {
    const key = routeKey(run.route);
    routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);
  }
  const routes = [...routeCounts.entries()]
    .map(([key, count]) => {
      const route = runs.find((run) => routeKey(run.route) === key).route;
      return {
        classification: route.classification,
        next_probe: route.next_probe,
        leading_source: route.leading_source,
        count,
      };
    })
    .toSorted(
      (left, right) => right.count - left.count || routeKey(left).localeCompare(routeKey(right))
    );
  const diagnosisProbe = ['inspect_gc_pressure', 'inspect_continuous_main_thread_source'].includes(
    first.source_capture.probe
  );
  let state;
  if (!currentSnapshot) state = 'stale';
  else if (routes.length > 1) state = 'unstable';
  else if (diagnosisProbe && routes[0].leading_source === null) state = 'insufficient_evidence';
  else if (runs.length < BROWSER_PROBE_STABILITY_LIMITS.stableRuns) {
    state = 'insufficient_repetitions';
  } else if (diagnosisProbe) state = 'diagnosis_stable';
  else if (routes[0].next_probe === null) state = 'insufficient_evidence';
  else state = 'stable';

  const everyCorrect = runs.every((run) => run.correctness === 'passed');
  const followUpEligible = state === 'stable' && everyCorrect;
  return assertBrowserProbeStability({
    schema_version: BROWSER_PROBE_STABILITY_SCHEMA_VERSION,
    state,
    subject: { ...first.subject, current: currentSnapshot },
    source_capture: first.source_capture,
    scope: first.scope,
    inventory: { total: runs.length, retained: runs.length, complete: true },
    routes,
    cpu_ratio: expectedCpuRatio(runs),
    runs,
    decision: {
      stable: ['stable', 'diagnosis_stable'].includes(state),
      diagnosis_stable: state === 'diagnosis_stable',
      follow_up_eligible: followUpEligible,
      source_inspection_eligible: state === 'diagnosis_stable' && everyCorrect,
      next_probe: state === 'stable' ? routes[0].next_probe : null,
      leading_source: state === 'diagnosis_stable' ? routes[0].leading_source : null,
      next_action: nextAction(state, everyCorrect, routes[0]?.leading_source ?? null),
    },
    authority: {
      confidence: 'low',
      source_causal: false,
      edit_eligible: false,
      correctness_required: true,
    },
    provenance: 'integrity_checked_repeated_browser_probe_assessment',
    limitations: [
      'Probe stability is local repeated evidence, not production frequency, latency, scale, or impact.',
      'CPU-ratio proximity is observed context and is not claimed to cause route disagreement.',
      'A stable probe permits only another bounded observation or source inspection; it never authorizes a source edit.',
    ],
  });
}

function compactRun(receipt, request, nextProbe) {
  const runtimeRoute =
    receipt.source_capture.probe === 'inspect_main_thread_runtime' && request.cpu
      ? diagnoseRuntimeMechanisms(request.cpu)
      : null;
  const lowOverheadRoute =
    receipt.source_capture.probe === 'repeat_with_lower_overhead_cpu_measurement'
      ? (receipt.evidence.low_overhead_runtime?.route ?? null)
      : null;
  const gcPressureRoute =
    receipt.source_capture.probe === 'inspect_gc_pressure'
      ? (receipt.evidence.gc_pressure?.route ?? null)
      : null;
  const continuousSource =
    receipt.source_capture.probe === 'inspect_continuous_main_thread_source'
      ? (receipt.evidence.continuous_source ?? null)
      : null;
  const continuousLeadingSource = continuousSource?.candidates?.[0]?.source ?? null;
  return {
    recapture_id: receipt.recapture_id,
    capture_id: receipt.new_capture.capture_id,
    subject: {
      repository_revision: receipt.subject.repository_revision,
      source_snapshot_sha256: receipt.subject.source_snapshot_sha256,
    },
    source_capture: receipt.source_capture,
    upstream_recapture: receipt.upstream_recapture ?? null,
    scope: receipt.scope,
    policy: {
      presentation_profile: receipt.policy.presentation_profile,
      remote_http_denied: receipt.policy.remote_http_denied,
    },
    runtime: {
      family: receipt.runtime?.family ?? null,
      configuration: receipt.runtime?.configuration ?? null,
      cleanup: receipt.runtime?.cleanup ?? null,
    },
    evidence_outcome: receipt.evidence.outcome,
    correctness: receipt.evidence.correctness,
    route: {
      classification:
        (continuousSource
          ? continuousLeadingSource
            ? 'continuous_source_observed'
            : 'continuous_source_unresolved'
          : null) ??
        gcPressureRoute?.classification ??
        lowOverheadRoute?.classification ??
        runtimeRoute?.classification ??
        nextProbe?.classification ??
        null,
      next_probe: gcPressureRoute
        ? null
        : (lowOverheadRoute?.next_probe ?? runtimeRoute?.next_probe ?? nextProbe?.probe ?? null),
      leading_source: continuousSource
        ? continuousLeadingSource
        : (gcPressureRoute?.leading_source ?? null),
    },
    preparation_wall_ms: request.response_timing?.preparation_ms ?? null,
    preparation_process_cpu_ms: request.process_cpu?.preparation_cpu_ms ?? null,
    preparation_cpu_to_wall_ratio: request.process_cpu?.preparation_cpu_to_wall_ratio ?? null,
  };
}

function compatibilityIdentity(run) {
  return JSON.stringify({
    subject: run.subject,
    source_capture: run.source_capture,
    upstream_recapture: run.upstream_recapture,
    scope: run.scope,
    policy: run.policy,
    runtime: { family: run.runtime.family, configuration: run.runtime.configuration },
    evidence_outcome: run.evidence_outcome,
  });
}

function routeKey(route) {
  return `${route.classification ?? '<null>'}\u0000${route.next_probe ?? '<null>'}\u0000${JSON.stringify(route.leading_source ?? null)}`;
}

function nextAction(state, everyCorrect, leadingSource = null) {
  if (state === 'stale') return 'recapture_probe_on_current_source_snapshot';
  if (state === 'unstable') return 'stabilize_measurement_before_following_probe';
  if (state === 'insufficient_repetitions') return 'capture_one_more_compatible_probe_repetition';
  if (state === 'insufficient_evidence') return 'capture_narrower_compatible_probe_evidence';
  if (state === 'diagnosis_stable') {
    return everyCorrect
      ? leadingSource?.provenance === 'continuous_node_cpu_sample'
        ? 'inspect_stable_sampled_cpu_source_before_candidate_edit'
        : 'inspect_stable_sampled_allocation_source_before_candidate_edit'
      : 'repair_or_replace_failed_correctness_flow';
  }
  if (!everyCorrect) return 'repair_or_replace_failed_correctness_flow';
  return 'follow_stable_probe_with_bounded_observation';
}

function assertRecaptureIds(value) {
  if (
    !Array.isArray(value) ||
    value.length < BROWSER_PROBE_STABILITY_LIMITS.minimumRuns ||
    value.length > BROWSER_PROBE_STABILITY_LIMITS.maximumRuns ||
    new Set(value).size !== value.length
  ) {
    throw new Error('browser probe stability requires two to five unique recapture IDs');
  }
  return value.map(assertPlaywrightCaptureId);
}

async function readContainedFile(root, path, maximumBytes, label) {
  if (repositoryRelative(root, path) === null) throw new Error(`${label} escapes repository`);
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumBytes
  ) {
    throw new Error(`${label} is unsafe`);
  }
  return readFile(path, 'utf8');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function round4(value) {
  return Math.round(value * 10_000) / 10_000;
}

export function assertBrowserProbeStability(value) {
  const legacy = value?.schema_version === BROWSER_PROBE_STABILITY_LEGACY_SCHEMA_VERSION;
  if (
    !closed(value, [
      'schema_version',
      'state',
      'subject',
      'source_capture',
      'scope',
      'inventory',
      'routes',
      'cpu_ratio',
      'runs',
      'decision',
      'authority',
      'provenance',
      'limitations',
    ]) ||
    ![
      BROWSER_PROBE_STABILITY_SCHEMA_VERSION,
      BROWSER_PROBE_STABILITY_LEGACY_SCHEMA_VERSION,
    ].includes(value.schema_version) ||
    !(
      legacy
        ? ['stable', 'unstable', 'insufficient_repetitions', 'insufficient_evidence', 'stale']
        : [
            'stable',
            'diagnosis_stable',
            'unstable',
            'insufficient_repetitions',
            'insufficient_evidence',
            'stale',
          ]
    ).includes(value.state) ||
    !validSubject(value.subject) ||
    !validSourceCapture(value.source_capture, legacy) ||
    !validScope(value.scope) ||
    !validInventory(value.inventory, value.runs) ||
    !Array.isArray(value.routes) ||
    value.routes.length < 1 ||
    value.routes.length > value.runs.length ||
    value.routes.some((route) => !validRouteCount(route, legacy)) ||
    value.routes.reduce((total, route) => total + route.count, 0) !== value.runs.length ||
    !validCpuRatio(value.cpu_ratio) ||
    !Array.isArray(value.runs) ||
    value.runs.length < BROWSER_PROBE_STABILITY_LIMITS.minimumRuns ||
    value.runs.length > BROWSER_PROBE_STABILITY_LIMITS.maximumRuns ||
    value.runs.some((run) => !validRun(run, legacy)) ||
    !validDecision(value.decision, value.state, legacy) ||
    !validAuthority(value.authority) ||
    value.provenance !== 'integrity_checked_repeated_browser_probe_assessment' ||
    !Array.isArray(value.limitations) ||
    value.limitations.some((item) => typeof item !== 'string')
  ) {
    throw new Error('browser probe stability assessment is invalid');
  }
  const recaptureIds = value.runs.map((run) => run.recapture_id);
  const expectedRoutes = normalizedRoutes(value.runs, legacy);
  const expectedRatio = expectedCpuRatio(value.runs);
  const everyCorrect = value.runs.every((run) => run.correctness === 'passed');
  if (
    new Set(recaptureIds).size !== recaptureIds.length ||
    value.runs.some(
      (run) =>
        JSON.stringify(run.subject) !==
          JSON.stringify({
            repository_revision: value.subject.repository_revision,
            source_snapshot_sha256: value.subject.source_snapshot_sha256,
          }) ||
        JSON.stringify(run.source_capture) !== JSON.stringify(value.source_capture) ||
        (!legacy &&
          JSON.stringify(run.upstream_recapture) !==
            JSON.stringify(value.runs[0].upstream_recapture)) ||
        JSON.stringify(run.scope) !== JSON.stringify(value.scope)
    ) ||
    JSON.stringify(value.routes) !== JSON.stringify(expectedRoutes) ||
    JSON.stringify(value.cpu_ratio) !== JSON.stringify(expectedRatio) ||
    (value.state === 'stale') !== (value.subject.current === false) ||
    value.decision.follow_up_eligible !== (value.state === 'stable' && everyCorrect) ||
    value.decision.next_probe !== (value.state === 'stable' ? value.routes[0].next_probe : null) ||
    (!legacy &&
      (value.decision.stable !== ['stable', 'diagnosis_stable'].includes(value.state) ||
        value.decision.diagnosis_stable !== (value.state === 'diagnosis_stable') ||
        value.decision.source_inspection_eligible !==
          (value.state === 'diagnosis_stable' && everyCorrect) ||
        JSON.stringify(value.decision.leading_source) !==
          JSON.stringify(
            value.state === 'diagnosis_stable' ? value.routes[0].leading_source : null
          ))) ||
    value.decision.next_action !==
      nextAction(
        value.state,
        everyCorrect,
        value.state === 'diagnosis_stable' ? value.routes[0].leading_source : null
      )
  ) {
    throw new Error('browser probe stability assessment is internally inconsistent');
  }
  return value;
}

function validSubject(value) {
  return (
    closed(value, ['repository_revision', 'source_snapshot_sha256', 'current']) &&
    typeof value.repository_revision === 'string' &&
    /^[0-9a-f]{64}$/.test(value.source_snapshot_sha256) &&
    typeof value.current === 'boolean'
  );
}

function validCompactSubject(value) {
  return (
    closed(value, ['repository_revision', 'source_snapshot_sha256']) &&
    typeof value.repository_revision === 'string' &&
    /^[0-9a-f]{64}$/.test(value.source_snapshot_sha256)
  );
}

function validSourceCapture(value, legacy = false) {
  return (
    closed(value, [
      'capture_id',
      'receipt_sha256',
      'probe',
      'server_request_ordinal',
      'method',
      'route',
    ]) &&
    safeCaptureId(value.capture_id) &&
    /^[0-9a-f]{64}$/.test(value.receipt_sha256) &&
    [
      'complete_async_and_framework_inventories',
      'inspect_main_thread_runtime',
      'repeat_with_lower_overhead_cpu_measurement',
      ...(legacy ? [] : ['inspect_gc_pressure', 'inspect_continuous_main_thread_source']),
    ].includes(value.probe) &&
    Number.isSafeInteger(value.server_request_ordinal) &&
    value.server_request_ordinal > 0 &&
    typeof value.method === 'string' &&
    typeof value.route === 'string' &&
    value.route.startsWith('/')
  );
}

function validUpstreamRecapture(value, sourceCapture) {
  if (value === null) {
    return !['inspect_gc_pressure', 'inspect_continuous_main_thread_source'].includes(
      sourceCapture.probe
    );
  }
  const expectedSourceProbe =
    sourceCapture.probe === 'repeat_with_lower_overhead_cpu_measurement'
      ? 'inspect_main_thread_runtime'
      : sourceCapture.probe === 'inspect_gc_pressure'
        ? 'repeat_with_lower_overhead_cpu_measurement'
        : sourceCapture.probe === 'inspect_continuous_main_thread_source'
          ? 'repeat_with_lower_overhead_cpu_measurement'
          : null;
  return (
    expectedSourceProbe !== null &&
    closed(value, [
      'recapture_id',
      'receipt_sha256',
      'source_probe',
      'classification',
      'next_probe',
      'server_request_ordinal',
      'correctness',
    ]) &&
    safeCaptureId(value.recapture_id) &&
    /^[0-9a-f]{64}$/.test(value.receipt_sha256) &&
    value.source_probe === expectedSourceProbe &&
    typeof value.classification === 'string' &&
    value.next_probe === sourceCapture.probe &&
    value.server_request_ordinal === sourceCapture.server_request_ordinal &&
    value.correctness === 'passed'
  );
}

function validSource(value) {
  return (
    closed(value, ['file', 'line', 'function', 'provenance']) &&
    typeof value.file === 'string' &&
    !value.file.startsWith('/') &&
    !value.file.includes('\\') &&
    !value.file.split('/').includes('..') &&
    Number.isSafeInteger(value.line) &&
    value.line > 0 &&
    typeof value.function === 'string' &&
    ['request_scoped_v8_sampling_heap_profile', 'continuous_node_cpu_sample'].includes(
      value.provenance
    )
  );
}

function validScope(value) {
  return (
    closed(value, ['target', 'name', 'project']) &&
    typeof value.target === 'string' &&
    value.target.length > 0 &&
    nullableString(value.name) &&
    nullableString(value.project)
  );
}

function validInventory(value, runs) {
  return (
    closed(value, ['total', 'retained', 'complete']) &&
    value.total === runs?.length &&
    value.retained === runs?.length &&
    value.complete === true
  );
}

function validRouteCount(value, legacy) {
  return (
    closed(value, [
      'classification',
      'next_probe',
      ...(legacy ? [] : ['leading_source']),
      'count',
    ]) &&
    nullableString(value.classification) &&
    nullableString(value.next_probe) &&
    (legacy || value.leading_source === null || validSource(value.leading_source)) &&
    Number.isSafeInteger(value.count) &&
    value.count > 0
  );
}

function validCpuRatio(value) {
  return (
    closed(value, ['threshold', 'minimum', 'maximum', 'range']) &&
    value.threshold === TOOL_LED_DETECTOR_POLICY.server_precommit_cpu_low_ratio &&
    nullableFinite(value.minimum) &&
    nullableFinite(value.maximum) &&
    nullableFinite(value.range) &&
    (value.minimum === null || value.maximum >= value.minimum)
  );
}

function validRun(value, legacy) {
  return (
    closed(value, [
      'recapture_id',
      'capture_id',
      'subject',
      'source_capture',
      ...(legacy ? [] : ['upstream_recapture']),
      'scope',
      'policy',
      'runtime',
      'evidence_outcome',
      'correctness',
      'route',
      'preparation_wall_ms',
      'preparation_process_cpu_ms',
      'preparation_cpu_to_wall_ratio',
    ]) &&
    safeCaptureId(value.recapture_id) &&
    safeCaptureId(value.capture_id) &&
    validCompactSubject(value.subject) &&
    validSourceCapture(value.source_capture, legacy) &&
    (legacy || validUpstreamRecapture(value.upstream_recapture, value.source_capture)) &&
    validScope(value.scope) &&
    validPolicy(value.policy) &&
    validRuntime(value.runtime) &&
    value.evidence_outcome === 'evidence_completed' &&
    ['passed', 'failed'].includes(value.correctness) &&
    closed(value.route, ['classification', 'next_probe', ...(legacy ? [] : ['leading_source'])]) &&
    nullableString(value.route.classification) &&
    nullableString(value.route.next_probe) &&
    (legacy || value.route.leading_source === null || validSource(value.route.leading_source)) &&
    nullableFinite(value.preparation_wall_ms) &&
    nullableFinite(value.preparation_process_cpu_ms) &&
    nullableFinite(value.preparation_cpu_to_wall_ratio)
  );
}

function validPolicy(value) {
  return (
    closed(value, ['presentation_profile', 'remote_http_denied']) &&
    [
      'expanded_async_framework',
      'runtime_mechanisms',
      'profiler_disabled_runtime',
      'gc_pressure_runtime',
      'continuous_source_runtime',
    ].includes(value.presentation_profile) &&
    value.remote_http_denied === true
  );
}

function validRuntime(value) {
  return (
    closed(value, ['family', 'configuration', 'cleanup']) &&
    nullableString(value.family) &&
    nullableString(value.configuration) &&
    nullableString(value.cleanup) &&
    value.cleanup !== 'failed'
  );
}

function validDecision(value, state, legacy) {
  if (legacy) {
    return (
      closed(value, ['stable', 'follow_up_eligible', 'next_probe', 'next_action']) &&
      value.stable === (state === 'stable') &&
      typeof value.follow_up_eligible === 'boolean' &&
      (!value.follow_up_eligible || state === 'stable') &&
      nullableString(value.next_probe) &&
      (state === 'stable' ? typeof value.next_probe === 'string' : value.next_probe === null) &&
      typeof value.next_action === 'string'
    );
  }
  return (
    closed(value, [
      'stable',
      'diagnosis_stable',
      'follow_up_eligible',
      'source_inspection_eligible',
      'next_probe',
      'leading_source',
      'next_action',
    ]) &&
    value.stable === ['stable', 'diagnosis_stable'].includes(state) &&
    value.diagnosis_stable === (state === 'diagnosis_stable') &&
    typeof value.follow_up_eligible === 'boolean' &&
    (!value.follow_up_eligible || state === 'stable') &&
    typeof value.source_inspection_eligible === 'boolean' &&
    (!value.source_inspection_eligible || state === 'diagnosis_stable') &&
    nullableString(value.next_probe) &&
    (state === 'stable' ? typeof value.next_probe === 'string' : value.next_probe === null) &&
    (value.leading_source === null || validSource(value.leading_source)) &&
    (state === 'diagnosis_stable'
      ? value.leading_source !== null
      : value.leading_source === null) &&
    typeof value.next_action === 'string'
  );
}

function normalizedRoutes(runs, legacy = false) {
  const counts = new Map();
  for (const run of runs) {
    const key = routeKey(run.route);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const route = runs.find((run) => routeKey(run.route) === key).route;
      return {
        classification: route.classification,
        next_probe: route.next_probe,
        ...(legacy ? {} : { leading_source: route.leading_source }),
        count,
      };
    })
    .toSorted(
      (left, right) => right.count - left.count || routeKey(left).localeCompare(routeKey(right))
    );
}

function expectedCpuRatio(runs) {
  const ratios = runs.map((run) => run.preparation_cpu_to_wall_ratio).filter(Number.isFinite);
  return {
    threshold: TOOL_LED_DETECTOR_POLICY.server_precommit_cpu_low_ratio,
    minimum: ratios.length === runs.length ? Math.min(...ratios) : null,
    maximum: ratios.length === runs.length ? Math.max(...ratios) : null,
    range: ratios.length === runs.length ? round4(Math.max(...ratios) - Math.min(...ratios)) : null,
  };
}

function validAuthority(value) {
  return (
    closed(value, ['confidence', 'source_causal', 'edit_eligible', 'correctness_required']) &&
    value.confidence === 'low' &&
    value.source_causal === false &&
    value.edit_eligible === false &&
    value.correctness_required === true
  );
}

function safeCaptureId(value) {
  try {
    assertPlaywrightCaptureId(value);
    return true;
  } catch {
    return false;
  }
}

function nullableString(value) {
  return value === null || typeof value === 'string';
}

function nullableFinite(value) {
  return value === null || (Number.isFinite(value) && value >= 0);
}

function closed(value, fields) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}
