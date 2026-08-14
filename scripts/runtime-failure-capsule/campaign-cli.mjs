#!/usr/bin/env node

import { resolve } from 'node:path';

import { createOptimizationCampaignService } from './campaign.mjs';
import { createOptimizationContributionService } from './contribution.mjs';
import { redactText } from './redact.mjs';

const OPERATIONS = new Set([
  'init',
  'baseline',
  'screen',
  'promote',
  'inspect',
  'status',
  'challenge',
  'inspect-contribution',
  'refresh-contribution',
]);

export async function main(argv = process.argv.slice(2), overrides = {}) {
  let repositoryRoot = resolve(process.cwd());
  try {
    const { operation, options } = parseArguments(argv);
    repositoryRoot = resolve(options.repo ?? process.cwd());
    const contributionOperation = [
      'challenge',
      'inspect-contribution',
      'refresh-contribution',
    ].includes(operation);
    const service = contributionOperation
      ? (overrides.contributionService ??
        (await createOptimizationContributionService(repositoryRoot)))
      : (overrides.service ?? (await createOptimizationCampaignService(repositoryRoot)));
    const input = { campaign_directory: required(options, 'campaign') };
    let result;
    if (operation === 'init') result = await service.initialize(input);
    else if (operation === 'baseline') result = await service.baseline(input);
    else if (operation === 'screen') {
      result = await service.screen({
        ...input,
        hypothesis: required(options, 'hypothesis'),
        incumbent_repository: options['incumbent-repo'],
      });
    } else if (operation === 'promote') {
      result = await service.promote({
        ...input,
        hypothesis: required(options, 'hypothesis'),
        incumbent_repository: required(options, 'incumbent-repo'),
      });
    } else if (operation === 'inspect') result = await service.inspect(input);
    else if (operation === 'status') result = await service.status(input);
    else if (operation === 'challenge') {
      result = await service.challenge({
        ...input,
        selected_sequence: requiredInteger(options, 'selected-sequence'),
        ...(options['comparison-sequence'] === undefined
          ? {}
          : { comparison_sequence: requiredInteger(options, 'comparison-sequence') }),
        ...(options.justification === undefined
          ? {}
          : { simpler_not_applicable_reason: options.justification }),
      });
    } else {
      result = await service[operation === 'inspect-contribution' ? 'inspect' : 'refresh']({
        ...input,
        challenge_path: required(options, 'challenge'),
        pull_request_url: required(options, 'pr'),
        trex_policy: required(options, 'trex-policy'),
        ...(options['trex-receipt'] === undefined ? {} : { trex_receipt: options['trex-receipt'] }),
        ...(options['trex-reason'] === undefined
          ? {}
          : { trex_not_applicable_reason: options['trex-reason'] }),
      });
    }
    writeJson(result, overrides.stdout);
    return exitCode(result);
  } catch (error) {
    const sanitized = redactText(error?.message ?? String(error), {
      repositoryRoot,
      environmentValues: Object.values(process.env),
      limit: 500,
    });
    writeJson(
      {
        schema_version: 'optimization-campaign-error/v1',
        error: { type: error?.name ?? 'Error', message: sanitized.text },
        verdict: { status: 'no_confidence' },
      },
      overrides.stdout
    );
    return 2;
  }
}

function parseArguments(argv) {
  const normalizedArguments = argv[0] === '--' ? argv.slice(1) : argv;
  const [operation, ...rest] = normalizedArguments;
  if (!OPERATIONS.has(operation)) {
    throw new Error(
      'usage: campaign-cli.mjs <init|baseline|screen|promote|inspect|status|challenge|inspect-contribution|refresh-contribution> --campaign PATH [--repo PATH] [operation options] [--json]'
    );
  }
  const normalized = rest[0] === '--' ? rest.slice(1) : rest;
  const options = {};
  for (let index = 0; index < normalized.length; index += 1) {
    const argument = normalized[index];
    if (argument === '--json') {
      if (options.json) throw new Error('duplicate option: --json');
      options.json = true;
      continue;
    }
    if (!argument.startsWith('--')) throw new Error(`unexpected positional argument: ${argument}`);
    const equals = argument.indexOf('=');
    if (equals !== -1) {
      const key = argument.slice(2, equals);
      if (!key) throw new Error('empty option name');
      if (Object.hasOwn(options, key)) throw new Error(`duplicate option: --${key}`);
      options[key] = argument.slice(equals + 1);
      continue;
    }
    const key = argument.slice(2);
    const value = normalized[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    if (Object.hasOwn(options, key)) throw new Error(`duplicate option: --${key}`);
    options[key] = value;
    index += 1;
  }
  let operationOptions = [];
  if (operation === 'screen') operationOptions = ['hypothesis', 'incumbent-repo'];
  else if (operation === 'promote') operationOptions = ['hypothesis', 'incumbent-repo'];
  else if (operation === 'challenge') {
    operationOptions = ['selected-sequence', 'comparison-sequence', 'justification'];
  } else if (['inspect-contribution', 'refresh-contribution'].includes(operation)) {
    operationOptions = ['challenge', 'pr', 'trex-policy', 'trex-receipt', 'trex-reason'];
  }
  const allowed = new Set(['repo', 'campaign', 'json', ...operationOptions]);
  const unknown = Object.keys(options).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`unknown option for ${operation}: --${unknown}`);
  return { operation, options };
}

function required(options, key) {
  const value = options[key];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`missing --${key}`);
  return value;
}

function requiredInteger(options, key) {
  const value = required(options, key);
  if (!/^\d+$/.test(value)) throw new Error(`--${key} must be a non-negative integer`);
  return Number(value);
}

function exitCode(result) {
  const decision = result?.record?.decision?.status ?? result?.latest?.decision?.status;
  if (['discard', 'crash'].includes(decision)) return 1;
  if (decision === 'no_confidence' || result?.status === 'no_confidence') return 2;
  if (result?.challenge?.patch_quality?.status === 'no_confidence') return 2;
  const contribution = result?.receipt?.status;
  if (
    ['review_action_required', 'checks_failed', 'pull_request_not_ready'].includes(contribution)
  ) {
    return 1;
  }
  if (contribution && !['ready', 'waiting_for_maintainer', 'merged'].includes(contribution)) {
    return 2;
  }
  return 0;
}

function writeJson(value, output = process.stdout) {
  output.write(`${JSON.stringify(value)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
