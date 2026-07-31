import { execFile as execFileCallback } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import {
  CONTRACT_SCHEMA_VERSIONS,
  CORPUS_LIMITS,
  canonicalJson,
  sha256Bytes,
  validateContract,
} from './contracts.mjs';
import { DEFAULT_CORPUS_ROOT, resolveArtifact, validateCorpus } from './validate-corpus.mjs';

const execFile = promisify(execFileCallback);
const WORKSPACE_POLICY = 'public_fixture_and_task_packet_v1';
const MAX_DRIVER_OUTPUT_BYTES = 256 * 1024;
const LIMITATIONS = Object.freeze([
  'Qualification executes trusted corpus check code without an operating-system sandbox.',
]);

export async function qualifyTask({
  root = DEFAULT_CORPUS_ROOT,
  taskId,
  executeDriver = executeCheckDriver,
  removeWorkspace = removeQualificationWorkspace,
  temporaryRoot = tmpdir(),
} = {}) {
  if (typeof taskId !== 'string' || taskId.length === 0) {
    throw new Error('taskId is required');
  }
  const task = await loadTaskPackage(root, taskId);
  const phaseOptions = { executeDriver, removeWorkspace, temporaryRoot, task };
  const baseline = await qualifyPhase('baseline', phaseOptions);
  const knownGood = await qualifyPhase('known_good', phaseOptions);
  const cleanupStatus = [...baseline.attempts, ...knownGood.attempts].some(
    (attempt) => attempt.outcome === 'cleanup_failure'
  )
    ? 'failed'
    : 'complete';
  const qualified =
    baseline.status === 'intended_failure' &&
    knownGood.status === 'pass' &&
    cleanupStatus === 'complete';

  const receipt = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['qualification-receipt-v2'],
    task_id: taskId,
    manifest_sha256: task.identities.manifest,
    fixture_sha256: task.identities.fixture,
    acceptance_contract_sha256: task.identities.acceptance,
    known_good_sha256: task.identities.knownGood,
    workspace_policy: WORKSPACE_POLICY,
    qualified,
    baseline,
    known_good: knownGood,
    cleanup: { status: cleanupStatus },
    limitations: [...LIMITATIONS],
  };
  const errors = validateContract('qualification-receipt', receipt);
  if (errors.length > 0) {
    throw new Error(`qualification produced an invalid receipt:\n${errors.join('\n')}`);
  }
  return receipt;
}

export async function writeQualificationReceipt(path, receipt) {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, destination);
}

async function loadTaskPackage(root, taskId) {
  const corpusRoot = resolve(root);
  const validation = validateCorpus({ root: corpusRoot, ignoreQualification: true });
  if (!validation.valid) {
    throw new Error(`corpus validation failed:\n${validation.errors.join('\n')}`);
  }
  const indexPath = resolveArtifact(corpusRoot, 'corpus.json', CORPUS_LIMITS.maxDocumentBytes);
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  const entry = index.tasks.find((candidate) => candidate.task_id === taskId);
  if (!entry) throw new Error(`task "${taskId}" is not in the corpus`);

  const manifestPath = resolveArtifact(
    corpusRoot,
    entry.manifest.path,
    CORPUS_LIMITS.maxDocumentBytes
  );
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const taskRoot = dirname(manifestPath);
  const fixture = await readJsonArtifact(taskRoot, manifest.artifacts.fixture, 'fixture-bundle');
  const acceptance = await readJsonArtifact(
    taskRoot,
    manifest.artifacts.acceptance_contract,
    'acceptance-contract'
  );
  const knownGood = await readJsonArtifact(
    taskRoot,
    manifest.artifacts.known_good_patch,
    'known-good-change'
  );
  const taskPacketPath = resolveArtifact(
    taskRoot,
    manifest.artifacts.task_packet.path,
    CORPUS_LIMITS.maxArtifactBytes
  );
  const taskPacket = await readFile(taskPacketPath);
  const driverPath = resolveArtifact(
    taskRoot,
    acceptance.value.driver.path,
    CORPUS_LIMITS.maxArtifactBytes
  );
  const driverBytes = await readFile(driverPath);
  if (sha256Bytes(driverBytes) !== acceptance.value.driver.sha256) {
    throw new Error('acceptance driver SHA-256 does not match its contract');
  }

  return {
    taskId,
    taskRoot,
    fixture: fixture.value,
    acceptance: acceptance.value,
    knownGood: knownGood.value,
    taskPacket,
    driverPath,
    identities: {
      manifest: sha256Bytes(manifestBytes),
      fixture: fixture.sha256,
      acceptance: acceptance.sha256,
      knownGood: knownGood.sha256,
    },
  };
}

