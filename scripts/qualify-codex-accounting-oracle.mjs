#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const INTEGER_FIELDS = ['input_tokens', 'cache_read_tokens', 'output_tokens', 'total_tokens'];

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function cost(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return value;
}

function normalizeBucket(bucket, label) {
  const pointCost = bucket.api_equivalent_cost_usd ?? bucket.totalCost;
  const minCost = cost(
    bucket.api_equivalent_cost_min_usd ?? pointCost ?? 0,
    `${label}.api_equivalent_cost_min_usd`
  );
  const maxCost = cost(
    bucket.api_equivalent_cost_max_usd ?? pointCost ?? 0,
    `${label}.api_equivalent_cost_max_usd`
  );
  if (minCost > maxCost) {
    throw new Error(`${label} cost minimum must not exceed maximum`);
  }
  return {
    input_tokens: integer(bucket.input_tokens ?? bucket.inputTokens, `${label}.input_tokens`),
    cache_read_tokens: integer(
      bucket.cache_read_tokens ?? bucket.cacheReadTokens,
      `${label}.cache_read_tokens`
    ),
    output_tokens: integer(bucket.output_tokens ?? bucket.outputTokens, `${label}.output_tokens`),
    total_tokens: integer(bucket.total_tokens ?? bucket.totalTokens, `${label}.total_tokens`),
    api_equivalent_cost_min_usd: minCost,
    api_equivalent_cost_max_usd: maxCost,
  };
}

export function normalizeCodexBar(raw) {
  const row = Array.isArray(raw) ? raw.find((entry) => entry?.provider === 'codex') : raw;
  if (!row || row.provider !== 'codex' || row.source !== 'local') {
    throw new Error('CodexBar result must contain one local codex provider row');
  }
  const totals = normalizeBucket(row.totals ?? {}, 'oracle.totals');
  const daily = new Map();
  for (const bucket of row.daily ?? []) {
    if (typeof bucket.date !== 'string' || daily.has(bucket.date)) {
      throw new Error(`oracle daily date is missing or duplicated: ${bucket.date}`);
    }
    daily.set(bucket.date, normalizeBucket(bucket, `oracle.daily.${bucket.date}`));
  }
  return { totals, daily };
}

export function normalizeCodeVetter(raw) {
  const totals = normalizeBucket(raw?.totals ?? {}, 'actual.totals');
  const daily = new Map();
  for (const bucket of raw?.daily ?? []) {
    if (typeof bucket.date !== 'string' || daily.has(bucket.date)) {
      throw new Error(`actual daily date is missing or duplicated: ${bucket.date}`);
    }
    daily.set(bucket.date, normalizeBucket(bucket, `actual.daily.${bucket.date}`));
  }
  return { totals, daily };
}

export function compareAccounting(oracle, actual) {
  const mismatches = [];
  const compareBucket = (scope, expected, observed) => {
    for (const field of INTEGER_FIELDS) {
      if (expected[field] !== observed[field]) {
        mismatches.push({ scope, field, expected: expected[field], actual: observed[field] });
      }
    }
    const oracleCost = expected.api_equivalent_cost_min_usd;
    const epsilon = 1e-12;
    if (
      oracleCost + epsilon < observed.api_equivalent_cost_min_usd ||
      oracleCost - epsilon > observed.api_equivalent_cost_max_usd
    ) {
      mismatches.push({
        scope,
        field: 'api_equivalent_cost_usd',
        expected: oracleCost,
        actual: [observed.api_equivalent_cost_min_usd, observed.api_equivalent_cost_max_usd],
      });
    }
  };
  compareBucket('totals', oracle.totals, actual.totals);
  const dates = [...new Set([...oracle.daily.keys(), ...actual.daily.keys()])].sort();
  for (const date of dates) {
    const expected = oracle.daily.get(date);
    const observed = actual.daily.get(date);
    if (!expected || !observed) {
      mismatches.push({
        scope: `daily.${date}`,
        field: 'bucket',
        expected: expected ? 'present' : 'missing',
        actual: observed ? 'present' : 'missing',
      });
      continue;
    }
    compareBucket(`daily.${date}`, expected, observed);
  }
  return mismatches;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadJson(path, label) {
  if (!path) throw new Error(`${label} path is required`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runOracle(codexHome, binary) {
  if (!codexHome) throw new Error('--codex-home is required when --oracle-json is omitted');
  const result = spawnSync(binary, ['cost', '--provider', 'codex', '--json', '--refresh'], {
    encoding: 'utf8',
    env: { ...process.env, CODEX_HOME: codexHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`CodexBar failed (${result.status}): ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout);
}
export function main() {
  const actual = normalizeCodeVetter(loadJson(argument('--codevetter-json'), '--codevetter-json'));
  const oracleInput = argument('--oracle-json')
    ? loadJson(argument('--oracle-json'), '--oracle-json')
    : runOracle(argument('--codex-home'), argument('--codexbar') ?? 'codexbar');
  const oracle = normalizeCodexBar(oracleInput);
  const mismatches = compareAccounting(oracle, actual);
  const result = {
    qualified: mismatches.length === 0,
    compared_token_fields: INTEGER_FIELDS,
    compared_cost_field: 'oracle point must fall within CodeVetter API-equivalent bounds',
    compared_daily_buckets: [...new Set([...oracle.daily.keys(), ...actual.daily.keys()])].sort(),
    reasoning_parity: 'not_exposed_by_codexbar_cli; qualified_by_internal_fixture',
    mismatches,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (mismatches.length > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
