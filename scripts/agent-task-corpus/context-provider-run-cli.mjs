#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CONTEXT_ATTEMPT_SCHEMA_VERSION,
  validateContextProviderAttempt,
} from './context-provider-evaluation.mjs';
import { canonicalJson, sha256Bytes, validateContract } from './contracts.mjs';
import {
  executeAgentTask,
  loadAgentAdapter,
  planAgentTask,
  runAdapterProcess,
} from './run-task.mjs';
import { resolveArtifact } from './validate-corpus.mjs';

const MODEL_ENVIRONMENT = 'CODEVETTER_LOCAL_MODEL_URL';
const OPERATOR_DIAGNOSTICS_SCHEMA_VERSION = 'codevetter.context-provider-operator-diagnostics.v1';
const CONTEXT_FILE = '.codevetter-context.json';
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_TOOL_BYTES = 64 * 1024 * 1024;

export async function runContextProviderPlan({
  root = process.cwd(),
  planPath,
  approvalId,
  modelUrl,
  toolPath,
  snapshotRoot = '.codevetter/verify-artifacts/context-provider/stage1',
  outputRoot,
} = {}) {
  const workspaceRoot = resolve(root);
  const planDocument = await readJson(workspaceRoot, planPath);
  const plan = planDocument.value;
  const errors = validateContract('context-provider-plan', plan);
  if (errors.length > 0) throw new Error(`invalid context-provider plan:\n${errors.join('\n')}`);
  assertExecutionApproval(plan, approvalId);
  if (plan.blocked_reasons.length > 0) {
    throw new Error(`execution plan is blocked: ${plan.blocked_reasons.join(', ')}`);
  }
  assertLoopbackModelUrl(modelUrl);

  const adapterPath = plan.agent_profile.adapter.path;
  const adapter = await loadAgentAdapter(resolveArtifact(workspaceRoot, adapterPath));
  if (adapter.sha256 !== plan.agent_profile.adapter.sha256) {
    throw new Error('agent adapter identity drifted after plan approval');
  }
  if (
    adapter.value.agent !== plan.agent_profile.agent ||
    adapter.value.model !== plan.agent_profile.model
  ) {
    throw new Error('agent or model identity drifted after plan approval');
  }
  await assertModelServer(modelUrl, adapter.value.model);

  const tool = resolveArtifact(workspaceRoot, toolPath, MAX_TOOL_BYTES);
  const snapshotDirectory = insideRoot(workspaceRoot, snapshotRoot, 'snapshot');
  const snapshotStats = await lstat(snapshotDirectory);
  if (snapshotStats.isSymbolicLink() || !snapshotStats.isDirectory()) {
    throw new Error('snapshot path must be a real directory');
  }
  const runRoot = insideRoot(
    workspaceRoot,
    outputRoot ?? `.codevetter/verify-artifacts/context-provider/runs/${plan.plan_id}`,
    'output'
  );
  await assertFreshOutput(runRoot);
  await mkdir(join(runRoot, 'receipts'), { recursive: true });
  await mkdir(join(runRoot, 'diagnostics'), { recursive: true });

  const providerById = new Map(plan.providers.map((provider) => [provider.provider_id, provider]));
  const snapshots = await loadSnapshots(plan, snapshotDirectory);
  const environment = { [MODEL_ENVIRONMENT]: modelUrl };
  const attempts = [];
  for (const scheduled of plan.schedule) {
    const provider = providerById.get(scheduled.provider_id);
    const treatment = provider.role === 'treatment';
    const snapshot = treatment ? snapshots.get(scheduled.task_id) : null;
    let workspaceId = `workspace-${sha256Bytes(Buffer.from(`${plan.plan_id}:${scheduled.sequence}`)).slice(0, 24)}`;
    const taskPlan = await planAgentTask({
      taskId: scheduled.task_id,
      adapterPath: adapter.path,
      availableEnvironmentNames: [MODEL_ENVIRONMENT],
    });
    const execution = await executeAgentTask({
      taskId: scheduled.task_id,
      adapterPath: adapter.path,
      environment,
      approvePlanId: taskPlan.plan_id,
      runAdapter: async (options) => {
        workspaceId = `workspace-${sha256Bytes(Buffer.from(options.cwd)).slice(0, 24)}`;
        if (treatment) {
          await writeFile(
            join(options.cwd, CONTEXT_FILE),
            JSON.stringify({
              indexed_revision: snapshot.indexed_revision,
              snapshot_id: snapshot.snapshot_id,
              snapshot_path: snapshot.path,
              tool_path: tool,
            }),
            { flag: 'wx' }
          );
        }
        return runAdapterProcess(options);
      },
    });
    if (execution.receipt.environment_sha256 !== plan.agent_profile.environment_sha256) {
      throw new Error(`attempt ${scheduled.sequence} environment identity drifted`);
    }
    const receiptPath = join(runRoot, 'receipts', `attempt-${scheduled.sequence}.json`);
    await writeJsonAtomic(receiptPath, execution.receipt);
    const receipt = await artifact(workspaceRoot, receiptPath);
    // The immutable receipt keeps only bounded hashes, so a failure cause would be
    // unrecoverable without retaining the matching redacted text beside it.
    await writeJsonAtomic(
      join(runRoot, 'diagnostics', `attempt-${scheduled.sequence}.json`),
      operatorDiagnostics(scheduled, execution)
    );
    const attempt = {
      schema_version: CONTEXT_ATTEMPT_SCHEMA_VERSION,
      plan_id: plan.plan_id,
      sequence: scheduled.sequence,
      provider_id: scheduled.provider_id,
      task_id: scheduled.task_id,
      trial_index: scheduled.trial_index,
      order: scheduled.order,
      ...(scheduled.comparison === undefined
        ? {}
        : { comparison: scheduled.comparison, arm: scheduled.arm }),
      workspace_id: workspaceId,
      agent_session_id: `session-${randomUUID()}`,
      tool_configuration_sha256: sha256Bytes(
        Buffer.from(
          canonicalJson({
            sequence: scheduled.sequence,
            provider_id: scheduled.provider_id,
            provider_configuration_sha256: provider.configuration_sha256,
            snapshot_id: snapshot?.snapshot_id ?? null,
          })
        )
      ),
      configured_tools: [...provider.allowed_tools],
      observed_tool_calls: [...(execution.receipt.diagnostics?.tool_calls ?? [])].sort(),
      generated_instruction_paths: [],
      retained_state_detected: false,
      snapshot_id: snapshot?.snapshot_id ?? null,
      indexed_revision: snapshot?.indexed_revision ?? null,
      receipt,
      adapter: plan.agent_profile.adapter,
    };
    const attemptErrors = validateContextProviderAttempt(attempt, plan);
    if (attemptErrors.length > 0) {
      throw new Error(`attempt ${scheduled.sequence} is invalid:\n${attemptErrors.join('\n')}`);
    }
    attempts.push(attempt);
    await writeJsonAtomic(join(runRoot, 'attempts.json'), attempts);
  }
  return {
    plan_id: plan.plan_id,
    approval_id: approvalId,
    attempts,
    attempts_path: relative(workspaceRoot, join(runRoot, 'attempts.json')).split(sep).join('/'),
    diagnostics_path: relative(workspaceRoot, join(runRoot, 'diagnostics')).split(sep).join('/'),
  };
}

