import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { sha256Bytes } from './contracts.mjs';
import { runAgentTaskCli } from './run-cli.mjs';
import { executeAgentTask, planAgentTask, runAdapterProcess } from './run-task.mjs';

const SAMPLE_ROOT = resolve('benchmarks/agent-tasks/sample');
const ADAPTER_PATH = resolve('benchmarks/agent-tasks/sample/adapters/synthetic-false-fix.json');
const TASK_ID = 'preserve-explicit-false';
const ENVIRONMENT = { FIXTURE_TOKEN: 'synthetic-secret' };

async function copyAdapter(t, mutate) {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-runner-adapter-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  await cp(resolve('benchmarks/agent-tasks/sample/adapters'), directory, { recursive: true });
  const path = join(directory, 'synthetic-false-fix.json');
  const value = JSON.parse(await readFile(path, 'utf8'));
  mutate(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function passingChecks(acceptanceSha256) {
  return {
    kind: 'result',
    result: {
      schema_version: 'codevetter.agent-task-check-result.v1',
      task_id: TASK_ID,
      acceptance_contract_sha256: acceptanceSha256,
      results: [
        { id: 'explicit-false-preserved', status: 'pass' },
        { id: 'label-preserved', status: 'pass' },
        { id: 'public-inputs-only', status: 'pass' },
      ],
    },
  };
}

function adapterDiagnostics(overrides = {}) {
  return {
    schema_version: 'codevetter.agent-task-diagnostics.v1',
    input_tokens: 120,
    output_tokens: 40,
    cost_usd: 0.002,
    tool_calls: ['apply_patch', 'read_file'],
    files_inspected: ['TASK.md', 'transformer.mjs'],
    files_modified: ['transformer.mjs'],
    ...overrides,
  };
}

test('creates a deterministic non-executing plan with conservative bounds', async () => {
  const options = {
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath: ADAPTER_PATH,
    availableEnvironmentNames: ['FIXTURE_TOKEN'],
  };
  const first = await planAgentTask(options);
  const second = await planAgentTask(options);

  assert.deepEqual(second, first);
  assert.match(first.plan_id, /^plan-[a-f0-9]{32}$/);
  assert.equal(first.filtered_input_bytes, 327);
  assert.equal(first.estimated_input_tokens, 146);
  assert.equal(first.estimated_max_cost_usd, 0);
  assert.equal(first.approval.launch_required, true);
  assert.equal(first.approval.paid_required, false);
  assert.deepEqual(first.blocked_reasons, []);
  assert.deepEqual(first.command, [
    '{node}',
    '{adapter_root}/synthetic-false-fix.mjs',
    '{workspace}',
  ]);
});

test('blocks missing environment, stale approval, paid approval, and cost overflow', async (t) => {
  const missing = await planAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath: ADAPTER_PATH,
  });
  assert.deepEqual(missing.blocked_reasons, ['missing-environment:FIXTURE_TOKEN']);

  const current = await planAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath: ADAPTER_PATH,
    availableEnvironmentNames: ['FIXTURE_TOKEN'],
  });
  await assert.rejects(
    executeAgentTask({
      root: SAMPLE_ROOT,
      taskId: TASK_ID,
      adapterPath: ADAPTER_PATH,
      environment: ENVIRONMENT,
      approvePlanId: 'plan-stale',
    }),
    /launch approval must name current plan/
  );

  const paidPath = await copyAdapter(t, (adapter) => {
    adapter.cost_posture = 'paid';
    adapter.planning.input_usd_per_million = 1;
    adapter.planning.output_usd_per_million = 1;
    adapter.planning.max_cost_usd = 1;
  });
  const paid = await planAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath: paidPath,
    availableEnvironmentNames: ['FIXTURE_TOKEN'],
  });
  assert.equal(paid.approval.paid_required, true);
  await assert.rejects(
    executeAgentTask({
      root: SAMPLE_ROOT,
      taskId: TASK_ID,
      adapterPath: paidPath,
      environment: ENVIRONMENT,
      approvePlanId: paid.plan_id,
    }),
    /separate paid approval/
  );

  const overCostPath = await copyAdapter(t, (adapter) => {
    adapter.cost_posture = 'paid';
    adapter.planning.input_usd_per_million = 100_000;
    adapter.planning.output_usd_per_million = 100_000;
    adapter.planning.max_cost_usd = 0;
  });
  const overCost = await planAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath: overCostPath,
    availableEnvironmentNames: ['FIXTURE_TOKEN'],
  });
  assert.equal(overCost.within_cost_limit, false);
  assert.deepEqual(overCost.blocked_reasons, ['cost-limit-exceeded']);
  await assert.rejects(
    executeAgentTask({
      root: SAMPLE_ROOT,
      taskId: TASK_ID,
      adapterPath: overCostPath,
      environment: ENVIRONMENT,
      approvePlanId: overCost.plan_id,
      approvePaid: true,
    }),
    /execution is blocked: cost-limit-exceeded/
  );
  assert.equal(current.blocked_reasons.length, 0);
});

