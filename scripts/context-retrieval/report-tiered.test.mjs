import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadTiered, render, summariseTier } from './report-tiered.mjs';

const bucket = (rows) => new Map(rows.map((r) => [r.provider_id, r]));

const row = (id, repos, r1, r4, r16, outcomes = { answered: 10 }) => ({
  provider_id: id,
  repos,
  tiers: repos.map(() => 'small'),
  samples: [
    {
      mean_recall_at_1000_tokens: r1,
      mean_recall_at_4000_tokens: r4,
      mean_recall_at_16000_tokens: r16,
      median_tokens_delivered: 1000,
    },
  ],
  outcomes,
  gate_failures: [],
});

test('a single-repo row is marked as weaker evidence than a multi-repo row', () => {
  const rows = summariseTier(
    bucket([
      row('narrow', ['gin'], 0.4, 0.4, 0.4),
      row('broad', ['gin', 'flask', 'express', 'got'], 0.3, 0.3, 0.3),
    ])
  );
  const narrow = rows.find((r) => r.provider_id === 'narrow');
  const broad = rows.find((r) => r.provider_id === 'broad');
  assert.equal(narrow.coverage.strength, 'single-repo');
  assert.equal(broad.coverage.strength, 'broad');
  // The narrow row still sorts higher on score; the marker is what stops a reader
  // treating it as equivalent evidence.
  assert.equal(rows[0].provider_id, 'narrow');
});

test('answer rate sits beside accuracy so silent decliners are visible', () => {
  const rows = summariseTier(
    bucket([row('declines', ['gin'], 0.6, 0.6, 0.6, { answered: 8, 'did-not-index': 2 })])
  );
  assert.equal(rows[0].answer_rate, 0.8);
});

test('no overall winner is produced, only per-tier-per-budget leaders', () => {
  const byTier = new Map([
    ['small', bucket([row('a', ['gin'], 0.5, 0.2, 0.2), row('b', ['gin'], 0.1, 0.6, 0.3)])],
    ['large', bucket([row('a', ['django'], 0.1, 0.1, 0.1), row('b', ['django'], 0.4, 0.4, 0.4)])],
  ]);
  const out = render(byTier, { planHash: 'deadbeef' });
  assert.match(out, /No overall winner is computed/);
  assert.match(out, /Pre-registered plan: `deadbeef`/);
  // Different winners in different places must both appear.
  assert.match(out, /\*\*small @ r@1k\*\*: a/);
  assert.match(out, /\*\*small @ r@4k\*\*: b/);
  assert.match(out, /\*\*large @ r@1k\*\*: b/);
  // And no aggregate row: every leader line must be scoped to a tier and a budget,
  // so there is nowhere for a single champion to be stated. Checked structurally
  // rather than by keyword, since the disclaimer itself says "overall winner".
  // Leader lines only. Other bullet lines exist (the comparability warning names
  // tiers too), and the property under test is that no leader is stated without a
  // tier AND a budget attached.
  const leaderLines = out.split('\n').filter((l) => l.startsWith('- **') && l.includes(' @ r@'));
  assert.ok(leaderLines.length > 0);
  for (const line of leaderLines) {
    assert.match(line, /^- \*\*(small|medium|large|untiered) @ r@(1k|4k|16k)\*\*:/);
  }
});

test('a run whose gates failed is marked untrustworthy in its own row', () => {
  const failing = { ...row('x', ['gin'], 0.5, 0.5, 0.5), gate_failures: ['gin'] };
  const out = render(new Map([['small', bucket([failing])]]));
  assert.match(out, /gate failed \(gin\)/);
});

test('tiers render in a stable order regardless of input order', () => {
  const byTier = new Map([
    ['large', bucket([row('a', ['django'], 0.1, 0.1, 0.1)])],
    ['small', bucket([row('a', ['gin'], 0.2, 0.2, 0.2)])],
  ]);
  const out = render(byTier);
  assert.ok(out.indexOf('Tier: small') < out.indexOf('Tier: large'));
});

test('a gate verdict stored per-arm does not condemn a run whose controls are present', () => {
  // When each arm is measured in its own process, every artifact truthfully reports
  // "controls absent" because the controls live in sibling files. Trusting the stored
  // verdict stamped "gate failed" on all 25 arms of a run whose controls were present
  // and losing — and a verifier reading that either rejects sound numbers or learns to
  // ignore the gate. The union is the experiment, so the union is what gets checked.
  const dir = mkdtempSync(join(tmpdir(), 'cr-tiered-'));
  const failed = {
    ok: false,
    trustworthy: false,
    controls_present: { ok: false, missing: ['random-files', 'random-code-files', 'churn-ranked'] },
  };
  const arm = (id, r4k) => ({
    tier: 'small',
    repository: { id: 'got' },
    gates: failed,
    providers: [
      {
        provider_id: id,
        summary: { all: { cases: 108, mean_recall_at_4000_tokens: r4k, unavailable: 0 } },
        outcomes: { answered: 108 },
      },
    ],
  });
  const paths = [];
  for (const [id, r4k] of [
    ['semble', 0.836],
    ['random-files', 0.007],
    ['random-code-files', 0.045],
    ['churn-ranked', 0.0],
  ]) {
    const file = join(dir, `${id}.json`);
    writeFileSync(file, JSON.stringify(arm(id, r4k)));
    paths.push(file);
  }

  const withControls = loadTiered(paths).get('small');
  for (const [id, row] of withControls) {
    assert.deepEqual(row.gate_failures, [], `${id} was condemned by a per-arm verdict`);
  }

  // The gate must still bite when the controls genuinely are not there.
  const soloed = loadTiered([paths[0]]).get('small');
  assert.deepEqual(soloed.get('semble').gate_failures, ['got']);
});
