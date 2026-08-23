import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import {
  CONTRACT_SCHEMA_VERSIONS,
  CORPUS_LIMITS,
  canonicalJson,
  deriveRunPlanId,
  sha256Bytes,
  validateContract,
} from './contracts.mjs';
import { executeCheckDriver, loadTaskPackage, materializeWorkspace } from './qualify-task.mjs';
import { DEFAULT_CORPUS_ROOT, resolveArtifact, validateCorpus } from './validate-corpus.mjs';

const MAX_OUTPUT_BYTES = 256 * 1024;
const EMPTY_SHA256 = sha256Bytes(Buffer.alloc(0));
const WORKSPACE_POLICY = 'public_fixture_and_task_packet_v1';
const PLAN_LIMITATIONS = Object.freeze([
  'Token counts use a conservative byte heuristic rather than provider tokenization.',
  'Planning checks environment-name availability without reading environment values.',
]);
const RUN_LIMITATIONS = Object.freeze([
  'The runner executes an immutable adapter without an operating-system sandbox.',
  'Captured operator output is bounded and redacted before it leaves the runner.',
]);
const DIAGNOSTICS_FAILURE_LIMITATION = 'Declared adapter diagnostics were unavailable or invalid.';

export async function planAgentTask({
  root = DEFAULT_CORPUS_ROOT,
  taskId,
  adapterPath,
  availableEnvironmentNames = [],
} = {}) {
  const validation = validateCorpus({ root });
  const taskRow = validation.tasks.find((task) => task.task_id === taskId);
  if (!validation.valid || !taskRow?.qualified) {
    throw new Error(
      !validation.valid
        ? `corpus validation failed:\n${validation.errors.join('\n')}`
        : `task "${taskId}" does not have valid qualification evidence`
    );
  }
  const task = await loadTaskPackage(root, taskId);
  const adapter = await loadAgentAdapter(adapterPath);
  const available = new Set(availableEnvironmentNames);
  const environment = adapter.value.environment_names.map((name) => ({
    name,
    available: available.has(name),
  }));
  const filteredInputBytes =
    task.taskPacket.length +
    task.fixture.files.reduce(
      (total, file) => total + Buffer.from(file.content_base64, 'base64').length,
      0
    );
  const estimatedInputTokens =
    Math.ceil(filteredInputBytes / 4) + adapter.value.planning.prompt_overhead_tokens;
  const estimatedMaxCostUsd = roundCostUp(
    (estimatedInputTokens * adapter.value.planning.input_usd_per_million +
      adapter.value.planning.reserved_output_tokens *
        adapter.value.planning.output_usd_per_million) /
      1_000_000
  );
  const withinCostLimit = estimatedMaxCostUsd <= adapter.value.planning.max_cost_usd;
  const blockedReasons = environment
    .filter((entry) => !entry.available)
    .map((entry) => `missing-environment:${entry.name}`);
  if (!withinCostLimit) blockedReasons.push('cost-limit-exceeded');
  blockedReasons.sort();

  const draft = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['run-plan'],
    task_id: taskId,
    manifest_sha256: task.identities.manifest,
    fixture_sha256: task.identities.fixture,
    acceptance_contract_sha256: task.identities.acceptance,
    adapter_sha256: adapter.sha256,
    workspace_policy: WORKSPACE_POLICY,
    environment,
    filtered_input_bytes: filteredInputBytes,
    estimated_input_tokens: estimatedInputTokens,
    reserved_output_tokens: adapter.value.planning.reserved_output_tokens,
    estimated_max_cost_usd: estimatedMaxCostUsd,
    max_cost_usd: adapter.value.planning.max_cost_usd,
    cost_posture: adapter.value.cost_posture,
    within_cost_limit: withinCostLimit,
    command: [...adapter.value.command],
    approval: {
      launch_required: true,
      paid_required: adapter.value.cost_posture !== 'free',
    },
    blocked_reasons: blockedReasons,
    limitations: [...PLAN_LIMITATIONS],
  };
  const plan = { ...draft, plan_id: deriveRunPlanId(draft) };
  const errors = validateContract('run-plan', plan);
  if (errors.length > 0) throw new Error(`invalid run plan:\n${errors.join('\n')}`);
  return plan;
}

