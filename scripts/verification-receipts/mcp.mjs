#!/usr/bin/env node
import { realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { compareReceiptDocuments, ingestReceiptDocument } from './analyze.mjs';
import { loadReceipt, stableStringify } from './contracts.mjs';

const PROTOCOL_VERSION = '2025-03-26';
const SERVER_INFO = { name: 'codevetter-verification-receipts', version: '0.1.0' };

export async function createMcpHandler(repositoryRoot) {
  const root = await realpath(repositoryRoot);
  return async function handle(request) {
    if (request?.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return failure(request?.id ?? null, -32600, 'Invalid JSON-RPC request');
    }
    if (request.method === 'notifications/initialized') return null;
    if (request.method === 'initialize') {
      return success(request.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    if (request.method === 'tools/list') return success(request.id, { tools: toolDefinitions() });
    if (request.method !== 'tools/call') return failure(request.id, -32601, 'Method not found');

    const name = request.params?.name;
    const args = request.params?.arguments;
    try {
      const result = await callTool(root, name, args);
      return success(request.id, {
        content: [{ type: 'text', text: stableStringify(result) }],
        structuredContent: { result },
        isError: false,
      });
    } catch (error) {
      return success(request.id, {
        content: [{ type: 'text', text: error.message }],
        isError: true,
      });
    }
  };
}

async function callTool(root, name, args) {
  if (name === 'ingest_verification_receipt') {
    closedArguments(args, ['receipt']);
    const loaded = await loadReceipt(root, args.receipt);
    return ingestReceiptDocument(loaded.receipt, {
      sourcePath: loaded.relativePath,
      sourceSha256: loaded.sha256,
    });
  }
  if (name === 'compare_verification_receipts') {
    closedArguments(args, ['baseline', 'current']);
    const [baseline, current] = await Promise.all([
      loadReceipt(root, args.baseline),
      loadReceipt(root, args.current),
    ]);
    return compareReceiptDocuments(baseline.receipt, current.receipt, {
      baselineSource: { sourcePath: baseline.relativePath, sourceSha256: baseline.sha256 },
      currentSource: { sourcePath: current.relativePath, sourceSha256: current.sha256 },
    });
  }
  throw new Error('Unknown verification receipt tool');
}

function closedArguments(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Tool arguments must be an object');
  const supplied = Object.keys(value);
  const unknown = supplied.filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => typeof value[key] !== 'string' || value[key].trim() === '');
  if (unknown.length > 0) throw new Error(`Unknown tool argument: ${unknown.join(', ')}`);
  if (missing.length > 0) throw new Error(`Missing tool argument: ${missing.join(', ')}`);
}

function toolDefinitions() {
  return [
    {
      name: 'ingest_verification_receipt',
      description:
        'Validate and normalize one repository-owned verification receipt without executing tests.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['receipt'],
        properties: {
          receipt: { type: 'string', description: 'Repository-relative canonical receipt path.' },
        },
      },
    },
    {
      name: 'compare_verification_receipts',
      description: 'Compare two compatible repository-owned verification receipts.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['baseline', 'current'],
        properties: {
          baseline: { type: 'string', description: 'Repository-relative baseline receipt path.' },
          current: { type: 'string', description: 'Repository-relative current receipt path.' },
        },
      },
    },
  ];
}

function success(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function failure(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function serve() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--repo')
    throw new Error('usage: mcp.mjs --repo <repository>');
  const handle = await createMcpHandler(args[1]);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    let response;
    try {
      response = await handle(JSON.parse(line));
    } catch {
      response = failure(null, -32700, 'Parse error');
    }
    if (response) process.stdout.write(`${stableStringify(response)}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  serve().catch((error) => {
    process.stderr.write(`codevetter verification MCP: ${error.message}\n`);
    process.exitCode = 1;
  });
}
