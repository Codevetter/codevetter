import { createHash } from 'node:crypto';

import { LIMITS, assertPairedAdapter } from './contracts.mjs';

export const CAMPAIGN_MANIFEST_SCHEMA_VERSION = 'optimization-campaign-manifest/v1';
export const CAMPAIGN_RECORD_SCHEMA_VERSION = 'optimization-campaign-record/v1';
export const CAMPAIGN_STATUS_SCHEMA_VERSION = 'optimization-campaign-status/v1';

export const CAMPAIGN_LIMITS = Object.freeze({
  allowedFiles: 64,
  correctnessScopes: 8,
  experiments: 100,
  elapsedMinutes: 10_080,
  consecutive: 20,
  hypothesisCharacters: 1_000,
  ledgerBytes: 4 * 1024 * 1024,
  evidenceBytes: 8 * 1024 * 1024,
});

const CORRECTNESS_ADAPTERS = new Set(['node-test', 'vitest', 'jest', 'go-test']);
const DECISIONS = new Set([
  'initialized',
  'baseline_ready',
  'promising',
  'discard',
  'crash',
  'no_confidence',
  'keep',
]);
const RECORD_KINDS = new Set(['initialized', 'baseline', 'screen', 'promotion']);

export function assertCampaignManifest(value) {
  const errors = validateCampaignManifest(value);
  if (errors.length > 0) throw new Error(`invalid campaign manifest: ${errors.join('; ')}`);
  return value;
}

export function validateCampaignManifest(value) {
  const errors = [];
  if (!plainObject(value)) return ['manifest must be an object'];
  closed(
    value,
    [
      'schema_version',
      'campaign_id',
      'repository_revision',
      'artifact_directory',
      'allowed_files',
      'correctness',
      'performance',
      'budgets',
    ],
    'manifest',
    errors
  );
  exact(value.schema_version, CAMPAIGN_MANIFEST_SCHEMA_VERSION, 'schema_version', errors);
  text(value.campaign_id, 'campaign_id', errors, 64);
  if (typeof value.campaign_id === 'string' && !/^[a-z0-9][a-z0-9-]*$/.test(value.campaign_id)) {
    errors.push('campaign_id must use lowercase letters, digits, and hyphens');
  }
  text(value.repository_revision, 'repository_revision', errors, 64);
  if (
    typeof value.repository_revision === 'string' &&
    !/^[0-9a-f]{7,64}$/i.test(value.repository_revision)
  ) {
    errors.push('repository_revision must be a Git object identifier');
  }
  safePath(value.artifact_directory, 'artifact_directory', errors, { directory: true });
  if (
    typeof value.artifact_directory === 'string' &&
    !value.artifact_directory.startsWith('.codevetter/optimization-campaigns/')
  ) {
    errors.push('artifact_directory must be under .codevetter/optimization-campaigns/');
  }
  stringPaths(value.allowed_files, 'allowed_files', errors, CAMPAIGN_LIMITS.allowedFiles);
  if (Array.isArray(value.allowed_files) && value.allowed_files.length === 0) {
    errors.push('allowed_files must not be empty');
  }
  validateCorrectness(value.correctness, errors);
  validatePerformance(value.performance, errors);
  validateBudgets(value.budgets, errors);

  const protectedTargets = new Set([
    ...(Array.isArray(value.correctness) ? value.correctness.map((scope) => scope?.target) : []),
    value.performance?.target,
  ]);
  for (const allowed of Array.isArray(value.allowed_files) ? value.allowed_files : []) {
    for (const target of protectedTargets) {
      if (
        typeof target === 'string' &&
        (allowed === target || (allowed.endsWith('/') && target.startsWith(allowed)))
      ) {
        errors.push(`allowed_files includes evaluator target: ${target}`);
      }
    }
    if (
      typeof value.artifact_directory === 'string' &&
      (allowed === value.artifact_directory || allowed.startsWith(`${value.artifact_directory}/`))
    ) {
      errors.push('allowed_files must not include the campaign artifact directory');
    }
  }
  return [...new Set(errors)];
}

export function assertCampaignRecord(value, { manifestDigest, sequence, previousDigest } = {}) {
  const errors = validateCampaignRecord(value);
  if (manifestDigest && value?.manifest_digest !== manifestDigest) {
    errors.push('record manifest_digest does not match the campaign manifest');
  }
  if (sequence !== undefined && value?.sequence !== sequence) {
    errors.push(`record sequence must be ${sequence}`);
  }
  if ((value?.previous_record_digest ?? null) !== (previousDigest ?? null)) {
    errors.push('record digest chain is broken');
  }
  const expected = campaignRecordDigest(value);
  if (value?.record_digest !== expected) errors.push('record_digest is invalid');
  if (errors.length > 0) throw new Error(`invalid campaign record: ${errors.join('; ')}`);
  return value;
}

