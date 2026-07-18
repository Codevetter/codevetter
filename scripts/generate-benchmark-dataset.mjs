#!/usr/bin/env node
// Generates the public benchmark dataset + per-reviewer results consumed by
// the /benchmark landing page.
//
// Outputs:
//   apps/landing-page-astro/public/benchmark/codevetter-benchmark-v1.json
//   apps/landing-page-astro/src/data/benchmark-results.json
//
// Run from the repo root after scoring reviewers:
//   node scripts/run-public-benchmark.mjs --reviewer=codevetter --json > /tmp/cv-score.json
//   node scripts/run-public-benchmark.mjs --reviewer=raw-claude --json > /tmp/rc-score.json
//   node scripts/generate-benchmark-dataset.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CASES_DIR = path.join(ROOT, 'benchmark/cases');
const LANDING_PUBLIC = path.join(ROOT, 'apps/landing-page-astro/public');
const LANDING_DATA = path.join(ROOT, 'apps/landing-page-astro/src/data');

const caseDirs = fs
  .readdirSync(CASES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const cases = [];
for (const id of caseDirs) {
  const dir = path.join(CASES_DIR, id);
  const label = JSON.parse(fs.readFileSync(path.join(dir, 'label.json'), 'utf8'));
  const source = fs.readFileSync(path.join(dir, label.source_file), 'utf8');
  cases.push({
    id: label.id,
    title: label.title,
    language: label.language,
    source_file: label.source_file,
    category: label.category,
    source,
    expected_findings: label.ground_truth.map((g) => ({
      id: g.id,
      type: g.type,
      severity: g.severity,
      location: g.location,
      description: g.description,
    })),
  });
}

const dataset = {
  name: 'CodeVetter Public Benchmark v1',
  version: '1.0.0',
  released: '2026-07-17',
  case_count: cases.length,
  expected_findings_total: cases.reduce((n, c) => n + c.expected_findings.length, 0),
  languages: [...new Set(cases.map((c) => c.language))].sort(),
  categories: [...new Set(cases.map((c) => c.category))].sort(),
  description:
    'A public, hand-labeled benchmark for measuring whether code review / security analysis tools catch known issues. Each case is a small, self-contained code snippet with one or more hand-labeled expected findings. Cases are synthetic and intentionally reproducible by anyone, anywhere.',
  scoring_method: {
    catch_rate: 'matched ground-truth issues / total expected issues',
    precision: 'matched issues / (matched + false positives + redundant matches)',
    f1: 'harmonic mean of catch rate and precision',
    false_positives: 'reviewer findings with empty matched_ground_truth',
    redundant_matches: 'repeated matches to an issue already caught in the same case',
  },
  license:
    'CC0 1.0 Universal (Public Domain Dedication). Attribution appreciated but not required.',
  cases,
};

fs.mkdirSync(path.join(LANDING_PUBLIC, 'benchmark'), { recursive: true });
fs.writeFileSync(
  path.join(LANDING_PUBLIC, 'benchmark', 'codevetter-benchmark-v1.json'),
  `${JSON.stringify(dataset, null, 2)}\n`
);

const REVIEWERS = [
  { name: 'codevetter', scoreFile: '/tmp/cv-score.json' },
  { name: 'raw-claude', scoreFile: '/tmp/rc-score.json' },
];
const results = {};
for (const { name, scoreFile } of REVIEWERS) {
  if (!fs.existsSync(scoreFile)) {
    console.warn(`[skip] ${scoreFile} not found — run the scorer with --json first`);
    continue;
  }
  const score = JSON.parse(fs.readFileSync(scoreFile, 'utf8'));
  results[name] = {
    reviewer: name,
    overall: score.overall,
    cases: score.cases.map((c) => ({
      id: c.id,
      title: c.title,
      language: c.language,
      expected: c.expected,
      caught: c.caughtCount,
      missed: c.missed.length,
      false_positives: c.falsePositives,
      redundant: c.redundant,
      catch_rate: c.catchRate,
    })),
  };
}

fs.mkdirSync(LANDING_DATA, { recursive: true });
fs.writeFileSync(
  path.join(LANDING_DATA, 'benchmark-results.json'),
  `${JSON.stringify(results, null, 2)}\n`
);

console.log('Dataset cases:', cases.length);
console.log('Expected findings:', dataset.expected_findings_total);
console.log('Wrote public/benchmark/codevetter-benchmark-v1.json');
console.log('Wrote src/data/benchmark-results.json');
