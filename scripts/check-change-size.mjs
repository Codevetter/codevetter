#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const standardLimits = Object.freeze({
  changedFiles: 40,
  addedLines: 4_000,
  grossLines: 6_000,
});
const retirementLimits = Object.freeze({
  retiredRoot: 'apps/desktop/',
  minimumDeletedFiles: 100,
  minimumDeletedLines: 100_000,
  maximumAddedLines: 8_000,
  maximumDirectlyChangedFiles: 100,
  maximumRenameFiles: 500,
  maximumRenameChurn: 1_000,
  maximumReviewChurn: 20_000,
});
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const comparisonBase = process.env.CODE_HEALTH_BASE?.trim() || 'origin/main';

function git(args) {
  return spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
}

function measureNumstat(args) {
  const result = git(['diff', '--numstat', ...args, comparisonBase, '--']);
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'git diff failed');
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .reduce(
      (totals, line) => {
        const [added, removed] = line.split('\t');
        const additions = /^\d+$/.test(added) ? Number(added) : 0;
        const deletions = /^\d+$/.test(removed) ? Number(removed) : 0;
        return {
          changedFiles: totals.changedFiles + 1,
          addedLines: totals.addedLines + additions,
          removedLines: totals.removedLines + deletions,
          grossLines: totals.grossLines + additions + deletions,
        };
      },
      { changedFiles: 0, addedLines: 0, removedLines: 0, grossLines: 0 }
    );
}

function countUntracked() {
  const result = git(['ls-files', '--others', '--exclude-standard']);
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'git ls-files failed');
  const files = result.stdout.split('\n').filter(Boolean);
  return files.reduce(
    (totals, file) => {
      const absolute = path.join(repositoryRoot, file);
      totals.changedFiles += 1;
      if (!lstatSync(absolute).isFile()) return totals;
      const content = readFileSync(absolute);
      const lines = content.includes(0)
        ? 0
        : content.length === 0
          ? 0
          : content.toString('utf8').split('\n').length - (content.at(-1) === 10 ? 1 : 0);
      totals.addedLines += lines;
      totals.grossLines += lines;
      return totals;
    },
    { files, changedFiles: 0, addedLines: 0, grossLines: 0 }
  );
}

function addUntracked(summary, untracked) {
  return {
    ...summary,
    changedFiles: summary.changedFiles + untracked.changedFiles,
    addedLines: summary.addedLines + untracked.addedLines,
    grossLines: summary.grossLines + untracked.grossLines,
  };
}

function retirementAssessment(untracked) {
  const created = measureNumstat(['--find-renames=90%', '--diff-filter=A']);
  const modified = measureNumstat(['--find-renames=90%', '--diff-filter=M']);
  const renamed = measureNumstat(['--find-renames=90%', '--diff-filter=R']);
  const deleted = measureNumstat(['--find-renames=90%', '--diff-filter=D']);
  const deletedNames = git([
    'diff',
    '--name-only',
    '--find-renames=90%',
    '--diff-filter=D',
    comparisonBase,
    '--',
  ]);
  if (deletedNames.status !== 0) throw new Error(deletedNames.stderr.trim() || 'git diff failed');
  const deletionPaths = deletedNames.stdout.split('\n').filter(Boolean);
  const directlyChangedFiles = created.changedFiles + modified.changedFiles;
  const addedLines = created.addedLines + modified.addedLines + renamed.addedLines;
  const reviewChurn = created.grossLines + modified.grossLines + renamed.grossLines;
  const checks = [
    ['no untracked files', untracked.files.length === 0],
    [
      `all deletions are under ${retirementLimits.retiredRoot}`,
      deletionPaths.length > 0 &&
        deletionPaths.every((file) => file.startsWith(retirementLimits.retiredRoot)),
    ],
    [
      `deleted files >= ${retirementLimits.minimumDeletedFiles}`,
      deleted.changedFiles >= retirementLimits.minimumDeletedFiles,
    ],
    [
      `deleted lines >= ${retirementLimits.minimumDeletedLines}`,
      deleted.removedLines >= retirementLimits.minimumDeletedLines,
    ],
    [
      `added lines <= ${retirementLimits.maximumAddedLines}`,
      addedLines <= retirementLimits.maximumAddedLines,
    ],
    [
      `directly changed files <= ${retirementLimits.maximumDirectlyChangedFiles}`,
      directlyChangedFiles <= retirementLimits.maximumDirectlyChangedFiles,
    ],
    [
      `recognized renames <= ${retirementLimits.maximumRenameFiles}`,
      renamed.changedFiles <= retirementLimits.maximumRenameFiles,
    ],
    [
      `rename churn <= ${retirementLimits.maximumRenameChurn}`,
      renamed.grossLines <= retirementLimits.maximumRenameChurn,
    ],
    [
      `review churn <= ${retirementLimits.maximumReviewChurn}`,
      reviewChurn <= retirementLimits.maximumReviewChurn,
    ],
  ];
  return {
    passed: checks.every(([, passed]) => passed),
    checks,
    metrics: {
      addedLines,
      deletedFiles: deleted.changedFiles,
      deletedLines: deleted.removedLines,
      directlyChangedFiles,
      renameFiles: renamed.changedFiles,
      renameChurn: renamed.grossLines,
      reviewChurn,
    },
  };
}

try {
  const untracked = countUntracked();
  const summary = addUntracked(measureNumstat(['--no-renames', '--diff-filter=ACDMR']), untracked);
  const violations = Object.entries(standardLimits).filter(
    ([metric, limit]) => summary[metric] > limit
  );

  if (violations.length === 0) {
    console.log(
      `Change-size gate: PASS (${summary.changedFiles}/${standardLimits.changedFiles} files, ${summary.addedLines}/${standardLimits.addedLines} additions, ${summary.grossLines}/${standardLimits.grossLines} gross lines)`
    );
    process.exit(0);
  }

  const retirement = retirementAssessment(untracked);
  if (retirement.passed) {
    const metrics = retirement.metrics;
    console.log(
      `Change-size gate: PASS retirement (${metrics.directlyChangedFiles} directly changed files, ${metrics.addedLines} additions, ${metrics.renameFiles} recognized renames, ${metrics.deletedFiles} legacy files deleted)`
    );
    console.log(
      `Review churn ${metrics.reviewChurn}/${retirementLimits.maximumReviewChurn}; legacy deletion ${metrics.deletedLines} lines under ${retirementLimits.retiredRoot}`
    );
    process.exit(0);
  }

  console.error(
    `Change-size gate: FAIL (${summary.changedFiles} files, ${summary.addedLines} additions, ${summary.grossLines} gross lines)`
  );
  for (const [metric, limit] of violations) {
    console.error(`- ${metric}: ${summary[metric]} exceeds ${limit}`);
  }
  for (const [description, passed] of retirement.checks) {
    if (!passed) console.error(`- retirement exception not met: ${description}`);
  }
  console.error(
    'Split the change into dependency-ordered, independently reviewable pull requests.'
  );
  process.exit(1);
} catch (error) {
  console.error(`Unable to measure change size from ${comparisonBase}: ${error.message}`);
  process.exit(1);
}
