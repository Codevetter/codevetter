import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

import { assertPlaywrightCaptureId } from './playwright-capture-contracts.mjs';

export const BROWSER_OPTIMIZATION_PLAN_SCHEMA_VERSION = 'browser-optimization-plan/v1';
export const BROWSER_OPTIMIZATION_EVENT_SCHEMA_VERSION = 'browser-optimization-event/v1';
export const BROWSER_OPTIMIZATION_REPORT_SCHEMA_VERSION = 'browser-optimization-report/v1';

export const BROWSER_OPTIMIZATION_LIMITS = Object.freeze({
  idCharacters: 80,
  evidenceFamilies: 8,
  observations: 64,
  causeGroups: 32,
  experiments: 16,
  allowedFiles: 16,
  limitations: 24,
  text: 1_000,
  importFiles: 256,
  importEdges: 1_024,
  sourceBytes: 4 * 1024 * 1024,
  artifactFiles: 128,
  artifactBytes: 8 * 1024 * 1024,
  elapsedMinutes: 1_440,
  consecutiveFailures: 8,
  eventsBytes: 1024 * 1024,
});

const FAMILY_STATES = new Set(['observed', 'unavailable', 'incomplete']);
const EVIDENCE_FAMILIES = new Set([
  'browser_timing',
  'loading',
  'memory',
  'react',
  'actions',
  'dependencies',
  'build_artifact',
  'review',
]);
const EVENT_DECISIONS = new Set(['rejected', 'kept', 'no_confidence', 'crash']);
const TERMINAL_STATES = new Set([
  'active',
  'queue_exhausted',
  'plateau',
  'budget_exhausted',
  'operational_failure',
  'blocked_on_host',
]);

export function assertBrowserOptimizationLoopId(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > BROWSER_OPTIMIZATION_LIMITS.idCharacters ||
    !/^[a-z0-9][a-z0-9-]*$/.test(value)
  ) {
    throw new Error('browser optimization loop ID must use lowercase letters, digits, and hyphens');
  }
  return value;
}

export function assertBrowserOptimizationPolicy(value = {}) {
  closed(value, ['max_experiments', 'max_elapsed_minutes', 'max_failures'], 'policy');
  return {
    max_experiments: boundedInteger(
      value.max_experiments,
      'policy.max_experiments',
      1,
      BROWSER_OPTIMIZATION_LIMITS.experiments,
      8
    ),
    max_elapsed_minutes: boundedInteger(
      value.max_elapsed_minutes,
      'policy.max_elapsed_minutes',
      1,
      BROWSER_OPTIMIZATION_LIMITS.elapsedMinutes,
      120
    ),
    max_failures: boundedInteger(
      value.max_failures,
      'policy.max_failures',
      1,
      BROWSER_OPTIMIZATION_LIMITS.consecutiveFailures,
      3
    ),
  };
}

export function assertContainedOptionalPath(value, label = 'path') {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > BROWSER_OPTIMIZATION_LIMITS.text ||
    value.includes('\0') ||
    isAbsolute(value) ||
    value.split(/[\\/]/).includes('..') ||
    sensitivePath(value)
  ) {
    throw new Error(`${label} must be a bounded non-sensitive contained relative path`);
  }
  return value.replaceAll('\\', '/');
}

