import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compareReceiptDocuments, ingestReceiptDocument } from './analyze.mjs';
import { adaptVaultE2eReceipt } from './adapters.mjs';
import {
  RECEIPT_SCHEMA_VERSION,
  assertValidReceipt,
  loadReceipt,
  sha256,
  stableStringify,
  validateReceipt,
} from './contracts.mjs';
import { runCli } from './cli.mjs';
import { createMcpHandler } from './mcp.mjs';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

test('ingestion is deterministic and keeps observed graph evidence separate', () => {
  const receipt = makeReceipt();
  const bytes = Buffer.from(stableStringify(receipt));
  const first = ingest(receipt, 'receipts/run.json', sha256(bytes));
  const second = ingest(structuredClone(receipt), 'receipts/run.json', sha256(bytes));
  assert.deepEqual(first, second);
  assert.equal(first.verdict.overall, 'passed');
  assert.equal(first.blast_radius.edges.filter((edge) => edge.kind === 'selected_by').length, 2);
  assert.equal(first.evidence[0].kind, 'runtime-performance-capsule');
  assert.equal('raw' in first.source_receipt, false);
});

test('performance budget failure does not change correctness evidence', () => {
  const receipt = makeReceipt();
  receipt.metrics.peak_rss_bytes = 3_000;
  const bundle = ingest(receipt);
  assert.equal(bundle.verdict.correctness, 'passed');
  assert.equal(bundle.verdict.performance, 'failed');
  assert.equal(bundle.verdict.overall, 'failed');
  assert.equal(
    bundle.budget_results.find((entry) => entry.metric === 'peak_rss_bytes').status,
    'failed'
  );
});

test('transient recovery and stable failures remain distinct', () => {
  const receipt = makeReceipt();
  receipt.attempts = [
    attempt('checkout-1', 'checkout', 'primary', 'failed', 'expected-200-received-500'),
    attempt('checkout-2', 'checkout', 'recheck', 'passed', null),
    attempt('cart-1', 'cart', 'primary', 'failed', 'total-was-null'),
  ];
  receipt.safety.retries = 1;
  receipt.outcome = { total: 2, passed: 1, failed: 1, skipped: 0, operational_failures: 0 };
  const bundle = ingest(receipt);
  assert.deepEqual(bundle.taxonomy.transient_recoveries[0].failure_signatures, [
    'expected-200-received-500',
  ]);
  assert.equal(bundle.taxonomy.stable_failures[0].signature, 'total-was-null');
  assert.ok(bundle.blast_radius.edges.some((edge) => edge.kind === 'failed_with'));
});

test('same-commit comparison classifies material resource and failure regressions', () => {
  const baseline = makeReceipt();
  const current = makeReceipt();
  current.metrics.wall_ms = 150;
  current.metrics.samples.wall_ms = [145, 150, 155];
  current.attempts[0] = attempt(
    'checkout-1',
    'checkout',
    'primary',
    'failed',
    'checkout-regressed'
  );
  current.outcome = { total: 2, passed: 1, failed: 1, skipped: 0, operational_failures: 0 };
  const comparison = compare(baseline, current);
  assert.equal(comparison.compatibility.kind, 'same_commit');
  assert.equal(
    comparison.metrics.find((metric) => metric.metric === 'wall_ms').conclusion,
    'regressed'
  );
  assert.deepEqual(comparison.failures.new, ['checkout-regressed']);
  assert.equal(comparison.verdict.status, 'regressed');
  assert.equal(comparison.verdict.controlled_performance_claim, true);
});

test('cross-commit comparison reports observations without a controlled claim', () => {
  const baseline = makeReceipt();
  const current = makeReceipt();
  current.subject.repository.revision = 'b'.repeat(40);
  current.metrics.wall_ms = 80;
  const comparison = compare(baseline, current);
  assert.equal(comparison.compatibility.kind, 'cross_commit');
  assert.equal(comparison.verdict.status, 'observed_only');
  assert.equal(comparison.verdict.controlled_performance_claim, false);
  assert.ok(comparison.limitations.some((item) => item.includes('cross-commit')));
});

