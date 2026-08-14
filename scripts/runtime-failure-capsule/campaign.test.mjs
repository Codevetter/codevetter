import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  CAMPAIGN_MANIFEST_SCHEMA_VERSION,
  assertCampaignManifest,
  validateCampaignManifest,
} from './campaign-contracts.mjs';
import { main as campaignCli } from './campaign-cli.mjs';
import { createOptimizationCampaignService } from './campaign.mjs';

const execute = promisify(execFile);

test('campaign manifests are closed and protect evaluator trees', () => {
  const manifest = manifestFor('a'.repeat(40));
  assert.equal(assertCampaignManifest(manifest), manifest);
  assert.match(
    validateCampaignManifest({ ...manifest, surprise: true }).join('\n'),
    /unknown field: surprise/
  );
  assert.match(
    validateCampaignManifest({ ...manifest, allowed_files: ['test/'] }).join('\n'),
    /includes evaluator target: test\/correctness.test.js/
  );
  assert.match(
    validateCampaignManifest({ ...manifest, allowed_files: ['../source.js'] }).join('\n'),
    /invalid path segment/
  );
  assert.deepEqual(
    validateCampaignManifest({
      ...manifest,
      performance: { ...manifest.performance, adapter: 'playwright' },
    }),
    []
  );
});

test('campaign CLI is closed, emits JSON, and preserves decision exit semantics', async () => {
  let output = '';
  const stdout = { write: (chunk) => (output += chunk) };
  const service = {
    screen: (input) => ({ record: { decision: { status: 'discard' } }, input }),
  };
  const code = await campaignCli(
    [
      'screen',
      '--campaign',
      '.codevetter/optimization-campaigns/hermetic',
      '--hypothesis',
      'Try one bounded change.',
      '--json',
    ],
    { service, stdout }
  );
  assert.equal(code, 1);
  assert.equal(JSON.parse(output).record.decision.status, 'discard');

  output = '';
  const invalid = await campaignCli(
    [
      'status',
      '--campaign',
      '.codevetter/optimization-campaigns/hermetic',
      '--command',
      'anything',
    ],
    { service, stdout }
  );
  assert.equal(invalid, 2);
  assert.match(JSON.parse(output).error.message, /unknown option/);

  output = '';
  let challengeInput = null;
  const contributionService = {
    challenge: (input) => {
      challengeInput = input;
      return { challenge: { patch_quality: { status: 'retained_with_justification' } } };
    },
  };
  const challenged = await campaignCli(
    [
      'challenge',
      '--campaign',
      '.codevetter/optimization-campaigns/hermetic',
      '--selected-sequence',
      '4',
      '--justification',
      'No simpler candidate is applicable.',
      '--json',
    ],
    { contributionService, stdout }
  );
  assert.equal(challenged, 0);
  assert.equal(challengeInput.selected_sequence, 4);
  assert.equal(challengeInput.simpler_not_applicable_reason, 'No simpler candidate is applicable.');

  output = '';
  const rejectedContributionOption = await campaignCli(
    [
      'inspect-contribution',
      '--campaign',
      '.codevetter/optimization-campaigns/hermetic',
      '--challenge',
      '.codevetter/optimization-campaigns/hermetic/closeout/challenge.json',
      '--pr',
      'https://github.com/example/repo/pull/1',
      '--trex-policy',
      'optional',
      '--command',
      'gh pr comment',
    ],
    { contributionService, stdout }
  );
  assert.equal(rejectedContributionOption, 2);
  assert.match(JSON.parse(output).error.message, /unknown option/);
});

