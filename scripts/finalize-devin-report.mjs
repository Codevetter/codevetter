#!/usr/bin/env node
// Merges a Devin-produced report JSON into a corpus record after validating
// structure and verifying every cited source exists in the pinned clone.
//
//   node scripts/finalize-devin-report.mjs <slug> --clone <path> --report <path>

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CORPUS = join(ROOT, 'benchmarks/repo-unpacks');
const [slug, ...rest] = process.argv.slice(2);
const get = (f) => rest[rest.indexOf(f) + 1];
const cloneDir = get('--clone');
const reportPath = get('--report');
const runtimeMs = Number(get('--runtime-ms') ?? 0);
const model = get('--model') ?? 'swe-2';

const SECTIONS = [
  'system_map',
  'feature_catalog',
  'data_flow',
  'behavior_traces',
  'testing_signals',
  'risk_map',
  'extension_points',
  'agent_handoff',
];

const corpusPath = join(CORPUS, `${slug}.json`);
const record = JSON.parse(readFileSync(corpusPath, 'utf8'));
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const headSha = execFileSync('git', ['-C', cloneDir, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
if (headSha !== record.scan.inventory.commit_sha) {
  console.error(`${slug}: clone not at scanned commit — refusing`);
  process.exit(1);
}
if (!report.overview) {
  console.error(`${slug}: report missing overview`);
  process.exit(1);
}
const missing = SECTIONS.filter((s) => !report[s]?.claims);
if (missing.length) {
  console.error(`${slug}: report missing sections: ${missing.join(', ')}`);
  process.exit(1);
}

let total = 0;
let bad = 0;
for (const key of SECTIONS) {
  for (const claim of report[key].claims) {
    claim.sources = (claim.sources ?? []).map(
      (s) =>
        s
          .split('#')[0]
          .trim()
          .replace(/\s*\([^)]*\)\s*$/, '') + (s.includes('#L') ? `#L${s.split('#L')[1]}` : '')
    );
    for (const src of claim.sources) {
      total += 1;
      if (!existsSync(join(cloneDir, src.split('#')[0]))) bad += 1;
    }
  }
}
console.log(`${record.repo}: ${total} citations, ${bad} unresolvable`);
if (total === 0) process.exit(1);

record.report = report;
record.analysis = {
  agent: 'devin',
  model,
  runtime_ms: runtimeMs,
  cost_usd: null,
  collected_at: new Date().toISOString(),
};
writeFileSync(corpusPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
console.log(`${record.repo}: devin report merged`);