test('incompatible identities refuse comparison', () => {
  const baseline = makeReceipt();
  const current = makeReceipt();
  current.subject.environment.id = 'different-machine';
  const comparison = compare(baseline, current);
  assert.equal(comparison.compatibility.kind, 'incompatible');
  assert.equal(comparison.verdict.status, 'no_confidence');
  assert.equal(comparison.metrics[0].conclusion, 'unavailable');
});

test('selector narrowing is classified independently', () => {
  const baseline = makeReceipt();
  const current = makeReceipt();
  current.selection.tests = [current.selection.tests[0]];
  current.attempts = [current.attempts[0]];
  current.outcome = { total: 1, passed: 1, failed: 0, skipped: 0, operational_failures: 0 };
  const comparison = compare(baseline, current);
  assert.equal(comparison.inventory.classification, 'unsafe_selector_narrowing');
  assert.equal(comparison.verdict.status, 'regressed');
});

test('aggregate inventory-count changes remain explicit drift', () => {
  const baseline = makeReceipt();
  const current = makeReceipt();
  current.selection.inventory_total += 1;
  const comparison = compare(baseline, current);
  assert.equal(comparison.inventory.classification, 'inventory_drift');
});

test('closed validation rejects unknown fields and credential-shaped content', () => {
  const unknown = makeReceipt();
  unknown.subject.repository.branch = 'main';
  assert.match(validateReceipt(unknown).join('\n'), /branch is unknown/);
  const secret = makeReceipt();
  secret.limitations.push('api_key=supersecretvalue');
  assert.match(validateReceipt(secret).join('\n'), /credential-shaped/);
  assert.throws(() => assertValidReceipt(secret), /invalid verification receipt/);
  assert.throws(() => ingest(makeReceipt(), '../receipt.json'), /source receipt path/);
});

test('enumerated test outcomes must match terminal attempts', () => {
  const receipt = makeReceipt();
  receipt.outcome = { total: 2, passed: 1, failed: 1, skipped: 0, operational_failures: 0 };
  assert.match(validateReceipt(receipt).join('\n'), /outcome counts do not match/);
});

test('receipt loading rejects traversal and escaping symlinks', async (context) => {
  const root = await temporaryDirectory(context);
  const outside = await temporaryDirectory(context);
  await writeJson(join(root, 'receipt.json'), makeReceipt());
  await writeJson(join(outside, 'outside.json'), makeReceipt());
  assert.equal(
    (await loadReceipt(root, 'receipt.json')).receipt.schema_version,
    RECEIPT_SCHEMA_VERSION
  );
  await assert.rejects(loadReceipt(root, '../outside.json'), /repository-relative|traversal/);
  await symlink(join(outside, 'outside.json'), join(root, 'link.json'));
  await assert.rejects(loadReceipt(root, 'link.json'), /escapes repository scope/);
});

test('CLI and MCP return the same normalized bundle and MCP stays read-only', async (context) => {
  const root = await temporaryDirectory(context);
  await mkdir(join(root, 'receipts'));
  await writeJson(join(root, 'receipts/run.json'), makeReceipt());
  let output = '';
  const code = await runCli(
    ['ingest', '--repo', root, '--receipt', 'receipts/run.json', '--output', 'bundle.json'],
    {
      cwd: root,
      stdout: {
        write: (chunk) => {
          output += chunk;
        },
      },
    }
  );
  assert.equal(code, 0);
  const cliBundle = JSON.parse(output);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'bundle.json'), 'utf8')), cliBundle);
  await assert.rejects(
    runCli([
      'ingest',
      '--repo',
      root,
      '--receipt',
      'receipts/run.json',
      '--output',
      'receipts/run.json',
    ]),
    /must not overwrite/
  );

  const handle = await createMcpHandler(root);
  const response = await handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'ingest_verification_receipt', arguments: { receipt: 'receipts/run.json' } },
  });
  assert.deepEqual(response.result.structuredContent.result, cliBundle);
  const escaped = await handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'ingest_verification_receipt', arguments: { receipt: '../outside.json' } },
  });
  assert.equal(escaped.result.isError, true);
});

