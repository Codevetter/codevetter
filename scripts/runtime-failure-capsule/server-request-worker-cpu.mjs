import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { normalizeCpuProfile } from './server-request-cpu.mjs';

export const SERVER_REQUEST_WORKER_CPU_SCHEMA_VERSION = 'runtime-node-request-worker-cpu/v1';
export const SERVER_REQUEST_WORKER_CPU_PROFILE_SCHEMA_VERSION =
  'codevetter-node-request-worker-cpu/v1';
export const SERVER_REQUEST_WORKER_CPU_LIMITS = Object.freeze({
  profiles: 8,
  workers: 4,
  bytes: 8 * 1024 * 1024,
  samples: 100_000,
});

const WORKER_STATES = new Set([
  'observed',
  'exited_before_start',
  'start_failed',
  'exited_before_stop',
  'stop_failed',
]);
const SUMMARY_STATES = new Set([
  'observed',
  'observed_zero',
  'insufficient',
  'unsupported',
  'contaminated',
  'invalid',
]);
const SCOPES = ['repository', 'dependency', 'generated', 'runtime', 'idle', 'unresolved'];

export async function collectServerRequestWorkerCpuProfiles(
  directory,
  { repositoryRoot, eventIds = [] } = {}
) {
  const root = await realpath(resolve(repositoryRoot));
  const admitted = new Set(eventIds.filter(safeEventId));
  let names;
  try {
    names = (await readdir(directory))
      .filter((name) => /^worker-cpu-\d+-\d+\.json$/.test(name))
      .sort();
  } catch {
    return new Map();
  }
  const results = new Map();
  let bytes = 0;
  for (const name of names.slice(0, SERVER_REQUEST_WORKER_CPU_LIMITS.profiles)) {
    const path = join(directory, name);
    try {
      const metadata = await stat(path);
      bytes += metadata.size;
      if (
        !metadata.isFile() ||
        metadata.size > SERVER_REQUEST_WORKER_CPU_LIMITS.bytes ||
        bytes > SERVER_REQUEST_WORKER_CPU_LIMITS.bytes
      ) {
        continue;
      }
      const document = JSON.parse(await readFile(path, 'utf8'));
      if (
        document?.schema_version !== SERVER_REQUEST_WORKER_CPU_PROFILE_SCHEMA_VERSION ||
        !admitted.has(document.parent_event_id) ||
        results.has(document.parent_event_id)
      ) {
        continue;
      }
      results.set(document.parent_event_id, await normalizeWorkerCpuProfile(document, root));
    } catch {
      // Malformed private diagnostics never disrupt the browser capture.
    }
  }
  return results;
}

export async function normalizeWorkerCpuProfile(document, repositoryRoot) {
  let root;
  try {
    root = await realpath(resolve(repositoryRoot));
  } catch {
    return emptySummary('invalid');
  }
  if (!validRawDocument(document)) return emptySummary('invalid');
  if (!document.supported) {
    return summaryFrom(document, 'unsupported', [], false);
  }
  if (document.overlapping_dynamic_requests > 0) {
    return summaryFrom(document, 'contaminated', [], false);
  }
  const workers = await Promise.all(
    document.workers.map((worker) => normalizeWorker(worker, root))
  );
  const retained = workers.filter((worker) => worker.state === 'observed').length;
  const normalizedComplete =
    document.inventory.complete === true &&
    retained === document.inventory.retained &&
    workers.length === document.inventory.attempted;
  const state = !normalizedComplete
    ? 'insufficient'
    : document.inventory.online_at_admission === 0
      ? 'observed_zero'
      : 'observed';
  return summaryFrom(document, state, workers, normalizedComplete);
}