export function assertBrowserOptimizationPlan(value) {
  if (!plain(value)) throw new Error('browser optimization plan must be an object');
  closed(
    value,
    [
      'schema_version',
      'loop_id',
      'generation',
      'subject',
      'flow',
      'policy',
      'evidence',
      'cause_groups',
      'queue',
      'created_at',
      'planner_digest',
      'limitations',
    ],
    'plan'
  );
  if (value.schema_version !== BROWSER_OPTIMIZATION_PLAN_SCHEMA_VERSION) {
    throw new Error('browser optimization plan schema is invalid');
  }
  assertBrowserOptimizationLoopId(value.loop_id);
  integer(value.generation, 'generation', 1, 10_000);
  subject(value.subject);
  flow(value.flow);
  const policy = assertBrowserOptimizationPolicy(value.policy);
  evidence(value.evidence);
  boundedArray(value.cause_groups, 'cause_groups', BROWSER_OPTIMIZATION_LIMITS.causeGroups);
  value.cause_groups.forEach((entry, index) => causeGroup(entry, index));
  boundedArray(value.queue, 'queue', policy.max_experiments);
  value.queue.forEach((entry, index) => experiment(entry, index));
  unique(
    value.queue.map((entry) => entry.experiment_id),
    'queue experiment IDs'
  );
  unique(
    value.cause_groups.map((entry) => entry.cause_id),
    'cause group IDs'
  );
  timestamp(value.created_at, 'created_at');
  digest(value.planner_digest, 'planner_digest');
  strings(value.limitations, 'limitations', BROWSER_OPTIMIZATION_LIMITS.limitations);
  const expected = browserOptimizationPlanDigest(value);
  if (value.planner_digest !== expected) throw new Error('planner_digest is invalid');
  return value;
}

export function createBrowserOptimizationPlan(payload) {
  const plan = {
    schema_version: BROWSER_OPTIMIZATION_PLAN_SCHEMA_VERSION,
    ...payload,
    planner_digest: null,
  };
  plan.planner_digest = browserOptimizationPlanDigest(plan);
  return assertBrowserOptimizationPlan(plan);
}

export function browserOptimizationPlanDigest(value) {
  const { planner_digest: _digest, ...payload } = value ?? {};
  return sha256(stableStringify(payload));
}

export function assertBrowserOptimizationEvent(value, { sequence, planDigest } = {}) {
  if (!plain(value)) throw new Error('browser optimization event must be an object');
  closed(
    value,
    [
      'schema_version',
      'sequence',
      'generation',
      'experiment_id',
      'decision',
      'reason',
      'campaign_record_digest',
      'subject',
      'plan_digest',
      'recorded_at',
    ],
    'event'
  );
  if (value.schema_version !== BROWSER_OPTIMIZATION_EVENT_SCHEMA_VERSION) {
    throw new Error('browser optimization event schema is invalid');
  }
  integer(value.sequence, 'event.sequence', 1, BROWSER_OPTIMIZATION_LIMITS.experiments * 4);
  if (sequence !== undefined && value.sequence !== sequence) {
    throw new Error(`browser optimization event sequence must be ${sequence}`);
  }
  integer(value.generation, 'event.generation', 1, 10_000);
  canonicalId(value.experiment_id, 'event.experiment_id');
  if (!EVENT_DECISIONS.has(value.decision)) throw new Error('event.decision is invalid');
  text(value.reason, 'event.reason');
  if (value.campaign_record_digest !== null) {
    digest(value.campaign_record_digest, 'event.campaign_record_digest');
  }
  subject(value.subject);
  digest(value.plan_digest, 'event.plan_digest');
  if (planDigest && value.plan_digest !== planDigest) {
    throw new Error('event plan_digest does not match the current plan');
  }
  timestamp(value.recorded_at, 'event.recorded_at');
  return value;
}

export function assertBrowserOptimizationReport(value) {
  if (!plain(value)) throw new Error('browser optimization report must be an object');
  closed(
    value,
    [
      'schema_version',
      'loop_id',
      'generation',
      'state',
      'incumbent',
      'next_experiment',
      'verified_improvements',
      'rejected_experiments',
      'untested_experiments',
      'coverage',
      'local_cost',
      'limitations',
    ],
    'report'
  );
  if (value.schema_version !== BROWSER_OPTIMIZATION_REPORT_SCHEMA_VERSION) {
    throw new Error('browser optimization report schema is invalid');
  }
  assertBrowserOptimizationLoopId(value.loop_id);
  integer(value.generation, 'report.generation', 1, 10_000);
  if (!TERMINAL_STATES.has(value.state)) throw new Error('report.state is invalid');
  subject(value.incumbent);
  if (value.next_experiment !== null) experiment(value.next_experiment, 0);
  boundedArray(
    value.verified_improvements,
    'verified_improvements',
    BROWSER_OPTIMIZATION_LIMITS.experiments
  );
  value.verified_improvements.forEach((entry, index) => compactEvent(entry, index));
  boundedArray(
    value.rejected_experiments,
    'rejected_experiments',
    BROWSER_OPTIMIZATION_LIMITS.experiments
  );
  value.rejected_experiments.forEach((entry, index) => compactEvent(entry, index));
  boundedArray(
    value.untested_experiments,
    'untested_experiments',
    BROWSER_OPTIMIZATION_LIMITS.experiments
  );
  reportCoverage(value.coverage);
  reportLocalCost(value.local_cost);
  strings(value.limitations, 'limitations', BROWSER_OPTIMIZATION_LIMITS.limitations);
  return value;
}

