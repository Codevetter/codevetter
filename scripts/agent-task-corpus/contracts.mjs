import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const CONTRACT_SCHEMA_VERSIONS = Object.freeze({
  'acceptance-contract': 'codevetter.agent-task-acceptance.v1',
  'agent-adapter': 'codevetter.agent-task-adapter.v1',
  'agent-adapter-v2': 'codevetter.agent-task-adapter.v2',
  'check-result': 'codevetter.agent-task-check-result.v1',
  'corpus-index': 'codevetter.agent-task-corpus.v1',
  'fixture-bundle': 'codevetter.agent-task-fixture.v1',
  'known-good-change': 'codevetter.agent-task-known-good.v1',
  'qualification-receipt': 'codevetter.agent-task-qualification.v1',
  'qualification-receipt-v2': 'codevetter.agent-task-qualification.v2',
  'run-receipt': 'codevetter.agent-task-run.v1',
  'run-plan': 'codevetter.agent-task-plan.v1',
  'run-receipt-v2': 'codevetter.agent-task-run.v2',
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

export function deriveRunPlanId(value) {
  const { plan_id: _planId, ...identity } = value;
  return `plan-${sha256Bytes(Buffer.from(canonicalJson(identity))).slice(0, 32)}`;
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
  if (value?.schema_version === CONTRACT_SCHEMA_VERSIONS['qualification-receipt-v2']) {
    validateQualificationReceiptV2(value, path, errors);
    return;
  }
  validateQualificationReceiptV1(value, path, errors);
}

function validateQualificationReceiptV1(value, path, errors) {
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

function validateFixtureBundle(value, path, errors) {
  if (
    !closedObject(value, path, ['schema_version', 'files'], ['schema_version', 'files'], errors)
  ) {
    return;
  }
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['fixture-bundle'],
    `${path}.schema_version`,
    errors
  );
  fileBundle(value.files, `${path}.files`, 'content_base64', errors);
  if (value.files?.some((file) => file?.path === 'TASK.md')) {
    errors.push(`${path}.files: TASK.md is reserved for the public task packet`);
  }
}

function validateAcceptanceContract(value, path, errors) {
  const fields = [
    'schema_version',
    'task_id',
    'task_defining_failures',
    'required_checks',
    'regression_checks',
    'driver',
    'repetitions',
  ];
  if (!closedObject(value, path, fields, fields, errors)) return;
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['acceptance-contract'],
    `${path}.schema_version`,
    errors
  );
  id(value.task_id, `${path}.task_id`, errors);
  checkIdArray(value.task_defining_failures, `${path}.task_defining_failures`, errors, {
    min: 1,
  });
  const required = describedCheckArray(value.required_checks, `${path}.required_checks`, errors, 1);
  const regression = describedCheckArray(
    value.regression_checks,
    `${path}.regression_checks`,
    errors,
    0
  );
  const requiredIds = new Set(required);
  for (const checkId of value.task_defining_failures ?? []) {
    if (!requiredIds.has(checkId)) {
      errors.push(`${path}.task_defining_failures: check "${checkId}" is not required`);
    }
  }
  for (const checkId of regression) {
    if (requiredIds.has(checkId)) {
      errors.push(`${path}.regression_checks: check "${checkId}" is also required`);
    }
  }
  if (
    closedObject(
      value.driver,
      `${path}.driver`,
      ['path', 'sha256', 'timeout_ms'],
      ['path', 'sha256', 'timeout_ms'],
      errors
    )
  ) {
    relativePath(value.driver.path, `${path}.driver.path`, errors);
    sha256(value.driver.sha256, `${path}.driver.sha256`, errors);
    integer(value.driver.timeout_ms, `${path}.driver.timeout_ms`, errors, 10, 60_000);
  }
  integer(value.repetitions, `${path}.repetitions`, errors, 2, 5);
}

function validateKnownGoodChange(value, path, errors) {
  if (
    !closedObject(
      value,
      path,
      ['schema_version', 'task_id', 'files'],
      ['schema_version', 'task_id', 'files'],
      errors
    )
  ) {
    return;
  }
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['known-good-change'],
    `${path}.schema_version`,
    errors
  );
  id(value.task_id, `${path}.task_id`, errors);
  array(value.files, `${path}.files`, errors, { min: 1, max: 100 });
  if (!Array.isArray(value.files)) return;
  const paths = [];
  for (const [index, file] of value.files.entries()) {
    const filePath = `${path}.files[${index}]`;
    if (
      !closedObject(
        file,
        filePath,
        ['path', 'before_sha256', 'after_base64', 'after_sha256'],
        ['path', 'before_sha256', 'after_base64', 'after_sha256'],
        errors
      )
    ) {
      continue;
    }
    relativePath(file.path, `${filePath}.path`, errors);
    sha256(file.before_sha256, `${filePath}.before_sha256`, errors);
    validateBase64(file.after_base64, file.after_sha256, `${filePath}.after_base64`, errors);
    sha256(file.after_sha256, `${filePath}.after_sha256`, errors);
    if (file.before_sha256 === file.after_sha256) {
      errors.push(`${filePath}: before and after SHA-256 must differ`);
    }
    if (typeof file.path === 'string') paths.push(file.path);
  }
  unique(paths, `${path}.files path`, errors);
  sorted(paths, `${path}.files`, errors);
}