test('CLI exit codes distinguish regression and no-confidence evidence', async (context) => {
  const root = await temporaryDirectory(context);
  const baseline = makeReceipt();
  const current = makeReceipt();
  current.metrics.wall_ms = 150;
  await writeJson(join(root, 'baseline.json'), baseline);
  await writeJson(join(root, 'current.json'), current);
  const sink = { write: () => {} };
  assert.equal(
    await runCli(
      ['compare', '--repo', root, '--baseline', 'baseline.json', '--current', 'current.json'],
      { cwd: root, stdout: sink }
    ),
    1
  );

  const incomplete = makeReceipt();
  incomplete.metrics.coverage.inventory = 'partial';
  await writeJson(join(root, 'incomplete.json'), incomplete);
  assert.equal(
    await runCli(['ingest', '--repo', root, '--receipt', 'incomplete.json'], {
      cwd: root,
      stdout: sink,
    }),
    2
  );
});

test('real CodeVetter runner projection preserves aggregate and RSS limitations', async () => {
  const path = 'scripts/verification-receipts/fixtures/codevetter-local-fast-2026-08-07.json';
  const loaded = await loadReceipt(ROOT, path);
  const bundle = ingestReceiptDocument(loaded.receipt, {
    sourcePath: loaded.relativePath,
    sourceSha256: loaded.sha256,
  });
  assert.equal(bundle.observed.outcome.passed, 79);
  assert.equal(bundle.observed.metrics.wall_ms, 13800);
  assert.equal(bundle.verdict.inventory, 'no_confidence');
  assert.ok(
    bundle.limitations.some((item) => item.includes('Process-tree resource coverage is partial'))
  );
  assert.equal(
    bundle.evidence[0].sha256,
    '9d9d1e71faf54640b70f17c522a1ddba4e4d368f0a5384363915ac7a3b947c96'
  );
});

test('Vault E2E receipts adapt without upgrading producer evidence', async (context) => {
  const raw = makeVaultReceipt();
  const receipt = adaptVaultE2eReceipt(raw, { repositoryId: 'vault-frontend' });
  assert.equal(receipt.schema_version, RECEIPT_SCHEMA_VERSION);
  assert.equal(receipt.subject.repository.revision, raw.baseCommit);
  assert.equal(receipt.selection.tests.length, 2);
  assert.equal(receipt.outcome.passed, 1);
  assert.equal(receipt.outcome.failed, 1);
  assert.equal(receipt.metrics.cpu_ms, 4_200);
  assert.equal(receipt.safety.live_network_requests, 0);
  assert.ok(receipt.limitations.some((item) => item.includes('raw source receipt')));
  assertValidReceipt(receipt);

  const root = await temporaryDirectory(context);
  await writeJson(join(root, 'package.json'), { name: 'vault-frontend' });
  await writeJson(join(root, 'raw.json'), raw);
  const loaded = await loadReceipt(root, 'raw.json');
  assert.equal(loaded.sourceFormat, 'vault-e2e-profile/v1');
  assert.equal(loaded.receipt.subject.repository.id, 'vault-frontend');
  const expected = ingestReceiptDocument(loaded.receipt, {
    sourcePath: loaded.relativePath,
    sourceSha256: loaded.sha256,
  });
  assert.equal(expected.verdict.correctness, 'failed');

  let output = '';
  assert.equal(
    await runCli(['ingest', '--repo', root, '--receipt', 'raw.json'], {
      cwd: root,
      stdout: { write: (chunk) => (output += chunk) },
    }),
    1
  );
  assert.deepEqual(JSON.parse(output), expected);
  const handle = await createMcpHandler(root);
  const response = await handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'ingest_verification_receipt', arguments: { receipt: 'raw.json' } },
  });
  assert.deepEqual(response.result.structuredContent.result, expected);
});

test('pre-test Vault failures become no-confidence operational evidence', () => {
  const raw = makeVaultReceipt();
  delete raw.playwright;
  delete raw.performance;
  raw.verdict = 'incomplete';
  raw.error = 'Expo export failed';
  raw.stages = { export: { durationMs: 1_096, code: 1, signal: null } };
  const receipt = adaptVaultE2eReceipt(raw, { repositoryId: 'vault-frontend' });
  assert.equal(receipt.outcome.operational_failures, 1);
  assert.equal(receipt.metrics.coverage.inventory, 'missing');
  assert.equal(receipt.safety.live_network_requests, null);
  const bundle = ingest(receipt);
  assert.equal(bundle.verdict.overall, 'no_confidence');
  assert.equal(bundle.verdict.performance, 'no_confidence');
  assert.equal(bundle.verdict.safety, 'no_confidence');
  assert.ok(bundle.limitations.some((item) => item.includes('before Playwright')));
});

