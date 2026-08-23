#!/usr/bin/env node

// Providers that index with a CLI and answer over MCP.
//
// Third tool in this registry with that shape (jcodemunch, cocoindex-code, and cgr),
// so it is worth a shared adapter. The MCP `indexToolName` hook does not cover it:
// these tools build their index from a shell command, and only the query side speaks
// JSON-RPC.
//
// Every case gets its own worktree at the case's base revision, because these
// indexers read the filesystem and would otherwise all index HEAD.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export function createCliIndexedMcpAdapter({
  providerId,
  indexCommand,
  buildIndexArgs,
  serveCommand,
  buildArguments,
  toolName,
  parsePaths,
  env = {},
  timeoutMs = 240_000,
  worktreeRoot,
  createMcpAdapter,
}) {
  mkdirSync(worktreeRoot, { recursive: true });
  const [indexBin, ...indexRest] = indexCommand.split(' ');
  const [serveBin, ...serveRest] = serveCommand.split(' ');

  return async function retrieve({ repo, revision, query, limit = 20 }) {
    const started = process.hrtime.bigint();
    const repoId = repo.replace(/\/+$/, '').split('/').pop();
    const worktree = join(worktreeRoot, `${providerId}-${repoId}-${revision.slice(0, 12)}`);
    rmSync(worktree, { recursive: true, force: true });
    const fail = (reason) => ({
      provider_id: providerId,
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
      for (const argv of normalize(buildIndexArgs({ worktree, revision }))) {
        run(indexBin, [...indexRest, ...argv], worktree, env);
      }
    } catch (error) {
      return fail(`index: ${short(error)}`);
    }
    try {
      const adapter = createMcpAdapter({
        providerId,
        command: serveBin,
        args: serveRest,
        env,
        toolName,
        buildArguments,
        parsePaths,
        timeoutMs,
      });
      return await adapter({ repo, revision, query, limit, workspace: worktree });
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

function normalize(built) {
  return Array.isArray(built[0]) ? built : [built];
}

function run(cmd, args, cwd, env = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    ...(cwd ? { cwd } : {}),
  });
}

function short(error) {
  const text = error?.stderr || error?.message || String(error);
  return String(text).split('\n')[0].slice(0, 160);
}
