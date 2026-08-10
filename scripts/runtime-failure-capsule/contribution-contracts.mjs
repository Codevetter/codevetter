import { sha256, stableStringify } from './campaign-contracts.mjs';

export const CANDIDATE_CHALLENGE_SCHEMA_VERSION = 'optimization-candidate-challenge/v1';
export const CONTRIBUTION_RECEIPT_SCHEMA_VERSION = 'optimization-contribution-receipt/v1';

export const CONTRIBUTION_LIMITS = Object.freeze({
  justificationCharacters: 1_000,
  pullRequestUrlCharacters: 300,
  receiptBytes: 1024 * 1024,
  riskSignals: 16,
  reviewThreads: 100,
  checkRuns: 100,
});

const PATCH_QUALITY = new Set([
  'simpler_candidate_selected',
  'retained_with_justification',
  'no_confidence',
]);
const CHECK_STATUSES = new Set([
  'passed',
  'pending',
  'approval_required',
  'failed',
  'not_observed',
]);
const TREX_STATUSES = new Set([
  'passed_with_limits',
  'failed',
  'no_confidence',
  'missing',
  'missing_optional',
  'not_applicable',
  'stale',
]);

export function createDigestedArtifact(schemaVersion, payload, digestField) {
  const value = { schema_version: schemaVersion, ...payload, [digestField]: null };
  value[digestField] = artifactDigest(value, digestField);
  return value;
}

export function artifactDigest(value, digestField) {
  const payload = { ...value };
  delete payload[digestField];
  return sha256(stableStringify(payload));
}

export function assertCandidateChallenge(value) {
  const errors = [];
  object(value, 'challenge', errors);
  if (errors.length === 0) {
    closed(
      value,
      [
        'schema_version',
        'campaign_id',
        'created_at',
        'candidate',
        'comparison',
        'diff_observations',
        'patch_quality',
        'challenge_digest',
      ],
      'challenge',
      errors
    );
    exact(value.schema_version, CANDIDATE_CHALLENGE_SCHEMA_VERSION, 'schema_version', errors);
    text(value.campaign_id, 'campaign_id', errors, 64);
    timestamp(value.created_at, 'created_at', errors);
    candidate(value.candidate, 'candidate', errors);
    if (value.comparison !== null) candidate(value.comparison, 'comparison', errors);
    diffObservations(value.diff_observations, errors);
    patchQuality(value.patch_quality, errors);
    digest(value.challenge_digest, 'challenge_digest', errors);
    if (
      typeof value.challenge_digest === 'string' &&
      value.challenge_digest !== artifactDigest(value, 'challenge_digest')
    ) {
      errors.push('challenge_digest is invalid');
    }
  }
  if (errors.length > 0) throw new Error(`invalid candidate challenge: ${errors.join('; ')}`);
  return value;
}

export function assertContributionReceipt(value) {
  const errors = [];
  object(value, 'receipt', errors);
  if (errors.length === 0) {
    closed(
      value,
      [
        'schema_version',
        'campaign_id',
        'observed_at',
        'pull_request',
        'evidence',
        'gates',
        'status',
        'limitations',
        'previous_receipt_digest',
        'receipt_digest',
      ],
      'receipt',
      errors
    );
    exact(value.schema_version, CONTRIBUTION_RECEIPT_SCHEMA_VERSION, 'schema_version', errors);
    text(value.campaign_id, 'campaign_id', errors, 64);
    timestamp(value.observed_at, 'observed_at', errors);
    pullRequest(value.pull_request, errors);
    evidence(value.evidence, errors);
    gates(value.gates, errors);
    text(value.status, 'status', errors, 80);
    strings(value.limitations, 'limitations', errors, 50, 500);
    if (value.previous_receipt_digest !== null) {
      digest(value.previous_receipt_digest, 'previous_receipt_digest', errors);
    }
    digest(value.receipt_digest, 'receipt_digest', errors);
    if (
      typeof value.receipt_digest === 'string' &&
      value.receipt_digest !== artifactDigest(value, 'receipt_digest')
    ) {
      errors.push('receipt_digest is invalid');
    }
    const derived = deriveContributionStatus(value.gates, value.pull_request);
    if (value.status !== derived) errors.push(`status must be derived as ${derived}`);
  }
  if (errors.length > 0) throw new Error(`invalid contribution receipt: ${errors.join('; ')}`);
  return value;
}

