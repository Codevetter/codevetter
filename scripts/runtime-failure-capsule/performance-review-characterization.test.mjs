import assert from 'node:assert/strict';
import test from 'node:test';

import { characterizePerformanceForReview } from './performance-review-characterization.mjs';

const SUBJECT = {
  repository_revision: 'a'.repeat(40),
  source_snapshot_sha256: 'b'.repeat(64),
};
const PERFORMANCE = {
  adapter: 'node-test',
  target: 'src/work.performance.test.mjs',
  name: 'measures work',
};
const CORRECTNESS = {
  adapter: 'node-test',
  target: 'src/work.test.mjs',
  name: 'does work',
};
const MANIFEST_SHA256 = 'c'.repeat(64);

test('current exact performance is characterized without an improvement claim', async () => {
  const result = await characterizePerformanceForReview(input(), dependencies());

  assert.equal(result.status, 'profiled');
  assert.equal(result.observed.sample_policy.samples, 2);
  assert.equal(result.observed.wall_time_ms.median, 12);
  assert.equal(result.observed.history.persistence.status, 'recorded');
  assert.equal(result.inferred.diagnosis.kind, 'application_cpu_hotspot');
  assert.equal(result.inferred.candidate.source.file, 'src/work.mjs');
  assert.match(result.unverified.join(' '), /not an improvement or regression verdict/);
});

test('changed binding stops before profile execution', async () => {
  let profiled = false;
  const result = await characterizePerformanceForReview(input(), {
    ...dependencies(),
    loadFlowContract: async () => ({
      present: true,
      manifest_sha256: MANIFEST_SHA256,
      bindings: [],
    }),
    profilePerformance: async () => {
      profiled = true;
      return capsule();
    },
  });

  assert.equal(result.status, 'no_confidence');
  assert.equal(result.reason, 'performance_binding_changed');
  assert.equal(profiled, false);
});

test('snapshot mutation invalidates completed characterization', async () => {
  let inspected = 0;
  const result = await characterizePerformanceForReview(input(), {
    ...dependencies(),
    inspectSnapshot: async () => {
      inspected += 1;
      return inspected === 1 ? SUBJECT : { ...SUBJECT, source_snapshot_sha256: 'd'.repeat(64) };
    },
  });

  assert.equal(result.status, 'no_confidence');
  assert.equal(result.reason, 'source_changed_during_performance');
  assert.equal(result.inferred, null);
});

test('a non-actionable diagnosis withholds its lower-level source candidate', async () => {
  const result = await characterizePerformanceForReview(input(), {
    ...dependencies(),
    diagnosePerformance: async () => ({
      ...diagnosis(),
      diagnosis: {
        kind: 'startup_dominated_workload',
        summary: 'Runner startup dominates.',
        confidence: { level: 'high', basis: 'deterministic_evidence_rules' },
        evidence_ids: ['evidence-1'],
      },
      next_action: { kind: 'design_representative_workload', evidence_ids: ['evidence-1'] },
    }),
  });

  assert.equal(result.status, 'profiled');
  assert.equal(result.inferred.candidate, null);
  assert.equal(result.inferred.next_action.kind, 'design_representative_workload');
});

test('a prior characterization is projected only as sequential screening', async () => {
  const result = await characterizePerformanceForReview(input(), {
    ...dependencies(),
    retainHistory: async () => ({
      persistence: { status: 'recorded', current: { source_snapshot_sha256: 'b'.repeat(64) } },
      predecessor: { source_snapshot_sha256: 'd'.repeat(64) },
      screening: {
        evidence_mode: 'sequential_historical',
        observed: [{ kind: 'wall_time_comparison' }],
        verdict: { status: 'confirmed', reason: 'Material movement was observed.' },
        decisions: { shipping_recommended: false },
        next_action: 'run_interleaved_paired_verification',
      },
      diagnostics: { records_considered: 1, invalid_records: 0 },
      unverified: ['This is a sequential historical screen.'],
    }),
  });

  assert.equal(result.inferred.sequential_screening.evidence_mode, 'sequential_historical');
  assert.equal(result.inferred.sequential_screening.decisions.shipping_recommended, false);
  assert.match(result.unverified.join(' '), /cannot authorize an improvement verdict/);
});

test('accepted paired evidence replaces the sequential no-claim boundary', async () => {
  const result = await characterizePerformanceForReview(input(), {
    ...dependencies(),
    retainHistory: async () => ({
      persistence: { status: 'recorded' },
      predecessor: { source_snapshot_sha256: 'd'.repeat(64) },
      screening: { next_action: 'run_interleaved_paired_verification' },
      diagnostics: {},
      unverified: ['Sequential only.'],
    }),
    attemptPairedReview: async () => ({
      status: 'accepted',
      reason: 'paired_local_optimization_accepted',
      observed: {
        paired: { evidence_mode: 'paired_interleaved' },
        artifact: { sha256: 'e'.repeat(64) },
      },
      inferred: {
        verdict: { status: 'confirmed' },
        decisions: { shipping_recommended: true },
      },
      limitations: ['Exact local flow only.'],
      unverified: ['Production remains unverified.'],
    }),
  });

  assert.equal(result.observed.paired_verification.status, 'accepted');
  assert.equal(result.inferred.paired_verification.decisions.shipping_recommended, true);
  assert.doesNotMatch(result.unverified.join(' '), /cannot authorize an improvement/);
  assert.match(result.unverified.join(' '), /Production remains unverified/);
});

