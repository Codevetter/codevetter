import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { scanCompleteTraceEvents } from './server-request-native-activity.mjs';
import {
  V8_HEAP_PROFILE_INTERVAL_BYTES,
  V8_HEAP_COLLECTION_SCOPE,
  isMaterialV8HeapCandidate,
  parseV8HeapProfileDocuments,
} from './v8-heap-profile.mjs';

export const SERVER_REQUEST_GC_PRESSURE_SCHEMA_VERSION = 'runtime-node-request-gc-pressure/v1';
export const SERVER_REQUEST_GC_PRESSURE_MARKER_SCHEMA_VERSION =
  'codevetter-node-request-gc-pressure/v1';
export const SERVER_REQUEST_GC_PRESSURE_LIMITS = Object.freeze({
  markers: 8,
  markerBytes: 64 * 1024,
  profileBytes: 16 * 1024 * 1024,
  candidates: 8,
  retryCount: 5,
  retryDelayMs: 20,
  minimumGcUnionMs: 5,
});

const GC_KINDS = Object.freeze(['minor', 'major', 'incremental', 'weak_callbacks', 'other']);
const HEAP_FIELDS = Object.freeze([
  'rss_bytes',
  'heap_total_bytes',
  'heap_used_bytes',
  'external_bytes',
  'array_buffers_bytes',
]);

export async function collectServerRequestGcPressure(
  directory,
  { repositoryRoot, eventIds = [] } = {}
) {
  const admitted = new Set(eventIds.filter(safeEventId));
  const markers = await loadMarkersWithBoundedRetry(directory, admitted);
  if (markers.length === 0) return new Map();
  const trace = await loadTrace(directory);
  const output = [];
  for (const marker of markers) {
    output.push([
      marker.parent_event_id,
      await normalizeMarker(directory, repositoryRoot, marker, trace),
    ]);
  }
  return new Map(output);
}

export async function normalizeGcPressureEvidence({
  marker,
  traceEvents,
  traceState = 'complete',
  profile,
  repositoryRoot,
  profileBytes = null,
}) {
  if (!validMarker(marker)) return incompleteSummary('invalid_marker');
  if (!marker.supported) return incompleteSummary('unsupported');
  if (marker.overlapping_dynamic_requests > 0) return incompleteSummary('contaminated');
  if (!marker.complete || !['complete', 'live_partial'].includes(traceState)) {
    return incompleteSummary('incomplete_artifact');
  }
  const gc = normalizeGcIntervals(traceEvents, marker.start_us, marker.stop_us);
  if (!gc.complete) return incompleteSummary('incomplete_trace');
  const parsed = parseV8HeapProfileDocuments(profile ? [profile] : [], repositoryRoot);
  const profileComplete =
    profile !== null &&
    parsed.truncated === false &&
    Number.isSafeInteger(profileBytes) &&
    profileBytes > 0 &&
    profileBytes === marker.profile_bytes;
  if (!profileComplete) return incompleteSummary('incomplete_profile');

  const candidates = parsed.hotspots
    .filter((hotspot) => hotspot.role === 'application')
    .filter((hotspot) => isMaterialV8HeapCandidate(hotspot, parsed))
    .slice(0, SERVER_REQUEST_GC_PRESSURE_LIMITS.candidates)
    .map((hotspot) => ({
      source: {
        file: hotspot.file,
        line: hotspot.line,
        function: hotspot.function,
        provenance: 'request_scoped_v8_sampling_heap_profile',
      },
      sampled_bytes: hotspot.sampled_bytes,
      sample_share: hotspot.sample_share,
      application_function_share:
        parsed.application_sampled_bytes > 0
          ? round6(hotspot.sampled_bytes / parsed.application_sampled_bytes)
          : 0,
    }));
  const materialGc = gc.union_activity_ms >= SERVER_REQUEST_GC_PRESSURE_LIMITS.minimumGcUnionMs;
  const state = !materialGc ? 'insufficient' : candidates.length > 0 ? 'observed' : 'unresolved';
  const heap = normalizeHeap(marker.heap_before, marker.heap_commit);
  const leading = candidates[0] ?? null;
  return assertServerRequestGcPressureSummary({
    schema_version: SERVER_REQUEST_GC_PRESSURE_SCHEMA_VERSION,
    state,
    interval: {
      response_commit_offset_ms: round3(marker.response_commit_offset_ms),
      overlapping_dynamic_requests: marker.overlapping_dynamic_requests,
      complete: true,
    },
    gc,
    heap,
    allocations: {
      sampling_interval_bytes: marker.sampling_interval_bytes,
      collection_scope: marker.collection_scope,
      profile_samples: parsed.profile_samples,
      sampled_bytes: parsed.sampled_bytes,
      application_sampled_bytes: parsed.application_sampled_bytes,
      inventory: {
        total: candidates.length,
        retained: candidates.length,
        complete: true,
      },
      candidates,
      complete: true,
    },
    route: {
      classification:
        state === 'observed'
          ? 'gc_allocation_repository'
          : state === 'insufficient'
            ? 'gc_pressure_insufficient'
            : 'gc_pressure_unresolved',
      dominant_gc_kind: dominantGcKind(gc),
      observed_union_activity_ms: gc.union_activity_ms,
      leading_source: state === 'observed' ? (leading?.source ?? null) : null,
      source_inspection_eligible: state === 'observed',
      edit_eligible: false,
      confidence: 'low',
    },
    complete: true,
    provenance: 'request_scoped_node_trace_heap_observation_and_v8_allocation_sampling',
    limitations: limitations(),
  });
}

