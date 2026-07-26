import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { ConsoleErrorCollector, navigateTo } from './helpers';

async function installWorkMock(page: Page, withLiveSessions = false) {
  await page.addInitScript((liveSessions) => {
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
    const secondProject = {
      ...project,
      id: 'project-2',
      repo_path: '/tmp/knowledge-base',
      display_name: 'Knowledge Base',
    };
    const controlled = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
        transformCallback: (callback?: (event: unknown) => void) => number;
        unregisterCallback: () => void;
        unregisterListener: () => void;
        callbacks: Record<number, (event: unknown) => void>;
      };
      __WORK_TEST__: {
        startRequests: Array<Record<string, unknown>>;
        inputRequests: Array<Record<string, unknown>>;
        stopRequests: Array<Record<string, unknown>>;
        attachRequests: Array<Record<string, unknown>>;
        directoryRequests: string[][];
        transcriptRequests: string[];
        emitTerminalEvent: (payload: Record<string, unknown>) => void;
        hasAgentListener: () => boolean;
      };
    };
    const startAttempts = { codex: 0, claude: 0 };
    const callbacks: Record<number, (event: unknown) => void> = {};
    const listeners: Record<string, number[]> = {};
    let nextCallbackId = 1;
    controlled.__WORK_TEST__ = {
      startRequests: [],
      inputRequests: [],
      stopRequests: [],
      attachRequests: [],
      directoryRequests: [],
      transcriptRequests: [],
      emitTerminalEvent: (payload) => {
        for (const callbackId of listeners['agent-terminal-event'] ?? []) {
          callbacks[callbackId]?.({ event: 'agent-terminal-event', payload });
        }
      },
      hasAgentListener: () => (listeners['agent-terminal-event']?.length ?? 0) > 0,
    };
    controlled.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args = {}) => {
        if (cmd === 'list_repo_projects') return [project, secondProject];
        if (cmd === 'list_agent_terminals') {
          if (!liveSessions) return [];
          return [
            {
              session_id: 'live-codex',
              provider: 'codex',
              cwd: '/tmp/codevetter',
              pid: 5101,
              started_at_ms: Date.now(),
              running: true,
              output_tail: '',
              codex_session_id: 'codex-live-provider-session',
            },
            {
              session_id: 'live-claude',
              provider: 'claude',
              cwd: '/tmp/knowledge-base',
              pid: 5102,
              started_at_ms: Date.now(),
              running: true,
              output_tail: '',
              codex_session_id: 'claude-live-provider-session',
            },
          ];
        }
        if (cmd === 'list_sessions') {
          if (args.agentType === 'claude-code') {
            return {
              sessions: [
                {
                  id: 'historical-session-2',
                  project_id: 'project-2',
                  agent_type: 'claude-code',
                  jsonl_path: null,
                  git_branch: 'main',
                  cwd: '/tmp/knowledge-base',
                  cli_version: null,
                  first_message: 'Explain repo history',
                  last_message: '2026-07-20T02:00:00Z',
                  message_count: 8,
                  total_input_tokens: 90,
                  total_output_tokens: 30,
                  cache_read_tokens: 0,
                  cache_creation_tokens: 0,
                  compaction_count: 0,
                  estimated_cost_usd: 0,
                  model_used: 'claude-sonnet-4-5',
                  slug: null,
                  file_size_bytes: 900,
                  indexed_at: '2026-07-20T02:00:00Z',
                  file_mtime: '2026-07-20T02:00:00Z',
                },
                {
                  id: 'missing-session',
                  project_id: 'project-deleted',
                  agent_type: 'claude-code',
                  jsonl_path: null,
                  git_branch: 'main',
                  cwd: '/tmp/deleted-project',
                  cli_version: null,
                  first_message: 'Deleted checkout thread',
                  last_message: '2026-07-20T03:00:00Z',
                  message_count: 4,
                  total_input_tokens: 50,
                  total_output_tokens: 10,
                  cache_read_tokens: 0,
                  cache_creation_tokens: 0,
                  compaction_count: 0,
                  estimated_cost_usd: 0,
                  model_used: 'claude-sonnet-4-5',
                  slug: null,
                  file_size_bytes: 500,
                  indexed_at: '2026-07-20T03:00:00Z',
                  file_mtime: '2026-07-20T03:00:00Z',
                },
              ],
            };
          }
          return {
            sessions: [
              {
                id: 'historical-session-1',
                project_id: 'project-1',
                agent_type: 'codex',
                jsonl_path: null,
                git_branch: 'main',
                cwd: '/tmp/codevetter',
                cli_version: null,
                first_message: 'Fix the Work attachment regression',
                last_message: '2026-07-20T01:00:00Z',
                message_count: 12,
                total_input_tokens: 100,
                total_output_tokens: 40,
                cache_read_tokens: 0,
                cache_creation_tokens: 0,
                compaction_count: 0,
                estimated_cost_usd: 0,
                model_used: 'gpt-5',
                slug: null,
                file_size_bytes: 1000,
                indexed_at: '2026-07-20T01:00:00Z',
                file_mtime: '2026-07-20T01:00:00Z',
              },
              ...(liveSessions
                ? [
                    {
                      id: 'codex-live-provider-session',
                      project_id: 'project-1',
                      agent_type: 'codex',
                      jsonl_path: null,
                      git_branch: 'main',
                      cwd: '/tmp/codevetter',
                      cli_version: null,
                      first_message: 'Duplicate live Codex',
                      last_message: '2026-07-20T04:00:00Z',
                      message_count: 20,
                      total_input_tokens: 120,
                      total_output_tokens: 60,
                      cache_read_tokens: 0,
                      cache_creation_tokens: 0,
                      compaction_count: 0,
                      estimated_cost_usd: 0,
                      model_used: 'gpt-5',
                      slug: null,
                      file_size_bytes: 1200,
                      indexed_at: '2026-07-20T04:00:00Z',
                      file_mtime: '2026-07-20T04:00:00Z',
                    },
                  ]
                : []),
            ],
          };
        }
        if (cmd === 'check_directories_exist') {
          const paths = args.paths as string[];
          controlled.__WORK_TEST__.directoryRequests.push(paths);
          return paths.map((path) => ({
            path,
            exists: path !== '/tmp/deleted-project',
          }));
        }
        if (cmd === 'get_session_transcript') {
          const sessionId = String(args.sessionId);
          controlled.__WORK_TEST__.transcriptRequests.push(sessionId);
          const claude = sessionId === 'historical-session-2';
          return {
            session_id: sessionId,
            messages: [
              {
                id: `${sessionId}-user`,
                message_index: 0,
                role: 'user',
                kind: 'message',
                timestamp: '2026-07-20T01:00:00Z',
                content_text: claude
                  ? 'Explain how this repository changed over time.'
                  : 'Fix the Work attachment regression.',
                content_truncated: false,
                tool_name: null,
              },
              {
                id: `${sessionId}-assistant`,
                message_index: 1,
                role: 'assistant',
                kind: 'message',
                timestamp: '2026-07-20T01:01:00Z',
                content_text: claude
                  ? 'I traced the major releases and their motivations.'
                  : 'I found and corrected the stale attachment identity.',
                content_truncated: false,
                tool_name: null,
              },
            ],
            total_messages: 2,
            truncated: false,
          };
        }
        if (cmd === 'list_reviews') return { reviews: [] };
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
        if (cmd === 'stop_agent_terminal') {
          controlled.__WORK_TEST__.stopRequests.push({ ...args });
          const payload = {
            session_id: args.sessionId,
            kind: 'exit',
            data: 'Stopped by user',
            exit_code: 1,
            success: true,
            intentional_stop: true,
          };
          queueMicrotask(() => {
            for (const callbackId of listeners['agent-terminal-event'] ?? []) {
              callbacks[callbackId]?.({ event: 'agent-terminal-event', payload });
            }
          });
          return undefined;
        }
        if (cmd === 'send_agent_terminal_input') {
          controlled.__WORK_TEST__.inputRequests.push({ ...args });
          return undefined;
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
        if (cmd === 'attach_work_item_session') {
          controlled.__WORK_TEST__.attachRequests.push({ ...args });
          const id = String(args.id);
          const input = args.input as Record<string, unknown>;
          items = items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  preferred_provider: input.provider,
                  agent_terminal_id: input.terminal_id ?? null,
                  agent_session_id: input.session_id ?? null,
                  updated_at: new Date().toISOString(),
                }
              : item
          );
          return items.find((item) => item.id === id);
        }
        if (cmd === 'plugin:event|listen') {
          const event = String(args.event);
          const callbackId = Number(args.handler);
          listeners[event] = [...(listeners[event] ?? []), callbackId];
          return callbackId;
        }
        if (cmd.startsWith('plugin:event|')) return 1;
        return undefined;
      },
      transformCallback: (callback) => {
        const id = nextCallbackId++;
        if (callback) callbacks[id] = callback;
        return id;
      },
      unregisterCallback: () => undefined,
      unregisterListener: () => undefined,
      callbacks,
    };
    (
      window as unknown as {
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => void };
      }
    ).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
  }, withLiveSessions);
}

