import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { collectV8FunctionCoverage } from './function-coverage.mjs';

const SIZES = [80, 800, 3_200];
const ITERATIONS = 2;

test('function coverage normalization scales across source anchors', {
  timeout: 30_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-self-profile-'));
  try {
    const fixtures = [];
    for (const size of SIZES) fixtures.push(await buildFixture(root, size));

    const metrics = [];
    for (const fixture of fixtures) {
      const initial = await collectV8FunctionCoverage(fixture.coverageDirectory, root);
      assertCoverage(initial, fixture.size);

      let totalDuration = 0;
      for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
        const startedAt = performance.now();
        const observed = await collectV8FunctionCoverage(fixture.coverageDirectory, root);
        totalDuration += performance.now() - startedAt;
        assertCoverage(observed, fixture.size);
      }
      metrics.push(`size${fixture.size}=${(totalDuration / ITERATIONS).toFixed(3)}ms/op`);
    }

    console.log(`[benchmark] ${metrics.join(' ')} (${ITERATIONS} iterations)`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function buildFixture(root, size) {
  const fixtureRoot = join(root, `fixture-${size}`);
  const sourceDirectory = join(fixtureRoot, 'src');
  const coverageDirectory = join(fixtureRoot, 'coverage');
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(coverageDirectory);

  const lines = [];
  const functions = [];
  let offset = 0;
  for (let index = 0; index < size; index += 1) {
    const line = `export function work${index}() { return ${index}; }`;
    lines.push(line);
    functions.push({
      functionName: `work${index}`,
      ranges: [{ startOffset: offset, endOffset: offset + line.length, count: size - index }],
    });
    offset += line.length + 1;
  }

  const sourcePath = join(sourceDirectory, 'generated.js');
  await writeFile(sourcePath, `${lines.join('\n')}\n`);
  await writeFile(
    join(coverageDirectory, 'coverage-generated.json'),
    JSON.stringify({ result: [{ url: pathToFileURL(sourcePath).href, functions }] })
  );
  return { coverageDirectory, size };
}

function assertCoverage(observed, size) {
  assert.equal(observed.coverage_files, 1);
  assert.equal(observed.functions.length, Math.min(size, 128));
  assert.equal(observed.functions[0].function, 'work0');
  assert.equal(observed.functions[0].start_line, 1);
  assert.equal(observed.functions.at(-1).start_line, Math.min(size, 128));
  assert.equal(observed.truncated, size > 128);
}
