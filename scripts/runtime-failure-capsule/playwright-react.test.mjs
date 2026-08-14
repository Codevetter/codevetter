import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import {
  PLAYWRIGHT_REACT_BINDING,
  REACT_COMMIT_HOOK_SOURCE,
  attributePlaywrightReactComponents,
  collectPlaywrightReactEvidence,
  findDeclaredReactAuthority,
  normalizePlaywrightReactEvidence,
  playwrightReactEnvironment,
  sanitizePlaywrightReactDocument,
} from './playwright-react.mjs';

test('the bounded hook observes commit and component activity without application values', () => {
  const context = vm.createContext({});
  vm.runInContext(REACT_COMMIT_HOOK_SOURCE, context);
  const hook = context.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const rendererId = hook.inject({ version: '19.1.0' });
  const child = {
    type: function ResultsList() {},
    actualDuration: 4.25,
    child: null,
    sibling: null,
    memoizedProps: { secret: 'must-not-survive' },
  };
  hook.onCommitFiberRoot(rendererId, {
    current: {
      type: function App() {},
      actualDuration: 6.5,
      child,
      sibling: null,
    },
  });

  const evidence = context.__CODEVETTER_REACT_COMMITS__;
  assert.equal(evidence.commit_count, 1);
  assert.equal(evidence.profiled_commit_count, 1);
  assert.equal(evidence.total_actual_duration_ms, 6.5);
  assert.equal(evidence.measurement_complete, true);
  assert.equal(evidence.self_duration_provenance, 'inclusive_minus_direct_child_actual_duration');
  assert.deepEqual([...evidence.renderer_versions], ['19.1.0']);
  assert.deepEqual([...evidence.components].map((entry) => entry.name).toSorted(), [
    'App',
    'ResultsList',
  ]);
  assert.equal(
    evidence.components.find((entry) => entry.name === 'App').self_actual_duration_ms,
    2.25
  );
  assert.equal(
    evidence.components.find((entry) => entry.name === 'ResultsList').self_actual_duration_ms,
    4.25
  );
  assert.doesNotMatch(JSON.stringify(evidence), /secret|must-not-survive/);
});

test('derived self duration clamps at zero and bounded fiber traversal fails closed', () => {
  const clampedContext = vm.createContext({});
  vm.runInContext(REACT_COMMIT_HOOK_SOURCE, clampedContext);
  const clampedHook = clampedContext.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const rendererId = clampedHook.inject({ version: '19.1.0' });
  clampedHook.onCommitFiberRoot(rendererId, {
    current: {
      type: function Parent() {},
      actualDuration: 2,
      child: {
        type: function Child() {},
        actualDuration: 3,
        child: null,
        sibling: null,
      },
      sibling: null,
    },
  });
  const parent = clampedContext.__CODEVETTER_REACT_COMMITS__.components.find(
    (entry) => entry.name === 'Parent'
  );
  assert.equal(parent.self_actual_duration_ms, 0);

  const boundedContext = vm.createContext({});
  vm.runInContext(REACT_COMMIT_HOOK_SOURCE, boundedContext);
  const boundedHook = boundedContext.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const boundedRenderer = boundedHook.inject({ version: '19.1.0' });
  let sibling = null;
  for (let index = 0; index < 10_001; index += 1) {
    sibling = { type: `host-${index}`, actualDuration: 1, child: null, sibling };
  }
  boundedHook.onCommitFiberRoot(boundedRenderer, {
    current: {
      type: function BoundedRoot() {},
      actualDuration: 10_001,
      child: sibling,
      sibling: null,
    },
  });
  assert.equal(boundedContext.__CODEVETTER_REACT_COMMITS__.measurement_complete, false);
  assert.equal(boundedContext.__CODEVETTER_REACT_COMMITS__.truncated, true);
});

