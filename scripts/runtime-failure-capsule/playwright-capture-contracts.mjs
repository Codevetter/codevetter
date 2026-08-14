import { boundedTimeout } from './contracts.mjs';
import {
  BROWSER_SERVER_FLOW_LEGACY_SCHEMA_VERSIONS,
  BROWSER_SERVER_FLOW_SCHEMA_VERSION,
  assertBrowserServerFlowSummary,
} from './browser-server-flow.mjs';
import { validateLocalServerAttestation } from './local-server-attestation-contracts.mjs';

export const PLAYWRIGHT_CAPTURE_SCHEMA_VERSION = 'runtime-playwright-capture/v5';
export const PLAYWRIGHT_CAPTURE_LIMITS = Object.freeze({
  captureIdCharacters: 80,
  receipts: 128,
  receiptBytes: 256 * 1024,
  resultBytes: 2 * 1024 * 1024,
  zipBytes: 16 * 1024 * 1024,
  traceBytes: 16 * 1024 * 1024,
  zipEntries: 2_048,
  traceEntries: 8,
  serverProbeMs: 750,
});

const STATES = new Set(['succeeded', 'failed', 'local_server_required']);
const ALLOWED_CAPTURE_SAFETY_FLAGS = new Set([
  'browser_signal',
  'integration_scope',
  'local_service_signal',
]);

export function assertPlaywrightCaptureId(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > PLAYWRIGHT_CAPTURE_LIMITS.captureIdCharacters ||
    !/^[a-z0-9][a-z0-9-]*$/.test(value)
  ) {
    throw new Error('browser capture ID must use lowercase letters, digits, and hyphens');
  }
  return value;
}

export function assertLoopbackBaseUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.port && (Number(url.port) < 1 || Number(url.port) > 65_535))
    ) {
      throw new Error('invalid');
    }
    return url.href.replace(/\/$/, '');
  } catch {
    throw new Error('browser capture requires a static loopback HTTP base URL');
  }
}

export function assertPlaywrightCaptureReceipt(value) {
  const errors = validatePlaywrightCaptureReceipt(value);
  if (errors.length > 0) throw new Error(`invalid browser capture receipt: ${errors.join('; ')}`);
  return value;
}

export function validatePlaywrightCaptureReceipt(value) {
  const errors = [];
  if (!plainObject(value)) return ['receipt must be an object'];
  closed(
    value,
    [
      'schema_version',
      'capture_id',
      'state',
      'subject',
      'execution_source',
      'scope',
      'policy',
      'lifecycle',
      'execution',
      'server_attestation',
      'diagnosis',
      'result',
      'failure',
      'limitations',
    ],
    'receipt',
    errors
  );
  if (value.schema_version !== PLAYWRIGHT_CAPTURE_SCHEMA_VERSION) {
    errors.push('schema_version is invalid');
  }
  try {
    assertPlaywrightCaptureId(value.capture_id);
  } catch (error) {
    errors.push(error.message);
  }
  if (!STATES.has(value.state)) errors.push('state is invalid');
  if (
    !plainObject(value.subject) ||
    typeof value.subject.repository_revision !== 'string' ||
    typeof value.subject.dirty !== 'boolean'
  ) {
    errors.push('subject is invalid');
  }
  if (
    value.subject?.source_snapshot_sha256 !== undefined &&
    !/^[0-9a-f]{64}$/.test(value.subject.source_snapshot_sha256 ?? '')
  ) {
    errors.push('subject.source_snapshot_sha256 is invalid');
  }
  validateExecutionSource(value.execution_source, errors);
  validateScope(value.scope, errors);
  if (!plainObject(value.policy)) errors.push('policy is invalid');
  else {
    closed(
      value.policy,
      [
        'timeout_ms',
        'workers',
        'retries',
        'remote_http_denied',
        'server_identity',
        'runtime_configuration',
      ],
      'policy',
      errors
    );
    try {
      boundedTimeout(value.policy.timeout_ms);
    } catch (error) {
      errors.push(error.message);
    }
    if (value.policy.workers !== 1 || value.policy.retries !== 0) {
      errors.push('policy execution bounds are invalid');
    }
    if (value.policy.remote_http_denied !== true) {
      errors.push('policy.remote_http_denied must be true');
    }
    if (!['unverified', 'verified_by_declared_process'].includes(value.policy.server_identity)) {
      errors.push('policy.server_identity is invalid');
    }
    if (
      value.policy.runtime_configuration !== undefined &&
      !['codevetter_config_disabled', 'repository_declared', null].includes(
        value.policy.runtime_configuration
      )
    ) {
      errors.push('policy.runtime_configuration is invalid');
    }
  }
  if (
    !plainObject(value.lifecycle) ||
    !validTimestamp(value.lifecycle.started_at) ||
    !validTimestamp(value.lifecycle.completed_at)
  ) {
    errors.push('lifecycle is invalid');
  } else {
    closed(value.lifecycle, ['started_at', 'completed_at'], 'lifecycle', errors);
  }
  if (!plainObject(value.execution)) errors.push('execution is invalid');
  else {
    closed(
      value.execution,
      ['status', 'exit_code', 'duration_ms', 'stdout_bytes', 'stderr_bytes', 'truncated', 'memory'],
      'execution',
      errors
    );
    if (typeof value.execution.status !== 'string') errors.push('execution.status is invalid');
    for (const field of ['duration_ms', 'stdout_bytes', 'stderr_bytes']) {
      if (!Number.isInteger(value.execution[field]) || value.execution[field] < 0) {
        errors.push(`execution.${field} is invalid`);
      }
    }
    if (typeof value.execution.truncated !== 'boolean') {
      errors.push('execution.truncated is invalid');
    }
    validateExecutionMemory(value.execution.memory, errors);
  }
  errors.push(
    ...validateLocalServerAttestation(value.server_attestation).map(
      (error) => `server_attestation.${error}`
    )
  );
  validateDiagnosisSummary(value.diagnosis, errors);
  if (
    value.policy?.server_identity === 'verified_by_declared_process' &&
    value.server_attestation?.state !== 'verified_by_declared_process'
  ) {
    errors.push('verified policy requires verified declared-process attestation');
  }
  if (
    value.server_attestation?.state === 'verified_by_declared_process' &&
    value.policy?.server_identity !== 'verified_by_declared_process'
  ) {
    errors.push('verified declared-process attestation requires matching policy identity');
  }
  validateResult(value.result, value.capture_id, value.state, errors);
  if ((value.result === null) !== (value.diagnosis === null)) {
    errors.push('result and diagnosis must be present together');
  }
  if (
    value.failure !== null &&
    (typeof value.failure !== 'string' || value.failure.length > 2_000)
  ) {
    errors.push('failure is invalid');
  }
  if (
    !Array.isArray(value.limitations) ||
    value.limitations.some((entry) => typeof entry !== 'string')
  ) {
    errors.push('limitations is invalid');
  }
  return errors;
}

