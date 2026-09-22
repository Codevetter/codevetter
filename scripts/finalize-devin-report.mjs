#!/usr/bin/env node
// Merges a Devin-produced report JSON into a corpus record after validating
// structure and verifying every cited source exists in the pinned clone.
//
//   node scripts/finalize-devin-report.mjs <slug> --clone <path> --report <path>

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { gitHeadSha, repoUnpackCorpusPath } from './repo-unpack-corpus.mjs';
const [slug, ...rest] = process.argv.slice(2);
const get = (f) => {
  const i = rest.indexOf(f);
  return i < 0 ? undefined : rest[i + 1];
};
const cloneDir = get('--clone');
const reportPath = get('--report');
const runtimeMs = Number(get('--runtime-ms') ?? 0);
const model = get('--model') ?? 'swe-2';
if (!slug || !cloneDir || !reportPath) {
  console.error(
    'usage: node scripts/finalize-devin-report.mjs <slug> --clone <path> --report <path>'
  );
  process.exit(1);
}

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

const corpusPath = repoUnpackCorpusPath(slug);
const record = JSON.parse(readFileSync(corpusPath, 'utf8'));
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const headSha = gitHeadSha(cloneDir);
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

// Citations must resolve against the pinned commit object — `git cat-file -e
// <sha>:<path>` rejects `../` traversal, files that only exist at a different
// revision, and untracked working-tree files alike.
const safePath = (p) => p && !p.startsWith('/') && !p.split('/').includes('..');
const pinnedExists = (p) => {
  if (!safePath(p)) return false;
  try {
    execFileSync('git', ['-C', cloneDir, 'cat-file', '-e', `${headSha}:${p}`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
};

let total = 0;
let bad = 0;
let dropped = 0;
for (const key of SECTIONS) {
  for (const claim of report[key].claims) {
    claim.sources = (claim.sources ?? []).map((s) => {
      const path = s
        .split('#')[0]
        .trim()
        .replace(/\s*\([^)]*\)\s*$/, '');
      return s.includes('#L') ? `${path}#L${s.split('#L')[1]}` : path;
    });
    for (const src of claim.sources) {
      total += 1;
      if (!pinnedExists(src.split('#')[0])) bad += 1;
    }
  }
  const kept = report[key].claims.filter((c) =>
    (c.sources ?? []).every((s) => pinnedExists(s.split('#')[0]))
  );
  dropped += report[key].claims.length - kept.length;
  report[key].claims = kept;
}
console.log(
  `${record.repo}: ${total} citations, ${bad} unresolvable${dropped ? `, ${dropped} claims dropped` : ''}`
);
if (total === 0 || SECTIONS.some((k) => report[k].claims.length === 0)) {
  console.error(`${slug}: report unusable after pruning — not merging`);
  process.exit(1);
}

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
