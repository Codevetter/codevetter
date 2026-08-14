import { lstat, realpath } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

import { BROWSER_SOURCE_MAP_LIMITS, mapBrowserGeneratedLocation } from './browser-source-map.mjs';
import { EXCLUDED_PATH_PARTS, repositoryRelative } from './contracts.mjs';

export const BROWSER_MAIN_THREAD_SCHEMA_VERSION = 'runtime-browser-main-thread/v4';
export const BROWSER_MAIN_THREAD_TRACE_CATEGORIES = Object.freeze([
  'loading',
  'toplevel',
  'devtools.timeline',
  'v8.execute',
  'blink.user_timing',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-v8.cpu_profiler',
]);
export const BROWSER_MAIN_THREAD_TRACE_BUFFER_KIB = 16_384;
export const BROWSER_MAIN_THREAD_LIMITS = Object.freeze({
  // Chromium's per-process event buffers are wrapped in shared JSON metadata;
  // keep a separate bounded raw-file allowance while the event cap below
  // remains authoritative.
  traceBytes: 32 * 1024 * 1024,
  traceEvents: 100_000,
  longTasks: 128,
  profileNodes: 20_000,
  profileSamples: 100_000,
  candidates: 24,
});
export const BROWSER_MAIN_THREAD_POLICY = Object.freeze({
  long_task_ms: 50,
  cpu_minimum_samples: 5,
  cpu_minimum_sample_share: 0.1,
});

const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const PHASE_NAMES = Object.freeze({
  javascript: new Set(['EvaluateScript', 'FunctionCall']),
  style: new Set(['RecalculateStyles', 'UpdateLayoutTree']),
  layout: new Set(['Layout']),
  paint: new Set(['Paint']),
});

export async function normalizeBrowserMainThreadTrace(
  repositoryRoot,
  source,
  { sourceMapLoader = null } = {}
) {
  if (
    typeof source !== 'string' ||
    Buffer.byteLength(source) > BROWSER_MAIN_THREAD_LIMITS.traceBytes
  ) {
    throw new Error('browser main-thread trace exceeds the raw evidence bound');
  }
  let document;
  try {
    document = JSON.parse(source);
  } catch {
    throw new Error('browser main-thread trace is not valid JSON');
  }
  const events = document?.traceEvents;
  if (!Array.isArray(events) || events.length > BROWSER_MAIN_THREAD_LIMITS.traceEvents) {
    throw new Error('browser main-thread trace event inventory is invalid or exceeds the bound');
  }
  const root = await realpath(resolve(repositoryRoot));
  const metadata = traceMetadata(events);
  const rendererThreads = new Set(
    [...metadata.threads]
      .filter(([identity, name]) => {
        const [pid] = identity.split(':');
        return metadata.processes.get(Number(pid)) === 'Renderer' && name === 'CrRendererMain';
      })
      .map(([identity]) => identity)
  );
  const rendererProcesses = new Set(
    [...rendererThreads].map((identity) => Number(identity.split(':')[0]))
  );
  const rendererEvents = events.filter((event) =>
    rendererThreads.has(`${event?.pid}:${event?.tid}`)
  );
  const rendererProfileEvents = events.filter(
    (event) =>
      rendererProcesses.has(event?.pid) && event?.ph === 'P' && event.name === 'ProfileChunk'
  );
  const longTasks = rendererEvents
    .filter(
      (event) =>
        event?.ph === 'X' &&
        event.name === 'ThreadControllerImpl::RunTask' &&
        durationMs(event) >= BROWSER_MAIN_THREAD_POLICY.long_task_ms
    )
    .map((event) => ({
      started_at_ms: round(event.ts / 1_000),
      duration_ms: round(durationMs(event)),
      task_type: normalizeTaskType(event.args?.renderer_main_thread_task_execution?.task_type),
    }))
    .toSorted(
      (left, right) =>
        left.started_at_ms - right.started_at_ms || right.duration_ms - left.duration_ms
    )
    .slice(0, BROWSER_MAIN_THREAD_LIMITS.longTasks);
  const phases = Object.fromEntries(
    Object.entries(PHASE_NAMES).map(([phase, names]) => [
      phase,
      summarizeIntervals(
        rendererEvents
          .filter((event) => event?.ph === 'X' && names.has(event.name) && durationMs(event) >= 0)
          .map((event) => [event.ts / 1_000, event.ts / 1_000 + durationMs(event)])
      ),
    ])
  );
  const memoryCounters = summarizeRendererMemoryCounters(rendererEvents);
  const pageLoad = summarizePageLoadMetrics(rendererEvents);
  const profile = await normalizeProfile(root, rendererProfileEvents, sourceMapLoader);
  return {
    schema_version: BROWSER_MAIN_THREAD_SCHEMA_VERSION,
    policy: { ...BROWSER_MAIN_THREAD_POLICY },
    trace_event_count: events.length,
    renderer_main_thread_count: rendererThreads.size,
    long_tasks: longTasks,
    phases,
    page_load: pageLoad,
    memory_counters: memoryCounters,
    profile,
    limitations: [
      'Renderer task and phase intervals can nest; phase totals are reported independently and are not summed into exclusive CPU time.',
      'Browser V8 sampling is approximate and excludes external, anonymous, browser-internal, and non-contained source URLs.',
      ...(memoryCounters
        ? [
            'Renderer counters are within-trace observations without forced garbage collection; positive heap, DOM-node, document, or listener deltas do not by themselves prove a leak.',
            ...(memoryCounters.renderer_process_count > 1
              ? [
                  'Multiple renderers emitted counters; the series with the most samples and latest endpoint was selected without cross-process aggregation.',
                ]
              : []),
          ]
        : ['Chromium emitted no bounded renderer memory counter series for this exact flow.']),
      ...(pageLoad
        ? [
            'Largest Contentful Paint is a local Chromium navigation observation from the final outer-main-frame candidate; it is not field data or representative-device evidence.',
          ]
        : ['Chromium emitted no comparable outer-main-frame Largest Contentful Paint candidate.']),
      ...(profile.candidates.some(
        (candidate) => candidate.provenance !== 'browser_inline_source_map_verified'
      )
        ? [
            'Some browser source locations use transformed or webpack-internal URLs because no content-identical inline source map was proven.',
          ]
        : []),
    ],
  };
}

