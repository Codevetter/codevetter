import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { EXCLUDED_PATH_PARTS, LIMITS, repositoryRelative } from './contracts.mjs';
import {
  BROWSER_ACTION_LIMITS,
  createBrowserActionSummary,
  normalizePlaywrightTraceAction,
  representativeBrowserActions,
  safePlaywrightActionIdentity,
} from './browser-actions.mjs';
import {
  attributeBrowserLoadingSources,
  createBrowserLoadingSummary,
  normalizeBrowserResourceSize,
} from './browser-loading.mjs';
import {
  BROWSER_SERVER_FLOW_PRESENTATION_PROFILES,
  createBrowserServerFlowSummary,
} from './browser-server-flow.mjs';
import { normalizeBrowserMainThreadTrace } from './browser-main-thread-import.mjs';
import { createDetectorCoverageMatrix } from './detector-coverage-matrix.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import { PLAYWRIGHT_CAPTURE_LIMITS } from './playwright-capture-contracts.mjs';
import {
  normalizeRepeatedPlaywrightMemory,
  normalizeSamePagePlaywrightMemory,
} from './playwright-memory.mjs';
import { normalizePlaywrightReactEvidence } from './playwright-react.mjs';
import { diagnoseToolLedPerformance } from './tool-led-performance-diagnosis.mjs';

const NETWORK_SOURCE_EXTENSIONS = new Set([
  '.css',
  '.go',
  '.html',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);
const NETWORK_SOURCE_BYTES = 4 * 1024 * 1024;
const NETWORK_SOURCE_FILE_BYTES = 512 * 1024;
const BROWSER_MAIN_THREAD_FLOW_LIMIT = 16;

export async function diagnosePlaywrightTrace(repositoryRoot, tracePath) {
  const root = await realpath(resolve(repositoryRoot));
  if (typeof tracePath !== 'string' || tracePath.length === 0 || isAbsolute(tracePath)) {
    throw new Error('Playwright trace must be a repository-relative file');
  }
  const path = await realpath(resolve(root, tracePath));
  if (repositoryRelative(root, path) === null)
    throw new Error('Playwright trace escapes repository');
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > LIMITS.flowBytes) {
    throw new Error('Playwright trace is unavailable or exceeds the flow evidence bound');
  }
  return diagnosePlaywrightTraceSource(repositoryRoot, await readFile(path, 'utf8'), {
    target: tracePath,
    name: null,
  });
}

