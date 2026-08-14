import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { LIMITS } from './contracts.mjs';

const EVENT_SCHEMA = 'codevetter-node-flow-events/v1';
const STREAM_EVENT_SCHEMA = 'codevetter-node-flow-event/v1';
const STREAM_META_SCHEMA = 'codevetter-node-flow-meta/v1';
const EVENT_KINDS = new Set([
  'async_resource',
  'database',
  'framework_phase',
  'http_client',
  'http_server',
]);
const SQLITE_OPERATIONS = new Set(['all', 'exec', 'get', 'run']);
const ASYNC_RESOURCE_KINDS = new Set([
  'connect',
  'dns',
  'filesystem',
  'scheduler',
  'timer',
  'worker_pool',
]);
const ASYNC_RESPONSE_DEPENDENCIES = new Set([
  'context_only',
  'response_completion_descendant',
  'unknown',
]);
const FRAMEWORK_PHASES = new Set([
  'client_component_loading',
  'component_tree',
  'route_resolution',
]);

export async function collectNodeFlowEvents(directory) {
  let names;
  try {
    names = (await readdir(directory)).filter((name) => /^flow-\d+\.json$/.test(name)).sort();
  } catch {
    return emptyFlowEvidence(['The Node flow artifact directory was unavailable.']);
  }
  const events = [];
  let bytes = 0;
  let truncated = names.length > LIMITS.flowFiles;
  for (const name of names.slice(0, LIMITS.flowFiles)) {
    const path = join(directory, name);
    let metadata;
    try {
      metadata = await stat(path);
    } catch {
      truncated = true;
      continue;
    }
    bytes += metadata.size;
    if (!metadata.isFile() || metadata.size > LIMITS.flowBytes || bytes > LIMITS.flowBytes) {
      truncated = true;
      continue;
    }
    try {
      const document = JSON.parse(await readFile(path, 'utf8'));
      if (document?.schema_version !== EVENT_SCHEMA || !Array.isArray(document.events)) {
        truncated = true;
        continue;
      }
      for (const event of document.events) {
        const normalized = normalizeEvent(event);
        if (normalized) events.push(normalized);
        if (events.length >= LIMITS.flows) {
          truncated = true;
          break;
        }
      }
    } catch {
      truncated = true;
    }
    if (events.length >= LIMITS.flows) break;
  }
  return {
    files: names.length,
    bytes,
    events: events
      .toSorted(
        (left, right) =>
          left.started_at_ms - right.started_at_ms || left.kind.localeCompare(right.kind)
      )
      .slice(0, LIMITS.flows),
    truncated,
    limitations:
      names.length === 0
        ? ['The diagnostic execution produced no supported Node flow events.']
        : [],
  };
}

