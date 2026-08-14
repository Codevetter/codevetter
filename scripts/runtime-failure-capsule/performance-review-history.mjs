import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { repositoryRelative, validatePerformanceCapsule } from './contracts.mjs';
import { ensureCodeVetterEvidenceRoot } from './evidence-root.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import {
  assertPerformanceFlowScope,
  performanceFlowIdentity,
} from './performance-flow-contract.mjs';
import { assertPerformanceLabCorrectnessScope } from './performance-lab-contracts.mjs';
import { verifyOptimizationCapsules } from './optimization-verification.mjs';

export const PERFORMANCE_REVIEW_HISTORY_SCHEMA_VERSION = 'runtime-review-performance-history/v1';

const HISTORY_DIRECTORY = 'performance-review-history';
const MAXIMUM_RECORDS = 64;
const MAXIMUM_RECORD_BYTES = 8 * 1024 * 1024;
const MAXIMUM_TARGET_BYTES = 8 * 1024 * 1024;

export async function retainPerformanceReviewHistory(
  { repositoryRoot, source, performanceScope, correctnessScope, manifestSha256, capsule },
  {
    now = () => new Date().toISOString(),
    compareCapsules = verifyOptimizationCapsules,
    ensureEvidenceRoot = ensureCodeVetterEvidenceRoot,
    inspectSnapshot = inspectGitDiff,
  } = {}
) {
  const root = await realpath(resolve(repositoryRoot));
  const performance = assertPerformanceFlowScope(performanceScope);
  const correctness = assertPerformanceLabCorrectnessScope(correctnessScope);
  assertSource(source);
  assertDigest(manifestSha256, 'manifest');
  assertCapsule(capsule);

  const beforeTargets = await inspectSnapshot(root);
  if (!sameSubject(beforeTargets, capsule.subject)) {
    throw new Error('review performance history snapshot changed before target binding');
  }

  const [performanceTargetSha256, correctnessTargetSha256] = await Promise.all([
    targetDigest(root, performance.target),
    targetDigest(root, correctness.target),
  ]);
  const afterTargets = await inspectSnapshot(root);
  if (!sameSubject(afterTargets, capsule.subject)) {
    throw new Error('review performance history snapshot changed during target binding');
  }
  const binding = createBinding({
    source,
    performance,
    correctness,
    manifestSha256,
    performanceTargetSha256,
    correctnessTargetSha256,
  });
  const current = createRecord({ binding, capsule, capturedAt: now() });
  const evidenceRoot = await ensureEvidenceRoot(root);
  const resolvedEvidenceRoot = await realpath(evidenceRoot.directory);
  if (repositoryRelative(root, resolvedEvidenceRoot) !== '.codevetter') {
    throw new Error('review performance evidence root escapes repository');
  }
  const directory = join(resolvedEvidenceRoot, HISTORY_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const resolvedDirectory = await realpath(directory);
  if (repositoryRelative(resolvedEvidenceRoot, resolvedDirectory) !== HISTORY_DIRECTORY) {
    throw new Error('review performance history escapes evidence root');
  }

  const entries = await readdir(resolvedDirectory, { withFileTypes: true });
  if (entries.length > MAXIMUM_RECORDS) {
    throw new Error('review performance history inventory exceeds bound');
  }
  const records = [];
  let invalidRecords = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !safeRecordName(entry.name)) {
      invalidRecords += 1;
      continue;
    }
    try {
      records.push(await readRecord(resolvedDirectory, entry.name));
    } catch {
      invalidRecords += 1;
    }
  }

  const currentName = recordName(current);
  const existing = records.find((record) => recordName(record) === currentName) ?? null;
  const predecessors = records
    .filter(
      (record) =>
        record.binding.key === binding.key &&
        record.subject.source_snapshot_sha256 !== current.subject.source_snapshot_sha256
    )
    .toSorted(
      (left, right) =>
        Date.parse(right.captured_at) - Date.parse(left.captured_at) ||
        right.subject.source_snapshot_sha256.localeCompare(left.subject.source_snapshot_sha256)
    );
  const predecessor = predecessors[0] ?? null;
  const screening = predecessor
    ? compactSequentialScreening(
        compareCapsules(predecessor.capsule, capsule, { memory_regression_gate: false })
      )
    : null;

  let persistenceStatus;
  if (existing) {
    if (existing.capsule_sha256 !== current.capsule_sha256) {
      throw new Error('review performance history conflicts with an immutable snapshot record');
    }
    persistenceStatus = 'already_recorded';
  } else if (entries.length >= MAXIMUM_RECORDS) {
    persistenceStatus = 'storage_full';
  } else {
    await writeRecord(resolvedDirectory, currentName, current);
    persistenceStatus = 'recorded';
  }

  return {
    schema_version: PERFORMANCE_REVIEW_HISTORY_SCHEMA_VERSION,
    persistence: {
      status: persistenceStatus,
      current: publicRecord(current),
    },
    predecessor: predecessor ? publicRecord(predecessor) : null,
    screening,
    diagnostics: {
      records_considered: records.length,
      invalid_records: invalidRecords,
    },
    unverified: screening
      ? [
          'This is a sequential historical screen, not an interleaved paired comparison.',
          'Metric movement does not establish causation, an improvement, a regression, or a shipping recommendation.',
        ]
      : [
          'No compatible prior snapshot was available; this record can seed a future sequential screen.',
        ],
  };
}

