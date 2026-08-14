import { AsyncLocalStorage, createHook, executionAsyncId } from 'node:async_hooks';
import fs from 'node:fs';
import http from 'node:http';
import { appendFileSync, realpathSync, writeFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import timersPromises from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import workerThreads, { isMainThread } from 'node:worker_threads';

import { V8_HEAP_COLLECTION_SCOPE, V8_HEAP_PROFILE_INTERVAL_BYTES } from './v8-heap-profile.mjs';

const directory = isMainThread ? process.env.CODEVETTER_FLOW_DIRECTORY : null;
let repositoryRoot = null;
try {
  repositoryRoot = process.env.CODEVETTER_REPOSITORY_ROOT
    ? realpathSync(resolve(process.env.CODEVETTER_REPOSITORY_ROOT))
    : null;
} catch {
  repositoryRoot = null;
}
const preloadPath = fileURLToPath(import.meta.url);
const maximumEvents = 128;
const events = [];
const requestContext = new AsyncLocalStorage();
const statementShapes = new WeakMap();
const streamedEvents = new WeakSet();
const streamEnabled = process.env.CODEVETTER_FLOW_STREAM === '1';
const cpuEnabled = process.env.CODEVETTER_FLOW_CPU === '1';
const continuousSourceEnabled = process.env.CODEVETTER_CONTINUOUS_SOURCE === '1';
const continuousSourceArmHeader = 'x-codevetter-continuous-source-arm';
const asyncResourceEnabled = process.env.CODEVETTER_FLOW_ASYNC === '1';
const nativeActivityEnabled = process.env.CODEVETTER_NATIVE_ACTIVITY === '1';
const gcPressureEnabled = process.env.CODEVETTER_GC_PRESSURE === '1';
const configuredCorrelationId = safeCorrelationId(process.env.CODEVETTER_FLOW_CORRELATION_ID);
const configuredContinuousSourceTarget = continuousSourceTargetFromEnvironment();
const nextPhasePrefix =
  process.env.NEXT_OTEL_PERFORMANCE_PREFIX === 'codevetter-next-phase'
    ? 'codevetter-next-phase'
    : null;
const nextFrameworkPhases = new Map([
  [`${nextPhasePrefix}:next-find-page-components`, 'route_resolution'],
  [`${nextPhasePrefix}:next-create-component-tree`, 'component_tree'],
  [`${nextPhasePrefix}:next-client-component-loading`, 'client_component_loading'],
]);
const maximumCpuProfiles = 8;
const maximumCpuProfileBytes = 8 * 1024 * 1024;
const maximumContinuousSourceSamples = 100_000;
const continuousSourceSamplingIntervalUs = 1_000;
const maximumGcPressureProfileBytes = 16 * 1024 * 1024;
const maximumRegisteredWorkers = 16;
const maximumWorkersPerProfile = 4;
const maximumWorkerProfileSamples = 100_000;
const maximumPendingAsyncResources = 256;
const maximumCompletedAsyncResourcesPerRequest = 256;
const maximumAsyncLineageNodesPerRequest = 4_096;
const maximumAsyncLineageNodes = 16_384;
const minimumAsyncWaitMs = 1;
const pendingAsyncResources = new Map();
const completedAsyncResourcesByRequest = new Map();
const asyncLineageNodes = new Map();
const asyncLineageChildren = new Map();
const asyncLineageCountsByRequest = new Map();
const incompleteAsyncLineageRequestIds = new Set();
const completedRequestIds = new Set();
const activeRequestCpuStates = new Map();
const registeredWorkers = new Map();
let nextId = 1;
let flushed = false;
let streamTruncationWritten = false;
let asyncCreationSource = null;
let asyncCreationSourceActive = false;
let cpuSession = null;
let cpuReady = false;
let activeCpuProfile = null;
let cpuProfileCount = 0;
let correlatedRequestOrdinal = 0;
let continuousSourceReady = false;
let continuousSourceRotation = null;
let activeContinuousSourceCapture = configuredContinuousSourceTarget
  ? {
      target: configuredContinuousSourceTarget,
      startup_attested: false,
      target_match_count: 0,
      event_id: null,
      overlapping_dynamic_requests: 0,
      overlapping_precommit_dynamic_requests: 0,
      response_committed: false,
      finished: false,
      finishing: null,
    }
  : null;
let nextWorkerOrdinal = 1;
let registeredWorkerCount = 0;
let workerRegistryTruncated = false;
let activeWorkerCpuCapture = null;
let activeNativeActivityCapture = null;
let nativeActivityCount = 0;
let createNativeTracing = null;
let heapSamplingReady = false;
let activeGcPressureCapture = null;
let gcPressureCaptureCount = 0;

const nativeTraceCategories = [
  'v8',
  'node.threadpoolwork.async',
  'node.threadpoolwork.sync',
  'node.fs.async',
  'node.fs_dir.async',
  'node.dns.native',
  'node.net.native',
];

if (directory && nativeActivityEnabled && isMainThread) {
  try {
    ({ createTracing: createNativeTracing } = await import('node:trace_events'));
  } catch {
    createNativeTracing = null;
  }
}

const workerCpuSupported = Boolean(
  isMainThread &&
    typeof workerThreads?.Worker?.prototype?.cpuUsage === 'function' &&
    typeof workerThreads?.Worker?.prototype?.startCpuProfile === 'function'
);

if (directory && cpuEnabled && configuredCorrelationId && isMainThread) {
  const OriginalWorker = workerThreads.Worker;
  if (typeof OriginalWorker === 'function') {
    workerThreads.Worker = new Proxy(OriginalWorker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget);
        registerWorker(worker);
        return worker;
      },
    });
    syncBuiltinESMExports();
  }
}

if (
  directory &&
  (cpuEnabled || continuousSourceEnabled || gcPressureEnabled) &&
  configuredCorrelationId
) {
  try {
    const { Session } = await import('node:inspector');
    cpuSession = new Session();
    cpuSession.connect();
    if (cpuEnabled) {
      await inspectorPost('Profiler.setSamplingInterval', { interval: 100 });
      await inspectorPost('Profiler.enable');
      cpuReady = true;
    }
    if (continuousSourceEnabled && configuredContinuousSourceTarget) {
      await inspectorPost('Profiler.setSamplingInterval', {
        interval: continuousSourceSamplingIntervalUs,
      });
      await inspectorPost('Profiler.enable');
      await inspectorPost('Profiler.start');
      continuousSourceReady = true;
      activeContinuousSourceCapture.startup_attested = true;
    }
    if (gcPressureEnabled) {
      await inspectorPost('HeapProfiler.enable');
      heapSamplingReady = true;
    }
  } catch {
    cpuSession = null;
    cpuReady = false;
    continuousSourceReady = false;
    heapSamplingReady = false;
  }
}

function now() {
  return Math.round((performance.timeOrigin + performance.now()) * 1000) / 1000;
}

function monotonicMicroseconds() {
  return Number(process.hrtime.bigint() / 1_000n);
}

