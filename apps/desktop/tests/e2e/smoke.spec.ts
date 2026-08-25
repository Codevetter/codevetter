import { test, expect } from '@playwright/test';
import { ConsoleErrorCollector, navigateTo, waitForNoSpinners, showNavBar } from './helpers';

test.describe('Smoke tests', () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
  });

  test.afterEach(() => {
    consoleErrors.assertNoErrors();
  });

  // ─── Page load tests ────────────────────────────────────────────────────

  test('Home page loads without errors', async ({ page }) => {
    await navigateTo(page, '/');
    await waitForNoSpinners(page);

    await expect(page.getByRole('button', { name: 'Search commands' })).toBeVisible();
    await expect(page.getByText('Claude + Codex + Grok, plus Devin')).toBeVisible();
    await expect(page.getByText('Provider telemetry')).toBeVisible();
  });

  test('local usage is sourced from ccusage plus Devin tracking', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('onboarding_complete', 'true');
      const responses: Record<string, unknown> = {
        get_resource_snapshot: {
          sampled_at: '2026-08-10T17:35:09Z',
          self_pid: 1,
          cpu_percent: 2,
          cpu_count: 8,
          ram_bytes: 120_000_000,
          disk_read_per_sec: 0,
          disk_write_per_sec: 0,
          gpu_percent: null,
          net_in_per_sec: null,
          net_out_per_sec: null,
          children: [],
        },
        get_local_usage_report: {
          status: 'ready',
          stale: false,
          error: null,
          provenance: {
            engine: 'ccusage',
            version: '20.0.20',
            generated_at: '2026-08-16T17:35:09Z',
            timezone: 'Asia/Kolkata',
            window: 'all',
            detected_agents: ['claude', 'codex'],
            excluded_agents: ['grok'],
            codex_roots: [],
            source_fingerprint: 'sha256:fixture',
            pricing_complete: true,
            fallback_models: [],
            unpriced_models: [],
          },
          daily: [
            {
              period: '2026-08-16',
              totals: {
                input_tokens: 10,
                cache_creation_tokens: 0,
                cache_read_tokens: 20,
                output_tokens: 5,
                total_tokens: 35,
                cost_usd: 4,
              },
              agents: [
                {
                  agent: 'claude',
                  totals: {
                    input_tokens: 4,
                    cache_creation_tokens: 0,
                    cache_read_tokens: 5,
                    output_tokens: 1,
                    total_tokens: 10,
                    cost_usd: 1,
                  },
                  models: [],
                },
                {
                  agent: 'codex',
                  totals: {
                    input_tokens: 6,
                    cache_creation_tokens: 0,
                    cache_read_tokens: 15,
                    output_tokens: 4,
                    total_tokens: 25,
                    cost_usd: 3,
                  },
                  models: [],
                },
              ],
              models: [],
            },
          ],
          weekly: [],
          monthly: [],
          sessions: [],
          totals: {
            input_tokens: 10,
            cache_creation_tokens: 0,
            cache_read_tokens: 20,
            output_tokens: 5,
            total_tokens: 35,
            cost_usd: 4,
          },
        },
        detect_provider_accounts: { accounts: [] },
        list_provider_accounts: [],
        list_repo_projects: [],
        get_devin_usage_by_day: [
          { date: '2026-08-16', agent_type: 'devin', generated: 3, cache: 0, cost: 1 },
        ],
        get_devin_usage_breakdown: [
          {
            agent_type: 'devin',
            sessions: 1,
            real_input_tokens: 2,
            cache_read_tokens: 0,
            output_tokens: 1,
            week_real_input_tokens: 2,
            week_output_tokens: 1,
            cost: 1,
          },
        ],
        get_devin_usage_by_model: [],
        'plugin:event|listen': 1,
      };
      Object.assign(window as unknown as Record<string, unknown>, {
        __TAURI_INTERNALS__: {
          metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
          transformCallback: () => 1,
          unregisterCallback: () => undefined,
          invoke: async (command: string, args?: { key?: string }) => {
            if (command === 'get_preference') {
              return { key: args?.key, value: args?.key === 'onboarding_complete' ? 'true' : null };
            }
            return responses[command] ?? [];
          },
        },
      });
    });

    await navigateTo(page, '/');
    await expect(page.getByText('Claude + Codex + Grok, plus Devin')).toBeVisible();
    await expect(page.getByText('ccusage 20.0.20 · Devin separate')).toBeVisible();
    await expect(page.getByText('Local usage · ccusage · Devin separate')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Claude' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Codex' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Devin' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cursor' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Grok' })).toHaveCount(0);
  });

  test('Review page loads without errors', async ({ page }) => {
    await navigateTo(page, '/review');
    await waitForNoSpinners(page);

    await expect(page.getByRole('heading', { name: 'Review the change' })).toBeVisible();
  });

  test('Settings page loads without errors', async ({ page }) => {
    await navigateTo(page, '/settings');
    await waitForNoSpinners(page);

    await expect(page.locator('text=General').first()).toBeVisible();
  });

  // ─── Navigation bar tests ──────────────────────────────────────────────

  test('Primary navigation is visible with all product pillars and settings', async ({ page }) => {
    await navigateTo(page, '/');
    await showNavBar(page);

    const nav = page.locator('nav');
    await expect(nav).toBeVisible();

    // Product pillars plus the Settings utility.
    const links = nav.locator('[data-nav-destination]');
    await expect(links).toHaveCount(6);
    for (const label of ['Usage', 'Review', 'Testing', 'Performance', 'Repo Unpack', 'Settings']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(nav).not.toContainText('Evidence workbench');
    await expect(nav).not.toContainText('Review workspace');
    await expect(nav.getByText('Roadmap')).toHaveCount(0);
    await expect(nav.getByText('Now')).toHaveCount(0);
  });

  test('Nav bar highlights the active route', async ({ page }) => {
    await navigateTo(page, '/settings');
    await showNavBar(page);

    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  // ─── No console errors across all pages ────────────────────────────────

  test('No unexpected console errors on any page', async ({ page }) => {
    const routes = ['/', '/review', '/settings'];

    for (const route of routes) {
      await navigateTo(page, route);
      await waitForNoSpinners(page);
      await page.waitForTimeout(500);
    }
  });
});