test('collector ranks bounded component evidence and preserves diagnostic limitations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-react-evidence-'));
  try {
    await writeFile(
      join(root, 'document-0.json'),
      JSON.stringify({
        schema_version: 'runtime-playwright-react-document/v1',
        hook_state: 'installed',
        renderer_versions: ['19.1.0'],
        commit_count: 2,
        profiled_commit_count: 2,
        total_actual_duration_ms: 12,
        max_commit_duration_ms: 8,
        components: [
          {
            name: 'SearchResults',
            active_fiber_count: 2,
            commits_present: 2,
            inclusive_actual_duration_ms: 10,
            max_actual_duration_ms: 7,
          },
        ],
        truncated: false,
      })
    );
    const evidence = await collectPlaywrightReactEvidence(root, authority());
    assert.equal(evidence.state, 'succeeded');
    assert.equal(evidence.attribution, 'component_activity_observed');
    assert.equal(evidence.components[0].name, 'SearchResults');
    assert.match(evidence.limitations[0], /separate diagnostic rerun/);
    assert.deepEqual(normalizePlaywrightReactEvidence(evidence), evidence);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collector advances modern self-duration evidence while retaining legacy readability', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-react-modern-'));
  try {
    await writeFile(
      join(root, 'document-0.json'),
      JSON.stringify(rawModernDocument({ documentToken: '0000000000000004', commits: 3 }))
    );
    const modern = await collectPlaywrightReactEvidence(root, authority());
    assert.equal(modern.schema_version, 'runtime-playwright-react-commits/v2');
    assert.equal(modern.measurement_complete, true);
    assert.equal(modern.components[0].self_actual_duration_ms, 6);
    assert.equal(modern.source_attribution, null);

    await writeFile(
      join(root, 'document-0.json'),
      JSON.stringify(rawDocument({ documentToken: '0000000000000005', commits: 3 }))
    );
    const legacy = await collectPlaywrightReactEvidence(root, authority());
    assert.equal(legacy.schema_version, 'runtime-playwright-react-commits/v1');
    assert.equal('self_actual_duration_ms' in legacy.components[0], false);
    assert.equal('measurement_complete' in legacy, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('declared React authority is resolved from the nearest package manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-react-authority-'));
  try {
    await mkdir(join(root, 'apps', 'web', 'tests'), { recursive: true });
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { react: '19.1.0' } })
    );
    await writeFile(
      join(root, 'apps', 'web', 'package.json'),
      JSON.stringify({ devDependencies: { '@playwright/test': '1.54.0', 'react-dom': '19.1.0' } })
    );
    const resolved = await findDeclaredReactAuthority(root, 'apps/web/tests/search.spec.ts');
    assert.deepEqual(resolved, {
      package_path: 'apps/web/package.json',
      declared_packages: ['react-dom'],
      provenance: 'nearest_package_manifest_declared_dependency',
    });
    const environment = playwrightReactEnvironment({
      repositoryRoot: root,
      target: 'apps/web/tests/search.spec.ts',
      outputDirectory: join(root, 'evidence'),
    });
    assert.match(environment.NODE_OPTIONS, /playwright-react-loader\.mjs/);
    assert.equal(environment.CODEVETTER_PLAYWRIGHT_TARGET, 'apps/web/tests/search.spec.ts');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CommonJS Playwright tests are intercepted only at the selected target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-react-commonjs-'));
  try {
    const canonicalRoot = await realpath(root);
    const packageDirectory = join(root, 'node_modules', '@playwright', 'test');
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(
      join(packageDirectory, 'index.js'),
      "module.exports={test:{kind:'base',extend(){return {kind:'instrumented'}}},expect:{}};\n"
    );
    await writeFile(
      join(root, 'selected.cjs'),
      "process.stdout.write(require('@playwright/test').test.kind);\n"
    );
    await writeFile(
      join(root, 'ordinary.cjs'),
      "process.stdout.write(require('@playwright/test').test.kind);\n"
    );
    const instrumented = spawnSync(process.execPath, [join(root, 'selected.cjs')], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...playwrightReactEnvironment({
          repositoryRoot: canonicalRoot,
          target: 'selected.cjs',
          outputDirectory: join(root, 'evidence'),
        }),
      },
    });
    const ordinary = spawnSync(process.execPath, [join(root, 'ordinary.cjs')], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...playwrightReactEnvironment({
          repositoryRoot: canonicalRoot,
          target: 'selected.cjs',
          outputDirectory: join(root, 'evidence'),
        }),
      },
    });
    assert.equal(instrumented.status, 0, instrumented.stderr);
    assert.equal(instrumented.stdout, 'instrumented');
    assert.equal(ordinary.status, 0, ordinary.stderr);
    assert.equal(ordinary.stdout, 'base');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('existing React DevTools hooks are not replaced', () => {
  const existing = { inject() {} };
  const context = vm.createContext({ __REACT_DEVTOOLS_GLOBAL_HOOK__: existing });
  vm.runInContext(REACT_COMMIT_HOOK_SOURCE, context);
  assert.equal(context.__REACT_DEVTOOLS_GLOBAL_HOOK__, existing);
  assert.equal(context.__CODEVETTER_REACT_COMMITS__.hook_state, 'existing_hook');
});

