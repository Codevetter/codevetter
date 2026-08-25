#!/usr/bin/env node

// Config-driven adapter for the common CLI shape: optionally build an index, run a
// query, read file paths out of whatever the tool prints.
//
// Most tools in this category are variations on that shape, so one adapter plus a
// config entry beats a bespoke integration each time. Same leverage as the MCP
// client. Tools that genuinely differ (structural patterns, symbol lookup) declare
// a `queryArgs` builder instead of a template.
//
// Every tool is indexed in a worktree materialized at the case's base revision,
// because they all read the filesystem and would otherwise index HEAD.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { pathShaped, PATH_TOKEN, TRAILING_PUNCT } from '../paths.mjs';
import { elapsed, firstLine, run } from './shared.mjs';

// Several providers write a cache inside the tree they were pointed at
// (token-savior drops .token-savior/, gitnexus drops .gitnexus/). A teardown that
// races one of those writes fails with ENOTEMPTY and takes the whole arm down —
// which is how two repositories were lost to a tool merely finishing its own write.
// Retry briefly, then give up quietly: a leftover worktree costs disk, not results.
function removeTree(path, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 });
      return true;
    } catch {
      if (attempt === attempts - 1) return false;
      // Synchronous spin: this runs inside a sync adapter, so there is nowhere to await.
      const until = Date.now() + 150 * (attempt + 1);
      while (Date.now() < until) {
        // busy-wait
      }
    }
  }
  return false;
}

