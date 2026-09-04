#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ingestReceiptDocument } from './analyze.mjs';
import { loadReceipt, stableStringify, writeJsonWithinRepository } from './contracts.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT_DIRECTORY = 'artifacts/verification-dogfood';
const OUTPUT_PATH = `${OUTPUT_DIRECTORY}/summary.json`;
const PRODUCERS = [
  {
    id: 'native-unit',
    command: 'pnpm',
    args: ['test:native'],
    receipts: [],
  },
  {
    id: 'rust-core',
    command: 'pnpm',
    args: ['core:test'],
    receipts: [],
  },
];

export async function runDogfood({
  repositoryRoot = REPOSITORY_ROOT,
  stdout = process.stdout,
} = {}) {
  await mkdir(resolve(repositoryRoot, OUTPUT_DIRECTORY), { recursive: true });
  const producers = [];
  const artifacts = [];

  for (const producer of PRODUCERS) {
    const exitCode = await runProducer(producer, repositoryRoot);
    producers.push({ id: producer.id, exit_code: exitCode, receipts: producer.receipts });
    for (const receiptPath of producer.receipts) {
      try {
        const loaded = await loadReceipt(repositoryRoot, receiptPath);
        const bundle = ingestReceiptDocument(loaded.receipt, {
          sourcePath: loaded.relativePath,
          sourceSha256: loaded.sha256,
        });
        artifacts.push({
          path: loaded.relativePath,
          format: loaded.sourceFormat,
          sha256: loaded.sha256,
          bundle_id: bundle.bundle_id,
          verdict: bundle.verdict,
          limitations: bundle.limitations,
        });
      } catch (error) {
        artifacts.push({
          path: receiptPath,
          error: boundedError(error, repositoryRoot),
        });
      }
    }
  }

  const summary = {
    schema_version: 'codevetter.external-tool-dogfood/v1',
    authority: 'integration-check-only',
    producers,
    artifacts,
  };
  await writeJsonWithinRepository(repositoryRoot, OUTPUT_PATH, summary);
  stdout.write(`${stableStringify(summary)}\n`);
  return producers.some((entry) => entry.exit_code !== 0) || artifacts.some((entry) => entry.error)
    ? 1
    : 0;
}

function runProducer(producer, repositoryRoot) {
  return new Promise((resolveExit) => {
    const child = spawn(producer.command, producer.args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', () => resolveExit(127));
    child.once('exit', (code, signal) => resolveExit(signal ? 128 : (code ?? 1)));
  });
}

function boundedError(error, repositoryRoot) {
  return String(error?.message ?? error)
    .replaceAll(repositoryRoot, '<repository>')
    .slice(0, 500);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length !== 2) {
    process.stderr.write('usage: dogfood-cli.mjs\n');
    process.exitCode = 2;
  } else {
    process.exitCode = await runDogfood();
  }
}