async function normalizeMarker(directory, repositoryRoot, marker, trace) {
  let profile = null;
  let profileBytes = null;
  try {
    const path = join(directory, marker.profile_file);
    const metadata = await lstat(path);
    if (
      metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      metadata.size > 0 &&
      metadata.size <= SERVER_REQUEST_GC_PRESSURE_LIMITS.profileBytes
    ) {
      profileBytes = metadata.size;
      profile = JSON.parse(
        await readBoundedFile(path, SERVER_REQUEST_GC_PRESSURE_LIMITS.profileBytes)
      );
    }
  } catch {
    profile = null;
  }
  return normalizeGcPressureEvidence({
    marker,
    traceEvents: trace.events,
    traceState: trace.state,
    profile,
    profileBytes,
    repositoryRoot,
  });
}

function normalizeGcIntervals(events, startUs, stopUs) {
  if (!Array.isArray(events)) return emptyGc(false);
  const stacks = new Map();
  const intervals = [];
  for (const event of events) {
    const kind = gcKind(event);
    if (!kind) continue;
    if (event.ph === 'X') {
      if (!finiteNonnegative(event.ts) || !finiteNonnegative(event.dur)) return emptyGc(false);
      retainInterval(intervals, kind, event.ts, event.ts + event.dur, startUs, stopUs);
      continue;
    }
    const key = pairKey(event, kind);
    if (!key || !finiteNonnegative(event.ts)) return emptyGc(false);
    if (event.ph === 'B') {
      const stack = stacks.get(key) ?? [];
      stack.push(event.ts);
      stacks.set(key, stack);
    } else {
      const stack = stacks.get(key);
      const began = stack?.pop();
      if (!finiteNonnegative(began) || event.ts < began) {
        if (event.ts >= startUs && event.ts <= stopUs) return emptyGc(false);
        continue;
      }
      retainInterval(intervals, kind, began, event.ts, startUs, stopUs);
    }
  }
  for (const stack of stacks.values()) {
    if (stack.some((began) => began < stopUs)) return emptyGc(false);
  }
  const kinds = GC_KINDS.map((kind) => {
    const selected = intervals.filter((interval) => interval.kind === kind);
    return selected.length === 0
      ? null
      : {
          kind,
          interval_count: selected.length,
          union_activity_ms: round3(unionMicroseconds(selected) / 1000),
          longest_interval_ms: round3(
            Math.max(...selected.map((interval) => interval.stop - interval.start)) / 1000
          ),
        };
  }).filter(Boolean);
  return {
    total_interval_count: intervals.length,
    union_activity_ms: round3(unionMicroseconds(intervals) / 1000),
    longest_interval_ms:
      intervals.length === 0
        ? 0
        : round3(Math.max(...intervals.map((interval) => interval.stop - interval.start)) / 1000),
    kinds,
    complete: true,
  };
}

