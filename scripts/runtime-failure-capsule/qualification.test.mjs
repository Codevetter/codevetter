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
import { qualifyPortfolioManifest, qualifyRepository } from './qualification.mjs';

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

test('discovers Playwright flows but requires caller selection', async (context) => {
  const root = await repositoryFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.0.0' } }),
    'tests/example.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('loads the product', async ({ page }) => page.goto('/'));",
      '',
    ].join('\n'),
  });

  const result = await qualifyRepository(root);

  assert.equal(result.status, 'needs_selection');
  assert.equal(result.recommended, null);
  assert.equal(result.candidates[0].adapter, 'playwright');
  assert.equal(result.candidates[0].name, 'loads the product');
  assert.equal(result.next_action.kind, 'select_representative_browser_flow');
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
