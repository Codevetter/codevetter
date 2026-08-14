import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { toolDefinitions } from './mcp.mjs';
import {
  PORTFOLIO_MANIFEST_SCHEMA_VERSION,
  QUALIFICATION_LIMITS,
  assertPortfolioManifest,
} from './qualification-contracts.mjs';
import {
  qualifyPortfolioManifest,
  qualifyRepository,
  selectBoundedFlows,
} from './qualification.mjs';

test('bounded qualification preserves low-volume runtime adapters', () => {
  const candidate = (id, adapter, score = 5) => ({
    id,
    adapter,
    score,
    safety_flags: [],
    target: `${id}.test.ts`,
    name: id,
  });
  const candidates = [
    ...Array.from({ length: 140 }, (_, index) =>
      candidate(`vitest-${String(index).padStart(3, '0')}`, 'vitest')
    ),
    candidate('browser-route', 'playwright'),
    candidate('go-benchmark', 'go-bench', 90),
    candidate('node-workload', 'node-test'),
  ];

  const selected = selectBoundedFlows(candidates, 10);
  assert.equal(selected.length, 10);
  assert.deepEqual(
    new Set(selected.map((entry) => entry.adapter)),
    new Set(['go-bench', 'node-test', 'vitest', 'playwright'])
  );
  assert.deepEqual(selectBoundedFlows([...candidates].reverse(), 10), selected);
});

test('qualifies one exact local Go benchmark as ready', async (context) => {
  const root = await repositoryFixture(context, {
    'go.mod': 'module example.test/ready\n\ngo 1.22\n',
    'parse_test.go': [
      'package ready',
      'import "testing"',
      'func BenchmarkParseRows(b *testing.B) { for i := 0; i < b.N; i++ {} }',
      '',
    ].join('\n'),
  });

  const result = await qualifyRepository(root);
  assert.equal(result.status, 'ready');
  assert.equal(result.recommended.adapter, 'go-bench');
  assert.equal(result.recommended.target, 'parse_test.go');
  assert.equal(result.recommended.name, 'BenchmarkParseRows');
  assert.equal(result.candidates[0].signals[0].kind, 'explicit_go_benchmark');
});

test('qualifies a stable dirty agent snapshot with an exact content identity', async (context) => {
  const root = await repositoryFixture(context, {
    'go.mod': 'module example.test/dirty-ready\n\ngo 1.22\n',
    'parse_test.go': [
      'package dirtyready',
      'import "testing"',
      'func BenchmarkParseRows(b *testing.B) { for i := 0; i < b.N; i++ {} }',
      '',
    ].join('\n'),
  });
  await writeFile(
    join(root, 'parse_test.go'),
    [
      'package dirtyready',
      'import "testing"',
      'func BenchmarkParseRows(b *testing.B) { for i := 0; i < b.N; i++ { _ = i } }',
      '',
    ].join('\n')
  );

  const result = await qualifyRepository(root);

  assert.equal(result.status, 'ready');
  assert.equal(result.subject.dirty, true);
  assert.match(result.subject.source_snapshot_sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.recommended.name, 'BenchmarkParseRows');
});

test('qualifies an exact Jest declaration without confusing it with Vitest', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { jest: '1.0.0' } }),
    'src/value.test.ts': [
      "import { test } from '@jest/globals';",
      "test('returns a value', () => {});",
    ].join('\n'),
  });
  const result = await qualifyRepository(root);
  assert.equal(result.flows.length, 1);
  assert.equal(result.flows[0].adapter, 'jest');
  assert.equal(result.flows[0].name, 'returns a value');
});

test('keeps generic tests selectable but does not call them representative', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'src/value.test.ts': "import { test } from 'vitest'; test('returns a value', () => {});\n",
  });

  const result = await qualifyRepository(root);
  assert.equal(result.status, 'needs_selection');
  assert.equal(result.recommended, null);
  assert.equal(result.candidates[0].score, 5);
  assert.equal(result.next_action.kind, 'select_representative_workload');
});

test('does not confuse performing-arts language with a performance workload', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'src/side-quests.test.ts': [
      "import { test } from 'vitest';",
      "test('turns performing for an audience into a small public-performance step', () => {});",
      '',
    ].join('\n'),
  });

  const result = await qualifyRepository(root);
  assert.equal(result.status, 'needs_selection');
  assert.equal(result.candidates[0].score, 5);
  assert.equal(
    result.candidates[0].signals.some((signal) => signal.kind === 'performance_workload_name'),
    false
  );
});

test('blocks automatic readiness when source suggests external operations', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'src/api.performance.test.ts': [
      "import { test } from 'vitest';",
      "test('performance benchmark', async () => { performance.now(); return fetch('https://api.example.test/rows'); });",
      '',
    ].join('\n'),
  });

  const result = await qualifyRepository(root);
  assert.equal(result.status, 'needs_selection');
  assert.equal(result.recommended, null);
  assert.ok(
    result.candidates[0].safety_flags.some((flag) => flag.kind === 'remote_network_signal')
  );
  assert.equal(result.next_action.kind, 'review_safety_and_select');
});

