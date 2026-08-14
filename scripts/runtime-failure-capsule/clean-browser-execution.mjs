import { lstat, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { repositoryRelative } from './contracts.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import { materializeCleanGitIncumbent } from './performance-review-incumbent.mjs';
import { qualifyRepository } from './qualification.mjs';

const CLEAN_BROWSER_CONTEXT = Symbol('codevetter-clean-browser-context');

export async function createCleanBrowserExecution(
  { repositoryRoot, candidateId },
  {
    qualify = qualifyRepository,
    inspectSource = inspectGitDiff,
    materialize = materializeCleanGitIncumbent,
  } = {}
) {
  const authorityRoot = await realpath(resolve(repositoryRoot));
  const qualification = await qualify(authorityRoot);
  const subject = assertCleanSubject(qualification.subject);
  const initial = await inspectSource(authorityRoot);
  assertSameCleanSubject(subject, initial);
  const candidate = (qualification.flows ?? []).find((flow) => flow.id === candidateId);
  if (!candidate || candidate.adapter !== 'playwright' || typeof candidate.target !== 'string') {
    throw new Error('clean browser execution requires one exact qualified Playwright flow');
  }

  const snapshot = await materialize(authorityRoot, subject.repository_revision, {
    excludeSensitivePaths: true,
  });
  try {
    await snapshot.graftNodeDependencies(authorityRoot, [candidate.target]);
    const executionRoot = await realpath(snapshot.root);
    const provenance = Object.freeze({
      mode: 'clean_git_snapshot',
      tree_sha256: snapshot.fingerprint,
      files: snapshot.files,
      bytes: snapshot.bytes,
      ...snapshot.sensitivePathExclusions,
      ...snapshot.dependencyProvenance(),
    });
    let finalized = false;
    const context = Object.freeze({
      [CLEAN_BROWSER_CONTEXT]: true,
      authorityRoot,
      executionRoot,
      dependencyRoot: authorityRoot,
      evidenceRoot: authorityRoot,
      qualification,
      subject: Object.freeze({ ...subject }),
      provenance,
      async finalize() {
        if (finalized) throw new Error('clean browser execution is already finalized');
        finalized = true;
        let validationError = null;
        let cleanup = null;
        try {
          await removeOwnedRuntimeOutputs(executionRoot);
          await snapshot.assertUnchanged();
          assertSameCleanSubject(subject, await inspectSource(authorityRoot));
        } catch (error) {
          validationError = error;
        }
        try {
          cleanup = await snapshot.dispose();
        } catch (error) {
          if (!validationError) validationError = error;
        }
        if (validationError) throw validationError;
        if (cleanup !== 'removed')
          throw new Error('clean browser snapshot cleanup was not completed');
        return Object.freeze({ state: 'removed', provenance });
      },
    });
    return context;
  } catch (error) {
    await snapshot.dispose().catch(() => {});
    throw error;
  }
}

export async function resolveBrowserExecutionContext(repositoryRoot, context = null) {
  const authorityRoot = await realpath(resolve(repositoryRoot));
  if (context === null) {
    return Object.freeze({
      mode: 'developer_checkout',
      authorityRoot,
      executionRoot: authorityRoot,
      dependencyRoot: authorityRoot,
      evidenceRoot: authorityRoot,
      qualification: null,
      subject: null,
      provenance: null,
    });
  }
  if (!context || context[CLEAN_BROWSER_CONTEXT] !== true) {
    throw new Error('browser execution context is not CodeVetter-owned');
  }
  if (context.authorityRoot !== authorityRoot || context.evidenceRoot !== authorityRoot) {
    throw new Error('clean browser execution authority differs from the requested repository');
  }
  const [executionRoot, dependencyRoot] = await Promise.all([
    realpath(context.executionRoot),
    realpath(context.dependencyRoot),
  ]);
  if (executionRoot !== context.executionRoot || dependencyRoot !== context.dependencyRoot) {
    throw new Error('clean browser execution roots changed after materialization');
  }
  if (dependencyRoot !== authorityRoot) {
    throw new Error('clean browser dependency authority differs from the repository');
  }
  assertCleanSubject(context.subject);
  assertCleanProvenance(context.provenance);
  return context;
}

function assertCleanSubject(value) {
  if (
    !value ||
    value.dirty !== false ||
    !/^[0-9a-f]{40,64}$/.test(value.repository_revision ?? '') ||
    !/^[0-9a-f]{64}$/.test(value.source_snapshot_sha256 ?? '')
  ) {
    throw new Error('clean browser execution requires an exact clean source subject');
  }
  return value;
}

function assertSameCleanSubject(expected, actual) {
  if (
    actual?.dirty !== false ||
    actual.repository_revision !== expected.repository_revision ||
    actual.source_snapshot_sha256 !== expected.source_snapshot_sha256
  ) {
    throw new Error('clean browser execution source identity changed');
  }
}

function assertCleanProvenance(value) {
  if (
    !value ||
    value.mode !== 'clean_git_snapshot' ||
    !/^[0-9a-f]{64}$/.test(value.tree_sha256 ?? '') ||
    !Number.isSafeInteger(value.files) ||
    value.files < 1 ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 0 ||
    !Number.isSafeInteger(value.excluded_sensitive_path_count) ||
    value.excluded_sensitive_path_count < 0 ||
    value.excluded_sensitive_path_count > 32 ||
    !/^[0-9a-f]{64}$/.test(value.excluded_sensitive_paths_sha256 ?? '') ||
    !Number.isSafeInteger(value.graft_count) ||
    value.graft_count < 0 ||
    value.graft_count > 8 ||
    !Array.isArray(value.grafts) ||
    value.grafts.length !== value.graft_count ||
    value.grafts.some((path) => !safeRelativePath(path)) ||
    !/^[0-9a-f]{64}$/.test(value.graft_sha256 ?? '')
  ) {
    throw new Error('clean browser execution provenance is invalid');
  }
}

async function removeOwnedRuntimeOutputs(executionRoot) {
  for (const relativePath of ['.codevetter', '.next']) {
    await removeOwnedRuntimeOutput(executionRoot, relativePath);
  }
}

async function removeOwnedRuntimeOutput(executionRoot, relativePath) {
  const output = join(executionRoot, relativePath);
  let metadata;
  try {
    metadata = await lstat(output);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (metadata.isSymbolicLink() || repositoryRelative(executionRoot, output) !== relativePath) {
    throw new Error('clean browser runtime output path is unsafe');
  }
  await rm(output, { recursive: true, force: false });
}

function safeRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !/[\0\r\n]/.test(value) &&
    value.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}
