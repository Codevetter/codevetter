import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertCandidateChallenge,
  assertContributionReceipt,
  deriveContributionStatus,
} from './contribution-contracts.mjs';
import { createOptimizationContributionService, normalizeGitHubEvidence } from './contribution.mjs';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const OLD_HEAD = 'c'.repeat(40);
const DIFF = 'd'.repeat(64);
const RECORD = 'e'.repeat(64);
const WORKLOAD = 'f'.repeat(64);

test('candidate challenge records diff risk and requires an explicit bounded reason', async (context) => {
  const fixture = await contributionFixture(context);
  const service = await createOptimizationContributionService(fixture.root, fixture.dependencies);

  const unqualified = await service.challenge({
    campaign_directory: fixture.campaignDirectory,
    selected_sequence: 1,
  });
  assert.equal(unqualified.challenge.patch_quality.status, 'no_confidence');
  assert.deepEqual(
    unqualified.challenge.diff_observations.risk_signals.map((signal) => signal.kind),
    ['mutable_state', 'cleanup_path', 'fallback_path', 'new_branch']
  );
  assertCandidateChallenge(unqualified.challenge);

  fixture.dependencies.now = () => new Date('2026-08-10T00:00:01.000Z');
  const qualified = await service.challenge({
    campaign_directory: fixture.campaignDirectory,
    selected_sequence: 1,
    simpler_not_applicable_reason:
      'The direct own-property lookup adds no cache; the branch preserves the empty-table fast path.',
  });
  assert.equal(qualified.challenge.patch_quality.status, 'retained_with_justification');
  assert.match(qualified.path, /challenge-b{12}-[0-9a-f]{12}\.json$/);
});

test('Marked-shaped challenge selects the simpler qualified candidate within tolerance', async (context) => {
  const fixture = await contributionFixture(context, {
    includeComparison: true,
    selectedSimpler: true,
  });
  const service = await createOptimizationContributionService(fixture.root, fixture.dependencies);
  const result = await service.challenge({
    campaign_directory: fixture.campaignDirectory,
    selected_sequence: 1,
    comparison_sequence: 2,
  });
  assert.equal(result.challenge.patch_quality.status, 'simpler_candidate_selected');
  assert.equal(result.challenge.candidate.complexity.added_lines, 4);
  assert.equal(result.challenge.comparison.complexity.added_lines, 12);
  assert.equal(result.challenge.candidate.control_metrics.length, 1);
});

test('candidate challenge observes class state, public signatures, and dependency manifests', async (context) => {
  const fixture = await contributionFixture(context);
  fixture.dependencies.inspectRepositoryState = async () => ({
    revision: HEAD,
    diff_digest: DIFF,
    changed_files: ['src/Lexer.ts', 'package.json'],
  });
  fixture.dependencies.readCandidateDiff = async () =>
    '+ private links = new Map();\n+ export function parse() {}\n';
  const service = await createOptimizationContributionService(fixture.root, fixture.dependencies);
  const result = await service.challenge({
    campaign_directory: fixture.campaignDirectory,
    selected_sequence: 1,
    simpler_not_applicable_reason:
      'The changed public surface and dependency manifest were reviewed.',
  });
  assert.deepEqual(
    result.challenge.diff_observations.risk_signals.map((signal) => signal.kind),
    ['class_member_state', 'public_signature', 'dependency_manifest']
  );
});

test('candidate challenge rejects a simpler target candidate when its control exceeds tolerance', async (context) => {
  const fixture = await contributionFixture(context, {
    includeComparison: true,
    selectedSimpler: true,
  });
  fixture.evidence.get(1).verification.observed[0].points[0].current = 1.1;
  const service = await createOptimizationContributionService(fixture.root, fixture.dependencies);
  const result = await service.challenge({
    campaign_directory: fixture.campaignDirectory,
    selected_sequence: 1,
    comparison_sequence: 2,
  });
  assert.equal(result.challenge.patch_quality.status, 'no_confidence');
  assert.match(result.challenge.patch_quality.reason, /tolerance/);
});