test('does not mistake URL fixture data for a network operation', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'src/parser.performance.test.ts': [
      "import { test } from 'vitest';",
      "test('performance benchmark', () => { performance.now(); return '<link>https://example.test/item</link>'; });",
      '',
    ].join('\n'),
  });

  const result = await qualifyRepository(root);
  assert.equal(result.status, 'ready');
  assert.equal(result.candidates[0].safety_flags.length, 0);
});

test('distinguishes loopback execution from indirect remote execution', async (context) => {
  const loopback = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'src/server.performance.test.ts': [
      "import { test } from 'vitest';",
      "test('performance benchmark', async () => { performance.now(); return fetch('http://127.0.0.1:3000/items'); });",
      '',
    ].join('\n'),
  });
  const indirect = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'src/api.performance.test.ts': [
      "import { test } from 'vitest';",
      "test('performance benchmark', async () => { const endpoint = process.env.API_URL; performance.now(); return fetch(endpoint); });",
      '',
    ].join('\n'),
  });

  assert.ok(
    (await qualifyRepository(loopback)).candidates[0].safety_flags.some(
      (flag) => flag.kind === 'local_service_signal'
    )
  );
  assert.ok(
    (await qualifyRepository(indirect)).candidates[0].safety_flags.some(
      (flag) => flag.kind === 'remote_network_signal'
    )
  );
});

test('requires direct timing evidence before a named Node performance test is ready', async (context) => {
  const namedOnly = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'src/value.performance.test.ts':
      "import { test } from 'vitest'; test('performance benchmark', () => {});\n",
  });
  const measured = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'src/value.performance.test.ts':
      "import { test } from 'vitest'; test('performance benchmark', () => { performance.now(); });\n",
  });

  assert.equal((await qualifyRepository(namedOnly)).status, 'needs_selection');
  assert.equal((await qualifyRepository(measured)).status, 'ready');
});

test('qualifies TypeScript Node tests only with a declared TSX loader', async (context) => {
  const source = [
    "import test from 'node:test';",
    "test('measures parser latency', () => performance.now());",
    '',
  ].join('\n');
  const supported = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { tsx: '4.21.0' } }),
    'src/parser.performance.test.ts': source,
  });
  const unsupported = await repositoryFixture(context, {
    'package.json': JSON.stringify({}),
    'src/parser.performance.test.ts': source,
  });

  const qualified = await qualifyRepository(supported);
  assert.equal(qualified.status, 'ready');
  assert.equal(qualified.recommended.adapter, 'node-test');
  assert.deepEqual(qualified.candidates[0].safety_flags, []);

  const unresolved = await qualifyRepository(unsupported);
  assert.equal(unresolved.status, 'needs_selection');
  assert.deepEqual(unresolved.candidates[0].safety_flags, [
    {
      kind: 'typescript_node_loader_unresolved_signal',
      evidence: 'src/parser.performance.test.ts',
    },
  ]);
});

test('does not treat synthetic performance evidence as executable timing', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'src/performance-diagnosis.test.ts': [
      "import { test } from 'vitest';",
      "test('diagnoses Go allocation pressure with evidence-linked verification', () => {",
      "  const fixture = 'performance.now() reported 30 allocs/op';",
      "  if (!fixture.includes('allocs/op')) throw new Error('missing B/op and allocs/op');",
      '});',
      '',
    ].join('\n'),
  });

  const result = await qualifyRepository(root);
  assert.equal(result.status, 'needs_selection');
  assert.equal(result.recommended, null);
  assert.equal(
    result.candidates[0].signals.some((signal) => signal.kind === 'timing_measurement_source'),
    false
  );
});

test('keeps executable timing evidence scoped to its exact declaration', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'src/value.performance.test.ts': [
      "import { test } from 'vitest';",
      "test('reports allocation pressure', () => { const fixture = '50 allocs/op'; });",
      "test('measures parser latency', () => { const started = performance.now(); return performance.now() - started; });",
      '',
    ].join('\n'),
  });

  const result = await qualifyRepository(root);
  const synthetic = result.candidates.find(
    (candidate) => candidate.name === 'reports allocation pressure'
  );
  const measured = result.candidates.find(
    (candidate) => candidate.name === 'measures parser latency'
  );
  assert.equal(
    synthetic.signals.some((signal) => signal.kind === 'timing_measurement_source'),
    false
  );
  assert.equal(
    measured.signals.some((signal) => signal.kind === 'timing_measurement_source'),
    true
  );
  assert.equal(result.status, 'ready');
  assert.equal(result.recommended.name, 'measures parser latency');
});

test('inventories Playwright journeys without promoting them to CPU-profile candidates', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.0.0' } }),
    'playwright.config.ts': 'export default {};\n',
    'tests/checkout.spec.ts': [
      "import { expect, test } from '@playwright/test';",
      "test('customer completes checkout', async ({ page }) => {",
      "  await page.goto('http://127.0.0.1:4173/checkout');",
      '  await expect(page).toHaveTitle(/Checkout/);',
      '});',
      '',
    ].join('\n'),
  });

  const result = await qualifyRepository(root);
  assert.equal(result.flows.length, 1);
  assert.equal(result.flows[0].adapter, 'playwright');
  assert.equal(result.flows[0].name, 'customer completes checkout');
  assert.equal(result.candidates.length, 0);
  assert.equal(result.status, 'no_representative_workload');
});

