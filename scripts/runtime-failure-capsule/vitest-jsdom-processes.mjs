import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const key = (row) => `${row.pid}:${row.birth}`;

async function processTable() {
  const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,ppid=,rss=,lstart='], {
    timeout: 2000,
    maxBuffer: 1048576,
  });
  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [, pid, parent, rss, birth] = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/) ?? [];
      assert.ok(birth, 'process inventory must be complete');
      return { pid: Number(pid), parent: Number(parent), rss_bytes: Number(rss) * 1024, birth };
    });
}

export function ownedSubtree(table, rootPid) {
  if (!table.some((row) => row.pid === rootPid)) return [];
  const owned = new Set([rootPid]);
  for (let before = -1; before !== owned.size; ) {
    before = owned.size;
    for (const row of table) if (owned.has(row.parent)) owned.add(row.pid);
  }
  return table.filter((row) => owned.has(row.pid));
}

export async function observeNativeChild(rootPid) {
  assert.ok(Number.isInteger(rootPid) && rootPid > 0);
  const observed = new Map();
  const samples = [];
  let rootBirth;
  let pending = Promise.resolve();
  let failure = null;
  let latest = [];
  const sample = async () => {
    const table = await processTable();
    const root = table.find((row) => row.pid === rootPid);
    rootBirth ??= root?.birth;
    const descendants = root?.birth === rootBirth ? ownedSubtree(table, rootPid) : [];
    for (const row of descendants) observed.set(key(row), row);
    latest = table.filter((row) => observed.has(key(row)));
    samples.push({ at_ms: Date.now(), processes: latest });
  };
  await sample();
  const timer = setInterval(() => {
    pending = pending.then(sample).catch((error) => {
      failure ??= error.message;
    });
  }, 20);
  timer.unref();
  return {
    async terminate(signal = 'SIGTERM') {
      const table = await processTable();
      for (const row of table.filter((item) => observed.has(key(item)))) {
        try {
          process.kill(row.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    },
    async stop() {
      clearInterval(timer);
      await pending;
      try {
        await sample();
      } catch (error) {
        failure ??= error.message;
      }
      for (let retry = 0; latest.length && retry < 10; retry++) {
        await delay(50);
        await sample();
      }
      return {
        root_pid: rootPid,
        interval_ms: 20,
        samples,
        observed_processes: [...observed.values()],
        surviving_processes: latest,
        failure,
      };
    },
  };
}

export function armProcessEvidence(observation, arm) {
  const selected = observation.samples.filter(
    (sample) => sample.at_ms >= arm.started_at_ms && sample.at_ms <= arm.finished_at_ms
  );
  const processes = new Map();
  let maximum = 0;
  for (const sample of selected) {
    const tree = ownedSubtree(sample.processes, arm.controller_pid);
    for (const row of tree) processes.set(key(row), row);
    maximum = Math.max(
      maximum,
      tree.reduce((sum, row) => sum + row.rss_bytes, 0)
    );
  }
  return {
    interval_ms: observation.interval_ms,
    samples: selected.length,
    controller_pid: arm.controller_pid,
    descendants_observed: [...processes.values()].filter((row) => row.pid !== arm.controller_pid)
      .length,
    maximum_sampled_tree_rss_bytes: maximum,
    processes: [...processes.values()],
  };
}

export function attachProcessEvidence(report, observation) {
  assert.equal(observation.failure, null, 'process observation must complete');
  report.lifecycle.orphaned = observation.surviving_processes;
  report.lifecycle.observed_processes = observation.observed_processes;
  for (const pair of report.lifecycle.pairs)
    for (const arm of ['cold', 'warm']) {
      const row = pair[arm];
      row.memory = armProcessEvidence(observation, row);
      if (arm === 'cold') {
        const observed = new Set(row.memory.processes.map(key));
        row.orphaned = observation.surviving_processes.filter((item) => observed.has(key(item)));
      }
    }
}

export async function runObservedNative(
  program,
  args,
  { cwd, env, timeoutMs = 120000, outputBytes = 1048576 }
) {
  const started = performance.now();
  const child = spawn(program, args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  let bytes = 0;
  let status = 'exited';
  let operationalError;
  let observer;
  let escalation;
  const terminate = (signal = 'SIGTERM') => {
    if (signal === 'SIGTERM' && !escalation) {
      escalation = setTimeout(() => terminate('SIGKILL'), 500);
      escalation.unref();
    }
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') operationalError ??= error.message;
      }
    }
    observer?.terminate(signal).catch((error) => {
      operationalError ??= error.message;
    });
  };
  const capture = (chunks) => (chunk) => {
    const remaining = Math.max(0, outputBytes - bytes);
    if (remaining) chunks.push(chunk.subarray(0, remaining));
    bytes += chunk.length;
    if (bytes > outputBytes) {
      status = 'output_limit';
      terminate();
    }
  };
  child.stdout.on('data', capture(stdout));
  child.stderr.on('data', capture(stderr));
  const closed = new Promise((resolvePromise) => {
    child.once('error', (error) => {
      operationalError = error.message;
      status = 'operational_failure';
    });
    child.once('close', (exitCode, signal) => resolvePromise({ exitCode, signal }));
  });
  if (!child.pid)
    return {
      ...(await closed),
      status,
      stdout: '',
      stderr: operationalError,
      durationMs: performance.now() - started,
    };
  try {
    observer = await observeNativeChild(child.pid);
  } catch (error) {
    terminate('SIGKILL');
    await closed;
    throw error;
  }
  const cancel = () => {
    status = 'cancelled';
    terminate();
  };
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  const deadline = setTimeout(() => {
    status = 'timeout';
    terminate();
  }, timeoutMs);
  deadline.unref();
  try {
    const outcome = await closed;
    const observation = await observer.stop();
    return {
      ...outcome,
      status: outcome.exitCode === 0 ? status : status === 'exited' ? 'failed' : status,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      operationalError,
      output_bytes: bytes,
      durationMs: performance.now() - started,
      process_observation: observation,
    };
  } finally {
    clearTimeout(deadline);
    clearTimeout(escalation);
    process.removeListener('SIGTERM', cancel);
    process.removeListener('SIGINT', cancel);
  }
}
