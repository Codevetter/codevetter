export const VERIFICATION_COPY = Object.freeze({
  action: 'Check a change',
  workflow: 'Review the change. Run executable checks. Decide whether to ship.',
  reviewTitle: 'Review the change',
  reviewDescription:
    'Inspect an exact branch or pull request. Findings are leads; executable checks determine confidence.',
  runtimeTitle: 'Runtime evidence',
  runtimeDescription:
    'Run bounded checks against the exact change, then inspect failures, limitations, and receipts.',
});

export interface VerificationDecisionInput {
  fixedCount: number;
  reproducedCount: number;
  notReproducedCount: number;
  uncheckedCount: number;
  executionFailureCount: number;
  blockedProcedureCount: number;
  satisfiedProcedureCount: number;
}

export interface VerificationDecisionSummary {
  status: 'ship_candidate' | 'hold' | 'no_confidence';
  label: 'Ship candidate' | 'Hold' | 'No confidence';
  evidenceStrength: string;
  limitation: string;
  nextAction: string;
}

export function deriveVerificationDecisionSummary(
  input: VerificationDecisionInput
): VerificationDecisionSummary {
  const recordedFindingEvidence =
    input.fixedCount + input.reproducedCount + input.notReproducedCount;
  const recordedProcedureEvidence =
    input.executionFailureCount + input.blockedProcedureCount + input.satisfiedProcedureCount;
  const hasRecordedEvidence = recordedFindingEvidence + recordedProcedureEvidence > 0;

  if (input.executionFailureCount > 0 || input.blockedProcedureCount > 0) {
    const blockers = [
      input.executionFailureCount > 0
        ? `${input.executionFailureCount} executable failure${input.executionFailureCount === 1 ? '' : 's'}`
        : null,
      input.blockedProcedureCount > 0
        ? `${input.blockedProcedureCount} blocked check${input.blockedProcedureCount === 1 ? '' : 's'}`
        : null,
      input.uncheckedCount > 0
        ? `${input.uncheckedCount} unchecked finding${input.uncheckedCount === 1 ? '' : 's'}`
        : null,
    ].filter((value): value is string => value !== null);
    return {
      status: 'hold',
      label: 'Hold',
      evidenceStrength: hasRecordedEvidence
        ? 'Executable evidence recorded'
        : 'Review findings only',
      limitation: blockers.join(' · '),
      nextAction: 'Resolve the failed or blocked checks before making a shipping decision.',
    };
  }

  if (input.uncheckedCount > 0) {
    return {
      status: 'hold',
      label: 'Hold',
      evidenceStrength: hasRecordedEvidence ? 'Partial evidence' : 'Review findings only',
      limitation: `${input.uncheckedCount} finding${input.uncheckedCount === 1 ? '' : 's'} still unverified`,
      nextAction: 'Reproduce, dismiss, or verify every remaining finding.',
    };
  }

  if (!hasRecordedEvidence) {
    return {
      status: 'no_confidence',
      label: 'No confidence',
      evidenceStrength: 'Review findings only',
      limitation: 'No qualifying runtime evidence has been recorded.',
      nextAction: 'Run a verification command or open Runtime evidence.',
    };
  }

  return {
    status: 'ship_candidate',
    label: 'Ship candidate',
    evidenceStrength: 'Recorded evidence has no open finding-level failures',
    limitation: 'Review repository scope and coverage limits before shipping.',
    nextAction: 'Inspect the receipt and limitations, then make the shipping decision.',
  };
}
