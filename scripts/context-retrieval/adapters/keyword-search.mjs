#!/usr/bin/env node

// The honest baseline: what a competent agent already does with grep over the
// repository at the pre-fix revision. Any context provider has to beat this,
// not "no context at all".

import { execFileSync } from 'node:child_process';

export const RETRIEVAL_RESPONSE_SCHEMA_VERSION = 'codevetter.context-retrieval-response.v1';

const MAX_FILE_BYTES = 512 * 1024;

const CODE_PATHSPEC = [
  '*.ts',
  '*.tsx',
  '*.mjs',
  '*.js',
  '*.rs',
  '*.astro',
  '*.py',
  '*.go',
  '*.swift',
  '*.sql',
  '*.json',
];

export function retrieveByKeyword({
  repo,
  revision,
  query,
  queryTokens,
  limit = 20,
  maxFileBytes = MAX_FILE_BYTES,
}) {
  const started = process.hrtime.bigint();
  const tokens = [...queryTokens].sort();
  const hits = new Map();
  for (const token of tokens) {
    for (const path of grepFiles(repo, revision, token)) {
      const entry = hits.get(path) ?? { path, tokens: new Set() };
      entry.tokens.add(token);
      hits.set(path, entry);
    }
  }
  // A competent agent does not read a 20MB data blob because one token matched.
  // Without this the baseline's token cost is dominated by vendored data.
  const sizes = fileSizes(repo, revision, [...hits.keys()]);
  const oversized = [...hits.keys()].filter((path) => (sizes.get(path) ?? 0) > maxFileBytes);
  for (const path of oversized) hits.delete(path);
  const ranked = [...hits.values()]
    .map((entry) => ({ path: entry.path, matched: entry.tokens.size }))
    // Distinct query terms matched first; shorter paths break ties so that a
    // module beats an incidental mention deep in a generated tree.
    .sort(
      (left, right) =>
        right.matched - left.matched ||
        left.path.split('/').length - right.path.split('/').length ||
        left.path.localeCompare(right.path)
    )
    .slice(0, limit);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    schema_version: RETRIEVAL_RESPONSE_SCHEMA_VERSION,
    provider_id: 'keyword-search',
    provider_version: gitVersion(repo),
    query,
    indexed_revision: revision,
    files: ranked.map((entry) => entry.path),
    ranking: ranked,
    tokens_delivered: Math.ceil(
      ranked.reduce((total, entry) => total + (sizes.get(entry.path) ?? 0), 0) / 4
    ),
    latency_ms: Math.round(elapsedMs * 1000) / 1000,
    candidates_considered: hits.size,
    oversized_skipped: oversized.sort(),
  };
}

function grepFiles(repo, revision, token) {
  try {
    const output = execFileSync(
      'git',
      [
        '-C',
        repo,
        'grep',
        '--name-only',
        '--fixed-strings',
        '--ignore-case',
        '-e',
        token,
        revision,
        '--',
        ...CODE_PATHSPEC,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(line.indexOf(':') + 1));
  } catch (error) {
    // git grep exits 1 when a pattern matches nothing; that is not a failure.
    if (error?.status === 1) return [];
    throw error;
  }
}

// One `cat-file --batch-check` per query instead of one process per candidate.
function fileSizes(repo, revision, paths) {
  const sizes = new Map();
  if (paths.length === 0) return sizes;
  const output = execFileSync('git', ['-C', repo, 'cat-file', '--batch-check'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    input: `${paths.map((path) => `${revision}:${path}`).join('\n')}\n`,
  });
  for (const [index, line] of output.split('\n').filter(Boolean).entries()) {
    const parts = line.trim().split(/\s+/);
    const size = parts.length >= 3 ? Number.parseInt(parts[2], 10) : 0;
    sizes.set(paths[index], Number.isFinite(size) ? size : 0);
  }
  return sizes;
}

function gitVersion(repo) {
  return execFileSync('git', ['-C', repo, '--version'], { encoding: 'utf8' }).trim();
}
