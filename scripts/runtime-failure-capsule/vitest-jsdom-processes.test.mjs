import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import {
  observeNativeChild,
  runObservedNative,
  NATIVE_NETWORK_POLICY,
  withStudyCancellation,
} from './vitest-jsdom-processes.mjs';
import { restorePreparationFiles } from './vitest-jsdom-experiment.mjs';

test('cancellation outside the native child lifetime cannot return a successful study', async () => {
  const listeners = process.listenerCount('SIGINT');
  await assert.rejects(
    withStudyCancellation(async () => {
      process.emit('SIGINT');
      return 'must not publish';
    }),
    { name: 'AbortError' }
  );
  assert.equal(process.listenerCount('SIGINT'), listeners);
});

test('native observer terminates its observed child tree and reads back no survivors', {
  skip: process.platform !== 'darwin',
  timeout: 10000,
}, async () => {
  const source =
    "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setTimeout(()=>{},4000)'],{stdio:'ignore'}); console.log(child.pid); setTimeout(()=>{},4000);";
  const child = spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'ignore'] });
  const closed = once(child, 'close');
  let observer;
  try {
    const [ready] = await once(child.stdout, 'data');
    const descendant = Number(String(ready).trim());
    assert.ok(descendant > 0);
    observer = await observeNativeChild(child.pid);
    await observer.terminate();
    const [, signal] = await closed;
    assert.equal(signal, 'SIGTERM');
    await delay(150);
    const result = await observer.stop();
    observer = null;
    assert.equal(result.failure, null);
    assert.ok(result.observed_processes.some((row) => row.pid === descendant));
    assert.deepEqual(result.surviving_processes, []);
  } finally {
    if (observer) {
      await observer.terminate();
      await observer.stop();
    }
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});

test('supervisor reaps an observed orphan after its root exits with inherited pipes', {
  skip: process.platform !== 'darwin',
  timeout: 10000,
}, async () => {
  const source =
    "const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setTimeout(()=>{},4000)'],{stdio:'inherit'});console.log(c.pid);setTimeout(()=>process.exit(1),150);";
  const result = await runObservedNative(process.execPath, ['-e', source], {
    timeoutMs: 2000,
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 'cleanup_required');
  assert.equal(result.exitCode, 1);
  assert.ok(result.orphaned_before_cleanup.length > 0);
  assert.deepEqual(result.process_observation.surviving_processes, []);
  assert.equal(result.forced_return, undefined);
});

test('supervisor reaps an unsampled process-group orphan after an immediate root exit', {
  skip: process.platform !== 'darwin',
  timeout: 10000,
}, async (t) => {
  const result = await runObservedNative('/bin/sh', ['-c', 'sleep 4 & echo $!; exit 0'], {
    timeoutMs: 500,
    env: { PATH: process.env.PATH },
  });
  const descendant = Number(result.stdout.trim());
  t.after(() => {
    if (descendant > 0) {
      try {
        process.kill(descendant, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  });
  assert.ok(descendant > 0);
  assert.ok(['cleanup_unqualified', 'cleanup_required'].includes(result.status));
  assert.equal(result.forced_return, undefined);
  assert.deepEqual(result.process_observation.surviving_processes, []);
  assert.deepEqual(result.process_observation.unverified_group_processes, []);
  assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
});

test('cancelled source configuration and lock mutation probes restore bytes and reap children', {
  skip: process.platform !== 'darwin',
  timeout: 10000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-owned-cancel-'));
  const paths = ['src/logic.ts', 'vitest.config.ts', 'pnpm-lock.yaml'];
  t.after(async () => {
    for (const path of paths) await unlink(join(root, path));
    await rmdir(join(root, 'src'));
    await rmdir(root);
  });
  await mkdir(join(root, 'src'));
  for (const path of paths) {
    const file = join(root, path);
    const original = Buffer.from('original bytes');
    await writeFile(file, original);
    const controller = new AbortController();
    const source = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(file)},'changed');setTimeout(()=>{},4000);`;
    const running = runObservedNative(process.execPath, ['-e', source], {
      signal: controller.signal,
      timeoutMs: 2000,
      env: { PATH: process.env.PATH },
    });
    let changed = false;
    for (let index = 0; index < 100 && !changed; index++) {
      changed = (await readFile(file, 'utf8')) === 'changed';
      if (!changed) await delay(10);
    }
    assert.ok(changed);
    controller.abort();
    let result;
    try {
      result = await running;
    } finally {
      await restorePreparationFiles(root, [[path, original]]);
    }
    assert.equal(result.status, 'cancelled');
    assert.deepEqual(result.process_observation.surviving_processes, []);
    assert.deepEqual(await readFile(file), original);
  }
});

test('native profile denies non-loopback outbound access', {
  skip: process.platform !== 'darwin',
  timeout: 10000,
}, async () => {
  const source =
    "const net=require('node:net');const s=net.connect({host:'192.0.2.1',port:9});s.on('error',e=>{console.log(e.code);process.exit(['EPERM','EACCES'].includes(e.code)?0:1)});s.on('connect',()=>process.exit(1));";
  const result = await runObservedNative(
    '/usr/bin/sandbox-exec',
    ['-p', NATIVE_NETWORK_POLICY, process.execPath, '-e', source],
    { timeoutMs: 2000, env: { PATH: process.env.PATH } }
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /EPERM|EACCES/);
  assert.deepEqual(result.process_observation.surviving_processes, []);
});

test('native supervisor bounds timeout and distinguishes output overflow', {
  skip: process.platform !== 'darwin',
  timeout: 10000,
}, async () => {
  const result = await runObservedNative(
    process.execPath,
    ['-e', "console.log('started');setTimeout(()=>{},4000)"],
    { timeoutMs: 100, env: { PATH: process.env.PATH } }
  );
  assert.equal(result.status, 'timeout');
  assert.equal(result.signal, 'SIGTERM');
  assert.match(result.stdout, /started/);
  assert.deepEqual(result.process_observation.surviving_processes, []);
  const overflow = await runObservedNative(
    process.execPath,
    ['-e', "process.stdout.write('a'.repeat(1000));setTimeout(()=>{},4000)"],
    { outputBytes: 32, timeoutMs: 2000, env: { PATH: process.env.PATH } }
  );
  assert.equal(overflow.status, 'output_limit');
  assert.equal(Buffer.byteLength(overflow.stdout), 32);
  assert.equal(overflow.output_bytes, 1000);
  assert.deepEqual(overflow.process_observation.surviving_processes, []);
  const stubborn = await runObservedNative(
    process.execPath,
    ['-e', "process.on('SIGTERM',()=>{});console.log('ready');setTimeout(()=>{},4000)"],
    { timeoutMs: 100, env: { PATH: process.env.PATH } }
  );
  assert.equal(stubborn.status, 'timeout');
  assert.equal(stubborn.signal, 'SIGKILL');
  assert.match(stubborn.stdout, /ready/);
  assert.deepEqual(stubborn.process_observation.surviving_processes, []);
});
