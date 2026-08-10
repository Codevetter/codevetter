import { spawn } from 'node:child_process';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { sha256, stableStringify } from './campaign-contracts.mjs';
import { createOptimizationCampaignService, inspectRepositoryState } from './campaign.mjs';
import {
  CANDIDATE_CHALLENGE_SCHEMA_VERSION,
  CONTRIBUTION_LIMITS,
  CONTRIBUTION_PUBLICATION_SCHEMA_VERSION,
  CONTRIBUTION_RECEIPT_SCHEMA_VERSION,
  assertCandidateChallenge,
  assertContributionPublication,
  assertContributionReceipt,
  createDigestedArtifact,
  deriveContributionStatus,
} from './contribution-contracts.mjs';
import { redactText } from './redact.mjs';

const CLOSEOUT_DIRECTORY = 'closeout';
const RECEIPT_LEDGER = 'contributions.ndjson';
const PUBLICATION_FILE = 'publication.json';
const TREX_POLICIES = new Set(['optional', 'required', 'not_applicable']);
const SIMPLER_TOLERANCE_PERCENT = 5;

const RISK_PATTERNS = Object.freeze([
  ['mutable_state', /^\+.*\b(?:cache|cached|memoized|state)\b/im],
  ['class_member_state', /^\+\s*(?:private|protected)\s+(?:readonly\s+)?\w+\s*[:=]/im],
  ['cleanup_path', /^\+.*\b(?:finally|defer)\b/im],
  ['fallback_path', /^\+.*\b(?:fallback|else)\b/im],
  ['new_branch', /^\+.*\b(?:if\s*\(|switch\s*\()/im],
  [
    'public_signature',
    /^\+.*\b(?:export\s+(?:async\s+)?(?:function|class|const|let|var)|public\s+\w+)/im,
  ],
]);

export async function createOptimizationContributionService(repositoryRoot, overrides = {}) {
  const root = await realpath(resolve(repositoryRoot));
  const dependencies = {
    now: () => new Date(),
    campaignService: await createOptimizationCampaignService(root),
    inspectRepositoryState,
    inspectCandidateCommit,
    readCandidateDiff,
    githubInspector: inspectGitHubPullRequest,
    ...overrides,
  };
  return {
    challenge: (input) => challengeCandidate(root, input, dependencies),
    inspect: (input) => inspectContribution(root, input, dependencies),
    refresh: (input) => inspectContribution(root, input, dependencies),
  };
}

async function challengeCandidate(root, input, dependencies) {
  closedInput(
    input,
    ['campaign_directory', 'selected_sequence'],
    ['comparison_sequence', 'simpler_not_applicable_reason']
  );
  const campaign = await dependencies.campaignService.inspect({
    campaign_directory: input.campaign_directory,
  });
  const selectedRecord = qualifiedPromotion(campaign.records, input.selected_sequence, 'selected');
  const currentRepository = await dependencies.inspectRepositoryState(root, campaign.manifest);
  if (currentRepository.diff_digest !== selectedRecord.repository.diff_digest) {
    throw new Error('current candidate diff does not match the selected promotion record');
  }
  if (currentRepository.revision !== selectedRecord.repository.revision) {
    throw new Error('current candidate revision does not match the selected promotion record');
  }
  const commitState = await dependencies.inspectCandidateCommit(root, campaign.manifest);
  if (!commitState.clean) {
    throw new Error(
      `candidate must be committed before challenge; uncommitted files: ${commitState.changed_files.slice(0, 8).join(', ')}`
    );
  }
  const selectedEvidence = await dependencies.campaignService.evidence({
    campaign_directory: input.campaign_directory,
    record_sequence: selectedRecord.sequence,
  });
  const selected = challengeCandidateIdentity(
    selectedRecord,
    currentRepository.revision,
    performanceMetrics(selectedEvidence.evidence)
  );
  let comparison = null;
  let comparisonEvidence = null;
  if (input.comparison_sequence !== undefined) {
    const comparisonRecord = qualifiedPromotion(
      campaign.records,
      input.comparison_sequence,
      'comparison'
    );
    comparisonEvidence = await dependencies.campaignService.evidence({
      campaign_directory: input.campaign_directory,
      record_sequence: comparisonRecord.sequence,
    });
    comparison = challengeCandidateIdentity(
      comparisonRecord,
      comparisonRecord.repository.revision,
      performanceMetrics(comparisonEvidence.evidence)
    );
  }
  const diff = await dependencies.readCandidateDiff(root, campaign.manifest, currentRepository);
  const observations = {
    changed_files: currentRepository.changed_files,
    diff_digest: sha256(diff),
    risk_signals: riskSignals(diff, currentRepository.changed_files),
  };
  const patchQuality = derivePatchQuality({
    selected,
    comparison,
    selectedEvidence: selectedEvidence.evidence,
    comparisonEvidence: comparisonEvidence?.evidence,
    riskSignals: observations.risk_signals,
    justification: input.simpler_not_applicable_reason,
    root,
  });
  const challenge = createDigestedArtifact(
    CANDIDATE_CHALLENGE_SCHEMA_VERSION,
    {
      campaign_id: campaign.manifest.campaign_id,
      created_at: dependencies.now().toISOString(),
      candidate: selected,
      comparison,
      diff_observations: observations,
      patch_quality: patchQuality,
    },
    'challenge_digest'
  );
  assertCandidateChallenge(challenge);
  const directory = safeCampaignDirectory(input.campaign_directory);
  const canonicalCampaign = await realpath(resolve(root, directory));
  assertContained(root, canonicalCampaign, 'campaign directory');
  const path = `${directory}/${CLOSEOUT_DIRECTORY}/challenge-${selected.candidate_revision.slice(0, 12)}-${challenge.challenge_digest.slice(0, 12)}.json`;
  await writeContainedArtifact(root, path, `${stableStringify(challenge)}\n`, canonicalCampaign);
  return { path, challenge };
}

async function inspectContribution(root, input, dependencies) {
  closedInput(
    input,
    ['campaign_directory', 'challenge_path', 'pull_request_url', 'trex_policy'],
    ['trex_receipt', 'trex_not_applicable_reason']
  );
  if (!TREX_POLICIES.has(input.trex_policy)) throw new Error('trex_policy is unsupported');
  const campaignDirectory = safeCampaignDirectory(input.campaign_directory);
  const canonicalCampaign = await realpath(resolve(root, campaignDirectory));
  assertContained(root, canonicalCampaign, 'campaign directory');
  const challengePath = safeContainedPath(input.challenge_path, 'challenge_path');
  if (!challengePath.startsWith(`${campaignDirectory}/${CLOSEOUT_DIRECTORY}/`)) {
    throw new Error('challenge_path must stay inside the selected campaign closeout directory');
  }
  const trexPath = input.trex_receipt
    ? safeContainedPath(input.trex_receipt, 'trex_receipt')
    : null;
  validateTrexPolicy(input, trexPath);
  const challenge = await readJsonArtifact(
    root,
    challengePath,
    CONTRIBUTION_LIMITS.receiptBytes,
    canonicalCampaign
  );
  assertCandidateChallenge(challenge);
  const campaign = await dependencies.campaignService.inspect({
    campaign_directory: campaignDirectory,
  });
  if (challenge.campaign_id !== campaign.manifest.campaign_id) {
    throw new Error('challenge campaign identity does not match the selected campaign');
  }
  const selectedRecord = qualifiedPromotion(
    campaign.records,
    challenge.candidate.sequence,
    'challenge candidate'
  );
  if (selectedRecord.record_digest !== challenge.candidate.record_digest) {
    throw new Error('challenge campaign record digest is stale');
  }
  const pullRequest = normalizeGitHubEvidence(
    await dependencies.githubInspector(input.pull_request_url)
  );
  if (pullRequest.identity.url !== canonicalPullRequestUrl(input.pull_request_url)) {
    throw new Error('GitHub returned a different pull request identity');
  }
  const trex = await importTrexGate(root, input, challenge.candidate.candidate_revision, trexPath);
  const gates = contributionGates(challenge, selectedRecord, pullRequest, trex);
  const ledgerPath = `${campaignDirectory}/${CLOSEOUT_DIRECTORY}/${RECEIPT_LEDGER}`;
  const publicationPath = `${campaignDirectory}/${CLOSEOUT_DIRECTORY}/${PUBLICATION_FILE}`;
  const previous = await readReceiptLedger(root, ledgerPath, canonicalCampaign);
  const feedbackLearning = await deriveFeedbackLearning({
    root,
    previous,
    challenge,
    selectedRecord,
    pullRequest,
    gates,
    canonicalCampaign,
  });
  const receiptPayload = {
    campaign_id: campaign.manifest.campaign_id,
    observed_at: dependencies.now().toISOString(),
    pull_request: pullRequest.identity,
    evidence: {
      campaign_record_digest: selectedRecord.record_digest,
      baseline_revision: campaign.manifest.repository_revision,
      candidate_revision: challenge.candidate.candidate_revision,
      candidate_diff_digest: challenge.candidate.diff_digest,
      challenge_path: challengePath,
      challenge_digest: challenge.challenge_digest,
      trex_path: trexPath,
    },
    gates,
    status: deriveContributionStatus(gates, pullRequest.identity),
    limitations: trex.limitations,
    feedback_learning: feedbackLearning,
    previous_receipt_digest: previous.at(-1)?.receipt_digest ?? null,
  };
  const receipt = createDigestedArtifact(
    CONTRIBUTION_RECEIPT_SCHEMA_VERSION,
    receiptPayload,
    'receipt_digest'
  );
  assertContributionReceipt(receipt);
  await appendReceipt(root, ledgerPath, previous, receipt, canonicalCampaign);
  const publication = await updatePublication(root, publicationPath, receipt, canonicalCampaign);
  return { receipt_path: ledgerPath, receipt, publication_path: publicationPath, publication };
}

function qualifiedPromotion(records, sequence, label) {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error(`${label}_sequence must be a non-negative integer`);
  }
  const record = records[sequence];
  if (!record || record.sequence !== sequence) throw new Error(`${label} record is unavailable`);
  if (record.kind !== 'promotion' || record.decision.status !== 'keep') {
    throw new Error(`${label} record must be a qualified keep promotion`);
  }
  if (!record.repository?.diff_digest)
    throw new Error(`${label} repository identity is incomplete`);
  return record;
}

function challengeCandidateIdentity(record, revision, metrics) {
  return {
    sequence: record.sequence,
    record_digest: record.record_digest,
    candidate_revision: revision,
    diff_digest: record.repository.diff_digest,
    complexity: record.complexity,
    performance_metric: metrics.target,
    control_metrics: metrics.controls,
  };
}

function performanceMetrics(evidence) {
  const verification = evidence?.verification;
  const scale = verification?.observed?.find(
    (observation) => observation.kind === 'scale_point_comparison'
  );
  if (scale?.points?.length > 0) {
    const target = scale.points.at(-1);
    return {
      target: {
        kind: 'largest_scale_point',
        value: target.current,
        unit: target.unit,
      },
      controls: scale.points.slice(0, -1).map((point) => ({
        label: `input:${point.input}`,
        kind: 'scale_control_point',
        value: point.current,
        unit: point.unit,
      })),
    };
  }
  const go = verification?.observed?.find(
    (observation) => observation.kind === 'go_benchmark_comparison'
  );
  if (go?.metrics?.ns_per_op?.current !== undefined) {
    return {
      target: { kind: 'go_ns_per_op', value: go.metrics.ns_per_op.current, unit: 'ns/op' },
      controls: ['bytes_per_op', 'allocs_per_op'].flatMap((name) =>
        go.metrics?.[name]?.current === undefined
          ? []
          : [
              {
                label: name,
                kind: `go_${name}`,
                value: go.metrics[name].current,
                unit: name === 'bytes_per_op' ? 'B/op' : 'allocs/op',
              },
            ]
      ),
    };
  }
  const wall = verification?.observed?.find(
    (observation) => observation.kind === 'wall_time_comparison'
  );
  if (wall?.comparison?.current_median_ms !== undefined) {
    return {
      target: { kind: 'wall_time', value: wall.comparison.current_median_ms, unit: 'ms' },
      controls: [],
    };
  }
  return { target: null, controls: [] };
}

function derivePatchQuality({
  selected,
  comparison,
  selectedEvidence,
  comparisonEvidence,
  riskSignals: signals,
  justification,
  root,
}) {
  const sanitizedJustification = sanitizeJustification(justification, root);
  if (comparison) {
    const sameWorkload =
      selectedEvidence?.verification?.workload_identity?.digest &&
      selectedEvidence.verification.workload_identity.digest ===
        comparisonEvidence?.verification?.workload_identity?.digest;
    const comparable =
      sameWorkload &&
      selected.performance_metric &&
      comparison.performance_metric &&
      selected.performance_metric.kind === comparison.performance_metric.kind &&
      selected.performance_metric.unit === comparison.performance_metric.unit &&
      compatibleControls(selected.control_metrics, comparison.control_metrics);
    if (!comparable) {
      return {
        status: 'no_confidence',
        reason: 'Candidate performance evidence is not directly comparable on one workload.',
        justification: sanitizedJustification,
      };
    }
    const selectedMovement = codeMovement(selected.complexity);
    const comparisonMovement = codeMovement(comparison.complexity);
    const withinTolerance =
      selected.performance_metric.value <=
        comparison.performance_metric.value * (1 + SIMPLER_TOLERANCE_PERCENT / 100) &&
      selected.control_metrics.every(
        (metric, index) =>
          metric.value <=
          comparison.control_metrics[index].value * (1 + SIMPLER_TOLERANCE_PERCENT / 100)
      );
    if (selectedMovement <= comparisonMovement && withinTolerance) {
      return {
        status: 'simpler_candidate_selected',
        reason: `Selected candidate is no more complex and remains within ${SIMPLER_TOLERANCE_PERCENT}% on the target and ${selected.control_metrics.length} recorded control metric(s).`,
        justification: sanitizedJustification,
      };
    }
    return {
      status: 'no_confidence',
      reason:
        'A qualified comparison is simpler or the selected candidate misses the performance tolerance.',
      justification: sanitizedJustification,
    };
  }
  if (!sanitizedJustification) {
    return {
      status: 'no_confidence',
      reason:
        signals.length > 0
          ? 'The diff adds defensive complexity without a qualified comparison or invariant justification.'
          : 'A bounded reason is required when no simpler-candidate comparison is supplied.',
      justification: null,
    };
  }
  return {
    status: 'retained_with_justification',
    reason:
      signals.length > 0
        ? 'Risk signals are retained as observations and covered by the supplied invariant justification.'
        : 'No deterministic defensive-complexity signal was observed; the missing comparison is explicitly bounded.',
    justification: sanitizedJustification,
  };
}

function compatibleControls(selected, comparison) {
  return (
    selected.length === comparison.length &&
    selected.every(
      (metric, index) =>
        metric.label === comparison[index].label &&
        metric.kind === comparison[index].kind &&
        metric.unit === comparison[index].unit
    )
  );
}

function riskSignals(diff, changedFiles) {
  const sourceSignals = RISK_PATTERNS.flatMap(([kind, pattern]) => {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const matches = String(diff).match(new RegExp(pattern.source, flags));
    return matches?.length ? [{ kind, occurrences: matches.length }] : [];
  });
  if (
    changedFiles.some((path) =>
      /(?:^|\/)(?:package\.json|go\.mod|Cargo\.toml|requirements\.txt|pyproject\.toml)$/.test(path)
    )
  ) {
    sourceSignals.push({ kind: 'dependency_manifest', occurrences: 1 });
  }
  return sourceSignals;
}

function codeMovement(complexity) {
  return Math.max(0, complexity.added_lines) + Math.max(0, complexity.deleted_lines);
}

function sanitizeJustification(value, root) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  if (typeof value !== 'string' || value.length > CONTRIBUTION_LIMITS.justificationCharacters) {
    throw new Error('simpler_not_applicable_reason is too long');
  }
  return redactText(value.trim(), {
    repositoryRoot: root,
    limit: CONTRIBUTION_LIMITS.justificationCharacters,
  }).text;
}

