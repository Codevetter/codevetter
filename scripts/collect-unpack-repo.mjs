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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CORPUS = join(ROOT, 'benchmarks/repo-unpacks');

const [repo, slugArg] = process.argv.slice(2);
if (!repo || !repo.includes('/')) {
  console.error('usage: node scripts/collect-unpack-repo.mjs <org/repo> [slug]');
  process.exit(1);
}
const slug =
  slugArg ??
  repo
    .split('/')[1]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');

const work = mkdtempSync(join(tmpdir(), 'unpack-pilot-'));
try {
  execFileSync(
    'git',
    ['clone', '--depth', '50', `https://github.com/${repo}.git`, join(work, slug)],
    {
      stdio: 'pipe',
    }
  );
  const logLine = execFileSync('git', ['-C', join(work, slug), 'log', '-1', '--format=%H|%cs|%s'], {
    encoding: 'utf8',
  }).trim();
  const firstPipe = logLine.indexOf('|');
  const secondPipe = logLine.indexOf('|', firstPipe + 1);
  const lastCommit = {
    sha: logLine.slice(0, firstPipe),
    date: logLine.slice(firstPipe + 1, secondPipe),
    subject: logLine.slice(secondPipe + 1),
  };
  const version = execFileSync('codevetter', ['--version'], { encoding: 'utf8' }).trim();
  const receipt = JSON.parse(
    execFileSync(
      'codevetter',
      ['unpack', '--operation', 'scan', '--repo', join(work, slug), '--json'],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }
    )
  );

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
  rmSync(work, { recursive: true, force: true });
}
