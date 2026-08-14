export const BROWSER_ACTIONS_SCHEMA_VERSION = 'runtime-browser-actions/v1';
export const BROWSER_ACTION_LIMITS = Object.freeze({
  retained: 64,
  sequence: 16,
  slowest: 8,
  resourcesPerAction: 3,
  pending: 1_024,
});

const ACTION_OBJECTS = new Map([
  ['apirequestcontext', 'apiRequest'],
  ['browsercontext', 'browserContext'],
  ['elementhandle', 'elementHandle'],
  ['frame', 'frame'],
  ['keyboard', 'keyboard'],
  ['locator', 'locator'],
  ['mouse', 'mouse'],
  ['page', 'page'],
  ['request', 'apiRequest'],
  ['touchscreen', 'touchscreen'],
]);

const NAVIGATION_METHODS = new Set(['goBack', 'goForward', 'goto', 'reload']);
const INTERACTION_METHODS = new Set([
  'check',
  'click',
  'dblclick',
  'dispatchEvent',
  'dragAndDrop',
  'hover',
  'press',
  'selectOption',
  'setInputFiles',
  'tap',
  'uncheck',
]);
const INPUT_METHODS = new Set(['clear', 'fill', 'insertText', 'type']);
const WAIT_METHODS = new Set([
  'waitFor',
  'waitForEvent',
  'waitForFunction',
  'waitForLoadState',
  'waitForNavigation',
  'waitForRequest',
  'waitForResponse',
  'waitForSelector',
  'waitForTimeout',
  'waitForURL',
]);
const ASSERTION_METHODS = new Set(['expect']);
const EVALUATION_METHODS = new Set(['evaluate', 'evaluateExpression', 'evaluateHandle']);
const SETUP_METHODS = new Set(['newPage']);
const INTERNAL_METHODS = new Set(['setNetworkInterceptionPatterns']);
const OBSERVATION_METHODS = new Set([
  'content',
  'count',
  'evaluate',
  'getAttribute',
  'innerHTML',
  'innerText',
  'inputValue',
  'isChecked',
  'isDisabled',
  'isEditable',
  'isEnabled',
  'isHidden',
  'isVisible',
  'screenshot',
  'textContent',
  'title',
]);

export function safePlaywrightActionIdentity(value) {
  if (!value || typeof value !== 'object') return null;
  const apiIdentity = safeApiIdentity(value.apiName ?? value.title);
  if (apiIdentity) return apiIdentity;
  const object = ACTION_OBJECTS.get(String(value.class ?? '').toLowerCase());
  const method = safeMethod(value.method);
  return object && method ? identity(object, method) : null;
}

export function normalizePlaywrightTraceAction(start, completion, ordinal) {
  const action = safePlaywrightActionIdentity(start);
  const startedAt = start?.startTime;
  const endedAt = start?.type === 'action' ? start?.endTime : completion?.endTime;
  if (
    !action ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 1 ||
    !Number.isFinite(startedAt) ||
    startedAt < 0 ||
    !Number.isFinite(endedAt) ||
    endedAt < startedAt ||
    endedAt - startedAt > 60 * 60 * 1_000
  ) {
    return null;
  }
  return {
    ordinal,
    name: action.name,
    category: action.category,
    state: completion?.error || start?.error ? 'failed' : 'succeeded',
    started_at_ms: round3(startedAt),
    duration_ms: round3(endedAt - startedAt),
  };
}

export function representativeBrowserActions(actions, limit = BROWSER_ACTION_LIMITS.retained) {
  if (!Array.isArray(actions) || !Number.isSafeInteger(limit) || limit < 0) {
    throw new Error('browser action retention input is invalid');
  }
  if (actions.length <= limit) return actions.toSorted(actionOrder);
  const earliestCount = Math.ceil(limit / 2);
  const chosen = new Set(actions.toSorted(actionOrder).slice(0, earliestCount));
  for (const action of actions.toSorted(
    (left, right) => right.duration_ms - left.duration_ms || actionOrder(left, right)
  )) {
    if (chosen.size >= limit) break;
    chosen.add(action);
  }
  return actions.filter((action) => chosen.has(action)).toSorted(actionOrder);
}

