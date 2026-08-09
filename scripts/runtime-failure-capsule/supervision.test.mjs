import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateSupervisedRunReceipt } from './supervision-contracts.mjs';
import { inspectSupervisedRun, supervisePerformanceRun } from './supervision.mjs';

test('persists and inspects a successful validated diagnosis', async (context) => {
  const root = await gitFixture(context);
  const receipt = await superviseFixture(root, 'success', printJson(validDiagnosis()));

  assert.equal(receipt.state, 'succeeded');
  assert.equal(receipt.child.exit_code, 0);
  assert.equal(receipt.failure, null);
  assert.equal(receipt.capture.truncated, false);
  assert.equal(receipt.result.path, '.codevetter/performance-runs/success/result.json');
  assert.match(receipt.result.sha256, /^[0-9a-f]{64}$/);

  const inspected = await inspectSupervisedRun(root, 'success');
  assert.equal(inspected.receipt.run_id, 'success');
  assert.equal(inspected.result_summary.verdict.status, 'measured');
  assert.equal(inspected.result_summary.diagnosis.kind, 'repository_cpu_candidate');

  await assert.rejects(
    () => superviseFixture(root, 'success', printJson(validDiagnosis())),
    /EEXIST/
  );
});

test('runs the existing diagnosis pipeline through the public supervisor boundary', async (context) => {
  const root = await gitFixture(
    context,
    [
      'let total = 0;',
      'for (let index = 0; index < 5000; index += 1) total += index;',
      "console.log('[benchmark] size5000=0.25ms/op total=' + total + 'count');",
      '',
    ].join('\n')
  );
  const receipt = await supervisePerformanceRun({
    repositoryRoot: root,
    runId: 'real-pipeline',
    adapter: 'node-script',
    target: 'src/benchmark.mjs',
    samples: 2,
    warmups: 0,
    timeoutMs: 5_000,
    heartbeatMs: 20,
    supervisorDeadlineMs: 15_000,
  });

  assert.equal(receipt.state, 'succeeded', JSON.stringify(receipt.failure));
  const inspected = await inspectSupervisedRun(root, 'real-pipeline');
  assert.equal(inspected.result_summary.scope.target, 'src/benchmark.mjs');
  assert.ok(
    ['measured', 'actionable', 'needs_better_workload', 'no_confidence'].includes(
      inspected.result_summary.verdict.status
    )
  );
});

test('exposes closed start and inspection operations through the CLI', async (context) => {
  const root = await gitFixture(context);
  const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
  const started = JSON.parse(
    await commandOutput(
      process.execPath,
      [
        cli,
        'supervise-performance',
        '--repo',
        root,
        '--run-id',
        'cli-run',
        '--adapter',
        'node-script',
        '--target',
        'src/benchmark.mjs',
        '--samples',
        '2',
        '--warmups',
        '0',
        '--timeout-ms',
        '5000',
        '--json',
      ],
      root
    )
  );
  assert.equal(started.state, 'succeeded');

  const inspected = JSON.parse(
    await commandOutput(
      process.execPath,
      [cli, 'inspect-performance-run', '--repo', root, '--run-id', 'cli-run', '--json'],
      root
    )
  );
  assert.equal(inspected.receipt.run_id, 'cli-run');
  assert.equal(inspected.result_summary.scope.target, 'src/benchmark.mjs');
});

test('persists bounded redacted failure evidence', async (context) => {
  const root = await gitFixture(context);
  const script = [
    `process.stdout.write(${JSON.stringify(`${root}/src/benchmark.mjs token=private-value`)});`,
    `process.stderr.write(${JSON.stringify('authorization: Bearer private-token')});`,
    'process.exit(3);',
  ].join('');
  const receipt = await superviseFixture(root, 'failed', script);

  assert.equal(receipt.state, 'failed');
  assert.equal(receipt.child.exit_code, 3);
  assert.match(receipt.failure.stdout, /<repo>\/src\/benchmark\.mjs token=<redacted>/);
  assert.match(receipt.failure.stderr, /authorization: <redacted>/i);
  assert.doesNotMatch(JSON.stringify(receipt), /private-value|private-token/);
  assert.ok(receipt.capture.redaction_count >= 3);
});

test('persists timeout, signal, spawn, and invalid-result terminal states', async (context) => {
  const root = await gitFixture(context);

  const timedOut = await superviseFixture(root, 'timeout', 'setInterval(() => {}, 1000);', {
    supervisorDeadlineMs: 40,
    heartbeatMs: 10,
  });
  assert.equal(timedOut.state, 'timed_out');
  assert.equal(timedOut.child.signal, 'SIGTERM');

  if (process.platform !== 'win32') {
    const signaled = await superviseFixture(
      root,
      'signaled',
      "process.kill(process.pid, 'SIGTERM');"
    );
    assert.equal(signaled.state, 'signaled');
    assert.equal(signaled.child.signal, 'SIGTERM');
  }

  const spawnFailed = await superviseFixture(root, 'spawn-failed', '', {
    childOverride: {
      program: join(root, 'missing-executable'),
      args: [],
      cwd: root,
      environment: {},
    },
  });
  assert.equal(spawnFailed.state, 'spawn_failed');
  assert.match(spawnFailed.failure.operational_error, /ENOENT|spawn/i);

  const invalid = await superviseFixture(root, 'invalid', "process.stdout.write('{bad json');");
  assert.equal(invalid.state, 'invalid_result');
  assert.match(invalid.failure.operational_error, /JSON/i);
  assert.equal(invalid.result, null);
});