export function deriveContributionStatus(gates, pullRequest) {
  if (gates?.freshness?.status === 'stale') return 'stale';
  if (gates?.correctness?.status !== 'passed') return 'correctness_not_proven';
  if (gates?.performance?.status !== 'confirmed') return 'performance_not_proven';
  if (!PATCH_QUALITY.has(gates?.patch_quality?.status)) return 'patch_quality_not_proven';
  if (gates?.patch_quality?.status === 'no_confidence') return 'patch_quality_not_proven';
  if (['failed', 'no_confidence', 'missing', 'stale'].includes(gates?.trex?.status)) {
    return 'trex_blocked';
  }
  if (gates?.approvals?.status === 'changes_requested') return 'review_action_required';
  if (gates?.reviews?.status === 'action_required') return 'review_action_required';
  if (gates?.checks?.status === 'failed') return 'checks_failed';
  if (gates?.checks?.status === 'approval_required') return 'checks_approval_required';
  if (gates?.checks?.status === 'pending') return 'checks_pending';
  if (gates?.checks?.status === 'not_observed') return 'checks_not_observed';
  if (pullRequest?.state === 'merged') return 'merged';
  if (pullRequest?.state !== 'open' || pullRequest?.is_draft) return 'pull_request_not_ready';
  if (gates?.merge_authority?.status === 'external_maintainer') return 'waiting_for_maintainer';
  if (gates?.merge_authority?.status !== 'contributor') return 'merge_authority_unknown';
  return 'ready';
}

function candidate(value, label, errors) {
  if (!object(value, label, errors)) return;
  closed(
    value,
    [
      'sequence',
      'record_digest',
      'candidate_revision',
      'diff_digest',
      'complexity',
      'performance_metric',
    ],
    label,
    errors
  );
  integer(value.sequence, `${label}.sequence`, errors, 0, 300);
  digest(value.record_digest, `${label}.record_digest`, errors);
  revision(value.candidate_revision, `${label}.candidate_revision`, errors);
  digest(value.diff_digest, `${label}.diff_digest`, errors);
  complexity(value.complexity, `${label}.complexity`, errors);
  if (value.performance_metric !== null) {
    if (!object(value.performance_metric, `${label}.performance_metric`, errors)) return;
    closed(
      value.performance_metric,
      ['kind', 'value', 'unit'],
      `${label}.performance_metric`,
      errors
    );
    text(value.performance_metric.kind, `${label}.performance_metric.kind`, errors, 80);
    number(value.performance_metric.value, `${label}.performance_metric.value`, errors);
    text(value.performance_metric.unit, `${label}.performance_metric.unit`, errors, 40);
  }
}

function complexity(value, label, errors) {
  if (!object(value, label, errors)) return;
  closed(
    value,
    ['files_changed', 'added_lines', 'deleted_lines', 'delta_added_lines', 'delta_deleted_lines'],
    label,
    errors
  );
  for (const key of Object.keys(value))
    integer(value[key], `${label}.${key}`, errors, -1_000_000, 1_000_000);
}

function diffObservations(value, errors) {
  if (!object(value, 'diff_observations', errors)) return;
  closed(value, ['changed_files', 'diff_digest', 'risk_signals'], 'diff_observations', errors);
  strings(value.changed_files, 'diff_observations.changed_files', errors, 64, 300);
  digest(value.diff_digest, 'diff_observations.diff_digest', errors);
  if (
    !Array.isArray(value.risk_signals) ||
    value.risk_signals.length > CONTRIBUTION_LIMITS.riskSignals
  ) {
    errors.push('diff_observations.risk_signals is invalid');
  } else {
    value.risk_signals.forEach((signal, index) => {
      const label = `diff_observations.risk_signals[${index}]`;
      if (!object(signal, label, errors)) return;
      closed(signal, ['kind', 'occurrences'], label, errors);
      text(signal.kind, `${label}.kind`, errors, 80);
      integer(signal.occurrences, `${label}.occurrences`, errors, 1, 10_000);
    });
  }
}

function patchQuality(value, errors) {
  if (!object(value, 'patch_quality', errors)) return;
  closed(value, ['status', 'reason', 'justification'], 'patch_quality', errors);
  if (!PATCH_QUALITY.has(value.status)) errors.push('patch_quality.status is invalid');
  text(value.reason, 'patch_quality.reason', errors, 1_000);
  if (value.justification !== null) {
    text(
      value.justification,
      'patch_quality.justification',
      errors,
      CONTRIBUTION_LIMITS.justificationCharacters
    );
  }
}

function pullRequest(value, errors) {
  if (!object(value, 'pull_request', errors)) return;
  closed(
    value,
    ['url', 'repository', 'number', 'head_sha', 'base_sha', 'state', 'is_draft', 'mergeable'],
    'pull_request',
    errors
  );
  text(value.url, 'pull_request.url', errors, CONTRIBUTION_LIMITS.pullRequestUrlCharacters);
  text(value.repository, 'pull_request.repository', errors, 200);
  integer(value.number, 'pull_request.number', errors, 1, 10_000_000);
  revision(value.head_sha, 'pull_request.head_sha', errors);
  revision(value.base_sha, 'pull_request.base_sha', errors);
  if (!['open', 'closed', 'merged'].includes(value.state))
    errors.push('pull_request.state is invalid');
  if (typeof value.is_draft !== 'boolean') errors.push('pull_request.is_draft must be boolean');
  text(value.mergeable, 'pull_request.mergeable', errors, 40);
}

