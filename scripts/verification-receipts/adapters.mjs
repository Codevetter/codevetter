import { createHash } from 'node:crypto';

const CANONICAL_VERSION = 'codevetter.project-verification-receipt/v1';
const VAULT_E2E_VERSION = 1;
const SHA256 = /^[a-f0-9]{64}$/;

export function adaptVerificationReceipt(value, { repositoryId }) {
  if (value?.schema_version === CANONICAL_VERSION) {
    return { receipt: value, sourceFormat: 'canonical' };
  }
  if (isVaultE2eReceipt(value)) {
    return {
      receipt: adaptVaultE2eReceipt(value, { repositoryId }),
      sourceFormat: 'vault-e2e-profile/v1',
    };
  }
  throw new Error('unsupported verification receipt format');
}

export function adaptVaultE2eReceipt(value, { repositoryId }) {
  assertVaultE2eReceipt(value);
  if (typeof repositoryId !== 'string' || repositoryId.trim() === '') {
    throw new Error('Vault E2E receipt adaptation requires a repository identity');
  }

  const playwright = plainObject(value.playwright) ? value.playwright : null;
  const inventoryItems = Array.isArray(playwright?.inventory?.items)
    ? playwright.inventory.items
    : [];
  const executionItems = Array.isArray(playwright?.execution?.items)
    ? playwright.execution.items
    : [];
  const attempts = executionItems.map((entry, index) => adaptAttempt(entry, index));
  const attemptsByTest = groupBy(attempts, (attempt) => attempt.test_id);
  const tests = inventoryItems.map((entry) => ({
    id: requiredText(entry.id, 'playwright.inventory.items[].id'),
    file: requiredText(entry.file, 'playwright.inventory.items[].file'),
    selected_by: selectedBy(value.selection),
    reason: selectionReason(value.selection),
  }));

  for (const test of tests) {
    if (!attemptsByTest.has(test.id)) {
      attempts.push({
        id: `${test.id}:operational:1`,
        test_id: test.id,
        phase: 'primary',
        status: 'operational_failure',
        duration_ms: 0,
        failure_signature: 'runner-ended-before-test-result',
      });
    }
  }

  const terminal = terminalAttempts(attempts);
  const counts = countTerminalStatuses(terminal);
  const resource = value.stages?.playwright?.resourceUsage;
  const measuredCosts = playwright?.execution?.measuredCosts;
  const performanceBudget = value.performance?.budget;
  const inventoryComplete =
    playwright !== null &&
    Number.isInteger(playwright.execution?.completedTests) &&
    playwright.execution.completedTests === playwright.inventory?.tests;
  const executionComplete = inventoryComplete && terminal.size === tests.length;

  const receipt = {
    schema_version: CANONICAL_VERSION,
    captured_at: isoTimestamp(value.finishedAt ?? value.startedAt),
    subject: {
      repository: {
        id: repositoryId,
        revision: requiredText(value.baseCommit, 'baseCommit'),
        dirty: Boolean(value.dirtyBeforeRun),
      },
      runner: {
        id: 'vault-e2e-profile',
        version: String(value.schemaVersion),
        profile: requiredText(value.profile, 'profile'),
        command: runnerCommand(value),
      },
      environment: {
        id: `vault-e2e-${digest({ machine: value.machine, browser: value.browser }).slice(0, 16)}`,
        platform: requiredText(value.machine.platform, 'machine.platform'),
        arch: requiredText(value.machine.arch, 'machine.arch'),
        runtime: `${requiredText(value.machine.node, 'machine.node')} / ${requiredText(value.browser.version, 'browser.version')}`,
      },
    },
    selection: {
      mode: selectionMode(value.selection?.mode),
      inventory_id: inventoryIdentity(value, inventoryItems),
      inventory_total: Number.isInteger(playwright?.inventory?.tests)
        ? playwright.inventory.tests
        : tests.length,
      selector_change_allowed: false,
      changed_files: changedFiles(value.selection),
      tests,
    },
    outcome: {
      total: counts.passed + counts.failed + counts.skipped,
      passed: counts.passed,
      failed: counts.failed,
      skipped: counts.skipped,
      operational_failures: counts.operational_failures + (playwright === null ? 1 : 0),
    },
    attempts,
    metrics: {
      wall_ms: finiteNumber(value.durationMs, 0),
      cpu_ms: finiteNumber(resource?.approximateCpuSeconds, null, 1_000),
      peak_rss_bytes: finiteNumber(resource?.peakRssBytes, null),
      peak_processes: finiteInteger(resource?.peakProcessCount, null),
      samples: {
        wall_ms: Number.isFinite(value.durationMs) ? [value.durationMs] : [],
        cpu_ms: Number.isFinite(resource?.approximateCpuSeconds)
          ? [resource.approximateCpuSeconds * 1_000]
          : [],
        peak_rss_bytes: Number.isFinite(resource?.peakRssBytes) ? [resource.peakRssBytes] : [],
      },
      coverage: {
        inventory: inventoryComplete ? 'complete' : playwright ? 'partial' : 'missing',
        cpu: Number.isFinite(resource?.approximateCpuSeconds) ? 'complete' : 'missing',
        rss: Number.isFinite(resource?.peakRssBytes) ? 'complete' : 'missing',
        process_tree: Number.isFinite(resource?.peakProcessCount) ? 'complete' : 'missing',
        network: Number.isInteger(measuredCosts?.blockedLiveRequests) ? 'complete' : 'missing',
        fixed_waits: Number.isFinite(measuredCosts?.fixedWaitMs) ? 'complete' : 'missing',
        selection: executionComplete ? 'complete' : playwright ? 'partial' : 'missing',
      },
    },
    safety: {
      fixed_wait_ms: finiteNumber(measuredCosts?.fixedWaitMs, null),
      live_network_requests: finiteInteger(measuredCosts?.blockedLiveRequests, null),
      mock_cost_usd: 0,
      retries: finiteInteger(playwright?.execution?.retries, 0),
    },
    budgets: adaptBudgets(performanceBudget),
    evidence: [],
    limitations: limitations(value, { playwright, inventoryComplete, executionComplete }),
  };
  return receipt;
}