export async function executeAgentTask({
  root = DEFAULT_CORPUS_ROOT,
  taskId,
  adapterPath,
  environment = {},
  approvePlanId,
  approvePaid = false,
  signal,
  runAdapter = runAdapterProcess,
  executeDriver = executeCheckDriver,
  removeWorkspace = removeRunWorkspace,
  temporaryRoot,
  runIdFactory = () => `run-${randomUUID()}`,
  now = monotonicMilliseconds,
} = {}) {
  const plan = await planAgentTask({
    root,
    taskId,
    adapterPath,
    availableEnvironmentNames: Object.keys(environment),
  });
  if (approvePlanId !== plan.plan_id) {
    throw new Error(`launch approval must name current plan "${plan.plan_id}"`);
  }
  if (plan.approval.paid_required && approvePaid !== true) {
    throw new Error('paid or unknown-cost adapter requires separate paid approval');
  }
  if (plan.blocked_reasons.length > 0) {
    throw new Error(`execution is blocked: ${plan.blocked_reasons.join(', ')}`);
  }

  const task = await loadTaskPackage(root, taskId);
  const adapter = await loadAgentAdapter(adapterPath);
  const declaredEnvironment = {};
  for (const name of adapter.value.environment_names) {
    if (typeof environment[name] !== 'string') {
      throw new Error(`declared environment value is unavailable: ${name}`);
    }
    declaredEnvironment[name] = environment[name];
  }
  const environmentIdentity = adapter.value.environment_names.map((name) => ({
    name,
    value_sha256: sha256Bytes(Buffer.from(declaredEnvironment[name])),
  }));
  const environmentSha256 = sha256Bytes(Buffer.from(canonicalJson(environmentIdentity)));
  const lifecycle = [];
  let workspace = null;
  let terminalStatus = 'setup_failure';
  let checks = [];
  let regressionCount = 0;
  let agentResult = emptyAgentResult();
  let operatorOutput = { stdout: '', stderr: '' };
  let diagnostics;
  let diagnosticsFailed = false;
  let resources = unavailableResources(
    'The adapter process did not expose sampled resource evidence.'
  );
  const telemetry = createTelemetryRecorder(now);
  let activeEvent = telemetry.start('workspace_prepare');

  try {
    workspace = await materializeWorkspace(task.fixture, task.taskPacket, temporaryRoot);
    telemetry.finish(activeEvent, 'complete');
    lifecycle.push('workspace_prepared');
    activeEvent = telemetry.start('agent_execute');
    const command = resolveAdapterCommand(adapter, workspace);
    const execution = await runAdapter({
      command,
      cwd: workspace,
      environment: declaredEnvironment,
      timeoutMs: adapter.value.timeout_ms,
      signal,
      onStarted: () => lifecycle.push('agent_started'),
    });
    telemetry.finish(activeEvent, agentPhaseOutcome(execution.status));
    resources = normalizeResources(execution.resources);
    const normalized = normalizeAgentOutput(execution, Object.values(declaredEnvironment));
    agentResult = normalized.agent;
    operatorOutput = normalized.output;
    if (agentResult.status !== 'not_started') lifecycle.push('agent_terminated');
    if (
      adapter.value.diagnostics_path !== undefined &&
      ['exited', 'failed'].includes(agentResult.status)
    ) {
      try {
        diagnostics = await consumeAdapterDiagnostics({
          workspace,
          path: adapter.value.diagnostics_path,
          secretValues: Object.values(declaredEnvironment),
        });
      } catch {
        diagnosticsFailed = true;
      }
    }

    if (agentResult.status === 'timeout') {
      terminalStatus = 'timeout';
    } else if (agentResult.status === 'cancelled') {
      terminalStatus = 'cancelled';
    } else if (agentResult.status !== 'exited' || agentResult.exit_code !== 0) {
      terminalStatus = 'agent_failure';
    } else if (diagnosticsFailed) {
      terminalStatus = 'agent_failure';
    } else {
      lifecycle.push('checks_started');
      activeEvent = telemetry.start('checks_execute');
      const checkExecution = await executeDriver({
        driverPath: task.driverPath,
        workspace,
        taskId,
        acceptanceSha256: task.identities.acceptance,
        phase: 'agent_run',
        attempt: 1,
        timeoutMs: task.acceptance.driver.timeout_ms,
      });
      if (checkExecution.kind === 'result') {
        checks = checkExecution.result.results;
        terminalStatus = classifyRunChecks(checks, task.acceptance);
        regressionCount = task.acceptance.regression_checks.filter(
          (check) => checks.find((result) => result.id === check.id)?.status === 'fail'
        ).length;
      } else {
        terminalStatus = checkExecution.kind === 'timeout' ? 'timeout' : 'check_error';
      }
      telemetry.finish(activeEvent, checkPhaseOutcome(checkExecution.kind));
      lifecycle.push('checks_finished');
    }
  } catch (error) {
    telemetry.finish(activeEvent, 'failed');
    if (error?.code === 'CODEVETTER_CLEANUP_FAILURE') {
      terminalStatus = 'cleanup_failure';
      lifecycle.push('cleanup_failed');
    } else {
      terminalStatus = lifecycle.includes('checks_started')
        ? 'check_error'
        : lifecycle.includes('agent_started')
          ? 'agent_failure'
          : 'setup_failure';
    }
  } finally {
    if (workspace !== null) {
      activeEvent = telemetry.start('cleanup');
      try {
        await removeWorkspace(workspace);
        telemetry.finish(activeEvent, 'complete');
        lifecycle.push('cleanup_complete');
      } catch {
        telemetry.finish(activeEvent, 'failed');
        lifecycle.push('cleanup_failed');
        terminalStatus = 'cleanup_failure';
      }
    }
  }

  const receipt = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['run-receipt-v2'],
    run_id: runIdFactory(),
    plan_id: plan.plan_id,
    task_id: taskId,
    manifest_sha256: task.identities.manifest,
    fixture_sha256: task.identities.fixture,
    acceptance_contract_sha256: task.identities.acceptance,
    adapter_sha256: adapter.sha256,
    environment_sha256: environmentSha256,
    workspace_policy: WORKSPACE_POLICY,
    terminal_status: terminalStatus,
    lifecycle,
    agent: agentResult,
    checks,
    regression_count: regressionCount,
    cleanup: { status: lifecycle.includes('cleanup_failed') ? 'failed' : 'complete' },
    ...(diagnostics === undefined ? {} : { diagnostics }),
    telemetry: telemetry.document(resources),
    limitations: [
      ...RUN_LIMITATIONS,
      ...(diagnosticsFailed ? [DIAGNOSTICS_FAILURE_LIMITATION] : []),
    ],
  };
  const errors = validateContract('run-receipt', receipt);
  if (errors.length > 0)
    throw new Error(`runner produced an invalid receipt:\n${errors.join('\n')}`);
  return { plan, receipt, output: operatorOutput };
}

