import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const CONTRACT_SCHEMA_VERSIONS = Object.freeze({
  'agent-adapter': 'codevetter.agent-task-adapter.v1',
  'check-result': 'codevetter.agent-task-check-result.v1',
  'corpus-index': 'codevetter.agent-task-corpus.v1',
  'qualification-receipt': 'codevetter.agent-task-qualification.v1',
  'run-receipt': 'codevetter.agent-task-run.v1',
  'task-manifest': 'codevetter.agent-task.v1',
});

export const CORPUS_LIMITS = Object.freeze({
  maxArtifactBytes: 1024 * 1024,
  maxChecks: 100,
  maxDocumentBytes: 256 * 1024,
  maxTasks: 50,
  minPublishableTasks: 30,
  minPublishableCategories: 6,
});

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/;

export function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

export function validateContract(kind, value) {
  const errors = [];
  const validator = validators[kind];
  if (!validator) {
    return [`$: unsupported contract kind "${kind}"`];
  }
  validator(value, '$', errors);
  return [...new Set(errors)].sort();
}

function validateCorpusIndex(value, path, errors) {
  if (
    !closedObject(
      value,
      path,
      ['schema_version', 'corpus_id', 'version', 'tasks'],
      ['schema_version', 'corpus_id', 'version', 'tasks'],
      errors
    )
  ) {
    return;
  }
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['corpus-index'],
    `${path}.schema_version`,
    errors
  );
  id(value.corpus_id, `${path}.corpus_id`, errors);
  stringPattern(value.version, /^\d+\.\d+\.\d+$/, `${path}.version`, errors, 40);
  array(value.tasks, `${path}.tasks`, errors, { max: CORPUS_LIMITS.maxTasks });
  if (!Array.isArray(value.tasks)) return;

  const taskIds = [];
  for (const [index, entry] of value.tasks.entries()) {
    const entryPath = `${path}.tasks[${index}]`;
    if (
      !closedObject(
        entry,
        entryPath,
        ['task_id', 'manifest', 'qualification'],
        ['task_id', 'manifest'],
        errors
      )
    ) {
      continue;
    }
    id(entry.task_id, `${entryPath}.task_id`, errors);
    artifact(entry.manifest, `${entryPath}.manifest`, errors);
    if (entry.qualification !== undefined) {
      artifact(entry.qualification, `${entryPath}.qualification`, errors);
    }
    if (typeof entry.task_id === 'string') taskIds.push(entry.task_id);
  }
  unique(taskIds, `${path}.tasks task_id`, errors);
  sorted(taskIds, `${path}.tasks`, errors);
}

function validateTaskManifest(value, path, errors) {
  const fields = [
    'schema_version',
    'task_id',
    'title',
    'lane',
    'runtime',
    'category',
    'failure_mode',
    'artifacts',
    'required_checks',
    'regression_checks',
    'provenance',
    'license',
  ];
  if (!closedObject(value, path, fields, fields, errors)) return;
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['task-manifest'],
    `${path}.schema_version`,
    errors
  );
  id(value.task_id, `${path}.task_id`, errors);
  boundedString(value.title, `${path}.title`, errors, 1, 160);
  oneOf(value.lane, ['api', 'browser'], `${path}.lane`, errors);
  oneOf(value.runtime, ['node', 'typescript'], `${path}.runtime`, errors);
  id(value.category, `${path}.category`, errors);
  id(value.failure_mode, `${path}.failure_mode`, errors);

  const artifactNames = ['fixture', 'task_packet', 'acceptance_contract', 'known_good_patch'];
  if (closedObject(value.artifacts, `${path}.artifacts`, artifactNames, artifactNames, errors)) {
    for (const name of artifactNames) {
      artifact(value.artifacts[name], `${path}.artifacts.${name}`, errors);
    }
  }
  checkIdArray(value.required_checks, `${path}.required_checks`, errors, { min: 1 });
  checkIdArray(value.regression_checks, `${path}.regression_checks`, errors);
  if (Array.isArray(value.required_checks) && Array.isArray(value.regression_checks)) {
    const required = new Set(value.required_checks);
    for (const checkId of value.regression_checks) {
      if (required.has(checkId)) {
        errors.push(`${path}.regression_checks: check "${checkId}" is also required`);
      }
    }
  }

  if (
    closedObject(
      value.provenance,
      `${path}.provenance`,
      ['kind', 'repository', 'revision', 'source_url'],
      ['kind', 'repository', 'revision'],
      errors
    )
  ) {
    oneOf(value.provenance.kind, ['external', 'owned'], `${path}.provenance.kind`, errors);
    stringPattern(
      value.provenance.repository,
      REPOSITORY_PATTERN,
      `${path}.provenance.repository`,
      errors,
      160
    );
    stringPattern(
      value.provenance.revision,
      REVISION_PATTERN,
      `${path}.provenance.revision`,
      errors,
      64
    );
    if (value.provenance.kind === 'external' && value.provenance.source_url === undefined) {
      errors.push(`${path}.provenance.source_url: required for external provenance`);
    }
    if (value.provenance.source_url !== undefined) {
      httpsUrl(value.provenance.source_url, `${path}.provenance.source_url`, errors);
    }
  }

  if (
    closedObject(value.license, `${path}.license`, ['spdx', 'notice'], ['spdx', 'notice'], errors)
  ) {
    boundedString(value.license.spdx, `${path}.license.spdx`, errors, 1, 80);
    boundedString(value.license.notice, `${path}.license.notice`, errors, 1, 500);
  }
}