function gcKind(event) {
  if (
    !event ||
    typeof event !== 'object' ||
    typeof event.cat !== 'string' ||
    !event.cat
      .split(',')
      .map((value) => value.trim())
      .includes('v8') ||
    !['B', 'E', 'X'].includes(event.ph) ||
    typeof event.name !== 'string'
  ) {
    return null;
  }
  const name = event.name.toLowerCase();
  if (!/gc|scavenge|mark|sweep|compact|weak/.test(name)) return null;
  if (/scavenge|minor/.test(name)) return 'minor';
  if (/incremental/.test(name)) return 'incremental';
  if (/weak/.test(name)) return 'weak_callbacks';
  if (/major|mark.?sweep|mark.?compact|full.?gc|sweep.?compact/.test(name)) return 'major';
  return 'other';
}

function pairKey(event, kind) {
  return Number.isSafeInteger(event.pid) &&
    Number.isSafeInteger(event.tid) &&
    typeof event.name === 'string'
    ? `${event.pid}:${event.tid}:${event.cat}:${event.name}:${kind}`
    : null;
}

function retainInterval(target, kind, rawStart, rawStop, startUs, stopUs) {
  const start = Math.max(startUs, rawStart);
  const stop = Math.min(stopUs, rawStop);
  if (stop > start) target.push({ kind, start, stop });
}

function unionMicroseconds(intervals) {
  const ordered = intervals
    .map(({ start, stop }) => ({ start, stop }))
    .toSorted((left, right) => left.start - right.start || left.stop - right.stop);
  let total = 0;
  let activeStart = null;
  let activeStop = null;
  for (const interval of ordered) {
    if (activeStart === null) {
      activeStart = interval.start;
      activeStop = interval.stop;
    } else if (interval.start <= activeStop) {
      activeStop = Math.max(activeStop, interval.stop);
    } else {
      total += activeStop - activeStart;
      activeStart = interval.start;
      activeStop = interval.stop;
    }
  }
  return activeStart === null ? 0 : total + activeStop - activeStart;
}

function normalizeHeap(before, commit) {
  const delta = Object.fromEntries(
    HEAP_FIELDS.map((field) => [field, commit[field] - before[field]])
  );
  return { before, commit, delta, complete: true };
}

function dominantGcKind(gc) {
  return (
    gc.kinds.toSorted(
      (left, right) =>
        right.union_activity_ms - left.union_activity_ms ||
        right.interval_count - left.interval_count ||
        GC_KINDS.indexOf(left.kind) - GC_KINDS.indexOf(right.kind)
    )[0]?.kind ?? null
  );
}