function summarizePageLoadMetrics(events) {
  const navigations = events
    .filter(
      (event) =>
        event?.name === 'navigationStart' &&
        Number.isFinite(event.ts) &&
        typeof event.args?.data?.navigationId === 'string'
    )
    .toSorted((left, right) => left.ts - right.ts);
  const candidates = events.filter(
    (event) =>
      event?.name === 'largestContentfulPaint::Candidate' &&
      Number.isFinite(event.ts) &&
      typeof event.args?.data?.navigationId === 'string' &&
      (event.args.data.isOutermostMainFrame ?? event.args.data.isMainFrame) === true
  );
  for (const navigation of navigations.toReversed()) {
    const navigationId = navigation.args.data.navigationId;
    const matching = candidates
      .filter(
        (candidate) =>
          candidate.args.data.navigationId === navigationId && candidate.ts >= navigation.ts
      )
      .toSorted(
        (left, right) =>
          (left.args.data.candidateIndex ?? 0) - (right.args.data.candidateIndex ?? 0) ||
          left.ts - right.ts
      );
    const finalCandidate = matching.at(-1);
    if (!finalCandidate) continue;
    const duration = (finalCandidate.ts - navigation.ts) / 1_000;
    if (!Number.isFinite(duration) || duration < 0 || duration > 300_000) continue;
    return {
      largest_contentful_paint_ms: round(duration),
      candidate_count: matching.length,
      candidate_size: boundedTraceInteger(finalCandidate.args.data.size),
      provenance: 'chromium_outer_main_frame_lcp_candidate',
    };
  }
  return null;
}

function boundedTraceInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function summarizeRendererMemoryCounters(events) {
  const groups = new Map();
  for (const event of events) {
    if (event?.name !== 'UpdateCounters' || !Number.isFinite(event.ts)) continue;
    const data = event.args?.data;
    const sample = normalizeMemoryCounterSample(data, event.ts / 1_000);
    if (!sample) continue;
    const group = groups.get(event.pid) ?? [];
    group.push(sample);
    groups.set(event.pid, group);
  }
  if (groups.size === 0) return null;
  const selected = [...groups.values()]
    .map((samples) => samples.toSorted((left, right) => left.at_ms - right.at_ms))
    .toSorted(
      (left, right) => right.length - left.length || right.at(-1).at_ms - left.at(-1).at_ms
    )[0];
  const first = selected[0];
  const last = selected.at(-1);
  const fields = ['js_heap_used_bytes', 'dom_nodes', 'documents', 'event_listeners'];
  return {
    sample_count: selected.length,
    renderer_process_count: groups.size,
    duration_ms: round(Math.max(0, last.at_ms - first.at_ms)),
    first: withoutTimestamp(first),
    last: withoutTimestamp(last),
    peak: Object.fromEntries(
      fields.map((field) => [field, Math.max(...selected.map((sample) => sample[field]))])
    ),
    delta: Object.fromEntries(fields.map((field) => [field, last[field] - first[field]])),
    provenance: 'chromium_update_counters',
  };
}

