import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_OPTIMIZATION_LIMITS,
  assertBrowserOptimizationPlan,
  assertBrowserOptimizationPolicy,
  assertContainedOptionalPath,
  browserOptimizationId,
  createBrowserOptimizationPlan,
} from './browser-optimization-contracts.mjs';

test('browser optimization plan accepts one closed bounded flow queue', () => {
  const plan = validPlan();
  assert.equal(assertBrowserOptimizationPlan(plan), plan);
  assert.equal(plan.queue[0].rank, 1);
});

test('browser optimization policy applies closed defaults and bounds', () => {
  assert.deepEqual(assertBrowserOptimizationPolicy(), {
    max_experiments: 8,
    max_elapsed_minutes: 120,
    max_failures: 3,
  });
  assert.throws(() => assertBrowserOptimizationPolicy({ max_experiments: 17 }), /between 1 and 16/);
  assert.throws(() => assertBrowserOptimizationPolicy({ command: 'npm test' }), /unknown field/);
});

test('browser optimization paths reject escaping and secret-like inputs', () => {
  for (const value of ['../vite.config.ts', '/tmp/dist', '.env.local', 'keys/private.pem']) {
    assert.throws(() => assertContainedOptionalPath(value), /contained relative path/);
  }
  assert.equal(assertContainedOptionalPath('dist/assets'), 'dist/assets');
});

test('browser optimization contracts reject malformed, oversized, and stale-shaped plans', () => {
  const malformed = structuredClone(validPlan());
  malformed.queue[0].command = 'pnpm build';
  assert.throws(() => assertBrowserOptimizationPlan(malformed), /unknown field/);

  const oversized = structuredClone(validPlan());
  oversized.queue = Array.from(
    { length: BROWSER_OPTIMIZATION_LIMITS.experiments + 1 },
    (_, index) => ({ ...oversized.queue[0], experiment_id: browserOptimizationId(`e-${index}`) })
  );
  assert.throws(() => assertBrowserOptimizationPlan(oversized), /at most 8 entries/);

  const stale = structuredClone(validPlan());
  stale.subject.source_snapshot_sha256 = 'a'.repeat(64);
  assert.throws(() => assertBrowserOptimizationPlan(stale), /planner_digest is invalid/);
});

function validPlan() {
  const observationId = browserOptimizationId('observation');
  const causeId = browserOptimizationId('cause');
  return createBrowserOptimizationPlan({
    loop_id: 'anime-home',
    generation: 1,
    subject: {
      repository_revision: 'a'.repeat(40),
      source_snapshot_sha256: 'b'.repeat(64),
      dirty: true,
    },
    flow: {
      candidate_id: 'c'.repeat(16),
      capture_id: 'anime-home-capture',
      target: 'e2e/home.spec.ts',
      name: 'loads home',
      project: 'desktop',
    },
    policy: assertBrowserOptimizationPolicy(),
    evidence: {
      families: [
        { name: 'browser_timing', state: 'observed', reason: null },
        { name: 'dependencies', state: 'observed', reason: null },
      ],
      observations: [
        {
          observation_id: observationId,
          family: 'dependencies',
          kind: 'chunk_rule_match',
          source: 'vite.config.ts',
          metric: { affected_bytes: 100_000 },
          provenance: 'static_vite_manual_chunks_rule',
          verified: true,
        },
      ],
    },
    cause_groups: [
      {
        cause_id: causeId,
        mechanism: 'broad_chunk_rule',
        source: 'vite.config.ts',
        observation_ids: [observationId],
        affected_bytes: 100_000,
        runtime_share: null,
      },
    ],
    queue: [
      {
        experiment_id: browserOptimizationId('experiment'),
        cause_id: causeId,
        rank: 1,
        hypothesis: 'Narrow the framework chunk predicate.',
        confidence_basis: 'Observed initial-route package matched the framework rule.',
        allowed_files: ['vite.config.ts'],
        predicted_metric: { name: 'initial_route_javascript_bytes', direction: 'decrease' },
        correctness_scope: null,
        performance_scope: {
          adapter: 'playwright',
          target: 'e2e/home.spec.ts',
          name: 'loads home',
          project: 'desktop',
        },
        rejection_condition: 'Reject unless paired bytes decrease without a browser regression.',
        evidence_ids: [observationId],
        limitations: [],
      },
    ],
    created_at: '2026-08-14T00:00:00.000Z',
    limitations: [],
  });
}
