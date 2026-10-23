export const SOURCE_EXECUTION_SCHEMA = 'node-source-execution-snapshot/v1';
export const SOURCE_EXECUTION_SCOPE = 'selected_run_through_owned_flush';
export const SOURCE_EXECUTION_LIMITS = Object.freeze({ files: 16, anchors: 128, bytes: 262144 });
export const SOURCE_EXECUTION_REASONS = Object.freeze([
  'capture_unavailable',
  'capture_incomplete',
  'capture_identity_mismatch',
  'execution_incomplete',
  'source_unavailable',
  'source_identity_mismatch',
  'unsupported_map',
  'unqualified_anchor',
  'capture_bound_exceeded',
]);
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const exact = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const boundedList = (value, max, predicate) =>
  Array.isArray(value) && value.length <= max && value.every(predicate);

// This validates a sanitized optional observation. It does not authenticate execution.
export function validateSourceExecutionSnapshot(value) {
  const errors = [];
  if (
    !exact(value, [
      'schema_version',
      'scope',
      'recommendation_qualified',
      'snapshots',
      'limitations',
    ])
  )
    return ['invalid source execution snapshot shape'];
  if (
    value.schema_version !== SOURCE_EXECUTION_SCHEMA ||
    value.scope !== SOURCE_EXECUTION_SCOPE ||
    value.recommendation_qualified !== false
  )
    errors.push('invalid source execution snapshot scope');
  if (
    !boundedList(value.snapshots, SOURCE_EXECUTION_LIMITS.files, validSnapshot) ||
    (Array.isArray(value.snapshots) &&
      new Set(value.snapshots.map((item) => `${item?.capture_id}:${item?.file}`)).size !==
        value.snapshots.length)
  )
    errors.push('invalid source execution snapshots');
  if (
    !boundedList(value.limitations, SOURCE_EXECUTION_REASONS.length, (reason) =>
      SOURCE_EXECUTION_REASONS.includes(reason)
    ) ||
    new Set(value.limitations).size !== value.limitations.length
  )
    errors.push('invalid source execution limitations');
  try {
    if (Buffer.byteLength(JSON.stringify(value)) > SOURCE_EXECUTION_LIMITS.bytes)
      errors.push('source execution snapshot exceeds byte bound');
  } catch {
    errors.push('source execution snapshot is not serializable');
  }
  return errors;
}

function validSnapshot(value) {
  if (
    !exact(value, [
      'file',
      'capture_id',
      'source_sha256',
      'generated_sha256',
      'map_sha256',
      'anchors',
    ])
  )
    return false;
  if (
    typeof value.file !== 'string' ||
    value.file.length > 1024 ||
    value.file.startsWith('/') ||
    value.file.includes('\\') ||
    /^[a-z]:/i.test(value.file) ||
    value.file.split('/').some((part) => !part || part === '.' || part === '..') ||
    [...value.file].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    return false;
  if (
    ![value.capture_id, value.source_sha256, value.generated_sha256, value.map_sha256].every(digest)
  )
    return false;
  return (
    value.anchors?.length > 0 &&
    boundedList(value.anchors, SOURCE_EXECUTION_LIMITS.anchors, validAnchor) &&
    new Set(value.anchors.map((anchor) => `${anchor.generated_start}:${anchor.generated_end}`))
      .size === value.anchors.length
  );
}

function validAnchor(value) {
  if (!exact(value, ['line', 'column', 'generated_start', 'generated_end', 'status', 'count']))
    return false;
  if (
    ![value.line, value.column, value.generated_start, value.generated_end].every(integer) ||
    value.line < 1 ||
    value.column < 1 ||
    value.line > SOURCE_EXECUTION_LIMITS.bytes ||
    value.column > SOURCE_EXECUTION_LIMITS.bytes ||
    value.generated_end <= value.generated_start ||
    value.generated_end > SOURCE_EXECUTION_LIMITS.bytes * 4
  )
    return false;
  if (value.status === 'executed_in_snapshot') return integer(value.count) && value.count > 0;
  if (value.status === 'not_observed_in_snapshot') return value.count === 0;
  return false;
}
