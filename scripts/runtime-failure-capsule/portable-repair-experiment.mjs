import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export async function portableRepairExperiment(
  sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
) {
  const moduleRoot = join(resolve(sourceRoot), 'scripts/runtime-failure-capsule');
  const { planPerformanceExecution, assertPerformanceExecutionPlanCurrent } = await import(
    pathToFileURL(join(moduleRoot, 'execution-governance.mjs'))
  );
  const root = await mkdtemp(join(tmpdir(), 'codevetter-repair-'));
  try {
    await mkdir(join(root, '.codevetter'));
    const files = {
      '.gitignore': '.codevetter/\n',
      'wait.mjs':
        "import {writeFileSync} from 'node:fs'; writeFileSync('.codevetter/started', String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
      'source.mjs': 'export const x = 1;',
      'config.json': '{"enabled":true}',
      'fixture.lock': 'locked',
    };
    for (const [file, text] of Object.entries(files)) await writeFile(join(root, file), text);
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
    await writeFile(join(root, 'source.mjs'), 'export const x = 2;');
    const scope = {
      repositoryRoot: root,
      adapter: 'node-script',
      target: 'wait.mjs',
      timeoutMs: 10000,
    };
    const invalidations = [];
    for (const file of ['source.mjs', 'config.json', 'fixture.lock']) {
      const plan = await planPerformanceExecution(scope);
      const original = await readFile(join(root, file));
      await writeFile(join(root, file), Buffer.concat([original, Buffer.from('\n')]));
      let rejected = false;
      try {
        await assertPerformanceExecutionPlanCurrent({ ...scope, plan });
      } catch (error) {
        assert.match(error.message, /stale/);
        rejected = true;
      }
      invalidations.push({ file, already_dirty: plan.subject.dirty, stale_rejected: rejected });
      await writeFile(join(root, file), original);
    }
    const cancellation = await cancelStarted(root, moduleRoot);
    return {
      runtime: process.version,
      platform: process.platform,
      fixture_sha256: Object.fromEntries(
        Object.entries(files).map(([file, text]) => [
          file,
          createHash('sha256').update(text).digest('hex'),
        ])
      ),
      invalidations,
      cancellation,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function cancelStarted(root, moduleRoot) {
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  const supervisor = spawn(
    process.execPath,
    [
      join(moduleRoot, 'cli.mjs'),
      'supervise-performance',
      '--repo',
      root,
      '--run-id',
      'repair',
      '--adapter',
      'node-script',
      '--target',
      'wait.mjs',
      '--samples',
      '2',
      '--warmups',
      '0',
      '--timeout-ms',
      '10000',
      '--json',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: root } }
  );
  let output = '';
  let stderr = '';
  supervisor.stdout.on('data', (chunk) => {
    output += chunk;
  });
  supervisor.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const closed = new Promise((resolvePromise, reject) => {
    supervisor.once('close', resolvePromise);
    supervisor.once('error', reject);
  });
  const deadline = setTimeout(() => supervisor.kill('SIGKILL'), 15000);
  deadline.unref();
  let pid;
  try {
    for (let attempt = 0; attempt < 500; attempt++) {
      try {
        pid = Number(await readFile(join(root, '.codevetter/started'), 'utf8'));
      } catch {
        /* not executing */
      }
      if (pid) break;
      await delay(10);
    }
    assert.ok(pid, `actual body did not start: ${output} ${stderr}`);
    supervisor.kill('SIGTERM');
    await closed;
    const receipt = JSON.parse(output);
    assert.equal(receipt.state, 'signaled');
    assert.equal(receipt.result, null);
    let running = true;
    for (let attempt = 0; attempt < 100 && running; attempt++) {
      running = await isRunning(pid);
      if (running) await delay(10);
    }
    const unownedAlive = await isRunning(sentinel.pid);
    if (running) process.kill(pid, 'SIGKILL');
    pid = null;
    return {
      actual_body_started: true,
      workload_running_after_cancel: running,
      study_cleanup_required: running,
      unowned_alive: unownedAlive,
      state: receipt.state,
      signal: receipt.child.signal,
      result: receipt.result,
      failure_kind: receipt.failure.kind,
    };
  } finally {
    clearTimeout(deadline);
    if (pid && (await isRunning(pid))) process.kill(pid, 'SIGKILL');
    if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill('SIGKILL');
    sentinel.kill('SIGTERM');
  }
}

async function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  process.stdout.write(
    `${JSON.stringify(await portableRepairExperiment(process.argv[2]), null, 2)}\n`
  );