test('Playwright JSON and JUnit XML reports preserve tests, retries, and failures', async (context) => {
  const root = await temporaryDirectory(context);
  await writeJson(join(root, 'package.json'), { name: 'external-test-fixture' });
  await mkdir(join(root, 'artifacts'));
  await writeJson(join(root, 'artifacts/playwright.json'), {
    config: { version: '1.58.2' },
    suites: [
      {
        title: 'checkout',
        specs: [
          {
            title: 'submits order',
            file: 'tests/checkout.spec.ts',
            tests: [
              {
                projectName: 'chromium',
                results: [
                  { status: 'failed', duration: 20, error: { message: 'first failure' } },
                  { status: 'passed', duration: 15 },
                ],
              },
            ],
          },
        ],
      },
    ],
    stats: { startTime: '2026-08-31T00:00:00.000Z', duration: 35 },
  });
  const playwright = await loadReceipt(root, 'artifacts/playwright.json');
  assert.equal(playwright.sourceFormat, 'playwright-json');
  assert.equal(playwright.receipt.outcome.passed, 1);
  assert.equal(playwright.receipt.safety.retries, 1);
  assert.equal(playwright.receipt.attempts[0].failure_signature.includes('first failure'), false);
  assertValidReceipt(playwright.receipt);

  await writeFile(
    join(root, 'artifacts/junit.xml'),
    '<?xml version="1.0"?><testsuites><testsuite name="unit" time="0.2"><testcase classname="cart" name="adds item" file="tests/cart.test.ts" time="0.05"/><testcase classname="cart" name="removes item" file="tests/cart.test.ts" time="0.1"><failure message="expected one"/></testcase><testcase classname="cart" name="loads item" file="tests/cart.test.ts" time="0.05"><error message="fixture threw"/></testcase></testsuite></testsuites>'
  );
  const junit = await loadReceipt(root, 'artifacts/junit.xml');
  assert.equal(junit.sourceFormat, 'junit-xml');
  assert.equal(junit.receipt.outcome.passed, 1);
  assert.equal(junit.receipt.outcome.failed, 2);
  assert.equal(junit.receipt.outcome.operational_failures, 0);
  assertValidReceipt(junit.receipt);
});

test('LCOV and Cobertura reports expose aggregate producer observations without a verdict upgrade', async (context) => {
  const root = await temporaryDirectory(context);
  await writeJson(join(root, 'package.json'), { name: 'coverage-fixture' });
  await mkdir(join(root, 'coverage'));
  await writeFile(
    join(root, 'coverage/lcov.info'),
    'TN:\nSF:src/cart.ts\nFN:1,add\nFNDA:2,add\nFNF:1\nFNH:1\nDA:1,2\nDA:2,0\nLF:2\nLH:1\nBRDA:1,0,0,1\nBRF:1\nBRH:1\nend_of_record\n'
  );
  const lcov = await loadReceipt(root, 'coverage/lcov.info');
  assert.equal(lcov.sourceFormat, 'lcov');
  assert.equal(
    lcov.receipt.producer_observations.find((entry) => entry.metric === 'coverage.lines.hit').value,
    1
  );
  assert.equal(ingest(lcov.receipt).verdict.overall, 'no_confidence');

  await writeFile(
    join(root, 'coverage/cobertura.xml'),
    '<?xml version="1.0"?><!DOCTYPE coverage SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd"><coverage version="1" timestamp="1788134400000" lines-valid="10" lines-covered="8" branches-valid="4" branches-covered="2"><packages/></coverage>'
  );
  const cobertura = await loadReceipt(root, 'coverage/cobertura.xml');
  assert.equal(cobertura.sourceFormat, 'cobertura-xml');
  assert.equal(cobertura.receipt.captured_at, '2026-08-31T00:00:00.000Z');
  assert.equal(
    cobertura.receipt.producer_observations.find(
      (entry) => entry.metric === 'coverage.branches.hit'
    ).value,
    2
  );
  assertValidReceipt(cobertura.receipt);
});

