#!/usr/bin/env node

// Generic MCP stdio client. Most tools in this category ship as an MCP server with
// no CLI, so one client turns each of them into a config entry instead of a bespoke
// adapter.
//
// Speaks the minimum of the protocol needed to retrieve: initialize, the
// initialized notification, tools/list, then tools/call.

import { spawn } from 'node:child_process';

import { pathTokensIn } from '../paths.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 180_000;
// Paths turn up under many key names across servers; check the common ones.
const PATH_KEYS = ['path', 'file', 'file_path', 'filePath', 'relative_path', 'relativePath', 'uri'];

export function createMcpAdapter({
  providerId,
  command,
  args = [],
  env = {},
  toolName,
  buildArguments,
  indexToolName,
  buildIndexArguments,
  // Providers whose payload is deliberately not a list of paths supply their own
  // reader. jcodemunch, for one, interns paths to @1/@2 and ships a legend, so a
  // path regex scores it 0% recall while it is returning the right symbols.
  parsePaths,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  return async function retrieveByMcp({ repo, revision, query, limit = 20, workspace }) {
    const started = process.hrtime.bigint();
    const root = workspace ?? repo;
    let session;
    try {
      session = await openSession({ command, args, env, cwd: root, timeoutMs });
    } catch (error) {
      return unavailable({
        providerId,
        query,
        revision,
        started,
        reason: `spawn: ${first(error)}`,
      });
    }
    try {
      const tools = await session.request('tools/list', {});
      const names = (tools?.tools ?? []).map((tool) => tool.name);
      if (!names.includes(toolName)) {
        return unavailable({
          providerId,
          query,
          revision,
          started,
          reason: `tool "${toolName}" not offered; server exposes: ${names.join(', ') || 'none'}`,
        });
      }
      if (indexToolName && names.includes(indexToolName)) {
        await session.request('tools/call', {
          name: indexToolName,
          arguments: buildIndexArguments({ root, query, limit }),
        });
      }
      const result = await session.request('tools/call', {
        name: toolName,
        arguments: buildArguments({ root, query, limit }),
      });
      return shapeResponse({
        providerId,
        query,
        revision,
        started,
        result,
        root,
        limit,
        names,
        parsePaths,
      });
    } catch (error) {
      return unavailable({ providerId, query, revision, started, reason: first(error) });
    } finally {
      session.close();
    }
  };
}

function shapeResponse({ providerId, query, revision, started, result, root, limit, parsePaths }) {
  const text = (result?.content ?? [])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('\n');
  const structured = result?.structuredContent ?? tryJson(text);
  const paths = [];
  if (parsePaths) {
    paths.push(...parsePaths({ text, structured }));
  } else {
    collectPaths(structured, paths);
    if (paths.length === 0) collectPathsFromText(text, paths);
  }

  const ordered = [];
  const seen = new Set();
  for (const raw of paths) {
    const path = raw
      .replace(/^file:\/\//, '')
      .replace(root, '')
      .replace(/^\/+/, '');
    if (!path || seen.has(path)) continue;
    seen.add(path);
    ordered.push({ path, rank: ordered.length + 1 });
  }
  return {
    provider_id: providerId,
    query,
    indexed_revision: revision,
    files: ordered.slice(0, limit).map((entry) => entry.path),
    ranking: ordered.slice(0, limit),
    tokens_delivered: Math.ceil(Buffer.byteLength(text) / 4),
    payload_kind: 'mcp-tool-result',
    latency_ms: elapsed(started),
    ...(ordered.length === 0 ? { unavailable_reason: 'no-paths-in-result' } : {}),
  };
}

function collectPaths(value, out, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, out, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  for (const key of PATH_KEYS) {
    if (typeof value[key] === 'string') out.push(value[key]);
  }
  for (const nested of Object.values(value)) collectPaths(nested, out, depth + 1);
}

function collectPathsFromText(text, out) {
  // Last resort: servers that only return prose still name files in it. Shared with
  // every other adapter on purpose — this used to carry its own extension allowlist,
  // one of four that disagreed, so an MCP arm could name a .json file while a CLI arm
  // could not and the two were not being asked the same question. See ../paths.mjs.
  for (const token of pathTokensIn(text)) out.push(token);
}

async function openSession({ command, args, env, cwd, timeoutMs }) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  const pending = new Map();
  let nextId = 1;
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // Servers sometimes log to stdout; ignore non-JSON lines.
      }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? 'mcp error'));
      else waiter.resolve(message.result);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4000);
  });
  child.on('exit', () => {
    for (const waiter of pending.values()) {
      waiter.reject(new Error(`server exited: ${stderr.split('\n').filter(Boolean).pop() ?? ''}`));
    }
    pending.clear();
  });

  const send = (payload) => child.stdin.write(`${JSON.stringify(payload)}\n`);
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout on ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      send({ jsonrpc: '2.0', id, method, params });
    });

  await request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'codevetter-retrieval-benchmark', version: '1' },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return { request, close: () => child.kill('SIGKILL') };
}

function tryJson(text) {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

function unavailable({ providerId, query, revision, started, reason }) {
  return {
    provider_id: providerId,
    query,
    indexed_revision: revision,
    files: [],
    ranking: [],
    tokens_delivered: 0,
    payload_kind: 'mcp-tool-result',
    latency_ms: elapsed(started),
    unavailable_reason: reason,
  };
}

function elapsed(started) {
  return Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 1000) / 1000;
}

function first(error) {
  return String(error?.message ?? error)
    .split('\n')[0]
    .slice(0, 200);
}
