import { createHash } from 'node:crypto';
import { link, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { normalizeCorrectnessExecution } from './campaign.mjs';
import { repositoryRelative, validateOptimizationVerification } from './contracts.mjs';
import { ensureCodeVetterEvidenceRoot } from './evidence-root.mjs';
import { cleanSourceSnapshotSha256, inspectGitDiff } from './git-diff.mjs';
import {
  contractOwnsReviewBinding,
  loadPerformanceFlowContract,
} from './performance-flow-contract.mjs';
import { assertPerformanceLabCorrectnessScope } from './performance-lab-contracts.mjs';
import { loadPerformanceReviewHistoryRecord } from './performance-review-history.mjs';
import { materializeCleanGitIncumbent } from './performance-review-incumbent.mjs';
import { verifyPairedRepositories } from './paired-verification.mjs';
import { runClosedAdapter } from './runner.mjs';

export const PERFORMANCE_REVIEW_PAIRED_SCHEMA_VERSION = 'runtime-review-paired-verification/v1';

const ARTIFACT_SCHEMA_VERSION = 'runtime-review-paired-artifact/v1';
const ARTIFACT_DIRECTORY = 'performance-review-pairs';
const MAXIMUM_ARTIFACT_BYTES = 8 * 1024 * 1024;
const PAIRED_SAMPLES = 10;
const PAIRED_WARMUPS = 1;
const CHILD_TIMEOUT_MS = 5_000;
let artifactTemporarySequence = 0;

export async function attemptAutomaticPerformanceReviewPair(
  {
    repositoryRoot,
    source,
    ownedSources,
    performanceScope,
    correctnessScope,
    manifestSha256,
    expectedSubject,
    history,
  },
  {
    inspectSnapshot = inspectGitDiff,
    loadFlowContract = loadPerformanceFlowContract,
    loadHistoryRecord = loadPerformanceReviewHistoryRecord,
    materializeIncumbent = materializeCleanGitIncumbent,
    runAdapter = runClosedAdapter,
    verifyPaired = verifyPairedRepositories,
    openArtifactStore = createPairArtifactStore,
    now = () => new Date().toISOString(),
  } = {}
) {
  if (history?.screening?.next_action !== 'run_interleaved_paired_verification') {
    return notRun('sequential_screen_not_material');
  }
  if (!history.predecessor) return noConfidence('compatible_predecessor_unavailable');
  const exactCorrectness = assertPerformanceLabCorrectnessScope(correctnessScope);
  const sources = assertOwnedSources(ownedSources, source);
  const root = await realpath(resolve(repositoryRoot));
  const [initial, contract, predecessor] = await Promise.all([
    inspectSnapshot(root),
    loadFlowContract(root),
    loadHistoryRecord(root, history.predecessor),
  ]);
  if (!sameSubject(initial, expectedSubject)) {
    return noConfidence('expected_snapshot_changed');
  }
  if (
    !contract.present ||
    contract.manifest_sha256 !== manifestSha256 ||
    !contractOwnsReviewBinding(contract, {
      source,
      performanceScope,
      correctnessScope: exactCorrectness,
    })
  ) {
    return noConfidence('performance_binding_changed');
  }
  if (!sameRevisionRoutingRecord(predecessor, expectedSubject.repository_revision)) {
    return noConfidence('predecessor_revision_incompatible');
  }
  const changeClassification = classifyPairingChanges(
    initial.changed_files,
    sources,
    performanceScope,
    exactCorrectness
  );
  if (!changeClassification.eligible) {
    return noConfidence('review_change_not_sealed_to_owned_sources', null, {
      observed: { change_classification: publicChangeClassification(changeClassification) },
      inferred: { next_action: pairingEligibilityNextAction(changeClassification) },
    });
  }
  const baselineSubject = {
    repository_revision: expectedSubject.repository_revision,
    source_snapshot_sha256: cleanSourceSnapshotSha256(expectedSubject.repository_revision),
    dirty: false,
  };

  const pairKey = pairIdentity({
    bindingKey: history.predecessor.binding_key,
    baselineSnapshot: cleanSourceSnapshotSha256(expectedSubject.repository_revision),
    currentSnapshot: expectedSubject.source_snapshot_sha256,
  });
  const store = await openArtifactStore(root);
  const existing = await store.read(pairKey);
  if (existing) {
    assertStoredArtifact(existing, {
      pairKey,
      bindingKey: history.predecessor.binding_key,
      baselineSubject,
      currentSubject: expectedSubject,
    });
    return attachArtifact(compactResult(existing.result, true), existing.reference);
  }

  let incumbent;
  try {
    incumbent = await materializeIncumbent(root, predecessor.subject.repository_revision);
    await assertExactFileIdentity(incumbent.root, root, 'codevetter.performance.json');
    await assertExactFileIdentity(incumbent.root, root, performanceScope.target);
    await assertExactFileIdentity(incumbent.root, root, exactCorrectness.target);
    for (const changedSource of initial.changed_files) {
      await assertBaselineSourceExists(incumbent.root, changedSource);
    }
    if (isNodeAdapter(performanceScope.adapter) || isNodeAdapter(exactCorrectness.adapter)) {
      await incumbent.graftNodeDependencies?.(root, [
        performanceScope.target,
        exactCorrectness.target,
      ]);
    }

    const correctness = {
      baseline: normalizeCorrectnessExecution(
        { ...exactCorrectness, timeout_ms: 30_000 },
        await runAdapter({
          repositoryRoot: incumbent.root,
          dependencyRepositoryRoot: root,
          adapter: exactCorrectness.adapter,
          target: exactCorrectness.target,
          name: exactCorrectness.name,
          timeoutMs: 30_000,
        }),
        'automatic_review_baseline'
      ),
      current: normalizeCorrectnessExecution(
        { ...exactCorrectness, timeout_ms: 30_000 },
        await runAdapter({
          repositoryRoot: root,
          dependencyRepositoryRoot: root,
          adapter: exactCorrectness.adapter,
          target: exactCorrectness.target,
          name: exactCorrectness.name,
          timeoutMs: 30_000,
        }),
        'automatic_review_current'
      ),
    };
    await assertStableRoots({ incumbent, root, expectedSubject, inspectSnapshot });

    let pairedReport = null;
    let status;
    let reason;
    if (correctness.current.status === 'failed') {
      status = 'rejected';
      reason = 'current_exact_correctness_failed';
    } else if (
      correctness.baseline.status !== 'passed' ||
      correctness.current.status !== 'passed'
    ) {
      status = 'no_confidence';
      reason = 'paired_correctness_unproven';
    } else {
      pairedReport = await verifyPaired({
        baselineRepositoryRoot: incumbent.root,
        currentRepositoryRoot: root,
        baselineDependencyRoot: root,
        currentDependencyRoot: root,
        baselineSubject,
        adapter: performanceScope.adapter,
        target: performanceScope.target,
        name: performanceScope.name,
        timeoutMs: CHILD_TIMEOUT_MS,
        samples: PAIRED_SAMPLES,
        warmups: PAIRED_WARMUPS,
      });
      await assertStableRoots({ incumbent, root, expectedSubject, inspectSnapshot });
      assertPairedReport(pairedReport, baselineSubject, expectedSubject, performanceScope);
      status =
        pairedReport.verdict.status === 'confirmed' &&
        pairedReport.decisions.shipping_recommended === true
          ? 'accepted'
          : pairedReport.verdict.status === 'rejected'
            ? 'rejected'
            : 'no_confidence';
      reason =
        status === 'accepted'
          ? 'paired_local_optimization_accepted'
          : status === 'rejected'
            ? 'paired_local_optimization_rejected'
            : 'paired_local_optimization_unproven';
    }

    const result = {
      schema_version: PERFORMANCE_REVIEW_PAIRED_SCHEMA_VERSION,
      status,
      reason,
      observed: {
        baseline_subject: publicSubject(baselineSubject),
        current_subject: publicSubject(expectedSubject),
        performance_scope: performanceScope,
        correctness: {
          baseline: compactCorrectness(correctness.baseline),
          current: compactCorrectness(correctness.current),
        },
        paired_report: pairedReport,
      },
      inferred: pairedReport
        ? { verdict: pairedReport.verdict, decisions: pairedReport.decisions }
        : null,
      limitations: [
        'The synthesized incumbent is the clean local Git revision; only manifest-owned source files may differ.',
        'The paired result describes one exact local flow and correctness test.',
      ],
      unverified: [
        'Production impact, production traffic, and flows outside the exact scopes remain unverified.',
        'The paired result does not establish that every changed line is independently causal.',
      ],
    };
    const artifact = await store.write(pairKey, {
      schema_version: ARTIFACT_SCHEMA_VERSION,
      created_at: now(),
      pair_key: pairKey,
      binding_key: history.predecessor.binding_key,
      baseline_subject: publicSubject(baselineSubject),
      current_subject: publicSubject(expectedSubject),
      result,
    });
    return attachArtifact(compactResult(result, false), artifact);
  } catch (error) {
    return noConfidence('automatic_pair_failed', safeReason(error));
  } finally {
    if (incumbent) {
      try {
        await incumbent.dispose();
      } catch {
        // The result already retains the cleanup boundary; never remove anything outside owned temp.
      }
    }
  }
}

export async function createPairArtifactStore(repositoryRoot) {
  const root = await realpath(resolve(repositoryRoot));
  const evidence = await ensureCodeVetterEvidenceRoot(root);
  const evidenceRoot = await realpath(evidence.directory);
  if (repositoryRelative(root, evidenceRoot) !== '.codevetter') {
    throw new Error('paired review evidence root escapes repository');
  }
  const directory = join(evidenceRoot, ARTIFACT_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const resolvedDirectory = await realpath(directory);
  if (repositoryRelative(evidenceRoot, resolvedDirectory) !== ARTIFACT_DIRECTORY) {
    throw new Error('paired review artifact directory escapes evidence root');
  }
  return {
    async read(pairKey) {
      assertDigest(pairKey, 'pair key');
      const path = join(resolvedDirectory, `${pairKey}.json`);
      let details;
      try {
        details = await stat(path);
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
      if (!details.isFile() || details.size > MAXIMUM_ARTIFACT_BYTES) {
        throw new Error('paired review artifact is unavailable or oversized');
      }
      const resolved = await realpath(path);
      if (repositoryRelative(resolvedDirectory, resolved) !== `${pairKey}.json`) {
        throw new Error('paired review artifact escapes evidence directory');
      }
      const source = await readFile(resolved);
      const artifact = JSON.parse(source.toString('utf8'));
      const { payload_sha256: payloadSha256, ...payload } = artifact;
      if (payloadSha256 !== sha256(JSON.stringify(payload))) {
        throw new Error('paired review artifact payload digest differs');
      }
      return {
        ...artifact,
        reference: {
          path: repositoryRelative(root, resolved),
          sha256: sha256(source),
          bytes: source.byteLength,
        },
      };
    },
    async write(pairKey, artifact) {
      assertDigest(pairKey, 'pair key');
      const sealed = {
        ...artifact,
        payload_sha256: sha256(JSON.stringify(artifact)),
      };
      const source = Buffer.from(`${JSON.stringify(sealed)}\n`);
      if (source.byteLength > MAXIMUM_ARTIFACT_BYTES) {
        throw new Error('paired review artifact exceeds bound');
      }
      const path = join(resolvedDirectory, `${pairKey}.json`);
      artifactTemporarySequence += 1;
      const temporary = join(
        resolvedDirectory,
        `.${pairKey}-${process.pid}-${artifactTemporarySequence}.tmp`
      );
      try {
        await writeFile(temporary, source, { flag: 'wx', mode: 0o600 });
        await link(temporary, path);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const existing = await this.read(pairKey);
        if (!existing || existing.reference.sha256 !== sha256(source)) {
          throw new Error('paired review artifact conflicts with an immutable pair');
        }
        return existing.reference;
      } finally {
        await rm(temporary, { force: true });
      }
      return {
        path: repositoryRelative(root, path),
        sha256: sha256(source),
        bytes: source.byteLength,
      };
    },
  };
}

function compactResult(result, reused) {
  const paired = result.observed.paired_report;
  return {
    schema_version: result.schema_version,
    status: result.status,
    reason: result.reason,
    observed: {
      baseline_subject: result.observed.baseline_subject,
      current_subject: result.observed.current_subject,
      performance_scope: result.observed.performance_scope,
      correctness: result.observed.correctness,
      paired: paired
        ? {
            evidence_mode: paired.evidence_mode,
            observed: paired.observed.slice(0, 8),
            verdict: paired.verdict,
            decisions: paired.decisions,
            samples: PAIRED_SAMPLES,
            warmups: PAIRED_WARMUPS,
          }
        : null,
      reused,
    },
    inferred: result.inferred,
    limitations: result.limitations,
    unverified: result.unverified,
  };
}

function attachArtifact(result, artifact) {
  return {
    ...result,
    observed: { ...result.observed, artifact },
  };
}

function assertStoredArtifact(artifact, expected) {
  if (
    artifact.schema_version !== ARTIFACT_SCHEMA_VERSION ||
    artifact.pair_key !== expected.pairKey ||
    artifact.binding_key !== expected.bindingKey ||
    !sameSubject(artifact.baseline_subject, expected.baselineSubject) ||
    !sameSubject(artifact.current_subject, expected.currentSubject)
  ) {
    throw new Error('paired review artifact identity differs');
  }
  assertPairResult(artifact.result);
}

function assertPairResult(result) {
  if (
    result?.schema_version !== PERFORMANCE_REVIEW_PAIRED_SCHEMA_VERSION ||
    !['accepted', 'rejected', 'no_confidence'].includes(result.status)
  ) {
    throw new Error('paired review result is invalid');
  }
  const report = result.observed?.paired_report;
  if (report) {
    if (validateOptimizationVerification(report).length > 0) {
      throw new Error('paired review optimization evidence is invalid');
    }
    if (report.evidence_mode !== 'paired_interleaved') {
      throw new Error('paired review evidence is not interleaved');
    }
    if (
      result.status === 'accepted' &&
      (report.verdict.status !== 'confirmed' || report.decisions.shipping_recommended !== true)
    ) {
      throw new Error('paired review acceptance lacks shipping authority');
    }
  } else if (result.status === 'accepted') {
    throw new Error('paired review acceptance lacks a paired report');
  }
}

function assertPairedReport(report, baselineSubject, currentSubject, scope) {
  if (validateOptimizationVerification(report).length > 0) {
    throw new Error('automatic paired verification report is invalid');
  }
  if (
    report.evidence_mode !== 'paired_interleaved' ||
    report.subject.baseline_revision !== baselineSubject.repository_revision ||
    report.subject.current_revision !== currentSubject.repository_revision ||
    report.scope.target !== scope.target ||
    (report.scope.name ?? null) !== (scope.name ?? null) ||
    report.baseline_capsule.sample_policy.samples !== PAIRED_SAMPLES ||
    report.current_capsule.sample_policy.samples !== PAIRED_SAMPLES
  ) {
    throw new Error('automatic paired verification identity differs');
  }
}

async function assertStableRoots({ incumbent, root, expectedSubject, inspectSnapshot }) {
  await incumbent.assertUnchanged();
  const current = await inspectSnapshot(root);
  if (!sameSubject(current, expectedSubject)) {
    throw new Error('current repository changed during automatic paired review');
  }
}

async function assertExactFileIdentity(baselineRoot, currentRoot, target) {
  const [baseline, current] = await Promise.all([
    containedFileDigest(baselineRoot, target),
    containedFileDigest(currentRoot, target),
  ]);
  if (baseline !== current) {
    throw new Error(`automatic paired evaluator changed: ${target}`);
  }
}

async function assertBaselineSourceExists(baselineRoot, target) {
  await containedFileDigest(baselineRoot, target);
}

async function containedFileDigest(root, target) {
  const canonicalRoot = await realpath(resolve(root));
  const lexical = resolve(canonicalRoot, target);
  const metadata = await lstat(lexical);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 8 * 1024 * 1024) {
    throw new Error('automatic paired file is unsafe or oversized');
  }
  const path = await realpath(lexical);
  if (repositoryRelative(canonicalRoot, path) !== target) {
    throw new Error('automatic paired file escapes repository');
  }
  return sha256(await readFile(path));
}

function sameRevisionRoutingRecord(record, currentRevision) {
  return (
    record.subject.repository_revision === currentRevision &&
    record.capsule.subject.repository_revision === record.subject.repository_revision &&
    record.capsule.subject.source_snapshot_sha256 === record.subject.source_snapshot_sha256
  );
}

export function classifyPairingChanges(changedFiles, sources, performanceScope, correctnessScope) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0 || changedFiles.length > 256) {
    throw new Error('automatic paired changed-file inventory is invalid');
  }
  const allowed = new Set(sources);
  const protectedFiles = new Set([
    'codevetter.performance.json',
    performanceScope.target,
    correctnessScope.target,
  ]);
  const unique = [...new Set(changedFiles)];
  if (unique.length !== changedFiles.length) {
    throw new Error('automatic paired changed-file inventory contains duplicates');
  }
  const classification = {
    owned_source_files: [],
    evaluator_files: [],
    unrelated_files: [],
  };
  for (const file of unique) {
    assertSafeOwnedPath(file, 'changed-file');
    if (protectedFiles.has(file)) classification.evaluator_files.push(file);
    else if (allowed.has(file)) classification.owned_source_files.push(file);
    else classification.unrelated_files.push(file);
  }
  for (const files of Object.values(classification)) files.sort();
  return {
    ...classification,
    eligible:
      classification.owned_source_files.length > 0 &&
      classification.evaluator_files.length === 0 &&
      classification.unrelated_files.length === 0,
  };
}

