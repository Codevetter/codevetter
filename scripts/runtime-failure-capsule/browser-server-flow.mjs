import { validServerRequestWorkerCpuSummary } from './server-request-worker-cpu.mjs';
import { validServerRequestNativeActivitySummary } from './server-request-native-activity.mjs';
import { validServerRequestGcPressureSummary } from './server-request-gc-pressure.mjs';
import { assertServerRequestCpuSummary } from './server-request-cpu.mjs';
import { assertContinuousSourceSummary } from './server-request-continuous-source.mjs';

export const BROWSER_SERVER_FLOW_SCHEMA_VERSION = 'runtime-browser-server-flow/v16';
export const BROWSER_SERVER_FLOW_LEGACY_SCHEMA_VERSIONS = Object.freeze([
  'runtime-browser-server-flow/v13',
  'runtime-browser-server-flow/v14',
  'runtime-browser-server-flow/v15',
]);
export const BROWSER_SERVER_FLOW_LIMITS = Object.freeze({
  requests: 16,
  childrenPerRequest: 8,
  asyncResourcesPerRequest: 8,
  frameworkPhasesPerRequest: 8,
  expandedAsyncResourcesPerRequest: 32,
  expandedFrameworkPhasesPerRequest: 32,
});
export const BROWSER_SERVER_FLOW_PRESENTATION_PROFILES = Object.freeze({
  ordinary: 'ordinary',
  expandedAsyncFramework: 'expanded_async_framework',
  runtimeMechanisms: 'runtime_mechanisms',
  profilerDisabledRuntime: 'profiler_disabled_runtime',
  gcPressureRuntime: 'gc_pressure_runtime',
  continuousSourceRuntime: 'continuous_source_runtime',
});

const UNAVAILABLE_REASONS = new Set([
  'artifact_directory_unavailable',
  'capture_identity_unavailable',
  'environment_blocked',
  'existing_listener_unowned',
  'frontend_only_vite',
  'go_instrumentation_not_authorized',
  'no_stream_events',
  'not_supplied',
  'runtime_not_owned',
  'unsupported_runtime',
]);

