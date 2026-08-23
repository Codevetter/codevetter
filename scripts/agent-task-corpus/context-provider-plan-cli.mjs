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

// Flags as a table. The if-chain this replaces was already above the repository's
// complexity ceiling at 25 and this change pushed it to 28; a table keeps each flag's
// destination and parser next to its name, so adding one costs no complexity at all.
const VALUE_FLAGS = {
  '--root': (options, value) => {
    options.root = value;
  },
  '--corpus-root': (options, value) => {
    options.corpusRoot = value;
  },
  '--probe': (options, value) => {
    options.probePaths.push(value);
  },
  '--stage': (options, value) => {
    options.stage = value;
  },
  '--aa-repetitions': (options, value) => {
    options.aaRepetitions = parseRepetitions(value);
  },
  '--out': (options, value) => {
    options.out = value;
  },
};

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
    const flag = args[index];
    if (flag === '--json') continue;
    const apply = VALUE_FLAGS[flag];
    if (!apply) throw new Error(`unknown argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    index += 1;
    apply(options, value);
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
