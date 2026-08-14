import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import { repositoryRelative } from './contracts.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import {
  PLAYWRIGHT_CAPTURE_LIMITS,
  assertPlaywrightCaptureId,
  assertPlaywrightCaptureReceipt,
} from './playwright-capture-contracts.mjs';
import { loadPlaywrightCaptureResult } from './playwright-capture.mjs';
import { diagnoseRuntimeMechanisms } from './server-request-cpu.mjs';

export const BROWSER_PROBE_INSPECTION_SCHEMA_VERSION = 'runtime-browser-probe-inspection/v4';
export const BROWSER_PROBE_INSPECTION_LIMITS = Object.freeze({ candidates: 8 });

const RUNS_DIRECTORY = '.codevetter/playwright-runs';
const MAIN_THREAD_SCOPES = new Set(['repository', 'dependency', 'generated', 'runtime']);
const WORKER_SCOPES = new Set(['repository', 'dependency', 'generated', 'runtime']);
const LIBUV_KINDS = new Set([
  'crypto',
  'zlib',
  'filesystem',
  'dns',
  'network',
  'node_api',
  'blob',
  'other',
]);
const ASYNC_KINDS = new Set(['connect', 'dns', 'filesystem', 'scheduler', 'timer', 'worker_pool']);

export async function inspectDurableBrowserProbe(repositoryRoot, input) {
  const root = await realpath(resolve(repositoryRoot));
  const inputRequest = assertInspectionInput(input);
  const captureId = inputRequest.capture_id;
  const requestedProbe = inputRequest.probe;
  const receipt = await loadCaptureReceipt(root, captureId);
  if (receipt.capture_id !== captureId) throw new Error('browser capture identity mismatch');
  if (!receipt.result) {
    throw new Error('browser capture has no executable next probe');
  }
  const upstream = inputRequest.source_recapture_id
    ? await loadChainedProbeRoute(root, {
        recaptureId: inputRequest.source_recapture_id,
        captureId,
        requestedProbe,
      })
    : null;
  if (!upstream && !receipt.diagnosis?.next_probe) {
    throw new Error('browser capture has no executable next probe');
  }
  const nextProbe = normalizeLegacyProbe(receipt.diagnosis?.next_probe ?? null);
  const result = await loadPlaywrightCaptureResult(root, receipt);
  const expectedOrdinal = upstream?.server_request_ordinal ?? nextProbe.server_request_ordinal;
  const matchingRequests = (result.server?.requests ?? []).filter(
    (candidate) => candidate.ordinal === expectedOrdinal
  );
  if (matchingRequests.length !== 1) {
    throw new Error('browser diagnosis does not resolve one exact server request');
  }
  const request = matchingRequests[0];
  const derivedRoute =
    nextProbe.probe === 'inspect_main_thread_runtime' && request.cpu
      ? diagnoseRuntimeMechanisms(request.cpu)
      : null;
  const direct = !upstream && nextProbe.probe === requestedProbe;
  const derivedLowerOverhead =
    requestedProbe === 'repeat_with_lower_overhead_cpu_measurement' &&
    derivedRoute?.classification === 'observer_effect' &&
    derivedRoute.next_probe === requestedProbe;
  const chained = upstream?.next_probe === requestedProbe;
  if (!direct && !derivedLowerOverhead && !chained) {
    throw new Error('requested probe does not match the durable browser diagnosis');
  }
  const family = parseProbe(requestedProbe);
  if (!family) throw new Error('browser diagnosis probe family is not inspectable');
  const probeDescriptor = upstream
    ? {
        classification: upstream.classification,
        probe: requestedProbe,
        server_request_ordinal: upstream.server_request_ordinal,
        required_observation:
          requestedProbe === 'inspect_continuous_main_thread_source'
            ? 'Recapture the same exact flow with low-frequency main-thread sampling active before warm-up and stopped at the exact response commitment.'
            : 'Recapture the same exact flow with CPU profilers disabled and bounded request-scoped GC allocation sampling enabled.',
      }
    : derivedLowerOverhead
      ? {
          classification: 'observer_effect',
          probe: requestedProbe,
          server_request_ordinal: request.ordinal,
          required_observation:
            'Recapture the same exact flow with main-thread and Worker sampling profilers disabled.',
        }
      : nextProbe;
  const current = await inspectGitDiff(root);
  return createBrowserProbeInspection({
    receipt,
    request,
    current,
    family,
    requestedProbe,
    probeDescriptor,
    upstreamRecapture: upstream,
  });
}

