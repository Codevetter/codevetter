import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { collectNodeFlowStreamEvents } from './flow-capture.mjs';
import {
  SERVER_REQUEST_RUNTIME_MECHANISMS,
  collectServerRequestCpuProfiles,
  diagnoseRuntimeMechanisms,
  normalizeCpuProfile,
} from './server-request-cpu.mjs';

const FLOW_PRELOAD = fileURLToPath(new URL('./node-flow-preload.mjs', import.meta.url));

test('normalizes material exact and closed Next server source frames', async (context) => {
  const root = await fixtureRoot(context);
  const source = join(root, 'src', 'hot.mjs');
  await writeFile(source, 'export function hot() {}\n', 'utf8');
  const exact = await normalizeCpuProfile(
    profileDocument(pathToFileURL(source).href, 'api_key=private-value'),
    root
  );
  assert.equal(exact.state, 'observed');
  assert.equal(exact.candidates[0].source.file, 'src/hot.mjs');
  assert.equal(exact.candidates[0].source.line, 1);
  assert.equal(exact.candidates[0].source.function, 'api_key=<redacted>');
  assert.deepEqual(exact.sample_scope, {
    repository: 10,
    dependency: 0,
    generated: 0,
    runtime: 0,
    idle: 0,
    unresolved: 0,
  });
  assert.deepEqual(exact.precommit, {
    state: 'observed',
    boundary_ms: 0.5,
    total_samples: 5,
    sampled_time_ms: 0.5,
    non_idle_sampled_time_ms: 0.5,
    sample_scope: {
      repository: 5,
      dependency: 0,
      generated: 0,
      runtime: 0,
      idle: 0,
      unresolved: 0,
    },
    sample_scope_time_ms: {
      repository: 0.5,
      dependency: 0,
      generated: 0,
      runtime: 0,
      idle: 0,
      unresolved: 0,
    },
    complete: true,
    provenance: 'v8_request_profile_cumulative_time_deltas',
  });
  assert.ok(!JSON.stringify(exact).includes('private-value'));

  const webpack = await normalizeCpuProfile(
    profileDocument('webpack-internal:///(rsc)/./src/hot.mjs?private=query', 'hot'),
    root
  );
  assert.equal(webpack.candidates[0].source.file, 'src/hot.mjs');
});

test('rejects overlap, generated paths, and malformed profiles', async (context) => {
  const root = await fixtureRoot(context);
  const generated = join(root, '.next', 'server.js');
  await writeFile(generated, 'export {};\n', 'utf8');
  const contaminated = await normalizeCpuProfile(
    { ...profileDocument(pathToFileURL(generated).href), overlapping_dynamic_requests: 1 },
    root
  );
  assert.equal(contaminated.state, 'contaminated');
  assert.deepEqual(contaminated.candidates, []);
  assert.equal(contaminated.runtime_mechanisms.complete, false);

  const excluded = await normalizeCpuProfile(profileDocument(pathToFileURL(generated).href), root);
  assert.equal(excluded.state, 'insufficient');
  assert.deepEqual(excluded.candidates, []);
  const malformed = await normalizeCpuProfile({ profile: null }, root);
  assert.equal(malformed.state, 'invalid');
  const truncated = profileDocument(pathToFileURL(generated).href);
  truncated.profile.samples = Array.from({ length: 100_001 }, () => 1);
  truncated.profile.timeDeltas = Array.from({ length: 100_001 }, () => 100);
  assert.equal((await normalizeCpuProfile(truncated, root)).state, 'invalid');
  assert.equal(
    (
      await normalizeCpuProfile(
        { ...profileDocument(pathToFileURL(generated).href), response_commit_offset_ms: 2 },
        root
      )
    ).state,
    'invalid'
  );
});

