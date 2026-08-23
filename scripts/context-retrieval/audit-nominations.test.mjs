import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auditNominations, renderAudit } from './audit-nominations.mjs';

const corpus = {
  cases: [
    {
      case_id: 'got-1',
      base_revision: 'base',
      commit: 'target',
      query: 'fix cache',
      required_files: ['source/cache.ts', 'test/cache.ts'],
    },
  ],
};

const legacyScore = {
  gates: {
    nominated_for_hand_audit: [
      {
        provider_id: 'tool',
        query: 'fix cache',
        revision: 'base',
        returned: ['source/cache.ts', 'source/other.ts'],
      },
    ],
  },
  cases: [
    {
      provider_id: 'tool',
      case_id: 'got-1',
      recall_at_5: 0.5,
      recall_at_10: 0.5,
    },
  ],
};

test('legacy nominations are joined to corpus evidence and audited at their stored window', () => {
  const audit = auditNominations({
    corpus,
    scores: [legacyScore],
    repo: '/repo',
    gitCheck: () => ({ missingRequiredChanges: [], missingReturnedPaths: [] }),
  });
  assert.deepEqual(audit.summary, {
    nominations: 1,
    metric_consistent: 1,
    selection_metric_evidence_complete: 0,
    corpus_cases_found: 1,
    score_cases_found: 1,
    required_file_sets_confirmed_by_git: 1,
    returned_path_sets_confirmed_by_git: 1,
  });
  assert.equal(audit.entries[0].case_id, 'got-1');
  assert.equal(audit.entries[0].independently_measured_recall, 0.5);
  assert.match(renderAudit(audit), /Legacy limitation/);
});

test('new nominations preserve enough evidence to reproduce the selection metric', () => {
  const score = {
    ...legacyScore,
    gates: {
      nominated_for_hand_audit: [
        {
          provider_id: 'tool',
          case_id: 'got-1',
          query: 'fix cache',
          revision: 'base',
          returned: ['source/cache.ts', 'source/other.ts'],
          returned_limit: 10,
          required_files: ['source/cache.ts', 'test/cache.ts'],
          claimed_recall_at_10: 0.5,
        },
      ],
    },
  };
  const audit = auditNominations({ corpus, scores: [score] });
  assert.equal(audit.summary.metric_consistent, 1);
  assert.equal(audit.summary.selection_metric_evidence_complete, 1);
  assert.doesNotMatch(renderAudit(audit), /Legacy limitation/);
});

test('an independently different result fails the metric check', () => {
  const score = structuredClone(legacyScore);
  score.cases[0].recall_at_5 = 1;
  const audit = auditNominations({ corpus, scores: [score] });
  assert.equal(audit.summary.metric_consistent, 0);
});