export function createIncompleteGcPressureSummary(reason = 'unavailable') {
  return assertServerRequestGcPressureSummary({
    schema_version: SERVER_REQUEST_GC_PRESSURE_SCHEMA_VERSION,
    state: 'incomplete',
    interval: {
      response_commit_offset_ms: null,
      overlapping_dynamic_requests: 0,
      complete: false,
    },
    gc: emptyGc(false),
    heap: { before: null, commit: null, delta: null, complete: false },
    allocations: {
      sampling_interval_bytes: V8_HEAP_PROFILE_INTERVAL_BYTES,
      collection_scope: V8_HEAP_COLLECTION_SCOPE,
      profile_samples: 0,
      sampled_bytes: 0,
      application_sampled_bytes: 0,
      inventory: { total: 0, retained: 0, complete: false },
      candidates: [],
      complete: false,
    },
    route: {
      classification: `gc_pressure_${reason}`,
      dominant_gc_kind: null,
      observed_union_activity_ms: null,
      leading_source: null,
      source_inspection_eligible: false,
      edit_eligible: false,
      confidence: 'low',
    },
    complete: false,
    provenance: 'request_scoped_node_trace_heap_observation_and_v8_allocation_sampling',
    limitations: limitations(),
  });
}

const incompleteSummary = createIncompleteGcPressureSummary;

function emptyGc(complete) {
  return {
    total_interval_count: 0,
    union_activity_ms: 0,
    longest_interval_ms: 0,
    kinds: [],
    complete,
  };
}

function limitations() {
  return [
    'GC trace values are elapsed union activity, not exact or exclusive CPU.',
    'Heap deltas are process observations and allocation samples are neither exact allocated bytes nor retained bytes.',
    'A sampled repository callsite is non-causal, low-confidence, source-inspection evidence and never edit authority.',
  ];
}

export function assertServerRequestGcPressureSummary(value) {
  if (
    !closed(value, [
      'schema_version',
      'state',
      'interval',
      'gc',
      'heap',
      'allocations',
      'route',
      'complete',
      'provenance',
      'limitations',
    ]) ||
    value.schema_version !== SERVER_REQUEST_GC_PRESSURE_SCHEMA_VERSION ||
    !['observed', 'insufficient', 'unresolved', 'incomplete'].includes(value.state) ||
    !validInterval(value.interval) ||
    !validGc(value.gc) ||
    !validHeap(value.heap) ||
    !validAllocations(value.allocations) ||
    !validRoute(value.route) ||
    typeof value.complete !== 'boolean' ||
    value.complete !==
      (value.interval.complete &&
        value.gc.complete &&
        value.heap.complete &&
        value.allocations.complete) ||
    (value.state === 'incomplete') !== !value.complete ||
    value.provenance !== 'request_scoped_node_trace_heap_observation_and_v8_allocation_sampling' ||
    !Array.isArray(value.limitations) ||
    value.limitations.length !== 3 ||
    value.limitations.some((item) => typeof item !== 'string')
  ) {
    throw new Error('server request GC pressure summary is invalid');
  }
  const material =
    value.complete &&
    value.gc.union_activity_ms >= SERVER_REQUEST_GC_PRESSURE_LIMITS.minimumGcUnionMs;
  if (
    (value.state === 'insufficient') !== (value.complete && !material) ||
    (value.state === 'observed') !== (material && value.allocations.candidates.length > 0) ||
    (value.state === 'unresolved') !== (material && value.allocations.candidates.length === 0) ||
    value.route.source_inspection_eligible !== (value.state === 'observed') ||
    value.route.edit_eligible !== false ||
    JSON.stringify(value.route.leading_source) !==
      JSON.stringify(
        value.state === 'observed' ? (value.allocations.candidates[0]?.source ?? null) : null
      )
  ) {
    throw new Error('server request GC pressure summary is inconsistent');
  }
  return value;
}

export function validServerRequestGcPressureSummary(value) {
  try {
    assertServerRequestGcPressureSummary(value);
    return true;
  } catch {
    return false;
  }
}

function validInterval(value) {
  return (
    closed(value, ['response_commit_offset_ms', 'overlapping_dynamic_requests', 'complete']) &&
    (value.response_commit_offset_ms === null ||
      finiteNonnegative(value.response_commit_offset_ms)) &&
    safeCount(value.overlapping_dynamic_requests) &&
    typeof value.complete === 'boolean' &&
    value.complete ===
      (value.response_commit_offset_ms !== null && value.overlapping_dynamic_requests === 0)
  );
}