export async function diagnosePlaywrightTraceSource(
  repositoryRoot,
  source,
  {
    target,
    name = null,
    expectedHttpStatuses = [],
    mainThreadTraceSource = null,
    serverIdentity = 'unverified',
    sourceMapLoader = null,
    browserMemory = null,
    repeatedMemory = null,
    samePageMemory = null,
    reactCommits = null,
    runtimeConfiguration = null,
    serverFlow = null,
    runtimePreflight = null,
    preflightRoute = null,
    serverPresentationProfile = BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.ordinary,
  }
) {
  const root = await realpath(resolve(repositoryRoot));
  if (
    typeof source !== 'string' ||
    Buffer.byteLength(source) > PLAYWRIGHT_CAPTURE_LIMITS.traceBytes ||
    typeof target !== 'string' ||
    target.length === 0 ||
    isAbsolute(target) ||
    target.split('/').includes('..') ||
    (name !== null && (typeof name !== 'string' || name.length === 0))
  ) {
    throw new Error('Playwright trace source or exact scope is invalid');
  }
  const parsed = parseTrace(source);
  const normalizedExpectedHttpStatuses = normalizeExpectedHttpStatuses(expectedHttpStatuses);
  const memory = normalizeBrowserMemory(browserMemory);
  const repeated = normalizeRepeatedPlaywrightMemory(repeatedMemory);
  const samePage = normalizeSamePagePlaywrightMemory(samePageMemory);
  const react = normalizePlaywrightReactEvidence(reactCommits);
  let mainThread = null;
  const mainThreadLimitations = [];
  if (mainThreadTraceSource !== null) {
    try {
      mainThread = await normalizeBrowserMainThreadTrace(root, mainThreadTraceSource, {
        sourceMapLoader,
      });
    } catch (error) {
      mainThreadLimitations.push(`Browser main-thread evidence was unavailable: ${error.message}`);
    }
  } else {
    mainThreadLimitations.push('The capture supplied no bounded browser main-thread trace.');
  }
  const events = parsed.events;
  const git = await inspectGitDiff(root);
  const rawNavigations = navigationSpans(events);
  const renderObservations = renderSpans(events);
  const mainThreadTasks = representativeLongTasks(
    mainThread?.long_tasks ?? [],
    Math.min(
      BROWSER_MAIN_THREAD_FLOW_LIMIT,
      Math.max(0, LIMITS.flows - 2 - renderObservations.length)
    )
  );
  const staticResources = await attributeStaticNetworkSources(root, resourceSpans(events));
  const allResources = await attributeBrowserLoadingSources(root, staticResources);
  const loading = createBrowserLoadingSummary(allResources, {
    traceResourceCount: parsed.resource_count,
    samplingApplied: parsed.resource_sampling_applied,
  });
  const actions = createBrowserActionSummary({
    actions: parsed.actions,
    startedActionCount: parsed.started_action_count,
    completedActionCount: parsed.completed_action_count,
    samplingApplied: parsed.action_sampling_applied,
    resources: allResources,
    longTasks: mainThread?.long_tasks ?? [],
    completedResponseInventoryComplete: loading.completed_responses.complete,
  });
  const server = createBrowserServerFlowSummary({
    nodeFlow: serverFlow,
    resources: allResources,
    actions,
    preflight: runtimePreflight,
    preflightRoute,
    presentationProfile: serverPresentationProfile,
    unavailableReason: serverFlow?.reason ?? 'not_supplied',
  });
  const resources = representativeResources(
    allResources,
    Math.max(
      0,
      LIMITS.flows - 1 - rawNavigations.length - renderObservations.length - mainThreadTasks.length
    )
  );
  const navigations = rawNavigations.map((navigation, index) =>
    navigationWithResourceAccounting(
      navigation,
      resourcesForNavigation(allResources, rawNavigations, index),
      {
        complete: !parsed.resource_sampling_applied && resources.length === allResources.length,
      }
    )
  );
  const timedObservations = [...resources, ...navigations, ...parsed.actions];
  const start = timedObservations.reduce(
    (minimum, span) => Math.min(minimum, span.started_at_ms),
    timedObservations.length > 0 ? Number.POSITIVE_INFINITY : 0
  );
  const end = timedObservations.reduce(
    (maximum, span) => Math.max(maximum, span.started_at_ms + span.duration_ms),
    start
  );
  const flows = [
    {
      id: 'flow-1',
      parent_flow_id: null,
      kind: 'workload',
      name: name ?? target,
      timing: { duration_ms: Math.max(0, end - start), provenance: 'playwright_trace_bounds' },
      evidence_ids: ['playwright-trace'],
      limitations: [],
    },
  ];
  for (const [index, navigation] of navigations.entries()) {
    flows.push(toFlow(navigation, `flow-${index + 2}`, 'flow-1'));
  }
  for (const [index, resource] of resources.entries()) {
    flows.push(
      toFlow(
        resource,
        `flow-${flows.length + 1}`,
        navigationParentFlowId(resource.started_at_ms, navigations)
      )
    );
  }
  for (const render of renderObservations) {
    flows.push(
      toFlow(
        render,
        `flow-${flows.length + 1}`,
        navigationParentFlowId(render.started_at_ms, navigations)
      )
    );
  }
  for (const task of mainThreadTasks) {
    flows.push({
      id: `flow-${flows.length + 1}`,
      parent_flow_id: navigationParentFlowId(task.started_at_ms, navigations),
      kind: 'browser_main_thread_task',
      name: `Browser main-thread ${task.task_type} task`,
      timing: {
        started_at_ms: task.started_at_ms,
        duration_ms: task.duration_ms,
        provenance: 'bounded_chromium_trace_event',
      },
      attributes: { task_type: task.task_type },
      evidence_ids: [`chromium-main-thread-task-${flows.length + 1}`],
      limitations: [
        'The renderer task is observed, but nested phases and sampled functions do not assign exclusive task cost.',
      ],
    });
  }
  const capsule = {
    subject: { repository_revision: git.repository_revision },
    adapter: { kind: 'playwright-trace' },
    scope: { target, name },
    root_flow_id: 'flow-1',
    flows,
    function_analysis: { observed_function_count: 0, repeated_work_candidate: null },
    browser_main_thread: mainThread ? { ...mainThread, server_identity: serverIdentity } : null,
    browser_memory: memory,
    browser_repeated_memory: repeated,
    browser_same_page_memory: samePage,
    browser_react: react,
    browser_loading: loading,
    browser_actions: actions,
    browser_server: server,
    expected_http_statuses: normalizedExpectedHttpStatuses,
    browser_runtime: { configuration: runtimeConfiguration },
    coverage: { captured_kinds: [...new Set(flows.map((flow) => flow.kind))].toSorted() },
  };
  return {
    schema_version: 'runtime-playwright-trace-diagnosis/v22',
    subject: capsule.subject,
    scope: capsule.scope,
    flows,
    main_thread: mainThread,
    memory,
    repeated_memory: repeated,
    same_page_memory: samePage,
    react,
    loading,
    actions,
    server,
    tool_diagnosis: diagnoseToolLedPerformance(capsule),
    detector_coverage_matrix: createDetectorCoverageMatrix({
      adapter: 'playwright-trace',
      flowCapsule: capsule,
    }),
    limitations: [
      ...(mainThread
        ? [
            'Renderer tasks and rendering phases are bounded observations; nested phases do not assign exclusive rendering cost.',
          ]
        : [
            'Trace actions and network intervals are observed; rendering cost remains unavailable without bounded browser main-thread evidence.',
          ]),
      'Local browser resources do not establish production network latency or cache behavior.',
      ...(parsed.resource_sampling_applied || resources.length < allResources.length
        ? [
            'Network evidence retains a bounded mix of the earliest and slowest resources; omitted requests are not represented.',
          ]
        : []),
      ...mainThreadLimitations,
      ...(mainThread?.limitations ?? []),
      ...(memory
        ? [
            'Peak RSS covers the owned Playwright and Chromium process tree; it does not isolate renderer heap or prove a leak.',
          ]
        : ['The exact browser flow supplied no bounded process-tree memory observation.']),
      ...(repeated?.limitations ?? [
        'The exact browser flow supplied no repeated forced-GC memory evidence.',
      ]),
      ...(samePage?.limitations ?? [
        'The exact browser flow supplied no same-page forced-GC memory evidence.',
      ]),
      ...(react?.limitations ?? [
        'The exact browser flow supplied no separate React commit evidence.',
      ]),
      ...loading.limitations,
      ...actions.limitations,
      ...server.limitations,
    ],
  };
}

