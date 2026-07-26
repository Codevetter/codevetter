import assert from 'node:assert/strict';
import test from 'node:test';

import { recommendAgentTeam } from './agent-team-recommendation';

test('ordinary work recommends one required implementation agent', () => {
  const recommendation = recommendAgentTeam('Add an export command to the settings page.');

  assert.equal(recommendation.length, 1);
  assert.deepEqual(
    recommendation.map(({ role, required, defaultProvider, phase, sandbox }) => ({
      role,
      required,
      defaultProvider,
      phase,
      sandbox,
    })),
    [
      {
        role: 'implementation',
        required: true,
        defaultProvider: 'codex',
        phase: 'now',
        sandbox: 'workspace-write',
      },
    ]
  );
  assert.match(recommendation[0].reason, /one implementation agent is sufficient/i);
  assert.match(recommendation[0].instructions, /Shared outcome: Add an export command/);
});

test('explicit UX and reliability signals add explainable bounded specialists', () => {
  const recommendation = recommendAgentTeam(
    'Redesign the Work sidebar and Agent Island, then run Playwright tests for release confidence.'
  );

  assert.deepEqual(
    recommendation.map(({ role, matchedSignal }) => ({ role, matchedSignal })),
    [
      { role: 'implementation', matchedSignal: null },
      { role: 'verification', matchedSignal: 'independent assurance' },
      { role: 'product-ux', matchedSignal: 'user-interface work' },
    ]
  );
  assert.equal(recommendation.length, 3);
  assert.match(recommendation[1].reason, /review, proof, testing, reliability/i);
  assert.match(recommendation[2].reason, /interface or user experience/i);
  assert.equal(recommendation[1].phase, 'after-implementation');
  assert.equal(recommendation[1].sandbox, 'read-only');
  assert.equal(recommendation[2].phase, 'now');
  assert.equal(recommendation[2].sandbox, 'read-only');
});

test('recommendations are deterministic, bounded, and keep specialist prompts read-only', () => {
  const outcome =
    'Investigate the root cause, redesign the UI, audit security, and verify browser regression safety.';
  const first = recommendAgentTeam(outcome);
  const second = recommendAgentTeam(outcome);

  assert.deepEqual(first, second);
  assert.equal(first.length, 3);
  assert.deepEqual(
    first.map((item) => item.role),
    ['implementation', 'verification', 'investigation']
  );
  assert.match(first[1].instructions, /without editing files/i);
  assert.match(first[2].instructions, /avoid editing files/i);
});

test('assurance outranks UX when explicit signals exceed the three-role cap', () => {
  const recommendation = recommendAgentTeam(
    'Investigate the root cause, redesign the sidebar UI, and prove release safety with browser tests.'
  );

  assert.equal(recommendation.length, 3);
  assert.deepEqual(
    recommendation.map((item) => item.role),
    ['implementation', 'verification', 'investigation']
  );
  assert.equal(
    recommendation.some((item) => item.role === 'product-ux'),
    false
  );
});
