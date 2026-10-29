import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { observeNativeChild, runObservedNative } from './vitest-jsdom-processes.mjs';

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