test('the hook delivers closed telemetry during the document lifetime', () => {
  const reports = [];
  const context = vm.createContext({
    [PLAYWRIGHT_REACT_BINDING]: (value) => reports.push(value),
  });
  vm.runInContext(REACT_COMMIT_HOOK_SOURCE, context);
  const hook = context.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const rendererId = hook.inject({ version: '19.1.0' });
  hook.onCommitFiberRoot(rendererId, {
    current: {
      type: function ProductCard() {},
      actualDuration: 3,
      child: null,
      sibling: null,
      memoizedState: { private: 'never-report' },
    },
  });
  assert.equal(reports.length >= 3, true);
  const delivered = sanitizePlaywrightReactDocument(reports.at(-1));
  assert.equal(delivered.commit_count, 1);
  assert.match(delivered.document_token, /^[0-9a-f]{16}$/);
  assert.doesNotMatch(JSON.stringify(delivered), /private|never-report/);
});

test('untrusted binding payloads are reduced to the closed document contract', () => {
  const sanitized = sanitizePlaywrightReactDocument({
    ...rawDocument({ documentToken: '0123456789abcdef' }),
    props: { token: 'secret-value' },
    url: 'https://example.test/private',
    source: 'private source text',
  });
  assert.deepEqual(Object.keys(sanitized).toSorted(), [
    'commit_count',
    'components',
    'document_token',
    'hook_state',
    'max_commit_duration_ms',
    'profiled_commit_count',
    'renderer_versions',
    'schema_version',
    'total_actual_duration_ms',
    'truncated',
  ]);
  assert.doesNotMatch(JSON.stringify(sanitized), /secret|private|example/);
});

