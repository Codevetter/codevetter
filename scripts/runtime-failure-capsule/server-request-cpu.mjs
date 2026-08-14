import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIMITS, isExcludedPath, repositoryRelative } from './contracts.mjs';
import { redactText } from './redact.mjs';

export const SERVER_REQUEST_CPU_SCHEMA_VERSION = 'runtime-node-request-cpu/v4';
export const SERVER_REQUEST_CPU_PREVIOUS_SCHEMA_VERSION = 'runtime-node-request-cpu/v3';
export const SERVER_REQUEST_CPU_LEGACY_SCHEMA_VERSION = 'runtime-node-request-cpu/v2';
export const SERVER_REQUEST_CPU_PROFILE_SCHEMA_VERSION = 'codevetter-node-request-cpu-profile/v3';
export const SERVER_REQUEST_CPU_PROFILE_LEGACY_SCHEMA_VERSION =
  'codevetter-node-request-cpu-profile/v2';
export const SERVER_REQUEST_CPU_LIMITS = Object.freeze({
  profiles: 8,
  candidates: 8,
  bytes: 8 * 1024 * 1024,
  samples: 100_000,
});
export const SERVER_REQUEST_CPU_POLICY = Object.freeze({
  minimum_samples: 5,
  minimum_sample_share: 0.1,
});
export const SERVER_REQUEST_RUNTIME_MECHANISMS = Object.freeze([
  'module_loading',
  'compilation',
  'garbage_collection',
  'promise_microtasks',
  'timers_scheduling',
  'http_streams',
  'buffer_encoding',
  'filesystem',
  'crypto_compression',
  'inspector',
  'v8_builtins',
  'other_runtime',
]);
export const SERVER_REQUEST_RUNTIME_POLICY = Object.freeze({
  minimum_self_time_ms: 5,
  minimum_runtime_sample_share: 0.2,
});

export async function collectServerRequestCpuProfiles(
  directory,
  { repositoryRoot, eventIds = [] } = {}
) {
  const root = await realpath(resolve(repositoryRoot));
  const admitted = new Set(eventIds.filter(safeEventId));
  let names;
  try {
    names = (await readdir(directory)).filter((name) => /^cpu-\d+-\d+\.json$/.test(name)).sort();
  } catch {
    return new Map();
  }
  const results = new Map();
  let bytes = 0;
  for (const name of names.slice(0, SERVER_REQUEST_CPU_LIMITS.profiles)) {
    const path = join(directory, name);
    try {
      const metadata = await stat(path);
      bytes += metadata.size;
      if (
        !metadata.isFile() ||
        metadata.size > SERVER_REQUEST_CPU_LIMITS.bytes ||
        bytes > SERVER_REQUEST_CPU_LIMITS.bytes
      ) {
        continue;
      }
      const document = JSON.parse(await readFile(path, 'utf8'));
      if (
        ![
          SERVER_REQUEST_CPU_PROFILE_SCHEMA_VERSION,
          SERVER_REQUEST_CPU_PROFILE_LEGACY_SCHEMA_VERSION,
        ].includes(document?.schema_version) ||
        !admitted.has(document.parent_event_id) ||
        results.has(document.parent_event_id)
      ) {
        continue;
      }
      results.set(document.parent_event_id, await normalizeCpuProfile(document, root));
    } catch {
      // Malformed raw diagnostic evidence is never exposed or allowed to disrupt capture.
    }
  }
  return results;
}

