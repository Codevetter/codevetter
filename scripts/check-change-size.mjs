#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const limits = Object.freeze({ changedFiles: 40, addedLines: 4_000, grossLines: 6_000 });
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const comparisonBase = process.env.CODE_HEALTH_BASE?.trim() || 'origin/main';
const result = spawnSync(
  'git',
  ['diff', '--numstat', '--no-renames', '--diff-filter=ACDMR', comparisonBase, '--'],
  { cwd: repositoryRoot, encoding: 'utf8' }
);
const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});

if (result.status !== 0 || untracked.status !== 0) {
  console.error(
    `Unable to measure change size from ${comparisonBase}: ${result.stderr.trim() || untracked.stderr.trim() || 'git failed'}`
  );
  process.exit(1);
}

const summary = result.stdout
  .split('\n')
  .filter(Boolean)
  .reduce(
    (totals, line) => {
      const [added, removed] = line.split('\t');
      return {
        changedFiles: totals.changedFiles + 1,
        addedLines: totals.addedLines + (/^\d+$/.test(added) ? Number(added) : 0),
        grossLines:
          totals.grossLines +
          (/^\d+$/.test(added) ? Number(added) : 0) +
          (/^\d+$/.test(removed) ? Number(removed) : 0),
      };
    },
    { changedFiles: 0, addedLines: 0, grossLines: 0 }
  );
for (const file of untracked.stdout.split('\n').filter(Boolean)) {
  summary.changedFiles += 1;
  const absolute = path.join(repositoryRoot, file);
  if (!lstatSync(absolute).isFile()) continue;
  const content = readFileSync(absolute);
  const lines = content.includes(0)
    ? 0
    : content.length === 0
      ? 0
      : content.toString('utf8').split('\n').length - (content.at(-1) === 10 ? 1 : 0);
  summary.addedLines += lines;
  summary.grossLines += lines;
}
const violations = Object.entries(limits).filter(([metric, limit]) => summary[metric] > limit);

if (violations.length > 0) {
  console.error(
    `Change-size gate: FAIL (${summary.changedFiles} files, ${summary.addedLines} additions, ${summary.grossLines} gross lines)`
  );
  for (const [metric, limit] of violations) {
    console.error(`- ${metric}: ${summary[metric]} exceeds ${limit}`);
  }
  console.error(
    'Split the change into dependency-ordered, independently reviewable pull requests.'
  );
  process.exit(1);
}

console.log(
  `Change-size gate: PASS (${summary.changedFiles}/${limits.changedFiles} files, ${summary.addedLines}/${limits.addedLines} additions, ${summary.grossLines}/${limits.grossLines} gross lines)`
);