function evidence(value) {
  if (!plain(value)) throw new Error('evidence must be an object');
  closed(value, ['families', 'observations'], 'evidence');
  boundedArray(value.families, 'evidence.families', BROWSER_OPTIMIZATION_LIMITS.evidenceFamilies);
  value.families.forEach((entry, index) => {
    if (!plain(entry)) throw new Error(`evidence.families[${index}] must be an object`);
    closed(entry, ['name', 'state', 'reason'], `evidence.families[${index}]`);
    if (!EVIDENCE_FAMILIES.has(entry.name)) throw new Error('evidence family name is invalid');
    if (!FAMILY_STATES.has(entry.state)) throw new Error('evidence family state is invalid');
    if (entry.reason !== null) text(entry.reason, 'evidence family reason');
  });
  unique(
    value.families.map((entry) => entry.name),
    'evidence family names'
  );
  boundedArray(
    value.observations,
    'evidence.observations',
    BROWSER_OPTIMIZATION_LIMITS.observations
  );
  value.observations.forEach((entry, index) => observation(entry, index));
}

function observation(value, index) {
  if (!plain(value)) throw new Error(`observations[${index}] must be an object`);
  closed(
    value,
    ['observation_id', 'family', 'kind', 'source', 'metric', 'provenance', 'verified'],
    `observations[${index}]`
  );
  canonicalId(value.observation_id, 'observation_id');
  if (!EVIDENCE_FAMILIES.has(value.family)) throw new Error('observation family is invalid');
  text(value.kind, 'observation kind', 120);
  if (value.source !== null) assertContainedOptionalPath(value.source, 'observation source');
  if (!plain(value.metric)) throw new Error('observation metric must be an object');
  text(value.provenance, 'observation provenance', 160);
  if (typeof value.verified !== 'boolean') throw new Error('observation verified is invalid');
}

function causeGroup(value, index) {
  if (!plain(value)) throw new Error(`cause_groups[${index}] must be an object`);
  closed(
    value,
    ['cause_id', 'mechanism', 'source', 'observation_ids', 'affected_bytes', 'runtime_share'],
    `cause_groups[${index}]`
  );
  canonicalId(value.cause_id, 'cause_id');
  text(value.mechanism, 'cause mechanism', 160);
  if (value.source !== null) assertContainedOptionalPath(value.source, 'cause source');
  strings(
    value.observation_ids,
    'cause observation_ids',
    BROWSER_OPTIMIZATION_LIMITS.observations,
    {
      canonical: true,
    }
  );
  nullableNumber(value.affected_bytes, 'cause affected_bytes', { integer: true });
  nullableNumber(value.runtime_share, 'cause runtime_share');
}

