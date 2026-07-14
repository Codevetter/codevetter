import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { execFileSync, spawn, spawnSync } from 'node:child_process';

const desktopRoot = resolve(import.meta.dirname, '..');
const tauriRoot = join(desktopRoot, 'src-tauri');
const repoRoot = resolve(desktopRoot, '../..');
const sidecar = join(
  tauriRoot,
  'target',
  'release',
  process.platform === 'win32' ? 'codevetter-mcp.exe' : 'codevetter-mcp'
);
const fixtureDir = mkdtempSync(join(tmpdir(), 'codevetter-mcp-bench-'));
const database = join(fixtureDir, 'codevetter.db');
const repoId = 'repo_fixture0123456789abcdef';
const startupRuns = Number(process.env.CV_MCP_STARTUP_RUNS ?? 25);
const queryRuns = Number(process.env.CV_MCP_QUERY_RUNS ?? 200);
const repositoryStatusBefore = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain=v1'], {
  encoding: 'utf8',
});

execFileSync(
  'cargo',
  [
    'build',
    '--release',
    '--manifest-path',
    join(tauriRoot, 'Cargo.toml'),
    '--bin',
    'codevetter-mcp',
  ],
  {
    cwd: desktopRoot,
    stdio: 'inherit',
    env: { ...process.env, CV_MCP_FIXTURE_EVENTS: '10000' },
  }
);
execFileSync(
  'cargo',
  [
    'run',
    '--quiet',
    '--manifest-path',
    join(tauriRoot, 'Cargo.toml'),
    '--example',
    'mcp_fixture',
    '--',
    repoRoot,
    database,
  ],
  { cwd: desktopRoot, stdio: 'inherit' }
);

class McpSession {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.child = spawn(sidecar, ['--database', database, '--repo-id', repoId], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        throw new Error(`Non-JSON sidecar stdout: ${line}`);
      }
      const resolvePending = this.pending.get(message.id);
      if (resolvePending) {
        this.pending.delete(message.id);
        resolvePending(message);
      }
    });
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString();
    });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    const response = new Promise((resolveResponse, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 10_000);
      this.pending.set(id, (message) => {
        clearTimeout(timeout);
        resolveResponse(message);
      });
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return response;
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async initialize() {
    const response = await this.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'codevetter-benchmark', version: '1' },
    });
    if (response.error) throw new Error(JSON.stringify(response.error));
    this.notify('notifications/initialized');
    return response;
  }

  async close() {
    this.child.stdin.end();
    await new Promise((resolveExit, reject) => {
      this.child.once('exit', (code) =>
        code === 0 ? resolveExit() : reject(new Error(this.stderr || `sidecar exited ${code}`))
      );
    });
  }
}

const startup = [];
for (let run = 0; run < startupRuns; run += 1) {
  const started = performance.now();
  const session = new McpSession();
  await session.initialize();
  startup.push(performance.now() - started);
  await session.close();
}

const session = new McpSession();
await session.initialize();
const listeners =
  process.platform === 'win32'
    ? ''
    : spawnSync('lsof', ['-nP', '-a', '-p', String(session.child.pid), '-iTCP', '-sTCP:LISTEN'], {
        encoding: 'utf8',
      }).stdout.trim();
if (listeners) throw new Error(`MCP sidecar opened a network listener:\n${listeners}`);
const rssKiB = Number(
  execFileSync('ps', ['-o', 'rss=', '-p', String(session.child.pid)], { encoding: 'utf8' }).trim()
);

async function benchmarkTool(name, args) {
  const samples = [];
  let bytes = 0;
  for (let run = 0; run < queryRuns; run += 1) {
    const started = performance.now();
    const response = await session.request('tools/call', { name, arguments: args });
    samples.push(performance.now() - started);
    bytes = Buffer.byteLength(JSON.stringify(response));
    if (response.error || response.result?.isError) throw new Error(JSON.stringify(response));
  }
  return { ...percentiles(samples), bytes };
}

const graph = await benchmarkTool('graph_query', { limit: 25 });
const releases = await benchmarkTool('history_list_releases', { limit: 25 });
const longLivedSearch = await benchmarkTool('history_search', {
  query: 'fixture',
  limit: 25,
  history_filter: { kinds: ['event'] },
});
const evidence = await benchmarkTool('history_get_evidence', { ids: ['fixture-evidence'] });
const listResourcesStarted = performance.now();
const resources = await session.request('resources/list', {});
const resourcesMs = performance.now() - listResourcesStarted;
await session.close();
const repositoryStatusAfter = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain=v1'], {
  encoding: 'utf8',
});
if (repositoryStatusAfter !== repositoryStatusBefore) {
  throw new Error('MCP benchmark mutated the target repository');
}

const report = {
  machine: `${process.platform}-${process.arch}`,
  protocol: '2025-11-25',
  sidecarBytes: statSync(sidecar).size,
  fixtureDatabaseBytes: statSync(database).size,
  fixtureEventCount: 10_000,
  startup: percentiles(startup),
  graphQuery: graph,
  releaseList: releases,
  longLivedSearch,
  evidenceHydration: evidence,
  resourceList: { milliseconds: resourcesMs, bytes: Buffer.byteLength(JSON.stringify(resources)) },
  idleRssMiB: rssKiB / 1024,
  networkListeners: 0,
  startupRuns,
  queryRuns,
};

assertMaximum('cold initialize p95', report.startup.p95Ms, 25, 'ms');
assertMaximum('graph_query p95', report.graphQuery.p95Ms, 6, 'ms');
assertMaximum('history_list_releases p95', report.releaseList.p95Ms, 6, 'ms');
assertMaximum('history_search p95', report.longLivedSearch.p95Ms, 6, 'ms');
assertMaximum('history_get_evidence p95', report.evidenceHydration.p95Ms, 6, 'ms');
assertMaximum('resource listing', report.resourceList.milliseconds, 6, 'ms');
assertMaximum('idle RSS', report.idleRssMiB, 24, 'MiB');
assertMaximum('sidecar binary', report.sidecarBytes / 1_048_576, 10, 'MiB');

console.log('\n=== CodeVetter MCP release-binary benchmark ===');
console.table({
  'cold initialize': display(report.startup),
  graph_query: display(report.graphQuery),
  history_list_releases: display(report.releaseList),
  'history_search (10k events)': display(report.longLivedSearch),
  history_get_evidence: display(report.evidenceHydration),
});
console.log(`resource list: ${resourcesMs.toFixed(3)} ms / ${report.resourceList.bytes} bytes`);
console.log(`idle RSS: ${report.idleRssMiB.toFixed(2)} MiB`);
console.log(`binary: ${(report.sidecarBytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`fixture DB: ${(report.fixtureDatabaseBytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(JSON.stringify(report));

function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50Ms: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    maxMs: sorted.at(-1),
  };
}

function display(result) {
  return {
    p50_ms: result.p50Ms.toFixed(3),
    p95_ms: result.p95Ms.toFixed(3),
    max_ms: result.maxMs.toFixed(3),
    bytes: result.bytes ?? '-',
  };
}

function assertMaximum(label, actual, maximum, unit) {
  if (actual > maximum) {
    throw new Error(
      `MCP release budget exceeded: ${label} was ${actual.toFixed(3)} ${unit}, maximum ${maximum.toFixed(3)} ${unit}`
    );
  }
}
