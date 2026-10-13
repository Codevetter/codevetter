import assert from 'node:assert/strict';
import test from 'node:test';
import { portableResetExperiment } from './portable-reset-experiment.mjs';

test('portable reset preserves failures, invalidation and owned cancellation', async () => {
  const report = await portableResetExperiment();
  assert.deepEqual(
    report.runs.slice(0, 4).map((row) => row.executed),
    [true, true, true, true]
  );
  assert.equal(report.runs[4].executed, true); // failed is executed, never passed
  assert.equal(report.runs[4].exit, 1);
  assert.equal(report.runs[5].executed, false);
  assert.equal(report.full_suite.exit, 1);
  assert.equal(report.edited.exit, 1);
  assert.equal(report.recovered.exit, 0);
  assert.equal(report.invalidations.length, 3);
  assert.equal(report.cancellation.owned_child_gone, true);
  assert.equal(report.cancellation.result, null);
  assert.equal(
    report.cancellation.cancellation_qualified,
    !report.cancellation.workload_survived_supervisor
  );
  if (report.cancellation.workload_survived_supervisor)
    assert.equal(report.cancellation.study_cleanup_signal_sent, true);
});