export function operatorDiagnostics(scheduled, execution) {
  const { receipt, output } = execution;
  const observed = {
    stdout_sha256: sha256Bytes(Buffer.from(output?.stdout ?? '')),
    stderr_sha256: sha256Bytes(Buffer.from(output?.stderr ?? '')),
  };
  for (const stream of ['stdout', 'stderr']) {
    if (observed[`${stream}_sha256`] !== receipt.agent[`${stream}_sha256`]) {
      throw new Error(`attempt ${scheduled.sequence} ${stream} does not match its receipt hash`);
    }
  }
  return {
    schema_version: OPERATOR_DIAGNOSTICS_SCHEMA_VERSION,
    plan_id: receipt.plan_id,
    run_id: receipt.run_id,
    sequence: scheduled.sequence,
    task_id: scheduled.task_id,
    provider_id: scheduled.provider_id,
    terminal_status: receipt.terminal_status,
    lifecycle: [...receipt.lifecycle],
    agent: { ...receipt.agent },
    limitations: [...receipt.limitations],
    output: { stdout: output?.stdout ?? '', stderr: output?.stderr ?? '' },
  };
}

export function assertExecutionApproval(plan, approvalId) {
  if (approvalId !== plan?.approvals?.approval_id) {
    throw new Error(
      `execution approval must name current approval "${plan?.approvals?.approval_id}"`
    );
  }
}