export async function normalizeCpuProfile(document, repositoryRoot) {
  let root;
  try {
    root = await realpath(resolve(repositoryRoot));
  } catch {
    return emptySummary('invalid', 0, 0, false);
  }
  const overlap = Number.isSafeInteger(document?.overlapping_dynamic_requests)
    ? Math.max(0, document.overlapping_dynamic_requests)
    : 0;
  const currentRawProfile = document?.schema_version === SERVER_REQUEST_CPU_PROFILE_SCHEMA_VERSION;
  const precommitOverlap = currentRawProfile
    ? document?.overlapping_precommit_dynamic_requests
    : overlap;
  if (
    !Number.isSafeInteger(precommitOverlap) ||
    precommitOverlap < 0 ||
    precommitOverlap > overlap
  ) {
    return emptySummary('invalid', 0, 0, false);
  }
  if (precommitOverlap > 0) {
    return emptySummary('contaminated', overlap, precommitOverlap, false);
  }
  const profile = document?.profile;
  const responseCommitOffsetMs = document?.response_commit_offset_ms;
  if (
    !profile ||
    !Array.isArray(profile.nodes) ||
    !Array.isArray(profile.samples) ||
    !Number.isFinite(responseCommitOffsetMs) ||
    responseCommitOffsetMs < 0
  ) {
    return emptySummary('invalid', overlap, precommitOverlap, false);
  }
  const sampleCount = Math.min(profile.samples.length, SERVER_REQUEST_CPU_LIMITS.samples);
  const complete = profile.samples.length <= SERVER_REQUEST_CPU_LIMITS.samples;
  const deltas = Array.isArray(profile.timeDeltas) ? profile.timeDeltas : [];
  if (
    !complete ||
    deltas.length < profile.samples.length ||
    deltas.slice(0, profile.samples.length).some((delta) => !finiteNonnegative(delta))
  ) {
    return emptySummary('invalid', overlap, precommitOverlap, false);
  }
  const nodes = new Map();
  for (const node of profile.nodes.slice(0, SERVER_REQUEST_CPU_LIMITS.samples)) {
    if (Number.isSafeInteger(node?.id) && node.callFrame) nodes.set(node.id, node.callFrame);
  }
  const totals = new Map();
  const sampleScope = {
    repository: 0,
    dependency: 0,
    generated: 0,
    runtime: 0,
    idle: 0,
    unresolved: 0,
  };
  let sampledTimeUs = 0;
  let repositorySamples = 0;
  let repositoryTimeUs = 0;
  const precommit = emptyPrecommit(responseCommitOffsetMs, true);
  const requestRuntime = emptyRuntimeView(null, true);
  const precommitRuntime = emptyRuntimeView(responseCommitOffsetMs, true);
  let requestRuntimeComplete = true;
  let precommitRuntimeComplete = true;
  const commitUs = responseCommitOffsetMs * 1_000;
  let cumulativeTimeUs = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const delta = deltas[index];
    sampledTimeUs += delta;
    cumulativeTimeUs += delta;
    const callFrame = nodes.get(profile.samples[index]);
    const scope = classifyCpuFrameScope(callFrame);
    const frame = await normalizeRepositoryCpuFrame(callFrame, root);
    const normalizedScope = frame ? 'repository' : scope;
    if (cumulativeTimeUs <= commitUs) {
      precommit.total_samples += 1;
      precommit.sampled_time_ms = round3(precommit.sampled_time_ms + delta / 1_000);
      precommit.sample_scope[normalizedScope] += 1;
      precommit.sample_scope_time_ms[normalizedScope] = round3(
        precommit.sample_scope_time_ms[normalizedScope] + delta / 1_000
      );
    }
    if (!callFrame) {
      requestRuntimeComplete = false;
      if (cumulativeTimeUs <= commitUs) precommitRuntimeComplete = false;
    }
    if (normalizedScope === 'runtime') {
      const mechanism = classifyRuntimeMechanism(callFrame);
      addRuntimeSample(requestRuntime, mechanism, delta);
      if (cumulativeTimeUs <= commitUs) addRuntimeSample(precommitRuntime, mechanism, delta);
    }
    if (!frame) {
      sampleScope[scope] += 1;
      continue;
    }
    sampleScope.repository += 1;
    repositorySamples += 1;
    repositoryTimeUs += delta;
    const key = `${frame.file}:${frame.line}:${frame.function}`;
    const value = totals.get(key) ?? { ...frame, samples: 0, self_time_us: 0 };
    value.samples += 1;
    value.self_time_us += delta;
    totals.set(key, value);
  }
  if (sampledTimeUs < commitUs) {
    return emptySummary('invalid', overlap, precommitOverlap, false);
  }
  precommit.non_idle_sampled_time_ms = round3(
    ['repository', 'dependency', 'generated', 'runtime'].reduce(
      (total, scope) => total + precommit.sample_scope_time_ms[scope],
      0
    )
  );
  const runtimeMechanisms = finalizeRuntimeMechanisms(
    overlap > 0 ? emptyRuntimeView(null, false) : requestRuntime,
    precommitRuntime,
    {
      requestComplete: complete && overlap === 0 && requestRuntimeComplete,
      precommitComplete: complete && precommitRuntimeComplete,
    }
  );
  const candidates = (overlap > 0 ? [] : [...totals.values()])
    .map((candidate) => ({
      source: {
        file: candidate.file,
        line: candidate.line,
        function: candidate.function,
        provenance: 'node_request_cpu_sample',
      },
      samples: candidate.samples,
      sample_share: round6(sampleCount > 0 ? candidate.samples / sampleCount : 0),
      self_time_ms: round3(candidate.self_time_us / 1_000),
    }))
    .filter(
      (candidate) =>
        candidate.samples >= SERVER_REQUEST_CPU_POLICY.minimum_samples &&
        candidate.sample_share >= SERVER_REQUEST_CPU_POLICY.minimum_sample_share
    )
    .toSorted(
      (left, right) =>
        right.self_time_ms - left.self_time_ms ||
        right.samples - left.samples ||
        left.source.file.localeCompare(right.source.file) ||
        left.source.line - right.source.line
    )
    .slice(0, SERVER_REQUEST_CPU_LIMITS.candidates);
  return assertServerRequestCpuSummary({
    schema_version: SERVER_REQUEST_CPU_SCHEMA_VERSION,
    state: overlap > 0 ? 'contaminated' : candidates.length > 0 ? 'observed' : 'insufficient',
    overlapping_dynamic_requests: overlap,
    overlapping_precommit_dynamic_requests: precommitOverlap,
    total_samples: overlap > 0 ? 0 : sampleCount,
    sampled_time_ms: overlap > 0 ? 0 : round3(sampledTimeUs / 1_000),
    repository_samples: overlap > 0 ? 0 : repositorySamples,
    repository_self_time_ms: overlap > 0 ? 0 : round3(repositoryTimeUs / 1_000),
    repository_sample_share:
      overlap > 0 ? 0 : round6(sampleCount > 0 ? repositorySamples / sampleCount : 0),
    sample_scope:
      overlap > 0
        ? {
            repository: 0,
            dependency: 0,
            generated: 0,
            runtime: 0,
            idle: 0,
            unresolved: 0,
          }
        : sampleScope,
    candidates,
    precommit,
    runtime_mechanisms: runtimeMechanisms,
    complete: complete && overlap === 0 && requestRuntimeComplete,
    observer_effect: 'profiler_started_before_handler_dispatch',
  });
}

