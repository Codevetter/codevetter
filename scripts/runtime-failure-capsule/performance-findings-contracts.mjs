import { sha256, stableStringify } from './campaign-contracts.mjs';

export const PERFORMANCE_FINDINGS_SCHEMA_VERSION = 'runtime-performance-findings/v2';
export const FINDING_ORIGINS = Object.freeze([
  'tool_detected',
  'agent_discovered_after_source_read',
  'user_supplied',
]);
export const FINDING_KINDS = Object.freeze([
  'application_cpu_hotspot',
  'application_allocation_hotspot',
  'repeated_database_operation',
  'n_plus_one_shape',
  'failed_network_operation',
  'repeated_network_operation',
  'dominant_network_operation',
  'browser_main_thread_long_task',
  'browser_javascript_cpu_hotspot',
  'react_component_commit_hotspot',
  'serialized_operations',
  'repeated_application_work',
  'unaccounted_flow_time',
]);
export const FINDING_LIMITS = Object.freeze({
  findings: 32,
  coverage: 24,
  evidenceIds: 64,
  flowIds: 64,
  text: 1_000,
  limitations: 16,
});

const FINDING_FIELDS = [
  'id',
  'candidate_key',
  'candidate_context_sha256',
  'detector',
  'kind',
  'origin',
  'flow_id',
  'source',
  'observed',
  'inference',
  'unverified',
  'confidence',
  'expected_effect',
  'verification',
  'evidence_ids',
  'limitations',
  'eligible_for_experiment',
];

export function createFinding(payload) {
  const finding = { ...payload, id: null };
  finding.id = findingIdentity(finding);
  return assertFinding(finding);
}

export function findingIdentity(finding) {
  const { id: _id, ...identity } = finding ?? {};
  return sha256(stableStringify(identity)).slice(0, 24);
}

export function candidateIdentity(finding, sourceIdentitySha256) {
  if (!/^[0-9a-f]{64}$/.test(sourceIdentitySha256 ?? '') || !plain(finding?.source)) return null;
  const stableSource = {
    file: finding.source.file,
    function: finding.source.function ?? null,
    ...(finding.source.function ? {} : { line: finding.source.line }),
  };
  return sha256(
    stableStringify({
      source_identity_sha256: sourceIdentitySha256,
      detector: finding.detector,
      kind: finding.kind,
      source: stableSource,
      inference_mechanism: finding.inference?.mechanism ?? null,
      operation_kind: finding.observed?.operation_kind ?? null,
    })
  ).slice(0, 24);
}

export function assertFinding(value) {
  const errors = validateFinding(value);
  if (errors.length > 0) throw new Error(`invalid performance finding: ${errors.join('; ')}`);
  return value;
}

export function validateFinding(value) {
  if (!plain(value)) return ['finding must be an object'];
  const errors = unknownFields(value, FINDING_FIELDS, 'finding');
  if (!/^[0-9a-f]{24}$/.test(value.id ?? '')) errors.push('id is invalid');
  else if (findingIdentity(value) !== value.id) errors.push('id does not match canonical content');
  if (value.candidate_key !== undefined && !/^[0-9a-f]{24}$/.test(value.candidate_key)) {
    errors.push('candidate_key is invalid');
  }
  if (
    value.candidate_context_sha256 !== undefined &&
    !/^[0-9a-f]{64}$/.test(value.candidate_context_sha256)
  ) {
    errors.push('candidate_context_sha256 is invalid');
  }
  if (!FINDING_KINDS.includes(value.kind)) errors.push('kind is invalid');
  if (!FINDING_ORIGINS.includes(value.origin)) errors.push('origin is invalid');
  text(value.detector, 'detector', errors, 100);
  text(value.flow_id, 'flow_id', errors, 100);
  source(value.source, errors);
  object(value.observed, 'observed', errors);
  object(value.inference, 'inference', errors);
  object(value.confidence, 'confidence', errors);
  object(value.expected_effect, 'expected_effect', errors);
  object(value.verification, 'verification', errors);
  strings(value.unverified, 'unverified', errors, FINDING_LIMITS.limitations);
  strings(value.evidence_ids, 'evidence_ids', errors, FINDING_LIMITS.evidenceIds);
  strings(value.limitations, 'limitations', errors, FINDING_LIMITS.limitations);
  if (typeof value.eligible_for_experiment !== 'boolean') {
    errors.push('eligible_for_experiment is invalid');
  }
  return errors;
}

