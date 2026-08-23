#!/usr/bin/env node

// codesearch (github.com/flupkede/codesearch): hybrid BM25 + local vector search
// over tree-sitter AST chunks. Fully offline, models bundled, no API key.
//
// Same revision trap as the other indexers: it reads the filesystem, so each case
// is indexed in a worktree materialized at its own base revision.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const PROVIDER_ID = 'codesearch';

export function createCodesearchAdapter({ binary, worktreeRoot, indexRoot, rerank = false }) {
  if (!existsSync(binary)) throw new Error(`codesearch binary not found: ${binary}`);
  mkdirSync(worktreeRoot, { recursive: true });
  mkdirSync(indexRoot, { recursive: true });

  return function retrieveByCodesearch({ repo, revision, query, limit = 20 }) {
    const started = process.hrtime.bigint();
    const repoId = repo.replace(/\/+$/, '').split('/').pop();
    const worktree = join(worktreeRoot, `${repoId}-${revision.slice(0, 12)}`);
    // The index lives beside the worktree, so it must be rebuilt per revision.
    rmSync(worktree, { recursive: true, force: true });
    try {
      run('git', ['-C', repo, 'worktree', 'add', '--detach', '--force', worktree, revision]);
    } catch (error) {
      return unavailable({ query, revision, started, reason: `worktree-failed: ${first(error)}` });
    }

    try {
      run(binary, ['index', 'add', worktree], { cwd: worktree, env: indexEnv(indexRoot) });
      const args = [
        'search',
        query,
        '--path',
        worktree,
        '--json',
        '--quiet',
        '--max-results',
        String(limit),
      ];
      if (rerank) args.push('--rerank');
      const output = run(binary, args, { cwd: worktree, env: indexEnv(indexRoot) });
      return parseResponse({ output, query, revision, started, worktree, limit });
    } catch (error) {
      return unavailable({ query, revision, started, reason: `search-failed: ${first(error)}` });
    } finally {
      rmSync(worktree, { recursive: true, force: true });
      try {
        run('git', ['-C', repo, 'worktree', 'prune']);
      } catch {
        // Best-effort bookkeeping.
      }
    }
  };
}

function parseResponse({ output, query, revision, started, worktree, limit }) {
  let document;
  try {
    document = JSON.parse(output.slice(output.indexOf('{') >= 0 ? output.indexOf('{') : 0));
  } catch {
    // Fall back to the object/array boundary the JSON actually starts at.
    const start = Math.min(
      ...['{', '['].map((token) =>
        output.indexOf(token) === -1 ? Infinity : output.indexOf(token)
      )
    );
    if (!Number.isFinite(start)) {
      return unavailable({ query, revision, started, reason: 'unparseable-json' });
    }
    try {
      document = JSON.parse(output.slice(start));
    } catch {
      return unavailable({ query, revision, started, reason: 'unparseable-json' });
    }
  }
  const rows = Array.isArray(document)
    ? document
    : (document.results ?? document.matches ?? document.hits ?? []);
  const ordered = [];
  const seen = new Set();
  let chunkBytes = 0;
  for (const row of rows) {
    const raw = row?.path ?? row?.file ?? row?.file_path ?? row?.relative_path;
    if (typeof raw !== 'string') continue;
    chunkBytes += Buffer.byteLength(row?.snippet ?? row?.content ?? '');
    // Paths may be absolute inside the throwaway worktree; report repo-relative.
    const path = raw.startsWith(worktree) ? raw.slice(worktree.length).replace(/^\/+/, '') : raw;
    if (seen.has(path)) continue;
    seen.add(path);
    ordered.push({ path, rank: ordered.length + 1, score: row?.score ?? null });
  }
  return {
    provider_id: PROVIDER_ID,
    query,
    indexed_revision: revision,
    files: ordered.slice(0, limit).map((entry) => entry.path),
    ranking: ordered.slice(0, limit),
    tokens_delivered: Math.ceil(chunkBytes / 4),
    payload_kind: 'chunks',
    latency_ms: elapsed(started),
    results_returned: rows.length,
  };
}

function indexEnv(indexRoot) {
  // Keep every index inside the scratch root so nothing lands in the user's repos.
  return { ...process.env, CODESEARCH_DATA_DIR: indexRoot, CODESEARCH_HOME: indexRoot };
}

function unavailable({ query, revision, started, reason }) {
  return {
    provider_id: PROVIDER_ID,
    query,
    indexed_revision: revision,
    files: [],
    ranking: [],
    tokens_delivered: 0,
    payload_kind: 'chunks',
    latency_ms: elapsed(started),
    unavailable_reason: reason,
  };
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function elapsed(started) {
  return Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 1000) / 1000;
}

function first(error) {
  const text = error?.stderr || error?.message || String(error);
  return String(text).split('\n')[0].slice(0, 200);
}