function validateQualificationReceiptV2(value, path, errors) {
  const fields = [
    'schema_version',
    'task_id',
    'manifest_sha256',
    'fixture_sha256',
    'acceptance_contract_sha256',
    'known_good_sha256',
    'workspace_policy',
    'qualified',
    'baseline',
    'known_good',
    'cleanup',
    'limitations',
  ];
  if (!closedObject(value, path, fields, fields, errors)) return;
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['qualification-receipt-v2'],
    `${path}.schema_version`,
    errors
  );
  id(value.task_id, `${path}.task_id`, errors);
  for (const field of [
    'manifest_sha256',
    'fixture_sha256',
    'acceptance_contract_sha256',
    'known_good_sha256',
  ]) {
    sha256(value[field], `${path}.${field}`, errors);
  }
  exact(
    value.workspace_policy,
    'public_fixture_and_task_packet_v1',
    `${path}.workspace_policy`,
    errors
  );
  boolean(value.qualified, `${path}.qualified`, errors);
  qualificationPhaseV2(value.baseline, `${path}.baseline`, 'baseline', errors);
  qualificationPhaseV2(value.known_good, `${path}.known_good`, 'known_good', errors);
  if (closedObject(value.cleanup, `${path}.cleanup`, ['status'], ['status'], errors)) {
    oneOf(value.cleanup.status, ['complete', 'failed'], `${path}.cleanup.status`, errors);
  }
  stringArray(value.limitations, `${path}.limitations`, errors, { max: 50, itemMax: 500 });
  if (typeof value.qualified === 'boolean') {
    const derived =
      value.baseline?.status === 'intended_failure' &&
      value.known_good?.status === 'pass' &&
      value.cleanup?.status === 'complete';
    if (value.qualified !== derived) {
      errors.push(`${path}.qualified: must equal the v2 qualification result`);
    }
  }
}

function validateAgentAdapter(value, path, errors) {
  if (value?.schema_version === CONTRACT_SCHEMA_VERSIONS['agent-adapter-v2']) {
    validateAgentAdapterV2(value, path, errors);
    return;
  }
  validateAgentAdapterV1(value, path, errors);
}