async function readJsonArtifact(root, artifact, kind) {
  const path = resolveArtifact(root, artifact.path, CORPUS_LIMITS.maxDocumentBytes);
  const bytes = await readFile(path);
  const sha256 = sha256Bytes(bytes);
  if (sha256 !== artifact.sha256) throw new Error(`${kind} SHA-256 does not match the manifest`);
  const value = JSON.parse(bytes.toString('utf8'));
  const errors = validateContract(kind, value);
  if (errors.length > 0) throw new Error(`invalid ${kind}:\n${errors.join('\n')}`);
  return { value, sha256 };
}

async function qualifyPhase(phase, options) {
  const attempts = [];
  for (let attempt = 1; attempt <= options.task.acceptance.repetitions; attempt += 1) {
    attempts.push(await runAttempt(phase, attempt, options));
  }
  const outcomes = new Set(attempts.map((item) => item.outcome));
  const results = new Set(attempts.map((item) => String(item.result_sha256)));
  const status = outcomes.size === 1 && results.size === 1 ? attempts[0].outcome : 'flaky';
  return { status, attempts };
}

async function runAttempt(phase, attempt, { executeDriver, removeWorkspace, temporaryRoot, task }) {
  let workspace = null;
  let outcome = 'setup_failure';
  let resultSha256 = null;
  try {
    workspace = await materializeWorkspace(task.fixture, task.taskPacket, temporaryRoot);
    if (phase === 'known_good') {
      try {
        await applyKnownGoodChange(workspace, task.knownGood);
      } catch {
        outcome = 'patch_failure';
      }
    }
    if (outcome !== 'patch_failure') {
      try {
        const execution = await executeDriver({
          driverPath: task.driverPath,
          workspace,
          taskId: task.taskId,
          acceptanceSha256: task.identities.acceptance,
          phase,
          attempt,
          timeoutMs: task.acceptance.driver.timeout_ms,
        });
        if (execution.kind !== 'result') {
          outcome = execution.kind;
        } else {
          resultSha256 = sha256Bytes(Buffer.from(canonicalJson(execution.result)));
          outcome = classifyResult(phase, execution.result, task.acceptance);
        }
      } catch {
        outcome = 'check_error';
      }
    }
  } catch (error) {
    outcome = error?.code === 'CODEVETTER_CLEANUP_FAILURE' ? 'cleanup_failure' : 'setup_failure';
  } finally {
    if (workspace !== null) {
      try {
        await removeWorkspace(workspace);
      } catch {
        outcome = 'cleanup_failure';
      }
    }
  }
  return { attempt, outcome, result_sha256: resultSha256 };
}

export async function materializeWorkspace(fixture, taskPacket, temporaryRoot = tmpdir()) {
  const workspace = await mkdtemp(join(resolve(temporaryRoot), 'codevetter-agent-task-'));
  try {
    for (const file of fixture.files) {
      const destination = safeWorkspacePath(workspace, file.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, Buffer.from(file.content_base64, 'base64'), { flag: 'wx' });
    }
    await writeFile(join(workspace, 'TASK.md'), taskPacket, { flag: 'wx' });
    return workspace;
  } catch (error) {
    try {
      await rm(workspace, { force: true, recursive: true });
    } catch {
      const cleanupError = new Error('workspace cleanup failed after setup');
      cleanupError.code = 'CODEVETTER_CLEANUP_FAILURE';
      throw cleanupError;
    }
    throw error;
  }
}

