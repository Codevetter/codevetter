import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { acceptPerformanceContinuation } from './performance-lab-acceptance.mjs';

test('acceptance proves exact correctness before forwarding the candidate source to paired verification', async (context) => {
  const roots = await repositories(context);
  const snapshots = new Map([
    [roots.incumbent, subject('0')],
    [roots.current, subject('1')],
  ]);
  let pairedInput = null;
  const result = await acceptPerformanceContinuation(input(roots), {
    inspectSnapshot: async (root) => structuredClone(snapshots.get(root)),
    runAdapter: async () => passedExecution(),
    verifyPaired: async (value) => {
      pairedInput = value;
      return pairedReport();
    },
    validatePaired: () => [],
  });

  assert.equal(result.verdict.status, 'accepted');
  assert.equal(result.correctness.incumbent.status, 'passed');
  assert.equal(result.correctness.current.status, 'passed');
  assert.deepEqual(pairedInput.nodeAllocationSource, {
    file: 'src/work.js',
    line: 12,
    function: 'work',
  });
});

test('acceptance fails closed when the incumbent does not match the predecessor', async (context) => {
  const roots = await repositories(context);
  let executions = 0;
  const result = await acceptPerformanceContinuation(input(roots), {
    inspectSnapshot: async (root) => (root === roots.incumbent ? subject('9') : subject('1')),
    runAdapter: async () => {
      executions += 1;
      return passedExecution();
    },
    verifyPaired: async () => {
      executions += 1;
      return pairedReport();
    },
  });

  assert.equal(result.verdict.status, 'no_confidence');
  assert.equal(executions, 0);
});

test('flow-owned correctness requires the same manifest in both checkouts', async (context) => {
  const roots = await repositories(context);
  let inspections = 0;
  const value = input(roots);
  value.correctnessBinding = {
    source: 'repository_manifest',
    manifest_sha256: 'f'.repeat(64),
  };
  const result = await acceptPerformanceContinuation(value, {
    loadFlowContract: async (root) => ({
      present: true,
      manifest_sha256: root === roots.incumbent ? 'e'.repeat(64) : 'f'.repeat(64),
      bindings: [],
    }),
    inspectSnapshot: async () => {
      inspections += 1;
      return subject('0');
    },
    runAdapter: async () => passedExecution(),
    verifyPaired: async () => pairedReport(),
    validatePaired: () => [],
  });

  assert.equal(result.verdict.status, 'no_confidence');
  assert.match(result.verdict.reason, /do not match/);
  assert.equal(inspections, 0);
});

test('a candidate correctness failure rejects before paired measurement', async (context) => {
  const roots = await repositories(context);
  let paired = false;
  const result = await acceptPerformanceContinuation(input(roots), {
    inspectSnapshot: async (root) => (root === roots.incumbent ? subject('0') : subject('1')),
    runAdapter: async ({ repositoryRoot }) =>
      repositoryRoot === roots.current ? failedExecution() : passedExecution(),
    verifyPaired: async () => {
      paired = true;
      return pairedReport();
    },
  });

  assert.equal(result.verdict.status, 'rejected');
  assert.equal(result.correctness.current.status, 'failed');
  assert.equal(paired, false);
});

test('an oversized candidate rejects before correctness or paired measurement', async (context) => {
  const roots = await repositories(context);
  let executions = 0;
  const result = await acceptPerformanceContinuation(input(roots), {
    inspectSnapshot: async (root) =>
      root === roots.incumbent
        ? subject('0')
        : subject('1', { lines_added: 170, gross_lines_changed: 170 }),
    runAdapter: async () => {
      executions += 1;
      return passedExecution();
    },
    verifyPaired: async () => {
      executions += 1;
      return pairedReport();
    },
  });

  assert.equal(result.verdict.status, 'rejected');
  assert.deepEqual(result.change_cost.violations, ['lines_added']);
  assert.equal(executions, 0);
});

