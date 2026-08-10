export const SUPERVISED_RUN_SCHEMA_VERSION = 'runtime-performance-supervision/v1';

export const SUPERVISION_LIMITS = Object.freeze({
  runIdCharacters: 80,
  receiptBytes: 256 * 1024,
  resultBytes: 8 * 1024 * 1024,
  outputBytes: 128 * 1024,
  failureCharacters: 2_000,
  heartbeatMs: 2_000,
  maximumDeadlineMs: 30 * 60 * 1_000,
  terminationGraceMs: 500,
});

export const SUPERVISED_RUN_STATES = Object.freeze([
  'initialized',
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'signaled',
  'spawn_failed',
  'invalid_result',
]);

export function assertRunId(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > SUPERVISION_LIMITS.runIdCharacters ||
    !/^[a-z0-9][a-z0-9-]*$/.test(value)
  ) {
    throw new Error('run ID must use lowercase letters, digits, and hyphens');
  }
  return value;
}

export function assertSupervisedRunReceipt(value) {
  const errors = validateSupervisedRunReceipt(value);
  if (errors.length > 0) throw new Error(`invalid supervised run receipt: ${errors.join('; ')}`);
  return value;
}

export function validateSupervisedRunReceipt(value) {
  const errors = [];
  if (!plainObject(value)) return ['receipt must be an object'];
  closed(
    value,
    [
      'schema_version',
      'run_id',
      'state',
      'subject',
      'scope',
      'policy',
      'supervisor',
      'lifecycle',
      'child',
      'result',
      'failure',
      'capture',
      'limitations',
    ],
    'receipt',
    errors
  );
  if (value.schema_version !== SUPERVISED_RUN_SCHEMA_VERSION) errors.push('invalid schema_version');
  try {
    assertRunId(value.run_id);
  } catch (error) {
    errors.push(error.message);
  }
  if (!SUPERVISED_RUN_STATES.includes(value.state)) errors.push('invalid state');
  validateSubject(value.subject, errors);
  validateScope(value.scope, errors);
  validatePolicy(value.policy, errors);
  validateSupervisor(value.supervisor, errors);
  validateLifecycle(value.lifecycle, errors);
  validateChild(value.child, errors);
  if (value.result !== null) validateReference(value.result, value.run_id, errors);
  if (value.failure !== null) validateFailure(value.failure, value.state, errors);
  validateCapture(value.capture, errors);
  if (
    !Array.isArray(value.limitations) ||
    value.limitations.length > 16 ||
    value.limitations.some((entry) => typeof entry !== 'string' || entry.length > 500)
  ) {
    errors.push('limitations must be a bounded string array');
  }
  validateStateConsistency(value, errors);
  return errors;
}

function validateSubject(value, errors) {
  if (!objectWithKeys(value, ['repository_revision', 'dirty'], 'subject', errors)) return;
  if (typeof value.repository_revision !== 'string' || value.repository_revision.length === 0) {
    errors.push('subject.repository_revision is invalid');
  }
  if (typeof value.dirty !== 'boolean') errors.push('subject.dirty must be boolean');
}

function validateScope(value, errors) {
  if (!objectWithKeys(value, ['adapter', 'target', 'name'], 'scope', errors)) return;
  if (!PROFILE_ADAPTERS.includes(value.adapter)) errors.push('scope.adapter is invalid');
  if (
    typeof value.target !== 'string' ||
    value.target.length === 0 ||
    value.target.length > 1_000
  ) {
    errors.push('scope.target is invalid');
  }
  if (value.name !== null && (typeof value.name !== 'string' || value.name.length > 1_000)) {
    errors.push('scope.name is invalid');
  }
}

function validatePolicy(value, errors) {
  if (
    !objectWithKeys(
      value,
      ['samples', 'warmups', 'timeout_ms', 'supervisor_deadline_ms'],
      'policy',
      errors
    )
  ) {
    return;
  }
  if (!integerBetween(value.samples, LIMITS.minimumSamples, LIMITS.maximumSamples)) {
    errors.push('policy.samples is invalid');
  }
  if (!integerBetween(value.warmups, 0, LIMITS.maximumWarmups)) {
    errors.push('policy.warmups is invalid');
  }
  if (!integerBetween(value.timeout_ms, 1, LIMITS.maximumTimeoutMs)) {
    errors.push('policy.timeout_ms is invalid');
  }
  if (!integerBetween(value.supervisor_deadline_ms, 25, SUPERVISION_LIMITS.maximumDeadlineMs)) {
    errors.push('policy.supervisor_deadline_ms is invalid');
  }
}

