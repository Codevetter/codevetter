import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyPerformanceReviewCorrectness } from './performance-review-correctness.mjs';

const SUBJECT = {
  repository_revision: 'a'.repeat(40),
  source_snapshot_sha256: 'b'.repeat(64),
  dirty: true,
};
const MANIFEST_SHA256 = 'c'.repeat(64);
const SCOPE = { adapter: 'node-test', target: 'src/work.test.js', name: 'does work' };

test('fresh exact current correctness passes with one selected test', async () => {
  const result = await verifyPerformanceReviewCorrectness(input(), dependencies());

  assert.equal(result.status, 'passed');
  assert.equal(result.reason, 'exact_current_correctness_passed');
  assert.deepEqual(result.observed.execution.selection, { executed: 1, failed: 0 });
  assert.equal(result.observed.execution.duration_ms, 17);
});

test('a current test failure remains observed failure evidence', async () => {
  const result = await verifyPerformanceReviewCorrectness(
    input(),
    dependencies({ execution: exited(1, '# pass 0\n# fail 1\n') })
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'exact_current_correctness_failed');
  assert.equal(result.observed.execution.exit_code, 1);
});

test('selection ambiguity and runner unavailability remain no-confidence', async () => {
  for (const execution of [
    exited(0, '# pass 2\n# fail 0\n'),
    { ...exited(null, ''), status: 'operational_failure' },
  ]) {
    const result = await verifyPerformanceReviewCorrectness(input(), dependencies({ execution }));
    assert.equal(result.status, 'no_confidence');
    assert.equal(result.reason, 'exact_current_correctness_unproven');
  }
});

test('snapshot mutation invalidates a completed correctness run', async () => {
  const changed = { ...SUBJECT, source_snapshot_sha256: 'd'.repeat(64) };
  const result = await verifyPerformanceReviewCorrectness(
    input(),
    dependencies({ snapshots: [SUBJECT, changed] })
  );

  assert.equal(result.status, 'no_confidence');
  assert.equal(result.reason, 'source_changed_during_correctness');
  assert.equal(result.observed.execution, null);
});

test('changed binding and changed pre-run snapshot stop before execution', async () => {
  let executions = 0;
  for (const overrides of [
    { manifestSha256: 'e'.repeat(64) },
    { snapshots: [{ ...SUBJECT, source_snapshot_sha256: 'f'.repeat(64) }] },
  ]) {
    const deps = dependencies({
      ...overrides,
      runAdapter: async () => {
        executions += 1;
        return exited(0, '# pass 1\n# fail 0\n');
      },
    });
    const result = await verifyPerformanceReviewCorrectness(input(), deps);
    assert.equal(result.status, 'no_confidence');
  }
  assert.equal(executions, 0);
});

function input() {
  return {
    repositoryRoot: process.cwd(),
    scope: SCOPE,
    manifestSha256: MANIFEST_SHA256,
    expectedSubject: SUBJECT,
  };
}

function dependencies({
  execution = exited(0, '# pass 1\n# fail 0\n'),
  snapshots = [SUBJECT, SUBJECT],
  manifestSha256 = MANIFEST_SHA256,
  runAdapter,
} = {}) {
  let snapshot = 0;
  return {
    inspectSnapshot: async () => snapshots[Math.min(snapshot++, snapshots.length - 1)],
    loadFlowContract: async () => ({
      present: true,
      manifest_sha256: manifestSha256,
      bindings: [{ correctness: SCOPE }],
    }),
    runAdapter: runAdapter ?? (async () => execution),
  };
}

function exited(exitCode, stdout) {
  return {
    status: 'exited',
    exitCode,
    signal: null,
    durationMs: 17,
    stdout,
    stderr: '',
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: 0,
    truncated: false,
  };
}