test('qualified comparison rejects a more complex candidate inside the same workload', async (context) => {
  const fixture = await contributionFixture(context, { includeComparison: true });
  const service = await createOptimizationContributionService(fixture.root, fixture.dependencies);
  const result = await service.challenge({
    campaign_directory: fixture.campaignDirectory,
    selected_sequence: 1,
    comparison_sequence: 2,
  });
  assert.equal(result.challenge.patch_quality.status, 'no_confidence');
  assert.match(result.challenge.patch_quality.reason, /simpler/);
});

test('candidate challenge refuses a working-tree-only candidate that has no exact PR revision', async (context) => {
  const fixture = await contributionFixture(context);
  fixture.dependencies.inspectCandidateCommit = async () => ({
    clean: false,
    changed_files: ['src/Lexer.ts'],
  });
  const service = await createOptimizationContributionService(fixture.root, fixture.dependencies);
  await assert.rejects(
    service.challenge({
      campaign_directory: fixture.campaignDirectory,
      selected_sequence: 1,
      simpler_not_applicable_reason: 'No simpler candidate is applicable.',
    }),
    /must be committed before challenge/
  );
});

test('contribution receipt keeps review, approval, T-Rex, and head gates independent', async (context) => {
  const fixture = await contributionFixture(context);
  let github = githubEvidence({
    checks: [{ name: 'test', status: 'completed', conclusion: 'action_required' }],
    threads: [
      {
        resolved: false,
        outdated: false,
        author: 'maintainer',
        path: 'src/Lexer.ts',
        line: 42,
        body: 'Use existing state.',
      },
      {
        resolved: false,
        outdated: true,
        author: 'maintainer',
        path: 'src/Lexer.ts',
        body: 'Old comment.',
      },
      {
        resolved: true,
        outdated: false,
        author: 'maintainer',
        path: 'src/Lexer.ts',
        body: 'Resolved comment.',
      },
    ],
  });
  const dependencies = { ...fixture.dependencies, githubInspector: async () => github };
  const service = await createOptimizationContributionService(fixture.root, dependencies);
  const challenged = await service.challenge({
    campaign_directory: fixture.campaignDirectory,
    selected_sequence: 1,
    simpler_not_applicable_reason: 'No additional state or fallback is introduced.',
  });
  const trexPath = 'artifacts/trex-receipt.json';
  await mkdir(join(fixture.root, 'artifacts'));
  await writeFile(
    join(fixture.root, trexPath),
    JSON.stringify({
      schema_version: 1,
      run_id: 'trex-preview-fixture',
      source: { head_sha: HEAD },
      preview: { status: 'verified' },
      verdict: 'passed_with_limits',
      summary: 'Selected browser flow passed.',
      limitations: ['Coverage remains bounded.'],
    })
  );
  const first = await service.inspect({
    campaign_directory: fixture.campaignDirectory,
    challenge_path: challenged.path,
    pull_request_url: 'https://github.com/markedjs/marked/pull/4048',
    trex_policy: 'required',
    trex_receipt: trexPath,
  });
  assertContributionReceipt(first.receipt);
  assert.equal(first.receipt.gates.performance.status, 'confirmed');
  assert.equal(first.receipt.gates.trex.status, 'passed_with_limits');
  assert.equal(first.receipt.gates.reviews.status, 'action_required');
  assert.equal(first.receipt.gates.reviews.current_threads, 1);
  assert.equal(first.receipt.gates.reviews.outdated_threads, 1);
  assert.equal(first.receipt.gates.reviews.resolved_threads, 1);
  assert.equal(
    first.receipt.gates.reviews.observations.find(
      (observation) => observation.kind === 'thread' && !observation.outdated
    ).line,
    42
  );
  assert.equal(first.receipt.gates.approvals.status, 'not_observed');
  assert.equal(first.receipt.gates.checks.status, 'approval_required');
  assert.equal(first.receipt.status, 'review_action_required');
  assert.equal(first.publication.status, 'current');
  assert.equal(first.publication.source_receipt_digest, first.receipt.receipt_digest);

  github = {
    ...githubEvidence(),
    url: 'https://github.com/example/other/pull/1',
    repository: 'example/other',
    number: 1,
  };
  await assert.rejects(
    service.refresh({
      campaign_directory: fixture.campaignDirectory,
      challenge_path: challenged.path,
      pull_request_url: 'https://github.com/example/other/pull/1',
      trex_policy: 'required',
      trex_receipt: trexPath,
    }),
    /different pull request/
  );

  github = githubEvidence({
    checks: [{ name: 'test', status: 'completed', conclusion: 'success' }],
    threads: [
      {
        resolved: false,
        outdated: true,
        author: 'maintainer',
        path: 'src/Lexer.ts',
        body: 'Old comment.',
      },
    ],
  });
  dependencies.now = () => new Date('2026-08-10T00:00:02.000Z');
  const refreshed = await service.refresh({
    campaign_directory: fixture.campaignDirectory,
    challenge_path: challenged.path,
    pull_request_url: 'https://github.com/markedjs/marked/pull/4048',
    trex_policy: 'required',
    trex_receipt: trexPath,
  });
  assert.equal(refreshed.receipt.status, 'waiting_for_maintainer');
  assert.equal(refreshed.receipt.gates.reviews.status, 'clear');
  assert.equal(refreshed.receipt.previous_receipt_digest, first.receipt.receipt_digest);
  const ledger = await readFile(join(fixture.root, refreshed.receipt_path), 'utf8');
  assert.equal(ledger.trim().split('\n').length, 2);
});

