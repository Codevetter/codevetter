import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SOURCE_EXECUTION_SCHEMA,
  SOURCE_EXECUTION_SCOPE,
  validateSourceExecutionSnapshot,
} from './source-execution-contract.mjs';
const sha = 'a'.repeat(64);
const fixture = () => ({
  schema_version: SOURCE_EXECUTION_SCHEMA,
  scope: SOURCE_EXECUTION_SCOPE,
  recommendation_qualified: false,
  limitations: [],
  snapshots: [
    {
      file: 'src/app.ts',
      capture_id: sha,
      source_sha256: sha,
      generated_sha256: sha,
      map_sha256: sha,
      anchors: [
        {
          line: 4,
          column: 5,
          generated_start: 20,
          generated_end: 21,
          status: 'executed_in_snapshot',
          count: 1,
        },
      ],
    },
  ],
});

test('optional sanitized snapshot distinguishes executed and not observed without whole-process claims', () => {
  const value = fixture();
  assert.deepEqual(validateSourceExecutionSnapshot(value), []);
  value.snapshots[0].anchors[0].status = 'not_observed_in_snapshot';
  value.snapshots[0].anchors[0].count = 0;
  assert.deepEqual(validateSourceExecutionSnapshot(value), []);
  value.snapshots = [];
  value.limitations = ['capture_incomplete'];
  assert.deepEqual(validateSourceExecutionSnapshot(value), []);
});

test('unbounded, raw or falsely authoritative source evidence is rejected', () => {
  const mutations = [
    (value) => {
      value.recommendation_qualified = true;
    },
    (value) => {
      value.scope = 'complete_process';
    },
    (value) => {
      value.raw_source = 'secret source';
    },
    (value) => {
      value.snapshots[0].source = 'raw source';
    },
    (value) => {
      value.snapshots[0].file = '/outside/app.ts';
    },
    (value) => {
      value.snapshots[0].file = '../app.ts';
    },
    (value) => {
      value.snapshots[0].file = 'C:/app.ts';
    },
    (value) => {
      value.snapshots[0].source_sha256 = 'wrong';
    },
    (value) => {
      value.snapshots[0].anchors[0].status = 'never_executed';
    },
    (value) => {
      value.snapshots[0].anchors[0].count = 0;
    },
    (value) => {
      value.snapshots[0].anchors[0].count = NaN;
    },
    (value) => {
      value.snapshots[0].anchors[0].generated_end = 20;
    },
    (value) => {
      value.snapshots[0].anchors = Array(129).fill(value.snapshots[0].anchors[0]);
    },
    (value) => {
      value.snapshots = Array(17).fill(value.snapshots[0]);
    },
    (value) => {
      value.limitations = ['raw arbitrary error/path'];
    },
    (value) => {
      value.limitations = ['capture_incomplete', 'capture_incomplete'];
    },
  ];
  for (const mutate of mutations) {
    const value = fixture();
    mutate(value);
    assert.ok(validateSourceExecutionSnapshot(value).length > 0, JSON.stringify(value));
  }
});
