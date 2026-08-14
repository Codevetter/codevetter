import { validServerRequestNativeActivitySummary } from './server-request-native-activity.mjs';

export const LOW_OVERHEAD_RUNTIME_SCHEMA_VERSION = 'runtime-node-low-overhead-corroboration/v3';
export const LOW_OVERHEAD_RUNTIME_PREVIOUS_SCHEMA_VERSION =
  'runtime-node-low-overhead-corroboration/v2';
export const LOW_OVERHEAD_RUNTIME_LEGACY_SCHEMA_VERSION =
  'runtime-node-low-overhead-corroboration/v1';
export const LOW_OVERHEAD_RUNTIME_POLICY = Object.freeze({ minimumActivityMs: 5 });

const THREADPOOL_KINDS = Object.freeze([
  'crypto',
  'zlib',
  'filesystem',
  'dns',
  'network',
  'node_api',
  'blob',
  'other',
]);
const V8_KINDS = Object.freeze(['gc', 'compilation']);
const MECHANISM_ORDER = Object.freeze([
  'gc',
  'compilation',
  ...THREADPOOL_KINDS.map((kind) => `libuv_${kind}`),
]);

export function createLowOverheadRuntimeCorroboration(request, { profilerDisabled = false } = {}) {
  const profilerAbsenceObserved = request?.cpu === null && request?.worker_cpu === null;
  const profiler = {
    main_thread: profilerDisabled && profilerAbsenceObserved ? 'disabled_by_probe' : 'unattested',
    workers: profilerDisabled && profilerAbsenceObserved ? 'disabled_by_probe' : 'unattested',
  };
  const precommit = compactPrecommit(request);
  const native = compactNative(request?.native_activity);
  const compatibleBoundary =
    precommit.boundary_ms !== null &&
    native.response_commit_offset_ms !== null &&
    Math.abs(precommit.boundary_ms - native.response_commit_offset_ms) <= 5;
  const complete =
    profiler.main_thread === 'disabled_by_probe' &&
    profiler.workers === 'disabled_by_probe' &&
    precommit.complete &&
    native.complete &&
    compatibleBoundary;
  const candidates = complete ? nativeMechanismCandidates(native) : [];
  const dominant = candidates.find(
    (candidate) => candidate.union_activity_ms >= LOW_OVERHEAD_RUNTIME_POLICY.minimumActivityMs
  );
  let state;
  if (!complete) state = 'incomplete';
  else if (precommit.main_thread_cpu_ms < LOW_OVERHEAD_RUNTIME_POLICY.minimumActivityMs) {
    state = 'insufficient';
  } else if (dominant) state = 'observed';
  else state = 'unresolved';

  return assertLowOverheadRuntimeCorroboration({
    schema_version: LOW_OVERHEAD_RUNTIME_SCHEMA_VERSION,
    state,
    profiler,
    precommit,
    native,
    route: routeFor(state, dominant),
    complete,
    provenance: 'profiler_disabled_process_thread_cpu_and_request_scoped_node_trace',
    limitations: [
      'Process and thread CPU counters are exact deltas; native mechanism values are elapsed union activity and are not CPU.',
      'Closed trace mechanisms do not cover every source of Node or V8 runtime work.',
      'Corroboration is local, low-confidence, source-null, non-causal, and edit-ineligible.',
    ],
  });
}

export function assertLowOverheadRuntimeCorroboration(value) {
  const current = value?.schema_version === LOW_OVERHEAD_RUNTIME_SCHEMA_VERSION;
  const hasIncompleteReason = [
    LOW_OVERHEAD_RUNTIME_SCHEMA_VERSION,
    LOW_OVERHEAD_RUNTIME_PREVIOUS_SCHEMA_VERSION,
  ].includes(value?.schema_version);
  if (
    !closed(value, [
      'schema_version',
      'state',
      'profiler',
      'precommit',
      'native',
      'route',
      'complete',
      'provenance',
      'limitations',
    ]) ||
    ![
      LOW_OVERHEAD_RUNTIME_SCHEMA_VERSION,
      LOW_OVERHEAD_RUNTIME_PREVIOUS_SCHEMA_VERSION,
      LOW_OVERHEAD_RUNTIME_LEGACY_SCHEMA_VERSION,
    ].includes(value.schema_version) ||
    !['observed', 'unresolved', 'insufficient', 'incomplete'].includes(value.state) ||
    !validProfiler(value.profiler) ||
    !validPrecommit(value.precommit) ||
    !validNative(value.native, hasIncompleteReason) ||
    !validRoute(value.route) ||
    typeof value.complete !== 'boolean' ||
    value.complete !==
      (value.profiler.main_thread === 'disabled_by_probe' &&
        value.profiler.workers === 'disabled_by_probe' &&
        value.precommit.complete &&
        value.native.complete &&
        value.precommit.boundary_ms !== null &&
        value.native.response_commit_offset_ms !== null &&
        Math.abs(value.precommit.boundary_ms - value.native.response_commit_offset_ms) <= 5) ||
    (current
      ? !validCurrentRouteForState(value.state, value.route)
      : (value.state === 'observed') !== (value.route.next_probe !== null)) ||
    (value.state === 'insufficient' &&
      value.precommit.main_thread_cpu_ms >= LOW_OVERHEAD_RUNTIME_POLICY.minimumActivityMs) ||
    value.provenance !== 'profiler_disabled_process_thread_cpu_and_request_scoped_node_trace' ||
    !Array.isArray(value.limitations) ||
    value.limitations.length !== 3 ||
    value.limitations.some((item) => typeof item !== 'string')
  ) {
    throw new Error('low-overhead runtime corroboration is invalid');
  }
  return value;
}