test('Marked-shaped lifecycle invalidates publication and learns from revised feedback', async (context) => {
  const fixture = await contributionFixture(context, { includeComparison: true });
  fixture.records[1].repository.revision = OLD_HEAD;
  fixture.records[2].repository.revision = HEAD;
  fixture.records[2].hypothesis = 'Replace duplicated lexer state with direct membership.';
  let repositoryRevision = OLD_HEAD;
  let diff = '+ private links = new Map();\n+ try { if (ready) work(); } finally { fallback(); }\n';
  let github = githubEvidence({
    head: OLD_HEAD,
    threads: [
      {
        resolved: false,
        outdated: false,
        author: 'maintainer',
        path: 'src/Lexer.ts',
        line: 42,
        body: 'Use the existing links object directly.',
      },
    ],
  });
  const dependencies = {
    ...fixture.dependencies,
    inspectRepositoryState: async () => ({
      revision: repositoryRevision,
      diff_digest: DIFF,
      changed_files: ['src/Lexer.ts'],
    }),
    readCandidateDiff: async () => diff,
    githubInspector: async () => github,
  };
  const service = await createOptimizationContributionService(fixture.root, dependencies);
  const complex = await service.challenge({
    campaign_directory: fixture.campaignDirectory,
    selected_sequence: 1,
    simpler_not_applicable_reason:
      'The first candidate preserves the old fallback during screening.',
  });
  const reviewed = await service.inspect({
    campaign_directory: fixture.campaignDirectory,
    challenge_path: complex.path,
    pull_request_url: 'https://github.com/markedjs/marked/pull/4048',
    trex_policy: 'not_applicable',
    trex_not_applicable_reason: 'Parser library has no browser flow.',
  });
  assert.equal(reviewed.receipt.status, 'review_action_required');
  assert.equal(reviewed.publication.status, 'current');

  repositoryRevision = HEAD;
  github = githubEvidence({
    head: HEAD,
    checks: [{ name: 'test', status: 'completed', conclusion: 'action_required' }],
    threads: [
      {
        resolved: false,
        outdated: true,
        author: 'maintainer',
        path: 'src/Lexer.ts',
        line: null,
        body: 'Use the existing links object directly.',
      },
    ],
  });
  dependencies.now = () => new Date('2026-08-10T00:00:02.000Z');
  const stale = await service.refresh({
    campaign_directory: fixture.campaignDirectory,
    challenge_path: complex.path,
    pull_request_url: 'https://github.com/markedjs/marked/pull/4048',
    trex_policy: 'not_applicable',
    trex_not_applicable_reason: 'Parser library has no browser flow.',
  });
  assert.equal(stale.receipt.status, 'stale');
  assert.equal(stale.publication.status, 'stale');
  assert.equal(stale.publication.source_receipt_digest, reviewed.receipt.receipt_digest);

  diff = '+ return Object.hasOwn(tokens.links, label);\n';
  dependencies.now = () => new Date('2026-08-10T00:00:03.000Z');
  const simpler = await service.challenge({
    campaign_directory: fixture.campaignDirectory,
    selected_sequence: 2,
    comparison_sequence: 1,
  });
  const current = await service.inspect({
    campaign_directory: fixture.campaignDirectory,
    challenge_path: simpler.path,
    pull_request_url: 'https://github.com/markedjs/marked/pull/4048',
    trex_policy: 'not_applicable',
    trex_not_applicable_reason: 'Parser library has no browser flow.',
  });
  assert.equal(current.receipt.status, 'checks_approval_required');
  assert.equal(current.receipt.feedback_learning.length, 1);
  assert.deepEqual(current.receipt.feedback_learning[0].rejected_patterns, [
    'class_member_state',
    'cleanup_path',
    'fallback_path',
    'new_branch',
  ]);
  assert.equal(current.receipt.feedback_learning[0].feedback[0].line, 42);
  assert.match(current.receipt.feedback_learning[0].revised_hypothesis, /direct membership/);
  assert.equal(current.publication.status, 'current');
  assert.equal(current.publication.source_receipt_digest, current.receipt.receipt_digest);
  assert.equal(current.publication.feedback_learning.length, 1);
});

