import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

import { generateFixture } from './file-fixture.mjs';

const execFileAsync = promisify(execFile);
const directory = dirname(fileURLToPath(import.meta.url));

export async function runCampaign({ rows, workers, samples = 5, outputPath = null }) {
  if (!Number.isInteger(samples) || samples < 3 || samples > 20) {
    throw new Error('samples must be between 3 and 20');
  }
  const temporary = await mkdtemp(join(tmpdir(), 'codevetter-1brc-campaign-'));
  const fixturePath = join(temporary, 'measurements.txt');
  const goBinary = join(temporary, 'go-1brc');
  const fixture = await generateFixture({ rows, outputPath: fixturePath });
  try {
    await execFileAsync('go', ['build', '-o', goBinary, '.'], {
      cwd: join(directory, 'go'),
      timeout: 120_000,
    });
    const lanes = [];
    for (const workerCount of workers) {
      lanes.push(
        lane('go', workerCount, goBinary, ['-workers', String(workerCount), fixturePath]),
        lane('node', workerCount, process.execPath, [
          join(directory, 'node/run.mjs'),
          fixturePath,
          String(workerCount),
        ])
      );
    }
    for (const candidate of lanes) await measure(candidate, fixture.expected_output_sha256);
    for (let round = 0; round < samples; round += 1) {
      const rotated = [
        ...lanes.slice(round % lanes.length),
        ...lanes.slice(0, round % lanes.length),
      ];
      for (const candidate of rotated) {
        candidate.samples.push(await measure(candidate, fixture.expected_output_sha256));
      }
    }
    const result = {
      schema_version: 'codevetter-1brc-campaign/v1',
      recorded_at: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: process.arch,
        logical_cpus: cpus().length,
        node_version: process.version,
        go_version: (await execFileAsync('go', ['version'])).stdout.trim(),
      },
      fixture,
      methodology: {
        warmups: 1,
        samples,
        aggregation: 'discard minimum and maximum wall time; mean remaining samples',
        order: 'round-robin rotation across runtime and worker lanes',
        fixture_retention: 'removed after campaign',
      },
      variants: lanes.map((candidate) => summarizeLane(candidate, rows)),
      limitations: [
        'Local filesystem cache state is not reset between samples.',
        'Peak RSS is the timed process value and excludes filesystem cache effects.',
        'Results are comparable only within this recorded machine and campaign.',
      ],
    };
    if (outputPath) await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export function summarizeSamples(values) {
  if (values.length < 3) throw new Error('at least three samples are required');
  const sorted = [...values].sort((left, right) => left - right);
  const retained = sorted.slice(1, -1);
  return {
    minimum: round(sorted[0]),
    maximum: round(sorted.at(-1)),
    retained_mean: round(retained.reduce((sum, value) => sum + value, 0) / retained.length),
  };
}

function lane(runtime, workers, command, args) {
  return { runtime, workers, command, args, samples: [] };
}

async function measure(candidate, expectedOutputSha256) {
  const timed = process.platform === 'darwin';
  const command = timed ? '/usr/bin/time' : candidate.command;
  const args = timed ? ['-l', candidate.command, ...candidate.args] : candidate.args;
  const startedAt = performance.now();
  const { stdout, stderr } = await execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 120_000,
  });
  const durationMs = performance.now() - startedAt;
  const outputSha256 = createHash('sha256').update(stdout.trim()).digest('hex');
  if (outputSha256 !== expectedOutputSha256) {
    throw new Error(`${candidate.runtime}/${candidate.workers} produced an incorrect result`);
  }
  const residentMatch = stderr.match(/(\d+)\s+maximum resident set size/);
  return {
    duration_ms: round(durationMs),
    peak_rss_bytes: residentMatch ? Number.parseInt(residentMatch[1], 10) : null,
  };
}

function summarizeLane(candidate, rows) {
  const durations = summarizeSamples(candidate.samples.map((sample) => sample.duration_ms));
  const resident = candidate.samples
    .map((sample) => sample.peak_rss_bytes)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return {
    runtime: candidate.runtime,
    workers: candidate.workers,
    samples: candidate.samples,
    duration_ms: durations,
    throughput_rows_per_second: Math.round((rows * 1000) / durations.retained_mean),
    median_peak_rss_bytes: resident.length === 0 ? null : resident[Math.floor(resident.length / 2)],
  };
}

function round(value) {
  return Number(value.toFixed(3));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const result = await runCampaign(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith('--') || value === undefined)
      throw new Error('arguments use --name value');
    values.set(name.slice(2), value);
  }
  const rows = Number.parseInt(values.get('rows') ?? '5000000', 10);
  const workers = (values.get('workers') ?? '1,2,4,8').split(',').map(Number);
  const samples = Number.parseInt(values.get('samples') ?? '5', 10);
  if (!Number.isSafeInteger(rows) || rows <= 0) throw new Error('rows must be a positive integer');
  if (workers.some((value) => !Number.isInteger(value) || value < 1 || value > 32)) {
    throw new Error('workers must be comma-separated integers between 1 and 32');
  }
  return {
    rows,
    workers: [...new Set(workers)],
    samples,
    outputPath: values.get('output') ?? null,
  };
}