function startNativeActivityCapture(event) {
  if (!directory || !nativeActivityEnabled || !isMainThread || activeNativeActivityCapture) {
    return;
  }
  nativeActivityCount += 1;
  const capture = {
    event_id: event.id,
    sequence: nativeActivityCount,
    start_us: monotonicMicroseconds(),
    tracing: null,
    supported: false,
    overlapping_dynamic_requests: 0,
    finished: false,
  };
  activeNativeActivityCapture = capture;
  try {
    if (typeof createNativeTracing !== 'function') return;
    capture.tracing = createNativeTracing({ categories: nativeTraceCategories });
    capture.tracing.enable();
    capture.supported = true;
  } catch {
    capture.tracing = null;
  }
}

function finishNativeActivityCapture(event, responseCommitOffsetMs) {
  const capture = activeNativeActivityCapture;
  if (!capture || capture.event_id !== event.id || capture.finished) return;
  capture.finished = true;
  const stopUs = monotonicMicroseconds();
  let complete = capture.supported;
  try {
    capture.tracing?.disable();
  } catch {
    complete = false;
  }
  const marker = {
    schema_version: 'codevetter-node-request-native-activity/v1',
    parent_event_id: event.id,
    supported: capture.supported,
    start_us: capture.start_us,
    stop_us: stopUs,
    response_commit_offset_ms: Number.isFinite(responseCommitOffsetMs)
      ? Math.max(0, responseCommitOffsetMs)
      : null,
    overlapping_dynamic_requests: Math.min(maximumEvents, capture.overlapping_dynamic_requests),
    complete,
  };
  try {
    writeFileSync(
      join(directory, `native-activity-${process.pid}-${capture.sequence}.json`),
      JSON.stringify(marker),
      { encoding: 'utf8', flag: 'wx' }
    );
  } catch {
    // A missing private marker makes the native observation unavailable.
  }
  if (activeNativeActivityCapture === capture) activeNativeActivityCapture = null;
}

function heapObservation() {
  try {
    const value = process.memoryUsage();
    const normalized = {
      rss_bytes: value?.rss,
      heap_total_bytes: value?.heapTotal,
      heap_used_bytes: value?.heapUsed,
      external_bytes: value?.external,
      array_buffers_bytes: value?.arrayBuffers,
    };
    return Object.values(normalized).every((item) => Number.isSafeInteger(item) && item >= 0)
      ? normalized
      : null;
  } catch {
    return null;
  }
}

async function startGcPressureCapture(event) {
  if (
    !directory ||
    !gcPressureEnabled ||
    !heapSamplingReady ||
    !isMainThread ||
    activeGcPressureCapture
  ) {
    return false;
  }
  gcPressureCaptureCount += 1;
  const capture = {
    event_id: event.id,
    sequence: gcPressureCaptureCount,
    start_us: monotonicMicroseconds(),
    heap_before: heapObservation(),
    overlapping_dynamic_requests: 0,
    supported: false,
    finished: false,
  };
  activeGcPressureCapture = capture;
  try {
    await inspectorPost('HeapProfiler.startSampling', {
      samplingInterval: V8_HEAP_PROFILE_INTERVAL_BYTES,
      stackDepth: 128,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    capture.supported = capture.heap_before !== null;
  } catch {
    capture.supported = false;
  }
  return capture.supported;
}

async function finishGcPressureCapture(event, responseCommitOffsetMs) {
  const capture = activeGcPressureCapture;
  if (!capture || capture.event_id !== event?.id || capture.finished) return;
  capture.finished = true;
  const stopUs = monotonicMicroseconds();
  const heapCommit = heapObservation();
  const profileFile = `gc-allocation-${process.pid}-${capture.sequence}.heapprofile`;
  let profileBytes = 0;
  let complete = capture.supported && heapCommit !== null;
  try {
    if (capture.supported) {
      const result = await inspectorPost('HeapProfiler.stopSampling');
      const serialized = JSON.stringify(result?.profile ?? null);
      profileBytes = Buffer.byteLength(serialized);
      if (profileBytes < 2 || profileBytes > maximumGcPressureProfileBytes) {
        complete = false;
        profileBytes = 0;
      } else {
        writeFileSync(join(directory, profileFile), serialized, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
      }
    }
  } catch {
    complete = false;
    profileBytes = 0;
  }
  const marker = {
    schema_version: 'codevetter-node-request-gc-pressure/v1',
    parent_event_id: capture.event_id,
    supported: capture.supported,
    start_us: capture.start_us,
    stop_us: stopUs,
    response_commit_offset_ms:
      Number.isFinite(responseCommitOffsetMs) && responseCommitOffsetMs >= 0
        ? responseCommitOffsetMs
        : 0,
    overlapping_dynamic_requests: Math.min(maximumEvents, capture.overlapping_dynamic_requests),
    sampling_interval_bytes: V8_HEAP_PROFILE_INTERVAL_BYTES,
    collection_scope: V8_HEAP_COLLECTION_SCOPE,
    heap_before: capture.heap_before ?? emptyHeapObservation(),
    heap_commit: heapCommit ?? emptyHeapObservation(),
    profile_file: profileFile,
    profile_bytes: profileBytes,
    complete,
  };
  try {
    writeFileSync(
      join(directory, `gc-pressure-${process.pid}-${capture.sequence}.json`),
      JSON.stringify(marker),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    );
  } catch {
    // Missing private evidence is reported by the parent collector.
  } finally {
    if (activeGcPressureCapture === capture) activeGcPressureCapture = null;
  }
}

function emptyHeapObservation() {
  return {
    rss_bytes: 0,
    heap_total_bytes: 0,
    heap_used_bytes: 0,
    external_bytes: 0,
    array_buffers_bytes: 0,
  };
}

function cpuSnapshot() {
  try {
    const value = process.cpuUsage();
    if (
      !Number.isSafeInteger(value?.user) ||
      value.user < 0 ||
      !Number.isSafeInteger(value?.system) ||
      value.system < 0
    ) {
      return null;
    }
    return { user_us: value.user, system_us: value.system };
  } catch {
    return null;
  }
}

function threadCpuSnapshot() {
  if (typeof process.threadCpuUsage !== 'function') return null;
  try {
    const value = process.threadCpuUsage();
    if (
      !Number.isSafeInteger(value?.user) ||
      value.user < 0 ||
      !Number.isSafeInteger(value?.system) ||
      value.system < 0
    ) {
      return null;
    }
    return { user_us: value.user, system_us: value.system };
  } catch {
    return null;
  }
}

function startingCpuSnapshot() {
  return {
    process: cpuSnapshot(),
    thread: threadCpuSnapshot(),
    thread_supported: typeof process.threadCpuUsage === 'function',
  };
}

function endingCpuSnapshot() {
  return {
    thread: threadCpuSnapshot(),
    process: cpuSnapshot(),
    thread_supported: typeof process.threadCpuUsage === 'function',
  };
}

function cpuDelta(start, end) {
  if (!start || !end) return null;
  const userUs = end.user_us - start.user_us;
  const systemUs = end.system_us - start.system_us;
  if (
    !Number.isSafeInteger(userUs) ||
    userUs < 0 ||
    !Number.isSafeInteger(systemUs) ||
    systemUs < 0
  ) {
    return null;
  }
  return { user_us: userUs, system_us: systemUs };
}

function registerWorker(worker) {
  registeredWorkerCount += 1;
  if (registeredWorkers.size >= maximumRegisteredWorkers) {
    workerRegistryTruncated = true;
    if (activeWorkerCpuCapture && !activeWorkerCpuCapture.stop_requested) {
      activeWorkerCpuCapture.created_during_interval += 1;
    }
    return;
  }
  const record = {
    ordinal: nextWorkerOrdinal,
    worker,
    online: false,
    exited: false,
  };
  nextWorkerOrdinal += 1;
  registeredWorkers.set(record.ordinal, record);
  if (activeWorkerCpuCapture && !activeWorkerCpuCapture.stop_requested) {
    activeWorkerCpuCapture.created_during_interval += 1;
  }
  worker.once('online', () => {
    record.online = true;
  });
  worker.once('exit', () => {
    record.exited = true;
    registeredWorkers.delete(record.ordinal);
  });
}

function normalizePath(value) {
  let pathname;
  try {
    pathname = new URL(String(value), 'http://127.0.0.1').pathname;
  } catch {
    return '/<invalid>';
  }
  const segments = pathname.split('/').map((segment) => {
    if (!segment) return segment;
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return ':value';
    }
    if (decoded.includes('/') || decoded.includes('\\')) return ':value';
    if (/^\d+$/.test(decoded)) return ':number';
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(decoded)) return ':uuid';
    if (/[-_][0-9a-f]{8,}$/i.test(decoded)) return ':value';
    if (decoded.length > 48 || /^[A-Za-z0-9_-]{24,}$/.test(decoded)) return ':value';
    return decoded.slice(0, 64);
  });
  return segments.join('/') || '/';
}

function requestDetails(input, init) {
  const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return null;
  return {
    method: String(init?.method ?? input?.method ?? 'GET')
      .toUpperCase()
      .slice(0, 16),
    route: normalizePath(url),
  };
}

function reserve(event) {
  if (!directory || events.length >= maximumEvents) {
    markStreamTruncated();
    return null;
  }
  const stored = { id: `event-${process.pid}-${nextId++}`, ...event };
  events.push(stored);
  return stored;
}

function markStreamTruncated() {
  if (!streamEnabled || streamTruncationWritten || !directory) return;
  streamTruncationWritten = true;
  try {
    appendFileSync(
      join(directory, `flow-${process.pid}.ndjson`),
      `${JSON.stringify({
        schema_version: 'codevetter-node-flow-meta/v1',
        truncated: true,
      })}\n`
    );
  } catch {
    // Missing completeness evidence is handled by the parent capture boundary.
  }
}

function complete(event, update) {
  if (!event) return;
  Object.assign(event, update);
  if (streamEnabled && Number.isFinite(event.duration_ms) && !streamedEvents.has(event)) {
    streamedEvents.add(event);
    try {
      appendFileSync(
        join(directory, `flow-${process.pid}.ndjson`),
        `${JSON.stringify({ schema_version: 'codevetter-node-flow-event/v1', event })}\n`
      );
    } catch {
      // Missing streamed evidence is reported by the parent; never disrupt the workload.
    }
  }
}

function currentParentId() {
  return requestContext.getStore()?.event_id ?? null;
}

function currentAsyncParentId() {
  const context = requestContext.getStore();
  return context?.capture_async === true ? context.event_id : null;
}

function captureSource(provenance = 'node_diagnostic_callsite', directCreator = false) {
  if (!repositoryRoot) return null;
  const stack = new Error().stack?.split('\n').slice(1) ?? [];
  for (const line of stack) {
    const match = line.match(/^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    if (!match) continue;
    let filename = match[2];
    try {
      if (filename.startsWith('file:')) filename = fileURLToPath(filename);
    } catch {
      continue;
    }
    if (!isAbsolute(filename)) continue;
    const absolute = resolve(filename);
    if (absolute === preloadPath) continue;
    const path = relative(resolve(repositoryRoot), absolute);
    const contained =
      path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
    if (!contained) {
      if (directCreator) return null;
      continue;
    }
    if (path.split(sep).includes('node_modules')) {
      if (directCreator) return null;
      continue;
    }
    return {
      file: path.split(sep).join('/').slice(0, 512),
      line: Number(match[3]),
      function: match[1]?.slice(0, 200) || null,
      provenance,
    };
  }
  return null;
}

function safeCorrelationId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value) ? value : null;
}

