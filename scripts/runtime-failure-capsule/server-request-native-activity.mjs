import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const SERVER_REQUEST_NATIVE_ACTIVITY_SCHEMA_VERSION =
  'runtime-node-request-native-activity/v2';
export const SERVER_REQUEST_NATIVE_ACTIVITY_LEGACY_SCHEMA_VERSION =
  'runtime-node-request-native-activity/v1';
export const SERVER_REQUEST_NATIVE_ACTIVITY_MARKER_SCHEMA_VERSION =
  'codevetter-node-request-native-activity/v1';
export const SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS = Object.freeze({
  markers: 8,
  markerBytes: 32 * 1024,
  traceBytes: 128 * 1024 * 1024,
  traceReadChunkBytes: 256 * 1024,
  events: 50_000,
  eventBytes: 64 * 1024,
  mechanisms: 8,
});

const SUMMARY_STATES = new Set([
  'observed',
  'observed_zero',
  'unsupported',
  'incomplete',
  'contaminated',
  'invalid',
]);
const THREADPOOL_KINDS = [
  'crypto',
  'zlib',
  'filesystem',
  'dns',
  'network',
  'node_api',
  'blob',
  'other',
];
const V8_KINDS = ['gc', 'compilation'];
const INCOMPLETE_REASONS = new Set([
  'marker_invalid',
  'runtime_unsupported',
  'overlapping_dynamic_requests',
  'trace_disable_failed',
  'trace_invalid',
  'trace_oversized',
  'trace_unavailable',
  'trace_truncated',
  'trace_interval_incomplete',
]);

export async function collectServerRequestNativeActivity(directory, { eventIds = [] } = {}) {
  const admitted = new Set(eventIds.filter(safeEventId));
  let names;
  try {
    names = (await readdir(directory))
      .filter((name) => /^native-activity-\d+-\d+\.json$/.test(name))
      .sort()
      .slice(0, SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.markers);
  } catch {
    return new Map();
  }
  const markers = [];
  for (const name of names) {
    try {
      const path = join(directory, name);
      const metadata = await lstat(path);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.size > SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.markerBytes
      ) {
        continue;
      }
      const marker = JSON.parse(
        await readBoundedFile(path, SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.markerBytes)
      );
      if (
        validMarker(marker) &&
        admitted.has(marker.parent_event_id) &&
        !markers.some((candidate) => candidate.parent_event_id === marker.parent_event_id)
      ) {
        markers.push(marker);
      }
    } catch {
      // Private marker failures never disrupt the browser capture.
    }
  }
  if (markers.length === 0) return new Map();

  let trace;
  let parserState = 'complete';
  try {
    const path = join(directory, 'native-trace.json');
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('unsafe trace file');
    if (metadata.size > SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.traceBytes) {
      parserState = 'oversized';
      trace = [];
    } else {
      const parsed = await scanTraceEventFile(path, markers);
      trace = parsed.events;
      parserState = parsed.state;
    }
  } catch {
    trace = [];
    parserState = 'unavailable';
  }

  return new Map(
    markers.map((marker) => [
      marker.parent_event_id,
      normalizeNativeActivity(marker, trace, parserState),
    ])
  );
}