export function createBrowserServerFlowSummary({
  nodeFlow = null,
  resources = [],
  actions = null,
  preflight = null,
  preflightRoute = null,
  unavailableReason = 'not_supplied',
  presentationProfile = BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.ordinary,
} = {}) {
  const presentationLimits = limitsForPresentationProfile(presentationProfile);
  if (!nodeFlow || nodeFlow.state !== 'observed') {
    return unavailableBrowserServerFlow(nodeFlow?.reason ?? unavailableReason);
  }
  const events = Array.isArray(nodeFlow.events) ? nodeFlow.events : [];
  const serverEvents = events.filter(
    (event) => event.kind === 'http_server' && safeHttpEvent(event)
  );
  const childrenByParent = new Map();
  const asyncByParent = new Map();
  const phasesByParent = new Map();
  for (const event of events) {
    if (event.parent_event_id && event.kind === 'framework_phase' && safeFrameworkPhase(event)) {
      const phases = phasesByParent.get(event.parent_event_id) ?? [];
      phases.push(event);
      phasesByParent.set(event.parent_event_id, phases);
      continue;
    }
    if (event.parent_event_id && event.kind === 'async_resource' && safeAsyncEvent(event)) {
      const resources = asyncByParent.get(event.parent_event_id) ?? [];
      resources.push(event);
      asyncByParent.set(event.parent_event_id, resources);
      continue;
    }
    if (
      !event.parent_event_id ||
      !['database', 'http_client'].includes(event.kind) ||
      !safeChildEvent(event)
    ) {
      continue;
    }
    const children = childrenByParent.get(event.parent_event_id) ?? [];
    children.push(event);
    childrenByParent.set(event.parent_event_id, children);
  }
  const localResources = resources.filter(
    (resource) =>
      resource?.kind === 'http_client' &&
      ['loopback', 'relative'].includes(resource.attributes?.network_scope) &&
      safeMethodRoute(resource.attributes)
  );
  const browserCounts = identityCounts(localResources, (resource) => resource.attributes);
  const serverCounts = identityCounts(serverEvents, (event) => event);
  const retainedEvents = representativeServerRequests(serverEvents);
  const retainedRequests = retainedEvents.map((event) => {
    const key = requestKey(event);
    const unique = browserCounts.get(key) === 1 && serverCounts.get(key) === 1;
    const resource = unique
      ? localResources.find((candidate) => requestKey(candidate.attributes) === key)
      : null;
    const associatedAction = resource ? mostSpecificAction(actions, resource.started_at_ms) : null;
    const allChildren = (childrenByParent.get(event.event_id) ?? []).toSorted(
      (left, right) =>
        right.duration_ms - left.duration_ms || left.started_at_ms - right.started_at_ms
    );
    const children = allChildren
      .slice(0, BROWSER_SERVER_FLOW_LIMITS.childrenPerRequest)
      .map(compactChild);
    const allAsyncResources = (asyncByParent.get(event.event_id) ?? []).toSorted(
      (left, right) =>
        responseDependencyRank(left.response_dependency) -
          responseDependencyRank(right.response_dependency) ||
        right.duration_ms - left.duration_ms ||
        left.started_at_ms - right.started_at_ms
    );
    const asyncResources = allAsyncResources
      .slice(0, presentationLimits.asyncResourcesPerRequest)
      .map((resource) => compactAsyncResource(event, resource));
    const allFrameworkPhases = (phasesByParent.get(event.event_id) ?? []).toSorted(
      (left, right) =>
        left.started_at_ms - right.started_at_ms ||
        right.duration_ms - left.duration_ms ||
        left.phase.localeCompare(right.phase)
    );
    const frameworkPhases = representativeFrameworkPhases(
      allFrameworkPhases,
      presentationLimits.frameworkPhasesPerRequest
    ).map((phase) => compactFrameworkPhase(event, phase));
    return {
      ordinal: event.correlation_ordinal,
      method: event.method,
      route: event.route,
      status: event.status,
      outcome: event.outcome,
      duration_ms: round3(event.duration_ms),
      source: event.source ?? null,
      browser_join: {
        state: unique ? 'joined_unique_identity' : browserCounts.has(key) ? 'ambiguous' : 'absent',
        action_ordinal: associatedAction?.ordinal ?? null,
        transfer_bytes:
          unique && Number.isSafeInteger(resource?.attributes?.transfer_bytes)
            ? resource.attributes.transfer_bytes
            : null,
      },
      child_inventory: {
        total: allChildren.length,
        retained: children.length,
        complete: allChildren.length === children.length,
      },
      children,
      accounting: childAccounting(event, allChildren),
      response_timing: event.response_timing ?? incompleteResponseTiming(event.duration_ms),
      process_cpu: event.process_cpu ?? incompleteProcessCpu(),
      worker_cpu: event.worker_cpu ?? null,
      native_activity: event.native_activity ?? null,
      gc_pressure: event.gc_pressure ?? null,
      continuous_source: event.continuous_source ?? null,
      async_resource_inventory: {
        total: allAsyncResources.length,
        retained: asyncResources.length,
        complete: nodeFlow.complete === true && allAsyncResources.length === asyncResources.length,
      },
      async_resources: asyncResources,
      async_overlap: {
        covered_delay_ms: intervalCoverage(event, allAsyncResources),
        response_completion_delay_ms: intervalCoverage(
          event,
          allAsyncResources.filter(
            (resource) => resource.response_dependency === 'response_completion_descendant'
          )
        ),
        preparation_response_completion_delay_ms: responsePreparationCoverage(
          event,
          allAsyncResources.filter(
            (resource) => resource.response_dependency === 'response_completion_descendant'
          )
        ),
      },
      framework_phase_inventory: {
        total: allFrameworkPhases.length,
        retained: frameworkPhases.length,
        complete:
          nodeFlow.complete === true && allFrameworkPhases.length === frameworkPhases.length,
      },
      framework_phases: frameworkPhases,
      framework_phase_overlap_ms: intervalCoverage(event, allFrameworkPhases),
      framework_phase_preparation_overlap_ms: responsePreparationCoverage(
        event,
        allFrameworkPhases
      ),
      cpu: event.cpu ?? null,
    };
  });
  const inventoryComplete =
    nodeFlow.complete === true && retainedEvents.length === serverEvents.length;
  const preflightComparison = comparePreflightRequests({
    preflight,
    preflightRoute,
    requests: retainedRequests,
  });
  const summary = {
    schema_version: BROWSER_SERVER_FLOW_SCHEMA_VERSION,
    state: serverEvents.length > 0 ? 'observed' : 'unavailable',
    reason: serverEvents.length > 0 ? null : 'no_stream_events',
    inventory: {
      total_server_requests: serverEvents.length,
      retained_server_requests: retainedRequests.length,
      complete: inventoryComplete,
      joined_unique_requests: retainedRequests.filter(
        (request) => request.browser_join.state === 'joined_unique_identity'
      ).length,
      ambiguous_requests: retainedRequests.filter(
        (request) => request.browser_join.state === 'ambiguous'
      ).length,
    },
    requests: retainedRequests,
    preflight_comparison: preflightComparison,
    provenance: 'owned_node_capture_header_and_async_context',
    limitations: [
      'The capture header scopes requests to the primary local browser pass; it does not establish production equivalence.',
      'Browser/server joining uses unique method and normalized route identity because their clocks are not assumed comparable.',
      'Action association is based on a browser resource start inside a retained action window and does not establish initiation or causality.',
      'Request and child durations are observed wall time; accounting does not assign exclusive handler CPU.',
      'Response timing uses server API call boundaries; it is not browser or network TTFB, byte delivery, or exclusive application work.',
      'Request CPU samples are observer-affected and source candidates require isolated repository-contained frames.',
      'Worker CPU covers only bounded public Worker instances observed by the owned preload; it excludes child processes, native threads, libuv work, and unobservable Workers.',
      'Native trace intervals show bounded V8 or libuv activity overlap; they are not exclusive CPU time, CPU attribution, or proof of causality.',
      'Async resource delay is context and temporal-overlap evidence; it does not prove that the response awaited the resource or that it was on the critical path.',
      'A response-completion descendant proves bounded async scheduling lineage to response.end, not JavaScript await syntax, exclusive blocking time, or a complete critical path.',
      'Framework phases are closed Next-emitted diagnostic intervals; they can include framework and application work and are not exclusive or source-causal.',
      'Next preflight wall time and correlated server-request wall time use different observers; their coarse classification does not identify compilation, exclusive work, or source cause.',
      ...(inventoryComplete
        ? []
        : ['The bounded server request or event inventory is incomplete.']),
    ],
  };
  assertBrowserServerFlowSummary(summary);
  return summary;
}

export function unavailableBrowserServerFlow(reason = 'not_supplied') {
  const safeReason = UNAVAILABLE_REASONS.has(reason) ? reason : 'unsupported_runtime';
  const value = {
    schema_version: BROWSER_SERVER_FLOW_SCHEMA_VERSION,
    state: 'unavailable',
    reason: safeReason,
    inventory: {
      total_server_requests: 0,
      retained_server_requests: 0,
      complete: false,
      joined_unique_requests: 0,
      ambiguous_requests: 0,
    },
    requests: [],
    preflight_comparison: unavailablePreflightComparison(),
    provenance: 'owned_node_capture_header_and_async_context',
    limitations: [availabilityLimitation(safeReason)],
  };
  assertBrowserServerFlowSummary(value);
  return value;
}