// Exported so the extraction can be tested directly. It was previously buried inside
// the adapter closure, reachable only by running a real tool against a real worktree —
// which is how three separate defects survived in it (a sort inversion, absolute paths
// silently dropped, and an extension allowlist narrower than the ground truth).
export function extractPaths({ text, worktree, ignorePattern, isFile = defaultIsFile }) {
  const ordered = [];
  const seen = new Set();
  // Some tools report paths relative to the parent of the repo, so every path arrives
  // prefixed with the repo directory's own name (gortex does this). Worktree names are
  // `<provider>-<repo>-<rev12>`, which no real source directory shares, so stripping
  // that exact leading segment is unambiguous.
  const selfPrefix = `${worktree.split('/').pop()}/`;
  const selfRe = new RegExp(`^${selfPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  // PATH_TOKEN keeps a leading slash, so absolute output survives the strips below. It
  // did not always: the earlier pattern's capture group began with [\w.-], which cannot
  // match "/", so "/private/.../context.go" arrived as "private/.../context.go", the
  // worktree-prefix strip missed, and the path was dropped. ck delivered four correct
  // .go files and was recorded at 0% recall for exactly that reason.
  const absPrefix = `${worktree.replace(/^\//, '')}/`;
  for (const match of text.matchAll(PATH_TOKEN)) {
    const path = match[1]
      .replace(TRAILING_PUNCT, '')
      .replace(/^\.\//, '')
      .replace(`${worktree}/`, '')
      .replace(absPrefix, '')
      .replace(selfRe, '');
    if (!pathShaped(path) || seen.has(path)) continue;
    if (ignorePattern?.test(path)) continue;
    // The filesystem adjudicates: a candidate counts only if it resolves to a regular
    // file at this revision. This check is what makes the extension-agnostic pattern
    // safe — without it every directory a tool mentions ("src/", "tests/") would take a
    // result slot and dilute the ranking.
    if (!isFile(join(worktree, path))) continue;
    seen.add(path);
    ordered.push({ path, rank: ordered.length + 1 });
  }
  return ordered;
}

function defaultIsFile(absolute) {
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

export function createGenericCliAdapter({
  providerId,
  binary,
  // Some tools index with a different executable than they query with (zoekt).
  indexBinary,
  indexArgs,
  queryArgs,
  worktreeRoot,
  indexRoot,
  env = {},
  payloadKind = 'tool-output',
  // Some tools emit their own paths (config, cache) which are not retrieval results.
  ignorePattern,
  // Tools backed by a shared database keep every repository they have ever indexed,
  // so without this the Nth case searches a graph containing the previous N-1
  // revisions of the same files. Their copies live outside this worktree and so get
  // filtered out, but they still consume result slots and silently depress recall.
  cleanupArgs,
  // Fixed-index mode for the large tier. The worktree is materialised once at a
  // pinned revision and kept, and the index step runs only on the first call.
  // Per-case reindexing is 43 s per case for some providers, which on a 3,000-file
  // repository makes a rerun cost days — and a benchmark nobody reruns is not a
  // benchmark. Correctness is preserved upstream: cases admitted under this protocol
  // are drawn only from fixes that landed after the pinned revision, so the index
  // still never contains the answer.
  reuseIndex = false,
}) {
  mkdirSync(worktreeRoot, { recursive: true });
  if (indexRoot) mkdirSync(indexRoot, { recursive: true });

  // Set once reuseIndex has built its worktree, so later cases skip both the
  // worktree creation and the index step.
  let established = null;

  // Split into named steps rather than one long body. The composite was flagged at
  // cognitive complexity 51 against a ceiling of 20, and it had already hidden three
  // defects — a sort inversion, dropped absolute paths, and a `return` in a `finally`.
  // A step you can read in one screen is a step whose bug you can see.

  function addWorktree(repo, revision, worktree) {
    run('git', ['-C', repo, 'worktree', 'add', '--detach', '--force', worktree, revision]);
  }

  function buildIndex(worktree, revision) {
    if (!indexArgs) return true;
    for (const argv of normalizeArgv(indexArgs({ worktree, indexRoot, revision }))) {
      if (runInTree(indexBinary ?? binary, argv, worktree, env) === null) return false;
    }
    return true;
  }

  // A tool may need several invocations, one per query token; the outputs concatenate.
  function collectOutput(worktree, query, queryTokens, limit) {
    let combined = '';
    for (const argv of normalizeArgv(
      queryArgs({ worktree, indexRoot, query, queryTokens, limit })
    )) {
      const output = runInTree(binary, argv, worktree, env);
      if (output !== null) combined += `${output}\n`;
    }
    return combined;
  }

  function rankedResults(worktree, top) {
    if (payloadKind !== 'whole-files') return top;
    return top.map((entry) => ({
      ...entry,
      tokens: Math.max(1, Math.ceil(fileBytes(worktree, entry.path) / 4)),
    }));
  }

  function payloadTokens(ranking, combined) {
    if (payloadKind !== 'whole-files') return Math.ceil(Buffer.byteLength(combined) / 4);
    return ranking.reduce((sum, entry) => sum + entry.tokens, 0);
  }

  function teardown(repo, worktree) {
    if (cleanupArgs) {
      for (const argv of normalizeArgv(cleanupArgs({ worktree, indexRoot }))) {
        runInTree(binary, argv, undefined, env);
      }
    }
    removeTree(worktree);
    try {
      run('git', ['-C', repo, 'worktree', 'prune']);
    } catch {
      // Best-effort bookkeeping.
    }
  }

  return function retrieveByCli({ repo, revision, query, queryTokens = [], limit = 20 }) {
    const started = process.hrtime.bigint();
    const repoId = repo.replace(/\/+$/, '').split('/').pop();
    const worktree = join(worktreeRoot, `${providerId}-${repoId}-${revision.slice(0, 12)}`);
    const base = { providerId, payloadKind, query, revision, started };
    const reusing = reuseIndex && established === worktree;

    if (!reusing) {
      removeTree(worktree);
      try {
        addWorktree(repo, revision, worktree);
      } catch (error) {
        return unavailable({ ...base, reason: `worktree: ${firstLine(error)}` });
      }
    }

    try {
      if (!reusing && !buildIndex(worktree, revision)) {
        return unavailable({ ...base, reason: 'index step failed' });
      }
      if (reuseIndex) established = worktree;

      const combined = collectOutput(worktree, query, queryTokens, limit);
      if (combined.trim().length === 0) {
        return { ...shape(base), unavailable_reason: 'no output' };
      }

      const ordered = extractPaths({ text: combined, worktree, ignorePattern });
      const top = ordered.slice(0, limit);
      const ranking = rankedResults(worktree, top);
      return {
        ...shape(base),
        files: top.map((entry) => entry.path),
        ranking,
        tokens_delivered: payloadTokens(ranking, combined),
        results_parsed: ordered.length,
      };
    } catch (error) {
      return unavailable({ ...base, reason: `query: ${firstLine(error)}` });
    } finally {
      // No `return` in here, ever. A bare `return` in a finally block does not just skip
      // the cleanup — it REPLACES the value the try block was returning. This guard was
      // written as `if (reuseIndex) return;` to skip teardown in fixed-index mode, and
      // the effect was that every fixed-index call resolved to undefined: the entire
      // large tier recorded no results, which was read as tools failing to scale rather
      // than as the adapter discarding their answers.
      if (!reuseIndex) teardown(repo, worktree);
    }
  };
}

function normalizeArgv(built) {
  return Array.isArray(built[0]) ? built : [built];
}

function shape({ providerId, payloadKind, query, revision, started }) {
  return {
    provider_id: providerId,
    query,
    indexed_revision: revision,
    files: [],
    ranking: [],
    tokens_delivered: 0,
    payload_kind: payloadKind,
    latency_ms: elapsed(started),
  };
}

function unavailable({ providerId, payloadKind, query, revision, started, reason }) {
  return {
    ...shape({ providerId, payloadKind, query, revision, started }),
    unavailable_reason: reason,
  };
}

function fileBytes(worktree, path) {
  try {
    return statSync(join(worktree, path)).size;
  } catch {
    return 0;
  }
}

// A provider that hangs must lose its case, not the run. One arm sat on a single
// query for 30 minutes with no timeout set, which blocked every remaining case and
// every remaining arm behind it — and an unbounded run is an unreproducible one.
const CALL_TIMEOUT_MS = 300_000;

// Deliberately NOT the shared `run`. Provider invocations need four things the shared
// helper does not give them: a cwd (the worktree), extra env, a hard timeout, and
// tolerance of exit 1, which for most search tools means "no matches" rather than
// failure. Folding this into the shared helper once already dropped the cwd and env
// silently — the call sites pass them positionally — and the adapter tests did not
// catch it because /bin/echo ignores cwd. runInTree keeps the difference visible.
function runInTree(command, args, cwd, env = {}) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: CALL_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env: { ...process.env, ...env },
      ...(cwd ? { cwd } : {}),
    });
  } catch (error) {
    if (error?.status === 1 && typeof error.stdout === 'string') return error.stdout;
    return null;
  }
}