export function assertServerRequestCpuSummary(value) {
  const legacy = value?.schema_version === SERVER_REQUEST_CPU_LEGACY_SCHEMA_VERSION;
  const current = value?.schema_version === SERVER_REQUEST_CPU_SCHEMA_VERSION;
  const allowed = [
    'schema_version',
    'state',
    'overlapping_dynamic_requests',
    ...(current ? ['overlapping_precommit_dynamic_requests'] : []),
    'total_samples',
    'sampled_time_ms',
    'repository_samples',
    'repository_self_time_ms',
    'repository_sample_share',
    'sample_scope',
    'candidates',
    'precommit',
    ...(legacy ? [] : ['runtime_mechanisms']),
    'complete',
    'observer_effect',
  ];
  if (
    !closedObject(value, allowed) ||
    ![
      SERVER_REQUEST_CPU_SCHEMA_VERSION,
      SERVER_REQUEST_CPU_PREVIOUS_SCHEMA_VERSION,
      SERVER_REQUEST_CPU_LEGACY_SCHEMA_VERSION,
    ].includes(value.schema_version) ||
    !['observed', 'insufficient', 'contaminated', 'invalid'].includes(value.state) ||
    !safeCount(value.overlapping_dynamic_requests) ||
    (current &&
      (!safeCount(value.overlapping_precommit_dynamic_requests) ||
        value.overlapping_precommit_dynamic_requests > value.overlapping_dynamic_requests)) ||
    !safeCount(value.total_samples) ||
    value.total_samples > SERVER_REQUEST_CPU_LIMITS.samples ||
    !finiteNonnegative(value.sampled_time_ms) ||
    !safeCount(value.repository_samples) ||
    value.repository_samples > value.total_samples ||
    !finiteNonnegative(value.repository_self_time_ms) ||
    !finiteShare(value.repository_sample_share) ||
    !validSampleScope(value.sample_scope, value.total_samples) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > SERVER_REQUEST_CPU_LIMITS.candidates ||
    value.candidates.some((candidate) => !validCandidate(candidate)) ||
    !validPrecommit(value.precommit) ||
    (!legacy &&
      !validRuntimeMechanisms(value.runtime_mechanisms, { splitCompleteness: current })) ||
    (value.state === 'observed') !== value.candidates.length > 0 ||
    (value.state === 'contaminated' && value.overlapping_dynamic_requests === 0) ||
    typeof value.complete !== 'boolean' ||
    value.observer_effect !== 'profiler_started_before_handler_dispatch'
  ) {
    throw new Error('server request CPU summary is invalid');
  }
  return value;
}