export async function writeRunReceipt(path, receipt) {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, destination);
}

export async function loadAgentAdapter(adapterPath) {
  if (typeof adapterPath !== 'string' || adapterPath.length === 0) {
    throw new Error('adapterPath is required');
  }
  const declared = resolve(adapterPath);
  const path = resolveArtifact(
    dirname(declared),
    basename(declared),
    CORPUS_LIMITS.maxDocumentBytes
  );
  const bytes = await readFile(path);
  const value = JSON.parse(bytes.toString('utf8'));
  const errors = validateContract('agent-adapter', value);
  if (errors.length > 0) throw new Error(`invalid agent adapter:\n${errors.join('\n')}`);
  if (value.schema_version !== CONTRACT_SCHEMA_VERSIONS['agent-adapter-v2']) {
    throw new Error('execution requires a v2 agent adapter');
  }
  const root = dirname(path);
  for (const artifact of value.artifacts) {
    const artifactPath = resolveArtifact(root, artifact.path, CORPUS_LIMITS.maxArtifactBytes);
    const artifactBytes = await readFile(artifactPath);
    if (sha256Bytes(artifactBytes) !== artifact.sha256) {
      throw new Error(`adapter artifact SHA-256 mismatch: ${artifact.path}`);
    }
  }
  return { value, path, root, sha256: sha256Bytes(bytes) };
}

