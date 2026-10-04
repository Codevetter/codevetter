#!/usr/bin/env node
// Verifies every cited source path in analyzed corpus records against the
// pinned commit object in the local clone — `git cat-file -e <sha>:<path>`
// proves the file existed at the scanned commit and rejects `../` traversal,
// later-revision-only files, and untracked working-tree files. With --prune,
// drops claims whose sources don't all resolve and exits nonzero if any
// section was emptied.
//
//   node scripts/verify-unpack-claims.mjs --clones /tmp/unpack-pilot [--prune]
//   node scripts/verify-unpack-claims.mjs --clones <retained-clones> --strict --slug <slug>
// --strict also requires exact line anchors within pinned text blobs; it is
// read-only and does not establish semantic correctness or runtime behavior.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateUnpackCitations } from './repo-unpack-corpus.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const CORPUS = join(ROOT, 'benchmarks/repo-unpacks');
const args = process.argv.slice(2);
let clonesDir = '/tmp/unpack-pilot';
let prune = false;
let strict = false;
const slugs = new Set();
for (let index = 0; index < args.length; index += 1) {
  const option = args[index];
  if (option === '--prune') prune = true;
  else if (option === '--strict') strict = true;
  else if (option === '--clones' || option === '--slug') {
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${option}`);
    if (option === '--clones') clonesDir = value;
    else {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error('invalid slug');
      slugs.add(value);
    }
  } else throw new Error(`unknown option: ${option}`);
}
if (strict && prune)
  throw new Error('--strict is read-only; review failed citations before repairing');
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
const found = new Set();
for (const file of readdirSync(CORPUS).filter((f) => f.endsWith('.json'))) {
  if (slugs.size && !slugs.has(file.slice(0, -5))) continue;
  const record = JSON.parse(readFileSync(join(CORPUS, file), 'utf8'));
  found.add(record.slug);
  if (!record.report) {
    if (strict) {
      console.error(`${record.slug}: missing analysis report`);
      failures += 1;
    }
    continue;
  }
  const clone = join(clonesDir, CLONE_NAMES[record.slug] ?? record.slug);
  const sha = record.scan?.inventory?.commit_sha;
  if (!sha) {
    console.error(`${record.slug}: no pinned commit`);
    failures += 1;
    continue;
  }
  let head;
  try {
    head = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    console.error(`${record.slug}: clone missing or unreadable`);
    failures += 1;
    continue;
  }
  if (head !== sha) {
    console.log(`${record.slug}: clone at ${head.slice(0, 7)}, scan pinned to ${sha.slice(0, 7)}`);
    failures += 1;
    continue;
  }
  if (strict) {
    const errors = validateUnpackCitations(record.report, clone, sha);
    if (errors.length) {
      console.error(`${record.slug}: ${errors.join('; ')}`);
      failures += 1;
    } else
      console.log(`${record.slug}: pinned paths and line bounds passed; semantics not established`);
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
for (const slug of slugs) {
  if (!found.has(slug)) {
    console.error(`${slug}: corpus record missing`);
    failures += 1;
  }
}
if (failures) {
  console.error(`${failures} record(s) failed citation verification`);
  process.exit(1);
}
