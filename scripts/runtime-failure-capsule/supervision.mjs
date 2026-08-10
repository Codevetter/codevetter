import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LIMITS,
  assertProfileAdapter,
  boundedCount,
  boundedTimeout,
  repositoryRelative,
  validatePerformanceDiagnosis,
} from './contracts.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import { redactJsonValue, redactText } from './redact.mjs';
import {
  SUPERVISED_RUN_SCHEMA_VERSION,
  SUPERVISION_LIMITS,
  assertRunId,
  assertSupervisedRunReceipt,
} from './supervision-contracts.mjs';

const RUNS_DIRECTORY = '.codevetter/performance-runs';
let temporarySequence = 0;

export async function supervisePerformanceRun({
  repositoryRoot,
  runId,
  adapter,
  target,
  name,
  timeoutMs,
  samples,
  warmups,
  heartbeatMs = SUPERVISION_LIMITS.heartbeatMs,
  supervisorDeadlineMs,
  childOverride,
}) {
  const requestedRoot = resolve(repositoryRoot);
  const root = await realpath(requestedRoot);
  const safeRunId = assertRunId(runId);
  const safeAdapter = assertProfileAdapter(adapter);
  const safeTimeout = boundedTimeout(timeoutMs);
  const safeSamples = boundedCount(samples, {
    name: 'samples',
    defaultValue: LIMITS.defaultSamples,
    minimum: LIMITS.minimumSamples,
    maximum: LIMITS.maximumSamples,
  });
  const safeWarmups = boundedCount(warmups, {
    name: 'warmups',
    defaultValue: LIMITS.defaultWarmups,
    maximum: LIMITS.maximumWarmups,
  });
  if (!Number.isInteger(heartbeatMs) || heartbeatMs < 10 || heartbeatMs > 60_000) {
    throw new Error('heartbeat interval must be between 10 and 60000 milliseconds');
  }
  await assertTarget(root, target);
  const git = await inspectGitDiff(root);
  const relativeDirectory = `${RUNS_DIRECTORY}/${safeRunId}`;
  const lexicalRunsDirectory = resolve(root, RUNS_DIRECTORY);
  await mkdir(lexicalRunsDirectory, { recursive: true });
  const realRunsDirectory = await realpath(lexicalRunsDirectory);
  if (repositoryRelative(root, realRunsDirectory) === null)
    throw new Error('run directory escapes repository');
  const absoluteDirectory = resolve(realRunsDirectory, safeRunId);
  await mkdir(absoluteDirectory, { recursive: false });

  const receiptPath = join(absoluteDirectory, 'receipt.json');
  const now = new Date().toISOString();
  let receipt = {
    schema_version: SUPERVISED_RUN_SCHEMA_VERSION,
    run_id: safeRunId,
    state: 'initialized',
    subject: { repository_revision: git.repository_revision, dirty: git.dirty },
    scope: { adapter: safeAdapter, target, name: name ?? null },
    policy: {
      samples: safeSamples,
      warmups: safeWarmups,
      timeout_ms: safeTimeout,
      supervisor_deadline_ms: boundedSupervisorDeadline(
        supervisorDeadlineMs ??
          deriveSupervisorDeadline(safeAdapter, safeTimeout, safeSamples, safeWarmups)
      ),
    },
    supervisor: { pid: process.pid, node_version: process.version },
    lifecycle: {
      created_at: now,
      started_at: null,
      heartbeat_at: null,
      completed_at: null,
    },
    child: { pid: null, exit_code: null, signal: null },
    result: null,
    failure: null,
    capture: {
      stdout_bytes: 0,
      stderr_bytes: 0,
      truncated: false,
      redaction_count: 0,
    },
    limitations: ['A supervised run proves only the recorded local performance scope.'],
  };
  await writeReceipt(receiptPath, receipt);

  const command =
    childOverride ??
    diagnosisCommand({
      root,
      adapter: safeAdapter,
      target,
      name,
      timeoutMs: safeTimeout,
      samples: safeSamples,
      warmups: safeWarmups,
    });
  const outcome = await superviseChild({
    program: command.program,
    args: command.args,
    cwd: command.cwd ?? root,
    environment: command.environment ?? minimalEnvironment(),
    deadlineMs: receipt.policy.supervisor_deadline_ms,
    heartbeatMs,
    repositoryRoot: root,
    onStarted: async (pid) => {
      const startedAt = new Date().toISOString();
      receipt = {
        ...receipt,
        state: 'running',
        lifecycle: { ...receipt.lifecycle, started_at: startedAt, heartbeat_at: startedAt },
        child: { ...receipt.child, pid },
      };
      await writeReceipt(receiptPath, receipt);
    },
    onHeartbeat: async () => {
      receipt = {
        ...receipt,
        lifecycle: { ...receipt.lifecycle, heartbeat_at: new Date().toISOString() },
      };
      await writeReceipt(receiptPath, receipt);
    },
  });

  const finalized = await finalizeRun({
    root,
    repositoryRoots: [requestedRoot, root],
    relativeDirectory,
    receipt,
    outcome,
  });
  await writeReceipt(receiptPath, finalized);
  return finalized;
}

