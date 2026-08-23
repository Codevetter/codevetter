#!/usr/bin/env node

// What a coding agent already does for free, before any provider is installed.
//
// `keyword-search` alone understates the default: agents also guess filenames from
// the task ("auth" -> look for auth.ts) and combine that with content search. This
// adapter models the realistic default as reciprocal-rank fusion of two free
// signals — content grep and filename match — which is the bar a paid or installed
// provider actually has to clear.

import { execFileSync } from 'node:child_process';

import { retrieveByKeyword } from './keyword-search.mjs';

import { isCandidateFile } from '../paths.mjs';

// Standard RRF constant; damps the influence of any single ranking's tail.
const RRF_K = 60;

const MAX_FILE_BYTES = 512 * 1024;

export function retrieveByFilename({ repo, revision, query, queryTokens = [], limit = 20 }) {
  const started = process.hrtime.bigint();
  const tokens = new Set(queryTokens);
  const scored = listFiles(repo, revision)
    .map((path) => ({ path, overlap: countOverlap(path, tokens) }))
    .filter((entry) => entry.overlap > 0)
    // More matched terms first; shallower paths break ties, as a human would guess.
    .sort(
      (left, right) =>
        right.overlap - left.overlap ||
        left.path.split('/').length - right.path.split('/').length ||
        left.path.localeCompare(right.path)
    )
    .slice(0, limit);
  const sizes = fileSizes(
    repo,
    revision,
    scored.map((entry) => entry.path)
  );
  return {
    provider_id: 'filename-match',
    query,
    indexed_revision: revision,
    files: scored.map((entry) => entry.path),
    ranking: scored.map((entry, index) => ({ ...entry, rank: index + 1 })),
    tokens_delivered: Math.ceil(
      scored.reduce((total, entry) => total + (sizes.get(entry.path) ?? 0), 0) / 4
    ),
    payload_kind: 'whole-files',
    latency_ms: elapsed(started),
  };
}

export function retrieveAgentDefault({ repo, revision, query, queryTokens = [], limit = 20 }) {
  const started = process.hrtime.bigint();
  const grep = retrieveByKeyword({ repo, revision, query, queryTokens, limit: limit * 2 });
  const names = retrieveByFilename({ repo, revision, query, queryTokens, limit: limit * 2 });

  const fused = new Map();
  for (const ranking of [grep.files, names.files]) {
    for (const [index, path] of ranking.entries()) {
      const entry = fused.get(path) ?? { path, score: 0, sources: [] };
      entry.score += 1 / (RRF_K + index + 1);
      fused.set(path, entry);
    }
  }
  for (const path of grep.files) fused.get(path).sources.push('content');
  for (const path of names.files) fused.get(path).sources.push('filename');

  const ordered = [...fused.values()]
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit);
  const sizes = fileSizes(
    repo,
    revision,
    ordered.map((entry) => entry.path)
  );
  return {
    provider_id: 'agent-default',
    query,
    indexed_revision: revision,
    files: ordered.map((entry) => entry.path),
    ranking: ordered.map((entry, index) => ({ ...entry, rank: index + 1 })),
    tokens_delivered: Math.ceil(
      ordered.reduce((total, entry) => total + (sizes.get(entry.path) ?? 0), 0) / 4
    ),
    payload_kind: 'whole-files',
    latency_ms: elapsed(started),
    fusion: { rrf_k: RRF_K, content_hits: grep.files.length, filename_hits: names.files.length },
  };
}

function countOverlap(path, tokens) {
  const parts = path
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => part.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' '))
    .map((part) => part.toLowerCase())
    .filter(Boolean);
  return new Set(parts.filter((part) => tokens.has(part))).size;
}

function listFiles(repo, revision) {
  try {
    return execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', revision], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
      .split('\n')
      .filter((path) => path && isCandidateFile(path));
  } catch {
    return [];
  }
}

function fileSizes(repo, revision, paths) {
  const sizes = new Map();
  if (paths.length === 0) return sizes;
  try {
    const output = execFileSync('git', ['-C', repo, 'cat-file', '--batch-check'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      input: `${paths.map((path) => `${revision}:${path}`).join('\n')}\n`,
    });
    for (const [index, line] of output.split('\n').filter(Boolean).entries()) {
      const parts = line.trim().split(/\s+/);
      const size = parts.length >= 3 ? Number.parseInt(parts[2], 10) : 0;
      // Same cap as the keyword baseline: no agent reads a huge data blob whole.
      sizes.set(paths[index], Number.isFinite(size) && size <= MAX_FILE_BYTES ? size : 0);
    }
  } catch {
    // Missing sizes contribute nothing rather than failing the run.
  }
  return sizes;
}

function elapsed(started) {
  return Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 1000) / 1000;
}
