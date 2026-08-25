import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { isHardFailure, scoreRetrieval } from './score.mjs';
import { mcpFailureReason } from './adapters/mcp-client.mjs';

// This file used to assert on score.mjs's SOURCE TEXT — matching the literal expression
// `consecutiveHardFailures = hard ? consecutiveHardFailures + 1 : 0`. That tests the
// spelling of an implementation, not its behaviour: extracting the loop into a named
// function broke the test while leaving the behaviour identical, which is exactly
// backwards from what a test should do. These drive the real code instead.

function fixture(caseCount) {
  const dir = mkdtempSync(join(tmpdir(), 'cr-abandon-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  writeFileSync(join(dir, 'app.ts'), 'export const a = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'one');
  const revision = git('rev-parse', 'HEAD').trim();
  return {
    repo: dir,
    corpus: {
      repository: { id: 'fixture', head: revision },
      counts: { cases: caseCount, path_leak: 0, baseline_blind: 0, multi_file: 0 },
      cases: Array.from({ length: caseCount }, (_, index) => ({
        case_id: `c${index}`,
        base_revision: revision,
        query: `query ${index}`,
        query_tokens: ['query'],
        required_files: ['app.ts'],
        retrieval: { path_leak: false },
      })),
    },
  };
}

const emptyResponse = (reason) => ({
  provider_id: 'stub',
  files: [],
  ranking: [],
  tokens_delivered: 0,
  payload_kind: 'chunks',
  latency_ms: 1,
  ...(reason ? { unavailable_reason: reason } : {}),
});

test('an arm that cannot index is abandoned rather than retried for every case', async () => {
  // One arm burned roughly 55 minutes proving a repository unindexable 11 times at a
  // 5-minute call timeout apiece. Three strikes and the arm stops.
  const { repo, corpus } = fixture(30);
  let calls = 0;
  const adapters = new Map([
    [
      'stub',
      () => {
        calls += 1;
        return emptyResponse('index step failed');
      },
    ],
  ]);
  const report = await scoreRetrieval({
    corpus,
    repo,
    providerIds: ['stub'],
    adapters,
    minFreeMemoryMb: 0,
  });
  assert.equal(calls, 3, `adapter was called ${calls} times; it should stop after 3`);
  const arm = report.providers.find((entry) => entry.provider_id === 'stub');
  assert.ok(arm.abandoned, 'abandonment was not recorded in the artifact');
  assert.equal(arm.abandoned.after_cases, 3);
  assert.equal(arm.abandoned.remaining, 27);
  assert.match(arm.abandoned.reason, /index step failed/);
});

test('the failure counter is consecutive, so an arm that recovers keeps going', async () => {
  // Cumulative counting would abandon a flaky-but-working arm on its third bad case
  // anywhere in the corpus. Here every other case fails, so it must never abandon.
  const { repo, corpus } = fixture(12);
  let calls = 0;
  const adapters = new Map([
    [
      'stub',
      () => {
        calls += 1;
        return calls % 2 === 0 ? emptyResponse('index step failed') : emptyResponse();
      },
    ],
  ]);
  const report = await scoreRetrieval({
    corpus,
    repo,
    providerIds: ['stub'],
    adapters,
    minFreeMemoryMb: 0,
  });
  assert.equal(calls, 12, 'the arm was abandoned despite recovering between failures');
  assert.equal(report.providers[0].abandoned, undefined);
});

test('an empty result is a result; only index, worktree and capacity refusals are hard', () => {
  // A query that returns nothing is an answer. Failing to index is not. A capacity
  // refusal is also hard: retrying cannot make a snapshot smaller than the ceiling
  // that rejected it.
  assert.equal(isHardFailure('index step failed'), true);
  assert.equal(isHardFailure('worktree: fatal: invalid reference'), true);
  assert.equal(isHardFailure('snapshot exceeds the 40 MB import limit'), true);
  assert.equal(isHardFailure('refused: safety limit reached'), true);

  assert.equal(isHardFailure('no output'), false);
  assert.equal(isHardFailure(undefined), false);
  assert.equal(isHardFailure(''), false);
  assert.equal(isHardFailure('query: timed out'), false);
  assert.equal(isHardFailure(mcpFailureReason('index', new Error('timeout on tools/call'))), true);
});
