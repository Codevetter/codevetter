#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import {
  planContextProviderExperiment,
  writeContextProviderPlan,
} from './context-provider-plan.mjs';

export async function runContextProviderPlanCli(args = process.argv.slice(2)) {
  const wantsJson = args.includes('--json');
  try {
    const options = parseArgs(args);
    const plan = await planContextProviderExperiment({
      root: options.root,
      corpusRoot: options.corpusRoot,
      probePaths: options.probePaths,
      stage: options.stage,
      aaRepetitions: options.aaRepetitions,
      availableEnvironmentNames: Object.keys(process.env),
    });
    if (options.out) await writeContextProviderPlan(options.out, plan);
    return {
      exitCode: 0,
      output: wantsJson ? `${JSON.stringify(plan)}\n` : humanOutput(plan, options.out),
      plan,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 2,
      output: wantsJson
        ? `${JSON.stringify({ error: detail })}\n`
        : `Context-provider planning failed: ${detail}\n`,
      plan: null,
    };
  }
}

function parseArgs(args) {
  const options = {
    root: process.cwd(),
    corpusRoot: 'benchmarks/agent-tasks/sample',
    probePaths: [],
    stage: 'feasibility',
    aaRepetitions: undefined,
    out: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') continue;
    if (
      ['--root', '--corpus-root', '--probe', '--stage', '--aa-repetitions', '--out'].includes(
        argument
      )
    ) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--root') options.root = value;
      if (argument === '--corpus-root') options.corpusRoot = value;
      if (argument === '--probe') options.probePaths.push(value);
      if (argument === '--stage') options.stage = value;
      if (argument === '--aa-repetitions') options.aaRepetitions = parseRepetitions(value);
      if (argument === '--out') options.out = value;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  if (options.probePaths.length === 0) throw new Error('at least one --probe is required');
  return options;
}

function parseRepetitions(value) {
  if (!/^\d+$/.test(value)) throw new Error('--aa-repetitions requires a non-negative integer');
  return Number.parseInt(value, 10);
}

function humanOutput(plan, outputPath) {
  const lines = [
    `Plan: ${plan.plan_id}`,
    `Stage: ${plan.stage}`,
    `Providers: ${plan.providers.map((provider) => provider.provider_id).join(', ')}`,
    `Tasks: ${plan.counts.tasks}`,
    `Repetitions: ${plan.counts.repetitions}`,
    `A/A repetitions: ${plan.aa_repetitions ?? 0}`,
    `Attempts: ${plan.counts.attempts}${
      plan.counts.aa_attempts === undefined
        ? ''
        : ` (${plan.counts.ab_attempts} A/B + ${plan.counts.aa_attempts} A/A)`
    }`,
    `Context maximum: $${plan.cost.context_max_usd.toFixed(6)}`,
    `Total cost posture: ${plan.cost.posture}`,
    `Approval: ${plan.approvals.approval_id}`,
    `Paid approval required: ${plan.approvals.paid_required ? 'yes' : 'no'}`,
    `Hosted approval required: ${plan.approvals.hosted_required ? 'yes' : 'no'}`,
    `Data-egress approval required: ${plan.approvals.data_egress_required ? 'yes' : 'no'}`,
    `Blocked: ${plan.blocked_reasons.length > 0 ? plan.blocked_reasons.join(', ') : 'no'}`,
  ];
  if (outputPath) lines.push(`Artifact: ${outputPath}`);
  return `${lines.join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runContextProviderPlanCli();
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
}
