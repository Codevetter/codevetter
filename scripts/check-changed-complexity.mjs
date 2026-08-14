#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const comparisonBase = process.env.CODE_HEALTH_BASE?.trim() || 'origin/main';
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const sourceExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/;

const changed = spawnSync(
  'git',
  ['diff', '--name-only', '--diff-filter=ACMR', comparisonBase, '--'],
  { cwd: repositoryRoot, encoding: 'utf8' }
);
const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});

if (changed.status !== 0 || untracked.status !== 0) {
  const detail = changed.stderr || untracked.stderr || 'git did not return a file list';
  console.error(`Unable to resolve changed files from ${comparisonBase}: ${detail.trim()}`);
  process.exit(1);
}

const files = [...changed.stdout.split('\n'), ...untracked.stdout.split('\n')]
  .map((file) => file.trim())
  .filter((file) => sourceExtension.test(file) && existsSync(path.join(repositoryRoot, file)))
  .filter((file, index, values) => values.indexOf(file) === index)
  .toSorted();

if (files.length === 0) {
  console.log(`Changed-file complexity: PASS (0 applicable files since ${comparisonBase})`);
  process.exit(0);
}

const result = spawnSync(
  command,
  [
    'exec',
    'biome',
    'lint',
    '--config-path=biome.code-health.json',
    '--only=complexity/noExcessiveCognitiveComplexity',
    ...files,
  ],
  { cwd: repositoryRoot, stdio: 'inherit' }
);

if (result.error) {
  console.error(`Unable to run changed-file complexity check: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
