import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { classifyCpuFrameScope, normalizeRepositoryCpuFrame } from './server-request-cpu.mjs';

export const CONTINUOUS_SOURCE_RAW_SCHEMA_VERSION = 'codevetter-node-continuous-source-profile/v1';
export const CONTINUOUS_SOURCE_SCHEMA_VERSION = 'runtime-node-continuous-source-profile/v1';
export const CONTINUOUS_SOURCE_LIMITS = Object.freeze({
  files: 1,
  bytes: 8 * 1024 * 1024,
  samples: 100_000,
  nodes: 100_000,
  candidates: 8,
  stopTailMs: 100,
});
export const CONTINUOUS_SOURCE_POLICY = Object.freeze({
  sampling_interval_us: 1_000,
  minimum_samples: 5,
  minimum_self_time_ms: 5,
  minimum_non_idle_sample_share: 0.1,
});

const SCOPES = Object.freeze([
  'repository',
  'dependency',
  'generated',
  'runtime',
  'idle',
  'unresolved',
]);
const INCOMPLETE_REASONS = new Set([
  'profile_unavailable',
  'profile_oversized',
  'startup_unattested',
  'target_unmatched',
  'target_multiple',
  'target_mismatch',
  'response_uncommitted',
  'precommit_overlap',
  'stop_tail_invalid',
  'profile_invalid',
  'interval_incomplete',
]);

export async function collectServerRequestContinuousSourceProfiles(
  directory,
  { repositoryRoot, requests = [] } = {}
) {
  const expectedByEventId = new Map(
    requests
      .filter(validExpectedRequest)
      .map((request) => [request.event_id, compactExpectedRequest(request)])
  );
  let names;
  try {
    names = (await readdir(directory))
      .filter((name) => /^continuous-source-\d+\.json$/.test(name))
      .sort();
  } catch {
    return new Map();
  }
  const results = new Map();
  for (const name of names.slice(0, CONTINUOUS_SOURCE_LIMITS.files)) {
    const path = join(directory, name);
    try {
      const metadata = await stat(path);
      if (
        !metadata.isFile() ||
        metadata.size < 1 ||
        metadata.size > CONTINUOUS_SOURCE_LIMITS.bytes
      ) {
        continue;
      }
      const document = JSON.parse(await readFile(path, 'utf8'));
      const expected = expectedByEventId.get(document?.parent_event_id);
      if (!expected || results.has(document.parent_event_id)) continue;
      const summary = await normalizeContinuousSourceProfile(document, repositoryRoot, expected);
      results.set(document.parent_event_id, summary);
    } catch {
      // Private malformed evidence is omitted and cannot disrupt the browser capture.
    }
  }
  return results;
}

