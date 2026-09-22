#!/usr/bin/env node
// Regenerates apps/landing-page-astro/src/data/xray-examples.json from the
// public catch-rate benchmark corpus (label.json per case) joined with the
// published benchmark results. Hand-written entries in the existing file are
// preserved verbatim; every other case gets a generated entry so each of the
// 27 adjudicated cases has its own evidence page at /xray/<id>.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CASES_DIR = join(ROOT, 'benchmarks/public-catch-rate/cases');
const RESULTS = join(ROOT, 'apps/landing-page-astro/src/data/benchmark-results.json');
const OUT = join(ROOT, 'apps/landing-page-astro/src/data/xray-examples.json');
const API_AI = join(ROOT, 'apps/landing-page-astro/public/api-ai.json');

const results = JSON.parse(readFileSync(RESULTS, 'utf8'));
const byId = new Map(results.codevetter.cases.map((c) => [c.id, c]));
const existing = existsSync(OUT)
  ? new Map(JSON.parse(readFileSync(OUT, 'utf8')).map((e) => [e.id, e]))
  : new Map();

const entries = [];
for (const dir of readdirSync(CASES_DIR).sort()) {
  const labelPath = join(CASES_DIR, dir, 'label.json');
  if (!existsSync(labelPath)) continue;
  const label = JSON.parse(readFileSync(labelPath, 'utf8'));
  if (existing.has(label.id)) {
    entries.push(existing.get(label.id));
    continue;
  }
  const truth = label.ground_truth[0];
  const measured = byId.get(label.id);
  entries.push({
    id: label.id,
    title: label.title,
    language: label.language,
    category: label.category,
    source: `codevetter-public-benchmark/${label.id}`,
    corpusState: 'benchmark_ground_truth',
    outcome: measured && measured.caught > 0 ? 'detected' : 'missed',
    confidence: 'benchmark',
    score: measured ? Math.round(measured.catch_rate * 100) : null,
    finding: {
      severity: truth.severity,
      title: truth.type.replace(/_/g, ' '),
      summary: truth.description,
      file: truth.location.file,
      line: truth.location.lines[0],
    },
  });
}

writeFileSync(OUT, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');

// Every public route must appear in /api/ai's surface catalog (enforced by
// scripts/verify-agent-surfaces.mjs in the deploy workflow).
const catalog = JSON.parse(readFileSync(API_AI, 'utf8'));
const known = new Set(catalog.surfaces.map((s) => s.id));
for (const entry of entries) {
  const id = `xray-${entry.id}`;
  if (known.has(id)) continue;
  catalog.surfaces.push({
    id,
    url: `https://codevetter.com/xray/${entry.id}`,
    md: `https://codevetter.com/xray/${entry.id}.md`,
    kind: 'static',
    description: `Adjudicated ${entry.language} ${String(entry.finding.title).toLowerCase()} example`,
  });
}
writeFileSync(API_AI, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(
  `xray-examples.json: ${entries.length} cases (${existing.size} preserved, ${entries.length - existing.size} generated)`
);