function validateExecutionSource(value, errors) {
  if (value === undefined) return;
  if (!plainObject(value)) {
    errors.push('execution_source is invalid');
    return;
  }
  closed(
    value,
    [
      'mode',
      'tree_sha256',
      'files',
      'bytes',
      'excluded_sensitive_path_count',
      'excluded_sensitive_paths_sha256',
      'graft_count',
      'grafts',
      'graft_sha256',
    ],
    'execution_source',
    errors
  );
  if (value.mode !== 'clean_git_snapshot') errors.push('execution_source.mode is invalid');
  if (!/^[0-9a-f]{64}$/.test(value.tree_sha256 ?? '')) {
    errors.push('execution_source.tree_sha256 is invalid');
  }
  if (!Number.isSafeInteger(value.files) || value.files < 1 || value.files > 20_000) {
    errors.push('execution_source.files is invalid');
  }
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > 512 * 1024 * 1024) {
    errors.push('execution_source.bytes is invalid');
  }
  if (
    !Number.isSafeInteger(value.excluded_sensitive_path_count) ||
    value.excluded_sensitive_path_count < 0 ||
    value.excluded_sensitive_path_count > 32
  ) {
    errors.push('execution_source.excluded_sensitive_path_count is invalid');
  }
  if (!/^[0-9a-f]{64}$/.test(value.excluded_sensitive_paths_sha256 ?? '')) {
    errors.push('execution_source.excluded_sensitive_paths_sha256 is invalid');
  }
  if (
    !Number.isSafeInteger(value.graft_count) ||
    value.graft_count < 0 ||
    value.graft_count > 8 ||
    !Array.isArray(value.grafts) ||
    value.grafts.length !== value.graft_count ||
    value.grafts.some((path) => !safeExecutionSourcePath(path)) ||
    JSON.stringify(value.grafts) !== JSON.stringify(value.grafts.toSorted()) ||
    new Set(value.grafts).size !== value.grafts.length
  ) {
    errors.push('execution_source.grafts are invalid');
  }
  if (!/^[0-9a-f]{64}$/.test(value.graft_sha256 ?? '')) {
    errors.push('execution_source.graft_sha256 is invalid');
  }
}

function safeExecutionSourcePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !/[\0\r\n]/.test(value) &&
    value.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

function validateExecutionMemory(value, errors) {
  if (value === null) return;
  if (!plainObject(value)) {
    errors.push('execution.memory is invalid');
    return;
  }
  closed(
    value,
    ['peak_rss_bytes', 'samples', 'interval_ms', 'provenance'],
    'execution.memory',
    errors
  );
  if (!Number.isInteger(value.peak_rss_bytes) || value.peak_rss_bytes < 1) {
    errors.push('execution.memory.peak_rss_bytes is invalid');
  }
  if (!Number.isInteger(value.samples) || value.samples < 1) {
    errors.push('execution.memory.samples is invalid');
  }
  if (!Number.isInteger(value.interval_ms) || value.interval_ms < 1) {
    errors.push('execution.memory.interval_ms is invalid');
  }
  if (value.provenance !== 'local_process_tree_rss_sampling') {
    errors.push('execution.memory.provenance is invalid');
  }
}

export function compactPlaywrightDiagnosis(value) {
  const findings = value?.tool_diagnosis?.findings;
  const verdict = value?.tool_diagnosis?.verdict?.status;
  if (!Array.isArray(findings) || !['findings', 'no_findings', 'no_confidence'].includes(verdict)) {
    throw new Error('normalized Playwright diagnosis is invalid');
  }
  const summary = {
    verdict,
    finding_count: findings.length,
    finding_ids: findings.map((finding) => finding.id).toSorted(),
    eligible_experiment_findings: findings.filter(
      (finding) => finding.eligible_for_experiment === true
    ).length,
    page_load: compactPageLoadSummary(value),
    main_thread: compactMainThreadSummary(value),
    memory: compactMemorySummary(value),
    react: compactReactSummary(value?.react),
    loading: compactLoadingSummary(value?.loading),
    actions: compactActionSummary(value?.actions),
    server: compactServerSummary(value?.server),
    next_probe: compactNextProbe(findings),
  };
  const errors = [];
  validateDiagnosisSummary(summary, errors);
  if (errors.length > 0) throw new Error(`invalid browser diagnosis summary: ${errors.join('; ')}`);
  return summary;
}

function validateDiagnosisSummary(value, errors) {
  if (value === null) return;
  if (!plainObject(value)) {
    errors.push('diagnosis is invalid');
    return;
  }
  closed(
    value,
    [
      'verdict',
      'finding_count',
      'finding_ids',
      'eligible_experiment_findings',
      'page_load',
      'main_thread',
      'memory',
      'react',
      'loading',
      'actions',
      'server',
      'next_probe',
    ],
    'diagnosis',
    errors
  );
  if (!['findings', 'no_findings', 'no_confidence'].includes(value.verdict)) {
    errors.push('diagnosis.verdict is invalid');
  }
  if (
    !Number.isInteger(value.finding_count) ||
    value.finding_count < 0 ||
    value.finding_count > 32
  ) {
    errors.push('diagnosis.finding_count is invalid');
  }
  if (
    !Array.isArray(value.finding_ids) ||
    value.finding_ids.length !== value.finding_count ||
    value.finding_ids.some((id) => !/^[0-9a-f]{24}$/.test(id)) ||
    new Set(value.finding_ids).size !== value.finding_ids.length ||
    value.finding_ids.some((id, index) => index > 0 && value.finding_ids[index - 1] > id)
  ) {
    errors.push('diagnosis.finding_ids is invalid');
  }
  if (
    !Number.isInteger(value.eligible_experiment_findings) ||
    value.eligible_experiment_findings < 0 ||
    value.eligible_experiment_findings > value.finding_count
  ) {
    errors.push('diagnosis.eligible_experiment_findings is invalid');
  }
  validateMemorySummary(value.memory, errors);
  if (
    value.page_load !== null &&
    (!plainObject(value.page_load) ||
      !Number.isFinite(value.page_load.largest_contentful_paint_ms) ||
      value.page_load.largest_contentful_paint_ms < 0 ||
      value.page_load.provenance !== 'chromium_outer_main_frame_lcp_candidate')
  ) {
    errors.push('diagnosis.page_load is invalid');
  }
  validateMainThreadSummary(value.main_thread, errors);
  validateReactSummary(value.react, errors);
  validateLoadingSummary(value.loading, errors);
  validateActionSummary(value.actions, errors);
  validateServerSummary(value.server, errors);
  validateNextProbe(value.next_probe, errors);
}

