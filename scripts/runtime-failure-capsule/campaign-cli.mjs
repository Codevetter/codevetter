#!/usr/bin/env node

import { resolve } from 'node:path';

import { createOptimizationCampaignService } from './campaign.mjs';
import { redactText } from './redact.mjs';

const OPERATIONS = new Set(['init', 'baseline', 'screen', 'promote', 'inspect', 'status']);

export async function main(argv = process.argv.slice(2), overrides = {}) {
  let repositoryRoot = resolve(process.cwd());
  try {
    const { operation, options } = parseArguments(argv);
    repositoryRoot = resolve(options.repo ?? process.cwd());
    const service = overrides.service ?? (await createOptimizationCampaignService(repositoryRoot));
    const input = { campaign_directory: required(options, 'campaign') };
    let result;
    if (operation === 'init') result = await service.initialize(input);
    else if (operation === 'baseline') result = await service.baseline(input);
    else if (operation === 'screen') {
      result = await service.screen({ ...input, hypothesis: required(options, 'hypothesis') });
    } else if (operation === 'promote') {
      result = await service.promote({
        ...input,
        hypothesis: required(options, 'hypothesis'),
        incumbent_repository: required(options, 'incumbent-repo'),
      });
    } else if (operation === 'inspect') result = await service.inspect(input);
    else result = await service.status(input);
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
      'usage: campaign-cli.mjs <init|baseline|screen|promote|inspect|status> --campaign PATH [--repo PATH] [operation options] [--json]'
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
  const allowed = new Set(
    operation === 'screen'
      ? ['repo', 'campaign', 'hypothesis', 'json']
      : operation === 'promote'
        ? ['repo', 'campaign', 'hypothesis', 'incumbent-repo', 'json']
        : ['repo', 'campaign', 'json']
  );
  const unknown = Object.keys(options).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`unknown option for ${operation}: --${unknown}`);
  return { operation, options };
}

function required(options, key) {
  const value = options[key];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`missing --${key}`);
  return value;
}

function exitCode(result) {
  const decision = result?.record?.decision?.status ?? result?.latest?.decision?.status;
  if (['discard', 'crash'].includes(decision)) return 1;
  if (decision === 'no_confidence' || result?.status === 'no_confidence') return 2;
  return 0;
}

function writeJson(value, output = process.stdout) {
  output.write(`${JSON.stringify(value)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
