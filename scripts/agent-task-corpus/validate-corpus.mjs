import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  CONTRACT_SCHEMA_VERSIONS,
  CORPUS_LIMITS,
  sha256Bytes,
  validateContract,
} from './contracts.mjs';

export const DEFAULT_CORPUS_ROOT = 'benchmarks/agent-tasks/sample';

export function validateCorpus({ root = DEFAULT_CORPUS_ROOT } = {}) {
  const corpusRoot = resolve(root);
  const indexPath = resolve(corpusRoot, 'corpus.json');
  const errors = [];
  const warnings = [];
  const taskRows = [];
  let index;
  let indexBytes;

  try {
    ({ bytes: indexBytes, value: index } = readJsonDocument(
      indexPath,
      CORPUS_LIMITS.maxDocumentBytes
    ));
  } catch (error) {
    errors.push(`corpus.json: ${message(error)}`);
  }

  if (index !== undefined) {
    errors.push(...validateContract('corpus-index', index).map((error) => `corpus.json ${error}`));
  }

  const entries = Array.isArray(index?.tasks) ? index.tasks : [];
  for (const entry of entries) {
    taskRows.push(validateTaskEntry(corpusRoot, entry, errors));
  }
  taskRows.sort((left, right) => left.task_id.localeCompare(right.task_id));

  const validTasks = taskRows.filter((task) => task.valid);
  const lanes = uniqueSorted(validTasks.map((task) => task.lane).filter(Boolean));
  const runtimes = uniqueSorted(validTasks.map((task) => task.runtime).filter(Boolean));
  const categories = uniqueSorted(validTasks.map((task) => task.category).filter(Boolean));
  const qualifiedTasks = validTasks.filter((task) => task.qualified).length;
  const counts = {
    categories: categories.length,
    qualified_tasks: qualifiedTasks,
    tasks: validTasks.length,
  };
  const gates = [
    gate(
      'task-count',
      counts.tasks >= CORPUS_LIMITS.minPublishableTasks && counts.tasks <= CORPUS_LIMITS.maxTasks,
      `${CORPUS_LIMITS.minPublishableTasks}-${CORPUS_LIMITS.maxTasks}`,
      counts.tasks
    ),
    gate(
      'qualification-count',
      qualifiedTasks === counts.tasks && counts.tasks > 0,
      'all tasks',
      qualifiedTasks
    ),
    gate(
      'lane-coverage',
      lanes.includes('api') && lanes.includes('browser'),
      'api,browser',
      lanes.join(',') || 'none'
    ),
    gate(
      'runtime-coverage',
      runtimes.includes('node') && runtimes.includes('typescript'),
      'node,typescript',
      runtimes.join(',') || 'none'
    ),
    gate(
      'failure-category-count',
      categories.length >= CORPUS_LIMITS.minPublishableCategories,
      `>=${CORPUS_LIMITS.minPublishableCategories}`,
      categories.length
    ),
  ];

  errors.sort();
  const valid = errors.length === 0;
  const publishable = valid && gates.every((item) => item.passed);
  if (valid && !publishable) {
    warnings.push('Corpus is structurally valid but not publishable.');
  }

  return {
    schema_version: 'codevetter.agent-task-corpus-validation.v1',
    corpus: {
      id: typeof index?.corpus_id === 'string' ? index.corpus_id : null,
      version: typeof index?.version === 'string' ? index.version : null,
      index_sha256: indexBytes ? sha256Bytes(indexBytes) : null,
    },
    counts,
    coverage: { categories, lanes, runtimes },
    tasks: taskRows,
    gates,
    errors,
    warnings,
    valid,
    publishable,
  };
}