async function normalizeWorker(worker, root) {
  if (worker.state !== 'observed') {
    return {
      ordinal: worker.ordinal,
      state: worker.state,
      start_request_offset_ms: worker.start_request_offset_ms,
      start_offset_ms: worker.start_offset_ms,
      stop_offset_ms: worker.stop_offset_ms,
      user_ms: null,
      system_ms: null,
      cpu_ms: null,
      profile: null,
    };
  }
  const sampledUs = worker.profile.timeDeltas
    .slice(0, worker.profile.samples.length)
    .reduce((total, delta) => total + delta, 0);
  const normalized = await normalizeCpuProfile(
    {
      overlapping_dynamic_requests: 0,
      response_commit_offset_ms: sampledUs / 1_000,
      profile: worker.profile,
    },
    root
  );
  const precommit = normalized.precommit;
  const profile = {
    state: normalized.state,
    total_samples: normalized.total_samples,
    sampled_time_ms: normalized.sampled_time_ms,
    non_idle_sampled_time_ms: precommit.non_idle_sampled_time_ms,
    sample_scope: normalized.sample_scope,
    sample_scope_time_ms: precommit.sample_scope_time_ms,
    candidates: normalized.candidates.map((candidate) => ({
      ...candidate,
      source: { ...candidate.source, provenance: 'node_worker_cpu_sample' },
    })),
    complete: normalized.complete && precommit.complete,
  };
  const userMs = round3(worker.user_us / 1_000);
  const systemMs = round3(worker.system_us / 1_000);
  return {
    ordinal: worker.ordinal,
    state: profile.complete ? 'observed' : 'stop_failed',
    start_request_offset_ms: round3(worker.start_request_offset_ms),
    start_offset_ms: round3(worker.start_offset_ms),
    stop_offset_ms: round3(worker.stop_offset_ms),
    user_ms: userMs,
    system_ms: systemMs,
    cpu_ms: round3(userMs + systemMs),
    profile: profile.complete ? profile : null,
  };
}

function summaryFrom(document, state, workers, complete) {
  const totals = workers.reduce(
    (result, worker) => {
      if (worker.state !== 'observed') return result;
      result.user_ms += worker.user_ms;
      result.system_ms += worker.system_ms;
      result.cpu_ms += worker.cpu_ms;
      return result;
    },
    { user_ms: 0, system_ms: 0, cpu_ms: 0 }
  );
  return assertServerRequestWorkerCpuSummary({
    schema_version: SERVER_REQUEST_WORKER_CPU_SCHEMA_VERSION,
    state,
    runtime_support: document.supported === true ? 'supported' : 'unsupported',
    response_commit_offset_ms:
      Number.isFinite(document.response_commit_offset_ms) && document.response_commit_offset_ms >= 0
        ? round3(document.response_commit_offset_ms)
        : null,
    overlapping_dynamic_requests: document.overlapping_dynamic_requests ?? 0,
    inventory: document.inventory
      ? {
          ...document.inventory,
          attempted: workers.length,
          retained: workers.filter((worker) => worker.state === 'observed').length,
          complete,
        }
      : emptyInventory(),
    total_user_ms: round3(totals.user_ms),
    total_system_ms: round3(totals.system_ms),
    total_cpu_ms: round3(totals.cpu_ms),
    workers,
    complete,
    observer_effect: 'worker_profilers_started_before_handler_dispatch',
  });
}

function emptySummary(state) {
  return assertServerRequestWorkerCpuSummary({
    schema_version: SERVER_REQUEST_WORKER_CPU_SCHEMA_VERSION,
    state,
    runtime_support: 'unknown',
    response_commit_offset_ms: null,
    overlapping_dynamic_requests: 0,
    inventory: emptyInventory(),
    total_user_ms: 0,
    total_system_ms: 0,
    total_cpu_ms: 0,
    workers: [],
    complete: false,
    observer_effect: 'worker_profilers_started_before_handler_dispatch',
  });
}

function emptyInventory() {
  return {
    registered_total: 0,
    registered_current: 0,
    online_at_admission: 0,
    attempted: 0,
    retained: 0,
    created_during_interval: 0,
    registry_truncated: false,
    admitted_truncated: false,
    complete: false,
  };
}

export function assertServerRequestWorkerCpuSummary(value) {
  if (!validServerRequestWorkerCpuSummary(value)) {
    throw new Error('server request Worker CPU summary is invalid');
  }
  return value;
}