export async function applyKnownGoodChange(workspace, knownGood) {
  for (const file of knownGood.files) {
    const destination = safeWorkspacePath(workspace, file.path);
    const linkStats = await lstat(destination);
    if (linkStats.isSymbolicLink() || !linkStats.isFile()) {
      throw new Error(`known-good target is not a regular file: ${file.path}`);
    }
    const before = await readFile(destination);
    if (sha256Bytes(before) !== file.before_sha256) {
      throw new Error(`known-good before SHA-256 mismatch: ${file.path}`);
    }
    const after = Buffer.from(file.after_base64, 'base64');
    if (sha256Bytes(after) !== file.after_sha256) {
      throw new Error(`known-good after SHA-256 mismatch: ${file.path}`);
    }
    await writeFile(destination, after);
  }
}

export async function executeCheckDriver({
  driverPath,
  workspace,
  taskId,
  acceptanceSha256,
  phase,
  attempt,
  timeoutMs,
}) {
  try {
    const { stdout } = await execFile(
      process.execPath,
      [driverPath, workspace, taskId, acceptanceSha256, phase, String(attempt)],
      {
        cwd: dirname(driverPath),
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '' },
        maxBuffer: MAX_DRIVER_OUTPUT_BYTES,
        shell: false,
        timeout: timeoutMs,
        windowsHide: true,
      }
    );
    let result;
    try {
      result = JSON.parse(stdout);
    } catch {
      return { kind: 'check_error' };
    }
    const errors = validateContract('check-result', result);
    if (
      errors.length > 0 ||
      result.task_id !== taskId ||
      result.acceptance_contract_sha256 !== acceptanceSha256
    ) {
      return { kind: 'check_error' };
    }
    return { kind: 'result', result };
  } catch (error) {
    if (error?.killed || error?.signal === 'SIGTERM' || error?.code === 'ETIMEDOUT') {
      return { kind: 'timeout' };
    }
    return { kind: 'check_error' };
  }
}

function classifyResult(phase, result, acceptance) {
  const required = acceptance.required_checks.map((check) => check.id);
  const regression = acceptance.regression_checks.map((check) => check.id);
  const expected = [...required, ...regression].sort();
  const actual = result.results.map((check) => check.id).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) return 'incomplete_checks';
  const byId = new Map(result.results.map((check) => [check.id, check.status]));
  if (result.results.some((check) => check.status === 'error')) return 'check_error';
  const failedRequired = required.filter((id) => byId.get(id) !== 'pass');
  const failedRegression = regression.filter((id) => byId.get(id) !== 'pass');
  if (phase === 'baseline') {
    if (failedRegression.length > 0) return 'wrong_failure';
    return failedRequired.some((id) => acceptance.task_defining_failures.includes(id))
      ? 'intended_failure'
      : 'wrong_failure';
  }
  if (failedRegression.length > 0) return 'regression';
  if (failedRequired.length > 0) return 'check_failure';
  return 'pass';
}

async function removeQualificationWorkspace(workspace) {
  await rm(workspace, { force: true, recursive: true });
}

function safeWorkspacePath(workspace, declaredPath) {
  if (
    typeof declaredPath !== 'string' ||
    declaredPath.length === 0 ||
    declaredPath.length > 240 ||
    isAbsolute(declaredPath) ||
    /^[A-Za-z]:/.test(declaredPath) ||
    declaredPath.includes('\\') ||
    declaredPath.includes('\0') ||
    declaredPath.split('/').includes('..')
  ) {
    throw new Error(`unsafe workspace path: ${String(declaredPath)}`);
  }
  const candidate = resolve(workspace, declaredPath);
  const pathFromRoot = relative(workspace, candidate);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`workspace path escapes root: ${declaredPath}`);
  }
  return candidate;
}
