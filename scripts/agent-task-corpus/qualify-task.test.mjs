import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { runQualificationCli } from './qualify-cli.mjs';
import {
  applyKnownGoodChange,
  executeCheckDriver,
  materializeWorkspace,
  qualifyTask,
} from './qualify-task.mjs';

const SAMPLE_ROOT = resolve('benchmarks/agent-tasks/sample');
const TASK_ID = 'preserve-explicit-false';

function checkResult(acceptanceSha256, statuses = {}) {
  return {
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: TASK_ID,
    acceptance_contract_sha256: acceptanceSha256,
    results: [
      {
        id: 'explicit-false-preserved',
        status: statuses.required ?? 'pass',
      },
      { id: 'label-preserved', status: statuses.label ?? 'pass' },
      { id: 'public-inputs-only', status: statuses.public ?? 'pass' },
    ],
  };
}

function fixtureDriver(overrides = {}) {
  return async ({ acceptanceSha256, phase, attempt }) => {
    const override = overrides[`${phase}:${attempt}`] ?? overrides[phase];
    if (override?.kind) return override;
    const defaults = phase === 'baseline' ? { required: 'fail' } : {};
    return {
      kind: 'result',
      result: checkResult(acceptanceSha256, { ...defaults, ...(override ?? {}) }),
    };
  };
}

test('qualifies the owned sample deterministically through isolated public inputs', async () => {
  const first = await qualifyTask({ root: SAMPLE_ROOT, taskId: TASK_ID });
  const second = await qualifyTask({ root: SAMPLE_ROOT, taskId: TASK_ID });
  const tracked = JSON.parse(await readFile(join(SAMPLE_ROOT, 'qualification.json'), 'utf8'));

  assert.deepEqual(second, first);
  assert.deepEqual(tracked, first);
  assert.equal(first.qualified, true);
  assert.equal(first.workspace_policy, 'public_fixture_and_task_packet_v1');
  assert.equal(first.baseline.status, 'intended_failure');
  assert.equal(first.known_good.status, 'pass');
  assert.equal(first.cleanup.status, 'complete');
});

test('requalifies a valid task package when its prior receipt is stale', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-stale-qualification-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const root = join(directory, 'sample');
  await cp(SAMPLE_ROOT, root, { recursive: true });
  await writeFile(join(root, 'qualification.json'), '{}\n');

  const receipt = await qualifyTask({ root, taskId: TASK_ID });

  assert.equal(receipt.qualified, true);
  assert.equal(receipt.baseline.status, 'intended_failure');
  assert.equal(receipt.known_good.status, 'pass');
});

test('classifies wrong failure, incomplete inventory, timeout, and flakiness', async () => {
  const wrong = await qualifyTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    executeDriver: fixtureDriver({ baseline: { required: 'pass' } }),
  });
  assert.equal(wrong.baseline.status, 'wrong_failure');

  const incomplete = await qualifyTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    executeDriver: async ({ acceptanceSha256 }) => {
      const result = checkResult(acceptanceSha256);
      result.results.pop();
      return { kind: 'result', result };
    },
  });
  assert.equal(incomplete.baseline.status, 'incomplete_checks');
  assert.equal(incomplete.known_good.status, 'incomplete_checks');

  const timeout = await qualifyTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    executeDriver: fixtureDriver({ baseline: { kind: 'timeout' } }),
  });
  assert.equal(timeout.baseline.status, 'timeout');

  const checkError = await qualifyTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    executeDriver: async () => {
      throw new Error('injected driver failure');
    },
  });
  assert.equal(checkError.baseline.status, 'check_error');
  assert.equal(checkError.known_good.status, 'check_error');

  const flaky = await qualifyTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    executeDriver: fixtureDriver({ 'baseline:2': { required: 'pass' } }),
  });
  assert.equal(flaky.baseline.status, 'flaky');
});

test('terminates a real check driver at its declared timeout', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-driver-timeout-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const driverPath = join(directory, 'slow-check.mjs');
  await writeFile(driverPath, 'setTimeout(() => process.stdout.write("{}"), 1000);\n');

  const result = await executeCheckDriver({
    driverPath,
    workspace: directory,
    taskId: TASK_ID,
    acceptanceSha256: 'a'.repeat(64),
    phase: 'baseline',
    attempt: 1,
    timeoutMs: 10,
  });

  assert.deepEqual(result, { kind: 'timeout' });
});

test('classifies a known-good regression separately from task check failure', async () => {
  const receipt = await qualifyTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    executeDriver: fixtureDriver({ known_good: { label: 'fail' } }),
  });

  assert.equal(receipt.baseline.status, 'intended_failure');
  assert.equal(receipt.known_good.status, 'regression');
  assert.equal(receipt.qualified, false);
});

test('rejects known-good patch drift before writing a replacement', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-patch-drift-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const fixture = JSON.parse(
    await readFile(join(SAMPLE_ROOT, 'tasks/preserve-explicit-false/fixture.json'), 'utf8')
  );
  const knownGood = JSON.parse(
    await readFile(join(SAMPLE_ROOT, 'tasks/preserve-explicit-false/known-good.json'), 'utf8')
  );
  knownGood.files[0].before_sha256 = 'f'.repeat(64);
  const workspace = await materializeWorkspace(fixture, Buffer.from('# Task\n'), directory);

  await assert.rejects(applyKnownGoodChange(workspace, knownGood), /before SHA-256 mismatch/);
});

test('retains cleanup failure as the terminal qualification outcome', async () => {
  const receipt = await qualifyTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    executeDriver: fixtureDriver(),
    removeWorkspace: async (workspace) => {
      await rm(workspace, { force: true, recursive: true });
      throw new Error('injected cleanup failure');
    },
  });

  assert.equal(receipt.baseline.status, 'cleanup_failure');
  assert.equal(receipt.known_good.status, 'cleanup_failure');
  assert.equal(receipt.cleanup.status, 'failed');
  assert.equal(receipt.qualified, false);
});

test('CLI writes the same deterministic receipt atomically', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-qualification-cli-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const outputPath = join(directory, 'qualification.json');
  const result = await runQualificationCli([
    '--root',
    SAMPLE_ROOT,
    '--task',
    TASK_ID,
    '--out',
    outputPath,
    '--json',
  ]);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), result.receipt);
  assert.deepEqual(JSON.parse(result.output), result.receipt);
});

test('CLI reports argument errors through its selected output contract', async () => {
  const result = await runQualificationCli(['--json']);

  assert.equal(result.exitCode, 2);
  assert.deepEqual(JSON.parse(result.output), { error: '--task is required' });
});
