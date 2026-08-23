import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// The abandon path lives inside the scoring loop, so it is asserted structurally:
// the threshold must exist, must be consecutive, and an abandoned arm must be
// recorded in the artifact rather than silently truncated.
const src = readFileSync(new URL('./score.mjs', import.meta.url), 'utf8');

test('abandons an arm after a bounded number of consecutive index failures', () => {
  assert.match(src, /ABANDON_AFTER_HARD_FAILURES = 3/);
  // Consecutive, not cumulative: the counter must reset on a non-hard failure.
  assert.match(src, /consecutiveHardFailures = hard \? consecutiveHardFailures \+ 1 : 0/);
});

test('hard failures are index, worktree and capacity refusals — not empty results', () => {
  // A query that returns nothing is a result; failing to index is not. A capacity
  // refusal is also hard: retrying cannot make a snapshot smaller than the ceiling
  // that rejected it, so the arm should be abandoned rather than retried 80 times.
  assert.match(src, /\^\(index\|worktree\)/);
  assert.match(src, /exceeds\?\[- \]\.\*limit/);
  assert.match(src, /safety limit/);
});

test('an abandoned arm is recorded in the artifact with what was skipped', () => {
  assert.match(src, /abandoned: provider_abandoned\.get\(provider\.provider_id\)/);
  assert.match(src, /remaining: corpus\.cases\.length - cases\.length/);
});
