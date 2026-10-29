import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { planPerformanceExecution } from './execution-governance.mjs';
import {
  assertionVector,
  qualifyJsdomSelection,
  qualifyLifecycleStudy,
  studyRuntimeErrors,
  studyTestReceipt,
} from './vitest-jsdom-evidence.mjs';

const expected = {
  names: ['conditional contract', 'benchmark'],
  source_identity: 'frozen',
  environment: 'node',
};

test('default study stays admitted while subprocess lifecycle requires a separate native lane', async () => {
  const scope = {
    repositoryRoot: fileURLToPath(new URL('../../', import.meta.url)),
    adapter: 'node-script',
    timeoutMs: 5000,
  };
  const original = await planPerformanceExecution({
    ...scope,
    target: 'scripts/runtime-failure-capsule/vitest-jsdom-worker.mjs',
  });
  assert.equal(original.decision.status, 'admitted');
  const lifecycle = await planPerformanceExecution({
    ...scope,
    target: 'scripts/runtime-failure-capsule/vitest-jsdom-lifecycle.mjs',
  });
  assert.equal(lifecycle.decision.status, 'blocked');
  assert.ok(lifecycle.decision.blockers.some((reason) => reason.includes('subprocess')));
});
function completed() {
  return {
    run_id: 'current',
    source_identity: 'frozen',
    environment: 'node',
    unhandled_errors: [],
    module_errors: [],
    tests: expected.names.map((name, index) => ({
      name,
      state: 'passed',
      assertions: index,
      run_id: 'current',
      errors: [],
    })),
  };
}

test('fresh body receipts retain a real conditional zero and a nonzero assertion vector', () => {
  const row = completed();
  assert.equal(qualifyJsdomSelection(row, expected), true);
  assert.deepEqual(assertionVector(row), [
    ['benchmark', 1],
    ['conditional contract', 0],
  ]);
  row.tests[1].assertions = 0;
  assert.equal(qualifyJsdomSelection(row, expected), false);
});

function lifecycleReport() {
  const names = Array.from(
    { length: 23 },
    (_, index) => `contract${String(index).padStart(2, '0')}`
  );
  const assertions = names.map((name, index) => [name, index === 22 ? 38 : 2]);
  const arm = (kind, index) => ({
    ...completed(),
    label: `${kind}:${index}`,
    run_id: `${kind}-${index}`,
    tests: assertions.map(([name, count]) => ({
      name,
      assertions: count,
      state: 'passed',
      run_id: `${kind}-${index}`,
      errors: [],
    })),
    process_total_ms: kind === 'cold' ? 20 : 10,
    memory: {
      samples: 2,
      maximum_sampled_tree_rss_bytes: 100,
      controller_pid: 42,
      descendants_observed: 1,
      processes: [
        { pid: 42, birth: 'observed' },
        { pid: 43, birth: 'worker' },
      ],
    },
    ...(kind === 'cold' ? { orphaned: [] } : {}),
  });
  return {
    expected_names: names,
    assertion_vector: assertions,
    lifecycle: {
      pairs: Array.from({ length: 5 }, (_, index) => ({
        pair: index,
        order: index % 2 ? ['warm', 'cold'] : ['cold', 'warm'],
        cold: arm('cold', index),
        warm: arm('warm', index),
      })),
      orphaned: [],
      default_adoption_qualified: false,
      setup_ms: 5,
      close_ms: 1,
      warm_total_ms: 56,
      cold_total_ms: 100,
      warm_preparation_invalidations: [
        'src/lib/bucket-list-insights.ts',
        'vitest.config.ts',
        'pnpm-lock.yaml',
      ].map((path) => ({ path, stale_rejected: true, capture_run_identity_unchanged: true })),
    },
  };
}