export async function normalizeContinuousSourceProfile(document, repositoryRoot, expectedTarget) {
  const expected = validExpectedTarget(expectedTarget) ? expectedTarget : null;
  let root;
  try {
    root = await realpath(resolve(repositoryRoot));
  } catch {
    return emptyContinuousSourceSummary('invalid', 'profile_invalid', expected);
  }
  if (!closedRawDocument(document)) {
    return emptyContinuousSourceSummary('invalid', 'profile_invalid', expected);
  }
  const target = compactTarget(document.target);
  if (!document.startup_attested) {
    return emptyContinuousSourceSummary('incomplete', 'startup_unattested', target);
  }
  if (document.target_match_count === 0) {
    return emptyContinuousSourceSummary('incomplete', 'target_unmatched', target);
  }
  if (document.target_match_count !== 1) {
    return emptyContinuousSourceSummary('incomplete', 'target_multiple', target);
  }
  if (!document.response_committed) {
    return emptyContinuousSourceSummary('incomplete', 'response_uncommitted', target);
  }
  if (expected && !sameTarget(target, expected)) {
    return emptyContinuousSourceSummary('incomplete', 'target_mismatch', expected);
  }
  if (document.overlapping_precommit_dynamic_requests > 0) {
    return emptyContinuousSourceSummary('contaminated', 'precommit_overlap', target, {
      overlap: document.overlapping_dynamic_requests,
      precommitOverlap: document.overlapping_precommit_dynamic_requests,
    });
  }
  if (
    !finiteNonnegative(document.stop_tail_ms) ||
    document.stop_tail_ms > CONTINUOUS_SOURCE_LIMITS.stopTailMs
  ) {
    return emptyContinuousSourceSummary('invalid', 'stop_tail_invalid', target);
  }
  if (document.sampling_interval_us !== CONTINUOUS_SOURCE_POLICY.sampling_interval_us) {
    return emptyContinuousSourceSummary('invalid', 'profile_invalid', target);
  }
  if (document.capture_reason !== null) {
    return emptyContinuousSourceSummary('incomplete', document.capture_reason, target);
  }
  const profile = document.profile;
  if (!validRawProfile(profile)) {
    return emptyContinuousSourceSummary('invalid', 'profile_invalid', target);
  }
  const totalProfileUs = profile.timeDeltas.reduce((total, delta) => total + delta, 0);
  const stopTailUs = document.stop_tail_ms * 1_000;
  const requestUs = document.response_commit_offset_ms * 1_000;
  const commitPositionUs = totalProfileUs - stopTailUs;
  const requestStartPositionUs = commitPositionUs - requestUs;
  if (
    !Number.isFinite(totalProfileUs) ||
    totalProfileUs < 0 ||
    !Number.isFinite(commitPositionUs) ||
    !Number.isFinite(requestStartPositionUs) ||
    requestStartPositionUs < 0 ||
    commitPositionUs > totalProfileUs
  ) {
    return emptyContinuousSourceSummary('incomplete', 'interval_incomplete', target);
  }

  const nodes = new Map();
  for (const node of profile.nodes) {
    if (Number.isSafeInteger(node?.id) && node.callFrame) nodes.set(node.id, node.callFrame);
  }
  const scopeSamples = emptyScopeCounts();
  const scopeTimeUs = emptyScopeCounts();
  const repositoryFrames = new Map();
  let cumulativeUs = 0;
  let admittedSamples = 0;
  let admittedTimeUs = 0;
  let nonIdleTimeUs = 0;
  for (let index = 0; index < profile.samples.length; index += 1) {
    const deltaUs = profile.timeDeltas[index];
    const sampleStartUs = cumulativeUs;
    cumulativeUs += deltaUs;
    if (sampleStartUs < requestStartPositionUs || cumulativeUs > commitPositionUs) continue;
    const callFrame = nodes.get(profile.samples[index]);
    const source = await normalizeRepositoryCpuFrame(callFrame, root);
    const scope = source ? 'repository' : classifyCpuFrameScope(callFrame);
    admittedSamples += 1;
    admittedTimeUs += deltaUs;
    scopeSamples[scope] += 1;
    scopeTimeUs[scope] += deltaUs;
    if (scope !== 'idle') nonIdleTimeUs += deltaUs;
    if (!source) continue;
    const key = `${source.file}:${source.line}:${source.function}`;
    const retained = repositoryFrames.get(key) ?? { source, samples: 0, self_time_us: 0 };
    retained.samples += 1;
    retained.self_time_us += deltaUs;
    repositoryFrames.set(key, retained);
  }

  const candidates = [...repositoryFrames.values()]
    .map((entry) => ({
      source: { ...entry.source, provenance: 'continuous_node_cpu_sample' },
      samples: entry.samples,
      self_time_ms: round3(entry.self_time_us / 1_000),
      non_idle_sample_share: round6(nonIdleTimeUs > 0 ? entry.self_time_us / nonIdleTimeUs : 0),
    }))
    .filter(
      (candidate) =>
        candidate.samples >= CONTINUOUS_SOURCE_POLICY.minimum_samples &&
        candidate.self_time_ms >= CONTINUOUS_SOURCE_POLICY.minimum_self_time_ms &&
        candidate.non_idle_sample_share >= CONTINUOUS_SOURCE_POLICY.minimum_non_idle_sample_share
    )
    .toSorted(
      (left, right) =>
        right.self_time_ms - left.self_time_ms ||
        right.samples - left.samples ||
        left.source.file.localeCompare(right.source.file) ||
        left.source.line - right.source.line
    )
    .slice(0, CONTINUOUS_SOURCE_LIMITS.candidates);

  return assertContinuousSourceSummary({
    schema_version: CONTINUOUS_SOURCE_SCHEMA_VERSION,
    state: candidates.length > 0 ? 'observed' : 'unresolved',
    incomplete_reason: null,
    target,
    startup_attested: true,
    interval: {
      response_commit_offset_ms: round3(document.response_commit_offset_ms),
      stop_tail_ms: round3(document.stop_tail_ms),
      sampling_interval_us: document.sampling_interval_us,
      boundary_uncertainty_ms: round3(
        document.stop_tail_ms + document.sampling_interval_us / 1_000
      ),
      profile_duration_ms: round3(totalProfileUs / 1_000),
      request_start_position_ms: round3(requestStartPositionUs / 1_000),
      commit_position_ms: round3(commitPositionUs / 1_000),
    },
    overlapping_dynamic_requests: document.overlapping_dynamic_requests,
    overlapping_precommit_dynamic_requests: document.overlapping_precommit_dynamic_requests,
    total_samples: admittedSamples,
    sampled_time_ms: round3(admittedTimeUs / 1_000),
    non_idle_sampled_time_ms: round3(nonIdleTimeUs / 1_000),
    sample_scope: scopeSamples,
    sample_scope_time_ms: Object.fromEntries(
      SCOPES.map((scope) => [scope, round3(scopeTimeUs[scope] / 1_000)])
    ),
    candidates,
    complete: true,
    observer_effect: 'continuous_v8_sampling_from_owned_runtime_startup',
    authority: noAuthority(),
  });
}

