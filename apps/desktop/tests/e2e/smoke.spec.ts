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

    await expect(page.getByTestId('verification-spotlight')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Check a change' }).first()).toBeVisible();
    await expect(page.getByText('Verified Codex usage unavailable')).toBeVisible();
    await expect(page.getByText('All-agent period estimates')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Re-index & reconcile|Reconciling/ })
    ).toBeVisible();
    await expect(page.getByText('Provider telemetry')).toBeVisible();
  });

  test('Codex usage leads with verified partial coverage and bounded cost', async ({ page }) => {
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
        get_codex_usage_reconciliation: {
          scanner_revision: 4,
          verified_sessions: 842,
          legacy_estimated_sessions: 126,
          ambiguous_sessions: 7,
          missing_unestimated_sessions: 19,
          stale_sessions: 3,
          verified_totals: {
            input_tokens: 1_323_422_557,
            cache_read_tokens: 1_295_676_160,
            output_tokens: 4_098_792,
            reasoning_tokens: 921_443,
          },
          legacy_estimated_totals: {
            input_tokens: 91_000_000_000,
            cache_read_tokens: 0,
            output_tokens: 87_000_000,
            reasoning_tokens: 0,
          },
          legacy_estimated_cost_usd: 0,
          priced_exact_events: 0,
          priced_range_events: 4_832,
          unpriced_events: 11,
          verified_cost_min_microusd: 906_887_997,
          verified_cost_max_microusd: 1_813_775_994,
          pending_bytes: 284_103,
          observation_watermark: '2026-08-10T17:35:09Z',
        },
        get_token_usage_stats: {
          today: 0,
          this_week: 0,
          this_month: 0,
          this_year: 0,
          today_generated: 0,
          week_generated: 0,
          month_generated: 0,
          year_generated: 0,
          today_cost: 0,
          week_cost: 0,
          month_cost: 0,
          year_cost: 0,
          daily_series: [],
          weekly_series: [],
        },
        detect_provider_accounts: { accounts: [] },
        list_provider_accounts: [],
        list_repo_projects: [],
        get_agent_usage_by_day: [],
        get_usage_by_model: [],
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
    await expect(page.getByRole('heading', { name: 'Verified Codex compute' })).toBeVisible();
    await expect(page.getByText('Partial coverage', { exact: true })).toBeVisible();
    await expect(page.getByText('$907–$1,814 priced portion · 11 unpriced')).toBeVisible();
    await expect(
      page.getByText(/91\.00B historical input tokens remain legacy estimates/)
    ).toBeVisible();
    await expect(page.getByText('All-agent period estimates')).toBeVisible();
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
    await expect(links).toHaveCount(7);
    await expect(nav.getByTestId('check-change-action')).toBeVisible();
    for (const label of [
      'Usage',
      'Work',
      'Board',
      'Review',
      'Testing',
      'Repo Unpack',
      'Settings',
    ]) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
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