function compactPrecommit(request) {
  const timing = request?.response_timing;
  const cpu = request?.process_cpu;
  const partition = cpu?.thread_partition;
  const complete =
    timing?.complete === true &&
    finiteNonnegative(timing.commit_offset_ms) &&
    cpu?.complete === true &&
    cpu.overlapping_preparation_request_count === 0 &&
    finiteNonnegative(cpu.preparation_cpu_ms) &&
    partition?.state === 'observed' &&
    finiteNonnegative(partition.preparation_main_thread_cpu_ms) &&
    finiteNonnegative(partition.preparation_other_threads_cpu_ms) &&
    Math.abs(
      partition.preparation_main_thread_cpu_ms +
        partition.preparation_other_threads_cpu_ms -
        cpu.preparation_cpu_ms
    ) <= 0.01;
  return {
    boundary_ms: complete ? round3(timing.commit_offset_ms) : null,
    process_cpu_ms: complete ? round3(cpu.preparation_cpu_ms) : null,
    main_thread_cpu_ms: complete ? round3(partition.preparation_main_thread_cpu_ms) : null,
    other_threads_cpu_ms: complete ? round3(partition.preparation_other_threads_cpu_ms) : null,
    complete,
    provenance: 'response_commit_process_and_current_thread_cpu_deltas',
  };
}

function compactNative(value) {
  if (!value || !validServerRequestNativeActivitySummary(value)) {
    return emptyNative('native_summary_invalid');
  }
  const complete =
    value.complete === true &&
    ['observed', 'observed_zero'].includes(value.state) &&
    value.overlapping_dynamic_requests === 0 &&
    value.inventory.complete === true;
  return {
    state: complete ? value.state : 'incomplete',
    incomplete_reason: complete
      ? null
      : (value.incomplete_reason ?? 'legacy_native_evidence_incomplete'),
    response_commit_offset_ms: complete ? value.response_commit_offset_ms : null,
    threadpool: complete ? value.threadpool : emptyGroup(),
    v8: complete ? value.v8 : emptyGroup(),
    complete,
    provenance: 'bounded_request_scoped_node_trace_events',
  };
}

function emptyNative(incompleteReason) {
  return {
    state: 'incomplete',
    incomplete_reason: incompleteReason,
    response_commit_offset_ms: null,
    threadpool: emptyGroup(),
    v8: emptyGroup(),
    complete: false,
    provenance: 'bounded_request_scoped_node_trace_events',
  };
}

function emptyGroup() {
  return { total_count: 0, union_activity_ms: 0, mechanisms: [] };
}

function nativeMechanismCandidates(native) {
  return [
    ...native.v8.mechanisms.map((item) => ({
      mechanism: item.kind,
      count: item.count,
      union_activity_ms: item.union_activity_ms,
    })),
    ...native.threadpool.mechanisms.map((item) => ({
      mechanism: `libuv_${item.kind}`,
      count: item.count,
      union_activity_ms: item.union_activity_ms,
    })),
  ].toSorted(
    (left, right) =>
      right.union_activity_ms - left.union_activity_ms ||
      right.count - left.count ||
      MECHANISM_ORDER.indexOf(left.mechanism) - MECHANISM_ORDER.indexOf(right.mechanism)
  );
}

