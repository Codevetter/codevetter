import { normalizeCorrectnessExecution } from './campaign.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import {
  contractOwnsCorrectnessScope,
  loadPerformanceFlowContract,
} from './performance-flow-contract.mjs';
import { assertPerformanceLabCorrectnessScope } from './performance-lab-contracts.mjs';
import { runClosedAdapter } from './runner.mjs';

export const PERFORMANCE_REVIEW_CORRECTNESS_SCHEMA_VERSION = 'runtime-review-correctness/v1';

export async function verifyPerformanceReviewCorrectness(
  { repositoryRoot, scope, manifestSha256, expectedSubject },
  {
    inspectSnapshot = inspectGitDiff,
    loadFlowContract = loadPerformanceFlowContract,
    runAdapter = runClosedAdapter,
  } = {}
) {
  const exactScope = assertPerformanceLabCorrectnessScope(scope);
  if (!/^[0-9a-f]{64}$/.test(manifestSha256 ?? '')) {
    throw new Error('review correctness manifest digest is invalid');
  }
  if (
    !expectedSubject ||
    !/^[0-9a-f]{40,64}$/.test(expectedSubject.repository_revision ?? '') ||
    !/^[0-9a-f]{64}$/.test(expectedSubject.source_snapshot_sha256 ?? '')
  ) {
    throw new Error('review correctness expected subject is invalid');
  }

  const [initial, contract] = await Promise.all([
    inspectSnapshot(repositoryRoot),
    loadFlowContract(repositoryRoot),
  ]);
  if (!sameSubject(initial, expectedSubject)) {
    return noConfidence(exactScope, initial, 'expected_snapshot_changed');
  }
  if (
    !contract.present ||
    contract.manifest_sha256 !== manifestSha256 ||
    !contractOwnsCorrectnessScope(contract, exactScope)
  ) {
    return noConfidence(exactScope, initial, 'correctness_binding_changed');
  }

  const execution = await runAdapter({
    repositoryRoot,
    adapter: exactScope.adapter,
    target: exactScope.target,
    name: exactScope.name,
    timeoutMs: 30_000,
  });
  const final = await inspectSnapshot(repositoryRoot);
  if (!sameSubject(final, initial)) {
    return noConfidence(exactScope, final, 'source_changed_during_correctness');
  }

  const normalized = normalizeCorrectnessExecution(
    { ...exactScope, timeout_ms: 30_000 },
    execution,
    'current_review'
  );
  const status = ['passed', 'failed'].includes(normalized.status)
    ? normalized.status
    : 'no_confidence';
  return {
    schema_version: PERFORMANCE_REVIEW_CORRECTNESS_SCHEMA_VERSION,
    status,
    observed: {
      subject: publicSubject(final),
      scope: normalized.scope,
      execution: {
        status: normalized.status,
        exit_code: normalized.exit_code,
        duration_ms: normalized.duration_ms,
        selection: normalized.selection,
      },
    },
    reason:
      status === 'passed'
        ? 'exact_current_correctness_passed'
        : status === 'failed'
          ? 'exact_current_correctness_failed'
          : 'exact_current_correctness_unproven',
    limitations: normalized.limitation ? [normalized.limitation] : [],
  };
}

function noConfidence(scope, subject, reason) {
  return {
    schema_version: PERFORMANCE_REVIEW_CORRECTNESS_SCHEMA_VERSION,
    status: 'no_confidence',
    observed: {
      subject: publicSubject(subject),
      scope,
      execution: null,
    },
    reason,
    limitations: [
      reason === 'source_changed_during_correctness'
        ? 'The repository source snapshot changed during exact correctness execution.'
        : reason === 'correctness_binding_changed'
          ? 'The repository-owned correctness binding no longer matches the accepted receipt.'
          : 'The repository source snapshot no longer matches the bounded review plan.',
    ],
  };
}

function sameSubject(left, right) {
  return (
    left?.repository_revision === right?.repository_revision &&
    left?.source_snapshot_sha256 === right?.source_snapshot_sha256
  );
}

function publicSubject(value) {
  return {
    repository_revision: value?.repository_revision ?? null,
    source_snapshot_sha256: value?.source_snapshot_sha256 ?? null,
  };
}
