#!/usr/bin/env node
// Frontend bundle-size budget — the third leg of the perf harness.
// Reports raw + gzipped size of every built JS chunk, flags anything over
// budget, and exits non-zero so it can gate CI. Run after `npm run build`:
//
//   npm run build && npm run bench:bundle
//
// Budgets are raw (pre-gzip) KB. Bump them deliberately when a real feature
// justifies it — that edit is the record of an intentional size increase.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'assets');

// Raw-KB budgets. Per-chunk guards lazy routes; total guards the whole app.
const PER_CHUNK_KB = 450; // largest single chunk (currently the vendor/index entry)
const TOTAL_KB = 1200; // sum of all JS

function kb(bytes) {
  return bytes / 1024;
}

let files;
try {
  files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js'));
} catch {
  console.error(`✖ No build output at ${ASSETS_DIR}. Run \`npm run build\` first.`);
  process.exit(2);
}

const chunks = files
  .map((name) => {
    const raw = statSync(join(ASSETS_DIR, name)).size;
    const gz = gzipSync(readFileSync(join(ASSETS_DIR, name))).length;
    return { name, raw, gz };
  })
  .sort((a, b) => b.raw - a.raw);

const totalRaw = chunks.reduce((s, c) => s + c.raw, 0);
const totalGz = chunks.reduce((s, c) => s + c.gz, 0);

console.log('\nJS bundle budget\n');
console.log(`${'chunk'.padEnd(34)}${'raw KB'.padStart(10)}${'gzip KB'.padStart(10)}`);
console.log('-'.repeat(54));
for (const c of chunks.slice(0, 12)) {
  const over = kb(c.raw) > PER_CHUNK_KB ? '  ⚠ over' : '';
  console.log(
    `${c.name.padEnd(34)}${kb(c.raw).toFixed(1).padStart(10)}${kb(c.gz).toFixed(1).padStart(10)}${over}`
  );
}
if (chunks.length > 12) console.log(`… and ${chunks.length - 12} more chunks`);
console.log('-'.repeat(54));
console.log(
  `${'TOTAL'.padEnd(34)}${kb(totalRaw).toFixed(1).padStart(10)}${kb(totalGz).toFixed(1).padStart(10)}`
);

const failures = [];
const biggest = chunks[0];
if (kb(biggest.raw) > PER_CHUNK_KB) {
  failures.push(
    `chunk ${biggest.name} is ${kb(biggest.raw).toFixed(0)} KB (budget ${PER_CHUNK_KB} KB)`
  );
}
if (kb(totalRaw) > TOTAL_KB) {
  failures.push(`total JS is ${kb(totalRaw).toFixed(0)} KB (budget ${TOTAL_KB} KB)`);
}

console.log('');
if (failures.length) {
  for (const f of failures) console.error(`✖ ${f}`);
  process.exit(1);
}
console.log(`✓ within budget (per-chunk ≤ ${PER_CHUNK_KB} KB, total ≤ ${TOTAL_KB} KB)\n`);
