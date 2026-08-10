import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { promisify } from 'node:util';

import { aggregateTemperatures, formatOfficialResults } from './parser.mjs';
import { aggregateTemperaturesReference } from './reference-parser.mjs';

const BLOCK_ROWS = 20_000;
const SIZES = [BLOCK_ROWS, BLOCK_ROWS * 10, BLOCK_ROWS * 40];
const ITERATIONS = 10;
const STATION_COUNT = 64;
const execFileAsync = promisify(execFile);
const VARIANT = process.env.CODEVETTER_1BRC_VARIANT ?? 'optimized';
const aggregateUnderTest =
  VARIANT === 'reference' ? aggregateTemperaturesReference : aggregateTemperatures;

if (!['optimized', 'reference'].includes(VARIANT)) {
  throw new Error(`unsupported CODEVETTER_1BRC_VARIANT: ${VARIANT}`);
}

test('matches the official 1BRC result contract for valid UTF-8 station rows', () => {
  const input = [
    'Zürich;-0.5',
    'Abéché;10.0',
    'A;99.9',
    'Zürich;0.4',
    'Abéché;10.1',
    'A;-99.9',
    '',
  ].join('\n');

  assert.equal(
    formatOfficialResults(aggregateTemperatures(input)),
    '{A=-99.9/0.0/99.9, Abéché=10.0/10.1/10.1, Zürich=-0.5/0.0/0.4}'
  );
});

test('reads a compatible measurements file and writes only the official result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-1brc-'));
  const inputPath = join(directory, 'measurements.txt');
  await writeFile(inputPath, 'Beta;1.0\nAlpha;-1.0\nAlpha;2.0\n');
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [new URL('./run.mjs', import.meta.url).pathname, inputPath],
      { encoding: 'utf8' }
    );
    assert.equal(stdout, '{Alpha=-1.0/0.5/2.0, Beta=1.0/1.0/1.0}\n');
    assert.equal(stderr, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('temperature aggregation scales across deterministic row counts', { timeout: 30_000 }, () => {
  const block = buildBlock();
  const metrics = [];
  let largestInputBytes = 0;

  for (const rows of SIZES) {
    const repetitions = rows / BLOCK_ROWS;
    const input = block.text.repeat(repetitions);
    largestInputBytes = Math.max(largestInputBytes, Buffer.byteLength(input));
    const expected = scaleExpected(block.expected, repetitions);
    const expectedDigest = digest(expected);

    assert.equal(digest(aggregateUnderTest(input)), expectedDigest);

    let totalDuration = 0;
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const startedAt = performance.now();
      const observed = aggregateUnderTest(input);
      totalDuration += performance.now() - startedAt;
      assert.equal(digest(observed), expectedDigest);
    }
    metrics.push(`size${rows}=${(totalDuration / ITERATIONS).toFixed(3)}ms/op`);
  }

  console.log(`[benchmark] ${metrics.join(' ')} (${ITERATIONS} iterations)`);
  console.log(
    `[resource] variant=${VARIANT} largest_input_bytes=${largestInputBytes} max_rss_kib=${process.resourceUsage().maxRSS}`
  );
});

function buildBlock() {
  const lines = new Array(BLOCK_ROWS);
  const expected = new Map();
  for (let row = 0; row < BLOCK_ROWS; row += 1) {
    const stationIndex = row % STATION_COUNT;
    const station = `station-${stationIndex.toString().padStart(2, '0')}`;
    const temperature = ((row * 73 + stationIndex * 11) % 1_999) - 999;
    lines[row] = `${station};${formatTenths(temperature)}\n`;
    updateAggregate(expected, station, temperature);
  }
  return { text: lines.join(''), expected };
}

function updateAggregate(aggregates, station, temperature) {
  const aggregate = aggregates.get(station);
  if (aggregate) {
    aggregate.count += 1;
    aggregate.sum += temperature;
    aggregate.min = Math.min(aggregate.min, temperature);
    aggregate.max = Math.max(aggregate.max, temperature);
  } else {
    aggregates.set(station, {
      count: 1,
      sum: temperature,
      min: temperature,
      max: temperature,
    });
  }
}

function scaleExpected(blockExpected, repetitions) {
  return new Map(
    [...blockExpected].map(([station, aggregate]) => [
      station,
      {
        count: aggregate.count * repetitions,
        sum: aggregate.sum * repetitions,
        min: aggregate.min,
        max: aggregate.max,
      },
    ])
  );
}

function digest(aggregates) {
  return [...aggregates]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([station, aggregate]) =>
        `${station}:${aggregate.count}:${aggregate.min}:${aggregate.max}:${aggregate.sum}`
    )
    .join('|');
}

function formatTenths(value) {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 10)}.${absolute % 10}`;
}