export async function scanTraceEventFile(
  path,
  markers,
  {
    maximumBytes = SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.traceBytes,
    chunkBytes = SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.traceReadChunkBytes,
  } = {}
) {
  if (
    !Array.isArray(markers) ||
    markers.length < 1 ||
    markers.length > SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.markers ||
    markers.some((marker) => !validMarker(marker)) ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.traceBytes ||
    !Number.isSafeInteger(chunkBytes) ||
    chunkBytes < 1 ||
    chunkBytes > SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.traceReadChunkBytes
  ) {
    return { state: 'invalid', events: [] };
  }
  const signature = Buffer.from('"traceEvents"');
  const handle = await open(path, 'r');
  const buffer = Buffer.alloc(chunkBytes);
  const events = [];
  let bytesScanned = 0;
  let signatureIndex = 0;
  let keyFound = false;
  let arrayStarted = false;
  let arrayClosed = false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let current = [];
  try {
    while (!arrayClosed) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, bytesScanned);
      if (bytesRead === 0) break;
      bytesScanned += bytesRead;
      if (bytesScanned > maximumBytes) return { state: 'oversized', events: [] };
      for (let index = 0; index < bytesRead; index += 1) {
        const byte = buffer[index];
        if (!arrayStarted) {
          if (!keyFound) {
            if (byte === signature[signatureIndex]) signatureIndex += 1;
            else signatureIndex = byte === signature[0] ? 1 : 0;
            if (signatureIndex === signature.length) keyFound = true;
          } else if (byte === 0x5b) {
            arrayStarted = true;
          }
          continue;
        }
        if (depth === 0) {
          if (byte === 0x7b) {
            depth = 1;
            current = [byte];
          } else if (byte === 0x5d) {
            arrayClosed = true;
            break;
          } else if (![0x09, 0x0a, 0x0d, 0x20, 0x2c].includes(byte)) {
            return { state: 'invalid', events: [] };
          }
          continue;
        }
        current.push(byte);
        if (current.length > SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.eventBytes) {
          return { state: 'oversized', events: [] };
        }
        if (inString) {
          if (escaped) escaped = false;
          else if (byte === 0x5c) escaped = true;
          else if (byte === 0x22) inString = false;
          continue;
        }
        if (byte === 0x22) inString = true;
        else if (byte === 0x7b) depth += 1;
        else if (byte === 0x7d) {
          depth -= 1;
          if (depth === 0) {
            let event;
            try {
              event = JSON.parse(Buffer.from(current).toString('utf8'));
            } catch {
              return { state: 'invalid', events: [] };
            }
            if (traceEventTouchesMarkers(event, markers)) events.push(event);
            if (events.length > SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.events) {
              return { state: 'oversized', events: [] };
            }
            current = [];
          }
        }
      }
    }
  } finally {
    await handle.close();
  }
  if (!arrayStarted) return { state: 'invalid', events: [] };
  if (depth > 0 || inString || escaped) return { state: 'truncated', events: [] };
  return { state: arrayClosed ? 'complete' : 'live_partial', events };
}

function traceEventTouchesMarkers(event, markers) {
  if (!classifyEvent(event)) return false;
  if (!finiteNonnegative(event?.ts)) return true;
  if (event.ph === 'X') {
    if (!finiteNonnegative(event.dur)) return true;
    return markers.some(
      (marker) => event.ts <= marker.stop_us && event.ts + event.dur >= marker.start_us
    );
  }
  return markers.some((marker) => event.ts >= marker.start_us && event.ts <= marker.stop_us);
}

