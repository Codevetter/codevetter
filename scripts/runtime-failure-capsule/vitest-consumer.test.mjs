import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sourceDigest } from './source-execution.mjs';
import { test } from 'node:test';
import { qualifyConsumerSelection, routeTestNames } from './vitest-consumer-evidence.mjs';
import { READER_BASE, vitestConsumerExperiment } from './vitest-consumer-experiment.mjs';

const report = JSON.parse(
  await readFile(
    new URL(
      '../../evidence/performance/vitest-consumer-experiment-2026-10-14.json',
      import.meta.url
    )
  )
);
const cold = report.rows.find((row) => row.label === 'happy-dom:cold');
const expected = {
  source_sha256: report.consumer.files['src/lib/spa-route.ts'],
  test_sha256: report.consumer.files['src/lib/spa-route.test.ts'],
  config_sha256: report.consumer.files['vitest.config.ts'],
  lock_sha256: report.consumer.files['pnpm-lock.yaml'],
  environment: 'happy-dom',
  selection: { file: 'src/lib/spa-route.test.ts', pattern: null },
  names: routeTestNames,
};

test('recorded consumer execution requires exact names, current run assertions and source identities', () => {
  assert.equal(report.consumer.commit, READER_BASE);
  assert.equal(qualifyConsumerSelection(cold, expected), true);
  for (const key of ['source_sha256', 'test_sha256', 'config_sha256', 'lock_sha256', 'environment'])
    assert.equal(qualifyConsumerSelection({ ...cold, [key]: 'changed' }, expected), false, key);
  for (const patch of [
    { run_id: 'prior-run' },
    { cancelled: true },
    { collected_only: true },
    { tests: [] },
    { unhandled_errors: ['error'] },
    { module_errors: ['afterAll failure'] },
    { selection: { ...cold.selection, pattern: 'different' } },
  ])
    assert.equal(qualifyConsumerSelection({ ...cold, ...patch }, expected), false);
  for (const patch of [
    { assertions: 0 },
    { assertions: '1' },
    { run_id: 'old' },
    { state: 'failed' },
    { state: 'pending' },
    { state: 'skipped' },
    { name: cold.tests[1].name },
    { errors: ['failure'] },
  ]) {
    const changed = structuredClone(cold);
    Object.assign(changed.tests[0], patch);
    assert.equal(qualifyConsumerSelection(changed, expected), false, JSON.stringify(patch));
  }
});

test('replay retains collection, selection, failure and cancellation counterexamples', () => {
  for (const row of report.rows.filter((row) => row.selection.file === expected.selection.file)) {
    if (row.label.endsWith(':selected')) {
      assert.equal(
        qualifyConsumerSelection(row, { ...expected, environment: row.environment }),
        false
      );
      assert.equal(
        qualifyConsumerSelection(row, {
          ...expected,
          environment: row.environment,
          selection: row.selection,
          names: [routeTestNames[0]],
        }),
        true
      );
    }
    if (/:(absent|collection|dependency-edited|assertion-oracle)$/.test(row.label))
      assert.equal(row.execution_qualified, false, row.label);
  }
  for (const row of report.rows.filter((row) => row.label.endsWith(':hook-error'))) {
    assert.equal(row.tests[0].state, 'passed');
    assert.deepEqual(row.module_errors, ['seeded afterAll failure']);
    assert.equal(row.execution_qualified, false);
  }
  const cancellation = report.rows.find((row) => row.cancelled);
  assertRecordedCancellation(cancellation);
  assert.equal(qualifyConsumerSelection(cancellation, expected), false);
  assert.ok(report.invalidations.clean.every((row) => row.stale_plan_rejected));
  assert.ok(
    report.invalidations.already_dirty.every(
      (row) => !row.stale_plan_rejected && row.exact_hash_changed
    )
  );
});

test('pinned consumer integration executes actual assertions and negative controls', {
  skip:
    !process.env.CODEVETTER_READER_STUDY_ROOT &&
    'Requires the documented public checkout and frozen install; replay is not a live Vitest run',
  timeout: 90000,
}, async () => {
  const current = await vitestConsumerExperiment(process.env.CODEVETTER_READER_STUDY_ROOT);
  assertRecordedCancellation(current.rows.find((row) => row.cancelled));
  assert.equal(current.default_runner.assertion_results.length, 18);
  assert.equal(current.rows.length, 29);
  assert.equal(current.rows.filter((row) => row.execution_qualified).length, 12);
});

// Assert the retained observation, while the experiment still returns every raw
// outcome. A changed cancellation result must fail this regression and be reviewed.
function assertRecordedCancellation(row) {
  const observation = {
    body_started: row.body_started,
    body_completed_after_cancel: row.body_completed_after_cancel,
    body_completed_after_close: row.body_completed_after_close,
    queued_body_executed: row.queued_body_executed,
    worker_gone_after_close: row.worker_gone_after_close,
    study_cleanup_signal_sent: row.study_cleanup_signal_sent,
    execution_qualified: row.execution_qualified,
    tests: row.tests.map(({ name, state, assertions }) => ({ name, state, assertions })),
  };
  assert.deepEqual(
    observation,
    {
      body_started: true,
      body_completed_after_cancel: false,
      body_completed_after_close: false,
      queued_body_executed: false,
      worker_gone_after_close: true,
      study_cleanup_signal_sent: false,
      execution_qualified: false,
      tests: [
        { name: 'active body', state: 'skipped', assertions: 0 },
        { name: 'queued body', state: 'skipped', assertions: 0 },
      ],
    },
    JSON.stringify(row)
  );
}

test('successor consumer report retains executed selections and repairs every dirty invalidation', async () => {
  const current = JSON.parse(
    await readFile(
      new URL(
        '../../evidence/performance/vitest-consumer-owned-output-2026-10-14.json',
        import.meta.url
      )
    )
  );
  assert.equal(current.published_prerequisite, '903dfb6b9f7bf76baa9c66c4750017eea0c619ee');
  assert.equal(current.consumer.commit, READER_BASE);
  assert.equal(current.rows.length, 29);
  assert.equal(current.rows.filter((row) => row.execution_qualified).length, 12);
  assert.equal(current.default_runner.assertion_results.length, 18);
  assert.equal(
    qualifyConsumerSelection(
      current.rows.find((row) => row.label === 'happy-dom:cold'),
      expected
    ),
    true
  );
  assertRecordedCancellation(current.rows.find((row) => row.cancelled));
  for (const group of Object.values(current.invalidations))
    assert.ok(group.every((row) => row.stale_plan_rejected && row.exact_hash_changed));
  for (const [file, hash] of Object.entries(current.implementation))
    assert.equal(sourceDigest(await readFile(new URL(file, import.meta.url))), hash, file);
});