test('head drift and required missing T-Rex evidence fail closed', async (context) => {
  const fixture = await contributionFixture(context);
  const dependencies = {
    ...fixture.dependencies,
    githubInspector: async () => githubEvidence({ head: 'c'.repeat(40) }),
  };
  const service = await createOptimizationContributionService(fixture.root, dependencies);
  const challenged = await service.challenge({
    campaign_directory: fixture.campaignDirectory,
    selected_sequence: 1,
    simpler_not_applicable_reason: 'No simpler candidate is applicable.',
  });
  const result = await service.inspect({
    campaign_directory: fixture.campaignDirectory,
    challenge_path: challenged.path,
    pull_request_url: 'https://github.com/markedjs/marked/pull/4048',
    trex_policy: 'required',
  });
  assert.equal(result.receipt.gates.freshness.status, 'stale');
  assert.equal(result.receipt.gates.trex.status, 'missing');
  assert.equal(result.receipt.status, 'stale');
});

test('contribution inspection rejects symlink escape before GitHub access', async (context) => {
  const fixture = await contributionFixture(context);
  let githubCalls = 0;
  const service = await createOptimizationContributionService(fixture.root, {
    ...fixture.dependencies,
    githubInspector: async () => {
      githubCalls += 1;
      return githubEvidence();
    },
  });
  const outside = join(fixture.root, 'outside.json');
  await writeFile(outside, '{}');
  const closeout = join(fixture.root, fixture.campaignDirectory, 'closeout');
  await mkdir(closeout);
  await symlink(outside, join(closeout, 'escape.json'));
  await assert.rejects(
    service.inspect({
      campaign_directory: fixture.campaignDirectory,
      challenge_path: `${fixture.campaignDirectory}/closeout/escape.json`,
      pull_request_url: 'https://github.com/markedjs/marked/pull/4048',
      trex_policy: 'optional',
    }),
    /escapes the repository/
  );
  assert.equal(githubCalls, 0);
});

test('GitHub normalization retains empty-body inline feedback and never weights gates', () => {
  const normalized = normalizeGitHubEvidence(
    githubEvidence({
      reviews: [{ author: 'maintainer', state: 'commented', body: '' }],
      threads: [
        { resolved: false, outdated: false, author: 'maintainer', path: 'src/a.ts', body: 'Why?' },
      ],
    })
  );
  assert.equal(normalized.reviews.status, 'action_required');
  assert.equal(normalized.reviews.observations[0].summary, '');
  assert.equal(
    deriveContributionStatus(
      {
        freshness: { status: 'current' },
        correctness: { status: 'passed' },
        performance: { status: 'confirmed' },
        patch_quality: { status: 'retained_with_justification' },
        trex: { status: 'not_applicable' },
        reviews: { status: 'action_required' },
        checks: { status: 'passed' },
        merge_authority: { status: 'external_maintainer' },
      },
      normalized.identity
    ),
    'review_action_required'
  );
});

test('GitHub normalization treats fork workflow authorization as approval-required, not failed', () => {
  const normalized = normalizeGitHubEvidence(
    githubEvidence({
      checks: [
        {
          name: 'Vercel',
          status: 'completed',
          conclusion: 'failure',
          details_url: 'https://vercel.com/git/authorize?team=MarkedJS',
        },
        { name: 'security/snyk', status: 'completed', conclusion: 'success' },
      ],
    })
  );
  assert.equal(normalized.checks.status, 'approval_required');
  assert.match(normalized.checks.reason, /approval/);
});