function validGc(value) {
  return (
    closed(value, [
      'total_interval_count',
      'union_activity_ms',
      'longest_interval_ms',
      'kinds',
      'complete',
    ]) &&
    safeCount(value.total_interval_count) &&
    finiteNonnegative(value.union_activity_ms) &&
    finiteNonnegative(value.longest_interval_ms) &&
    Array.isArray(value.kinds) &&
    value.kinds.length <= GC_KINDS.length &&
    new Set(value.kinds.map((item) => item?.kind)).size === value.kinds.length &&
    value.kinds.every(validGcKind) &&
    value.kinds.reduce((total, item) => total + item.interval_count, 0) ===
      value.total_interval_count &&
    typeof value.complete === 'boolean'
  );
}

function validGcKind(value) {
  return (
    closed(value, ['kind', 'interval_count', 'union_activity_ms', 'longest_interval_ms']) &&
    GC_KINDS.includes(value.kind) &&
    safeCount(value.interval_count) &&
    value.interval_count > 0 &&
    finiteNonnegative(value.union_activity_ms) &&
    finiteNonnegative(value.longest_interval_ms)
  );
}

function validHeap(value) {
  if (!closed(value, ['before', 'commit', 'delta', 'complete'])) return false;
  if (value.complete === false)
    return value.before === null && value.commit === null && value.delta === null;
  return (
    value.complete === true &&
    validHeapPoint(value.before) &&
    validHeapPoint(value.commit) &&
    validHeapDelta(value.delta)
  );
}

function validHeapPoint(value) {
  return closed(value, HEAP_FIELDS) && HEAP_FIELDS.every((field) => safeCount(value[field]));
}

function validHeapDelta(value) {
  return (
    closed(value, HEAP_FIELDS) && HEAP_FIELDS.every((field) => Number.isSafeInteger(value[field]))
  );
}

function validAllocations(value) {
  return (
    closed(value, [
      'sampling_interval_bytes',
      'collection_scope',
      'profile_samples',
      'sampled_bytes',
      'application_sampled_bytes',
      'inventory',
      'candidates',
      'complete',
    ]) &&
    value.sampling_interval_bytes === V8_HEAP_PROFILE_INTERVAL_BYTES &&
    value.collection_scope === V8_HEAP_COLLECTION_SCOPE &&
    safeCount(value.profile_samples) &&
    safeCount(value.sampled_bytes) &&
    safeCount(value.application_sampled_bytes) &&
    value.application_sampled_bytes <= value.sampled_bytes &&
    closed(value.inventory, ['total', 'retained', 'complete']) &&
    Array.isArray(value.candidates) &&
    value.candidates.length <= SERVER_REQUEST_GC_PRESSURE_LIMITS.candidates &&
    value.inventory.total === value.candidates.length &&
    value.inventory.retained === value.candidates.length &&
    value.inventory.complete === value.complete &&
    value.candidates.every(validCandidate) &&
    typeof value.complete === 'boolean'
  );
}

function validCandidate(value) {
  return (
    closed(value, ['source', 'sampled_bytes', 'sample_share', 'application_function_share']) &&
    validSource(value.source) &&
    safeCount(value.sampled_bytes) &&
    finiteFraction(value.sample_share) &&
    finiteFraction(value.application_function_share)
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
    value.provenance === 'request_scoped_v8_sampling_heap_profile'
  );
}

function validRoute(value) {
  return (
    closed(value, [
      'classification',
      'dominant_gc_kind',
      'observed_union_activity_ms',
      'leading_source',
      'source_inspection_eligible',
      'edit_eligible',
      'confidence',
    ]) &&
    typeof value.classification === 'string' &&
    (value.dominant_gc_kind === null || GC_KINDS.includes(value.dominant_gc_kind)) &&
    (value.observed_union_activity_ms === null ||
      finiteNonnegative(value.observed_union_activity_ms)) &&
    (value.leading_source === null || validSource(value.leading_source)) &&
    typeof value.source_inspection_eligible === 'boolean' &&
    value.edit_eligible === false &&
    value.confidence === 'low'
  );
}