export async function collectNodeFlowStreamEvents(directory, { correlationId } = {}) {
  if (typeof correlationId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(correlationId)) {
    throw new Error('Node flow correlation ID is invalid');
  }
  let names;
  try {
    names = (await readdir(directory)).filter((name) => /^flow-\d+\.ndjson$/.test(name)).sort();
  } catch {
    return emptyStreamEvidence('artifact_directory_unavailable');
  }
  const events = [];
  let bytes = 0;
  let truncated = names.length > LIMITS.flowFiles;
  for (const name of names.slice(0, LIMITS.flowFiles)) {
    const path = join(directory, name);
    let metadata;
    try {
      metadata = await stat(path);
    } catch {
      truncated = true;
      continue;
    }
    if (
      !metadata.isFile() ||
      metadata.size > LIMITS.flowBytes ||
      bytes + metadata.size > LIMITS.flowBytes
    ) {
      truncated = true;
      continue;
    }
    bytes += metadata.size;
    try {
      const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean);
      for (const line of lines) {
        let document;
        try {
          document = JSON.parse(line);
        } catch {
          truncated = true;
          continue;
        }
        if (document?.schema_version === STREAM_META_SCHEMA && document.truncated === true) {
          truncated = true;
          continue;
        }
        if (document?.schema_version !== STREAM_EVENT_SCHEMA) {
          truncated = true;
          continue;
        }
        const normalized = normalizeEvent(document.event, { correlationId });
        if (normalized) events.push(normalized);
        if (events.length >= LIMITS.flows) {
          truncated = true;
          break;
        }
      }
    } catch {
      truncated = true;
    }
    if (events.length >= LIMITS.flows) break;
  }
  const correlatedRoots = new Set(
    events
      .filter((event) => event.kind === 'http_server' && event.correlation_id === correlationId)
      .map((event) => event.event_id)
      .filter(Boolean)
  );
  const admitted = new Set(correlatedRoots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const event of events) {
      if (
        event.event_id &&
        event.parent_event_id &&
        admitted.has(event.parent_event_id) &&
        !admitted.has(event.event_id)
      ) {
        admitted.add(event.event_id);
        changed = true;
      }
    }
  }
  const scopedEvents = events.filter((event) => event.event_id && admitted.has(event.event_id));
  let correlationOrdinal = 0;
  const orderedScopedEvents = scopedEvents
    .toSorted(
      (left, right) =>
        left.started_at_ms - right.started_at_ms || left.event_id.localeCompare(right.event_id)
    )
    .map((event) =>
      event.kind === 'http_server'
        ? { ...event, correlation_ordinal: (correlationOrdinal += 1) }
        : event
    );
  return {
    schema_version: 'runtime-node-flow-stream/v1',
    state: names.length > 0 ? 'observed' : 'unavailable',
    files: names.length,
    bytes,
    events: orderedScopedEvents
      .toSorted(
        (left, right) =>
          left.started_at_ms - right.started_at_ms || left.kind.localeCompare(right.kind)
      )
      .slice(0, LIMITS.flows),
    complete: !truncated,
    truncated,
    reason: names.length > 0 ? null : 'no_stream_events',
  };
}

export function normalizeNodeFlowEvents(events, rootDurationMs) {
  const flows = [
    {
      id: 'flow-1',
      parent_flow_id: null,
      kind: 'workload',
      name: 'exact local workload',
      timing: {
        duration_ms: Number.isFinite(rootDurationMs) ? rootDurationMs : null,
        provenance: 'unprofiled_measurement_median',
      },
      evidence_ids: ['wall-time-distribution'],
      limitations: [
        'Child timings come from a separate diagnostic execution and are not additive to the root median.',
      ],
    },
  ];
  const relationships = [];
  const evidence = [];
  const normalizedEvents = (Array.isArray(events) ? events : [])
    .slice(0, LIMITS.flows - 1)
    .map((event) => ({ ...event, source: normalizeSource(event?.source) }));
  const eventToFlow = new Map();
  for (const [index, event] of normalizedEvents.entries()) {
    const id = `flow-${index + 2}`;
    const evidenceId = `flow-event-${index + 1}`;
    if (event.event_id) eventToFlow.set(event.event_id, id);
    flows.push({
      id,
      parent_flow_id: 'flow-1',
      kind: event.kind,
      name: flowName(event),
      timing: {
        duration_ms: event.duration_ms,
        started_at_ms: event.started_at_ms,
        provenance: 'node_diagnostic_flow_pass',
      },
      attributes: flowAttributes(event),
      evidence_ids: [evidenceId],
      limitations: [],
    });
    evidence.push({ id: evidenceId, ...event, provenance: 'node_diagnostic_preload' });
  }

  for (const [index, event] of normalizedEvents.entries()) {
    const parentFlowId = event.parent_event_id ? eventToFlow.get(event.parent_event_id) : null;
    if (parentFlowId) flows[index + 1].parent_flow_id = parentFlowId;
  }

  for (const client of flows.filter((flow) => flow.kind === 'http_client')) {
    const match = flows
      .filter(
        (flow) =>
          flow.kind === 'http_server' &&
          flow.attributes.method === client.attributes.method &&
          flow.attributes.route === client.attributes.route &&
          flow.timing.started_at_ms >= client.timing.started_at_ms &&
          flow.timing.started_at_ms <= client.timing.started_at_ms + client.timing.duration_ms + 5
      )
      .toSorted(
        (left, right) =>
          Math.abs(left.timing.started_at_ms - client.timing.started_at_ms) -
          Math.abs(right.timing.started_at_ms - client.timing.started_at_ms)
      )[0];
    if (!match) continue;
    if (match.parent_flow_id === 'flow-1') match.parent_flow_id = client.id;
    relationships.push({ kind: 'caused', from_flow_id: client.id, to_flow_id: match.id });
  }

  for (const flow of flows.slice(1)) {
    relationships.push({
      kind: 'contains',
      from_flow_id: flow.parent_flow_id ?? 'flow-1',
      to_flow_id: flow.id,
    });
  }
  addTimingBreakdowns(flows);

  const capturedKinds = [...new Set(normalizedEvents.map((event) => event.kind))].sort();
  return {
    root_flow_id: 'flow-1',
    flows,
    relationships,
    evidence,
    coverage: {
      captured_kinds: capturedKinds,
      child_flow_count: Math.max(0, flows.length - 1),
      operation_summary: summarizeOperations(normalizedEvents),
      root_accounting: 'unavailable_across_separate_executions',
      unaccounted_ms: null,
    },
  };
}