function normalizeExpectedHttpStatuses(values) {
  if (!Array.isArray(values) || values.length > 8) return [];
  return values.flatMap((value) => {
    if (typeof value !== 'string' || value.length > 600) return [];
    const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD) (\/\S{0,500}) ([1-5]\d{2})$/.exec(value);
    return match ? [{ method: match[1], route: match[2], status: Number(match[3]) }] : [];
  });
}

function normalizeBrowserMemory(value) {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Number.isInteger(value.peak_process_tree_rss_bytes) ||
    value.peak_process_tree_rss_bytes < 1 ||
    !Number.isInteger(value.samples) ||
    value.samples < 1 ||
    !Number.isInteger(value.interval_ms) ||
    value.interval_ms < 1 ||
    value.provenance !== 'local_process_tree_rss_sampling'
  ) {
    throw new Error('browser process-tree memory observation is invalid');
  }
  return {
    peak_process_tree_rss_bytes: value.peak_process_tree_rss_bytes,
    samples: value.samples,
    interval_ms: value.interval_ms,
    provenance: value.provenance,
  };
}

function parseTrace(source) {
  const navigationEvents = [];
  const navigationCallIds = new Set();
  const firstResources = [];
  const slowResources = [];
  const largeResources = [];
  const frames = [];
  const pendingActions = new Map();
  const completedActions = [];
  const resourcePool = LIMITS.flows * 2;
  let resourceCount = 0;
  let startedActionCount = 0;
  let completedActionCount = 0;
  let actionOrdinal = 0;
  let lineCount = 0;
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lineCount += 1;
    if (lineCount > LIMITS.flows * 1_000) {
      throw new Error('Playwright trace line count exceeds bound');
    }
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error('Playwright trace contains invalid JSONL');
    }
    if (!value || typeof value !== 'object' || typeof value.type !== 'string') continue;
    if (value.type === 'action' && safePlaywrightActionIdentity(value)) {
      startedActionCount += 1;
      actionOrdinal += 1;
      const action = normalizePlaywrightTraceAction(value, null, actionOrdinal);
      if (action) {
        completedActionCount += 1;
        completedActions.push(action);
      }
    } else if (value.type === 'before' && safePlaywrightActionIdentity(value)) {
      startedActionCount += 1;
      actionOrdinal += 1;
      if (
        typeof value.callId === 'string' &&
        value.callId.length <= 160 &&
        pendingActions.size < BROWSER_ACTION_LIMITS.pending
      ) {
        pendingActions.set(value.callId, { start: value, ordinal: actionOrdinal });
      }
    } else if (value.type === 'after' && pendingActions.has(value.callId)) {
      const pending = pendingActions.get(value.callId);
      pendingActions.delete(value.callId);
      const action = normalizePlaywrightTraceAction(pending.start, value, pending.ordinal);
      if (action) {
        completedActionCount += 1;
        completedActions.push(action);
      }
    }
    if (
      ['before', 'action'].includes(value.type) &&
      ((value.apiName ?? value.title) === 'page.goto' ||
        (value.class === 'Frame' && value.method === 'goto'))
    ) {
      if (navigationEvents.length < 16) navigationEvents.push(value);
      if (typeof value.callId === 'string') navigationCallIds.add(value.callId);
      continue;
    }
    if (value.type === 'after' && navigationCallIds.has(value.callId)) {
      if (navigationEvents.length < 16) navigationEvents.push(value);
      continue;
    }
    if (value.type === 'frame-snapshot') {
      if (frames.length < 16) frames.push(value);
      continue;
    }
    if (value.type !== 'resource-snapshot') continue;
    resourceCount += 1;
    if (firstResources.length < resourcePool) firstResources.push(value);
    slowResources.push(value);
    slowResources.sort((left, right) => traceResourceDuration(right) - traceResourceDuration(left));
    if (slowResources.length > resourcePool) slowResources.pop();
    largeResources.push(value);
    largeResources.sort(
      (left, right) => traceResourceTransferBytes(right) - traceResourceTransferBytes(left)
    );
    if (largeResources.length > resourcePool) largeResources.pop();
  }
  const resources = [...new Set([...firstResources, ...slowResources, ...largeResources])];
  const actions = representativeBrowserActions(completedActions);
  return {
    events: [...navigationEvents, ...resources, ...frames],
    actions,
    started_action_count: startedActionCount,
    completed_action_count: completedActionCount,
    action_sampling_applied: completedActionCount > actions.length,
    resource_count: resourceCount,
    resource_sampling_applied: resourceCount > resources.length,
  };
}

