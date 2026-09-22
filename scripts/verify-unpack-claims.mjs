#!/usr/bin/env node
// Verifies every cited source path in analyzed corpus records against the
// pinned clone on disk. With --prune, drops claims whose sources don't all
// resolve (they'd 404 as GitHub links) and reports what was removed.
//
//   node scripts/verify-unpack-claims.mjs --clones /tmp/unpack-pilot [--prune]

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

for (const file of readdirSync(CORPUS).filter((f) => f.endsWith('.json'))) {
  const record = JSON.parse(readFileSync(join(CORPUS, file), 'utf8'));
  if (!record.report) continue;
  const clone = join(clonesDir, CLONE_NAMES[record.slug] ?? record.slug);
  let total = 0;
  let bad = 0;
  let dropped = 0;
  for (const section of Object.values(record.report)) {
    if (typeof section !== 'object' || !section?.claims) continue;
    for (const claim of section.claims) {
      for (const source of claim.sources ?? []) {
        total += 1;
        if (!existsSync(join(clone, normalize(source)))) bad += 1;
      }
    }
    if (prune) {
      const kept = section.claims.filter((c) =>
        (c.sources ?? []).every((s) => existsSync(join(clone, normalize(s))))
      );
      dropped += section.claims.length - kept.length;
      section.claims = kept;
    }
  }
  if (bad || prune) {
    console.log(
      `${record.slug}: ${total} cited, ${bad} unresolvable${dropped ? `, ${dropped} claims dropped` : ''}`
    );
    if (prune && dropped)
      writeFileSync(join(CORPUS, file), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  }
}
