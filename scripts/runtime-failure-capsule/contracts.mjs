import { relative, resolve, sep } from 'node:path';

export const CAPSULE_SCHEMA_VERSION = 'runtime-failure-capsule/v1';
export const PERFORMANCE_SCHEMA_VERSION = 'runtime-performance-capsule/v1';
export const PERFORMANCE_DIAGNOSIS_SCHEMA_VERSION = 'runtime-performance-diagnosis/v1';
export const OPTIMIZATION_VERIFICATION_SCHEMA_VERSION = 'runtime-optimization-verification/v1';
export const FLOW_SCHEMA_VERSION = 'runtime-flow-capsule/v1';
export const FLOW_PRIORITY_MANIFEST_SCHEMA_VERSION = 'runtime-flow-priority-manifest/v1';
export const FLOW_CAMPAIGN_PLAN_SCHEMA_VERSION = 'runtime-flow-campaign-plan/v1';
export const DETECTION_SCHEMA_VERSION = 'runtime-lane-detection/v1';
export const ADAPTERS = Object.freeze(['node-test', 'vitest', 'playwright', 'go-test']);
export const PROFILE_ADAPTERS = Object.freeze([
  'node-test',
  'node-script',
  'vitest',
  'playwright',
  'go-bench',
]);
export const FLOW_ADAPTERS = Object.freeze(['node-test', 'vitest']);
export const IMPORT_KINDS = Object.freeze(['browser', 'worker']);
export const LIMITS = Object.freeze({
  outputBytes: 128 * 1024,
  receiptBytes: 256 * 1024,
  summaryCharacters: 8_000,
  observations: 32,
  frames: 64,
  changes: 16,
  scanFiles: 500,
  scanDepth: 4,
  timeoutMs: 30_000,
  maximumTimeoutMs: 120_000,
  profileFiles: 32,
  profileBytes: 16 * 1024 * 1024,
  profileSamples: 250_000,
  flowFiles: 32,
  flowBytes: 2 * 1024 * 1024,
  flows: 128,
  coverageFiles: 32,
  coverageBytes: 16 * 1024 * 1024,
  functionCoverage: 128,
  storedCaptures: 8,
  campaignFlows: 8,
  hotspots: 24,
  sourceFiles: 3,
  sourceBytes: 256 * 1024,
  sourceLines: 100,
  minimumSamples: 2,
  defaultSamples: 3,
  maximumSamples: 10,
  defaultWarmups: 1,
  maximumWarmups: 5,
});

export const EXCLUDED_PATH_PARTS = Object.freeze([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.next',
  '.wrangler',
  '.pages-deploy',
  '.blume',
  '.git',
]);

export function assertAdapter(value) {
  if (!ADAPTERS.includes(value)) throw new Error(`unsupported adapter: ${value ?? '<missing>'}`);
  return value;
}

export function assertImportKind(value) {
  if (!IMPORT_KINDS.includes(value)) {
    throw new Error(`unsupported import kind: ${value ?? '<missing>'}`);
  }
  return value;
}

export function assertProfileAdapter(value) {
  if (!PROFILE_ADAPTERS.includes(value)) {
    throw new Error(`unsupported profile adapter: ${value ?? '<missing>'}`);
  }
  return value;
}

export function assertFlowAdapter(value) {
  if (!FLOW_ADAPTERS.includes(value)) {
    throw new Error(`unsupported local flow adapter: ${value ?? '<missing>'}`);
  }
  return value;
}

export function boundedCount(value, { name, defaultValue, minimum = 0, maximum }) {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function boundedThreshold(value, { name, defaultValue, minimum, maximum }) {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function boundedTimeout(value) {
  if (value === undefined) return LIMITS.timeoutMs;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > LIMITS.maximumTimeoutMs) {
    throw new Error(`timeout must be an integer between 100 and ${LIMITS.maximumTimeoutMs}`);
  }
  return parsed;
}

export function repositoryRelative(root, candidate) {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(candidate);
  const path = relative(absoluteRoot, absoluteCandidate);
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || path.startsWith(sep)) {
    return null;
  }
  return path.split(sep).join('/');
}

