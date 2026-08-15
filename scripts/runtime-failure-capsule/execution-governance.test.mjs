import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  createPerformanceExecutionReceipt,
  planPerformanceExecution,
  validatePerformanceExecutionPlan,
} from './execution-governance.mjs';
import { runClosedAdapter } from './runner.mjs';
import { profileRepository } from './performance.mjs';
import { supervisePerformanceRun } from './supervision.mjs';

const run = promisify(execFile);

test('local plan is immutable, bounded, and stable without running project code', async (context) => {
  const root = await fixture(context, {
    'bench.mjs': "process.stdout.write('not executed');\n",
  });
  const input = {
    repositoryRoot: root,
    adapter: 'node-script',
    target: 'bench.mjs',
    timeoutMs: 1_000,
    processCount: 4,
  };
  const first = await planPerformanceExecution(input);
  const second = await planPerformanceExecution(input);

  assert.equal(first.decision.status, 'admitted');
  assert.equal(first.plan_id, second.plan_id);
  assert.deepEqual(first.limits, {
    max_wall_time_ms: 4_000,
    max_processes: 4,
    max_concurrency: 1,
    max_retries: 0,
    max_external_requests: 0,
    max_cost_microusd: 0,
  });
  assert.deepEqual(first.external_services, []);
  assert.ok(
    validatePerformanceExecutionPlan({ ...first, unexpected: true }).includes(
      'plan contains unknown field: unexpected'
    )
  );
  assert.ok(
    validatePerformanceExecutionPlan({
      ...first,
      limits: { ...first.limits, unexpected: true },
    }).includes('limits contains unknown field: unexpected')
  );
  assert.ok(
    validatePerformanceExecutionPlan({
      ...first,
      decision: { ...first.decision, blockers: [42] },
    }).includes('decision is invalid')
  );
});

test('remote and production-like plans fail closed even with an approval identity', async (context) => {
  const root = await fixture(context, {
    'stress-production.mjs': "await fetch('https://api.openai.com/v1/models');\n",
  });
  const plan = await planPerformanceExecution({
    repositoryRoot: root,
    adapter: 'node-script',
    target: 'stress-production.mjs',
    name: 'production stress test',
    timeoutMs: 1_000,
    processCount: 1,
    approvalIdentity: 'owner-approved-123',
  });
  const receipt = createPerformanceExecutionReceipt(plan);

  assert.equal(plan.decision.status, 'blocked');
  assert.equal(plan.approval_identity, 'owner-approved-123');
  assert.ok(plan.external_services.includes('api.openai.com'));
  assert.equal(plan.limits.max_cost_microusd, null);
  assert.equal(receipt.status, 'blocked');
  assert.equal(receipt.observed.processes, 0);
  assert.equal(receipt.observed.successful_external_requests, 0);
  assert.equal(receipt.observed.cost_microusd, null);
});

test('runtime guard permits loopback and blocks imported remote access without internet', async (context) => {
  const server = http.createServer((_request, response) => response.end('ok'));
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  context.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));
  const address = server.address();
  const root = await fixture(context, {
    'local.mjs': "import './local-dependency.mjs';\n",
    'local-dependency.mjs': `const response = await fetch('http://127.0.0.1:${address.port}/'); if ((await response.text()) !== 'ok') process.exitCode = 1;\n`,
    'remote.mjs': "import './remote-dependency.mjs';\n",
    'remote-dependency.mjs': "await fetch('http://192.0.2.1/');\n",
  });
  const localPlan = await planPerformanceExecution({
    repositoryRoot: root,
    adapter: 'node-script',
    target: 'local.mjs',
    timeoutMs: 5_000,
    processCount: 1,
  });
  const local = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'node-script',
    target: 'local.mjs',
    timeoutMs: 5_000,
    executionPlan: localPlan,
  });
  assert.equal(local.status, 'exited');
  assert.equal(local.exitCode, 0, local.stderr);

  const remotePlan = await planPerformanceExecution({
    repositoryRoot: root,
    adapter: 'node-script',
    target: 'remote.mjs',
    timeoutMs: 5_000,
    processCount: 1,
  });
  const remote = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'node-script',
    target: 'remote.mjs',
    timeoutMs: 5_000,
    executionPlan: remotePlan,
  });
  const receipt = createPerformanceExecutionReceipt(remotePlan, [
    { phase: 'measurement', index: 0, execution: remote },
  ]);
  assert.notEqual(remote.exitCode, 0);
  assert.match(remote.stderr, /CODEVETTER_EGRESS_BLOCKED/);
  assert.equal(receipt.status, 'policy_violation');
  assert.equal(receipt.observed.blocked_external_attempts, 1);
  assert.equal(receipt.observed.successful_external_requests, 0);
  assert.equal(receipt.observed.retries, 0);
});