export function normalizeEvent(event, { correlationId = null } = {}) {
  if (!event || !EVENT_KINDS.has(event.kind)) return null;
  if (!Number.isFinite(event.started_at_ms) || !Number.isFinite(event.duration_ms)) return null;
  const common = {
    event_id: typeof event.id === 'string' ? event.id.slice(0, 80) : null,
    parent_event_id:
      typeof event.parent_event_id === 'string' ? event.parent_event_id.slice(0, 80) : null,
    kind: event.kind,
    started_at_ms: event.started_at_ms,
    duration_ms: Math.max(0, Math.round(event.duration_ms * 1000) / 1000),
    source: normalizeSource(event.source),
  };
  if (event.kind === 'database') {
    if (event.database !== 'node_sqlite' || !SQLITE_OPERATIONS.has(event.operation)) return null;
    return {
      ...common,
      database: 'node_sqlite',
      operation: event.operation,
      statement: normalizeSqlShape(event.statement),
      outcome: event.outcome === 'error' ? 'error' : 'ok',
    };
  }
  if (event.kind === 'framework_phase') {
    if (!FRAMEWORK_PHASES.has(event.phase)) return null;
    return {
      ...common,
      source: null,
      phase: event.phase,
      outcome: 'completed',
    };
  }
  if (event.kind === 'async_resource') {
    if (!ASYNC_RESOURCE_KINDS.has(event.resource_kind)) return null;
    if (!Number.isFinite(event.callback_active_ms) || event.callback_active_ms < 0) return null;
    const responseDependency = ASYNC_RESPONSE_DEPENDENCIES.has(event.response_dependency)
      ? event.response_dependency
      : 'unknown';
    if (
      event.response_end_after_callback_ms !== null &&
      event.response_end_after_callback_ms !== undefined &&
      (!Number.isFinite(event.response_end_after_callback_ms) ||
        event.response_end_after_callback_ms < 0)
    ) {
      return null;
    }
    return {
      ...common,
      resource_kind: event.resource_kind,
      callback_active_ms: Math.round(event.callback_active_ms * 1_000) / 1_000,
      response_dependency: responseDependency,
      response_end_after_callback_ms: Number.isFinite(event.response_end_after_callback_ms)
        ? Math.round(event.response_end_after_callback_ms * 1_000) / 1_000
        : null,
      outcome: 'callback_completed',
    };
  }
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(event.method)) {
    return null;
  }
  if (
    typeof event.route !== 'string' ||
    !event.route.startsWith('/') ||
    event.route.includes('?')
  ) {
    return null;
  }
  const responseTiming =
    event.kind === 'http_server'
      ? normalizeResponseTiming(event.response_timing, common.duration_ms)
      : null;
  if (event.kind === 'http_server' && event.response_timing !== undefined && !responseTiming) {
    return null;
  }
  const processCpu =
    event.kind === 'http_server'
      ? normalizeProcessCpu(event.process_cpu, responseTiming, common.duration_ms)
      : null;
  if (event.kind === 'http_server' && event.process_cpu !== undefined && !processCpu) return null;
  return {
    ...common,
    method: event.method,
    route: event.route.slice(0, 256),
    status:
      Number.isInteger(event.status) && event.status >= 100 && event.status <= 599
        ? event.status
        : null,
    outcome: event.outcome === 'error' ? 'error' : 'ok',
    ...(event.kind === 'http_server'
      ? {
          source: normalizeSource(event.source),
          response_timing: responseTiming ?? incompleteResponseTiming(common.duration_ms),
          process_cpu:
            processCpu ?? incompleteProcessCpu(responseTiming ?? incompleteResponseTiming()),
        }
      : {}),
    ...(event.kind === 'http_server' && event.correlation_id === correlationId
      ? {
          correlation_id: correlationId,
          correlation_ordinal:
            Number.isSafeInteger(event.correlation_ordinal) && event.correlation_ordinal > 0
              ? event.correlation_ordinal
              : null,
        }
      : {}),
  };
}

