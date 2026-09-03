import { expect, test, type Page } from '@playwright/test';

import { ConsoleErrorCollector, navigateTo, waitForNoSpinners } from './helpers';

const REPO_PATH = '/tmp/review-warm-app';
const REVIEW_ID = 'review-warm-1';
const hash = (character: string) => character.repeat(64);

function warmResult(runId: string, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    protocol_version: 1,
    run_id: runId,
    outcome: 'passed',
    started_at: '2026-07-15T08:00:00.000Z',
    finished_at: '2026-07-15T08:00:01.000Z',
    warm: true,
    stale: false,
    model_call_count: 0,
    source: {
      target_sha: 'a'.repeat(40),
      change_set_kind: 'worktree',
      change_set_identity: hash('b'),
      config_hash: hash('c'),
      manifest_hash: hash('d'),
      source_hash_before: hash('e'),
      source_hash_after: hash('e'),
    },
    observation_policy: { schema_version: 1, profile_id: 'strict-local' },
    selection: {
      changed_paths: ['src/portfolio.tsx'],
      selected_scenario_ids: ['portfolio-empty', 'app-smoke'],
      mandatory_smoke_ids: ['app-smoke'],
      fallback_scenario_ids: [],
      complete: true,
      explanation: 'Portfolio mapping plus mandatory smoke.',
    },
    scenarios: [
      { scenario_id: 'portfolio-empty', outcome: 'passed', duration_ms: 400 },
      { scenario_id: 'app-smoke', outcome: 'passed', duration_ms: 200 },
    ],
    timings: [{ stage: 'total', duration_ms: 1_000 }],
    observations: [],
    limitations: [],
    artifacts: [],
    cancellation: { state: 'not_requested' },
    ...overrides,
  };
}

function audienceBundle() {
  return {
    run: {
      id: 'audience-1',
      review_id: REVIEW_ID,
      repo_path: REPO_PATH,
      audience: 'Portfolio users',
      task: 'Confirm the changed flow',
      candidate_a: 'Changed build',
      candidate_a_artifact: null,
      candidate_b: null,
      candidate_b_artifact: null,
      criteria: ['task completion'],
      min_responses: 1,
      required: false,
      waived_reason: 'Executable-only fixture',
      created_at: '2026-07-15T07:00:00.000Z',
      updated_at: '2026-07-15T07:00:00.000Z',
    },
    responses: [],
    diagnostics: {
      response_count: 0,
      human_response_count: 0,
      agent_response_count: 0,
      imported_response_count: 0,
      mean_agreement: 0,
      mean_majority_strength: 0,
      low_confidence_count: 0,
      order_inconsistent_count: 0,
      criteria_with_cycles: [],
      signal_strength: 'weak',
      criteria: [],
    },
    verification: {
      review: {
        status: 'completed',
        label: 'Code review',
        evidence: [`review:${REVIEW_ID}`],
        caveats: [],
      },
      executable_test: {
        status: 'passed',
        label: 'Executable test',
        evidence: ['legacy:must-be-replaced'],
        caveats: [],
      },
      audience: {
        status: 'waived',
        label: 'Audience',
        evidence: ['waiver:fixture'],
        caveats: [],
      },
      aggregate_status: 'verified',
      confidence: 'high',
      human_validation_fulfilled: false,
      proof_markdown: 'legacy proof',
    },
  };
}

