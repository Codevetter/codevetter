import { validateOptimizationVerification } from './contracts.mjs';
import { isAbsolute } from 'node:path';

export const PERFORMANCE_LAB_SCHEMA_VERSION = 'runtime-performance-lab-run/v6';
export const PERFORMANCE_LAB_LIMITS = Object.freeze({
  labIdCharacters: 64,
  maximumSteps: 8,
  findingExclusions: 8,
  candidateExclusions: 8,
  receipts: 64,
  receiptBytes: 256 * 1024,
  evidenceBytes: 8 * 1024 * 1024,
  limitations: 16,
  text: 1_000,
});

const RECEIPT_FIELDS = new Set([
  'schema_version',
  'lab_id',
  'state',
  'subject',
  'policy',
  'lifecycle',
  'initial_summary',
  'final_summary',
  'steps',
  'continuation',
  'screening',
  'acceptance',
  'stop',
  'limitations',
]);
const POLICY_FIELDS = new Set([
  'max_steps',
  'samples',
  'warmups',
  'timeout_ms',
  'excluded_finding_ids',
  'excluded_candidate_keys',
]);

export function assertPerformanceLabId(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > PERFORMANCE_LAB_LIMITS.labIdCharacters ||
    !/^[a-z0-9][a-z0-9-]*$/.test(value)
  ) {
    throw new Error('laboratory ID must use lowercase letters, digits, and hyphens');
  }
  return value;
}

export function boundedPerformanceLabSteps(value, defaultValue = 8) {
  const parsed = value === undefined ? defaultValue : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > PERFORMANCE_LAB_LIMITS.maximumSteps) {
    throw new Error('laboratory steps must be an integer between 1 and 8');
  }
  return parsed;
}

export function boundedPerformanceFindingExclusions(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > PERFORMANCE_LAB_LIMITS.findingExclusions) {
    throw new Error('excluded finding IDs must be an array with at most 8 entries');
  }
  const ids = value.map((entry) => {
    if (typeof entry !== 'string' || !/^[0-9a-f]{24}$/.test(entry)) {
      throw new Error('excluded finding IDs must be canonical 24-character lowercase hex IDs');
    }
    return entry;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error('excluded finding IDs must be unique');
  }
  return ids.toSorted();
}

export function boundedPerformanceCandidateExclusions(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > PERFORMANCE_LAB_LIMITS.candidateExclusions) {
    throw new Error('excluded candidate keys must be an array with at most 8 entries');
  }
  const keys = value.map((entry) => {
    if (typeof entry !== 'string' || !/^[0-9a-f]{24}$/.test(entry)) {
      throw new Error('excluded candidate keys must be canonical 24-character lowercase hex');
    }
    return entry;
  });
  if (new Set(keys).size !== keys.length) {
    throw new Error('excluded candidate keys must be unique');
  }
  return keys.toSorted();
}

export function assertPerformanceLabCorrectnessScope(value) {
  if (!plain(value)) throw new Error('correctness scope must be an object');
  const unknown = Object.keys(value).filter(
    (field) => !['adapter', 'target', 'name'].includes(field)
  );
  if (unknown.length > 0)
    throw new Error(`correctness scope has unknown field: ${unknown.join(', ')}`);
  if (!['node-test', 'vitest', 'jest', 'go-test'].includes(value.adapter)) {
    throw new Error('correctness adapter is unsupported');
  }
  if (
    typeof value.target !== 'string' ||
    value.target.length === 0 ||
    value.target.length > 1_000 ||
    value.target.includes('\0') ||
    isAbsolute(value.target) ||
    value.target.split(/[\\/]/).includes('..')
  ) {
    throw new Error('correctness target must be a bounded contained relative path');
  }
  if (
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    value.name.length > 1_000 ||
    value.name.includes('\0')
  ) {
    throw new Error('correctness name must identify one exact test');
  }
  return { adapter: value.adapter, target: value.target, name: value.name };
}

export function compactPerformanceLabSummary(summary) {
  const fields = [
    'discovered_flows',
    'profile_capable_flows',
    'measured_profile_flows',
    'measurement_ready_flows',
    'measured_measurement_ready_flows',
    'experimented_measurement_ready_flows',
    'screening_eligible_flows',
    'screened_existing_flows',
    'browser_capture_eligible_flows',
    'browser_traced_flows',
    'browser_failure_diagnosed_flows',
    'browser_capture_failures',
    'candidate_ready_flows',
    'candidate_exhausted_flows',
    'correctness_bound_flows',
    'stale_correctness_bindings',
    'discovery_truncated',
  ];
  return Object.fromEntries(fields.map((field) => [field, summary[field]]));
}

