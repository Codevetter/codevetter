import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('verification learning executes Rust source, ledger, wording, and CLI acceptance', {
  timeout: 490_000,
}, async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      'cargo',
      [
        'test',
        '--locked',
        '--manifest-path',
        'crates/codevetter-core/Cargo.toml',
        '--features',
        'browser-agent',
        '--lib',
        '--bin',
        'codevetter',
        'verification_learning',
      ],
      { cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let output = '';
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') child.kill('SIGKILL');
      else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') reject(error);
        }
      }
    };
    const onSignal = () => stop();
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
    const timer = setTimeout(stop, 480_000);
    const cleanup = () => {
      clearTimeout(timer);
      process.removeListener('SIGTERM', onSignal);
      process.removeListener('SIGINT', onSignal);
    };
    const append = (chunk) => {
      if (Buffer.byteLength(output) + chunk.byteLength > 2 * 1024 * 1024) {
        stop();
        reject(new Error('Rust acceptance output exceeded 2 MiB'));
        return;
      }
      output += chunk;
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (code, signal) => {
      cleanup();
      resolve({ code, signal, output });
    });
  });
  assert.equal(result.code, 0, result.output);
  assert.equal(result.signal, null, result.output);
  const runs = [...result.output.matchAll(/test result: ok\. (\d+) passed;/g)].map((match) =>
    Number(match[1])
  );
  assert.equal(runs.length, 2, result.output);
  assert.ok(
    runs.every((count) => count > 0),
    result.output
  );
  for (const boundary of ['priority_', 'outcomes_', 'wording_', 'cli_']) {
    assert.ok(result.output.includes(`verification_learning_${boundary}`), result.output);
  }
});
