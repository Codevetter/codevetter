import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { generateFixture } from '../file-fixture.mjs';
import { formatOfficialResults } from '../parser.mjs';
import { aggregateFile } from './file-parser.mjs';

const rows = 800_000;
const iterations = 5;
const directory = await mkdtemp(join(tmpdir(), 'codevetter-1brc-node-profile-'));
const path = join(directory, 'measurements.txt');
try {
  const fixture = await generateFixture({ rows, outputPath: path });
  let totalMs = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    const aggregates = await aggregateFile(path, 1);
    totalMs += performance.now() - startedAt;
    const digest = createHash('sha256').update(formatOfficialResults(aggregates)).digest('hex');
    assert.equal(digest, fixture.expected_output_sha256);
  }
  console.log(`[benchmark] size${rows}=${(totalMs / iterations).toFixed(3)}ms/op`);
  console.log(
    `[resource] variant=node-file-sequential rows=${rows} max_rss_kib=${process.resourceUsage().maxRSS}`
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