test('Lighthouse and Chrome trace artifacts remain observational and source-attributed', async (context) => {
  const root = await temporaryDirectory(context);
  await writeJson(join(root, 'package.json'), { name: 'performance-fixture' });
  await mkdir(join(root, 'artifacts'));
  await writeJson(join(root, 'artifacts/lighthouse.json'), {
    lighthouseVersion: '13.0.1',
    fetchTime: '2026-08-31T00:00:00.000Z',
    configSettings: { formFactor: 'desktop' },
    categories: { performance: { score: 0.91 } },
    audits: {
      'largest-contentful-paint': { numericValue: 900, numericUnit: 'millisecond' },
      'cumulative-layout-shift': { numericValue: 0.02, numericUnit: 'unitless' },
    },
  });
  const lighthouse = await loadReceipt(root, 'artifacts/lighthouse.json');
  assert.equal(lighthouse.sourceFormat, 'lighthouse-json');
  assert.equal(
    lighthouse.receipt.producer_observations.find(
      (entry) => entry.metric === 'lighthouse.performance.score'
    ).value,
    0.91
  );
  assert.equal(ingest(lighthouse.receipt).observed.producer_observations.length, 3);

  await writeJson(join(root, 'artifacts/trace.json'), {
    traceEvents: [
      { name: 'navigationStart', ts: 1_000, dur: 0 },
      { name: 'task', ts: 2_000, dur: 4_000 },
    ],
  });
  const trace = await loadReceipt(root, 'artifacts/trace.json');
  assert.equal(trace.sourceFormat, 'chrome-trace-json');
  assert.equal(
    trace.receipt.producer_observations.find((entry) => entry.metric === 'chrome_trace.duration')
      .value,
    5
  );
  assertValidReceipt(trace.receipt);
});

test('XML artifacts reject entity declarations before parser execution', async (context) => {
  const root = await temporaryDirectory(context);
  await writeJson(join(root, 'package.json'), { name: 'xml-fixture' });
  await writeFile(
    join(root, 'report.xml'),
    '<!DOCTYPE testsuite [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><testsuite><testcase name="&xxe;"/></testsuite>'
  );
  await assert.rejects(loadReceipt(root, 'report.xml'), /unsupported document type or entity/);
});

function ingest(
  receipt,
  sourcePath = 'receipt.json',
  sourceSha256 = sha256(stableStringify(receipt))
) {
  return ingestReceiptDocument(receipt, { sourcePath, sourceSha256 });
}

function compare(baseline, current) {
  return compareReceiptDocuments(baseline, current, {
    baselineSource: {
      sourcePath: 'baseline.json',
      sourceSha256: sha256(stableStringify(baseline)),
    },
    currentSource: { sourcePath: 'current.json', sourceSha256: sha256(stableStringify(current)) },
  });
}

function attempt(id, testId, phase, status, failureSignature) {
  return {
    id,
    test_id: testId,
    phase,
    status,
    duration_ms: 10,
    failure_signature: failureSignature,
  };
}