export function assertBrowserServerFlowSummary(value) {
  if (
    !closedObject(value, [
      'schema_version',
      'state',
      'reason',
      'inventory',
      'requests',
      'preflight_comparison',
      'provenance',
      'limitations',
    ]) ||
    ![BROWSER_SERVER_FLOW_SCHEMA_VERSION, ...BROWSER_SERVER_FLOW_LEGACY_SCHEMA_VERSIONS].includes(
      value.schema_version
    ) ||
    !['observed', 'unavailable'].includes(value.state) ||
    (value.reason !== null && !UNAVAILABLE_REASONS.has(value.reason)) ||
    !closedObject(value.inventory, [
      'total_server_requests',
      'retained_server_requests',
      'complete',
      'joined_unique_requests',
      'ambiguous_requests',
    ]) ||
    !Number.isSafeInteger(value.inventory.total_server_requests) ||
    !Number.isSafeInteger(value.inventory.retained_server_requests) ||
    value.inventory.retained_server_requests > BROWSER_SERVER_FLOW_LIMITS.requests ||
    value.inventory.total_server_requests < value.inventory.retained_server_requests ||
    typeof value.inventory.complete !== 'boolean' ||
    !Number.isSafeInteger(value.inventory.joined_unique_requests) ||
    !Number.isSafeInteger(value.inventory.ambiguous_requests) ||
    !Array.isArray(value.requests) ||
    value.requests.length !== value.inventory.retained_server_requests ||
    value.requests.some((request) => !validRequest(request, value.schema_version)) ||
    !validPreflightComparison(value.preflight_comparison) ||
    value.inventory.joined_unique_requests !==
      value.requests.filter((request) => request.browser_join.state === 'joined_unique_identity')
        .length ||
    value.inventory.ambiguous_requests !==
      value.requests.filter((request) => request.browser_join.state === 'ambiguous').length ||
    (value.state === 'observed') !== (value.reason === null) ||
    (value.state === 'unavailable' && value.requests.length !== 0) ||
    value.provenance !== 'owned_node_capture_header_and_async_context' ||
    !Array.isArray(value.limitations) ||
    value.limitations.some((limitation) => typeof limitation !== 'string')
  ) {
    throw new Error('browser server-flow summary is invalid');
  }
  return value;
}

function comparePreflightRequests({ preflight, preflightRoute, requests }) {
  const normalized = normalizePreflight(preflight);
  const routeValid = safeMethodRoute({ method: 'GET', route: preflightRoute });
  if (!normalized) return unavailablePreflightComparison();
  const [first, repeat] = normalized.requests;
  const compatibleStatus = first.status_class === repeat.status_class ? first.status_class : null;
  const base = {
    classification: 'insufficient_evidence',
    first_duration_ms: first.duration_ms,
    repeat_duration_ms: repeat.duration_ms,
    browser_duration_ms: null,
    status_class: compatibleStatus,
    provenance: 'owned_next_preflight_wall_and_correlated_server_wall',
  };
  if (!routeValid || !compatibleStatus) return base;
  const matches = requests.filter(
    (request) =>
      request.method === 'GET' &&
      request.route === preflightRoute &&
      request.browser_join.state === 'joined_unique_identity' &&
      statusClass(request.status) === compatibleStatus
  );
  if (matches.length !== 1) return base;
  const browserDuration = matches[0].duration_ms;
  const comparison = { ...base, browser_duration_ms: browserDuration };
  const material = 100;
  const ratio = 2;
  if (browserDuration >= material && browserDuration >= repeat.duration_ms * ratio) {
    return { ...comparison, classification: 'browser_request_outlier' };
  }
  if (first.duration_ms >= material && first.duration_ms >= repeat.duration_ms * ratio) {
    return { ...comparison, classification: 'first_preflight_outlier' };
  }
  const repeatBrowserRatio =
    Math.max(repeat.duration_ms, browserDuration) /
    Math.max(1, Math.min(repeat.duration_ms, browserDuration));
  if (repeat.duration_ms >= material && browserDuration >= material && repeatBrowserRatio < ratio) {
    return { ...comparison, classification: 'repeated_high_latency' };
  }
  if (repeatBrowserRatio >= ratio && repeat.duration_ms >= material) return comparison;
  return { ...comparison, classification: 'no_material_outlier' };
}

function normalizePreflight(value) {
  if (
    !closedObject(value, ['state', 'inventory', 'requests']) ||
    value.state !== 'completed' ||
    !closedObject(value.inventory, ['total', 'retained', 'complete']) ||
    value.inventory.total !== 2 ||
    value.inventory.retained !== 2 ||
    value.inventory.complete !== true ||
    !Array.isArray(value.requests) ||
    value.requests.length !== 2
  ) {
    return null;
  }
  const requests = value.requests.map((request, index) => {
    if (
      !closedObject(request, ['ordinal', 'duration_ms', 'status_class']) ||
      request.ordinal !== index + 1 ||
      !Number.isInteger(request.duration_ms) ||
      request.duration_ms < 0 ||
      request.duration_ms > 10_000 ||
      !['1xx', '2xx', '3xx', '4xx', '5xx'].includes(request.status_class)
    ) {
      return null;
    }
    return { ...request };
  });
  return requests.includes(null) ? null : { requests };
}

function unavailablePreflightComparison() {
  return {
    classification: 'insufficient_evidence',
    first_duration_ms: null,
    repeat_duration_ms: null,
    browser_duration_ms: null,
    status_class: null,
    provenance: 'owned_next_preflight_wall_and_correlated_server_wall',
  };
}

function validPreflightComparison(value) {
  return (
    closedObject(value, [
      'classification',
      'first_duration_ms',
      'repeat_duration_ms',
      'browser_duration_ms',
      'status_class',
      'provenance',
    ]) &&
    [
      'browser_request_outlier',
      'first_preflight_outlier',
      'insufficient_evidence',
      'no_material_outlier',
      'repeated_high_latency',
    ].includes(value.classification) &&
    [value.first_duration_ms, value.repeat_duration_ms, value.browser_duration_ms].every(
      (duration) => duration === null || (Number.isFinite(duration) && duration >= 0)
    ) &&
    (value.status_class === null ||
      ['1xx', '2xx', '3xx', '4xx', '5xx'].includes(value.status_class)) &&
    value.provenance === 'owned_next_preflight_wall_and_correlated_server_wall' &&
    (value.classification === 'insufficient_evidence' ||
      (value.first_duration_ms !== null &&
        value.repeat_duration_ms !== null &&
        value.browser_duration_ms !== null &&
        value.status_class !== null))
  );
}

function statusClass(status) {
  return Number.isSafeInteger(status) && status >= 100 && status <= 599
    ? `${Math.floor(status / 100)}xx`
    : null;
}