test('runs the immutable synthetic adapter before hidden checks and redacts output', async () => {
  const plan = await planAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath: ADAPTER_PATH,
    availableEnvironmentNames: ['FIXTURE_TOKEN'],
  });
  const result = await executeAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath: ADAPTER_PATH,
    environment: ENVIRONMENT,
    approvePlanId: plan.plan_id,
    runIdFactory: () => 'run-synthetic-success',
  });

  assert.equal(result.receipt.terminal_status, 'success');
  assert.deepEqual(result.receipt.lifecycle, [
    'workspace_prepared',
    'agent_started',
    'agent_terminated',
    'checks_started',
    'checks_finished',
    'cleanup_complete',
  ]);
  assert.equal(result.receipt.agent.status, 'exited');
  assert.equal(result.receipt.agent.exit_code, 0);
  assert.equal(result.receipt.regression_count, 0);
  assert.ok(result.receipt.checks.every((check) => check.status === 'pass'));
  assert.match(result.output.stdout, /FIXTURE_TOKEN=\[REDACTED\]/);
  assert.doesNotMatch(result.output.stdout, /synthetic-secret/);
  assert.doesNotMatch(JSON.stringify(result.receipt), /synthetic-secret|codevetter-agent-task-/);
});

test('captures declared bounded diagnostics before hidden checks', async (t) => {
  const adapterPath = await copyAdapter(t, (adapter) => {
    adapter.diagnostics_path = 'adapter-diagnostics.json';
  });
  const plan = await planAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath,
    availableEnvironmentNames: ['FIXTURE_TOKEN'],
  });
  let checksStarted = false;
  const result = await executeAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath,
    environment: ENVIRONMENT,
    approvePlanId: plan.plan_id,
    runAdapter: async ({ cwd, onStarted }) => {
      onStarted();
      await writeFile(
        join(cwd, 'adapter-diagnostics.json'),
        `${JSON.stringify(adapterDiagnostics())}\n`
      );
      return {
        status: 'exited',
        exitCode: 0,
        stdout: '',
        stderr: '',
        truncated: false,
      };
    },
    executeDriver: async ({ acceptanceSha256 }) => {
      checksStarted = true;
      return passingChecks(acceptanceSha256);
    },
    runIdFactory: () => 'run-with-diagnostics',
  });

  assert.equal(result.receipt.terminal_status, 'success');
  assert.equal(checksStarted, true);
  assert.deepEqual(result.receipt.diagnostics, {
    input_tokens: 120,
    output_tokens: 40,
    cost_usd: 0.002,
    tool_calls: ['apply_patch', 'read_file'],
    files_inspected: ['TASK.md', 'transformer.mjs'],
    files_modified: ['transformer.mjs'],
  });
  assert.doesNotMatch(JSON.stringify(result.receipt), /adapter-diagnostics\.json/);
});

test('fails closed before checks when declared diagnostics are invalid', async (t) => {
  for (const [name, document] of [
    ['missing', null],
    ['unknown-field', adapterDiagnostics({ raw_response: 'forbidden' })],
    ['declared-secret', adapterDiagnostics({ tool_calls: ['synthetic-secret'] })],
  ]) {
    const adapterPath = await copyAdapter(t, (adapter) => {
      adapter.diagnostics_path = 'adapter-diagnostics.json';
    });
    const plan = await planAgentTask({
      root: SAMPLE_ROOT,
      taskId: TASK_ID,
      adapterPath,
      availableEnvironmentNames: ['FIXTURE_TOKEN'],
    });
    let checksStarted = false;
    const result = await executeAgentTask({
      root: SAMPLE_ROOT,
      taskId: TASK_ID,
      adapterPath,
      environment: ENVIRONMENT,
      approvePlanId: plan.plan_id,
      runAdapter: async ({ cwd, onStarted }) => {
        onStarted();
        if (document !== null) {
          await writeFile(join(cwd, 'adapter-diagnostics.json'), `${JSON.stringify(document)}\n`);
        }
        return {
          status: 'exited',
          exitCode: 0,
          stdout: '',
          stderr: '',
          truncated: false,
        };
      },
      executeDriver: async ({ acceptanceSha256 }) => {
        checksStarted = true;
        return passingChecks(acceptanceSha256);
      },
      runIdFactory: () => `run-invalid-diagnostics-${name}`,
    });
    assert.equal(result.receipt.terminal_status, 'agent_failure');
    assert.equal(result.receipt.diagnostics, undefined);
    assert.equal(checksStarted, false);
    assert.equal(result.receipt.lifecycle.includes('checks_started'), false);
    assert.match(result.receipt.limitations.at(-1), /diagnostics were unavailable or invalid/);
    assert.doesNotMatch(JSON.stringify(result.receipt), /synthetic-secret/);
  }
});