function compactNextProbe(findings) {
  const finding = findings.find(
    (candidate) => candidate.detector === 'browser_server_precommit_probe_route'
  );
  if (!finding) return null;
  return {
    classification: finding.observed.classification,
    probe: finding.observed.next_probe,
    server_request_ordinal: finding.observed.server_request_ordinal,
    confidence: finding.confidence.level,
    edit_eligible: finding.eligible_for_experiment,
    required_observation: finding.verification.required_observation,
    evidence_ids: finding.evidence_ids,
    failed_flow_requires_correctness: true,
  };
}

function validateNextProbe(value, errors) {
  if (value === null) return;
  if (plainObject(value)) {
    closed(
      value,
      [
        'classification',
        'probe',
        'server_request_ordinal',
        'confidence',
        'edit_eligible',
        'required_observation',
        'evidence_ids',
        'failed_flow_requires_correctness',
      ],
      'diagnosis.next_probe',
      errors
    );
  }
  if (
    !plainObject(value) ||
    typeof value.classification !== 'string' ||
    value.classification.length === 0 ||
    typeof value.probe !== 'string' ||
    value.probe.length === 0 ||
    !Number.isSafeInteger(value.server_request_ordinal) ||
    value.server_request_ordinal < 1 ||
    value.server_request_ordinal > 128 ||
    value.confidence !== 'low' ||
    value.edit_eligible !== false ||
    typeof value.required_observation !== 'string' ||
    !Array.isArray(value.evidence_ids) ||
    value.evidence_ids.length < 1 ||
    value.evidence_ids.length > 8 ||
    value.evidence_ids.some((entry) => typeof entry !== 'string') ||
    value.failed_flow_requires_correctness !== true
  ) {
    errors.push('diagnosis.next_probe is invalid');
  }
}

function compactServerSummary(value) {
  if (value === null || value === undefined) return null;
  return {
    state: value.state,
    reason: value.reason,
    inventory: value.inventory,
    requests: value.requests,
    preflight_comparison: value.preflight_comparison,
    provenance: value.provenance,
  };
}

function validateServerSummary(value, errors) {
  if (value === null || value === undefined) return;
  if (!plainObject(value)) {
    errors.push('diagnosis.server is invalid');
    return;
  }
  closed(
    value,
    ['state', 'reason', 'inventory', 'requests', 'preflight_comparison', 'provenance'],
    'diagnosis.server',
    errors
  );
  try {
    const schema = value.requests?.every((request) => Object.hasOwn(request, 'continuous_source'))
      ? BROWSER_SERVER_FLOW_SCHEMA_VERSION
      : BROWSER_SERVER_FLOW_LEGACY_SCHEMA_VERSIONS.at(-1);
    assertBrowserServerFlowSummary({
      schema_version: schema,
      ...value,
      limitations: [],
    });
  } catch {
    errors.push('diagnosis.server is invalid');
  }
}

function compactActionSummary(value) {
  if (value === null || value === undefined) return null;
  return {
    state: value.state,
    inventory: value.inventory,
    sequence: value.sequence,
    slowest: value.slowest,
    provenance: value.provenance,
  };
}

function validateActionSummary(value, errors) {
  if (value === null || value === undefined) return;
  if (!plainObject(value)) {
    errors.push('diagnosis.actions is invalid');
    return;
  }
  closed(
    value,
    ['state', 'inventory', 'sequence', 'slowest', 'provenance'],
    'diagnosis.actions',
    errors
  );
  const inventory = value.inventory;
  if (
    !['observed', 'unavailable'].includes(value.state) ||
    !plainObject(inventory) ||
    !Number.isSafeInteger(inventory.started_action_count) ||
    inventory.started_action_count < 0 ||
    !Number.isSafeInteger(inventory.completed_action_count) ||
    inventory.completed_action_count < 0 ||
    inventory.completed_action_count > inventory.started_action_count ||
    !Number.isSafeInteger(inventory.observed_completed_action_count) ||
    inventory.observed_completed_action_count < 0 ||
    inventory.observed_completed_action_count > inventory.completed_action_count ||
    typeof inventory.complete !== 'boolean' ||
    typeof inventory.sampled !== 'boolean' ||
    !Array.isArray(value.sequence) ||
    value.sequence.length > 16 ||
    !Array.isArray(value.slowest) ||
    value.slowest.length > 8 ||
    value.sequence.some((action) => !validCompactAction(action)) ||
    value.slowest.some((action) => !validCompactAction(action)) ||
    value.provenance !== 'bounded_playwright_trace_actions'
  ) {
    errors.push('diagnosis.actions is invalid');
    return;
  }
  closed(
    inventory,
    [
      'started_action_count',
      'completed_action_count',
      'observed_completed_action_count',
      'complete',
      'sampled',
    ],
    'diagnosis.actions.inventory',
    errors
  );
}

function validCompactAction(value) {
  if (!plainObject(value)) return false;
  const fields = [
    'ordinal',
    'name',
    'category',
    'state',
    'started_at_ms',
    'duration_ms',
    'resources_started',
    'completed_responses',
    'failed_or_aborted_resources',
    'completed_response_transfer_bytes',
    'largest_resources',
    'overlapping_long_tasks',
    'overlapping_long_task_ms',
  ];
  return (
    Object.keys(value).every((key) => fields.includes(key)) &&
    Number.isSafeInteger(value.ordinal) &&
    value.ordinal > 0 &&
    /^(?:apiRequest|browserContext|elementHandle|frame|keyboard|locator|mouse|page|touchscreen)\.[A-Za-z][A-Za-z0-9]{0,63}$/.test(
      value.name
    ) &&
    [
      'navigation',
      'interaction',
      'input',
      'wait',
      'assertion',
      'evaluation',
      'setup',
      'observation',
      'other',
    ].includes(value.category) &&
    ['succeeded', 'failed'].includes(value.state) &&
    Number.isFinite(value.started_at_ms) &&
    value.started_at_ms >= 0 &&
    Number.isFinite(value.duration_ms) &&
    value.duration_ms >= 0 &&
    Number.isSafeInteger(value.resources_started) &&
    value.resources_started >= 0 &&
    Number.isSafeInteger(value.completed_responses) &&
    value.completed_responses >= 0 &&
    Number.isSafeInteger(value.failed_or_aborted_resources) &&
    value.failed_or_aborted_resources >= 0 &&
    value.completed_responses + value.failed_or_aborted_resources === value.resources_started &&
    nullableNonnegativeInteger(value.completed_response_transfer_bytes) &&
    Array.isArray(value.largest_resources) &&
    value.largest_resources.length <= 3 &&
    value.largest_resources.every(validCompactActionResource) &&
    Number.isSafeInteger(value.overlapping_long_tasks) &&
    value.overlapping_long_tasks >= 0 &&
    Number.isFinite(value.overlapping_long_task_ms) &&
    value.overlapping_long_task_ms >= 0
  );
}

