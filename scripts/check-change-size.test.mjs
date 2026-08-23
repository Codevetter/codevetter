import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The exclusion is a hole in a quality gate, so it is pinned by test: it must cover
// declared data directories and must not cover code, including code that happens to
// live under benchmarks/.
const source = readFileSync(new URL('./check-change-size.mjs', import.meta.url), 'utf8');
const patterns = [...source.matchAll(/\/\^benchmarks\\\/\[\^\/\]\+\\\/(\w+)\\\//g)].map(
  (m) => m[1]
);

const DATA_PATHS = [/^benchmarks\/[^/]+\/results\//, /^benchmarks\/[^/]+\/corpora\//];
const isGeneratedData = (file) => DATA_PATHS.some((pattern) => pattern.test(file));

test('the exclusion covers exactly the two declared data directories', () => {
  // If this fails, someone widened the hole. Widening it is a decision, not a detail.
  assert.deepEqual(patterns.sort(), ['corpora', 'results']);
});

test('measurement output is excluded', () => {
  assert.equal(
    isGeneratedData('benchmarks/context-retrieval/results/full-field-got/semble.json'),
    true
  );
  assert.equal(isGeneratedData('benchmarks/context-retrieval/corpora/corpus-got.json'), true);
});

test('code is counted, including code under benchmarks/', () => {
  // The gate exists to keep review tractable. Anything a reviewer reads must still count.
  assert.equal(isGeneratedData('benchmarks/context-retrieval/README.md'), false);
  assert.equal(isGeneratedData('benchmarks/context-retrieval/plan.json'), false);
  assert.equal(isGeneratedData('scripts/context-retrieval/score.mjs'), false);
  assert.equal(isGeneratedData('apps/desktop/src/App.tsx'), false);
  // Not a results directory of a benchmark, just a path that mentions the word.
  assert.equal(isGeneratedData('scripts/results/helper.mjs'), false);
  assert.equal(isGeneratedData('benchmarks/results/loose.json'), false);
});
