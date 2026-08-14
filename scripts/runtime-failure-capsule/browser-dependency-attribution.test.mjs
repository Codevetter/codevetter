import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  analyzeBrowserDependencies,
  buildLiteralImportGraph,
  evaluateChunkCondition,
  extractManualChunkRules,
  inspectViteManualChunks,
} from './browser-dependency-attribution.mjs';

const fixture = resolve('scripts/runtime-failure-capsule/fixtures/browser-optimization-vite');

test('literal import graph keeps static route packages separate from dynamic routes', async () => {
  const graph = await buildLiteralImportGraph(fixture, 'src/main.tsx');
  assert.equal(graph.state, 'observed');
  assert.deepEqual(graph.files, ['src/Navigation.tsx', 'src/main.tsx']);
  assert.equal(graph.packages[0].package, '@radix-ui/react-dropdown-menu');
  assert.equal(graph.packages[0].static, true);
  assert.deepEqual(graph.packages[0].static_imported_by, ['src/Navigation.tsx']);
});

test('literal import graph includes multiline named imports in the edit boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-multiline-import-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(
      join(root, 'src/main.tsx'),
      [
        'import {',
        '  Avatar,',
        '  DropdownMenu,',
        "} from 'radix-ui';",
        "import './view.tsx';",
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      join(root, 'src/view.tsx'),
      ["import { Slot } from 'radix-ui';", 'export const view = Slot;'].join('\n'),
      'utf8'
    );

    const graph = await buildLiteralImportGraph(root, 'src/main.tsx');
    const radix = graph.packages.find((entry) => entry.package === 'radix-ui');
    assert.deepEqual(radix.imported_by, ['src/main.tsx', 'src/view.tsx']);
    assert.deepEqual(radix.static_imported_by, ['src/main.tsx', 'src/view.tsx']);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('closed manual chunk subset detects peer-suffix path contamination', async () => {
  const source = await readFile(join(fixture, 'vite.config.ts'), 'utf8');
  const parsed = extractManualChunkRules(source);
  assert.equal(parsed.rules.length, 1);
  const dependencyPath =
    '/repo/node_modules/.pnpm/@radix-ui+react-dropdown-menu@2_react-dom@19/node_modules/@radix-ui/react-dropdown-menu';
  const result = evaluateChunkCondition(parsed.rules[0].condition, {
    id: dependencyPath,
    packagePath: '@radix-ui/react-dropdown-menu',
  });
  assert.equal(result.supported, true);
  assert.equal(result.value, true);
  assert.deepEqual(result.literals, ['react-dom']);
});

test('manual chunk attribution respects first-return rule order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-rule-order-'));
  try {
    await writeFile(
      join(root, 'vite.config.ts'),
      [
        'export default { build: { rollupOptions: { output: { manualChunks(id) {',
        "if (id.includes('@tanstack/react-router')) return 'router';",
        "if (id.includes('react-dom')) return 'react';",
        '} } } } };',
      ].join('\n'),
      'utf8'
    );
    const vite = await inspectViteManualChunks(root, [
      {
        package: '@tanstack/react-router',
        resolved_path:
          '/repo/node_modules/.pnpm/@tanstack+react-router@1_react-dom@19/node_modules/@tanstack/react-router',
        imported_by: ['src/main.tsx'],
        static: true,
      },
    ]);
    assert.deepEqual(
      vite.matches.map((entry) => [entry.package, entry.chunk, entry.surprising]),
      [['@tanstack/react-router', 'router', false]]
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test('dependency analyzer reads inert config and unverified build evidence without execution', async () => {
  const result = await analyzeBrowserDependencies({
    repositoryRoot: fixture,
    buildDirectory: 'dist',
    subject: { source_snapshot_sha256: 'a'.repeat(64) },
  });
  assert.equal(result.entry, 'src/main.tsx');
  assert.equal(result.vite.rules.length, 1);
  assert.equal(result.artifact.state, 'observed');
  assert.equal(result.artifact.verified, false);
  assert.equal(result.artifact.chunks.length, 2);
});

test('dependency analyzer rejects escaping artifacts and bounds import inventories', async () => {
  await assert.rejects(
    analyzeBrowserDependencies({ repositoryRoot: fixture, buildDirectory: '../dist' }),
    /contained relative path/
  );

  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-deps-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(
      join(root, 'index.html'),
      '<script type="module" src="/src/main.ts"></script>',
      'utf8'
    );
    const imports = Array.from({ length: 1_100 }, (_, index) => `import './m${index}.js';`).join(
      '\n'
    );
    await writeFile(join(root, 'src/main.ts'), imports, 'utf8');
    const result = await analyzeBrowserDependencies({ repositoryRoot: root });
    assert.equal(result.graph.state, 'incomplete');
    assert.equal(result.graph.inventory.complete, false);
  } finally {
    await rm(root, { recursive: true });
  }
});