test('scopes remote Playwright safety evidence to the exact declaration', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.0.0' } }),
    'playwright.config.ts': "export default { use: { baseURL: 'http://127.0.0.1:4173' } };\n",
    'tests/flows.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('local page', async ({ page }) => page.goto('/local'));",
      "test('deployed API flow', async ({ page }) => page.goto('https://api.example.com/items'));",
    ].join('\n'),
  });

  const flows = (await qualifyRepository(root)).flows;
  const local = flows.find((flow) => flow.name === 'local page');
  const remote = flows.find((flow) => flow.name === 'deployed API flow');
  assert.equal(
    local.safety_flags.some((flag) => flag.kind === 'remote_service_signal'),
    false
  );
  assert.equal(
    remote.safety_flags.some((flag) => flag.kind === 'remote_service_signal'),
    true
  );
});

test('discovers only one static loopback Playwright base URL without evaluating config', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.0.0' } }),
    'playwright.config.ts': [
      "import { defineConfig } from '@playwright/test';",
      "throw new Error('config-must-not-run');",
      'const decoy = "baseURL: \'http://localhost:9999\'";',
      "// baseURL: 'http://localhost:9998'",
      "/* baseURL: 'http://localhost:9997' */",
      'export default defineConfig({',
      "  use: { baseURL: 'http://127.0.0.1:4173' },",
      "  webServer: { command: 'curl production', url: 'http://127.0.0.1:4173' },",
      '});',
      '',
    ].join('\n'),
    'tests/checkout.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('customer completes checkout', async ({ page }) => page.goto('/checkout'));",
      '',
    ].join('\n'),
  });

  const result = await qualifyRepository(root);
  assert.deepEqual(
    result.flows[0].signals.find((signal) => signal.kind === 'loopback_browser_base_url'),
    { kind: 'loopback_browser_base_url', weight: 0, evidence: 'http://127.0.0.1:4173' }
  );
  assert.equal(
    result.flows.some((flow) => flow.target === 'playwright.config.ts'),
    false
  );

  const remote = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.0.0' } }),
    'playwright.config.ts': "export default { use: { baseURL: 'https://example.com' } };\n",
    'tests/remote.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('remote flow', async ({ page }) => page.goto('/'));",
      '',
    ].join('\n'),
  });
  const remoteResult = await qualifyRepository(remote);
  assert.equal(
    remoteResult.flows[0].signals.some((signal) => signal.kind === 'loopback_browser_base_url'),
    false
  );

  const decoyOnly = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.0.0' } }),
    'playwright.config.ts': [
      'const decoy = "baseURL: \'http://127.0.0.1:4173\'";',
      "// baseURL: 'http://127.0.0.1:4173'",
      'export default {};',
      '',
    ].join('\n'),
    'tests/decoy.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('decoy flow', async ({ page }) => page.goto('/'));",
      '',
    ].join('\n'),
  });
  assert.equal(
    (await qualifyRepository(decoyOnly)).flows[0].signals.some(
      (signal) => signal.kind === 'loopback_browser_base_url'
    ),
    false
  );
});

test('qualifies a static Playwright environment override for an owned Vite frontend', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({
      scripts: { dev: 'concurrently "pnpm dev:worker" "pnpm dev:fe"', 'dev:fe': 'vite' },
      devDependencies: { '@playwright/test': '1.0.0', vite: '1.0.0' },
    }),
    'playwright.config.ts': [
      "import { defineConfig } from '@playwright/test';",
      "export default defineConfig({ use: { baseURL: process.env.E2E_BASE_URL || 'https://example.com' } });",
      '',
    ].join('\n'),
    'e2e/consumer.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('consumer flow', async ({ page }) => page.goto('/discover'));",
      '',
    ].join('\n'),
    'e2e/server-document.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('server title flow', async ({ page }) => { await page.goto('/detail'); await page.title(); });",
      '',
    ].join('\n'),
  });

  const flows = (await qualifyRepository(root)).flows;
  const flow = flows.find((candidate) => candidate.name === 'consumer flow');
  assert.deepEqual(
    flow.signals.find((signal) => signal.kind === 'loopback_browser_base_url'),
    { kind: 'loopback_browser_base_url', weight: 0, evidence: 'http://127.0.0.1:5173' }
  );
  assert.equal(
    flow.signals.find((signal) => signal.kind === 'declared_browser_server_family').evidence,
    'vite'
  );
  assert.ok(flow.signals.some((signal) => signal.kind === 'synthesized_loopback_vite_origin'));
  assert.deepEqual(
    flow.signals.find((signal) => signal.kind === 'declared_browser_warmup_path'),
    { kind: 'declared_browser_warmup_path', weight: 0, evidence: '/discover' }
  );
  assert.ok(
    flows
      .find((candidate) => candidate.name === 'server title flow')
      .safety_flags.some((flag) => flag.kind === 'server_document_semantics_signal')
  );
});

