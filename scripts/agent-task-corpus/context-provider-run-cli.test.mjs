import assert from 'node:assert/strict';
import test from 'node:test';

import { assertExecutionApproval, assertLoopbackModelUrl } from './context-provider-run-cli.mjs';

test('context execution requires the exact current approval identity', () => {
  const plan = { approvals: { approval_id: 'approval-current' } };
  assert.doesNotThrow(() => assertExecutionApproval(plan, 'approval-current'));
  assert.throws(
    () => assertExecutionApproval(plan, 'approval-stale'),
    /must name current approval "approval-current"/
  );
});

test('context execution accepts only loopback model servers', () => {
  for (const url of ['http://127.0.0.1:18081', 'http://localhost:18081', 'http://[::1]:18081']) {
    assert.doesNotThrow(() => assertLoopbackModelUrl(url));
  }
  for (const url of ['https://127.0.0.1:18081', 'http://example.com', 'not-a-url']) {
    assert.throws(() => assertLoopbackModelUrl(url));
  }
});