function validCompactActionResource(value) {
  if (!plainObject(value)) return false;
  return (
    Object.keys(value).every((key) =>
      ['route', 'network_scope', 'resource_type', 'status', 'transfer_bytes', 'source'].includes(
        key
      )
    ) &&
    safeRoute(value.route) &&
    ['loopback', 'relative', 'remote', 'invalid'].includes(value.network_scope) &&
    safeResourceType(value.resource_type) &&
    (value.status === null || Number.isSafeInteger(value.status)) &&
    Number.isSafeInteger(value.transfer_bytes) &&
    value.transfer_bytes >= 0 &&
    validLoadingSource(value.source)
  );
}

function compactLoadingSummary(value) {
  if (value === null || value === undefined) return null;
  return {
    state: value.state,
    inventory: value.inventory,
    complete_transfer_bytes: value.complete_transfer_bytes,
    observed_transfer_bytes: value.observed_transfer_bytes,
    completed_responses: value.completed_responses,
    failed_or_aborted: value.failed_or_aborted,
    repository_modules: value.repository_modules,
    categories: value.categories.slice(0, 8),
    largest_resources: value.largest_resources.slice(0, 8),
    initiator_graph: value.initiator_graph,
    provenance: value.provenance,
  };
}

function validateLoadingSummary(value, errors) {
  if (value === null || value === undefined) return;
  if (!plainObject(value)) {
    errors.push('diagnosis.loading is invalid');
    return;
  }
  closed(
    value,
    [
      'state',
      'inventory',
      'complete_transfer_bytes',
      'observed_transfer_bytes',
      'completed_responses',
      'failed_or_aborted',
      'repository_modules',
      'categories',
      'largest_resources',
      'initiator_graph',
      'provenance',
    ],
    'diagnosis.loading',
    errors
  );
  const inventory = value.inventory;
  if (
    !['observed', 'unavailable'].includes(value.state) ||
    !plainObject(inventory) ||
    !Number.isSafeInteger(inventory.trace_resource_count) ||
    inventory.trace_resource_count < 0 ||
    !Number.isSafeInteger(inventory.observed_resource_count) ||
    inventory.observed_resource_count < 0 ||
    inventory.observed_resource_count > inventory.trace_resource_count ||
    !Number.isSafeInteger(inventory.resources_with_transfer_size) ||
    inventory.resources_with_transfer_size < 0 ||
    inventory.resources_with_transfer_size > inventory.observed_resource_count ||
    typeof inventory.complete !== 'boolean' ||
    !nullableNonnegativeInteger(value.complete_transfer_bytes) ||
    !Number.isSafeInteger(value.observed_transfer_bytes) ||
    value.observed_transfer_bytes < 0 ||
    !Array.isArray(value.categories) ||
    value.categories.length > 8 ||
    !Array.isArray(value.largest_resources) ||
    value.largest_resources.length > 8 ||
    value.initiator_graph !== 'unavailable' ||
    value.provenance !== 'bounded_playwright_har_resource_snapshots' ||
    inventory.complete !== (value.complete_transfer_bytes !== null)
  ) {
    errors.push('diagnosis.loading is invalid');
    return;
  }
  closed(
    inventory,
    ['trace_resource_count', 'observed_resource_count', 'resources_with_transfer_size', 'complete'],
    'diagnosis.loading.inventory',
    errors
  );
  const completed = value.completed_responses;
  if (
    !plainObject(completed) ||
    !Number.isSafeInteger(completed.count) ||
    completed.count < 0 ||
    completed.count > inventory.observed_resource_count ||
    !Number.isSafeInteger(completed.resources_with_transfer_size) ||
    completed.resources_with_transfer_size < 0 ||
    completed.resources_with_transfer_size > completed.count ||
    typeof completed.complete !== 'boolean' ||
    !nullableNonnegativeInteger(completed.complete_transfer_bytes) ||
    !Number.isSafeInteger(completed.observed_transfer_bytes) ||
    completed.observed_transfer_bytes < 0 ||
    completed.complete !== (completed.complete_transfer_bytes !== null)
  ) {
    errors.push('diagnosis.loading.completed_responses is invalid');
  } else {
    closed(
      completed,
      [
        'count',
        'resources_with_transfer_size',
        'complete',
        'complete_transfer_bytes',
        'observed_transfer_bytes',
      ],
      'diagnosis.loading.completed_responses',
      errors
    );
  }
  const failed = value.failed_or_aborted;
  if (
    !plainObject(failed) ||
    !Number.isSafeInteger(failed.count) ||
    failed.count < 0 ||
    failed.count + completed?.count !== inventory.observed_resource_count ||
    !/^[0-9a-f]{64}$/.test(failed.request_identity_sha256 ?? '')
  ) {
    errors.push('diagnosis.loading.failed_or_aborted is invalid');
  } else {
    closed(
      failed,
      ['count', 'request_identity_sha256'],
      'diagnosis.loading.failed_or_aborted',
      errors
    );
  }
  const repositoryModules = value.repository_modules;
  if (
    !plainObject(repositoryModules) ||
    !Number.isSafeInteger(repositoryModules.count) ||
    repositoryModules.count < 0 ||
    repositoryModules.count > inventory.observed_resource_count ||
    !Number.isSafeInteger(repositoryModules.resources_with_transfer_size) ||
    repositoryModules.resources_with_transfer_size < 0 ||
    repositoryModules.resources_with_transfer_size > repositoryModules.count ||
    !Number.isSafeInteger(repositoryModules.observed_transfer_bytes) ||
    repositoryModules.observed_transfer_bytes < 0 ||
    !Array.isArray(repositoryModules.largest) ||
    repositoryModules.largest.length > 8 ||
    repositoryModules.largest.some(
      (resource) =>
        !validLoadingResource(resource) ||
        resource.source?.provenance !== 'exact_local_module_route'
    )
  ) {
    errors.push('diagnosis.loading.repository_modules is invalid');
  } else {
    closed(
      repositoryModules,
      ['count', 'resources_with_transfer_size', 'observed_transfer_bytes', 'largest'],
      'diagnosis.loading.repository_modules',
      errors
    );
  }
  for (const category of value.categories) {
    if (
      !plainObject(category) ||
      !safeResourceType(category.resource_type) ||
      !Number.isSafeInteger(category.count) ||
      category.count < 1 ||
      !Number.isSafeInteger(category.observed_transfer_bytes) ||
      category.observed_transfer_bytes < 0 ||
      !Number.isSafeInteger(category.resources_with_transfer_size) ||
      category.resources_with_transfer_size < 0 ||
      category.resources_with_transfer_size > category.count
    ) {
      errors.push('diagnosis.loading.categories is invalid');
      break;
    }
    closed(
      category,
      ['resource_type', 'count', 'observed_transfer_bytes', 'resources_with_transfer_size'],
      'diagnosis.loading.categories',
      errors
    );
  }
  for (const resource of value.largest_resources) {
    if (!validLoadingResource(resource)) {
      errors.push('diagnosis.loading.largest_resources is invalid');
      break;
    }
  }
}

