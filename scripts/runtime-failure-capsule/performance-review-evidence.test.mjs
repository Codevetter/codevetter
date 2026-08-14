import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PERFORMANCE_LAB_SCHEMA_VERSION } from './performance-lab-contracts.mjs';
import {
  PERFORMANCE_REVIEW_EVIDENCE_SCHEMA_VERSION,
  collectPerformanceReviewEvidence,
} from './performance-review-evidence.mjs';

const SUBJECT = {
  repository_revision: 'a'.repeat(40),
  source_snapshot_sha256: 'b'.repeat(64),
  dirty: true,
};
const MANIFEST_SHA256 = 'c'.repeat(64);

test('accepted digest-bound evidence becomes a compact review projection', async () => {
  const fixture = await acceptedFixture();
  const result = await collectPerformanceReviewEvidence(fixture.root, fixture.dependencies);

  assert.equal(result.schema_version, PERFORMANCE_REVIEW_EVIDENCE_SCHEMA_VERSION);
  assert.equal(result.status, 'qualified');
  assert.equal(result.observed.lab_id, 'accepted-flow');
  assert.equal(result.observed.candidate_source.file, 'src/work.js');
  assert.equal(result.observed.correctness_flow.current_status, 'passed');
  assert.equal(result.observed.performance_flow.name, 'does measured work');
  assert.deepEqual(result.observed.metric_summaries, [
    {
      kind: 'wall_time_comparison',
      metric: { baseline: 10, current: 7, delta: -3, delta_percent: -30 },
    },
  ]);
  assert.equal(result.inferred.status, 'accepted_local_optimization');
  assert.match(result.unverified[0], /Production impact/);
});

test('a tampered paired artifact cannot influence review', async () => {
  const fixture = await acceptedFixture();
  await writeFile(fixture.evidencePath, '{"tampered":true}\n');

  const result = await collectPerformanceReviewEvidence(fixture.root, fixture.dependencies);

  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'no_current_accepted_evidence');
  assert.equal(result.exclusions.evidence_mismatch, 1);
});

test('a stale source snapshot produces no metrics and a non-accepted receipt is excluded', async () => {
  const stale = await acceptedFixture({
    currentSubject: { ...SUBJECT, source_snapshot_sha256: 'd'.repeat(64) },
  });
  const staleResult = await collectPerformanceReviewEvidence(stale.root, stale.dependencies);
  assert.equal(staleResult.status, 'reverification_required');
  assert.equal(staleResult.plan.historical_evidence.performance_claim_status, 'stale_excluded');
  assert.equal(staleResult.plan.correctness_scope.name, 'does work');
  assert.equal(staleResult.plan.performance_flow.name, 'does measured work');
  assert.equal(staleResult.observed, undefined);
  assert.equal(staleResult.diagnostics.excluded_before_selection.stale, 1);

  const rejected = await acceptedFixture({ accepted: false });
  const rejectedResult = await collectPerformanceReviewEvidence(
    rejected.root,
    rejected.dependencies
  );
  assert.equal(rejectedResult.status, 'unavailable');
  assert.equal(rejectedResult.exclusions.unaccepted, 1);
});

test('a changed repository correctness binding excludes accepted evidence', async () => {
  const fixture = await acceptedFixture({ manifestSha256: 'e'.repeat(64) });
  const result = await collectPerformanceReviewEvidence(fixture.root, fixture.dependencies);

  assert.equal(result.status, 'unavailable');
  assert.equal(result.exclusions.authority_mismatch, 1);
});

test('a source-owned manifest produces a cold-start correctness plan without metrics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-cold-review-'));
  await writeFile(
    join(root, 'codevetter.performance.json'),
    JSON.stringify({
      schema_version: 'codevetter-performance-flows/v1',
      flows: [
        {
          sources: ['src/work.js'],
          performance: {
            adapter: 'node-test',
            target: 'src/work.performance.test.js',
            name: 'does measured work',
          },
          correctness: {
            adapter: 'node-test',
            target: 'src/work.test.js',
            name: 'does work',
          },
        },
      ],
    })
  );

  const result = await collectPerformanceReviewEvidence(root, {
    reviewChangedFiles: ['src/work.js'],
    inspectSnapshot: async () => SUBJECT,
  });

  assert.equal(result.status, 'cold_start_correctness_required');
  assert.equal(result.plan.correctness_scope.name, 'does work');
  assert.equal(result.plan.performance_claim_status, 'not_measured');
  assert.equal(result.plan.candidate_source.file, 'src/work.js');
  assert.equal(result.observed, undefined);
});

