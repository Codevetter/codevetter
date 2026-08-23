#!/usr/bin/env node

// Graphify, via its local CLI. Indexing uses `update --no-cluster`, which is pure
// AST extraction with no LLM call and no network egress; clustering and community
// labelling are deliberately skipped because they invoke a model.
//
// Like the CodeVetter fixture, graphify reads the filesystem, so every case is
// indexed in a worktree materialized at its own base revision.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const PROVIDER_ID = 'graphify';

const DEFAULT_BUDGET = 2000;
const NODE_LINE = /^NODE\s+(.*?)\s+\[src=([^\s\]]*)/;
const REPORTED_TOKENS = /~(\d+)\s+tokens/;

export function createGraphifyAdapter({
  binary = 'graphify',
  cacheDir,
  worktreeRoot,
  budget = DEFAULT_BUDGET,
}) {
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });

  return function retrieveByGraphify({ repo, revision, query, limit = 20 }) {
    const started = process.hrtime.bigint();
    const graph = ensureGraph({ binary, cacheDir, worktreeRoot, repo, revision });
    if (!graph.ok) return unavailable({ query, revision, started, reason: graph.reason });

    let output;
    try {
      output = run(binary, ['query', query, '--graph', graph.path, '--budget', String(budget)]);
    } catch (error) {
      return unavailable({ query, revision, started, reason: `query-failed: ${firstLine(error)}` });
    }

    const ordered = [];
    const seen = new Set();
    for (const line of output.split('\n')) {
      const match = NODE_LINE.exec(line.trim());
      if (!match) continue;
      const path = match[2];
      // Nodes without a source path are synthetic references, not retrievable files.
      if (!path || seen.has(path)) continue;
      seen.add(path);
      ordered.push({ path, rank: ordered.length + 1, label: match[1] });
    }
    const reported = REPORTED_TOKENS.exec(output);
    return {
      provider_id: PROVIDER_ID,
      query,
      indexed_revision: revision,
      // Breadth-first traversal order is the provider's own ranking.
      files: ordered.slice(0, limit).map((entry) => entry.path),
      ranking: ordered.slice(0, limit),
      tokens_delivered: reported
        ? Number.parseInt(reported[1], 10)
        : Math.ceil(Buffer.byteLength(output) / 4),
      payload_kind: 'node-summaries',
      latency_ms: elapsed(started),
      nodes_returned: ordered.length,
    };
  };
}

function ensureGraph({ binary, cacheDir, worktreeRoot, repo, revision }) {
  const repoId = repo.replace(/\/+$/, '').split('/').pop();
  const cached = join(cacheDir, `${repoId}-${revision}.graph.json`);
  if (existsSync(cached)) return { ok: true, path: cached, cached: true };

  const worktree = join(worktreeRoot, `${repoId}-${revision.slice(0, 12)}`);
  rmSync(worktree, { recursive: true, force: true });
  try {
    run('git', ['-C', repo, 'worktree', 'add', '--detach', '--force', worktree, revision]);
  } catch (error) {
    return { ok: false, reason: `worktree-failed: ${firstLine(error)}` };
  }
  try {
    run(binary, ['update', worktree, '--no-cluster'], {
      cwd: worktree,
      maxBuffer: 64 * 1024 * 1024,
    });
    const produced = join(worktree, 'graphify-out', 'graph.json');
    if (!existsSync(produced)) return { ok: false, reason: 'index-produced-no-graph' };
    copyFileSync(produced, cached);
    return { ok: true, path: cached, cached: false };
  } catch (error) {
    return { ok: false, reason: `index-failed: ${firstLine(error)}` };
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    try {
      run('git', ['-C', repo, 'worktree', 'prune']);
    } catch {
      // Best-effort bookkeeping.
    }
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
    payload_kind: 'node-summaries',
    latency_ms: elapsed(started),
    unavailable_reason: reason,
  };
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function elapsed(started) {
  return Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 1000) / 1000;
}

function firstLine(error) {
  const text = error?.stderr || error?.message || String(error);
  return String(text).split('\n')[0].slice(0, 200);
}
