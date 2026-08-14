export const OWNED_VITE_RUNTIME_SCHEMA_VERSION = 'runtime-local-browser-server/v3';

export const OWNED_VITE_RUNTIME_LIMITS = Object.freeze({
  readinessMs: 30_000,
  startupMs: 90_000,
  gracefulCleanupMs: 1_000,
  forceCleanupMs: 1_000,
  outputBytes: 32 * 1024,
  preflightMs: 60_000,
  preflightRequests: 2,
  preflightRedirects: 3,
});

const STATES = new Set([
  'owned_attested',
  'reused_attested',
  'unsupported',
  'blocked_listener',
  'startup_failed',
  'attestation_failed',
  'environment_blocked',
]);
const OWNERSHIP = new Set(['owned', 'unowned', 'none']);
const CONFIGURATION = new Set(['codevetter_config_disabled', 'repository_declared', null]);
const WARMUP = new Set(['completed', 'unavailable', 'failed', 'not_applicable']);
const PREFLIGHT_STATE = new Set(['completed', 'unavailable', 'failed', 'not_applicable']);
const STATUS_CLASS = new Set(['1xx', '2xx', '3xx', '4xx', '5xx']);
const CLEANUP = new Set([
  'pending',
  'terminated',
  'force_terminated',
  'already_exited',
  'not_owned',
  'not_started',
  'failed',
]);
const ATTESTATION = new Set([
  'verified_by_declared_process',
  'not_listening',
  'listener_mismatch',
  'inspection_unavailable',
  'expected_family_unavailable',
  null,
]);

export function assertOwnedViteRuntimeSummary(value) {
  const errors = validateOwnedViteRuntimeSummary(value);
  if (errors.length > 0) {
    throw new Error(`invalid local browser runtime summary: ${errors.join('; ')}`);
  }
  return value;
}

export function validateOwnedViteRuntimeSummary(value, { nullable = false } = {}) {
  if (value === null && nullable) return [];
  if (!plainObject(value)) return ['runtime must be an object'];
  const errors = [];
  closed(
    value,
    [
      'schema_version',
      'state',
      'ownership',
      'family',
      'configuration',
      'warmup',
      'preflight',
      'startup_ms',
      'attestation_state',
      'cleanup',
    ],
    errors
  );
  if (value.schema_version !== OWNED_VITE_RUNTIME_SCHEMA_VERSION) {
    errors.push('schema_version is invalid');
  }
  if (!STATES.has(value.state)) errors.push('state is invalid');
  if (!OWNERSHIP.has(value.ownership)) errors.push('ownership is invalid');
  if (!['vite', 'next', null].includes(value.family)) errors.push('family is invalid');
  if (!CONFIGURATION.has(value.configuration)) errors.push('configuration is invalid');
  if (!WARMUP.has(value.warmup)) errors.push('warmup is invalid');
  validatePreflight(value.preflight, errors);
  if (
    !Number.isInteger(value.startup_ms) ||
    value.startup_ms < 0 ||
    value.startup_ms > OWNED_VITE_RUNTIME_LIMITS.startupMs
  ) {
    errors.push('startup_ms is invalid');
  }
  if (!ATTESTATION.has(value.attestation_state)) errors.push('attestation_state is invalid');
  if (!CLEANUP.has(value.cleanup)) errors.push('cleanup is invalid');
  if (value.state === 'owned_attested' && value.ownership !== 'owned') {
    errors.push('owned_attested runtime must be owned');
  }
  if (value.state === 'reused_attested' && value.ownership !== 'unowned') {
    errors.push('reused_attested runtime must be unowned');
  }
  if (value.state === 'owned_attested' && value.configuration !== 'codevetter_config_disabled') {
    errors.push('owned runtime must identify its disabled repository configuration');
  }
  if (value.state === 'reused_attested' && value.configuration !== 'repository_declared') {
    errors.push('reused runtime must identify repository-declared configuration');
  }
  if (
    ['owned_attested', 'reused_attested'].includes(value.state) &&
    value.attestation_state !== 'verified_by_declared_process'
  ) {
    errors.push('ready runtime must be attested');
  }
  if (value.ownership === 'none' && !['not_started', 'failed'].includes(value.cleanup)) {
    errors.push('unstarted runtime has invalid cleanup');
  }
  if (value.ownership === 'unowned' && value.cleanup !== 'not_owned') {
    errors.push('unowned runtime cannot have owned cleanup');
  }
  if (value.preflight?.state === 'completed' && value.warmup !== 'completed') {
    errors.push('completed preflight requires completed warmup');
  }
  if (value.warmup === 'completed' && value.preflight?.state !== 'completed') {
    errors.push('completed warmup requires completed preflight');
  }
  return errors;
}

