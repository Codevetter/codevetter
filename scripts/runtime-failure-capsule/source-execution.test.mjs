import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { sourceExecutionExperiment } from './source-execution-experiment.mjs';
import { qualifySourceExecution } from './source-execution.mjs';

let study;
before(async () => {
  study = await sourceExecutionExperiment();
});

test('real transformed coordinates and opposite executed branches remain distinct', () => {
  assert.deepEqual(
    study.reports.flatMap((row) => row.results.map((result) => result.status)),
    ['not_executed', 'executed', 'executed', 'not_executed']
  );
  for (const row of study.reports)
    for (const result of row.results) {
      assert.equal(result.recommendation_qualified, false);
      assert.equal(result.mapped_anchor.source, 'fixture.ts');
    }
  assert.equal(study.vitest_environment.executed_tests, 0);
});

test('positive enclosing function counts do not prove an unexecuted nested span', () => {
  const input = study.witnesses[0];
  assert.ok(input.capture.functions.some((entry) => entry.ranges[0].count > 0));
  assert.equal(qualifySourceExecution(input).status, 'not_executed');
});

test('source, emitted code, map, compiler, runtime, selection and run edits invalidate evidence', () => {
  for (const key of [
    'source_sha256',
    'generated_sha256',
    'map_sha256',
    'compiler',
    'runtime',
    'node_binary_sha256',
    'selection_sha256',
    'run_id',
  ]) {
    const input = structuredClone(study.witnesses[1]);
    input.expected[key] += '-changed';
    assert.equal(qualifySourceExecution(input).reason, 'identity_mismatch', key);
  }
  for (const key of ['source', 'generated']) {
    const input = structuredClone(study.witnesses[1]);
    input[key] += '\n// changed';
    assert.equal(qualifySourceExecution(input).status, 'unknown');
  }
});

test('collection, cancellation, failed or incomplete selection and missing block data are unknown', () => {
  for (const patch of [
    { status: 'collected' },
    { status: 'cancelled' },
    { errors: 1 },
    { executed_tests: 0 },
    { executed_tests: null },
    { executed_tests: '1' },
    { selected_tests: 2 },
    { functions: [] },
    { executed_source_sha256: 'different' },
  ]) {
    const input = structuredClone(study.witnesses[1]);
    Object.assign(input.capture, patch);
    assert.equal(qualifySourceExecution(input).status, 'unknown', JSON.stringify(patch));
  }
});

test('unmapped positions and a span extending into a skipped branch cannot qualify', () => {
  const input = structuredClone(study.witnesses[1]);
  input.span.original_line += 1;
  assert.equal(qualifySourceExecution(input).reason, 'unmapped_or_ambiguous_anchor');
  const malformed = structuredClone(study.witnesses[1]);
  malformed.span.end = malformed.generated.length + 1;
  assert.equal(qualifySourceExecution(malformed).reason, 'invalid_generated_span');
  const broad = structuredClone(study.witnesses[0]);
  broad.span.end = study.witnesses[1].span.end;
  assert.equal(qualifySourceExecution(broad).status, 'not_executed');
});

test('uncalled function ranges override enclosing script execution', () => {
  const input = structuredClone(study.witnesses[1]);
  input.capture.functions.push({
    isBlockCoverage: false,
    ranges: [
      {
        startOffset: input.span.start,
        endOffset: input.span.end,
        count: 0,
      },
    ],
  });
  assert.equal(qualifySourceExecution(input).status, 'not_executed');
  input.capture.functions.at(-1).ranges[0].count = 1;
  assert.equal(qualifySourceExecution(input).reason, 'function_only_coverage');
});
