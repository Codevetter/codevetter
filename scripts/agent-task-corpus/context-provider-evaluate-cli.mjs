#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CORPUS_LIMITS, sha256Bytes, validateContract } from './contracts.mjs';
import {
  aggregateContextProviderScores,
  projectContextProviderEvaluationBundle,
  renderContextProviderComparison,
  writeContextProviderArtifact,
} from './context-provider-evaluation.mjs';
import { resolveArtifact } from './validate-corpus.mjs';

export async function runContextProviderEvaluationCli(args = process.argv.slice(2)) {
  const wantsJson = args.includes('--json');
  try {
    const options = parseArgs(args);
    const root = resolve(options.root);
    const planDocument = await readJsonArtifact(root, options.planPath, 'context-provider-plan');
    if (options.command === 'project') {
      const attemptsDocument = await readJsonArtifact(root, options.attemptsPath);
      if (!Array.isArray(attemptsDocument.value)) {
        throw new Error('--attempts must contain a JSON array');
      }
      const result = projectContextProviderEvaluationBundle({
        plan: planDocument.value,
        providerId: options.providerId,
        attempts: attemptsDocument.value,
      });
      const content = `${JSON.stringify(result.bundle, null, 2)}\n`;
      if (options.out) await writeContextProviderArtifact(options.out, content);
      return {
        exitCode: 0,
        output: wantsJson
          ? `${JSON.stringify(result.bundle)}\n`
          : projectionOutput(result, options.out),
        value: result.bundle,
      };
    }

    const pairwise = [];
    for (const descriptor of options.pairwise) {
      const [providerId, scorePath, bundlePath] = descriptor;
      const score = await readJsonArtifact(root, scorePath, 'evaluation-score');
      const bundle = await readJsonArtifact(root, bundlePath, 'evaluation-bundle');
      if (score.value.evidence.bundle_sha256 !== bundle.artifact.sha256) {
        throw new Error(`score/bundle SHA-256 mismatch for ${providerId}`);
      }
      pairwise.push({
        provider_id: providerId,
        score: score.value,
        score_artifact: score.artifact,
        bundle_artifact: bundle.artifact,
        missing_arms: [],
      });
    }
    const comparison = aggregateContextProviderScores({
      plan: planDocument.value,
      planArtifact: planDocument.artifact,
      pairwise,
    });
    const content = renderContextProviderComparison(comparison, options.format);
    if (options.out) await writeContextProviderArtifact(options.out, content);
    return { exitCode: 0, output: content, value: comparison };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 2,
      output: wantsJson
        ? `${JSON.stringify({ error: detail })}\n`
        : `Context-provider evaluation failed: ${detail}\n`,
      value: null,
    };
  }
}

function parseArgs(args) {
  const command = args[0];
  if (!['project', 'aggregate'].includes(command)) {
    throw new Error('expected subcommand project or aggregate');
  }
  const options = {
    command,
    root: process.cwd(),
    planPath: undefined,
    providerId: undefined,
    attemptsPath: undefined,
    pairwise: [],
    format: 'json',
    out: undefined,
  };
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') continue;
    assertKnownArgument(argument);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    index += 1;
    assignOption(options, argument, value);
  }
  validateOptions(options);
  return options;
}

function assertKnownArgument(argument) {
  const known = ['--root', '--plan', '--provider', '--attempts', '--pairwise', '--format', '--out'];
  if (!known.includes(argument)) throw new Error(`unknown argument: ${argument}`);
}

function assignOption(options, argument, value) {
  const fields = {
    '--root': 'root',
    '--plan': 'planPath',
    '--provider': 'providerId',
    '--attempts': 'attemptsPath',
    '--format': 'format',
    '--out': 'out',
  };
  if (argument !== '--pairwise') {
    options[fields[argument]] = value;
    return;
  }
  const descriptor = value.split(',');
  if (descriptor.length !== 3 || descriptor.some((part) => part.length === 0)) {
    throw new Error('--pairwise requires PROVIDER_ID,SCORE_PATH,BUNDLE_PATH');
  }
  options.pairwise.push(descriptor);
}

function validateOptions(options) {
  if (!options.planPath) throw new Error('--plan is required');
  if (options.command === 'project' && (!options.providerId || !options.attemptsPath)) {
    throw new Error('project requires --provider and --attempts');
  }
  if (options.command === 'aggregate' && options.pairwise.length === 0) {
    throw new Error('aggregate requires at least one --pairwise');
  }
  if (!['json', 'markdown', 'html'].includes(options.format)) {
    throw new Error('--format must be json, markdown, or html');
  }
}

async function readJsonArtifact(root, declaredPath, kind) {
  const absolute = resolveArtifact(root, declaredPath, CORPUS_LIMITS.maxArtifactBytes);
  const bytes = await readFile(absolute);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`artifact is not valid JSON: ${declaredPath}`);
  }
  if (kind) {
    const errors = validateContract(kind, value);
    if (errors.length > 0) throw new Error(`invalid ${kind}:\n${errors.join('\n')}`);
  }
  return {
    value,
    artifact: {
      path: relative(root, absolute).split(sep).join('/'),
      sha256: sha256Bytes(bytes),
    },
  };
}

function projectionOutput(result, outputPath) {
  const lines = [
    `Runs: ${result.bundle.runs.length}`,
    `Missing arms: ${result.inspection.missing_arms.length}`,
  ];
  if (outputPath) lines.push(`Bundle: ${outputPath}`);
  else lines.push('Use --json to print the projected bundle or --out to save it.');
  return `${lines.join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runContextProviderEvaluationCli();
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
}