function normalizeProcessCpu(value, responseTiming, durationMs) {
  if (value === undefined) return incompleteProcessCpu(responseTiming);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.some(
      (key) =>
        ![
          'complete',
          'overlapping_request_count',
          'overlapping_preparation_request_count',
          'preparation_user_us',
          'preparation_system_us',
          'request_user_us',
          'request_system_us',
          'thread_cpu_supported',
          'thread_cpu_observer_effect',
          'preparation_thread_user_us',
          'preparation_thread_system_us',
          'request_thread_user_us',
          'request_thread_system_us',
        ].includes(key)
    ) ||
    typeof value.complete !== 'boolean' ||
    !Number.isSafeInteger(value.overlapping_request_count) ||
    value.overlapping_request_count < 0 ||
    value.overlapping_request_count > 128 ||
    !Number.isSafeInteger(value.overlapping_preparation_request_count) ||
    value.overlapping_preparation_request_count < 0 ||
    value.overlapping_preparation_request_count > value.overlapping_request_count
  ) {
    return null;
  }
  const raw = [
    value.preparation_user_us,
    value.preparation_system_us,
    value.request_user_us,
    value.request_system_us,
  ];
  const threadPartition = normalizeThreadPartition(value, null);
  if (threadPartition === null) return null;
  if (!value.complete) {
    if (raw.some((item) => item !== null && (!Number.isSafeInteger(item) || item < 0))) return null;
    return incompleteProcessCpu(
      responseTiming,
      value.overlapping_request_count,
      value.overlapping_preparation_request_count,
      threadPartition
    );
  }
  if (
    !responseTiming?.complete ||
    raw.some((item) => !Number.isSafeInteger(item) || item < 0) ||
    value.preparation_user_us > value.request_user_us ||
    value.preparation_system_us > value.request_system_us
  ) {
    return null;
  }
  const maximumCpuUs = Math.max(1_000_000, (durationMs + 1_000) * 256_000);
  if (value.request_user_us + value.request_system_us > maximumCpuUs) return null;
  const preparationUserMs = round3(value.preparation_user_us / 1_000);
  const preparationSystemMs = round3(value.preparation_system_us / 1_000);
  const requestUserMs = round3(value.request_user_us / 1_000);
  const requestSystemMs = round3(value.request_system_us / 1_000);
  const preparationCpuMs = round3(preparationUserMs + preparationSystemMs);
  const requestCpuMs = round3(requestUserMs + requestSystemMs);
  const reconciledThreadPartition = normalizeThreadPartition(value, {
    preparation_cpu_us: value.preparation_user_us + value.preparation_system_us,
    request_cpu_us: value.request_user_us + value.request_system_us,
    maximum_cpu_us: maximumCpuUs,
  });
  if (reconciledThreadPartition === null) return null;
  return {
    complete: true,
    overlapping_request_count: value.overlapping_request_count,
    overlapping_preparation_request_count: value.overlapping_preparation_request_count,
    preparation_user_ms: preparationUserMs,
    preparation_system_ms: preparationSystemMs,
    preparation_cpu_ms: preparationCpuMs,
    preparation_cpu_to_wall_ratio:
      responseTiming.preparation_ms > 0
        ? round4(preparationCpuMs / responseTiming.preparation_ms)
        : null,
    request_user_ms: requestUserMs,
    request_system_ms: requestSystemMs,
    request_cpu_ms: requestCpuMs,
    request_cpu_to_wall_ratio: durationMs > 0 ? round4(requestCpuMs / durationMs) : null,
    thread_partition: reconciledThreadPartition,
  };
}

