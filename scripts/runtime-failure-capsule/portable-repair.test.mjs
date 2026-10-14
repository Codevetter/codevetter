import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { portableRepairExperiment } from './portable-repair-experiment.mjs';
import {
  planPerformanceExecution,
  assertPerformanceExecutionPlanCurrent,
} from './execution-governance.mjs';
import { spawnOwnedProcess, terminateOwnedProcess, ownedProcessOutcome } from './owned-process.mjs';

const posix = {
  timeout: 20000,
  skip: process.platform === 'win32' && 'Windows Job Object tree cleanup is not implemented',
};
test(
  'dirty source/config/lock edits invalidate, and real started cancellation preserves unowned processes',
  posix,
  async () => {
    const report = await portableRepairExperiment();
    assert.ok(report.invalidations.every((row) => row.already_dirty && row.stale_rejected));
    assert.deepEqual(report.cancellation, {
      actual_body_started: true,
      workload_running_after_cancel: false,
      study_cleanup_required: false,
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

test(
  'owned guard cleans inherited-group grandchildren even when the program exits normally',
  posix,
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'codevetter-group-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const code = `const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs');
const c=spawn(process.execPath,['-e',"require('node:fs').writeFileSync('started',String(process.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"],{stdio:'ignore'}); c.unref();
const timer=setInterval(()=>{if(require('node:fs').existsSync('started')){clearInterval(timer);process.exit(7)}},10);`;
    const child = spawnOwnedProcess(process.execPath, ['-e', code], {
      cwd: root,
      env: {},
      shell: false,
    });
    const [codeOut, signal] = await once(child, 'close');
    assert.equal(ownedProcessOutcome(child, codeOut, signal).code, 7);
    const pid = Number(await readFile(join(root, 'started'), 'utf8'));
    await assertGone(pid);
    // Delayed/repeated cleanup after close must be inert, never signal a stale group.
    terminateOwnedProcess(child, 'SIGTERM');
  }
);

for (const action of ['disconnect', 'SIGTERM']) {
  test(`owned guard cleans a started TERM-resistant child after ${action}`, posix, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'codevetter-owner-loss-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const child = spawnOwnedProcess(
      process.execPath,
      [
        '-e',
        "require('node:fs').writeFileSync('started',String(process.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)",
      ],
      { cwd: root, env: {}, shell: false }
    );
    // Some hosted Node transports omit close after explicit IPC disconnect;
    // the exit event plus independent workload liveness is the cleanup oracle.
    const closed = once(child, action === 'disconnect' ? 'exit' : 'close');
    t.after(() => terminateOwnedProcess(child, 'SIGTERM'));
    let pid;
    for (let attempt = 0; attempt < 500 && !pid; attempt++) {
      try {
        pid = Number(await readFile(join(root, 'started'), 'utf8'));
      } catch {
        /* not started */
      }
      if (!pid) await delay(10);
    }
    assert.ok(pid, 'actual body must start before owner loss');
    if (action === 'disconnect') child.disconnect();
    else terminateOwnedProcess(child, action);
    const [code, signal] = await closed;
    assert.equal(ownedProcessOutcome(child, code, signal).signal, 'SIGKILL');
    await assertGone(pid);
  });
}

async function assertGone(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      assert.equal(error.code, 'ESRCH');
      return;
    }
    await delay(10);
  }
  assert.fail('owned child remained alive after bounded cleanup');
}