test('ambiguous source ownership cannot select an arbitrary cold-start test', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-ambiguous-review-'));
  const flow = (name) => ({
    sources: ['src/work.js'],
    performance: {
      adapter: 'node-test',
      target: `src/${name}.performance.test.js`,
      name: `${name} performance`,
    },
    correctness: {
      adapter: 'node-test',
      target: `src/${name}.test.js`,
      name: `${name} correctness`,
    },
  });
  await writeFile(
    join(root, 'codevetter.performance.json'),
    JSON.stringify({
      schema_version: 'codevetter-performance-flows/v1',
      flows: [flow('first'), flow('second')],
    })
  );

  const result = await collectPerformanceReviewEvidence(root, {
    reviewChangedFiles: ['src/work.js'],
    inspectSnapshot: async () => SUBJECT,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'multiple_relevant_correctness_bindings');
  assert.equal(result.considered_bindings, 2);
});

test('an unrelated accepted receipt does not block a relevant cold-start binding', async () => {
  const fixture = await acceptedFixture();
  fixture.dependencies.reviewChangedFiles = ['src/other.js'];
  fixture.dependencies.loadFlowContract = async () => ({
    present: true,
    manifest_sha256: MANIFEST_SHA256,
    bindings: [
      {
        sources: ['src/other.js'],
        performance: {
          adapter: 'node-test',
          target: 'src/other.performance.test.js',
          name: 'measures other',
        },
        correctness: {
          adapter: 'node-test',
          target: 'src/other.test.js',
          name: 'checks other',
        },
        manifest_sha256: MANIFEST_SHA256,
      },
    ],
  });

  const result = await collectPerformanceReviewEvidence(fixture.root, fixture.dependencies);

  assert.equal(result.status, 'cold_start_correctness_required');
  assert.equal(result.plan.candidate_source.file, 'src/other.js');
  assert.equal(result.plan.correctness_scope.name, 'checks other');
});