function normalizeThreadPartition(value, processCpu) {
  const keys = [
    'preparation_thread_user_us',
    'preparation_thread_system_us',
    'request_thread_user_us',
    'request_thread_system_us',
  ];
  const present = ['thread_cpu_supported', 'thread_cpu_observer_effect', ...keys].some((key) =>
    Object.hasOwn(value, key)
  );
  if (!present) return emptyThreadPartition('unsupported');
  if (
    typeof value.thread_cpu_supported !== 'boolean' ||
    value.thread_cpu_observer_effect !==
      'process_counter_interval_encloses_current_thread_counter_interval'
  ) {
    return null;
  }
  const raw = keys.map((key) => value[key]);
  if (raw.some((item) => item !== null && (!Number.isSafeInteger(item) || item < 0))) return null;
  if (!value.thread_cpu_supported) {
    return raw.every((item) => item === null) ? emptyThreadPartition('unsupported') : null;
  }
  if (raw.some((item) => item === null) || processCpu === null) {
    return emptyThreadPartition('incomplete');
  }
  const preparationThreadUs = value.preparation_thread_user_us + value.preparation_thread_system_us;
  const requestThreadUs = value.request_thread_user_us + value.request_thread_system_us;
  if (
    value.preparation_thread_user_us > value.request_thread_user_us ||
    value.preparation_thread_system_us > value.request_thread_system_us ||
    requestThreadUs > processCpu.maximum_cpu_us
  ) {
    return emptyThreadPartition('inconsistent');
  }
  const toleranceUs = 1_000;
  if (
    preparationThreadUs > processCpu.preparation_cpu_us + toleranceUs ||
    requestThreadUs > processCpu.request_cpu_us + toleranceUs
  ) {
    return emptyThreadPartition('inconsistent');
  }
  return observedThreadPartition({
    preparationThreadUs: Math.min(preparationThreadUs, processCpu.preparation_cpu_us),
    preparationProcessUs: processCpu.preparation_cpu_us,
    requestThreadUs: Math.min(requestThreadUs, processCpu.request_cpu_us),
    requestProcessUs: processCpu.request_cpu_us,
  });
}

function observedThreadPartition({
  preparationThreadUs,
  preparationProcessUs,
  requestThreadUs,
  requestProcessUs,
}) {
  const preparationMainThreadCpuMs = round3(preparationThreadUs / 1_000);
  const preparationProcessCpuMs = round3(preparationProcessUs / 1_000);
  const requestMainThreadCpuMs = round3(requestThreadUs / 1_000);
  const requestProcessCpuMs = round3(requestProcessUs / 1_000);
  return {
    state: 'observed',
    preparation_main_thread_cpu_ms: preparationMainThreadCpuMs,
    preparation_other_threads_cpu_ms: round3(
      Math.max(0, preparationProcessCpuMs - preparationMainThreadCpuMs)
    ),
    preparation_main_thread_to_process_cpu_ratio:
      preparationProcessCpuMs > 0
        ? round4(preparationMainThreadCpuMs / preparationProcessCpuMs)
        : null,
    request_main_thread_cpu_ms: requestMainThreadCpuMs,
    request_other_threads_cpu_ms: round3(Math.max(0, requestProcessCpuMs - requestMainThreadCpuMs)),
    request_main_thread_to_process_cpu_ratio:
      requestProcessCpuMs > 0 ? round4(requestMainThreadCpuMs / requestProcessCpuMs) : null,
    observer_effect: 'nested_process_and_current_thread_counter_snapshots',
    provenance: 'process_and_current_thread_cpu_usage_deltas',
  };
}

function emptyThreadPartition(state) {
  return {
    state,
    preparation_main_thread_cpu_ms: null,
    preparation_other_threads_cpu_ms: null,
    preparation_main_thread_to_process_cpu_ratio: null,
    request_main_thread_cpu_ms: null,
    request_other_threads_cpu_ms: null,
    request_main_thread_to_process_cpu_ratio: null,
    observer_effect: 'nested_process_and_current_thread_counter_snapshots',
    provenance: 'process_and_current_thread_cpu_usage_deltas',
  };
}

