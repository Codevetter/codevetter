import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deriveVerificationDecisionSummary, VERIFICATION_COPY } from './verification-presentation';

const EMPTY = {
  fixedCount: 0,
  reproducedCount: 0,
  notReproducedCount: 0,
  uncheckedCount: 0,
  executionFailureCount: 0,
  blockedProcedureCount: 0,
  satisfiedProcedureCount: 0,
};

describe('verification presentation', () => {
  it('uses one truthful workflow vocabulary', () => {
    assert.equal(VERIFICATION_COPY.action, 'Check a change');
    assert.match(VERIFICATION_COPY.workflow, /Review the change/);
    assert.match(VERIFICATION_COPY.workflow, /executable checks/);
    assert.match(VERIFICATION_COPY.workflow, /ship/);
  });

  it('stays no-confidence when a review has no runtime evidence', () => {
    assert.deepEqual(deriveVerificationDecisionSummary(EMPTY), {
      status: 'no_confidence',
      label: 'No confidence',
      evidenceStrength: 'Review findings only',
      limitation: 'No qualifying runtime evidence has been recorded.',
      nextAction: 'Run a verification command or open Runtime evidence.',
    });
  });

  it('holds executable failures and unchecked findings', () => {
    const summary = deriveVerificationDecisionSummary({
      ...EMPTY,
      reproducedCount: 1,
      uncheckedCount: 2,
      executionFailureCount: 1,
    });
    assert.equal(summary.status, 'hold');
    assert.match(summary.limitation, /1 executable failure/);
    assert.match(summary.limitation, /2 unchecked findings/);
  });

  it('only becomes a ship candidate after recorded evidence has no open finding-level gaps', () => {
    const summary = deriveVerificationDecisionSummary({
      ...EMPTY,
      fixedCount: 2,
      satisfiedProcedureCount: 1,
    });
    assert.equal(summary.status, 'ship_candidate');
    assert.match(summary.nextAction, /limitations/);
  });
});