function evidence(value, errors) {
  if (!object(value, 'evidence', errors)) return;
  closed(
    value,
    [
      'campaign_record_digest',
      'baseline_revision',
      'candidate_revision',
      'candidate_diff_digest',
      'challenge_path',
      'challenge_digest',
      'trex_path',
    ],
    'evidence',
    errors
  );
  digest(value.campaign_record_digest, 'evidence.campaign_record_digest', errors);
  revision(value.baseline_revision, 'evidence.baseline_revision', errors);
  revision(value.candidate_revision, 'evidence.candidate_revision', errors);
  digest(value.candidate_diff_digest, 'evidence.candidate_diff_digest', errors);
  safePath(value.challenge_path, 'evidence.challenge_path', errors);
  digest(value.challenge_digest, 'evidence.challenge_digest', errors);
  if (value.trex_path !== null) safePath(value.trex_path, 'evidence.trex_path', errors);
}

function gates(value, errors) {
  if (!object(value, 'gates', errors)) return;
  closed(
    value,
    [
      'freshness',
      'correctness',
      'performance',
      'patch_quality',
      'trex',
      'checks',
      'reviews',
      'approvals',
      'merge_authority',
    ],
    'gates',
    errors
  );
  simpleGate(value.freshness, 'freshness', new Set(['current', 'stale']), errors);
  simpleGate(
    value.correctness,
    'correctness',
    new Set(['passed', 'failed', 'no_confidence']),
    errors
  );
  simpleGate(value.performance, 'performance', new Set(['confirmed', 'no_confidence']), errors);
  simpleGate(value.patch_quality, 'patch_quality', PATCH_QUALITY, errors);
  simpleGate(value.trex, 'trex', TREX_STATUSES, errors, ['policy', 'limitations']);
  simpleGate(value.checks, 'checks', CHECK_STATUSES, errors, ['observations']);
  simpleGate(value.reviews, 'reviews', new Set(['clear', 'action_required']), errors, [
    'current_threads',
    'outdated_threads',
    'resolved_threads',
    'observations',
  ]);
  simpleGate(
    value.approvals,
    'approvals',
    new Set(['approved', 'not_observed', 'changes_requested']),
    errors,
    ['observations']
  );
  simpleGate(
    value.merge_authority,
    'merge_authority',
    new Set(['contributor', 'external_maintainer', 'unknown']),
    errors
  );
}

function simpleGate(value, label, statuses, errors, optional = []) {
  if (!object(value, `gates.${label}`, errors)) return;
  closed(value, ['status', 'reason', ...optional], `gates.${label}`, errors);
  if (!statuses.has(value.status)) errors.push(`gates.${label}.status is invalid`);
  text(value.reason, `gates.${label}.reason`, errors, 1_000);
  for (const key of optional) {
    if (key === 'policy') text(value[key], `gates.${label}.${key}`, errors, 40);
    else if (key === 'limitations') strings(value[key], `gates.${label}.${key}`, errors, 50, 500);
    else if (key === 'observations') {
      if (!Array.isArray(value[key]) || value[key].length > CONTRIBUTION_LIMITS.checkRuns) {
        errors.push(`gates.${label}.${key} is invalid`);
      }
    } else
      integer(value[key], `gates.${label}.${key}`, errors, 0, CONTRIBUTION_LIMITS.reviewThreads);
  }
}

function object(value, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  return true;
}

function closed(value, allowed, label, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label} has unknown field: ${key}`);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) errors.push(`${label} is missing field: ${key}`);
  }
}

function exact(value, expected, label, errors) {
  if (value !== expected) errors.push(`${label} must equal ${expected}`);
}

function text(value, label, errors, maximum) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    errors.push(`${label} must be non-empty text no longer than ${maximum}`);
  }
}

function strings(value, label, errors, maximumItems, maximumCharacters) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    errors.push(`${label} must be an array with at most ${maximumItems} items`);
    return;
  }
  value.forEach((entry, index) => text(entry, `${label}[${index}]`, errors, maximumCharacters));
}

function integer(value, label, errors, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    errors.push(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
}

function number(value, label, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push(`${label} must be a finite non-negative number`);
  }
}

function timestamp(value, label, errors) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
    errors.push(`${label} is invalid`);
}

function revision(value, label, errors) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40,64}$/i.test(value)) {
    errors.push(`${label} must be a full Git revision`);
  }
}

function digest(value, label, errors) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    errors.push(`${label} must be a SHA-256 digest`);
  }
}

function safePath(value, label, errors) {
  if (
    typeof value !== 'string' ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').some((part) => ['', '.', '..'].includes(part))
  ) {
    errors.push(`${label} must be a contained repository-relative path`);
  }
}
