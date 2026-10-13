import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  planPerformanceExecution,
  assertPerformanceExecutionPlanCurrent,
} from './execution-governance.mjs';
import { parseConsoleBenchmarkMetrics, selectedWorkloadExecuted } from './performance.mjs';
import { preflightAdapter, runClosedAdapter } from './runner.mjs';

// Bounded synthetic experiments, not a new verification lane or an acceleration claim.
// Every child executes through the existing zero-egress runner. Fixtures are retained.
export async function testingSpeedExperiment() {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-testing-speed-'));
  const files = {
    'package.json': '{"type":"module","private":true}',
    'logic.mjs': 'export const sum = (values) => values.reduce((a, b) => a + b, 0);',
    'logic.test.mjs': [
      "import test from 'node:test'; import assert from 'node:assert/strict';",
      "import { sum } from './logic.mjs';",
      "test('acceptance', () => assert.equal(sum([1, 2, 3]), 6));",
      "test('empty input', () => assert.equal(sum([]), 0));",
      "test('failing acceptance oracle', () => assert.equal(sum([1, 2, 3]), 7));",
    ].join('\n'),
    'missing.test.ts': "throw new Error('preflight must never load this module');",
    'wait.mjs': 'setInterval(() => {}, 1000);',
    'warm.mjs': 'let calls = 0; export const run = () => ++calls;',
    'config.json': '{"mode":"original"}',
    'fixture.lock': 'original',
  };
  const work =
    "let value = 0; for (let i = 0; i < 100000; i++) value += i; if (value !== 4999950000) throw Error('contract');";
  files['timing.mjs'] = work;
  files['metrics.mjs'] =
    `${work}\nconsole.log('[benchmark] checksum=' + value + 'items rss=' + process.memoryUsage().rss + 'bytes');`;
  for (const [path, source] of Object.entries(files)) await writeFile(join(root, path), source);
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'fixture',
    ],
  ])
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  const execute = async (target, name = null, timeoutMs = 5000) => {
    const adapter = target.endsWith('.test.mjs') ? 'node-test' : 'node-script';
    const scope = { repositoryRoot: root, adapter, target, name, timeoutMs, processCount: 1 };
    const plan = await planPerformanceExecution(scope);
    assert.equal(plan.decision.status, 'admitted');
    return runClosedAdapter({ ...scope, executionPlan: plan });
  };
  const selection = [];
  for (const name of [null, 'acceptance', 'failing acceptance oracle', 'absent name']) {
    const run = await execute('logic.test.mjs', name);
    selection.push({ name, exit: run.exitCode, elapsed_ms: run.durationMs, stdout: run.stdout });
  }
  assert.equal(selection[0].exit, 1);
  assert.equal(selection[1].exit, 0);
  assert.equal(selection[2].exit, 1);
  // Node's no-match exit can be zero: a fast clean exit alone is never execution proof.
  assert.match(selection[3].stdout, /^1\.\.0$/m);
  assert.doesNotMatch(
    selection[3].stdout,
    /# Subtest: (?:acceptance|empty input|failing acceptance oracle)/
  );
  assert.equal(
    selectedWorkloadExecuted(
      { stdout: selection[3].stdout, stderr: '' },
      'node-test',
      'absent name'
    ),
    false
  );
  const timings = [];
  for (let pair = 0; pair < 5; pair++) {
    for (const target of pair % 2 ? ['metrics.mjs', 'timing.mjs'] : ['timing.mjs', 'metrics.mjs']) {
      const run = await execute(target);
      assert.equal(run.exitCode, 0);
      const metrics = parseConsoleBenchmarkMetrics(run.stdout);
      assert.equal(metrics.length, target === 'metrics.mjs' ? 1 : 0);
      timings.push({ pair, target, elapsed_ms: run.durationMs, metrics });
    }
  }
  const start = performance.now();
  const prerequisite = await preflightAdapter({
    repositoryRoot: root,
    adapter: 'vitest',
    target: 'missing.test.ts',
  });
  assert.equal(prerequisite.status, 'unavailable');
  const prerequisiteMs = performance.now() - start;
  const cancelled = await execute('wait.mjs', null, 1000);
  assert.notEqual(cancelled.status, 'exited');
  assert.notEqual(cancelled.exitCode, 0);
  const staleScope = {
    repositoryRoot: root,
    adapter: 'node-script',
    target: 'timing.mjs',
    timeoutMs: 1000,
  };
  const stalePlan = await planPerformanceExecution(staleScope);
  await writeFile(join(root, 'timing.mjs'), `${work}\n// changed source`);
  await assert.rejects(
    assertPerformanceExecutionPlanCurrent({ ...staleScope, plan: stalePlan }),
    /stale/
  );

  const warm = await inspectModuleReuse(root);
  return {
    schema_version: 'codevetter.testing-speed-experiment/v1',
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    implementation_sha256: Object.fromEntries(
      await Promise.all(
        [
          'runner.mjs',
          'execution-governance.mjs',
          'performance.mjs',
          'testing-speed-experiment.mjs',
        ].map(async (name) => [
          name,
          createHash('sha256')
            .update(await readFile(new URL(name, import.meta.url)))
            .digest('hex'),
        ])
      )
    ),
    fixture_sha256: Object.fromEntries(
      Object.entries(files).map(([path, source]) => [
        path,
        createHash('sha256').update(source).digest('hex'),
      ])
    ),
    selection: selection.map(({ stdout, ...row }) => row),
    timing_pairs: timings,
    prerequisite: {
      status: prerequisite.status,
      elapsed_ms: prerequisiteMs,
      workload_executions: 0,
    },
    cancellation: { status: cancelled.status, exit: cancelled.exitCode },
    edited_execution_plan_rejected: true,
    unmatched_named_selection_rejected: true,
    module_reuse: warm,
    decisions: {
      exact_selection:
        'Keep explicit file/name selection only with acceptance coverage and nonzero execution proof; the selected pass omits a known failing oracle.',
      joint_timing_metrics:
        'Same-run timing and complete metrics are observable; this synthetic reporter calibration does not qualify removal of independent metric passes.',
      timing_only:
        'Retain as an experiment only. No CPU/allocation/profile verdict is available from exit status and wall time.',
      module_reuse:
        'Reject transparent shared-module reuse: repeated state and stale source change results. Versioned preparation and independent cold validation remain required.',
    },
    limitations: [
      'Synthetic Node pure-logic workload, not a production task or a with/without-agent trial.',
      'Each timed child is fresh; repeat pairs may benefit from host filesystem caches. No cache purge or machine isolation was performed.',
      'Reported RSS is instrumented metrics-child RSS, not a matched memory reduction or peak allocation attribution.',
      'Vitest/jsdom comparison and a compatible repository-owned warm daemon were not available in this fixture; no generic warm-verifier adoption is claimed.',
      'Changing configuration and lock bytes invalidates the demonstrated preparation key; this experiment does not implement a production cache.',
    ],
  };
}

