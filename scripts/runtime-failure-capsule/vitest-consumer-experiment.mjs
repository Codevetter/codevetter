import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertPerformanceExecutionPlanCurrent,
  planPerformanceExecution,
} from './execution-governance.mjs';
import { runClosedAdapter } from './runner.mjs';
import { sourceDigest } from './source-execution.mjs';
import { qualifyConsumerSelection, routeTestNames } from './vitest-consumer-evidence.mjs';
import { consumerFixtures } from './vitest-consumer-fixtures.mjs';

export const READER_BASE = '4c45b25f2c0320d7d25901940973dcb9cbe40dde';
const target = 'src/lib/spa-route.test.ts';
const publicFiles = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'vitest.config.ts',
  'src/test/setup.ts',
  target,
  'src/lib/spa-route.ts',
];

export async function vitestConsumerExperiment(consumerRoot, { disposableCheckout = false } = {}) {
  assert.equal(
    disposableCheckout,
    true,
    'Use an explicitly disposable checkout with separately installed frozen dependencies'
  );
  const root = await realpath(resolve(consumerRoot));
  assert.equal(git(root, ['rev-parse', 'HEAD']), READER_BASE);
  assert.equal(git(root, ['status', '--porcelain']), '');
  const original = Object.fromEntries(
    await Promise.all(publicFiles.map(async (path) => [path, await readFile(join(root, path))]))
  );
  for (const path of [
    'study',
    'study.mjs',
    ...Object.keys(consumerFixtures).filter((path) => !path.startsWith('study/')),
  ])
    await assert.rejects(lstat(join(root, path)), { code: 'ENOENT' });
  let report;
  let failure;
  try {
    report = await experiment(root);
  } catch (error) {
    failure = error;
  }
  try {
    await restoreConsumerCheckout(root, original);
    assert.equal(git(root, ['rev-parse', 'HEAD']), READER_BASE);
    assert.equal(git(root, ['status', '--porcelain']), '');
  } catch (error) {
    throw new AggregateError([failure, error].filter(Boolean), 'Consumer study cleanup failed');
  }
  if (failure) throw failure;
  report.checkout_restored = {
    commit: READER_BASE,
    clean: true,
    refs_or_index_changed: false,
    owned_study_fixtures_removed: true,
  };
  return JSON.parse(JSON.stringify(report).replaceAll(root, '<study>'));
}

async function restoreConsumerCheckout(root, original) {
  for (const [path, bytes] of Object.entries(original)) {
    const current = await readFile(join(root, path)).catch(() => null);
    if (!current?.equals(bytes)) await writeFile(join(root, path), bytes);
  }
  for (const path of [
    'study.mjs',
    ...Object.keys(consumerFixtures).filter((path) => !path.startsWith('study/')),
  ])
    await rm(join(root, path), { force: true });
  // This directory was required absent before the explicitly disposable study.
  await rm(join(root, 'study'), { recursive: true, force: true });
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

async function identities(root, paths) {
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [path, sourceDigest(await readFile(join(root, path)))])
    )
  );
}

