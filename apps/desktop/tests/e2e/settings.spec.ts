import { test, expect } from '@playwright/test';
import { ConsoleErrorCollector, navigateTo, waitForNoSpinners } from './helpers';

test.describe('Settings page', () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
    await navigateTo(page, '/settings');
    await waitForNoSpinners(page);
  });

  test.afterEach(() => {
    consoleErrors.assertNoErrors();
  });

  // ─── General tab ──────────────────────────────────────────────────────

  test('General tab is selected by default and shows AI Provider section', async ({ page }) => {
    // "General" should be the active category
    await expect(page.locator('text=General').first()).toBeVisible();

    // AI Provider section heading
    await expect(page.getByRole('heading', { name: 'AI Provider' })).toBeVisible();
  });

  // ─── Provider dropdown ────────────────────────────────────────────────

  test('Can select AI provider from dropdown', async ({ page }) => {
    // The provider dropdown is a <select> with the Provider label
    const providerSelect = page
      .locator('select')
      .filter({ has: page.locator('option[value="anthropic"]') });
    await expect(providerSelect).toBeVisible();

    // Should default to "anthropic"
    await expect(providerSelect).toHaveValue('anthropic');

    // Change to OpenAI
    await providerSelect.selectOption('openai');
    await expect(providerSelect).toHaveValue('openai');

    // Change to OpenRouter
    await providerSelect.selectOption('openrouter');
    await expect(providerSelect).toHaveValue('openrouter');

    // Change to Custom
    await providerSelect.selectOption('custom');
    await expect(providerSelect).toHaveValue('custom');

    // Custom gateway shows Base URL field
    await expect(page.locator('text=Base URL')).toBeVisible();
  });

  // ─── API key input ────────────────────────────────────────────────────

  test('Can enter API key', async ({ page }) => {
    // API Key input
    const apiKeyInput = page.locator('input[placeholder="sk-..."]');
    await expect(apiKeyInput).toBeVisible();

    await apiKeyInput.fill('sk-test-key-12345');
    await expect(apiKeyInput).toHaveValue('sk-test-key-12345');
  });

  // ─── Save config button ───────────────────────────────────────────────

  test('Save AI Config button is present', async ({ page }) => {
    const saveButton = page.locator('button', { hasText: 'Save AI Config' });
    await expect(saveButton).toBeVisible();
  });

  test('Save AI Config button is disabled without required fields', async ({ page }) => {
    // Without an API key, the save button should be disabled
    // (disabled state depends on !aiApiKey || !aiBaseUrl || !aiModel)
    const saveButton = page.locator('button', { hasText: 'Save AI Config' });
    await expect(saveButton).toBeDisabled();
  });

  // ─── Category sidebar navigation ─────────────────────────────────────

  test('Settings sidebar shows all categories', async ({ page }) => {
    const expectedCategories = [
      'General',
      'Appearance',
      'Integrations',
      'Agents',
      'Agent MCP',
      'Notifications',
      'Usage',
      'About',
    ];

    for (const category of expectedCategories) {
      await expect(page.locator('button', { hasText: category }).first()).toBeVisible();
    }
  });

  test('Can switch between settings categories', async ({ page }) => {
    // Click Appearance
    await page.locator('button', { hasText: 'Appearance' }).first().click();
    await expect(page.locator('text=Compact Mode')).toBeVisible();

    // Click Agents
    await page.locator('button', { hasText: 'Agents' }).first().click();
    // Agents section should have agent-related settings
    await expect(page.locator('text=/Default Adapter|Max Concurrent/').first()).toBeVisible();

    // Click back to General
    await page.locator('button', { hasText: 'General' }).first().click();
    await expect(page.getByRole('heading', { name: 'AI Provider' })).toBeVisible();
  });
});

test.describe('Agent MCP settings', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      const repoPath = '/tmp/codevetter-mcp-fixture';
      let enabled = false;
      let audit = [
        {
          id: 1,
          repo_id: 'repo_0123456789abcdef',
          server_session: 'session-1',
          operation: 'graph_query',
          status: 'ok',
          duration_ms: 2,
          result_count: 4,
          response_bytes: 800,
          created_at: '2026-07-13T00:00:00Z',
        },
      ];
      const settings = () => ({
        repo_id: enabled ? 'repo_0123456789abcdef' : null,
        enabled,
        indexed: true,
        indexed_head: 'abc123',
        current_head: 'abc123',
        stale: false,
        server_path: '/Applications/CodeVetter.app/Contents/MacOS/codevetter-mcp',
        client_config: enabled
          ? {
              mcpServers: {
                'codevetter-history': {
                  command: '/Applications/CodeVetter.app/Contents/MacOS/codevetter-mcp',
                  args: ['--database', '/tmp/codevetter.db', '--repo-id', 'repo_0123456789abcdef'],
                },
              },
            }
          : null,
        resource_kinds: ['repository', 'graph', 'release', 'evidence'],
        tool_names: ['graph_query', 'history_search'],
        redaction_rules: ['No arbitrary file reads', 'Sensitive paths remain opaque'],
        limits: { page_size: 100, response_bytes: 262144 },
        recent_audit: audit,
      });
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          if (cmd.startsWith('plugin:event|')) return cmd.endsWith('|listen') ? 1 : undefined;
          if (cmd === 'get_preference') {
            return {
              key: args?.key ?? '',
              value:
                args?.key === 'active_repo_path'
                  ? repoPath
                  : args?.key === 'onboarding_complete'
                    ? 'true'
                    : null,
            };
          }
          if (cmd === 'set_preference') return undefined;
          if (cmd === 'list_repo_projects') {
            return [
              {
                id: 'project-mcp',
                repo_path: repoPath,
                display_name: 'codevetter-mcp-fixture',
                first_opened_at: '2026-01-01T00:00:00Z',
                last_opened_at: '2026-07-13T00:00:00Z',
                last_unpack_at: null,
                last_intel_at: null,
                unpack_snapshot_count: 0,
                intel_snapshot_count: 0,
              },
            ];
          }
          if (cmd === 'get_mcp_repository_settings') return settings();
          if (cmd === 'set_mcp_repository_enabled') {
            enabled = Boolean(args?.enabled);
            return settings();
          }
          if (cmd === 'clear_mcp_access_audit') {
            const count = audit.length;
            audit = [];
            return count;
          }
          if (cmd === 'plugin:app|version') return '1.2.20';
          return undefined;
        },
      };
    });
    await navigateTo(page, '/settings?section=mcp');
    await waitForNoSpinners(page);
  });

  test('previews scope, enables explicitly, copies config, and clears audit', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Agent MCP' })).toBeVisible();
    await expect(page.getByText('Disabled', { exact: true })).toBeVisible();
    await expect(page.getByText('Recent accesses').locator('..').getByText('1')).toBeVisible();
    await expect(page.getByText('graph_query', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Enable' }).click();
    await expect(page.getByText('Enabled', { exact: true })).toBeVisible();
    await expect(page.getByText('repo_0123456789abcdef')).toBeVisible();
    await page.getByRole('button', { name: 'Copy config' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('codevetter-history');
    expect(clipboard).not.toContain('sk-');
    await page.getByRole('button', { name: 'Disable' }).click();
    await expect(page.getByText('Disabled', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy config' })).toBeDisabled();
    await page.getByRole('button', { name: 'Clear access audit' }).click();
    await expect(page.getByText('Recent accesses').locator('..').getByText('0')).toBeVisible();
  });
});
