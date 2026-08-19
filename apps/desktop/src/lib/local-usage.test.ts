import assert from 'node:assert/strict';
import test from 'node:test';

import type { LocalUsageReport, LocalUsageTotals } from './tauri-ipc';
import { ccusageAgentDays, ccusageAgentRows, ccusageModels, usageStats } from './local-usage';

const totals = (
  input: number,
  cache: number,
  output: number,
  cost: number,
  cacheCreation = 0
): LocalUsageTotals => ({
  input_tokens: input,
  cache_creation_tokens: cacheCreation,
  cache_read_tokens: cache,
  output_tokens: output,
  total_tokens: input + cacheCreation + cache + output,
  cost_usd: cost,
});

const report: LocalUsageReport = {
  status: 'ready',
  stale: false,
  error: null,
  provenance: {
    engine: 'ccusage',
    version: '20.0.20',
    generated_at: '2026-08-16T12:00:00Z',
    timezone: 'UTC',
    window: 'all',
    detected_agents: ['claude', 'codex', 'grok'],
    excluded_agents: ['opencode'],
    codex_roots: [],
    source_fingerprint: 'sha256:test',
    pricing_complete: true,
    fallback_models: [],
    unpriced_models: [],
  },
  daily: [
    {
      period: '2026-08-16',
      totals: totals(15, 9, 4, 5, 3),
      agents: [
        { agent: 'claude', totals: totals(5, 2, 1, 1, 3), models: [] },
        { agent: 'codex', totals: totals(8, 4, 2, 3), models: [] },
        { agent: 'grok', totals: totals(2, 3, 1, 1), models: [] },
      ],
      models: [],
    },
  ],
  weekly: [],
  monthly: [],
  sessions: [
    {
      session_id: 'codex-1',
      agent: 'codex',
      last_activity: '2026-08-16T10:00:00Z',
      reasoning_output_tokens: 0,
      totals: totals(8, 4, 2, 3),
      models: [{ model: 'gpt-test', totals: totals(8, 4, 2, 3), fallback: false, priced: true }],
    },
    {
      session_id: 'grok-1',
      agent: 'grok',
      last_activity: '2026-08-16T11:00:00Z',
      reasoning_output_tokens: 0,
      totals: totals(2, 3, 1, 1),
      models: [{ model: 'grok-test', totals: totals(2, 3, 1, 1), fallback: false, priced: true }],
    },
  ],
  totals: totals(15, 9, 4, 5, 3),
};

test('ccusage selectors expose mapped Claude, Codex, and Grok rows', () => {
  assert.deepEqual(
    ccusageAgentDays(report).map((row) => row.agent_type),
    ['claude-code', 'codex', 'grok']
  );
  assert.deepEqual(
    ccusageAgentRows(report).map((row) => row.agent_type),
    ['codex', 'grok']
  );
});

test('usage summary keeps generated and cache tokens separate', () => {
  const stats = usageStats(ccusageAgentDays(report), new Date('2026-08-16T12:00:00'));
  assert.equal(stats.today_generated, 22);
  assert.equal(stats.today, 31);
  assert.equal(stats.today_cost, 5);
});

test('model selector uses one report snapshot and honors agent filters', () => {
  assert.equal(ccusageModels(report)[0]?.model, 'gpt-test');
  assert.deepEqual(ccusageModels(report, undefined, undefined, new Set(['codex', 'grok'])), []);
});