async function deriveFeedbackLearning({
  root,
  previous,
  challenge,
  selectedRecord,
  pullRequest,
  gates,
  canonicalCampaign,
}) {
  const latest = previous.at(-1);
  const carried = latest?.feedback_learning ?? [];
  if (latest && latest.pull_request.url !== pullRequest.identity.url) {
    throw new Error('contribution ledger belongs to a different pull request');
  }
  if (!latest || latest.evidence.candidate_revision === challenge.candidate.candidate_revision) {
    return carried;
  }
  const source = previous.findLast(
    (receipt) =>
      receipt.evidence.candidate_revision !== challenge.candidate.candidate_revision &&
      receipt.gates.reviews.observations.some(
        (observation) =>
          observation.kind === 'thread' && !observation.resolved && !observation.outdated
      )
  );
  if (!source) return carried;
  const feedback = source.gates.reviews.observations
    .filter(
      (observation) =>
        observation.kind === 'thread' && !observation.resolved && !observation.outdated
    )
    .map((observation) => ({
      author: observation.author,
      path: observation.path,
      line: observation.line ?? null,
      summary: observation.summary,
    }));
  if (feedback.length === 0) return carried;
  const priorChallenge = await readJsonArtifact(
    root,
    source.evidence.challenge_path,
    CONTRIBUTION_LIMITS.receiptBytes,
    canonicalCampaign
  );
  assertCandidateChallenge(priorChallenge);
  if (priorChallenge.challenge_digest !== source.evidence.challenge_digest) {
    throw new Error('previous contribution challenge digest does not match its receipt');
  }
  const learning = {
    source_candidate_revision: source.evidence.candidate_revision,
    revised_candidate_revision: challenge.candidate.candidate_revision,
    feedback,
    rejected_patterns: priorChallenge.diff_observations.risk_signals.map((signal) => signal.kind),
    before_complexity: priorChallenge.candidate.complexity,
    after_complexity: challenge.candidate.complexity,
    revised_hypothesis:
      typeof selectedRecord.hypothesis === 'string' && selectedRecord.hypothesis.trim()
        ? sanitizeJustification(selectedRecord.hypothesis, root)
        : null,
    correctness_status: gates.correctness.status,
    performance_status: gates.performance.status,
    upstream_disposition: `${pullRequest.identity.state}:${deriveContributionStatus(gates, pullRequest.identity)}`,
  };
  return [...carried, learning].slice(-CONTRIBUTION_LIMITS.feedbackLearning);
}

