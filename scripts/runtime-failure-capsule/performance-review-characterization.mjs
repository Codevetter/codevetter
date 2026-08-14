import { inspectGitDiff } from './git-diff.mjs';
import {
  assertPerformanceFlowScope,
  contractOwnsReviewBinding,
  loadPerformanceFlowContract,
} from './performance-flow-contract.mjs';
import { diagnosePerformanceRepository } from './performance-diagnosis.mjs';
import { assertPerformanceLabCorrectnessScope } from './performance-lab-contracts.mjs';
import { profileRepository } from './performance.mjs';
import { selectProfileExperimentFinding } from './profile-tool-diagnosis.mjs';
import { retainPerformanceReviewHistory } from './performance-review-history.mjs';
import { attemptAutomaticPerformanceReviewPair } from './performance-review-paired.mjs';

export const PERFORMANCE_REVIEW_CHARACTERIZATION_SCHEMA_VERSION =
  'runtime-review-performance-characterization/v1';

const REVIEW_SAMPLES = 2;
const REVIEW_WARMUPS = 0;
const REVIEW_CHILD_TIMEOUT_MS = 5_000;

export async function characterizePerformanceForReview(
  { repositoryRoot, source, performanceScope, correctnessScope, manifestSha256, expectedSubject },
  {
    inspectSnapshot = inspectGitDiff,
    loadFlowContract = loadPerformanceFlowContract,
    profilePerformance = profileRepository,
    diagnosePerformance = diagnosePerformanceRepository,
    retainHistory = retainPerformanceReviewHistory,
    attemptPairedReview = attemptAutomaticPerformanceReviewPair,
  } = {}
) {
  const exactPerformance = assertPerformanceFlowScope(performanceScope);
  const exactCorrectness = assertPerformanceLabCorrectnessScope(correctnessScope);
  if (!safeSource(source)) throw new Error('review performance source is invalid');
  if (!/^[0-9a-f]{64}$/.test(manifestSha256 ?? '')) {
    throw new Error('review performance manifest digest is invalid');
  }
  if (
    !expectedSubject ||
    !/^[0-9a-f]{40,64}$/.test(expectedSubject.repository_revision ?? '') ||
    !/^[0-9a-f]{64}$/.test(expectedSubject.source_snapshot_sha256 ?? '')
  ) {
    throw new Error('review performance expected subject is invalid');
  }

  const [initial, contract] = await Promise.all([
    inspectSnapshot(repositoryRoot),
    loadFlowContract(repositoryRoot),
  ]);
  if (!sameSubject(initial, expectedSubject)) {
    return noConfidence(exactPerformance, initial, 'expected_snapshot_changed');
  }
  if (
    !contract.present ||
    contract.manifest_sha256 !== manifestSha256 ||
    !contractOwnsReviewBinding(contract, {
      source,
      performanceScope: exactPerformance,
      correctnessScope: exactCorrectness,
    })
  ) {
    return noConfidence(exactPerformance, initial, 'performance_binding_changed');
  }

  const capsule = await profilePerformance({
    repositoryRoot,
    adapter: exactPerformance.adapter,
    target: exactPerformance.target,
    name: exactPerformance.name,
    timeoutMs: REVIEW_CHILD_TIMEOUT_MS,
    samples: REVIEW_SAMPLES,
    warmups: REVIEW_WARMUPS,
  });
  const final = await inspectSnapshot(repositoryRoot);
  if (!sameSubject(final, initial)) {
    return noConfidence(exactPerformance, final, 'source_changed_during_performance');
  }
  if (!sameSubject(capsule.subject, final) || capsule.scope?.target !== exactPerformance.target) {
    return noConfidence(exactPerformance, final, 'performance_subject_mismatch');
  }

  const diagnosis = await diagnosePerformance(capsule, repositoryRoot);
  const candidate =
    diagnosis.next_action?.kind === 'optimize_one_candidate_then_compare'
      ? selectProfileExperimentFinding(diagnosis)
      : null;
  let history;
  try {
    history = await retainHistory({
      repositoryRoot,
      source,
      performanceScope: exactPerformance,
      correctnessScope: exactCorrectness,
      manifestSha256,
      capsule,
    });
  } catch (error) {
    history = {
      persistence: { status: 'unavailable' },
      predecessor: null,
      screening: null,
      diagnostics: { reason: safeHistoryReason(error) },
      unverified: [
        'Performance history was unavailable, so no historical screening was attempted.',
      ],
    };
  }
  const ownedBinding = contract.bindings.find(
    (binding) =>
      binding.sources?.includes(source) &&
      binding.performance.adapter === exactPerformance.adapter &&
      binding.performance.target === exactPerformance.target &&
      (binding.performance.name ?? null) === (exactPerformance.name ?? null) &&
      binding.correctness.adapter === exactCorrectness.adapter &&
      binding.correctness.target === exactCorrectness.target &&
      binding.correctness.name === exactCorrectness.name
  );
  let pairedVerification;
  try {
    pairedVerification = await attemptPairedReview({
      repositoryRoot,
      source,
      ownedSources: ownedBinding?.sources ?? [source],
      performanceScope: exactPerformance,
      correctnessScope: exactCorrectness,
      manifestSha256,
      expectedSubject: final,
      history,
    });
  } catch (error) {
    pairedVerification = unavailablePairedVerification(error);
  }
  const status = capsule.verdict?.status === 'profiled' ? 'profiled' : 'no_confidence';
  return {
    schema_version: PERFORMANCE_REVIEW_CHARACTERIZATION_SCHEMA_VERSION,
    status,
    observed: {
      subject: publicSubject(final),
      scope: exactPerformance,
      sample_policy: { samples: REVIEW_SAMPLES, warmups: REVIEW_WARMUPS },
      workload: capsule.verdict,
      wall_time_ms: capsule.observed?.wall_time_ms ?? null,
      peak_rss_bytes: capsule.observed?.peak_rss_bytes ?? null,
      go_benchmarks: boundedArray(capsule.observed?.go_benchmarks, 4),
      console_metrics: boundedArray(capsule.observed?.console_metrics, 8),
      vitest_execution_share: capsule.observed?.vitest_execution_share ?? null,
      hotspots: boundedArray(
        capsule.observed?.hotspots?.filter((hotspot) => hotspot.role === 'application'),
        4
      ),
      history: {
        persistence: history.persistence,
        predecessor: history.predecessor,
        diagnostics: history.diagnostics,
      },
      paired_verification: {
        status: pairedVerification.status,
        reason: pairedVerification.reason,
        observed: pairedVerification.observed,
        limitations: pairedVerification.limitations,
      },
    },
    inferred: {
      diagnosis: diagnosis.diagnosis,
      candidate: candidate ? compactCandidate(candidate) : null,
      next_action: diagnosis.next_action,
      sequential_screening: history.screening,
      paired_verification:
        pairedVerification.status === 'not_run' ? null : pairedVerification.inferred,
    },
    limitations: boundedArray(
      [
        ...boundedArray(diagnosis.limitations, 12),
        ...(history.persistence?.status === 'unavailable'
          ? ['Local performance screening history was unavailable.']
          : []),
        ...(history.persistence?.status === 'storage_full'
          ? ['Local performance screening history reached its fixed record bound.']
          : []),
        ...(pairedVerification.status === 'no_confidence'
          ? boundedArray(pairedVerification.limitations, 2)
          : []),
      ],
      14
    ),
    unverified: [
      ...boundedArray(
        pairedVerification.status === 'not_run'
          ? history.unverified
          : pairedVerification.unverified,
        3
      ),
      ...(pairedVerification.status === 'accepted'
        ? []
        : [
            history.screening
              ? 'No accepted interleaved paired comparison is available, so the historical screen cannot authorize an improvement verdict.'
              : 'No compatible prior characterization or paired comparison was available, so this is not an improvement or regression verdict.',
          ]),
      'The measurements describe only the exact local repository-owned flow.',
      'Production impact and flows outside this scope remain unverified.',
    ],
  };
}