function validateCheckResult(value, path, errors) {
  const fields = ['schema_version', 'task_id', 'acceptance_contract_sha256', 'results'];
  if (!closedObject(value, path, fields, fields, errors)) return;
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['check-result'],
    `${path}.schema_version`,
    errors
  );
  id(value.task_id, `${path}.task_id`, errors);
  sha256(value.acceptance_contract_sha256, `${path}.acceptance_contract_sha256`, errors);
  checkArray(value.results, `${path}.results`, errors);
}

function validateQualificationReceipt(value, path, errors) {
  const fields = [
    'schema_version',
    'task_id',
    'manifest_sha256',
    'qualified',
    'baseline',
    'known_good',
    'limitations',
  ];
  if (!closedObject(value, path, fields, fields, errors)) return;
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['qualification-receipt'],
    `${path}.schema_version`,
    errors
  );
  id(value.task_id, `${path}.task_id`, errors);
  sha256(value.manifest_sha256, `${path}.manifest_sha256`, errors);
  boolean(value.qualified, `${path}.qualified`, errors);
  qualificationPhase(
    value.baseline,
    `${path}.baseline`,
    ['intended_failure', 'wrong_failure', 'error', 'flaky'],
    errors
  );
  qualificationPhase(
    value.known_good,
    `${path}.known_good`,
    ['pass', 'check_failure', 'regression', 'error', 'flaky'],
    errors
  );
  stringArray(value.limitations, `${path}.limitations`, errors, { max: 50, itemMax: 500 });

  if (typeof value.qualified === 'boolean') {
    const derived =
      value.baseline?.status === 'intended_failure' && value.known_good?.status === 'pass';
    if (value.qualified !== derived) {
      errors.push(`${path}.qualified: must equal the baseline and known-good qualification result`);
    }
  }
}

function validateAgentAdapter(value, path, errors) {
  const fields = [
    'schema_version',
    'adapter_id',
    'agent',
    'model',
    'configuration',
    'command',
    'environment_names',
    'timeout_ms',
    'cost_posture',
    'diagnostics_path',
  ];
  if (
    !closedObject(
      value,
      path,
      fields,
      fields.filter((field) => field !== 'diagnostics_path'),
      errors
    )
  ) {
    return;
  }
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['agent-adapter'],
    `${path}.schema_version`,
    errors
  );
  id(value.adapter_id, `${path}.adapter_id`, errors);
  boundedString(value.agent, `${path}.agent`, errors, 1, 120);
  boundedString(value.model, `${path}.model`, errors, 1, 160);
  boundedString(value.configuration, `${path}.configuration`, errors, 1, 160);
  stringArray(value.command, `${path}.command`, errors, { min: 1, max: 50, itemMax: 500 });
  stringArray(value.environment_names, `${path}.environment_names`, errors, {
    max: 30,
    itemMax: 80,
  });
  if (Array.isArray(value.environment_names)) {
    unique(value.environment_names, `${path}.environment_names`, errors);
    for (const [index, name] of value.environment_names.entries()) {
      if (typeof name === 'string' && !ENVIRONMENT_NAME_PATTERN.test(name)) {
        errors.push(`${path}.environment_names[${index}]: invalid environment variable name`);
      }
    }
  }
  integer(value.timeout_ms, `${path}.timeout_ms`, errors, 1000, 3_600_000);
  oneOf(value.cost_posture, ['free', 'paid', 'unknown'], `${path}.cost_posture`, errors);
  if (value.diagnostics_path !== undefined) {
    relativePath(value.diagnostics_path, `${path}.diagnostics_path`, errors);
  }
}

