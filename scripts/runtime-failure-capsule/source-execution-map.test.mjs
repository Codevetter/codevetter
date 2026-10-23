import assert from 'node:assert/strict';
import test from 'node:test';
import { stripTypeScriptTypes } from 'node:module';
import { sourceDigest } from './source-execution.mjs';
import { mapCapturedSource, SOURCE_EXECUTION_WORK_LIMITS } from './source-execution-map.mjs';

function input(source, functions) {
  const url = 'file:///fixture/app.ts';
  const generated = stripTypeScriptTypes(source, {
    mode: 'transform',
    sourceMap: true,
    sourceUrl: url,
  });
  return {
    source,
    url,
    functions: functions(generated),
    generatedDigest: sourceDigest(generated),
    selectedTests: 1,
    identity: {
      run_id: 'run',
      runtime: process.version,
      node_binary_sha256: 'a'.repeat(64),
      selection_sha256: 'b'.repeat(64),
    },
  };
}

test('function-only unknown anchors consume the mapping work budget', () => {
  const source = Array.from(
    { length: 200 },
    (_, index) => `export const value${index}: number = ${index};`
  ).join('\n');
  const result = mapCapturedSource(
    input(source, (generated) => [
      {
        isBlockCoverage: false,
        ranges: [{ startOffset: 0, endOffset: generated.length, count: 1 }],
      },
    ])
  );
  assert.deepEqual(result.anchors, []);
  assert.equal(result.unknown, true);
  assert.equal(result.truncated, true);
});

test('aggregate range and function caps reject before source transformation or spread operations', () => {
  const entry = { isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 1, count: 1 }] };
  for (const functions of [
    Array(SOURCE_EXECUTION_WORK_LIMITS.functions + 1).fill(entry),
    [{ ...entry, ranges: Array(SOURCE_EXECUTION_WORK_LIMITS.ranges + 1).fill(entry.ranges[0]) }],
  ]) {
    assert.deepEqual(mapCapturedSource({ source: 'invalid source =', functions }), {
      reason: 'capture_bound_exceeded',
    });
  }
});