test('retains valid diagnostics from a failed adapter exit', async (t) => {
  const adapterPath = await copyAdapter(t, (adapter) => {
    adapter.diagnostics_path = 'adapter-diagnostics.json';
  });
  const plan = await planAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath,
    availableEnvironmentNames: ['FIXTURE_TOKEN'],
  });
  const result = await executeAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath,
    environment: ENVIRONMENT,
    approvePlanId: plan.plan_id,
    runAdapter: async ({ cwd, onStarted }) => {
      onStarted();
      await writeFile(
        join(cwd, 'adapter-diagnostics.json'),
        `${JSON.stringify(adapterDiagnostics({ output_tokens: 12 }))}\n`
      );
      return {
        status: 'failed',
        exitCode: 2,
        stdout: '',
        stderr: 'provider failed',
        truncated: false,
      };
    },
    runIdFactory: () => 'run-failed-with-diagnostics',
  });

  assert.equal(result.receipt.terminal_status, 'agent_failure');
  assert.equal(result.receipt.diagnostics.output_tokens, 12);
  assert.equal(result.receipt.lifecycle.includes('checks_started'), false);
});

test('skips hidden checks after failure or timeout and preserves cleanup', async () => {
  const plan = await planAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath: ADAPTER_PATH,
    availableEnvironmentNames: ['FIXTURE_TOKEN'],
  });
  for (const [status, expected] of [
    ['failed', 'agent_failure'],
    ['timeout', 'timeout'],
    ['cancelled', 'cancelled'],
  ]) {
    let checksStarted = false;
    const result = await executeAgentTask({
      root: SAMPLE_ROOT,
      taskId: TASK_ID,
      adapterPath: ADAPTER_PATH,
      environment: ENVIRONMENT,
      approvePlanId: plan.plan_id,
      runAdapter: async ({ onStarted }) => {
        onStarted();
        return {
          status,
          exitCode: status === 'failed' ? 2 : null,
          stdout: '',
          stderr: '',
          truncated: false,
        };
      },
      executeDriver: async () => {
        checksStarted = true;
        return passingChecks('a'.repeat(64));
      },
      runIdFactory: () => `run-${status}`,
    });
    assert.equal(result.receipt.terminal_status, expected);
    assert.equal(checksStarted, false);
    assert.equal(result.receipt.cleanup.status, 'complete');
    assert.equal(result.receipt.lifecycle.includes('checks_started'), false);
  }
});

test('starts exact checks only after termination and classifies regression', async () => {
  const plan = await planAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath: ADAPTER_PATH,
    availableEnvironmentNames: ['FIXTURE_TOKEN'],
  });
  let terminated = false;
  const result = await executeAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath: ADAPTER_PATH,
    environment: ENVIRONMENT,
    approvePlanId: plan.plan_id,
    runAdapter: async ({ onStarted }) => {
      onStarted();
      terminated = true;
      return { status: 'exited', exitCode: 0, stdout: '', stderr: '', truncated: false };
    },
    executeDriver: async ({ acceptanceSha256 }) => {
      assert.equal(terminated, true);
      const evidence = passingChecks(acceptanceSha256);
      evidence.result.results[1].status = 'fail';
      return evidence;
    },
    runIdFactory: () => 'run-regression',
  });

  assert.equal(result.receipt.terminal_status, 'regression');
  assert.equal(result.receipt.regression_count, 1);
  assert.ok(
    result.receipt.lifecycle.indexOf('agent_terminated') <
      result.receipt.lifecycle.indexOf('checks_started')
  );
});

