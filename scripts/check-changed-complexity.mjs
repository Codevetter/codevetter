#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const comparisonBase = process.env.CODE_HEALTH_BASE?.trim() || 'origin/main';
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

const current = runComplexity(repositoryRoot, files);
const baseline = baselineComplexity(files);
const baselineByFunction = new Map(
  baseline.map((diagnostic) => [diagnostic.identity, diagnostic.score])
);
const regressions = current.filter((diagnostic) => {
  const previous = baselineByFunction.get(diagnostic.identity);
  return previous === undefined || diagnostic.score > Math.max(20, previous);
});

if (regressions.length > 0) {
  for (const diagnostic of regressions) {
    const previous = baselineByFunction.get(diagnostic.identity);
    console.error(
      `${diagnostic.file}:${diagnostic.line} ${diagnostic.name} has complexity ${diagnostic.score}` +
        (previous === undefined ? ' (new violation)' : ` (baseline ${previous})`)
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    `Changed-file complexity: PASS (${files.length} files, ${current.length} retained baseline exceptions)`
  );
}

function baselineComplexity(paths) {
  const directory = mkdtempSync(path.join(tmpdir(), 'codevetter-complexity-'));
  const retained = [];
  try {
    copyConfig(directory);
    for (const file of paths) {
      const source = spawnSync('git', ['show', `${comparisonBase}:${file}`], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      });
      if (source.status !== 0) continue;
      const target = path.join(directory, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source.stdout);
      retained.push(file);
    }
    return retained.length > 0 ? runComplexity(directory, retained) : [];
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function copyConfig(directory) {
  for (const file of ['.gitignore', 'biome.json', 'biome.code-health.json']) {
    writeFileSync(path.join(directory, file), readFileSync(path.join(repositoryRoot, file)));
  }
}

function runComplexity(root, paths) {
  const executable = path.join(
    repositoryRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'biome.cmd' : 'biome'
  );
  const result = spawnSync(
    executable,
    [
      'lint',
      `--config-path=${path.join(root, 'biome.code-health.json')}`,
      '--only=complexity/noExcessiveCognitiveComplexity',
      '--reporter=json',
      ...paths,
    ],
    { cwd: root, encoding: 'utf8' }
  );
  if (result.error) throw result.error;
  const report = parseReport(result.stdout, result.stderr, result.status);
  return report.diagnostics.map((diagnostic) => normalizeDiagnostic(root, diagnostic));
}

function parseReport(output, errorOutput, status) {
  const line = String(output)
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith('{'));
  if (!line && status === 0) return { diagnostics: [] };
  if (!line) {
    throw new Error(`Biome did not return a JSON complexity report: ${errorOutput.trim()}`);
  }
  return JSON.parse(line);
}

function normalizeDiagnostic(root, diagnostic) {
  const file = path
    .relative(root, path.resolve(root, diagnostic.location.path))
    .split(path.sep)
    .join('/');
  const line = diagnostic.location.start.line;
  const sourceLine = readFileSync(path.join(root, file), 'utf8').split(/\r?\n/)[line - 1] ?? '';
  const start = diagnostic.location.start.column - 1;
  const end = diagnostic.location.end.column - 1;
  const name = sourceLine.slice(start, end) || '<anonymous>';
  const score = Number(/complexity of (\d+)/i.exec(diagnostic.message)?.[1]);
  return { identity: `${file}:${name}`, file, line, name, score };
}
