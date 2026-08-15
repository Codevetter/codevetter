import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPerformanceRequestId,
  performanceBridgeFixture,
  performancePreviewReceipts,
  performancePreviewState,
} from './performance-workbench';

test('performance request identities stay inside the native bridge contract', () => {
  const first = createPerformanceRequestId();
  const second = createPerformanceRequestId();
  assert.match(first, /^perf-[0-9a-f]{24}$/);
  assert.notEqual(first, second);
});

test('preview receipts remain clearly qualified and machine readable', () => {
  const { plan, diagnosis } = performancePreviewReceipts();
  assert.equal(plan.result.schema_version, 'performance-execution-plan/v1');
  assert.equal((plan.result.decision as { status: string }).status, 'admitted');
  assert.equal(diagnosis.result.schema_version, 'runtime-performance-diagnosis/v1');
  assert.match(JSON.stringify(diagnosis.result.limitations), /illustrative/i);
  assert.equal(diagnosis.cleanup.owned_process_reaped, true);
});

test('qualification fixtures cover terminal performance states without claiming real evidence', () => {
  assert.equal(
    (performancePreviewState('performance-blocked').plan?.result.decision as { status: string })
      .status,
    'blocked'
  );
  assert.equal(
    (
      performancePreviewState('performance-no-confidence').diagnosis?.result.verdict as {
        status: string;
      }
    ).status,
    'no_confidence'
  );
  assert.equal(
    (
      performancePreviewState('performance-paired-proof').diagnosis?.result.verdict as {
        status: string;
      }
    ).status,
    'confirmed'
  );
  assert.equal(performancePreviewState('performance-running').running, true);
});

test('desktop bridge fixtures cover every bounded terminal and rejection path', () => {
  const names = [
    'success',
    'unsupported_runtime',
    'unsafe_scope',
    'cancellation',
    'timeout',
    'malformed_output',
    'cleanup_failure',
  ] as const;
  const fixtures = names.map(performanceBridgeFixture);
  assert.equal(fixtures.length, 7);
  assert.equal(fixtures[2].kind, 'rejected');
  const cleanupFailure = fixtures[6];
  assert.equal(cleanupFailure.kind, 'receipt');
  if (cleanupFailure.kind === 'receipt') {
    assert.equal(cleanupFailure.receipt.cleanup.owned_process_reaped, false);
    assert.match(JSON.stringify(cleanupFailure.receipt.result.limitations), /cleanup/i);
  }
  for (const fixture of fixtures) {
    assert.doesNotMatch(JSON.stringify(fixture), /illustrative repository evidence/i);
  }
});