export function validServerRequestWorkerCpuSummary(value) {
  return (
    closed(value, [
      'schema_version',
      'state',
      'runtime_support',
      'response_commit_offset_ms',
      'overlapping_dynamic_requests',
      'inventory',
      'total_user_ms',
      'total_system_ms',
      'total_cpu_ms',
      'workers',
      'complete',
      'observer_effect',
    ]) &&
    value.schema_version === SERVER_REQUEST_WORKER_CPU_SCHEMA_VERSION &&
    SUMMARY_STATES.has(value.state) &&
    ['supported', 'unsupported', 'unknown'].includes(value.runtime_support) &&
    nullableNonnegative(value.response_commit_offset_ms) &&
    safeCount(value.overlapping_dynamic_requests) &&
    validInventory(value.inventory) &&
    nonnegative(value.total_user_ms) &&
    nonnegative(value.total_system_ms) &&
    nonnegative(value.total_cpu_ms) &&
    Math.abs(value.total_cpu_ms - (value.total_user_ms + value.total_system_ms)) <= 0.01 &&
    Array.isArray(value.workers) &&
    value.workers.length <= SERVER_REQUEST_WORKER_CPU_LIMITS.workers &&
    value.workers.every(validWorker) &&
    value.workers.length === value.inventory.attempted &&
    value.workers.filter((worker) => worker.state === 'observed').length ===
      value.inventory.retained &&
    typeof value.complete === 'boolean' &&
    value.complete === value.inventory.complete &&
    (value.state === 'observed_zero') ===
      (value.complete && value.inventory.online_at_admission === 0) &&
    (value.state === 'observed') === (value.complete && value.inventory.online_at_admission > 0) &&
    value.observer_effect === 'worker_profilers_started_before_handler_dispatch'
  );
}

function validRawDocument(value) {
  return (
    closed(value, [
      'schema_version',
      'parent_event_id',
      'supported',
      'response_commit_offset_ms',
      'overlapping_dynamic_requests',
      'inventory',
      'workers',
    ]) &&
    value.schema_version === SERVER_REQUEST_WORKER_CPU_PROFILE_SCHEMA_VERSION &&
    safeEventId(value.parent_event_id) &&
    typeof value.supported === 'boolean' &&
    nullableNonnegative(value.response_commit_offset_ms) &&
    safeCount(value.overlapping_dynamic_requests) &&
    validInventory(value.inventory) &&
    Array.isArray(value.workers) &&
    value.workers.length <= SERVER_REQUEST_WORKER_CPU_LIMITS.workers &&
    value.workers.length === value.inventory.attempted &&
    value.workers.every(validRawWorker)
  );
}

function validInventory(value) {
  if (
    !closed(value, [
      'registered_total',
      'registered_current',
      'online_at_admission',
      'attempted',
      'retained',
      'created_during_interval',
      'registry_truncated',
      'admitted_truncated',
      'complete',
    ])
  ) {
    return false;
  }
  const counts = [
    value.registered_total,
    value.registered_current,
    value.online_at_admission,
    value.attempted,
    value.retained,
    value.created_during_interval,
  ];
  return (
    counts.every(safeCount) &&
    value.attempted <= SERVER_REQUEST_WORKER_CPU_LIMITS.workers &&
    value.retained <= value.attempted &&
    value.attempted <= value.online_at_admission &&
    value.online_at_admission <= value.registered_current &&
    value.registered_current <= value.registered_total &&
    typeof value.registry_truncated === 'boolean' &&
    typeof value.admitted_truncated === 'boolean' &&
    typeof value.complete === 'boolean'
  );
}

function validRawWorker(value) {
  if (
    !closed(value, [
      'ordinal',
      'state',
      'start_request_offset_ms',
      'start_offset_ms',
      'stop_offset_ms',
      'user_us',
      'system_us',
      'profile',
    ]) ||
    !safeCount(value.ordinal) ||
    value.ordinal < 1 ||
    !WORKER_STATES.has(value.state) ||
    !nonnegative(value.start_request_offset_ms) ||
    !nullableNonnegative(value.start_offset_ms) ||
    !nullableNonnegative(value.stop_offset_ms)
  ) {
    return false;
  }
  if (value.state !== 'observed') {
    return value.user_us === null && value.system_us === null && value.profile === null;
  }
  return (
    Number.isSafeInteger(value.user_us) &&
    value.user_us >= 0 &&
    Number.isSafeInteger(value.system_us) &&
    value.system_us >= 0 &&
    value.start_offset_ms !== null &&
    value.stop_offset_ms !== null &&
    value.start_offset_ms <= value.stop_offset_ms &&
    validRawProfile(value.profile)
  );
}