function normalizeMemoryCounterSample(data, atMs) {
  if (!data || typeof data !== 'object') return null;
  const values = {
    js_heap_used_bytes: data.jsHeapSizeUsed,
    dom_nodes: data.nodes,
    documents: data.documents,
    event_listeners: data.jsEventListeners,
  };
  if (Object.values(values).some((value) => !Number.isSafeInteger(value) || value < 0)) {
    return null;
  }
  return { at_ms: round(atMs), ...values };
}

function withoutTimestamp({ at_ms: _atMs, ...sample }) {
  return sample;
}

function traceMetadata(events) {
  const processes = new Map();
  const threads = new Map();
  for (const event of events) {
    if (event?.ph !== 'M') continue;
    if (event.name === 'process_name' && typeof event.args?.name === 'string') {
      processes.set(event.pid, event.args.name);
    }
    if (event.name === 'thread_name' && typeof event.args?.name === 'string') {
      threads.set(`${event.pid}:${event.tid}`, event.args.name);
    }
  }
  return { processes, threads };
}

async function normalizeProfile(root, rendererProfileEvents, sourceMapLoader) {
  const profiles = new Map();
  const sourceCache = new Map();
  let profileNodeCount = 0;
  let sampleCount = 0;
  let repositorySampleCount = 0;
  const aggregate = new Map();
  for (const event of rendererProfileEvents) {
    const identity = `${event.pid}:${event.tid}`;
    const profile = profiles.get(identity) ?? new Map();
    const chunk = event.args?.data?.cpuProfile;
    const nodes = Array.isArray(chunk?.nodes) ? chunk.nodes : [];
    profileNodeCount += nodes.length;
    if (profileNodeCount > BROWSER_MAIN_THREAD_LIMITS.profileNodes) {
      throw new Error('browser V8 profile node inventory exceeds the bound');
    }
    for (const node of nodes) {
      if (Number.isInteger(node?.id) && node.callFrame && typeof node.callFrame === 'object') {
        profile.set(node.id, node.callFrame);
      }
    }
    profiles.set(identity, profile);
    const samples = Array.isArray(chunk?.samples) ? chunk.samples : [];
    const deltas = Array.isArray(event.args?.data?.timeDeltas) ? event.args.data.timeDeltas : [];
    if (sampleCount + samples.length > BROWSER_MAIN_THREAD_LIMITS.profileSamples) {
      throw new Error('browser V8 sample inventory exceeds the bound');
    }
    for (const [index, sample] of samples.entries()) {
      sampleCount += 1;
      const frame = profile.get(sample);
      const sourceValue = frame?.url;
      if (!sourceCache.has(sourceValue)) {
        sourceCache.set(sourceValue, containedBrowserSource(root, sourceValue));
      }
      const source = await sourceCache.get(sourceValue);
      if (!source) continue;
      repositorySampleCount += 1;
      const generatedLine =
        Number.isInteger(frame.lineNumber) && frame.lineNumber >= 0 ? frame.lineNumber : null;
      const generatedColumn =
        Number.isInteger(frame.columnNumber) && frame.columnNumber >= 0 ? frame.columnNumber : null;
      const line = generatedLine === null ? 1 : generatedLine + 1;
      const functionName = normalizeFunctionName(frame.functionName);
      const key = `${source.url}\u0000${line}\u0000${generatedColumn ?? ''}\u0000${functionName ?? ''}`;
      const current = aggregate.get(key) ?? {
        file: source.file,
        line,
        function: functionName,
        provenance: source.provenance ?? 'browser_transformed_url',
        sample_count: 0,
        self_time_ms: 0,
        generated_url: source.url,
        generated_line: generatedLine,
        generated_column: generatedColumn,
      };
      current.sample_count += 1;
      const delta = Number.isFinite(deltas[index]) ? Math.max(0, deltas[index]) : 0;
      current.self_time_ms += delta / 1_000;
      aggregate.set(key, current);
    }
  }
  const rawCandidates = [...aggregate.values()]
    .map((candidate) => ({
      ...candidate,
      self_time_ms: round(candidate.self_time_ms),
      sample_share: sampleCount > 0 ? round(candidate.sample_count / sampleCount, 4) : 0,
    }))
    .toSorted(
      (left, right) =>
        right.sample_count - left.sample_count ||
        right.self_time_ms - left.self_time_ms ||
        left.file.localeCompare(right.file) ||
        left.line - right.line ||
        (left.function ?? '').localeCompare(right.function ?? '')
    )
    .slice(0, BROWSER_MAIN_THREAD_LIMITS.candidates);
  const candidates = [];
  let attemptedCandidates = 0;
  let loadedResponses = 0;
  let verifiedCandidates = 0;
  for (const [index, rawCandidate] of rawCandidates.entries()) {
    const {
      generated_url: generatedUrl,
      generated_line: generatedLine,
      generated_column: generatedColumn,
      ...candidate
    } = rawCandidate;
    let mapped = null;
    if (
      typeof sourceMapLoader === 'function' &&
      index < BROWSER_SOURCE_MAP_LIMITS.candidates &&
      generatedLine !== null &&
      generatedColumn !== null
    ) {
      attemptedCandidates += 1;
      let transformedSource = null;
      try {
        transformedSource = await sourceMapLoader({ url: generatedUrl, file: candidate.file });
      } catch {
        transformedSource = null;
      }
      if (typeof transformedSource === 'string') {
        loadedResponses += 1;
        mapped = await mapBrowserGeneratedLocation({
          repositoryRoot: root,
          transformedSource,
          generatedFile: candidate.file,
          generatedLine,
          generatedColumn,
        });
      }
    }
    if (mapped) {
      verifiedCandidates += 1;
      candidates.push({
        ...candidate,
        file: mapped.file,
        line: mapped.line,
        function: mapped.function ?? candidate.function,
        provenance: mapped.provenance,
        generated: { file: candidate.file, line: candidate.line },
      });
    } else {
      candidates.push(candidate);
    }
  }
  return {
    sample_count: sampleCount,
    repository_sample_count: repositorySampleCount,
    source_map: {
      candidate_count: rawCandidates.length,
      attempted_candidates: attemptedCandidates,
      loaded_responses: loadedResponses,
      verified_candidates: verifiedCandidates,
    },
    candidates,
  };
}