test('lifecycle acceptance requires all ten fresh full-contract executions and reconciled totals', () => {
  const report = lifecycleReport();
  assert.equal(qualifyLifecycleStudy(report, 'frozen'), true);
  for (const mutate of [
    (value) => {
      value.lifecycle.pairs.pop();
    },
    (value) => {
      value.lifecycle.pairs[1].warm.tests.pop();
    },
    (value) => {
      value.lifecycle.pairs[0].cold.tests[0].assertions = 0;
    },
    (value) => {
      value.lifecycle.cold_total_ms = 1;
    },
    (value) => {
      value.lifecycle.pairs[1].order.reverse();
    },
    (value) => {
      value.lifecycle.pairs[1].cold.run_id = 'cold-0';
    },
  ]) {
    const changed = structuredClone(report);
    mutate(changed);
    assert.equal(qualifyLifecycleStudy(changed, 'frozen'), false);
  }
});

test('lifecycle acceptance rejects missing memory, surviving children and promoted default claims', () => {
  const report = lifecycleReport();
  for (const mutate of [
    (value) => {
      delete value.lifecycle.pairs[0].warm.memory;
    },
    (value) => {
      value.lifecycle.pairs[0].cold.memory.samples = 0;
    },
    (value) => {
      value.lifecycle.pairs[0].warm.memory.processes = [];
    },
    (value) => {
      value.lifecycle.pairs[0].warm.memory.processes = [{ pid: 42, birth: 'controller only' }];
    },
    (value) => {
      value.lifecycle.warm_preparation_invalidations.pop();
    },
    (value) => {
      value.lifecycle.warm_preparation_invalidations[0].capture_run_identity_unchanged = false;
    },
    (value) => {
      value.lifecycle.pairs[0].cold.orphaned = [{ pid: 42 }];
    },
    (value) => {
      value.lifecycle.orphaned = [{ pid: 42 }];
    },
    (value) => {
      value.lifecycle.default_adoption_qualified = true;
    },
    (value) => {
      value.lifecycle.pairs[0].warm.cancelled = true;
    },
    (value) => {
      value.lifecycle.pairs[0].warm.source_identity = 'edited';
    },
  ]) {
    const changed = structuredClone(report);
    mutate(changed);
    assert.equal(qualifyLifecycleStudy(changed, 'frozen'), false);
  }
});

test('collection projection leaves missing body evidence unknown and retains runtime errors', () => {
  const testCase = {
    fullName: 'not executed',
    result: () => ({ state: 'pending', errors: [{ message: 'body error' }] }),
    meta: () => ({}),
  };
  assert.deepEqual(studyTestReceipt(testCase), {
    name: 'not executed',
    state: 'pending',
    assertions: null,
    run_id: null,
    worker_rss_bytes: null,
    errors: ['body error'],
  });
  assert.deepEqual(
    studyRuntimeErrors({ unhandledErrors: [{ message: 'unhandled' }] }, [
      { errors: () => [{ message: 'afterAll' }] },
    ]),
    { unhandled_errors: ['unhandled'], module_errors: ['afterAll'] }
  );
});

test('cached passing tests from a different run cannot satisfy the selected execution', () => {
  const row = completed();
  row.tests[1].run_id = 'previous';
  assert.equal(qualifyJsdomSelection(row, expected), false);
  row.tests[1].run_id = 'current';
  row.tests.push({ ...row.tests[1], name: 'unselected cached module' });
  assert.equal(qualifyJsdomSelection(row, expected), false);
});

test('collection, missing selection, cancellation and an afterAll failure never qualify', () => {
  for (const patch of [
    { collected_only: true },
    { tests: [] },
    { cancelled: true },
    { module_errors: ['afterAll failure'] },
    { unhandled_errors: ['unhandled failure'] },
  ])
    assert.equal(qualifyJsdomSelection({ ...completed(), ...patch }, expected), false);
});

test('wrong source, environment, skipped bodies and failed assertions retain rejection', () => {
  assert.equal(
    qualifyJsdomSelection({ ...completed(), source_identity: 'edited' }, expected),
    false
  );
  assert.equal(qualifyJsdomSelection({ ...completed(), environment: 'jsdom' }, expected), false);
  for (const state of ['skipped', 'pending', 'failed']) {
    const row = completed();
    row.tests[1].state = state;
    assert.equal(qualifyJsdomSelection(row, expected), false);
  }
});