function normalizeResponseTiming(value, durationMs) {
  if (value === undefined) return incompleteResponseTiming(durationMs);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.some(
      (key) =>
        !['commit_offset_ms', 'first_body_offset_ms', 'end_offset_ms', 'finish_offset_ms'].includes(
          key
        )
    )
  ) {
    return null;
  }
  const commit = optionalOffset(value.commit_offset_ms, durationMs);
  const firstBody = optionalOffset(value.first_body_offset_ms, durationMs);
  const end = optionalOffset(value.end_offset_ms, durationMs);
  const finish = optionalOffset(value.finish_offset_ms, durationMs);
  if ([commit, firstBody, end, finish].includes(false) || finish === null) return null;
  if (Math.abs(finish - durationMs) > 1) return null;
  if (
    (firstBody !== null && commit === null) ||
    (end !== null && commit === null) ||
    (firstBody !== null && firstBody < commit) ||
    (end !== null && end < commit) ||
    (firstBody !== null && end !== null && firstBody > end)
  ) {
    return null;
  }
  const complete = commit !== null && end !== null;
  return {
    complete,
    commit_offset_ms: commit,
    first_body_offset_ms: firstBody,
    end_offset_ms: end,
    finish_offset_ms: durationMs,
    preparation_ms: complete ? commit : null,
    emission_ms: complete ? round3(end - commit) : null,
    finish_tail_ms: complete ? round3(durationMs - end) : null,
  };
}

function optionalOffset(value, durationMs) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > durationMs + 1) return false;
  return Math.min(durationMs, round3(value));
}

function incompleteResponseTiming(durationMs) {
  return {
    complete: false,
    commit_offset_ms: null,
    first_body_offset_ms: null,
    end_offset_ms: null,
    finish_offset_ms: durationMs,
    preparation_ms: null,
    emission_ms: null,
    finish_tail_ms: null,
  };
}

function incompleteProcessCpu(
  responseTiming,
  overlappingRequestCount = 0,
  overlappingPreparationRequestCount = 0,
  threadPartition = emptyThreadPartition('unsupported')
) {
  return {
    complete: false,
    overlapping_request_count: overlappingRequestCount,
    overlapping_preparation_request_count: overlappingPreparationRequestCount,
    preparation_user_ms: null,
    preparation_system_ms: null,
    preparation_cpu_ms: null,
    preparation_cpu_to_wall_ratio: null,
    request_user_ms: null,
    request_system_ms: null,
    request_cpu_ms: null,
    request_cpu_to_wall_ratio: null,
    thread_partition:
      threadPartition.state === 'unsupported'
        ? threadPartition
        : emptyThreadPartition('incomplete'),
  };
}

function round3(value) {
  return Math.round(value * 1_000) / 1_000;
}

function round4(value) {
  return Math.round(value * 10_000) / 10_000;
}

function emptyStreamEvidence(reason) {
  return {
    schema_version: 'runtime-node-flow-stream/v1',
    state: 'unavailable',
    files: 0,
    bytes: 0,
    events: [],
    complete: false,
    truncated: false,
    reason,
  };
}

export function normalizeSqlShape(value) {
  if (typeof value !== 'string') return '<unknown>';
  return (
    value
      .replace(/--[^\r\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\b[xX]'(?:''|[^'])*'/g, '?')
      .replace(/'(?:''|[^'])*'/g, '?')
      .replace(/\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b/gi, '?')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 256) || '<empty>'
  );
}

function flowName(event) {
  if (event.kind === 'framework_phase') {
    return `${event.phase} framework phase`;
  }
  if (event.kind === 'async_resource') {
    return `${event.resource_kind} first callback`;
  }
  if (event.kind === 'database') {
    return `SQLite ${event.operation.toUpperCase()} ${event.statement}`;
  }
  return `${event.method} ${event.route}`;
}

