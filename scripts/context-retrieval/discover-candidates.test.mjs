import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TOPIC_QUERIES, diffAgainstRegistry, runSweep, triage } from './discover-candidates.mjs';

test('matching is owner-aware: same name, different owner is not covered', () => {
  // The exact miss: repowise-npm was registered; repowise-dev/repowise (6.2k stars,
  // AGPL, a different tool) had never been evaluated and was reported as covered.
  const registry = { candidates: [{ id: 'repowise-npm', repo: 'someone/repowise-npm' }] };
  const { missing } = diffAgainstRegistry(
    [{ full_name: 'repowise-dev/repowise', stars: 6165, description: 'codebase intelligence' }],
    registry
  );
  assert.equal(missing.length, 1, 'a different owner must not be treated as covered');
});

test('both registry schema keys are honoured', () => {
  // Older entries use `repo`, newer ones `repository`. Reading only one made half the
  // dedupe dead code, which is why the diff silently fell back to matching ids.
  const viaRepo = diffAgainstRegistry(
    [{ full_name: 'Graphify-Labs/graphify', stars: 1, description: '' }],
    { candidates: [{ id: 'graphify', repo: 'Graphify-Labs/graphify' }] }
  );
  assert.equal(viaRepo.missing.length, 0);
  const viaRepository = diffAgainstRegistry(
    [{ full_name: 'repowise-dev/repowise', stars: 1, description: '' }],
    { candidates: [{ id: 'repowise', repository: 'repowise-dev/repowise' }] }
  );
  assert.equal(viaRepository.missing.length, 0);
});

test('a bare id match with no slug is surfaced as needing verification', () => {
  const { missing } = diffAgainstRegistry(
    [{ full_name: 'google/codesearch', stars: 3997, description: 'trigram index' }],
    { candidates: [{ id: 'codesearch' }, { id: 'other', repo: 'a/b' }] }
  );
  assert.equal(missing.length, 1);
  assert.match(missing[0].name_collision, /verify these are the same project/);
});

test('topic list covers the tags the ecosystem actually uses', () => {
  // `mcp` alone missed a category that is mostly MCP servers.
  assert.ok(TOPIC_QUERIES.includes('mcp-server'));
  assert.ok(TOPIC_QUERIES.includes('code-graph'));
  assert.ok(TOPIC_QUERIES.includes('semantic-search'));
});

test('the star floor is 1000 and sub-floor tools are dropped with a reason', () => {
  // Owner decision. The tension is recorded rather than argued: sub-floor members exist
  // and are kept in the registry as excluded-below-star-floor so the scope limit stays
  // auditable instead of looking like an oversight.
  const { kept, dropped } = triage(
    [
      {
        full_name: 'ory/lumen',
        stars: 251,
        description: 'local semantic code search',
        pushed_at: '2026-08-01',
      },
      {
        full_name: 'BeaconBay/ck',
        stars: 1703,
        description: 'semantic code search grep',
        pushed_at: '2026-08-01',
      },
    ],
    { minStars: 1000 }
  );
  assert.deepEqual(
    kept.map((r) => r.full_name),
    ['BeaconBay/ck']
  );
  assert.equal(dropped[0].reason, 'below-star-floor');
});

test('discovery fails closed when GitHub search is unavailable', () => {
  assert.throws(
    () => runSweep({ gh: 'codevetter-missing-gh-executable' }),
    /GitHub discovery failed/
  );
});