test('emits one exact flow per static Playwright device project', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({
      scripts: { dev: 'vite' },
      devDependencies: { '@playwright/test': '1.0.0', vite: '1.0.0' },
    }),
    'playwright.config.ts': [
      "import { defineConfig, devices } from '@playwright/test';",
      'export default defineConfig({',
      "  use: { baseURL: 'http://127.0.0.1:5173' },",
      '  projects: [',
      "    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },",
      "    { name: 'mobile', use: { ...devices['iPhone 13'] } },",
      '  ],',
      '});',
    ].join('\n'),
    'e2e/mobile.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('home renders', async ({ page }) => page.goto('/'));",
    ].join('\n'),
  });

  const flows = (await qualifyRepository(root)).flows.filter(
    (flow) => flow.name === 'home renders'
  );
  assert.deepEqual(
    flows.map((flow) => [flow.browser_profile.project_name, flow.browser_profile.device_name]),
    [
      ['desktop', 'Desktop Chrome'],
      ['mobile', 'iPhone 13'],
    ]
  );
  assert.equal(new Set(flows.map((flow) => flow.id)).size, 2);
});

test('resolves a closed environment-backed Playwright port fallback without reading it', async (context) => {
  const portReference = templateReference('port');
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({
      scripts: { dev: 'next dev' },
      devDependencies: { '@playwright/test': '1.0.0', next: '1.0.0' },
    }),
    'playwright.config.ts': [
      "import { devices } from '@playwright/test';",
      "const port = process.env.CODEVETTER_QUALIFICATION_TEST_PORT ?? '3000';",
      `const baseURL = \`http://localhost:${portReference}\`;`,
      'export default {',
      '  use: { baseURL },',
      `  webServer: { command: \`next dev -p ${portReference}\`, url: baseURL },`,
      '  projects: [',
      "    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },",
      "    { name: 'mobile', use: { ...devices['iPhone 13'] } },",
      '  ],',
      '};',
    ].join('\n'),
    'e2e/home.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('home renders', async ({ page }) => page.goto('/'));",
    ].join('\n'),
  });
  const original = process.env.CODEVETTER_QUALIFICATION_TEST_PORT;
  process.env.CODEVETTER_QUALIFICATION_TEST_PORT = '59999';
  context.after(() => {
    if (original === undefined) delete process.env.CODEVETTER_QUALIFICATION_TEST_PORT;
    else process.env.CODEVETTER_QUALIFICATION_TEST_PORT = original;
  });

  const flows = (await qualifyRepository(root)).flows.filter(
    (flow) => flow.name === 'home renders'
  );
  assert.deepEqual(
    flows.map((flow) => [
      flow.browser_profile.project_name,
      flow.signals.find((signal) => signal.kind === 'loopback_browser_base_url')?.evidence,
    ]),
    [
      ['desktop', 'http://localhost:3000'],
      ['mobile', 'http://localhost:3000'],
    ]
  );
  assert.ok(
    flows.every(
      (flow) =>
        flow.signals.find((signal) => signal.kind === 'declared_browser_server_family')
          ?.evidence === 'next'
    )
  );
});

test('qualifies a RolePatch-shaped base URL fallback without evaluating config or environment', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({
      scripts: { dev: 'next dev' },
      devDependencies: { '@playwright/test': '1.0.0', next: '1.0.0' },
    }),
    'playwright.config.ts': [
      "import { defineConfig, devices } from '@playwright/test';",
      'const ci = Boolean(process.env.CI);',
      "const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';",
      "const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? 'pnpm dev';",
      "throw new Error('config-must-not-run');",
      'export default defineConfig({',
      "  testDir: './e2e',",
      '  forbidOnly: ci,',
      '  use: { baseURL },',
      "  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],",
      '  webServer: { command: webServerCommand, url: baseURL },',
      '});',
      '',
    ].join('\n'),
    'e2e/navigation.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('landing page renders', async ({ page }) => page.goto('/'));",
      '',
    ].join('\n'),
  });
  const originalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
  const originalCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND;
  process.env.PLAYWRIGHT_BASE_URL = 'https://production.example.com';
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND = 'curl https://production.example.com';
  context.after(() => {
    if (originalBaseUrl === undefined) delete process.env.PLAYWRIGHT_BASE_URL;
    else process.env.PLAYWRIGHT_BASE_URL = originalBaseUrl;
    if (originalCommand === undefined) delete process.env.PLAYWRIGHT_WEB_SERVER_COMMAND;
    else process.env.PLAYWRIGHT_WEB_SERVER_COMMAND = originalCommand;
  });

  const result = await qualifyRepository(root);
  const flow = result.flows.find((candidate) => candidate.name === 'landing page renders');
  assert.deepEqual(
    flow.signals.find((signal) => signal.kind === 'loopback_browser_base_url'),
    { kind: 'loopback_browser_base_url', weight: 0, evidence: 'http://localhost:3000' }
  );
  assert.equal(
    flow.signals.find((signal) => signal.kind === 'declared_browser_server_family')?.evidence,
    'next'
  );
  assert.equal(flow.browser_profile.project_name, 'desktop');
  assert.equal(JSON.stringify(result).includes('PLAYWRIGHT_BASE_URL'), false);
  assert.equal(JSON.stringify(result).includes('production.example.com'), false);
});

