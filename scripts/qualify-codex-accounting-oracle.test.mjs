import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

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

let fixtureDirectory;
let fakeCodexBarPath;
const scriptPath = fileURLToPath(new URL('./qualify-codex-accounting-oracle.mjs', import.meta.url));

before(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'codevetter-accounting-oracle-'));
  fakeCodexBarPath = join(fixtureDirectory, 'fake-codexbar.mjs');
  writeFileSync(
    fakeCodexBarPath,
    `#!/usr/bin/env node
const expected = ['cost', '--provider', 'codex', '--json', '--refresh'];
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) {
  process.stderr.write('unexpected arguments');
  process.exit(9);
}
if (!process.env.CODEX_HOME?.endsWith('/codex-home')) {
  process.stderr.write('missing CODEX_HOME');
  process.exit(10);
}
process.stdout.write(${JSON.stringify(JSON.stringify(oracle))});
`
  );
  chmodSync(fakeCodexBarPath, 0o755);
});

after(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true });
});

test('accepts exact aggregate and local-day token parity', () => {
  const mismatches = compareAccounting(normalizeCodexBar(oracle), normalizeCodeVetter(actual));
  assert.deepEqual(mismatches, []);
});

test('accepts zero-valued integer and cost evidence', () => {
  const zero = {
    totals: {
      input_tokens: 0,
      cache_read_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      api_equivalent_cost_usd: 0,
    },
  };
  const normalized = normalizeCodeVetter(zero);
  assert.equal(normalized.totals.input_tokens, 0);
  assert.equal(normalized.totals.api_equivalent_cost_min_usd, 0);
  assert.deepEqual([...normalized.daily], []);
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

test('rejects every invalid numeric shape and inverted cost bounds', () => {
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
    const invalid = structuredClone(actual);
    invalid.totals.input_tokens = value;
    assert.throws(() => normalizeCodeVetter(invalid), /non-negative safe integer/);
  }

  for (const value of [-0.01, Number.NaN, Number.POSITIVE_INFINITY, '0.25']) {
    const invalid = structuredClone(actual);
    invalid.totals.api_equivalent_cost_usd = value;
    assert.throws(() => normalizeCodeVetter(invalid), /non-negative finite number/);
  }

  const inverted = structuredClone(actual);
  delete inverted.totals.api_equivalent_cost_usd;
  inverted.totals.api_equivalent_cost_min_usd = 0.5;
  inverted.totals.api_equivalent_cost_max_usd = 0.2;
  assert.throws(() => normalizeCodeVetter(inverted), /minimum must not exceed maximum/);
});

test('requires the local Codex provider and valid unique daily dates', () => {
  assert.deepEqual(
    normalizeCodexBar([undefined, { provider: 'other' }, oracle]),
    normalizeCodexBar(oracle)
  );
  assert.throws(() => normalizeCodexBar([]), /local codex provider row/);
  assert.throws(
    () => normalizeCodexBar({ ...oracle, provider: 'other' }),
    /local codex provider row/
  );
  assert.throws(
    () => normalizeCodexBar({ ...oracle, source: 'remote' }),
    /local codex provider row/
  );

  const invalidDate = structuredClone(actual);
  invalidDate.daily[0].date = 20260716;
  assert.throws(() => normalizeCodeVetter(invalidDate), /date is missing or duplicated/);

  const duplicateOracleDate = structuredClone(oracle);
  duplicateOracleDate.daily.push(structuredClone(oracle.daily[0]));
  assert.throws(() => normalizeCodexBar(duplicateOracleDate), /oracle daily.*duplicated/);
  assert.throws(() => normalizeCodeVetter(undefined), /actual\.totals\.input_tokens/);
});

test('reports missing daily buckets in either input', () => {
  const missingActual = structuredClone(actual);
  missingActual.daily = [];
  assert.deepEqual(
    compareAccounting(normalizeCodexBar(oracle), normalizeCodeVetter(missingActual)),
    [
      {
        scope: 'daily.2026-07-16',
        field: 'bucket',
        expected: 'present',
        actual: 'missing',
      },
    ]
  );

  const missingOracle = structuredClone(oracle);
  missingOracle.daily = [];
  assert.deepEqual(
    compareAccounting(normalizeCodexBar(missingOracle), normalizeCodeVetter(actual)),
    [
      {
        scope: 'daily.2026-07-16',
        field: 'bucket',
        expected: 'missing',
        actual: 'present',
      },
    ]
  );
});

test('CLI distinguishes qualified, mismatched, and malformed evidence', () => {
  const oraclePath = join(fixtureDirectory, 'oracle.json');
  const actualPath = join(fixtureDirectory, 'actual.json');
  writeFileSync(oraclePath, JSON.stringify(oracle));
  writeFileSync(actualPath, JSON.stringify(actual));

  const qualified = spawnSync(
    process.execPath,
    [scriptPath, '--oracle-json', oraclePath, '--codevetter-json', actualPath],
    { encoding: 'utf8' }
  );
  assert.equal(qualified.status, 0);
  assert.deepEqual(JSON.parse(qualified.stdout), {
    qualified: true,
    compared_token_fields: ['input_tokens', 'cache_read_tokens', 'output_tokens', 'total_tokens'],
    compared_cost_field: 'oracle point must fall within CodeVetter API-equivalent bounds',
    compared_daily_buckets: ['2026-07-16'],
    reasoning_parity: 'not_exposed_by_codexbar_cli; qualified_by_internal_fixture',
    mismatches: [],
  });

  const mismatchedActual = structuredClone(actual);
  mismatchedActual.totals.total_tokens += 1;
  writeFileSync(actualPath, JSON.stringify(mismatchedActual));
  const mismatched = spawnSync(
    process.execPath,
    [scriptPath, '--oracle-json', oraclePath, '--codevetter-json', actualPath],
    { encoding: 'utf8' }
  );
  assert.equal(mismatched.status, 1);
  assert.equal(JSON.parse(mismatched.stdout).qualified, false);

  writeFileSync(actualPath, '{');
  const malformed = spawnSync(
    process.execPath,
    [scriptPath, '--oracle-json', oraclePath, '--codevetter-json', actualPath],
    { encoding: 'utf8' }
  );
  assert.equal(malformed.status, 2);
  assert.match(malformed.stderr, /JSON/);
});

test('CLI invokes CodexBar with its exact local evidence contract', () => {
  const actualPath = join(fixtureDirectory, 'actual-for-binary.json');
  const codexHome = join(fixtureDirectory, 'codex-home');
  writeFileSync(actualPath, JSON.stringify(actual));

  const qualified = spawnSync(
    process.execPath,
    [
      scriptPath,
      '--codex-home',
      codexHome,
      '--codexbar',
      fakeCodexBarPath,
      '--codevetter-json',
      actualPath,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(qualified.status, 0, qualified.stderr);
  assert.equal(JSON.parse(qualified.stdout).qualified, true);

  const missingHome = spawnSync(
    process.execPath,
    [scriptPath, '--codevetter-json', actualPath, '--codexbar', fakeCodexBarPath],
    { encoding: 'utf8' }
  );
  assert.equal(missingHome.status, 2);
  assert.match(missingHome.stderr, /--codex-home is required/);
});