test('snapshot mutation during acceptance invalidates otherwise passing evidence', async (context) => {
  const roots = await repositories(context);
  let inspections = 0;
  const result = await acceptPerformanceContinuation(input(roots), {
    inspectSnapshot: async (root) => {
      inspections += 1;
      if (inspections > 2 && root === roots.current) return subject('2');
      return root === roots.incumbent ? subject('0') : subject('1');
    },
    runAdapter: async () => passedExecution(),
    verifyPaired: async () => pairedReport(),
  });

  assert.equal(result.verdict.status, 'no_confidence');
  assert.match(result.verdict.reason, /changed during correctness/);
});

test('indeterminate correctness and incomplete paired evidence cannot authorize shipping', async (context) => {
  const roots = await repositories(context);
  let pairedCalls = 0;
  const indeterminate = await acceptPerformanceContinuation(input(roots), {
    inspectSnapshot: async (root) => (root === roots.incumbent ? subject('0') : subject('1')),
    runAdapter: async ({ repositoryRoot }) =>
      repositoryRoot === roots.current
        ? { ...passedExecution(), truncated: true }
        : passedExecution(),
    verifyPaired: async () => {
      pairedCalls += 1;
      return pairedReport();
    },
    validatePaired: () => [],
  });
  assert.equal(indeterminate.verdict.status, 'no_confidence');
  assert.equal(pairedCalls, 0);

  const incomplete = await acceptPerformanceContinuation(input(roots), {
    inspectSnapshot: async (root) => (root === roots.incumbent ? subject('0') : subject('1')),
    runAdapter: async () => passedExecution(),
    verifyPaired: async () => pairedReport(),
    validatePaired: () => ['invalid baseline capsule'],
  });
  assert.equal(incomplete.verdict.status, 'no_confidence');
  assert.match(incomplete.verdict.reason, /incomplete/);
});

async function repositories(context) {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-acceptance-'));
  const incumbent = join(directory, 'incumbent');
  const current = join(directory, 'current');
  await Promise.all([mkdir(incumbent), mkdir(current)]);
  context.after(() => rm(directory, { recursive: true, force: true }));
  return { incumbent: await realpath(incumbent), current: await realpath(current) };
}

function input(roots) {
  return {
    repositoryRoot: roots.current,
    incumbentRepository: roots.incumbent,
    baselineSubject: subject('0'),
    currentSubject: subject('1'),
    performanceScope: { adapter: 'node-test', target: 'src/work.test.js', name: 'does work' },
    candidate: {
      kind: 'application_allocation_hotspot',
      source: { file: 'src/work.js', line: 12, function: 'work' },
    },
    correctnessScope: {
      adapter: 'node-test',
      target: 'src/work.test.js',
      name: 'does work',
    },
    samples: 10,
    warmups: 0,
    timeoutMs: 1_000,
  };
}

function subject(digit, costOverrides = {}) {
  return {
    repository_revision: 'a'.repeat(40),
    source_snapshot_sha256: digit.repeat(64),
    dirty: true,
    change_cost: {
      complete: true,
      files_changed: 1,
      changed_files: ['src/work.js'],
      lines_added: 1,
      lines_removed: 1,
      gross_lines_changed: 2,
      net_lines_changed: 0,
      untracked_files: [],
      binary_files: [],
      production_dependencies_added: [],
      ...costOverrides,
    },
  };
}

function passedExecution() {
  return {
    status: 'exited',
    exitCode: 0,
    stdout: '# pass 1\n# fail 0\n',
    stderr: '',
    durationMs: 10,
    truncated: false,
  };
}

function failedExecution() {
  return { ...passedExecution(), exitCode: 1, stdout: '# pass 0\n# fail 1\n' };
}

function pairedReport() {
  return {
    decisions: { shipping_recommended: true },
    verdict: { status: 'confirmed', reason: 'material improvement' },
    evidence_mode: 'paired_interleaved',
    workload_identity: { algorithm: 'sha256', digest: 'f'.repeat(64) },
  };
}
