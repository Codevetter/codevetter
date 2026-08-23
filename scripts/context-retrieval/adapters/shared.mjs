// Helpers every adapter needs, in one place.
//
// They were copied into eight adapter files, which the clone gate correctly flagged:
// `run`, `elapsed` and `firstLine` were byte-identical across codesearch, repomix,
// repomapper, ripgrep, graphify, keyword-search, cli-indexed-mcp and jcodemunch, and
// `unavailableShape` differed only in its payload_kind string. Duplicated helpers in a
// measurement harness are worse than duplicated helpers elsewhere: a fix applied to one
// copy silently leaves the other arms measuring something different, which is how four
// adapters ended up with four disagreeing definitions of a file path.

import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

// The third parameter is an OPTIONS OBJECT, not a cwd. Three call sites passed a bare
// worktree path here during consolidation, and because a spread string contributes no
// keys the cwd was silently never set — ripgrep searched the harness's own repository
// instead of the tree under test and returned this repo's files. Pass { cwd } explicitly.
export function run(command, args, options = {}) {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError(
      `run(): third argument must be an options object, received ${typeof options}`
    );
  }
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

export function elapsed(started) {
  return Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 1000) / 1000;
}

// Tools report failures on stderr at arbitrary length; one line is enough to classify.
export function firstLine(error) {
  const text = error?.stderr || error?.message || String(error);
  return String(text).split('\n')[0].slice(0, 200);
}

// The shape an arm returns when it could not answer. Distinct from an empty answer:
// an arm that ran and found nothing is a result, an arm that could not run is not, and
// collapsing the two is the single largest distortion available in this benchmark.
export function unavailableShape({ providerId, query, revision, started, payloadKind, reason }) {
  return {
    provider_id: providerId,
    query,
    indexed_revision: revision,
    files: [],
    ranking: [],
    tokens_delivered: 0,
    payload_kind: payloadKind,
    latency_ms: elapsed(started),
    unavailable_reason: reason,
  };
}

// Materialise a repository at one revision. Every adapter needs this and eight of them
// had spelled it out inline, which the clone gate flagged five times over. Returning a
// result rather than throwing keeps the caller's error path explicit: a worktree that
// cannot be created is an unavailable arm, not a retrieval failure, and the two must not
// collapse into the same published number.
export function materialiseWorktree({ repo, revision, worktree }) {
  rmSync(worktree, { recursive: true, force: true });
  try {
    run('git', ['-C', repo, 'worktree', 'add', '--detach', '--force', worktree, revision]);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `worktree-failed: ${firstLine(error)}` };
  }
}