function normalizeLegacyProbe(value) {
  return value?.probe === 'capture_main_thread_source_profile'
    ? { ...value, probe: 'inspect_main_thread_runtime' }
    : value;
}

export function createBrowserProbeInspection({
  receipt,
  request,
  current,
  family,
  requestedProbe,
  probeDescriptor = receipt.diagnosis.next_probe,
  upstreamRecapture = null,
}) {
  const nextProbe = probeDescriptor;
  const snapshotCurrent =
    current.repository_revision === receipt.subject.repository_revision &&
    current.source_snapshot_sha256 === receipt.subject.source_snapshot_sha256;
  const candidates = snapshotCurrent ? sourceCandidates(request, family) : [];
  const sourceInventory = {
    total: candidates.length,
    retained: candidates.length,
    complete: true,
  };
  const runtimeRoute =
    ((family.family === 'main_thread' && family.mechanism === 'runtime') ||
      family.family === 'low_overhead_runtime') &&
    request.cpu
      ? diagnoseRuntimeMechanisms(request.cpu)
      : null;
  return assertBrowserProbeInspection({
    schema_version: BROWSER_PROBE_INSPECTION_SCHEMA_VERSION,
    state: !snapshotCurrent
      ? 'stale_source_snapshot'
      : upstreamRecapture?.correctness === 'failed'
        ? 'correctness_blocked'
        : 'observed',
    capture_id: receipt.capture_id,
    upstream_recapture: upstreamRecapture,
    subject: {
      repository_revision: receipt.subject.repository_revision,
      source_snapshot_sha256: receipt.subject.source_snapshot_sha256,
      current: snapshotCurrent,
    },
    scope: {
      target: receipt.scope.target,
      name: receipt.scope.name ?? null,
      project: receipt.scope.browser_profile?.project_name ?? null,
    },
    probe: {
      classification: nextProbe.classification,
      name: requestedProbe,
      family: family.family,
      mechanism: family.mechanism,
      required_observation: nextProbe.required_observation,
    },
    request: compactRequest(request, runtimeRoute),
    source_inventory: sourceInventory,
    source_candidates: candidates,
    next_action: !snapshotCurrent
      ? 'recapture_probe_on_current_source_snapshot'
      : upstreamRecapture?.correctness === 'failed'
        ? 'repair_or_replace_failed_correctness_flow'
        : family.family === 'low_overhead_runtime'
          ? missingSourceAction(family)
          : runtimeRoute
            ? runtimeRoute.next_probe
            : candidates.length > 0
              ? 'inspect_candidate_source_then_recapture_correctness'
              : missingSourceAction(family),
    authority: {
      confidence: 'low',
      source_causal: false,
      edit_eligible: false,
      correctness_required: true,
    },
    provenance: 'integrity_checked_durable_playwright_probe_projection',
    limitations: [
      'Source candidates were already captured on the exact request; inspection does not execute or recapture application code.',
      'Temporal, async-context, sampled, and route relationships do not prove exclusive work or causal ownership.',
      'A failed browser flow cannot authorize a source edit or optimization.',
    ],
  });
}

async function loadCaptureReceipt(root, captureId) {
  const path = resolve(root, RUNS_DIRECTORY, captureId, 'receipt.json');
  if (repositoryRelative(root, path) === null) throw new Error('browser capture receipt escapes');
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > PLAYWRIGHT_CAPTURE_LIMITS.receiptBytes
  ) {
    throw new Error('browser capture receipt is unsafe');
  }
  return assertPlaywrightCaptureReceipt(JSON.parse(await readFile(path, 'utf8')));
}