function validMarker(value) {
  return (
    closed(value, [
      'schema_version',
      'parent_event_id',
      'supported',
      'start_us',
      'stop_us',
      'response_commit_offset_ms',
      'overlapping_dynamic_requests',
      'sampling_interval_bytes',
      'collection_scope',
      'heap_before',
      'heap_commit',
      'profile_file',
      'profile_bytes',
      'complete',
    ]) &&
    value.schema_version === SERVER_REQUEST_GC_PRESSURE_MARKER_SCHEMA_VERSION &&
    safeEventId(value.parent_event_id) &&
    typeof value.supported === 'boolean' &&
    finiteNonnegative(value.start_us) &&
    finiteNonnegative(value.stop_us) &&
    value.stop_us >= value.start_us &&
    finiteNonnegative(value.response_commit_offset_ms) &&
    safeCount(value.overlapping_dynamic_requests) &&
    value.sampling_interval_bytes === V8_HEAP_PROFILE_INTERVAL_BYTES &&
    value.collection_scope === V8_HEAP_COLLECTION_SCOPE &&
    validHeapPoint(value.heap_before) &&
    validHeapPoint(value.heap_commit) &&
    typeof value.profile_file === 'string' &&
    /^gc-allocation-\d+-\d+\.heapprofile$/.test(value.profile_file) &&
    safeCount(value.profile_bytes) &&
    (!value.supported || value.profile_bytes > 0) &&
    typeof value.complete === 'boolean' &&
    (!value.complete || value.supported)
  );
}

async function loadMarkersWithBoundedRetry(directory, admitted) {
  for (let attempt = 0; attempt < SERVER_REQUEST_GC_PRESSURE_LIMITS.retryCount; attempt += 1) {
    const markers = await loadMarkers(directory, admitted);
    if (markers.length > 0 || attempt + 1 === SERVER_REQUEST_GC_PRESSURE_LIMITS.retryCount) {
      return markers;
    }
    await delay(SERVER_REQUEST_GC_PRESSURE_LIMITS.retryDelayMs);
  }
  return [];
}

async function loadMarkers(directory, admitted) {
  let names;
  try {
    names = (await readdir(directory))
      .filter((name) => /^gc-pressure-\d+-\d+\.json$/.test(name))
      .sort()
      .slice(0, SERVER_REQUEST_GC_PRESSURE_LIMITS.markers);
  } catch {
    return [];
  }
  const markers = [];
  for (const name of names) {
    try {
      const path = join(directory, name);
      const metadata = await lstat(path);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.size > SERVER_REQUEST_GC_PRESSURE_LIMITS.markerBytes
      ) {
        continue;
      }
      const marker = JSON.parse(
        await readBoundedFile(path, SERVER_REQUEST_GC_PRESSURE_LIMITS.markerBytes)
      );
      if (
        validMarker(marker) &&
        admitted.has(marker.parent_event_id) &&
        !markers.some((candidate) => candidate.parent_event_id === marker.parent_event_id)
      ) {
        markers.push(marker);
      }
    } catch {
      // Private artifact failure is normalized as unavailable evidence.
    }
  }
  return markers;
}

async function loadTrace(directory) {
  try {
    const path = join(directory, 'native-trace.json');
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return { state: 'invalid', events: [] };
    return scanCompleteTraceEvents(await readBoundedFile(path, 16 * 1024 * 1024));
  } catch {
    return { state: 'unavailable', events: [] };
  }
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

function safeEventId(value) {
  return typeof value === 'string' && /^event-\d+-\d+$/.test(value);
}

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function finiteFraction(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function round6(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
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