function validLoadingResource(value) {
  if (!plainObject(value)) return false;
  const fields = [
    'route',
    'network_scope',
    'resource_type',
    'mime_category',
    'transfer_bytes',
    'encoded_body_bytes',
    'decoded_body_bytes',
    'duration_ms',
    'source',
  ];
  if (Object.keys(value).some((key) => !fields.includes(key))) return false;
  return (
    safeRoute(value.route) &&
    ['loopback', 'relative', 'remote', 'invalid'].includes(value.network_scope) &&
    safeResourceType(value.resource_type) &&
    typeof value.mime_category === 'string' &&
    value.mime_category.length > 0 &&
    value.mime_category.length <= 16 &&
    Number.isSafeInteger(value.transfer_bytes) &&
    value.transfer_bytes >= 0 &&
    nullableNonnegativeInteger(value.encoded_body_bytes) &&
    nullableNonnegativeInteger(value.decoded_body_bytes) &&
    Number.isFinite(value.duration_ms) &&
    value.duration_ms >= 0 &&
    validLoadingSource(value.source)
  );
}

function validLoadingSource(value) {
  if (value === null) return true;
  return (
    plainObject(value) &&
    Object.keys(value).every((key) => ['file', 'line', 'function', 'provenance'].includes(key)) &&
    safeRelativePath(value.file) &&
    Number.isSafeInteger(value.line) &&
    value.line > 0 &&
    value.function === null &&
    ['exact_local_module_route', 'static_network_literal'].includes(value.provenance)
  );
}

