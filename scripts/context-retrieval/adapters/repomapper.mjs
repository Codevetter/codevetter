#!/usr/bin/env node

// RepoMapper (pdavis68/RepoMapper): a standalone implementation of Aider's repo-map
// — tree-sitter tags plus personalized PageRank over the symbol graph.
//
// IMPORTANT: repo-map is not a natural-language retrieval interface, and scoring it
// as one is a category error.
//
// `--mentioned-idents` applies a 10x boost where `tag.name in mentioned_idents` — an
// exact match against extracted *identifier* names. Feeding it prose tokens from a
// commit subject ("canonical", "auth", "fallback") almost never matches a camelCase
// tag, so it produces no boost while still perturbing the map, and scores BELOW the
// no-personalization run. Fed real identifiers instead (`getGmailAccessToken`,
// `AuthEnv`) it ranks the correct file first.
//
// So `personalize: true` is only meaningful with an identifier list, which a
// natural-language corpus cannot supply. In Aider those identifiers come from live
// chat state. `repomap-global` is the configuration this benchmark can measure
// honestly: a query-blind orientation map, expected to land near the controls.

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { elapsed, firstLine, materialiseWorktree, run } from './shared.mjs';

export const PROVIDER_ID = 'repomap';

// The repr-printed map names each file as `path:\n(Rank value: N)`, and the tuple
// repr escapes its newlines, so accept either form.
// The separator is consumed explicitly: matching it as an optional prefix lets the
// path class swallow the "n" out of an escaped "\n" and yields paths like "nsrc/…".
const RANKED_FILE =
  /(?:\\n|\n|^|["\s])([\w.-]+(?:\/[\w.-]+)*\.[A-Za-z]+):(?:\\n|\n)\(Rank value: ([\d.]+)\)/g;

export function createRepomapperAdapter({
  python,
  script,
  worktreeRoot,
  personalize = true,
  mapTokens = 4096,
}) {
  if (!existsSync(script)) throw new Error(`RepoMapper script not found: ${script}`);
  mkdirSync(worktreeRoot, { recursive: true });

  return function retrieveByRepomap({ repo, revision, query, queryTokens = [], limit = 20 }) {
    const started = process.hrtime.bigint();
    const repoId = repo.replace(/\/+$/, '').split('/').pop();
    const worktree = join(worktreeRoot, `rm-${repoId}-${revision.slice(0, 12)}`);
    const materialised = materialiseWorktree({ repo, revision, worktree });
    if (!materialised.ok) {
      return unavailable({ query, revision, started, reason: materialised.reason });
    }
    try {
      const args = [script, worktree, '--root', worktree, '--map-tokens', String(mapTokens)];
      if (personalize && queryTokens.length > 0) {
        args.push('--mentioned-idents', ...queryTokens);
      }
      const output = run(python, args, { cwd: worktree, maxBuffer: 256 * 1024 * 1024 });
      const ranked = [];
      const seen = new Set();
      for (const match of output.matchAll(RANKED_FILE)) {
        const path = match[1];
        if (seen.has(path)) continue;
        seen.add(path);
        ranked.push({ path, rank: ranked.length + 1, score: Number.parseFloat(match[2]) });
      }
      const scores = new Set(ranked.map((entry) => entry.score));
      return {
        provider_id: providerId(personalize),
        query,
        indexed_revision: revision,
        files: ranked.slice(0, limit).map((entry) => entry.path),
        ranking: ranked.slice(0, limit),
        tokens_delivered: Math.ceil(Buffer.byteLength(output) / 4),
        payload_kind: 'symbol-map',
        latency_ms: elapsed(started),
        files_ranked: ranked.length,
        // Recorded so a degenerate all-ties ranking is visible in the evidence
        // rather than being silently scored as if it were a ranking.
        distinct_scores: scores.size,
        rank_is_degenerate: scores.size <= 1,
      };
    } catch (error) {
      return unavailable({
        query,
        revision,
        started,
        personalize,
        reason: `map: ${firstLine(error)}`,
      });
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

function providerId(personalize) {
  return personalize ? 'repomap-personalized' : 'repomap-global';
}

function unavailable({ query, revision, started, personalize, reason }) {
  return {
    provider_id: providerId(personalize),
    query,
    indexed_revision: revision,
    files: [],
    ranking: [],
    tokens_delivered: 0,
    payload_kind: 'symbol-map',
    latency_ms: elapsed(started),
    unavailable_reason: reason,
  };
}
