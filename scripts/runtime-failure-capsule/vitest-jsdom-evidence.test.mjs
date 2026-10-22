import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertionVector,
  qualifyJsdomSelection,
  studyRuntimeErrors,
  studyTestReceipt,
} from './vitest-jsdom-evidence.mjs';

const expected = {
  names: ['conditional contract', 'benchmark'],
  source_identity: 'frozen',
  environment: 'node',
};
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
