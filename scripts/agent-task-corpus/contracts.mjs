import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const CONTRACT_SCHEMA_VERSIONS = Object.freeze({
  'acceptance-contract': 'codevetter.agent-task-acceptance.v1',
  'adapter-diagnostics': 'codevetter.agent-task-diagnostics.v1',
  'agent-adapter': 'codevetter.agent-task-adapter.v1',
  'agent-adapter-v2': 'codevetter.agent-task-adapter.v2',
  'check-result': 'codevetter.agent-task-check-result.v1',
  'context-provider-comparison': 'codevetter.context-provider-comparison.v1',
  'context-provider-plan': 'codevetter.context-provider-plan.v1',
  'context-provider-probe': 'codevetter.context-provider-probe.v1',
  'corpus-index': 'codevetter.agent-task-corpus.v1',
  'evaluation-bundle': 'codevetter.agent-task-evaluation-bundle.v1',
  'evaluation-score': 'codevetter.agent-task-evaluation-score.v1',
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
const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
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

export function deriveContextProviderPlanId(value) {
  const { plan_id: _planId, approvals, ...identity } = value;
  const approvalsWithoutIdentity = approvals ? { ...approvals, approval_id: undefined } : approvals;
  return `plan-${sha256Bytes(
    Buffer.from(canonicalJson({ ...identity, approvals: approvalsWithoutIdentity }))
  ).slice(0, 32)}`;
}

export function deriveContextProviderApprovalId(planId) {
  return `approval-${sha256Bytes(Buffer.from(planId)).slice(0, 32)}`;
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
  if (kind.startsWith('context-provider-')) {
    validatePrivacySafeDocument(value, '$', errors);
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

function validateEvaluationBundle(value, path, errors) {
  const fields = ['schema_version', 'experiment', 'corpus', 'tasks', 'runs'];
  if (!closedObject(value, path, fields, fields, errors)) return;
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['evaluation-bundle'],
    `${path}.schema_version`,
    errors
  );
  validateEvaluationExperiment(value.experiment, `${path}.experiment`, errors);
  artifact(value.corpus, `${path}.corpus`, errors);

  array(value.tasks, `${path}.tasks`, errors, { min: 1, max: CORPUS_LIMITS.maxTasks });
  const taskIds = [];
  for (const [index, task] of (Array.isArray(value.tasks) ? value.tasks : []).entries()) {
    const taskPath = `${path}.tasks[${index}]`;
    if (
      !closedObject(
        task,
        taskPath,
        ['task_id', 'repository_revision'],
        ['task_id', 'repository_revision'],
        errors
      )
    ) {
      continue;
    }
    id(task.task_id, `${taskPath}.task_id`, errors);
    revision(task.repository_revision, `${taskPath}.repository_revision`, errors);
    if (typeof task.task_id === 'string') taskIds.push(task.task_id);
  }
  unique(taskIds, `${path}.tasks task_id`, errors);

  array(value.runs, `${path}.runs`, errors, { min: 2, max: 5_000 });
  const runKeys = [];
  const receiptPaths = [];
  const receiptHashes = [];
  for (const [index, run] of (Array.isArray(value.runs) ? value.runs : []).entries()) {
    const runPath = `${path}.runs[${index}]`;
    const runFields = [
      'pair_id',
      'comparison',
      'arm',
      'task_id',
      'trial_index',
      'execution_order',
      'receipt',
      'adapter',
      'context',
    ];
    if (!closedObject(run, runPath, runFields, runFields, errors)) continue;
    id(run.pair_id, `${runPath}.pair_id`, errors);
    oneOf(run.comparison, ['aa', 'ab'], `${runPath}.comparison`, errors);
    const allowedArms = run.comparison === 'aa' ? ['a', 'b'] : ['control', 'treatment'];
    oneOf(run.arm, allowedArms, `${runPath}.arm`, errors);
    id(run.task_id, `${runPath}.task_id`, errors);
    if (typeof run.task_id === 'string' && !taskIds.includes(run.task_id)) {
      errors.push(`${runPath}.task_id: does not reference a declared task`);
    }
    integer(run.trial_index, `${runPath}.trial_index`, errors, 1, 10_000);
    integer(run.execution_order, `${runPath}.execution_order`, errors, 1, 2);
    artifact(run.receipt, `${runPath}.receipt`, errors);
    artifact(run.adapter, `${runPath}.adapter`, errors);
    validateEvaluationContext(run.context, `${runPath}.context`, errors);
    if (
      typeof run.comparison === 'string' &&
      typeof run.pair_id === 'string' &&
      typeof run.arm === 'string'
    ) {
      runKeys.push(`${run.comparison}:${run.pair_id}:${run.arm}`);
    }
    if (typeof run.receipt?.path === 'string') receiptPaths.push(run.receipt.path);
    if (typeof run.receipt?.sha256 === 'string') receiptHashes.push(run.receipt.sha256);
  }
  unique(runKeys, `${path}.runs pair arm`, errors);
  unique(receiptPaths, `${path}.runs receipt path`, errors);
  unique(receiptHashes, `${path}.runs receipt sha256`, errors);
}

function validateEvaluationExperiment(value, path, errors) {
  const fields = ['id', 'title', 'evidence_kind', 'qualification_policy', 'limitations'];
  if (!closedObject(value, path, fields, fields, errors)) return;
  id(value.id, `${path}.id`, errors);
  boundedString(value.title, `${path}.title`, errors, 1, 160);
  oneOf(value.evidence_kind, ['real', 'synthetic'], `${path}.evidence_kind`, errors);
  const policyFields = [
    'minimum_complete_pairs',
    'minimum_distinct_tasks',
    'minimum_aa_pairs',
    'minimum_success_rate_delta',
    'maximum_regression_delta',
    'maximum_aa_discordance_rate',
  ];
  if (
    closedObject(
      value.qualification_policy,
      `${path}.qualification_policy`,
      policyFields,
      policyFields,
      errors
    )
  ) {
    const policy = value.qualification_policy;
    integer(
      policy.minimum_complete_pairs,
      `${path}.qualification_policy.minimum_complete_pairs`,
      errors,
      1,
      5_000
    );
    integer(
      policy.minimum_distinct_tasks,
      `${path}.qualification_policy.minimum_distinct_tasks`,
      errors,
      1,
      CORPUS_LIMITS.maxTasks
    );
    integer(
      policy.minimum_aa_pairs,
      `${path}.qualification_policy.minimum_aa_pairs`,
      errors,
      1,
      5_000
    );
    finiteNumber(
      policy.minimum_success_rate_delta,
      `${path}.qualification_policy.minimum_success_rate_delta`,
      errors,
      0,
      1
    );
    integer(
      policy.maximum_regression_delta,
      `${path}.qualification_policy.maximum_regression_delta`,
      errors,
      0,
      CORPUS_LIMITS.maxChecks * 5_000
    );
    finiteNumber(
      policy.maximum_aa_discordance_rate,
      `${path}.qualification_policy.maximum_aa_discordance_rate`,
      errors,
      0,
      1
    );
  }
  stringArray(value.limitations, `${path}.limitations`, errors, { max: 50, itemMax: 500 });
}

function validateEvaluationContext(value, path, errors) {
  const fields = ['structural_context_enabled', 'policy_identity', 'graph', 'allowed_graph_tools'];
  if (!closedObject(value, path, fields, fields, errors)) return;
  boolean(value.structural_context_enabled, `${path}.structural_context_enabled`, errors);
  id(value.policy_identity, `${path}.policy_identity`, errors);
  stringArray(value.allowed_graph_tools, `${path}.allowed_graph_tools`, errors, {
    max: 100,
    itemMax: 200,
  });
  if (Array.isArray(value.allowed_graph_tools)) {
    unique(value.allowed_graph_tools, `${path}.allowed_graph_tools`, errors);
    sorted(value.allowed_graph_tools, `${path}.allowed_graph_tools`, errors);
  }
  if (value.graph === null) return;
  const graphFields = ['engine_id', 'engine_version', 'snapshot_id', 'indexed_revision'];
  if (!closedObject(value.graph, `${path}.graph`, graphFields, graphFields, errors)) return;
  id(value.graph.engine_id, `${path}.graph.engine_id`, errors);
  boundedString(value.graph.engine_version, `${path}.graph.engine_version`, errors, 1, 80);
  snapshotId(value.graph.snapshot_id, `${path}.graph.snapshot_id`, errors);
  revision(value.graph.indexed_revision, `${path}.graph.indexed_revision`, errors);
}

function validateEvaluationScore(value, path, errors) {
  const fields = ['schema_version', 'score_id', 'scorer', 'evidence', 'scorecard'];
  if (!closedObject(value, path, fields, fields, errors)) return;
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['evaluation-score'],
    `${path}.schema_version`,
    errors
  );
  id(value.score_id, `${path}.score_id`, errors);
  if (
    closedObject(
      value.scorer,
      `${path}.scorer`,
      ['version', 'sha256'],
      ['version', 'sha256'],
      errors
    )
  ) {
    boundedString(value.scorer.version, `${path}.scorer.version`, errors, 1, 80);
    sha256(value.scorer.sha256, `${path}.scorer.sha256`, errors);
  }
  const evidenceFields = [
    'bundle_sha256',
    'corpus_sha256',
    'ground_truth_sha256',
    'projected_manifest_sha256',
    'receipts',
  ];
  if (closedObject(value.evidence, `${path}.evidence`, evidenceFields, evidenceFields, errors)) {
    for (const field of evidenceFields.slice(0, -1)) {
      sha256(value.evidence[field], `${path}.evidence.${field}`, errors);
    }
    array(value.evidence.receipts, `${path}.evidence.receipts`, errors, { min: 2, max: 5_000 });
    const receiptPaths = [];
    const receiptHashes = [];
    const runIds = [];
    for (const [index, receipt] of (Array.isArray(value.evidence.receipts)
      ? value.evidence.receipts
      : []
    ).entries()) {
      const receiptPath = `${path}.evidence.receipts[${index}]`;
      if (
        !closedObject(
          receipt,
          receiptPath,
          ['path', 'sha256', 'run_id'],
          ['path', 'sha256', 'run_id'],
          errors
        )
      ) {
        continue;
      }
      relativePath(receipt.path, `${receiptPath}.path`, errors);
      sha256(receipt.sha256, `${receiptPath}.sha256`, errors);
      id(receipt.run_id, `${receiptPath}.run_id`, errors);
      receiptPaths.push(receipt.path);
      receiptHashes.push(receipt.sha256);
      runIds.push(receipt.run_id);
    }
    unique(receiptPaths, `${path}.evidence.receipts path`, errors);
    unique(receiptHashes, `${path}.evidence.receipts sha256`, errors);
    unique(runIds, `${path}.evidence.receipts run_id`, errors);
    sorted(receiptPaths, `${path}.evidence.receipts`, errors);
  }
  if (!value.scorecard || typeof value.scorecard !== 'object' || Array.isArray(value.scorecard)) {
    errors.push(`${path}.scorecard: expected an object`);
  }
  if (typeof value.score_id === 'string') {
    const { score_id: _scoreId, ...identity } = value;
    const expected = `score-${sha256Bytes(Buffer.from(canonicalJson(identity))).slice(0, 32)}`;
    if (value.score_id !== expected) {
      errors.push(`${path}.score_id: does not match the canonical score identity`);
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

function validateAdapterDiagnostics(value, path, errors) {
  const fields = [
    'schema_version',
    'input_tokens',
    'output_tokens',
    'cost_usd',
    'tool_calls',
    'files_inspected',
    'files_modified',
  ];
  if (!closedObject(value, path, fields, ['schema_version'], errors)) return;
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['adapter-diagnostics'],
    `${path}.schema_version`,
    errors
  );
  const diagnostics = Object.fromEntries(
    fields
      .filter((field) => field !== 'schema_version' && value[field] !== undefined)
      .map((field) => [field, value[field]])
  );
  if (Object.keys(diagnostics).length === 0) {
    errors.push(`${path}: at least one diagnostics observation is required`);
  }
  validateDiagnostics(diagnostics, path, errors);
  for (const field of ['tool_calls', 'files_inspected', 'files_modified']) {
    if (!Array.isArray(value[field])) continue;
    unique(value[field], `${path}.${field}`, errors);
    sorted(value[field], `${path}.${field}`, errors);
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

function validateContextProviderProbe(value, path, errors) {
  const fields = [
    'schema_version',
    'provider_id',
    'provider_name',
    'provider_version',
    'configuration_sha256',
    'context_kind',
    'interface_kind',
    'operating_mode',
    'indexing',
    'tools',
    'data_egress',
    'authentication',
    'environment_names',
    'cost',
    'setup',
    'publication',
    'limitations',
  ];
  if (!closedObject(value, path, fields, fields, errors)) return;
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['context-provider-probe'],
    `${path}.schema_version`,
    errors
  );
  id(value.provider_id, `${path}.provider_id`, errors);
  boundedString(value.provider_name, `${path}.provider_name`, errors, 1, 120);
  boundedString(value.provider_version, `${path}.provider_version`, errors, 1, 120);
  sha256(value.configuration_sha256, `${path}.configuration_sha256`, errors);
  oneOf(
    value.context_kind,
    ['baseline', 'graph', 'search', 'wiki-rag', 'hybrid'],
    `${path}.context_kind`,
    errors
  );
  oneOf(value.interface_kind, ['none', 'cli', 'mcp', 'api'], `${path}.interface_kind`, errors);
  oneOf(value.operating_mode, ['local', 'hosted', 'enterprise'], `${path}.operating_mode`, errors);
  if (
    closedObject(
      value.indexing,
      `${path}.indexing`,
      ['mode', 'exact_revision_supported', 'snapshot_identity_supported', 'freshness_check'],
      ['mode', 'exact_revision_supported', 'snapshot_identity_supported', 'freshness_check'],
      errors
    )
  ) {
    oneOf(
      value.indexing.mode,
      ['none', 'on-demand', 'prebuilt', 'continuous'],
      `${path}.indexing.mode`,
      errors
    );
    boolean(
      value.indexing.exact_revision_supported,
      `${path}.indexing.exact_revision_supported`,
      errors
    );
    boolean(
      value.indexing.snapshot_identity_supported,
      `${path}.indexing.snapshot_identity_supported`,
      errors
    );
    oneOf(
      value.indexing.freshness_check,
      ['none', 'revision-match', 'provider-status', 'unknown'],
      `${path}.indexing.freshness_check`,
      errors
    );
  }
  if (
    closedObject(
      value.tools,
      `${path}.tools`,
      ['observable', 'allowed'],
      ['observable', 'allowed'],
      errors
    )
  ) {
    boolean(value.tools.observable, `${path}.tools.observable`, errors);
    stringArray(value.tools.allowed, `${path}.tools.allowed`, errors, { max: 100, itemMax: 80 });
    if (Array.isArray(value.tools.allowed)) {
      unique(value.tools.allowed, `${path}.tools.allowed`, errors);
      sorted(value.tools.allowed, `${path}.tools.allowed`, errors);
      for (const [index, tool] of value.tools.allowed.entries()) {
        stringPattern(
          tool,
          /^[a-z][a-z0-9_-]{0,79}$/,
          `${path}.tools.allowed[${index}]`,
          errors,
          80
        );
      }
    }
  }
  oneOf(
    value.data_egress,
    ['none', 'metadata', 'source-content', 'unknown'],
    `${path}.data_egress`,
    errors
  );
  oneOf(
    value.authentication,
    ['none', 'credential-name', 'unknown'],
    `${path}.authentication`,
    errors
  );
  validateEnvironmentNames(value.environment_names, `${path}.environment_names`, errors);
  if (
    closedObject(
      value.cost,
      `${path}.cost`,
      ['posture', 'max_usd_per_attempt'],
      ['posture', 'max_usd_per_attempt'],
      errors
    )
  ) {
    oneOf(value.cost.posture, ['free', 'paid', 'unknown'], `${path}.cost.posture`, errors);
    finiteNumber(
      value.cost.max_usd_per_attempt,
      `${path}.cost.max_usd_per_attempt`,
      errors,
      0,
      100_000
    );
    if (value.cost.posture === 'free' && value.cost.max_usd_per_attempt !== 0) {
      errors.push(`${path}.cost.max_usd_per_attempt: free providers require zero cost`);
    }
  }
  if (
    closedObject(
      value.setup,
      `${path}.setup`,
      ['status', 'duration_ms', 'evidence', 'exclusion_reasons'],
      ['status', 'duration_ms', 'evidence', 'exclusion_reasons'],
      errors
    )
  ) {
    oneOf(value.setup.status, ['eligible', 'excluded', 'blocked'], `${path}.setup.status`, errors);
    if (value.setup.duration_ms !== null) {
      integer(value.setup.duration_ms, `${path}.setup.duration_ms`, errors, 0, 3_600_000);
    }
    stringArray(value.setup.evidence, `${path}.setup.evidence`, errors, { max: 30, itemMax: 240 });
    stringArray(value.setup.exclusion_reasons, `${path}.setup.exclusion_reasons`, errors, {
      max: 30,
      itemMax: 240,
    });
    for (const field of ['evidence', 'exclusion_reasons']) {
      unique(value.setup[field], `${path}.setup.${field}`, errors);
      sorted(value.setup[field], `${path}.setup.${field}`, errors);
    }
    if (value.setup.status === 'eligible' && value.setup.exclusion_reasons?.length !== 0) {
      errors.push(`${path}.setup.exclusion_reasons: eligible providers cannot have exclusions`);
    }
    if (value.setup.status !== 'eligible' && value.setup.exclusion_reasons?.length === 0) {
      errors.push(
        `${path}.setup.exclusion_reasons: excluded or blocked providers require a reason`
      );
    }
  }
  oneOf(value.publication, ['allowed', 'restricted', 'unknown'], `${path}.publication`, errors);
  stringArray(value.limitations, `${path}.limitations`, errors, { max: 50, itemMax: 500 });

  if (value.authentication === 'none' && value.environment_names?.length !== 0) {
    errors.push(`${path}.environment_names: unauthenticated providers cannot require credentials`);
  }
  if (value.authentication === 'credential-name' && value.environment_names?.length === 0) {
    errors.push(`${path}.environment_names: credential-name authentication requires a name`);
  }
  if (value.context_kind === 'baseline') {
    if (value.provider_id !== 'plain-repository-tools') {
      errors.push(`${path}.provider_id: baseline identity must be plain-repository-tools`);
    }
    if (value.interface_kind !== 'none' || value.indexing?.mode !== 'none') {
      errors.push(`${path}: baseline cannot declare a provider interface or index`);
    }
    if (value.tools?.allowed?.length !== 0 || value.data_egress !== 'none') {
      errors.push(`${path}: baseline cannot declare provider tools or data egress`);
    }
  } else if (value.setup?.status === 'eligible') {
    if (value.interface_kind === 'none')
      errors.push(`${path}.interface_kind: treatment requires a machine interface`);
    if (!value.indexing?.exact_revision_supported) {
      errors.push(
        `${path}.indexing.exact_revision_supported: eligible treatment must pin revisions`
      );
    }
    if (!value.indexing?.snapshot_identity_supported) {
      errors.push(
        `${path}.indexing.snapshot_identity_supported: eligible treatment must identify snapshots`
      );
    }
    if (!['revision-match', 'provider-status'].includes(value.indexing?.freshness_check)) {
      errors.push(
        `${path}.indexing.freshness_check: eligible treatment requires a freshness check`
      );
    }
    if (!value.tools?.observable || value.tools?.allowed?.length === 0) {
      errors.push(`${path}.tools: eligible treatment requires observable declared tools`);
    }
  }
}

function validateContextProviderPlan(value, path, errors) {
  const fields = [
    'schema_version',
    'plan_id',
    'experiment_id',
    'stage',
    'corpus',
    'corpus_id',
    'corpus_version',
    'agent_profile',
    'provider_probes',
    'providers',
    'tasks',
    'repetitions',
    'schedule',
    'counts',
    'cost',
    'environment',
    'approvals',
    'blocked_reasons',
    'diagnostics',
    'limitations',
  ];
  if (!closedObject(value, path, [...fields, 'aa_repetitions'], fields, errors)) return;
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['context-provider-plan'],
    `${path}.schema_version`,
    errors
  );
  id(value.plan_id, `${path}.plan_id`, errors);
  id(value.experiment_id, `${path}.experiment_id`, errors);
  oneOf(value.stage, ['probe', 'feasibility', 'full'], `${path}.stage`, errors);
  artifact(value.corpus, `${path}.corpus`, errors);
  id(value.corpus_id, `${path}.corpus_id`, errors);
  stringPattern(value.corpus_version, /^\d+\.\d+\.\d+$/, `${path}.corpus_version`, errors, 40);
  validateContextAgentProfile(value.agent_profile, `${path}.agent_profile`, errors);
  artifactArray(value.provider_probes, `${path}.provider_probes`, errors);
  array(value.providers, `${path}.providers`, errors, { min: 1, max: 4 });
  const providerIds = validateContextPlanProviders(value.providers, path, errors);
  unique(providerIds, `${path}.providers provider_id`, errors);
  sorted(providerIds, `${path}.providers`, errors);
  const probeHashes = (value.provider_probes ?? []).map((probe) => probe?.sha256).sort();
  const providerProbeHashes = (value.providers ?? [])
    .map((provider) => provider?.probe_sha256)
    .sort();
  unique(probeHashes, `${path}.provider_probes sha256`, errors);
  if (JSON.stringify(probeHashes) !== JSON.stringify(providerProbeHashes)) {
    errors.push(`${path}.provider_probes: hashes must match the declared providers`);
  }
  if ((value.providers ?? []).filter((provider) => provider?.role === 'baseline').length !== 1) {
    errors.push(`${path}.providers: exactly one baseline is required`);
  }
  array(value.tasks, `${path}.tasks`, errors, { max: CORPUS_LIMITS.maxTasks });
  const taskIds = validateContextPlanTasks(value.tasks, path, errors);
  unique(taskIds, `${path}.tasks task_id`, errors);
  sorted(taskIds, `${path}.tasks`, errors);
  validateProviderSnapshotCoverage(value.providers, value.tasks, path, errors);
  integer(value.repetitions, `${path}.repetitions`, errors, 0, 5);
  const noiseRepetitions = validateContextNoiseRepetitions(value, path, errors);
  validateContextSchedule(value.schedule, `${path}.schedule`, errors, {
    providerIds,
    treatmentIds: (value.providers ?? [])
      .filter((provider) => provider?.role === 'treatment')
      .map((provider) => provider.provider_id),
    taskIds,
    repetitions: value.repetitions,
    noiseRepetitions,
  });
  validateContextCounts(value.counts, `${path}.counts`, value, errors);
  validateContextCost(value.cost, `${path}.cost`, errors);
  validateContextCostDerivation(value, path, errors);
  validateEnvironmentAvailability(value.environment, `${path}.environment`, errors);
  validateContextApprovals(value.approvals, `${path}.approvals`, value, errors);
  for (const field of ['blocked_reasons', 'diagnostics']) {
    stringArray(value[field], `${path}.${field}`, errors, {
      max: field === 'diagnostics' ? 20 : 50,
      itemMax: 200,
    });
    unique(value[field], `${path}.${field}`, errors);
    sorted(value[field], `${path}.${field}`, errors);
  }
  stringArray(value.limitations, `${path}.limitations`, errors, { max: 50, itemMax: 500 });
  const expected =
    value.stage === 'probe' ? [0, 0] : value.stage === 'feasibility' ? [4, 2] : [30, 3];
  if (value.tasks?.length !== expected[0] || value.repetitions !== expected[1]) {
    errors.push(
      `${path}: ${value.stage} stage requires ${expected[0]} tasks and ${expected[1]} repetitions`
    );
  }
  if (typeof value.plan_id === 'string' && value.plan_id !== deriveContextProviderPlanId(value)) {
    errors.push(`${path}.plan_id: does not match the canonical context plan identity`);
  }
  if (
    typeof value.plan_id === 'string' &&
    value.approvals?.approval_id !== deriveContextProviderApprovalId(value.plan_id)
  ) {
    errors.push(`${path}.approvals.approval_id: does not match the plan identity`);
  }
}

function validateContextPlanProviders(providers, path, errors) {
  const providerIds = [];
  for (const [index, provider] of (Array.isArray(providers) ? providers : []).entries()) {
    const providerPath = `${path}.providers[${index}]`;
    if (!validateContextPlanProvider(provider, providerPath, errors)) continue;
    if (typeof provider.provider_id === 'string') providerIds.push(provider.provider_id);
  }
  return providerIds;
}

function validateContextPlanProvider(provider, path, errors) {
  const fields = [
    'provider_id',
    'provider_version',
    'configuration_sha256',
    'probe_sha256',
    'role',
    'context_kind',
    'interface_kind',
    'operating_mode',
    'data_egress',
    'cost_posture',
    'max_usd_per_attempt',
    'environment_names',
    'allowed_tools',
    'snapshots',
  ];
  if (!closedObject(provider, path, fields, fields, errors)) return false;
  id(provider.provider_id, `${path}.provider_id`, errors);
  boundedString(provider.provider_version, `${path}.provider_version`, errors, 1, 120);
  sha256(provider.configuration_sha256, `${path}.configuration_sha256`, errors);
  sha256(provider.probe_sha256, `${path}.probe_sha256`, errors);
  oneOf(provider.role, ['baseline', 'treatment'], `${path}.role`, errors);
  oneOf(
    provider.context_kind,
    ['baseline', 'graph', 'search', 'wiki-rag', 'hybrid'],
    `${path}.context_kind`,
    errors
  );
  oneOf(provider.interface_kind, ['none', 'cli', 'mcp', 'api'], `${path}.interface_kind`, errors);
  oneOf(
    provider.operating_mode,
    ['local', 'hosted', 'enterprise'],
    `${path}.operating_mode`,
    errors
  );
  oneOf(
    provider.data_egress,
    ['none', 'metadata', 'source-content', 'unknown'],
    `${path}.data_egress`,
    errors
  );
  oneOf(provider.cost_posture, ['free', 'paid', 'unknown'], `${path}.cost_posture`, errors);
  finiteNumber(provider.max_usd_per_attempt, `${path}.max_usd_per_attempt`, errors, 0, 100_000);
  validateEnvironmentNames(provider.environment_names, `${path}.environment_names`, errors);
  stringArray(provider.allowed_tools, `${path}.allowed_tools`, errors, { max: 100, itemMax: 80 });
  if (Array.isArray(provider.allowed_tools)) {
    unique(provider.allowed_tools, `${path}.allowed_tools`, errors);
    sorted(provider.allowed_tools, `${path}.allowed_tools`, errors);
  }
  array(provider.snapshots, `${path}.snapshots`, errors, { max: CORPUS_LIMITS.maxTasks });
  const snapshotTaskIds = [];
  for (const [index, snapshot] of (Array.isArray(provider.snapshots)
    ? provider.snapshots
    : []
  ).entries()) {
    validateContextSnapshot(snapshot, `${path}.snapshots[${index}]`, errors);
    if (typeof snapshot?.task_id === 'string') snapshotTaskIds.push(snapshot.task_id);
  }
  unique(snapshotTaskIds, `${path}.snapshots task_id`, errors);
  sorted(snapshotTaskIds, `${path}.snapshots`, errors);
  if (
    provider.role === 'baseline' &&
    (provider.context_kind !== 'baseline' || provider.interface_kind !== 'none')
  ) {
    errors.push(`${path}: baseline role cannot expose a provider interface`);
  }
  if (provider.role === 'treatment' && provider.context_kind === 'baseline') {
    errors.push(`${path}.context_kind: treatment cannot use baseline context`);
  }
  return true;
}

function validateProviderSnapshotCoverage(providers, tasks, path, errors) {
  const taskRows = Array.isArray(tasks) ? tasks : [];
  const taskIds = taskRows.map((task) => task?.task_id);
  const tasksById = new Map(taskRows.map((task) => [task?.task_id, task]));
  for (const [index, provider] of (Array.isArray(providers) ? providers : []).entries()) {
    const snapshotTaskIds = (provider?.snapshots ?? []).map((snapshot) => snapshot?.task_id);
    const expected = provider?.role === 'baseline' ? [] : taskIds;
    if (JSON.stringify(snapshotTaskIds) !== JSON.stringify(expected)) {
      errors.push(`${path}.providers[${index}].snapshots: must cover every planned task exactly`);
    }
    for (const [snapshotIndex, snapshot] of (provider?.snapshots ?? []).entries()) {
      const task = tasksById.get(snapshot?.task_id);
      if (task && snapshot?.source_sha256 !== task.fixture_sha256) {
        errors.push(
          `${path}.providers[${index}].snapshots[${snapshotIndex}].source_sha256: must match the task fixture`
        );
      }
      if (
        task &&
        snapshot?.indexed_revision !== null &&
        snapshot?.indexed_revision !== task.repository_revision
      ) {
        errors.push(
          `${path}.providers[${index}].snapshots[${snapshotIndex}].indexed_revision: must match the task revision`
        );
      }
    }
  }
}

function validateContextPlanTasks(tasks, path, errors) {
  const taskIds = [];
  for (const [index, task] of (Array.isArray(tasks) ? tasks : []).entries()) {
    const taskPath = `${path}.tasks[${index}]`;
    const fields = [
      'task_id',
      'manifest_sha256',
      'fixture_sha256',
      'repository_revision',
      'lane',
      'runtime',
      'category',
    ];
    if (!closedObject(task, taskPath, fields, fields, errors)) continue;
    id(task.task_id, `${taskPath}.task_id`, errors);
    sha256(task.manifest_sha256, `${taskPath}.manifest_sha256`, errors);
    sha256(task.fixture_sha256, `${taskPath}.fixture_sha256`, errors);
    revision(task.repository_revision, `${taskPath}.repository_revision`, errors);
    oneOf(task.lane, ['api', 'browser'], `${taskPath}.lane`, errors);
    oneOf(task.runtime, ['node', 'typescript'], `${taskPath}.runtime`, errors);
    id(task.category, `${taskPath}.category`, errors);
    if (typeof task.task_id === 'string') taskIds.push(task.task_id);
  }
  return taskIds;
}

function validateContextAgentProfile(value, path, errors) {
  const fields = [
    'status',
    'agent',
    'model',
    'adapter',
    'configuration_sha256',
    'environment_sha256',
    'cost_posture',
    'max_usd_per_attempt',
  ];
  if (!closedObject(value, path, fields, fields, errors)) return;
  oneOf(value.status, ['unselected', 'selected'], `${path}.status`, errors);
  for (const field of ['agent', 'model']) {
    if (value[field] !== null)
      boundedString(value[field], `${path}.${field}`, errors, 1, field === 'agent' ? 120 : 160);
  }
  if (value.adapter !== null) artifact(value.adapter, `${path}.adapter`, errors);
  for (const field of ['configuration_sha256', 'environment_sha256']) {
    if (value[field] !== null) sha256(value[field], `${path}.${field}`, errors);
  }
  oneOf(value.cost_posture, ['free', 'paid', 'unknown'], `${path}.cost_posture`, errors);
  if (value.max_usd_per_attempt !== null)
    finiteNumber(value.max_usd_per_attempt, `${path}.max_usd_per_attempt`, errors, 0, 100_000);
  const nullable = [
    'agent',
    'model',
    'adapter',
    'configuration_sha256',
    'environment_sha256',
    'max_usd_per_attempt',
  ];
  if (value.status === 'unselected' && nullable.some((field) => value[field] !== null)) {
    errors.push(`${path}: unselected agent profile fields must be null`);
  }
  if (value.status === 'selected' && nullable.some((field) => value[field] === null)) {
    errors.push(`${path}: selected agent profile fields must be pinned`);
  }
}

function validateContextSnapshot(value, path, errors) {
  const fields = ['task_id', 'source_sha256', 'status', 'snapshot_id', 'indexed_revision'];
  if (!closedObject(value, path, fields, fields, errors)) return;
  id(value.task_id, `${path}.task_id`, errors);
  sha256(value.source_sha256, `${path}.source_sha256`, errors);
  oneOf(value.status, ['pending', 'ready', 'stale'], `${path}.status`, errors);
  if (value.snapshot_id !== null) snapshotId(value.snapshot_id, `${path}.snapshot_id`, errors);
  if (value.indexed_revision !== null)
    revision(value.indexed_revision, `${path}.indexed_revision`, errors);
  if (value.status === 'ready' && (value.snapshot_id === null || value.indexed_revision === null)) {
    errors.push(`${path}: ready snapshots require identity and indexed revision`);
  }
  if (value.status !== 'ready' && (value.snapshot_id !== null || value.indexed_revision !== null)) {
    errors.push(`${path}: non-ready snapshots cannot claim identity or revision`);
  }
}

function validateContextNoiseRepetitions(plan, path, errors) {
  if (!Object.hasOwn(plan, 'aa_repetitions')) return 0;
  integer(plan.aa_repetitions, `${path}.aa_repetitions`, errors, 0, 5);
  if (plan.aa_repetitions === 0) {
    errors.push(`${path}.aa_repetitions: omit the field instead of declaring zero A/A repetitions`);
  }
  if (plan.stage === 'probe' && plan.aa_repetitions > 0) {
    errors.push(`${path}.aa_repetitions: the probe stage schedules no attempts`);
  }
  return Number.isInteger(plan.aa_repetitions) ? plan.aa_repetitions : 0;
}

// Split into per-entry validation, key derivation and cross-entry tallies. The single
// function scored cognitive complexity 34 against this repository's ceiling of 20; the
// pull request that introduced it verified lint, cycles, duplication and the test suites
// but not `quality:complexity`, so nothing flagged it before merge.
function validateContextScheduleEntry(entry, entryPath, index, identity, errors) {
  const { providerIds, treatmentIds, taskIds, noiseRepetitions } = identity;
  const noise = noiseRepetitions > 0;
  const fields = ['sequence', 'task_id', 'trial_index', 'provider_id', 'order'];
  const allowed = noise ? [...fields, 'comparison', 'arm'] : fields;
  if (!closedObject(entry, entryPath, allowed, noise ? allowed : fields, errors)) return null;

  integer(entry.sequence, `${entryPath}.sequence`, errors, 1, 1000);
  if (entry.sequence !== index + 1) {
    errors.push(`${entryPath}.sequence: schedule must be contiguous`);
  }
  id(entry.task_id, `${entryPath}.task_id`, errors);
  integer(entry.trial_index, `${entryPath}.trial_index`, errors, 1, 5);
  id(entry.provider_id, `${entryPath}.provider_id`, errors);
  integer(entry.order, `${entryPath}.order`, errors, 1, 4);
  if (!taskIds.includes(entry.task_id)) errors.push(`${entryPath}.task_id: task is not declared`);
  if (!providerIds.includes(entry.provider_id)) {
    errors.push(`${entryPath}.provider_id: provider is not declared`);
  }

  if (noise) {
    oneOf(entry.comparison, ['ab', 'aa'], `${entryPath}.comparison`, errors);
    validateContextScheduleArm(entry, entryPath, treatmentIds, errors);
  }
  const comparison = noise ? entry.comparison : 'ab';
  // An A/A arm compares one treatment against itself, so a control provider there
  // would silently turn a noise measurement into a second A/B comparison.
  if (comparison === 'aa' && !treatmentIds.includes(entry.provider_id)) {
    errors.push(`${entryPath}.provider_id: A/A arms compare one treatment against itself`);
  }
  return comparison;
}

function scheduleKeys(entry, comparison) {
  return comparison === 'aa'
    ? {
        key: `aa:${entry.provider_id}:${entry.task_id}:${entry.trial_index}:${entry.arm}`,
        group: `aa:${entry.provider_id}:${entry.task_id}:${entry.trial_index}`,
      }
    : {
        key: `ab:${entry.task_id}:${entry.trial_index}:${entry.provider_id}`,
        group: `ab:${entry.task_id}:${entry.trial_index}`,
      };
}

function validateContextScheduleTotals({ path, identity, tallies, ordersByGroup, errors }) {
  const { providerIds, treatmentIds, taskIds, repetitions, noiseRepetitions } = identity;
  const expectedAb = taskIds.length * repetitions * providerIds.length;
  const expectedAa = treatmentIds.length * taskIds.length * noiseRepetitions * 2;
  if (tallies.ab !== expectedAb) {
    errors.push(`${path}: expected ${expectedAb} scheduled A/B attempts`);
  }
  if (tallies.aa !== expectedAa) {
    errors.push(`${path}: expected ${expectedAa} scheduled A/A attempts`);
  }
  const expectedAbOrders = Array.from({ length: providerIds.length }, (_, index) => index + 1);
  for (const [groupKey, orders] of ordersByGroup) {
    const expectedOrders = groupKey.startsWith('aa:') ? [1, 2] : expectedAbOrders;
    if (JSON.stringify([...orders].sort()) !== JSON.stringify(expectedOrders)) {
      errors.push(`${path}: ${groupKey} must use each arm order exactly once`);
    }
  }
}

function validateContextSchedule(value, path, errors, identity) {
  array(value, path, errors, { max: 1000 });
  if (!Array.isArray(value)) return;

  const keys = [];
  const ordersByGroup = new Map();
  const tallies = { ab: 0, aa: 0 };

  for (const [index, entry] of value.entries()) {
    const entryPath = `${path}[${index}]`;
    const comparison = validateContextScheduleEntry(entry, entryPath, index, identity, errors);
    if (comparison === null) continue;

    tallies[comparison === 'aa' ? 'aa' : 'ab'] += 1;
    const { key, group } = scheduleKeys(entry, comparison);
    keys.push(key);
    ordersByGroup.set(group, [...(ordersByGroup.get(group) ?? []), entry.order]);
  }

  unique(keys, `${path} comparison task trial arm`, errors);
  validateContextScheduleTotals({ path, identity, tallies, ordersByGroup, errors });
}

function validateContextScheduleArm(entry, path, treatmentIds, errors) {
  if (entry.comparison === 'aa') {
    oneOf(entry.arm, ['a', 'b'], `${path}.arm`, errors);
    return;
  }
  oneOf(entry.arm, ['control', 'treatment'], `${path}.arm`, errors);
  const expected = treatmentIds.includes(entry.provider_id) ? 'treatment' : 'control';
  if (entry.arm !== expected) errors.push(`${path}.arm: does not match the provider role`);
}

function validateContextCounts(value, path, plan, errors) {
  const fields = ['providers', 'tasks', 'repetitions', 'attempts'];
  const noise = (plan.aa_repetitions ?? 0) > 0;
  const noiseFields = ['ab_attempts', 'aa_attempts'];
  const allowed = noise ? [...fields, ...noiseFields] : fields;
  if (!closedObject(value, path, allowed, allowed, errors)) return;
  const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
  const expected = {
    providers: plan.providers?.length,
    tasks: plan.tasks?.length,
    repetitions: plan.repetitions,
    attempts: schedule.length,
    ...(noise
      ? {
          ab_attempts: schedule.filter((entry) => entry?.comparison !== 'aa').length,
          aa_attempts: schedule.filter((entry) => entry?.comparison === 'aa').length,
        }
      : {}),
  };
  for (const field of allowed) {
    const max = field === 'providers' || field === 'tasks' || field === 'repetitions' ? 50 : 1000;
    integer(value[field], `${path}.${field}`, errors, 0, max);
    if (value[field] !== expected[field])
      errors.push(`${path}.${field}: does not match plan contents`);
  }
}

function validateContextCost(value, path, errors) {
  const fields = ['posture', 'context_max_usd', 'agent_max_usd', 'total_max_usd'];
  if (!closedObject(value, path, fields, fields, errors)) return;
  oneOf(value.posture, ['free', 'paid', 'unknown'], `${path}.posture`, errors);
  finiteNumber(value.context_max_usd, `${path}.context_max_usd`, errors, 0, 100_000);
  for (const field of ['agent_max_usd', 'total_max_usd']) {
    if (value[field] !== null) finiteNumber(value[field], `${path}.${field}`, errors, 0, 100_000);
  }
}

function validateContextCostDerivation(plan, path, errors) {
  if (!plan.cost || !Array.isArray(plan.providers) || !Array.isArray(plan.schedule)) return;
  const perAttempt = (providers) =>
    providers.reduce(
      (total, provider) =>
        total + (Number.isFinite(provider?.max_usd_per_attempt) ? provider.max_usd_per_attempt : 0),
      0
    );
  const taskCount = plan.tasks?.length ?? 0;
  const contextMax = roundContextCost(
    perAttempt(plan.providers) * taskCount * (plan.repetitions ?? 0) +
      perAttempt(plan.providers.filter((provider) => provider?.role === 'treatment')) *
        taskCount *
        (plan.aa_repetitions ?? 0) *
        2
  );
  const agentMax =
    plan.agent_profile?.status === 'selected' &&
    Number.isFinite(plan.agent_profile?.max_usd_per_attempt)
      ? roundContextCost(plan.agent_profile.max_usd_per_attempt * plan.schedule.length)
      : null;
  const unknown =
    plan.agent_profile?.cost_posture === 'unknown' ||
    plan.providers.some((provider) => provider?.cost_posture === 'unknown');
  const paid =
    plan.agent_profile?.cost_posture === 'paid' ||
    plan.providers.some((provider) => provider?.cost_posture === 'paid');
  const posture = unknown ? 'unknown' : paid ? 'paid' : 'free';
  const totalMax = agentMax === null ? null : roundContextCost(contextMax + agentMax);
  for (const [field, expected] of Object.entries({
    posture,
    context_max_usd: contextMax,
    agent_max_usd: agentMax,
    total_max_usd: totalMax,
  })) {
    if (plan.cost[field] !== expected)
      errors.push(`${path}.cost.${field}: does not match plan inputs`);
  }
}

function roundContextCost(value) {
  if (value === 0) return 0;
  return Math.ceil(value * 1_000_000) / 1_000_000;
}

function validateContextApprovals(value, path, plan, errors) {
  const fields = [
    'approval_id',
    'execution_required',
    'paid_required',
    'hosted_required',
    'data_egress_required',
  ];
  if (!closedObject(value, path, fields, fields, errors)) return;
  id(value.approval_id, `${path}.approval_id`, errors);
  exact(value.execution_required, true, `${path}.execution_required`, errors);
  for (const field of ['paid_required', 'hosted_required', 'data_egress_required'])
    boolean(value[field], `${path}.${field}`, errors);
  const paid =
    plan.agent_profile?.cost_posture !== 'free' ||
    plan.providers?.some((provider) => provider?.cost_posture !== 'free');
  const hosted = plan.providers?.some((provider) => provider?.operating_mode !== 'local');
  const egress = plan.providers?.some((provider) => provider?.data_egress !== 'none');
  if (value.paid_required !== paid)
    errors.push(`${path}.paid_required: must match conservative cost posture`);
  if (value.hosted_required !== hosted)
    errors.push(`${path}.hosted_required: must match provider operating modes`);
  if (value.data_egress_required !== egress)
    errors.push(`${path}.data_egress_required: must match provider egress posture`);
}

function validateContextProviderComparison(value, path, errors) {
  const fields = [
    'schema_version',
    'comparison_id',
    'plan_sha256',
    'scorer_sha256',
    'status',
    'providers',
    'missing_arms',
    'limitations',
  ];
  if (!closedObject(value, path, fields, fields, errors)) return;
  exact(
    value.schema_version,
    CONTRACT_SCHEMA_VERSIONS['context-provider-comparison'],
    `${path}.schema_version`,
    errors
  );
  id(value.comparison_id, `${path}.comparison_id`, errors);
  sha256(value.plan_sha256, `${path}.plan_sha256`, errors);
  sha256(value.scorer_sha256, `${path}.scorer_sha256`, errors);
  oneOf(value.status, ['descriptive', 'qualified', 'invalid'], `${path}.status`, errors);
  array(value.providers, `${path}.providers`, errors, { max: 3 });
  const providerIds = [];
  for (const [index, provider] of (Array.isArray(value.providers)
    ? value.providers
    : []
  ).entries()) {
    const providerPath = `${path}.providers[${index}]`;
    if (!validateContextComparisonProvider(provider, providerPath, errors)) continue;
    if (typeof provider.provider_id === 'string') providerIds.push(provider.provider_id);
  }
  unique(providerIds, `${path}.providers provider_id`, errors);
  sorted(providerIds, `${path}.providers`, errors);
  stringArray(value.missing_arms, `${path}.missing_arms`, errors, { max: 1000, itemMax: 200 });
  unique(value.missing_arms, `${path}.missing_arms`, errors);
  sorted(value.missing_arms, `${path}.missing_arms`, errors);
  stringArray(value.limitations, `${path}.limitations`, errors, { max: 50, itemMax: 500 });
}

function validateContextComparisonProvider(provider, path, errors) {
  const fields = [
    'provider_id',
    'provider_version',
    'configuration_sha256',
    'context_kind',
    'snapshots',
    'allowed_tools',
    'pairwise_score',
    'pairwise_bundle',
    'scheduled_attempts',
    'complete_attempts',
    'outcomes',
    'noise',
    'diagnostics_available',
    'raw_p_value',
    'adjusted_p_value',
    'pairwise_qualified',
    'family_qualified',
  ];
  if (!closedObject(provider, path, fields, fields, errors)) return false;
  id(provider.provider_id, `${path}.provider_id`, errors);
  boundedString(provider.provider_version, `${path}.provider_version`, errors, 1, 120);
  sha256(provider.configuration_sha256, `${path}.configuration_sha256`, errors);
  oneOf(
    provider.context_kind,
    ['graph', 'search', 'wiki-rag', 'hybrid'],
    `${path}.context_kind`,
    errors
  );
  array(provider.snapshots, `${path}.snapshots`, errors, { min: 1, max: CORPUS_LIMITS.maxTasks });
  const snapshotTaskIds = [];
  for (const [index, snapshot] of (Array.isArray(provider.snapshots)
    ? provider.snapshots
    : []
  ).entries()) {
    validateContextSnapshot(snapshot, `${path}.snapshots[${index}]`, errors);
    if (snapshot?.status !== 'ready') {
      errors.push(`${path}.snapshots[${index}]: comparison snapshots must be ready`);
    }
    if (typeof snapshot?.task_id === 'string') snapshotTaskIds.push(snapshot.task_id);
  }
  unique(snapshotTaskIds, `${path}.snapshots task_id`, errors);
  sorted(snapshotTaskIds, `${path}.snapshots`, errors);
  stringArray(provider.allowed_tools, `${path}.allowed_tools`, errors, { max: 100, itemMax: 80 });
  validateUniqueSorted(provider.allowed_tools, `${path}.allowed_tools`, errors);
  artifact(provider.pairwise_score, `${path}.pairwise_score`, errors);
  artifact(provider.pairwise_bundle, `${path}.pairwise_bundle`, errors);
  integer(provider.scheduled_attempts, `${path}.scheduled_attempts`, errors, 1, 1000);
  integer(provider.complete_attempts, `${path}.complete_attempts`, errors, 0, 1000);
  if (provider.complete_attempts > provider.scheduled_attempts) {
    errors.push(`${path}.complete_attempts: cannot exceed scheduled attempts`);
  }
  validateContextProviderOutcomes(provider.outcomes, `${path}.outcomes`, errors);
  validateContextProviderNoise(provider.noise, `${path}.noise`, errors);
  stringArray(provider.diagnostics_available, `${path}.diagnostics_available`, errors, {
    max: 20,
    itemMax: 80,
  });
  validateUniqueSorted(provider.diagnostics_available, `${path}.diagnostics_available`, errors);
  validateNullableProbability(provider.raw_p_value, `${path}.raw_p_value`, errors);
  validateNullableProbability(provider.adjusted_p_value, `${path}.adjusted_p_value`, errors);
  boolean(provider.pairwise_qualified, `${path}.pairwise_qualified`, errors);
  boolean(provider.family_qualified, `${path}.family_qualified`, errors);
  if (provider.family_qualified && !provider.pairwise_qualified) {
    errors.push(`${path}.family_qualified: requires pairwise qualification`);
  }
  if (provider.family_qualified && (provider.noise?.complete_pairs ?? 0) === 0) {
    errors.push(`${path}.family_qualified: requires independent A/A noise evidence`);
  }
  return true;
}

function validateContextProviderNoise(value, path, errors) {
  const fields = [
    'scheduled_attempts',
    'complete_attempts',
    'complete_pairs',
    'discordant_pairs',
    'discordance_rate',
  ];
  if (!closedObject(value, path, fields, fields, errors)) return;
  for (const field of ['scheduled_attempts', 'complete_attempts'])
    integer(value[field], `${path}.${field}`, errors, 0, 1000);
  for (const field of ['complete_pairs', 'discordant_pairs'])
    integer(value[field], `${path}.${field}`, errors, 0, 5000);
  finiteNumber(value.discordance_rate, `${path}.discordance_rate`, errors, 0, 1);
  if (value.complete_attempts > value.scheduled_attempts) {
    errors.push(`${path}.complete_attempts: cannot exceed scheduled A/A attempts`);
  }
  if (value.discordant_pairs > value.complete_pairs) {
    errors.push(`${path}.discordant_pairs: cannot exceed complete A/A pairs`);
  }
}

function validateUniqueSorted(value, path, errors) {
  if (!Array.isArray(value)) return;
  unique(value, path, errors);
  sorted(value, path, errors);
}

function validateNullableProbability(value, path, errors) {
  if (value !== null) finiteNumber(value, path, errors, 0, 1);
}

function validateContextProviderOutcomes(value, path, errors) {
  const fields = [
    'complete_pairs',
    'control_successes',
    'treatment_successes',
    'treatment_wins',
    'control_wins',
    'ties',
    'success_rate_delta',
    'regression_delta',
  ];
  if (!closedObject(value, path, fields, fields, errors)) return;
  for (const field of fields.slice(0, 6))
    integer(value[field], `${path}.${field}`, errors, 0, 5000);
  finiteNumber(value.success_rate_delta, `${path}.success_rate_delta`, errors, -1, 1);
  integer(value.regression_delta, `${path}.regression_delta`, errors, -5000, 5000);
}

function validatePrivacySafeDocument(value, path, errors) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      validatePrivacySafeDocument(item, `${path}[${index}]`, errors);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value))
      validatePrivacySafeDocument(item, `${path}.${key}`, errors);
    return;
  }
  if (typeof value !== 'string') return;
  const unsafePatterns = [
    [/^(?:\/Users\/|\/home\/|[A-Za-z]:\\|\\\\)/, 'absolute path'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
    [/(?:^|[^A-Za-z0-9])(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}/, 'credential'],
    [/AKIA[0-9A-Z]{16}/, 'credential'],
    [/\bBearer\s+[A-Za-z0-9._~-]{12,}/i, 'credential'],
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'provider account identifier'],
  ];
  for (const [pattern, label] of unsafePatterns) {
    if (pattern.test(value)) errors.push(`${path}: ${label} is not allowed`);
  }
  if (value.includes('\n')) errors.push(`${path}: multiline or raw source content is not allowed`);
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

function snapshotId(value, path, errors) {
  stringPattern(value, SNAPSHOT_ID_PATTERN, path, errors, 200);
}

function sha256(value, path, errors) {
  stringPattern(value, SHA256_PATTERN, path, errors, 64);
}

function revision(value, path, errors) {
  stringPattern(value, REVISION_PATTERN, path, errors, 64);
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
  'adapter-diagnostics': validateAdapterDiagnostics,
  'agent-adapter': validateAgentAdapter,
  'check-result': validateCheckResult,
  'context-provider-comparison': validateContextProviderComparison,
  'context-provider-plan': validateContextProviderPlan,
  'context-provider-probe': validateContextProviderProbe,
  'corpus-index': validateCorpusIndex,
  'evaluation-bundle': validateEvaluationBundle,
  'evaluation-score': validateEvaluationScore,
  'fixture-bundle': validateFixtureBundle,
  'known-good-change': validateKnownGoodChange,
  'qualification-receipt': validateQualificationReceipt,
  'run-plan': validateRunPlan,
  'run-receipt': validateRunReceipt,
  'task-manifest': validateTaskManifest,
});