test('retains only isolated pre-commit mechanisms when overlap begins after commit', async (context) => {
  const root = await fixtureRoot(context);
  const document = profileDocument('node:fs', 'readFile');
  document.schema_version = 'codevetter-node-request-cpu-profile/v3';
  document.overlapping_dynamic_requests = 1;
  document.overlapping_precommit_dynamic_requests = 0;
  document.response_commit_offset_ms = 10;
  document.profile.timeDeltas = Array.from({ length: 10 }, () => 1_000);

  const summary = await normalizeCpuProfile(document, root);
  assert.equal(summary.state, 'contaminated');
  assert.equal(summary.overlapping_dynamic_requests, 1);
  assert.equal(summary.overlapping_precommit_dynamic_requests, 0);
  assert.equal(summary.total_samples, 0);
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.candidates, []);
  assert.equal(summary.runtime_mechanisms.request.complete, false);
  assert.equal(summary.runtime_mechanisms.request.total_samples, 0);
  assert.equal(summary.runtime_mechanisms.precommit.complete, true);
  assert.equal(summary.runtime_mechanisms.precommit.total_samples, 10);
  assert.equal(summary.runtime_mechanisms.complete, true);
  assert.equal(diagnoseRuntimeMechanisms(summary).classification, 'runtime_filesystem');
  assert.equal(diagnoseRuntimeMechanisms(summary).source, null);
  assert.equal(diagnoseRuntimeMechanisms(summary).edit_authority, 'none');

  const malformed = structuredClone(document);
  malformed.overlapping_precommit_dynamic_requests = 2;
  const rejected = await normalizeCpuProfile(malformed, root);
  assert.equal(rejected.state, 'invalid');
  assert.equal(rejected.runtime_mechanisms.complete, false);
});

test('classifies every closed runtime mechanism without retaining raw identity', async (context) => {
  const root = await fixtureRoot(context);
  const frames = [
    ['node:internal/modules/cjs/loader', 'load', 'module_loading'],
    ['node:vm', 'compileFunction', 'compilation'],
    ['', '(garbage collector)', 'garbage_collection'],
    ['node:internal/process/task_queues', 'runMicrotasks', 'promise_microtasks'],
    ['node:internal/timers', 'processTimers', 'timers_scheduling'],
    ['node:_http_server', 'parserOnIncoming', 'http_streams'],
    ['node:buffer', 'utf8Write', 'buffer_encoding'],
    ['node:fs', 'readFile', 'filesystem'],
    ['node:crypto', 'cipher', 'crypto_compression'],
    ['node:inspector', 'private-profiler-token', 'inspector'],
    ['[native code]', 'Builtin:ArrayMap', 'v8_builtins'],
    ['node:mystery/private-secret', 'private-engine-label', 'other_runtime'],
  ];
  const document = profileDocument('node:internal/modules/cjs/loader', 'load');
  document.response_commit_offset_ms = frames.length * 10;
  document.profile.nodes = frames.map(([url, functionName], index) => ({
    id: index + 1,
    callFrame: { url, functionName, lineNumber: 0, columnNumber: 0 },
  }));
  document.profile.samples = frames.map((_, index) => index + 1);
  document.profile.timeDeltas = frames.map(() => 10_000);
  const summary = await normalizeCpuProfile(document, root);
  assert.deepEqual(
    summary.runtime_mechanisms.precommit.mechanisms.map((entry) => entry.mechanism).toSorted(),
    [...SERVER_REQUEST_RUNTIME_MECHANISMS].toSorted()
  );
  assert.equal(summary.runtime_mechanisms.precommit.total_samples, frames.length);
  assert.equal(summary.runtime_mechanisms.precommit.sampled_time_ms, 120);
  assert.equal(summary.runtime_mechanisms.complete, true);
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes('private-profiler-token'), false);
  assert.equal(serialized.includes('private-engine-label'), false);
  assert.equal(serialized.includes('private-secret'), false);
});