export function assertPerformanceLabReceipt(value) {
  const errors = validatePerformanceLabReceipt(value);
  if (errors.length > 0) {
    throw new Error(`invalid performance laboratory receipt: ${errors.join('; ')}`);
  }
  return value;
}

export function validatePerformanceLabReceipt(value) {
  if (!plain(value)) return ['receipt must be an object'];
  const errors = [];
  const unknown = Object.keys(value).filter((field) => !RECEIPT_FIELDS.has(field));
  if (unknown.length) errors.push(`receipt has unknown field: ${unknown.join(', ')}`);
  if (value.schema_version !== PERFORMANCE_LAB_SCHEMA_VERSION)
    errors.push('schema_version is invalid');
  try {
    assertPerformanceLabId(value.lab_id);
  } catch (error) {
    errors.push(error.message);
  }
  if (!['running', 'completed', 'stopped', 'failed'].includes(value.state)) {
    errors.push('state is invalid');
  }
  if (
    !plain(value.subject) ||
    (value.subject.dirty !== null && typeof value.subject.dirty !== 'boolean')
  ) {
    errors.push('subject is invalid');
  }
  if (
    value.subject?.source_snapshot_sha256 !== null &&
    value.subject?.source_snapshot_sha256 !== undefined &&
    !/^[0-9a-f]{64}$/.test(value.subject.source_snapshot_sha256)
  ) {
    errors.push('subject.source_snapshot_sha256 is invalid');
  }
  if (
    !plain(value.policy) ||
    value.policy.samples !== 10 ||
    !Number.isInteger(value.policy.warmups) ||
    !Number.isInteger(value.policy.timeout_ms)
  ) {
    errors.push('policy is invalid');
  }
  if (plain(value.policy)) {
    const unknownPolicyFields = Object.keys(value.policy).filter(
      (field) => !POLICY_FIELDS.has(field)
    );
    if (unknownPolicyFields.length) {
      errors.push(`policy has unknown field: ${unknownPolicyFields.join(', ')}`);
    }
    try {
      const exclusions = boundedPerformanceFindingExclusions(value.policy.excluded_finding_ids);
      if (JSON.stringify(exclusions) !== JSON.stringify(value.policy.excluded_finding_ids)) {
        errors.push('policy.excluded_finding_ids must be sorted');
      }
    } catch (error) {
      errors.push(error.message);
    }
    try {
      const exclusions = boundedPerformanceCandidateExclusions(
        value.policy.excluded_candidate_keys
      );
      if (JSON.stringify(exclusions) !== JSON.stringify(value.policy.excluded_candidate_keys)) {
        errors.push('policy.excluded_candidate_keys must be sorted');
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  try {
    boundedPerformanceLabSteps(value.policy?.max_steps);
  } catch (error) {
    errors.push(error.message);
  }
  if (!plain(value.lifecycle) || !timestamp(value.lifecycle.started_at)) {
    errors.push('lifecycle is invalid');
  }
  if (
    value.state === 'running'
      ? value.lifecycle?.completed_at !== null
      : !timestamp(value.lifecycle?.completed_at)
  ) {
    errors.push('lifecycle completion is invalid');
  }
  if (!Array.isArray(value.steps) || value.steps.length > PERFORMANCE_LAB_LIMITS.maximumSteps) {
    errors.push('steps is invalid');
  } else {
    for (const [index, step] of value.steps.entries()) {
      if (!plain(step) || step.index !== index + 1 || typeof step.result !== 'string') {
        errors.push(`steps[${index}] is invalid`);
      }
      if (
        step?.action === 'capture_playwright_flow' &&
        step.result === 'succeeded' &&
        step.diagnosis === null
      ) {
        errors.push(`steps[${index}].successful browser capture requires diagnosis`);
      }
      if (step?.action === 'capture_playwright_flow' && step.runtime === null) {
        errors.push(`steps[${index}].browser capture requires runtime evidence`);
      }
    }
  }
  validateContinuation(value.continuation, errors);
  if (value.screening !== null) {
    const screeningErrors = validateOptimizationVerification(value.screening);
    errors.push(...screeningErrors.map((error) => `screening.${error}`));
  }
  if (value.continuation === null && value.screening !== null) {
    errors.push('screening requires continuation');
  }
  validateAcceptance(value.acceptance, value.continuation, errors);
  if (
    !Array.isArray(value.limitations) ||
    value.limitations.length > PERFORMANCE_LAB_LIMITS.limitations
  ) {
    errors.push('limitations is invalid');
  }
  if (value.state === 'running' ? value.stop !== null : !plain(value.stop)) {
    errors.push('stop is invalid');
  }
  return errors;
}

function validateAcceptance(value, continuation, errors) {
  if (value === null) return;
  if (!plain(value)) {
    errors.push('acceptance is invalid');
    return;
  }
  const unknown = Object.keys(value).filter(
    (field) => !['change_cost', 'correctness', 'paired_verification', 'verdict'].includes(field)
  );
  if (unknown.length > 0) errors.push(`acceptance has unknown field: ${unknown.join(', ')}`);
  if (continuation === null) errors.push('acceptance requires continuation');
  validateChangeCost(value.change_cost, value.verdict?.status, errors);
  if (
    !plain(value.verdict) ||
    !['accepted', 'rejected', 'no_confidence'].includes(value.verdict.status)
  ) {
    errors.push('acceptance.verdict is invalid');
  }
  if (value.correctness !== null) {
    try {
      assertPerformanceLabCorrectnessScope(value.correctness?.scope);
    } catch (error) {
      errors.push(error.message);
    }
    for (const role of ['incumbent', 'current']) {
      if (!plain(value.correctness?.[role]) || typeof value.correctness[role].status !== 'string') {
        errors.push(`acceptance.correctness.${role} is invalid`);
      }
    }
    if (value.correctness.binding !== undefined) {
      const binding = value.correctness.binding;
      if (!plain(binding) || !['cli', 'repository_manifest'].includes(binding.source)) {
        errors.push('acceptance.correctness.binding is invalid');
      } else if (
        binding.source === 'repository_manifest' &&
        !/^[0-9a-f]{64}$/.test(binding.manifest_sha256 ?? '')
      ) {
        errors.push('acceptance.correctness.binding.manifest_sha256 is invalid');
      }
    }
  }
  if (value.paired_verification !== null) {
    const evidence = value.paired_verification?.evidence;
    if (
      !plain(evidence) ||
      typeof evidence.path !== 'string' ||
      !evidence.path.startsWith('.codevetter/performance-labs/') ||
      !/^[0-9a-f]{64}$/.test(evidence.sha256 ?? '') ||
      !Number.isSafeInteger(evidence.bytes) ||
      evidence.bytes < 1 ||
      evidence.bytes > PERFORMANCE_LAB_LIMITS.evidenceBytes
    ) {
      errors.push('acceptance.paired_verification.evidence is invalid');
    }
    if (!plain(value.paired_verification?.summary)) {
      errors.push('acceptance.paired_verification.summary is invalid');
    }
  }
}

function validateChangeCost(value, verdict, errors) {
  if (value === null && verdict === 'no_confidence') return;
  if (!plain(value) || !plain(value.observed) || !plain(value.policy)) {
    errors.push('acceptance.change_cost is invalid');
    return;
  }
  for (const field of [
    'files_changed',
    'lines_added',
    'lines_removed',
    'gross_lines_changed',
    'net_lines_changed',
  ]) {
    if (!Number.isSafeInteger(value.observed[field])) {
      errors.push(`acceptance.change_cost.observed.${field} is invalid`);
    }
  }
  if (!Array.isArray(value.violations) || !Array.isArray(value.outside_boundary_files)) {
    errors.push('acceptance.change_cost violations are invalid');
  }
}

function validateContinuation(value, errors) {
  if (value === null) return;
  if (!plain(value)) {
    errors.push('continuation is invalid');
    return;
  }
  const expected = [
    'predecessor_lab_id',
    'predecessor_receipt_sha256',
    'baseline_run_id',
    'baseline_subject',
    'candidate',
  ];
  const unknown = Object.keys(value).filter((field) => !expected.includes(field));
  if (unknown.length > 0) errors.push(`continuation has unknown field: ${unknown.join(', ')}`);
  try {
    assertPerformanceLabId(value.predecessor_lab_id);
  } catch (error) {
    errors.push(error.message);
  }
  if (!/^[0-9a-f]{64}$/.test(value.predecessor_receipt_sha256 ?? '')) {
    errors.push('continuation.predecessor_receipt_sha256 is invalid');
  }
  if (
    typeof value.baseline_run_id !== 'string' ||
    !/^[a-z0-9][a-z0-9-]*$/.test(value.baseline_run_id)
  ) {
    errors.push('continuation.baseline_run_id is invalid');
  }
  if (
    !plain(value.baseline_subject) ||
    !/^[0-9a-f]{64}$/.test(value.baseline_subject.source_snapshot_sha256 ?? '')
  ) {
    errors.push('continuation.baseline_subject is invalid');
  }
  if (!plain(value.candidate) || !plain(value.candidate.source)) {
    errors.push('continuation.candidate is invalid');
  }
}

function timestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