function validateAgentAdapterV1(value, path, errors) {
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

function validateAgentAdapterV2(value, path, errors) {
  const fields = [
    'schema_version',
    'adapter_id',
    'agent',
    'model',
    'configuration',
    'command',
    'artifacts',
    'environment_names',
    'timeout_ms',
    'cost_posture',
    'planning',
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
    CONTRACT_SCHEMA_VERSIONS['agent-adapter-v2'],
    `${path}.schema_version`,
    errors
  );
  id(value.adapter_id, `${path}.adapter_id`, errors);
  boundedString(value.agent, `${path}.agent`, errors, 1, 120);
  boundedString(value.model, `${path}.model`, errors, 1, 160);
  boundedString(value.configuration, `${path}.configuration`, errors, 1, 160);
  stringArray(value.command, `${path}.command`, errors, { min: 1, max: 50, itemMax: 500 });
  validateAdapterCommand(value.command, `${path}.command`, errors);
  artifactArray(value.artifacts, `${path}.artifacts`, errors);
  const artifactPaths = new Set((value.artifacts ?? []).map((item) => item?.path));
  for (const [index, argument] of (value.command ?? []).entries()) {
    if (typeof argument !== 'string' || !argument.startsWith('{adapter_root}/')) continue;
    const declaredPath = argument.slice('{adapter_root}/'.length);
    if (!artifactPaths.has(declaredPath)) {
      errors.push(`${path}.command[${index}]: adapter artifact is not declared`);
    }
  }
  validateEnvironmentNames(value.environment_names, `${path}.environment_names`, errors);
  integer(value.timeout_ms, `${path}.timeout_ms`, errors, 1000, 3_600_000);
  oneOf(value.cost_posture, ['free', 'paid', 'unknown'], `${path}.cost_posture`, errors);
  validatePlanning(value.planning, `${path}.planning`, errors);
  if (value.cost_posture === 'free') {
    if (value.planning?.input_usd_per_million !== 0) {
      errors.push(`${path}.planning.input_usd_per_million: free adapters require zero pricing`);
    }
    if (value.planning?.output_usd_per_million !== 0) {
      errors.push(`${path}.planning.output_usd_per_million: free adapters require zero pricing`);
    }
  }
  if (value.diagnostics_path !== undefined) {
    relativePath(value.diagnostics_path, `${path}.diagnostics_path`, errors);
  }
}

function validateRunPlan(value, path, errors) {
  const fields = [
    'schema_version',
    'plan_id',
    'task_id',
    'manifest_sha256',
    'fixture_sha256',
    'acceptance_contract_sha256',
    'adapter_sha256',
    'workspace_policy',
    'environment',
    'filtered_input_bytes',
    'estimated_input_tokens',
    'reserved_output_tokens',
    'estimated_max_cost_usd',
    'max_cost_usd',
    'cost_posture',
    'within_cost_limit',
    'command',
    'approval',
    'blocked_reasons',
    'limitations',
  ];
  if (!closedObject(value, path, fields, fields, errors)) return;
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['run-plan'],
    `${path}.schema_version`,
    errors
  );
  id(value.plan_id, `${path}.plan_id`, errors);
  id(value.task_id, `${path}.task_id`, errors);
  for (const field of [
    'manifest_sha256',
    'fixture_sha256',
    'acceptance_contract_sha256',
    'adapter_sha256',
  ]) {
    sha256(value[field], `${path}.${field}`, errors);
  }
  exact(
    value.workspace_policy,
    'public_fixture_and_task_packet_v1',
    `${path}.workspace_policy`,
    errors
  );
  validateEnvironmentAvailability(value.environment, `${path}.environment`, errors);
  integer(value.filtered_input_bytes, `${path}.filtered_input_bytes`, errors, 1, 104_857_600);
  integer(value.estimated_input_tokens, `${path}.estimated_input_tokens`, errors, 1, 100_000_000);
  integer(value.reserved_output_tokens, `${path}.reserved_output_tokens`, errors, 1, 1_000_000);
  finiteNumber(value.estimated_max_cost_usd, `${path}.estimated_max_cost_usd`, errors, 0, 100_000);
  finiteNumber(value.max_cost_usd, `${path}.max_cost_usd`, errors, 0, 100_000);
  oneOf(value.cost_posture, ['free', 'paid', 'unknown'], `${path}.cost_posture`, errors);
  boolean(value.within_cost_limit, `${path}.within_cost_limit`, errors);
  if (
    typeof value.estimated_max_cost_usd === 'number' &&
    typeof value.max_cost_usd === 'number' &&
    value.within_cost_limit !== value.estimated_max_cost_usd <= value.max_cost_usd
  ) {
    errors.push(`${path}.within_cost_limit: must match the declared cost gate`);
  }
  stringArray(value.command, `${path}.command`, errors, { min: 1, max: 50, itemMax: 500 });
  validateAdapterCommand(value.command, `${path}.command`, errors);
  if (
    closedObject(
      value.approval,
      `${path}.approval`,
      ['launch_required', 'paid_required'],
      ['launch_required', 'paid_required'],
      errors
    )
  ) {
    exact(value.approval.launch_required, true, `${path}.approval.launch_required`, errors);
    boolean(value.approval.paid_required, `${path}.approval.paid_required`, errors);
    const expectedPaid = value.cost_posture !== 'free';
    if (value.approval.paid_required !== expectedPaid) {
      errors.push(`${path}.approval.paid_required: must match conservative cost posture`);
    }
  }
  stringArray(value.blocked_reasons, `${path}.blocked_reasons`, errors, {
    max: 50,
    itemMax: 200,
  });
  if (Array.isArray(value.blocked_reasons)) {
    unique(value.blocked_reasons, `${path}.blocked_reasons`, errors);
    sorted(value.blocked_reasons, `${path}.blocked_reasons`, errors);
  }
  stringArray(value.limitations, `${path}.limitations`, errors, { max: 50, itemMax: 500 });
  if (typeof value.plan_id === 'string' && value.plan_id !== deriveRunPlanId(value)) {
    errors.push(`${path}.plan_id: does not match the canonical plan identity`);
  }
}