export async function loadPerformanceReviewHistoryRecord(repositoryRoot, reference) {
  const root = await realpath(resolve(repositoryRoot));
  if (
    !plain(reference) ||
    ![reference.binding_key, reference.source_snapshot_sha256, reference.capsule_sha256].every(
      (value) => /^[0-9a-f]{64}$/.test(value ?? '')
    ) ||
    !/^[0-9a-f]{40,64}$/.test(reference.repository_revision ?? '')
  ) {
    throw new Error('review performance history reference is invalid');
  }
  const evidenceRoot = await realpath(join(root, '.codevetter'));
  if (repositoryRelative(root, evidenceRoot) !== '.codevetter') {
    throw new Error('review performance evidence root escapes repository');
  }
  const directory = await realpath(join(evidenceRoot, HISTORY_DIRECTORY));
  if (repositoryRelative(evidenceRoot, directory) !== HISTORY_DIRECTORY) {
    throw new Error('review performance history escapes evidence root');
  }
  const name = `${reference.binding_key}-${reference.source_snapshot_sha256}.json`;
  const record = await readRecord(directory, name);
  if (
    record.subject.repository_revision !== reference.repository_revision ||
    record.capsule_sha256 !== reference.capsule_sha256
  ) {
    throw new Error('review performance history reference differs from its immutable record');
  }
  return record;
}

function createBinding({
  source,
  performance,
  correctness,
  manifestSha256,
  performanceTargetSha256,
  correctnessTargetSha256,
}) {
  const identity = {
    manifest_sha256: manifestSha256,
    source,
    performance_scope: performance,
    correctness_scope: correctness,
    performance_target_sha256: performanceTargetSha256,
    correctness_target_sha256: correctnessTargetSha256,
  };
  return {
    ...identity,
    key: sha256(JSON.stringify(identity)),
  };
}

function createRecord({ binding, capsule, capturedAt }) {
  if (!Number.isFinite(Date.parse(capturedAt))) {
    throw new Error('review performance history timestamp is invalid');
  }
  const capsuleSource = JSON.stringify(capsule);
  const record = {
    schema_version: PERFORMANCE_REVIEW_HISTORY_SCHEMA_VERSION,
    captured_at: capturedAt,
    binding,
    subject: {
      repository_revision: capsule.subject.repository_revision,
      source_snapshot_sha256: capsule.subject.source_snapshot_sha256,
    },
    capsule_sha256: sha256(capsuleSource),
    capsule,
  };
  assertRecord(record);
  return record;
}

function compactSequentialScreening(verification) {
  const materialMovement = ['confirmed', 'rejected'].includes(verification.verdict?.status);
  return {
    evidence_mode: 'sequential_historical',
    observed: Array.isArray(verification.observed) ? verification.observed.slice(0, 8) : [],
    verdict: verification.verdict,
    decisions: {
      material_movement_screened: materialMovement,
      paired_verification_required: materialMovement,
      shipping_recommended: false,
      basis: materialMovement
        ? 'Sequential evidence crossed a screening threshold but cannot authorize a performance claim.'
        : 'Sequential evidence did not cross a screening threshold.',
    },
    next_action: materialMovement
      ? 'run_interleaved_paired_verification'
      : 'retain_history_until_material_movement',
  };
}

async function targetDigest(root, target) {
  const lexical = resolve(root, target);
  const metadata = await lstat(lexical);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAXIMUM_TARGET_BYTES) {
    throw new Error('review performance target is unsafe or oversized');
  }
  const path = await realpath(lexical);
  if (repositoryRelative(root, path) !== target) {
    throw new Error('review performance target escapes repository');
  }
  return sha256(await readFile(path));
}

