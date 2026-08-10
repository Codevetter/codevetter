import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DEFAULT_MAX_ROWS, generateFixture, qualifyFixtureRequest } from './file-fixture.mjs';

test('generates deterministic file metadata without retaining hidden state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-1brc-fixture-'));
  const first = join(directory, 'first.txt');
  const second = join(directory, 'second.txt');
  try {
    const firstMetadata = await generateFixture({ rows: 20_003, outputPath: first });
    const secondMetadata = await generateFixture({ rows: 20_003, outputPath: second });
    assert.deepEqual(firstMetadata, secondMetadata);
    assert.equal((await readFile(first, 'utf8')).split('\n').length - 1, 20_003);
    assert.deepEqual(await readFile(first), await readFile(second));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses large fixtures before writing unless explicitly authorized', () => {
  assert.throws(
    () => qualifyFixtureRequest({ rows: DEFAULT_MAX_ROWS + 1, outputPath: '/tmp/blocked.txt' }),
    /explicit local large-run authorization/
  );
  assert.equal(
    qualifyFixtureRequest({
      rows: DEFAULT_MAX_ROWS + 1,
      outputPath: '/tmp/allowed.txt',
      allowLarge: true,
    }).large,
    true
  );
});