export function isExcludedPath(path) {
  const parts = path.replaceAll('\\', '/').split('/');
  return parts.some((part) => EXCLUDED_PATH_PARTS.includes(part));
}

export function validateCapsule(capsule) {
  const errors = [];
  if (capsule?.schema_version !== CAPSULE_SCHEMA_VERSION) errors.push('invalid schema_version');
  if (!['failed', 'no_confidence'].includes(capsule?.verdict?.status)) {
    errors.push('invalid verdict.status');
  }
  if (!capsule?.subject?.repository_revision) errors.push('missing subject.repository_revision');
  if (!capsule?.adapter?.kind) errors.push('missing adapter.kind');
  if (!capsule?.lane?.kind) errors.push('missing lane.kind');
  if (!capsule?.scope?.target) errors.push('missing scope.target');
  if (!Array.isArray(capsule?.observed)) errors.push('observed must be an array');
  if (!Array.isArray(capsule?.relationships)) errors.push('relationships must be an array');
  if (!Array.isArray(capsule?.unverified)) errors.push('unverified must be an array');
  if (!Array.isArray(capsule?.limitations)) errors.push('limitations must be an array');
  return errors;
}

export function validateDetection(report) {
  const errors = [];
  if (report?.schema_version !== DETECTION_SCHEMA_VERSION) errors.push('invalid schema_version');
  if (!Array.isArray(report?.lanes)) errors.push('lanes must be an array');
  if (!Array.isArray(report?.limitations)) errors.push('limitations must be an array');
  return errors;
}

export function validatePerformanceCapsule(capsule) {
  const errors = [];
  if (capsule?.schema_version !== PERFORMANCE_SCHEMA_VERSION) errors.push('invalid schema_version');
  if (
    !['profiled', 'stable', 'improved', 'regressed', 'no_confidence'].includes(
      capsule?.verdict?.status
    )
  ) {
    errors.push('invalid verdict.status');
  }
  if (!capsule?.subject?.repository_revision) errors.push('missing subject.repository_revision');
  if (!capsule?.adapter?.kind) errors.push('missing adapter.kind');
  if (!capsule?.scope?.target) errors.push('missing scope.target');
  if (!Array.isArray(capsule?.observed?.executions))
    errors.push('observed.executions must be an array');
  if (!Array.isArray(capsule?.observed?.hotspots))
    errors.push('observed.hotspots must be an array');
  if (!Array.isArray(capsule?.findings)) errors.push('findings must be an array');
  if (!Array.isArray(capsule?.unverified)) errors.push('unverified must be an array');
  if (!Array.isArray(capsule?.limitations)) errors.push('limitations must be an array');
  return errors;
}

export function validatePerformanceDiagnosis(report) {
  const errors = [];
  if (report?.schema_version !== PERFORMANCE_DIAGNOSIS_SCHEMA_VERSION) {
    errors.push('invalid schema_version');
  }
  if (!report?.subject?.repository_revision) errors.push('missing subject.repository_revision');
  if (!report?.adapter?.kind) errors.push('missing adapter.kind');
  if (!report?.scope?.target) errors.push('missing scope.target');
  if (!report?.diagnosis?.kind) errors.push('missing diagnosis.kind');
  if (!Array.isArray(report?.observed)) errors.push('observed must be an array');
  if (!Array.isArray(report?.inferred)) errors.push('inferred must be an array');
  if (!Array.isArray(report?.unverified)) errors.push('unverified must be an array');
  if (!report?.next_action?.kind) errors.push('missing next_action.kind');
  if (report?.verification?.operation !== 'diagnose-performance') {
    errors.push('invalid verification.operation');
  }
  if (!Array.isArray(report?.limitations)) errors.push('limitations must be an array');
  if (
    !['actionable', 'measured', 'needs_better_workload', 'no_confidence'].includes(
      report?.verdict?.status
    )
  ) {
    errors.push('invalid verdict.status');
  }
  if (validatePerformanceCapsule(report?.performance_capsule).length > 0) {
    errors.push('invalid performance_capsule');
  }
  return errors;
}