function representativeServerRequests(events) {
  return events
    .toSorted(
      (left, right) =>
        Number(!isDynamicRoute(left.route)) - Number(!isDynamicRoute(right.route)) ||
        right.duration_ms - left.duration_ms ||
        left.correlation_ordinal - right.correlation_ordinal
    )
    .slice(0, BROWSER_SERVER_FLOW_LIMITS.requests)
    .toSorted((left, right) => left.correlation_ordinal - right.correlation_ordinal);
}

function isDynamicRoute(route) {
  return route === '/api' || route.startsWith('/api/') || !/\.[a-z0-9]{1,8}$/i.test(route);
}

function identityCounts(values, attributes) {
  const counts = new Map();
  for (const value of values) {
    const key = requestKey(attributes(value));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function requestKey(value) {
  return `${value.method} ${value.route}`;
}

function mostSpecificAction(actions, startedAtMs) {
  const candidates = [...(actions?.sequence ?? []), ...(actions?.slowest ?? [])]
    .filter(
      (action) =>
        Number.isFinite(action.started_at_ms) &&
        Number.isFinite(action.duration_ms) &&
        startedAtMs >= action.started_at_ms &&
        startedAtMs <= action.started_at_ms + action.duration_ms
    )
    .filter(
      (action, index, values) =>
        values.findIndex((candidate) => candidate.ordinal === action.ordinal) === index
    );
  return candidates.toSorted(
    (left, right) =>
      left.duration_ms - right.duration_ms || right.started_at_ms - left.started_at_ms
  )[0];
}

function compactChild(event) {
  if (event.kind === 'database') {
    return {
      kind: 'database',
      database: event.database,
      operation: event.operation,
      statement: event.statement,
      outcome: event.outcome,
      duration_ms: round3(event.duration_ms),
      source: event.source ?? null,
    };
  }
  return {
    kind: 'http_client',
    method: event.method,
    route: event.route,
    status: event.status,
    outcome: event.outcome,
    duration_ms: round3(event.duration_ms),
    source: event.source ?? null,
  };
}

function compactAsyncResource(request, event) {
  const startOffsetMs = round3(Math.max(0, event.started_at_ms - request.started_at_ms));
  const preparationMs = request.response_timing?.complete
    ? request.response_timing.preparation_ms
    : 0;
  return {
    resource_kind: event.resource_kind,
    start_offset_ms: startOffsetMs,
    wait_ms: round3(event.duration_ms),
    preparation_overlap_ms: round3(
      Math.max(0, Math.min(preparationMs, startOffsetMs + event.duration_ms) - startOffsetMs)
    ),
    callback_active_ms: round3(event.callback_active_ms),
    response_dependency: event.response_dependency,
    response_end_after_callback_ms: Number.isFinite(event.response_end_after_callback_ms)
      ? round3(event.response_end_after_callback_ms)
      : null,
    source: event.source ?? null,
  };
}

function representativeFrameworkPhases(
  phases,
  limit = BROWSER_SERVER_FLOW_LIMITS.frameworkPhasesPerRequest
) {
  if (phases.length <= limit) return phases;
  const earliest = phases.slice(0, Math.ceil(limit / 2));
  const slowest = phases
    .toSorted(
      (left, right) =>
        right.duration_ms - left.duration_ms ||
        left.started_at_ms - right.started_at_ms ||
        left.phase.localeCompare(right.phase)
    )
    .slice(0, limit);
  return [...new Map([...earliest, ...slowest].map((phase) => [phase.event_id, phase])).values()]
    .slice(0, limit)
    .toSorted(
      (left, right) =>
        left.started_at_ms - right.started_at_ms ||
        right.duration_ms - left.duration_ms ||
        left.phase.localeCompare(right.phase)
    );
}

function limitsForPresentationProfile(profile) {
  if (
    profile === BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.ordinary ||
    profile === BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.runtimeMechanisms ||
    profile === BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.profilerDisabledRuntime ||
    profile === BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.gcPressureRuntime ||
    profile === BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.continuousSourceRuntime
  ) {
    return {
      asyncResourcesPerRequest: BROWSER_SERVER_FLOW_LIMITS.asyncResourcesPerRequest,
      frameworkPhasesPerRequest: BROWSER_SERVER_FLOW_LIMITS.frameworkPhasesPerRequest,
    };
  }
  if (profile === BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.expandedAsyncFramework) {
    return {
      asyncResourcesPerRequest: BROWSER_SERVER_FLOW_LIMITS.expandedAsyncResourcesPerRequest,
      frameworkPhasesPerRequest: BROWSER_SERVER_FLOW_LIMITS.expandedFrameworkPhasesPerRequest,
    };
  }
  throw new Error('browser server presentation profile is invalid');
}

function compactFrameworkPhase(request, phase) {
  return {
    phase: phase.phase,
    start_offset_ms: round3(Math.max(0, phase.started_at_ms - request.started_at_ms)),
    duration_ms: round3(phase.duration_ms),
  };
}

function responseDependencyRank(value) {
  if (value === 'response_completion_descendant') return 0;
  if (value === 'context_only') return 1;
  return 2;
}

function childAccounting(parent, children) {
  const covered = intervalCoverage(parent, children);
  return {
    covered_child_ms: covered,
    unaccounted_ms: round3(Math.max(0, parent.duration_ms - covered)),
  };
}

function intervalCoverage(parent, children) {
  const start = parent.started_at_ms;
  const end = start + parent.duration_ms;
  const intervals = children
    .map((child) => [
      Math.max(start, child.started_at_ms),
      Math.min(end, child.started_at_ms + child.duration_ms),
    ])
    .filter(([left, right]) => Number.isFinite(left) && Number.isFinite(right) && right > left)
    .toSorted((left, right) => left[0] - right[0] || left[1] - right[1]);
  let covered = 0;
  let active = null;
  for (const interval of intervals) {
    if (!active) active = interval;
    else if (interval[0] <= active[1]) active[1] = Math.max(active[1], interval[1]);
    else {
      covered += active[1] - active[0];
      active = interval;
    }
  }
  if (active) covered += active[1] - active[0];
  covered = Math.min(parent.duration_ms, Math.max(0, covered));
  return round3(covered);
}

function responsePreparationCoverage(parent, children) {
  const preparationMs = parent.response_timing?.complete
    ? parent.response_timing.preparation_ms
    : null;
  if (!Number.isFinite(preparationMs)) return 0;
  return intervalCoverage({ ...parent, duration_ms: preparationMs }, children);
}

function safeHttpEvent(event) {
  return (
    safeMethodRoute(event) &&
    Number.isFinite(event.started_at_ms) &&
    Number.isFinite(event.duration_ms) &&
    event.duration_ms >= 0 &&
    Number.isSafeInteger(event.correlation_ordinal) &&
    event.correlation_ordinal > 0
  );
}

function safeChildEvent(event) {
  return (
    Number.isFinite(event.started_at_ms) &&
    Number.isFinite(event.duration_ms) &&
    event.duration_ms >= 0 &&
    (event.kind === 'database' || safeMethodRoute(event))
  );
}

function safeAsyncEvent(event) {
  return (
    ['connect', 'dns', 'filesystem', 'scheduler', 'timer', 'worker_pool'].includes(
      event.resource_kind
    ) &&
    Number.isFinite(event.started_at_ms) &&
    Number.isFinite(event.duration_ms) &&
    event.duration_ms >= 0 &&
    Number.isFinite(event.callback_active_ms) &&
    event.callback_active_ms >= 0 &&
    ['context_only', 'response_completion_descendant', 'unknown'].includes(
      event.response_dependency
    ) &&
    (event.response_end_after_callback_ms === null ||
      (Number.isFinite(event.response_end_after_callback_ms) &&
        event.response_end_after_callback_ms >= 0)) &&
    validSource(event.source)
  );
}

function safeFrameworkPhase(event) {
  return (
    ['client_component_loading', 'component_tree', 'route_resolution'].includes(event.phase) &&
    Number.isFinite(event.started_at_ms) &&
    Number.isFinite(event.duration_ms) &&
    event.duration_ms >= 0
  );
}

function safeMethodRoute(value) {
  return (
    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(value?.method) &&
    typeof value.route === 'string' &&
    value.route.startsWith('/') &&
    !value.route.includes('?') &&
    value.route.length <= 256
  );
}

function validRequest(request, schema) {
  const currentFields = [
    ...(['runtime-browser-server-flow/v15', BROWSER_SERVER_FLOW_SCHEMA_VERSION].includes(schema)
      ? ['gc_pressure']
      : []),
    ...(schema === BROWSER_SERVER_FLOW_SCHEMA_VERSION ? ['continuous_source'] : []),
  ];
  return (
    closedObject(request, [
      'ordinal',
      'method',
      'route',
      'status',
      'outcome',
      'duration_ms',
      'source',
      'browser_join',
      'child_inventory',
      'children',
      'accounting',
      'response_timing',
      'process_cpu',
      'worker_cpu',
      'native_activity',
      ...currentFields,
      'async_resource_inventory',
      'async_resources',
      'async_overlap',
      'framework_phase_inventory',
      'framework_phases',
      'framework_phase_overlap_ms',
      'framework_phase_preparation_overlap_ms',
      'cpu',
    ]) &&
    Number.isSafeInteger(request.ordinal) &&
    request.ordinal > 0 &&
    safeMethodRoute(request) &&
    Number.isFinite(request.duration_ms) &&
    ['ok', 'error'].includes(request.outcome) &&
    (request.status === null ||
      (Number.isSafeInteger(request.status) && request.status >= 100 && request.status <= 599)) &&
    closedObject(request.browser_join, ['state', 'action_ordinal', 'transfer_bytes']) &&
    ['joined_unique_identity', 'ambiguous', 'absent'].includes(request.browser_join?.state) &&
    (request.browser_join.action_ordinal === null ||
      (Number.isSafeInteger(request.browser_join.action_ordinal) &&
        request.browser_join.action_ordinal > 0)) &&
    (request.browser_join.transfer_bytes === null ||
      (Number.isSafeInteger(request.browser_join.transfer_bytes) &&
        request.browser_join.transfer_bytes >= 0)) &&
    closedObject(request.child_inventory, ['total', 'retained', 'complete']) &&
    Number.isSafeInteger(request.child_inventory.total) &&
    Number.isSafeInteger(request.child_inventory?.retained) &&
    request.child_inventory.retained <= BROWSER_SERVER_FLOW_LIMITS.childrenPerRequest &&
    request.child_inventory.total >= request.child_inventory.retained &&
    typeof request.child_inventory.complete === 'boolean' &&
    request.child_inventory.complete ===
      (request.child_inventory.total === request.child_inventory.retained) &&
    Array.isArray(request.children) &&
    request.children.length === request.child_inventory.retained &&
    request.children.every(validChild) &&
    validSource(request.source) &&
    closedObject(request.accounting, ['covered_child_ms', 'unaccounted_ms']) &&
    Number.isFinite(request.accounting.covered_child_ms) &&
    request.accounting.covered_child_ms >= 0 &&
    Number.isFinite(request.accounting.unaccounted_ms) &&
    request.accounting.unaccounted_ms >= 0 &&
    validResponseTiming(request.response_timing, request.duration_ms) &&
    validProcessCpu(request.process_cpu, request.response_timing, request.duration_ms) &&
    (request.worker_cpu === null || validServerRequestWorkerCpuSummary(request.worker_cpu)) &&
    (request.native_activity === null ||
      validServerRequestNativeActivitySummary(request.native_activity)) &&
    (schema !== BROWSER_SERVER_FLOW_SCHEMA_VERSION ||
      request.gc_pressure === null ||
      validServerRequestGcPressureSummary(request.gc_pressure)) &&
    (schema !== BROWSER_SERVER_FLOW_SCHEMA_VERSION ||
      request.continuous_source === null ||
      validContinuousSourceSummary(request.continuous_source)) &&
    closedObject(request.async_resource_inventory, ['total', 'retained', 'complete']) &&
    Number.isSafeInteger(request.async_resource_inventory.total) &&
    request.async_resource_inventory.total >= 0 &&
    Number.isSafeInteger(request.async_resource_inventory.retained) &&
    request.async_resource_inventory.retained >= 0 &&
    request.async_resource_inventory.retained <=
      BROWSER_SERVER_FLOW_LIMITS.expandedAsyncResourcesPerRequest &&
    request.async_resource_inventory.total >= request.async_resource_inventory.retained &&
    typeof request.async_resource_inventory.complete === 'boolean' &&
    (!request.async_resource_inventory.complete ||
      request.async_resource_inventory.total === request.async_resource_inventory.retained) &&
    Array.isArray(request.async_resources) &&
    request.async_resources.length === request.async_resource_inventory.retained &&
    request.async_resources.every(validAsyncResource) &&
    closedObject(request.async_overlap, [
      'covered_delay_ms',
      'response_completion_delay_ms',
      'preparation_response_completion_delay_ms',
    ]) &&
    Number.isFinite(request.async_overlap.covered_delay_ms) &&
    request.async_overlap.covered_delay_ms >= 0 &&
    Number.isFinite(request.async_overlap.response_completion_delay_ms) &&
    request.async_overlap.response_completion_delay_ms >= 0 &&
    request.async_overlap.response_completion_delay_ms <= request.async_overlap.covered_delay_ms &&
    Number.isFinite(request.async_overlap.preparation_response_completion_delay_ms) &&
    request.async_overlap.preparation_response_completion_delay_ms >= 0 &&
    request.async_overlap.preparation_response_completion_delay_ms <=
      request.async_overlap.response_completion_delay_ms &&
    closedObject(request.framework_phase_inventory, ['total', 'retained', 'complete']) &&
    Number.isSafeInteger(request.framework_phase_inventory.total) &&
    request.framework_phase_inventory.total >= 0 &&
    Number.isSafeInteger(request.framework_phase_inventory.retained) &&
    request.framework_phase_inventory.retained >= 0 &&
    request.framework_phase_inventory.retained <=
      BROWSER_SERVER_FLOW_LIMITS.expandedFrameworkPhasesPerRequest &&
    request.framework_phase_inventory.total >= request.framework_phase_inventory.retained &&
    typeof request.framework_phase_inventory.complete === 'boolean' &&
    (!request.framework_phase_inventory.complete ||
      request.framework_phase_inventory.total === request.framework_phase_inventory.retained) &&
    Array.isArray(request.framework_phases) &&
    request.framework_phases.length === request.framework_phase_inventory.retained &&
    request.framework_phases.every(validFrameworkPhase) &&
    Number.isFinite(request.framework_phase_overlap_ms) &&
    request.framework_phase_overlap_ms >= 0 &&
    request.framework_phase_overlap_ms <= request.duration_ms &&
    Number.isFinite(request.framework_phase_preparation_overlap_ms) &&
    request.framework_phase_preparation_overlap_ms >= 0 &&
    request.framework_phase_preparation_overlap_ms <= request.framework_phase_overlap_ms &&
    validCpu(request.cpu)
  );
}

function validContinuousSourceSummary(value) {
  try {
    assertContinuousSourceSummary(value);
    return true;
  } catch {
    return false;
  }
}

function validResponseTiming(value, durationMs) {
  if (
    !closedObject(value, [
      'complete',
      'commit_offset_ms',
      'first_body_offset_ms',
      'end_offset_ms',
      'finish_offset_ms',
      'preparation_ms',
      'emission_ms',
      'finish_tail_ms',
    ]) ||
    typeof value.complete !== 'boolean' ||
    !Number.isFinite(value.finish_offset_ms) ||
    Math.abs(value.finish_offset_ms - durationMs) > 0.001
  ) {
    return false;
  }
  const nullable = [
    value.commit_offset_ms,
    value.first_body_offset_ms,
    value.end_offset_ms,
    value.preparation_ms,
    value.emission_ms,
    value.finish_tail_ms,
  ];
  if (nullable.some((item) => item !== null && (!Number.isFinite(item) || item < 0))) {
    return false;
  }
  if (!value.complete) {
    return (
      value.preparation_ms === null && value.emission_ms === null && value.finish_tail_ms === null
    );
  }
  if (
    value.commit_offset_ms === null ||
    value.end_offset_ms === null ||
    value.preparation_ms === null ||
    value.emission_ms === null ||
    value.finish_tail_ms === null ||
    value.commit_offset_ms > value.end_offset_ms ||
    value.end_offset_ms > durationMs ||
    (value.first_body_offset_ms !== null &&
      (value.first_body_offset_ms < value.commit_offset_ms ||
        value.first_body_offset_ms > value.end_offset_ms))
  ) {
    return false;
  }
  return (
    Math.abs(value.preparation_ms - value.commit_offset_ms) <= 0.001 &&
    Math.abs(value.emission_ms - (value.end_offset_ms - value.commit_offset_ms)) <= 0.002 &&
    Math.abs(value.finish_tail_ms - (durationMs - value.end_offset_ms)) <= 0.002 &&
    Math.abs(value.preparation_ms + value.emission_ms + value.finish_tail_ms - durationMs) <= 0.003
  );
}

function incompleteResponseTiming(durationMs) {
  return {
    complete: false,
    commit_offset_ms: null,
    first_body_offset_ms: null,
    end_offset_ms: null,
    finish_offset_ms: round3(durationMs),
    preparation_ms: null,
    emission_ms: null,
    finish_tail_ms: null,
  };
}

function validProcessCpu(value, responseTiming, durationMs) {
  const durationKeys = [
    'preparation_user_ms',
    'preparation_system_ms',
    'preparation_cpu_ms',
    'request_user_ms',
    'request_system_ms',
    'request_cpu_ms',
  ];
  const ratioKeys = ['preparation_cpu_to_wall_ratio', 'request_cpu_to_wall_ratio'];
  const nullableKeys = [...durationKeys, ...ratioKeys];
  if (
    !closedObject(value, [
      'complete',
      'overlapping_request_count',
      'overlapping_preparation_request_count',
      ...nullableKeys,
      'thread_partition',
    ]) ||
    typeof value.complete !== 'boolean' ||
    !Number.isSafeInteger(value.overlapping_request_count) ||
    value.overlapping_request_count < 0 ||
    value.overlapping_request_count > 128 ||
    !Number.isSafeInteger(value.overlapping_preparation_request_count) ||
    value.overlapping_preparation_request_count < 0 ||
    value.overlapping_preparation_request_count > value.overlapping_request_count ||
    nullableKeys.some(
      (key) => value[key] !== null && (!Number.isFinite(value[key]) || value[key] < 0)
    ) ||
    !validThreadPartition(value.thread_partition, value)
  ) {
    return false;
  }
  if (!value.complete) return nullableKeys.every((key) => value[key] === null);
  if (!responseTiming.complete || durationKeys.some((key) => value[key] === null)) return false;
  if (
    (responseTiming.preparation_ms === 0) !== (value.preparation_cpu_to_wall_ratio === null) ||
    (durationMs === 0) !== (value.request_cpu_to_wall_ratio === null)
  ) {
    return false;
  }
  return (
    value.preparation_user_ms <= value.request_user_ms &&
    value.preparation_system_ms <= value.request_system_ms &&
    Math.abs(
      value.preparation_cpu_ms - (value.preparation_user_ms + value.preparation_system_ms)
    ) <= 0.002 &&
    Math.abs(value.request_cpu_ms - (value.request_user_ms + value.request_system_ms)) <= 0.002 &&
    (responseTiming.preparation_ms === 0 ||
      Math.abs(
        value.preparation_cpu_to_wall_ratio -
          value.preparation_cpu_ms / responseTiming.preparation_ms
      ) <= 0.0002) &&
    (durationMs === 0 ||
      Math.abs(value.request_cpu_to_wall_ratio - value.request_cpu_ms / durationMs) <= 0.0002)
  );
}

function validThreadPartition(value, processCpu) {
  const metricKeys = [
    'preparation_main_thread_cpu_ms',
    'preparation_other_threads_cpu_ms',
    'preparation_main_thread_to_process_cpu_ratio',
    'request_main_thread_cpu_ms',
    'request_other_threads_cpu_ms',
    'request_main_thread_to_process_cpu_ratio',
  ];
  if (
    !closedObject(value, ['state', ...metricKeys, 'observer_effect', 'provenance']) ||
    !['observed', 'unsupported', 'incomplete', 'inconsistent'].includes(value.state) ||
    value.observer_effect !== 'nested_process_and_current_thread_counter_snapshots' ||
    value.provenance !== 'process_and_current_thread_cpu_usage_deltas' ||
    metricKeys.some(
      (key) => value[key] !== null && (!Number.isFinite(value[key]) || value[key] < 0)
    )
  ) {
    return false;
  }
  if (value.state !== 'observed') return metricKeys.every((key) => value[key] === null);
  if (!processCpu.complete || metricKeys.some((key) => value[key] === null)) return false;
  const preparationRatio =
    processCpu.preparation_cpu_ms > 0
      ? value.preparation_main_thread_cpu_ms / processCpu.preparation_cpu_ms
      : null;
  const requestRatio =
    processCpu.request_cpu_ms > 0
      ? value.request_main_thread_cpu_ms / processCpu.request_cpu_ms
      : null;
  return (
    Math.abs(
      processCpu.preparation_cpu_ms -
        (value.preparation_main_thread_cpu_ms + value.preparation_other_threads_cpu_ms)
    ) <= 0.002 &&
    Math.abs(
      processCpu.request_cpu_ms -
        (value.request_main_thread_cpu_ms + value.request_other_threads_cpu_ms)
    ) <= 0.002 &&
    (preparationRatio === null
      ? value.preparation_main_thread_to_process_cpu_ratio === null
      : Math.abs(value.preparation_main_thread_to_process_cpu_ratio - preparationRatio) <=
        0.0002) &&
    (requestRatio === null
      ? value.request_main_thread_to_process_cpu_ratio === null
      : Math.abs(value.request_main_thread_to_process_cpu_ratio - requestRatio) <= 0.0002)
  );
}

function incompleteProcessCpu() {
  return {
    complete: false,
    overlapping_request_count: 0,
    overlapping_preparation_request_count: 0,
    preparation_user_ms: null,
    preparation_system_ms: null,
    preparation_cpu_ms: null,
    preparation_cpu_to_wall_ratio: null,
    request_user_ms: null,
    request_system_ms: null,
    request_cpu_ms: null,
    request_cpu_to_wall_ratio: null,
    thread_partition: emptyThreadPartition('unsupported'),
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

function validFrameworkPhase(phase) {
  return (
    closedObject(phase, ['phase', 'start_offset_ms', 'duration_ms']) &&
    ['client_component_loading', 'component_tree', 'route_resolution'].includes(phase.phase) &&
    Number.isFinite(phase.start_offset_ms) &&
    phase.start_offset_ms >= 0 &&
    Number.isFinite(phase.duration_ms) &&
    phase.duration_ms >= 0
  );
}

function validAsyncResource(resource) {
  return (
    closedObject(resource, [
      'resource_kind',
      'start_offset_ms',
      'wait_ms',
      'preparation_overlap_ms',
      'callback_active_ms',
      'response_dependency',
      'response_end_after_callback_ms',
      'source',
    ]) &&
    ['connect', 'dns', 'filesystem', 'scheduler', 'timer', 'worker_pool'].includes(
      resource.resource_kind
    ) &&
    Number.isFinite(resource.start_offset_ms) &&
    resource.start_offset_ms >= 0 &&
    Number.isFinite(resource.wait_ms) &&
    resource.wait_ms >= 0 &&
    Number.isFinite(resource.preparation_overlap_ms) &&
    resource.preparation_overlap_ms >= 0 &&
    resource.preparation_overlap_ms <= resource.wait_ms &&
    Number.isFinite(resource.callback_active_ms) &&
    resource.callback_active_ms >= 0 &&
    ['context_only', 'response_completion_descendant', 'unknown'].includes(
      resource.response_dependency
    ) &&
    (resource.response_end_after_callback_ms === null ||
      (Number.isFinite(resource.response_end_after_callback_ms) &&
        resource.response_end_after_callback_ms >= 0)) &&
    validSource(resource.source)
  );
}

function validCpu(cpu) {
  if (cpu === null) return true;
  try {
    assertServerRequestCpuSummary(cpu);
    return true;
  } catch {
    return false;
  }
}

function validCpuPrecommit(value) {
  const scopes = ['repository', 'dependency', 'generated', 'runtime', 'idle', 'unresolved'];
  return (
    closedObject(value, [
      'state',
      'boundary_ms',
      'total_samples',
      'sampled_time_ms',
      'non_idle_sampled_time_ms',
      'sample_scope',
      'sample_scope_time_ms',
      'complete',
      'provenance',
    ]) &&
    ['observed', 'insufficient'].includes(value.state) &&
    (value.boundary_ms === null ||
      (Number.isFinite(value.boundary_ms) && value.boundary_ms >= 0)) &&
    Number.isSafeInteger(value.total_samples) &&
    value.total_samples >= 0 &&
    Number.isFinite(value.sampled_time_ms) &&
    value.sampled_time_ms >= 0 &&
    Number.isFinite(value.non_idle_sampled_time_ms) &&
    value.non_idle_sampled_time_ms >= 0 &&
    value.non_idle_sampled_time_ms <= value.sampled_time_ms + 0.01 &&
    validCpuSampleScope(value.sample_scope, value.total_samples) &&
    closedObject(value.sample_scope_time_ms, scopes) &&
    scopes.every(
      (scope) =>
        Number.isFinite(value.sample_scope_time_ms[scope]) && value.sample_scope_time_ms[scope] >= 0
    ) &&
    Math.abs(
      scopes.reduce((total, scope) => total + value.sample_scope_time_ms[scope], 0) -
        value.sampled_time_ms
    ) <= 0.01 &&
    typeof value.complete === 'boolean' &&
    value.state === (value.complete ? 'observed' : 'insufficient') &&
    value.provenance === 'v8_request_profile_cumulative_time_deltas'
  );
}

function validCpuSampleScope(value, totalSamples) {
  const fields = ['repository', 'dependency', 'generated', 'runtime', 'idle', 'unresolved'];
  return (
    closedObject(value, fields) &&
    fields.every((field) => Number.isSafeInteger(value[field]) && value[field] >= 0) &&
    fields.reduce((total, field) => total + value[field], 0) === totalSamples
  );
}

function validCpuCandidate(candidate) {
  return (
    closedObject(candidate, ['source', 'samples', 'sample_share', 'self_time_ms']) &&
    validCpuSource(candidate.source) &&
    Number.isSafeInteger(candidate.samples) &&
    candidate.samples >= 5 &&
    Number.isFinite(candidate.sample_share) &&
    candidate.sample_share >= 0.1 &&
    candidate.sample_share <= 1 &&
    Number.isFinite(candidate.self_time_ms) &&
    candidate.self_time_ms >= 0
  );
}

function validCpuSource(source) {
  return (
    closedObject(source, ['file', 'line', 'function', 'provenance']) &&
    typeof source.file === 'string' &&
    source.file.length > 0 &&
    source.file.length <= 512 &&
    !source.file.startsWith('/') &&
    !source.file.includes('\\') &&
    !source.file.split('/').includes('..') &&
    Number.isSafeInteger(source.line) &&
    source.line > 0 &&
    typeof source.function === 'string' &&
    source.function.length > 0 &&
    source.function.length <= 200 &&
    source.provenance === 'node_request_cpu_sample'
  );
}

function validChild(child) {
  if (!child || !['database', 'http_client'].includes(child.kind)) return false;
  if (
    !Number.isFinite(child.duration_ms) ||
    child.duration_ms < 0 ||
    !['ok', 'error'].includes(child.outcome) ||
    !validSource(child.source)
  ) {
    return false;
  }
  if (child.kind === 'database') {
    return (
      closedObject(child, [
        'kind',
        'database',
        'operation',
        'statement',
        'outcome',
        'duration_ms',
        'source',
      ]) &&
      child.database === 'node_sqlite' &&
      ['all', 'exec', 'get', 'run'].includes(child.operation) &&
      typeof child.statement === 'string' &&
      child.statement.length <= 256
    );
  }
  return (
    closedObject(child, [
      'kind',
      'method',
      'route',
      'status',
      'outcome',
      'duration_ms',
      'source',
    ]) &&
    safeMethodRoute(child) &&
    (child.status === null ||
      (Number.isSafeInteger(child.status) && child.status >= 100 && child.status <= 599))
  );
}

function validSource(source) {
  return (
    source === null ||
    (closedObject(source, ['file', 'line', 'function', 'provenance']) &&
      typeof source.file === 'string' &&
      source.file.length > 0 &&
      source.file.length <= 512 &&
      !source.file.startsWith('/') &&
      !source.file.includes('\\') &&
      !source.file.split('/').includes('..') &&
      Number.isSafeInteger(source.line) &&
      source.line > 0 &&
      (source.function === null ||
        (typeof source.function === 'string' && source.function.length <= 200)) &&
      [
        'node_async_creator_callsite',
        'node_diagnostic_callsite',
        'static_unique_next_route',
      ].includes(source.provenance))
  );
}

function availabilityLimitation(reason) {
  const labels = {
    artifact_directory_unavailable: 'The owned Node stream artifact directory was unavailable.',
    capture_identity_unavailable:
      'No validated capture identity was available for owned server instrumentation.',
    environment_blocked:
      'The Next runtime is blocked because a loadable development environment file exists.',
    existing_listener_unowned:
      'The reachable application server is not owned by CodeVetter and was not instrumented.',
    frontend_only_vite:
      'The owned Vite runtime serves frontend development assets and is not treated as the application backend.',
    go_instrumentation_not_authorized:
      'Go server tracing requires explicit repository instrumentation authority and was not inferred.',
    no_stream_events: 'The owned runtime produced no supported scoped server events.',
    not_supplied: 'The capture supplied no owned server evidence.',
    runtime_not_owned: 'The local runtime was not owned by CodeVetter.',
    unsupported_runtime: 'The local server runtime does not support bounded owned correlation.',
  };
  return labels[reason];
}

function round3(value) {
  return Math.round(value * 1_000) / 1_000;
}

function closedObject(value, fields) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => fields.includes(key)) &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}