async function installReviewMock(
  page: Page,
  newestIsStale: boolean,
  legacyManifest = false,
  withSuggestion = false
) {
  const newest = warmResult(newestIsStale ? 'newest-stale' : 'newest-pass', {
    stale: newestIsStale,
  });
  const older = warmResult(newestIsStale ? 'older-pass' : 'older-regression', {
    outcome: newestIsStale ? 'passed' : 'regression',
  });
  const current = {
    schema_version: 1,
    target_sha: newest.source.target_sha,
    change_set_kind: newest.source.change_set_kind,
    change_set_identity: newest.source.change_set_identity,
    config_hash: newest.source.config_hash,
    manifest_hash: newest.source.manifest_hash,
    source_hash: newest.source.source_hash_after,
    observation_policy_profile_id: newest.observation_policy.profile_id,
  };
  const project = {
    id: 'project-warm-review',
    repo_path: REPO_PATH,
    display_name: 'review-warm-app',
    first_opened_at: '2026-07-01T00:00:00.000Z',
    last_opened_at: '2026-07-15T08:00:00.000Z',
    last_unpack_at: null,
    last_intel_at: null,
    unpack_snapshot_count: 0,
    intel_snapshot_count: 0,
  };
  const review = {
    id: REVIEW_ID,
    review_type: 'local',
    source_label: 'main...feature',
    repo_path: REPO_PATH,
    repo_full_name: null,
    pr_number: null,
    agent_used: 'claude',
    score_composite: 100,
    findings_count: withSuggestion ? 1 : 0,
    review_action: null,
    summary_markdown: 'No findings.',
    status: 'completed',
    error_message: null,
    started_at: '2026-07-15T07:00:00.000Z',
    completed_at: '2026-07-15T07:00:01.000Z',
    created_at: '2026-07-15T07:00:00.000Z',
    standards_pack: null,
  };
  const findings = withSuggestion
    ? [
        {
          id: 'finding-approval',
          review_id: REVIEW_ID,
          severity: 'medium',
          title: 'Guard invalid state',
          summary: 'The guard accepts an invalid state.',
          suggestion: 'Return an error.',
          file_path: 'src/portfolio.tsx',
          line: 12,
          confidence: 0.9,
          disposition: 'unreviewed',
        },
      ]
    : [];

  await page.addInitScript(
    ({
      repoPath,
      reviewId,
      projectRow,
      reviewRow,
      findingRows,
      bundle,
      warmRuns,
      currentIdentity,
      legacy,
    }) => {
      const controlled = window as unknown as {
        __reviewWarmCommands: Array<{ cmd: string; args: Record<string, unknown> | undefined }>;
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
          transformCallback: () => number;
          unregisterCallback: () => void;
          callbacks: Record<string, unknown>;
        };
      };
      controlled.__reviewWarmCommands = [];
      controlled.__TAURI_INTERNALS__ = {
        invoke: async (cmd, args) => {
          controlled.__reviewWarmCommands.push({ cmd, args });
          if (cmd === 'get_preference') {
            const key = String(args?.key ?? '');
            const preferences: Record<string, string> = {
              onboarding_complete: 'true',
              active_repo_path: repoPath,
            };
            return {
              key,
              value: preferences[key] ?? null,
            };
          }
          if (new Set(['set_preference', 'preload_directory_picker']).has(cmd)) return undefined;
          if (cmd === 'list_repo_projects') return [projectRow];
          if (cmd === 'register_repo_project') return projectRow;
          if (cmd === 'list_reviews') return { reviews: [reviewRow] };
          if (cmd === 'get_review') return { review: reviewRow, findings: findingRows };
          if (cmd === 'read_file_around_line') {
            const targetLine = Number(args?.line ?? 12);
            const source = [
              'export function resolvePortfolioState(input: PortfolioInput) {',
              '  const account = input.account;',
              '  const holdings = input.holdings ?? [];',
              '',
              '  if (!account) {',
              "    return { kind: 'signed_out' as const };",
              '  }',
              '',
              '  const total = holdings.reduce((sum, item) => sum + item.value, 0);',
              '  const hasPositions = holdings.length > 0;',
              '',
              '  if (total >= 0) {',
              "    return { kind: 'ready' as const, total, hasPositions };",
              '  }',
              '',
              "  return { kind: 'error' as const, reason: 'invalid_total' };",
              '}',
            ];
            return {
              lines: source.map((text, index) => ({
                line: index + 1,
                text,
                highlight: index + 1 === targetLine,
              })),
              language: 'typescript',
              target_line: targetLine,
              file_path: `${repoPath}/src/portfolio.tsx`,
            };
          }
          if (cmd === 'get_review_manifest')
            return legacy
              ? {
                  schema_version: 1,
                  review_id: reviewId,
                  coverage_kind: 'legacy_aggregate',
                  complete_coverage: false,
                  limitation: 'Coverage predates deterministic manifests.',
                }
              : {
                  schema_version: 1,
                  run_id: 'run-coverage',
                  review_id: reviewId,
                  target: {
                    schema_version: 1,
                    identity: 'target',
                    diff_mode: 'range',
                    requested_range: 'main...feature',
                    head_sha: 'b'.repeat(40),
                    base_sha: 'a'.repeat(40),
                    source_fingerprint: 'source',
                  },
                  executor_id: 'claude',
                  executor_version: 'cli-v1',
                  policy_fingerprint: 'policy',
                  units: [
                    {
                      id: 'unit-1',
                      file_path: 'src/app.ts',
                      file_status: 'M',
                      fingerprint: 'unit',
                      diff_bytes: 120,
                      prompt_budget_bytes: 81920,
                      coverage_state: 'reviewed',
                      coverage_reason: null,
                    },
                  ],
                  qualification_counts: { qualified: 0, stale: 0, unresolved: 0, rejected: 2 },
                  complete_coverage: true,
                  stale: false,
                  cancelled: false,
                  created_at: '2026-07-15T07:00:00.000Z',
                  completed_at: '2026-07-15T07:00:01.000Z',
                };
          if (cmd === 'list_git_branches')
            return { branches: ['main', 'feature'], current: 'feature' };
          if (cmd === 'list_pull_requests') return { pull_requests: [] };
          if (cmd === 'get_mcp_repository_settings')
            return {
              repo_id: 'repo_review_fixture',
              enabled: true,
              indexed: true,
              indexed_head: 'b'.repeat(40),
              current_head: 'b'.repeat(40),
              stale: false,
              server_path: '/Applications/CodeVetter/codevetter-mcp',
              client_config: {},
              resource_kinds: ['repository', 'graph'],
              tool_names: ['prepare_review', 'graph_query', 'history_search'],
              redaction_rules: ['No arbitrary file reads'],
              limits: { page_size: 100 },
              recent_audit: [],
            };
          if (cmd === 'detect_project_for_repo') return { project: null, source: null };
          if (cmd === 'get_audience_validation') return bundle;
          if (cmd === 'list_warm_verification_runs') return warmRuns;
          if (cmd === 'get_current_warm_verification_identity') return currentIdentity;
          if (cmd === 'list_synthetic_qa_runs') return { runs: [] };
          if (cmd === 'list_review_procedure_events') return { events: [] };
          if (cmd === 'suggest_review_verification_commands') return { commands: [] };
          if (cmd === 'build_agent_pr_xray') {
            const request = args?.request as
              | { public_source_confirmed?: boolean; public_source?: string }
              | undefined;
            const eligible = !!request?.public_source_confirmed && !!request.public_source;
            return {
              eligible,
              missing_requirements: eligible ? [] : ['Confirm a public source.'],
              sanitizer_issues: [],
              payload: {
                schema_version: 1,
                xray_id: 'xray-test',
                source: request?.public_source ?? '',
                generated_at: '2026-07-15T07:00:01.000Z',
                corpus_state: 'dogfood',
                outcome: 'incomplete',
                confidence: 'low',
                score: 100,
                review_status: 'completed',
                findings: [],
                stages: [],
                coverage: {
                  kind: 'deterministic_units',
                  complete: true,
                  reviewed: 1,
                  reused: 0,
                  skipped: 0,
                  failed: 0,
                  cancelled: 0,
                  rejected_candidates: 0,
                  unresolved_candidates: 0,
                  stale_candidates: 0,
                },
                changed_behavior: [],
                trusted_impact_paths: [],
                checks_run: [],
                verified_claims: [],
                missing_proof: ['executable_test: no evidence'],
                unresolved_risks: [],
              },
              json: '{}',
              markdown: '# X-Ray',
              html: '<!doctype html><title>X-Ray preview</title><p>Portable evidence</p>',
            };
          }
          throw new Error(`unhandled mocked command: ${cmd} for ${reviewId}`);
        },
        transformCallback: () => 1,
        unregisterCallback: () => undefined,
        callbacks: {},
      };
    },
    {
      repoPath: REPO_PATH,
      reviewId: REVIEW_ID,
      projectRow: project,
      reviewRow: review,
      findingRows: findings,
      bundle: audienceBundle(),
      warmRuns: [
        {
          id: 'stored-newest',
          repo_path: REPO_PATH,
          result: newest,
          created_at: newest.finished_at,
        },
        {
          id: 'stored-older',
          repo_path: REPO_PATH,
          result: older,
          created_at: '2026-07-14T08:00:01.000Z',
        },
      ],
      currentIdentity: current,
      legacy: legacyManifest,
    }
  );
}