function makeReceipt() {
  return {
    schema_version: RECEIPT_SCHEMA_VERSION,
    captured_at: '2026-08-09T00:00:00.000Z',
    subject: {
      repository: { id: 'example/shop', revision: 'a'.repeat(40), dirty: false },
      runner: { id: 'shop-tests', version: '1', profile: 'changed', command: 'pnpm test:changed' },
      environment: { id: 'fixture-node24', platform: 'darwin', arch: 'arm64', runtime: 'Node 24' },
    },
    selection: {
      mode: 'scoped',
      inventory_id: 'shop-tests-v1',
      inventory_total: 20,
      selector_change_allowed: false,
      changed_files: ['src/cart.ts'],
      tests: [
        {
          id: 'checkout',
          file: 'tests/checkout.test.ts',
          selected_by: ['src/cart.ts'],
          reason: 'direct import',
        },
        {
          id: 'cart',
          file: 'tests/cart.test.ts',
          selected_by: ['src/cart.ts'],
          reason: 'direct import',
        },
      ],
    },
    outcome: { total: 2, passed: 2, failed: 0, skipped: 0, operational_failures: 0 },
    attempts: [
      attempt('checkout-1', 'checkout', 'primary', 'passed', null),
      attempt('cart-1', 'cart', 'primary', 'passed', null),
    ],
    metrics: {
      wall_ms: 100,
      cpu_ms: 80,
      peak_rss_bytes: 1_000,
      peak_processes: 2,
      samples: { wall_ms: [95, 100, 105], cpu_ms: [75, 80, 85], peak_rss_bytes: [900, 1_000, 950] },
      coverage: {
        inventory: 'complete',
        cpu: 'complete',
        rss: 'complete',
        process_tree: 'complete',
        network: 'complete',
        fixed_waits: 'complete',
        selection: 'complete',
      },
    },
    safety: { fixed_wait_ms: 0, live_network_requests: 0, mock_cost_usd: 0, retries: 0 },
    budgets: {
      policy_id: 'shop-v1',
      maxima: {
        wall_ms: 200,
        cpu_ms: 200,
        peak_rss_bytes: 2_000,
        peak_processes: 4,
        fixed_wait_ms: 0,
        live_network_requests: 0,
        retries: 1,
      },
      required_metrics: [
        'wall_ms',
        'cpu_ms',
        'peak_rss_bytes',
        'fixed_wait_ms',
        'live_network_requests',
      ],
      regression: {
        relative_percent: 20,
        wall_absolute_ms: 25,
        cpu_absolute_ms: 25,
        peak_rss_absolute_bytes: 500,
        peak_processes_absolute: 1,
      },
    },
    evidence: [
      {
        kind: 'runtime-performance-capsule',
        path: 'artifacts/profile.json',
        sha256: 'a'.repeat(64),
      },
    ],
    limitations: [],
  };
}

function makeVaultReceipt() {
  return {
    schemaVersion: 1,
    runId: 'vault-fixture-fast',
    profile: 'fast',
    mode: 'cold',
    target: 'e2e-tests/plan',
    grep: null,
    lastFailed: false,
    shard: null,
    workers: 4,
    selection: { mode: 'ALL', specs: ['e2e-tests/plan'] },
    browserProject: 'chromium',
    browserLifecycle: 'per-worker',
    startedAt: '2026-08-09T00:00:00.000Z',
    finishedAt: '2026-08-09T00:00:10.000Z',
    durationMs: 10_000,
    baseCommit: 'b'.repeat(40),
    dirtyBeforeRun: false,
    packageLockSha256: 'c'.repeat(64),
    machine: { platform: 'darwin', release: '26.0.0', arch: 'arm64', node: 'v24.0.0' },
    browser: { project: 'chromium', version: '140.0.0', executablePath: '/redacted' },
    staticCostInventory: {
      fixedWaitCallSites: 0,
      literalFixedWaitBudgetMs: 0,
      implicitMockDelayCallSites: 2,
    },
    targetIdentity: {
      baseUrl: 'http://127.0.0.1:1234',
      liveApiBlocked: true,
    },
    stages: {
      playwright: {
        code: 1,
        signal: null,
        resourceUsage: {
          approximateCpuSeconds: 4.2,
          peakRssBytes: 10_000,
          peakProcessCount: 3,
        },
      },
    },
    playwright: {
      inventory: {
        tests: 2,
        files: 1,
        items: [
          { id: 'checkout', title: 'checkout', file: 'e2e-tests/plan/checkout.spec.ts' },
          { id: 'cart', title: 'cart', file: 'e2e-tests/plan/checkout.spec.ts' },
        ],
      },
      execution: {
        completedTests: 2,
        retries: 0,
        measuredCosts: {
          blockedLiveRequests: 0,
          fixedWaitMs: 0,
          mockRequestMs: 20,
          mockRequestCalls: 2,
        },
        items: [
          { id: 'checkout', status: 'passed', durationMs: 10, retry: 0, errors: [] },
          {
            id: 'cart',
            status: 'failed',
            durationMs: 20,
            retry: 0,
            errors: [{ signature: 'expected cart total' }],
          },
        ],
      },
    },
    performance: {
      budget: {
        wallTimeMs: 300_000,
        cpuSeconds: 832,
        peakRssBytes: 8 * 1024 ** 3,
        blockedLiveRequests: 0,
        fixedWaitMs: 0,
      },
    },
    verdict: 'fail',
  };
}

async function temporaryDirectory(context) {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-receipts-'));
  context.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}