export function createBrowserActionSummary({
  actions,
  startedActionCount,
  completedActionCount,
  samplingApplied,
  resources,
  longTasks,
  completedResponseInventoryComplete,
}) {
  if (
    !Array.isArray(actions) ||
    !Number.isSafeInteger(startedActionCount) ||
    startedActionCount < 0 ||
    !Number.isSafeInteger(completedActionCount) ||
    completedActionCount < 0 ||
    completedActionCount > startedActionCount ||
    actions.length > completedActionCount ||
    typeof samplingApplied !== 'boolean' ||
    !Array.isArray(resources) ||
    !Array.isArray(longTasks) ||
    typeof completedResponseInventoryComplete !== 'boolean'
  ) {
    throw new Error('browser action summary input is invalid');
  }
  const enriched = actions.map((action) =>
    enrichAction(action, resources, longTasks, completedResponseInventoryComplete)
  );
  const inventoryComplete =
    startedActionCount === completedActionCount &&
    completedActionCount === actions.length &&
    !samplingApplied;
  return {
    schema_version: BROWSER_ACTIONS_SCHEMA_VERSION,
    state: startedActionCount > 0 ? 'observed' : 'unavailable',
    inventory: {
      started_action_count: startedActionCount,
      completed_action_count: completedActionCount,
      observed_completed_action_count: actions.length,
      complete: inventoryComplete,
      sampled: samplingApplied,
    },
    sequence: enriched.slice(0, BROWSER_ACTION_LIMITS.sequence),
    slowest: enriched
      .toSorted(
        (left, right) => right.duration_ms - left.duration_ms || left.ordinal - right.ordinal
      )
      .slice(0, BROWSER_ACTION_LIMITS.slowest),
    provenance: 'bounded_playwright_trace_actions',
    limitations: [
      'Action duration is Playwright wall time including waits and framework overhead, not exclusive application CPU.',
      'Resources started and renderer long tasks overlapping an action are temporal associations, not initiator, causality, or exclusive-cost attribution.',
      'Nested or overlapping action windows may reference the same browser observation more than once.',
      ...(inventoryComplete
        ? []
        : ['The action inventory is sampled or contains an action without a bounded completion.']),
      ...(completedResponseInventoryComplete
        ? []
        : [
            'Completed-response transfer totals are unavailable per action because the global completed-response inventory is partial.',
          ]),
    ],
  };
}

function enrichAction(action, resources, longTasks, transferComplete) {
  const end = action.started_at_ms + action.duration_ms;
  const associatedResources = resources.filter(
    (resource) =>
      Number.isFinite(resource.started_at_ms) &&
      resource.started_at_ms >= action.started_at_ms &&
      resource.started_at_ms <= end
  );
  const completedResponses = associatedResources.filter(
    (resource) =>
      Number.isSafeInteger(resource.attributes?.status) &&
      resource.attributes.status >= 100 &&
      resource.attributes.status <= 599
  );
  const overlap = longTasks.reduce(
    (summary, task) => {
      const taskStart = task.started_at_ms;
      const taskEnd = taskStart + task.duration_ms;
      const overlapMs = Math.max(
        0,
        Math.min(end, taskEnd) - Math.max(action.started_at_ms, taskStart)
      );
      if (overlapMs > 0) {
        summary.count += 1;
        summary.duration_ms += overlapMs;
      }
      return summary;
    },
    { count: 0, duration_ms: 0 }
  );
  return {
    ordinal: action.ordinal,
    name: action.name,
    category: action.category,
    state: action.state,
    started_at_ms: action.started_at_ms,
    duration_ms: action.duration_ms,
    resources_started: associatedResources.length,
    completed_responses: completedResponses.length,
    failed_or_aborted_resources: associatedResources.length - completedResponses.length,
    completed_response_transfer_bytes: transferComplete
      ? completedResponses.reduce(
          (total, resource) => total + (resource.attributes.transfer_bytes ?? 0),
          0
        )
      : null,
    largest_resources: associatedResources
      .filter((resource) => Number.isSafeInteger(resource.attributes?.transfer_bytes))
      .toSorted(
        (left, right) =>
          right.attributes.transfer_bytes - left.attributes.transfer_bytes ||
          left.attributes.route.localeCompare(right.attributes.route)
      )
      .slice(0, BROWSER_ACTION_LIMITS.resourcesPerAction)
      .map((resource) => ({
        route: resource.attributes.route,
        network_scope: resource.attributes.network_scope,
        resource_type: resource.attributes.resource_type,
        status: resource.attributes.status,
        transfer_bytes: resource.attributes.transfer_bytes,
        source: resource.attributes.source ?? null,
      })),
    overlapping_long_tasks: overlap.count,
    overlapping_long_task_ms: round3(overlap.duration_ms),
  };
}

function safeApiIdentity(value) {
  if (typeof value !== 'string') return null;
  const match = /^([A-Za-z][A-Za-z0-9]{0,31})\.([A-Za-z][A-Za-z0-9]{0,63})$/.exec(value);
  if (!match) return null;
  const object = ACTION_OBJECTS.get(match[1].toLowerCase());
  const method = safeMethod(match[2]);
  return object && method ? identity(object, method) : null;
}

function safeMethod(value) {
  return typeof value === 'string' &&
    /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value) &&
    !INTERNAL_METHODS.has(value)
    ? value
    : null;
}

function identity(object, method) {
  return { name: `${object}.${method}`, category: actionCategory(method) };
}

function actionCategory(method) {
  if (ASSERTION_METHODS.has(method)) return 'assertion';
  if (EVALUATION_METHODS.has(method)) return 'evaluation';
  if (SETUP_METHODS.has(method)) return 'setup';
  if (NAVIGATION_METHODS.has(method)) return 'navigation';
  if (INTERACTION_METHODS.has(method)) return 'interaction';
  if (INPUT_METHODS.has(method)) return 'input';
  if (WAIT_METHODS.has(method)) return 'wait';
  if (OBSERVATION_METHODS.has(method)) return 'observation';
  return 'other';
}

function actionOrder(left, right) {
  return left.started_at_ms - right.started_at_ms || left.ordinal - right.ordinal;
}

function round3(value) {
  return Math.round(value * 1_000) / 1_000;
}