function isNodeAdapter(adapter) {
  return ['node-test', 'node-script', 'vitest', 'jest', 'playwright'].includes(adapter);
}

function assertOwnedSources(value, selectedSource) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    throw new Error('automatic paired owned sources are invalid');
  }
  const sources = [...new Set(value)];
  if (sources.length !== value.length || !sources.includes(selectedSource)) {
    throw new Error('automatic paired selected source lacks unique ownership');
  }
  for (const source of sources) {
    assertSafeOwnedPath(source, 'owned source');
  }
  return sources;
}

function assertSafeOwnedPath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    /[\0\r\n]/.test(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`automatic paired ${label} path is unsafe`);
  }
}

function publicChangeClassification(value) {
  return {
    owned_source_files: value.owned_source_files,
    evaluator_files: value.evaluator_files,
    unrelated_files: value.unrelated_files,
  };
}

function pairingEligibilityNextAction(value) {
  if (value.evaluator_files.length > 0) {
    return {
      kind: 'establish_evaluator_baseline',
      summary:
        'Establish the manifest and exact evaluator targets as tracked baseline authority, then rerun review with only binding-owned source changes.',
      automated: false,
      repository_mutation_performed: false,
    };
  }
  return {
    kind: 'isolate_owned_source_change',
    summary:
      'Isolate the binding-owned source change from unrelated changed files before requesting automatic paired verification.',
    automated: false,
    repository_mutation_performed: false,
  };
}