function parseProbe(probe) {
  let match = /^inspect_main_thread_(repository|dependency|generated|runtime)$/.exec(probe);
  if (match && MAIN_THREAD_SCOPES.has(match[1])) {
    return { family: 'main_thread', mechanism: match[1] };
  }
  match = /^inspect_worker_thread_(repository|dependency|generated|runtime)$/.exec(probe);
  if (match && WORKER_SCOPES.has(match[1])) {
    return { family: 'worker_thread', mechanism: match[1] };
  }
  match = /^inspect_libuv_threadpool_([a-z_]+)$/.exec(probe);
  if (match && LIBUV_KINDS.has(match[1])) {
    return { family: 'libuv_threadpool', mechanism: match[1] };
  }
  match = /^inspect_async_([a-z_]+)$/.exec(probe);
  if (match && ASYNC_KINDS.has(match[1])) {
    return { family: 'response_linked_async', mechanism: match[1] };
  }
  match =
    /^inspect_framework_phase_(route_resolution|component_tree|client_component_loading)$/.exec(
      probe
    );
  if (match) return { family: 'framework_phase', mechanism: match[1] };
  if (probe === 'complete_async_and_framework_inventories') {
    return { family: 'evidence_gap', mechanism: 'async_and_framework_inventories' };
  }
  if (probe === 'repeat_with_lower_overhead_cpu_measurement') {
    return { family: 'low_overhead_runtime', mechanism: 'profiler_disabled' };
  }
  if (probe === 'inspect_gc_pressure') {
    return { family: 'gc_pressure', mechanism: 'allocation_sampling' };
  }
  if (probe === 'inspect_continuous_main_thread_source') {
    return { family: 'continuous_main_thread_source', mechanism: 'startup_sampling' };
  }
  return null;
}

function sourceCandidates(request, family) {
  let candidates = [];
  if (family.family === 'main_thread' && family.mechanism === 'repository') {
    candidates = (request.cpu?.candidates ?? []).map((candidate) => ({
      source: candidate.source,
      evidence_kind: 'main_thread_cpu_sample',
      mechanism: family.mechanism,
      metric: { kind: 'sampled_self_time_ms', value: candidate.self_time_ms },
      relationship: 'sampled_on_exact_request_not_exclusive_or_causal',
    }));
  } else if (family.family === 'worker_thread' && family.mechanism === 'repository') {
    candidates = (request.worker_cpu?.workers ?? []).flatMap((worker) =>
      (worker.profile?.candidates ?? []).map((candidate) => ({
        source: candidate.source,
        evidence_kind: 'worker_cpu_sample',
        mechanism: family.mechanism,
        metric: { kind: 'sampled_self_time_ms', value: candidate.self_time_ms },
        relationship: 'sampled_on_compatible_worker_interval_not_exclusive_or_causal',
      }))
    );
  } else if (family.family === 'libuv_threadpool') {
    const resourceKind = libuvResourceKind(family.mechanism);
    candidates = resourceKind
      ? (request.async_resources ?? [])
          .filter((resource) => resource.resource_kind === resourceKind && resource.source)
          .map((resource) => ({
            source: resource.source,
            evidence_kind: 'async_resource_callsite',
            mechanism: family.mechanism,
            metric: { kind: 'preparation_overlap_ms', value: resource.preparation_overlap_ms },
            relationship: 'async_context_and_temporal_overlap_not_native_cpu_attribution',
          }))
      : [];
  } else if (family.family === 'response_linked_async') {
    candidates = (request.async_resources ?? [])
      .filter(
        (resource) =>
          resource.resource_kind === family.mechanism &&
          resource.response_dependency === 'response_completion_descendant' &&
          resource.source
      )
      .map((resource) => ({
        source: resource.source,
        evidence_kind: 'async_resource_callsite',
        mechanism: family.mechanism,
        metric: { kind: 'preparation_overlap_ms', value: resource.preparation_overlap_ms },
        relationship: 'response_lineage_and_temporal_overlap_not_await_or_causality',
      }));
  } else if (family.family === 'continuous_main_thread_source') {
    candidates = (request.continuous_source?.candidates ?? []).map((candidate) => ({
      source: candidate.source,
      evidence_kind: 'continuous_main_thread_cpu_sample',
      mechanism: family.mechanism,
      metric: { kind: 'sampled_self_time_ms', value: candidate.self_time_ms },
      relationship: 'sampled_on_exact_precommit_interval_not_exclusive_or_causal',
    }));
  }
  return deduplicateCandidates(candidates).slice(0, BROWSER_PROBE_INSPECTION_LIMITS.candidates);
}

