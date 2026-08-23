#!/usr/bin/env node

// CodeVetter structural context, via the repo's own experiment fixture tool.
//
// The fixture's `revision` argument is only a LABEL: indexing discovers files with
// `git ls-files -co` against the working tree and reads them from disk. Passing a
// historical SHA without checking it out would index HEAD and stamp it with the old
// revision — wrong, and invisible to any identity check. So every case is indexed
// in a detached worktree materialized at its own base revision.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const PROVIDER_ID = 'codevetter-structural-context';

// Hits are graph nodes, and many nodes share a file. Ask for well over the file
// budget so deduplication can still fill it.
const NODE_LIMIT = 400;

export function createStructuralGraphAdapter({ tool, cacheDir, worktreeRoot }) {
  if (!existsSync(tool)) throw new Error(`fixture tool not found: ${tool}`);
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });

  return function retrieveByStructuralGraph({ repo, revision, query, limit = 20 }) {
    const started = process.hrtime.bigint();
    const snapshot = ensureSnapshot({ tool, cacheDir, worktreeRoot, repo, revision });
    if (!snapshot.ok) {
      return {
        provider_id: PROVIDER_ID,
        query,
        indexed_revision: revision,
        files: [],
        ranking: [],
        tokens_delivered: 0,
        payload_kind: 'excerpts',
        latency_ms: elapsed(started),
        unavailable_reason: snapshot.reason,
      };
    }
    let result;
    try {
      result = JSON.parse(
        run(tool, ['query', snapshot.path, query, String(NODE_LIMIT)], {
          maxBuffer: 256 * 1024 * 1024,
        })
      );
    } catch (error) {
      return {
        provider_id: PROVIDER_ID,
        query,
        indexed_revision: revision,
        files: [],
        ranking: [],
        tokens_delivered: 0,
        payload_kind: 'excerpts',
        latency_ms: elapsed(started),
        unavailable_reason: `query-failed: ${firstLine(error)}`,
      };
    }

    const byFile = new Map();
    let excerptBytes = 0;
    for (const hit of result.hits ?? []) {
      const path = hit?.node?.path;
      if (typeof path !== 'string') continue;
      for (const source of hit.node.sources ?? []) {
        excerptBytes += Buffer.byteLength(source.excerpt ?? '');
      }
      const existing = byFile.get(path);
      if (existing === undefined || hit.score > existing.score) {
        byFile.set(path, { path, score: hit.score, matched_by: hit.matched_by });
      }
    }
    const ranked = [...byFile.values()]
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, limit);
    return {
      provider_id: PROVIDER_ID,
      query,
      indexed_revision: result.context?.snapshot_id ? revision : null,
      files: ranked.map((entry) => entry.path),
      ranking: ranked,
      // The graph returns excerpts, not whole files. Reported separately from the
      // baseline's whole-file cost so the two are never silently blended.
      tokens_delivered: Math.ceil(excerptBytes / 4),
      payload_kind: 'excerpts',
      latency_ms: elapsed(started),
      snapshot_id: result.context?.snapshot_id ?? null,
      freshness: result.context?.freshness ?? null,
      nodes_returned: (result.hits ?? []).length,
      truncated: Boolean(result.truncated),
    };
  };
}

function ensureSnapshot({ tool, cacheDir, worktreeRoot, repo, revision }) {
  const repoId = repo.replace(/\/+$/, '').split('/').pop();
  const path = join(cacheDir, `${repoId}-${revision}.json`);
  if (existsSync(path)) return { ok: true, path, cached: true };

  const worktree = join(worktreeRoot, `${repoId}-${revision.slice(0, 12)}`);
  rmSync(worktree, { recursive: true, force: true });
  try {
    run('git', ['-C', repo, 'worktree', 'add', '--detach', '--force', worktree, revision]);
  } catch (error) {
    return { ok: false, reason: `worktree-failed: ${firstLine(error)}` };
  }
  try {
    run(tool, ['build', worktree, revision, path], { maxBuffer: 64 * 1024 * 1024 });
    // Refuse to score a snapshot the provider cannot read back.
    const size = statSync(path).size;
    const importLimit = 32 * 1024 * 1024;
    if (size > importLimit) {
      return {
        ok: false,
        reason: `snapshot-exceeds-import-limit: ${size} bytes > ${importLimit}`,
      };
    }
    return { ok: true, path, cached: false };
  } catch (error) {
    return { ok: false, reason: `build-failed: ${firstLine(error)}` };
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    try {
      run('git', ['-C', repo, 'worktree', 'prune']);
    } catch {
      // Pruning is best-effort bookkeeping.
    }
  }
}

export function readSnapshotIdentity(path) {
  const document = JSON.parse(readFileSync(path, 'utf8'));
  return { snapshot_id: document?.snapshot?.id, repo_head: document?.snapshot?.repo_head };
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
}

function elapsed(started) {
  return Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 1000) / 1000;
}

function firstLine(error) {
  const text = error?.stderr || error?.message || String(error);
  return String(text).split('\n')[0].slice(0, 200);
}