export async function inspectSupervisedRun(repositoryRoot, runId) {
  const root = await realpath(resolve(repositoryRoot));
  const safeRunId = assertRunId(runId);
  const absoluteDirectory = await realpath(resolve(root, RUNS_DIRECTORY, safeRunId));
  if (repositoryRelative(root, absoluteDirectory) === null)
    throw new Error('run directory escapes repository');
  const receiptPath = await realpath(join(absoluteDirectory, 'receipt.json'));
  if (repositoryRelative(absoluteDirectory, receiptPath) === null) {
    throw new Error('supervised receipt escapes run directory');
  }
  const receipt = await readBoundedJson(
    receiptPath,
    SUPERVISION_LIMITS.receiptBytes,
    'supervised run receipt'
  );
  assertSupervisedRunReceipt(receipt);
  let resultSummary = null;
  if (receipt.result) {
    const resultPath = await realpath(resolve(root, receipt.result.path));
    if (repositoryRelative(absoluteDirectory, resultPath) === null) {
      throw new Error('supervised result reference escapes run directory');
    }
    const source = await readFile(resultPath, 'utf8');
    if (
      Buffer.byteLength(source) !== receipt.result.bytes ||
      sha256(source) !== receipt.result.sha256
    ) {
      throw new Error('supervised result digest is invalid');
    }
    const result = JSON.parse(source);
    const errors = validatePerformanceDiagnosis(result);
    if (errors.length > 0) throw new Error('supervised result contract is invalid');
    resultSummary = {
      verdict: result.verdict,
      diagnosis: result.diagnosis,
      scope: result.scope,
    };
  }
  return { receipt, result_summary: resultSummary };
}

async function finalizeRun({ root, repositoryRoots, relativeDirectory, receipt, outcome }) {
  const sanitizedStdout = redactText(outcome.stdout, {
    repositoryRoots,
    limit: SUPERVISION_LIMITS.failureCharacters,
  });
  const sanitizedStderr = redactText(outcome.stderr, {
    repositoryRoots,
    limit: SUPERVISION_LIMITS.failureCharacters,
  });
  const sanitizedError = redactText(outcome.operationalError, {
    repositoryRoots,
    limit: SUPERVISION_LIMITS.failureCharacters,
  });
  let state;
  let result = null;
  let invalidReason = null;
  let resultRedactionCount = 0;
  let resultWasTruncated = false;
  if (outcome.timedOut) state = 'timed_out';
  else if (outcome.operationalError) state = 'spawn_failed';
  else if (outcome.signal) state = 'signaled';
  else if (outcome.exitCode !== 0) state = 'failed';
  else {
    try {
      const parsed = JSON.parse(outcome.stdout.trim());
      const sanitized = redactJsonValue(parsed, { repositoryRoots });
      resultRedactionCount = sanitized.redaction_count;
      resultWasTruncated = sanitized.truncated;
      const errors = validatePerformanceDiagnosis(sanitized.value);
      if (errors.length > 0) throw new Error(errors.join('; '));
      result = await writeResult(root, relativeDirectory, sanitized.value);
      state = 'succeeded';
    } catch (error) {
      state = 'invalid_result';
      invalidReason = error.message;
    }
  }
  const failure =
    state === 'succeeded'
      ? null
      : {
          kind: state,
          operational_error: sanitizedError.text || invalidReason,
          stdout: sanitizedStdout.text || null,
          stderr: sanitizedStderr.text || null,
        };
  return assertSupervisedRunReceipt({
    ...receipt,
    state,
    lifecycle: {
      ...receipt.lifecycle,
      heartbeat_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    },
    child: {
      ...receipt.child,
      exit_code: outcome.exitCode,
      signal: outcome.signal,
    },
    result,
    failure,
    capture: {
      stdout_bytes: outcome.stdoutBytes,
      stderr_bytes: outcome.stderrBytes,
      truncated:
        outcome.truncated ||
        resultWasTruncated ||
        (state !== 'succeeded' &&
          (sanitizedStdout.truncated || sanitizedStderr.truncated || sanitizedError.truncated)),
      redaction_count:
        resultRedactionCount +
        (state === 'succeeded'
          ? 0
          : sanitizedStdout.redaction_count +
            sanitizedStderr.redaction_count +
            sanitizedError.redaction_count),
    },
    limitations:
      state === 'succeeded'
        ? receipt.limitations
        : [
            ...receipt.limitations,
            'No performance conclusion is authorized from this incomplete run.',
          ],
  });
}

