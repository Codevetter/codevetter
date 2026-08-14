import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBrowserActionSummary,
  normalizePlaywrightTraceAction,
  representativeBrowserActions,
  safePlaywrightActionIdentity,
} from './browser-actions.mjs';

test('normalizes modern and legacy actions without retaining parameters or errors', () => {
  const modern = {
    type: 'action',
    title: 'locator.click',
    class: 'Locator',
    method: 'click',
    startTime: 10,
    endTime: 25,
    params: { selector: 'text=private account', value: 'secret value' },
    error: { message: 'private failure' },
  };
  const legacy = {
    type: 'before',
    apiName: 'page.waitForResponse',
    startTime: 30,
    params: { url: 'https://example.com/private?token=value' },
  };
  const actions = [
    normalizePlaywrightTraceAction(modern, null, 1),
    normalizePlaywrightTraceAction(legacy, { type: 'after', endTime: 50, error: null }, 2),
  ];

  assert.deepEqual(actions, [
    {
      ordinal: 1,
      name: 'locator.click',
      category: 'interaction',
      state: 'failed',
      started_at_ms: 10,
      duration_ms: 15,
    },
    {
      ordinal: 2,
      name: 'page.waitForResponse',
      category: 'wait',
      state: 'succeeded',
      started_at_ms: 30,
      duration_ms: 20,
    },
  ]);
  const serialized = JSON.stringify(actions);
  assert.equal(serialized.includes('private'), false);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('example.com'), false);
});

test('falls back to closed framework class/method identity and rejects arbitrary labels', () => {
  assert.deepEqual(safePlaywrightActionIdentity({ class: 'Frame', method: 'goto' }), {
    name: 'frame.goto',
    category: 'navigation',
  });
  assert.equal(
    safePlaywrightActionIdentity({ title: 'click the private account', class: 'UserStep' }),
    null
  );
  assert.equal(safePlaywrightActionIdentity({ class: 'Locator', method: 'click private' }), null);
  assert.equal(
    safePlaywrightActionIdentity({ class: 'Page', method: 'setNetworkInterceptionPatterns' }),
    null
  );
  assert.deepEqual(safePlaywrightActionIdentity({ class: 'Frame', method: 'expect' }), {
    name: 'frame.expect',
    category: 'assertion',
  });
  assert.deepEqual(safePlaywrightActionIdentity({ class: 'Frame', method: 'evaluateExpression' }), {
    name: 'frame.evaluateExpression',
    category: 'evaluation',
  });
  assert.equal(
    normalizePlaywrightTraceAction(
      { type: 'action', title: 'locator.click', startTime: 20, endTime: 10 },
      null,
      1
    ),
    null
  );
});

test('retains earliest and slowest actions within the public bound', () => {
  const actions = Array.from({ length: 100 }, (_, index) => ({
    ordinal: index + 1,
    name: 'locator.click',
    category: 'interaction',
    state: 'succeeded',
    started_at_ms: index * 10,
    duration_ms: index + 1,
  }));
  const retained = representativeBrowserActions(actions);

  assert.equal(retained.length, 64);
  assert.equal(retained[0].ordinal, 1);
  assert.equal(
    retained.some((action) => action.ordinal === 32),
    true
  );
  assert.equal(
    retained.some((action) => action.ordinal === 100),
    true
  );
  assert.equal(
    retained.some((action) => action.ordinal === 50),
    false
  );
});

test('associates resource starts and long-task overlap without assigning causality', () => {
  const action = {
    ordinal: 1,
    name: 'locator.click',
    category: 'interaction',
    state: 'succeeded',
    started_at_ms: 100,
    duration_ms: 50,
  };
  const summary = createBrowserActionSummary({
    actions: [action],
    startedActionCount: 1,
    completedActionCount: 1,
    samplingApplied: false,
    resources: [resource(110, 200, 12_000), resource(130, -1, null), resource(151, 200, 99_000)],
    longTasks: [
      { started_at_ms: 90, duration_ms: 20 },
      { started_at_ms: 120, duration_ms: 40 },
      { started_at_ms: 160, duration_ms: 10 },
    ],
    completedResponseInventoryComplete: true,
  });
  const observed = summary.sequence[0];

  assert.equal(summary.inventory.complete, true);
  assert.equal(observed.resources_started, 2);
  assert.equal(observed.completed_responses, 1);
  assert.equal(observed.failed_or_aborted_resources, 1);
  assert.equal(observed.completed_response_transfer_bytes, 12_000);
  assert.deepEqual(observed.largest_resources, [
    {
      route: '/resource',
      network_scope: 'loopback',
      resource_type: 'fetch',
      status: 200,
      transfer_bytes: 12_000,
      source: null,
    },
  ]);
  assert.equal(observed.overlapping_long_tasks, 2);
  assert.equal(observed.overlapping_long_task_ms, 40);
  assert.match(summary.limitations.join(' '), /temporal associations, not initiator/);
});

test('withholds per-action bytes for partial response evidence and exposes incomplete starts', () => {
  const action = {
    ordinal: 1,
    name: 'page.goto',
    category: 'navigation',
    state: 'succeeded',
    started_at_ms: 1,
    duration_ms: 2,
  };
  const summary = createBrowserActionSummary({
    actions: [action],
    startedActionCount: 2,
    completedActionCount: 1,
    samplingApplied: false,
    resources: [resource(2, 200, 5_000)],
    longTasks: [],
    completedResponseInventoryComplete: false,
  });

  assert.equal(summary.inventory.complete, false);
  assert.equal(summary.sequence[0].completed_response_transfer_bytes, null);
  assert.match(summary.limitations.join(' '), /without a bounded completion/);
  assert.match(summary.limitations.join(' '), /global completed-response inventory is partial/);
});

function resource(startedAt, status, transferBytes) {
  return {
    started_at_ms: startedAt,
    duration_ms: 1,
    attributes: {
      route: '/resource',
      network_scope: 'loopback',
      resource_type: 'fetch',
      status,
      transfer_bytes: transferBytes,
      source: null,
    },
  };
}