function validateRunReceipt(value, path, errors) {
  if (value?.schema_version === CONTRACT_SCHEMA_VERSIONS['run-receipt-v2']) {
    validateRunReceiptV2(value, path, errors);
    return;
  }
  validateRunReceiptV1(value, path, errors);
}

function validateRunReceiptV1(value, path, errors) {
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

function validateRunReceiptV2(value, path, errors) {
  const fields = [
    'schema_version',
    'run_id',
    'plan_id',
    'task_id',
    'manifest_sha256',
    'fixture_sha256',
    'acceptance_contract_sha256',
    'adapter_sha256',
    'environment_sha256',
    'workspace_policy',
    'terminal_status',
    'lifecycle',
    'agent',
    'checks',
    'regression_count',
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
    CONTRACT_SCHEMA_VERSIONS['run-receipt-v2'],
    `${path}.schema_version`,
    errors
  );
  id(value.run_id, `${path}.run_id`, errors);
  id(value.plan_id, `${path}.plan_id`, errors);
  id(value.task_id, `${path}.task_id`, errors);
  for (const field of [
    'manifest_sha256',
    'fixture_sha256',
    'acceptance_contract_sha256',
    'adapter_sha256',
    'environment_sha256',
  ]) {
    sha256(value[field], `${path}.${field}`, errors);
  }
  exact(
    value.workspace_policy,
    'public_fixture_and_task_packet_v1',
    `${path}.workspace_policy`,
    errors
  );
  const terminalStatuses = [
    'setup_failure',
    'agent_failure',
    'cancelled',
    'timeout',
    'incomplete_checks',
    'check_failure',
    'regression',
    'check_error',
    'cleanup_failure',
    'success',
  ];
  oneOf(value.terminal_status, terminalStatuses, `${path}.terminal_status`, errors);
  validateLifecycle(value.lifecycle, `${path}.lifecycle`, errors);
  validateAgentTermination(value.agent, `${path}.agent`, errors);
  checkArray(value.checks, `${path}.checks`, errors);
  integer(value.regression_count, `${path}.regression_count`, errors, 0, CORPUS_LIMITS.maxChecks);
  if (closedObject(value.cleanup, `${path}.cleanup`, ['status'], ['status'], errors)) {
    oneOf(value.cleanup.status, ['complete', 'failed'], `${path}.cleanup.status`, errors);
  }
  validateDiagnostics(value.diagnostics, `${path}.diagnostics`, errors);
  stringArray(value.limitations, `${path}.limitations`, errors, { max: 50, itemMax: 500 });

  const checksStarted = value.lifecycle?.includes('checks_started');
  const agentTerminated = value.lifecycle?.includes('agent_terminated');
  if (checksStarted && !agentTerminated) {
    errors.push(`${path}.lifecycle: checks require prior agent termination`);
  }
  if (value.terminal_status === 'success') {
    if (value.cleanup?.status !== 'complete') {
      errors.push(`${path}.cleanup.status: success requires complete cleanup`);
    }
    if (value.agent?.status !== 'exited' || value.agent?.exit_code !== 0) {
      errors.push(`${path}.agent: success requires a clean zero exit`);
    }
    if (!checksStarted || !value.lifecycle?.includes('checks_finished')) {
      errors.push(`${path}.lifecycle: success requires completed checks`);
    }
    if (value.regression_count !== 0) {
      errors.push(`${path}.regression_count: success requires zero regressions`);
    }
    if (value.checks?.some((check) => check?.status !== 'pass')) {
      errors.push(`${path}.checks: success requires every check to pass`);
    }
  }
  if (value.cleanup?.status === 'failed' && value.terminal_status !== 'cleanup_failure') {
    errors.push(`${path}.terminal_status: failed cleanup requires cleanup_failure`);
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

function validateAdapterCommand(value, path, errors) {
  if (!Array.isArray(value)) return;
  const allowed = new Set(['{node}', '{adapter_root}', '{workspace}', '{task_packet}']);
  if (value[0] !== '{node}') {
    errors.push(`${path}[0]: v2 adapters must use the immutable Node runtime placeholder`);
  }
  for (const [index, argument] of value.entries()) {
    if (typeof argument !== 'string') continue;
    const placeholders = argument.match(/\{[^}]+\}/g) ?? [];
    for (const placeholder of placeholders) {
      if (!allowed.has(placeholder)) {
        errors.push(`${path}[${index}]: unknown placeholder "${placeholder}"`);
      }
    }
    if (placeholders.length > 1 || /[{}]/.test(argument.replace(/\{[^}]+\}/g, ''))) {
      errors.push(`${path}[${index}]: expected at most one closed placeholder`);
    }
    if (argument.includes('{node}') && argument !== '{node}') {
      errors.push(`${path}[${index}]: node placeholder must be the complete argument`);
    }
    if (argument.includes('{task_packet}') && argument !== '{task_packet}') {
      errors.push(`${path}[${index}]: task_packet placeholder must be the complete argument`);
    }
    if (argument.includes('{workspace}') && argument !== '{workspace}') {
      if (!argument.startsWith('{workspace}/')) {
        errors.push(`${path}[${index}]: workspace must prefix one safe relative path`);
      } else {
        relativePath(
          argument.slice('{workspace}/'.length),
          `${path}[${index}] workspace path`,
          errors
        );
      }
    }
    if (argument.includes('{adapter_root}')) {
      if (!argument.startsWith('{adapter_root}/') || argument.match(/\{[^}]+\}/g)?.length !== 1) {
        errors.push(`${path}[${index}]: adapter_root must prefix one declared artifact path`);
      } else {
        relativePath(
          argument.slice('{adapter_root}/'.length),
          `${path}[${index}] adapter path`,
          errors
        );
      }
    }
  }
}