async function updatePublication(root, path, receipt, canonicalCampaign) {
  const existing = await readPublication(root, path, canonicalCampaign);
  let publication;
  if (receipt.gates.freshness.status === 'current') {
    publication = createDigestedArtifact(
      CONTRIBUTION_PUBLICATION_SCHEMA_VERSION,
      {
        campaign_id: receipt.campaign_id,
        updated_at: receipt.observed_at,
        status: 'current',
        source_receipt_digest: receipt.receipt_digest,
        candidate_revision: receipt.evidence.candidate_revision,
        pull_request: receipt.pull_request,
        summary: {
          performance: receipt.gates.performance.status,
          correctness: receipt.gates.correctness.status,
          patch_quality: receipt.gates.patch_quality.status,
          contribution: receipt.status,
        },
        feedback_learning: receipt.feedback_learning,
        stale_reason: null,
      },
      'publication_digest'
    );
  } else if (existing) {
    publication = createDigestedArtifact(
      CONTRIBUTION_PUBLICATION_SCHEMA_VERSION,
      {
        campaign_id: existing.value.campaign_id,
        updated_at: receipt.observed_at,
        status: 'stale',
        source_receipt_digest: existing.value.source_receipt_digest,
        candidate_revision: existing.value.candidate_revision,
        pull_request: existing.value.pull_request,
        summary: existing.value.summary,
        feedback_learning: existing.value.feedback_learning,
        stale_reason: receipt.gates.freshness.reason,
      },
      'publication_digest'
    );
  } else {
    return null;
  }
  assertContributionPublication(publication);
  await replaceContainedArtifact(
    root,
    path,
    `${stableStringify(publication)}\n`,
    existing?.source ?? '',
    canonicalCampaign
  );
  return publication;
}

