import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { repositoryRelative, validateOptimizationVerification } from './contracts.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import { loadPerformanceFlowContract } from './performance-flow-contract.mjs';
import { resolveSourceOwnedPerformanceBindings } from './performance-flow-contract.mjs';
import {
  PERFORMANCE_LAB_LIMITS,
  assertPerformanceLabId,
  assertPerformanceLabReceipt,
} from './performance-lab-contracts.mjs';

export const PERFORMANCE_REVIEW_EVIDENCE_SCHEMA_VERSION = 'runtime-performance-review-evidence/v1';

const LAB_DIRECTORY = '.codevetter/performance-labs';
const MAXIMUM_LAB_DIRECTORIES = 64;
const MAXIMUM_ACCEPTED_CANDIDATES = 8;
const SUMMARY_FIELDS = [
  'subject',
  'adapter',
  'scope',
  'observed',
  'limitations',
  'decisions',
  'verdict',
  'evidence_mode',
  'workload_identity',
];

export async function collectPerformanceReviewEvidence(
  repositoryRoot,
  {
    reviewChangedFiles,
    inspectSnapshot = inspectGitDiff,
    loadFlowContract = loadPerformanceFlowContract,
  } = {}
) {
  const root = await realpath(resolve(repositoryRoot));
  const currentSubject = await inspectSnapshot(root);
  const changedFiles = boundedReviewChangedFiles(reviewChangedFiles);
  let directory;
  try {
    directory = await realpath(resolve(root, LAB_DIRECTORY));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    directory = null;
  }
  if (directory !== null && repositoryRelative(root, directory) !== LAB_DIRECTORY) {
    return unavailable('laboratory_directory_escapes_repository');
  }

  const entries = directory === null ? [] : await readdir(directory, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (directories.length > MAXIMUM_LAB_DIRECTORIES) {
    return unavailable('laboratory_inventory_exceeds_bound', {
      considered_labs: 0,
      excluded_labs: directories.length,
    });
  }

  const accepted = [];
  let invalid = 0;
  let unaccepted = 0;
  for (const labId of directories) {
    try {
      assertPerformanceLabId(labId);
      const loaded = await readReceipt(directory, labId);
      assertPerformanceLabReceipt(loaded.receipt);
      if (!isAcceptedTerminal(loaded.receipt)) {
        unaccepted += 1;
        continue;
      }
      accepted.push(loaded);
    } catch {
      invalid += 1;
    }
  }
  accepted.sort(
    (left, right) =>
      Date.parse(right.receipt.lifecycle.completed_at) -
        Date.parse(left.receipt.lifecycle.completed_at) ||
      right.receipt.lab_id.localeCompare(left.receipt.lab_id)
  );

  const exclusions = {
    invalid,
    unaccepted,
    stale: 0,
    unrelated: 0,
    authority_mismatch: 0,
    evidence_mismatch: 0,
  };
  let reverificationPlan = null;
  for (const loaded of accepted.slice(0, MAXIMUM_ACCEPTED_CANDIDATES)) {
    const receipt = loaded.receipt;
    let flowContract = null;
    if (receipt.acceptance.correctness.binding?.source === 'repository_manifest') {
      try {
        flowContract = await loadFlowContract(root);
      } catch {
        exclusions.authority_mismatch += 1;
        continue;
      }
      if (
        !flowContract.present ||
        flowContract.manifest_sha256 !== receipt.acceptance.correctness.binding.manifest_sha256
      ) {
        exclusions.authority_mismatch += 1;
        continue;
      }
    }

    try {
      const paired = await readPairedEvidence(root, directory, receipt);
      if (!sameSubject(receipt.subject, currentSubject)) {
        exclusions.stale += 1;
        const candidateFile = receipt.continuation.candidate?.source?.file;
        if (
          reverificationPlan === null &&
          (changedFiles === null || changedFiles.includes(candidateFile)) &&
          receipt.subject.repository_revision === currentSubject.repository_revision &&
          receipt.acceptance.correctness.binding?.source === 'repository_manifest' &&
          flowContract?.manifest_sha256 === receipt.acceptance.correctness.binding.manifest_sha256
        ) {
          reverificationPlan = buildCorrectnessReverificationPlan({
            receipt,
            receiptSha256: loaded.sha256,
            paired,
            currentSubject,
            exclusions,
          });
        }
        continue;
      }
      const candidateFile = receipt.continuation.candidate?.source?.file;
      if (changedFiles !== null && !changedFiles.includes(candidateFile)) {
        exclusions.unrelated += 1;
        continue;
      }
      return qualifyPerformanceReviewEvidence({
        receipt,
        receiptSha256: loaded.sha256,
        paired,
        currentSubject,
        exclusions,
      });
    } catch {
      exclusions.evidence_mismatch += 1;
    }
  }

  if (reverificationPlan) return reverificationPlan;

  if (changedFiles !== null) {
    let contract;
    try {
      contract = await loadFlowContract(root);
    } catch {
      return unavailable('correctness_contract_invalid');
    }
    if (contract.present) {
      const sourceBindings = resolveSourceOwnedPerformanceBindings(contract, changedFiles);
      const correctnessIdentities = new Set(
        sourceBindings.map((binding) => JSON.stringify(binding.correctness))
      );
      if (correctnessIdentities.size > 1) {
        return unavailable('multiple_relevant_correctness_bindings', {
          considered_bindings: sourceBindings.length,
        });
      }
      if (sourceBindings.length > 0) {
        return buildColdStartCorrectnessPlan({
          binding: sourceBindings[0],
          manifestSha256: contract.manifest_sha256,
          currentSubject,
          changedFiles,
        });
      }
    }
  }

  return unavailable('no_current_accepted_evidence', {
    considered_labs: directories.length,
    excluded_labs: Object.values(exclusions).reduce((sum, value) => sum + value, 0),
    exclusions,
  });
}

export function buildColdStartCorrectnessPlan({
  binding,
  manifestSha256,
  currentSubject,
  changedFiles,
}) {
  if (!/^[0-9a-f]{64}$/.test(manifestSha256 ?? '')) {
    throw new Error('cold-start correctness manifest digest is invalid');
  }
  const source = binding.sources.find((file) => changedFiles.includes(file));
  if (!source) throw new Error('cold-start binding does not own a changed source file');
  return {
    schema_version: PERFORMANCE_REVIEW_EVIDENCE_SCHEMA_VERSION,
    status: 'cold_start_correctness_required',
    plan: {
      candidate_source: {
        file: source,
        provenance: 'repository_manifest_source_binding',
      },
      performance_flow: binding.performance,
      correctness_scope: binding.correctness,
      correctness_binding: {
        source: 'repository_manifest',
        manifest_sha256: manifestSha256,
      },
      current_subject: {
        repository_revision: currentSubject.repository_revision,
        source_snapshot_sha256: currentSubject.source_snapshot_sha256,
      },
      selection_authority: 'repository_manifest_source_binding',
      performance_claim_status: 'not_measured',
    },
    unverified: [
      'Current correctness has not been executed yet.',
      'No current performance comparison is available.',
      'Production impact and flows outside the exact correctness scope remain unverified.',
    ],
  };
}

export function buildCorrectnessReverificationPlan({
  receipt,
  receiptSha256,
  paired,
  currentSubject,
  exclusions = {},
}) {
  assertPerformanceLabReceipt(receipt);
  if (!isAcceptedTerminal(receipt)) throw new Error('laboratory receipt is not accepted');
  if (
    receipt.subject.repository_revision !== currentSubject?.repository_revision ||
    receipt.subject.source_snapshot_sha256 === currentSubject?.source_snapshot_sha256
  ) {
    throw new Error('reverification requires a newer source snapshot on the same revision');
  }
  const correctness = receipt.acceptance.correctness;
  if (
    correctness.binding?.source !== 'repository_manifest' ||
    !/^[0-9a-f]{64}$/.test(correctness.binding.manifest_sha256 ?? '')
  ) {
    throw new Error('reverification requires repository-owned correctness authority');
  }
  if (!/^[0-9a-f]{64}$/.test(receiptSha256)) {
    throw new Error('laboratory receipt digest is invalid');
  }
  assertPairedAuthority(receipt, paired);
  const source = acceptedSource(receipt.continuation.candidate?.source);
  const evidence = receipt.acceptance.paired_verification.evidence;
  return {
    schema_version: PERFORMANCE_REVIEW_EVIDENCE_SCHEMA_VERSION,
    status: 'reverification_required',
    plan: {
      candidate_source: source,
      performance_flow: {
        adapter: paired.adapter.kind,
        target: paired.scope.target,
        name: paired.scope.name ?? null,
      },
      correctness_scope: correctness.scope,
      correctness_binding: {
        source: 'repository_manifest',
        manifest_sha256: correctness.binding.manifest_sha256,
      },
      current_subject: {
        repository_revision: currentSubject.repository_revision,
        source_snapshot_sha256: currentSubject.source_snapshot_sha256,
      },
      historical_evidence: {
        lab_id: receipt.lab_id,
        receipt_sha256: receiptSha256,
        paired_artifact: evidence,
        performance_claim_status: 'stale_excluded',
      },
    },
    unverified: [
      'The historical performance result does not describe the current source snapshot.',
      'Current correctness has not been executed yet.',
      'Production impact and flows outside the exact correctness scope remain unverified.',
    ],
    diagnostics: {
      excluded_before_selection: exclusions,
    },
  };
}

export function qualifyPerformanceReviewEvidence({
  receipt,
  receiptSha256,
  paired,
  currentSubject,
  exclusions = {},
}) {
  assertPerformanceLabReceipt(receipt);
  if (!isAcceptedTerminal(receipt)) throw new Error('laboratory receipt is not accepted');
  if (!sameSubject(receipt.subject, currentSubject)) {
    throw new Error('laboratory receipt does not match the current source snapshot');
  }
  if (!/^[0-9a-f]{64}$/.test(receiptSha256)) {
    throw new Error('laboratory receipt digest is invalid');
  }
  if (validateOptimizationVerification(paired).length > 0) {
    throw new Error('paired performance evidence is invalid');
  }
  assertPairedAuthority(receipt, paired);
  const source = acceptedSource(receipt.continuation.candidate?.source);
  const correctness = receipt.acceptance.correctness;
  const evidence = receipt.acceptance.paired_verification.evidence;
  return {
    schema_version: PERFORMANCE_REVIEW_EVIDENCE_SCHEMA_VERSION,
    status: 'qualified',
    observed: {
      lab_id: receipt.lab_id,
      completed_at: receipt.lifecycle.completed_at,
      subject: {
        repository_revision: receipt.subject.repository_revision,
        source_snapshot_sha256: receipt.subject.source_snapshot_sha256,
      },
      candidate_source: source,
      performance_flow: {
        adapter: paired.adapter.kind,
        target: paired.scope.target,
        name: paired.scope.name ?? null,
      },
      correctness_flow: {
        ...correctness.scope,
        incumbent_status: correctness.incumbent.status,
        current_status: correctness.current.status,
        binding_source: correctness.binding?.source ?? 'unknown',
        ...(correctness.binding?.manifest_sha256
          ? { manifest_sha256: correctness.binding.manifest_sha256 }
          : {}),
      },
      metric_summaries: compactMetricSummaries(paired.observed),
      receipt: { sha256: receiptSha256 },
      paired_artifact: evidence,
    },
    inferred: {
      status: 'accepted_local_optimization',
      summary:
        'Exact local correctness passed and independently paired performance gates recommended retaining this candidate.',
    },
    unverified: [
      'Production impact and production-scale behavior were not established.',
      'Flows outside the exact performance and correctness scopes were not established by this receipt.',
      'The reviewer must still inspect the changed implementation and uncovered risks.',
    ],
    diagnostics: {
      considered_labs: 1,
      excluded_before_selection: exclusions,
    },
  };
}

function assertPairedAuthority(receipt, paired) {
  if (validateOptimizationVerification(paired).length > 0) {
    throw new Error('paired performance evidence is invalid');
  }
  const summary = receipt.acceptance.paired_verification.summary;
  for (const field of SUMMARY_FIELDS) {
    if (!isDeepStrictEqual(summary[field], paired[field])) {
      throw new Error(`paired performance summary differs at ${field}`);
    }
  }
  if (
    paired.evidence_mode !== 'paired_interleaved' ||
    paired.verdict.status !== 'confirmed' ||
    paired.decisions.shipping_recommended !== true ||
    paired.subject.current_revision !== receipt.subject.repository_revision
  ) {
    throw new Error('paired performance evidence does not authorize the accepted revision');
  }
}

async function readReceipt(directory, labId) {
  const labDirectory = await realpath(resolve(directory, labId));
  if (repositoryRelative(directory, labDirectory) !== labId) {
    throw new Error('laboratory directory escapes evidence root');
  }
  const receiptPath = await realpath(resolve(labDirectory, 'receipt.json'));
  if (repositoryRelative(labDirectory, receiptPath) !== 'receipt.json') {
    throw new Error('laboratory receipt escapes its run directory');
  }
  const details = await stat(receiptPath);
  if (!details.isFile() || details.size > PERFORMANCE_LAB_LIMITS.receiptBytes) {
    throw new Error('laboratory receipt is unavailable or oversized');
  }
  const bytes = await readFile(receiptPath);
  return {
    receipt: JSON.parse(bytes.toString('utf8')),
    sha256: sha256(bytes),
  };
}

async function readPairedEvidence(root, directory, receipt) {
  const reference = receipt.acceptance.paired_verification.evidence;
  const expected = `${LAB_DIRECTORY}/${receipt.lab_id}/paired-verification.json`;
  if (reference.path !== expected) throw new Error('paired evidence path is not canonical');
  const labDirectory = await realpath(resolve(directory, receipt.lab_id));
  const evidencePath = await realpath(resolve(root, reference.path));
  if (repositoryRelative(labDirectory, evidencePath) !== 'paired-verification.json') {
    throw new Error('paired evidence escapes its laboratory directory');
  }
  const details = await stat(evidencePath);
  if (
    !details.isFile() ||
    details.size !== reference.bytes ||
    details.size > PERFORMANCE_LAB_LIMITS.evidenceBytes
  ) {
    throw new Error('paired evidence byte count differs');
  }
  const bytes = await readFile(evidencePath);
  if (sha256(bytes) !== reference.sha256) throw new Error('paired evidence digest differs');
  return JSON.parse(bytes.toString('utf8'));
}

function isAcceptedTerminal(receipt) {
  return (
    receipt.state === 'completed' &&
    receipt.stop?.kind === 'candidate_accepted' &&
    receipt.acceptance?.verdict?.status === 'accepted' &&
    receipt.acceptance?.correctness?.incumbent?.status === 'passed' &&
    receipt.acceptance?.correctness?.current?.status === 'passed' &&
    receipt.acceptance?.paired_verification?.summary?.decisions?.shipping_recommended === true
  );
}

function sameSubject(left, right) {
  return (
    left?.repository_revision === right?.repository_revision &&
    left?.source_snapshot_sha256 === right?.source_snapshot_sha256
  );
}

function acceptedSource(value) {
  if (
    !value ||
    typeof value.file !== 'string' ||
    value.file.length === 0 ||
    value.file.length > 512 ||
    value.file.startsWith('/') ||
    value.file.includes('\\') ||
    value.file.split('/').includes('..') ||
    /[\0\r\n]/.test(value.file) ||
    !Number.isSafeInteger(value.line) ||
    value.line < 1 ||
    typeof value.function !== 'string' ||
    value.function.length === 0 ||
    value.function.length > 256 ||
    /[\0\r\n]/.test(value.function)
  ) {
    throw new Error('accepted candidate source is invalid');
  }
  return {
    file: value.file,
    line: value.line,
    function: value.function,
    provenance: boundedText(value.provenance, 80),
  };
}

function compactMetricSummaries(observed) {
  const summaries = [];
  for (const observation of observed) {
    if (!observation || typeof observation.kind !== 'string') continue;
    if (Array.isArray(observation.points)) {
      for (const point of observation.points.slice(0, 4)) {
        summaries.push({
          kind: observation.kind,
          input: finite(point.input),
          unit: boundedText(point.unit, 24),
          baseline: finite(point.baseline),
          current: finite(point.current),
          delta_percent: finite(point.delta_percent),
        });
      }
    } else {
      const summary = { kind: boundedText(observation.kind, 80) };
      const metric = compactMetric(observation.metric);
      const applicationMetric = compactMetric(observation.application_metric);
      if (metric) summary.metric = metric;
      if (applicationMetric) summary.application_metric = applicationMetric;
      for (const field of ['baseline', 'current', 'delta', 'delta_percent']) {
        if (Number.isFinite(observation[field])) summary[field] = observation[field];
      }
      if (observation.source) {
        summary.source = {
          file: boundedText(observation.source.file, 512),
          function: boundedText(observation.source.function, 256),
        };
      }
      summaries.push(summary);
    }
    if (summaries.length >= 8) break;
  }
  return summaries.slice(0, 8);
}

function compactMetric(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metric = {};
  for (const field of ['baseline', 'current', 'delta', 'delta_percent']) {
    if (Number.isFinite(value[field])) metric[field] = value[field];
  }
  return Object.keys(metric).length > 0 ? metric : null;
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function boundedText(value, maximum) {
  if (typeof value !== 'string') return null;
  return value.replace(/[\0\r\n]/g, ' ').slice(0, maximum);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function unavailable(reason, details = {}) {
  return {
    schema_version: PERFORMANCE_REVIEW_EVIDENCE_SCHEMA_VERSION,
    status: 'unavailable',
    reason,
    ...details,
  };
}

function boundedReviewChangedFiles(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new Error('review changed files must contain 1 to 64 exact paths');
  }
  const files = value.map((file) => {
    if (
      typeof file !== 'string' ||
      file.length === 0 ||
      file.length > 512 ||
      file.startsWith('/') ||
      file.includes('\\') ||
      file.split('/').some((part) => part === '' || part === '.' || part === '..') ||
      /[\0\r\n]/.test(file)
    ) {
      throw new Error('review changed files must be exact repository-relative paths');
    }
    return file;
  });
  if (new Set(files).size !== files.length) {
    throw new Error('review changed files must be unique');
  }
  return files.toSorted();
}