test('rejects unsupported base URL constant aliases', async (context) => {
  const cases = [
    ['environment-only', 'const baseURL = process.env.PLAYWRIGHT_BASE_URL;'],
    ['call-derived', 'const baseURL = resolveBaseUrl();'],
    ['property-derived', 'const baseURL = config.baseURL;'],
    ['computed', "const baseURL = 'http://localhost:' + '3000';"],
    [
      'oversized',
      `const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000/${'x'.repeat(101)}';`,
    ],
    ['remote', "const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://example.com';"],
    [
      'ambiguous',
      [
        "const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';",
        "{ const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4000'; void baseURL; }",
      ].join('\n'),
    ],
  ];
  for (const [name, declaration] of cases) {
    const root = await repositoryFixture(context, {
      'package.json': JSON.stringify({
        scripts: { dev: 'next dev' },
        devDependencies: { '@playwright/test': '1.0.0', next: '1.0.0' },
      }),
      'playwright.config.ts': [declaration, 'export default { use: { baseURL } };'].join('\n'),
      [`e2e/${name}.spec.ts`]: [
        "import { test } from '@playwright/test';",
        `test('${name} flow', async ({ page }) => page.goto('/'));`,
      ].join('\n'),
    });
    const flow = (await qualifyRepository(root)).flows.find(
      (candidate) => candidate.name === `${name} flow`
    );
    assert.equal(
      flow.signals.some((signal) => signal.kind === 'loopback_browser_base_url'),
      false,
      name
    );
  }
});

test('rejects dynamic and non-loopback Playwright port templates', async (context) => {
  const portReference = templateReference('port');
  const expressionReference = templateReference('Number(port)');
  const cases = [
    {
      name: 'unquoted',
      port: 'const port = process.env.PORT ?? 4317;',
      baseURL: `const baseURL = \`http://localhost:${portReference}\`;`,
    },
    {
      name: 'expression',
      port: "const port = process.env.PORT ?? '4317';",
      baseURL: `const baseURL = \`http://localhost:${expressionReference}\`;`,
    },
    {
      name: 'remote',
      port: "const port = process.env.PORT ?? '4317';",
      baseURL: `const baseURL = \`https://example.com:${portReference}\`;`,
    },
    {
      name: 'invalid-port',
      port: "const port = process.env.PORT ?? '70000';",
      baseURL: `const baseURL = \`http://localhost:${portReference}\`;`,
    },
    {
      name: 'ambiguous',
      port: [
        "const port = process.env.PORT ?? '3000';",
        "{ const port = process.env.PORT ?? '4000'; void port; }",
      ].join('\n'),
      baseURL: `const baseURL = \`http://localhost:${portReference}\`;`,
    },
  ];
  for (const item of cases) {
    const root = await repositoryFixture(context, {
      'package.json': JSON.stringify({
        scripts: { dev: 'next dev' },
        devDependencies: { '@playwright/test': '1.0.0', next: '1.0.0' },
      }),
      'playwright.config.ts': [
        item.port,
        item.baseURL,
        'export default { use: { baseURL } };',
      ].join('\n'),
      [`e2e/${item.name}.spec.ts`]: [
        "import { test } from '@playwright/test';",
        `test('${item.name} flow', async ({ page }) => page.goto('/'));`,
      ].join('\n'),
    });

    const flow = (await qualifyRepository(root)).flows.find(
      (candidate) => candidate.name === `${item.name} flow`
    );
    assert.equal(
      flow.signals.some((signal) => signal.kind === 'loopback_browser_base_url'),
      false,
      item.name
    );
  }
});

test('resolves a typed named project array, ignore filters, and device overrides', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({
      scripts: { dev: 'next dev' },
      devDependencies: { '@playwright/test': '1.0.0', next: '1.0.0' },
    }),
    'playwright.config.ts': [
      "import type { PlaywrightTestConfig } from '@playwright/test';",
      "import { devices } from '@playwright/test';",
      'const LANDING_SPEC = /landing\\.spec\\.ts/;',
      "const projects: PlaywrightTestConfig['projects'] = [",
      "  { name: 'mobile', testIgnore: LANDING_SPEC, use: { ...devices['Pixel 7'] } },",
      "  { name: 'wide', testIgnore: /landing\\.spec\\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 }, hasTouch: true } },",
      "  { name: 'landing', testMatch: LANDING_SPEC, use: { ...devices['Desktop Chrome'] } },",
      '];',
      "export default { use: { baseURL: 'http://localhost:3000' }, projects };",
    ].join('\n'),
    'e2e/home.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('home renders', async ({ page }) => page.goto('/'));",
    ].join('\n'),
    'e2e/landing.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('landing renders', async ({ page }) => page.goto('/'));",
    ].join('\n'),
  });

  const flows = (await qualifyRepository(root)).flows;
  const home = flows.filter((flow) => flow.name === 'home renders');
  assert.deepEqual(
    home.map((flow) => flow.browser_profile.project_name),
    ['mobile', 'wide']
  );
  assert.deepEqual(
    home.find((flow) => flow.browser_profile.project_name === 'wide').browser_profile,
    {
      project_name: 'wide',
      device_name: 'Desktop Chrome',
      viewport: { width: 1920, height: 1080 },
      device_scale_factor: null,
      is_mobile: null,
      has_touch: true,
      provenance: 'static_playwright_device',
    }
  );
  assert.equal(
    flows.some((flow) => flow.name === 'landing renders'),
    false
  );
});

