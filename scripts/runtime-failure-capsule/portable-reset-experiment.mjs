import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertPerformanceExecutionPlanCurrent,
  planPerformanceExecution,
} from './execution-governance.mjs';
import { runClosedAdapter } from './runner.mjs';
import { selectedWorkloadExecuted } from './performance.mjs';
import { sourceDigest } from './source-execution.mjs';

export async function portableResetExperiment() {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-reset-'));
  try {
    return await experiment(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function experiment(root) {
  const files = {
    'dependency.mjs': 'export const value = 1; let calls = 0; export const next = () => ++calls;',
    'config.json': '{"mode":"node"}',
    'fixture.lock': 'locked',
    'reset.test.mjs': `import test from 'node:test'; import assert from 'node:assert/strict';
import { next, value } from './dependency.mjs';
test('module reset', () => { assert.equal(next(), 1); assert.equal(value, 1); });
test('node environment', () => assert.equal(typeof document, 'undefined'));
test('timer reset', t => { t.mock.timers.enable({apis:['setTimeout']}); let n = 0;
 setTimeout(() => n++, 20); t.mock.timers.tick(20); assert.equal(n, 1); t.mock.timers.reset(); });
test('failing oracle', () => assert.equal(value, 99));`,
    'reuse.mjs': `import assert from 'node:assert/strict';
const first = await import('./dependency.mjs'); assert.equal(first.next(), 1);
const second = await import('./dependency.mjs'); assert.equal(second.next(), 2);
console.log(JSON.stringify({same_module: first === second, shared_counter: 2}));`,
    'wait.mjs':
      "import {writeFileSync} from 'node:fs'; writeFileSync('.codevetter/workload-start.json', JSON.stringify({pid: process.pid})); setInterval(() => {}, 1000);",
  };
  for (const [name, data] of Object.entries(files)) await writeFile(join(root, name), data);
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
    execFileSync('git', args, { cwd: root });
  const execute = async (target, name = null) => {
    const scope = {
      repositoryRoot: root,
      adapter: target.endsWith('.test.mjs') ? 'node-test' : 'node-script',
      target,
      name,
      timeoutMs: 5000,
    };
    const executionPlan = await planPerformanceExecution(scope);
    assert.equal(executionPlan.decision.status, 'admitted');
    const run = await runClosedAdapter({ ...scope, executionPlan });
    return {
      name,
      status: run.status,
      exit: run.exitCode,
      executed:
        scope.adapter === 'node-test' ? selectedWorkloadExecuted(run, scope.adapter, name) : null,
      stdout: run.stdout,
    };
  };
  const runs = [];
  // Fixed input and real assertions; this is reset/correctness evidence, not timing.
  for (const name of [
    'module reset',
    'node environment',
    'timer reset',
    'module reset',
    'failing oracle',
    'absent',
  ]) {
    const run = await execute('reset.test.mjs', name);
    assert.equal(run.exit, name === 'failing oracle' ? 1 : 0);
    assert.equal(run.executed, name !== 'absent');
    runs.push(run);
  }
  const full = await execute('reset.test.mjs');
  assert.equal(full.exit, 1);
  const reuse = await execute('reuse.mjs');
  assert.equal(reuse.exit, 0);
  const invalidations = [];
  const scope = {
    repositoryRoot: root,
    adapter: 'node-test',
    target: 'reset.test.mjs',
    name: 'module reset',
    timeoutMs: 5000,
  };
  for (const name of ['dependency.mjs', 'config.json', 'fixture.lock']) {
    const plan = await planPerformanceExecution(scope);
    const old = await readFile(join(root, name), 'utf8');
    await writeFile(join(root, name), `${old}\n`);
    await assert.rejects(assertPerformanceExecutionPlanCurrent({ ...scope, plan }), /stale/);
    invalidations.push({ file: name, stale_plan_rejected: true });
    await writeFile(join(root, name), old);
  }
  await writeFile(
    join(root, 'dependency.mjs'),
    files['dependency.mjs'].replace('value = 1', 'value = 2')
  );
  const edited = await execute('reset.test.mjs', 'module reset');
  assert.equal(edited.exit, 1);
  await writeFile(join(root, 'dependency.mjs'), files['dependency.mjs']);
  const recovered = await execute('reset.test.mjs', 'module reset');
  assert.equal(recovered.exit, 0);
  const cancellation = await cancelOwnedSupervisor(root);
  return {
    schema_version: 'codevetter.portable-reset-study/v1',
    runtime: process.version,
    implementation_sha256: sourceDigest(
      await readFile(new URL('./portable-reset-experiment.mjs', import.meta.url))
    ),
    fixture_sha256: Object.fromEntries(
      Object.entries(files).map(([name, data]) => [name, sourceDigest(data)])
    ),
    runs,
    full_suite: full,
    module_reuse: reuse,
    invalidations,
    edited,
    recovered,
    cancellation,
    limitations: [
      'Node synthetic checks only; Node environment is not jsdom equivalence.',
      'Fresh-child reset is not a supported warm-verifier or transform-cache qualification.',
      'No elapsed-time, memory improvement, or agent-benefit claim.',
      'A signaled supervisor does not prove descendant cleanup; inspect cancellation_qualified.',
    ],
  };
}

async function cancelOwnedSupervisor(root) {
  const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
  const child = spawn(
    process.execPath,
    [
      cli,
      'supervise-performance',
      '--repo',
      root,
      '--run-id',
      'cancelled-study',
      '--adapter',
      'node-script',
      '--target',
      'wait.mjs',
      '--samples',
      '2',
      '--warmups',
      '0',
      '--timeout-ms',
      '5000',
      '--json',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: root } }
  );
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.resume();
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  let workload;
  try {
    let running;
    for (let attempt = 0; attempt < 500; attempt++) {
      try {
        running = JSON.parse(
          await readFile(
            join(root, '.codevetter/performance-runs/cancelled-study/receipt.json'),
            'utf8'
          )
        );
      } catch {
        /* not started */
      }
      try {
        workload = JSON.parse(
          await readFile(join(root, '.codevetter/workload-start.json'), 'utf8')
        );
      } catch {
        /* not executing yet */
      }
      if (running?.child?.pid && workload?.pid) break;
      await delay(10);
    }
    assert.ok(running?.child?.pid, 'owned supervisor child must start before cancellation');
    assert.ok(workload?.pid, 'actual workload must execute before cancellation');
    child.kill('SIGTERM');
    await closed;
    const receipt = JSON.parse(output);
    assert.equal(receipt.state, 'signaled');
    assert.equal(receipt.result, null);
    assert.throws(() => process.kill(running.child.pid, 0), { code: 'ESRCH' });
    const workloadSurvived = await remainsAfterCleanup(workload.pid);
    if (workloadSurvived) process.kill(workload.pid, 'SIGKILL');
    workload = null; // Do not signal a numeric PID again after cleanup.
    return {
      workload_survived_supervisor: workloadSurvived,
      study_cleanup_signal_sent: workloadSurvived,
      cancellation_qualified: !workloadSurvived,
      state: receipt.state,
      signal: receipt.child.signal,
      result: receipt.result,
      owned_child_gone: true,
      verdict: 'no_confidence',
    };
  } finally {
    if (workload?.pid) {
      try {
        process.kill(workload.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

async function remainsAfterCleanup(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
      return false;
    }
    await delay(10);
  }
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  process.stdout.write(`${JSON.stringify(await portableResetExperiment(), null, 2)}\n`);
