import { expect, test, type Page } from '@playwright/test';

import { ConsoleErrorCollector, navigateTo, waitForNoSpinners } from './helpers';

const REPO_PATH = '/tmp/warm-verification-app';

async function installWarmVerificationMock(
  page: Page,
  options: { offline?: boolean; activeRun?: boolean } = {}
) {
  await page.addInitScript(
    ({ repoPath, offline, activeRun }) => {
      const result = {
        schema_version: 1,
        protocol_version: 1,
        run_id: 'run-warm-1',
        outcome: offline ? 'no_confidence' : 'regression',
        started_at: '2026-07-15T08:00:00.000Z',
        finished_at: '2026-07-15T08:00:01.234Z',
        warm: true,
        stale: false,
        model_call_count: 0,
        source: {
          target_sha: 'a'.repeat(40),
          change_set_kind: 'worktree',
          change_set_identity: 'b'.repeat(64),
          config_hash: 'c'.repeat(64),
          manifest_hash: 'd'.repeat(64),
          source_hash_before: 'e'.repeat(64),
          source_hash_after: 'e'.repeat(64),
        },
        observation_policy: { schema_version: 1, profile_id: 'strict-local' },
        selection: {
          changed_paths: ['src/features/portfolio/Recurring.tsx'],
          selected_scenario_ids: ['portfolio-recurring', 'app-smoke'],
          mandatory_smoke_ids: ['app-smoke'],
          fallback_scenario_ids: [],
          complete: !offline,
          explanation:
            'Recurring.tsx matched portfolio and selected its deterministic scenario plus mandatory smoke.',
        },
        scenarios: [
          { scenario_id: 'app-smoke', outcome: 'passed', duration_ms: 400 },
          {
            scenario_id: 'portfolio-recurring',
            outcome: offline ? 'no_confidence' : 'regression',
            duration_ms: 700,
          },
        ],
        timings: [
          { stage: 'selection', duration_ms: 8 },
          { stage: 'navigation', duration_ms: 240 },
          { stage: 'actions', duration_ms: 610 },
          { stage: 'total', duration_ms: 1_234 },
        ],
        observations: offline
          ? []
          : [
              {
                id: 'observation-1',
                scenario_id: 'portfolio-recurring',
                kind: 'duplicate_mutation',
                disposition: 'regression',
                policy_id: 'single-mutation',
                message: 'Expected one mutation but observed two.',
                occurred_at: '2026-07-15T08:00:01.000Z',
              },
            ],
        limitations: offline
          ? [
              {
                code: 'daemon_unavailable',
                message: 'The local verifier is not reachable.',
                affects_confidence: true,
                remediation: 'Start the daemon.',
              },
            ]
          : [],
        artifacts: offline
          ? []
          : [
              {
                id: 'artifact-1',
                kind: 'screenshot',
                relative_path: 'run-warm-1/portfolio-recurring/failure.png',
                sha256: 'f'.repeat(64),
                bytes: 4_096,
                redacted: true,
                created_at: '2026-07-15T08:00:01.000Z',
                retained_until: '2026-07-22T08:00:01.000Z',
                scenario_id: 'portfolio-recurring',
              },
            ],
        cancellation: { state: 'not_requested' },
      };
      const storedRun = {
        id: 'stored-warm-1',
        review_id: null,
        repo_path: repoPath,
        result,
        created_at: result.finished_at,
      };
      const health = offline
        ? null
        : {
            schema_version: 1,
            daemon_pid: 4100,
            daemon_start_identity: '4100:daemon-start',
            target_root: repoPath,
            target_sha: 'a'.repeat(40),
            config_hash: 'c'.repeat(64),
            chromium_revision: '1234567',
            cold_startup_ms: 900,
            warm: true,
            server: {
              kind: 'process',
              state: 'ready',
              owned: true,
              pid: 4200,
              start_identity: '4200:server-start',
              restart_attempts: 0,
              last_exit: null,
            },
            browser: {
              kind: 'browser',
              state: 'ready',
              owned: true,
              pid: null,
              start_identity: 'playwright:1',
              restart_attempts: 0,
              last_exit: null,
            },
            active_run_ids: activeRun ? ['run-active-1'] : [],
            resources: {
              rss_bytes: 100_000_000,
              heap_used_bytes: 30_000_000,
              active_contexts: activeRun ? 2 : 0,
              retained_artifact_bytes: 4_096,
            },
            checked_at: '2026-07-15T08:00:02.000Z',
          };

      const browserWindow = window as unknown as {
        __warmCommands: Array<{ cmd: string; args: unknown }>;
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
          transformCallback: () => number;
          unregisterCallback: () => void;
          callbacks: Record<string, unknown>;
        };
      };
      browserWindow.__warmCommands = [];
      browserWindow.__TAURI_INTERNALS__ = {
        invoke: async (cmd, args) => {
          browserWindow.__warmCommands.push({ cmd, args });
          if (cmd === 'get_preference') {
            const key = String(args?.key ?? '');
            return {
              key,
              value:
                key === 'onboarding_complete'
                  ? 'true'
                  : key === 'active_repo_path'
                    ? repoPath
                    : null,
            };
          }
          if (cmd === 'set_preference') return undefined;
          if (cmd === 'list_repo_projects') {
            return [
              {
                id: 'project-warm',
                repo_path: repoPath,
                display_name: 'warm-verification-app',
                first_opened_at: '2026-07-01T00:00:00.000Z',
                last_opened_at: '2026-07-15T08:00:00.000Z',
                last_unpack_at: null,
                last_intel_at: null,
                unpack_snapshot_count: 0,
                intel_snapshot_count: 0,
              },
            ];
          }
          if (cmd === 'list_trex_watchers' || cmd === 'list_trex_pr_runs') return [];
          if (cmd === 'list_warm_verification_runs') return [storedRun];
          if (cmd === 'get_warm_verification_daemon_health') return health;
          if (cmd === 'start_warm_verification_daemon') return health;
          if (cmd === 'stop_warm_verification_daemon') return { active_run_ids: [] };
          if (cmd === 'run_warm_changed_verification') return storedRun;
          if (cmd === 'cancel_warm_verification_run') {
            if (health) health.active_run_ids = [];
            return { accepted: true };
          }
          if (cmd === 'cleanup_warm_verification_artifacts') {
            return {
              dry_run: false,
              removed_runs: 2,
              removed_files: 4,
              reclaimed_bytes: 8_192,
              retained_bytes: 4_096,
              shared_playwright_cache_bytes: 50_000_000,
            };
          }
          throw new Error(`unhandled mocked command: ${cmd}`);
        },
        transformCallback: () => 1,
        unregisterCallback: () => undefined,
        callbacks: {},
      };
    },
    {
      repoPath: REPO_PATH,
      offline: options.offline ?? false,
      activeRun: options.activeRun ?? false,
    }
  );
}