test('GitHub normalization keeps submitted change requests independent from inline threads', () => {
  const normalized = normalizeGitHubEvidence(
    githubEvidence({
      reviews: [{ author: 'maintainer', state: 'changes_requested', body: 'Please revise.' }],
      threads: [],
    })
  );
  assert.equal(normalized.reviews.status, 'clear');
  assert.equal(normalized.approvals.status, 'changes_requested');
});

test('GitHub normalization does not call an empty check list passing', () => {
  const normalized = normalizeGitHubEvidence(githubEvidence({ checks: [] }));
  assert.equal(normalized.checks.status, 'not_observed');
});

async function contributionFixture(
  context,
  { includeComparison = false, selectedSimpler = false } = {}
) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-contribution-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const campaignDirectory = '.codevetter/optimization-campaigns/fixture';
  await mkdir(join(root, campaignDirectory), { recursive: true });
  const records = [
    initializedRecord(),
    promotionRecord(
      1,
      selectedSimpler ? { movement: 4, metric: 10.2 } : { movement: 12, metric: 10 }
    ),
  ];
  if (includeComparison) {
    records.push(
      promotionRecord(
        2,
        selectedSimpler ? { movement: 12, metric: 10 } : { movement: 4, metric: 10.2 }
      )
    );
  }
  const evidence = new Map(
    records
      .filter((record) => record.kind === 'promotion')
      .map((record) => [record.sequence, promotionEvidence(record.metric)])
  );
  const dependencies = {
    now: () => new Date('2026-08-10T00:00:00.000Z'),
    campaignService: {
      inspect: async () => ({
        manifest: {
          campaign_id: 'fixture',
          repository_revision: BASE,
          artifact_directory: campaignDirectory,
        },
        records,
      }),
      evidence: async ({ record_sequence: sequence }) => ({
        record: records[sequence],
        evidence: evidence.get(sequence),
      }),
    },
    inspectRepositoryState: async () => ({
      revision: HEAD,
      diff_digest: DIFF,
      changed_files: ['src/Lexer.ts'],
    }),
    inspectCandidateCommit: async () => ({ clean: true, changed_files: [] }),
    readCandidateDiff: async () =>
      '+ const cache = new Map();\n+ try { if (ready) work(); } finally { fallback(); }\n',
    githubInspector: async () => githubEvidence(),
  };
  return { root, campaignDirectory, dependencies, records, evidence };
}

function initializedRecord() {
  return { sequence: 0, kind: 'initialized', decision: { status: 'initialized' } };
}

function promotionRecord(sequence, { movement, metric }) {
  return {
    sequence,
    kind: 'promotion',
    record_digest: sequence === 1 ? RECORD : '9'.repeat(64),
    repository: {
      revision: HEAD,
      diff_digest: DIFF,
      changed_files: ['src/Lexer.ts'],
    },
    complexity: {
      files_changed: 1,
      added_lines: movement,
      deleted_lines: 1,
      delta_added_lines: movement,
      delta_deleted_lines: 1,
    },
    correctness: [{ status: 'passed' }],
    decision: { status: 'keep' },
    metric,
  };
}

function promotionEvidence(metric) {
  return {
    verification: {
      workload_identity: { digest: WORKLOAD },
      observed: [
        {
          kind: 'scale_point_comparison',
          points: [
            { input: 0, unit: 'ms/op', baseline: 1, current: metric / 10 },
            { input: 2_000, unit: 'ms/op', baseline: 100, current: metric },
          ],
        },
      ],
    },
  };
}

function githubEvidence({
  head = HEAD,
  checks = [{ name: 'test', status: 'completed', conclusion: 'success' }],
  reviews = [],
  threads = [],
} = {}) {
  return {
    url: 'https://github.com/markedjs/marked/pull/4048',
    repository: 'markedjs/marked',
    number: 4048,
    head_sha: head,
    base_sha: BASE,
    state: 'open',
    is_draft: false,
    mergeable: 'mergeable',
    viewer_permission: 'read',
    checks,
    reviews,
    threads,
  };
}