function validRawProfile(profile) {
  return (
    profile &&
    Array.isArray(profile.nodes) &&
    Array.isArray(profile.samples) &&
    profile.samples.length <= SERVER_REQUEST_WORKER_CPU_LIMITS.samples &&
    Array.isArray(profile.timeDeltas) &&
    profile.timeDeltas.length >= profile.samples.length &&
    profile.timeDeltas
      .slice(0, profile.samples.length)
      .every((delta) => Number.isFinite(delta) && delta >= 0)
  );
}

function validWorker(value) {
  if (
    !closed(value, [
      'ordinal',
      'state',
      'start_request_offset_ms',
      'start_offset_ms',
      'stop_offset_ms',
      'user_ms',
      'system_ms',
      'cpu_ms',
      'profile',
    ]) ||
    !safeCount(value.ordinal) ||
    value.ordinal < 1 ||
    !WORKER_STATES.has(value.state) ||
    !nonnegative(value.start_request_offset_ms) ||
    !nullableNonnegative(value.start_offset_ms) ||
    !nullableNonnegative(value.stop_offset_ms)
  ) {
    return false;
  }
  if (value.state !== 'observed') {
    return (
      value.user_ms === null &&
      value.system_ms === null &&
      value.cpu_ms === null &&
      value.profile === null
    );
  }
  return (
    nonnegative(value.user_ms) &&
    nonnegative(value.system_ms) &&
    nonnegative(value.cpu_ms) &&
    Math.abs(value.cpu_ms - (value.user_ms + value.system_ms)) <= 0.01 &&
    value.start_offset_ms !== null &&
    value.stop_offset_ms !== null &&
    value.start_offset_ms <= value.stop_offset_ms &&
    validWorkerProfile(value.profile)
  );
}

function validWorkerProfile(value) {
  return (
    closed(value, [
      'state',
      'total_samples',
      'sampled_time_ms',
      'non_idle_sampled_time_ms',
      'sample_scope',
      'sample_scope_time_ms',
      'candidates',
      'complete',
    ]) &&
    ['observed', 'insufficient'].includes(value.state) &&
    safeCount(value.total_samples) &&
    nonnegative(value.sampled_time_ms) &&
    nonnegative(value.non_idle_sampled_time_ms) &&
    value.non_idle_sampled_time_ms <= value.sampled_time_ms + 0.01 &&
    validScope(value.sample_scope, value.total_samples, true) &&
    validScope(value.sample_scope_time_ms, value.sampled_time_ms, false) &&
    Array.isArray(value.candidates) &&
    value.candidates.length <= 8 &&
    value.candidates.every(validCandidate) &&
    typeof value.complete === 'boolean' &&
    value.complete === true
  );
}

function validCandidate(value) {
  return (
    closed(value, ['source', 'samples', 'sample_share', 'self_time_ms']) &&
    closed(value.source, ['file', 'line', 'function', 'provenance']) &&
    typeof value.source.file === 'string' &&
    value.source.file.length > 0 &&
    !value.source.file.startsWith('/') &&
    !value.source.file.split(/[\\/]/).includes('..') &&
    safeCount(value.source.line) &&
    value.source.line > 0 &&
    typeof value.source.function === 'string' &&
    value.source.provenance === 'node_worker_cpu_sample' &&
    safeCount(value.samples) &&
    value.samples > 0 &&
    Number.isFinite(value.sample_share) &&
    value.sample_share >= 0 &&
    value.sample_share <= 1 &&
    nonnegative(value.self_time_ms)
  );
}

function validScope(value, expected, integer) {
  return (
    closed(value, SCOPES) &&
    SCOPES.every((scope) => (integer ? safeCount(value[scope]) : nonnegative(value[scope]))) &&
    Math.abs(SCOPES.reduce((total, scope) => total + value[scope], 0) - expected) <= 0.01
  );
}

function closed(value, fields) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((field) => fields.includes(field)) &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function nullableNonnegative(value) {
  return value === null || nonnegative(value);
}

function safeEventId(value) {
  return typeof value === 'string' && /^event-\d+-\d+$/.test(value);
}

function round3(value) {
  return Math.round(value * 1_000) / 1_000;
}
