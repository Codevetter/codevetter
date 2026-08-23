#!/usr/bin/env node

// Repomix as the upper reference bound, not a competitor. It is a packer, not a
// retriever: it ships the whole repository, so it reaches perfect recall by
// definition and its only interesting number is the token cost of doing so.
//
// Including it frames every other row. A provider is only worth anything if it
// approaches this recall at a small fraction of this cost.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const PROVIDER_ID = 'repomix-pack-all';

export function createRepomixAdapter({ binary = 'npx', worktreeRoot, compress = false }) {
  mkdirSync(worktreeRoot, { recursive: true });

  return function retrieveByRepomix({ repo, revision, query, limit = 20 }) {
    const started = process.hrtime.bigint();
    const repoId = repo.replace(/\/+$/, '').split('/').pop();
    const worktree = join(worktreeRoot, `repomix-${repoId}-${revision.slice(0, 12)}`);
    rmSync(worktree, { recursive: true, force: true });
    try {
      run('git', ['-C', repo, 'worktree', 'add', '--detach', '--force', worktree, revision]);
    } catch (error) {
      return unavailable({ query, revision, started, reason: `worktree-failed: ${first(error)}` });
    }
    try {
      const output = join(worktree, 'repomix-output.xml');
      const args = [
        '--yes',
        'repomix@1.18.0',
        worktree,
        '--output',
        output,
        '--style',
        'xml',
        '--no-file-summary',
        '--no-directory-structure',
      ];
      if (compress) args.push('--compress');
      const stdout = run(binary, args, { cwd: worktree });
      // Repomix reports its own token total; prefer it over an estimate.
      const reported = /Total Tokens?:\s*([\d,]+)/i.exec(stdout);
      const tokens = reported
        ? Number.parseInt(reported[1].replaceAll(',', ''), 10)
        : Math.ceil(fileBytes(output) / 4);
      // A packer "returns" every file it packed. Rank is arbitrary because there is no
      // ranking; the honest report is the whole set with its true cost.
      //
      // The whole set, and NOT the first `limit` of it. Truncating to 20 took the first
      // twenty paths in `git ls-files` order — .editorconfig, .github/... — which are
      // never the answer, so both packer arms recorded 0.0% recall and a 1.0 zero-hit
      // rate on all 108 cases while in fact delivering every required file in a 163k
      // token payload. "Finds nothing" and "finds everything, unaffordably" are opposite
      // findings and the truncation turned the second into the first. The token-budget
      // metric is what should penalise a packer, and it does that without any help.
      const packed = existsSync(output)
        ? run('git', ['-C', worktree, 'ls-files']).split('\n').filter(Boolean)
        : [];
      return {
        provider_id: compress ? `${PROVIDER_ID}-compressed` : PROVIDER_ID,
        query,
        indexed_revision: revision,
        files: packed,
        ranking: packed.map((path, index) => ({ path, rank: index + 1 })),
        tokens_delivered: tokens,
        payload_kind: 'whole-repository',
        latency_ms: elapsed(started),
        files_packed: packed.length,
        unranked: true,
      };
    } catch (error) {
      return unavailable({ query, revision, started, reason: `pack-failed: ${first(error)}` });
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

function fileBytes(path) {
  try {
    return Number.parseInt(run('wc', ['-c', path]).trim().split(/\s+/)[0], 10);
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
    payload_kind: 'whole-repository',
    latency_ms: elapsed(started),
    unavailable_reason: reason,
  };
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
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