function artifactArray(value, path, errors) {
  array(value, path, errors, { min: 1, max: 50 });
  if (!Array.isArray(value)) return;
  const paths = [];
  for (const [index, item] of value.entries()) {
    artifact(item, `${path}[${index}]`, errors);
    if (typeof item?.path === 'string') paths.push(item.path);
  }
  unique(paths, `${path} path`, errors);
  sorted(paths, path, errors);
}

function validateEnvironmentNames(value, path, errors) {
  stringArray(value, path, errors, { max: 30, itemMax: 80 });
  if (!Array.isArray(value)) return;
  unique(value, path, errors);
  sorted(value, path, errors);
  for (const [index, name] of value.entries()) {
    if (typeof name === 'string' && !ENVIRONMENT_NAME_PATTERN.test(name)) {
      errors.push(`${path}[${index}]: invalid environment variable name`);
    }
  }
}

function validateEnvironmentAvailability(value, path, errors) {
  array(value, path, errors, { max: 30 });
  if (!Array.isArray(value)) return;
  const names = [];
  for (const [index, entry] of value.entries()) {
    const entryPath = `${path}[${index}]`;
    if (!closedObject(entry, entryPath, ['name', 'available'], ['name', 'available'], errors)) {
      continue;
    }
    stringPattern(entry.name, ENVIRONMENT_NAME_PATTERN, `${entryPath}.name`, errors, 80);
    boolean(entry.available, `${entryPath}.available`, errors);
    if (typeof entry.name === 'string') names.push(entry.name);
  }
  unique(names, `${path} name`, errors);
  sorted(names, path, errors);
}