export async function loadAdapterDiagnostics({ workspace, path, secretValues = [] } = {}) {
  const diagnosticsPath = resolveArtifact(workspace, path, CORPUS_LIMITS.maxDocumentBytes);
  const bytes = await readFile(diagnosticsPath);
  const text = bytes.toString('utf8');
  for (const secret of secretValues.filter(
    (value) => typeof value === 'string' && value.length > 0
  )) {
    if (text.includes(secret)) {
      throw new Error('adapter diagnostics contain a declared environment value');
    }
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error('adapter diagnostics are not valid JSON');
  }
  const errors = validateContract('adapter-diagnostics', document);
  if (errors.length > 0) {
    throw new Error(`invalid adapter diagnostics:\n${errors.join('\n')}`);
  }
  const diagnostics = {};
  for (const field of [
    'input_tokens',
    'output_tokens',
    'cached_input_tokens',
    'reasoning_tokens',
    'tool_result_tokens',
    'tool_calls_total',
    'tool_elapsed_ms',
    'model_elapsed_ms',
    'cost_usd',
  ]) {
    if (document[field] !== undefined) diagnostics[field] = document[field];
  }
  if (document.tool_calls !== undefined) {
    diagnostics.tool_calls = [
      ...new Set(document.tool_calls.map((value) => redactText(value, []))),
    ].sort();
  }
  for (const field of ['files_inspected', 'files_modified']) {
    if (document[field] !== undefined) diagnostics[field] = [...document[field]];
  }
  return diagnostics;
}

async function consumeAdapterDiagnostics(options) {
  const diagnostics = await loadAdapterDiagnostics(options);
  const diagnosticsPath = resolveArtifact(
    options.workspace,
    options.path,
    CORPUS_LIMITS.maxDocumentBytes
  );
  await rm(diagnosticsPath);
  return diagnostics;
}

export async function runAdapterProcess({
  command,
  cwd,
  environment,
  timeoutMs,
  signal,
  onStarted,
  sampleResources = sampleProcessTree,
  resourceSampleIntervalMs = 100,
}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      detached: process.platform !== 'win32',
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const resourceSampler = createProcessTreeSampler(child.pid, {
      sampleResources,
      intervalMs: resourceSampleIntervalMs,
    });
    onStarted?.();
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let requestedStatus = null;
    let settled = false;
    let escalation = null;

    const capture = (chunks, currentBytes, chunk) => {
      const remaining = MAX_OUTPUT_BYTES - currentBytes;
      if (remaining <= 0) {
        truncated = true;
        return currentBytes;
      }
      chunks.push(chunk.subarray(0, remaining));
      if (chunk.length > remaining) truncated = true;
      return currentBytes + Math.min(chunk.length, remaining);
    };
    child.stdout.on('data', (chunk) => {
      stdoutBytes = capture(stdout, stdoutBytes, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes = capture(stderr, stderrBytes, chunk);
    });

    const terminate = (status) => {
      if (requestedStatus !== null) return;
      requestedStatus = status;
      terminateProcessGroup(child, 'SIGTERM');
      escalation = setTimeout(() => terminateProcessGroup(child, 'SIGKILL'), 250);
      escalation.unref?.();
    };
    const timer = setTimeout(() => terminate('timeout'), timeoutMs);
    timer.unref?.();
    const abort = () => terminate('cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();

    const finish = async (code, spawnError = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (requestedStatus !== null) terminateProcessGroup(child, 'SIGKILL');
      if (escalation) clearTimeout(escalation);
      signal?.removeEventListener('abort', abort);
      const status = requestedStatus ?? (spawnError || code !== 0 ? 'failed' : 'exited');
      const resources = await resourceSampler.stop();
      resolvePromise({
        status,
        exitCode: status === 'exited' || status === 'failed' ? code : null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        truncated,
        resources,
      });
    };
    child.once('error', () => void finish(null, true));
    child.once('close', (code) => void finish(code));
  });
}

export function sampleProcessTree(rootPid) {
  if (!Number.isInteger(rootPid) || rootPid <= 0 || process.platform === 'win32') {
    return Promise.reject(new Error('process-tree sampling is unavailable'));
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('ps', ['-axo', 'pid=,ppid=,rss=,time='], {
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`ps exited with ${code}`));
        return;
      }
      const rows = Buffer.concat(chunks)
        .toString('utf8')
        .split('\n')
        .map(parseProcessRow)
        .filter(Boolean);
      const descendants = new Set([rootPid]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of rows) {
          if (descendants.has(row.ppid) && !descendants.has(row.pid)) {
            descendants.add(row.pid);
            changed = true;
          }
        }
      }
      const tree = rows.filter((row) => descendants.has(row.pid));
      if (tree.length === 0) {
        rejectPromise(new Error('agent process tree was not present in the sample'));
        return;
      }
      resolvePromise({
        rssBytes: tree.reduce((sum, row) => sum + row.rssBytes, 0),
        cpuTimeMs: tree.reduce((sum, row) => sum + row.cpuTimeMs, 0),
      });
    });
  });
}

