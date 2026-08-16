import assert from 'node:assert/strict';
import test from 'node:test';

import type { LocalUsageReport, LocalUsageTotals } from './tauri-ipc';
import { ccusageAgentDays, ccusageAgentRows, ccusageModels, usageStats } from './local-usage';

const totals = (input: number, cache: number, output: number, cost: number): LocalUsageTotals => ({
  input_tokens: input,
  cache_creation_tokens: 0,
  cache_read_tokens: cache,
  output_tokens: output,
  total_tokens: input + cache + output,
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
    detected_agents: ['claude', 'codex'],
    excluded_agents: ['grok'],
    codex_roots: [],
    source_fingerprint: 'sha256:test',
    pricing_complete: true,
    fallback_models: [],
    unpriced_models: [],
  },
  daily: [
    {
      period: '2026-08-16',
      totals: totals(13, 6, 3, 4),
      agents: [
        { agent: 'claude', totals: totals(5, 2, 1, 1), models: [] },
        { agent: 'codex', totals: totals(8, 4, 2, 3), models: [] },
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
  ],
  totals: totals(13, 6, 3, 4),
};

test('ccusage selectors expose only mapped Claude and Codex rows', () => {
  assert.deepEqual(
    ccusageAgentDays(report).map((row) => row.agent_type),
    ['claude-code', 'codex']
  );
  assert.deepEqual(
    ccusageAgentRows(report).map((row) => row.agent_type),
    ['codex']
  );
});

test('usage summary keeps generated and cache tokens separate', () => {
  const stats = usageStats(ccusageAgentDays(report), new Date('2026-08-16T12:00:00'));
  assert.equal(stats.today_generated, 16);
  assert.equal(stats.today, 22);
  assert.equal(stats.today_cost, 4);
});

test('model selector uses one report snapshot and honors agent filters', () => {
  assert.equal(ccusageModels(report)[0]?.model, 'gpt-test');
  assert.deepEqual(ccusageModels(report, undefined, undefined, new Set(['codex'])), []);
});