async function inspectModuleReuse(root) {
  const identity = async () => {
    const hash = createHash('sha256').update(
      `${process.version}:${process.platform}:${process.arch}`
    );
    for (const path of ['warm.mjs', 'config.json', 'fixture.lock'])
      hash.update(await readFile(join(root, path)));
    return hash.digest('hex');
  };
  const url = pathToFileURL(join(root, 'warm.mjs')).href;
  const originalKey = await identity();
  const first = await import(url);
  assert.equal(first.run(), 1);
  assert.equal((await import(url)).run(), 2);
  await writeFile(join(root, 'warm.mjs'), 'let calls = 10; export const run = () => ++calls;');
  assert.equal((await import(url)).run(), 3);
  const editedKey = await identity();
  assert.notEqual(editedKey, originalKey);
  assert.equal((await import(`${url}?identity=${editedKey}`)).run(), 11);
  await writeFile(join(root, 'config.json'), '{"mode":"changed"}');
  const configKey = await identity();
  assert.notEqual(configKey, editedKey);
  await writeFile(join(root, 'fixture.lock'), 'changed');
  assert.notEqual(await identity(), configKey);
  return {
    shared_state_counterexample: true,
    stale_source_counterexample: true,
    source_config_lock_runtime_identity_checked: true,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.stdout.write(`${JSON.stringify(await testingSpeedExperiment(), null, 2)}\n`);
}
