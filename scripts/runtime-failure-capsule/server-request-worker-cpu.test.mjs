import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { collectNodeFlowStreamEvents } from './flow-capture.mjs';
import {
  collectServerRequestWorkerCpuProfiles,
  normalizeWorkerCpuProfile,
} from './server-request-worker-cpu.mjs';

const FLOW_PRELOAD = fileURLToPath(new URL('./node-flow-preload.mjs', import.meta.url));

test('normalizes anonymous Worker CPU and contained sampled scopes', async (context) => {
  const root = await fixtureRoot(context);
  const source = join(root, 'src', 'worker.mjs');
  await writeFile(source, 'export function work() {}\n', 'utf8');
  const summary = await normalizeWorkerCpuProfile(
    rawDocument([rawWorker(pathToFileURL(source).href)]),
    root
  );

  assert.equal(summary.state, 'observed');
  assert.equal(summary.total_cpu_ms, 7);
  assert.equal(summary.inventory.retained, 1);
  assert.equal(summary.workers[0].ordinal, 1);
  assert.equal(summary.workers[0].profile.candidates[0].source.file, 'src/worker.mjs');
  assert.equal(
    summary.workers[0].profile.candidates[0].source.provenance,
    'node_worker_cpu_sample'
  );
  assert.equal(JSON.stringify(summary).includes('threadId'), false);
});

test('zero, unsupported, incomplete, contaminated, and malformed Worker evidence fail closed', async (context) => {
  const root = await fixtureRoot(context);
  const zero = await normalizeWorkerCpuProfile(rawDocument([]), root);
  assert.equal(zero.state, 'observed_zero');
  assert.equal(zero.complete, true);

  const unsupported = rawDocument([]);
  unsupported.supported = false;
  unsupported.inventory.complete = false;
  assert.equal((await normalizeWorkerCpuProfile(unsupported, root)).state, 'unsupported');

  const incomplete = rawDocument([rawWorker('node:internal/worker')]);
  incomplete.workers[0] = {
    ...incomplete.workers[0],
    state: 'start_failed',
    start_offset_ms: null,
    stop_offset_ms: null,
    user_us: null,
    system_us: null,
    profile: null,
  };
  incomplete.inventory.retained = 0;
  incomplete.inventory.complete = false;
  assert.equal((await normalizeWorkerCpuProfile(incomplete, root)).state, 'insufficient');

  const contaminated = rawDocument([]);
  contaminated.overlapping_dynamic_requests = 1;
  assert.equal((await normalizeWorkerCpuProfile(contaminated, root)).state, 'contaminated');

  const malformed = rawDocument([rawWorker('node:internal/worker')]);
  malformed.workers[0].profile.samples = Array.from({ length: 100_001 }, () => 1);
  malformed.workers[0].profile.timeDeltas = Array.from({ length: 100_001 }, () => 100);
  assert.equal((await normalizeWorkerCpuProfile(malformed, root)).state, 'invalid');

  const inconsistent = rawDocument([rawWorker('node:internal/worker')]);
  inconsistent.inventory.retained = 0;
  assert.equal((await normalizeWorkerCpuProfile(inconsistent, root)).state, 'insufficient');

  const escaping = await normalizeWorkerCpuProfile(
    rawDocument([rawWorker(pathToFileURL(join(dirname(root), 'outside-worker.mjs')).href)]),
    root
  );
  assert.equal(JSON.stringify(escaping).includes('outside-worker.mjs'), false);

  await writeFile(join(root, 'worker-cpu-1-1.json'), ' '.repeat(8 * 1024 * 1024 + 1), 'utf8');
  assert.equal(
    (
      await collectServerRequestWorkerCpuProfiles(root, {
        repositoryRoot: root,
        eventIds: ['event-1-1'],
      })
    ).size,
    0
  );
});