async function readPublication(root, path, containmentRoot) {
  const absolute = resolve(root, path);
  assertContained(root, absolute, path);
  try {
    const canonical = await realpath(absolute);
    assertContained(containmentRoot, canonical, path);
    const details = await stat(canonical);
    if (!details.isFile() || details.size > CONTRIBUTION_LIMITS.receiptBytes) {
      throw new Error('contribution publication is unavailable or oversized');
    }
    const source = await readFile(canonical, 'utf8');
    const value = JSON.parse(source);
    assertContributionPublication(value);
    return { source, value };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error('contribution publication is not valid JSON');
    throw error;
  }
}

function contributionGates(challenge, record, pullRequest, trex) {
  const freshness =
    pullRequest.identity.head_sha === challenge.candidate.candidate_revision
      ? {
          status: 'current',
          reason: 'Pull-request head matches the locally challenged candidate revision.',
        }
      : {
          status: 'stale',
          reason: `Expected ${challenge.candidate.candidate_revision}; observed ${pullRequest.identity.head_sha}.`,
        };
  const correctnessPassed =
    Array.isArray(record.correctness) &&
    record.correctness.length > 0 &&
    record.correctness.every((result) => result.status === 'passed');
  return {
    freshness,
    correctness: correctnessPassed
      ? { status: 'passed', reason: 'Every correctness result in the selected promotion passed.' }
      : { status: 'no_confidence', reason: 'Selected promotion correctness is incomplete.' },
    performance:
      record.decision.status === 'keep'
        ? { status: 'confirmed', reason: 'Selected campaign promotion met the keep policy.' }
        : { status: 'no_confidence', reason: 'Selected campaign promotion is not a keep.' },
    patch_quality: {
      status: challenge.patch_quality.status,
      reason: challenge.patch_quality.reason,
    },
    trex: {
      status: trex.status,
      reason: trex.reason,
      policy: trex.policy,
      limitations: trex.limitations,
    },
    checks: pullRequest.checks,
    reviews: pullRequest.reviews,
    approvals: pullRequest.approvals,
    merge_authority: pullRequest.mergeAuthority,
  };
}

