import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { Worker } from 'node:worker_threads';

const CHUNK_BYTES = 1024 * 1024;
const MAX_WORKERS = 32;
const NEWLINE_PROBE_BYTES = 128 * 1024;

export async function aggregateFile(path, workers = 1) {
  if (!Number.isInteger(workers) || workers < 1 || workers > MAX_WORKERS) {
    throw new Error(`workers must be between 1 and ${MAX_WORKERS}`);
  }
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    if (workers === 1 || size === 0) return await aggregateFileRange(file, 0, size);
    const ranges = await newlineAlignedRanges(file, size, workers);
    const partials = await Promise.all(ranges.map((range) => runWorker(path, range)));
    const merged = new Map();
    for (const entries of partials) mergeAggregates(merged, new Map(entries));
    return merged;
  } finally {
    await file.close();
  }
}

export async function aggregateFileRange(fileOrPath, start, end) {
  const ownsFile = typeof fileOrPath === 'string';
  const file = ownsFile ? await open(fileOrPath, 'r') : fileOrPath;
  const aggregates = new Map();
  const decoder = new StringDecoder('utf8');
  let position = start;
  let carry = '';
  try {
    while (position < end) {
      const requested = Math.min(CHUNK_BYTES, end - position);
      const chunk = Buffer.allocUnsafe(requested);
      const { bytesRead } = await file.read(chunk, 0, requested, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const input = carry + decoder.write(chunk.subarray(0, bytesRead));
      const finalNewline = input.lastIndexOf('\n');
      if (finalNewline === -1) {
        carry = input;
        continue;
      }
      parseTextRows(input.slice(0, finalNewline + 1), aggregates);
      carry = input.slice(finalNewline + 1);
    }
    carry += decoder.end();
    if (carry.length > 0) parseTextRows(carry, aggregates);
    return aggregates;
  } finally {
    if (ownsFile) await file.close();
  }
}

async function newlineAlignedRanges(file, size, workers) {
  const boundaries = new Array(workers + 1).fill(0);
  boundaries[workers] = size;
  const probe = Buffer.allocUnsafe(NEWLINE_PROBE_BYTES);
  for (let worker = 1; worker < workers; worker += 1) {
    const target = Math.floor((size * worker) / workers);
    const { bytesRead } = await file.read(probe, 0, probe.length, target);
    const newline = probe.subarray(0, bytesRead).indexOf(10);
    boundaries[worker] = newline === -1 ? size : target + newline + 1;
  }
  const ranges = [];
  for (let worker = 0; worker < workers; worker += 1) {
    if (boundaries[worker] < boundaries[worker + 1]) {
      ranges.push({ start: boundaries[worker], end: boundaries[worker + 1] });
    }
  }
  return ranges;
}

function parseTextRows(text, aggregates) {
  let cursor = 0;
  while (cursor < text.length) {
    const separator = text.indexOf(';', cursor);
    if (separator <= cursor) throw new Error('invalid row');
    const station = text.slice(cursor, separator);
    cursor = separator + 1;
    let sign = 1;
    if (text.charCodeAt(cursor) === 45) {
      sign = -1;
      cursor += 1;
    }
    let temperature = 0;
    let integerDigits = 0;
    let fractionDigits = 0;
    let sawDot = false;
    for (; cursor < text.length; cursor += 1) {
      const code = text.charCodeAt(cursor);
      if (code === 10) {
        cursor += 1;
        break;
      }
      if (code === 46 && !sawDot && integerDigits > 0) {
        sawDot = true;
        continue;
      }
      if (code < 48 || code > 57) throw new Error('invalid temperature');
      temperature = temperature * 10 + code - 48;
      if (sawDot) fractionDigits += 1;
      else integerDigits += 1;
    }
    if (integerDigits === 0 || fractionDigits !== 1) throw new Error('invalid temperature');
    temperature *= sign;
    const aggregate = aggregates.get(station);
    if (aggregate) updateAggregate(aggregate, temperature);
    else {
      aggregates.set(station, {
        count: 1,
        sum: temperature,
        min: temperature,
        max: temperature,
      });
    }
  }
}

function updateAggregate(aggregate, temperature) {
  aggregate.count += 1;
  aggregate.sum += temperature;
  if (temperature < aggregate.min) aggregate.min = temperature;
  if (temperature > aggregate.max) aggregate.max = temperature;
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

function runWorker(path, range) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
      workerData: { path, ...range },
    });
    worker.once('message', (message) => {
      if (message.error) reject(new Error(message.error));
      else resolve(message.entries);
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`worker exited with code ${code}`));
    });
  });
}