function validateRunReceipt(value, path, errors) {
  const fields = [
    'schema_version',
    'run_id',
    'task_id',
    'manifest_sha256',
    'adapter_sha256',
    'environment_sha256',
    'workspace_policy',
    'terminal_status',
    'checks',
    'regression_count',
    'elapsed_ms',
    'cleanup',
    'diagnostics',
    'limitations',
  ];
  if (
    !closedObject(
      value,
      path,
      fields,
      fields.filter((field) => field !== 'diagnostics'),
      errors
    )
  ) {
    return;
  }
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['run-receipt'],
    `${path}.schema_version`,
    errors
  );
  id(value.run_id, `${path}.run_id`, errors);
  id(value.task_id, `${path}.task_id`, errors);
  for (const field of ['manifest_sha256', 'adapter_sha256', 'environment_sha256']) {
    sha256(value[field], `${path}.${field}`, errors);
  }
  exact(value.workspace_policy, 'withheld_workspace_v1', `${path}.workspace_policy`, errors);
  oneOf(
    value.terminal_status,
    [
      'setup_failure',
      'agent_failure',
      'cancelled',
      'timeout',
      'incomplete_checks',
      'check_failure',
      'regression',
      'success',
    ],
    `${path}.terminal_status`,
    errors
  );
  checkArray(value.checks, `${path}.checks`, errors);
  integer(value.regression_count, `${path}.regression_count`, errors, 0, CORPUS_LIMITS.maxChecks);
  integer(value.elapsed_ms, `${path}.elapsed_ms`, errors, 0, 7_200_000);
  if (closedObject(value.cleanup, `${path}.cleanup`, ['status', 'message'], ['status'], errors)) {
    oneOf(value.cleanup.status, ['complete', 'failed'], `${path}.cleanup.status`, errors);
    if (value.cleanup.message !== undefined) {
      boundedString(value.cleanup.message, `${path}.cleanup.message`, errors, 1, 500);
    }
  }
  validateDiagnostics(value.diagnostics, `${path}.diagnostics`, errors);
  stringArray(value.limitations, `${path}.limitations`, errors, { max: 50, itemMax: 500 });

  if (value.terminal_status === 'success') {
    if (value.cleanup?.status !== 'complete')
      errors.push(`${path}.cleanup.status: success requires complete cleanup`);
    if (value.regression_count !== 0)
      errors.push(`${path}.regression_count: success requires zero regressions`);
    if (Array.isArray(value.checks) && value.checks.some((check) => check?.status !== 'pass')) {
      errors.push(`${path}.checks: success requires every check to pass`);
    }
  }
}

function validateDiagnostics(value, path, errors) {
  if (value === undefined) return;
  const fields = [
    'input_tokens',
    'output_tokens',
    'cost_usd',
    'tool_calls',
    'files_inspected',
    'files_modified',
  ];
  if (!closedObject(value, path, fields, [], errors)) return;
  for (const field of ['input_tokens', 'output_tokens']) {
    if (value[field] !== undefined) integer(value[field], `${path}.${field}`, errors, 0);
  }
  if (value.cost_usd !== undefined) {
    if (
      typeof value.cost_usd !== 'number' ||
      !Number.isFinite(value.cost_usd) ||
      value.cost_usd < 0
    ) {
      errors.push(`${path}.cost_usd: expected a finite non-negative number`);
    }
  }
  if (value.tool_calls !== undefined) {
    stringArray(value.tool_calls, `${path}.tool_calls`, errors, { max: 1000, itemMax: 200 });
  }
  for (const field of ['files_inspected', 'files_modified']) {
    if (value[field] === undefined) continue;
    stringArray(value[field], `${path}.${field}`, errors, { max: 1000, itemMax: 240 });
    if (Array.isArray(value[field])) {
      for (const [index, item] of value[field].entries()) {
        relativePath(item, `${path}.${field}[${index}]`, errors);
      }
    }
  }
}

function qualificationPhase(value, path, statuses, errors) {
  if (
    !closedObject(
      value,
      path,
      ['runs', 'result_sha256', 'status'],
      ['runs', 'result_sha256', 'status'],
      errors
    )
  ) {
    return;
  }
  integer(value.runs, `${path}.runs`, errors, 2, 10);
  sha256(value.result_sha256, `${path}.result_sha256`, errors);
  oneOf(value.status, statuses, `${path}.status`, errors);
}

