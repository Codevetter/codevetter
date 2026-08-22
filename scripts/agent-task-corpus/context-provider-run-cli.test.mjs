import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256Bytes } from './contracts.mjs';
import {
  assertExecutionApproval,
  assertLoopbackModelUrl,
  operatorDiagnostics,
} from './context-provider-run-cli.mjs';

function failedExecution({ stderr = 'adapter aborted: missing graph tool\n' } = {}) {
  return {
    receipt: {
      plan_id: 'plan-fixture',
      run_id: 'run-fixture',
      terminal_status: 'agent_failure',
      lifecycle: ['workspace_prepared', 'agent_started', 'agent_terminated'],
      agent: {
        status: 'exited',
        exit_code: 1,
        stdout_sha256: sha256Bytes(Buffer.from('')),
        stderr_sha256: sha256Bytes(Buffer.from(stderr)),
        stdout_bytes: 0,
        stderr_bytes: Buffer.byteLength(stderr),
        output_truncated: false,
      },
      limitations: ['Declared adapter diagnostics were unavailable or invalid.'],
    },
    output: { stdout: '', stderr },
  };
}

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

test('an agent failure retains recoverable redacted output bound to its receipt hashes', () => {
  const scheduled = {
    sequence: 7,
    task_id: 'accept-zero-duration',
    provider_id: 'codevetter-structural-context',
  };
  const execution = failedExecution();
  const diagnostics = operatorDiagnostics(scheduled, execution);

  assert.equal(diagnostics.sequence, 7);
  assert.equal(diagnostics.terminal_status, 'agent_failure');
  assert.equal(diagnostics.run_id, 'run-fixture');
  assert.match(diagnostics.output.stderr, /missing graph tool/);
  assert.equal(
    sha256Bytes(Buffer.from(diagnostics.output.stderr)),
    execution.receipt.agent.stderr_sha256
  );

  const drifted = failedExecution();
  drifted.output.stderr = 'a different failure\n';
  assert.throws(
    () => operatorDiagnostics(scheduled, drifted),
    /stderr does not match its receipt hash/
  );
});
