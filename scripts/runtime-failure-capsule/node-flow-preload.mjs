import { AsyncLocalStorage } from 'node:async_hooks';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const directory = process.env.CODEVETTER_FLOW_DIRECTORY;
const maximumEvents = 128;
const events = [];
const requestContext = new AsyncLocalStorage();
const statementShapes = new WeakMap();
let nextId = 1;
let flushed = false;

function now() {
  return Math.round((performance.timeOrigin + performance.now()) * 1000) / 1000;
}

function normalizePath(value) {
  let pathname;
  try {
    pathname = new URL(String(value), 'http://127.0.0.1').pathname;
  } catch {
    return '/<invalid>';
  }
  const segments = pathname.split('/').map((segment) => {
    if (!segment) return segment;
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return ':value';
    }
    if (decoded.includes('/') || decoded.includes('\\')) return ':value';
    if (/^\d+$/.test(decoded)) return ':number';
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(decoded)) return ':uuid';
    if (/[-_][0-9a-f]{8,}$/i.test(decoded)) return ':value';
    if (decoded.length > 48 || /^[A-Za-z0-9_-]{24,}$/.test(decoded)) return ':value';
    return decoded.slice(0, 64);
  });
  return segments.join('/') || '/';
}

function requestDetails(input, init) {
  const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return null;
  return {
    method: String(init?.method ?? input?.method ?? 'GET')
      .toUpperCase()
      .slice(0, 16),
    route: normalizePath(url),
  };
}

function reserve(event) {
  if (!directory || events.length >= maximumEvents) return null;
  const stored = { id: `event-${nextId++}`, ...event };
  events.push(stored);
  return stored;
}

function complete(event, update) {
  if (event) Object.assign(event, update);
}

function currentParentId() {
  return requestContext.getStore()?.event_id ?? null;
}

function normalizeSql(value) {
  if (typeof value !== 'string') return '<unknown>';
  return (
    value
      .replace(/--[^\r\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\b[xX]'(?:''|[^'])*'/g, '?')
      .replace(/'(?:''|[^'])*'/g, '?')
      .replace(/\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b/gi, '?')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 256) || '<empty>'
  );
}

if (directory && typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function codeVetterFlowFetch(input, init) {
    const details = requestDetails(input, init);
    if (!details) return originalFetch.call(this, input, init);
    const startedAt = now();
    const event = reserve({
      kind: 'http_client',
      ...details,
      parent_event_id: currentParentId(),
      status: null,
      started_at_ms: startedAt,
      duration_ms: null,
    });
    try {
      const response = await originalFetch.call(this, input, init);
      complete(event, {
        status: response.status,
        duration_ms: Math.max(0, now() - startedAt),
      });
      return response;
    } catch (error) {
      complete(event, {
        outcome: 'error',
        duration_ms: Math.max(0, now() - startedAt),
      });
      throw error;
    }
  };

  const originalEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function codeVetterFlowEmit(type, ...args) {
    if (type === 'request') {
      const [request, response] = args;
      const startedAt = now();
      const method = String(request?.method ?? 'GET')
        .toUpperCase()
        .slice(0, 16);
      const route = normalizePath(request?.url ?? '/');
      const event = reserve({
        kind: 'http_server',
        method,
        route,
        parent_event_id: null,
        status: null,
        started_at_ms: startedAt,
        duration_ms: null,
      });
      if (!event) return originalEmit.call(this, type, ...args);
      return requestContext.run({ event_id: event.id }, () => {
        response?.once?.('finish', () => {
          complete(event, {
            status: Number.isInteger(response.statusCode) ? response.statusCode : null,
            duration_ms: Math.max(0, now() - startedAt),
          });
        });
        try {
          return originalEmit.call(this, type, ...args);
        } catch (error) {
          complete(event, {
            outcome: 'error',
            duration_ms: Math.max(0, now() - startedAt),
          });
          throw error;
        }
      });
    }
    return originalEmit.call(this, type, ...args);
  };
}

if (directory) {
  try {
    const { DatabaseSync, StatementSync } = await import('node:sqlite');
    const originalPrepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function codeVetterSqlitePrepare(sql, ...args) {
      const statement = originalPrepare.call(this, sql, ...args);
      statementShapes.set(statement, normalizeSql(sql));
      return statement;
    };

    wrapSqliteMethod(DatabaseSync.prototype, 'exec', (_receiver, args) => ({
      operation: 'exec',
      statement: normalizeSql(args[0]),
    }));
    for (const operation of ['all', 'get', 'run']) {
      wrapSqliteMethod(StatementSync.prototype, operation, (receiver) => ({
        operation,
        statement: statementShapes.get(receiver) ?? '<unknown>',
      }));
    }
  } catch {
    // Older Node versions do not provide node:sqlite; coverage reports no database events.
  }
}

function wrapSqliteMethod(prototype, name, describe) {
  const original = prototype?.[name];
  if (typeof original !== 'function') return;
  prototype[name] = function codeVetterSqliteOperation(...args) {
    const parentEventId = currentParentId();
    if (!parentEventId) return original.apply(this, args);
    const startedAt = now();
    const event = reserve({
      kind: 'database',
      database: 'node_sqlite',
      ...describe(this, args),
      parent_event_id: parentEventId,
      outcome: null,
      started_at_ms: startedAt,
      duration_ms: null,
    });
    try {
      const result = original.apply(this, args);
      complete(event, { outcome: 'ok', duration_ms: Math.max(0, now() - startedAt) });
      return result;
    } catch (error) {
      complete(event, { outcome: 'error', duration_ms: Math.max(0, now() - startedAt) });
      throw error;
    }
  };
}

function flush() {
  if (flushed || !directory) return;
  flushed = true;
  try {
    writeFileSync(
      join(directory, `flow-${process.pid}.json`),
      JSON.stringify({ schema_version: 'codevetter-node-flow-events/v1', events })
    );
  } catch {
    // The parent process reports missing flow evidence; never disrupt the target workload.
  }
}

process.once('beforeExit', flush);
process.once('exit', flush);
