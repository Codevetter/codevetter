#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(repositoryRoot, 'artifacts/code-health/duplication');
const reportPath = resolve(outputDirectory, 'jscpd-report.json');

// The native-only migration removed more than half of the duplicated lines but
// also removed a much larger body of non-duplicated React code. An absolute
// regression budget preserves that improvement without letting denominator
// shrinkage turn deletion into a false failure.
const baseline = Object.freeze({
  duplicatedLines: 596,
  duplicatedTokens: 4_375,
});

mkdirSync(outputDirectory, { recursive: true });
const startedAt = Date.now();
const scan = spawnSync(
  'pnpm',
  [
    'exec',
    'jscpd',
    'apps/landing-page-astro/src',
    'scripts',
    '--min-lines',
    '8',
    '--min-tokens',
    '60',
    '--mode',
    'strict',
    '--format',
    'typescript,tsx,javascript',
    '--cross-formats',
    'js-ts',
    '--ignore',
    '**/fixtures/**,**/generated/**,**/gen/**,**/node_modules/**,**/dist/**,**/out/**,**/coverage/**',
    '--threshold',
    '100',
    '--reporters',
    'console,json',
    '--output',
    outputDirectory,
    '--no-colors',
    '--no-tips',
  ],
  { cwd: repositoryRoot, encoding: 'utf8' }
);

if (scan.stdout) process.stdout.write(scan.stdout);
if (scan.stderr) process.stderr.write(scan.stderr);
if (scan.status !== 0) process.exit(scan.status ?? 1);

const reportStat = statSync(reportPath);
if (reportStat.mtimeMs + 1_000 < startedAt) {
  throw new Error('jscpd did not refresh its machine-readable report');
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const totals = report.statistics?.total;
if (!totals) throw new Error('jscpd report is missing total statistics');

const violations = Object.entries(baseline).filter(
  ([metric, limit]) => !Number.isFinite(totals[metric]) || totals[metric] > limit
);
if (violations.length > 0) {
  process.stderr.write(
    `Duplication regression: FAIL (${totals.duplicatedLines} lines, ${totals.duplicatedTokens} tokens)\n`
  );
  for (const [metric, limit] of violations) {
    process.stderr.write(
      `- ${metric}: ${totals[metric]} exceeds post-retirement baseline ${limit}\n`
    );
  }
  process.exit(1);
}

process.stdout.write(
  `Duplication regression: PASS (${totals.duplicatedLines}/${baseline.duplicatedLines} lines, ${totals.duplicatedTokens}/${baseline.duplicatedTokens} tokens)\n`
);