test.describe('Work surface', () => {
  const consoleErrors = new ConsoleErrorCollector();

  test.beforeEach(async ({ page }, testInfo) => {
    consoleErrors.reset();
    consoleErrors.attach(page);
    await installWorkMock(
      page,
      testInfo.title.includes('focuses live runs') ||
        testInfo.title.includes('opens with existing conversations') ||
        testInfo.title.includes('groups runs') ||
        testInfo.title.includes('pre-fills verified history') ||
        testInfo.title.includes('reviews confirmed approval') ||
        testInfo.title.includes('surfaces confirmed') ||
        testInfo.title.includes('archives a live run')
    );
    await navigateTo(page, '/agents');
  });

  test.afterEach(() => consoleErrors.assertNoErrors());

  test('anchors the run navigator to the left edge and lets the user collapse it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });

    const sidebar = page.getByRole('complementary', { name: 'Run navigator' });
    await expect(sidebar).toBeVisible();
    const bounds = await sidebar.boundingBox();

    expect(bounds).not.toBeNull();
    expect(bounds?.x).toBeLessThanOrEqual(32);
    expect(bounds?.width).toBe(252);

    await sidebar.getByRole('button', { name: 'Collapse run navigator' }).click();
    await expect(page.getByRole('button', { name: 'Open run navigator' })).toBeVisible();
    const collapsedBounds = await page
      .getByRole('complementary', { name: 'Run navigator' })
      .boundingBox();
    expect(collapsedBounds?.width).toBe(42);
  });

  test('opens with existing conversations unselected and makes starting explicit', async ({
    page,
  }) => {
    const sidebar = page.getByRole('complementary', { name: 'Run navigator' });

    await expect(page.getByRole('heading', { name: 'What outcome do you need?' })).toBeVisible();
    await expect(sidebar.getByText('Active', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Recent', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Previous', { exact: true }).first()).toBeVisible();
    await expect(sidebar.locator('[data-agent-provider-mark="codex"]').first()).toBeVisible();
    await expect(sidebar.locator('[data-agent-provider-mark="claude"]').first()).toBeVisible();

    await sidebar.getByRole('button', { name: /Open Codex run/ }).click();
    await expect(page.getByLabel('Codex work session')).toBeVisible();

    await sidebar.getByRole('button', { name: 'New outcome' }).click();
    await expect(page.getByRole('heading', { name: 'What outcome do you need?' })).toBeVisible();
    await page.getByLabel('Outcome').fill('Start a clean Claude conversation');
    await page.getByLabel('Implementation provider').selectOption('claude');
    await page.getByRole('button', { name: 'Start agent', exact: true }).click();

    await expect(page.getByLabel('Claude work session')).toBeVisible();
    const startRequests = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WORK_TEST__: { startRequests: Array<Record<string, unknown>> };
          }
        ).__WORK_TEST__.startRequests
    );
    expect(startRequests).toHaveLength(1);
    expect(startRequests[0]).toMatchObject({
      provider: 'claude',
      roleLabel: 'Implementation',
      sandbox: 'workspace-write',
    });
    expect(String(startRequests[0].prompt)).toContain(
      'Shared outcome: Start a clean Claude conversation'
    );
  });

  test('confirms one writer, launches actionable specialists once, and saves later assurance', async ({
    page,
  }) => {
    await page
      .getByLabel('Outcome')
      .fill('Redesign the Work sidebar UI and prove browser release safety');

    const team = page.getByLabel('Recommended agent team');
    await expect(team).toContainText('Implementation');
    await expect(team).toContainText('Product UX');
    await expect(team).toContainText('Assurance');
    await expect(team.getByText('Can edit', { exact: true })).toHaveCount(1);
    await expect(team.getByText('Read-only', { exact: true })).toHaveCount(2);
    await expect(page.getByLabel('Include Assurance')).toBeChecked();
    await page.getByLabel('Product UX provider').selectOption('claude');

    const confirm = page.getByRole('button', { name: 'Start 2 agents', exact: true });
    await expect(confirm).toBeEnabled();
    await confirm.evaluate((button) => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await expect(page.getByLabel('Implementation queued agent')).toHaveCount(0);
    const requests = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WORK_TEST__: { startRequests: Array<Record<string, unknown>> };
          }
        ).__WORK_TEST__.startRequests
    );
    expect(requests).toHaveLength(2);
    expect(new Set(requests.map((request) => request.sessionId)).size).toBe(2);
    expect(requests.map((request) => request.roleLabel)).toEqual(['Implementation', 'Product UX']);
    expect(requests.map((request) => request.sandbox)).toEqual(['workspace-write', 'read-only']);
    expect(requests[0].teamId).toBeTruthy();
    expect(requests[1].teamId).toBe(requests[0].teamId);

    const navigator = page.getByRole('complementary', { name: 'Run navigator' });
    const recent = navigator.getByRole('group', { name: 'Recent runs' });
    await expect(recent).toContainText('Assurance');
    await expect(recent).toContainText('Queued');
    await recent.getByRole('button', { name: /Open Assurance Codex run/ }).click();
    const queued = page.getByLabel('Assurance queued agent');
    await expect(queued).toContainText('has not started');

    await page.reload();
    await expect(page.getByRole('complementary', { name: 'Run navigator' })).toContainText(
      'Assurance'
    );
    await page
      .getByRole('complementary', { name: 'Run navigator' })
      .getByRole('button', { name: /Open Assurance Codex run/ })
      .click();
    await page.getByRole('button', { name: 'Start Assurance', exact: true }).click();

    const afterLaterStart = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WORK_TEST__: { startRequests: Array<Record<string, unknown>> };
          }
        ).__WORK_TEST__.startRequests
    );
    expect(afterLaterStart).toHaveLength(1);
    expect(afterLaterStart[0]).toMatchObject({
      roleLabel: 'Assurance',
      sandbox: 'read-only',
      teamId: requests[0].teamId,
    });
  });

  test('requires a known repository before confirming more than one role', async ({ page }) => {
    await page.getByLabel('Outcome').fill('Redesign this UI and audit release safety');
    await page.getByLabel('Conversation repository').selectOption('');

    await expect(
      page.getByText('Choose a known repository before confirming more than one agent.')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start 2 agents', exact: true })).toBeDisabled();

    await page.getByLabel('Include Assurance').uncheck();
    await page.getByLabel('Include Product UX').uncheck();
    await expect(page.getByRole('button', { name: 'Start agent', exact: true })).toBeEnabled();
  });

  test('groups runs by operational state and prioritizes attention', async ({ page }) => {
    const sidebar = page.getByRole('complementary', { name: 'Run navigator' });
    const active = sidebar.getByRole('group', { name: 'Active runs' });

    await expect(active).toContainText('Codex');
    await expect(active).toContainText('Claude');
    await expect(active).toContainText('Working');
    await expect(active).toContainText('codevetter');
    await expect(active).toContainText('knowledge-base');

    await page.getByLabel('Search runs').fill('knowledge-base');
    await expect(active).toContainText('Claude');
    await expect(active).not.toContainText('Codex');
    await page.getByLabel('Search runs').fill('');

    await active.getByRole('button', { name: /Open Claude run/ }).click();
    await page.waitForFunction(() =>
      (
        window as unknown as {
          __WORK_TEST__: { hasAgentListener: () => boolean };
        }
      ).__WORK_TEST__.hasAgentListener()
    );
    await page.evaluate(() => {
      (
        window as unknown as {
          __WORK_TEST__: { emitTerminalEvent: (payload: Record<string, unknown>) => void };
        }
      ).__WORK_TEST__.emitTerminalEvent({
        session_id: 'live-claude',
        kind: 'agent_event',
        data: JSON.stringify({
          agent: 'claude',
          event: 'question_asked',
          summary: 'Which approach should I use?',
        }),
        seq: 1,
      });
    });

    const attention = sidebar.getByRole('group', { name: 'Needs attention runs' });
    await expect(attention).toContainText('Claude');
    await expect(attention).toContainText('Needs help');
    await page.getByLabel('Search runs').fill('Needs help');
    await expect(attention).toBeVisible();
    await expect(sidebar.getByRole('group', { name: 'Active runs' })).toHaveCount(0);
    await page.getByLabel('Search runs').fill('');

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(sidebar.getByRole('group', { name: 'Recent runs' })).toContainText('Paused');

    const results = await new AxeBuilder({ page })
      .include('[aria-label="Run navigator"]')
      .analyze();
    expect(
      results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious'
      )
    ).toEqual([]);
  });

  test('previews verified history before an explicit resume', async ({ page }) => {
    const sidebar = page.getByRole('complementary', { name: 'Run navigator' });
    const recent = sidebar.getByRole('group', { name: 'Recent runs' });
    const recentDisclosure = recent.getByRole('button', { name: /Recent/ });
    const claudeHistory = recent.getByRole('button', {
      name: 'Open Claude previous conversation Explain repo history',
    });

    await expect(
      recent.getByRole('button', {
        name: 'Open Codex previous conversation Fix the Work attachment regression',
      })
    ).toBeVisible();
    await expect(claudeHistory).toBeVisible();
    await expect(sidebar.getByText('Deleted checkout thread')).toHaveCount(0);
    await expect(sidebar.getByText('Duplicate live Codex')).toHaveCount(0);

    const initialState = await page.evaluate(() => {
      const testState = (
        window as unknown as {
          __WORK_TEST__: {
            directoryRequests: string[][];
            startRequests: Array<Record<string, unknown>>;
          };
        }
      ).__WORK_TEST__;
      return {
        directoryRequests: testState.directoryRequests,
        startRequests: testState.startRequests,
      };
    });
    expect(initialState.directoryRequests).toEqual([
      ['/tmp/codevetter', '/tmp/deleted-project', '/tmp/knowledge-base'],
    ]);
    expect(initialState.startRequests).toEqual([]);

    await expect(recentDisclosure).toHaveAttribute('aria-expanded', 'true');
    await recentDisclosure.click();
    await expect(recentDisclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(claudeHistory).toHaveCount(0);

    await page.getByLabel('Search runs').fill('Explain repo history');
    await expect(recentDisclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(claudeHistory).toBeVisible();
    await page.getByLabel('Search runs').fill('');
    await expect(recentDisclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(claudeHistory).toHaveCount(0);

    await recentDisclosure.click();
    await claudeHistory.click();
    await expect(page.getByLabel('Previous conversation preview')).toBeVisible();
    await expect(
      page.getByText('Explain how this repository changed over time.', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('I traced the major releases and their motivations.', { exact: true })
    ).toBeVisible();

    const previewState = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WORK_TEST__: {
              startRequests: Array<Record<string, unknown>>;
              transcriptRequests: string[];
            };
          }
        ).__WORK_TEST__
    );
    expect(previewState.transcriptRequests.length).toBeGreaterThan(0);
    expect(new Set(previewState.transcriptRequests)).toEqual(new Set(['historical-session-2']));
    expect(previewState.startRequests).toEqual([]);

    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    const startRequestsAfterResume = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WORK_TEST__: { startRequests: Array<Record<string, unknown>> };
          }
        ).__WORK_TEST__.startRequests
    );
    expect(startRequestsAfterResume).toHaveLength(1);
    expect(startRequestsAfterResume[0]).toMatchObject({
      provider: 'claude',
      cwd: '/tmp/knowledge-base',
      resumeSessionId: 'historical-session-2',
      roleLabel: null,
      teamId: null,
    });

    const results = await new AxeBuilder({ page })
      .include('[aria-label="Run navigator"]')
      .analyze();
    expect(
      results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious'
      )
    ).toEqual([]);
  });

  test('starts calm, creates local work, and moves it with an accessible action', async ({
    page,
  }) => {
    await expect(page.getByRole('heading', { name: 'What outcome do you need?' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Board' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Board' }).click();
    await expect(page).toHaveURL(/\/board$/);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
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
    await page.getByRole('link', { name: 'Board' }).click();
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

  test('keeps managed work explicit and usable when additive evidence is unavailable', async ({
    page,
  }) => {
    await page.getByRole('link', { name: 'Board' }).click();
    await page.getByRole('button', { name: 'New work' }).click();
    await page.getByLabel('Outcome').fill('Qualify an isolated managed run');
    await page.getByRole('button', { name: 'Create work' }).click();
    await page.getByRole('button', { name: 'Managed', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Managed work' })).toBeVisible();
    await expect(page.getByText('Publishing is never automatic.')).toBeVisible();
    await expect(page.getByLabel('Codex profile')).toHaveValue('');
    await expect(page.getByLabel('Codex profile')).toContainText('No usable profile found');
    await expect(page.getByRole('button', { name: 'Create isolated run' })).toBeDisabled();

    await page.setViewportSize({ width: 800, height: 650 });
    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  });

  test('attaches historical evidence without launching another agent', async ({ page }) => {
    await page.getByRole('link', { name: 'Board' }).click();
    await page.getByRole('button', { name: 'New work' }).click();
    await page.getByLabel('Outcome').fill('Connect existing evidence');
    await page.getByLabel('Existing agent run').selectOption('history:codex:historical-session-1');
    await page.getByRole('button', { name: 'Create work' }).click();

    await page.getByText('Connect existing evidence').click();
    await expect(page.getByLabel('Existing agent run')).toHaveValue(
      'history:codex:historical-session-1'
    );
    await expect(page.getByText('Attaching records this run as evidence.')).toBeVisible();

    const startRequests = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WORK_TEST__: { startRequests: Array<Record<string, unknown>> };
          }
        ).__WORK_TEST__.startRequests
    );
    expect(startRequests).toEqual([]);
  });

  test('routes one board item through Work, Review, Testing, and Repo Unpack', async ({ page }) => {
    await page.getByRole('link', { name: 'Board' }).click();
    await page.getByRole('button', { name: 'New work' }).click();
    await page.getByLabel('Outcome').fill('Qualify the shared handoffs');
    await page
      .getByLabel('Acceptance criteria')
      .fill('Every specialist receives repository context');
    await page.getByRole('button', { name: 'Create work' }).click();

    await page
      .getByRole('button', { name: 'Understand Qualify the shared handoffs in Repo Unpack' })
      .click();
    await expect(page).toHaveURL(/\/unpack\?repo=%2Ftmp%2Fcodevetter$/);

    await page.getByRole('link', { name: 'Board' }).click();
    await page.getByRole('button', { name: 'Move Qualify the shared handoffs right' }).click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page).toHaveURL(/\/agents$/);
    await expect(page.getByLabel('Outcome')).toHaveValue(/Work item: Qualify the shared handoffs/);

    await page.getByRole('link', { name: 'Board' }).click();
    await page.getByRole('button', { name: 'Move Qualify the shared handoffs right' }).click();
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page).toHaveURL(/\/review\?project=%2Ftmp%2Fcodevetter$/);

    await page.getByRole('link', { name: 'Board' }).click();
    await page.getByRole('button', { name: 'Move Qualify the shared handoffs right' }).click();
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(page).toHaveURL(/\/trex\?project=%2Ftmp%2Fcodevetter$/);
  });

  test('links a Board item only to the primary writer in a confirmed team', async ({ page }) => {
    await page.getByRole('link', { name: 'Board' }).click();
    await page.getByRole('button', { name: 'New work' }).click();
    await page
      .getByLabel('Outcome')
      .fill('Redesign the Work sidebar UI and prove browser release safety');
    await page.getByRole('button', { name: 'Create work' }).click();
    await page
      .getByRole('button', {
        name: 'Move Redesign the Work sidebar UI and prove browser release safety right',
      })
      .click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();

    await expect(page.getByLabel('Recommended agent team')).toContainText('Product UX');
    await page.getByRole('button', { name: 'Start 2 agents', exact: true }).click();

    const implementation = page.getByLabel('Codex work session');
    await expect(implementation).toContainText('Codex CLI is unavailable');
    await implementation.getByRole('button', { name: 'Restart Codex agent', exact: true }).click();

    const navigator = page.getByRole('complementary', { name: 'Run navigator' });
    await navigator.getByRole('button', { name: /Open Product UX Claude run/ }).click();
    const productUx = page.getByLabel('Claude work session');
    await expect(productUx).toContainText('Claude CLI is unavailable');
    await productUx.getByRole('button', { name: 'Restart Claude agent', exact: true }).click();

    const state = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WORK_TEST__: {
              attachRequests: Array<Record<string, unknown>>;
              startRequests: Array<Record<string, unknown>>;
            };
          }
        ).__WORK_TEST__
    );
    expect(state.startRequests).toHaveLength(4);
    expect(state.attachRequests).toHaveLength(1);
    expect(state.attachRequests[0].input).toMatchObject({
      provider: 'codex',
      terminal_id: state.startRequests[0].sessionId,
    });
  });

  test('focuses live runs and attaches one without restarting it', async ({ page }) => {
    const conversations = page.getByRole('navigation', { name: 'Runs' });
    const claudeRun = conversations.getByRole('button', { name: /Open Claude run/ });
    await expect(conversations).toBeVisible();
    await page.getByLabel('Search runs').fill('Claude');
    await expect(claudeRun).toBeVisible();
    await expect(conversations.getByRole('button', { name: /Open Codex run/ })).toHaveCount(0);
    await page.getByLabel('Search runs').fill('');
    await claudeRun.click();
    await expect(page.getByLabel('Claude work session')).toBeVisible();

    await page.getByRole('link', { name: 'Board' }).click();
    await expect(page).toHaveURL(/\/board$/);
    await page.getByRole('button', { name: 'New work' }).click();
    await page.getByLabel('Outcome').fill('Attach the live Claude run');
    await page.getByLabel('Repository').selectOption('/tmp/knowledge-base');
    await page.getByLabel('Existing agent run').selectOption('terminal:live-claude');
    await page.getByRole('button', { name: 'Create work' }).click();
    await expect(page.getByText('claude active')).toBeVisible();

    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page).toHaveURL(/\/agents$/);
    await expect(page.getByLabel('Claude work session')).toBeVisible();
    await expect(claudeRun).toHaveAttribute('aria-current', 'page');

    const startRequests = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WORK_TEST__: { startRequests: Array<Record<string, unknown>> };
          }
        ).__WORK_TEST__.startRequests
    );
    expect(startRequests).toEqual([]);

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByText('Claude stopped. This session can be resumed.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);

    await conversations.getByRole('button', { name: /Archive Claude run/ }).click();
    await expect(claudeRun).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'What outcome do you need?' })).toBeVisible();
    await expect(page.getByLabel('Codex work session')).toHaveCount(0);
  });

  test('archives a live run only after stopping its owned process', async ({ page }) => {
    const conversations = page.getByRole('navigation', { name: 'Runs' });
    await conversations.getByRole('button', { name: /Open Codex run/ }).click();
    await conversations.getByRole('button', { name: /Archive Codex run/ }).click();

    await expect(conversations.getByRole('button', { name: /Open Codex run/ })).toHaveCount(0);
    const stopRequests = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WORK_TEST__: { stopRequests: Array<Record<string, unknown>> };
          }
        ).__WORK_TEST__.stopRequests
    );
    expect(stopRequests).toContainEqual({ sessionId: 'live-codex' });
  });

  test('reviews confirmed approval evidence without approving it', async ({ page }) => {
    await page
      .getByRole('navigation', { name: 'Runs' })
      .getByRole('button', { name: /Open Codex run/ })
      .click();
    await page.waitForFunction(() =>
      (
        window as unknown as {
          __WORK_TEST__: { hasAgentListener: () => boolean };
        }
      ).__WORK_TEST__.hasAgentListener()
    );
    await page.evaluate(() => {
      (
        window as unknown as {
          __WORK_TEST__: { emitTerminalEvent: (payload: Record<string, unknown>) => void };
        }
      ).__WORK_TEST__.emitTerminalEvent({
        session_id: 'live-codex',
        kind: 'agent_event',
        data: JSON.stringify({
          agent: 'codex',
          event: 'permission_request',
          summary: 'Allow a shell command?',
        }),
        seq: 1,
      });
    });

    const attention = page.getByRole('alert', { name: 'Agent attention required' });
    await expect(attention).toContainText('Codex needs your approval');
    await attention.getByRole('button', { name: 'Review request' }).click();
    await expect(page.getByText('Provider output', { exact: true })).toBeFocused();

    const inputRequests = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WORK_TEST__: { inputRequests: Array<Record<string, unknown>> };
          }
        ).__WORK_TEST__.inputRequests
    );
    expect(inputRequests).toEqual([]);
  });

  for (const provider of ['codex', 'claude'] as const) {
    const label = provider === 'claude' ? 'Claude' : 'Codex';
    test(`surfaces confirmed ${label} questions globally and keeps attention until resume`, async ({
      page,
    }) => {
      await page
        .getByRole('navigation', { name: 'Runs' })
        .getByRole('button', { name: new RegExp(`Open ${label} run`) })
        .click();
      await expect(page.getByText(`Attached to running ${label} process`)).toBeVisible();
      await page.waitForFunction(() =>
        (
          window as unknown as {
            __WORK_TEST__: { hasAgentListener: () => boolean };
          }
        ).__WORK_TEST__.hasAgentListener()
      );
      await page.evaluate((selectedProvider) => {
        (
          window as unknown as {
            __WORK_TEST__: { emitTerminalEvent: (payload: Record<string, unknown>) => void };
          }
        ).__WORK_TEST__.emitTerminalEvent({
          session_id: `live-${selectedProvider}`,
          kind: 'agent_event',
          data: JSON.stringify({
            agent: selectedProvider,
            event: 'question_asked',
            summary: 'Which migration strategy should I use?',
          }),
          seq: 1,
        });
      }, provider);

      const attention = page.getByRole('alert', { name: 'Agent attention required' });
      await expect(attention).toContainText(`${label} is waiting for your answer`);
      await expect(attention).toContainText('Confirmed provider event');
      await expect(page.getByLabel('1 agent run needs attention')).toBeVisible();

      await attention.getByRole('button', { name: 'Reply' }).click();
      await expect(page.getByLabel(`Message ${label}`)).toBeFocused();
      await page.getByLabel(`Message ${label}`).fill('Use the safest option');
      await page.getByLabel(`Message ${label}`).press('Shift+Enter');
      await expect(page.getByLabel(`Message ${label}`)).toHaveValue('Use the safest option\n');
      await page.getByLabel(`Message ${label}`).fill('Use the safest option');
      await page.getByLabel(`Message ${label}`).press('Enter');
      await expect(attention).toContainText('waiting for the provider to resume');

      const inputRequests = await page.evaluate(
        () =>
          (
            window as unknown as {
              __WORK_TEST__: { inputRequests: Array<Record<string, unknown>> };
            }
          ).__WORK_TEST__.inputRequests
      );
      expect(inputRequests.slice(-2)).toEqual([
        {
          sessionId: `live-${provider}`,
          data: '\u001b[200~Use the safest option\u001b[201~',
        },
        { sessionId: `live-${provider}`, data: '\r' },
      ]);
    });
  }

  for (const provider of ['codex', 'claude'] as const) {
    const label = provider === 'claude' ? 'Claude' : 'Codex';
    const otherLabel = provider === 'claude' ? 'Codex' : 'Claude';

    test(`${label} selection keeps launch, failure, and recovery provider-specific`, async ({
      page,
    }) => {
      await page.getByLabel('Outcome').fill(`Implement the ${label} provider launch path`);
      await page.getByLabel('Implementation provider').selectOption(provider);
      await page.getByLabel('Implementation model').fill(`test-${provider}-model`);
      await page.getByRole('button', { name: 'Start agent', exact: true }).click();

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
      await expect(session.getByRole('status', { name: `${label} is working` })).toContainText(
        `${label} is thinking`
      );
      await expect(session).toContainText(`test-${provider}-model`);

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
      expect(startRequests.map((request) => request.model)).toEqual([
        `test-${provider}-model`,
        `test-${provider}-model`,
      ]);
      expect(startRequests.map((request) => String(request.prompt))).toEqual([
        expect.stringContaining(`Shared outcome: Implement the ${label} provider launch path`),
        expect.stringContaining(`Shared outcome: Implement the ${label} provider launch path`),
      ]);
      expect(startRequests.map((request) => request.sandbox)).toEqual([
        'workspace-write',
        'workspace-write',
      ]);
    });
  }
});
