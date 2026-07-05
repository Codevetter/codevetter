import assert from 'node:assert/strict';
import test from 'node:test';

import { computeUnpackMetricScores } from '@/lib/unpack-metrics';

const verifiedRepos = [
  {
    name: 'codevetter',
    input: {
      totalMs: 245,
      capped: false,
      coveragePct: null,
      hasWholeRepoMetadata: true,
      graphNodes: 644,
      graphTruncated: false,
      healthFiles: 96,
      commits: 12,
      workspaceUnits: 6,
    },
  },
  {
    name: 'saas-maker monorepo',
    input: {
      totalMs: 198,
      capped: false,
      coveragePct: null,
      hasWholeRepoMetadata: true,
      graphNodes: 535,
      graphTruncated: false,
      healthFiles: 96,
      commits: 12,
      workspaceUnits: 14,
    },
  },
  {
    name: 'compact fleet-ops repo',
    input: {
      totalMs: 82,
      capped: false,
      coveragePct: null,
      hasWholeRepoMetadata: true,
      graphNodes: 112,
      graphTruncated: false,
      healthFiles: 37,
      commits: 12,
      workspaceUnits: 3,
    },
  },
  {
    name: 'linux sampled huge repo',
    input: {
      totalMs: 1019,
      capped: true,
      coveragePct: 4.2,
      hasWholeRepoMetadata: true,
      graphNodes: 1024,
      graphTruncated: true,
      healthFiles: 96,
      commits: 1,
      workspaceUnits: 17,
    },
  },
];

for (const fixture of verifiedRepos) {
  test(`scan metric scores stay 9+ for ${fixture.name}`, () => {
    const scores = computeUnpackMetricScores(fixture.input);
    assert.ok(scores.speed >= 9, `speed=${scores.speed}`);
    assert.ok(scores.correctness >= 9, `correctness=${scores.correctness}`);
    assert.ok(scores.usefulness >= 9, `usefulness=${scores.usefulness}`);
  });
}

test('correctness drops when sampled repos lack whole-repo metadata', () => {
  const scores = computeUnpackMetricScores({
    totalMs: 800,
    capped: true,
    coveragePct: 4,
    hasWholeRepoMetadata: false,
    graphNodes: 600,
    graphTruncated: false,
    healthFiles: 96,
    commits: 5,
    workspaceUnits: 10,
  });

  assert.equal(scores.correctness, 6);
});

test('usefulness drops for repos without graph or health evidence', () => {
  const scores = computeUnpackMetricScores({
    totalMs: 120,
    capped: false,
    coveragePct: null,
    hasWholeRepoMetadata: true,
    graphNodes: 0,
    graphTruncated: false,
    healthFiles: 0,
    commits: 0,
    workspaceUnits: 0,
  });

  assert.equal(scores.correctness, 6);
  assert.ok(scores.usefulness < 7, `usefulness=${scores.usefulness}`);
});