function createTelemetryRecorder(now) {
  const origin = now();
  const events = [];
  let active = null;
  return {
    start(name) {
      if (active !== null) throw new Error('telemetry phases cannot overlap');
      active = { name, startedAt: now(), finished: false };
      return active;
    },
    finish(event, outcome) {
      if (event?.finished || active !== event) return;
      event.finished = true;
      event.finishedAt = now();
      event.outcome = outcome;
      events.push(event);
      active = null;
    },
    document(resources) {
      if (active !== null) this.finish(active, 'failed');
      let cursor = 0;
      const normalized = events.map((event, index) => {
        const startOffset = Math.max(cursor, roundedMilliseconds(event.startedAt - origin));
        const duration = roundedMilliseconds(event.finishedAt - event.startedAt);
        cursor = startOffset + duration;
        return {
          sequence: index + 1,
          name: event.name,
          start_offset_ms: startOffset,
          duration_ms: duration,
          outcome: event.outcome,
        };
      });
      return {
        schema_version: CONTRACT_SCHEMA_VERSIONS['run-telemetry'],
        clock: 'monotonic',
        elapsed_ms: Math.max(cursor, roundedMilliseconds(now() - origin)),
        events: normalized,
        resources,
      };
    },
  };
}

function agentPhaseOutcome(status) {
  return status === 'exited' ? 'complete' : 'failed';
}

function checkPhaseOutcome(kind) {
  return kind === 'result' ? 'complete' : 'failed';
}

function createProcessTreeSampler(rootPid, { sampleResources, intervalMs }) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    return { stop: async () => unavailableResources('The adapter process did not start.') };
  }
  let stopped = false;
  let sampleCount = 0;
  let peakRssBytes = 0;
  let cpuTimeMs = 0;
  let samplingFailed = false;
  let sampleInFlight = false;
  let pending = Promise.resolve();
  const sample = () => {
    if (stopped || sampleInFlight) return;
    sampleInFlight = true;
    pending = Promise.resolve()
      .then(() => sampleResources(rootPid))
      .then((value) => {
        sampleCount += 1;
        peakRssBytes = Math.max(peakRssBytes, roundedMilliseconds(value.rssBytes));
        cpuTimeMs = Math.max(cpuTimeMs, roundedMilliseconds(value.cpuTimeMs));
      })
      .catch(() => {
        samplingFailed = true;
      })
      .finally(() => {
        sampleInFlight = false;
      });
  };
  sample();
  const timer = setInterval(sample, intervalMs);
  timer.unref?.();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await pending;
      if (sampleCount === 0) {
        return unavailableResources(
          'No process-tree resource sample completed before termination.'
        );
      }
      return {
        scope: 'agent-process-tree',
        sampler: 'ps-process-tree-v1',
        sample_count: sampleCount,
        peak_rss_bytes: peakRssBytes,
        cpu_time_ms: cpuTimeMs,
        io_read_bytes: null,
        io_write_bytes: null,
        network_rx_bytes: null,
        network_tx_bytes: null,
        thermal_state: null,
        limitations: [
          'RSS and CPU time are sampled from the adapter process tree and may miss short-lived descendants.',
          'Process I/O, network use, external provider daemons, and thermal state are not measured.',
          ...(samplingFailed ? ['One or more process-tree samples failed.'] : []),
        ],
      };
    },
  };
}

function unavailableResources(reason) {
  return {
    scope: 'agent-process-tree',
    sampler: 'unavailable',
    sample_count: 0,
    peak_rss_bytes: null,
    cpu_time_ms: null,
    io_read_bytes: null,
    io_write_bytes: null,
    network_rx_bytes: null,
    network_tx_bytes: null,
    thermal_state: null,
    limitations: [
      reason,
      'Process I/O, network use, external provider daemons, and thermal state are not measured.',
    ],
  };
}

function normalizeResources(value) {
  if (value === undefined) {
    return unavailableResources('The adapter process did not expose sampled resource evidence.');
  }
  const errors = [];
  validateResourceShape(value, errors);
  return errors.length === 0
    ? structuredClone(value)
    : unavailableResources('The adapter process returned invalid sampled resource evidence.');
}

function validateResourceShape(value, errors) {
  const telemetry = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['run-telemetry'],
    clock: 'monotonic',
    elapsed_ms: 0,
    events: [
      {
        sequence: 1,
        name: 'agent_execute',
        start_offset_ms: 0,
        duration_ms: 0,
        outcome: 'complete',
      },
    ],
    resources: value,
  };
  errors.push(...validateContract('run-telemetry', telemetry));
}