function safeRoute(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function safeResourceType(value) {
  return [
    'document',
    'stylesheet',
    'image',
    'media',
    'font',
    'script',
    'texttrack',
    'xhr',
    'fetch',
    'eventsource',
    'websocket',
    'manifest',
    'other',
  ].includes(value);
}

function nullableNonnegativeInteger(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function compactReactSummary(value) {
  if (value === null || value === undefined) return null;
  return {
    state: value.state,
    attribution: value.attribution,
    commit_count: value.commit_count,
    profiled_commit_count: value.profiled_commit_count,
    total_actual_duration_ms: value.total_actual_duration_ms,
    max_commit_duration_ms: value.max_commit_duration_ms,
    measurement_complete: value.measurement_complete ?? null,
    presentation_truncated: value.presentation_truncated ?? value.truncated,
    self_duration_provenance: value.self_duration_provenance ?? null,
    source_attribution: value.source_attribution ?? null,
    renderer_versions: value.renderer_versions,
    top_components: value.components.slice(0, 8).map((component) => ({
      name: component.name,
      commits_present: component.commits_present,
      inclusive_actual_duration_ms: component.inclusive_actual_duration_ms,
      self_actual_duration_ms: component.self_actual_duration_ms ?? null,
      ...(component.ownership === undefined
        ? {}
        : { ownership: component.ownership, source: component.source }),
    })),
    delivery: value.delivery ?? null,
    provenance: value.provenance,
  };
}

function validateReactSummary(value, errors) {
  if (value === null || value === undefined) return;
  if (!plainObject(value)) {
    errors.push('diagnosis.react is invalid');
    return;
  }
  closed(
    value,
    [
      'state',
      'attribution',
      'commit_count',
      'profiled_commit_count',
      'total_actual_duration_ms',
      'max_commit_duration_ms',
      'measurement_complete',
      'presentation_truncated',
      'self_duration_provenance',
      'source_attribution',
      'renderer_versions',
      'top_components',
      'delivery',
      'provenance',
    ],
    'diagnosis.react',
    errors
  );
  if (
    !['succeeded', 'not_detected', 'unavailable'].includes(value.state) ||
    !['component_activity_observed', 'commit_only', 'not_detected', 'unavailable'].includes(
      value.attribution
    ) ||
    !Number.isSafeInteger(value.commit_count) ||
    value.commit_count < 0 ||
    !Number.isSafeInteger(value.profiled_commit_count) ||
    value.profiled_commit_count < 0 ||
    value.profiled_commit_count > value.commit_count ||
    !Number.isFinite(value.total_actual_duration_ms) ||
    value.total_actual_duration_ms < 0 ||
    !Number.isFinite(value.max_commit_duration_ms) ||
    value.max_commit_duration_ms < 0 ||
    !(value.measurement_complete === null || typeof value.measurement_complete === 'boolean') ||
    typeof value.presentation_truncated !== 'boolean' ||
    !(
      value.self_duration_provenance === null ||
      value.self_duration_provenance === 'inclusive_minus_direct_child_actual_duration'
    ) ||
    !validReactSourceAttribution(value.source_attribution) ||
    !Array.isArray(value.renderer_versions) ||
    value.renderer_versions.length > 8 ||
    value.renderer_versions.some((entry) => typeof entry !== 'string' || entry.length > 80) ||
    !Array.isArray(value.top_components) ||
    value.top_components.length > 8 ||
    !validReactDelivery(value.delivery) ||
    value.provenance !== 'react_devtools_hook_separate_exact_flow_pass'
  ) {
    errors.push('diagnosis.react is invalid');
    return;
  }
  for (const component of value.top_components) {
    if (
      !plainObject(component) ||
      Object.keys(component).some(
        (key) =>
          ![
            'name',
            'commits_present',
            'inclusive_actual_duration_ms',
            'self_actual_duration_ms',
            'ownership',
            'source',
          ].includes(key)
      ) ||
      typeof component.name !== 'string' ||
      component.name.length < 1 ||
      component.name.length > 120 ||
      !Number.isSafeInteger(component.commits_present) ||
      component.commits_present < 1 ||
      !Number.isFinite(component.inclusive_actual_duration_ms) ||
      component.inclusive_actual_duration_ms < 0 ||
      !(
        component.self_actual_duration_ms === null ||
        (Number.isFinite(component.self_actual_duration_ms) &&
          component.self_actual_duration_ms >= 0)
      ) ||
      (component.ownership !== undefined &&
        !['repository', 'external_or_ambiguous'].includes(component.ownership)) ||
      (component.source !== undefined && !validReactComponentSource(component))
    ) {
      errors.push('diagnosis.react.top_components is invalid');
      break;
    }
  }
}

function validReactSourceAttribution(value) {
  return (
    value === null ||
    (plainObject(value) &&
      Object.keys(value).every((key) =>
        [
          'state',
          'files_scanned',
          'bytes_scanned',
          'file_limit',
          'byte_limit',
          'provenance',
        ].includes(key)
      ) &&
      ['complete', 'partial'].includes(value.state) &&
      Number.isSafeInteger(value.files_scanned) &&
      value.files_scanned >= 0 &&
      Number.isSafeInteger(value.bytes_scanned) &&
      value.bytes_scanned >= 0 &&
      value.file_limit === 512 &&
      value.byte_limit === 4 * 1024 * 1024 &&
      value.provenance === 'bounded_static_component_declaration_scan')
  );
}

function validReactDelivery(value) {
  return (
    value === null ||
    (plainObject(value) &&
      Object.keys(value).every((key) =>
        [
          'binding_state',
          'binding_calls',
          'invalid_payloads',
          'documents_delivered',
          'fallback_pages_evaluated',
          'provenance',
        ].includes(key)
      ) &&
      ['installed', 'unavailable'].includes(value.binding_state) &&
      [
        value.binding_calls,
        value.invalid_payloads,
        value.documents_delivered,
        value.fallback_pages_evaluated,
      ].every((entry) => Number.isSafeInteger(entry) && entry >= 0 && entry <= 256) &&
      value.documents_delivered <= 8 &&
      value.fallback_pages_evaluated <= 8 &&
      value.provenance === 'owned_playwright_page_binding_and_final_page_fallback')
  );
}

function validReactComponentSource(component) {
  if (component.ownership === 'external_or_ambiguous') return component.source === null;
  const source = component.source;
  return (
    component.ownership === 'repository' &&
    plainObject(source) &&
    Object.keys(source).every((key) => ['file', 'line', 'provenance'].includes(key)) &&
    safeRelativePath(source.file) &&
    Number.isSafeInteger(source.line) &&
    source.line > 0 &&
    source.provenance === 'static_unique_react_component_declaration'
  );
}

function compactPageLoadSummary(value) {
  const pageLoad = value?.main_thread?.page_load;
  if (!Number.isFinite(pageLoad?.largest_contentful_paint_ms)) return null;
  return {
    largest_contentful_paint_ms: pageLoad.largest_contentful_paint_ms,
    provenance: pageLoad.provenance,
  };
}

function compactMainThreadSummary(value) {
  const mainThread = value?.main_thread;
  const phases = mainThread?.phases;
  const phaseNames = ['javascript', 'style', 'layout', 'paint'];
  if (
    !plainObject(mainThread) ||
    !plainObject(phases) ||
    !Array.isArray(mainThread.long_tasks) ||
    phaseNames.some(
      (name) =>
        !plainObject(phases[name]) ||
        !Number.isFinite(phases[name].total_duration_ms) ||
        phases[name].total_duration_ms < 0
    )
  ) {
    return null;
  }

  const profile = mainThread.profile;
  const repositorySampleCount = profile?.repository_sample_count;
  const candidates = Array.isArray(profile?.candidates) ? profile.candidates : [];
  const repositoryCpu = Number.isSafeInteger(repositorySampleCount)
    ? {
        state: repositorySampleCount === 0 ? 'observed_zero' : 'observed',
        sample_count: repositorySampleCount,
        self_time_ms:
          repositorySampleCount === 0 || candidates.length > 0
            ? round3(
                candidates.reduce(
                  (total, candidate) =>
                    total + (Number.isFinite(candidate?.self_time_ms) ? candidate.self_time_ms : 0),
                  0
                )
              )
            : null,
      }
    : { state: 'unavailable', sample_count: null, self_time_ms: null };

  return {
    phases_ms: Object.fromEntries(phaseNames.map((name) => [name, phases[name].total_duration_ms])),
    long_tasks: {
      count: mainThread.long_tasks.length,
      total_duration_ms: round3(
        mainThread.long_tasks.reduce(
          (total, task) => total + (Number.isFinite(task?.duration_ms) ? task.duration_ms : 0),
          0
        )
      ),
    },
    repository_cpu: repositoryCpu,
  };
}

function validateMainThreadSummary(value, errors) {
  if (value === null || value === undefined) return;
  if (!plainObject(value)) {
    errors.push('diagnosis.main_thread is invalid');
    return;
  }
  closed(value, ['phases_ms', 'long_tasks', 'repository_cpu'], 'diagnosis.main_thread', errors);
  const phaseNames = ['javascript', 'style', 'layout', 'paint'];
  if (plainObject(value.phases_ms)) {
    closed(value.phases_ms, phaseNames, 'diagnosis.main_thread.phases_ms', errors);
  }
  if (
    !plainObject(value.phases_ms) ||
    Object.keys(value.phases_ms).length !== phaseNames.length ||
    phaseNames.some((name) => !Number.isFinite(value.phases_ms[name]) || value.phases_ms[name] < 0)
  ) {
    errors.push('diagnosis.main_thread.phases_ms is invalid');
  }
  if (
    !plainObject(value.long_tasks) ||
    !Number.isSafeInteger(value.long_tasks.count) ||
    value.long_tasks.count < 0 ||
    !Number.isFinite(value.long_tasks.total_duration_ms) ||
    value.long_tasks.total_duration_ms < 0
  ) {
    errors.push('diagnosis.main_thread.long_tasks is invalid');
  } else {
    closed(
      value.long_tasks,
      ['count', 'total_duration_ms'],
      'diagnosis.main_thread.long_tasks',
      errors
    );
  }
  const repositoryCpu = value.repository_cpu;
  if (!plainObject(repositoryCpu)) {
    errors.push('diagnosis.main_thread.repository_cpu is invalid');
    return;
  }
  closed(
    repositoryCpu,
    ['state', 'sample_count', 'self_time_ms'],
    'diagnosis.main_thread.repository_cpu',
    errors
  );
  if (
    (repositoryCpu.state === 'unavailable' &&
      (repositoryCpu.sample_count !== null || repositoryCpu.self_time_ms !== null)) ||
    (repositoryCpu.state === 'observed_zero' &&
      (repositoryCpu.sample_count !== 0 || repositoryCpu.self_time_ms !== 0)) ||
    (repositoryCpu.state === 'observed' &&
      (!Number.isSafeInteger(repositoryCpu.sample_count) ||
        repositoryCpu.sample_count < 1 ||
        (repositoryCpu.self_time_ms !== null &&
          (!Number.isFinite(repositoryCpu.self_time_ms) || repositoryCpu.self_time_ms < 0)))) ||
    !['observed', 'observed_zero', 'unavailable'].includes(repositoryCpu.state)
  ) {
    errors.push('diagnosis.main_thread.repository_cpu is invalid');
  }
}

function round3(value) {
  return Math.round(value * 1_000) / 1_000;
}

function compactMemorySummary(value) {
  const processTreePeak = value?.memory?.peak_process_tree_rss_bytes;
  const counters = value?.main_thread?.memory_counters;
  const repeated = value?.repeated_memory;
  const samePage = value?.same_page_memory;
  if (
    !Number.isSafeInteger(processTreePeak) &&
    !Number.isSafeInteger(counters?.sample_count) &&
    repeated?.state !== 'succeeded' &&
    samePage?.state !== 'succeeded'
  ) {
    return null;
  }
  return {
    process_tree_peak_rss_bytes: Number.isSafeInteger(processTreePeak) ? processTreePeak : null,
    renderer: Number.isSafeInteger(counters?.sample_count)
      ? {
          samples: counters.sample_count,
          heap_peak_bytes: counters.peak.js_heap_used_bytes,
          heap_delta_bytes: counters.delta.js_heap_used_bytes,
          dom_nodes_peak: counters.peak.dom_nodes,
          dom_nodes_delta: counters.delta.dom_nodes,
          documents_peak: counters.peak.documents,
          documents_delta: counters.delta.documents,
          event_listeners_peak: counters.peak.event_listeners,
          event_listeners_delta: counters.delta.event_listeners,
        }
      : null,
    repeated:
      repeated?.state === 'succeeded'
        ? {
            samples: repeated.samples.length,
            after_heap_used_bytes: repeated.summary.after_heap_used_bytes,
            delta_heap_used_bytes: repeated.summary.delta_heap_used_bytes,
            after_dom_nodes: repeated.summary.after_dom_nodes,
            after_event_listeners: repeated.summary.after_event_listeners,
            context_scope: repeated.context_scope,
          }
        : null,
    same_page:
      samePage?.state === 'succeeded'
        ? {
            samples: samePage.samples.length,
            after_heap_used_bytes: samePage.trend.after_heap_used_bytes,
            after_dom_nodes: samePage.trend.after_dom_nodes,
            after_event_listeners: samePage.trend.after_event_listeners,
            context_scope: samePage.context_scope,
            interaction_scope: samePage.interaction_scope,
            retained_attribution_state:
              samePage.retained_attribution?.state === 'succeeded' ? 'succeeded' : 'unavailable',
            retained_candidate: compactRetainedCandidate(samePage.retained_attribution?.candidate),
          }
        : null,
    leak_assessment: 'not_evaluated',
  };
}

function validateMemorySummary(value, errors) {
  if (value === null || value === undefined) return;
  if (!plainObject(value)) {
    errors.push('diagnosis.memory is invalid');
    return;
  }
  closed(
    value,
    ['process_tree_peak_rss_bytes', 'renderer', 'repeated', 'same_page', 'leak_assessment'],
    'diagnosis.memory',
    errors
  );
  if (
    value.process_tree_peak_rss_bytes !== null &&
    (!Number.isSafeInteger(value.process_tree_peak_rss_bytes) ||
      value.process_tree_peak_rss_bytes < 1)
  ) {
    errors.push('diagnosis.memory.process_tree_peak_rss_bytes is invalid');
  }
  if (value.leak_assessment !== 'not_evaluated') {
    errors.push('diagnosis.memory.leak_assessment is invalid');
  }
  if (value.renderer !== null) {
    if (!plainObject(value.renderer)) {
      errors.push('diagnosis.memory.renderer is invalid');
    } else {
      const fields = [
        'samples',
        'heap_peak_bytes',
        'heap_delta_bytes',
        'dom_nodes_peak',
        'dom_nodes_delta',
        'documents_peak',
        'documents_delta',
        'event_listeners_peak',
        'event_listeners_delta',
      ];
      closed(value.renderer, fields, 'diagnosis.memory.renderer', errors);
      for (const field of fields) {
        if (!Number.isSafeInteger(value.renderer[field])) {
          errors.push(`diagnosis.memory.renderer.${field} is invalid`);
        }
      }
      for (const field of [
        'samples',
        'heap_peak_bytes',
        'dom_nodes_peak',
        'documents_peak',
        'event_listeners_peak',
      ]) {
        if (value.renderer[field] < 0) {
          errors.push(`diagnosis.memory.renderer.${field} is invalid`);
        }
      }
    }
  }
  validateRepeatedMemorySummary(value.repeated, errors);
  validateSamePageMemorySummary(value.same_page, errors);
}

function validateSamePageMemorySummary(value, errors) {
  if (value === null || value === undefined) return;
  if (!plainObject(value)) {
    errors.push('diagnosis.memory.same_page is invalid');
    return;
  }
  const fields = [
    'samples',
    'after_heap_used_bytes',
    'after_dom_nodes',
    'after_event_listeners',
    'context_scope',
    'interaction_scope',
    'retained_attribution_state',
    'retained_candidate',
  ];
  closed(value, fields, 'diagnosis.memory.same_page', errors);
  if (
    value.samples !== 3 ||
    value.context_scope !== 'same_page_and_context_exact_flow_repeats' ||
    value.interaction_scope !== 'full_project_test_callback' ||
    !['succeeded', 'unavailable'].includes(value.retained_attribution_state)
  ) {
    errors.push('diagnosis.memory.same_page identity is invalid');
  }
  for (const field of fields.slice(1, 4)) {
    validateSequenceSummary(value[field], `diagnosis.memory.same_page.${field}`, errors);
  }
  validateRetainedCandidate(value.retained_candidate, errors);
}

function compactRetainedCandidate(value) {
  if (!value) return null;
  return {
    source: value.source,
    per_cycle_sampled_live_bytes: value.per_cycle_sampled_live_bytes,
    delta_sampled_live_bytes: value.delta_sampled_live_bytes,
    delta_percent: value.delta_percent,
    monotonically_non_decreasing: value.monotonically_non_decreasing,
  };
}

function validateRetainedCandidate(value, errors) {
  if (value === null) return;
  if (!plainObject(value)) {
    errors.push('diagnosis.memory.same_page.retained_candidate is invalid');
    return;
  }
  const label = 'diagnosis.memory.same_page.retained_candidate';
  closed(
    value,
    [
      'source',
      'per_cycle_sampled_live_bytes',
      'delta_sampled_live_bytes',
      'delta_percent',
      'monotonically_non_decreasing',
    ],
    label,
    errors
  );
  const source = value.source;
  if (
    !plainObject(source) ||
    !safeRelativePath(source.file) ||
    !Number.isInteger(source.line) ||
    source.line < 1 ||
    typeof source.function !== 'string' ||
    source.function.length > 300 ||
    source.provenance !== 'repository_contained_browser_runtime_frame'
  ) {
    errors.push(`${label}.source is invalid`);
  }
  if (
    !Array.isArray(value.per_cycle_sampled_live_bytes) ||
    value.per_cycle_sampled_live_bytes.length !== 3 ||
    value.per_cycle_sampled_live_bytes.some((entry) => !Number.isSafeInteger(entry) || entry < 0) ||
    value.per_cycle_sampled_live_bytes.filter((entry) => entry > 0).length < 2 ||
    !Number.isSafeInteger(value.delta_sampled_live_bytes) ||
    value.delta_sampled_live_bytes < 64 * 1024 ||
    (value.delta_percent !== null &&
      (!Number.isFinite(value.delta_percent) || value.delta_percent < 20)) ||
    value.monotonically_non_decreasing !== true
  ) {
    errors.push(`${label} values are invalid`);
  }
}

function safeRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 300 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.split('/').includes('..')
  );
}

