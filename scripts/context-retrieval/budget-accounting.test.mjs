import assert from 'node:assert/strict';
import { test } from 'node:test';

import { measureCase } from './score.mjs';

const entry = {
  required_files: ['answer.ts'],
};

test('token budgets charge the ranked prefix when per-result costs exist', () => {
  const measures = measureCase(entry, {
    files: ['answer.ts', 'large-noise.ts'],
    ranking: [
      { path: 'answer.ts', rank: 1, tokens: 100 },
      { path: 'large-noise.ts', rank: 2, tokens: 2_000 },
    ],
    tokens_delivered: 2_100,
  });
  assert.equal(measures.recall_at_1000_tokens, 1);
});

test('unknown or zero payload cost never makes nonempty results free', () => {
  const zero = measureCase(entry, {
    files: ['answer.ts'],
    ranking: [{ path: 'answer.ts', rank: 1 }],
    tokens_delivered: 0,
  });
  assert.equal(zero.recall_at_16000_tokens, 0);

  const bounded = measureCase(entry, {
    files: ['answer.ts'],
    ranking: [{ path: 'answer.ts', rank: 1 }],
    tokens_delivered: 500,
  });
  assert.equal(bounded.recall_at_1000_tokens, 1);
});