function validateTaskEntry(corpusRoot, entry, errors) {
  const taskId = typeof entry?.task_id === 'string' ? entry.task_id : '(invalid-task-id)';
  const row = {
    task_id: taskId,
    manifest_sha256: null,
    lane: null,
    runtime: null,
    category: null,
    qualified: false,
    valid: false,
  };
  const entryErrors = [];
  let manifestDocument;
  let manifestPath;

  try {
    manifestPath = resolveArtifact(
      corpusRoot,
      entry?.manifest?.path,
      CORPUS_LIMITS.maxDocumentBytes
    );
    const manifestBytes = readFileSync(manifestPath);
    row.manifest_sha256 = sha256Bytes(manifestBytes);
    if (row.manifest_sha256 !== entry?.manifest?.sha256) {
      entryErrors.push(
        `manifest: SHA-256 mismatch for ${entry?.manifest?.path ?? '(missing path)'}`
      );
    }
    manifestDocument = parseJson(manifestBytes, entry?.manifest?.path ?? 'manifest');
  } catch (error) {
    entryErrors.push(`manifest: ${message(error)}`);
  }

  if (manifestDocument !== undefined) {
    entryErrors.push(...validateContract('task-manifest', manifestDocument));
    if (manifestDocument.task_id !== taskId) {
      entryErrors.push(`$.task_id: expected "${taskId}" from corpus index`);
    }
    row.lane = typeof manifestDocument.lane === 'string' ? manifestDocument.lane : null;
    row.runtime = typeof manifestDocument.runtime === 'string' ? manifestDocument.runtime : null;
    row.category = typeof manifestDocument.category === 'string' ? manifestDocument.category : null;

    const taskRoot = manifestPath ? dirname(manifestPath) : corpusRoot;
    for (const [name, artifact] of Object.entries(manifestDocument.artifacts ?? {}).sort()) {
      validateArtifact(taskRoot, artifact, `artifact ${name}`, entryErrors);
    }
  }

  if (entry?.qualification !== undefined) {
    validateQualification(
      corpusRoot,
      entry.qualification,
      taskId,
      row.manifest_sha256,
      entryErrors
    );
    row.qualified = !entryErrors.some((error) => error.startsWith('qualification:'));
  }

  for (const error of [...new Set(entryErrors)].sort()) {
    errors.push(`task ${taskId}: ${error}`);
  }
  row.valid = entryErrors.length === 0;
  if (!row.valid) row.qualified = false;
  return row;
}

function validateQualification(corpusRoot, artifact, taskId, manifestSha256, errors) {
  let receipt;
  try {
    const path = resolveArtifact(corpusRoot, artifact?.path, CORPUS_LIMITS.maxDocumentBytes);
    const bytes = readFileSync(path);
    if (sha256Bytes(bytes) !== artifact?.sha256) {
      errors.push(`qualification: SHA-256 mismatch for ${artifact?.path ?? '(missing path)'}`);
    }
    receipt = parseJson(bytes, artifact?.path ?? 'qualification receipt');
  } catch (error) {
    errors.push(`qualification: ${message(error)}`);
    return;
  }

  for (const error of validateContract('qualification-receipt', receipt)) {
    errors.push(`qualification: ${error}`);
  }
  if (receipt?.schema_version !== CONTRACT_SCHEMA_VERSIONS['qualification-receipt']) return;
  if (receipt.task_id !== taskId) errors.push(`qualification: $.task_id must equal "${taskId}"`);
  if (receipt.manifest_sha256 !== manifestSha256) {
    errors.push('qualification: $.manifest_sha256 does not match the task manifest');
  }
  if (receipt.qualified !== true)
    errors.push('qualification: $.qualified must be true for readiness');
}

function validateArtifact(taskRoot, artifact, label, errors) {
  try {
    const path = resolveArtifact(taskRoot, artifact?.path, CORPUS_LIMITS.maxArtifactBytes);
    const bytes = readFileSync(path);
    const actual = sha256Bytes(bytes);
    if (actual !== artifact?.sha256) {
      errors.push(`${label}: SHA-256 mismatch for ${artifact?.path ?? '(missing path)'}`);
    }
  } catch (error) {
    errors.push(`${label}: ${message(error)}`);
  }
}

function resolveArtifact(root, declaredPath, maxBytes) {
  if (typeof declaredPath !== 'string' || !safeRelativePath(declaredPath)) {
    throw new Error(`unsafe relative path "${String(declaredPath)}"`);
  }
  const realRoot = realpathSync(root);
  const candidate = resolve(realRoot, declaredPath);
  if (!inside(realRoot, candidate)) throw new Error(`path escapes its root: ${declaredPath}`);
  const linkStats = lstatSync(candidate);
  if (linkStats.isSymbolicLink()) throw new Error(`symbolic links are forbidden: ${declaredPath}`);
  const realCandidate = realpathSync(candidate);
  if (!inside(realRoot, realCandidate))
    throw new Error(`resolved path escapes its root: ${declaredPath}`);
  const stats = statSync(realCandidate);
  if (!stats.isFile()) throw new Error(`artifact is not a regular file: ${declaredPath}`);
  if (stats.size === 0 || stats.size > maxBytes) {
    throw new Error(`artifact size ${stats.size} is outside 1-${maxBytes} bytes: ${declaredPath}`);
  }
  return realCandidate;
}

function readJsonDocument(path, maxBytes) {
  const resolved = resolveArtifact(dirname(path), path.split(sep).at(-1), maxBytes);
  const bytes = readFileSync(resolved);
  return { bytes, value: parseJson(bytes, path) };
}

function parseJson(bytes, path) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`invalid JSON in ${path}: ${message(error)}`);
  }
}

function safeRelativePath(value) {
  return (
    value.length > 0 &&
    value.length <= 240 &&
    !isAbsolute(value) &&
    !/^[A-Za-z]:/.test(value) &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.split('/').includes('..')
  );
}

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function gate(id, passed, expected, actual) {
  return { id, passed, expected, actual };
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
