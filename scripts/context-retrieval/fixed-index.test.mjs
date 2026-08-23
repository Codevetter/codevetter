import assert from 'node:assert/strict';
import { test } from 'node:test';

import { admissibleUnderFixedIndex } from './tiers.mjs';

const SP =
  '/private/tmp/claude-501/-Users-sarthak-Desktop-fleet-codevetter/89a25e80-80a8-452a-bfe6-a8c6ea4ae228/scratchpad';
const REPO = `${SP}/public/gin`;

// The whole validity of the large tier rests on this: if the index revision is not
// strictly older than the case, the provider is handed the fix it is being asked to
// locate, and the entire tier inflates. Asserted against real git history rather
// than trusted to a comment.
test('a case is admissible only if the index predates it', async (t) => {
  const { execFileSync } = await import('node:child_process');
  let revs;
  try {
    revs = execFileSync('git', ['-C', REPO, 'rev-list', '--max-count=3', 'HEAD'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n');
  } catch {
    t.skip('gin checkout unavailable');
    return;
  }
  const [newest, middle, oldest] = revs;

  // Index older than the case: admissible.
  assert.equal(
    admissibleUnderFixedIndex({ repo: REPO, indexRevision: oldest, caseRevision: newest }),
    true
  );
  // Index newer than the case: the fix would already be indexed.
  assert.equal(
    admissibleUnderFixedIndex({ repo: REPO, indexRevision: newest, caseRevision: oldest }),
    false
  );
  // Index equal to the case: the fix is in the index.
  assert.equal(
    admissibleUnderFixedIndex({ repo: REPO, indexRevision: middle, caseRevision: middle }),
    false
  );
});

test('an unknown revision is inadmissible rather than silently allowed', () => {
  assert.equal(
    admissibleUnderFixedIndex({
      repo: REPO,
      indexRevision: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      caseRevision: 'HEAD',
    }),
    false
  );
});