function compactCorrectness(value) {
  return {
    status: value.status,
    exit_code: value.exit_code,
    duration_ms: value.duration_ms,
    selection: value.selection,
    limitation: value.limitation,
  };
}

function pairIdentity({ bindingKey, baselineSnapshot, currentSnapshot }) {
  return sha256(
    JSON.stringify({
      evaluator: ARTIFACT_SCHEMA_VERSION,
      binding_key: bindingKey,
      baseline_snapshot: baselineSnapshot,
      current_snapshot: currentSnapshot,
      node_version: process.version,
    })
  );
}

function notRun(reason) {
  return {
    schema_version: PERFORMANCE_REVIEW_PAIRED_SCHEMA_VERSION,
    status: 'not_run',
    reason,
    observed: null,
    inferred: null,
    limitations: [],
    unverified: ['No automatic interleaved paired verification was executed.'],
  };
}

function noConfidence(reason, detail = null, projection = null) {
  return {
    schema_version: PERFORMANCE_REVIEW_PAIRED_SCHEMA_VERSION,
    status: 'no_confidence',
    reason,
    observed: projection?.observed ?? (detail ? { detail } : null),
    inferred: projection?.inferred ?? null,
    limitations: [
      'Automatic paired review could not establish two compatible independently runnable roots.',
    ],
    unverified: ['No local optimization acceptance or production claim is available.'],
  };
}

function publicSubject(value) {
  return {
    repository_revision: value.repository_revision,
    source_snapshot_sha256: value.source_snapshot_sha256,
  };
}

function sameSubject(left, right) {
  return (
    left?.repository_revision === right?.repository_revision &&
    left?.source_snapshot_sha256 === right?.source_snapshot_sha256
  );
}

function assertDigest(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value ?? '')) {
    throw new Error(`paired review ${label} is invalid`);
  }
}

function safeReason(error) {
  const value = error instanceof Error ? error.message : 'automatic_pair_failed';
  return /^[a-zA-Z0-9 ./,_:()@+-]{1,240}$/.test(value) ? value : 'automatic_pair_failed';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
