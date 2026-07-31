import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import {
  STRUCTURAL_CONTEXT_SCORER_VERSION,
  scoreManifest,
  validateManifest,
} from '../run-structural-context-evaluation.mjs';
import {
  CONTRACT_SCHEMA_VERSIONS,
  CORPUS_LIMITS,
  canonicalJson,
  sha256Bytes,
  validateContract,
} from './contracts.mjs';
import { loadTaskPackage } from './qualify-task.mjs';
import { validateCorpus } from './validate-corpus.mjs';

const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPT_BYTES = CORPUS_LIMITS.maxDocumentBytes;
const SCORER_PATH = new URL('../run-structural-context-evaluation.mjs', import.meta.url);

export async function evaluateReceiptBundle({
  bundlePath,
  root = process.cwd(),
  scorerPath = SCORER_PATH,
} = {}) {
  if (typeof bundlePath !== 'string' || bundlePath.length === 0) {
    throw new Error('bundlePath is required');
  }
  const bundleDocument = await readExplicitJson(bundlePath, MAX_BUNDLE_BYTES);
  const bundleErrors = validateContract('evaluation-bundle', bundleDocument.value);
  if (bundleErrors.length > 0) {
    throw new Error(`invalid evaluation bundle:\n${bundleErrors.join('\n')}`);
  }

  const workspaceRoot = resolve(root);
  const corpusDocument = await readDeclaredArtifact(
    workspaceRoot,
    bundleDocument.value.corpus,
    CORPUS_LIMITS.maxDocumentBytes
  );
  if (!corpusDocument.path.endsWith(`${sep}corpus.json`)) {
    throw new Error('evaluation bundle corpus path must name corpus.json');
  }
  const corpusRoot = dirname(corpusDocument.path);
  const corpusValidation = validateCorpus({ root: corpusRoot, ignoreQualification: true });
  if (!corpusValidation.valid) {
    throw new Error(`corpus validation failed:\n${corpusValidation.errors.join('\n')}`);
  }

  const tasks = await loadEvaluationTasks(bundleDocument.value.tasks, corpusRoot);
  const runs = await loadEvaluationRuns(bundleDocument.value.runs, workspaceRoot, tasks);
  const manifest = projectManifest(bundleDocument.value, tasks, runs);
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length > 0) {
    throw new Error(`invalid projected evaluator manifest:\n${manifestErrors.join('\n')}`);
  }

  const scorecard = scoreManifest(manifest, `receipt-bundle:${bundleDocument.value.experiment.id}`);
  if (scorecard.invalid_pairs.length > 0) {
    const reasons = scorecard.invalid_pairs
      .map((pair) => `${pair.comparison}:${pair.pair_id}: ${pair.reasons.join(', ')}`)
      .join('\n');
    throw new Error(`evaluation export rejected invalid evidence:\n${reasons}`);
  }

  const scorerBytes = await readFile(scorerPath);
  const groundTruth = [...tasks.values()]
    .map((task) => ({
      task_id: task.taskId,
      acceptance_contract_sha256: task.identities.acceptance,
      checks: allAcceptanceChecks(task).map((check) => ({ id: check.id, label: check.label })),
    }))
    .sort((left, right) => left.task_id.localeCompare(right.task_id));
  const receiptEvidence = runs
    .map((run) => ({
      path: run.descriptor.receipt.path,
      sha256: run.descriptor.receipt.sha256,
      run_id: run.receipt.run_id,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const draft = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['evaluation-score'],
    scorer: {
      version: STRUCTURAL_CONTEXT_SCORER_VERSION,
      sha256: sha256Bytes(scorerBytes),
    },
    evidence: {
      bundle_sha256: bundleDocument.sha256,
      corpus_sha256: corpusDocument.sha256,
      ground_truth_sha256: sha256Bytes(Buffer.from(canonicalJson(groundTruth))),
      projected_manifest_sha256: sha256Bytes(Buffer.from(canonicalJson(manifest))),
      receipts: receiptEvidence,
    },
    scorecard,
  };
  const score = {
    ...draft,
    score_id: `score-${sha256Bytes(Buffer.from(canonicalJson(draft))).slice(0, 32)}`,
  };
  const scoreErrors = validateContract('evaluation-score', score);
  if (scoreErrors.length > 0) {
    throw new Error(`invalid derived evaluation score:\n${scoreErrors.join('\n')}`);
  }
  return { manifest, score };
}

async function loadEvaluationTasks(taskDescriptors, corpusRoot) {
  const tasks = new Map();
  for (const descriptor of taskDescriptors) {
    const task = await loadTaskPackage(corpusRoot, descriptor.task_id);
    if (task.manifest.provenance.revision !== descriptor.repository_revision) {
      throw new Error(`task "${descriptor.task_id}" repository revision does not match corpus`);
    }
    tasks.set(descriptor.task_id, {
      ...task,
      repositoryRevision: descriptor.repository_revision,
    });
  }
  return tasks;
}

async function loadEvaluationRuns(runDescriptors, workspaceRoot, tasks) {
  const runs = [];
  const runIds = new Set();
  for (const descriptor of runDescriptors) {
    const task = tasks.get(descriptor.task_id);
    const receiptDocument = await readDeclaredArtifact(
      workspaceRoot,
      descriptor.receipt,
      MAX_RECEIPT_BYTES
    );
    const receipt = parseJson(receiptDocument.bytes, descriptor.receipt.path);
    const receiptErrors = validateContract('run-receipt', receipt);
    if (receiptErrors.length > 0) {
      throw new Error(
        `invalid run receipt "${descriptor.receipt.path}":\n${receiptErrors.join('\n')}`
      );
    }
    if (receipt.schema_version !== CONTRACT_SCHEMA_VERSIONS['run-receipt-v2']) {
      throw new Error(`run receipt "${descriptor.receipt.path}" must use the v2 contract`);
    }
    if (runIds.has(receipt.run_id)) {
      throw new Error(`duplicate raw run identity "${receipt.run_id}"`);
    }
    runIds.add(receipt.run_id);

    const adapterDocument = await readDeclaredArtifact(
      workspaceRoot,
      descriptor.adapter,
      MAX_RECEIPT_BYTES
    );
    const adapter = parseJson(adapterDocument.bytes, descriptor.adapter.path);
    const adapterErrors = validateContract('agent-adapter', adapter);
    if (adapterErrors.length > 0) {
      throw new Error(
        `invalid agent adapter "${descriptor.adapter.path}":\n${adapterErrors.join('\n')}`
      );
    }
    if (adapter.schema_version !== CONTRACT_SCHEMA_VERSIONS['agent-adapter-v2']) {
      throw new Error(`agent adapter "${descriptor.adapter.path}" must use the v2 contract`);
    }
    validateReceiptIdentity(receipt, adapterDocument.sha256, task, descriptor.receipt.path);
    validateReceiptChecks(receipt, task, descriptor.receipt.path);
    runs.push({ descriptor, receipt, adapter });
  }
  return runs;
}

function validateReceiptIdentity(receipt, adapterSha256, task, label) {
  const expected = {
    task_id: task.taskId,
    manifest_sha256: task.identities.manifest,
    fixture_sha256: task.identities.fixture,
    acceptance_contract_sha256: task.identities.acceptance,
    adapter_sha256: adapterSha256,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (receipt[field] !== value) {
      throw new Error(`run receipt "${label}" ${field} does not match immutable evidence`);
    }
  }
}

function validateReceiptChecks(receipt, task, label) {
  const expected = allAcceptanceChecks(task)
    .map((check) => check.id)
    .sort();
  const observed = receipt.checks.map((check) => check.id).sort();
  const checksStarted = receipt.lifecycle.includes('checks_started');
  if (!checksStarted && observed.length > 0) {
    throw new Error(`run receipt "${label}" reports checks before checks_started`);
  }
  if (checksStarted && JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(`run receipt "${label}" is missing or adds acceptance checks`);
  }
}

function projectManifest(bundle, tasks, runs) {
  return {
    schema_version: 1,
    experiment: {
      id: bundle.experiment.id,
      title: bundle.experiment.title,
      evidence_kind: bundle.experiment.evidence_kind,
      qualification_policy: { ...bundle.experiment.qualification_policy },
      limitations: [...bundle.experiment.limitations],
    },
    tasks: [...tasks.values()]
      .map((task) => ({
        id: task.taskId,
        title: task.manifest.title,
        repository_revision: task.repositoryRevision,
        task_packet_sha256: task.identities.taskPacket,
        acceptance_contract_sha256: task.identities.acceptance,
        required_checks: allAcceptanceChecks(task).map((check) => ({
          id: check.id,
          label: check.label,
        })),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    runs: runs.map((run) => projectRun(run, tasks)).sort(compareProjectedRuns),
  };
}

function projectRun({ descriptor, receipt, adapter }, tasks) {
  const task = tasks.get(descriptor.task_id);
  const diagnostics = projectDiagnostics(receipt.diagnostics);
  return {
    pair_id: descriptor.pair_id,
    comparison: descriptor.comparison,
    arm: descriptor.arm,
    task_id: descriptor.task_id,
    trial_index: descriptor.trial_index,
    execution_order: descriptor.execution_order,
    identities: {
      repository_revision: task.repositoryRevision,
      task_packet_sha256: task.identities.taskPacket,
      acceptance_contract_sha256: receipt.acceptance_contract_sha256,
      agent: adapter.agent,
      model: adapter.model,
      configuration_sha256: receipt.adapter_sha256,
      environment_sha256: receipt.environment_sha256,
    },
    context: structuredClone(descriptor.context),
    outcome: {
      status: projectTerminalStatus(receipt.terminal_status),
      regression_count: receipt.regression_count,
      checks: receipt.lifecycle.includes('checks_started')
        ? receipt.checks.map((check) => ({ id: check.id, status: check.status }))
        : allAcceptanceChecks(task).map((check) => ({ id: check.id, status: 'skipped' })),
    },
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
}

function projectTerminalStatus(status) {
  if (status === 'setup_failure') return 'setup_failed';
  if (status === 'agent_failure') return 'agent_failed';
  if (status === 'timeout') return 'timed_out';
  if (['cancelled', 'check_error', 'cleanup_failure'].includes(status)) return status;
  return 'completed';
}

function projectDiagnostics(diagnostics) {
  if (diagnostics === undefined) return undefined;
  const projected = {};
  for (const field of ['input_tokens', 'output_tokens', 'cost_usd']) {
    if (diagnostics[field] !== undefined) projected[field] = diagnostics[field];
  }
  for (const field of ['tool_calls', 'files_inspected', 'files_modified']) {
    if (diagnostics[field] !== undefined) projected[field] = [...diagnostics[field]];
  }
  return Object.keys(projected).length === 0 ? undefined : projected;
}

function allAcceptanceChecks(task) {
  return [...task.acceptance.required_checks, ...task.acceptance.regression_checks].sort(
    (left, right) => left.id.localeCompare(right.id)
  );
}

function compareProjectedRuns(left, right) {
  return (
    left.comparison.localeCompare(right.comparison) ||
    left.pair_id.localeCompare(right.pair_id) ||
    left.execution_order - right.execution_order ||
    left.arm.localeCompare(right.arm)
  );
}

async function readExplicitJson(path, maxBytes) {
  const absolute = resolve(path);
  const document = await readFileDocument(absolute, maxBytes, path);
  return { ...document, value: parseJson(document.bytes, path) };
}

async function readDeclaredArtifact(root, artifact, maxBytes) {
  const absolute = resolve(root, artifact.path);
  const parent = relative(root, absolute);
  if (parent === '..' || parent.startsWith(`..${sep}`)) {
    throw new Error(`artifact escapes the evaluation root: ${artifact.path}`);
  }
  const document = await readFileDocument(absolute, maxBytes, artifact.path);
  if (document.sha256 !== artifact.sha256) {
    throw new Error(`artifact SHA-256 mismatch: ${artifact.path}`);
  }
  return document;
}

async function readFileDocument(path, maxBytes, label) {
  const stat = await lstat(path);
  if (!stat.isFile()) throw new Error(`artifact is not a regular file: ${label}`);
  if (stat.size > maxBytes) throw new Error(`artifact exceeds ${maxBytes} bytes: ${label}`);
  const bytes = await readFile(path);
  return { path, bytes, sha256: sha256Bytes(bytes) };
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`artifact is not valid JSON: ${label}`);
  }
}

export async function writeEvaluationScore(path, score) {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(score, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, destination);
}
