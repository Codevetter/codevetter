import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { LIMITS, PROFILE_ADAPTERS, repositoryRelative } from './contracts.mjs';
import { inspectGitDiff } from './git-diff.mjs';

export const PERFORMANCE_EXECUTION_PLAN_SCHEMA_VERSION = 'performance-execution-plan/v1';
export const PERFORMANCE_EXECUTION_RECEIPT_SCHEMA_VERSION = 'performance-execution-receipt/v1';

const MAX_SOURCE_BYTES = 512 * 1024;
const GOVERNED_ADAPTERS = Object.freeze([...PROFILE_ADAPTERS, 'go-test']);
const NODE_ADAPTERS = new Set(['node-test', 'node-script', 'vitest']);
const LOOPBACK_URL =
  /^(?:https?|wss?):\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::(?:\d+|\$\{[^}]+\}))?(?:[/?#]|$)/i;
const URL_LITERAL = /(?:https?|wss?):\/\/[^\s'"`<>)]+/gi;
const DYNAMIC_NETWORK_CALL =
  /\b(?:fetch|axios(?:\.[A-Za-z]+)?|got|ky|https?\.request|new\s+WebSocket)\s*\(\s*(?!['"`]https?:\/\/(?:localhost|127\.|\[::1\]))/i;
const REMOTE_SERVICE =
  /\b(?:postgres(?:ql)?|mysql|mongodb|redis|supabase|firebase|dynamodb|cloudflare|workers\s*ai|openai|anthropic|openrouter|stripe)\b/i;
const CLOUDFLARE_SERVICE =
  /\b(?:DurableObject|browser\s+rendering|Workers\s+AI|env\.(?:D1|R2|KV)|(?:D1|R2|KV)Database)\b/i;
const SUBPROCESS_NETWORK_ESCAPE =
  /(?:from\s+['"]node:child_process['"]|require\s*\(\s*['"](?:node:)?child_process['"]\s*\)|\b(?:spawn|exec|execFile)\s*\()/;
const FORBIDDEN_WORKLOAD =
  /\b(?:load[-_ ]?test|soak|stress[-_ ]?test|production[-_ ]?(?:profile|load|test))\b/i;

export async function planPerformanceExecution({
  repositoryRoot,
  adapter,
  target,
  name = null,
  timeoutMs,
  processCount = 1,
  approvalIdentity = null,
}) {
  const root = await realpath(resolve(repositoryRoot));
  if (!GOVERNED_ADAPTERS.includes(adapter)) throw new Error(`unsupported adapter: ${adapter}`);
  const safeTarget = await inspectTarget(root, target);
  const git = await inspectGitDiff(root);
  const signals = inspectSafetySignals(safeTarget.source, { adapter, target, name });
  const enforcement = enforcementFor(adapter);
  const blockers = [...signals.blockers];
  if (enforcement.kind === 'unavailable') blockers.push(enforcement.reason);
  if (adapter === 'playwright' && signals.loopback_urls.length === 0) {
    blockers.push('Playwright zero-egress admission requires an explicit loopback URL.');
  }
  const maxDurationMs = boundedTotalDuration(timeoutMs, processCount);
  const decision = blockers.length === 0 ? 'admitted' : 'blocked';
  const maximumCostMicrousd = decision === 'admitted' ? 0 : signals.unknown_cost ? null : 0;
  const payload = {
    schema_version: PERFORMANCE_EXECUTION_PLAN_SCHEMA_VERSION,
    subject: {
      repository_revision: git.repository_revision,
      diff_identity: git.diff_identity,
      dirty: git.dirty,
      target_sha256: sha256(safeTarget.source),
    },
    scope: { adapter, target: safeTarget.relative, name },
    mode: 'local_zero_egress',
    limits: {
      max_wall_time_ms: maxDurationMs,
      max_processes: processCount,
      max_concurrency: 1,
      max_retries: 0,
      max_external_requests: 0,
      max_cost_microusd: maximumCostMicrousd,
    },
    external_services: signals.external_services,
    approval_identity: normalizeApprovalIdentity(approvalIdentity),
    enforcement,
    decision: {
      status: decision,
      reason:
        decision === 'admitted'
          ? 'The exact workload is admitted for bounded local zero-egress execution.'
          : 'The workload is blocked before project code executes.',
      blockers: [...new Set(blockers)].sort(),
    },
    limitations: signals.limitations,
  };
  const plan = { ...payload, plan_id: sha256(stableStringify(payload)) };
  assertPerformanceExecutionPlan(plan);
  return plan;
}

export function createPerformanceExecutionReceipt(plan, executions = []) {
  assertPerformanceExecutionPlan(plan);
  const markers = executions.flatMap((entry) =>
    blockedEgressMarkers(entry.execution?.stderr ?? '')
  );
  const outcome = summarizeReceiptOutcome(plan, executions, markers);
  const receipt = {
    schema_version: PERFORMANCE_EXECUTION_RECEIPT_SCHEMA_VERSION,
    plan_id: plan.plan_id,
    decision: plan.decision.status,
    status: outcome.status,
    planned: plan.limits,
    observed: summarizeReceiptObservations(plan, executions, markers),
    enforcement: plan.enforcement,
    terminal_reason: outcome.reason,
    limitations: [...plan.limitations],
  };
  assertPerformanceExecutionReceipt(receipt);
  return receipt;
}

function summarizeReceiptOutcome(plan, executions, markers) {
  if (plan.decision.status === 'blocked') {
    return { status: 'blocked', reason: plan.decision.blockers.join(' ') };
  }
  if (markers.length > 0) {
    return {
      status: 'policy_violation',
      reason: 'The zero-egress boundary blocked a remote network attempt.',
    };
  }
  if (executions.length === 0) {
    return { status: 'admitted', reason: 'The workload is admitted but has not executed.' };
  }
  const completed = executions.every(
    (entry) => entry.execution?.status === 'exited' && entry.execution?.exitCode === 0
  );
  return completed
    ? {
        status: 'completed',
        reason: 'The admitted local workload completed within the execution policy.',
      }
    : {
        status: 'failed',
        reason: 'The admitted local workload did not complete successfully.',
      };
}

function summarizeReceiptObservations(plan, executions, markers) {
  return {
    wall_time_ms: executions.reduce(
      (total, entry) => total + Math.max(0, entry.execution?.durationMs ?? 0),
      0
    ),
    processes: executions.length,
    max_concurrency: executions.length > 0 ? 1 : 0,
    retries: 0,
    successful_external_requests: 0,
    blocked_external_attempts: markers.length,
    external_services: [],
    cost_microusd: plan.decision.status === 'admitted' ? 0 : null,
  };
}

export async function assertPerformanceExecutionPlanCurrent({
  plan,
  repositoryRoot,
  adapter,
  target,
  name = null,
}) {
  assertPerformanceExecutionPlan(plan);
  const root = await realpath(resolve(repositoryRoot));
  const safeTarget = await inspectTarget(root, target);
  const git = await inspectGitDiff(root);
  if (
    plan.scope.adapter !== adapter ||
    plan.scope.target !== safeTarget.relative ||
    plan.scope.name !== name ||
    plan.subject.repository_revision !== git.repository_revision ||
    plan.subject.diff_identity !== git.diff_identity ||
    plan.subject.dirty !== git.dirty ||
    plan.subject.target_sha256 !== sha256(safeTarget.source)
  ) {
    throw new Error('performance execution plan identity is stale');
  }
  return plan;
}

export function assertPerformanceExecutionPlan(value) {
  const errors = validatePerformanceExecutionPlan(value);
  if (errors.length > 0)
    throw new Error(`invalid performance execution plan: ${errors.join('; ')}`);
  return value;
}

export function validatePerformanceExecutionPlan(value) {
  const errors = [];
  if (!plainObject(value)) return ['plan must be an object'];
  closed(
    value,
    [
      'schema_version',
      'plan_id',
      'subject',
      'scope',
      'mode',
      'limits',
      'external_services',
      'approval_identity',
      'enforcement',
      'decision',
      'limitations',
    ],
    'plan',
    errors
  );
  if (value.schema_version !== PERFORMANCE_EXECUTION_PLAN_SCHEMA_VERSION)
    errors.push('invalid schema_version');
  if (!/^[0-9a-f]{64}$/.test(value.plan_id ?? '')) errors.push('plan_id is invalid');
  validatePlanSubject(value.subject, errors);
  validatePlanScope(value.scope, errors);
  if (value.mode !== 'local_zero_egress') errors.push('mode is invalid');
  validateLimits(value.limits, errors);
  if (!Array.isArray(value.external_services)) errors.push('external_services must be an array');
  if (
    value.approval_identity !== null &&
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.approval_identity)
  )
    errors.push('approval_identity is invalid');
  validateEnforcement(value.enforcement, errors);
  validatePlanDecision(value.decision, errors);
  if (!stringArray(value.external_services)) errors.push('external_services must be an array');
  if (!stringArray(value.limitations)) errors.push('limitations must be an array');
  const { plan_id: _planId, ...payload } = value;
  if (value.plan_id && value.plan_id !== sha256(stableStringify(payload)))
    errors.push('plan_id does not match content');
  return errors;
}

function validatePlanSubject(value, errors) {
  closed(
    value,
    ['repository_revision', 'diff_identity', 'dirty', 'target_sha256'],
    'subject',
    errors
  );
  if (!plainObject(value)) return errors.push('subject is invalid');
  const valid =
    /^[0-9a-f]{40,64}$/.test(value.repository_revision ?? '') &&
    typeof value.diff_identity === 'string' &&
    value.diff_identity.length > 0 &&
    value.diff_identity.length <= 200 &&
    typeof value.dirty === 'boolean' &&
    /^[0-9a-f]{64}$/.test(value.target_sha256 ?? '');
  if (!valid) errors.push('subject is invalid');
}

function validatePlanScope(value, errors) {
  closed(value, ['adapter', 'target', 'name'], 'scope', errors);
  if (!plainObject(value)) return errors.push('scope is invalid');
  const valid =
    GOVERNED_ADAPTERS.includes(value.adapter) &&
    typeof value.target === 'string' &&
    value.target.length > 0 &&
    (value.name === null || typeof value.name === 'string');
  if (!valid) errors.push('scope is invalid');
}

function validateEnforcement(value, errors) {
  closed(value, ['kind', 'network_scope', 'reason'], 'enforcement', errors);
  if (!plainObject(value)) return errors.push('enforcement is invalid');
  const validKinds = ['node_preload', 'macos_sandbox_node_preload', 'macos_sandbox', 'unavailable'];
  if (!validKinds.includes(value.kind)) errors.push('enforcement is invalid');
  if (!['none', 'loopback_only', 'unknown'].includes(value.network_scope))
    errors.push('enforcement.network_scope is invalid');
}

function validatePlanDecision(value, errors) {
  closed(value, ['status', 'reason', 'blockers'], 'decision', errors);
  if (!plainObject(value)) return errors.push('decision is invalid');
  const valid =
    ['admitted', 'blocked'].includes(value.status) &&
    typeof value.reason === 'string' &&
    value.reason.length > 0 &&
    stringArray(value.blockers);
  if (!valid) errors.push('decision is invalid');
}

export function assertPerformanceExecutionReceipt(value) {
  const errors = validatePerformanceExecutionReceipt(value);
  if (errors.length > 0)
    throw new Error(`invalid performance execution receipt: ${errors.join('; ')}`);
  return value;
}

export function validatePerformanceExecutionReceipt(value) {
  const errors = [];
  if (!plainObject(value)) return ['receipt must be an object'];
  closed(
    value,
    [
      'schema_version',
      'plan_id',
      'decision',
      'status',
      'planned',
      'observed',
      'enforcement',
      'terminal_reason',
      'limitations',
    ],
    'receipt',
    errors
  );
  if (value.schema_version !== PERFORMANCE_EXECUTION_RECEIPT_SCHEMA_VERSION)
    errors.push('invalid schema_version');
  if (!/^[0-9a-f]{64}$/.test(value.plan_id ?? '')) errors.push('plan_id is invalid');
  if (!['admitted', 'blocked'].includes(value.decision)) errors.push('decision is invalid');
  if (!['admitted', 'blocked', 'completed', 'failed', 'policy_violation'].includes(value.status))
    errors.push('status is invalid');
  validateLimits(value.planned, errors);
  validateReceiptObservations(value.observed, errors);
  validateEnforcement(value.enforcement, errors);
  if (typeof value.terminal_reason !== 'string' || value.terminal_reason.length === 0)
    errors.push('terminal_reason is invalid');
  if (!stringArray(value.limitations)) errors.push('limitations must be an array');
  return errors;
}

function validateReceiptObservations(value, errors) {
  if (!plainObject(value)) return errors.push('observed is invalid');
  closed(
    value,
    [
      'wall_time_ms',
      'processes',
      'max_concurrency',
      'retries',
      'successful_external_requests',
      'blocked_external_attempts',
      'external_services',
      'cost_microusd',
    ],
    'observed',
    errors
  );
  for (const field of [
    'wall_time_ms',
    'processes',
    'max_concurrency',
    'retries',
    'successful_external_requests',
    'blocked_external_attempts',
  ]) {
    if (!Number.isInteger(value[field]) || value[field] < 0)
      errors.push(`observed.${field} is invalid`);
  }
  if (!stringArray(value.external_services)) errors.push('observed.external_services is invalid');
  if (value.cost_microusd === null) return;
  if (!Number.isInteger(value.cost_microusd) || value.cost_microusd < 0)
    errors.push('observed.cost_microusd is invalid');
}

export function blockedEgressMarkers(stderr) {
  return String(stderr)
    .split(/\r?\n/)
    .filter((line) => line.startsWith('CODEVETTER_EGRESS_BLOCKED '))
    .slice(0, 32)
    .map((line) => {
      try {
        return JSON.parse(line.slice('CODEVETTER_EGRESS_BLOCKED '.length));
      } catch {
        return { kind: 'unknown', destination: '<invalid-marker>' };
      }
    });
}

function inspectSafetySignals(source, { adapter, target, name }) {
  const blockers = [];
  const externalServices = new Set();
  const urls = [...source.matchAll(URL_LITERAL)].map((match) => match[0]);
  const remoteUrls = urls.filter((url) => !LOOPBACK_URL.test(url));
  const loopbackUrls = urls.filter((url) => LOOPBACK_URL.test(url));
  for (const url of remoteUrls) {
    try {
      externalServices.add(new URL(url).hostname.toLowerCase());
    } catch {
      externalServices.add('unknown-remote-endpoint');
    }
  }
  if (remoteUrls.length > 0) blockers.push('The workload contains a non-loopback endpoint.');
  if (DYNAMIC_NETWORK_CALL.test(source)) {
    blockers.push(
      'The workload contains a network call whose destination is not a literal loopback URL.'
    );
    externalServices.add('unknown-dynamic-endpoint');
  }
  if (REMOTE_SERVICE.test(source) || CLOUDFLARE_SERVICE.test(source)) {
    blockers.push(
      'The workload contains a hosted or paid service signal with unknown execution cost.'
    );
    externalServices.add('unknown-hosted-service');
  }
  if (SUBPROCESS_NETWORK_ESCAPE.test(source)) {
    blockers.push(
      'The workload can launch a subprocess outside the portable Node zero-egress guard.'
    );
  }
  if (FORBIDDEN_WORKLOAD.test(`${target} ${name ?? ''} ${source}`)) {
    blockers.push('Autonomous load, soak, stress, and production profiling is unsupported.');
  }
  return {
    blockers,
    external_services: [...externalServices].sort(),
    loopback_urls: loopbackUrls,
    unknown_cost:
      remoteUrls.length > 0 ||
      DYNAMIC_NETWORK_CALL.test(source) ||
      REMOTE_SERVICE.test(source) ||
      CLOUDFLARE_SERVICE.test(source),
    limitations: [
      adapter === 'playwright'
        ? 'Browser execution is admitted only for explicit loopback targets.'
        : 'Admission applies only to the exact repository-owned workload identity.',
    ],
  };
}

function enforcementFor(adapter) {
  if (process.platform === 'darwin') {
    return NODE_ADAPTERS.has(adapter) || adapter === 'playwright'
      ? { kind: 'macos_sandbox_node_preload', network_scope: 'loopback_only' }
      : { kind: 'macos_sandbox', network_scope: 'none' };
  }
  if (NODE_ADAPTERS.has(adapter)) return { kind: 'node_preload', network_scope: 'loopback_only' };
  return {
    kind: 'unavailable',
    network_scope: 'unknown',
    reason: `Portable zero-egress enforcement is unavailable for ${adapter} on ${process.platform}.`,
  };
}

async function inspectTarget(root, target) {
  if (typeof target !== 'string' || target.length === 0 || isAbsolute(target))
    throw new Error('target must be a repository-relative file');
  const absolute = resolve(root, target);
  const relative = repositoryRelative(root, absolute);
  if (relative === null) throw new Error('target escapes repository');
  const resolved = await realpath(absolute);
  if (repositoryRelative(root, resolved) === null)
    throw new Error('target symlink escapes repository');
  const metadata = await stat(resolved);
  if (!metadata.isFile() || metadata.size > MAX_SOURCE_BYTES)
    throw new Error('target must be a bounded regular file');
  return { relative, source: await readFile(resolved, 'utf8') };
}

function validateLimits(value, errors) {
  if (!plainObject(value)) {
    errors.push('limits are invalid');
    return;
  }
  closed(
    value,
    [
      'max_wall_time_ms',
      'max_processes',
      'max_concurrency',
      'max_retries',
      'max_external_requests',
      'max_cost_microusd',
    ],
    'limits',
    errors
  );
  const exact = { max_concurrency: 1, max_retries: 0, max_external_requests: 0 };
  for (const [field, expected] of Object.entries(exact))
    if (value[field] !== expected) errors.push(`limits.${field} must equal ${expected}`);
  if (
    !Number.isInteger(value.max_wall_time_ms) ||
    value.max_wall_time_ms < 100 ||
    value.max_wall_time_ms > LIMITS.maximumTimeoutMs * 64
  )
    errors.push('limits.max_wall_time_ms is invalid');
  if (!Number.isInteger(value.max_processes) || value.max_processes < 1 || value.max_processes > 64)
    errors.push('limits.max_processes is invalid');
  if (value.max_cost_microusd !== null && value.max_cost_microusd !== 0)
    errors.push('limits.max_cost_microusd is invalid');
}

function boundedTotalDuration(timeoutMs, processCount) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > LIMITS.maximumTimeoutMs)
    throw new Error('timeout is outside the performance execution bound');
  if (!Number.isInteger(processCount) || processCount < 1 || processCount > 64)
    throw new Error('process count is outside the performance execution bound');
  return timeoutMs * processCount;
}

function normalizeApprovalIdentity(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    throw new Error('approval identity is invalid');
  return value;
}

function closed(value, allowed, label, errors) {
  if (!plainObject(value)) return;
  const keys = new Set(allowed);
  for (const key of Object.keys(value))
    if (!keys.has(key)) errors.push(`${label} contains unknown field: ${key}`);
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!plainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])])
  );
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
