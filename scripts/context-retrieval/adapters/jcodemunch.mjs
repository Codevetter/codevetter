#!/usr/bin/env node

// jcodemunch — retrieval behind a deliberately compressed wire format.
//
// Two things make it unlike every other MCP arm. Its tool surface is six generic
// verbs rather than named search tools, so retrieval is reached as one of 91
// catalog actions through `order`. And its payload interns file paths into @1/@2
// refs with a legend at the top:
//
//   #MUNCH/1 tool=search_symbols enc=ss1
//
//   @1=context_test.go
//   @2=context.go
//
//   __tables=s:results:id|name|kind|file|line|score|signature|summary
//   s,@2::Context#type,Context,type,@2,61,,"type Context struct {..."
//
// That interning is the product's whole point, so resolving it is measuring the
// tool as shipped rather than working around it. A generic path regex reports 0%
// recall here while the tool is in fact returning the right files.
//
// Ranking follows first appearance in the results table, not legend order: the
// legend is emitted sorted, so trusting it would score a fixed alphabetical
// permutation instead of the tool's own ordering.

const LEGEND = /^@(\d+)=(.+)$/;
const TABLE_HEADER = /^__tables=([a-z]+):results:(.+)$/;

export function parseMunchPaths({ text }) {
  if (typeof text !== 'string' || !text.includes('#MUNCH/')) return [];
  const legend = new Map();
  let rowPrefix = null;
  let fileColumn = -1;
  const lines = text.split('\n');

  for (const line of lines) {
    const entry = LEGEND.exec(line.trim());
    if (entry) {
      legend.set(entry[1], entry[2].trim());
      continue;
    }
    const header = TABLE_HEADER.exec(line.trim());
    if (header) {
      rowPrefix = header[1];
      fileColumn = header[2].split('|').indexOf('file');
    }
  }
  if (legend.size === 0) return [];

  const ordered = [];
  const seen = new Set();
  const push = (id) => {
    const path = legend.get(id);
    if (!path || seen.has(path)) return;
    seen.add(path);
    ordered.push(path);
  };

  if (rowPrefix !== null && fileColumn >= 0) {
    for (const line of lines) {
      if (!line.startsWith(`${rowPrefix},`)) continue;
      const cell = splitRow(line)[fileColumn];
      const ref = /^@(\d+)$/.exec((cell ?? '').trim());
      if (ref) push(ref[1]);
    }
  }
  // Rows can be absent (search_text returns spans, not a symbol table). Fall back
  // to reference order in the body, still not legend order.
  if (ordered.length === 0) {
    const body = lines.filter((line) => !LEGEND.test(line.trim())).join('\n');
    for (const match of body.matchAll(/@(\d+)/g)) push(match[1]);
  }
  return ordered;
}

// Signatures are embedded whole and contain commas, quotes and newlines, so the
// row needs real CSV splitting rather than a split(',').
function splitRow(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

// jcodemunch indexes a directory and registers it under that directory's basename,
// then queries by that name rather than by path. So the worktree name IS the repo
// id, and it has to be deterministic per revision or cases collide. Indexing is a
// CLI step, not an MCP tool, which is why this wraps the MCP adapter instead of
// using its indexToolName hook.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export function createJcodemunchAdapter({
  command,
  worktreeRoot,
  timeoutMs = 240_000,
  createMcpAdapter,
}) {
  mkdirSync(worktreeRoot, { recursive: true });
  const [bin, ...rest] = command.split(' ');

  return async function retrieveByJcodemunch({ repo, revision, query, limit = 20 }) {
    const started = process.hrtime.bigint();
    const repoId = repo.replace(/\/+$/, '').split('/').pop();
    const name = `jcm-${repoId}-${revision.slice(0, 12)}`;
    const worktree = join(worktreeRoot, name);
    rmSync(worktree, { recursive: true, force: true });
    const fail = (reason) => ({
      provider_id: 'jcodemunch',
      query,
      indexed_revision: revision,
      files: [],
      ranking: [],
      tokens_delivered: 0,
      payload_kind: 'mcp-tool-result',
      latency_ms: Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 1000) / 1000,
      unavailable_reason: reason,
    });
    try {
      run('git', ['-C', repo, 'worktree', 'add', '--detach', '--force', worktree, revision]);
    } catch (error) {
      return fail(`worktree: ${short(error)}`);
    }
    try {
      // --no-ai-summaries keeps this a retrieval measurement rather than a
      // measurement of whatever model it would otherwise call per file.
      run(bin, [...rest, 'index', worktree, '--no-ai-summaries', '--log-level', 'ERROR'], worktree);
    } catch (error) {
      return fail(`index: ${short(error)}`);
    }
    try {
      const adapter = createMcpAdapter({
        providerId: 'jcodemunch',
        command: bin,
        args: rest,
        toolName: 'order',
        // It reports `limit` in ignored_arguments and always returns 10, so the
        // budget curve, not the limit, is what constrains it here.
        buildArguments: ({ query: text }) => ({
          action: 'search_symbols',
          args: { repo: name, query: text, limit },
        }),
        parsePaths: parseMunchPaths,
        timeoutMs,
      });
      return await adapter({ repo, revision, query, limit, workspace: worktree });
    } finally {
      // Leaving the worktree registered would grow its repo list by one per case.
      try {
        run(bin, [...rest, 'delete-index', name]);
      } catch {
        // delete-index is best-effort; its state dir is disposable either way.
      }
      rmSync(worktree, { recursive: true, force: true });
      try {
        run('git', ['-C', repo, 'worktree', 'prune']);
      } catch {
        // Best-effort bookkeeping.
      }
    }
  };
}

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(cwd ? { cwd } : {}),
  });
}

function short(error) {
  const text = error?.stderr || error?.message || String(error);
  return String(text).split('\n')[0].slice(0, 160);
}
