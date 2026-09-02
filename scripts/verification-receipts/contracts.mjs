import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { adaptVerificationArtifact } from './producer-adapters.mjs';

const execFileAsync = promisify(execFile);

export const RECEIPT_SCHEMA_VERSION = 'codevetter.project-verification-receipt/v1';
export const BUNDLE_SCHEMA_VERSION = 'codevetter.verification-bundle/v1';
export const COMPARISON_SCHEMA_VERSION = 'codevetter.verification-comparison/v1';

export const LIMITS = Object.freeze({
  receiptBytes: 2 * 1024 * 1024,
  artifactBytes: 32 * 1024 * 1024,
  changedFiles: 1_000,
  tests: 5_000,
  attempts: 10_000,
  evidence: 64,
  limitations: 128,
  string: 1_024,
  graphNodes: 12_000,
  graphEdges: 24_000,
  samples: 100,
  producerObservations: 256,
});

const COVERAGE = new Set(['complete', 'partial', 'aggregate', 'missing']);
const ATTEMPT_PHASES = new Set(['primary', 'recheck']);
const ATTEMPT_STATUSES = new Set([
  'passed',
  'failed',
  'skipped',
  'timed_out',
  'operational_failure',
]);
const SELECTION_MODES = new Set(['none', 'scoped', 'all']);
const REQUIRED_METRICS = new Set([
  'wall_ms',
  'cpu_ms',
  'peak_rss_bytes',
  'peak_processes',
  'fixed_wait_ms',
  'live_network_requests',
  'retries',
]);
const SECRET_PATTERN =
  /(?:\b(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|secret)\b\s*[:=]\s*[^\s,}"']{4,}|--(?:api[_-]?key|token|password|secret)(?:=|\s+)\S{4,}|\bBearer\s+[A-Za-z0-9._-]{10,}|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b|https?:\/\/[^\s/@]+:[^\s/@]+@)/i;

export function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function assertValidReceipt(value) {
  const errors = validateReceipt(value);
  if (errors.length > 0) throw new Error(`invalid verification receipt: ${errors.join('; ')}`);
  return value;
}

export function validateReceipt(value) {
  const errors = [];
  if (!plainObject(value)) return ['receipt must be an object'];
  closed(
    value,
    [
      'schema_version',
      'captured_at',
      'subject',
      'selection',
      'outcome',
      'attempts',
      'metrics',
      'safety',
      'budgets',
      'evidence',
      'limitations',
    ],
    'receipt',
    errors,
    ['producer_observations']
  );
  exactString(value.schema_version, RECEIPT_SCHEMA_VERSION, 'schema_version', errors);
  isoDate(value.captured_at, 'captured_at', errors);
  validateSubject(value.subject, errors);
  validateSelection(value.selection, errors);
  validateOutcome(value.outcome, errors);
  validateAttempts(value.attempts, value.selection, value.outcome, errors);
  validateMetrics(value.metrics, errors);
  validateSafety(value.safety, errors);
  validateBudgets(value.budgets, errors);
  validateEvidence(value.evidence, errors);
  if (value.producer_observations !== undefined) {
    validateProducerObservations(value.producer_observations, errors);
  }
  stringArray(value.limitations, 'limitations', errors, LIMITS.limitations);
  scanSecrets(value, 'receipt', errors);
  return errors;
}

export async function loadReceipt(repositoryRoot, receiptPath) {
  const { root, absolute, relativePath } = await containedExistingPath(repositoryRoot, receiptPath);
  const details = await stat(absolute);
  if (!details.isFile()) throw new Error(`receipt is not a file: ${relativePath}`);
  if (details.size > LIMITS.artifactBytes) {
    throw new Error(`verification artifact exceeds ${LIMITS.artifactBytes} byte limit`);
  }
  const bytes = await readFile(absolute);
  const repository = await repositoryContext(root);
  const sourceSha256 = sha256(bytes);
  const { receipt, sourceFormat } = adaptVerificationArtifact({
    bytes,
    relativePath,
    sourceSha256,
    repository,
    repositoryRoot: root,
  });
  if (
    details.size > LIMITS.receiptBytes &&
    ['canonical', 'vault-e2e-profile/v1'].includes(sourceFormat)
  ) {
    throw new Error(`verification receipt exceeds ${LIMITS.receiptBytes} byte limit`);
  }
  assertValidReceipt(receipt);
  return { root, absolute, relativePath, bytes, receipt, sourceFormat, sha256: sourceSha256 };
}

export async function writeJsonWithinRepository(repositoryRoot, outputPath, value) {
  const root = await realpath(repositoryRoot);
  const relativePath = safeRelativePath(outputPath, 'output path');
  const absolute = resolve(root, relativePath);
  assertContained(root, absolute, 'output path');
  const parent = dirname(absolute);
  let canonicalParent;
  try {
    canonicalParent = await realpath(parent);
  } catch {
    throw new Error('output parent must already exist inside the repository');
  }
  assertContained(root, canonicalParent, 'output parent');
  const temporary = `${absolute}.codevetter-${process.pid}.tmp`;
  await writeFile(temporary, `${stableStringify(value)}\n`, { flag: 'wx' });
  await rename(temporary, absolute);
  return relativePath;
}

export function safeRelativePath(value, label = 'path') {
  text(value, label, [], { allowEmpty: false, max: LIMITS.string });
  if (typeof value !== 'string' || isAbsolute(value) || value.includes('\\')) {
    throw new Error(`${label} must be a repository-relative POSIX path`);
  }
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`${label} must not contain empty, dot, or traversal segments`);
  }
  return parts.join('/');
}