async function readRecord(directory, name) {
  const lexical = join(directory, name);
  const metadata = await lstat(lexical);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAXIMUM_RECORD_BYTES) {
    throw new Error('review performance history record is unsafe or oversized');
  }
  const path = await realpath(lexical);
  if (repositoryRelative(directory, path) !== name) {
    throw new Error('review performance history record escapes its directory');
  }
  const record = JSON.parse(await readFile(path, 'utf8'));
  assertRecord(record);
  if (recordName(record) !== name) throw new Error('review performance history filename differs');
  return record;
}

async function writeRecord(directory, name, record) {
  const source = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(source) > MAXIMUM_RECORD_BYTES) {
    throw new Error('review performance history record exceeds bound');
  }
  await writeFile(join(directory, name), source, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

function assertRecord(record) {
  if (!plain(record) || record.schema_version !== PERFORMANCE_REVIEW_HISTORY_SCHEMA_VERSION) {
    throw new Error('review performance history record schema is invalid');
  }
  assertClosed(
    record,
    ['schema_version', 'captured_at', 'binding', 'subject', 'capsule_sha256', 'capsule'],
    'record'
  );
  if (!Number.isFinite(Date.parse(record.captured_at))) {
    throw new Error('review performance history record timestamp is invalid');
  }
  const binding = record.binding;
  if (plain(binding)) {
    assertClosed(
      binding,
      [
        'manifest_sha256',
        'source',
        'performance_scope',
        'correctness_scope',
        'performance_target_sha256',
        'correctness_target_sha256',
        'key',
      ],
      'binding'
    );
  }
  if (
    !plain(binding) ||
    !safeSource(binding.source) ||
    performanceFlowIdentity(assertPerformanceFlowScope(binding.performance_scope)) !==
      performanceFlowIdentity(binding.performance_scope) ||
    !assertPerformanceLabCorrectnessScope(binding.correctness_scope) ||
    ![
      binding.key,
      binding.manifest_sha256,
      binding.performance_target_sha256,
      binding.correctness_target_sha256,
    ].every((value) => /^[0-9a-f]{64}$/.test(value ?? ''))
  ) {
    throw new Error('review performance history binding is invalid');
  }
  const expectedBinding = createHash('sha256')
    .update(
      JSON.stringify({
        manifest_sha256: binding.manifest_sha256,
        source: binding.source,
        performance_scope: binding.performance_scope,
        correctness_scope: binding.correctness_scope,
        performance_target_sha256: binding.performance_target_sha256,
        correctness_target_sha256: binding.correctness_target_sha256,
      })
    )
    .digest('hex');
  if (expectedBinding !== binding.key) {
    throw new Error('review performance history binding digest differs');
  }
  assertCapsule(record.capsule);
  if (
    record.capsule.adapter?.kind !== binding.performance_scope.adapter ||
    record.capsule.scope?.target !== binding.performance_scope.target ||
    (record.capsule.scope?.name ?? null) !== (binding.performance_scope.name ?? null) ||
    record.subject?.repository_revision !== record.capsule.subject.repository_revision ||
    record.subject?.source_snapshot_sha256 !== record.capsule.subject.source_snapshot_sha256 ||
    record.capsule_sha256 !== sha256(JSON.stringify(record.capsule))
  ) {
    throw new Error('review performance history capsule identity differs');
  }
}

function publicRecord(record) {
  return {
    captured_at: record.captured_at,
    binding_key: record.binding.key,
    repository_revision: record.subject.repository_revision,
    source_snapshot_sha256: record.subject.source_snapshot_sha256,
    capsule_sha256: record.capsule_sha256,
  };
}

function recordName(record) {
  return `${record.binding.key}-${record.subject.source_snapshot_sha256}.json`;
}

function safeRecordName(value) {
  return /^[0-9a-f]{64}-[0-9a-f]{64}\.json$/.test(value);
}

function assertCapsule(capsule) {
  const errors = validatePerformanceCapsule(capsule);
  if (errors.length > 0) {
    throw new Error(`invalid review performance capsule: ${errors.join(', ')}`);
  }
}

function assertSource(value) {
  if (!safeSource(value)) throw new Error('review performance history source is invalid');
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

function assertDigest(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value ?? '')) {
    throw new Error(`review performance ${label} digest is invalid`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameSubject(left, right) {
  return (
    left?.repository_revision === right?.repository_revision &&
    left?.source_snapshot_sha256 === right?.source_snapshot_sha256
  );
}

function assertClosed(value, allowed, label) {
  const unknown = Object.keys(value).filter((field) => !allowed.includes(field));
  if (unknown.length > 0) {
    throw new Error(`review performance history ${label} has unknown fields`);
  }
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
