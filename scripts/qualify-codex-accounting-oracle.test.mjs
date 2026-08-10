import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareAccounting,
  normalizeCodeVetter,
  normalizeCodexBar,
} from './qualify-codex-accounting-oracle.mjs';

const oracle = {
  provider: 'codex',
  source: 'local',
  totals: {
    inputTokens: 150,
    cacheReadTokens: 120,
    outputTokens: 15,
    totalTokens: 165,
    totalCost: 0.25,
  },
  daily: [
    {
      date: '2026-07-16',
      inputTokens: 150,
      cacheReadTokens: 120,
      outputTokens: 15,
      totalTokens: 165,
      totalCost: 0.25,
    },
  ],
};

const actual = {
  totals: {
    input_tokens: 150,
    cache_read_tokens: 120,
    output_tokens: 15,
    total_tokens: 165,
    api_equivalent_cost_usd: 0.25,
  },
  daily: [
    {
      date: '2026-07-16',
      input_tokens: 150,
      cache_read_tokens: 120,
      output_tokens: 15,
      total_tokens: 165,
      api_equivalent_cost_usd: 0.25,
    },
  ],
};

test('accepts exact aggregate and local-day token parity', () => {
  const mismatches = compareAccounting(normalizeCodexBar(oracle), normalizeCodeVetter(actual));
  assert.deepEqual(mismatches, []);
});

test('accepts an oracle cost inside bounded service-tier uncertainty', () => {
  const ranged = structuredClone(actual);
  delete ranged.totals.api_equivalent_cost_usd;
  ranged.totals.api_equivalent_cost_min_usd = 0.2;
  ranged.totals.api_equivalent_cost_max_usd = 0.5;
  delete ranged.daily[0].api_equivalent_cost_usd;
  ranged.daily[0].api_equivalent_cost_min_usd = 0.2;
  ranged.daily[0].api_equivalent_cost_max_usd = 0.5;
  assert.deepEqual(compareAccounting(normalizeCodexBar(oracle), normalizeCodeVetter(ranged)), []);
});

test('rejects an oracle cost outside CodeVetter bounds', () => {
  const changed = structuredClone(actual);
  changed.totals.api_equivalent_cost_usd = 0.2;
  const mismatches = compareAccounting(normalizeCodexBar(oracle), normalizeCodeVetter(changed));
  assert.deepEqual(mismatches, [
    {
      scope: 'totals',
      field: 'api_equivalent_cost_usd',
      expected: 0.25,
      actual: [0.2, 0.2],
    },
  ]);
});

test('reports exact field and day mismatches', () => {
  const changed = structuredClone(actual);
  changed.daily[0].cache_read_tokens += 1;
  changed.totals.output_tokens += 2;
  const mismatches = compareAccounting(normalizeCodexBar(oracle), normalizeCodeVetter(changed));
  assert.deepEqual(mismatches, [
    { scope: 'totals', field: 'output_tokens', expected: 15, actual: 17 },
    { scope: 'daily.2026-07-16', field: 'cache_read_tokens', expected: 120, actual: 121 },
  ]);
});

test('rejects unsafe or duplicate input instead of coercing it', () => {
  const invalid = structuredClone(actual);
  invalid.daily.push(structuredClone(invalid.daily[0]));
  assert.throws(() => normalizeCodeVetter(invalid), /duplicated/);

  const unsafe = structuredClone(oracle);
  unsafe.totals.inputTokens = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => normalizeCodexBar(unsafe), /safe integer/);
});