function noConfidence(scope, subject, reason) {
  return {
    schema_version: PERFORMANCE_REVIEW_CHARACTERIZATION_SCHEMA_VERSION,
    status: 'no_confidence',
    reason,
    observed: {
      subject: publicSubject(subject),
      scope,
    },
    inferred: null,
    limitations: [
      reason === 'performance_binding_changed'
        ? 'The repository-owned source, performance, and correctness binding no longer matches the review plan.'
        : reason === 'source_changed_during_performance'
          ? 'The repository source snapshot changed during performance characterization.'
          : 'The expected repository snapshot did not remain authoritative for performance characterization.',
    ],
    unverified: ['No current performance characterization is available.'],
  };
}

function compactCandidate(candidate) {
  return {
    id: candidate.id,
    kind: candidate.kind,
    source: candidate.source,
    observed: candidate.observed,
    inference: candidate.inference,
    confidence: candidate.confidence,
    expected_effect: candidate.expected_effect,
    verification: candidate.verification,
    unverified: boundedArray(candidate.unverified, 8),
  };
}

function safeSource(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !/[\0\r\n]/.test(value) &&
    !value.split('/').some((part) => part === '' || part === '.' || part === '..')
  );
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

function boundedArray(value, maximum) {
  return Array.isArray(value) ? value.slice(0, maximum) : [];
}

function safeHistoryReason(error) {
  const value = error instanceof Error ? error.message : 'history_unavailable';
  return /^[a-zA-Z0-9 .,_:-]{1,200}$/.test(value) ? value : 'history_unavailable';
}

function unavailablePairedVerification(error) {
  return {
    status: 'no_confidence',
    reason: 'automatic_pair_unavailable',
    observed: { detail: safeHistoryReason(error) },
    inferred: null,
    limitations: ['Automatic interleaved paired verification was unavailable.'],
    unverified: ['No accepted local optimization or production claim is available.'],
  };
}