async function containedExistingPath(repositoryRoot, inputPath) {
  const root = await realpath(repositoryRoot);
  const relativePath = safeRelativePath(inputPath, 'receipt path');
  const candidate = resolve(root, relativePath);
  assertContained(root, candidate, 'receipt path');
  let absolute;
  try {
    absolute = await realpath(candidate);
  } catch {
    throw new Error(`receipt is unavailable: ${relativePath}`);
  }
  assertContained(root, absolute, 'receipt path');
  return { root, absolute, relativePath };
}

async function repositoryIdentity(root) {
  try {
    const bytes = await readFile(resolve(root, 'package.json'));
    if (bytes.length > LIMITS.receiptBytes) throw new Error('package.json is too large');
    const value = JSON.parse(bytes.toString('utf8'));
    if (typeof value?.name === 'string' && value.name.trim() !== '') return value.name;
  } catch {
    // Canonical receipts carry their own repository identity. Adapters fail closed
    // below when a producer-native receipt needs an identity and none is available.
  }
  return null;
}

async function repositoryContext(root) {
  const id = await repositoryIdentity(root);
  let revision = 'unavailable';
  let dirty = true;
  try {
    const [{ stdout: head }, { stdout: status }] = await Promise.all([
      execFileAsync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }),
      execFileAsync('git', ['-C', root, 'status', '--porcelain=v1'], { encoding: 'utf8' }),
    ]);
    revision = head.trim();
    dirty = status.trim() !== '';
  } catch {
    // An unresolvable repository identity remains explicit and cannot support a
    // controlled comparison claim.
  }
  return { id: id ?? '', revision, dirty };
}