export function scanCompleteTraceEvents(text) {
  if (
    typeof text !== 'string' ||
    Buffer.byteLength(text) > SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.traceBytes
  ) {
    return { state: 'oversized', events: [] };
  }
  const prefix = /^\s*\{\s*"traceEvents"\s*:\s*\[/.exec(text);
  if (!prefix) return { state: 'invalid', events: [] };
  const bracket = prefix[0].lastIndexOf('[');
  const events = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let arrayClosed = false;
  for (let index = bracket + 1; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character === '}') {
      if (depth === 0) return { state: 'invalid', events: [] };
      depth -= 1;
      if (depth === 0) {
        const raw = text.slice(start, index + 1);
        if (Buffer.byteLength(raw) > SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.eventBytes) {
          return { state: 'oversized', events: [] };
        }
        try {
          events.push(JSON.parse(raw));
        } catch {
          return { state: 'invalid', events: [] };
        }
        if (events.length > SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.events) {
          return { state: 'oversized', events: [] };
        }
      }
      continue;
    }
    if (character === ']' && depth === 0) {
      arrayClosed = true;
      break;
    }
    if (depth === 0 && !/[\s,]/.test(character)) {
      return { state: 'invalid', events: [] };
    }
  }
  if (inString || escaped) return { state: 'truncated', events: [] };
  return { state: arrayClosed ? 'complete' : 'live_partial', events };
}

export function normalizeNativeActivity(marker, traceEvents, parserState = 'complete') {
  if (!validMarker(marker)) return emptySummary('invalid', 'marker_invalid');
  if (!marker.supported)
    return summaryFrom(
      marker,
      'unsupported',
      emptyGroup(),
      emptyGroup(),
      false,
      0,
      'runtime_unsupported'
    );
  if (marker.overlapping_dynamic_requests > 0) {
    return summaryFrom(
      marker,
      'contaminated',
      emptyGroup(),
      emptyGroup(),
      false,
      0,
      'overlapping_dynamic_requests'
    );
  }
  if (!marker.complete || !['complete', 'live_partial'].includes(parserState)) {
    const reason = !marker.complete ? 'trace_disable_failed' : `trace_${parserState}`;
    return summaryFrom(
      marker,
      parserState === 'invalid' ? 'invalid' : 'incomplete',
      emptyGroup(),
      emptyGroup(),
      false,
      0,
      reason
    );
  }
  const normalized = normalizeIntervals(traceEvents, marker.start_us, marker.stop_us);
  if (!normalized.complete) {
    return summaryFrom(
      marker,
      'incomplete',
      emptyGroup(),
      emptyGroup(),
      false,
      normalized.eventsSeen,
      'trace_interval_incomplete'
    );
  }
  const threadpool = aggregate(normalized.intervals.filter((item) => item.group === 'threadpool'));
  const v8 = aggregate(normalized.intervals.filter((item) => item.group === 'v8'));
  const state =
    threadpool.mechanisms.length + v8.mechanisms.length === 0 ? 'observed_zero' : 'observed';
  return summaryFrom(marker, state, threadpool, v8, true, normalized.eventsSeen);
}

function normalizeIntervals(events, startUs, stopUs) {
  if (!Array.isArray(events)) return { complete: false, intervals: [], eventsSeen: 0 };
  const stacks = new Map();
  const intervals = [];
  let eventsSeen = 0;
  for (const event of events) {
    const classified = classifyEvent(event);
    if (!classified) continue;
    eventsSeen += 1;
    if (event.ph === 'X') {
      if (!finiteNonnegative(event.ts) || !finiteNonnegative(event.dur)) {
        return { complete: false, intervals: [], eventsSeen };
      }
      retainInterval(intervals, classified, event.ts, event.ts + event.dur, startUs, stopUs);
      continue;
    }
    const key = pairKey(event, classified);
    if (!key || !finiteNonnegative(event.ts)) {
      return { complete: false, intervals: [], eventsSeen };
    }
    if (event.ph === 'B') {
      const stack = stacks.get(key) ?? [];
      stack.push(event.ts);
      stacks.set(key, stack);
    } else if (event.ph === 'E') {
      const stack = stacks.get(key);
      const began = stack?.pop();
      if (!finiteNonnegative(began) || event.ts < began) {
        if (event.ts >= startUs && event.ts <= stopUs)
          return { complete: false, intervals: [], eventsSeen };
        continue;
      }
      retainInterval(intervals, classified, began, event.ts, startUs, stopUs);
    }
  }
  for (const [key, stack] of stacks) {
    if (stack.some((began) => began < stopUs) && key) {
      return { complete: false, intervals: [], eventsSeen };
    }
  }
  return { complete: true, intervals, eventsSeen };
}

function classifyEvent(event) {
  if (!event || typeof event !== 'object' || typeof event.cat !== 'string') return null;
  const categories = new Set(event.cat.split(',').map((value) => value.trim()));
  if (categories.has('node.threadpoolwork.sync') && ['B', 'E', 'X'].includes(event.ph)) {
    return { group: 'threadpool', kind: threadpoolKind(event.name) };
  }
  if (categories.has('v8') && ['B', 'E', 'X'].includes(event.ph)) {
    const kind = v8Kind(event.name);
    return kind ? { group: 'v8', kind } : null;
  }
  return null;
}

function threadpoolKind(name) {
  const value = typeof name === 'string' ? name.toLowerCase() : '';
  if (/pbkdf|scrypt|crypto|random|key|sign|verify/.test(value)) return 'crypto';
  if (/zlib|deflate|inflate|gzip|brotli/.test(value)) return 'zlib';
  if (/fs|file/.test(value)) return 'filesystem';
  if (/dns|addrinfo|nameinfo/.test(value)) return 'dns';
  if (/net|tcp|udp/.test(value)) return 'network';
  if (/node.?api|napi/.test(value)) return 'node_api';
  if (/blob/.test(value)) return 'blob';
  return 'other';
}

function v8Kind(name) {
  const value = typeof name === 'string' ? name : '';
  if (/GC|Scavenge|Mark|Sweep|Compactor/.test(value)) return 'gc';
  if (/Compile|Code|Deopt|Optimize/.test(value)) return 'compilation';
  return null;
}

function pairKey(event, classified) {
  if (
    !Number.isSafeInteger(event.pid) ||
    !Number.isSafeInteger(event.tid) ||
    typeof event.name !== 'string'
  ) {
    return null;
  }
  return `${event.pid}:${event.tid}:${event.cat}:${event.name}:${classified.group}:${classified.kind}`;
}

function retainInterval(target, classified, rawStart, rawStop, startUs, stopUs) {
  const start = Math.max(startUs, rawStart);
  const stop = Math.min(stopUs, rawStop);
  if (stop > start) target.push({ ...classified, start, stop });
}

function aggregate(intervals) {
  const order = intervals.some((item) => item.group === 'threadpool') ? THREADPOOL_KINDS : V8_KINDS;
  const mechanisms = order
    .map((kind) => {
      const selected = intervals.filter((item) => item.kind === kind);
      if (selected.length === 0) return null;
      return {
        kind,
        count: selected.length,
        union_activity_ms: round3(unionDuration(selected) / 1_000),
      };
    })
    .filter(Boolean)
    .slice(0, SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.mechanisms);
  return { mechanisms, unionActivityMs: round3(unionDuration(intervals) / 1_000) };
}

function unionDuration(intervals) {
  const sorted = intervals.toSorted(
    (left, right) => left.start - right.start || left.stop - right.stop
  );
  let total = 0;
  let start = null;
  let stop = null;
  for (const interval of sorted) {
    if (start === null) {
      start = interval.start;
      stop = interval.stop;
    } else if (interval.start <= stop) {
      stop = Math.max(stop, interval.stop);
    } else {
      total += stop - start;
      start = interval.start;
      stop = interval.stop;
    }
  }
  return start === null ? 0 : total + stop - start;
}

function summaryFrom(
  marker,
  state,
  threadpool,
  v8,
  complete,
  eventsSeen = 0,
  incompleteReason = null
) {
  const responseOffset = finiteNonnegative(marker.response_commit_offset_ms)
    ? round3(marker.response_commit_offset_ms)
    : null;
  const intervalMs = finiteNonnegative(marker.stop_us - marker.start_us)
    ? round3((marker.stop_us - marker.start_us) / 1_000)
    : null;
  return assertServerRequestNativeActivitySummary({
    schema_version: SERVER_REQUEST_NATIVE_ACTIVITY_SCHEMA_VERSION,
    state,
    incomplete_reason: incompleteReason,
    response_commit_offset_ms: responseOffset,
    interval_ms: intervalMs,
    overlapping_dynamic_requests: marker.overlapping_dynamic_requests ?? 0,
    inventory: {
      events_seen: Math.min(SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.events, eventsSeen),
      intervals_retained:
        threadpool.mechanisms.reduce((total, item) => total + item.count, 0) +
        v8.mechanisms.reduce((total, item) => total + item.count, 0),
      complete,
    },
    threadpool: activityGroup(threadpool),
    v8: activityGroup(v8),
    complete,
    observer_effect: 'node_trace_events_enabled_before_handler_dispatch',
    provenance: 'bounded_request_scoped_node_trace_events',
  });
}

function activityGroup(mechanisms) {
  const values = Array.isArray(mechanisms) ? { mechanisms, unionActivityMs: 0 } : mechanisms;
  return {
    total_count: values.mechanisms.reduce((total, item) => total + item.count, 0),
    union_activity_ms: values.unionActivityMs,
    mechanisms: values.mechanisms,
  };
}

function emptyGroup() {
  return { mechanisms: [], unionActivityMs: 0 };
}

function emptySummary(state, incompleteReason) {
  return assertServerRequestNativeActivitySummary({
    schema_version: SERVER_REQUEST_NATIVE_ACTIVITY_SCHEMA_VERSION,
    state,
    incomplete_reason: incompleteReason,
    response_commit_offset_ms: null,
    interval_ms: null,
    overlapping_dynamic_requests: 0,
    inventory: { events_seen: 0, intervals_retained: 0, complete: false },
    threadpool: activityGroup([]),
    v8: activityGroup([]),
    complete: false,
    observer_effect: 'node_trace_events_enabled_before_handler_dispatch',
    provenance: 'bounded_request_scoped_node_trace_events',
  });
}

export function assertServerRequestNativeActivitySummary(value) {
  const current = value?.schema_version === SERVER_REQUEST_NATIVE_ACTIVITY_SCHEMA_VERSION;
  if (
    !closedObject(value, [
      'schema_version',
      'state',
      ...(current ? ['incomplete_reason'] : []),
      'response_commit_offset_ms',
      'interval_ms',
      'overlapping_dynamic_requests',
      'inventory',
      'threadpool',
      'v8',
      'complete',
      'observer_effect',
      'provenance',
    ]) ||
    ![
      SERVER_REQUEST_NATIVE_ACTIVITY_SCHEMA_VERSION,
      SERVER_REQUEST_NATIVE_ACTIVITY_LEGACY_SCHEMA_VERSION,
    ].includes(value.schema_version) ||
    !SUMMARY_STATES.has(value.state) ||
    (current &&
      (['observed', 'observed_zero'].includes(value.state)
        ? value.incomplete_reason !== null
        : !INCOMPLETE_REASONS.has(value.incomplete_reason))) ||
    (value.response_commit_offset_ms !== null &&
      !finiteNonnegative(value.response_commit_offset_ms)) ||
    (value.interval_ms !== null && !finiteNonnegative(value.interval_ms)) ||
    !Number.isSafeInteger(value.overlapping_dynamic_requests) ||
    value.overlapping_dynamic_requests < 0 ||
    value.overlapping_dynamic_requests > 128 ||
    !closedObject(value.inventory, ['events_seen', 'intervals_retained', 'complete']) ||
    !boundedInteger(value.inventory.events_seen, SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.events) ||
    !boundedInteger(
      value.inventory.intervals_retained,
      SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.events
    ) ||
    typeof value.inventory.complete !== 'boolean' ||
    !validActivityGroup(value.threadpool, THREADPOOL_KINDS) ||
    !validActivityGroup(value.v8, V8_KINDS) ||
    (value.complete &&
      (!finiteNonnegative(value.interval_ms) ||
        value.threadpool.union_activity_ms > value.interval_ms + 0.002 ||
        value.v8.union_activity_ms > value.interval_ms + 0.002)) ||
    typeof value.complete !== 'boolean' ||
    value.complete !== value.inventory.complete ||
    !(['observed', 'observed_zero'].includes(value.state) ? value.complete : !value.complete) ||
    (value.state === 'observed_zero' &&
      (value.threadpool.total_count !== 0 || value.v8.total_count !== 0)) ||
    (value.state === 'observed' && value.threadpool.total_count + value.v8.total_count === 0) ||
    value.observer_effect !== 'node_trace_events_enabled_before_handler_dispatch' ||
    value.provenance !== 'bounded_request_scoped_node_trace_events'
  ) {
    throw new Error('server request native-activity summary is invalid');
  }
  return value;
}

export function validServerRequestNativeActivitySummary(value) {
  try {
    assertServerRequestNativeActivitySummary(value);
    return true;
  } catch {
    return false;
  }
}

function validActivityGroup(value, kinds) {
  if (
    !closedObject(value, ['total_count', 'union_activity_ms', 'mechanisms']) ||
    !boundedInteger(value.total_count, SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.events) ||
    !finiteNonnegative(value.union_activity_ms) ||
    !Array.isArray(value.mechanisms) ||
    value.mechanisms.length > kinds.length ||
    value.mechanisms.some(
      (item) =>
        !closedObject(item, ['kind', 'count', 'union_activity_ms']) ||
        !kinds.includes(item.kind) ||
        !boundedInteger(item.count, SERVER_REQUEST_NATIVE_ACTIVITY_LIMITS.events) ||
        item.count < 1 ||
        !finiteNonnegative(item.union_activity_ms) ||
        item.union_activity_ms > value.union_activity_ms + 0.002
    ) ||
    new Set(value.mechanisms.map((item) => item.kind)).size !== value.mechanisms.length
  ) {
    return false;
  }
  return value.total_count === value.mechanisms.reduce((total, item) => total + item.count, 0);
}

function validMarker(value) {
  return (
    closedObject(value, [
      'schema_version',
      'parent_event_id',
      'supported',
      'start_us',
      'stop_us',
      'response_commit_offset_ms',
      'overlapping_dynamic_requests',
      'complete',
    ]) &&
    value.schema_version === SERVER_REQUEST_NATIVE_ACTIVITY_MARKER_SCHEMA_VERSION &&
    safeEventId(value.parent_event_id) &&
    typeof value.supported === 'boolean' &&
    Number.isSafeInteger(value.start_us) &&
    value.start_us >= 0 &&
    Number.isSafeInteger(value.stop_us) &&
    value.stop_us >= 0 &&
    value.stop_us >= value.start_us &&
    (value.response_commit_offset_ms === null ||
      finiteNonnegative(value.response_commit_offset_ms)) &&
    boundedInteger(value.overlapping_dynamic_requests, 128) &&
    typeof value.complete === 'boolean'
  );
}

function safeEventId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(value);
}

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function boundedInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function round3(value) {
  return Math.round(value * 1_000) / 1_000;
}

async function readBoundedFile(path, maximumBytes) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(maximumBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximumBytes) throw new Error('bounded private artifact exceeded its limit');
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    await handle.close();
  }
}

function closedObject(value, fields) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}
