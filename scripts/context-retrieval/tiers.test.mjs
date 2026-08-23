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

test('tier is measured at case revisions, not at HEAD', async (t) => {
  const { tierFromRevisions } = await import('./tiers.mjs');
  const { existsSync, readFileSync } = await import('node:fs');
  const repo = `${process.env.HOME}/Desktop/fleet/site-health`;
  // Deliberately the corpus's own base revisions, not `rev-list HEAD`. The newest
  // commits are all post-split and read small; the trap only appears in the
  // revisions the cases are actually scored against. Sampling the wrong revisions
  // is the exact mistake this test exists to catch, and the first version of this
  // test made it.
  const corpus =
    '/private/tmp/claude-501/-Users-sarthak-Desktop-fleet-codevetter/89a25e80-80a8-452a-bfe6-a8c6ea4ae228/scratchpad/corpus-site-health.json';
  if (!existsSync(repo) || !existsSync(corpus)) {
    t.skip('site-health checkout or corpus unavailable');
    return;
  }
  const revisions = JSON.parse(readFileSync(corpus, 'utf8')).cases.map((c) => c.base_revision);
  const result = tierFromRevisions(repo, revisions);
  assert.equal(result.ok, true);
  // HEAD reads 69 code files (small); the case revisions run far larger, because a
  // monorepo was extracted out of this repository partway through its history. A
  // provider was wrongly accused of a capacity defect on the HEAD number.
  assert.ok(
    result.max_code_files > 250,
    `history must exceed the small ceiling, saw ${result.max_code_files}`
  );
  assert.ok(Array.isArray(result.spans_tiers), 'a repo spanning tiers must say so');
});

test('every repository lands in exactly one tier', () => {
  for (const files of [0, 1, 250, 251, 1000, 1001, 1461, 99999]) {
    const matches = TIERS.filter((t) => files <= t.max_code_files);
    assert.ok(matches.length >= 1);
    assert.equal(classify(files).id, matches[0].id);
  }
});