function checkArray(value, path, errors) {
  array(value, path, errors, { max: 200 });
  if (!Array.isArray(value)) return;
  const ids = [];
  for (const [index, check] of value.entries()) {
    const checkPath = `${path}[${index}]`;
    if (!closedObject(check, checkPath, ['id', 'status', 'message'], ['id', 'status'], errors))
      continue;
    id(check.id, `${checkPath}.id`, errors);
    oneOf(check.status, ['error', 'fail', 'pass'], `${checkPath}.status`, errors);
    if (check.message !== undefined)
      boundedString(check.message, `${checkPath}.message`, errors, 1, 500);
    if (typeof check.id === 'string') ids.push(check.id);
  }
  unique(ids, `${path} id`, errors);
}

function checkIdArray(value, path, errors, { min = 0 } = {}) {
  array(value, path, errors, { min, max: CORPUS_LIMITS.maxChecks });
  if (!Array.isArray(value)) return;
  for (const [index, checkId] of value.entries()) id(checkId, `${path}[${index}]`, errors);
  unique(value, path, errors);
  sorted(value, path, errors);
}

function artifact(value, path, errors) {
  if (!closedObject(value, path, ['path', 'sha256'], ['path', 'sha256'], errors)) return;
  relativePath(value.path, `${path}.path`, errors);
  sha256(value.sha256, `${path}.sha256`, errors);
}

function closedObject(value, path, allowed, required, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path}: expected an object`);
    return false;
  }
  for (const field of Object.keys(value).sort()) {
    if (!allowed.includes(field)) errors.push(`${path}.${field}: unknown field`);
  }
  for (const field of required) {
    if (!Object.hasOwn(value, field)) errors.push(`${path}.${field}: required field is missing`);
  }
  return true;
}

function relativePath(value, path, errors) {
  boundedString(value, path, errors, 1, 240);
  if (typeof value !== 'string') return;
  if (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[A-Za-z]:/.test(value) ||
    value.includes('\\') ||
    value.split('/').includes('..') ||
    value.includes('\0')
  ) {
    errors.push(`${path}: expected a safe POSIX relative path`);
  }
}

function id(value, path, errors) {
  stringPattern(value, ID_PATTERN, path, errors, 80);
}

function sha256(value, path, errors) {
  stringPattern(value, SHA256_PATTERN, path, errors, 64);
}

function httpsUrl(value, path, errors) {
  boundedString(value, path, errors, 1, 500);
  if (typeof value !== 'string') return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') errors.push(`${path}: expected an HTTPS URL`);
  } catch {
    errors.push(`${path}: expected a valid HTTPS URL`);
  }
}

function stringPattern(value, pattern, path, errors, max) {
  boundedString(value, path, errors, 1, max);
  if (typeof value === 'string' && !pattern.test(value)) errors.push(`${path}: invalid format`);
}

function boundedString(value, path, errors, min, max) {
  if (typeof value !== 'string') {
    errors.push(`${path}: expected a string`);
    return;
  }
  if (value.length < min || value.length > max) {
    errors.push(`${path}: expected ${min}-${max} characters`);
  }
}

function stringArray(value, path, errors, { min = 0, max, itemMax }) {
  array(value, path, errors, { min, max });
  if (!Array.isArray(value)) return;
  for (const [index, item] of value.entries()) {
    boundedString(item, `${path}[${index}]`, errors, 1, itemMax);
  }
}

function array(value, path, errors, { min = 0, max }) {
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected an array`);
    return;
  }
  if (value.length < min || value.length > max) {
    errors.push(`${path}: expected ${min}-${max} items`);
  }
}

function integer(value, path, errors, min, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${path}: expected an integer from ${min} to ${max}`);
  }
}

function boolean(value, path, errors) {
  if (typeof value !== 'boolean') errors.push(`${path}: expected a boolean`);
}

function exact(value, expected, path, errors) {
  if (value !== expected) errors.push(`${path}: expected "${expected}"`);
}

function oneOf(value, values, path, errors) {
  if (!values.includes(value)) errors.push(`${path}: expected one of ${values.join(', ')}`);
}

function unique(values, path, errors) {
  if (!Array.isArray(values)) return;
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) errors.push(`${path}: duplicate value "${value}"`);
    seen.add(value);
  }
}

function sorted(values, path, errors) {
  if (!Array.isArray(values)) return;
  const expected = [...values].sort();
  if (values.some((value, index) => value !== expected[index])) {
    errors.push(`${path}: values must be sorted`);
  }
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])])
  );
}

const validators = Object.freeze({
  'agent-adapter': validateAgentAdapter,
  'check-result': validateCheckResult,
  'corpus-index': validateCorpusIndex,
  'qualification-receipt': validateQualificationReceipt,
  'run-receipt': validateRunReceipt,
  'task-manifest': validateTaskManifest,
});