async function importTrexGate(root, input, candidateRevision, path) {
  if (input.trex_policy === 'not_applicable') {
    return {
      status: 'not_applicable',
      policy: input.trex_policy,
      reason: sanitizeJustification(input.trex_not_applicable_reason, root),
      limitations: [],
    };
  }
  if (!path) {
    return {
      status: input.trex_policy === 'required' ? 'missing' : 'missing_optional',
      policy: input.trex_policy,
      reason:
        input.trex_policy === 'required'
          ? 'Required T-Rex evidence was not supplied.'
          : 'Optional T-Rex evidence was not supplied.',
      limitations:
        input.trex_policy === 'optional' ? ['Optional browser-flow evidence is absent.'] : [],
    };
  }
  let receipt;
  try {
    receipt = await readJsonArtifact(root, path, CONTRIBUTION_LIMITS.receiptBytes);
  } catch (error) {
    return {
      status: 'no_confidence',
      policy: input.trex_policy,
      reason: 'T-Rex receipt could not be read as bounded JSON.',
      limitations: [error.message],
    };
  }
  const limitations = Array.isArray(receipt.limitations)
    ? receipt.limitations.filter((entry) => typeof entry === 'string').slice(0, 50)
    : [];
  if (
    receipt.schema_version !== 1 ||
    typeof receipt.run_id !== 'string' ||
    !/^[0-9a-f]{40,64}$/i.test(receipt.source?.head_sha ?? '') ||
    !['passed_with_limits', 'failed', 'no_confidence'].includes(receipt.verdict) ||
    !['verified', 'claimed', 'mismatch'].includes(receipt.preview?.status)
  ) {
    return {
      status: 'no_confidence',
      policy: input.trex_policy,
      reason: 'T-Rex receipt schema or required evidence is unsupported.',
      limitations,
    };
  }
  if (receipt.source.head_sha !== candidateRevision || receipt.preview.status === 'mismatch') {
    return {
      status: 'stale',
      policy: input.trex_policy,
      reason: 'T-Rex source or preview identity does not match the challenged candidate.',
      limitations,
    };
  }
  return {
    status: receipt.verdict,
    policy: input.trex_policy,
    reason: receipt.summary || `T-Rex reported ${receipt.verdict}.`,
    limitations,
  };
}

function validateTrexPolicy(input, trexPath) {
  if (input.trex_policy === 'not_applicable') {
    if (trexPath) throw new Error('trex_receipt is incompatible with not_applicable policy');
    if (!input.trex_not_applicable_reason) {
      throw new Error('trex_not_applicable_reason is required for not_applicable policy');
    }
  } else if (input.trex_not_applicable_reason !== undefined) {
    throw new Error('trex_not_applicable_reason requires not_applicable policy');
  }
}