async function experiment(root) {
  const original = await identities(root, publicFiles);
  const tools = {};
  for (const name of ['vitest', 'vite', 'happy-dom', '@vitest/coverage-v8', 'typescript']) {
    const path = `node_modules/${name}/package.json`;
    const bytes = await readFile(join(root, path));
    tools[name] = { version: JSON.parse(bytes).version, package_sha256: sourceDigest(bytes) };
  }
  const declared = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  for (const [name, installed] of Object.entries(tools))
    assert.equal(installed.version, declared.devDependencies[name]);
  assert.equal(declared.packageManager, 'pnpm@10.33.2');
  assert.equal(
    sourceDigest(await readFile(join(root, 'node_modules/.pnpm/lock.yaml'))),
    original['pnpm-lock.yaml']
  );
  const worker = await readFile(new URL('./vitest-consumer-worker.mjs', import.meta.url));
  const files = { ...consumerFixtures, 'study.mjs': worker };
  const defaultRunner = await defaultRunnerControl(root);
  const cleanInvalidations = await invalidationControls(root);
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes);
  }
  const scope = {
    repositoryRoot: root,
    adapter: 'node-script',
    target: 'study.mjs',
    timeoutMs: 60000,
  };
  const plan = await planPerformanceExecution(scope);
  assert.equal(plan.decision.status, 'admitted', JSON.stringify(plan.decision));
  const execution = await runClosedAdapter({ ...scope, executionPlan: plan });
  assert.equal(execution.exitCode, 0, `${execution.stdout}\n${execution.stderr}`);
  const line = execution.stdout
    .split('\n')
    .find((value) => value.startsWith('CODEVETTER_VITEST_STUDY='));
  assert.ok(line, 'exit zero without a completed execution report is not proof');
  const results = JSON.parse(line.slice('CODEVETTER_VITEST_STUDY='.length));
  qualifyRows(
    results.rows,
    original,
    sourceDigest(
      (await readFile(join(root, 'vitest.config.ts'), 'utf8')).replace(
        "environment: 'happy-dom'",
        "environment: 'node'"
      )
    )
  );
  assert.deepEqual(
    await identities(root, publicFiles),
    original,
    'all mutation controls must restore published bytes'
  );
  const invalidations = await invalidationControls(root);
  return {
    schema_version: 'codevetter.vitest-consumer-study/v1',
    published_prerequisite: '903dfb6b9f7bf76baa9c66c4750017eea0c619ee',
    producer: {
      repository_revision: git(dirname(fileURLToPath(import.meta.url)), ['rev-parse', 'HEAD']),
      dirty: git(dirname(fileURLToPath(import.meta.url)), ['status', '--porcelain']) !== '',
    },
    consumer: {
      repository: 'Significant-Hobbies/reader',
      commit: READER_BASE,
      tree: '28d11fdce92c18eab96f5c84eede3e5318e479aa',
      files: original,
    },
    installation: {
      prerequisite_command: 'corepack pnpm install --frozen-lockfile',
      declared_pnpm: '10.33.2',
      installed_lock_matches_published: true,
      lockfile_changed: false,
      scripts: 'Existing repository policy; no dependency build-script allowlist was changed.',
    },
    runtime: {
      node: process.version,
      binary_sha256: sourceDigest(await readFile(process.execPath)),
      platform: process.platform,
      arch: process.arch,
    },
    tools,
    implementation: await identities(dirname(fileURLToPath(import.meta.url)), [
      'vitest-consumer-experiment.mjs',
      'vitest-consumer-worker.mjs',
      'vitest-consumer-fixtures.mjs',
      'vitest-consumer-evidence.mjs',
      'runner.mjs',
      'node-test-reporter.mjs',
      'node-test-selection.mjs',
      'execution-governance.mjs',
      'execution-identity.mjs',
      'supervised-inputs.mjs',
      'supervision.mjs',
      'node-egress-preload.mjs',
    ]),
    fixtures: Object.fromEntries(
      Object.entries(files).map(([path, bytes]) => [path, sourceDigest(bytes)])
    ),
    execution: {
      plan_id: plan.plan_id,
      subject: plan.subject,
      enforcement: plan.enforcement,
      status: execution.status,
      exit: execution.exitCode,
      stderr: execution.stderr,
    },
    default_runner: defaultRunner,
    ...results,
    invalidations: { clean: cleanInvalidations, already_dirty: invalidations },
    limitations: [
      'One published pure-logic module; environment equivalence does not extend to DOM-dependent tests.',
      'Cold means a fresh Vitest context; warm means rerun in that context, not a machine or filesystem cache flush.',
      'No duration comparison or acceleration, memory, agent, native, production, or provider claim.',
      'Cancellation is observed after the actual body starts; cancellation never qualifies execution.',
      'Plan identity binds raw Git-owned/nonignored input bytes including already-dirty edits; production warm reuse remains unqualified.',
      'Detached-descendant supervisor cancellation remains unqualified; the attempted POSIX guard was withdrawn after a non-reaping-parent counterexample.',
      'Explicitly disposable clean checkout with its own frozen installation; no dependency/build directory is copied or shared and no Git ref or index is changed.',
    ],
  };
}