function experiment(value, index) {
  if (!plain(value)) throw new Error(`queue[${index}] must be an object`);
  closed(
    value,
    [
      'experiment_id',
      'cause_id',
      'rank',
      'hypothesis',
      'confidence_basis',
      'allowed_files',
      'predicted_metric',
      'correctness_scope',
      'performance_scope',
      'rejection_condition',
      'evidence_ids',
      'limitations',
    ],
    `queue[${index}]`
  );
  canonicalId(value.experiment_id, 'experiment_id');
  canonicalId(value.cause_id, 'experiment cause_id');
  integer(value.rank, 'experiment rank', 1, BROWSER_OPTIMIZATION_LIMITS.experiments);
  text(value.hypothesis, 'experiment hypothesis');
  text(value.confidence_basis, 'experiment confidence_basis');
  strings(
    value.allowed_files,
    'experiment allowed_files',
    BROWSER_OPTIMIZATION_LIMITS.allowedFiles,
    {
      paths: true,
    }
  );
  if (value.allowed_files.length === 0)
    throw new Error('experiment allowed_files must not be empty');
  predictedMetric(value.predicted_metric);
  correctnessScope(value.correctness_scope);
  performanceScope(value.performance_scope);
  text(value.rejection_condition, 'experiment rejection_condition');
  strings(value.evidence_ids, 'experiment evidence_ids', BROWSER_OPTIMIZATION_LIMITS.observations, {
    canonical: true,
  });
  strings(value.limitations, 'experiment limitations', BROWSER_OPTIMIZATION_LIMITS.limitations);
}

function predictedMetric(value) {
  closed(value, ['name', 'direction'], 'experiment predicted_metric');
  text(value.name, 'experiment predicted_metric.name', 160);
  if (!['decrease', 'increase'].includes(value.direction)) {
    throw new Error('experiment predicted_metric.direction is invalid');
  }
}

function correctnessScope(value) {
  if (value === null) return;
  closed(value, ['adapter', 'target', 'name'], 'experiment correctness_scope');
  if (!['node-test', 'vitest', 'jest', 'go-test'].includes(value.adapter)) {
    throw new Error('experiment correctness_scope.adapter is invalid');
  }
  assertContainedOptionalPath(value.target, 'experiment correctness_scope.target');
  text(value.name, 'experiment correctness_scope.name');
}

function performanceScope(value) {
  closed(value, ['adapter', 'target', 'name', 'project'], 'experiment performance_scope');
  if (value.adapter !== 'playwright') throw new Error('experiment performance_scope is invalid');
  assertContainedOptionalPath(value.target, 'experiment performance_scope.target');
  text(value.name, 'experiment performance_scope.name');
  if (value.project !== null) text(value.project, 'experiment performance_scope.project', 100);
}

function compactEvent(value, index) {
  closed(
    value,
    ['generation', 'experiment_id', 'decision', 'reason', 'recorded_at'],
    `report event[${index}]`
  );
  integer(value.generation, 'report event generation', 1, 10_000);
  canonicalId(value.experiment_id, 'report event experiment_id');
  if (!EVENT_DECISIONS.has(value.decision)) throw new Error('report event decision is invalid');
  text(value.reason, 'report event reason');
  timestamp(value.recorded_at, 'report event recorded_at');
}

function reportCoverage(value) {
  closed(
    value,
    ['evidence_families', 'cause_groups', 'queued', 'tested', 'source_restoration_required'],
    'report coverage'
  );
  boundedArray(
    value.evidence_families,
    'report coverage.evidence_families',
    BROWSER_OPTIMIZATION_LIMITS.evidenceFamilies
  );
  value.evidence_families.forEach((entry, index) => {
    closed(entry, ['name', 'state', 'reason'], `report evidence family[${index}]`);
    if (!EVIDENCE_FAMILIES.has(entry.name) || !FAMILY_STATES.has(entry.state)) {
      throw new Error(`report evidence family[${index}] is invalid`);
    }
    if (entry.reason !== null) text(entry.reason, `report evidence family[${index}].reason`);
  });
  unique(
    value.evidence_families.map((entry) => entry.name),
    'report evidence family names'
  );
  integer(
    value.cause_groups,
    'report coverage.cause_groups',
    0,
    BROWSER_OPTIMIZATION_LIMITS.causeGroups
  );
  integer(value.queued, 'report coverage.queued', 0, BROWSER_OPTIMIZATION_LIMITS.experiments);
  integer(value.tested, 'report coverage.tested', 0, BROWSER_OPTIMIZATION_LIMITS.experiments);
  if (typeof value.source_restoration_required !== 'boolean') {
    throw new Error('report coverage.source_restoration_required is invalid');
  }
}