test('owned preload observes CommonJS and ESM Workers across one request interval', async (context) => {
  const root = await fixtureRoot(context);
  const workerScript = join(root, 'worker.cjs');
  const serverScript = join(root, 'server.mjs');
  await writeFile(
    workerScript,
    `const { parentPort } = require('node:worker_threads');
parentPort.on('message', () => {
  let value = 0;
  const end = performance.now() + 35;
  while (performance.now() < end) value = (value + Math.sqrt(value + 1)) % 100000;
  parentPort.postMessage(value);
});
`,
    'utf8'
  );
  await writeFile(
    serverScript,
    `import http from 'node:http';
import { createRequire } from 'node:module';
import { Worker as EsmWorker } from 'node:worker_threads';
const require = createRequire(import.meta.url);
const { Worker: CommonWorker } = require('node:worker_threads');
const workers = [new EsmWorker(new URL('./worker.cjs', import.meta.url)), new CommonWorker(new URL('./worker.cjs', import.meta.url))];
if (!workers.every((worker) => worker instanceof EsmWorker && worker instanceof CommonWorker)) throw new Error('Worker compatibility changed');
await Promise.all(workers.map((worker) => new Promise((resolve, reject) => { worker.once('online', resolve); worker.once('error', reject); })));
const server = http.createServer(async (_request, response) => {
  await Promise.all(workers.map((worker) => new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); worker.postMessage('work'); })));
  response.end('ok');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const headers = { 'x-codevetter-capture': 'worker-capture' };
await fetch('http://127.0.0.1:' + server.address().port + '/api/work', { headers });
await new Promise((resolve) => setTimeout(resolve, 150));
await Promise.all(workers.map((worker) => worker.terminate()));
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );

  await runNode(serverScript, root);
  const flow = await collectNodeFlowStreamEvents(root, { correlationId: 'worker-capture' });
  const request = flow.events.find((event) => event.kind === 'http_server');
  const profiles = await collectServerRequestWorkerCpuProfiles(root, {
    repositoryRoot: root,
    eventIds: [request.event_id],
  });
  const summary = profiles.get(request.event_id);
  assert.equal(summary.state, 'observed');
  assert.equal(summary.inventory.online_at_admission, 2);
  assert.equal(summary.inventory.retained, 2);
  assert.ok(summary.total_cpu_ms >= 20);
  assert.ok(
    summary.workers.some((worker) =>
      worker.profile.candidates.some((candidate) => candidate.source.file === 'worker.cjs')
    )
  );
  const rawName = (await readdir(root)).find((name) => name.startsWith('worker-cpu-'));
  const raw = await readFile(join(root, rawName), 'utf8');
  assert.equal(raw.includes('worker.cjs'), true);
  assert.equal(JSON.stringify(summary).includes('workerData'), false);
});

test('Worker creation during the request makes the admitted inventory incomplete', async (context) => {
  const root = await fixtureRoot(context);
  const workerScript = join(root, 'late-worker.cjs');
  const serverScript = join(root, 'late-server.mjs');
  await writeFile(
    workerScript,
    `const { parentPort } = require('node:worker_threads'); parentPort.postMessage('ready');`,
    'utf8'
  );
  await writeFile(
    serverScript,
    `import http from 'node:http'; import { Worker } from 'node:worker_threads';
let late;
const server = http.createServer(async (_request, response) => {
  late = new Worker(new URL('./late-worker.cjs', import.meta.url));
  await new Promise((resolve, reject) => { late.once('message', resolve); late.once('error', reject); });
  response.end('ok');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
await fetch('http://127.0.0.1:' + server.address().port + '/api/late', { headers: { 'x-codevetter-capture': 'worker-capture' } });
await new Promise((resolve) => setTimeout(resolve, 100));
await late.terminate();
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );

  await runNode(serverScript, root);
  const flow = await collectNodeFlowStreamEvents(root, { correlationId: 'worker-capture' });
  const request = flow.events.find((event) => event.kind === 'http_server');
  const profiles = await collectServerRequestWorkerCpuProfiles(root, {
    repositoryRoot: root,
    eventIds: [request.event_id],
  });
  const summary = profiles.get(request.event_id);
  assert.equal(summary.state, 'insufficient');
  assert.equal(summary.inventory.created_during_interval, 1);
  assert.equal(summary.inventory.complete, false);
});

test('Workers that exit before request admission are excluded without losing lifecycle count', async (context) => {
  const root = await fixtureRoot(context);
  const workerScript = join(root, 'exited-worker.cjs');
  const serverScript = join(root, 'exited-server.mjs');
  await writeFile(workerScript, ``, 'utf8');
  await writeFile(
    serverScript,
    `import http from 'node:http'; import { Worker } from 'node:worker_threads';
const worker = new Worker(new URL('./exited-worker.cjs', import.meta.url));
await new Promise((resolve, reject) => { worker.once('exit', resolve); worker.once('error', reject); });
const server = http.createServer((_request, response) => response.end('ok'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
await fetch('http://127.0.0.1:' + server.address().port + '/api/exited', { headers: { 'x-codevetter-capture': 'worker-capture' } });
await new Promise((resolve) => setTimeout(resolve, 100));
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );

  await runNode(serverScript, root);
  const flow = await collectNodeFlowStreamEvents(root, { correlationId: 'worker-capture' });
  const request = flow.events.find((event) => event.kind === 'http_server');
  const profiles = await collectServerRequestWorkerCpuProfiles(root, {
    repositoryRoot: root,
    eventIds: [request.event_id],
  });
  const summary = profiles.get(request.event_id);
  assert.equal(summary.state, 'observed_zero');
  assert.equal(summary.inventory.registered_total, 1);
  assert.equal(summary.inventory.registered_current, 0);
  assert.equal(summary.inventory.retained, 0);
  assert.equal(summary.complete, true);
});

test('overlapping dynamic requests contaminate the active Worker interval', async (context) => {
  const root = await fixtureRoot(context);
  const workerScript = join(root, 'overlap-worker.cjs');
  const serverScript = join(root, 'overlap-server.mjs');
  await writeFile(
    workerScript,
    `const { parentPort } = require('node:worker_threads'); parentPort.on('message', () => setTimeout(() => parentPort.postMessage('done'), 30));`,
    'utf8'
  );
  await writeFile(
    serverScript,
    `import http from 'node:http'; import { Worker } from 'node:worker_threads';
const worker = new Worker(new URL('./overlap-worker.cjs', import.meta.url));
await new Promise((resolve, reject) => { worker.once('online', resolve); worker.once('error', reject); });
const server = http.createServer(async (_request, response) => {
  await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); worker.postMessage('work'); });
  response.end('ok');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const target = 'http://127.0.0.1:' + server.address().port;
const options = { headers: { 'x-codevetter-capture': 'worker-capture' } };
await Promise.all([fetch(target + '/api/one', options), fetch(target + '/api/two', options)]);
await new Promise((resolve) => setTimeout(resolve, 100));
await worker.terminate(); await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );

  await runNode(serverScript, root);
  const flow = await collectNodeFlowStreamEvents(root, { correlationId: 'worker-capture' });
  const requests = flow.events.filter((event) => event.kind === 'http_server');
  const profiles = await collectServerRequestWorkerCpuProfiles(root, {
    repositoryRoot: root,
    eventIds: requests.map((request) => request.event_id),
  });
  assert.equal(profiles.size, 1);
  assert.equal([...profiles.values()][0].state, 'contaminated');
  assert.equal([...profiles.values()][0].overlapping_dynamic_requests, 1);
});

function rawDocument(workers) {
  return {
    schema_version: 'codevetter-node-request-worker-cpu/v1',
    parent_event_id: 'event-1-1',
    supported: true,
    response_commit_offset_ms: 10,
    overlapping_dynamic_requests: 0,
    inventory: {
      registered_total: workers.length,
      registered_current: workers.length,
      online_at_admission: workers.length,
      attempted: workers.length,
      retained: workers.filter((worker) => worker.state === 'observed').length,
      created_during_interval: 0,
      registry_truncated: false,
      admitted_truncated: false,
      complete: true,
    },
    workers,
  };
}

function rawWorker(url) {
  return {
    ordinal: 1,
    state: 'observed',
    start_request_offset_ms: 0.1,
    start_offset_ms: 0.2,
    stop_offset_ms: 10.1,
    user_us: 6_000,
    system_us: 1_000,
    profile: {
      nodes: [{ id: 1, callFrame: { url, functionName: 'work', lineNumber: 0, columnNumber: 0 } }],
      samples: Array.from({ length: 10 }, () => 1),
      timeDeltas: Array.from({ length: 10 }, () => 100),
    },
  };
}

async function fixtureRoot(context) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-worker-cpu-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'), { recursive: true });
  return root;
}

function runNode(script, directory) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--import', pathToFileURL(FLOW_PRELOAD).href, script], {
      cwd: dirname(script),
      env: {
        CI: '1',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        ...Object.fromEntries(
          ['PATH', 'TMPDIR', 'TMP', 'TEMP'].flatMap((name) =>
            typeof process.env[name] === 'string' ? [[name, process.env[name]]] : []
          )
        ),
        CODEVETTER_FLOW_DIRECTORY: directory,
        CODEVETTER_REPOSITORY_ROOT: directory,
        CODEVETTER_FLOW_STREAM: '1',
        CODEVETTER_FLOW_CPU: '1',
        CODEVETTER_FLOW_CORRELATION_ID: 'worker-capture',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`fixture exited ${code}: ${stderr}`));
    });
  });
}
