#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { executeAgentTask, planAgentTask, writeRunReceipt } from './run-task.mjs';

export async function runAgentTaskCli(args = process.argv.slice(2)) {
  const wantsJson = args.includes('--json');
  try {
    const options = parseArgs(args);
    const availableEnvironmentNames = Object.keys(process.env);
    const plan = await planAgentTask({
      root: options.root,
      taskId: options.taskId,
      adapterPath: options.adapterPath,
      availableEnvironmentNames,
    });
    if (!options.execute) {
      return {
        exitCode: 0,
        output: wantsJson ? `${JSON.stringify(plan)}\n` : planOutput(plan),
        plan,
        receipt: null,
      };
    }
    const environment = {};
    for (const entry of plan.environment) {
      if (entry.available) environment[entry.name] = process.env[entry.name];
    }
    const result = await executeAgentTask({
      root: options.root,
      taskId: options.taskId,
      adapterPath: options.adapterPath,
      environment,
      approvePlanId: options.approvePlanId,
      approvePaid: options.approvePaid,
    });
    if (options.out) await writeRunReceipt(options.out, result.receipt);
    const rendered = wantsJson ? `${JSON.stringify(result)}\n` : runOutput(result, options.out);
    return {
      ...result,
      operatorOutput: result.output,
      exitCode: result.receipt.terminal_status === 'success' ? 0 : 1,
      output: rendered,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 2,
      output: wantsJson
        ? `${JSON.stringify({ error: message })}\n`
        : `Agent-task runner failed: ${message}\n`,
      plan: null,
      receipt: null,
    };
  }
}

function parseArgs(args) {
  const options = {
    root: undefined,
    taskId: undefined,
    adapterPath: undefined,
    approvePlanId: undefined,
    out: undefined,
    execute: false,
    approvePaid: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') continue;
    if (argument === '--execute') {
      options.execute = true;
      continue;
    }
    if (argument === '--approve-paid') {
      options.approvePaid = true;
      continue;
    }
    if (['--root', '--task', '--adapter', '--approve-plan', '--out'].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--root') options.root = value;
      if (argument === '--task') options.taskId = value;
      if (argument === '--adapter') options.adapterPath = value;
      if (argument === '--approve-plan') options.approvePlanId = value;
      if (argument === '--out') options.out = value;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  if (!options.taskId) throw new Error('--task is required');
  if (!options.adapterPath) throw new Error('--adapter is required');
  return options;
}

function planOutput(plan) {
  const lines = [
    `Plan: ${plan.plan_id}`,
    `Task: ${plan.task_id}`,
    `Cost posture: ${plan.cost_posture}`,
    `Estimated maximum cost: $${plan.estimated_max_cost_usd.toFixed(6)}`,
    `Cost limit: $${plan.max_cost_usd.toFixed(6)}`,
    `Launch approval required: yes`,
    `Paid approval required: ${plan.approval.paid_required ? 'yes' : 'no'}`,
    `Blocked: ${plan.blocked_reasons.length > 0 ? plan.blocked_reasons.join(', ') : 'no'}`,
  ];
  return `${lines.join('\n')}\n`;
}

function runOutput(result, outputPath) {
  const lines = [
    `Run: ${result.receipt.run_id}`,
    `Plan: ${result.plan.plan_id}`,
    `Status: ${result.receipt.terminal_status}`,
    `Cleanup: ${result.receipt.cleanup.status}`,
  ];
  if (result.output.stdout) lines.push(`Stdout:\n${result.output.stdout.trimEnd()}`);
  if (result.output.stderr) lines.push(`Stderr:\n${result.output.stderr.trimEnd()}`);
  if (outputPath) lines.push(`Receipt: ${outputPath}`);
  return `${lines.join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runAgentTaskCli();
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
}
