import { createHash } from 'node:crypto';
import { mkdir, open, readFile, statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatOfficialResults } from './parser.mjs';

export const BLOCK_ROWS = 20_000;
export const DEFAULT_MAX_ROWS = 10_000_000;
export const DEFAULT_MAX_GENERATION_MS = 30 * 60 * 1000;
export const LARGE_RUN_ENV = 'CODEVETTER_1BRC_ALLOW_LARGE';

const MAX_ROW_BYTES = 128;
const STORAGE_RESERVE_BYTES = 128 * 1024 * 1024;
const stationPath = fileURLToPath(new URL('./official-stations.csv', import.meta.url));
let stationPromise;

export async function buildDeterministicBlock(startRow = 0, rows = BLOCK_ROWS) {
  const stations = await loadStations();
  const lines = new Array(rows);
  const aggregates = new Map();
  for (let offset = 0; offset < rows; offset += 1) {
    const row = startRow + offset;
    const station = stations[mix32(row * 3 + 1) % stations.length];
    const temperature = deterministicTemperature(station.meanTenths, row);
    lines[offset] = `${station.name};${formatTenths(temperature)}\n`;
    updateAggregate(aggregates, station.name, temperature);
  }
  return { buffer: Buffer.from(lines.join('')), aggregates };
}

export function qualifyFixtureRequest({ rows, outputPath, allowLarge = false }) {
  if (!Number.isSafeInteger(rows) || rows <= 0) throw new Error('rows must be a positive integer');
  if (!outputPath) throw new Error('outputPath is required');
  const large = rows > DEFAULT_MAX_ROWS;
  if (large && !allowLarge && process.env[LARGE_RUN_ENV] !== '1') {
    throw new Error(
      `${rows} rows requires explicit local large-run authorization via ${LARGE_RUN_ENV}=1`
    );
  }
  return { rows, maximumBytes: rows * MAX_ROW_BYTES, large };
}

export async function generateFixture({
  rows,
  outputPath,
  allowLarge = false,
  maximumDurationMs = DEFAULT_MAX_GENERATION_MS,
}) {
  if (!Number.isFinite(maximumDurationMs) || maximumDurationMs <= 0) {
    throw new Error('maximumDurationMs must be positive');
  }
  const qualification = qualifyFixtureRequest({ rows, outputPath, allowLarge });
  await mkdir(dirname(outputPath), { recursive: true });
  const storage = await statfs(dirname(outputPath));
  const availableBytes = Number(storage.bavail) * Number(storage.bsize);
  if (availableBytes < qualification.maximumBytes + STORAGE_RESERVE_BYTES) {
    throw new Error(
      `insufficient local storage: need up to ${qualification.maximumBytes + STORAGE_RESERVE_BYTES} bytes, have ${availableBytes}`
    );
  }

  const inputHash = createHash('sha256');
  const expected = new Map();
  const handle = await open(outputPath, 'wx');
  const startedAt = performance.now();
  let bytes = 0;
  try {
    for (let startRow = 0; startRow < rows; startRow += BLOCK_ROWS) {
      if (performance.now() - startedAt > maximumDurationMs) {
        throw new Error(`fixture generation exceeded ${maximumDurationMs} ms`);
      }
      const block = await buildDeterministicBlock(startRow, Math.min(BLOCK_ROWS, rows - startRow));
      await handle.write(block.buffer);
      inputHash.update(block.buffer);
      bytes += block.buffer.length;
      mergeAggregates(expected, block.aggregates);
    }
  } finally {
    await handle.close();
  }

  const expectedOutput = formatOfficialResults(expected);
  return {
    schema_version: 'codevetter-1brc-fixture/v1',
    rows,
    bytes,
    sha256: inputHash.digest('hex'),
    expected_output_sha256: createHash('sha256').update(expectedOutput).digest('hex'),
    fixture_profile: 'official-413-stations-deterministic-gaussian',
    station_count: 413,
    generation_duration_limit_ms: maximumDurationMs,
    large_run_authorized: qualification.large,
    retention: 'caller-controlled; campaign default is remove',
  };
}

async function loadStations() {
  stationPromise ??= readFile(stationPath, 'utf8').then((text) =>
    text
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.lastIndexOf(';');
        return {
          name: line.slice(0, separator),
          meanTenths: Math.round(Number.parseFloat(line.slice(separator + 1)) * 10),
        };
      })
  );
  const stations = await stationPromise;
  if (stations.length !== 413)
    throw new Error(`expected 413 official stations, got ${stations.length}`);
  return stations;
}

function deterministicTemperature(meanTenths, row) {
  const first = (mix32(row * 3 + 2) + 1) / 4_294_967_297;
  const second = (mix32(row * 3 + 3) + 1) / 4_294_967_297;
  const gaussian = Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  return Math.max(-999, Math.min(999, Math.round(meanTenths + gaussian * 100)));
}

function mix32(value) {
  let mixed = value | 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function mergeAggregates(destination, source) {
  for (const [station, observed] of source) {
    const current = destination.get(station);
    if (!current) {
      destination.set(station, { ...observed });
      continue;
    }
    current.count += observed.count;
    current.sum += observed.sum;
    if (observed.min < current.min) current.min = observed.min;
    if (observed.max > current.max) current.max = observed.max;
  }
}

function updateAggregate(aggregates, station, temperature) {
  const aggregate = aggregates.get(station);
  if (aggregate) {
    aggregate.count += 1;
    aggregate.sum += temperature;
    if (temperature < aggregate.min) aggregate.min = temperature;
    if (temperature > aggregate.max) aggregate.max = temperature;
  } else {
    aggregates.set(station, {
      count: 1,
      sum: temperature,
      min: temperature,
      max: temperature,
    });
  }
}

function formatTenths(value) {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 10)}.${absolute % 10}`;
}