export function assertContinuousSourceSummary(value) {
  if (
    !closed(value, [
      'schema_version',
      'state',
      'incomplete_reason',
      'target',
      'startup_attested',
      'interval',
      'overlapping_dynamic_requests',
      'overlapping_precommit_dynamic_requests',
      'total_samples',
      'sampled_time_ms',
      'non_idle_sampled_time_ms',
      'sample_scope',
      'sample_scope_time_ms',
      'candidates',
      'complete',
      'observer_effect',
      'authority',
    ]) ||
    value.schema_version !== CONTINUOUS_SOURCE_SCHEMA_VERSION ||
    !['observed', 'unresolved', 'contaminated', 'incomplete', 'invalid'].includes(value.state) ||
    (value.incomplete_reason !== null && !INCOMPLETE_REASONS.has(value.incomplete_reason)) ||
    !validExpectedTarget(value.target) ||
    typeof value.startup_attested !== 'boolean' ||
    !validInterval(value.interval) ||
    !safeCount(value.overlapping_dynamic_requests) ||
    !safeCount(value.overlapping_precommit_dynamic_requests) ||
    value.overlapping_precommit_dynamic_requests > value.overlapping_dynamic_requests ||
    !safeCount(value.total_samples) ||
    value.total_samples > CONTINUOUS_SOURCE_LIMITS.samples ||
    !finiteNonnegative(value.sampled_time_ms) ||
    !finiteNonnegative(value.non_idle_sampled_time_ms) ||
    value.non_idle_sampled_time_ms > value.sampled_time_ms + 0.01 ||
    !validScopeCounts(value.sample_scope, value.total_samples) ||
    !validScopeTimes(value.sample_scope_time_ms, value.sampled_time_ms) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > CONTINUOUS_SOURCE_LIMITS.candidates ||
    value.candidates.some(
      (candidate) => !validCandidate(candidate, value.non_idle_sampled_time_ms)
    ) ||
    typeof value.complete !== 'boolean' ||
    value.complete !== ['observed', 'unresolved'].includes(value.state) ||
    (value.state === 'observed') !== value.candidates.length > 0 ||
    (value.state === 'contaminated') !== (value.incomplete_reason === 'precommit_overlap') ||
    (value.complete ? value.incomplete_reason !== null : value.incomplete_reason === null) ||
    value.observer_effect !== 'continuous_v8_sampling_from_owned_runtime_startup' ||
    !validAuthority(value.authority)
  ) {
    throw new Error('continuous source summary is invalid');
  }
  return value;
}