test('runtime routing applies fixed floors, observer isolation, and incomplete fail-closed behavior', async (context) => {
  const root = await fixtureRoot(context);
  const dominantDocument = profileDocument('node:fs', 'readFile');
  dominantDocument.response_commit_offset_ms = 10;
  dominantDocument.profile.timeDeltas = Array.from({ length: 10 }, () => 1_000);
  const dominant = await normalizeCpuProfile(dominantDocument, root);
  assert.deepEqual(diagnoseRuntimeMechanisms(dominant), {
    classification: 'runtime_filesystem',
    dominant_mechanism: 'filesystem',
    observed_self_time_ms: 10,
    observed_runtime_sample_share: 1,
    next_probe: 'inspect_filesystem_runtime',
    confidence: 'low',
    source: null,
    causal_authority: 'none',
    edit_authority: 'none',
  });

  const belowFloorDocument = profileDocument('node:fs', 'readFile');
  belowFloorDocument.response_commit_offset_ms = 4.999;
  belowFloorDocument.profile.samples = Array.from({ length: 5 }, () => 1);
  belowFloorDocument.profile.timeDeltas = Array.from({ length: 5 }, () => 999.8);
  const belowFloor = await normalizeCpuProfile(belowFloorDocument, root);
  assert.equal(diagnoseRuntimeMechanisms(belowFloor).classification, 'unresolved');

  const inspectorDocument = profileDocument('node:inspector', 'dispatch');
  inspectorDocument.response_commit_offset_ms = 10;
  inspectorDocument.profile.timeDeltas = Array.from({ length: 10 }, () => 1_000);
  const inspector = await normalizeCpuProfile(inspectorDocument, root);
  assert.equal(diagnoseRuntimeMechanisms(inspector).classification, 'observer_effect');
  assert.equal(diagnoseRuntimeMechanisms(inspector).source, null);
  assert.equal(diagnoseRuntimeMechanisms(inspector).edit_authority, 'none');

  const missing = profileDocument('node:fs', 'readFile');
  missing.profile.samples[0] = 999;
  const incomplete = await normalizeCpuProfile(missing, root);
  assert.equal(incomplete.sample_scope.unresolved, 1);
  assert.equal(incomplete.runtime_mechanisms.state, 'incomplete');
  assert.equal(diagnoseRuntimeMechanisms(incomplete).classification, 'incomplete');
});