function validatePlanning(value, path, errors) {
  const fields = [
    'prompt_overhead_tokens',
    'reserved_output_tokens',
    'input_usd_per_million',
    'output_usd_per_million',
    'max_cost_usd',
  ];
  if (!closedObject(value, path, fields, fields, errors)) return;
  integer(value.prompt_overhead_tokens, `${path}.prompt_overhead_tokens`, errors, 0, 1_000_000);
  integer(value.reserved_output_tokens, `${path}.reserved_output_tokens`, errors, 1, 1_000_000);
  for (const field of ['input_usd_per_million', 'output_usd_per_million', 'max_cost_usd']) {
    finiteNumber(value[field], `${path}.${field}`, errors, 0, 100_000);
  }
}

function validateLifecycle(value, path, errors) {
  const order = [
    'workspace_prepared',
    'agent_started',
    'agent_terminated',
    'checks_started',
    'checks_finished',
    'cleanup_complete',
    'cleanup_failed',
  ];
  array(value, path, errors, { max: order.length });
  if (!Array.isArray(value)) return;
  for (const [index, item] of value.entries()) {
    oneOf(item, order, `${path}[${index}]`, errors);
  }
  unique(value, path, errors);
  const positions = value.map((item) => order.indexOf(item));
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    errors.push(`${path}: lifecycle events must follow terminal execution order`);
  }
  if (value.includes('cleanup_complete') && value.includes('cleanup_failed')) {
    errors.push(`${path}: cleanup cannot be both complete and failed`);
  }
}

