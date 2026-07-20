import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { ConsoleErrorCollector, navigateTo } from './helpers';

async function installWorkMock(page: Page) {
  await page.addInitScript(() => {
    let items: Array<Record<string, unknown>> = [];
    const project = {
      id: 'project-1',
      repo_path: '/tmp/codevetter',
      display_name: 'codevetter',
      first_opened_at: '2026-07-20T00:00:00Z',
      last_opened_at: '2026-07-20T00:00:00Z',
      last_unpack_at: null,
      last_intel_at: null,
      unpack_snapshot_count: 0,
      intel_snapshot_count: 0,
    };
    const controlled = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
        transformCallback: () => number;
        unregisterCallback: () => void;
        callbacks: Record<string, unknown>;
      };
      __WORK_TEST__: {
        startRequests: Array<Record<string, unknown>>;
      };
    };
    const startAttempts = { codex: 0, claude: 0 };
    controlled.__WORK_TEST__ = { startRequests: [] };
    controlled.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args = {}) => {
        if (cmd === 'list_repo_projects') return [project];
        if (cmd === 'list_sessions' || cmd === 'list_agent_terminals') return [];
        if (cmd === 'get_codex_warp_plugin_status') {
          return {
            codex_available: true,
            marketplace_installed: false,
            warp_plugin_installed: false,
            warp_plugin_enabled: false,
            orchestration_plugin_installed: false,
            orchestration_plugin_enabled: false,
            structured_env_enabled: false,
            needs_install: true,
            codex_path: 'codex',
            marketplace_output: '',
            plugin_output: '',
            error: null,
          };
        }
        if (cmd === 'list_work_items') return items;
        if (cmd === 'start_agent_terminal') {
          const provider = args.provider === 'claude' ? 'claude' : 'codex';
          controlled.__WORK_TEST__.startRequests.push({ ...args });
          startAttempts[provider] += 1;
          if (startAttempts[provider] === 1) {
            const label = provider === 'claude' ? 'Claude' : 'Codex';
            throw new Error(`${label} CLI is unavailable`);
          }
          return {
            session_id: args.sessionId,
            provider,
            cwd: args.cwd,
            pid: provider === 'claude' ? 4202 : 4201,
          };
        }
        if (cmd === 'create_work_item') {
          const input = args.input as Record<string, unknown>;
          const now = new Date().toISOString();
          const item = {
            schema_version: 1,
            id: `work-${items.length + 1}`,
            title: input.title,
            description: input.description ?? null,
            acceptance_criteria: input.acceptance_criteria ?? null,
            project_path: input.project_path ?? null,
            workspace_id: null,
            status: 'plan',
            preferred_provider: input.preferred_provider ?? 'codex',
            assigned_agent: null,
            agent_terminal_id: null,
            agent_session_id: null,
            change_identity: null,
            review_id: null,
            review_score: null,
            review_attempts: 0,
            verification_run_id: null,
            verification_status: 'missing',
            completion_disposition: null,
            attention: false,
            created_at: now,
            updated_at: now,
          };
          items = [item];
          return item;
        }
        if (cmd === 'transition_work_item') {
          const id = String(args.id);
          const status = String(args.status);
          items = items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status,
                  completion_disposition: args.completionDisposition ?? null,
                  updated_at: new Date().toISOString(),
                }
              : item
          );
          return items.find((item) => item.id === id);
        }
        if (cmd.startsWith('plugin:event|')) return 1;
        return undefined;
      },
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
      callbacks: {},
    };
  });
}

test.describe('Work surface', () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
    await installWorkMock(page);
    await navigateTo(page, '/agents');
  });

  test.afterEach(() => consoleErrors.assertNoErrors());

  test('starts calm, creates local work, and moves it with an accessible action', async ({
    page,
  }) => {
    await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible();
    await page.getByRole('tab', { name: 'Board' }).click();
    await page.getByRole('button', { name: 'New work' }).click();
    await page.getByLabel('Outcome').fill('Ship the native Work surface');
    await page.getByLabel('Acceptance criteria').fill('Conversation and board both work');
    await page.getByRole('button', { name: 'Create work' }).click();

    await expect(page.getByText('Ship the native Work surface')).toBeVisible();
    const moveRight = page.getByRole('button', {
      name: 'Move Ship the native Work surface right',
    });
    await moveRight.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Build work items' })).toContainText(
      'Ship the native Work surface'
    );

    await page
      .locator('#work-card-work-1')
      .dragTo(page.getByRole('region', { name: 'Review work items' }));
    await expect(page.getByRole('region', { name: 'Review work items' })).toContainText(
      'Ship the native Work surface'
    );

    await page.getByRole('link', { name: 'Usage' }).click();
    await page.getByRole('link', { name: 'Work' }).click();
    await expect(page.getByRole('region', { name: 'Review work items' })).toContainText(
      'Ship the native Work surface'
    );

    await page.setViewportSize({ width: 1024, height: 720 });
    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);

    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious'
      )
    ).toEqual([]);
  });

  for (const provider of ['codex', 'claude'] as const) {
    const label = provider === 'claude' ? 'Claude' : 'Codex';
    const otherLabel = provider === 'claude' ? 'Codex' : 'Claude';

    test(`${label} selection keeps launch, failure, and recovery provider-specific`, async ({
      page,
    }) => {
      await page.getByRole('button', { name: provider, exact: true }).click();
      await expect(page.getByRole('button', { name: `Start ${label}`, exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: `Start ${otherLabel}`, exact: true })
      ).toHaveCount(0);

      await page
        .getByPlaceholder('Describe the change, bug, or question…')
        .fill(`Verify the ${label} launch path`);
      await page.getByRole('button', { name: `Start ${label}`, exact: true }).click();

      const session = page.getByLabel(`${label} work session`);
      await expect(session).toBeVisible();
      await expect(session).toContainText(`${label} CLI is unavailable`);
      await expect(
        session.getByRole('button', { name: `Restart ${label} agent`, exact: true })
      ).toBeVisible();
      await expect(
        session.getByRole('button', { name: `Restart ${otherLabel} agent`, exact: true })
      ).toHaveCount(0);

      await session.getByRole('button', { name: `Restart ${label} agent`, exact: true }).click();
      await expect(session.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();

      const startRequests = await page.evaluate(
        () =>
          (
            window as unknown as {
              __WORK_TEST__: { startRequests: Array<Record<string, unknown>> };
            }
          ).__WORK_TEST__.startRequests
      );
      expect(startRequests).toHaveLength(2);
      expect(startRequests.map((request) => request.provider)).toEqual([provider, provider]);
      expect(startRequests.map((request) => request.prompt)).toEqual([
        `Verify the ${label} launch path`,
        `Verify the ${label} launch path`,
      ]);
    });
  }
});
