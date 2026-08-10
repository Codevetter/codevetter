import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { aggregateFile } from './file-parser.mjs';
import { aggregateTemperatures, formatOfficialResults } from '../parser.mjs';

const execFileAsync = promisify(execFile);

test('Node sequential and worker lanes match Go across UTF-8 and partition boundaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-1brc-node-'));
  const path = join(directory, 'measurements.txt');
  const rows = [];
  for (let index = 0; index < 20_003; index += 1) {
    rows.push(index % 2 === 0 ? `Zürich;${index % 4 === 0 ? '-' : ''}0.5` : 'Abéché;10.1');
  }
  rows.push('A;-99.9', 'A;99.9');
  await writeFile(path, rows.join('\n'));
  try {
    const sequential = formatOfficialResults(await aggregateFile(path, 1));
    assert.equal(formatOfficialResults(aggregateTemperatures(rows.join('\n'))), sequential);
    for (const workers of [2, 4, 8]) {
      assert.equal(formatOfficialResults(await aggregateFile(path, workers)), sequential);
    }
    const goDirectory = new URL('../go', import.meta.url).pathname;
    const { stdout } = await execFileAsync('go', ['run', '.', '-workers', '8', path], {
      cwd: goDirectory,
      encoding: 'utf8',
    });
    assert.equal(stdout.trim(), sequential);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('preserves a UTF-8 station split across the one-megabyte read boundary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-1brc-utf8-boundary-'));
  const path = join(directory, 'measurements.txt');
  const prefix = 'A;0.0\n'.repeat(174_762);
  await writeFile(path, `${prefix}abcé;1.0\nlast;-9.9`);
  try {
    const sequential = formatOfficialResults(await aggregateFile(path, 1));
    assert.equal(sequential, '{A=0.0/0.0/0.0, abcé=1.0/1.0/1.0, last=-9.9/-9.9/-9.9}');
    assert.equal(formatOfficialResults(await aggregateFile(path, 4)), sequential);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Node file parser rejects invalid rows and unbounded worker counts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-1brc-invalid-'));
  const path = join(directory, 'measurements.txt');
  await writeFile(path, 'missing separator');
  try {
    await assert.rejects(aggregateFile(path, 1), /invalid row/);
    await assert.rejects(aggregateFile(path, 0), /workers must be between/);
    await assert.rejects(aggregateFile(path, 33), /workers must be between/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
