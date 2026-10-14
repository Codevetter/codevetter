import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, symlink, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { performanceInputIdentity } from './execution-identity.mjs';
import { ownedSupervisionInputs, SUPERVISION_INPUT_ENV } from './supervised-inputs.mjs';
import {
  portableRepairExperiment,
  reservedInputExperiment,
} from './portable-repair-experiment.mjs';
import {
  planPerformanceExecution,
  assertPerformanceExecutionPlanCurrent,
} from './execution-governance.mjs';

const posix = {
  timeout: 20000,
  skip: process.platform === 'win32' && 'POSIX supervisor cancellation observation',
};
test(
  'dirty source/config/lock edits invalidate while the unresolved cancellation negative is retained',
  posix,
  async () => {
    const report = await portableRepairExperiment();
    assert.ok(report.invalidations.every((row) => row.already_dirty && row.stale_rejected));
    assert.deepEqual(report.cancellation, {
      actual_body_started: true,
      workload_running_after_cancel: true,
      study_cleanup_required: true,
      unowned_alive: true,
      state: 'signaled',
      signal: 'SIGTERM',
      result: null,
      failure_kind: 'signaled',
    });
  }
);

test('input identity binds untracked bytes, staged edits, deletion, modes and contained symlinks without exposing paths', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'test.mjs'), 'console.log(1)');
  await writeFile(join(root, 'config.json'), '{}');
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
  const scope = {
    repositoryRoot: root,
    adapter: 'node-script',
    target: 'test.mjs',
    timeoutMs: 1000,
  };
  await writeFile(join(root, 'untracked.json'), 'first');
  let plan = await planPerformanceExecution(scope);
  await writeFile(join(root, 'untracked.json'), 'second');
  await assert.rejects(assertPerformanceExecutionPlanCurrent({ ...scope, plan }), /stale/);
  plan = await planPerformanceExecution(scope);
  await writeFile(join(root, 'config.json'), '{"changed":true}');
  execFileSync('git', ['add', 'config.json'], { cwd: root });
  await assert.rejects(assertPerformanceExecutionPlanCurrent({ ...scope, plan }), /stale/);
  plan = await planPerformanceExecution(scope);
  await rm(join(root, 'config.json'));
  await assert.rejects(assertPerformanceExecutionPlanCurrent({ ...scope, plan }), /stale/);
  assert.match(plan.subject.diff_identity, /^worktree-sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(plan), /untracked.json|config.json|changed/);
  const owned = '.codevetter/performance-runs/current';
  await mkdir(join(root, owned), { recursive: true });
  await writeFile(join(root, owned, 'receipt.json'), '{}');
  let identity = await performanceInputIdentity(root, owned);
  await writeFile(join(root, owned, 'receipt.json'), '{"heartbeat":2}');
  assert.equal(await performanceInputIdentity(root, owned), identity);
  await writeFile(join(root, owned, 'helper.mjs'), 'export const x=1;');
  identity = await performanceInputIdentity(root, owned);
  await writeFile(join(root, owned, 'helper.mjs'), 'export const x=2;');
  assert.notEqual(await performanceInputIdentity(root, owned), identity);
  execFileSync('git', ['add', `${owned}/receipt.json`], { cwd: root });
  identity = await performanceInputIdentity(root, owned);
  await writeFile(join(root, owned, 'receipt.json'), '{"heartbeat":3}');
  assert.notEqual(await performanceInputIdentity(root, owned), identity);
  const previous = process.env[SUPERVISION_INPUT_ENV];
  try {
    process.env[SUPERVISION_INPUT_ENV] = owned;
    await assert.rejects(ownedSupervisionInputs(root), /invalid supervised run receipt/);
  } finally {
    if (previous === undefined) delete process.env[SUPERVISION_INPUT_ENV];
    else process.env[SUPERVISION_INPUT_ENV] = previous;
  }
  if (process.platform !== 'win32') {
    plan = await planPerformanceExecution(scope);
    await chmod(join(root, 'test.mjs'), 0o755);
    await assert.rejects(assertPerformanceExecutionPlanCurrent({ ...scope, plan }), /stale/);
    await symlink('untracked.json', join(root, 'link.json'));
    plan = await planPerformanceExecution(scope);
    await writeFile(join(root, 'untracked.json'), 'third');
    await assert.rejects(assertPerformanceExecutionPlanCurrent({ ...scope, plan }), /stale/);
    await symlink(process.execPath, join(root, 'escape'));
    await assert.rejects(planPerformanceExecution(scope), /symlink escapes/);
  }
});

test('an imported helper or receipt-shaped configuration beneath another run cannot escape invalidation', async () => {
  const report = await reservedInputExperiment();
  assert.ok(
    report.rows.every((row) => row.already_dirty && row.stale_rejected && row.executed === null)
  );
});