test('binding-delivered documents survive replacement and retain lifecycle evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-react-navigation-'));
  try {
    await writeFile(
      join(root, 'document-0.json'),
      JSON.stringify(rawDocument({ documentToken: '0000000000000001', commits: 1 }))
    );
    await writeFile(
      join(root, 'document-1.json'),
      JSON.stringify(rawDocument({ documentToken: '0000000000000002', commits: 2 }))
    );
    await writeFile(join(root, 'lifecycle.json'), JSON.stringify(lifecycle({ delivered: 2 })));
    const evidence = await collectPlaywrightReactEvidence(root, authority());
    assert.equal(evidence.state, 'succeeded');
    assert.equal(evidence.documents_observed, 2);
    assert.equal(evidence.commit_count, 3);
    assert.equal(evidence.delivery.documents_delivered, 2);
    assert.match(evidence.limitations.join(' '), /delivered during/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('completed lifecycle separates unavailable delivery from a zero-commit document', async () => {
  const unavailableRoot = await mkdtemp(join(tmpdir(), 'codevetter-react-unavailable-'));
  const zeroRoot = await mkdtemp(join(tmpdir(), 'codevetter-react-zero-'));
  try {
    await writeFile(join(unavailableRoot, 'lifecycle.json'), JSON.stringify(lifecycle()));
    const unavailable = await collectPlaywrightReactEvidence(unavailableRoot, authority());
    assert.equal(unavailable.state, 'unavailable');
    assert.match(unavailable.limitations[0], /no bounded React document report/);

    await writeFile(
      join(zeroRoot, 'document-0.json'),
      JSON.stringify(rawDocument({ documentToken: '0000000000000003', commits: 0 }))
    );
    await writeFile(join(zeroRoot, 'lifecycle.json'), JSON.stringify(lifecycle({ delivered: 1 })));
    const zero = await collectPlaywrightReactEvidence(zeroRoot, authority());
    assert.equal(zero.state, 'not_detected');
    assert.equal(zero.commit_count, 0);
  } finally {
    await Promise.all([
      rm(unavailableRoot, { recursive: true, force: true }),
      rm(zeroRoot, { recursive: true, force: true }),
    ]);
  }
});

test('a renderer without profiling duration remains commit-only evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-react-commit-only-'));
  try {
    await writeFile(
      join(root, 'document-0.json'),
      JSON.stringify({
        schema_version: 'runtime-playwright-react-document/v1',
        hook_state: 'installed',
        renderer_versions: ['19.1.0'],
        commit_count: 1,
        profiled_commit_count: 0,
        total_actual_duration_ms: 0,
        max_commit_duration_ms: 0,
        components: [],
        truncated: false,
      })
    );
    const evidence = await collectPlaywrightReactEvidence(root, authority());
    assert.equal(evidence.state, 'succeeded');
    assert.equal(evidence.attribution, 'commit_only');
    assert.match(evidence.limitations.join(' '), /no positive profiling duration/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing, malformed, and oversized inventories fail closed', async () => {
  const missing = await collectPlaywrightReactEvidence(
    '/definitely/missing/codevetter',
    authority()
  );
  assert.equal(missing.state, 'unavailable');

  const root = await mkdtemp(join(tmpdir(), 'codevetter-react-bounds-'));
  try {
    await Promise.all(
      Array.from({ length: 17 }, (_, index) =>
        writeFile(join(root, `document-${index}.json`), '{}')
      )
    );
    const bounded = await collectPlaywrightReactEvidence(root, authority());
    assert.equal(bounded.state, 'unavailable');
    assert.match(bounded.limitations[0], /inventory exceeded/);
    assert.throws(
      () =>
        normalizePlaywrightReactEvidence({
          ...bounded,
          forbidden_application_value: 'secret',
        }),
      /invalid/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('component attribution promotes only unique repository declarations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-react-attribution-'));
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src', 'ResultsList.tsx'),
      'export function ResultsList() { return null; }\n'
    );
    const evidence = await attributePlaywrightReactComponents(root, {
      schema_version: 'runtime-playwright-react-commits/v1',
      state: 'succeeded',
      framework: 'react',
      authority: authority(),
      documents_observed: 1,
      renderer_versions: ['19.1.0'],
      commit_count: 1,
      profiled_commit_count: 1,
      total_actual_duration_ms: 5,
      max_commit_duration_ms: 5,
      components: [component('FrameworkBoundary', 20), component('ResultsList', 5)],
      attribution: 'component_activity_observed',
      truncated: false,
      provenance: 'react_devtools_hook_separate_exact_flow_pass',
      limitations: [],
    });
    assert.equal(evidence.components[0].name, 'ResultsList');
    assert.equal(evidence.components[0].ownership, 'repository');
    assert.equal(evidence.components[0].source.file, 'src/ResultsList.tsx');
    assert.equal(evidence.components[1].ownership, 'external_or_ambiguous');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('repository ownership is applied before the public component projection bound', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-react-owned-window-'));
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src', 'TinyProductLeaf.tsx'),
      'export const TinyProductLeaf = () => null;\n'
    );
    const external = Array.from({ length: 20 }, (_, index) =>
      component(`FrameworkComponent${index}`, 100 - index)
    );
    const evidence = await attributePlaywrightReactComponents(root, {
      schema_version: 'runtime-playwright-react-commits/v1',
      state: 'succeeded',
      framework: 'react',
      authority: authority(),
      documents_observed: 1,
      renderer_versions: ['19.1.0'],
      commit_count: 1,
      profiled_commit_count: 1,
      total_actual_duration_ms: 5,
      max_commit_duration_ms: 5,
      components: [...external, component('TinyProductLeaf', 1)],
      attribution: 'component_activity_observed',
      truncated: false,
      provenance: 'react_devtools_hook_separate_exact_flow_pass',
      delivery: null,
      limitations: [],
    });
    assert.equal(evidence.components.length, 16);
    assert.equal(evidence.components[0].name, 'TinyProductLeaf');
    assert.equal(evidence.components[0].ownership, 'repository');
    assert.equal(evidence.truncated, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('partial bounded source scans withhold repository ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-react-partial-source-'));
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src', 'ResultsList.tsx'),
      `export function ResultsList() { return null; }\n${' '.repeat(256 * 1024)}`
    );
    const evidence = await attributePlaywrightReactComponents(
      root,
      modernEvidence([modernComponent('ResultsList', 15)])
    );
    assert.equal(evidence.source_attribution.state, 'partial');
    assert.equal(evidence.components[0].ownership, 'external_or_ambiguous');
    assert.equal(evidence.components[0].source, null);
    assert.match(evidence.limitations.join(' '), /incomplete/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function authority() {
  return {
    package_path: 'package.json',
    declared_packages: ['react'],
    provenance: 'nearest_package_manifest_declared_dependency',
  };
}

function component(name, duration) {
  return {
    name,
    active_fiber_count: 1,
    commits_present: 1,
    inclusive_actual_duration_ms: duration,
    max_actual_duration_ms: duration,
  };
}

function modernComponent(name, duration, commits = 3) {
  return {
    ...component(name, duration),
    commits_present: commits,
    self_actual_duration_ms: duration,
    max_self_actual_duration_ms: duration,
  };
}

function modernEvidence(components) {
  return {
    schema_version: 'runtime-playwright-react-commits/v2',
    state: 'succeeded',
    framework: 'react',
    authority: authority(),
    documents_observed: 1,
    renderer_versions: ['19.1.0'],
    commit_count: 3,
    profiled_commit_count: 3,
    total_actual_duration_ms: 20,
    max_commit_duration_ms: 10,
    measurement_complete: true,
    presentation_truncated: false,
    self_duration_provenance: 'inclusive_minus_direct_child_actual_duration',
    source_attribution: null,
    components,
    attribution: 'component_activity_observed',
    truncated: false,
    provenance: 'react_devtools_hook_separate_exact_flow_pass',
    delivery: null,
    limitations: [],
  };
}

function rawDocument({ documentToken, commits = 1 } = {}) {
  return {
    schema_version: 'runtime-playwright-react-document/v1',
    hook_state: 'installed',
    document_token: documentToken,
    renderer_versions: ['19.1.0'],
    commit_count: commits,
    profiled_commit_count: commits,
    total_actual_duration_ms: commits * 2,
    max_commit_duration_ms: commits > 0 ? 2 : 0,
    components: commits > 0 ? [component('ProductCard', commits * 2)] : [],
    truncated: false,
  };
}

function rawModernDocument({ documentToken, commits = 1 } = {}) {
  return {
    schema_version: 'runtime-playwright-react-document/v2',
    hook_state: 'installed',
    document_token: documentToken,
    renderer_versions: ['19.1.0'],
    commit_count: commits,
    profiled_commit_count: commits,
    total_actual_duration_ms: commits * 2,
    max_commit_duration_ms: commits > 0 ? 2 : 0,
    measurement_complete: true,
    presentation_truncated: false,
    self_duration_provenance: 'inclusive_minus_direct_child_actual_duration',
    components: commits > 0 ? [modernComponent('ProductCard', commits * 2, commits)] : [],
    truncated: false,
  };
}

function lifecycle({ delivered = 0, bindingState = 'installed' } = {}) {
  return {
    schema_version: 'runtime-playwright-react-lifecycle/v1',
    fixture_started: true,
    binding_state: bindingState,
    binding_calls: delivered,
    invalid_payloads: 0,
    documents_delivered: delivered,
    fallback_pages_evaluated: 1,
    truncated: false,
    completed: true,
  };
}
