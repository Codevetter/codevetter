import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('partial arms disclose their actual coverage and abandonment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cr-field-report-'));
  const score = {
    repository: { id: 'fixture', head: '1234567890abcdef' },
    tier: 'small',
    corpus_counts: { cases: 30, multi_file: 5, path_leak: 4 },
    providers: [
      {
        provider_id: 'partial-provider',
        summary: {
          all: {
            cases: 3,
            mean_recall_at_1000_tokens: 0.5,
            mean_recall_at_4000_tokens: 0.5,
            mean_recall_at_16000_tokens: 0.5,
            median_tokens_delivered: 100,
            median_latency_ms: 10,
            unavailable: 3,
          },
        },
        outcomes: { 'did-not-index': 3 },
        abandoned: {
          after_cases: 3,
          remaining: 27,
          reason: '3 consecutive hard failures',
        },
      },
    ],
  };
  writeFileSync(join(dir, 'score.json'), JSON.stringify(score));

  const output = execFileSync(
    process.execPath,
    ['scripts/context-retrieval/field-report.mjs', dir],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    }
  );
  assert.match(output, /all — every case \(30 planned cases\)/);
  assert.match(output, /\| partial-provider \| 3\/30 \| abandoned after 3; 27 remaining \|/);
});