test('campaign rejects faster incorrect work, promotes paired evidence, resumes, and stops on plateau', async () => {
  const fixture = await createFixture({ maxNonImprovements: 2 });
  let profileCalls = 0;
  const dependencies = fakeDependencies(() => {
    profileCalls += 1;
  });
  try {
    const service = await createOptimizationCampaignService(fixture.root, dependencies);
    const initialized = await service.initialize({ campaign_directory: fixture.campaignDirectory });
    assert.equal(initialized.record.decision.status, 'initialized');

    const baseline = await service.baseline({ campaign_directory: fixture.campaignDirectory });
    assert.equal(baseline.record.decision.status, 'baseline_ready');
    assert.equal(profileCalls, 1);
    const changedEvaluator = await createOptimizationCampaignService(fixture.root, {
      ...dependencies,
      engineIdentity: {
        id: 'codevetter-autonomous-optimization/v1',
        implementation_digest: 'f'.repeat(64),
      },
    });
    await assert.rejects(
      changedEvaluator.screen({
        campaign_directory: fixture.campaignDirectory,
        hypothesis: 'A changed evaluator must not reinterpret this campaign.',
      }),
      /evaluator implementation changed/
    );

    const incumbentRoot = await mkdtemp(join(tmpdir(), 'codevetter-campaign-incumbent-'));
    await rm(incumbentRoot, { recursive: true, force: true });
    await git(process.cwd(), ['clone', '--quiet', fixture.root, incumbentRoot]);
    try {
      await writeFile(join(fixture.root, 'source.js'), 'export const mode = "FAST BAD";\n');
      const incorrect = await service.screen({
        campaign_directory: fixture.campaignDirectory,
        hypothesis: 'Skip work but accidentally return the wrong result.',
      });
      assert.equal(incorrect.record.decision.status, 'discard');
      assert.equal(profileCalls, 1, 'incorrect candidates must not reach performance profiling');

      await writeFile(join(fixture.root, 'source.js'), 'export const mode = "FAST";\n');
      const promising = await service.screen({
        campaign_directory: fixture.campaignDirectory,
        hypothesis: 'Remove the redundant allocation while preserving the result.',
      });
      assert.equal(promising.record.decision.status, 'promising');
      assert.equal(promising.status.status, 'needs_promotion');

      const promoted = await service.promote({
        campaign_directory: fixture.campaignDirectory,
        hypothesis: 'Remove the redundant allocation while preserving the result.',
        incumbent_repository: incumbentRoot,
      });
      assert.equal(promoted.record.decision.status, 'keep');
      assert.equal(promoted.status.incumbent.record_digest, promoted.record.record_digest);

      const resumedService = await createOptimizationCampaignService(fixture.root, dependencies);
      const resumed = await resumedService.status({
        campaign_directory: fixture.campaignDirectory,
      });
      assert.equal(resumed.status, 'active');
      assert.equal(resumed.incumbent.decision.status, 'keep');

      await writeFile(join(fixture.root, 'source.js'), 'export const mode = "SLOW";\n');
      const slower = await resumedService.screen({
        campaign_directory: fixture.campaignDirectory,
        hypothesis: 'Try a simpler loop that is actually slower.',
      });
      assert.equal(slower.record.decision.status, 'discard');

      await writeFile(join(fixture.root, 'source.js'), 'export const mode = "BAD AGAIN";\n');
      const secondFailure = await resumedService.screen({
        campaign_directory: fixture.campaignDirectory,
        hypothesis: 'Try an unsafe shortcut.',
      });
      assert.equal(secondFailure.record.decision.status, 'discard');
      assert.equal(secondFailure.status.status, 'stopped');
      assert.equal(secondFailure.status.stop_reason, 'plateau');

      const inspected = await resumedService.inspect({
        campaign_directory: fixture.campaignDirectory,
      });
      assert.deepEqual(
        inspected.records.map((record) => record.decision.status),
        ['initialized', 'baseline_ready', 'discard', 'promising', 'keep', 'discard', 'discard']
      );
    } finally {
      await rm(incumbentRoot, { recursive: true, force: true });
    }
  } finally {
    await fixture.cleanup();
  }
});

test('campaign rejects disproportionate source growth before verification', async () => {
  const fixture = await createFixture();
  try {
    let profileCount = 0;
    const service = await createOptimizationCampaignService(
      fixture.root,
      fakeDependencies(() => {
        profileCount += 1;
      })
    );
    await service.initialize({ campaign_directory: fixture.campaignDirectory });
    await service.baseline({ campaign_directory: fixture.campaignDirectory });
    const baselineProfiles = profileCount;
    await writeFile(
      join(fixture.root, 'source.js'),
      Array.from({ length: 170 }, (_, index) => `export const value${index} = ${index};`).join('\n')
    );

    const result = await service.screen({
      campaign_directory: fixture.campaignDirectory,
      hypothesis: 'Add a large shortcut.',
    });

    assert.equal(result.record.decision.status, 'discard');
    assert.match(result.record.decision.reason, /change-cost budget: lines_added/);
    assert.equal(profileCount, baselineProfiles);
  } finally {
    await fixture.cleanup();
  }
});

test('campaign records crash and no-confidence outcomes and detects evidence or ledger tampering', async () => {
  for (const candidate of [
    { source: 'export const mode = "CRASH";\n', decision: 'crash' },
    { source: 'export const mode = "NOISY";\n', decision: 'no_confidence' },
  ]) {
    const fixture = await createFixture({ maxCrashes: 1 });
    try {
      const service = await createOptimizationCampaignService(fixture.root, fakeDependencies());
      await service.initialize({ campaign_directory: fixture.campaignDirectory });
      await service.baseline({ campaign_directory: fixture.campaignDirectory });
      await writeFile(join(fixture.root, 'source.js'), candidate.source);
      const result = await service.screen({
        campaign_directory: fixture.campaignDirectory,
        hypothesis: `Exercise ${candidate.decision} handling.`,
      });
      assert.equal(result.record.decision.status, candidate.decision);
      if (candidate.decision === 'crash') {
        assert.equal(result.status.stop_reason, 'consecutive_crashes');
      }

      const ledgerPath = join(fixture.root, fixture.campaignDirectory, 'ledger.ndjson');
      const ledger = await readFile(ledgerPath, 'utf8');
      await writeFile(ledgerPath, ledger.replace('Campaign scope', 'Altered scope'));
      await assert.rejects(
        service.status({ campaign_directory: fixture.campaignDirectory }),
        /record_digest is invalid/
      );
    } finally {
      await fixture.cleanup();
    }
  }

  const fixture = await createFixture();
  try {
    const service = await createOptimizationCampaignService(fixture.root, fakeDependencies());
    await service.initialize({ campaign_directory: fixture.campaignDirectory });
    const baseline = await service.baseline({ campaign_directory: fixture.campaignDirectory });
    const evidencePath = join(fixture.root, baseline.record.performance.path);
    await writeFile(evidencePath, '{"tampered":true}\n');
    await assert.rejects(
      service.inspect({ campaign_directory: fixture.campaignDirectory }),
      /evidence digest mismatch/
    );
  } finally {
    await fixture.cleanup();
  }
});