function qualifyRows(rows, files, editedConfig) {
  for (const row of rows.filter(
    (row) => row.selection.file === target || row.label.endsWith(':hook-error')
  )) {
    const selected = row.label.endsWith(':selected');
    const expected = {
      source_sha256: files['src/lib/spa-route.ts'],
      test_sha256: files[target],
      environment: row.label.split(':')[0],
      config_sha256: row.label.endsWith(':config-recreated')
        ? editedConfig
        : files['vitest.config.ts'],
      lock_sha256: files['pnpm-lock.yaml'],
      selection: {
        file: target,
        pattern: selected ? 'keeps \\/app on the application shell$' : null,
      },
      names: selected ? [routeTestNames[0]] : routeTestNames,
    };
    if (row.label.endsWith(':hook-error')) {
      expected.test_sha256 = sourceDigest(consumerFixtures['src/study-hook.test.ts']);
      expected.selection = { file: 'src/study-hook.test.ts', pattern: null };
      expected.names = ['body before hook failure'];
    }
    row.execution_qualified = qualifyConsumerSelection(row, expected);
    const shouldQualify =
      /:(cold|warm|selected|dependency-restored|oracle-restored|config-recreated|config-restored)$/.test(
        row.label
      );
    assert.equal(row.execution_qualified, shouldQualify, row.label);
  }
}

async function defaultRunnerControl(root) {
  const scope = { repositoryRoot: root, adapter: 'vitest', target, timeoutMs: 15000 };
  const plan = await planPerformanceExecution(scope);
  assert.equal(plan.decision.status, 'admitted');
  const execution = await runClosedAdapter({ ...scope, executionPlan: plan });
  assert.equal(execution.exitCode, 0, execution.stderr);
  const result = JSON.parse(execution.stdout);
  assert.equal(result.numPassedTests, 18);
  assert.equal(result.numFailedTests, 0);
  const assertions = result.testResults.flatMap((file) => file.assertionResults);
  assert.equal(assertions.length, 18);
  assert.ok(assertions.every((test) => test.status === 'passed'));
  assert.deepEqual(
    assertions.map((test) => test.fullName).sort(),
    routeTestNames.map((name) => name.replace(' > ', ' ')).sort()
  );
  return {
    plan_id: plan.plan_id,
    enforcement: plan.enforcement,
    exit: execution.exitCode,
    assertion_results: assertions.map((test) => ({ name: test.fullName, status: test.status })),
    stderr: execution.stderr,
  };
}

async function invalidationControls(root) {
  const scope = { repositoryRoot: root, adapter: 'vitest', target, timeoutMs: 10000 };
  const rows = [];
  for (const file of ['src/lib/spa-route.ts', 'vitest.config.ts', 'pnpm-lock.yaml']) {
    const plan = await planPerformanceExecution(scope);
    const bytes = await readFile(join(root, file));
    try {
      await writeFile(join(root, file), Buffer.concat([bytes, Buffer.from('\n')]));
      let rejected = false;
      try {
        await assertPerformanceExecutionPlanCurrent({ ...scope, plan });
      } catch (error) {
        assert.match(error.message, /stale/);
        rejected = true;
      }
      const changed = sourceDigest(await readFile(join(root, file))) !== sourceDigest(bytes);
      assert.equal(changed, true);
      assert.equal(rejected, true);
      rows.push({
        file,
        baseline_dirty: plan.subject.dirty,
        stale_plan_rejected: rejected,
        exact_hash_changed: changed,
        reuse_qualified: false,
      });
    } finally {
      await writeFile(join(root, file), bytes);
    }
  }
  return rows;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  assert.ok(
    process.argv[2],
    'Provide a clean disposable Reader checkout at READER_BASE with frozen dependencies installed'
  );
  process.stdout.write(
    `${JSON.stringify(await vitestConsumerExperiment(process.argv[2], { disposableCheckout: process.argv.includes('--disposable-checkout') }), null, 2)}\n`
  );
}