test('Review presents deterministic coverage and rejected candidate counts', async ({ page }) => {
  await installReviewMock(page, false);
  await openPastReview(page);
  await expect(page.getByTestId('review-coverage')).toContainText('Complete coverage');
  await expect(page.getByTestId('review-coverage')).toContainText('2 rejected');
  await page.getByRole('tab', { name: /Evidence/ }).click();
  const decision = page.getByTestId('verification-decision-summary');
  await expect(decision).toBeVisible();
  await expect(decision).toContainText(/Hold|No confidence/);
  await expect(decision).toContainText(/unchecked|runtime evidence/i);
  await expect(decision.getByRole('link', { name: 'Runtime evidence' })).toBeVisible();
});

test('Review shows readiness for an external review agent', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await installReviewMock(page, false);
  await navigateTo(page, '/review');
  await waitForNoSpinners(page);
  await expect(page.getByText('Review agent ready')).toBeVisible();
  await page.getByRole('button', { name: /feature/ }).click();
  await expect(page.getByText(/prepare this exact range/)).toBeVisible();
  await expect(page.getByText('Run the full local check')).toBeVisible();
  await expect(page.getByText(/codevetter check --repo/)).toContainText(
    'codevetter check --repo /tmp/review-warm-app --range main...feature'
  );
  await page.getByRole('button', { name: 'Copy command template' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Agent MCP' })).toBeVisible();
});

test('Review labels legacy aggregate coverage as unknown', async ({ page }) => {
  await installReviewMock(page, false, true);
  await openPastReview(page);
  await expect(page.getByTestId('review-coverage')).toContainText('Coverage unknown');
  await expect(page.getByTestId('review-coverage')).toContainText('Legacy review');
});

test('Completed review can preview a sanitized offline X-Ray', async ({ page }) => {
  await installReviewMock(page, false);
  await openPastReview(page);
  await page.getByText('Agent PR X-Ray', { exact: true }).click();
  await page.getByPlaceholder('owner/repository#123').fill('owner/repo#42');
  await page
    .getByLabel('I confirm this repository/change and the finding summaries are safe to publish.')
    .check();
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('Ready to publish')).toBeVisible();
  await expect(page.getByTitle('Agent PR X-Ray preview')).toBeVisible();
});