export function emptyContinuousSourceSummary(
  state = 'incomplete',
  reason = 'profile_unavailable',
  target = null,
  { overlap = 0, precommitOverlap = 0 } = {}
) {
  const safeTarget = validExpectedTarget(target)
    ? compactTarget(target)
    : { ordinal: 1, method: 'GET', route: '/' };
  return assertContinuousSourceSummary({
    schema_version: CONTINUOUS_SOURCE_SCHEMA_VERSION,
    state,
    incomplete_reason: reason,
    target: safeTarget,
    startup_attested: false,
    interval: null,
    overlapping_dynamic_requests: overlap,
    overlapping_precommit_dynamic_requests: precommitOverlap,
    total_samples: 0,
    sampled_time_ms: 0,
    non_idle_sampled_time_ms: 0,
    sample_scope: emptyScopeCounts(),
    sample_scope_time_ms: emptyScopeCounts(),
    candidates: [],
    complete: false,
    observer_effect: 'continuous_v8_sampling_from_owned_runtime_startup',
    authority: noAuthority(),
  });
}

function closedRawDocument(value) {
  return (
    closed(value, [
      'schema_version',
      'parent_event_id',
      'startup_attested',
      'target',
      'target_match_count',
      'response_committed',
      'response_commit_offset_ms',
      'stop_tail_ms',
      'sampling_interval_us',
      'overlapping_dynamic_requests',
      'overlapping_precommit_dynamic_requests',
      'capture_reason',
      'profile',
    ]) &&
    value.schema_version === CONTINUOUS_SOURCE_RAW_SCHEMA_VERSION &&
    typeof value.parent_event_id === 'string' &&
    value.parent_event_id.length > 0 &&
    typeof value.startup_attested === 'boolean' &&
    validExpectedTarget(value.target) &&
    safeCount(value.target_match_count) &&
    typeof value.response_committed === 'boolean' &&
    finiteNonnegative(value.response_commit_offset_ms) &&
    finiteNonnegative(value.stop_tail_ms) &&
    Number.isSafeInteger(value.sampling_interval_us) &&
    safeCount(value.overlapping_dynamic_requests) &&
    safeCount(value.overlapping_precommit_dynamic_requests) &&
    value.overlapping_precommit_dynamic_requests <= value.overlapping_dynamic_requests &&
    (value.capture_reason === null ||
      ['profile_unavailable', 'profile_oversized', 'profile_invalid'].includes(
        value.capture_reason
      ))
  );
}

function validRawProfile(value) {
  return (
    value &&
    Array.isArray(value.nodes) &&
    value.nodes.length <= CONTINUOUS_SOURCE_LIMITS.nodes &&
    Array.isArray(value.samples) &&
    value.samples.length <= CONTINUOUS_SOURCE_LIMITS.samples &&
    Array.isArray(value.timeDeltas) &&
    value.timeDeltas.length === value.samples.length &&
    value.timeDeltas.every(finiteNonnegative)
  );
}

function validInterval(value) {
  if (value === null) return true;
  return (
    closed(value, [
      'response_commit_offset_ms',
      'stop_tail_ms',
      'sampling_interval_us',
      'boundary_uncertainty_ms',
      'profile_duration_ms',
      'request_start_position_ms',
      'commit_position_ms',
    ]) &&
    finiteNonnegative(value.response_commit_offset_ms) &&
    finiteNonnegative(value.stop_tail_ms) &&
    value.stop_tail_ms <= CONTINUOUS_SOURCE_LIMITS.stopTailMs &&
    value.sampling_interval_us === CONTINUOUS_SOURCE_POLICY.sampling_interval_us &&
    finiteNonnegative(value.boundary_uncertainty_ms) &&
    finiteNonnegative(value.profile_duration_ms) &&
    finiteNonnegative(value.request_start_position_ms) &&
    finiteNonnegative(value.commit_position_ms) &&
    value.request_start_position_ms <= value.commit_position_ms &&
    value.commit_position_ms <= value.profile_duration_ms
  );
}