function parseProcessRow(line) {
  const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.-]+)\s*$/.exec(line);
  if (!match) return null;
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    rssBytes: Number(match[3]) * 1024,
    cpuTimeMs: parseCpuTime(match[4]),
  };
}

function parseCpuTime(value) {
  const dayParts = value.split('-');
  const days = dayParts.length === 2 ? Number(dayParts[0]) : 0;
  const clock = dayParts.at(-1).split(':').map(Number);
  const seconds = clock.pop() ?? 0;
  const minutes = clock.pop() ?? 0;
  const hours = clock.pop() ?? 0;
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

function monotonicMilliseconds() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function roundedMilliseconds(value) {
  return Math.max(0, Math.round(value));
}

function resolveAdapterCommand(adapter, workspace) {
  const replacements = new Map([
    ['{node}', process.execPath],
    ['{adapter_root}', adapter.root],
    ['{workspace}', workspace],
    ['{task_packet}', join(workspace, 'TASK.md')],
  ]);
  return adapter.value.command.map((argument) => {
    let resolved = argument;
    for (const [placeholder, value] of replacements) {
      resolved = resolved.split(placeholder).join(value);
    }
    if (/\{[^}]+\}/.test(resolved)) throw new Error(`unresolved command placeholder: ${argument}`);
    return resolved;
  });
}

function normalizeAgentOutput(execution, secretValues) {
  const stdout = boundText(redactText(execution.stdout ?? '', secretValues));
  const stderr = boundText(redactText(execution.stderr ?? '', secretValues));
  const outputTruncated = Boolean(execution.truncated) || stdout.truncated || stderr.truncated;
  const status = ['exited', 'failed', 'cancelled', 'timeout', 'not_started'].includes(
    execution.status
  )
    ? execution.status
    : 'failed';
  const exitCode =
    (status === 'exited' || status === 'failed') && Number.isInteger(execution.exitCode)
      ? execution.exitCode
      : null;
  return {
    agent: {
      status,
      exit_code: exitCode,
      stdout_sha256: sha256Bytes(Buffer.from(stdout.text)),
      stderr_sha256: sha256Bytes(Buffer.from(stderr.text)),
      stdout_bytes: Buffer.byteLength(stdout.text),
      stderr_bytes: Buffer.byteLength(stderr.text),
      output_truncated: outputTruncated,
    },
    output: { stdout: stdout.text, stderr: stderr.text },
  };
}

function redactText(value, secretValues) {
  let redacted = String(value).replace(
    /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*)=([^\s]+)/gi,
    '$1=[REDACTED]'
  );
  for (const secret of secretValues.filter((item) => typeof item === 'string' && item.length > 0)) {
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

function boundText(value) {
  const bytes = Buffer.from(value);
  if (bytes.length <= MAX_OUTPUT_BYTES) return { text: value, truncated: false };
  let text = bytes.subarray(0, MAX_OUTPUT_BYTES).toString('utf8');
  while (Buffer.byteLength(text) > MAX_OUTPUT_BYTES) text = text.slice(0, -1);
  return {
    text,
    truncated: true,
  };
}

function emptyAgentResult() {
  return {
    status: 'not_started',
    exit_code: null,
    stdout_sha256: EMPTY_SHA256,
    stderr_sha256: EMPTY_SHA256,
    stdout_bytes: 0,
    stderr_bytes: 0,
    output_truncated: false,
  };
}

function classifyRunChecks(results, acceptance) {
  const required = acceptance.required_checks.map((check) => check.id);
  const regression = acceptance.regression_checks.map((check) => check.id);
  const expected = [...required, ...regression].sort();
  const actual = results.map((check) => check.id).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) return 'incomplete_checks';
  const byId = new Map(results.map((check) => [check.id, check.status]));
  if (results.some((check) => check.status === 'error')) return 'check_error';
  if (regression.some((id) => byId.get(id) !== 'pass')) return 'regression';
  if (required.some((id) => byId.get(id) !== 'pass')) return 'check_failure';
  return 'success';
}

function terminateProcessGroup(child, signal) {
  try {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process already reached a terminal state.
    }
  }
}

async function removeRunWorkspace(workspace) {
  await rm(workspace, { force: true, recursive: true });
}

function roundCostUp(value) {
  return Math.ceil(value * 1_000_000) / 1_000_000;
}