test('X-Ray preview stays blocked until the public source is confirmed', async ({ page }) => {
  await installReviewMock(page, false);
  await openPastReview(page);
  await page.getByText('Agent PR X-Ray', { exact: true }).click();
  await page.getByPlaceholder('owner/repository#123').fill('owner/repo#42');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('Export blocked')).toBeVisible();
  await expect(page.getByText('Confirm a public source.')).toBeVisible();
});

test('X-Ray sends only explicitly approved suggestion excerpts', async ({ page }) => {
  await installReviewMock(page, false, false, true);
  await openPastReview(page);
  await page.getByText('Agent PR X-Ray', { exact: true }).click();
  await page.getByLabel('Guard invalid state').check();
  await page.getByPlaceholder('owner/repository#123').fill('owner/repo#42');
  await page
    .getByLabel('I confirm this repository/change and the finding summaries are safe to publish.')
    .check();
  await page.getByRole('button', { name: 'Preview' }).click();
  const approved = await page.evaluate(() => {
    const controlled = window as unknown as {
      __reviewWarmCommands: Array<{ cmd: string; args?: Record<string, unknown> }>;
    };
    const command = controlled.__reviewWarmCommands
      .filter(({ cmd }) => cmd === 'build_agent_pr_xray')
      .at(-1);
    return (command?.args?.request as { approved_excerpt_finding_ids?: string[] } | undefined)
      ?.approved_excerpt_finding_ids;
  });
  expect(approved).toEqual(['finding-approval']);
});