function validateRepeatedMemorySummary(value, errors) {
  if (value === null || value === undefined) return;
  if (!plainObject(value)) {
    errors.push('diagnosis.memory.repeated is invalid');
    return;
  }
  const fields = [
    'samples',
    'after_heap_used_bytes',
    'delta_heap_used_bytes',
    'after_dom_nodes',
    'after_event_listeners',
    'context_scope',
  ];
  closed(value, fields, 'diagnosis.memory.repeated', errors);
  if (value.samples !== 3 || value.context_scope !== 'fresh_context_exact_flow_repeats') {
    errors.push('diagnosis.memory.repeated identity is invalid');
  }
  for (const field of fields.slice(1, 5)) {
    validateDistribution(value[field], `diagnosis.memory.repeated.${field}`, errors);
  }
}

function validateDistribution(value, label, errors) {
  if (!plainObject(value)) {
    errors.push(`${label} is invalid`);
    return;
  }
  closed(value, ['count', 'min', 'median', 'max', 'spread_percent'], label, errors);
  if (
    value.count !== 3 ||
    ![value.min, value.median, value.max].every(Number.isSafeInteger) ||
    value.min > value.median ||
    value.median > value.max ||
    (value.spread_percent !== null &&
      (!Number.isFinite(value.spread_percent) || value.spread_percent < 0))
  ) {
    errors.push(`${label} is invalid`);
  }
}