test('dynamic Playwright projects remain ineligible for owned capture', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({
      scripts: { dev: 'vite' },
      devDependencies: { '@playwright/test': '1.0.0', vite: '1.0.0' },
    }),
    'playwright.config.ts': [
      'const projects = makeProjects();',
      "export default { use: { baseURL: 'http://127.0.0.1:5173' }, projects };",
    ].join('\n'),
    'e2e/home.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('home renders', async ({ page }) => page.goto('/'));",
    ].join('\n'),
  });

  const flow = (await qualifyRepository(root)).flows.find(
    (candidate) => candidate.name === 'home renders'
  );
  assert.ok(flow.safety_flags.some((flag) => flag.kind === 'browser_project_unresolved_signal'));
});

test('retains an exact statically asserted HTTP status as browser evidence', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({
      scripts: { dev: 'vite' },
      devDependencies: { '@playwright/test': '1.0.0', vite: '1.0.0' },
    }),
    'playwright.config.ts': "export default { use: { baseURL: 'http://127.0.0.1:5173' } };\n",
    'e2e/status.spec.ts': [
      "import { expect, test } from '@playwright/test';",
      "test('missing route stays missing', async ({ page }) => {",
      "  const response = await page.request.get('/missing', { failOnStatusCode: false });",
      '  expect(response.status()).toBe(404);',
      '});',
    ].join('\n'),
  });

  const flow = (await qualifyRepository(root)).flows.find(
    (candidate) => candidate.name === 'missing route stays missing'
  );
  assert.deepEqual(
    flow.signals.find((signal) => signal.kind === 'declared_expected_http_status'),
    { kind: 'declared_expected_http_status', weight: 0, evidence: 'GET /missing 404' }
  );
});

test('resolves a declared Next origin without assigning an alternate Playwright project', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({
      scripts: { dev: 'next dev', 'dev:test-auth': 'ENABLE_TEST_AUTH=1 next dev' },
      devDependencies: { '@playwright/test': '1.0.0', next: '1.0.0' },
    }),
    'playwright.config.ts': [
      "const APP_URL = 'http://localhost:3000';",
      "const LANDING_URL = 'http://localhost:4321';",
      'const LANDING_SPEC = /landing\\.spec\\.ts/;',
      'export default {',
      '  use: { baseURL: APP_URL },',
      '  projects: [{ testMatch: LANDING_SPEC, use: { baseURL: LANDING_URL } }],',
      '};',
    ].join('\n'),
    'e2e/consumer.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('consumer flow', async ({ page }) => page.goto('/daily'));",
    ].join('\n'),
    'e2e/landing.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('landing flow', async ({ page }) => page.goto('/'));",
    ].join('\n'),
  });

  const result = await qualifyRepository(root);
  const consumer = result.flows.find((flow) => flow.target === 'e2e/consumer.spec.ts');
  const landing = result.flows.find((flow) => flow.target === 'e2e/landing.spec.ts');
  assert.equal(
    consumer.signals.find((signal) => signal.kind === 'declared_browser_server_family').evidence,
    'next'
  );
  assert.equal(
    consumer.signals.find((signal) => signal.kind === 'loopback_browser_base_url').evidence,
    'http://localhost:3000'
  );
  assert.equal(
    consumer.signals.find((signal) => signal.kind === 'declared_browser_warmup_path').evidence,
    '/daily'
  );
  assert.equal(
    landing.signals.some((signal) => signal.kind === 'loopback_browser_base_url'),
    false
  );
});

test('retains repository-fixtured browser flows ahead of remote-dependent siblings', () => {
  const browser = (id, score = 0) => ({
    id,
    adapter: 'playwright',
    score,
    safety_flags: [],
    target: `${id}.spec.ts`,
    name: id,
  });
  const flows = selectBoundedFlows(
    [
      browser('remote-a'),
      browser('remote-b'),
      browser('remote-c'),
      browser('remote-d'),
      browser('fixtured', 10),
    ],
    4
  );
  assert.equal(
    flows.some((flow) => flow.id === 'fixtured'),
    true
  );
});

