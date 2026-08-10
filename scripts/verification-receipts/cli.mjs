#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { compareReceiptDocuments, ingestReceiptDocument } from './analyze.mjs';
import { loadReceipt, stableStringify, writeJsonWithinRepository } from './contracts.mjs';

const HELP = `CodeVetter verification receipt analysis

Usage:
  cli.mjs ingest --receipt <relative.json> [--repo <path>] [--output <relative.json>]
  cli.mjs compare --baseline <relative.json> --current <relative.json> [--repo <path>] [--output <relative.json>]
`;

export async function runCli(argv, { cwd = process.cwd(), stdout = process.stdout } = {}) {
  const { operation, options } = parseArguments(argv, cwd);
  if (operation === 'help') {
    stdout.write(HELP);
    return 0;
  }
  let result;
  if (operation === 'ingest') {
    const loaded = await loadReceipt(options.repo, required(options, 'receipt'));
    result = ingestReceiptDocument(loaded.receipt, {
      sourcePath: loaded.relativePath,
      sourceSha256: loaded.sha256,
    });
  } else {
    const [baseline, current] = await Promise.all([
      loadReceipt(options.repo, required(options, 'baseline')),
      loadReceipt(options.repo, required(options, 'current')),
    ]);
    result = compareReceiptDocuments(baseline.receipt, current.receipt, {
      baselineSource: { sourcePath: baseline.relativePath, sourceSha256: baseline.sha256 },
      currentSource: { sourcePath: current.relativePath, sourceSha256: current.sha256 },
    });
  }
  if (options.output) await writeJsonWithinRepository(options.repo, options.output, result);
  stdout.write(`${stableStringify(result)}\n`);
  return exitCode(result);
}

function parseArguments(argv, cwd) {
  const args = [...argv];
  const operation = args.shift();
  if (!operation || operation === 'help' || operation === '--help' || operation === '-h') {
    return { operation: 'help', options: { repo: cwd } };
  }
  if (!['ingest', 'compare'].includes(operation))
    throw new Error(`unknown operation ${operation}\n\n${HELP}`);
  const options = { repo: cwd };
  while (args.length > 0) {
    const flag = args.shift();
    if (!['--repo', '--receipt', '--baseline', '--current', '--output'].includes(flag)) {
      throw new Error(`unknown argument ${flag}`);
    }
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    options[flag.slice(2)] = value;
  }
  if (operation === 'ingest') {
    required(options, 'receipt');
    if (options.baseline || options.current)
      throw new Error('ingest does not accept baseline or current');
    if (options.output === options.receipt)
      throw new Error('output must not overwrite the source receipt');
  } else {
    required(options, 'baseline');
    required(options, 'current');
    if (options.receipt) throw new Error('compare does not accept receipt');
    if (options.output === options.baseline || options.output === options.current) {
      throw new Error('output must not overwrite an input receipt');
    }
  }
  return { operation, options };
}

function required(options, key) {
  if (!options[key]) throw new Error(`--${key} is required`);
  return options[key];
}

function exitCode(result) {
  const status = result.verdict?.status ?? result.verdict?.overall;
  if (['failed', 'regressed'].includes(status)) return 1;
  if (['no_confidence'].includes(status)) return 2;
  return 0;
}

async function main() {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`codevetter verification receipt: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