export function validateCampaignRecord(value) {
  const errors = [];
  if (!plainObject(value)) return ['record must be an object'];
  closed(
    value,
    [
      'schema_version',
      'campaign_id',
      'sequence',
      'attempt',
      'kind',
      'recorded_at',
      'manifest_digest',
      'engine',
      'repository',
      'hypothesis',
      'correctness',
      'performance',
      'complexity',
      'decision',
      'limitations',
      'previous_record_digest',
      'record_digest',
    ],
    'record',
    errors
  );
  exact(value.schema_version, CAMPAIGN_RECORD_SCHEMA_VERSION, 'record.schema_version', errors);
  text(value.campaign_id, 'record.campaign_id', errors, 64);
  integer(value.sequence, 'record.sequence', errors, 0, CAMPAIGN_LIMITS.experiments * 3);
  integer(value.attempt, 'record.attempt', errors, 0, CAMPAIGN_LIMITS.experiments);
  if (!RECORD_KINDS.has(value.kind)) errors.push('record.kind is invalid');
  if (!validDate(value.recorded_at)) errors.push('record.recorded_at must be an ISO timestamp');
  digest(value.manifest_digest, 'record.manifest_digest', errors);
  validateEngine(value.engine, errors);
  validateRepository(value.repository, errors);
  if (value.hypothesis !== null) {
    text(value.hypothesis, 'record.hypothesis', errors, CAMPAIGN_LIMITS.hypothesisCharacters);
  }
  validateCorrectnessResults(value.correctness, errors);
  validateEvidenceReference(value.performance, errors);
  validateComplexityMovement(value.complexity, errors);
  validateDecision(value.decision, errors);
  validateLimitations(value.limitations, errors);
  if (value.previous_record_digest !== null)
    digest(value.previous_record_digest, 'record.previous_record_digest', errors);
  digest(value.record_digest, 'record.record_digest', errors);
  return errors;
}

function validateEngine(value, errors) {
  if (!plainObject(value)) {
    errors.push('record.engine must be an object');
    return;
  }
  closed(value, ['id', 'implementation_digest'], 'record.engine', errors);
  text(value.id, 'record.engine.id', errors, 100);
  digest(value.implementation_digest, 'record.engine.implementation_digest', errors);
}

export function createCampaignRecord(payload) {
  const record = {
    schema_version: CAMPAIGN_RECORD_SCHEMA_VERSION,
    ...payload,
    record_digest: null,
  };
  record.record_digest = campaignRecordDigest(record);
  return record;
}

export function campaignRecordDigest(record) {
  const { record_digest: _recordDigest, ...payload } = record ?? {};
  return sha256(stableStringify(payload));
}

export function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validateCorrectness(value, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('correctness must be a non-empty array');
    return;
  }
  if (value.length > CAMPAIGN_LIMITS.correctnessScopes) {
    errors.push(`correctness exceeds ${CAMPAIGN_LIMITS.correctnessScopes} scopes`);
  }
  value.forEach((scope, index) => {
    const label = `correctness[${index}]`;
    if (!plainObject(scope)) {
      errors.push(`${label} must be an object`);
      return;
    }
    closed(scope, ['adapter', 'target', 'name', 'timeout_ms'], label, errors);
    if (!CORRECTNESS_ADAPTERS.has(scope.adapter)) errors.push(`${label}.adapter is unsupported`);
    safePath(scope.target, `${label}.target`, errors);
    text(scope.name, `${label}.name`, errors);
    integer(scope.timeout_ms, `${label}.timeout_ms`, errors, 100, LIMITS.maximumTimeoutMs);
  });
}

function validatePerformance(value, errors) {
  if (!plainObject(value)) {
    errors.push('performance must be an object');
    return;
  }
  closed(
    value,
    ['adapter', 'target', 'name', 'project', 'timeout_ms', 'screening', 'promotion'],
    'performance',
    errors
  );
  try {
    assertPairedAdapter(value.adapter);
  } catch (error) {
    errors.push(error.message);
  }
  safePath(value.target, 'performance.target', errors);
  text(value.name, 'performance.name', errors);
  if (value.project !== null) {
    text(value.project, 'performance.project', errors, 100);
    if (value.adapter !== 'playwright') {
      errors.push('performance.project is supported only for Playwright');
    }
  }
  integer(value.timeout_ms, 'performance.timeout_ms', errors, 100, LIMITS.maximumTimeoutMs);
  samplePolicy(value.screening, 'performance.screening', errors, { promotion: false });
  samplePolicy(value.promotion, 'performance.promotion', errors, { promotion: true });
}

