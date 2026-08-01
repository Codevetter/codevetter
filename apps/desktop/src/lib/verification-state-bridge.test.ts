import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  completeReviewQualificationState,
  failReviewQualificationState,
  getReviewQualificationRequest,
  initializeVerificationStateBridge,
  type VerificationWindow,
} from './verification-state-bridge';

function host(stateName = 'shell-navigation-ready'): VerificationWindow {
  return {
    __CODEVETTER_VERIFY__: {
      protocolVersion: 1 as const,
      runId: 'run-1',
      scenarioId: 'shell-smoke',
      stateName,
      frozenTime: '2026-07-15T10:00:00.000Z',
      flags: stateName.startsWith('review-') ? { reviewId: 'review-1' } : {},
    },
    __CODEVETTER_VERIFY_STATE__: undefined,
  };
}

describe('CodeVetter verification state bridge', () => {
  it('does nothing during normal application startup', async () => {
    const target = {};
    assert.equal(await initializeVerificationStateBridge(target), false);
    assert.deepEqual(target, {});
  });

  it('acknowledges only an installed named state with exact run identity', async () => {
    const target = host();
    assert.equal(await initializeVerificationStateBridge(target), true);
    assert.deepEqual(target.__CODEVETTER_VERIFY_STATE__, {
      protocolVersion: 1,
      runId: 'run-1',
      scenarioId: 'shell-smoke',
      status: 'ready',
    });
  });

  it('fails closed for unknown states and installer errors', async () => {
    const unknown = host('unknown-state');
    await initializeVerificationStateBridge(unknown);
    assert.equal(unknown.__CODEVETTER_VERIFY_STATE__?.status, 'error');

    const failed = host('fixture-error');
    await initializeVerificationStateBridge(failed, {
      'fixture-error': () => {
        throw new Error('secret backend detail');
      },
    });
    assert.equal(failed.__CODEVETTER_VERIFY_STATE__?.status, 'error');
    assert.doesNotMatch(failed.__CODEVETTER_VERIFY_STATE__?.message ?? '', /secret backend detail/);
  });

  it('waits for Review to render an exact qualification state', async () => {
    const target = host('review-partial-ready');
    const installing = initializeVerificationStateBridge(target);
    await Promise.resolve();

    const request = getReviewQualificationRequest(target);
    assert.equal(request?.reviewId, 'review-1');
    assert.equal(request?.stateName, 'review-partial-ready');
    assert.equal(request ? completeReviewQualificationState(request) : false, true);
    assert.equal(await installing, true);
    assert.equal(target.__CODEVETTER_VERIFY_STATE__?.status, 'ready');
  });

  it('fails closed when Review cannot install the requested state', async () => {
    const target = host('review-completed-ready');
    const installing = initializeVerificationStateBridge(target);
    await Promise.resolve();

    const request = getReviewQualificationRequest(target);
    assert.equal(request ? failReviewQualificationState(request) : false, true);
    assert.equal(await installing, true);
    assert.equal(target.__CODEVETTER_VERIFY_STATE__?.status, 'error');
  });

  it('rejects a Review state without a stable review identity', () => {
    const target = host('review-partial-ready');
    if (target.__CODEVETTER_VERIFY__) {
      target.__CODEVETTER_VERIFY__.flags = { reviewId: '../outside' };
    }
    assert.equal(getReviewQualificationRequest(target), null);
  });
});