function flowAttributes(event) {
  if (event.kind === 'framework_phase') {
    return { phase: event.phase, outcome: event.outcome };
  }
  if (event.kind === 'async_resource') {
    return {
      resource_kind: event.resource_kind,
      wait_ms: event.duration_ms,
      callback_active_ms: event.callback_active_ms,
      response_dependency: event.response_dependency,
      response_end_after_callback_ms: event.response_end_after_callback_ms,
      outcome: event.outcome,
      source: event.source,
    };
  }
  if (event.kind === 'database') {
    return {
      database: event.database,
      operation: event.operation,
      statement: event.statement,
      outcome: event.outcome,
      source: event.source,
    };
  }
  return {
    method: event.method,
    route: event.route,
    status: event.status,
    outcome: event.outcome,
    source: event.source,
    ...(event.kind === 'http_server'
      ? { response_timing: event.response_timing, process_cpu: event.process_cpu }
      : {}),
  };
}

function normalizeSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (
    typeof value.file !== 'string' ||
    value.file.length === 0 ||
    value.file.length > 512 ||
    value.file.startsWith('/') ||
    value.file.includes('\\') ||
    value.file.split('/').includes('..') ||
    !Number.isInteger(value.line) ||
    value.line < 1
  ) {
    return null;
  }
  return {
    file: value.file,
    line: value.line,
    function:
      typeof value.function === 'string' && value.function.length > 0
        ? value.function.slice(0, 200)
        : null,
    provenance: ['node_async_creator_callsite', 'node_diagnostic_callsite'].includes(
      value.provenance
    )
      ? value.provenance
      : 'node_diagnostic_callsite',
  };
}

function summarizeOperations(events) {
  const summaries = new Map();
  for (const event of events) {
    const key =
      event.kind === 'database'
        ? `${event.kind}:${event.operation}`
        : event.kind === 'framework_phase'
          ? `${event.kind}:${event.phase}`
          : event.kind === 'async_resource'
            ? `${event.kind}:${event.resource_kind}`
            : event.kind;
    const summary = summaries.get(key) ?? {
      kind: event.kind,
      ...(event.operation ? { operation: event.operation } : {}),
      ...(event.resource_kind ? { resource_kind: event.resource_kind } : {}),
      ...(event.phase ? { phase: event.phase } : {}),
      count: 0,
      total_duration_ms: 0,
      max_duration_ms: 0,
    };
    summary.count += 1;
    summary.total_duration_ms += event.duration_ms;
    summary.max_duration_ms = Math.max(summary.max_duration_ms, event.duration_ms);
    summaries.set(key, summary);
  }
  return [...summaries.values()]
    .map((summary) => ({
      ...summary,
      total_duration_ms: roundMilliseconds(summary.total_duration_ms),
      max_duration_ms: roundMilliseconds(summary.max_duration_ms),
    }))
    .toSorted((left, right) => right.total_duration_ms - left.total_duration_ms);
}

function addTimingBreakdowns(flows) {
  for (const parent of flows.slice(1)) {
    const children = flows.filter(
      (flow) =>
        flow.parent_flow_id === parent.id &&
        flow.timing.provenance === parent.timing.provenance &&
        Number.isFinite(flow.timing.started_at_ms) &&
        Number.isFinite(flow.timing.duration_ms)
    );
    if (children.length === 0) continue;
    const parentStart = parent.timing.started_at_ms;
    const parentEnd = parentStart + parent.timing.duration_ms;
    const intervals = children
      .map((child) => [
        Math.max(parentStart, child.timing.started_at_ms),
        Math.min(parentEnd, child.timing.started_at_ms + child.timing.duration_ms),
      ])
      .filter(([start, end]) => end >= start)
      .toSorted((left, right) => left[0] - right[0]);
    let covered = 0;
    let current = null;
    for (const interval of intervals) {
      if (!current || interval[0] > current[1]) {
        if (current) covered += current[1] - current[0];
        current = [...interval];
      } else {
        current[1] = Math.max(current[1], interval[1]);
      }
    }
    if (current) covered += current[1] - current[0];
    parent.timing.accounting = {
      method: 'same_execution_child_interval_union',
      accounted_child_ms: roundMilliseconds(covered),
      unaccounted_ms: roundMilliseconds(Math.max(0, parent.timing.duration_ms - covered)),
    };
  }
}

function roundMilliseconds(value) {
  return Math.round(value * 1000) / 1000;
}

function emptyFlowEvidence(limitations = []) {
  return { files: 0, bytes: 0, events: [], truncated: false, limitations };
}