function samplePolicy(value, label, errors, { promotion }) {
  if (!plainObject(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  closed(value, ['samples', 'warmups'], label, errors);
  integer(value.samples, `${label}.samples`, errors, LIMITS.minimumSamples, LIMITS.maximumSamples);
  integer(value.warmups, `${label}.warmups`, errors, 0, LIMITS.maximumWarmups);
  if (promotion && Number.isInteger(value.samples) && value.samples < 10) {
    errors.push(`${label}.samples must meet the 10-sample promotion floor`);
  }
}

function validateBudgets(value, errors) {
  if (!plainObject(value)) {
    errors.push('budgets must be an object');
    return;
  }
  closed(
    value,
    [
      'max_experiments',
      'max_elapsed_minutes',
      'max_consecutive_non_improvements',
      'max_consecutive_crashes',
    ],
    'budgets',
    errors
  );
  integer(value.max_experiments, 'budgets.max_experiments', errors, 1, CAMPAIGN_LIMITS.experiments);
  integer(
    value.max_elapsed_minutes,
    'budgets.max_elapsed_minutes',
    errors,
    1,
    CAMPAIGN_LIMITS.elapsedMinutes
  );
  integer(
    value.max_consecutive_non_improvements,
    'budgets.max_consecutive_non_improvements',
    errors,
    1,
    CAMPAIGN_LIMITS.consecutive
  );
  integer(
    value.max_consecutive_crashes,
    'budgets.max_consecutive_crashes',
    errors,
    1,
    CAMPAIGN_LIMITS.consecutive
  );
}

function validateRepository(value, errors) {
  if (!plainObject(value)) {
    errors.push('record.repository must be an object');
    return;
  }
  closed(
    value,
    ['revision', 'base_revision', 'diff_digest', 'dirty', 'changed_files', 'complexity'],
    'record.repository',
    errors
  );
  text(value.revision, 'record.repository.revision', errors, 64);
  text(value.base_revision, 'record.repository.base_revision', errors, 64);
  digest(value.diff_digest, 'record.repository.diff_digest', errors);
  if (typeof value.dirty !== 'boolean') errors.push('record.repository.dirty must be boolean');
  stringPaths(value.changed_files, 'record.repository.changed_files', errors, 1_000);
  validateRepositoryComplexity(value.complexity, errors);
}

function validateRepositoryComplexity(value, errors) {
  if (!plainObject(value)) {
    errors.push('record.repository.complexity must be an object');
    return;
  }
  closed(value, ['files', 'added_lines', 'deleted_lines'], 'record.repository.complexity', errors);
  integer(value.files, 'record.repository.complexity.files', errors, 0, 1_000);
  integer(value.added_lines, 'record.repository.complexity.added_lines', errors, 0, 10_000_000);
  integer(value.deleted_lines, 'record.repository.complexity.deleted_lines', errors, 0, 10_000_000);
}

function validateCorrectnessResults(value, errors) {
  if (!Array.isArray(value)) {
    errors.push('record.correctness must be an array');
    return;
  }
  if (value.length > CAMPAIGN_LIMITS.correctnessScopes * 2) {
    errors.push('record.correctness contains too many results');
  }
  for (const [index, result] of value.entries()) {
    const label = `record.correctness[${index}]`;
    if (!plainObject(result)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    closed(
      result,
      ['role', 'scope', 'status', 'exit_code', 'duration_ms', 'selection', 'limitation'],
      label,
      errors
    );
    if (!['candidate', 'incumbent'].includes(result.role)) errors.push(`${label}.role is invalid`);
    if (!['passed', 'failed', 'crash', 'no_confidence'].includes(result.status)) {
      errors.push(`${label}.status is invalid`);
    }
    if (result.exit_code !== null) integer(result.exit_code, `${label}.exit_code`, errors, 0, 255);
    if (typeof result.duration_ms !== 'number' || result.duration_ms < 0) {
      errors.push(`${label}.duration_ms must be a non-negative number`);
    }
    if (!plainObject(result.scope)) errors.push(`${label}.scope must be an object`);
    else {
      closed(result.scope, ['adapter', 'target', 'name'], `${label}.scope`, errors);
      if (!CORRECTNESS_ADAPTERS.has(result.scope.adapter)) {
        errors.push(`${label}.scope.adapter is unsupported`);
      }
      safePath(result.scope.target, `${label}.scope.target`, errors);
      text(result.scope.name, `${label}.scope.name`, errors);
    }
    if (result.selection !== null) {
      if (!plainObject(result.selection))
        errors.push(`${label}.selection must be an object or null`);
      else {
        closed(result.selection, ['executed', 'failed'], `${label}.selection`, errors);
        integer(result.selection.executed, `${label}.selection.executed`, errors, 0, 1_000_000);
        integer(result.selection.failed, `${label}.selection.failed`, errors, 0, 1_000_000);
      }
    }
    if (result.limitation !== null) text(result.limitation, `${label}.limitation`, errors, 1_000);
  }
}

function validateEvidenceReference(value, errors) {
  if (value === null) return;
  if (!plainObject(value)) {
    errors.push('record.performance must be an object or null');
    return;
  }
  closed(value, ['path', 'sha256', 'bytes'], 'record.performance', errors);
  safePath(value.path, 'record.performance.path', errors);
  digest(value.sha256, 'record.performance.sha256', errors);
  integer(value.bytes, 'record.performance.bytes', errors, 1, CAMPAIGN_LIMITS.evidenceBytes);
}

function validateComplexityMovement(value, errors) {
  if (!plainObject(value)) {
    errors.push('record.complexity must be an object');
    return;
  }
  const fields = [
    'files_changed',
    'added_lines',
    'deleted_lines',
    'delta_added_lines',
    'delta_deleted_lines',
  ];
  closed(value, fields, 'record.complexity', errors);
  integer(value.files_changed, 'record.complexity.files_changed', errors, 0, 1_000);
  integer(value.added_lines, 'record.complexity.added_lines', errors, 0, 10_000_000);
  integer(value.deleted_lines, 'record.complexity.deleted_lines', errors, 0, 10_000_000);
  for (const field of ['delta_added_lines', 'delta_deleted_lines']) {
    if (!Number.isInteger(value[field]) || Math.abs(value[field]) > 10_000_000) {
      errors.push(`record.complexity.${field} must be a bounded integer`);
    }
  }
}

function validateDecision(value, errors) {
  if (!plainObject(value)) {
    errors.push('record.decision must be an object');
    return;
  }
  closed(value, ['status', 'reason'], 'record.decision', errors);
  if (!DECISIONS.has(value.status)) errors.push('record.decision.status is invalid');
  text(value.reason, 'record.decision.reason', errors, 1_000);
}

function validateLimitations(value, errors) {
  if (!Array.isArray(value)) {
    errors.push('record.limitations must be an array');
    return;
  }
  if (value.length > 64) errors.push('record.limitations contains too many entries');
  value.forEach((entry, index) => text(entry, `record.limitations[${index}]`, errors, 1_000));
}

function stringPaths(value, label, errors, maximum) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return;
  }
  if (value.length > maximum) errors.push(`${label} exceeds ${maximum} entries`);
  const seen = new Set();
  value.forEach((entry, index) => {
    safePath(entry, `${label}[${index}]`, errors, { directory: entry?.endsWith?.('/') });
    if (seen.has(entry)) errors.push(`${label} contains duplicate path: ${entry}`);
    seen.add(entry);
  });
}

function safePath(value, label, errors, { directory = false } = {}) {
  text(value, label, errors);
  if (typeof value !== 'string') return;
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) {
    errors.push(`${label} must be a repository-relative POSIX path`);
  }
  const normalized = directory ? value.replace(/\/$/, '') : value;
  if (
    normalized === '' ||
    normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    errors.push(`${label} contains an invalid path segment`);
  }
}

function closed(value, keys, label, errors) {
  if (!plainObject(value)) return;
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label} contains unknown field: ${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) errors.push(`${label} is missing field: ${key}`);
  }
}

function exact(value, expected, label, errors) {
  if (value !== expected) errors.push(`${label} must equal ${expected}`);
}

function text(value, label, errors, maximum = CAMPAIGN_LIMITS.hypothesisCharacters) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    errors.push(`${label} must be a non-empty string no longer than ${maximum} characters`);
  }
}

function integer(value, label, errors, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    errors.push(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
}

function digest(value, label, errors) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    errors.push(`${label} must be a lowercase SHA-256 digest`);
  }
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!plainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])])
  );
}