export function assertLoopbackModelUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('local model URL is invalid');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error('context experiment requires a loopback-only local model URL');
  }
}

async function assertModelServer(modelUrl, declaredModel) {
  const [model, snapshot] = declaredModel.split('@');
  const response = await fetch(new URL('/v1/models', modelUrl), {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`local model inventory failed with HTTP ${response.status}`);
  const document = await response.json();
  const ids = (document?.data ?? []).map((entry) => entry?.id).filter(Boolean);
  if (!ids.includes(model) || !ids.some((id) => id.endsWith(`/snapshots/${snapshot}`))) {
    throw new Error('local model server does not expose the plan-pinned model snapshot');
  }
}

async function loadSnapshots(plan, directory) {
  const snapshots = new Map();
  const treatment = plan.providers.find((provider) => provider.role === 'treatment');
  for (const expected of treatment.snapshots) {
    const path = resolveArtifact(directory, `${expected.task_id}.graph.json`, MAX_ARTIFACT_BYTES);
    const document = JSON.parse(await readFile(path, 'utf8'));
    if (
      document?.snapshot?.id !== expected.snapshot_id ||
      document?.snapshot?.repo_head !== expected.indexed_revision
    ) {
      throw new Error(`snapshot identity drifted for task ${expected.task_id}`);
    }
    snapshots.set(expected.task_id, { ...expected, path });
  }
  return snapshots;
}

async function assertFreshOutput(path) {
  try {
    await lstat(path);
    throw new Error(`output already exists: ${path}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function readJson(root, declaredPath) {
  const path = resolveArtifact(root, declaredPath, MAX_ARTIFACT_BYTES);
  const bytes = await readFile(path);
  return { value: JSON.parse(bytes.toString('utf8')), path, sha256: sha256Bytes(bytes) };
}

async function artifact(root, path) {
  const bytes = await readFile(path);
  return {
    path: relative(root, path).split(sep).join('/'),
    sha256: sha256Bytes(bytes),
  };
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, path);
}

function insideRoot(root, path, label) {
  const absolute = resolve(root, path);
  const declared = relative(root, absolute);
  if (declared === '' || declared === '..' || declared.startsWith(`..${sep}`)) {
    throw new Error(`${label} path must be inside the repository root`);
  }
  return absolute;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      !['--plan', '--approve', '--model-url', '--tool', '--snapshots', '--out-root'].includes(
        argument
      )
    ) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    index += 1;
    if (argument === '--plan') options.planPath = value;
    if (argument === '--approve') options.approvalId = value;
    if (argument === '--model-url') options.modelUrl = value;
    if (argument === '--tool') options.toolPath = value;
    if (argument === '--snapshots') options.snapshotRoot = value;
    if (argument === '--out-root') options.outputRoot = value;
  }
  if (!options.planPath || !options.approvalId || !options.modelUrl || !options.toolPath) {
    throw new Error('--plan, --approve, --model-url, and --tool are required');
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runContextProviderPlan(parseArgs(process.argv.slice(2)));
    process.stdout.write(
      `Completed ${result.attempts.length} attempts\nEvidence: ${result.attempts_path}\nFailure diagnostics: ${result.diagnostics_path}\n`
    );
  } catch (error) {
    process.stderr.write(
      `Context-provider run failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  }
}