async function containedBrowserSource(root, value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_000) return null;
  let url;
  try {
    url = new URL(value, 'http://local.invalid');
  } catch {
    return null;
  }
  let pathname;
  let provenance = 'browser_transformed_url';
  if (['webpack-internal:', 'webpack:'].includes(url.protocol)) {
    try {
      pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return null;
    }
    const moduleMarker = pathname.indexOf('/./');
    if (moduleMarker >= 0) pathname = pathname.slice(moduleMarker + 3);
    else pathname = pathname.replace(/^\([^/]+\)\//, '').replace(/^\.\//, '');
    provenance = 'browser_webpack_internal_url';
  } else {
    if (!['localhost', '127.0.0.1', '[::1]', 'local.invalid'].includes(url.hostname)) return null;
    try {
      pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return null;
    }
  }
  if (
    pathname.length === 0 ||
    pathname.includes('\\') ||
    pathname.startsWith('@fs/') ||
    pathname.startsWith('@id/') ||
    pathname.split('/').includes('..') ||
    pathname.split('/').some((part) => EXCLUDED_PATH_PARTS.includes(part)) ||
    !SOURCE_EXTENSIONS.has(extname(pathname))
  ) {
    return null;
  }
  const lexical = resolve(root, pathname);
  const relative = repositoryRelative(root, lexical);
  if (!relative) return null;
  try {
    const path = await realpath(lexical);
    const metadata = await lstat(path);
    const file = metadata.isFile() ? repositoryRelative(root, path) : null;
    return file ? { file, url: value, provenance } : null;
  } catch {
    return null;
  }
}

function summarizeIntervals(intervals) {
  const valid = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .toSorted((left, right) => left[0] - right[0] || left[1] - right[1]);
  let total = 0;
  let maximum = 0;
  let activeStart = null;
  let activeEnd = null;
  for (const [start, end] of valid) {
    maximum = Math.max(maximum, end - start);
    if (activeStart === null) {
      activeStart = start;
      activeEnd = end;
      continue;
    }
    if (start <= activeEnd) {
      activeEnd = Math.max(activeEnd, end);
      continue;
    }
    total += activeEnd - activeStart;
    activeStart = start;
    activeEnd = end;
  }
  if (activeStart !== null) total += activeEnd - activeStart;
  return {
    event_count: valid.length,
    total_duration_ms: round(total),
    max_duration_ms: round(maximum),
  };
}

function normalizeTaskType(value) {
  if (typeof value !== 'string' || value.length === 0) return 'unknown';
  return value
    .replace(/^TASK_TYPE_/, '')
    .toLowerCase()
    .slice(0, 100);
}

function normalizeFunctionName(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.slice(0, 200);
}

function durationMs(event) {
  return Number.isFinite(event?.dur) ? Math.max(0, event.dur / 1_000) : 0;
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
