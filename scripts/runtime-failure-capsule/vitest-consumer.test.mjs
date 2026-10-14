import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  assert.equal(cancellation.body_started, true);
  assert.equal(cancellation.execution_qualified, false);
  assert.equal(cancellation.queued_body_executed, false);
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
  assert.equal(current.default_runner.assertion_results.length, 18);
  assert.equal(current.rows.length, 29);
  assert.equal(current.rows.filter((row) => row.execution_qualified).length, 12);
});