test('classifies incomplete checks, required failures, and check errors distinctly', async () => {
  const plan = await planAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath: ADAPTER_PATH,
    availableEnvironmentNames: ['FIXTURE_TOKEN'],
  });
  const cases = [
    [
      'incomplete_checks',
      async ({ acceptanceSha256 }) => {
        const evidence = passingChecks(acceptanceSha256);
        evidence.result.results.pop();
        return evidence;
      },
    ],
    [
      'check_failure',
      async ({ acceptanceSha256 }) => {
        const evidence = passingChecks(acceptanceSha256);
        evidence.result.results[0].status = 'fail';
        return evidence;
      },
    ],
    [
      'check_error',
      async () => {
        throw new Error('injected check-driver failure');
      },
    ],
  ];
  for (const [expected, executeDriver] of cases) {
    const result = await executeAgentTask({
      root: SAMPLE_ROOT,
      taskId: TASK_ID,
      adapterPath: ADAPTER_PATH,
      environment: ENVIRONMENT,
      approvePlanId: plan.plan_id,
      runAdapter: async ({ onStarted }) => {
        onStarted();
        return { status: 'exited', exitCode: 0, stdout: '', stderr: '', truncated: false };
      },
      executeDriver,
      runIdFactory: () => `run-${expected.replaceAll('_', '-')}`,
    });
    assert.equal(result.receipt.terminal_status, expected);
  }
});

test('bounds redacted output and preserves cleanup failure', async () => {
  const plan = await planAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath: ADAPTER_PATH,
    availableEnvironmentNames: ['FIXTURE_TOKEN'],
  });
  const result = await executeAgentTask({
    root: SAMPLE_ROOT,
    taskId: TASK_ID,
    adapterPath: ADAPTER_PATH,
    environment: ENVIRONMENT,
    approvePlanId: plan.plan_id,
    runAdapter: async ({ onStarted }) => {
      onStarted();
      return {
        status: 'exited',
        exitCode: 0,
        stdout: `FIXTURE_TOKEN=synthetic-secret\n${'x'.repeat(300_000)}`,
        stderr: '',
        truncated: false,
      };
    },
    executeDriver: async ({ acceptanceSha256 }) => passingChecks(acceptanceSha256),
    removeWorkspace: async (workspace) => {
      await rm(workspace, { force: true, recursive: true });
      throw new Error('injected cleanup failure');
    },
    runIdFactory: () => 'run-cleanup-failure',
  });

  assert.equal(result.receipt.terminal_status, 'cleanup_failure');
  assert.equal(result.receipt.cleanup.status, 'failed');
  assert.equal(result.receipt.agent.output_truncated, true);
  assert.ok(result.receipt.agent.stdout_bytes <= 262_144);
  assert.doesNotMatch(result.output.stdout, /synthetic-secret/);
});

test('terminates a real adapter process on timeout and cancellation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-runner-process-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const script = join(directory, 'slow.mjs');
  await writeFile(script, 'setInterval(() => {}, 1000);\n');
  const command = [process.execPath, script];

  const timeout = await runAdapterProcess({
    command,
    cwd: directory,
    environment: {},
    timeoutMs: 20,
  });
  assert.equal(timeout.status, 'timeout');

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  const cancelled = await runAdapterProcess({
    command,
    cwd: directory,
    environment: {},
    timeoutMs: 5_000,
    signal: controller.signal,
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(sha256Bytes(Buffer.from(cancelled.stdout)), sha256Bytes(Buffer.alloc(0)));
});

test('CLI plans first and executes only with the exact explicit approval', async (t) => {
  const previous = process.env.FIXTURE_TOKEN;
  process.env.FIXTURE_TOKEN = 'cli-synthetic-secret';
  t.after(() => {
    if (previous === undefined) delete process.env.FIXTURE_TOKEN;
    else process.env.FIXTURE_TOKEN = previous;
  });
  const common = ['--root', SAMPLE_ROOT, '--task', TASK_ID, '--adapter', ADAPTER_PATH, '--json'];
  const planned = await runAgentTaskCli(common);
  assert.equal(planned.exitCode, 0);
  const plan = JSON.parse(planned.output);

  const rejected = await runAgentTaskCli([...common, '--execute']);
  assert.equal(rejected.exitCode, 2);
  assert.match(JSON.parse(rejected.output).error, /launch approval/);

  const executed = await runAgentTaskCli([...common, '--execute', '--approve-plan', plan.plan_id]);
  assert.equal(executed.exitCode, 0);
  const result = JSON.parse(executed.output);
  assert.equal(result.receipt.terminal_status, 'success');
  assert.doesNotMatch(JSON.stringify(result), /cli-synthetic-secret/);
});