test('owned preload profiles a dynamic request and skips static resources', async (context) => {
  const root = await fixtureRoot(context);
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
function expensiveWork() {
  let value = 0;
  const end = performance.now() + 40;
  while (performance.now() < end) value = (value + Math.sqrt(value + 1)) % 100000;
  return value;
}
const server = http.createServer((request, response) => {
  if (request.url === '/api/work') expensiveWork();
  response.end('ok');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const headers = { 'x-codevetter-capture': 'cpu-capture' };
await fetch('http://127.0.0.1:' + port + '/asset.js', { headers });
await fetch('http://127.0.0.1:' + port + '/api/work', { headers });
await new Promise((resolve) => setTimeout(resolve, 100));
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, root);
  const flow = await collectNodeFlowStreamEvents(root, { correlationId: 'cpu-capture' });
  const servers = flow.events.filter((event) => event.kind === 'http_server');
  const profiles = await collectServerRequestCpuProfiles(root, {
    repositoryRoot: root,
    eventIds: servers.map((event) => event.event_id),
  });
  const cpuFiles = (await readdir(root)).filter((name) => name.startsWith('cpu-'));
  assert.equal(cpuFiles.length, 1);
  const dynamic = servers.find((event) => event.route === '/api/work');
  assert.equal(profiles.get(dynamic.event_id)?.state, 'observed');
  assert.equal(profiles.get(dynamic.event_id).candidates[0].source.file, 'server.mjs');
  assert.ok(profiles.get(dynamic.event_id).candidates[0].samples >= 5);
  assert.equal(profiles.get(dynamic.event_id).precommit.state, 'observed');
  assert.ok(profiles.get(dynamic.event_id).precommit.total_samples >= 5);
});

test('overlapping captured dynamic requests contaminate the active profile', async (context) => {
  const root = await fixtureRoot(context);
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
const server = http.createServer(async (_request, response) => {
  await new Promise((resolve) => setTimeout(resolve, 35));
  response.end('ok');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const headers = { 'x-codevetter-capture': 'cpu-capture' };
await Promise.all([
  fetch('http://127.0.0.1:' + port + '/api/one', { headers }),
  fetch('http://127.0.0.1:' + port + '/api/two', { headers }),
]);
await new Promise((resolve) => setTimeout(resolve, 100));
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, root);
  const flow = await collectNodeFlowStreamEvents(root, { correlationId: 'cpu-capture' });
  const servers = flow.events.filter((event) => event.kind === 'http_server');
  const profiles = await collectServerRequestCpuProfiles(root, {
    repositoryRoot: root,
    eventIds: servers.map((event) => event.event_id),
  });
  assert.equal(profiles.size, 1);
  assert.equal([...profiles.values()][0].state, 'contaminated');
  assert.equal([...profiles.values()][0].overlapping_dynamic_requests, 1);
  assert.equal([...profiles.values()][0].overlapping_precommit_dynamic_requests, 1);
  assert.equal([...profiles.values()][0].runtime_mechanisms.complete, false);
});

test('owned preload preserves an isolated pre-commit slice across post-commit overlap', async (context) => {
  const root = await fixtureRoot(context);
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
function expensiveWork() {
  let value = 0;
  const end = performance.now() + 40;
  while (performance.now() < end) value = (value + Math.sqrt(value + 1)) % 100000;
  return value;
}
const server = http.createServer((request, response) => {
  if (request.url === '/api/one') {
    expensiveWork();
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.flushHeaders();
    setTimeout(() => response.end('one'), 60);
    return;
  }
  response.end('two');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const headers = { 'x-codevetter-capture': 'cpu-capture' };
const first = await fetch('http://127.0.0.1:' + port + '/api/one', { headers });
const second = await fetch('http://127.0.0.1:' + port + '/api/two', { headers });
await Promise.all([first.text(), second.text()]);
await new Promise((resolve) => setTimeout(resolve, 100));
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, root);
  const flow = await collectNodeFlowStreamEvents(root, { correlationId: 'cpu-capture' });
  const servers = flow.events.filter((event) => event.kind === 'http_server');
  const profiles = await collectServerRequestCpuProfiles(root, {
    repositoryRoot: root,
    eventIds: servers.map((event) => event.event_id),
  });
  const firstRequest = servers.find((event) => event.route === '/api/one');
  const summary = profiles.get(firstRequest.event_id);
  assert.equal(summary.state, 'contaminated');
  assert.equal(summary.overlapping_dynamic_requests, 1);
  assert.equal(summary.overlapping_precommit_dynamic_requests, 0);
  assert.equal(summary.total_samples, 0);
  assert.deepEqual(summary.candidates, []);
  assert.equal(summary.precommit.complete, true);
  assert.ok(summary.precommit.total_samples >= 5);
  assert.equal(summary.runtime_mechanisms.request.complete, false);
  assert.equal(summary.runtime_mechanisms.precommit.complete, true);

  const cpuFile = (await readdir(root)).find((name) => name.startsWith('cpu-'));
  const raw = JSON.parse(await readFile(join(root, cpuFile), 'utf8'));
  assert.equal(raw.schema_version, 'codevetter-node-request-cpu-profile/v3');
  assert.equal(raw.overlapping_dynamic_requests, 1);
  assert.equal(raw.overlapping_precommit_dynamic_requests, 0);
});

function profileDocument(url, functionName = 'hot') {
  return {
    schema_version: 'codevetter-node-request-cpu-profile/v2',
    parent_event_id: 'event-1-1',
    overlapping_dynamic_requests: 0,
    response_commit_offset_ms: 0.5,
    profile: {
      nodes: [{ id: 1, callFrame: { url, functionName, lineNumber: 0, columnNumber: 0 } }],
      samples: Array.from({ length: 10 }, () => 1),
      timeDeltas: Array.from({ length: 10 }, () => 100),
    },
  };
}

async function fixtureRoot(context) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-request-cpu-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, '.next'), { recursive: true });
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
        CODEVETTER_FLOW_CORRELATION_ID: 'cpu-capture',
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