function validateSupervisor(value, errors) {
  if (!objectWithKeys(value, ['pid', 'node_version'], 'supervisor', errors)) return;
  if (!integerBetween(value.pid, 1, Number.MAX_SAFE_INTEGER))
    errors.push('supervisor.pid is invalid');
  if (typeof value.node_version !== 'string' || value.node_version.length > 100) {
    errors.push('supervisor.node_version is invalid');
  }
}

function validateLifecycle(value, errors) {
  if (
    !objectWithKeys(
      value,
      ['created_at', 'started_at', 'heartbeat_at', 'completed_at'],
      'lifecycle',
      errors
    )
  ) {
    return;
  }
  if (!validTimestamp(value.created_at)) errors.push('lifecycle.created_at is invalid');
  for (const field of ['started_at', 'heartbeat_at', 'completed_at']) {
    if (value[field] !== null && !validTimestamp(value[field])) {
      errors.push(`lifecycle.${field} is invalid`);
    }
  }
}

function validateChild(value, errors) {
  if (!objectWithKeys(value, ['pid', 'exit_code', 'signal'], 'child', errors)) return;
  if (value.pid !== null && !integerBetween(value.pid, 1, Number.MAX_SAFE_INTEGER)) {
    errors.push('child.pid is invalid');
  }
  if (value.exit_code !== null && !Number.isInteger(value.exit_code)) {
    errors.push('child.exit_code is invalid');
  }
  if (value.signal !== null && (typeof value.signal !== 'string' || value.signal.length > 32)) {
    errors.push('child.signal is invalid');
  }
}

function validateReference(value, runId, errors) {
  if (!objectWithKeys(value, ['path', 'sha256', 'bytes'], 'result', errors)) return;
  if (value.path !== `.codevetter/performance-runs/${runId}/result.json`) {
    errors.push('result.path is invalid');
  }
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) {
    errors.push('result.sha256 is invalid');
  }
  if (!integerBetween(value.bytes, 1, SUPERVISION_LIMITS.resultBytes)) {
    errors.push('result.bytes is invalid');
  }
}

function validateFailure(value, state, errors) {
  if (
    !objectWithKeys(value, ['kind', 'operational_error', 'stdout', 'stderr'], 'failure', errors)
  ) {
    return;
  }
  if (value.kind !== state || !SUPERVISED_RUN_STATES.includes(value.kind)) {
    errors.push('failure.kind is invalid');
  }
  for (const field of ['operational_error', 'stdout', 'stderr']) {
    if (
      value[field] !== null &&
      (typeof value[field] !== 'string' ||
        value[field].length > SUPERVISION_LIMITS.failureCharacters)
    ) {
      errors.push(`failure.${field} is invalid`);
    }
  }
}

function validateCapture(value, errors) {
  if (
    !objectWithKeys(
      value,
      ['stdout_bytes', 'stderr_bytes', 'truncated', 'redaction_count'],
      'capture',
      errors
    )
  ) {
    return;
  }
  for (const field of ['stdout_bytes', 'stderr_bytes', 'redaction_count']) {
    if (!integerBetween(value[field], 0, Number.MAX_SAFE_INTEGER)) {
      errors.push(`capture.${field} is invalid`);
    }
  }
  if (typeof value.truncated !== 'boolean') errors.push('capture.truncated must be boolean');
}

function validateStateConsistency(value, errors) {
  const terminal = !['initialized', 'running'].includes(value.state);
  if (terminal && value.lifecycle?.completed_at === null) {
    errors.push('terminal receipt requires lifecycle.completed_at');
  }
  if (!terminal && value.lifecycle?.completed_at !== null) {
    errors.push('active receipt cannot have lifecycle.completed_at');
  }
  if (
    value.state === 'running' &&
    (value.child?.pid === null || value.lifecycle?.started_at === null)
  ) {
    errors.push('running receipt requires child and start evidence');
  }
  if (value.state === 'succeeded') {
    if (value.result === null) errors.push('succeeded receipt requires result');
    if (value.failure !== null) errors.push('succeeded receipt cannot have failure');
  } else if (terminal) {
    if (value.result !== null) errors.push('non-success receipt cannot have result');
    if (value.failure === null) errors.push('non-success receipt requires failure');
  } else if (value.result !== null || value.failure !== null) {
    errors.push('active receipt cannot have result or failure');
  }
}

function objectWithKeys(value, keys, label, errors) {
  if (!plainObject(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  closed(value, keys, label, errors);
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) errors.push(`${label} is missing field: ${missing.join(', ')}`);
  return missing.length === 0;
}

function integerBetween(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function validTimestamp(value) {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function closed(value, allowed, label, errors) {
  const accepted = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !accepted.has(key));
  if (unknown.length > 0) errors.push(`${label} has unknown field: ${unknown.join(', ')}`);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
import { LIMITS, PROFILE_ADAPTERS } from './contracts.mjs';