async function acceptedFixture({
  currentSubject = SUBJECT,
  accepted = true,
  manifestSha256 = MANIFEST_SHA256,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-review-evidence-'));
  const labDirectory = join(root, '.codevetter', 'performance-labs', 'accepted-flow');
  await mkdir(labDirectory, { recursive: true });
  const paired = pairedVerification();
  const pairedBytes = `${JSON.stringify(paired)}\n`;
  const evidencePath = join(labDirectory, 'paired-verification.json');
  await writeFile(evidencePath, pairedBytes);
  const evidence = {
    path: '.codevetter/performance-labs/accepted-flow/paired-verification.json',
    sha256: sha256(pairedBytes),
    bytes: Buffer.byteLength(pairedBytes),
  };
  const receipt = acceptedReceipt(paired, evidence, accepted);
  await writeFile(join(labDirectory, 'receipt.json'), `${JSON.stringify(receipt)}\n`);
  return {
    root,
    evidencePath,
    dependencies: {
      inspectSnapshot: async () => currentSubject,
      loadFlowContract: async () => ({
        present: true,
        manifest_sha256: manifestSha256,
      }),
    },
  };
}

function acceptedReceipt(paired, evidence, accepted) {
  return {
    schema_version: PERFORMANCE_LAB_SCHEMA_VERSION,
    lab_id: 'accepted-flow',
    state: accepted ? 'completed' : 'stopped',
    subject: SUBJECT,
    policy: {
      max_steps: 1,
      samples: 10,
      warmups: 0,
      timeout_ms: 1_000,
      excluded_finding_ids: [],
      excluded_candidate_keys: [],
    },
    lifecycle: {
      started_at: '2026-08-13T00:00:00.000Z',
      completed_at: '2026-08-13T00:00:01.000Z',
    },
    initial_summary: null,
    final_summary: null,
    steps: [],
    continuation: {
      predecessor_lab_id: 'baseline-flow',
      predecessor_receipt_sha256: 'f'.repeat(64),
      baseline_run_id: 'baseline-flow-s1',
      baseline_subject: {
        repository_revision: SUBJECT.repository_revision,
        source_snapshot_sha256: '0'.repeat(64),
      },
      candidate: {
        id: '1'.repeat(24),
        candidate_key: '2'.repeat(24),
        kind: 'application_cpu_hotspot',
        source: {
          file: 'src/work.js',
          line: 12,
          function: 'work',
          provenance: 'cpu_profile',
        },
      },
    },
    screening: null,
    acceptance: {
      change_cost: {
        observed: {
          complete: true,
          files_changed: 1,
          changed_files: ['src/work.js'],
          lines_added: 4,
          lines_removed: 2,
          gross_lines_changed: 6,
          net_lines_changed: 2,
          untracked_files: [],
          binary_files: [],
          production_dependencies_added: [],
        },
        policy: {
          max_files_changed: 3,
          max_lines_added: 160,
          max_gross_lines_changed: 200,
          max_production_dependencies_added: 0,
        },
        violations: [],
        outside_boundary_files: [],
      },
      correctness: {
        scope: { adapter: 'node-test', target: 'src/work.test.js', name: 'does work' },
        binding: { source: 'repository_manifest', manifest_sha256: MANIFEST_SHA256 },
        incumbent: { status: 'passed' },
        current: { status: 'passed' },
      },
      paired_verification: {
        evidence,
        summary: Object.fromEntries(
          [
            'subject',
            'adapter',
            'scope',
            'observed',
            'limitations',
            'decisions',
            'verdict',
            'evidence_mode',
            'workload_identity',
          ].map((field) => [field, paired[field]])
        ),
      },
      verdict: {
        status: accepted ? 'accepted' : 'rejected',
        reason: accepted ? 'Correct and materially faster.' : 'Candidate regressed.',
      },
    },
    stop: {
      kind: accepted ? 'candidate_accepted' : 'candidate_rejected',
      reason: accepted ? 'Correct and materially faster.' : 'Candidate regressed.',
      next_action_kind: accepted ? 'retain_source_candidate' : 'revise_or_revert_source_candidate',
    },
    limitations: [],
  };
}

function pairedVerification() {
  const baseline = performanceCapsule(10, '0'.repeat(64));
  const current = performanceCapsule(7, SUBJECT.source_snapshot_sha256);
  return {
    schema_version: 'runtime-optimization-verification/v1',
    subject: {
      baseline_revision: SUBJECT.repository_revision,
      current_revision: SUBJECT.repository_revision,
    },
    adapter: { kind: 'node-test' },
    scope: { target: 'src/work.test.js', name: 'does measured work' },
    observed: [
      {
        kind: 'wall_time_comparison',
        metric: { baseline: 10, current: 7, delta: -3, delta_percent: -30 },
      },
    ],
    decisions: {
      mechanically_confirmed: true,
      materially_useful: true,
      shipping_recommended: true,
    },
    verdict: { status: 'confirmed', reason: 'Paired evidence passed.' },
    baseline_capsule: baseline,
    current_capsule: current,
    limitations: ['Exact local test only.'],
    evidence_mode: 'paired_interleaved',
    workload_identity: { algorithm: 'sha256', digest: '3'.repeat(64) },
  };
}

function performanceCapsule(median, sourceSnapshotSha256) {
  return {
    schema_version: 'runtime-performance-capsule/v1',
    subject: {
      repository_revision: SUBJECT.repository_revision,
      source_snapshot_sha256: sourceSnapshotSha256,
      dirty: true,
    },
    adapter: {
      kind: 'node-test',
      executable_identity: 'local:node',
      arguments: [],
      working_directory: '.',
    },
    scope: { target: 'src/work.test.js', name: 'does measured work' },
    sample_policy: { samples: 10, warmups: 0 },
    observed: {
      executions: Array.from({ length: 10 }, () => ({ wall_time_ms: median })),
      wall_time_ms: {
        count: 10,
        min: median,
        median,
        p95: median,
        max: median,
        spread_percent: 0,
      },
      hotspots: [],
      go_benchmarks: [],
      vitest_tests: [],
      vitest_execution_share: null,
      console_metrics: [],
    },
    findings: [],
    relationships: [],
    unverified: [],
    comparison: null,
    limitations: [],
    capture: {},
    verdict: { status: 'profiled', reason: 'Profiled.' },
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