export function assertPerformanceFindingsReport(value) {
  const errors = validatePerformanceFindingsReport(value);
  if (errors.length > 0) throw new Error(`invalid performance findings: ${errors.join('; ')}`);
  return value;
}

export function validatePerformanceFindingsReport(value) {
  if (!plain(value)) return ['report must be an object'];
  const errors = unknownFields(
    value,
    [
      'schema_version',
      'subject',
      'scope',
      'policy',
      'findings',
      'detector_coverage',
      'limitations',
      'verdict',
    ],
    'report'
  );
  if (value.schema_version !== PERFORMANCE_FINDINGS_SCHEMA_VERSION) {
    errors.push('schema_version is invalid');
  }
  if (typeof value.subject?.repository_revision !== 'string') errors.push('subject is invalid');
  if (
    value.subject?.source_snapshot_sha256 !== undefined &&
    !/^[0-9a-f]{64}$/.test(value.subject.source_snapshot_sha256)
  ) {
    errors.push('subject.source_snapshot_sha256 is invalid');
  }
  if (typeof value.scope?.root_flow_id !== 'string') errors.push('scope is invalid');
  if (!plain(value.policy) || typeof value.policy.version !== 'string') {
    errors.push('policy is invalid');
  }
  if (!Array.isArray(value.findings) || value.findings.length > FINDING_LIMITS.findings) {
    errors.push('findings is invalid');
  } else {
    value.findings.forEach((finding, index) => {
      errors.push(...validateFinding(finding).map((error) => `findings[${index}].${error}`));
      if (
        finding.candidate_key !== undefined &&
        candidateIdentity(
          finding,
          finding.candidate_context_sha256 ?? value.subject?.source_snapshot_sha256
        ) !== finding.candidate_key
      ) {
        errors.push(`findings[${index}].candidate_key does not match canonical candidate`);
      }
    });
    const ids = value.findings.map((finding) => finding.id);
    if (new Set(ids).size !== ids.length) errors.push('finding IDs are duplicated');
    if (!ordered(ids)) errors.push('findings are not sorted');
  }
  if (
    !Array.isArray(value.detector_coverage) ||
    value.detector_coverage.length > FINDING_LIMITS.coverage ||
    value.detector_coverage.some(
      (entry) =>
        !plain(entry) ||
        typeof entry.detector !== 'string' ||
        !['ran', 'unavailable', 'insufficient_evidence'].includes(entry.status)
    )
  ) {
    errors.push('detector_coverage is invalid');
  }
  strings(value.limitations, 'limitations', errors, FINDING_LIMITS.limitations);
  if (!['findings', 'no_findings', 'no_confidence'].includes(value.verdict?.status)) {
    errors.push('verdict is invalid');
  }
  return errors;
}

function source(value, errors) {
  if (value === null) return;
  if (
    !plain(value) ||
    typeof value.file !== 'string' ||
    value.file.startsWith('/') ||
    value.file.includes('\\') ||
    value.file.split('/').includes('..') ||
    !Number.isInteger(value.line) ||
    value.line < 1
  ) {
    errors.push('source is invalid');
  }
}

function strings(value, label, errors, maximum) {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((entry) => typeof entry !== 'string' || entry.length > FINDING_LIMITS.text)
  ) {
    errors.push(`${label} is invalid`);
  }
}

function object(value, label, errors) {
  if (!plain(value)) errors.push(`${label} is invalid`);
}

function text(value, label, errors, maximum) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    errors.push(`${label} is invalid`);
  }
}

function unknownFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  return unknown.length > 0 ? [`${label} has unknown field: ${unknown.join(', ')}`] : [];
}

function ordered(values) {
  return values.every((value, index) => index === 0 || values[index - 1] <= value);
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