function assertContained(root, candidate, label) {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} escapes repository scope`);
  }
}

function validateSubject(value, errors) {
  object(value, 'subject', errors);
  if (!plainObject(value)) return;
  closed(value, ['repository', 'runner', 'environment'], 'subject', errors);

  object(value.repository, 'subject.repository', errors);
  if (plainObject(value.repository)) {
    closed(value.repository, ['id', 'revision', 'dirty'], 'subject.repository', errors);
    text(value.repository.id, 'subject.repository.id', errors);
    text(value.repository.revision, 'subject.repository.revision', errors);
    boolean(value.repository.dirty, 'subject.repository.dirty', errors);
  }

  object(value.runner, 'subject.runner', errors);
  if (plainObject(value.runner)) {
    closed(value.runner, ['id', 'version', 'profile', 'command'], 'subject.runner', errors);
    text(value.runner.id, 'subject.runner.id', errors);
    text(value.runner.version, 'subject.runner.version', errors);
    text(value.runner.profile, 'subject.runner.profile', errors);
    text(value.runner.command, 'subject.runner.command', errors);
  }

  object(value.environment, 'subject.environment', errors);
  if (plainObject(value.environment)) {
    closed(value.environment, ['id', 'platform', 'arch', 'runtime'], 'subject.environment', errors);
    text(value.environment.id, 'subject.environment.id', errors);
    text(value.environment.platform, 'subject.environment.platform', errors);
    text(value.environment.arch, 'subject.environment.arch', errors);
    text(value.environment.runtime, 'subject.environment.runtime', errors);
  }
}

function validateSelection(value, errors) {
  object(value, 'selection', errors);
  if (!plainObject(value)) return;
  closed(
    value,
    [
      'mode',
      'inventory_id',
      'inventory_total',
      'selector_change_allowed',
      'changed_files',
      'tests',
    ],
    'selection',
    errors
  );
  enumeration(value.mode, SELECTION_MODES, 'selection.mode', errors);
  text(value.inventory_id, 'selection.inventory_id', errors);
  integer(value.inventory_total, 'selection.inventory_total', errors, 0);
  boolean(value.selector_change_allowed, 'selection.selector_change_allowed', errors);
  pathArray(value.changed_files, 'selection.changed_files', errors, LIMITS.changedFiles);
  array(value.tests, 'selection.tests', errors, LIMITS.tests);
  const ids = new Set();
  if (Array.isArray(value.tests)) {
    value.tests.forEach((entry, index) => {
      const path = `selection.tests[${index}]`;
      object(entry, path, errors);
      if (!plainObject(entry)) return;
      closed(entry, ['id', 'file', 'selected_by', 'reason'], path, errors);
      text(entry.id, `${path}.id`, errors);
      safePath(entry.file, `${path}.file`, errors);
      pathArray(entry.selected_by, `${path}.selected_by`, errors, LIMITS.changedFiles);
      nullableText(entry.reason, `${path}.reason`, errors);
      if (typeof entry.id === 'string' && ids.has(entry.id)) errors.push(`${path}.id is duplicate`);
      ids.add(entry.id);
      for (const source of Array.isArray(entry.selected_by) ? entry.selected_by : []) {
        if (Array.isArray(value.changed_files) && !value.changed_files.includes(source)) {
          errors.push(`${path}.selected_by references undeclared changed file ${source}`);
        }
      }
    });
  }
}

function validateOutcome(value, errors) {
  object(value, 'outcome', errors);
  if (!plainObject(value)) return;
  closed(
    value,
    ['total', 'passed', 'failed', 'skipped', 'operational_failures'],
    'outcome',
    errors
  );
  for (const key of ['total', 'passed', 'failed', 'skipped', 'operational_failures']) {
    integer(value[key], `outcome.${key}`, errors, 0);
  }
  if ([value.total, value.passed, value.failed, value.skipped].every(Number.isInteger)) {
    if (value.total !== value.passed + value.failed + value.skipped) {
      errors.push('outcome.total must equal passed + failed + skipped');
    }
  }
}

function validateAttempts(value, selection, outcome, errors) {
  array(value, 'attempts', errors, LIMITS.attempts);
  if (!Array.isArray(value)) return;
  const attemptIds = new Set();
  const testIds = new Set(
    Array.isArray(selection?.tests) ? selection.tests.map((test) => test.id) : []
  );
  const finalByTest = new Map();
  value.forEach((entry, index) => {
    const path = `attempts[${index}]`;
    object(entry, path, errors);
    if (!plainObject(entry)) return;
    closed(
      entry,
      ['id', 'test_id', 'phase', 'status', 'duration_ms', 'failure_signature'],
      path,
      errors
    );
    text(entry.id, `${path}.id`, errors);
    text(entry.test_id, `${path}.test_id`, errors);
    enumeration(entry.phase, ATTEMPT_PHASES, `${path}.phase`, errors);
    enumeration(entry.status, ATTEMPT_STATUSES, `${path}.status`, errors);
    number(entry.duration_ms, `${path}.duration_ms`, errors, 0);
    nullableText(entry.failure_signature, `${path}.failure_signature`, errors);
    if (attemptIds.has(entry.id)) errors.push(`${path}.id is duplicate`);
    attemptIds.add(entry.id);
    if (typeof entry.test_id === 'string' && !testIds.has(entry.test_id)) {
      errors.push(`${path}.test_id references undeclared test ${entry.test_id}`);
    }
    if (typeof entry.test_id === 'string') finalByTest.set(entry.test_id, entry.status);
    if (entry.status === 'failed' && !entry.failure_signature) {
      errors.push(`${path}.failure_signature is required for failed attempts`);
    }
  });

  if (selection?.mode === 'none' && outcome?.total > 0) {
    errors.push('selection.mode none cannot report executed test outcomes');
  }
  if (selection?.tests?.length > 0) {
    if (finalByTest.size !== selection.tests.length) {
      errors.push('every declared selected test must have a terminal attempt');
    }
    const finalStatuses = [...finalByTest.values()];
    const counts = {
      passed: finalStatuses.filter((status) => status === 'passed').length,
      failed: finalStatuses.filter((status) => status === 'failed' || status === 'timed_out')
        .length,
      skipped: finalStatuses.filter((status) => status === 'skipped').length,
      operational_failures: finalStatuses.filter((status) => status === 'operational_failure')
        .length,
    };
    if (
      counts.passed !== outcome?.passed ||
      counts.failed !== outcome?.failed ||
      counts.skipped !== outcome?.skipped ||
      counts.operational_failures !== outcome?.operational_failures
    ) {
      errors.push('outcome counts do not match final per-test attempt statuses');
    }
  }
}

function validateMetrics(value, errors) {
  object(value, 'metrics', errors);
  if (!plainObject(value)) return;
  closed(
    value,
    ['wall_ms', 'cpu_ms', 'peak_rss_bytes', 'peak_processes', 'samples', 'coverage'],
    'metrics',
    errors
  );
  number(value.wall_ms, 'metrics.wall_ms', errors, 0);
  nullableNumber(value.cpu_ms, 'metrics.cpu_ms', errors, 0);
  nullableNumber(value.peak_rss_bytes, 'metrics.peak_rss_bytes', errors, 0);
  nullableNumber(value.peak_processes, 'metrics.peak_processes', errors, 0, true);
  object(value.samples, 'metrics.samples', errors);
  if (plainObject(value.samples)) {
    closed(value.samples, ['wall_ms', 'cpu_ms', 'peak_rss_bytes'], 'metrics.samples', errors);
    numberArray(value.samples.wall_ms, 'metrics.samples.wall_ms', errors);
    numberArray(value.samples.cpu_ms, 'metrics.samples.cpu_ms', errors, true);
    numberArray(value.samples.peak_rss_bytes, 'metrics.samples.peak_rss_bytes', errors, true);
  }
  object(value.coverage, 'metrics.coverage', errors);
  if (plainObject(value.coverage)) {
    closed(
      value.coverage,
      ['inventory', 'cpu', 'rss', 'process_tree', 'network', 'fixed_waits', 'selection'],
      'metrics.coverage',
      errors
    );
    for (const key of [
      'inventory',
      'cpu',
      'rss',
      'process_tree',
      'network',
      'fixed_waits',
      'selection',
    ]) {
      enumeration(value.coverage[key], COVERAGE, `metrics.coverage.${key}`, errors);
    }
  }
}

function validateSafety(value, errors) {
  object(value, 'safety', errors);
  if (!plainObject(value)) return;
  closed(
    value,
    ['fixed_wait_ms', 'live_network_requests', 'mock_cost_usd', 'retries'],
    'safety',
    errors
  );
  nullableNumber(value.fixed_wait_ms, 'safety.fixed_wait_ms', errors, 0);
  nullableNumber(value.live_network_requests, 'safety.live_network_requests', errors, 0, true);
  nullableNumber(value.mock_cost_usd, 'safety.mock_cost_usd', errors, 0);
  integer(value.retries, 'safety.retries', errors, 0);
}

function validateBudgets(value, errors) {
  object(value, 'budgets', errors);
  if (!plainObject(value)) return;
  closed(value, ['policy_id', 'maxima', 'required_metrics', 'regression'], 'budgets', errors);
  text(value.policy_id, 'budgets.policy_id', errors);
  object(value.maxima, 'budgets.maxima', errors);
  if (plainObject(value.maxima)) {
    closed(
      value.maxima,
      [
        'wall_ms',
        'cpu_ms',
        'peak_rss_bytes',
        'peak_processes',
        'fixed_wait_ms',
        'live_network_requests',
        'retries',
      ],
      'budgets.maxima',
      errors
    );
    for (const key of Object.keys(value.maxima)) {
      nullableNumber(
        value.maxima[key],
        `budgets.maxima.${key}`,
        errors,
        0,
        key === 'peak_processes' || key === 'live_network_requests' || key === 'retries'
      );
    }
  }
  array(value.required_metrics, 'budgets.required_metrics', errors, REQUIRED_METRICS.size);
  if (Array.isArray(value.required_metrics)) {
    const seen = new Set();
    for (const [index, metric] of value.required_metrics.entries()) {
      enumeration(metric, REQUIRED_METRICS, `budgets.required_metrics[${index}]`, errors);
      if (seen.has(metric)) errors.push(`budgets.required_metrics[${index}] is duplicate`);
      seen.add(metric);
    }
  }
  object(value.regression, 'budgets.regression', errors);
  if (plainObject(value.regression)) {
    closed(
      value.regression,
      [
        'relative_percent',
        'wall_absolute_ms',
        'cpu_absolute_ms',
        'peak_rss_absolute_bytes',
        'peak_processes_absolute',
      ],
      'budgets.regression',
      errors
    );
    number(
      value.regression.relative_percent,
      'budgets.regression.relative_percent',
      errors,
      0,
      1_000
    );
    number(value.regression.wall_absolute_ms, 'budgets.regression.wall_absolute_ms', errors, 0);
    number(value.regression.cpu_absolute_ms, 'budgets.regression.cpu_absolute_ms', errors, 0);
    number(
      value.regression.peak_rss_absolute_bytes,
      'budgets.regression.peak_rss_absolute_bytes',
      errors,
      0
    );
    number(
      value.regression.peak_processes_absolute,
      'budgets.regression.peak_processes_absolute',
      errors,
      0,
      undefined,
      true
    );
  }
}

function validateEvidence(value, errors) {
  array(value, 'evidence', errors, LIMITS.evidence);
  if (!Array.isArray(value)) return;
  const paths = new Set();
  value.forEach((entry, index) => {
    const path = `evidence[${index}]`;
    object(entry, path, errors);
    if (!plainObject(entry)) return;
    closed(entry, ['kind', 'path', 'sha256'], path, errors);
    text(entry.kind, `${path}.kind`, errors);
    safePath(entry.path, `${path}.path`, errors);
    if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      errors.push(`${path}.sha256 must be a lowercase SHA-256 hex digest`);
    }
    if (paths.has(entry.path)) errors.push(`${path}.path is duplicate`);
    paths.add(entry.path);
  });
}

function validateProducerObservations(value, errors) {
  array(value, 'producer_observations', errors, LIMITS.producerObservations);
  if (!Array.isArray(value)) return;
  const metrics = new Set();
  value.forEach((entry, index) => {
    const path = `producer_observations[${index}]`;
    object(entry, path, errors);
    if (!plainObject(entry)) return;
    closed(entry, ['metric', 'value', 'unit', 'scope', 'evidence'], path, errors);
    text(entry.metric, `${path}.metric`, errors);
    number(entry.value, `${path}.value`, errors, 0);
    text(entry.unit, `${path}.unit`, errors);
    text(entry.scope, `${path}.scope`, errors);
    exactString(entry.evidence, 'producer_artifact', `${path}.evidence`, errors);
    if (typeof entry.metric === 'string' && !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(entry.metric)) {
      errors.push(`${path}.metric is invalid`);
    }
    if (metrics.has(entry.metric)) errors.push(`${path}.metric is duplicate`);
    metrics.add(entry.metric);
  });
}

function scanSecrets(value, path, errors) {
  if (typeof value === 'string') {
    if (SECRET_PATTERN.test(value)) errors.push(`${path} contains credential-shaped content`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanSecrets(entry, `${path}[${index}]`, errors));
    return;
  }
  if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) scanSecrets(entry, `${path}.${key}`, errors);
  }
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

function closed(value, keys, path, errors, optionalKeys = []) {
  if (!plainObject(value)) return;
  const allowed = new Set([...keys, ...optionalKeys]);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) errors.push(`${path}.${key} is unknown`);
  for (const key of keys) if (!(key in value)) errors.push(`${path}.${key} is required`);
}

function plainObject(value) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function object(value, path, errors) {
  if (!plainObject(value)) errors.push(`${path} must be an object`);
}

function array(value, path, errors, max) {
  if (!Array.isArray(value)) errors.push(`${path} must be an array`);
  else if (value.length > max) errors.push(`${path} exceeds ${max} entries`);
}

function text(value, path, errors, { allowEmpty = false, max = LIMITS.string } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '') || value.length > max) {
    errors.push(
      `${path} must be a ${allowEmpty ? '' : 'non-empty '}string no longer than ${max} characters`
    );
  }
}

function nullableText(value, path, errors) {
  if (value !== null) text(value, path, errors);
}

function exactString(value, expected, path, errors) {
  if (value !== expected) errors.push(`${path} must equal ${expected}`);
}

function isoDate(value, path, errors) {
  text(value, path, errors);
  if (
    typeof value === 'string' &&
    (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value)))
  ) {
    errors.push(`${path} must be an ISO-8601 timestamp`);
  }
}

function boolean(value, path, errors) {
  if (typeof value !== 'boolean') errors.push(`${path} must be a boolean`);
}

function number(value, path, errors, min = -Infinity, max = Infinity, whole = false) {
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (whole && !Number.isInteger(value))
  ) {
    errors.push(
      `${path} must be a finite${whole ? ' integer' : ''} number between ${min} and ${max}`
    );
  }
}

function nullableNumber(value, path, errors, min = -Infinity, whole = false) {
  if (value !== null) number(value, path, errors, min, Infinity, whole);
}

function integer(value, path, errors, min = -Infinity) {
  number(value, path, errors, min, Infinity, true);
}

function enumeration(value, allowed, path, errors) {
  if (!allowed.has(value)) errors.push(`${path} must be one of ${[...allowed].join(', ')}`);
}

function safePath(value, path, errors) {
  try {
    safeRelativePath(value, path);
  } catch (error) {
    errors.push(error.message);
  }
}

function pathArray(value, path, errors, max) {
  array(value, path, errors, max);
  if (!Array.isArray(value)) return;
  const seen = new Set();
  value.forEach((entry, index) => {
    safePath(entry, `${path}[${index}]`, errors);
    if (seen.has(entry)) errors.push(`${path}[${index}] is duplicate`);
    seen.add(entry);
  });
}

function stringArray(value, path, errors, max) {
  array(value, path, errors, max);
  if (!Array.isArray(value)) return;
  value.forEach((entry, index) => text(entry, `${path}[${index}]`, errors));
}

function numberArray(value, path, errors, nullable = false) {
  if (nullable && value === null) return;
  array(value, path, errors, LIMITS.samples);
  if (!Array.isArray(value)) return;
  value.forEach((entry, index) => number(entry, `${path}[${index}]`, errors, 0));
}