function validCandidate(value, nonIdleTimeMs) {
  return (
    closed(value, ['source', 'samples', 'self_time_ms', 'non_idle_sample_share']) &&
    closed(value.source, ['file', 'line', 'function', 'provenance']) &&
    typeof value.source.file === 'string' &&
    value.source.file.length > 0 &&
    !value.source.file.startsWith('/') &&
    !value.source.file.includes('\\') &&
    !value.source.file.split('/').includes('..') &&
    Number.isSafeInteger(value.source.line) &&
    value.source.line > 0 &&
    typeof value.source.function === 'string' &&
    value.source.provenance === 'continuous_node_cpu_sample' &&
    Number.isSafeInteger(value.samples) &&
    value.samples >= CONTINUOUS_SOURCE_POLICY.minimum_samples &&
    finiteNonnegative(value.self_time_ms) &&
    value.self_time_ms >= CONTINUOUS_SOURCE_POLICY.minimum_self_time_ms &&
    finiteShare(value.non_idle_sample_share) &&
    value.non_idle_sample_share >= CONTINUOUS_SOURCE_POLICY.minimum_non_idle_sample_share &&
    value.self_time_ms <= nonIdleTimeMs + 0.01
  );
}

function validAuthority(value) {
  return (
    closed(value, [
      'confidence',
      'source_causal',
      'edit_eligible',
      'optimization_eligible',
      'production_representative',
    ]) &&
    value.confidence === 'low' &&
    value.source_causal === false &&
    value.edit_eligible === false &&
    value.optimization_eligible === false &&
    value.production_representative === false
  );
}

function noAuthority() {
  return {
    confidence: 'low',
    source_causal: false,
    edit_eligible: false,
    optimization_eligible: false,
    production_representative: false,
  };
}

function validExpectedRequest(value) {
  return typeof value?.event_id === 'string' && validExpectedTarget(value);
}

function compactExpectedRequest(value) {
  return { ordinal: value.correlation_ordinal, method: value.method, route: value.route };
}

function validExpectedTarget(value) {
  return (
    value &&
    Number.isSafeInteger(value.ordinal ?? value.correlation_ordinal) &&
    (value.ordinal ?? value.correlation_ordinal) > 0 &&
    typeof value.method === 'string' &&
    /^[A-Z]{1,16}$/.test(value.method) &&
    typeof value.route === 'string' &&
    value.route.startsWith('/') &&
    value.route.length <= 2_048
  );
}

function compactTarget(value) {
  return {
    ordinal: value.ordinal ?? value.correlation_ordinal,
    method: value.method,
    route: value.route,
  };
}

function sameTarget(left, right) {
  return (
    left.ordinal === (right.ordinal ?? right.correlation_ordinal) &&
    left.method === right.method &&
    left.route === right.route
  );
}

function validScopeCounts(value, expectedTotal) {
  return (
    closed(value, SCOPES) &&
    SCOPES.every((scope) => safeCount(value[scope])) &&
    SCOPES.reduce((total, scope) => total + value[scope], 0) === expectedTotal
  );
}

function validScopeTimes(value, expectedTotal) {
  return (
    closed(value, SCOPES) &&
    SCOPES.every((scope) => finiteNonnegative(value[scope])) &&
    Math.abs(SCOPES.reduce((total, scope) => total + value[scope], 0) - expectedTotal) <= 0.01
  );
}

function emptyScopeCounts() {
  return Object.fromEntries(SCOPES.map((scope) => [scope, 0]));
}

function closed(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
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

function round3(value) {
  return Math.round(value * 1_000) / 1_000;
}

function round6(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
