import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateScores,
  matchFinding,
  parseArguments,
  scoreFindings,
} from './run-cross-review-benchmark.mjs';

const label = {
  source_file: 'source.ts',
  ground_truth: [
    {
      id: 'sql-at-sink',
      type: 'sql_injection',
      location: { lines: [14, 14] },
    },
  ],
};

test('cross-review benchmark arguments reject ambiguous bounds', () => {
  assert.equal(parseArguments(['--', '--limit', '2']).limit, 2);
  assert.equal(parseArguments(['--rescore']).rescore, true);
  assert.equal(
    parseArguments(['--resume', 'artifacts/run']).resumeDirectory.endsWith('/artifacts/run'),
    true
  );
  assert.throws(() => parseArguments(['--limit', '0']), /positive integer/);
  assert.throws(() => parseArguments(['--case']), /Unknown or incomplete/);
});

test('finding mapping requires path, nearby line, and defect semantics', () => {
  assert.deepEqual(
    matchFinding(
      {
        filePath: 'source.ts',
        line: 13,
        title: 'SQL injection through string interpolation',
      },
      label
    ),
    ['sql-at-sink']
  );
  assert.deepEqual(
    matchFinding({ filePath: 'source.ts', line: 13, title: 'Add a test' }, label),
    []
  );
  assert.deepEqual(
    matchFinding({ filePath: '../source.ts', line: 14, title: 'SQL injection' }, label),
    []
  );
  assert.deepEqual(
    matchFinding(
      { filePath: 'source.py', line: 8, title: 'Passwords are stored with unsalted MD5' },
      {
        source_file: 'source.py',
        ground_truth: [
          { id: 'weak-password-hash', type: 'weak_crypto', location: { lines: [7, 7] } },
        ],
      }
    ),
    ['weak-password-hash']
  );
});

test('scoring separates missed, false-positive, and redundant findings', () => {
  const score = scoreFindings(
    [
      { filePath: 'source.ts', line: 14, title: 'SQL injection' },
      { filePath: 'source.ts', line: 14, title: 'Parameterize SQL injection' },
      { filePath: 'source.ts', line: 40, title: 'Unrelated concern' },
    ],
    label
  );
  assert.deepEqual(score, {
    expected: 1,
    caught: 1,
    missed: [],
    findings: 3,
    false_positives: 1,
    redundant: 1,
  });
});

test('aggregate report compares all reviewers under one scoring policy', () => {
  const cases = [
    {
      duration_ms: { claude: 100, codex: 80, cross: 180 },
      reviewers: {
        claude: { expected: 2, caught: 1, findings: 2, false_positives: 1, redundant: 0 },
        codex: { expected: 2, caught: 2, findings: 2, false_positives: 0, redundant: 0 },
        cross: { expected: 2, caught: 2, findings: 3, false_positives: 1, redundant: 0 },
      },
    },
  ];
  const aggregate = aggregateScores(cases, 'cross');
  assert.equal(aggregate.recall, 1);
  assert.equal(aggregate.precision, 2 / 3);
  assert.equal(aggregate.mean_duration_ms, 180);
});
