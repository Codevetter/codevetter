import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const key = (row) => `${row.pid}:${row.birth}`;
export const NATIVE_NETWORK_POLICY =
  '(version 1)(allow default)(deny network*)(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))';

async function processTable() {
  const { stdout } = await promisify(execFile)(
    '/bin/ps',
    ['-axo', 'pid=,ppid=,pgid=,rss=,lstart='],
    {
      timeout: 2000,
      maxBuffer: 1048576,
    }
  );
  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [, pid, parent, group, rss, birth] =
        line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/) ?? [];
      assert.ok(birth, 'process inventory must be complete');
      return {
        pid: Number(pid),
        parent: Number(parent),
        group: Number(group),
        rss_bytes: Number(rss) * 1024,
        birth,
      };
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
  let polling = false;
  let failure = null;
  let latest = [];
  let uncertain = [];
  let groupEmptied = false;
  const currentGroup = (table) => {
    const members = table.filter((row) => row.group === rootPid);
    if (!members.length) groupEmptied = true;
    return groupEmptied ? [] : members;
  };
  const sample = async () => {
    const startedAt = Date.now();
    const table = await processTable();
    const root = table.find((row) => row.pid === rootPid);
    currentGroup(table);
    rootBirth ??= root?.birth;
    const descendants = root?.birth === rootBirth ? ownedSubtree(table, rootPid) : [];
    for (const row of descendants) observed.set(key(row), row);
    if (table.some((row) => row.group === rootPid && observed.has(key(row)))) {
      for (const row of table.filter((item) => item.group === rootPid)) observed.set(key(row), row);
    }
    latest = table.filter((row) => observed.has(key(row)));
    uncertain = table.filter((row) => row.group === rootPid && !observed.has(key(row)));
    samples.push({ started_at_ms: startedAt, finished_at_ms: Date.now(), processes: latest });
  };
  await sample();
  const timer = setInterval(() => {
    if (polling) return;
    polling = true;
    pending = sample()
      .catch((error) => {
        failure ??= error.message;
      })
      .finally(() => {
        polling = false;
      });
  }, 20);
  timer.unref();
  return {
    async terminate(signal = 'SIGTERM') {
      const table = await processTable();
      // The detached child's group remains owned even when its root exits before sampling.
      if (currentGroup(table).length) {
        try {
          process.kill(-rootPid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      for (const row of table.filter((item) => observed.has(key(item)))) {
        try {
          process.kill(row.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    },
    async refresh() {
      await pending;
      polling = true;
      try {
        await sample();
      } finally {
        polling = false;
      }
      return { surviving_processes: latest, unverified_group_processes: uncertain };
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
        await sample().catch((error) => {
          failure ??= error.message;
        });
      }
      return {
        root_pid: rootPid,
        interval_ms: 20,
        samples,
        observed_processes: [...observed.values()],
        surviving_processes: latest,
        unverified_group_processes: uncertain,
        failure,
      };
    },
  };
}

export function armProcessEvidence(observation, arm, excludedRoots = []) {
  const selected = observation.samples.filter(
    (sample) =>
      sample.started_at_ms >= arm.started_at_ms && sample.finished_at_ms <= arm.finished_at_ms
  );
  const processes = new Map();
  let maximum = 0;
  for (const sample of selected) {
    const excluded = new Set(
      excludedRoots.flatMap((root) => ownedSubtree(sample.processes, root)).map(key)
    );
    const tree = ownedSubtree(
      sample.processes.filter((row) => !excluded.has(key(row))),
      arm.controller_pid
    );
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
  assert.deepEqual(
    observation.unverified_group_processes,
    [],
    'unknown process-group membership cannot qualify'
  );
  report.lifecycle.orphaned = observation.surviving_processes;
  report.lifecycle.observed_processes = observation.observed_processes;
  const coldRoots = report.lifecycle.pairs.map((pair) => pair.cold.controller_pid);
  for (const pair of report.lifecycle.pairs)
    for (const arm of ['cold', 'warm']) {
      const row = pair[arm];
      row.memory = armProcessEvidence(observation, row, arm === 'warm' ? coldRoots : []);
      if (arm === 'cold') {
        const observed = new Set(row.memory.processes.map(key));
        row.orphaned = observation.surviving_processes.filter((item) => observed.has(key(item)));
      }
    }
}

export async function runObservedNative(
  program,
  args,
  { cwd, env, signal: cancellation, timeoutMs = 120000, outputBytes = 1048576 }
) {
  cancellation?.throwIfAborted();
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
  let observation;
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
    return observer?.terminate(signal).catch((error) => {
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
  const exited = new Promise((resolvePromise) =>
    child.once('exit', (exitCode, signal) => resolvePromise({ exitCode, signal }))
  );
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
  cancellation?.addEventListener('abort', cancel);
  if (cancellation?.aborted) cancel();
  const deadline = setTimeout(() => {
    if (status === 'exited') status = 'timeout';
    terminate();
  }, timeoutMs);
  deadline.unref();
  let forceDeadline;
  const forced = new Promise((resolvePromise) => {
    forceDeadline = setTimeout(() => {
      if (status === 'exited') status = 'timeout';
      terminate('SIGKILL');
      child.stdout.destroy();
      child.stderr.destroy();
      resolvePromise({ exitCode: child.exitCode, signal: child.signalCode, forced_return: true });
    }, timeoutMs + 1500);
    forceDeadline.unref();
  });
  try {
    await Promise.race([exited, forced]);
    await delay(50);
    const beforeCleanup = await observer.refresh();
    const needsCleanup = (value) =>
      value.surviving_processes.length || value.unverified_group_processes.length;
    if (needsCleanup(beforeCleanup)) {
      await terminate();
      await delay(100);
      if (needsCleanup(await observer.refresh())) await terminate('SIGKILL');
      if (status === 'exited')
        status = beforeCleanup.unverified_group_processes.length
          ? 'cleanup_unqualified'
          : 'cleanup_required';
    }
    const outcome = await Promise.race([closed, forced]);
    observation = await observer.stop();
    return {
      ...outcome,
      status: outcome.exitCode === 0 ? status : status === 'exited' ? 'failed' : status,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      operationalError,
      output_bytes: bytes,
      durationMs: performance.now() - started,
      process_observation: observation,
      orphaned_before_cleanup: beforeCleanup.surviving_processes,
      unverified_before_cleanup: beforeCleanup.unverified_group_processes,
    };
  } finally {
    if (!observation) {
      await terminate('SIGKILL');
      await observer.stop().catch((error) => {
        operationalError ??= error.message;
      });
    }
    clearTimeout(deadline);
    clearTimeout(escalation);
    clearTimeout(forceDeadline);
    cancellation?.removeEventListener('abort', cancel);
  }
}

export async function withStudyCancellation(operation) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGTERM', cancel);
  process.on('SIGINT', cancel);
  try {
    const result = await operation(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    process.removeListener('SIGTERM', cancel);
    process.removeListener('SIGINT', cancel);
  }
}