test('the bounded Playwright floor retains a declared local runtime', () => {
  const flows = Array.from({ length: 5 }, (_, index) => ({
    id: `flow-${index}`,
    adapter: 'playwright',
    score: 5,
    safety_flags: [],
    signals:
      index === 4
        ? [{ kind: 'loopback_browser_base_url' }, { kind: 'declared_browser_server_family' }]
        : [],
    target: `e2e/${index}.spec.ts`,
    name: `flow ${index}`,
  }));
  assert.equal(
    selectBoundedFlows(flows, 4).some((flow) => flow.id === 'flow-4'),
    true
  );
});

test('the browser floor retains a small product journey suite beside a crowded unit lane', () => {
  const candidates = [
    ...Array.from({ length: 140 }, (_, index) => ({
      id: `unit-${index}`,
      adapter: 'vitest',
      score: 5,
      safety_flags: [],
      target: `unit-${index}.test.ts`,
      name: `unit ${index}`,
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `journey-${index}`,
      adapter: 'playwright',
      score: 0,
      safety_flags: [],
      signals: [{ kind: 'loopback_browser_base_url' }, { kind: 'declared_browser_server_family' }],
      target: `e2e/journey-${index}.spec.ts`,
      name: `journey ${index}`,
    })),
  ];

  const selected = selectBoundedFlows(candidates, 128);
  assert.equal(selected.filter((flow) => flow.adapter === 'playwright').length, 8);
  assert.deepEqual(selectBoundedFlows([...candidates].reverse(), 128), selected);
});

test('the browser floor prefers distinct journeys before extra device variants', () => {
  const candidates = Array.from({ length: 20 }, (_, journey) =>
    ['mobile', 'tablet', 'desktop', 'wide'].map((project) => ({
      id: `journey-${journey}-${project}`,
      adapter: 'playwright',
      score: 0,
      safety_flags: [],
      signals: [{ kind: 'loopback_browser_base_url' }, { kind: 'declared_browser_server_family' }],
      target: `e2e/journey-${String(journey).padStart(2, '0')}.spec.ts`,
      name: `journey ${journey}`,
      browser_profile: { project_name: project },
    }))
  ).flat();

  const selected = selectBoundedFlows(candidates, 16);
  assert.equal(selected.length, 16);
  assert.equal(new Set(selected.map((flow) => `${flow.target}\0${flow.name}`)).size, 16);
});

test('keeps parameterized template test names out of exact autonomous execution', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.0.0' } }),
    'playwright.config.ts': "export default { use: { baseURL: 'http://127.0.0.1:4173' } };\n",
    'tests/mobile.spec.ts': [
      "import { test } from '@playwright/test';",
      "for (const path of ['/welcome', '/login']) {",
      [
        '  test(`no horizontal scroll on $',
        '{path}',
        '`, async ({ page }) => page.goto(path));',
      ].join(''),
      '}',
      '',
    ].join('\n'),
  });

  const result = await qualifyRepository(root);
  const flow = result.flows[0];
  assert.equal(flow.name, ['no horizontal scroll on $', '{path}'].join(''));
  assert.ok(flow.safety_flags.some((flag) => flag.kind === 'dynamic_test_name_signal'));
});

test('qualifies a standalone local Node benchmark without pretending it is a test', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'benchmarks/benchmark-parser.mjs': [
      "import { performance } from 'node:perf_hooks';",
      'const started = performance.now();',
      'for (let index = 0; index < 1000; index += 1) Math.sqrt(index);',
      "console.log('[benchmark] elapsed=' + (performance.now() - started) + 'ms (1000 iterations)');",
      '',
    ].join('\n'),
  });

  const result = await qualifyRepository(root);
  assert.equal(result.status, 'ready');
  assert.equal(result.recommended.adapter, 'node-script');
  assert.equal(result.recommended.target, 'benchmarks/benchmark-parser.mjs');
  assert.equal(result.recommended.name, null);
});

test('keeps large static JSON performance fixtures visible but out of autonomous execution', async (context) => {
  const performanceTest = [
    "import catalog from './catalog.json';",
    "import { performance } from 'node:perf_hooks';",
    "import { test } from 'vitest';",
    "test('catalog performance benchmark', () => {",
    '  const startedAt = performance.now();',
    "  console.log('[benchmark] size1000=' + (performance.now() - startedAt) + 'ms/op ' + catalog.length);",
    '});',
    '',
  ].join('\n');
  const large = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'src/catalog.performance.test.ts': performanceTest,
    'src/catalog.json': `"${'x'.repeat(1024 * 1024)}"`,
  });
  const small = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'src/catalog.performance.test.ts': performanceTest,
    'src/catalog.json': '[]\n',
  });

  const largeResult = await qualifyRepository(large);
  assert.equal(largeResult.status, 'needs_selection');
  assert.equal(largeResult.candidates.length, 1);
  assert.ok(
    largeResult.candidates[0].safety_flags.some(
      (flag) => flag.kind === 'large_static_json_fixture_signal'
    )
  );
  assert.equal(largeResult.recommended, null);

  const smallResult = await qualifyRepository(small);
  assert.equal(smallResult.status, 'ready');
  assert.equal(
    smallResult.candidates[0].safety_flags.some(
      (flag) => flag.kind === 'large_static_json_fixture_signal'
    ),
    false
  );
});