function assertVaultE2eReceipt(value) {
  if (!isVaultE2eReceipt(value)) throw new Error('receipt is not a Vault E2E profile v1 document');
  requiredText(value.runId, 'runId');
  requiredText(value.profile, 'profile');
  requiredText(value.mode, 'mode');
  requiredText(value.target, 'target');
  requiredText(value.baseCommit, 'baseCommit');
  if (!/^[a-f0-9]{40}$/.test(value.baseCommit)) throw new Error('baseCommit must be a Git SHA-1');
  if (!plainObject(value.machine)) throw new Error('machine must be an object');
  if (!plainObject(value.browser)) throw new Error('browser must be an object');
  isoTimestamp(value.startedAt);
  if (value.finishedAt !== undefined) isoTimestamp(value.finishedAt);
  if (!Number.isFinite(value.durationMs) || value.durationMs < 0) {
    throw new Error('durationMs must be a non-negative number');
  }
  if (value.packageLockSha256 !== undefined && !SHA256.test(value.packageLockSha256)) {
    throw new Error('packageLockSha256 must be a SHA-256 digest');
  }
}

function isVaultE2eReceipt(value) {
  return (
    plainObject(value) &&
    value.schemaVersion === VAULT_E2E_VERSION &&
    typeof value.runId === 'string' &&
    typeof value.baseCommit === 'string' &&
    plainObject(value.selection) &&
    plainObject(value.stages)
  );
}

function adaptAttempt(entry, index) {
  if (!plainObject(entry))
    throw new Error(`playwright.execution.items[${index}] must be an object`);
  const testId = requiredText(entry.id, `playwright.execution.items[${index}].id`);
  const status = attemptStatus(entry.status);
  const signature = failureSignature(entry, status);
  return {
    id: `${testId}:attempt:${index + 1}`,
    test_id: testId,
    phase: Number.isInteger(entry.retry) && entry.retry > 0 ? 'recheck' : 'primary',
    status,
    duration_ms: finiteNumber(entry.durationMs, 0),
    failure_signature: signature,
  };
}

function attemptStatus(status) {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  if (status === 'timedOut') return 'timed_out';
  if (status === 'skipped') return 'skipped';
  return 'operational_failure';
}

