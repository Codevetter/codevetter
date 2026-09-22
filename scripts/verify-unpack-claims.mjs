#!/usr/bin/env node
// Verifies every cited source path in analyzed corpus records against the
// pinned commit object in the local clone — `git cat-file -e <sha>:<path>`
// proves the file existed at the scanned commit and rejects `../` traversal,
// later-revision-only files, and untracked working-tree files. With --prune,
// drops claims whose sources don't all resolve and exits nonzero if any
// section was emptied.
//
//   node scripts/verify-unpack-claims.mjs --clones /tmp/unpack-pilot [--prune]

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CORPUS = join(ROOT, 'benchmarks/repo-unpacks');
const args = process.argv.slice(2);
const clonesDir = args[args.indexOf('--clones') + 1] ?? '/tmp/unpack-pilot';
const prune = args.includes('--prune');
const CLONE_NAMES = { httpie: 'cli', jsonwebtoken: 'node-jsonwebtoken' };

const normalize = (s) =>
  s
    .split('#')[0]
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, '');

const safePath = (p) => p && !p.startsWith('/') && !p.split('/').includes('..');
const pinnedExists = (clone, sha, p) => {
  if (!safePath(p)) return false;
  try {
    execFileSync('git', ['-C', clone, 'cat-file', '-e', `${sha}:${p}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

let failures = 0;
for (const file of readdirSync(CORPUS).filter((f) => f.endsWith('.json'))) {
  const record = JSON.parse(readFileSync(join(CORPUS, file), 'utf8'));
  if (!record.report) continue;
  const clone = join(clonesDir, CLONE_NAMES[record.slug] ?? record.slug);
  const sha = record.scan?.inventory?.commit_sha;
  if (!sha) {
    console.log(`${record.slug}: no pinned commit — skipped`);
    continue;
  }
  const head = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  if (head !== sha) {
    console.log(
      `${record.slug}: clone at ${head.slice(0, 7)}, scan pinned to ${sha.slice(0, 7)} — skipped`
    );
    continue;
  }
  let total = 0;
  let bad = 0;
  let dropped = 0;
  for (const section of Object.values(record.report)) {
    if (typeof section !== 'object' || !section?.claims) continue;
    for (const claim of section.claims) {
      for (const source of claim.sources ?? []) {
        total += 1;
        if (!pinnedExists(clone, sha, normalize(source))) bad += 1;
      }
    }
    if (prune) {
      const kept = section.claims.filter((c) =>
        (c.sources ?? []).every((s) => pinnedExists(clone, sha, normalize(s)))
      );
      dropped += section.claims.length - kept.length;
      section.claims = kept;
    }
  }
  if (bad || dropped) {
    console.log(
      `${record.slug}: ${total} cited, ${bad} unresolvable${dropped ? `, ${dropped} claims dropped` : ''}`
    );
    if (bad) failures += 1;
    if (prune && dropped)
      writeFileSync(join(CORPUS, file), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  }
}
if (failures) {
  console.error(`${failures} record(s) with unresolvable citations`);
  process.exit(1);
}