function reportLocalCost(value) {
  closed(value, ['elapsed_minutes', 'experiments', 'failures'], 'report local_cost');
  nullableNumber(value.elapsed_minutes, 'report local_cost.elapsed_minutes');
  integer(
    value.experiments,
    'report local_cost.experiments',
    0,
    BROWSER_OPTIMIZATION_LIMITS.experiments
  );
  integer(value.failures, 'report local_cost.failures', 0, BROWSER_OPTIMIZATION_LIMITS.experiments);
}

function subject(value) {
  closed(
    value,
    ['repository_revision', 'source_snapshot_sha256', 'dirty'],
    'browser optimization subject'
  );
  if (
    typeof value.repository_revision !== 'string' ||
    !/^[0-9a-f]{7,64}$/i.test(value.repository_revision) ||
    !/^[0-9a-f]{64}$/.test(value.source_snapshot_sha256) ||
    typeof value.dirty !== 'boolean'
  ) {
    throw new Error('browser optimization subject is invalid');
  }
}

function flow(value) {
  if (!plain(value)) throw new Error('flow must be an object');
  closed(value, ['candidate_id', 'capture_id', 'target', 'name', 'project'], 'flow');
  canonicalId(value.candidate_id, 'flow.candidate_id', 16);
  assertPlaywrightCaptureId(value.capture_id);
  assertContainedOptionalPath(value.target, 'flow.target');
  text(value.name, 'flow.name');
  if (value.project !== null) text(value.project, 'flow.project', 100);
}

function strings(value, label, maximum, options = {}) {
  boundedArray(value, label, maximum);
  value.forEach((entry) => {
    if (options.canonical) canonicalId(entry, label);
    else if (options.paths) assertContainedOptionalPath(entry, label);
    else text(entry, label);
  });
  unique(value, label);
}

function boundedArray(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be an array with at most ${maximum} entries`);
  }
}

function text(value, label, maximum = BROWSER_OPTIMIZATION_LIMITS.text) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    value.includes('\0')
  ) {
    throw new Error(`${label} must be bounded text`);
  }
}

function canonicalId(value, label, length = 24) {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
    throw new Error(`${label} must be a canonical lowercase hex ID`);
  }
}

function integer(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
}

function boundedInteger(value, label, minimum, maximum, fallback) {
  const candidate = value === undefined ? fallback : Number(value);
  integer(candidate, label, minimum, maximum);
  return candidate;
}

function nullableNumber(value, label, { integer: requireInteger = false } = {}) {
  if (value === null) return;
  if (!Number.isFinite(value) || value < 0 || (requireInteger && !Number.isInteger(value))) {
    throw new Error(`${label} is invalid`);
  }
}

function timestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
}

function digest(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
}

function unique(value, label) {
  if (new Set(value).size !== value.length) throw new Error(`${label} must be unique`);
}

function closed(value, fields, label) {
  if (!plain(value)) throw new Error(`${label} must be an object`);
  const allowed = new Set(fields);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0) throw new Error(`${label} has unknown field: ${unknown.join(', ')}`);
}

function sensitivePath(value) {
  const normalized = value.toLowerCase().replaceAll('\\', '/');
  const name = normalized.split('/').at(-1);
  return (
    normalized.split('/').some((part) => ['.ssh', '.aws', '.kube'].includes(part)) ||
    /^\.env(?:\.|$)/.test(name) ||
    ['.npmrc', '.pypirc', '.netrc', 'credentials.json'].includes(name) ||
    /\.(?:key|pem|p12|pfx)$/.test(name)
  );
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value) {
  return JSON.stringify(sort(value));
}

function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (!plain(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sort(value[key])])
  );
}

export function browserOptimizationId(value) {
  return sha256(typeof value === 'string' ? value : stableStringify(value)).slice(0, 24);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