function representativeResources(resources, limit) {
  if (resources.length <= limit) return resources;
  const earliestCount = Math.ceil(limit / 2);
  const chosen = new Set(resources.slice(0, earliestCount));
  for (const resource of resources.toSorted(
    (left, right) => right.duration_ms - left.duration_ms
  )) {
    if (chosen.size >= limit) break;
    chosen.add(resource);
  }
  return [...chosen].toSorted((left, right) => left.started_at_ms - right.started_at_ms);
}

function representativeLongTasks(tasks, limit) {
  if (tasks.length <= limit) return tasks;
  const earliestCount = Math.ceil(limit / 2);
  const chosen = new Set(tasks.slice(0, earliestCount));
  for (const task of tasks.toSorted(
    (left, right) =>
      right.duration_ms - left.duration_ms || left.started_at_ms - right.started_at_ms
  )) {
    if (chosen.size >= limit) break;
    chosen.add(task);
  }
  return tasks.filter((task) => chosen.has(task));
}

function traceResourceDuration(event) {
  const snapshot = event.snapshot ?? {};
  if (Number.isFinite(snapshot.time)) return Math.max(0, snapshot.time);
  const start = snapshot.timing?.startTime;
  const end = snapshot.timing?.responseEnd;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

function traceResourceTransferBytes(event) {
  return normalizeBrowserResourceSize(event?.snapshot).transfer_bytes ?? -1;
}

function navigationSpans(events) {
  const spans = [];
  const seen = new Set();
  for (const before of events) {
    if (
      !['before', 'action'].includes(before.type) ||
      !(
        (before.apiName ?? before.title) === 'page.goto' ||
        (before.class === 'Frame' && before.method === 'goto')
      ) ||
      seen.has(before.callId)
    ) {
      continue;
    }
    const after =
      before.type === 'action'
        ? before
        : events.find((event) => event.type === 'after' && event.callId === before.callId);
    if (!after || !Number.isFinite(before.startTime) || !Number.isFinite(after.endTime)) continue;
    seen.add(before.callId);
    spans.push({
      kind: 'navigation',
      name: 'page.goto',
      started_at_ms: before.startTime,
      duration_ms: Math.max(0, after.endTime - before.startTime),
      attributes: { route: normalizeUrl(before.params?.url), source: null },
      evidence_ids: [`playwright-action-${before.callId}`],
      limitations: [],
    });
  }
  return spans.toSorted((left, right) => left.started_at_ms - right.started_at_ms).slice(0, 8);
}

function resourcesForNavigation(resources, navigations, index) {
  const start = navigations[index].started_at_ms;
  const nextStart = navigations[index + 1]?.started_at_ms ?? Number.POSITIVE_INFINITY;
  return resources.filter(
    (resource) => resource.started_at_ms >= start && resource.started_at_ms < nextStart
  );
}

function navigationParentFlowId(startedAtMs, navigations) {
  let parent = 'flow-1';
  for (const [index, navigation] of navigations.entries()) {
    if (navigation.started_at_ms > startedAtMs) break;
    parent = `flow-${index + 2}`;
  }
  return parent;
}

export function navigationWithResourceAccounting(navigation, resources, { complete }) {
  if (!navigation || !complete) return navigation;
  const start = navigation.started_at_ms;
  const end = start + navigation.duration_ms;
  const intervals = resources
    .map((resource) => [
      Math.max(start, resource.started_at_ms),
      Math.min(end, resource.started_at_ms + resource.duration_ms),
    ])
    .filter(([left, right]) => Number.isFinite(left) && Number.isFinite(right) && right > left)
    .toSorted((left, right) => left[0] - right[0] || left[1] - right[1]);
  let accounted = 0;
  let activeStart = null;
  let activeEnd = null;
  for (const [left, right] of intervals) {
    if (activeStart === null) {
      activeStart = left;
      activeEnd = right;
      continue;
    }
    if (left <= activeEnd) {
      activeEnd = Math.max(activeEnd, right);
      continue;
    }
    accounted += activeEnd - activeStart;
    activeStart = left;
    activeEnd = right;
  }
  if (activeStart !== null) accounted += activeEnd - activeStart;
  accounted = Math.min(navigation.duration_ms, Math.max(0, accounted));
  return {
    ...navigation,
    accounting: {
      accounted_child_ms: roundDuration(accounted),
      unaccounted_ms: roundDuration(Math.max(0, navigation.duration_ms - accounted)),
    },
  };
}

function resourceSpans(events) {
  return events
    .filter((event) => event.type === 'resource-snapshot')
    .map((event, index) => {
      const snapshot = event.snapshot ?? {};
      const legacyStart = snapshot.timing?.startTime;
      const legacyEnd = snapshot.timing?.responseEnd;
      const start = Number.isFinite(snapshot._monotonicTime)
        ? snapshot._monotonicTime
        : legacyStart;
      const duration = Number.isFinite(snapshot.time)
        ? Math.max(0, snapshot.time)
        : Number.isFinite(legacyStart) && Number.isFinite(legacyEnd)
          ? Math.max(0, legacyEnd - legacyStart)
          : null;
      if (!Number.isFinite(start) || duration === null) return null;
      const status = Number.isInteger(snapshot.response?.status) ? snapshot.response.status : null;
      const destination = normalizeNetworkDestination(snapshot.request?.url);
      const method = String(snapshot.request?.method ?? 'GET').slice(0, 16);
      const loading = normalizeBrowserResourceSize(snapshot);
      return {
        kind: 'http_client',
        name: `${method} ${destination.label}`,
        started_at_ms: start,
        duration_ms: duration,
        attributes: {
          method,
          route: destination.route,
          request_identity_sha256: destination.request_identity_sha256,
          host: destination.host,
          network_scope: destination.scope,
          status,
          outcome:
            snapshot._wasAborted || (status !== null && (status < 0 || status >= 400))
              ? 'error'
              : 'ok',
          ...loading,
          source: null,
        },
        request_url: destination.url,
        evidence_ids: [`playwright-resource-${index + 1}`],
        limitations: [
          'The Playwright trace does not attribute this resource to a repository callsite.',
        ],
      };
    })
    .filter(Boolean)
    .toSorted((left, right) => left.started_at_ms - right.started_at_ms);
}

async function attributeStaticNetworkSources(root, spans) {
  if (!spans.some((span) => span.attributes.network_scope === 'remote')) {
    return spans.map(stripPrivateResourceFields);
  }
  const sources = await boundedNetworkSources(root);
  return spans.map((span) => {
    const source =
      span.attributes.network_scope === 'remote'
        ? locateNetworkLiteral(sources, span.request_url)
        : null;
    return stripPrivateResourceFields({
      ...span,
      attributes: { ...span.attributes, source },
      limitations: source
        ? [
            'The source is an exact static network literal, not a captured runtime JavaScript callsite.',
          ]
        : span.limitations,
    });
  });
}

function stripPrivateResourceFields({ request_url: _requestUrl, ...span }) {
  return span;
}

async function boundedNetworkSources(root) {
  const queue = [{ directory: root, depth: 0 }];
  const sources = [];
  let bytes = 0;
  while (queue.length > 0 && sources.length < LIMITS.scanFiles && bytes < NETWORK_SOURCE_BYTES) {
    const current = queue.shift();
    let entries;
    try {
      entries = await readdir(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (EXCLUDED_PATH_PARTS.includes(entry.name)) continue;
      const absolute = join(current.directory, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < 6) queue.push({ directory: absolute, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile() || !NETWORK_SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
      let metadata;
      try {
        metadata = await stat(absolute);
      } catch {
        continue;
      }
      if (
        !metadata.isFile() ||
        metadata.size > NETWORK_SOURCE_FILE_BYTES ||
        bytes + metadata.size > NETWORK_SOURCE_BYTES
      ) {
        continue;
      }
      try {
        sources.push({
          path: relative(root, absolute).split(sep).join('/'),
          text: await readFile(absolute, 'utf8'),
        });
        bytes += metadata.size;
      } catch {
        // Unreadable source cannot provide attribution evidence.
      }
    }
  }
  return sources;
}

function locateNetworkLiteral(sources, requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  const needles = [`${url.protocol}//${url.host}${url.pathname}`, url.hostname].filter(
    (value, index, values) => value.length > 0 && values.indexOf(value) === index
  );
  const matches = [];
  for (const source of sources) {
    for (const [needleRank, needle] of needles.entries()) {
      const index = source.text.indexOf(needle);
      if (index === -1) continue;
      matches.push({ source, index, needleRank });
    }
  }
  const best = matches.toSorted(
    (left, right) =>
      left.needleRank - right.needleRank ||
      networkSourceRank(left.source.path) - networkSourceRank(right.source.path) ||
      left.source.path.localeCompare(right.source.path) ||
      left.index - right.index
  )[0];
  if (!best) return null;
  return {
    file: best.source.path,
    line: best.source.text.slice(0, best.index).split(/\r?\n/).length,
    function: null,
    provenance: 'static_network_literal',
  };
}

function networkSourceRank(path) {
  if (path === 'index.html') return 0;
  if (path.endsWith('/index.html')) return 1;
  if (/(?:^|\/)src\/(?:main|index)\.[cm]?[jt]sx?$/.test(path)) return 2;
  return 3;
}

function renderSpans(events) {
  return events
    .filter(
      (event) => event.type === 'frame-snapshot' && Number.isFinite(event.snapshot?.timestamp)
    )
    .slice(0, 16)
    .map((event, index) => ({
      kind: 'render_observation',
      name: 'Playwright frame snapshot',
      started_at_ms: event.snapshot.timestamp,
      duration_ms: 0,
      attributes: { frame_id: String(event.snapshot.frameId ?? '').slice(0, 80) },
      evidence_ids: [`playwright-frame-${index + 1}`],
      limitations: [
        'A frame snapshot proves rendered state was captured but does not assign browser rendering duration.',
      ],
    }));
}

function toFlow(span, id, parentFlowId) {
  return {
    id,
    parent_flow_id: parentFlowId,
    kind: span.kind,
    name: span.name,
    timing: {
      started_at_ms: span.started_at_ms,
      duration_ms: span.duration_ms,
      provenance: 'bounded_playwright_trace',
      ...(span.accounting ? { accounting: span.accounting } : {}),
    },
    attributes: span.attributes,
    evidence_ids: span.evidence_ids,
    limitations: span.limitations,
  };
}

function roundDuration(value) {
  return Math.round(value * 1_000) / 1_000;
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value), 'http://local.invalid');
    return url.pathname.slice(0, 256) || '/';
  } catch {
    return '/<invalid>';
  }
}

function normalizeNetworkDestination(value) {
  try {
    const url = new URL(String(value), 'http://local.invalid');
    const route = redactOpaqueRouteSegments(url.pathname).slice(0, 256) || '/';
    const host = url.hostname.slice(0, 128);
    const scope = ['localhost', '127.0.0.1', '[::1]', 'local.invalid'].includes(url.hostname)
      ? url.hostname === 'local.invalid'
        ? 'relative'
        : 'loopback'
      : 'remote';
    return {
      route,
      host: scope === 'relative' ? null : host,
      scope,
      label: scope === 'remote' ? `${host}${route}` : route,
      url: url.href,
      request_identity_sha256: createHash('sha256')
        .update(`${url.pathname}${url.search}`)
        .digest('hex'),
    };
  } catch {
    return {
      route: '/<invalid>',
      host: null,
      scope: 'invalid',
      label: '/<invalid>',
      url: null,
      request_identity_sha256: null,
    };
  }
}

function redactOpaqueRouteSegments(pathname) {
  return pathname
    .split('/')
    .map((segment) =>
      /^(?:phc|phx|pk|sk|token|secret|key)_[A-Za-z0-9_-]{12,}$/i.test(segment)
        ? '<redacted:opaque>'
        : segment
    )
    .join('/');
}
