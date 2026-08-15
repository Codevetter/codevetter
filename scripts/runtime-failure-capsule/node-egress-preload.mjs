import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const BLOCK_CODE = 'CODEVETTER_REMOTE_EGRESS_BLOCKED';

function isLoopback(hostname) {
  const value = String(hostname ?? '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  return value === 'localhost' || value === '::1' || /^127(?:\.\d{1,3}){3}$/.test(value);
}

function destination(args) {
  const first = args[0];
  if (first instanceof URL) return first.hostname;
  if (typeof first === 'string') {
    try {
      return new URL(first).hostname;
    } catch {
      return first;
    }
  }
  if (first && typeof first === 'object') return first.hostname ?? first.host ?? 'localhost';
  return args[1]?.hostname ?? args[1]?.host ?? 'localhost';
}

function deny(kind, hostname) {
  const safeDestination = String(hostname ?? '<unknown>').slice(0, 255);
  process.stderr.write(
    `CODEVETTER_EGRESS_BLOCKED ${JSON.stringify({ kind, destination: safeDestination })}\n`
  );
  const error = new Error(`CodeVetter blocked remote ${kind} access to ${safeDestination}`);
  error.code = BLOCK_CODE;
  throw error;
}

function guard(object, method, kind, pick = destination) {
  const original = object?.[method];
  if (typeof original !== 'function') return;
  object[method] = function guarded(...args) {
    const hostname = pick(args);
    if (!isLoopback(hostname)) return deny(kind, hostname);
    return original.apply(this, args);
  };
}

for (const method of ['connect', 'createConnection']) guard(net, method, 'socket');
guard(tls, 'connect', 'tls');
for (const method of ['request', 'get']) {
  guard(http, method, 'http');
  guard(https, method, 'https');
}
for (const method of ['lookup', 'resolve', 'resolve4', 'resolve6']) {
  guard(dns, method, 'dns', (args) => args[0]);
}

if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function guardedFetch(input, init) {
    const hostname = destination([input]);
    if (!isLoopback(hostname)) return Promise.reject(policyError('fetch', hostname));
    return originalFetch(input, init);
  };
}

if (typeof globalThis.WebSocket === 'function') {
  const OriginalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class GuardedWebSocket extends OriginalWebSocket {
    constructor(url, protocols) {
      const hostname = destination([url]);
      if (!isLoopback(hostname)) deny('websocket', hostname);
      super(url, protocols);
    }
  };
}

function policyError(kind, hostname) {
  try {
    deny(kind, hostname);
  } catch (error) {
    return error;
  }
}