export function validateFlowPriorityManifest(manifest) {
  const errors = [];
  if (!plainObject(manifest)) return ['manifest must be an object'];
  closedObject(manifest, ['schema_version', 'flows'], 'manifest', errors);
  if (manifest.schema_version !== FLOW_PRIORITY_MANIFEST_SCHEMA_VERSION) {
    errors.push('invalid schema_version');
  }
  if (!Array.isArray(manifest.flows)) {
    errors.push('flows must be an array');
    return errors;
  }
  if (manifest.flows.length > LIMITS.campaignFlows) errors.push('flows exceed bound');
  const identifiers = new Set();
  for (const [index, flow] of manifest.flows.entries()) {
    const label = `flows[${index}]`;
    if (!plainObject(flow)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    closedObject(
      flow,
      ['candidate_id', 'frequency_weight', 'user_impact_weight', 'rationale'],
      label,
      errors
    );
    if (typeof flow.candidate_id !== 'string' || !/^[0-9a-f]{16}$/.test(flow.candidate_id)) {
      errors.push(`${label}.candidate_id is invalid`);
    } else if (identifiers.has(flow.candidate_id)) {
      errors.push(`${label}.candidate_id is duplicated`);
    } else {
      identifiers.add(flow.candidate_id);
    }
    if (!integerBetween(flow.frequency_weight, 1, 10)) {
      errors.push(`${label}.frequency_weight is invalid`);
    }
    if (!integerBetween(flow.user_impact_weight, 1, 5)) {
      errors.push(`${label}.user_impact_weight is invalid`);
    }
    if (
      typeof flow.rationale !== 'string' ||
      flow.rationale.trim() === '' ||
      flow.rationale.length > 500
    ) {
      errors.push(`${label}.rationale is invalid`);
    }
  }
  return errors;
}

export function assertFlowPriorityManifest(manifest) {
  const errors = validateFlowPriorityManifest(manifest);
  if (errors.length > 0) throw new Error(`invalid flow priority manifest: ${errors.join('; ')}`);
  return manifest;
}

export function validateFlowCampaignPlan(plan) {
  const errors = [];
  if (!plainObject(plan)) return ['plan must be an object'];
  if (plan.schema_version !== FLOW_CAMPAIGN_PLAN_SCHEMA_VERSION) {
    errors.push('invalid schema_version');
  }
  if (!plan.subject?.repository_revision) errors.push('missing subject.repository_revision');
  if (!plainObject(plan.policy)) errors.push('policy must be an object');
  if (!Array.isArray(plan.inventory?.eligible)) errors.push('inventory.eligible must be an array');
  if (!Array.isArray(plan.inventory?.excluded)) errors.push('inventory.excluded must be an array');
  if (!Array.isArray(plan.screened)) errors.push('screened must be an array');
  if (!Array.isArray(plan.ranked)) errors.push('ranked must be an array');
  if (!Array.isArray(plan.unverified)) errors.push('unverified must be an array');
  if (!Array.isArray(plan.limitations)) errors.push('limitations must be an array');
  if (!plan.next_action?.kind) errors.push('missing next_action.kind');
  if (
    !['actionable', 'measured', 'needs_better_workload', 'no_confidence'].includes(
      plan.verdict?.status
    )
  ) {
    errors.push('invalid verdict.status');
  }
  if ((plan.screened?.length ?? 0) > LIMITS.campaignFlows) errors.push('screened exceeds bound');
  for (let index = 1; index < (plan.ranked?.length ?? 0); index += 1) {
    if (plan.ranked[index - 1].priority_score < plan.ranked[index].priority_score) {
      errors.push('ranked is not descending');
      break;
    }
  }
  return errors;
}

export function assertFlowCampaignPlan(plan) {
  const errors = validateFlowCampaignPlan(plan);
  if (errors.length > 0) throw new Error(`invalid flow campaign plan: ${errors.join('; ')}`);
  return plan;
}

export function validateOptimizationVerification(report) {
  const errors = [];
  if (report?.schema_version !== OPTIMIZATION_VERIFICATION_SCHEMA_VERSION) {
    errors.push('invalid schema_version');
  }
  if (!report?.subject?.baseline_revision) errors.push('missing subject.baseline_revision');
  if (!report?.subject?.current_revision) errors.push('missing subject.current_revision');
  if (!report?.adapter?.kind) errors.push('missing adapter.kind');
  if (!report?.scope?.target) errors.push('missing scope.target');
  if (!Array.isArray(report?.observed)) errors.push('observed must be an array');
  if (!Array.isArray(report?.limitations)) errors.push('limitations must be an array');
  if (typeof report?.decisions?.mechanically_confirmed !== 'boolean') {
    errors.push('missing decisions.mechanically_confirmed');
  }
  if (typeof report?.decisions?.materially_useful !== 'boolean') {
    errors.push('missing decisions.materially_useful');
  }
  if (typeof report?.decisions?.shipping_recommended !== 'boolean') {
    errors.push('missing decisions.shipping_recommended');
  }
  if (
    !['confirmed', 'rejected', 'inconclusive', 'no_confidence'].includes(report?.verdict?.status)
  ) {
    errors.push('invalid verdict.status');
  }
  if (validatePerformanceCapsule(report?.baseline_capsule).length > 0) {
    errors.push('invalid baseline_capsule');
  }
  if (validatePerformanceCapsule(report?.current_capsule).length > 0) {
    errors.push('invalid current_capsule');
  }
  return errors;
}

export function validateFlowCapsule(capsule) {
  const errors = [];
  if (capsule?.schema_version !== FLOW_SCHEMA_VERSION) errors.push('invalid schema_version');
  if (!capsule?.subject?.repository_revision) errors.push('missing subject.repository_revision');
  if (!capsule?.adapter?.kind) errors.push('missing adapter.kind');
  if (!capsule?.scope?.target) errors.push('missing scope.target');
  if (!capsule?.root_flow_id) errors.push('missing root_flow_id');
  if (!Array.isArray(capsule?.flows) || capsule.flows.length === 0) {
    errors.push('flows must be a non-empty array');
  }
  if (!Array.isArray(capsule?.relationships)) errors.push('relationships must be an array');
  if (!Array.isArray(capsule?.limitations)) errors.push('limitations must be an array');
  if (!['captured', 'no_confidence'].includes(capsule?.verdict?.status)) {
    errors.push('invalid verdict.status');
  }
  const identifiers = new Set();
  for (const flow of Array.isArray(capsule?.flows) ? capsule.flows : []) {
    if (!flow?.id || identifiers.has(flow.id)) errors.push('flow identifiers must be unique');
    identifiers.add(flow?.id);
    if (!flow?.kind) errors.push('missing flow.kind');
    if (!Array.isArray(flow?.evidence_ids)) errors.push('flow.evidence_ids must be an array');
    if (!Array.isArray(flow?.limitations)) errors.push('flow.limitations must be an array');
  }
  if (capsule?.root_flow_id && !identifiers.has(capsule.root_flow_id)) {
    errors.push('root_flow_id does not identify a flow');
  }
  return [...new Set(errors)];
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function closedObject(value, allowed, label, errors) {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) errors.push(`${label} has unknown field: ${unknown.join(', ')}`);
}

function integerBetween(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}
