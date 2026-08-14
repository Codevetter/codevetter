export const LOCAL_SERVER_ATTESTATION_SCHEMA_VERSION = 'runtime-local-server-attestation/v1';
export const QUALIFIED_LOCAL_SERVER_ATTESTATION_SCHEMA_VERSION =
  'runtime-qualified-local-server-attestation/v1';

const STATES = new Set([
  'verified_by_declared_process',
  'not_listening',
  'expected_family_unavailable',
  'inspection_unavailable',
  'listener_mismatch',
]);
const FAMILIES = new Set(['wrangler', 'vite', 'next', 'node']);

export function assertLocalServerAttestation(value) {
  const errors = validateLocalServerAttestation(value);
  if (errors.length > 0) throw new Error(`invalid local server attestation: ${errors.join('; ')}`);
  return value;
}

export function validateLocalServerAttestation(value) {
  const errors = [];
  if (!plainObject(value)) return ['attestation must be an object'];
  closed(
    value,
    [
      'schema_version',
      'state',
      'expected_family',
      'declared_command_sha256',
      'checks',
      'limitations',
    ],
    'attestation',
    errors
  );
  if (value.schema_version !== LOCAL_SERVER_ATTESTATION_SCHEMA_VERSION) {
    errors.push('schema_version is invalid');
  }
  if (!STATES.has(value.state)) errors.push('state is invalid');
  if (value.expected_family !== null && !FAMILIES.has(value.expected_family)) {
    errors.push('expected_family is invalid');
  }
  if (
    value.declared_command_sha256 !== null &&
    !/^[0-9a-f]{64}$/.test(value.declared_command_sha256 ?? '')
  ) {
    errors.push('declared_command_sha256 is invalid');
  }
  if ((value.expected_family === null) !== (value.declared_command_sha256 === null)) {
    errors.push('expected server family and command digest must be present together');
  }
  if (!plainObject(value.checks)) errors.push('checks is invalid');
  else {
    closed(
      value.checks,
      ['listener_count', 'repository_cwd_match', 'declared_family_match'],
      'checks',
      errors
    );
    if (
      !Number.isInteger(value.checks.listener_count) ||
      value.checks.listener_count < 0 ||
      value.checks.listener_count > 8
    ) {
      errors.push('checks.listener_count is invalid');
    }
    if (typeof value.checks.repository_cwd_match !== 'boolean') {
      errors.push('checks.repository_cwd_match is invalid');
    }
    if (typeof value.checks.declared_family_match !== 'boolean') {
      errors.push('checks.declared_family_match is invalid');
    }
  }
  if (
    !Array.isArray(value.limitations) ||
    value.limitations.length > 8 ||
    value.limitations.some((entry) => typeof entry !== 'string' || entry.length > 500)
  ) {
    errors.push('limitations is invalid');
  }
  if (value.state === 'verified_by_declared_process') {
    if (
      value.expected_family === null ||
      value.declared_command_sha256 === null ||
      value.checks?.listener_count !== 1 ||
      value.checks?.repository_cwd_match !== true ||
      value.checks?.declared_family_match !== true
    ) {
      errors.push('verified state requires one matching declared repository listener');
    }
  }
  if (
    value.state === 'expected_family_unavailable' &&
    (value.expected_family !== null ||
      value.declared_command_sha256 !== null ||
      value.checks?.listener_count !== 0 ||
      value.checks?.repository_cwd_match !== false ||
      value.checks?.declared_family_match !== false)
  ) {
    errors.push('unavailable expected family cannot claim listener or expectation evidence');
  }
  if (
    [
      'verified_by_declared_process',
      'not_listening',
      'inspection_unavailable',
      'listener_mismatch',
    ].includes(value.state) &&
    (value.expected_family === null || value.declared_command_sha256 === null)
  ) {
    errors.push('listener attestation state requires one declared server expectation');
  }
  if (value.state === 'not_listening' && value.checks?.listener_count !== 0) {
    errors.push('not-listening state cannot claim listeners');
  }
  if (value.state === 'listener_mismatch' && value.checks?.listener_count < 1) {
    errors.push('listener mismatch requires at least one listener');
  }
  return errors;
}

export function assertQualifiedLocalServerAttestation(value) {
  const errors = validateQualifiedLocalServerAttestation(value);
  if (errors.length > 0) {
    throw new Error(`invalid qualified local server attestation: ${errors.join('; ')}`);
  }
  return value;
}

export function validateQualifiedLocalServerAttestation(value) {
  const errors = [];
  if (!plainObject(value)) return ['result must be an object'];
  closed(
    value,
    ['schema_version', 'subject', 'scope', 'attestation', 'limitations'],
    'result',
    errors
  );
  if (value.schema_version !== QUALIFIED_LOCAL_SERVER_ATTESTATION_SCHEMA_VERSION) {
    errors.push('schema_version is invalid');
  }
  if (
    !plainObject(value.subject) ||
    typeof value.subject.repository_revision !== 'string' ||
    typeof value.subject.dirty !== 'boolean'
  ) {
    errors.push('subject is invalid');
  } else closed(value.subject, ['repository_revision', 'dirty'], 'subject', errors);
  if (!plainObject(value.scope)) errors.push('scope is invalid');
  else {
    closed(value.scope, ['candidate_id', 'target', 'name', 'base_url'], 'scope', errors);
    for (const key of ['candidate_id', 'target', 'name', 'base_url']) {
      if (typeof value.scope[key] !== 'string' || value.scope[key].length === 0) {
        errors.push(`scope.${key} is invalid`);
      }
    }
  }
  errors.push(
    ...validateLocalServerAttestation(value.attestation).map((error) => `attestation.${error}`)
  );
  if (
    !Array.isArray(value.limitations) ||
    value.limitations.some((entry) => typeof entry !== 'string' || entry.length > 500)
  ) {
    errors.push('limitations is invalid');
  }
  return errors;
}

function closed(value, allowed, label, errors) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) errors.push(`${label} has unknown field: ${unknown.join(', ')}`);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