export function normalizeGitHubEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('GitHub inspection returned invalid evidence');
  }
  const identity = {
    url: canonicalPullRequestUrl(value.url),
    repository: value.repository,
    number: value.number,
    head_sha: value.head_sha,
    base_sha: value.base_sha,
    state: String(value.state).toLowerCase(),
    is_draft: Boolean(value.is_draft),
    mergeable: String(value.mergeable ?? 'unknown').toLowerCase(),
  };
  const checks = normalizeChecks(value.checks ?? []);
  const threads = (value.threads ?? []).slice(0, CONTRIBUTION_LIMITS.reviewThreads);
  const current = threads.filter((thread) => !thread.resolved && !thread.outdated);
  const outdated = threads.filter((thread) => thread.outdated);
  const resolved = threads.filter((thread) => thread.resolved);
  const observations = [
    ...(value.reviews ?? []).slice(0, CONTRIBUTION_LIMITS.reviewThreads).map((review) => ({
      kind: 'review',
      author: bounded(review.author, 100),
      state: bounded(review.state, 40),
      summary: bounded(review.body || '', 300),
    })),
    ...threads.map((thread) => ({
      kind: 'thread',
      author: bounded(thread.author, 100),
      path: bounded(thread.path, 300),
      line: Number.isInteger(thread.line) ? thread.line : null,
      summary: bounded(thread.body, 300),
      resolved: Boolean(thread.resolved),
      outdated: Boolean(thread.outdated),
    })),
  ];
  const reviews = {
    status: current.length > 0 ? 'action_required' : 'clear',
    reason:
      current.length > 0
        ? `${current.length} current unresolved maintainer thread(s) require contributor action.`
        : 'No current unresolved review thread requires action.',
    current_threads: current.length,
    outdated_threads: outdated.length,
    resolved_threads: resolved.length,
    observations,
  };
  const reviewStates = (value.reviews ?? []).map((review) => String(review.state).toUpperCase());
  const approvals = reviewStates.includes('CHANGES_REQUESTED')
    ? {
        status: 'changes_requested',
        reason: 'A submitted review requests changes.',
        observations: observations.filter((observation) => observation.kind === 'review'),
      }
    : reviewStates.includes('APPROVED')
      ? {
          status: 'approved',
          reason: 'At least one approval is observed.',
          observations: observations.filter((observation) => observation.kind === 'review'),
        }
      : {
          status: 'not_observed',
          reason: 'No approval or change-request review is observed.',
          observations: observations.filter((observation) => observation.kind === 'review'),
        };
  const permission = String(value.viewer_permission ?? '').toUpperCase();
  const mergeAuthority = ['ADMIN', 'MAINTAIN', 'WRITE'].includes(permission)
    ? { status: 'contributor', reason: `GitHub viewer permission is ${permission}.` }
    : ['READ', 'TRIAGE'].includes(permission)
      ? { status: 'external_maintainer', reason: `GitHub viewer permission is ${permission}.` }
      : { status: 'unknown', reason: 'GitHub merge authority could not be established.' };
  return { identity, checks, reviews, approvals, mergeAuthority };
}

function normalizeChecks(values) {
  const observations = values.slice(0, CONTRIBUTION_LIMITS.checkRuns).map((check) => ({
    name: bounded(check.name, 160),
    status: bounded(check.status, 40),
    conclusion: bounded(check.conclusion, 40),
    details_url: bounded(check.details_url, 300),
  }));
  const conclusions = observations.map((check) => check.conclusion.toLowerCase());
  const statuses = observations.map((check) => check.status.toLowerCase());
  const approvalRequired = observations.some(
    (check) =>
      ['action_required', 'approval_required'].includes(check.conclusion.toLowerCase()) ||
      /(?:authorize|approval_required|actions\/runs\/[^/]+\/approve)/i.test(check.details_url)
  );
  const failed = observations.some(
    (check) =>
      ['failure', 'failed', 'error', 'cancelled', 'timed_out'].includes(
        check.conclusion.toLowerCase()
      ) && !/(?:authorize|approval_required|actions\/runs\/[^/]+\/approve)/i.test(check.details_url)
  );
  let status = 'passed';
  let reason = 'All observed checks passed.';
  if (observations.length === 0) {
    status = 'not_observed';
    reason = 'No current-head check was observed.';
  } else if (failed) {
    status = 'failed';
    reason = 'At least one current-head check failed.';
  } else if (approvalRequired) {
    status = 'approval_required';
    reason = 'A current-head workflow requires repository approval.';
  } else if (
    statuses.some((value) => !['completed', 'success'].includes(value)) ||
    conclusions.some((value) => ['', 'pending', 'queued', 'in_progress'].includes(value))
  ) {
    status = 'pending';
    reason = 'At least one current-head check is pending.';
  }
  return { status, reason, observations };
}

