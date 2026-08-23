import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TIERS, classify, protocolFor } from './tiers.mjs';

test('tiers are assigned by measured size, and the boundaries are ordered', () => {
  assert.equal(classify(99).id, 'small');
  assert.equal(classify(141).id, 'small');
  assert.equal(classify(250).id, 'small');
  assert.equal(classify(251).id, 'medium');
  assert.equal(classify(1000).id, 'medium');
  assert.equal(classify(1001).id, 'large');
  // The regime that matters: the 1,461-file repository that broke a graph provider's
  // own import ceiling must be classified large, not medium.
  assert.equal(classify(1461).id, 'large');
  assert.equal(classify(30000).id, 'large');
});

test('the large boundary sits below the observed import ceiling', () => {
  // A graph provider failed on a 1,461-file repository against its own 32 MB /
  // 100k-node limits. If the large tier began above that, the benchmark could never
  // observe the failure mode that matters most at scale.
  const large = TIERS.find((t) => t.id === 'large');
  const medium = TIERS.find((t) => t.id === 'medium');
  assert.ok(medium.max_code_files <= 1461, 'large tier must include the 1,461-file regime');
  assert.equal(large.max_code_files, Number.POSITIVE_INFINITY);
});

test('large repositories use fixed-index, smaller ones re-index per case', () => {
  assert.equal(protocolFor('small'), 'per-case-index');
  assert.equal(protocolFor('medium'), 'per-case-index');
  assert.equal(protocolFor('large'), 'fixed-index');
  assert.throws(() => protocolFor('enormous'), /unknown tier/);
});

test('tier is measured at case revisions, not at HEAD', async () => {
  // The trap: a repository that has been split up reads small at HEAD and large at the
  // revisions its cases are actually scored against. One real repository measured 69
  // code files at HEAD with a median case revision of 537 — a different tier entirely,
  // and the protocol follows from the tier.
  //
  // This test used to point at that repository's local checkout and at a corpus file in
  // a session-scoped temp directory, so it skipped everywhere except one machine and
  // quietly contributed nothing. Building the shape synthetically is the only version
  // that runs for anyone else, which is the point of having it.
  const { tierFromRevisions } = await import('./tiers.mjs');
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const dir = mkdtempSync(join(tmpdir(), 'cr-tiers-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  mkdirSync(join(dir, 'src'), { recursive: true });

  // A large historical revision: 300 code files, which is above the small ceiling.
  for (let index = 0; index < 300; index += 1) {
    writeFileSync(join(dir, 'src', `mod${index}.ts`), `export const v${index} = ${index};\n`);
  }
  git('add', '-A');
  git('commit', '-qm', 'monolith');
  const historical = git('rev-parse', 'HEAD').trim();

  // Then the split: almost everything moves out, so HEAD reads small.
  for (let index = 0; index < 295; index += 1) {
    rmSync(join(dir, 'src', `mod${index}.ts`));
  }
  git('add', '-A');
  git('commit', '-qm', 'extract packages');
  const head = git('rev-parse', 'HEAD').trim();

  const atHead = tierFromRevisions(dir, [head]);
  const atCases = tierFromRevisions(dir, [historical]);

  assert.equal(atHead.tier, 'small', 'HEAD should read small after the split');
  assert.notEqual(
    atCases.tier,
    atHead.tier,
    'the historical revision must land in a different tier, or this trap cannot be detected'
  );
  assert.ok(
    atCases.median_code_files > atHead.median_code_files,
    `expected the case revision to be larger: ${atCases.median_code_files} vs ${atHead.median_code_files}`
  );
});

test('every repository lands in exactly one tier', () => {
  for (const files of [0, 1, 250, 251, 1000, 1001, 1461, 99999]) {
    const matches = TIERS.filter((t) => files <= t.max_code_files);
    assert.ok(matches.length >= 1);
    assert.equal(classify(files).id, matches[0].id);
  }
});
