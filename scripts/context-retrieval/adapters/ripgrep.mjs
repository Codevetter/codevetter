#!/usr/bin/env node

// ripgrep — the actual default. Claude Code and most coding agents ship ripgrep as
// their search tool, so this is not a synthetic baseline: it is the thing a provider
// has to beat to be worth installing at all.
//
// Differs from the git-grep baseline in two ways that matter: it reads the working
// tree rather than a git revision, and it respects .gitignore by default. The probe
// therefore runs it inside a worktree materialized at the target revision.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const PROVIDER_ID = 'ripgrep';

const MAX_FILE_BYTES = 512 * 1024;
// Code only, matching the git-grep baseline's pathspec so the two are comparable.
const TYPES = ['ts', 'js', 'py', 'go', 'rust'];

export function createRipgrepAdapter({ binary = 'rg', worktreeRoot }) {
  mkdirSync(worktreeRoot, { recursive: true });

  return function retrieveByRipgrep({ repo, revision, query, queryTokens = [], limit = 20 }) {
    const started = process.hrtime.bigint();
    const repoId = repo.replace(/\/+$/, '').split('/').pop();
    const worktree = join(worktreeRoot, `rg-${repoId}-${revision.slice(0, 12)}`);
    rmSync(worktree, { recursive: true, force: true });
    try {
      run('git', ['-C', repo, 'worktree', 'add', '--detach', '--force', worktree, revision]);
    } catch (error) {
      return unavailable({ query, revision, started, reason: `worktree: ${first(error)}` });
    }
    try {
      // One pass per token, then rank by how many distinct terms hit the file —
      // the same ranking the git-grep baseline uses, so the two are comparable.
      const hits = new Map();
      for (const token of [...queryTokens].sort()) {
        for (const path of countLines(binary, worktree, token)) {
          const entry = hits.get(path) ?? { path, matched: 0 };
          entry.matched += 1;
          hits.set(path, entry);
        }
      }
      const ranked = [...hits.values()]
        .sort(
          (left, right) =>
            right.matched - left.matched ||
            left.path.split('/').length - right.path.split('/').length ||
            left.path.localeCompare(right.path)
        )
        .slice(0, limit);
      const bytes = ranked.reduce((total, entry) => total + fileBytes(worktree, entry.path), 0);
      return {
        provider_id: PROVIDER_ID,
        query,
        indexed_revision: revision,
        files: ranked.map((entry) => entry.path),
        ranking: ranked.map((entry, index) => ({ ...entry, rank: index + 1 })),
        tokens_delivered: Math.ceil(bytes / 4),
        payload_kind: 'whole-files',
        latency_ms: elapsed(started),
        holds_index: false,
      };
    } catch (error) {
      return unavailable({ query, revision, started, reason: `search: ${first(error)}` });
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

function countLines(binary, worktree, token) {
  const args = ['--files-with-matches', '--fixed-strings', '--ignore-case'];
  for (const type of TYPES) args.push('--type', type);
  args.push('--', token, '.');
  try {
    return run(binary, args, worktree).split('\n').filter(Boolean).map(strip);
  } catch (error) {
    // ripgrep exits 1 when nothing matched, which is an answer not a failure.
    if (error?.status === 1) return [];
    throw error;
  }
}

function strip(path) {
  return path.replace(/^\.\//, '');
}

function fileBytes(worktree, path) {
  const full = join(worktree, path);
  if (!existsSync(full)) return 0;
  try {
    const size = Number.parseInt(run('wc', ['-c', full]).trim().split(/\s+/)[0], 10);
    // Same cap as every other whole-file arm: nobody reads a huge blob entire.
    return Number.isFinite(size) && size <= MAX_FILE_BYTES ? size : 0;
  } catch {
    return 0;
  }
}

function unavailable({ query, revision, started, reason }) {
  return {
    provider_id: PROVIDER_ID,
    query,
    indexed_revision: revision,
    files: [],
    ranking: [],
    tokens_delivered: 0,
    payload_kind: 'whole-files',
    latency_ms: elapsed(started),
    unavailable_reason: reason,
  };
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(cwd ? { cwd } : {}),
  });
}

function elapsed(started) {
  return Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 1000) / 1000;
}

function first(error) {
  const text = error?.stderr || error?.message || String(error);
  return String(text).split('\n')[0].slice(0, 200);
}