function failureSignature(entry, status) {
  if (status === 'passed' || status === 'skipped') return null;
  const signature = entry.errors?.find((error) => typeof error?.signature === 'string')?.signature;
  return signature?.slice(0, 1_024) ?? `playwright-${status}`;
}

function terminalAttempts(attempts) {
  const terminal = new Map();
  for (const attempt of attempts) terminal.set(attempt.test_id, attempt);
  return terminal;
}

function countTerminalStatuses(terminal) {
  const counts = { passed: 0, failed: 0, skipped: 0, operational_failures: 0 };
  for (const attempt of terminal.values()) {
    if (attempt.status === 'passed') counts.passed += 1;
    else if (attempt.status === 'failed' || attempt.status === 'timed_out') counts.failed += 1;
    else if (attempt.status === 'skipped') counts.skipped += 1;
    else counts.operational_failures += 1;
  }
  return counts;
}

function adaptBudgets(budget) {
  const maxima = {
    wall_ms: finiteNumber(budget?.wallTimeMs, null),
    cpu_ms: finiteNumber(budget?.cpuSeconds, null, 1_000),
    peak_rss_bytes: finiteNumber(budget?.peakRssBytes, null),
    peak_processes: null,
    fixed_wait_ms: finiteNumber(budget?.fixedWaitMs, null),
    live_network_requests: finiteInteger(budget?.blockedLiveRequests, null),
    retries: null,
  };
  return {
    policy_id: 'vault-e2e-profile-v1',
    maxima,
    required_metrics: Object.entries(maxima)
      .filter(([, maximum]) => maximum !== null)
      .map(([metric]) => metric),
    regression: {
      relative_percent: 0,
      wall_absolute_ms: 0,
      cpu_absolute_ms: 0,
      peak_rss_absolute_bytes: 0,
      peak_processes_absolute: 0,
    },
  };
}

function limitations(value, { playwright, inventoryComplete, executionComplete }) {
  const items = [
    'Adapted from the Vault E2E profile v1 producer; the raw source receipt remains authoritative.',
    'The producer does not declare controlled comparison materiality thresholds.',
  ];
  if (!playwright) items.push('The runner ended before Playwright produced inventory or attempts.');
  if (!inventoryComplete) items.push('Test inventory coverage is incomplete.');
  if (!executionComplete) items.push('Selection-to-execution coverage is incomplete.');
  if (value.dirtyBeforeRun) items.push('The source repository was dirty before execution.');
  if (value.error) items.push(`Runner operational failure: ${String(value.error).slice(0, 900)}`);
  return [...new Set(items)].sort();
}

function inventoryIdentity(value, items) {
  return `vault-e2e-${digest({ packageLockSha256: value.packageLockSha256 ?? null, items })}`;
}

function runnerCommand(value) {
  return [
    'node scripts/run-e2e-profile.mjs',
    `--profile=${value.profile}`,
    `--mode=${value.mode}`,
    `--workers=${value.workers}`,
    `--target=${value.target}`,
  ].join(' ');
}

function selectionMode(mode) {
  if (mode === 'NONE') return 'none';
  if (mode === 'ALL') return 'all';
  return 'scoped';
}

function selectionReason(selection) {
  if (selection?.mode === 'ALL') return 'all tests selected by the producer';
  return 'selected by the producer';
}

function selectedBy(selection) {
  return selection?.mode === 'ALL' ? [] : changedFiles(selection);
}

function changedFiles(selection) {
  return Array.isArray(selection?.changedFiles)
    ? [...new Set(selection.changedFiles.filter((entry) => typeof entry === 'string'))].sort()
    : [];
}

function groupBy(items, key) {
  const grouped = new Map();
  for (const item of items) {
    const name = key(item);
    const entries = grouped.get(name) ?? [];
    entries.push(item);
    grouped.set(name, entries);
  }
  return grouped;
}

function finiteNumber(value, fallback, multiplier = 1) {
  return Number.isFinite(value) && value >= 0 ? value * multiplier : fallback;
}

function finiteInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function requiredText(value, path) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be text`);
  return value;
}

function isoTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('receipt timestamp must be ISO-8601 text');
  }
  return new Date(value).toISOString();
}

function digest(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  return JSON.stringify(sort(value));
}

function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (!plainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sort(value[key])])
  );
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