function validateSequenceSummary(value, label, errors) {
  if (!plainObject(value)) {
    errors.push(`${label} is invalid`);
    return;
  }
  closed(
    value,
    [
      'count',
      'first',
      'last',
      'min',
      'max',
      'delta',
      'delta_percent',
      'monotonically_non_decreasing',
    ],
    label,
    errors
  );
  if (
    value.count !== 3 ||
    ![value.first, value.last, value.min, value.max, value.delta].every(Number.isSafeInteger) ||
    value.min > value.max ||
    value.delta !== value.last - value.first ||
    (value.delta_percent !== null && !Number.isFinite(value.delta_percent)) ||
    typeof value.monotonically_non_decreasing !== 'boolean'
  ) {
    errors.push(`${label} is invalid`);
  }
}

export function qualifiedPlaywrightDeclarationLine(candidate) {
  const evidence = (candidate?.evidence ?? []).filter(
    (entry) =>
      entry?.kind === 'literal_test_declaration' &&
      entry.file === candidate.target &&
      Number.isInteger(entry.line) &&
      entry.line > 0
  );
  return evidence.length === 1 ? evidence[0].line : null;
}

export function playwrightCandidateSafetyAllowsCapture(candidate) {
  return (
    candidate?.adapter === 'playwright' &&
    (candidate.safety_flags ?? []).every((flag) => ALLOWED_CAPTURE_SAFETY_FLAGS.has(flag.kind))
  );
}

function validateScope(value, errors) {
  if (!plainObject(value)) {
    errors.push('scope is invalid');
    return;
  }
  closed(
    value,
    ['adapter', 'candidate_id', 'target', 'name', 'base_url', 'browser_profile'],
    'scope',
    errors
  );
  if (value.adapter !== 'playwright' || typeof value.candidate_id !== 'string') {
    errors.push('scope identity is invalid');
  }
  if (
    typeof value.target !== 'string' ||
    value.target.length === 0 ||
    value.target.startsWith('/') ||
    value.target.split('/').includes('..') ||
    typeof value.name !== 'string' ||
    value.name.length === 0
  ) {
    errors.push('scope target is invalid');
  }
  try {
    assertLoopbackBaseUrl(value.base_url);
  } catch (error) {
    errors.push(error.message);
  }
  validateOwnedBrowserProfile(value.browser_profile, errors);
}

function validateOwnedBrowserProfile(value, errors) {
  if (!plainObject(value)) {
    errors.push('scope browser_profile is invalid');
    return;
  }
  closed(
    value,
    [
      'project_name',
      'device_name',
      'viewport',
      'device_scale_factor',
      'is_mobile',
      'has_touch',
      'provenance',
      'browser_binary',
    ],
    'scope.browser_profile',
    errors
  );
  if (value.project_name !== null && typeof value.project_name !== 'string') {
    errors.push('scope browser_profile project_name is invalid');
  }
  if (value.device_name !== null && typeof value.device_name !== 'string') {
    errors.push('scope browser_profile device_name is invalid');
  }
  if (
    !plainObject(value.viewport) ||
    !Number.isInteger(value.viewport.width) ||
    !Number.isInteger(value.viewport.height)
  ) {
    errors.push('scope browser_profile viewport is invalid');
  }
  if (
    typeof value.device_scale_factor !== 'number' ||
    typeof value.is_mobile !== 'boolean' ||
    typeof value.has_touch !== 'boolean'
  ) {
    errors.push('scope browser_profile device fields are invalid');
  }
  if (
    ![
      'codevetter_generic_desktop',
      'static_playwright_device',
      'static_playwright_viewport',
    ].includes(value.provenance)
  ) {
    errors.push('scope browser_profile provenance is invalid');
  }
  if (
    value.browser_binary !== undefined &&
    !['playwright_managed', 'system_chrome'].includes(value.browser_binary)
  ) {
    errors.push('scope browser_profile browser_binary is invalid');
  }
}

function validateResult(value, captureId, state, errors) {
  if (state === 'local_server_required') {
    if (value !== null) errors.push('non-execution receipt cannot have result');
    return;
  }
  if (state === 'succeeded' && !plainObject(value)) {
    errors.push('successful receipt requires result');
    return;
  }
  if (state === 'failed' && value === null) return;
  if (!plainObject(value)) {
    errors.push('result is invalid');
    return;
  }
  closed(value, ['path', 'sha256', 'bytes'], 'result', errors);
  if (value.path !== `.codevetter/playwright-runs/${captureId}/result.json`) {
    errors.push('result.path is invalid');
  }
  if (!/^[0-9a-f]{64}$/.test(value.sha256 ?? '')) errors.push('result.sha256 is invalid');
  if (
    !Number.isInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > PLAYWRIGHT_CAPTURE_LIMITS.resultBytes
  ) {
    errors.push('result.bytes is invalid');
  }
}

function closed(value, allowed, label, errors) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) errors.push(`${label} has unknown field: ${unknown.join(', ')}`);
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