function libuvResourceKind(mechanism) {
  if (mechanism === 'crypto') return 'worker_pool';
  if (mechanism === 'filesystem') return 'filesystem';
  if (mechanism === 'dns') return 'dns';
  if (mechanism === 'network') return 'connect';
  return null;
}

function deduplicateCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!validSource(candidate.source) || !Number.isFinite(candidate.metric.value)) return false;
    const key = `${candidate.source.file}:${candidate.source.line}:${candidate.source.function ?? ''}:${candidate.evidence_kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactRequest(request, runtimeRoute) {
  return {
    ordinal: request.ordinal,
    method: request.method,
    route: request.route,
    status: request.status,
    outcome: request.outcome,
    duration_ms: request.duration_ms,
    source: request.source ?? null,
    response_timing: request.response_timing,
    process_cpu: request.process_cpu,
    worker_cpu: request.worker_cpu ?? null,
    native_activity: request.native_activity ?? null,
    continuous_source: request.continuous_source ?? null,
    runtime_mechanisms: runtimeRoute ? (request.cpu?.runtime_mechanisms ?? null) : null,
    runtime_route: runtimeRoute,
  };
}

function missingSourceAction(family) {
  if (family.family === 'main_thread' && family.mechanism === 'runtime') {
    return 'recapture_same_exact_flow_with_runtime_mechanisms';
  }
  if (family.family === 'main_thread') return 'capture_main_thread_repository_source_profile';
  if (family.family === 'worker_thread') return 'capture_worker_repository_source_profile';
  if (family.family === 'libuv_threadpool') {
    return `capture_libuv_${family.mechanism}_async_callsite`;
  }
  if (family.family === 'response_linked_async') {
    return `capture_response_linked_${family.mechanism}_callsite`;
  }
  if (family.family === 'evidence_gap') {
    return 'recapture_same_exact_flow_with_complete_async_and_framework_inventories';
  }
  if (family.family === 'low_overhead_runtime') {
    return 'recapture_same_exact_flow_with_sampling_profilers_disabled';
  }
  if (family.family === 'gc_pressure') {
    return 'recapture_same_exact_flow_with_gc_allocation_sampling';
  }
  if (family.family === 'continuous_main_thread_source') {
    return 'recapture_same_exact_flow_with_startup_main_thread_sampling';
  }
  return 'inspect_route_source_and_capture_narrower_framework_evidence';
}

export function assertBrowserProbeInspection(value) {
  const fields = [
    'schema_version',
    'state',
    'capture_id',
    'upstream_recapture',
    'subject',
    'scope',
    'probe',
    'request',
    'source_inventory',
    'source_candidates',
    'next_action',
    'authority',
    'provenance',
    'limitations',
  ];
  if (
    !closed(value, fields) ||
    value.schema_version !== BROWSER_PROBE_INSPECTION_SCHEMA_VERSION ||
    !['observed', 'correctness_blocked', 'stale_source_snapshot'].includes(value.state) ||
    assertSafeCaptureId(value.capture_id) !== true ||
    !validUpstreamRecapture(value.upstream_recapture, value.capture_id, value.probe?.name) ||
    !closed(value.subject, ['repository_revision', 'source_snapshot_sha256', 'current']) ||
    typeof value.subject.repository_revision !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.subject.source_snapshot_sha256) ||
    typeof value.subject.current !== 'boolean' ||
    (value.state === 'stale_source_snapshot') !== !value.subject.current ||
    (value.state === 'correctness_blocked') !==
      (value.subject.current && value.upstream_recapture?.correctness === 'failed') ||
    !closed(value.scope, ['target', 'name', 'project']) ||
    typeof value.scope.target !== 'string' ||
    !nullableString(value.scope.name) ||
    !nullableString(value.scope.project) ||
    !closed(value.probe, [
      'classification',
      'name',
      'family',
      'mechanism',
      'required_observation',
    ]) ||
    ![
      'main_thread',
      'worker_thread',
      'libuv_threadpool',
      'response_linked_async',
      'framework_phase',
      'evidence_gap',
      'low_overhead_runtime',
      'gc_pressure',
      'continuous_main_thread_source',
    ].includes(value.probe.family) ||
    typeof value.probe.name !== 'string' ||
    parseProbe(value.probe.name)?.family !== value.probe.family ||
    parseProbe(value.probe.name)?.mechanism !== value.probe.mechanism ||
    typeof value.probe.classification !== 'string' ||
    typeof value.probe.required_observation !== 'string' ||
    !closed(value.request, [
      'ordinal',
      'method',
      'route',
      'status',
      'outcome',
      'duration_ms',
      'source',
      'response_timing',
      'process_cpu',
      'worker_cpu',
      'native_activity',
      'continuous_source',
      'runtime_mechanisms',
      'runtime_route',
    ]) ||
    !Number.isSafeInteger(value.request.ordinal) ||
    !validRuntimeProjection(value.request.runtime_mechanisms, value.request.runtime_route) ||
    !closed(value.source_inventory, ['total', 'retained', 'complete']) ||
    value.source_inventory.total !== value.source_candidates?.length ||
    value.source_inventory.retained !== value.source_candidates?.length ||
    value.source_inventory.complete !== true ||
    !Array.isArray(value.source_candidates) ||
    value.source_candidates.length > BROWSER_PROBE_INSPECTION_LIMITS.candidates ||
    value.source_candidates.some((candidate) => !validCandidate(candidate)) ||
    (value.state !== 'observed' && value.source_candidates.length !== 0) ||
    typeof value.next_action !== 'string' ||
    !closed(value.authority, [
      'confidence',
      'source_causal',
      'edit_eligible',
      'correctness_required',
    ]) ||
    value.authority.confidence !== 'low' ||
    value.authority.source_causal !== false ||
    value.authority.edit_eligible !== false ||
    value.authority.correctness_required !== true ||
    value.provenance !== 'integrity_checked_durable_playwright_probe_projection' ||
    !Array.isArray(value.limitations) ||
    value.limitations.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error('browser probe inspection is invalid');
  }
  return value;
}

function validRuntimeProjection(mechanisms, route) {
  if (mechanisms === null && route === null) return true;
  if (mechanisms === null && route?.classification !== 'legacy_unavailable') return false;
  return (
    (mechanisms === null || typeof mechanisms === 'object') &&
    route !== null &&
    closed(route, [
      'classification',
      'dominant_mechanism',
      'observed_self_time_ms',
      'observed_runtime_sample_share',
      'next_probe',
      'confidence',
      'source',
      'causal_authority',
      'edit_authority',
    ]) &&
    typeof route.classification === 'string' &&
    (route.dominant_mechanism === null || typeof route.dominant_mechanism === 'string') &&
    (route.observed_self_time_ms === null || Number.isFinite(route.observed_self_time_ms)) &&
    (route.observed_runtime_sample_share === null ||
      Number.isFinite(route.observed_runtime_sample_share)) &&
    typeof route.next_probe === 'string' &&
    route.confidence === 'low' &&
    route.source === null &&
    route.causal_authority === 'none' &&
    route.edit_authority === 'none'
  );
}

function validCandidate(value) {
  return (
    closed(value, ['source', 'evidence_kind', 'mechanism', 'metric', 'relationship']) &&
    validSource(value.source) &&
    [
      'main_thread_cpu_sample',
      'continuous_main_thread_cpu_sample',
      'worker_cpu_sample',
      'async_resource_callsite',
    ].includes(value.evidence_kind) &&
    typeof value.mechanism === 'string' &&
    closed(value.metric, ['kind', 'value']) &&
    ['sampled_self_time_ms', 'preparation_overlap_ms'].includes(value.metric.kind) &&
    Number.isFinite(value.metric.value) &&
    value.metric.value >= 0 &&
    typeof value.relationship === 'string'
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
    (value.function === null || typeof value.function === 'string') &&
    typeof value.provenance === 'string'
  );
}

function nullableString(value) {
  return value === null || typeof value === 'string';
}

async function loadChainedProbeRoute(root, { recaptureId, captureId, requestedProbe }) {
  const path = resolve(root, '.codevetter/browser-probe-runs', recaptureId, 'receipt.json');
  if (repositoryRelative(root, path) === null) throw new Error('upstream probe receipt escapes');
  const before = await readBoundedReceipt(path, 'upstream probe receipt');
  const receiptSha256 = createReceiptHash(before);
  const { loadDurableProbeRun } = await import('./browser-probe-stability.mjs');
  const run = await loadDurableProbeRun(root, recaptureId);
  const after = await readBoundedReceipt(path, 'upstream probe receipt');
  if (createReceiptHash(after) !== receiptSha256) {
    throw new Error('upstream probe receipt changed during validation');
  }
  const expectedSourceProbe =
    requestedProbe === 'repeat_with_lower_overhead_cpu_measurement'
      ? 'inspect_main_thread_runtime'
      : requestedProbe === 'inspect_gc_pressure'
        ? 'repeat_with_lower_overhead_cpu_measurement'
        : requestedProbe === 'inspect_continuous_main_thread_source'
          ? 'repeat_with_lower_overhead_cpu_measurement'
          : null;
  if (
    run.recapture_id !== recaptureId ||
    run.source_capture.capture_id !== captureId ||
    expectedSourceProbe === null ||
    run.source_capture.probe !== expectedSourceProbe ||
    run.route.next_probe !== requestedProbe ||
    ![
      'repeat_with_lower_overhead_cpu_measurement',
      'inspect_gc_pressure',
      'inspect_continuous_main_thread_source',
    ].includes(requestedProbe)
  ) {
    throw new Error('upstream probe does not select the requested chained route');
  }
  return {
    recapture_id: recaptureId,
    receipt_sha256: receiptSha256,
    source_probe: run.source_capture.probe,
    classification: run.route.classification,
    next_probe: run.route.next_probe,
    server_request_ordinal: run.source_capture.server_request_ordinal,
    correctness: run.correctness,
  };
}

async function readBoundedReceipt(path, label) {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > PLAYWRIGHT_CAPTURE_LIMITS.receiptBytes
  ) {
    throw new Error(`${label} is unsafe`);
  }
  return readFile(path, 'utf8');
}

function createReceiptHash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validUpstreamRecapture(value, captureId, probe) {
  if (value === null) {
    return !['inspect_gc_pressure', 'inspect_continuous_main_thread_source'].includes(probe);
  }
  const expectedSourceProbe =
    probe === 'repeat_with_lower_overhead_cpu_measurement'
      ? 'inspect_main_thread_runtime'
      : probe === 'inspect_gc_pressure'
        ? 'repeat_with_lower_overhead_cpu_measurement'
        : probe === 'inspect_continuous_main_thread_source'
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
    assertSafeCaptureId(value.recapture_id) === true &&
    /^[0-9a-f]{64}$/.test(value.receipt_sha256) &&
    value.source_probe === expectedSourceProbe &&
    typeof value.classification === 'string' &&
    value.next_probe === probe &&
    Number.isSafeInteger(value.server_request_ordinal) &&
    value.server_request_ordinal > 0 &&
    ['passed', 'failed'].includes(value.correctness) &&
    typeof captureId === 'string'
  );
}

function assertInspectionInput(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['capture_id', 'probe', 'source_recapture_id'].includes(key))
  ) {
    throw new Error('browser probe inspection input is invalid');
  }
  return {
    capture_id: assertPlaywrightCaptureId(requiredString(value, 'capture_id')),
    probe: requiredString(value, 'probe'),
    source_recapture_id:
      value.source_recapture_id === undefined
        ? null
        : assertPlaywrightCaptureId(requiredString(value, 'source_recapture_id')),
  };
}

function assertSafeCaptureId(value) {
  try {
    assertPlaywrightCaptureId(value);
    return true;
  } catch {
    return false;
  }
}

function requiredString(value, key) {
  if (typeof value?.[key] !== 'string' || value[key].trim() === '') {
    throw new Error(`missing browser probe argument: ${key}`);
  }
  return value[key];
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