export async function inspectGitHubPullRequest(url) {
  const parsed = parsePullRequestUrl(url);
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){viewerPermission pullRequest(number:$number){url number state isDraft mergeable headRefOid baseRefOid reviews(first:100){nodes{author{login}state body}} reviewThreads(first:100){nodes{isResolved isOutdated comments(first:20){nodes{author{login}body path line}}}} commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){nodes{__typename ... on CheckRun{name status conclusion detailsUrl} ... on StatusContext{context state targetUrl}}}}}}}}}}`;
  const output = await runCommand('gh', [
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-F',
    `owner=${parsed.owner}`,
    '-F',
    `name=${parsed.name}`,
    '-F',
    `number=${parsed.number}`,
  ]);
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    throw new Error('GitHub inspection did not return JSON');
  }
  const repository = payload?.data?.repository;
  const pr = repository?.pullRequest;
  if (!pr) throw new Error('GitHub pull request was not found');
  const contexts = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  return {
    url: pr.url,
    repository: `${parsed.owner}/${parsed.name}`,
    number: pr.number,
    head_sha: pr.headRefOid,
    base_sha: pr.baseRefOid,
    state: pr.state,
    is_draft: pr.isDraft,
    mergeable: pr.mergeable,
    viewer_permission: repository.viewerPermission,
    checks: contexts.map((context) =>
      context.__typename === 'StatusContext'
        ? {
            name: context.context,
            status: context.state === 'PENDING' ? 'pending' : 'completed',
            conclusion: context.state.toLowerCase(),
            details_url: context.targetUrl ?? '',
          }
        : {
            name: context.name,
            status: context.status,
            conclusion: context.conclusion ?? '',
            details_url: context.detailsUrl ?? '',
          }
    ),
    reviews: (pr.reviews?.nodes ?? []).map((review) => ({
      author: review.author?.login ?? 'unknown',
      state: review.state,
      body: review.body ?? '',
    })),
    threads: (pr.reviewThreads?.nodes ?? []).map((thread) => {
      const comment = thread.comments?.nodes?.at(-1) ?? {};
      return {
        resolved: thread.isResolved,
        outdated: thread.isOutdated,
        author: comment.author?.login ?? 'unknown',
        path: comment.path ?? '',
        line: comment.line ?? null,
        body: comment.body ?? '',
      };
    }),
  };
}

async function readCandidateDiff(root, manifest, repository) {
  let source = await runCommand('git', [
    '-C',
    root,
    'diff',
    '--no-ext-diff',
    '--unified=0',
    manifest.repository_revision,
    '--',
    ...repository.changed_files,
  ]);
  const untracked = new Set(
    (await runCommand('git', ['-C', root, 'ls-files', '--others', '--exclude-standard', '-z']))
      .split('\0')
      .filter(Boolean)
  );
  for (const path of repository.changed_files.filter((candidate) => untracked.has(candidate))) {
    const absolute = resolve(root, path);
    assertContained(root, absolute, 'untracked candidate source');
    const details = await stat(absolute);
    if (!details.isFile()) throw new Error(`untracked candidate is not a regular file: ${path}`);
    const content = await readFile(absolute, 'utf8');
    source += `\n+++ b/${path}\n${content
      .split(/\r?\n/)
      .map((line) => `+${line}`)
      .join('\n')}\n`;
    if (Buffer.byteLength(source) > CONTRIBUTION_LIMITS.receiptBytes) {
      throw new Error('candidate diff exceeds contribution evidence bounds');
    }
  }
  if (Buffer.byteLength(source) > CONTRIBUTION_LIMITS.receiptBytes) {
    throw new Error('candidate diff exceeds contribution evidence bounds');
  }
  return source;
}

async function inspectCandidateCommit(root, manifest) {
  const outputs = await Promise.all([
    runCommand('git', ['-C', root, 'diff', '--name-only', '-z', 'HEAD', '--']),
    runCommand('git', ['-C', root, 'diff', '--cached', '--name-only', '-z', 'HEAD', '--']),
    runCommand('git', ['-C', root, 'ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const changed = [
    ...new Set(outputs.flatMap((output) => output.split('\0').filter(Boolean))),
  ].filter(
    (path) =>
      path !== manifest.artifact_directory && !path.startsWith(`${manifest.artifact_directory}/`)
  );
  return { clean: changed.length === 0, changed_files: changed.sort() };
}

function parsePullRequestUrl(value) {
  const canonical = canonicalPullRequestUrl(value);
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(canonical);
  return { owner: match[1], name: match[2], number: Number(match[3]) };
}

function canonicalPullRequestUrl(value) {
  if (typeof value !== 'string' || value.length > CONTRIBUTION_LIMITS.pullRequestUrlCharacters) {
    throw new Error('pull_request_url is invalid');
  }
  const match = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/pull\/(\d+)\/?$/.exec(value);
  if (!match) throw new Error('pull_request_url must be a canonical GitHub pull request URL');
  return `https://github.com/${match[1]}/${match[2]}/pull/${Number(match[3])}`;
}

function closedInput(value, required, optional) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('contribution input must be an object');
  }
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter(
    (key) => value[key] === undefined || value[key] === null || value[key] === ''
  );
  if (unknown.length > 0) throw new Error(`unknown contribution field: ${unknown.join(', ')}`);
  if (missing.length > 0) throw new Error(`missing contribution field: ${missing.join(', ')}`);
}