test.describe('T-Rex warm verification', () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
  });

  test.afterEach(() => consoleErrors.assertNoErrors());

  test('shows exact health, selection, timing, failure, artifact, and cleanup evidence', async ({
    page,
  }) => {
    await installWarmVerificationMock(page);
    await navigateTo(page, '/trex');
    await waitForNoSpinners(page);

    const panel = page.getByTestId('warm-verification-panel');
    await expect(panel.getByText('Warm verification')).toBeVisible();
    await expect(panel.getByText('pid 4100 · 0 active')).toBeVisible();
    await expect(panel.getByText('Chromium 1234567')).toBeVisible();
    await expect(panel.getByText('Recurring.tsx matched portfolio')).toBeVisible();
    await expect(panel.getByRole('definition').filter({ hasText: '1.23 s' })).toBeVisible();
    await expect(panel.getByText('Expected one mutation but observed two.')).toBeVisible();
    await expect(panel.getByText(/failure\.png/)).toBeVisible();

    await panel.getByRole('button', { name: 'Verify changed' }).click();
    await panel.getByRole('button', { name: 'Clean owned artifacts' }).click();
    await expect(panel.getByText(/Removed 2 runs and reclaimed 8,192 bytes/)).toBeVisible();

    const commands = await page.evaluate(() => {
      const browserWindow = window as unknown as {
        __warmCommands: Array<{ cmd: string; args: unknown }>;
      };
      return browserWindow.__warmCommands;
    });
    expect(commands.map(({ cmd }) => cmd)).toContain('run_warm_changed_verification');
    expect(commands.map(({ cmd }) => cmd)).toContain('cleanup_warm_verification_artifacts');
  });

  test('keeps operational failures no-confidence and exposes cancellation for an active run', async ({
    page,
  }) => {
    await installWarmVerificationMock(page, { offline: true });
    await navigateTo(page, '/trex');
    await waitForNoSpinners(page);

    const panel = page.getByTestId('warm-verification-panel');
    await expect(panel.getByText('No confidence: daemon unavailable')).toBeVisible();
    await expect(panel.getByText('The local verifier is not reachable.')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Verify changed' })).toBeDisabled();

    await page.reload();
    await installWarmVerificationMock(page, { activeRun: true });
    await navigateTo(page, '/trex');
    await waitForNoSpinners(page);
    const activePanel = page.getByTestId('warm-verification-panel');
    await activePanel.getByRole('button', { name: 'Cancel run' }).click();
    await expect(activePanel.getByRole('button', { name: 'Verify changed' })).toBeVisible();
  });
});