function routeFor(state, dominant) {
  const next = dominant
    ? dominant.mechanism === 'gc'
      ? 'inspect_gc_pressure'
      : dominant.mechanism === 'compilation'
        ? 'inspect_compilation_runtime'
        : `inspect_libuv_threadpool_${dominant.mechanism.slice('libuv_'.length)}`
    : state === 'unresolved'
      ? 'inspect_continuous_main_thread_source'
      : null;
  return {
    classification: dominant ? `low_overhead_${dominant.mechanism}` : `low_overhead_${state}`,
    dominant_mechanism: dominant?.mechanism ?? null,
    observed_union_activity_ms: dominant?.union_activity_ms ?? null,
    next_probe: ['observed', 'unresolved'].includes(state) ? next : null,
    confidence: 'low',
    source: null,
    causal_authority: 'none',
    edit_authority: 'none',
  };
}

function validCurrentRouteForState(state, route) {
  if (state === 'unresolved') {
    return route.next_probe === 'inspect_continuous_main_thread_source';
  }
  if (state === 'observed') {
    return (
      route.next_probe !== null && route.next_probe !== 'inspect_continuous_main_thread_source'
    );
  }
  return route.next_probe === null;
}

function validProfiler(value) {
  return (
    closed(value, ['main_thread', 'workers']) &&
    ['disabled_by_probe', 'unattested'].includes(value.main_thread) &&
    ['disabled_by_probe', 'unattested'].includes(value.workers) &&
    value.main_thread === value.workers
  );
}

function validPrecommit(value) {
  return (
    closed(value, [
      'boundary_ms',
      'process_cpu_ms',
      'main_thread_cpu_ms',
      'other_threads_cpu_ms',
      'complete',
      'provenance',
    ]) &&
    nullableNonnegative(value.boundary_ms) &&
    nullableNonnegative(value.process_cpu_ms) &&
    nullableNonnegative(value.main_thread_cpu_ms) &&
    nullableNonnegative(value.other_threads_cpu_ms) &&
    typeof value.complete === 'boolean' &&
    value.complete ===
      [
        value.boundary_ms,
        value.process_cpu_ms,
        value.main_thread_cpu_ms,
        value.other_threads_cpu_ms,
      ].every(Number.isFinite) &&
    (!value.complete ||
      Math.abs(value.main_thread_cpu_ms + value.other_threads_cpu_ms - value.process_cpu_ms) <=
        0.01) &&
    value.provenance === 'response_commit_process_and_current_thread_cpu_deltas'
  );
}

function validNative(value, current) {
  return (
    closed(value, [
      'state',
      ...(current ? ['incomplete_reason'] : []),
      'response_commit_offset_ms',
      'threadpool',
      'v8',
      'complete',
      'provenance',
    ]) &&
    ['observed', 'observed_zero', 'incomplete'].includes(value.state) &&
    (!current ||
      (value.state === 'incomplete'
        ? typeof value.incomplete_reason === 'string' && value.incomplete_reason.length > 0
        : value.incomplete_reason === null)) &&
    nullableNonnegative(value.response_commit_offset_ms) &&
    validGroup(value.threadpool, THREADPOOL_KINDS) &&
    validGroup(value.v8, V8_KINDS) &&
    typeof value.complete === 'boolean' &&
    value.complete === ['observed', 'observed_zero'].includes(value.state) &&
    value.provenance === 'bounded_request_scoped_node_trace_events'
  );
}

function validGroup(value, kinds) {
  return (
    closed(value, ['total_count', 'union_activity_ms', 'mechanisms']) &&
    safeCount(value.total_count) &&
    finiteNonnegative(value.union_activity_ms) &&
    Array.isArray(value.mechanisms) &&
    value.mechanisms.length <= kinds.length &&
    new Set(value.mechanisms.map((item) => item?.kind)).size === value.mechanisms.length &&
    value.mechanisms.every(
      (item) =>
        closed(item, ['kind', 'count', 'union_activity_ms']) &&
        kinds.includes(item.kind) &&
        safeCount(item.count) &&
        item.count > 0 &&
        finiteNonnegative(item.union_activity_ms)
    ) &&
    value.mechanisms.reduce((total, item) => total + item.count, 0) === value.total_count
  );
}

function validRoute(value) {
  return (
    closed(value, [
      'classification',
      'dominant_mechanism',
      'observed_union_activity_ms',
      'next_probe',
      'confidence',
      'source',
      'causal_authority',
      'edit_authority',
    ]) &&
    typeof value.classification === 'string' &&
    (value.dominant_mechanism === null || MECHANISM_ORDER.includes(value.dominant_mechanism)) &&
    nullableNonnegative(value.observed_union_activity_ms) &&
    (value.next_probe === null || typeof value.next_probe === 'string') &&
    value.confidence === 'low' &&
    value.source === null &&
    value.causal_authority === 'none' &&
    value.edit_authority === 'none'
  );
}

function nullableNonnegative(value) {
  return value === null || finiteNonnegative(value);
}

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
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

function round3(value) {
  return Math.round(value * 1_000) / 1_000;
}