test('keeps benchmark-named generators out of autonomous execution', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'scripts/generate-benchmark-dataset.mjs': [
      "import fs from 'node:fs';",
      "import { performance } from 'node:perf_hooks';",
      'const started = performance.now();',
      "fs.mkdirSync('generated', { recursive: true });",
      "fs.writeFileSync('generated/result.json', '{}');",
      "console.log('[benchmark] elapsed=' + (performance.now() - started) + 'ms');",
      '',
    ].join('\n'),
  });

  const result = await qualifyRepository(root);
  assert.equal(result.status, 'needs_selection');
  assert.equal(result.recommended, null);
  assert.deepEqual(
    result.candidates[0].safety_flags.map((flag) => flag.kind),
    ['standalone_generator_script_signal', 'standalone_filesystem_write_signal']
  );
});

test('requires selection when a standalone benchmark expects caller arguments', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'benchmark-parser.mjs': [
      "import { performance } from 'node:perf_hooks';",
      'const input = process.argv[2];',
      'const started = performance.now();',
      "console.log('[benchmark] elapsed=' + (performance.now() - started) + 'ms input=' + input);",
      '',
    ].join('\n'),
  });

  const result = await qualifyRepository(root);
  assert.equal(result.status, 'needs_selection');
  assert.ok(
    result.candidates[0].safety_flags.some((flag) => flag.kind === 'required_arguments_signal')
  );
});

test('reports nested documentation package scope instead of promoting it to product readiness', async (context) => {
  const root = await repositoryFixture(context, {
    'README.md': '# native application\n',
    'docs/example/package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'docs/example/render.performance.test.ts':
      "import { test } from 'vitest'; test('performance benchmark', () => {});\n",
  });

  const result = await qualifyRepository(root);
  assert.equal(result.status, 'needs_selection');
  assert.equal(result.candidates[0].package_scope, 'docs/example');
  assert.ok(result.candidates[0].safety_flags.some((flag) => flag.kind === 'non_product_scope'));
});

test('distinguishes supported runtime without a workload from an unsupported repository', async (context) => {
  const supported = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'src/index.ts': 'export const value = 1;\n',
  });
  const unsupported = await repositoryFixture(context, {
    'README.md': '# no supported runtime\n',
  });

  assert.equal((await qualifyRepository(supported)).status, 'no_representative_workload');
  assert.equal((await qualifyRepository(unsupported)).status, 'unsupported');
});

test('qualifies a bounded mixed portfolio sequentially without leaking paths', async (context) => {
  const parent = await mkdtemp(join(tmpdir(), 'codevetter-qualification-portfolio-'));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const ready = join(parent, 'ready');
  const unsupported = join(parent, 'unsupported');
  await initializeRepository(ready, {
    'go.mod': 'module example.test/portfolio\n\ngo 1.22\n',
    'rows_test.go': 'package portfolio\nimport "testing"\nfunc BenchmarkRows(b *testing.B) {}\n',
  });
  await initializeRepository(unsupported, { 'README.md': '# unsupported\n' });
  const manifestPath = join(parent, 'portfolio.json');
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: PORTFOLIO_MANIFEST_SCHEMA_VERSION,
      repositories: [
        { id: 'ready-app', path: './ready' },
        { id: 'unsupported-app', path: './unsupported' },
        { id: 'missing-app', path: './missing' },
      ],
    })
  );

  const report = await qualifyPortfolioManifest(manifestPath);
  assert.deepEqual(
    report.repositories.map((entry) => [entry.repository_id, entry.status]),
    [
      ['ready-app', 'ready'],
      ['unsupported-app', 'unsupported'],
      ['missing-app', 'inaccessible'],
    ]
  );
  assert.deepEqual(report.summary, {
    total: 3,
    ready: 1,
    needs_selection: 0,
    no_representative_workload: 0,
    unsupported: 1,
    inaccessible: 1,
  });
  assert.equal(JSON.stringify(report).includes(parent), false);
});

test('rejects an oversized portfolio before repository inspection', () => {
  assert.throws(
    () =>
      assertPortfolioManifest({
        schema_version: PORTFOLIO_MANIFEST_SCHEMA_VERSION,
        repositories: Array.from({ length: QUALIFICATION_LIMITS.repositories + 1 }, (_, index) => ({
          id: `repository-${index}`,
          path: `/definitely-not-inspected/${index}`,
        })),
      }),
    /repositories exceeds/
  );
});

test('publishes qualification as a read-only local MCP operation', () => {
  const definition = toolDefinitions().find((tool) => tool.name === 'qualify_runtime_repository');
  assert.ok(definition);
  assert.equal(definition.annotations.readOnlyHint, true);
  assert.equal(definition.inputSchema.additionalProperties, false);
});

function templateReference(name) {
  return `${String.fromCharCode(36)}{${name}}`;
}

async function repositoryFixture(context, files) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-qualification-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await initializeRepository(root, files);
  return root;
}

async function initializeRepository(root, files) {
  await mkdir(root, { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, contents);
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'CodeVetter Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
}