function validatePreflight(value, errors) {
  if (!plainObject(value)) {
    errors.push('preflight must be an object');
    return;
  }
  const unknown = Object.keys(value).filter(
    (key) => !new Set(['state', 'inventory', 'requests']).has(key)
  );
  if (unknown.length > 0) errors.push(`preflight has unknown field: ${unknown.join(', ')}`);
  if (!PREFLIGHT_STATE.has(value.state)) errors.push('preflight state is invalid');
  if (!plainObject(value.inventory)) {
    errors.push('preflight inventory must be an object');
  } else {
    const inventoryUnknown = Object.keys(value.inventory).filter(
      (key) => !new Set(['total', 'retained', 'complete']).has(key)
    );
    if (inventoryUnknown.length > 0) {
      errors.push(`preflight inventory has unknown field: ${inventoryUnknown.join(', ')}`);
    }
    if (
      !Number.isSafeInteger(value.inventory.total) ||
      value.inventory.total < 0 ||
      value.inventory.total > OWNED_VITE_RUNTIME_LIMITS.preflightRequests
    ) {
      errors.push('preflight inventory total is invalid');
    }
    if (
      !Number.isSafeInteger(value.inventory.retained) ||
      value.inventory.retained < 0 ||
      value.inventory.retained > OWNED_VITE_RUNTIME_LIMITS.preflightRequests
    ) {
      errors.push('preflight inventory retained is invalid');
    }
    if (value.inventory.retained > value.inventory.total) {
      errors.push('preflight inventory retained exceeds total');
    }
    if (typeof value.inventory.complete !== 'boolean') {
      errors.push('preflight inventory completeness is invalid');
    }
  }
  if (!Array.isArray(value.requests)) {
    errors.push('preflight requests must be an array');
    return;
  }
  if (value.requests.length > OWNED_VITE_RUNTIME_LIMITS.preflightRequests) {
    errors.push('preflight requests exceed bound');
  }
  if (value.inventory?.retained !== value.requests.length) {
    errors.push('preflight retained count does not match requests');
  }
  for (const [index, request] of value.requests.entries()) {
    if (!plainObject(request)) {
      errors.push('preflight request must be an object');
      continue;
    }
    const requestUnknown = Object.keys(request).filter(
      (key) => !new Set(['ordinal', 'duration_ms', 'status_class']).has(key)
    );
    if (requestUnknown.length > 0) {
      errors.push(`preflight request has unknown field: ${requestUnknown.join(', ')}`);
    }
    if (request.ordinal !== index + 1) errors.push('preflight request ordinal is invalid');
    if (
      !Number.isInteger(request.duration_ms) ||
      request.duration_ms < 0 ||
      request.duration_ms > OWNED_VITE_RUNTIME_LIMITS.preflightMs
    ) {
      errors.push('preflight request duration is invalid');
    }
    if (!STATUS_CLASS.has(request.status_class)) {
      errors.push('preflight request status class is invalid');
    }
  }
  if (value.state === 'completed') {
    if (
      value.requests.length !== OWNED_VITE_RUNTIME_LIMITS.preflightRequests ||
      value.inventory?.complete !== true
    ) {
      errors.push('completed preflight must retain a complete request inventory');
    }
  } else if (value.inventory?.complete === true) {
    errors.push('non-completed preflight cannot be complete');
  }
}

function closed(value, allowed, errors) {
  const keys = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !keys.has(key));
  if (unknown.length > 0) errors.push(`runtime has unknown field: ${unknown.join(', ')}`);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