function continuousSourceTargetFromEnvironment() {
  if (!continuousSourceEnabled) return null;
  const ordinal = Number(process.env.CODEVETTER_CONTINUOUS_SOURCE_ORDINAL);
  const method = process.env.CODEVETTER_CONTINUOUS_SOURCE_METHOD;
  const route = process.env.CODEVETTER_CONTINUOUS_SOURCE_ROUTE;
  if (
    !Number.isSafeInteger(ordinal) ||
    ordinal < 1 ||
    typeof method !== 'string' ||
    !/^[A-Z]{1,16}$/.test(method) ||
    typeof route !== 'string' ||
    route.length < 1 ||
    route.length > 2_048 ||
    !route.startsWith('/') ||
    normalizePath(route) !== route
  ) {
    return null;
  }
  return { ordinal, method, route };
}

function requestCorrelationId(request) {
  if (!configuredCorrelationId) return null;
  const value = request?.headers?.['x-codevetter-capture'];
  return typeof value === 'string' && value === configuredCorrelationId ? value : null;
}

function normalizeSql(value) {
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

if (directory && asyncResourceEnabled && configuredCorrelationId) {
  createHook({
    init(asyncId, type, triggerAsyncId) {
      const parentEventId = currentAsyncParentId();
      if (!parentEventId || completedRequestIds.has(parentEventId)) return;
      const resourceKind = asyncResourceKind(type);
      trackAsyncLineageNode(asyncId, type, triggerAsyncId, parentEventId, resourceKind);
      if (!resourceKind) return;
      if (pendingAsyncResources.size >= maximumPendingAsyncResources) {
        markStreamTruncated();
        return;
      }
      pendingAsyncResources.set(asyncId, {
        parent_event_id: parentEventId,
        resource_kind: resourceKind,
        started_at_ms: now(),
        callback_started_at_ms: null,
        source: asyncCreationSourceActive ? asyncCreationSource : captureSource(),
      });
    },
    before(asyncId) {
      const resource = pendingAsyncResources.get(asyncId);
      if (resource && resource.callback_started_at_ms === null) {
        resource.callback_started_at_ms = now();
      }
    },
    after(asyncId) {
      const resource = pendingAsyncResources.get(asyncId);
      if (!resource || resource.callback_started_at_ms === null) return;
      pendingAsyncResources.delete(asyncId);
      if (completedRequestIds.has(resource.parent_event_id)) return;
      const callbackCompletedAtMs = now();
      const waitMs = Math.max(0, resource.callback_started_at_ms - resource.started_at_ms);
      if (waitMs < minimumAsyncWaitMs) return;
      const completed = completedAsyncResourcesByRequest.get(resource.parent_event_id) ?? [];
      if (completed.length >= maximumCompletedAsyncResourcesPerRequest) {
        incompleteAsyncLineageRequestIds.add(resource.parent_event_id);
        markStreamTruncated();
        return;
      }
      completed.push({
        async_id: asyncId,
        resource_kind: resource.resource_kind,
        parent_event_id: resource.parent_event_id,
        started_at_ms: resource.started_at_ms,
        duration_ms: waitMs,
        callback_active_ms: Math.max(0, callbackCompletedAtMs - resource.callback_started_at_ms),
        callback_completed_at_ms: callbackCompletedAtMs,
        source: resource.source,
      });
      completedAsyncResourcesByRequest.set(resource.parent_event_id, completed);
    },
    destroy(asyncId) {
      pendingAsyncResources.delete(asyncId);
      releaseAsyncLineageNode(asyncId);
    },
    promiseResolve(asyncId) {
      pendingAsyncResources.delete(asyncId);
      const node = asyncLineageNodes.get(asyncId);
      const resolverAsyncId = executionAsyncId();
      const resolver = asyncLineageNodes.get(resolverAsyncId);
      if (
        node?.promise === true &&
        resolverAsyncId !== asyncId &&
        resolver?.parent_event_id === node.parent_event_id
      ) {
        propagateAsyncLineageRoots(asyncId, resolver.response_dependency_roots);
      }
    },
  }).enable();
  wrapAsyncCreator('setTimeout');
  wrapAsyncCreator('setInterval');
  wrapAsyncCreator('setImmediate');
  wrapBuiltinAsyncCreators(timersPromises, ['setTimeout', 'setImmediate']);
  wrapBuiltinAsyncCreators(fsPromises, [
    'access',
    'appendFile',
    'chmod',
    'chown',
    'copyFile',
    'cp',
    'lchmod',
    'lchown',
    'link',
    'lstat',
    'lutimes',
    'mkdir',
    'mkdtemp',
    'open',
    'opendir',
    'readFile',
    'readdir',
    'readlink',
    'realpath',
    'rename',
    'rm',
    'rmdir',
    'stat',
    'statfs',
    'symlink',
    'truncate',
    'unlink',
    'utimes',
    'writeFile',
  ]);
  syncBuiltinESMExports();
}

if (directory && streamEnabled && configuredCorrelationId && nextPhasePrefix) {
  const originalPerformanceMeasure = performance.measure;
  performance.measure = function codeVetterNextFrameworkMeasure(name, ...args) {
    const measure = originalPerformanceMeasure.call(this, name, ...args);
    const phase = nextFrameworkPhases.get(name);
    const parentEventId = currentAsyncParentId();
    if (
      phase &&
      parentEventId &&
      !completedRequestIds.has(parentEventId) &&
      Number.isFinite(measure?.startTime) &&
      measure.startTime >= 0 &&
      Number.isFinite(measure?.duration) &&
      measure.duration >= 0
    ) {
      const event = reserve({
        kind: 'framework_phase',
        phase,
        parent_event_id: parentEventId,
        started_at_ms: Math.round((performance.timeOrigin + measure.startTime) * 1000) / 1000,
        duration_ms: Math.round(measure.duration * 1000) / 1000,
      });
      complete(event, {});
    }
    return measure;
  };
}

function trackAsyncLineageNode(asyncId, type, triggerAsyncId, parentEventId, resourceKind) {
  const requestCount = asyncLineageCountsByRequest.get(parentEventId) ?? 0;
  if (
    requestCount >= maximumAsyncLineageNodesPerRequest ||
    asyncLineageNodes.size >= maximumAsyncLineageNodes
  ) {
    incompleteAsyncLineageRequestIds.add(parentEventId);
    return;
  }
  const trigger = asyncLineageNodes.get(triggerAsyncId);
  const triggerRoots =
    trigger?.parent_event_id === parentEventId ? trigger.response_dependency_roots : [];
  asyncLineageNodes.set(asyncId, {
    parent_event_id: parentEventId,
    trigger_async_id: Number.isSafeInteger(triggerAsyncId) ? triggerAsyncId : null,
    promise: type === 'PROMISE',
    response_dependency_roots: resourceKind ? [...triggerRoots, asyncId] : triggerRoots,
  });
  if (trigger?.parent_event_id === parentEventId) {
    const children = asyncLineageChildren.get(triggerAsyncId) ?? new Set();
    children.add(asyncId);
    asyncLineageChildren.set(triggerAsyncId, children);
  }
  asyncLineageCountsByRequest.set(parentEventId, requestCount + 1);
}

function propagateAsyncLineageRoots(asyncId, additionalRoots) {
  if (!Array.isArray(additionalRoots) || additionalRoots.length === 0) return;
  const pending = [asyncId];
  const visited = new Set();
  while (pending.length > 0 && visited.size <= maximumAsyncLineageNodesPerRequest) {
    const currentAsyncId = pending.pop();
    if (visited.has(currentAsyncId)) continue;
    visited.add(currentAsyncId);
    const node = asyncLineageNodes.get(currentAsyncId);
    if (!node) continue;
    const merged = mergeAsyncLineageRoots(node.response_dependency_roots, additionalRoots);
    if (merged === node.response_dependency_roots) continue;
    node.response_dependency_roots = merged;
    for (const childAsyncId of asyncLineageChildren.get(currentAsyncId) ?? []) {
      pending.push(childAsyncId);
    }
  }
}

function mergeAsyncLineageRoots(current, additional) {
  if (additional.every((asyncId) => current.includes(asyncId))) return current;
  return [...new Set([...current, ...additional])].slice(0, maximumPendingAsyncResources);
}

function releaseAsyncLineageNode(asyncId) {
  const node = asyncLineageNodes.get(asyncId);
  if (!node) return;
  asyncLineageNodes.delete(asyncId);
  const parentChildren = asyncLineageChildren.get(node.trigger_async_id);
  parentChildren?.delete(asyncId);
  if (parentChildren?.size === 0) asyncLineageChildren.delete(node.trigger_async_id);
  asyncLineageChildren.delete(asyncId);
  const requestCount = asyncLineageCountsByRequest.get(node.parent_event_id) ?? 0;
  if (requestCount <= 1) asyncLineageCountsByRequest.delete(node.parent_event_id);
  else asyncLineageCountsByRequest.set(node.parent_event_id, requestCount - 1);
}

function responseCompletionRoots(parentEventId, responseEndAsyncId) {
  const node = asyncLineageNodes.get(responseEndAsyncId);
  return node?.parent_event_id === parentEventId ? [...node.response_dependency_roots] : [];
}

function finalizeAsyncResources(
  parentEventId,
  responseEndObserved,
  responseEndRoots,
  responseEndAtMs
) {
  const resources = completedAsyncResourcesByRequest.get(parentEventId) ?? [];
  const lineageComplete =
    responseEndObserved === true && !incompleteAsyncLineageRequestIds.has(parentEventId);
  const ancestors = new Set(responseEndRoots);
  for (const resource of resources) {
    const responseDependency = ancestors.has(resource.async_id)
      ? 'response_completion_descendant'
      : lineageComplete
        ? 'context_only'
        : 'unknown';
    const event = reserve({
      kind: 'async_resource',
      resource_kind: resource.resource_kind,
      parent_event_id: resource.parent_event_id,
      started_at_ms: resource.started_at_ms,
      duration_ms: resource.duration_ms,
      callback_active_ms: resource.callback_active_ms,
      response_dependency: responseDependency,
      response_end_after_callback_ms:
        Number.isFinite(responseEndAtMs) && responseEndAtMs >= resource.callback_completed_at_ms
          ? Math.max(0, responseEndAtMs - resource.callback_completed_at_ms)
          : null,
      source: resource.source,
    });
    complete(event, {});
  }
  completedAsyncResourcesByRequest.delete(parentEventId);
  incompleteAsyncLineageRequestIds.delete(parentEventId);
  asyncLineageCountsByRequest.delete(parentEventId);
  for (const [asyncId, node] of asyncLineageNodes) {
    if (node.parent_event_id === parentEventId) releaseAsyncLineageNode(asyncId);
  }
}

function wrapAsyncCreator(name) {
  const original = globalThis[name];
  if (typeof original !== 'function') return;
  globalThis[name] = function codeVetterAsyncCreator(...args) {
    const prior = asyncCreationSource;
    const priorActive = asyncCreationSourceActive;
    asyncCreationSourceActive = true;
    asyncCreationSource = currentAsyncParentId()
      ? captureSource('node_async_creator_callsite', true)
      : null;
    try {
      return original.apply(this, args);
    } finally {
      asyncCreationSource = prior;
      asyncCreationSourceActive = priorActive;
    }
  };
}

function wrapBuiltinAsyncCreators(target, names) {
  for (const name of names) {
    const original = target?.[name];
    if (typeof original !== 'function') continue;
    target[name] = function codeVetterBuiltinAsyncCreator(...args) {
      const prior = asyncCreationSource;
      const priorActive = asyncCreationSourceActive;
      asyncCreationSourceActive = true;
      asyncCreationSource = currentAsyncParentId()
        ? captureSource('node_async_creator_callsite', true)
        : null;
      try {
        return original.apply(this, args);
      } finally {
        asyncCreationSource = prior;
        asyncCreationSourceActive = priorActive;
      }
    };
  }
}

function asyncResourceKind(type) {
  if (type === 'Timeout') return 'timer';
  if (type === 'Immediate') return 'scheduler';
  if (['FSREQCALLBACK', 'FSREQPROMISE', 'FILEHANDLECLOSEREQ'].includes(type)) {
    return 'filesystem';
  }
  if (['GETADDRINFOREQWRAP', 'GETNAMEINFOREQWRAP', 'QUERYWRAP'].includes(type)) return 'dns';
  if (['TCPCONNECTWRAP', 'PIPECONNECTWRAP'].includes(type)) return 'connect';
  if (
    [
      'PBKDF2REQUEST',
      'SCRYPTREQUEST',
      'RANDOMBYTESREQUEST',
      'KEYPAIRGENREQUEST',
      'KEYGENREQUEST',
      'SIGNREQUEST',
      'VERIFYREQUEST',
    ].includes(type)
  ) {
    return 'worker_pool';
  }
  return null;
}

if (directory && typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function codeVetterFlowFetch(input, init) {
    const details = requestDetails(input, init);
    const parentEventId = currentParentId();
    if (!details || (configuredCorrelationId && !parentEventId)) {
      return originalFetch.call(this, input, init);
    }
    const startedAt = now();
    const event = reserve({
      kind: 'http_client',
      ...details,
      source: captureSource(),
      parent_event_id: parentEventId,
      status: null,
      started_at_ms: startedAt,
      duration_ms: null,
    });
    try {
      const response = await originalFetch.call(this, input, init);
      complete(event, {
        status: response.status,
        duration_ms: Math.max(0, now() - startedAt),
      });
      return response;
    } catch (error) {
      complete(event, {
        outcome: 'error',
        duration_ms: Math.max(0, now() - startedAt),
      });
      throw error;
    }
  };

  const originalEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function codeVetterFlowEmit(type, ...args) {
    if (type === 'request') {
      const [request, response] = args;
      if (isContinuousSourceArmRequest(request)) {
        void rotateContinuousSourceProfile()
          .then(() => {
            response.statusCode = 204;
            response.end();
          })
          .catch(() => {
            response.statusCode = 503;
            response.end();
          });
        return true;
      }
      const correlationId = requestCorrelationId(request);
      if (configuredCorrelationId && !correlationId) {
        return originalEmit.call(this, type, ...args);
      }
      const startedAt = now();
      const method = String(request?.method ?? 'GET')
        .toUpperCase()
        .slice(0, 16);
      const route = normalizePath(request?.url ?? '/');
      const correlationOrdinal = correlationId ? (correlatedRequestOrdinal += 1) : null;
      const event = reserve({
        kind: 'http_server',
        method,
        route,
        parent_event_id: null,
        ...(correlationId
          ? {
              correlation_id: correlationId,
              correlation_ordinal: correlationOrdinal,
            }
          : {}),
        status: null,
        started_at_ms: startedAt,
        duration_ms: null,
      });
      if (!event) return originalEmit.call(this, type, ...args);
      const requestCpuState = {
        start: startingCpuSnapshot(),
        commit: null,
        overlapping_request_count: activeRequestCpuStates.size,
        overlapping_preparation_request_count: activeRequestCpuStates.size,
      };
      for (const activeState of activeRequestCpuStates.values()) {
        activeState.overlapping_request_count += 1;
        if (activeState.commit === null) {
          activeState.overlapping_preparation_request_count += 1;
        }
      }
      activeRequestCpuStates.set(event.id, requestCpuState);
      if (
        activeContinuousSourceCapture?.event_id &&
        activeContinuousSourceCapture.event_id !== event.id &&
        !activeContinuousSourceCapture.finished &&
        shouldCaptureDiagnosticRequest(route)
      ) {
        activeContinuousSourceCapture.overlapping_dynamic_requests += 1;
        if (!activeContinuousSourceCapture.response_committed) {
          activeContinuousSourceCapture.overlapping_precommit_dynamic_requests += 1;
        }
      }
      if (
        activeContinuousSourceCapture &&
        correlationOrdinal === activeContinuousSourceCapture.target.ordinal &&
        method === activeContinuousSourceCapture.target.method &&
        route === activeContinuousSourceCapture.target.route
      ) {
        activeContinuousSourceCapture.target_match_count += 1;
        if (activeContinuousSourceCapture.event_id === null) {
          activeContinuousSourceCapture.event_id = event.id;
        }
      }
      const dispatch = () =>
        requestContext.run(
          { event_id: event.id, capture_async: shouldObserveAsyncRequest(route) },
          () => {
            let completed = false;
            let responseEndObserved = false;
            let responseEndRoots = [];
            let responseEndAtMs = null;
            let responseCommitAtMs = null;
            let firstBodyAtMs = null;
            let responseEndCallAtMs = null;
            const markCommit = (atMs, cpuAtMs) => {
              if (responseCommitAtMs === null || atMs < responseCommitAtMs) {
                responseCommitAtMs = atMs;
                requestCpuState.commit = cpuAtMs;
                if (activeCpuProfile?.event_id === event.id) {
                  activeCpuProfile.response_committed = true;
                }
                if (activeContinuousSourceCapture?.event_id === event.id) {
                  activeContinuousSourceCapture.response_committed = true;
                  void finishContinuousSourceProfile(event, Math.max(0, atMs - startedAt));
                }
                void finishWorkerCpuCapture(event, Math.max(0, atMs - startedAt));
                finishNativeActivityCapture(event, Math.max(0, atMs - startedAt));
                void finishGcPressureCapture(event, Math.max(0, atMs - startedAt));
              }
            };
            const markBody = (atMs, cpuAtMs) => {
              markCommit(atMs, cpuAtMs);
              if (firstBodyAtMs === null || atMs < firstBodyAtMs) firstBodyAtMs = atMs;
            };
            const responseTiming = (finishedAtMs) => ({
              commit_offset_ms: Number.isFinite(responseCommitAtMs)
                ? Math.max(0, responseCommitAtMs - startedAt)
                : null,
              first_body_offset_ms: Number.isFinite(firstBodyAtMs)
                ? Math.max(0, firstBodyAtMs - startedAt)
                : null,
              end_offset_ms: Number.isFinite(responseEndCallAtMs)
                ? Math.max(0, responseEndCallAtMs - startedAt)
                : null,
              finish_offset_ms: Math.max(0, finishedAtMs - startedAt),
            });
            const processCpuTiming = (finishedCpu) => {
              const preparation = cpuDelta(
                requestCpuState.start.process,
                requestCpuState.commit?.process
              );
              const requestTotal = cpuDelta(requestCpuState.start.process, finishedCpu.process);
              const preparationThread = cpuDelta(
                requestCpuState.start.thread,
                requestCpuState.commit?.thread
              );
              const requestThread = cpuDelta(requestCpuState.start.thread, finishedCpu.thread);
              return {
                complete: Boolean(preparation && requestTotal),
                overlapping_request_count: Math.min(
                  maximumEvents,
                  requestCpuState.overlapping_request_count
                ),
                overlapping_preparation_request_count: Math.min(
                  maximumEvents,
                  requestCpuState.overlapping_preparation_request_count
                ),
                preparation_user_us: preparation?.user_us ?? null,
                preparation_system_us: preparation?.system_us ?? null,
                request_user_us: requestTotal?.user_us ?? null,
                request_system_us: requestTotal?.system_us ?? null,
                thread_cpu_supported:
                  requestCpuState.start.thread_supported && finishedCpu.thread_supported,
                thread_cpu_observer_effect:
                  'process_counter_interval_encloses_current_thread_counter_interval',
                preparation_thread_user_us: preparationThread?.user_us ?? null,
                preparation_thread_system_us: preparationThread?.system_us ?? null,
                request_thread_user_us: requestThread?.user_us ?? null,
                request_thread_system_us: requestThread?.system_us ?? null,
              };
            };
            const finishRequest = (update) => {
              if (completed) return;
              completed = true;
              const finishedCpu = endingCpuSnapshot();
              activeRequestCpuStates.delete(event.id);
              completedRequestIds.add(event.id);
              finalizeAsyncResources(
                event.id,
                responseEndObserved,
                responseEndRoots,
                responseEndAtMs
              );
              for (const [asyncId, resource] of pendingAsyncResources) {
                if (resource.parent_event_id === event.id) pendingAsyncResources.delete(asyncId);
              }
              complete(event, { ...update, process_cpu: processCpuTiming(finishedCpu) });
              void finishWorkerCpuCapture(event, update?.response_timing?.commit_offset_ms ?? null);
              void finishCpuProfile(event, update?.response_timing?.commit_offset_ms ?? null);
              finishNativeActivityCapture(event, update?.response_timing?.commit_offset_ms ?? null);
              void finishGcPressureCapture(
                event,
                update?.response_timing?.commit_offset_ms ?? null
              );
            };
            for (const methodName of ['writeHead', 'flushHeaders']) {
              if (typeof response?.[methodName] !== 'function') continue;
              const original = response[methodName];
              response[methodName] = function codeVetterFlowResponseCommit(...methodArgs) {
                const invokedAtMs = now();
                const invokedCpu = endingCpuSnapshot();
                const result = original.apply(this, methodArgs);
                markCommit(invokedAtMs, invokedCpu);
                return result;
              };
            }
            if (typeof response?.write === 'function') {
              const originalWrite = response.write;
              response.write = function codeVetterFlowResponseWrite(...writeArgs) {
                const invokedAtMs = now();
                const invokedCpu = endingCpuSnapshot();
                const result = originalWrite.apply(this, writeArgs);
                markBody(invokedAtMs, invokedCpu);
                return result;
              };
            }
            if (typeof response?.end === 'function') {
              const originalEnd = response.end;
              response.end = function codeVetterFlowResponseEnd(...endArgs) {
                if (!event.source) event.source = captureSource();
                if (!responseEndObserved) {
                  responseEndObserved = true;
                  responseEndRoots = responseCompletionRoots(event.id, executionAsyncId());
                  responseEndAtMs = now();
                }
                const invokedAtMs = responseEndAtMs;
                const invokedCpu = endingCpuSnapshot();
                const result = originalEnd.apply(this, endArgs);
                markCommit(invokedAtMs, invokedCpu);
                if (endArgs.length > 0 && typeof endArgs[0] !== 'function') {
                  markBody(invokedAtMs, invokedCpu);
                }
                if (responseEndCallAtMs === null) responseEndCallAtMs = invokedAtMs;
                return result;
              };
            }
            response?.once?.('finish', () => {
              const finishedAtMs = now();
              finishRequest({
                status: Number.isInteger(response.statusCode) ? response.statusCode : null,
                duration_ms: Math.max(0, finishedAtMs - startedAt),
                response_timing: responseTiming(finishedAtMs),
              });
            });
            try {
              return originalEmit.call(this, type, ...args);
            } catch (error) {
              const failedAtMs = now();
              finishRequest({
                outcome: 'error',
                duration_ms: Math.max(0, failedAtMs - startedAt),
                response_timing: responseTiming(failedAtMs),
              });
              throw error;
            }
          }
        );
      if (shouldObserveAsyncRequest(route)) {
        if (activeNativeActivityCapture && !activeNativeActivityCapture.finished) {
          activeNativeActivityCapture.overlapping_dynamic_requests += 1;
        } else {
          startNativeActivityCapture(event);
        }
        if (activeGcPressureCapture && !activeGcPressureCapture.finished) {
          activeGcPressureCapture.overlapping_dynamic_requests += 1;
        }
      }
      if (
        gcPressureEnabled &&
        heapSamplingReady &&
        shouldCaptureDiagnosticRequest(route) &&
        !activeGcPressureCapture &&
        gcPressureCaptureCount < maximumCpuProfiles
      ) {
        void startGcPressureCapture(event).then(dispatch).catch(dispatch);
        return true;
      }
      if (shouldProfileRequest(route)) {
        if (activeCpuProfile) {
          activeCpuProfile.overlapping_dynamic_requests += 1;
          if (!activeCpuProfile.response_committed) {
            activeCpuProfile.overlapping_precommit_dynamic_requests += 1;
          }
          if (activeWorkerCpuCapture && !activeWorkerCpuCapture.stop_requested) {
            activeWorkerCpuCapture.overlapping_dynamic_requests += 1;
          }
        } else if (cpuProfileCount < maximumCpuProfiles) {
          activeCpuProfile = {
            event_id: event.id,
            sequence: cpuProfileCount + 1,
            method,
            route,
            overlapping_dynamic_requests: 0,
            overlapping_precommit_dynamic_requests: 0,
            response_committed: false,
          };
          cpuProfileCount += 1;
          void Promise.all([
            inspectorPost('Profiler.start'),
            startWorkerCpuCapture(event, startedAt),
          ])
            .then(dispatch)
            .catch(() => {
              if (activeCpuProfile?.event_id === event.id) activeCpuProfile = null;
              void finishWorkerCpuCapture(event, null);
              dispatch();
            });
          return true;
        }
      }
      return dispatch();
    }
    return originalEmit.call(this, type, ...args);
  };
}

function isContinuousSourceArmRequest(request) {
  if (!continuousSourceEnabled || !configuredCorrelationId || !continuousSourceReady) return false;
  const value = request?.headers?.[continuousSourceArmHeader];
  return request?.method === 'POST' && value === configuredCorrelationId;
}

async function rotateContinuousSourceProfile() {
  if (continuousSourceRotation) return continuousSourceRotation;
  continuousSourceRotation = (async () => {
    if (!continuousSourceReady || !activeContinuousSourceCapture) {
      throw new Error('continuous profiler unavailable');
    }
    continuousSourceReady = false;
    await inspectorPost('Profiler.stop');
    await inspectorPost('Profiler.start');
    activeContinuousSourceCapture = {
      target: configuredContinuousSourceTarget,
      startup_attested: true,
      target_match_count: 0,
      event_id: null,
      overlapping_dynamic_requests: 0,
      overlapping_precommit_dynamic_requests: 0,
      response_committed: false,
      finished: false,
      finishing: null,
    };
    continuousSourceReady = true;
  })().finally(() => {
    continuousSourceRotation = null;
  });
  return continuousSourceRotation;
}

function shouldObserveAsyncRequest(route) {
  return typeof route === 'string' && !route.startsWith('/_next/');
}

function shouldProfileRequest(route) {
  return cpuReady && shouldCaptureDiagnosticRequest(route);
}

function shouldCaptureDiagnosticRequest(route) {
  return (
    typeof route === 'string' && !route.startsWith('/_next/') && !/\.[a-z0-9]{1,8}$/i.test(route)
  );
}

async function startWorkerCpuCapture(event, startedAtMs) {
  const records = [...registeredWorkers.values()];
  const online = records.filter((record) => record.online && !record.exited);
  const admitted = online.slice(0, maximumWorkersPerProfile);
  const capture = {
    event_id: event.id,
    sequence: activeCpuProfile?.sequence ?? cpuProfileCount,
    started_at_ms: startedAtMs,
    supported: workerCpuSupported,
    registered_total: registeredWorkerCount,
    registered_current: records.length,
    online_at_admission: online.length,
    registry_truncated: workerRegistryTruncated,
    admitted_truncated: online.length > admitted.length,
    created_during_interval: 0,
    overlapping_dynamic_requests: 0,
    workers: [],
    finishing: null,
    stop_requested: false,
  };
  activeWorkerCpuCapture = capture;
  if (!workerCpuSupported) return;
  capture.workers = await Promise.all(
    admitted.map((record) => startWorkerObservation(record, startedAtMs))
  );
}

async function startWorkerObservation(record, startedAtMs) {
  const requestedAtMs = now();
  try {
    const startUsage = await record.worker.cpuUsage();
    const handle = await record.worker.startCpuProfile({
      sampleInterval: 0.1,
      maxBufferSize: maximumWorkerProfileSamples,
    });
    return {
      ordinal: record.ordinal,
      record,
      state: 'active',
      start_offset_ms: Math.max(0, now() - startedAtMs),
      start_request_offset_ms: Math.max(0, requestedAtMs - startedAtMs),
      start_usage: startUsage,
      handle,
    };
  } catch {
    return {
      ordinal: record.ordinal,
      record,
      state: record.exited ? 'exited_before_start' : 'start_failed',
      start_offset_ms: null,
      start_request_offset_ms: Math.max(0, requestedAtMs - startedAtMs),
      start_usage: null,
      handle: null,
    };
  }
}

async function finishWorkerCpuCapture(event, responseCommitOffsetMs) {
  const capture = activeWorkerCpuCapture;
  if (!capture || capture.event_id !== event?.id) return;
  if (capture.finishing) return capture.finishing;
  capture.stop_requested = true;
  capture.finishing = persistWorkerCpuCapture(capture, responseCommitOffsetMs).finally(() => {
    if (activeWorkerCpuCapture?.event_id === capture.event_id) activeWorkerCpuCapture = null;
  });
  return capture.finishing;
}

async function persistWorkerCpuCapture(capture, responseCommitOffsetMs) {
  const workers = await Promise.all(
    capture.workers.map((observation) =>
      finishWorkerObservation(observation, capture.started_at_ms)
    )
  );
  const retainedWorkers = workers.filter((worker) => worker.state === 'observed').length;
  const complete =
    capture.supported &&
    !capture.registry_truncated &&
    !capture.admitted_truncated &&
    capture.created_during_interval === 0 &&
    capture.online_at_admission === capture.registered_current &&
    retainedWorkers === capture.online_at_admission;
  const document = JSON.stringify({
    schema_version: 'codevetter-node-request-worker-cpu/v1',
    parent_event_id: capture.event_id,
    supported: capture.supported,
    response_commit_offset_ms:
      Number.isFinite(responseCommitOffsetMs) && responseCommitOffsetMs >= 0
        ? responseCommitOffsetMs
        : null,
    overlapping_dynamic_requests: capture.overlapping_dynamic_requests,
    inventory: {
      registered_total: capture.registered_total,
      registered_current: capture.registered_current,
      online_at_admission: capture.online_at_admission,
      attempted: capture.workers.length,
      retained: retainedWorkers,
      created_during_interval: capture.created_during_interval,
      registry_truncated: capture.registry_truncated,
      admitted_truncated: capture.admitted_truncated,
      complete,
    },
    workers: workers.map((worker) => ({
      ordinal: worker.ordinal,
      state: worker.state,
      start_request_offset_ms: worker.start_request_offset_ms,
      start_offset_ms: worker.start_offset_ms,
      stop_offset_ms: worker.stop_offset_ms,
      user_us: worker.user_us,
      system_us: worker.system_us,
      profile: worker.profile,
    })),
  });
  if (Buffer.byteLength(document) <= maximumCpuProfileBytes) {
    writeFileSync(join(directory, `worker-cpu-${process.pid}-${capture.sequence}.json`), document);
  }
}

async function finishWorkerObservation(observation, startedAtMs) {
  if (observation.state !== 'active') {
    return {
      ordinal: observation.ordinal,
      state: observation.state,
      start_request_offset_ms: observation.start_request_offset_ms,
      start_offset_ms: observation.start_offset_ms,
      stop_offset_ms: null,
      user_us: null,
      system_us: null,
      profile: null,
    };
  }
  const stopOffsetMs = Math.max(0, now() - startedAtMs);
  try {
    const [usage, rawProfile] = await Promise.all([
      observation.record.worker.cpuUsage(observation.start_usage),
      observation.handle.stop(),
    ]);
    const profile = normalizeWorkerRawProfile(rawProfile);
    if (!profile) throw new Error('invalid Worker profile');
    const userUs = safeCpuUsageValue(usage?.user);
    const systemUs = safeCpuUsageValue(usage?.system);
    if (userUs === null || systemUs === null) throw new Error('invalid Worker CPU usage');
    return {
      ordinal: observation.ordinal,
      state: 'observed',
      start_request_offset_ms: observation.start_request_offset_ms,
      start_offset_ms: observation.start_offset_ms,
      stop_offset_ms: stopOffsetMs,
      user_us: userUs,
      system_us: systemUs,
      profile,
    };
  } catch {
    try {
      await observation.handle?.stop();
    } catch {
      // A failed or already stopped handle carries no reusable evidence.
    }
    return {
      ordinal: observation.ordinal,
      state: observation.record.exited ? 'exited_before_stop' : 'stop_failed',
      start_request_offset_ms: observation.start_request_offset_ms,
      start_offset_ms: observation.start_offset_ms,
      stop_offset_ms: stopOffsetMs,
      user_us: null,
      system_us: null,
      profile: null,
    };
  }
}

function normalizeWorkerRawProfile(rawProfile) {
  try {
    const profile = typeof rawProfile === 'string' ? JSON.parse(rawProfile) : rawProfile;
    if (
      !profile ||
      !Array.isArray(profile.nodes) ||
      !Array.isArray(profile.samples) ||
      !Array.isArray(profile.timeDeltas) ||
      profile.samples.length > maximumWorkerProfileSamples ||
      profile.timeDeltas.length < profile.samples.length
    ) {
      return null;
    }
    return profile;
  } catch {
    return null;
  }
}

function safeCpuUsageValue(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function finishCpuProfile(event, responseCommitOffsetMs) {
  if (!cpuReady || activeCpuProfile?.event_id !== event?.id) return;
  const capture = activeCpuProfile;
  try {
    const result = await inspectorPost('Profiler.stop');
    const document = JSON.stringify({
      schema_version: 'codevetter-node-request-cpu-profile/v3',
      parent_event_id: capture.event_id,
      method: capture.method,
      route: capture.route,
      overlapping_dynamic_requests: capture.overlapping_dynamic_requests,
      overlapping_precommit_dynamic_requests: capture.overlapping_precommit_dynamic_requests,
      response_commit_offset_ms:
        Number.isFinite(responseCommitOffsetMs) && responseCommitOffsetMs >= 0
          ? responseCommitOffsetMs
          : null,
      profile: result?.profile ?? null,
    });
    if (Buffer.byteLength(document) <= maximumCpuProfileBytes) {
      writeFileSync(join(directory, `cpu-${process.pid}-${capture.sequence}.json`), document);
    }
  } catch {
    // Missing CPU evidence is non-fatal and never disrupts the request.
  } finally {
    if (activeCpuProfile?.event_id === capture.event_id) activeCpuProfile = null;
  }
}

async function finishContinuousSourceProfile(event, responseCommitOffsetMs) {
  const capture = activeContinuousSourceCapture;
  if (!capture || capture.event_id !== event?.id || capture.finished) {
    return capture?.finishing ?? null;
  }
  capture.finished = true;
  const stopStartedUs = monotonicMicroseconds();
  capture.finishing = (async () => {
    let profile = null;
    let captureReason = null;
    try {
      if (!continuousSourceReady) throw new Error('continuous profiler unavailable');
      const result = await inspectorPost('Profiler.stop');
      profile = result?.profile ?? null;
      if (
        !profile ||
        !Array.isArray(profile.nodes) ||
        !Array.isArray(profile.samples) ||
        !Array.isArray(profile.timeDeltas) ||
        profile.nodes.length > maximumContinuousSourceSamples ||
        profile.samples.length > maximumContinuousSourceSamples ||
        profile.timeDeltas.length !== profile.samples.length
      ) {
        profile = null;
        captureReason = 'profile_invalid';
      }
    } catch {
      captureReason = 'profile_unavailable';
      profile = null;
    }
    const stopTailMs = Math.max(0, (monotonicMicroseconds() - stopStartedUs) / 1_000);
    const base = {
      schema_version: 'codevetter-node-continuous-source-profile/v1',
      parent_event_id: capture.event_id,
      startup_attested: capture.startup_attested,
      target: capture.target,
      target_match_count: capture.target_match_count,
      response_committed: capture.response_committed,
      response_commit_offset_ms:
        Number.isFinite(responseCommitOffsetMs) && responseCommitOffsetMs >= 0
          ? responseCommitOffsetMs
          : 0,
      stop_tail_ms: stopTailMs,
      sampling_interval_us: continuousSourceSamplingIntervalUs,
      overlapping_dynamic_requests: Math.min(maximumEvents, capture.overlapping_dynamic_requests),
      overlapping_precommit_dynamic_requests: Math.min(
        maximumEvents,
        capture.overlapping_precommit_dynamic_requests
      ),
      capture_reason: captureReason,
      profile,
    };
    let document = JSON.stringify(base);
    if (Buffer.byteLength(document) > maximumCpuProfileBytes) {
      document = JSON.stringify({ ...base, capture_reason: 'profile_oversized', profile: null });
    }
    try {
      writeFileSync(join(directory, `continuous-source-${process.pid}.json`), document, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    } catch {
      // Missing private evidence is reported by the parent collector.
    }
    continuousSourceReady = false;
  })();
  return capture.finishing;
}

function inspectorPost(method, parameters = undefined) {
  return new Promise((resolvePromise, reject) => {
    if (!cpuSession) {
      reject(new Error('inspector unavailable'));
      return;
    }
    cpuSession.post(method, parameters, (error, result) => {
      if (error) reject(error);
      else resolvePromise(result);
    });
  });
}

if (directory) {
  try {
    const { DatabaseSync, StatementSync } = await import('node:sqlite');
    const originalPrepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function codeVetterSqlitePrepare(sql, ...args) {
      const statement = originalPrepare.call(this, sql, ...args);
      statementShapes.set(statement, normalizeSql(sql));
      return statement;
    };

    wrapSqliteMethod(DatabaseSync.prototype, 'exec', (_receiver, args) => ({
      operation: 'exec',
      statement: normalizeSql(args[0]),
    }));
    for (const operation of ['all', 'get', 'run']) {
      wrapSqliteMethod(StatementSync.prototype, operation, (receiver) => ({
        operation,
        statement: statementShapes.get(receiver) ?? '<unknown>',
      }));
    }
  } catch {
    // Older Node versions do not provide node:sqlite; coverage reports no database events.
  }
}

function wrapSqliteMethod(prototype, name, describe) {
  const original = prototype?.[name];
  if (typeof original !== 'function') return;
  prototype[name] = function codeVetterSqliteOperation(...args) {
    const parentEventId = currentParentId();
    if (!parentEventId) return original.apply(this, args);
    const startedAt = now();
    const event = reserve({
      kind: 'database',
      database: 'node_sqlite',
      ...describe(this, args),
      source: captureSource(),
      parent_event_id: parentEventId,
      outcome: null,
      started_at_ms: startedAt,
      duration_ms: null,
    });
    try {
      const result = original.apply(this, args);
      complete(event, { outcome: 'ok', duration_ms: Math.max(0, now() - startedAt) });
      return result;
    } catch (error) {
      complete(event, { outcome: 'error', duration_ms: Math.max(0, now() - startedAt) });
      throw error;
    }
  };
}

function flush() {
  if (flushed || !directory) return;
  flushed = true;
  try {
    writeFileSync(
      join(directory, `flow-${process.pid}.json`),
      JSON.stringify({ schema_version: 'codevetter-node-flow-events/v1', events })
    );
  } catch {
    // The parent process reports missing flow evidence; never disrupt the target workload.
  }
}

process.once('beforeExit', flush);
process.once('exit', flush);