test('automatic-pair blocker categories and next action survive characterization', async () => {
  const result = await characterizePerformanceForReview(input(), {
    ...dependencies(),
    retainHistory: async () => ({
      persistence: { status: 'recorded' },
      predecessor: { source_snapshot_sha256: 'd'.repeat(64) },
      screening: { next_action: 'run_interleaved_paired_verification' },
      diagnostics: {},
      unverified: ['Sequential only.'],
    }),
    attemptPairedReview: async () => ({
      status: 'no_confidence',
      reason: 'review_change_not_sealed_to_owned_sources',
      observed: {
        change_classification: {
          owned_source_files: ['src/work.mjs'],
          evaluator_files: ['codevetter.performance.json'],
          unrelated_files: [],
        },
      },
      inferred: {
        next_action: {
          kind: 'establish_evaluator_baseline',
          automated: false,
          repository_mutation_performed: false,
        },
      },
      limitations: ['Automatic pairing did not have sealed evaluator authority.'],
      unverified: ['No local optimization acceptance is available.'],
    }),
  });

  assert.equal(result.observed.paired_verification.status, 'no_confidence');
  assert.deepEqual(
    result.observed.paired_verification.observed.change_classification.evaluator_files,
    ['codevetter.performance.json']
  );
  assert.equal(
    result.inferred.paired_verification.next_action.kind,
    'establish_evaluator_baseline'
  );
  assert.equal(
    result.inferred.paired_verification.next_action.repository_mutation_performed,
    false
  );
});

test('history failure preserves current characterization with an explicit limitation', async () => {
  const result = await characterizePerformanceForReview(input(), {
    ...dependencies(),
    retainHistory: async () => {
      throw new Error('review performance history inventory exceeds bound');
    },
  });

  assert.equal(result.status, 'profiled');
  assert.equal(result.observed.history.persistence.status, 'unavailable');
  assert.equal(result.inferred.sequential_screening, null);
  assert.match(result.limitations.join(' '), /history was unavailable/);
});

function input() {
  return {
    repositoryRoot: '/fixture',
    source: 'src/work.mjs',
    performanceScope: PERFORMANCE,
    correctnessScope: CORRECTNESS,
    manifestSha256: MANIFEST_SHA256,
    expectedSubject: SUBJECT,
  };
}

function dependencies() {
  return {
    inspectSnapshot: async () => SUBJECT,
    loadFlowContract: async () => ({
      present: true,
      manifest_sha256: MANIFEST_SHA256,
      bindings: [
        {
          sources: ['src/work.mjs'],
          performance: PERFORMANCE,
          correctness: CORRECTNESS,
          manifest_sha256: MANIFEST_SHA256,
        },
      ],
    }),
    profilePerformance: async () => capsule(),
    diagnosePerformance: async () => diagnosis(),
    retainHistory: async () => ({
      persistence: { status: 'recorded', current: { source_snapshot_sha256: 'b'.repeat(64) } },
      predecessor: null,
      screening: null,
      diagnostics: { records_considered: 0, invalid_records: 0 },
      unverified: ['No compatible prior snapshot was available.'],
    }),
    attemptPairedReview: async () => ({
      status: 'not_run',
      reason: 'sequential_screen_not_material',
      observed: null,
      inferred: null,
      limitations: [],
      unverified: ['No automatic interleaved paired verification was executed.'],
    }),
  };
}

function capsule() {
  return {
    subject: SUBJECT,
    scope: { target: PERFORMANCE.target, name: PERFORMANCE.name },
    verdict: { status: 'profiled', reason: 'Profiled exact flow.' },
    observed: {
      wall_time_ms: { count: 2, min: 11, median: 12, p95: 13, max: 13, spread_percent: 16.667 },
      peak_rss_bytes: {
        count: 3,
        min: 1_000,
        median: 1_100,
        p95: 1_200,
        max: 1_200,
        spread_percent: 18.182,
      },
      go_benchmarks: [],
      console_metrics: [],
      vitest_execution_share: null,
      hotspots: [
        {
          role: 'application',
          file: 'src/work.mjs',
          line: 1,
          function: 'work',
          self_time_ms: 10,
          sample_share: 0.5,
        },
      ],
    },
  };
}

function diagnosis() {
  return {
    diagnosis: {
      kind: 'application_cpu_hotspot',
      summary: 'The exact local flow spends material CPU in work.',
      confidence: 0.8,
      evidence_ids: ['evidence-1'],
    },
    next_action: { kind: 'optimize_one_candidate_then_compare', evidence_ids: ['evidence-1'] },
    limitations: ['Exact local flow only.'],
    tool_diagnosis: {
      findings: [
        {
          id: '1'.repeat(24),
          candidate_key: '2'.repeat(24),
          kind: 'application_cpu_hotspot',
          source: { file: 'src/work.mjs', line: 1, function: 'work' },
          observed: { self_time_ms: 10 },
          inference: { mechanism: 'repeatable_cpu_profile' },
          confidence: { level: 'high' },
          expected_effect: { kind: 'lower_cpu_time' },
          verification: { operation: 'compare_exact_flow' },
          unverified: ['Cause remains a hypothesis.'],
          eligible_for_experiment: true,
        },
      ],
    },
  };
}
