#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CORPUS_ROOT, validateCorpus } from './validate-corpus.mjs';

export function runCli(args, { cwd = process.cwd() } = {}) {
  const options = parseArgs(args);
  const root = resolve(cwd, options.root);
  const result = validateCorpus({ root });
  const output = options.json ? `${JSON.stringify(result, null, 2)}\n` : formatHuman(result);
  const exitCode = result.valid && (!options.strict || result.publishable) ? 0 : 1;
  return { exitCode, output, result };
}

function parseArgs(args) {
  let root = DEFAULT_CORPUS_ROOT;
  let json = false;
  let strict = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      json = true;
    } else if (argument === '--strict') {
      strict = true;
    } else if (argument === '--root') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--root requires a path');
      root = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { json, root, strict };
}

function formatHuman(result) {
  const lines = [
    `Agent-task corpus: ${result.valid ? 'valid' : 'invalid'} · ${result.publishable ? 'publishable' : 'not publishable'}`,
    `Identity: ${result.corpus.id ?? 'unknown'}@${result.corpus.version ?? 'unknown'} · ${result.corpus.index_sha256 ?? 'unavailable'}`,
    `Tasks: ${result.counts.tasks} valid · ${result.counts.qualified_tasks} qualified · ${result.counts.categories} categories`,
    `Coverage: lanes=${result.coverage.lanes.join(',') || 'none'} · runtimes=${result.coverage.runtimes.join(',') || 'none'}`,
    'Readiness:',
    ...result.gates.map(
      (gate) =>
        `  ${gate.passed ? 'PASS' : 'FAIL'} ${gate.id}: ${gate.actual} (expected ${gate.expected})`
    ),
  ];
  if (result.errors.length > 0) {
    lines.push('Errors:', ...result.errors.map((error) => `  - ${error}`));
  }
  if (result.warnings.length > 0) {
    lines.push('Warnings:', ...result.warnings.map((warning) => `  - ${warning}`));
  }
  return `${lines.join('\n')}\n`;
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const { exitCode, output } = runCli(process.argv.slice(2));
    process.stdout.write(output);
    process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(
      `Agent-task corpus validation failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  }
}