async function openPastReview(page: Page) {
  await navigateTo(page, '/review');
  await waitForNoSpinners(page);
  await page
    .locator('button')
    .filter({ hasText: /findings/ })
    .last()
    .click();
  await page.getByRole('tab', { name: /Review record/ }).click();
  await expect(page.getByTestId('audience-validation-panel')).toBeVisible();
}

for (const evidence of [
  { name: 'exact-current pass', stale: false, expected: 'passed' },
  { name: 'stale newest run', stale: true, expected: 'not_verified' },
] as const) {
  test(`Review qualifies only the newest repository warm evidence: ${evidence.name}`, async ({
    page,
  }) => {
    const consoleErrors = new ConsoleErrorCollector();
    consoleErrors.attach(page);
    await installReviewMock(page, evidence.stale);
    await openPastReview(page);

    const panel = page.getByTestId('audience-validation-panel');
    const executableStage = panel.getByText('Executable test', { exact: true }).locator('..');
    await expect(executableStage.getByText(evidence.expected, { exact: true })).toBeVisible();
    await expect(
      panel.getByRole('button', { name: /^(verify changed|start|run|cancel)/i })
    ).toHaveCount(0);
    await page.getByRole('tab', { name: /History/ }).click();
    await expect(page.getByText('Warm verification history').first()).toBeVisible();
    if (!evidence.stale) {
      await page.getByRole('tab', { name: /Evidence/ }).click();
      await page.getByRole('button').filter({ hasText: 'Evidence details' }).click();
      const executionFindings = page.getByTestId('warm-execution-findings');
      await expect(executionFindings).toContainText('Recent read-only execution findings');
      await expect(executionFindings).toContainText('older-regression');
      await expect(executionFindings).toContainText('Warm verification detected a regression');
    }

    const commands = await page.evaluate(() => {
      const controlled = window as unknown as {
        __reviewWarmCommands: Array<{ cmd: string; args?: Record<string, unknown> }>;
      };
      return controlled.__reviewWarmCommands;
    });
    const historyReads = commands.filter(({ cmd }) => cmd === 'list_warm_verification_runs');
    expect(historyReads.length).toBeGreaterThan(0);
    for (const read of historyReads) {
      expect(read.args?.repoPath).toBe(REPO_PATH);
      expect(read.args?.reviewId).toBeUndefined();
      expect([1, 8]).toContain(read.args?.limit);
    }
    expect(historyReads.some(({ args }) => args?.limit === 1)).toBe(true);
    expect(historyReads.some(({ args }) => args?.limit === 8)).toBe(true);
    const identityReads = commands.filter(
      ({ cmd }) => cmd === 'get_current_warm_verification_identity'
    );
    expect(identityReads.length).toBeGreaterThan(0);
    for (const read of identityReads) expect(read.args).toEqual({ repoPath: REPO_PATH });
    expect(
      commands.some(({ cmd }) =>
        [
          'start_warm_verification_daemon',
          'run_warm_changed_verification',
          'cancel_warm_verification_run',
        ].includes(cmd)
      )
    ).toBe(false);
    expect(commands.some(({ cmd }) => cmd === 'record_synthetic_qa_run')).toBe(false);
    const legacyQaWrites = commands.filter(
      ({ cmd, args }) =>
        cmd === 'set_preference' && String(args?.key ?? '').startsWith('quick_review_qa_runs_')
    );
    for (const write of legacyQaWrites) {
      expect(String(write.args?.value ?? '')).not.toContain('warm_verifyd');
      expect(String(write.args?.value ?? '')).not.toContain('older-regression');
    }
    consoleErrors.assertNoErrors();
  });
}