function safeCampaignDirectory(value) {
  const path = safeContainedPath(value, 'campaign_directory');
  if (!path.startsWith('.codevetter/optimization-campaigns/')) {
    throw new Error('campaign_directory must be under .codevetter/optimization-campaigns/');
  }
  return path;
}

function safeContainedPath(value, label) {
  if (
    typeof value !== 'string' ||
    isAbsolute(value) ||
    value.includes('\\') ||
    value.split('/').some((part) => ['', '.', '..'].includes(part))
  ) {
    throw new Error(`${label} must be a contained repository-relative POSIX path`);
  }
  return value;
}

async function readJsonArtifact(root, path, maximumBytes, containmentRoot = root) {
  const absolute = resolve(root, path);
  assertContained(root, absolute, path);
  const canonical = await realpath(absolute);
  assertContained(containmentRoot, canonical, path);
  const details = await stat(canonical);
  if (!details.isFile() || details.size > maximumBytes)
    throw new Error(`${path} is unavailable or oversized`);
  try {
    return JSON.parse(await readFile(canonical, 'utf8'));
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

async function writeContainedArtifact(root, path, source, containmentRoot = root) {
  const absolute = resolve(root, path);
  assertContained(root, absolute, path);
  if (Buffer.byteLength(source) > CONTRIBUTION_LIMITS.receiptBytes) {
    throw new Error('contribution artifact exceeds size limit');
  }
  await mkdir(dirname(absolute), { recursive: true });
  const canonicalParent = await realpath(dirname(absolute));
  assertContained(containmentRoot, canonicalParent, path);
  const target = resolve(canonicalParent, basename(absolute));
  try {
    const existing = await readFile(target, 'utf8');
    if (existing === source) return;
    throw new Error('contribution artifact already exists with different content');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${target}.codevetter-${process.pid}.tmp`;
  try {
    await writeFile(temporary, source, { flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function replaceContainedArtifact(root, path, source, expected, containmentRoot = root) {
  const absolute = resolve(root, path);
  assertContained(root, absolute, path);
  if (Buffer.byteLength(source) > CONTRIBUTION_LIMITS.receiptBytes) {
    throw new Error('contribution artifact exceeds size limit');
  }
  await mkdir(dirname(absolute), { recursive: true });
  const canonicalParent = await realpath(dirname(absolute));
  assertContained(containmentRoot, canonicalParent, path);
  const target = resolve(canonicalParent, basename(absolute));
  let current = '';
  try {
    current = await readFile(target, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (current !== expected) throw new Error('contribution publication changed during refresh');
  const temporary = `${target}.codevetter-${process.pid}.tmp`;
  try {
    await writeFile(temporary, source, { flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readReceiptLedger(root, path, containmentRoot = root) {
  const absolute = resolve(root, path);
  assertContained(root, absolute, path);
  let source = '';
  try {
    const canonical = await realpath(absolute);
    assertContained(containmentRoot, canonical, path);
    const details = await stat(canonical);
    if (!details.isFile() || details.size > CONTRIBUTION_LIMITS.receiptBytes) {
      throw new Error('contribution receipt ledger is unavailable or oversized');
    }
    source = await readFile(canonical, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const receipts = source
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  let previous = null;
  for (const receipt of receipts) {
    assertContributionReceipt(receipt);
    if (receipt.previous_receipt_digest !== previous)
      throw new Error('contribution receipt chain is broken');
    previous = receipt.receipt_digest;
  }
  return receipts;
}

async function appendReceipt(root, path, previous, receipt, containmentRoot = root) {
  const absolute = resolve(root, path);
  assertContained(root, absolute, path);
  await mkdir(dirname(absolute), { recursive: true });
  const canonicalParent = await realpath(dirname(absolute));
  assertContained(containmentRoot, canonicalParent, path);
  const target = resolve(canonicalParent, basename(absolute));
  const existing = previous.map((entry) => `${stableStringify(entry)}\n`).join('');
  const next = `${existing}${stableStringify(receipt)}\n`;
  if (Buffer.byteLength(next) > CONTRIBUTION_LIMITS.receiptBytes) {
    throw new Error('contribution receipt ledger size limit exceeded');
  }
  let current = '';
  try {
    current = await readFile(target, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (current !== existing) throw new Error('contribution receipt ledger changed during refresh');
  const temporary = `${target}.codevetter-${process.pid}.tmp`;
  try {
    await writeFile(temporary, next, { flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function assertContained(root, path, label) {
  const rel = relative(root, path);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} escapes the repository`);
  }
}

function bounded(value, maximum) {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function runCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      if (stdout.length <= CONTRIBUTION_LIMITS.receiptBytes) stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length <= 4_000) stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${command} inspection failed: ${stderr.trim()}`));
      else if (Buffer.byteLength(stdout) > CONTRIBUTION_LIMITS.receiptBytes) {
        reject(new Error(`${command} inspection output exceeded the evidence bound`));
      } else resolvePromise(stdout);
    });
  });
}
