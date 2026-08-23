import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  REQUIRED_CONTROLS,
  checkControlsLose,
  checkControlsPresent,
  classifyOutcome,
  coverageOf,
  flagExtremes,
  nominateForAudit,
} from './gates.mjs';

const arm = (id, r4, extra = {}) => ({
  provider_id: id,
  summary: { all: { mean_recall_at_4000_tokens: r4, cases: 10, unavailable: 0, ...extra } },
});

test('a report without controls is refused', () => {
  assert.equal(checkControlsPresent(['codesearch']).ok, false);
  assert.deepEqual(checkControlsPresent(['codesearch']).missing, REQUIRED_CONTROLS);
  // Asserting against REQUIRED_CONTROLS rather than a literal list, because the literal
  // is what went stale when the conservative random draw was added as a third control.
  assert.equal(checkControlsPresent(['codesearch', ...REQUIRED_CONTROLS]).ok, true);
  // The weak random draw alone is not enough: widening its pool to every tracked file
  // made it easier to beat, which is why the code-only draw is also mandatory.
  assert.equal(checkControlsPresent(['codesearch', 'random-files', 'churn-ranked']).ok, false);
});

test('a control scoring near the leader fails the run', () => {
  // The exact shape of the real bug: a query-blind churn ranker at 37.3% while the
  // best real provider sat at 59.2%.
  const bad = checkControlsLose({
    providers: [arm('codesearch', 0.592), arm('churn-ranked', 0.373), arm('random-files', 0.026)],
  });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /Suspect the metric/);

  const good = checkControlsLose({
    providers: [arm('codesearch', 0.592), arm('churn-ranked', 0.018), arm('random-files', 0.026)],
  });
  assert.equal(good.ok, true);
});

test('install failure is never conflated with poor retrieval', () => {
  assert.equal(
    classifyOutcome({ unavailable_reason: 'spawn: command not found' }),
    'did-not-install'
  );
  assert.equal(classifyOutcome({ unavailable_reason: 'index step failed' }), 'did-not-index');
  assert.equal(
    classifyOutcome({ unavailable_reason: 'no output' }),
    'indexed-but-returned-nothing'
  );
  assert.equal(classifyOutcome({ files: [] }), 'indexed-but-returned-nothing');
  assert.equal(classifyOutcome({ files: ['a.go'] }), 'answered');
});

test('a capacity refusal is distinguished from an index failure', () => {
  // The extraction succeeded and the product declined to load its own output. That is
  // the most important thing this benchmark can say about a tool's usable scale, and
  // collapsing it into did-not-index would lose it. Real reasons observed:
  assert.equal(
    classifyOutcome({
      unavailable_reason: 'snapshot-exceeds-import-limit: 128820371 bytes > 33554432',
    }),
    'refused-own-capacity-limit'
  );
  assert.equal(
    classifyOutcome({
      unavailable_reason: 'CodeVetter import exceeds the 32 MiB local safety limit',
    }),
    'refused-own-capacity-limit'
  );
  // Still separated from a genuine index failure.
  assert.equal(classifyOutcome({ unavailable_reason: 'index step failed' }), 'did-not-index');
});

test('coverage marks a single-repo row as a hint rather than a finding', () => {
  assert.equal(coverageOf({ repos: ['gin'], tiers: ['small'] }).strength, 'single-repo');
  assert.equal(
    coverageOf({ repos: ['gin', 'flask', 'express', 'got'], tiers: ['small'] }).strength,
    'broad'
  );
});

test('a ranking mixing single-repo and multi-repo arms is flagged as indefensible', async () => {
  const { checkRankingComparable } = await import('./gates.mjs');
  const row = (id, repos) => ({ provider_id: id, coverage: { repos } });
  // The exact shape of the problem: a one-repo leader ranked above a four-repo arm.
  const mixed = checkRankingComparable([
    row('semble', ['gin']),
    row('codesearch', ['gin', 'express', 'flask', 'got']),
    row('random-files', ['gin']),
  ]);
  assert.equal(mixed.ok, false);
  assert.deepEqual(mixed.thin_arms, ['semble']);
  assert.match(mixed.reason, /not defensible/);
  // Controls are exempt: they exist to bound the metric, not to be ranked.
  assert.ok(!mixed.thin_arms.includes('random-files'));

  const sound = checkRankingComparable([
    row('semble', ['gin', 'express']),
    row('codesearch', ['gin', 'express', 'flask', 'got']),
  ]);
  assert.equal(sound.ok, true);
  assert.equal(sound.min_repos_present, 2);
});

test('zeros and perfect scores are flagged for raw-payload inspection', () => {
  const flags = flagExtremes([
    arm('broken', 0),
    arm('suspicious', 0.98),
    arm('normal', 0.4),
    arm('churn-ranked', 0),
  ]);
  const ids = flags.map((f) => f.provider_id);
  assert.deepEqual(ids.sort(), ['broken', 'suspicious']);
  // Controls are expected to score near zero, so they are never flagged.
  assert.ok(!ids.includes('churn-ranked'));
});

test('audit nominations are deterministic and drawn from the plausible middle', () => {
  const providers = [
    {
      provider_id: 'x',
      cases: Array.from({ length: 6 }, (_, i) => ({
        case: { query: `q${i}`, base_revision: `r${i}`, changed_files: ['a.go'] },
        response: { files: ['a.go'] },
        measures: { recall_at_10: i === 0 ? 0 : i === 5 ? 1 : 0.5 },
      })),
    },
  ];
  const first = nominateForAudit({ providers, perProvider: 2 });
  const second = nominateForAudit({ providers, perProvider: 2 });
  assert.deepEqual(first, second);
  // Neither the 0.0 nor the 1.0 case is eligible: those are the ones already checked.
  assert.ok(first.every((n) => n.query !== 'q0' && n.query !== 'q5'));
});