test('runner rejects a stale target identity before execution', async (context) => {
  const root = await fixture(context, { 'bench.mjs': "process.stdout.write('old');\n" });
  const plan = await planPerformanceExecution({
    repositoryRoot: root,
    adapter: 'node-script',
    target: 'bench.mjs',
    timeoutMs: 1_000,
    processCount: 1,
  });
  await writeFile(join(root, 'bench.mjs'), "process.stdout.write('new');\n");
  await assert.rejects(
    runClosedAdapter({
      repositoryRoot: root,
      adapter: 'node-script',
      target: 'bench.mjs',
      timeoutMs: 1_000,
      executionPlan: plan,
    }),
    /plan identity is stale/
  );
});

test('profile and dry-run CLI emit machine-readable blocked evidence before project code', async (context) => {
  const root = await fixture(context, {
    'remote.mjs':
      "await fetch('https://paid.example.test/work');\nprocess.stdout.write('must-not-run');\n",
  });
  const capsule = await profileRepository({
    repositoryRoot: root,
    adapter: 'node-script',
    target: 'remote.mjs',
    timeoutMs: 1_000,
    samples: 2,
    warmups: 0,
  });
  assert.equal(capsule.verdict.status, 'no_confidence');
  assert.equal(capsule.observed.executions.length, 0);
  assert.equal(capsule.execution_governance.receipt.status, 'blocked');
  assert.equal(capsule.execution_governance.receipt.observed.processes, 0);

  const supervised = await supervisePerformanceRun({
    repositoryRoot: root,
    runId: 'blocked-remote-run',
    adapter: 'node-script',
    target: 'remote.mjs',
    timeoutMs: 1_000,
    samples: 2,
    warmups: 0,
  });
  assert.equal(supervised.state, 'blocked');
  assert.equal(supervised.child.pid, null);
  assert.equal(supervised.execution_governance.receipt.observed.processes, 0);

  await assert.rejects(
    run(
      process.execPath,
      [
        join(import.meta.dirname, 'cli.mjs'),
        'plan-performance',
        '--repo',
        root,
        '--adapter',
        'node-script',
        '--target',
        'remote.mjs',
        '--samples',
        '2',
        '--warmups',
        '0',
        '--timeout-ms',
        '1000',
        '--json',
      ],
      { cwd: root }
    ),
    (error) => {
      const plan = JSON.parse(error.stdout);
      assert.equal(error.code, 2);
      assert.equal(plan.decision.status, 'blocked');
      assert.equal(plan.limits.max_cost_microusd, null);
      return true;
    }
  );
});

async function fixture(context, files) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-execution-governance-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  await run('git', ['init', '-q'], { cwd: root });
  await run('git', ['add', '.'], { cwd: root });
  await run(
    'git',
    [
      '-c',
      'user.name=CodeVetter',
      '-c',
      'user.email=codevetter@example.invalid',
      'commit',
      '-qm',
      'fixture',
    ],
    { cwd: root }
  );
  return root;
}
