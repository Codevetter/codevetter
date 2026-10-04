#!/usr/bin/env node
// Collects a Repo Unpack scan receipt for a public GitHub repository into
// benchmarks/repo-unpacks/<slug>.json. Adds evidence metadata (cli version,
// scan date, last upstream commit) that the landing pages display.
//
//   node scripts/collect-unpack-repo.mjs <org/repo> [slug]
//
// The scan layer is deterministic — no model calls. The `report` field is
// populated by the heavier analysis pass, which can be run later without
// changing the page contract.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CORPUS = join(ROOT, 'benchmarks/repo-unpacks');

const [repo, ...args] = process.argv.slice(2);
const slugArg = args[0]?.startsWith('--') ? undefined : args.shift();
let cloneDirectory = null;
let cli = 'codevetter';
for (let index = 0; index < args.length; index += 2) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error('missing option value');
  if (args[index] === '--clone') cloneDirectory = resolve(value);
  else if (args[index] === '--cli') cli = resolve(value);
  else throw new Error(`unknown option: ${args[index]}`);
}
if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
  console.error(
    'usage: node scripts/collect-unpack-repo.mjs <org/repo> [slug] [--clone <clean-clone>] [--cli <binary>]'
  );
  process.exit(1);
}
const slug =
  slugArg ??
  repo
    .split('/')[1]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error(`invalid slug ${JSON.stringify(slug)} — must match /^[a-z0-9][a-z0-9-]*$/`);
  process.exit(1);
}

const work = cloneDirectory ? null : mkdtempSync(join(tmpdir(), 'unpack-pilot-'));
const clone = cloneDirectory ?? join(work, slug);
try {
  if (!cloneDirectory)
    execFileSync('git', ['clone', '--depth', '50', `https://github.com/${repo}.git`, clone], {
      stdio: 'pipe',
    });
  if (!existsSync(join(clone, '.git'))) throw new Error('clone is not a Git checkout');
  const status = execFileSync('git', ['-C', clone, 'status', '--porcelain'], {
    encoding: 'utf8',
  }).trim();
  if (status) throw new Error('refusing to collect a dirty clone');
  const remote = execFileSync('git', ['-C', clone, 'remote', 'get-url', 'origin'], {
    encoding: 'utf8',
  }).trim();
  if (remote.toLowerCase() !== `https://github.com/${repo}.git`.toLowerCase())
    throw new Error('clone remote does not match requested repository');
  const logLine = execFileSync('git', ['-C', clone, 'log', '-1', '--format=%H|%cs|%s'], {
    encoding: 'utf8',
  }).trim();
  const firstPipe = logLine.indexOf('|');
  const secondPipe = logLine.indexOf('|', firstPipe + 1);
  const lastCommit = {
    sha: logLine.slice(0, firstPipe),
    date: logLine.slice(firstPipe + 1, secondPipe),
    subject: logLine.slice(secondPipe + 1),
  };
  const version = execFileSync(cli, ['--version'], { encoding: 'utf8' }).trim();
  const receipt = JSON.parse(
    execFileSync(cli, ['unpack', '--operation', 'scan', '--repo', clone, '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  );
  if (receipt.inventory?.commit_sha !== lastCommit.sha)
    throw new Error('scan and clone revision differ');

  const record = {
    schema_version: 'codevetter.repo-unpack-corpus/v1',
    repo,
    slug,
    codevetter_version: version,
    collected_at: new Date().toISOString(),
    last_commit: lastCommit,
    scan: receipt,
  };
  mkdirSync(CORPUS, { recursive: true });
  const out = join(CORPUS, `${slug}.json`);
  writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(
    `${repo} → ${out} (${record.scan.inventory.files_scanned} files, commit ${lastCommit.sha.slice(0, 7)})`
  );
} finally {
  if (work) rmSync(work, { recursive: true, force: true });
}