test('rejects unsafe IDs and detects result tampering', async (context) => {
  const root = await gitFixture(context);
  await assert.rejects(
    () => superviseFixture(root, '../escape', printJson(validDiagnosis())),
    /run ID/
  );

  await superviseFixture(root, 'tampered', printJson(validDiagnosis()));
  await writeFile(
    join(root, '.codevetter/performance-runs/tampered/result.json'),
    `${JSON.stringify(validDiagnosis({ verdict: { status: 'actionable' } }))}\n`
  );
  await assert.rejects(() => inspectSupervisedRun(root, 'tampered'), /digest is invalid/);
});

test('keeps nested receipt fields closed and state-consistent', async (context) => {
  const root = await gitFixture(context);
  const receipt = await superviseFixture(root, 'contract', printJson(validDiagnosis()));

  const unknownPolicy = structuredClone(receipt);
  unknownPolicy.policy.command = 'arbitrary';
  assert.ok(
    validateSupervisedRunReceipt(unknownPolicy).includes('policy has unknown field: command')
  );

  const missingResult = structuredClone(receipt);
  missingResult.result = null;
  assert.ok(
    validateSupervisedRunReceipt(missingResult).includes('succeeded receipt requires result')
  );

  const escapingResult = structuredClone(receipt);
  escapingResult.result.path = '.codevetter/performance-runs/another/result.json';
  assert.ok(validateSupervisedRunReceipt(escapingResult).includes('result.path is invalid'));
});

test('inspection observes an atomic running heartbeat while the child is active', async (context) => {
  const root = await gitFixture(context);
  const script = `setTimeout(() => process.stdout.write(${JSON.stringify(
    JSON.stringify(validDiagnosis())
  )}), 250);`;
  const completion = superviseFixture(root, 'active', script, { heartbeatMs: 15 });
  const active = await waitForInspection(
    root,
    'active',
    (entry) => entry.receipt.state === 'running'
  );

  assert.equal(active.result_summary, null);
  assert.ok(active.receipt.child.pid > 0);
  assert.ok(active.receipt.lifecycle.heartbeat_at);
  assert.equal((await completion).state, 'succeeded');
});

function superviseFixture(root, runId, script, options = {}) {
  return supervisePerformanceRun({
    repositoryRoot: root,
    runId,
    adapter: 'node-script',
    target: 'src/benchmark.mjs',
    samples: 2,
    warmups: 0,
    timeoutMs: 1_000,
    heartbeatMs: options.heartbeatMs ?? 20,
    supervisorDeadlineMs: options.supervisorDeadlineMs ?? 2_000,
    childOverride: options.childOverride ?? {
      program: process.execPath,
      args: ['-e', script],
      cwd: root,
      environment: { PATH: process.env.PATH ?? '', CI: '1' },
    },
  });
}

function printJson(value) {
  return `process.stdout.write(${JSON.stringify(JSON.stringify(value))});`;
}

function validDiagnosis(overrides = {}) {
  return {
    schema_version: 'runtime-performance-diagnosis/v1',
    subject: { repository_revision: 'abc123' },
    adapter: { kind: 'node-script' },
    scope: { target: 'src/benchmark.mjs', name: null },
    diagnosis: { kind: 'repository_cpu_candidate' },
    observed: [],
    inferred: [],
    unverified: [],
    next_action: { kind: 'none' },
    verification: { operation: 'diagnose-performance' },
    limitations: [],
    verdict: { status: 'measured', reason: 'Fixture diagnosis.' },
    performance_capsule: {
      schema_version: 'runtime-performance-capsule/v1',
      subject: { repository_revision: 'abc123' },
      adapter: { kind: 'node-script' },
      scope: { target: 'src/benchmark.mjs', name: null },
      observed: { executions: [], hotspots: [] },
      findings: [],
      unverified: [],
      limitations: [],
      verdict: { status: 'profiled', reason: 'Fixture profile.' },
    },
    ...overrides,
  };
}

async function gitFixture(context, benchmark = 'console.log("fixture");\n') {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-supervision-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/benchmark.mjs'), benchmark);
  await command('git', ['init', '-q'], root);
  await command('git', ['add', '.'], root);
  await command(
    'git',
    [
      '-c',
      'user.name=CodeVetter Test',
      '-c',
      'user.email=codevetter@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'fixture baseline',
    ],
    root
  );
  return root;
}

function command(program, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${program} failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

function commandOutput(program, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(new Error(`${program} failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

async function waitForInspection(root, runId, predicate) {
  const deadline = Date.now() + 1_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await inspectSupervisedRun(root, runId);
      if (predicate(result)) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw lastError ?? new Error('supervised run did not reach the expected state');
}