export async function normalizeRepositoryCpuFrame(callFrame, root) {
  if (!callFrame || typeof callFrame.url !== 'string' || callFrame.url.length > 2_048) return null;
  let candidate;
  const internal = callFrame.url.match(
    /^webpack-internal:\/\/\/(?:\(rsc\)|\(ssr\))\/\.\/([^?#]+)(?:[?#].*)?$/
  );
  if (internal) {
    try {
      candidate = resolve(root, decodeURIComponent(internal[1]));
    } catch {
      return null;
    }
  } else if (callFrame.url.startsWith('file:')) {
    try {
      candidate = fileURLToPath(callFrame.url);
    } catch {
      return null;
    }
  } else if (isAbsolute(callFrame.url)) {
    candidate = callFrame.url;
  } else {
    return null;
  }
  try {
    const canonical = await realpath(candidate);
    const file = repositoryRelative(root, canonical);
    if (!file || isExcludedPath(file)) return null;
    if (!(await lstat(canonical)).isFile()) return null;
    const rawFunction = typeof callFrame.functionName === 'string' ? callFrame.functionName : '';
    const redacted = redactText(rawFunction || '<anonymous>', {
      repositoryRoot: root,
      limit: 200,
    });
    return {
      file,
      line:
        Number.isSafeInteger(callFrame.lineNumber) && callFrame.lineNumber >= 0
          ? callFrame.lineNumber + 1
          : 1,
      function: redacted.text || '<anonymous>',
    };
  } catch {
    return null;
  }
}

function emptySummary(state, overlap, precommitOverlap, complete) {
  return assertServerRequestCpuSummary({
    schema_version: SERVER_REQUEST_CPU_SCHEMA_VERSION,
    state,
    overlapping_dynamic_requests: overlap,
    overlapping_precommit_dynamic_requests: precommitOverlap,
    total_samples: 0,
    sampled_time_ms: 0,
    repository_samples: 0,
    repository_self_time_ms: 0,
    repository_sample_share: 0,
    sample_scope: {
      repository: 0,
      dependency: 0,
      generated: 0,
      runtime: 0,
      idle: 0,
      unresolved: 0,
    },
    candidates: [],
    precommit: emptyPrecommit(null, false),
    runtime_mechanisms: emptyRuntimeMechanisms(false),
    complete,
    observer_effect: 'profiler_started_before_handler_dispatch',
  });
}

function emptyPrecommit(boundaryMs, complete) {
  const sampleScope = {
    repository: 0,
    dependency: 0,
    generated: 0,
    runtime: 0,
    idle: 0,
    unresolved: 0,
  };
  return {
    state: complete ? 'observed' : 'insufficient',
    boundary_ms: boundaryMs,
    total_samples: 0,
    sampled_time_ms: 0,
    non_idle_sampled_time_ms: 0,
    sample_scope: sampleScope,
    sample_scope_time_ms: Object.fromEntries(Object.keys(sampleScope).map((scope) => [scope, 0])),
    complete,
    provenance: 'v8_request_profile_cumulative_time_deltas',
  };
}

function validPrecommit(value) {
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
    (value.boundary_ms === null || finiteNonnegative(value.boundary_ms)) &&
    safeCount(value.total_samples) &&
    finiteNonnegative(value.sampled_time_ms) &&
    finiteNonnegative(value.non_idle_sampled_time_ms) &&
    value.non_idle_sampled_time_ms <= value.sampled_time_ms + 0.01 &&
    validSampleScope(value.sample_scope, value.total_samples) &&
    closedObject(value.sample_scope_time_ms, scopes) &&
    scopes.every((scope) => finiteNonnegative(value.sample_scope_time_ms[scope])) &&
    Math.abs(
      scopes.reduce((total, scope) => total + value.sample_scope_time_ms[scope], 0) -
        value.sampled_time_ms
    ) <= 0.01 &&
    typeof value.complete === 'boolean' &&
    value.state === (value.complete ? 'observed' : 'insufficient') &&
    value.provenance === 'v8_request_profile_cumulative_time_deltas'
  );
}

export function classifyCpuFrameScope(callFrame) {
  if (!callFrame) return 'unresolved';
  const url = typeof callFrame?.url === 'string' ? callFrame.url : '';
  if (callFrame?.functionName === '(idle)') return 'idle';
  if (
    url === '' &&
    /^(?:\(garbage collector\)|Builtin:|BytecodeHandler:|Stub:|RegExp:|\(program\))/.test(
      callFrame?.functionName ?? ''
    )
  ) {
    return 'runtime';
  }
  if (url.startsWith('node:') || url.startsWith('internal/') || url === '[native code]') {
    return 'runtime';
  }
  if (url.includes('/node_modules/') || url.includes('next/dist/')) return 'dependency';
  if (url.includes('/.next/') || url.startsWith('webpack-internal:')) return 'generated';
  return 'unresolved';
}

export function diagnoseRuntimeMechanisms(cpu) {
  assertServerRequestCpuSummary(cpu);
  const evidence = cpu.runtime_mechanisms;
  if (!evidence) return runtimeRoute('legacy_unavailable', null, null);
  if (!evidence.complete || evidence.state === 'incomplete') {
    return runtimeRoute('incomplete', null, null);
  }
  const eligible = evidence.precommit.mechanisms.filter(
    (entry) =>
      entry.self_time_ms >= SERVER_REQUEST_RUNTIME_POLICY.minimum_self_time_ms &&
      entry.runtime_sample_share >= SERVER_REQUEST_RUNTIME_POLICY.minimum_runtime_sample_share
  );
  if (eligible.length === 0) return runtimeRoute('unresolved', null, null);
  const dominant = eligible[0];
  if (dominant.mechanism === 'inspector') {
    return runtimeRoute('observer_effect', dominant, 'repeat_with_lower_overhead_cpu_measurement');
  }
  const nextProbe = {
    module_loading: 'inspect_module_loading_runtime',
    compilation: 'inspect_compilation_runtime',
    garbage_collection: 'inspect_gc_pressure',
    promise_microtasks: 'inspect_promise_microtask_runtime',
    timers_scheduling: 'inspect_timer_scheduling_runtime',
    http_streams: 'inspect_http_stream_runtime',
    buffer_encoding: 'inspect_buffer_encoding_runtime',
    filesystem: 'inspect_filesystem_runtime',
    crypto_compression: 'inspect_crypto_compression_runtime',
    v8_builtins: 'inspect_v8_builtin_runtime',
    other_runtime: 'capture_narrower_runtime_profile',
  }[dominant.mechanism];
  return runtimeRoute(`runtime_${dominant.mechanism}`, dominant, nextProbe);
}

function classifyRuntimeMechanism(callFrame) {
  const url = typeof callFrame?.url === 'string' ? callFrame.url.toLowerCase() : '';
  const name =
    typeof callFrame?.functionName === 'string' ? callFrame.functionName.toLowerCase() : '';
  if (name === '(garbage collector)' || name.includes('garbagecollect')) {
    return 'garbage_collection';
  }
  if (url.includes('inspector') || name.includes('inspector')) return 'inspector';
  if (
    url.includes('internal/modules') ||
    url.includes('node:module') ||
    url.includes('node:internal/modules')
  ) {
    return 'module_loading';
  }
  if (
    url.includes('node:vm') ||
    url.includes('internal/vm') ||
    /(?:compile|scriptcompiler|parseprogram|parsescript)/.test(name)
  ) {
    return 'compilation';
  }
  if (
    url.includes('task_queues') ||
    /(?:promise|microtask|processTicksAndRejections)/i.test(callFrame?.functionName ?? '')
  ) {
    return 'promise_microtasks';
  }
  if (url.includes('timer') || /(?:timer|timeout|immediate)/.test(name)) {
    return 'timers_scheduling';
  }
  if (
    /(?:node:_http|internal\/http|internal\/streams|node:stream)/.test(url) ||
    /(?:http|stream)/.test(name)
  ) {
    return 'http_streams';
  }
  if (
    /(?:node:buffer|internal\/buffer|string_decoder)/.test(url) ||
    /(?:buffer|encode|decode)/.test(name)
  ) {
    return 'buffer_encoding';
  }
  if (/(?:node:fs|internal\/fs)/.test(url)) return 'filesystem';
  if (/(?:node:crypto|node:zlib|internal\/(?:crypto|zlib))/.test(url)) {
    return 'crypto_compression';
  }
  if (
    url === '[native code]' ||
    /^(?:builtin:|bytecodehandler:|stub:|regexp:|\(program\))/.test(name)
  ) {
    return 'v8_builtins';
  }
  return 'other_runtime';
}

function emptyRuntimeMechanisms(complete) {
  return {
    state: complete ? 'insufficient' : 'incomplete',
    request: emptyRuntimeView(null, complete),
    precommit: emptyRuntimeView(null, complete),
    complete,
    provenance: 'closed_node_v8_runtime_sample_classification',
  };
}

function emptyRuntimeView(boundaryMs, complete) {
  return {
    boundary_ms: boundaryMs,
    total_samples: 0,
    sampled_time_ms: 0,
    mechanisms: [],
    complete,
  };
}

function addRuntimeSample(view, mechanism, deltaUs) {
  view.total_samples += 1;
  view.sampled_time_ms += deltaUs / 1_000;
  const existing = view.mechanisms.find((entry) => entry.mechanism === mechanism);
  if (existing) {
    existing.samples += 1;
    existing.self_time_ms += deltaUs / 1_000;
  } else {
    view.mechanisms.push({ mechanism, samples: 1, self_time_ms: deltaUs / 1_000 });
  }
}

function finalizeRuntimeMechanisms(request, precommit, { requestComplete, precommitComplete }) {
  for (const [view, complete] of [
    [request, requestComplete],
    [precommit, precommitComplete],
  ]) {
    view.complete = complete;
    view.sampled_time_ms = round3(view.sampled_time_ms);
    view.mechanisms = view.mechanisms
      .map((entry) => ({
        ...entry,
        self_time_ms: round3(entry.self_time_ms),
        runtime_sample_share: round6(
          view.sampled_time_ms > 0 ? entry.self_time_ms / view.sampled_time_ms : 0
        ),
      }))
      .toSorted(
        (left, right) =>
          right.self_time_ms - left.self_time_ms ||
          right.samples - left.samples ||
          SERVER_REQUEST_RUNTIME_MECHANISMS.indexOf(left.mechanism) -
            SERVER_REQUEST_RUNTIME_MECHANISMS.indexOf(right.mechanism)
      );
  }
  return {
    state: !precommitComplete
      ? 'incomplete'
      : precommit.total_samples > 0
        ? 'observed'
        : 'insufficient',
    request,
    precommit,
    complete: precommitComplete,
    provenance: 'closed_node_v8_runtime_sample_classification',
  };
}

function validRuntimeMechanisms(value, { splitCompleteness = false } = {}) {
  return (
    closedObject(value, ['state', 'request', 'precommit', 'complete', 'provenance']) &&
    ['observed', 'insufficient', 'incomplete'].includes(value.state) &&
    validRuntimeView(value.request) &&
    validRuntimeView(value.precommit) &&
    typeof value.complete === 'boolean' &&
    (splitCompleteness || value.request.complete === value.complete) &&
    value.precommit.complete === value.complete &&
    value.state ===
      (!value.complete
        ? 'incomplete'
        : value.precommit.total_samples > 0
          ? 'observed'
          : 'insufficient') &&
    value.provenance === 'closed_node_v8_runtime_sample_classification'
  );
}

function validRuntimeView(value) {
  return (
    closedObject(value, [
      'boundary_ms',
      'total_samples',
      'sampled_time_ms',
      'mechanisms',
      'complete',
    ]) &&
    (value.boundary_ms === null || finiteNonnegative(value.boundary_ms)) &&
    safeCount(value.total_samples) &&
    finiteNonnegative(value.sampled_time_ms) &&
    Array.isArray(value.mechanisms) &&
    value.mechanisms.length <= SERVER_REQUEST_RUNTIME_MECHANISMS.length &&
    new Set(value.mechanisms.map((entry) => entry?.mechanism)).size === value.mechanisms.length &&
    value.mechanisms.every(validRuntimeEntry) &&
    value.mechanisms.every(
      (entry) =>
        Math.abs(
          entry.runtime_sample_share -
            (value.sampled_time_ms > 0 ? entry.self_time_ms / value.sampled_time_ms : 0)
        ) <= 0.00001
    ) &&
    value.mechanisms.reduce((total, entry) => total + entry.samples, 0) === value.total_samples &&
    Math.abs(
      value.mechanisms.reduce((total, entry) => total + entry.self_time_ms, 0) -
        value.sampled_time_ms
    ) <= 0.01 &&
    typeof value.complete === 'boolean'
  );
}

function validRuntimeEntry(entry) {
  return (
    closedObject(entry, ['mechanism', 'samples', 'self_time_ms', 'runtime_sample_share']) &&
    SERVER_REQUEST_RUNTIME_MECHANISMS.includes(entry.mechanism) &&
    safeCount(entry.samples) &&
    entry.samples > 0 &&
    finiteNonnegative(entry.self_time_ms) &&
    finiteShare(entry.runtime_sample_share)
  );
}

function runtimeRoute(classification, dominant, nextProbe) {
  return {
    classification,
    dominant_mechanism: dominant?.mechanism ?? null,
    observed_self_time_ms: dominant?.self_time_ms ?? null,
    observed_runtime_sample_share: dominant?.runtime_sample_share ?? null,
    next_probe:
      nextProbe ??
      (classification === 'legacy_unavailable'
        ? 'recapture_same_exact_flow_with_runtime_mechanisms'
        : 'capture_narrower_runtime_profile'),
    confidence: 'low',
    source: null,
    causal_authority: 'none',
    edit_authority: 'none',
  };
}

function validSampleScope(value, totalSamples) {
  const fields = ['repository', 'dependency', 'generated', 'runtime', 'idle', 'unresolved'];
  return (
    closedObject(value, fields) &&
    fields.every((field) => safeCount(value[field])) &&
    fields.reduce((total, field) => total + value[field], 0) === totalSamples
  );
}

function validCandidate(candidate) {
  return (
    closedObject(candidate, ['source', 'samples', 'sample_share', 'self_time_ms']) &&
    closedObject(candidate.source, ['file', 'line', 'function', 'provenance']) &&
    typeof candidate.source.file === 'string' &&
    candidate.source.file.length > 0 &&
    candidate.source.file.length <= 512 &&
    !candidate.source.file.startsWith('/') &&
    !candidate.source.file.includes('\\') &&
    !candidate.source.file.split('/').includes('..') &&
    Number.isSafeInteger(candidate.source.line) &&
    candidate.source.line > 0 &&
    typeof candidate.source.function === 'string' &&
    candidate.source.function.length > 0 &&
    candidate.source.function.length <= 200 &&
    candidate.source.provenance === 'node_request_cpu_sample' &&
    safeCount(candidate.samples) &&
    candidate.samples >= SERVER_REQUEST_CPU_POLICY.minimum_samples &&
    finiteShare(candidate.sample_share) &&
    candidate.sample_share >= SERVER_REQUEST_CPU_POLICY.minimum_sample_share &&
    finiteNonnegative(candidate.self_time_ms)
  );
}

function safeEventId(value) {
  return typeof value === 'string' && /^event-\d+-\d+$/.test(value);
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function finiteShare(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
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

function round3(value) {
  return Math.round(value * 1_000) / 1_000;
}

function round6(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
