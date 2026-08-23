#!/usr/bin/env node

// Null controls. These do no retrieval at all, so they calibrate how much of a
// provider's score comes from understanding the query versus from the shape of the
// benchmark itself.
//
// - random-files : the floor from coverage alone. Returning k of a small repo's n
//   files scores k/n by luck. Any provider near this is not retrieving.
// - churn-ranked : the leakage probe. Ground truth is "files a commit changed", and
//   files that changed often before tend to change again. A churn ranker uses ONLY
//   history before the base revision and never reads the query. If it rivals the
//   real providers, the benchmark is rewarding churn prediction, not retrieval.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { isCandidateFile } from '../paths.mjs';
import { elapsed } from './shared.mjs';

// The pool a random draw samples from decides how strong the floor is, and it used to
// be source code only. Widening it to every tracked file is correct — ground truth is
// "the files the fix touched", which includes .rst, .css, .sh, .mod and .webp — but it
// also makes the control WEAKER, by 1.18x on gin and 2.36x on flask, and weaker
// unevenly. A weaker floor flatters every real provider and makes the controls-lose
// gate easier to pass, so both draws are reported rather than picking the flattering
// one: random-files is the honest null (no information at all) and random-code-files is
// the conservative floor a provider ought to have to clear.
const CODE_POOL = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|swift|kt|astro)$/;

function randomDraw({ providerId, repo, revision, query, limit, pool }) {
  const started = process.hrtime.bigint();
  const files = pool
    ? listFiles(repo, revision).filter((path) => pool.test(path))
    : listFiles(repo, revision);
  // Seeded by case identity so the control is reproducible, not luck of the run.
  const seed = createHash('sha256').update(`${revision}:${query}`).digest();
  const ordered = files
    .map((path, index) => ({
      path,
      key: createHash('sha256').update(seed).update(String(index)).digest('hex'),
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
    .slice(0, limit)
    .map((entry) => entry.path);
  return {
    provider_id: providerId,
    query,
    indexed_revision: revision,
    files: ordered,
    ranking: ordered.map((path, index) => ({ path, rank: index + 1 })),
    tokens_delivered: wholeFileTokens(repo, revision, ordered),
    payload_kind: 'control-whole-files',
    latency_ms: elapsed(started),
    corpus_size: files.length,
  };
}

export function retrieveRandomFiles({ repo, revision, query, limit = 20 }) {
  return randomDraw({ providerId: 'random-files', repo, revision, query, limit });
}

// Same draw, restricted to source files. Strictly harder to beat than random-files,
// because the wasted slots (lockfiles, images, generated output) are removed.
export function retrieveRandomCodeFiles({ repo, revision, query, limit = 20 }) {
  return randomDraw({
    providerId: 'random-code-files',
    repo,
    revision,
    query,
    limit,
    pool: CODE_POOL,
  });
}

export function retrieveByChurn({ repo, revision, query, limit = 20 }) {
  const started = process.hrtime.bigint();
  // `git log <revision>` walks ancestors only, so no post-fix information leaks in.
  let output;
  try {
    output = execFileSync(
      'git',
      ['-C', repo, 'log', revision, '--name-only', '--format=', '--no-merges', '--max-count=500'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
  } catch {
    output = '';
  }
  const counts = new Map();
  for (const line of output.split('\n')) {
    const path = line.trim();
    if (!path || !isCandidateFile(path)) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  const present = new Set(listFiles(repo, revision));
  const ordered = [...counts.entries()]
    .filter(([path]) => present.has(path))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([path, changes]) => ({ path, changes }));
  return {
    provider_id: 'churn-ranked',
    query,
    indexed_revision: revision,
    files: ordered.map((entry) => entry.path),
    ranking: ordered,
    tokens_delivered: wholeFileTokens(
      repo,
      revision,
      ordered.map((entry) => entry.path)
    ),
    payload_kind: 'control-whole-files',
    latency_ms: elapsed(started),
    // Recorded to make the point explicit: the query was never read.
    query_used: false,
  };
}

// Controls return paths, not payloads — but an agent handed a path still pays to
// read the file. Charging them the whole-file cost, exactly as the keyword baseline
// is charged, is what keeps the token-budget comparison honest; reporting zero would
// hand every control an unlimited budget and a free win.
function wholeFileTokens(repo, revision, paths) {
  if (paths.length === 0) return 0;
  try {
    const output = execFileSync('git', ['-C', repo, 'cat-file', '--batch-check'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      input: `${paths.map((path) => `${revision}:${path}`).join('\n')}\n`,
    });
    let bytes = 0;
    for (const line of output.split('\n').filter(Boolean)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const size = Number.parseInt(parts[2], 10);
        if (Number.isFinite(size)) bytes += size;
      }
    }
    return Math.ceil(bytes / 4);
  } catch {
    return 0;
  }
}

function listFiles(repo, revision) {
  try {
    return execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', revision], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter((path) => path && isCandidateFile(path));
  } catch {
    return [];
  }
}