function validateAgentTermination(value, path, errors) {
  const fields = [
    'status',
    'exit_code',
    'stdout_sha256',
    'stderr_sha256',
    'stdout_bytes',
    'stderr_bytes',
    'output_truncated',
  ];
  if (!closedObject(value, path, fields, fields, errors)) return;
  oneOf(
    value.status,
    ['not_started', 'exited', 'failed', 'cancelled', 'timeout'],
    `${path}.status`,
    errors
  );
  if (value.exit_code !== null) integer(value.exit_code, `${path}.exit_code`, errors, 0, 255);
  sha256(value.stdout_sha256, `${path}.stdout_sha256`, errors);
  sha256(value.stderr_sha256, `${path}.stderr_sha256`, errors);
  integer(value.stdout_bytes, `${path}.stdout_bytes`, errors, 0, 262_144);
  integer(value.stderr_bytes, `${path}.stderr_bytes`, errors, 0, 262_144);
  boolean(value.output_truncated, `${path}.output_truncated`, errors);
  if (value.status === 'exited' && value.exit_code !== 0) {
    errors.push(`${path}.exit_code: exited status requires zero`);
  }
  if (['not_started', 'cancelled', 'timeout'].includes(value.status) && value.exit_code !== null) {
    errors.push(`${path}.exit_code: status requires null`);
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

function qualificationPhaseV2(value, path, phase, errors) {
  const baselineStatuses = [
    'intended_failure',
    'wrong_failure',
    'setup_failure',
    'timeout',
    'incomplete_checks',
    'check_error',
    'flaky',
    'cleanup_failure',
  ];
  const knownGoodStatuses = [
    'pass',
    'patch_failure',
    'check_failure',
    'regression',
    'setup_failure',
    'timeout',
    'incomplete_checks',
    'check_error',
    'flaky',
    'cleanup_failure',
  ];
  const statuses = phase === 'baseline' ? baselineStatuses : knownGoodStatuses;
  if (!closedObject(value, path, ['status', 'attempts'], ['status', 'attempts'], errors)) return;
  oneOf(value.status, statuses, `${path}.status`, errors);
  array(value.attempts, `${path}.attempts`, errors, { min: 2, max: 5 });
  if (!Array.isArray(value.attempts)) return;
  const outcomes = [];
  const identities = [];
  for (const [index, attempt] of value.attempts.entries()) {
    const attemptPath = `${path}.attempts[${index}]`;
    if (
      !closedObject(
        attempt,
        attemptPath,
        ['attempt', 'outcome', 'result_sha256'],
        ['attempt', 'outcome', 'result_sha256'],
        errors
      )
    ) {
      continue;
    }
    integer(attempt.attempt, `${attemptPath}.attempt`, errors, 1, 5);
    if (attempt.attempt !== index + 1) {
      errors.push(`${attemptPath}.attempt: attempts must be ordered from 1`);
    }
    oneOf(
      attempt.outcome,
      statuses.filter((status) => status !== 'flaky'),
      `${attemptPath}.outcome`,
      errors
    );
    if (attempt.result_sha256 !== null) {
      sha256(attempt.result_sha256, `${attemptPath}.result_sha256`, errors);
    }
    if (typeof attempt.outcome === 'string') outcomes.push(attempt.outcome);
    identities.push(attempt.result_sha256);
  }
  const stable =
    new Set(outcomes).size <= 1 &&
    new Set(identities.map((identity) => String(identity))).size <= 1;
  if (value.status === 'flaky' && stable) {
    errors.push(`${path}.status: flaky requires differing repeated outcomes or results`);
  }
  if (value.status !== 'flaky' && outcomes.some((outcome) => outcome !== value.status)) {
    errors.push(`${path}.status: must match every stable attempt outcome`);
  }
}

function fileBundle(value, path, contentField, errors) {
  array(value, path, errors, { min: 1, max: 100 });
  if (!Array.isArray(value)) return;
  const paths = [];
  for (const [index, file] of value.entries()) {
    const filePath = `${path}[${index}]`;
    const allowed = ['path', contentField, 'sha256'];
    if (!closedObject(file, filePath, allowed, allowed, errors)) continue;
    relativePath(file.path, `${filePath}.path`, errors);
    validateBase64(file[contentField], file.sha256, `${filePath}.${contentField}`, errors);
    sha256(file.sha256, `${filePath}.sha256`, errors);
    if (typeof file.path === 'string') paths.push(file.path);
  }
  unique(paths, `${path} path`, errors);
  sorted(paths, path, errors);
}

function validateBase64(value, expectedSha256, path, errors) {
  boundedString(value, path, errors, 4, 1_398_104);
  if (typeof value !== 'string') return;
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    errors.push(`${path}: expected canonical base64`);
    return;
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.length > CORPUS_LIMITS.maxArtifactBytes) {
    errors.push(`${path}: decoded content must be 1-${CORPUS_LIMITS.maxArtifactBytes} bytes`);
    return;
  }
  if (SHA256_PATTERN.test(String(expectedSha256)) && sha256Bytes(bytes) !== expectedSha256) {
    errors.push(`${path}: decoded SHA-256 does not match`);
  }
}

function describedCheckArray(value, path, errors, min) {
  array(value, path, errors, { min, max: CORPUS_LIMITS.maxChecks });
  if (!Array.isArray(value)) return [];
  const ids = [];
  for (const [index, check] of value.entries()) {
    const checkPath = `${path}[${index}]`;
    if (!closedObject(check, checkPath, ['id', 'label'], ['id', 'label'], errors)) continue;
    id(check.id, `${checkPath}.id`, errors);
    boundedString(check.label, `${checkPath}.label`, errors, 1, 160);
    if (typeof check.id === 'string') ids.push(check.id);
  }
  unique(ids, `${path} id`, errors);
  sorted(ids, path, errors);
  return ids;
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

function finiteNumber(value, path, errors, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    errors.push(`${path}: expected a finite number from ${min} to ${max}`);
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
  'acceptance-contract': validateAcceptanceContract,
  'agent-adapter': validateAgentAdapter,
  'check-result': validateCheckResult,
  'corpus-index': validateCorpusIndex,
  'fixture-bundle': validateFixtureBundle,
  'known-good-change': validateKnownGoodChange,
  'qualification-receipt': validateQualificationReceipt,
  'run-plan': validateRunPlan,
  'run-receipt': validateRunReceipt,
  'task-manifest': validateTaskManifest,
});