function superviseChild({
  program,
  args,
  cwd,
  environment,
  deadlineMs,
  heartbeatMs,
  repositoryRoot,
  onStarted,
  onHeartbeat,
}) {
  return new Promise((resolvePromise) => {
    const stdout = boundedCollector(SUPERVISION_LIMITS.resultBytes);
    const stderr = boundedCollector(SUPERVISION_LIMITS.outputBytes);
    let child;
    let timedOut = false;
    let operationalError = null;
    let settled = false;
    let heartbeatTimer = null;
    let heartbeatWrite = Promise.resolve();
    let shutdownSignal = null;
    let deadlineTimer = null;

    const finish = async (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(heartbeatTimer);
      process.off('SIGINT', handleSigint);
      process.off('SIGTERM', handleSigterm);
      await heartbeatWrite.catch(() => {});
      resolvePromise({
        exitCode,
        signal: shutdownSignal ?? signal,
        timedOut,
        operationalError,
        stdout: stdout.value(),
        stderr: stderr.value(),
        stdoutBytes: stdout.totalBytes(),
        stderrBytes: stderr.totalBytes(),
        truncated: stdout.truncated() || stderr.truncated(),
      });
    };
    const scheduleHeartbeat = () => {
      if (settled) return;
      heartbeatTimer = setTimeout(() => {
        heartbeatWrite = heartbeatWrite.then(onHeartbeat).catch((error) => {
          operationalError ??= error.message;
        });
        heartbeatWrite.finally(() => {
          if (!settled) scheduleHeartbeat();
        });
      }, heartbeatMs);
      heartbeatTimer.unref();
    };
    const handleShutdown = (signal) => {
      shutdownSignal = signal;
      terminateOwned(child, 'SIGTERM');
      setTimeout(
        () => terminateOwned(child, 'SIGKILL'),
        SUPERVISION_LIMITS.terminationGraceMs
      ).unref();
    };
    const handleSigint = () => handleShutdown('SIGINT');
    const handleSigterm = () => handleShutdown('SIGTERM');
    process.once('SIGINT', handleSigint);
    process.once('SIGTERM', handleSigterm);

    try {
      child = spawn(program, args, {
        cwd,
        env: environment,
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      operationalError = error.message;
      finish(null, null);
      return;
    }
    child.stdout.on('data', stdout.push);
    child.stderr.on('data', stderr.push);
    child.once('error', (error) => {
      operationalError = redactText(error.message, { repositoryRoot }).text;
    });
    child.once('spawn', () => {
      heartbeatWrite = heartbeatWrite
        .then(() => onStarted(child.pid))
        .catch((error) => {
          operationalError ??= error.message;
        });
      heartbeatWrite.finally(() => {
        if (!settled) scheduleHeartbeat();
      });
    });
    child.once('close', (code, signal) => finish(code, signal));
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      terminateOwned(child, 'SIGTERM');
      setTimeout(
        () => terminateOwned(child, 'SIGKILL'),
        SUPERVISION_LIMITS.terminationGraceMs
      ).unref();
    }, deadlineMs);
    deadlineTimer.unref();
  });
}