function fakeDependencies(onProfile = () => {}) {
  return {
    now: () => new Date('2026-08-09T00:00:00.000Z'),
    runClosedAdapter: async ({ repositoryRoot }) => {
      const source = await readFile(join(repositoryRoot, 'source.js'), 'utf8');
      if (source.includes('CRASH')) return execution({ status: 'timeout', exitCode: null });
      if (source.includes('BAD')) return execution({ exitCode: 1, stdout: 'not ok 1 - result\n' });
      return execution({ stdout: 'ok 1 - result\n# pass 1\n# fail 0\n' });
    },
    profileRepository: async ({ repositoryRoot }) => {
      onProfile();
      const source = await readFile(join(repositoryRoot, 'source.js'), 'utf8');
      return {
        marker: source.includes('NOISY') ? 'noisy' : source.includes('FAST') ? 'fast' : 'baseline',
        verdict: { status: source.includes('NOISY') ? 'no_confidence' : 'profiled' },
        limitations: source.includes('NOISY') ? ['Measurements were unstable.'] : [],
      };
    },
    verifyOptimizationCapsules: (_baseline, current) =>
      verification(
        current.marker === 'fast'
          ? 'confirmed'
          : current.marker === 'noisy'
            ? 'no_confidence'
            : 'rejected'
      ),
    verifyPairedRepositories: async () => ({
      ...verification('confirmed', { shipping: true }),
      current_capsule: { marker: 'fast', verdict: { status: 'profiled' }, limitations: [] },
    }),
  };
}

function verification(status, { shipping = false } = {}) {
  const confirmed = status === 'confirmed';
  return {
    verdict: { status, reason: `${status} fixture verdict` },
    decisions: {
      mechanically_confirmed: confirmed,
      materially_useful: confirmed,
      shipping_recommended: confirmed && shipping,
    },
    limitations: status === 'no_confidence' ? ['Measurements were unstable.'] : [],
  };
}

function execution({ status = 'exited', exitCode = 0, stdout = '' } = {}) {
  return { status, exitCode, stdout, stderr: '', durationMs: 4, truncated: false };
}

async function createFixture({ maxNonImprovements = 5, maxCrashes = 2 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-campaign-'));
  const campaignDirectory = '.codevetter/optimization-campaigns/hermetic';
  await writeFile(join(root, 'source.js'), 'export const mode = "BASELINE";\n');
  await mkdir(join(root, 'test'));
  await writeFile(join(root, 'test/correctness.test.js'), '// immutable correctness target\n');
  await writeFile(join(root, 'test/performance.test.js'), '// immutable performance target\n');
  await git(root, ['init', '--quiet']);
  await git(root, ['config', 'user.email', 'codevetter@example.invalid']);
  await git(root, ['config', 'user.name', 'CodeVetter Test']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '--quiet', '-m', 'fixture']);
  const revision = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await mkdir(join(root, campaignDirectory), { recursive: true });
  await writeFile(
    join(root, campaignDirectory, 'manifest.json'),
    `${JSON.stringify(
      manifestFor(revision, { maxNonImprovements, maxCrashes, campaignDirectory }),
      null,
      2
    )}\n`
  );
  return {
    root,
    campaignDirectory,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function manifestFor(revision, { maxNonImprovements = 5, maxCrashes = 2, campaignDirectory } = {}) {
  return {
    schema_version: CAMPAIGN_MANIFEST_SCHEMA_VERSION,
    campaign_id: 'hermetic',
    repository_revision: revision,
    artifact_directory: campaignDirectory ?? '.codevetter/optimization-campaigns/hermetic',
    allowed_files: ['source.js'],
    correctness: [
      {
        adapter: 'node-test',
        target: 'test/correctness.test.js',
        name: 'result',
        timeout_ms: 10_000,
      },
    ],
    performance: {
      adapter: 'node-test',
      target: 'test/performance.test.js',
      name: 'performance',
      timeout_ms: 10_000,
      screening: { samples: 3, warmups: 1 },
      promotion: { samples: 10, warmups: 1 },
    },
    budgets: {
      max_experiments: 10,
      max_elapsed_minutes: 60,
      max_consecutive_non_improvements: maxNonImprovements,
      max_consecutive_crashes: maxCrashes,
    },
  };
}

function git(cwd, args) {
  return execute('git', args, { cwd });
}
