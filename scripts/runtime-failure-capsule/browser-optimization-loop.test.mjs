import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertBrowserOptimizationPolicy,
  browserOptimizationId,
  createBrowserOptimizationPlan,
} from './browser-optimization-contracts.mjs';
import { createBrowserOptimizationLoopService } from './browser-optimization-loop.mjs';

test('loop records a rejection, blocks until incumbent restoration, then resumes the next experiment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-loop-'));
  let current = subject('b');
  let campaignCalls = 0;
  try {
    const service = await createBrowserOptimizationLoopService(root, {
      planner: async (_root, input) => plan({ loopId: input.loop_id, subjectValue: subject('b') }),
      inspectSubject: async () => current,
      campaignService: {
        screen: async () => {
          campaignCalls += 1;
          return campaignResult('discard', 'No material improvement.', 'd');
        },
      },
      now: () => new Date('2026-08-14T00:01:00.000Z'),
    });
    const initial = await service.plan(planInput('reject-loop'));
    assert.equal(initial.state, 'active');
    assert.equal(initial.next_experiment.rank, 1);

    current = { ...subject('c'), changed_files: ['vite.config.ts'] };
    const rejected = await service.evaluate({
      loop_id: 'reject-loop',
      incumbent_repository: '/tmp/incumbent',
    });
    assert.equal(campaignCalls, 1);
    assert.equal(rejected.state, 'blocked_on_host');
    assert.equal(rejected.rejected_experiments.length, 1);
    assert.equal(rejected.coverage.source_restoration_required, true);

    current = subject('b');
    const resumedService = await createBrowserOptimizationLoopService(root, {
      inspectSubject: async () => current,
      now: () => new Date('2026-08-14T00:02:00.000Z'),
    });
    const resumed = await resumedService.next({ loop_id: 'reject-loop' });
    assert.equal(resumed.state, 'active');
    assert.equal(resumed.next_experiment.rank, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loop rejects out-of-bound source changes before campaign execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-loop-boundary-'));
  let current = subject('b');
  let called = false;
  try {
    const service = await createBrowserOptimizationLoopService(root, {
      planner: async (_root, input) => plan({ loopId: input.loop_id, subjectValue: subject('b') }),
      inspectSubject: async () => current,
      campaignService: {
        screen: async () => {
          called = true;
          return campaignResult('discard', 'unused', 'e');
        },
      },
    });
    await service.plan(planInput('boundary-loop'));
    current = { ...subject('c'), changed_files: ['e2e/home.spec.ts'] };
    await assert.rejects(
      service.evaluate({
        loop_id: 'boundary-loop',
        incumbent_repository: '/tmp/incumbent',
      }),
      /outside its boundary/
    );
    assert.equal(called, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loop promotes a promising candidate and replans from the paired current capture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-loop-keep-'));
  let current = subject('b');
  const calls = [];
  try {
    const service = await createBrowserOptimizationLoopService(root, {
      planner: async (_root, input) =>
        plan({
          loopId: input.loop_id,
          generation: input.generation ?? 1,
          captureId: input.capture_id,
          subjectValue: input.generation === 2 ? subject('c') : subject('b'),
          empty: input.generation === 2,
        }),
      inspectSubject: async () => current,
      campaignService: {
        screen: async () => {
          calls.push('screen');
          return campaignResult('promising', 'Candidate passed screening.', 'f');
        },
        promote: async () => {
          calls.push('promote');
          return campaignResult('keep', 'Candidate passed paired promotion.', '1');
        },
      },
      listCaptures: async () => [
        {
          capture_id: 'paired-current-capture',
          state: 'succeeded',
          subject: subject('c'),
          scope: {
            target: 'e2e/home.spec.ts',
            name: 'loads home',
            browser_profile: { project_name: 'desktop' },
          },
        },
      ],
      now: () => new Date('2026-08-14T00:03:00.000Z'),
    });
    await service.plan(planInput('keep-loop'));
    current = { ...subject('c'), changed_files: ['vite.config.ts'] };
    const kept = await service.evaluate({
      loop_id: 'keep-loop',
      incumbent_repository: '/tmp/incumbent',
      build_directory: 'dist',
    });
    assert.deepEqual(calls, ['screen', 'promote']);
    assert.equal(kept.generation, 2);
    assert.equal(kept.state, 'queue_exhausted');
    assert.equal(kept.verified_improvements.length, 1);
    assert.equal(kept.incumbent.source_snapshot_sha256, 'c'.repeat(64));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loop supplies source-attested initial-route movement to campaign acceptance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-artifact-loop-'));
  let current = subject('b');
  let acceptedArtifact = null;
  try {
    const service = await createBrowserOptimizationLoopService(root, {
      planner: async (_root, input) =>
        plan({
          loopId: input.loop_id,
          generation: input.generation ?? 1,
          captureId: input.capture_id,
          subjectValue: input.generation === 2 ? subject('c') : subject('b'),
          empty: input.generation === 2,
          artifact: input.generation !== 2,
        }),
      inspectSubject: async () => current,
      inspectDependencies: async () => ({
        artifact: artifact(100_000, 30_000, '2'),
      }),
      campaignService: {
        screen: async (input) => {
          acceptedArtifact = input.artifact_verification;
          return campaignResult('promising', 'Attested artifact passed screening.', '3');
        },
        promote: async () => campaignResult('keep', 'Attested artifact passed promotion.', '4'),
      },
      listCaptures: async () => [
        {
          capture_id: 'artifact-current-capture',
          state: 'succeeded',
          subject: subject('c'),
          scope: {
            target: 'e2e/home.spec.ts',
            name: 'loads home',
            browser_profile: { project_name: 'desktop' },
          },
        },
      ],
      now: () => new Date('2026-08-14T00:04:00.000Z'),
    });
    await service.plan(planInput('artifact-loop'));
    current = { ...subject('c'), changed_files: ['vite.config.ts'] };
    const result = await service.evaluate({
      loop_id: 'artifact-loop',
      incumbent_repository: '/tmp/incumbent',
      build_directory: 'dist',
      artifact_attestation: {
        source_snapshot_sha256: 'c'.repeat(64),
        artifact_sha256: '2'.repeat(64),
      },
    });
    assert.equal(acceptedArtifact.verdict.status, 'confirmed');
    assert.equal(result.verified_improvements.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function planInput(loopId) {
  return {
    loop_id: loopId,
    campaign_directory: `.codevetter/optimization-campaigns/${loopId}`,
    capture_id: 'fixture-home-capture',
    policy: { max_experiments: 4, max_elapsed_minutes: 60, max_failures: 3 },
  };
}

function plan({
  loopId = 'fixture-home',
  generation = 1,
  captureId = 'fixture-home-capture',
  subjectValue,
  empty = false,
  artifact: includeArtifact = false,
}) {
  const observationId = browserOptimizationId('loop-observation');
  const artifactObservationId = browserOptimizationId('loop-artifact-observation');
  const causes = [browserOptimizationId('loop-cause-1'), browserOptimizationId('loop-cause-2')];
  const queue = empty
    ? []
    : causes.map((causeId, index) => ({
        experiment_id: browserOptimizationId(`loop-experiment-${index}`),
        cause_id: causeId,
        rank: index + 1,
        hypothesis: index === 0 ? 'Narrow the chunk predicate.' : 'Reduce component work.',
        confidence_basis: 'Fixture evidence.',
        allowed_files: [index === 0 ? 'vite.config.ts' : 'src/HomePage.tsx'],
        predicted_metric: {
          name:
            includeArtifact && index === 0
              ? 'initial_route_javascript_bytes'
              : 'same_flow_runtime_candidate',
          direction: 'decrease',
        },
        correctness_scope: null,
        performance_scope: {
          adapter: 'playwright',
          target: 'e2e/home.spec.ts',
          name: 'loads home',
          project: 'desktop',
        },
        rejection_condition: 'Reject on regression.',
        evidence_ids: [observationId],
        limitations: [],
      }));
  return createBrowserOptimizationPlan({
    loop_id: loopId,
    generation,
    subject: {
      repository_revision: subjectValue.repository_revision,
      source_snapshot_sha256: subjectValue.source_snapshot_sha256,
      dirty: subjectValue.dirty,
    },
    flow: {
      candidate_id: 'a'.repeat(16),
      capture_id: captureId,
      target: 'e2e/home.spec.ts',
      name: 'loads home',
      project: 'desktop',
    },
    policy: assertBrowserOptimizationPolicy({
      max_experiments: 4,
      max_elapsed_minutes: 60,
      max_failures: 3,
    }),
    evidence: {
      families: [{ name: 'dependencies', state: 'observed', reason: null }],
      observations: [
        {
          observation_id: observationId,
          family: 'dependencies',
          kind: 'chunk_rule_match',
          source: 'vite.config.ts',
          metric: { bytes: 100 },
          provenance: 'fixture',
          verified: true,
        },
        ...(includeArtifact
          ? [
              {
                observation_id: artifactObservationId,
                family: 'build_artifact',
                kind: 'initial_route_artifact_summary',
                source: null,
                metric: artifact(300_000, 100_000, '1'),
                provenance: 'fixture_attested_artifact',
                verified: true,
              },
            ]
          : []),
      ],
    },
    cause_groups: empty
      ? []
      : causes.map((causeId) => ({
          cause_id: causeId,
          mechanism: 'fixture',
          source: 'vite.config.ts',
          observation_ids: [observationId],
          affected_bytes: 100,
          runtime_share: null,
        })),
    queue,
    created_at: '2026-08-14T00:00:00.000Z',
    limitations: ['Fixture plan.'],
  });
}

function artifact(totalBytes, totalGzipBytes, digestCharacter) {
  return {
    state: 'observed',
    verified: true,
    total_bytes: totalBytes,
    total_gzip_bytes: totalGzipBytes,
    artifact_sha256: digestCharacter.repeat(64),
  };
}

function subject(character) {
  return {
    repository_revision: 'a'.repeat(40),
    source_snapshot_sha256: character.repeat(64),
    dirty: character !== 'b',
    changed_files: [],
  };
}

function campaignResult(status, reason, digestCharacter) {
  return {
    record: {
      decision: { status, reason },
      record_digest: digestCharacter.repeat(64),
    },
  };
}