function diagnosisCommand({ root, adapter, target, name, timeoutMs, samples, warmups }) {
  const args = [
    fileURLToPath(new URL('./cli.mjs', import.meta.url)),
    'diagnose-performance',
    '--repo',
    root,
    '--adapter',
    adapter,
    '--target',
    target,
    '--timeout-ms',
    String(timeoutMs),
    '--samples',
    String(samples),
    '--warmups',
    String(warmups),
    '--json',
  ];
  if (name) args.push('--name', name);
  return { program: process.execPath, args, cwd: root, environment: minimalEnvironment() };
}

function deriveSupervisorDeadline(adapter, timeoutMs, samples, warmups) {
  const profilePasses = adapter === 'go-bench' ? 1 : 2;
  const metricPasses = ['node-test', 'node-script', 'vitest'].includes(adapter) ? samples : 0;
  const passes = warmups + samples + metricPasses + profilePasses + 1;
  return Math.min(SUPERVISION_LIMITS.maximumDeadlineMs, timeoutMs * passes);
}

function boundedSupervisorDeadline(value) {
  if (!Number.isInteger(value) || value < 25 || value > SUPERVISION_LIMITS.maximumDeadlineMs) {
    throw new Error(
      `supervisor deadline must be between 25 and ${SUPERVISION_LIMITS.maximumDeadlineMs} milliseconds`
    );
  }
  return value;
}

async function assertTarget(root, target) {
  if (typeof target !== 'string' || target.length === 0) throw new Error('target is required');
  const absolute = await realpath(resolve(root, target));
  if (repositoryRelative(root, absolute) === null) throw new Error('target escapes repository');
  const details = await stat(absolute);
  if (!details.isFile()) throw new Error('target is not a regular file');
}

async function writeReceipt(path, receipt) {
  assertSupervisedRunReceipt(receipt);
  await writeJsonAtomic(path, receipt, SUPERVISION_LIMITS.receiptBytes, true);
}

async function writeResult(root, relativeDirectory, value) {
  const relativePath = `${relativeDirectory}/result.json`;
  const absolute = resolve(root, relativePath);
  const source = `${JSON.stringify(value)}\n`;
  const bytes = Buffer.byteLength(source);
  if (bytes > SUPERVISION_LIMITS.resultBytes) throw new Error('supervised result exceeds bound');
  await writeTextAtomic(absolute, source, false);
  return { path: relativePath, sha256: sha256(source), bytes };
}

async function writeJsonAtomic(path, value, maximumBytes, replace) {
  const source = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(source) > maximumBytes) throw new Error('supervised receipt exceeds bound');
  await writeTextAtomic(path, source, replace);
}

async function writeTextAtomic(path, source, replace) {
  temporarySequence += 1;
  const temporary = `${path}.codevetter-${process.pid}-${temporarySequence}.tmp`;
  try {
    await writeFile(temporary, source, { flag: 'wx' });
    if (!replace) {
      try {
        await stat(path);
        throw new Error('supervised artifact already exists');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readBoundedJson(path, maximumBytes, label) {
  const details = await stat(path);
  if (!details.isFile() || details.size > maximumBytes)
    throw new Error(`${label} is unavailable or oversized`);
  return JSON.parse(await readFile(path, 'utf8'));
}

function boundedCollector(limit) {
  const chunks = [];
  let retained = 0;
  let total = 0;
  let wasTruncated = false;
  return {
    push(chunk) {
      const value = Buffer.from(chunk);
      total += value.length;
      const remaining = limit - retained;
      if (remaining > 0) {
        const kept = value.subarray(0, remaining);
        chunks.push(kept);
        retained += kept.length;
      }
      if (value.length > remaining) wasTruncated = true;
    },
    value: () => Buffer.concat(chunks).toString('utf8'),
    totalBytes: () => total,
    truncated: () => wasTruncated,
  };
}

function minimalEnvironment() {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT'];
  const environment = { CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
  for (const name of allowed) {
    if (typeof process.env[name] === 'string') environment[name] = process.env[name];
  }
  return environment;
}

function terminateOwned(child, signal) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The owned child already exited.
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
