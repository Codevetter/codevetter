import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { collectNodeFlowStreamEvents } from './flow-capture.mjs';
import {
  CONTINUOUS_SOURCE_POLICY,
  assertContinuousSourceSummary,
  collectServerRequestContinuousSourceProfiles,
  normalizeContinuousSourceProfile,
} from './server-request-continuous-source.mjs';

const FLOW_PRELOAD = fileURLToPath(new URL('./node-flow-preload.mjs', import.meta.url));

test('reconstructs the exact relative interval without absolute clock alignment', async (context) => {
  const root = await fixtureRoot(context);
  const source = join(root, 'src', 'hot.mjs');
  await writeFile(source, 'export function hot() {}\n', 'utf8');
  const result = await normalizeContinuousSourceProfile(
    profileDocument(pathToFileURL(source).href, 'token=private-value'),
    root,
    target()
  );

  assert.equal(result.state, 'observed');
  assert.equal(result.complete, true);
  assert.equal(result.interval.profile_duration_ms, 32);
  assert.equal(result.interval.request_start_position_ms, 10);
  assert.equal(result.interval.commit_position_ms, 30);
  assert.equal(result.interval.boundary_uncertainty_ms, 3);
  assert.equal(result.total_samples, 20);
  assert.equal(result.sampled_time_ms, 20);
  assert.equal(result.candidates[0].source.file, 'src/hot.mjs');
  assert.equal(result.candidates[0].source.function, 'token=<redacted>');
  assert.equal(result.candidates[0].self_time_ms, 20);
  assert.equal(result.candidates[0].non_idle_sample_share, 1);
  assert.equal(result.authority.source_causal, false);
  assert.equal(result.authority.edit_eligible, false);
  assert.equal(result.authority.optimization_eligible, false);
  assert.equal(JSON.stringify(result).includes('private-value'), false);
  assert.equal(assertContinuousSourceSummary(result), result);
});

test('keeps dependency, runtime, idle, generated, and arbitrary identities aggregated', async (context) => {
  const root = await fixtureRoot(context);
  const document = profileDocument('node:fs', 'private-runtime-label');
  document.profile.nodes = [
    frame(1, 'node:fs', 'private-runtime-label'),
    frame(2, '/tmp/node_modules/pkg/index.js', 'private-dependency-label'),
    frame(3, '/tmp/.next/server.js', 'private-generated-label'),
    frame(4, '', '(idle)'),
    frame(5, 'https://secret.example/private', 'private-arbitrary-label'),
  ];
  document.profile.samples = [
    ...Array.from({ length: 10 }, () => 1),
    ...Array.from({ length: 4 }, () => 1),
    ...Array.from({ length: 4 }, () => 2),
    ...Array.from({ length: 4 }, () => 3),
    ...Array.from({ length: 4 }, () => 4),
    ...Array.from({ length: 4 }, () => 5),
    ...Array.from({ length: 2 }, () => 1),
  ];
  document.profile.timeDeltas = document.profile.samples.map(() => 1_000);
  const result = await normalizeContinuousSourceProfile(document, root, target());

  assert.equal(result.state, 'unresolved');
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.sample_scope, {
    repository: 0,
    dependency: 4,
    generated: 4,
    runtime: 4,
    idle: 4,
    unresolved: 4,
  });
  const serialized = JSON.stringify(result);
  for (const raw of [
    'private-runtime-label',
    'private-dependency-label',
    'private-generated-label',
    'private-arbitrary-label',
    'secret.example',
  ]) {
    assert.equal(serialized.includes(raw), false);
  }
});

test('requires count, sampled time, and non-idle share floors together', async (context) => {
  const root = await fixtureRoot(context);
  const source = join(root, 'src', 'hot.mjs');
  await writeFile(source, 'export function hot() {}\n', 'utf8');
  const sourceUrl = pathToFileURL(source).href;

  const exact = profileDocument(sourceUrl, 'hot');
  exact.response_commit_offset_ms = 5;
  exact.profile.samples = [
    ...Array.from({ length: 10 }, () => 2),
    ...Array.from({ length: 5 }, () => 1),
    ...Array.from({ length: 2 }, () => 2),
  ];
  exact.profile.nodes = [frame(1, sourceUrl, 'hot'), frame(2, 'node:fs', 'readFile')];
  exact.profile.timeDeltas = exact.profile.samples.map(() => 1_000);
  const accepted = await normalizeContinuousSourceProfile(exact, root, target());
  assert.equal(accepted.state, 'observed');
  assert.equal(accepted.candidates[0].samples, CONTINUOUS_SOURCE_POLICY.minimum_samples);

  for (const mutate of [
    (document) => {
      document.profile.samples[14] = 2;
    },
    (document) => {
      document.profile.timeDeltas = document.profile.timeDeltas.map((delta, index) =>
        index >= 10 && index < 15 ? 999 : delta
      );
      document.response_commit_offset_ms = 4.995;
    },
    (document) => {
      document.profile.samples = [
        ...Array.from({ length: 10 }, () => 2),
        ...Array.from({ length: 5 }, () => 1),
        ...Array.from({ length: 50 }, () => 2),
        ...Array.from({ length: 2 }, () => 2),
      ];
      document.profile.timeDeltas = document.profile.samples.map(() => 1_000);
      document.response_commit_offset_ms = 55;
    },
  ]) {
    const below = structuredClone(exact);
    mutate(below);
    const result = await normalizeContinuousSourceProfile(below, root, target());
    assert.equal(result.state, 'unresolved');
    assert.deepEqual(result.candidates, []);
  }
});

test('fails closed for startup, target, overlap, tail, profile, and interval gaps', async (context) => {
  const root = await fixtureRoot(context);
  const cases = [
    ['startup_unattested', (value) => (value.startup_attested = false), 'incomplete'],
    ['target_unmatched', (value) => (value.target_match_count = 0), 'incomplete'],
    ['target_multiple', (value) => (value.target_match_count = 2), 'incomplete'],
    ['response_uncommitted', (value) => (value.response_committed = false), 'incomplete'],
    [
      'precommit_overlap',
      (value) => {
        value.overlapping_dynamic_requests = 1;
        value.overlapping_precommit_dynamic_requests = 1;
      },
      'contaminated',
    ],
    ['stop_tail_invalid', (value) => (value.stop_tail_ms = 100.001), 'invalid'],
    ['profile_invalid', (value) => value.profile.timeDeltas.pop(), 'invalid'],
    ['interval_incomplete', (value) => (value.response_commit_offset_ms = 100), 'incomplete'],
  ];
  for (const [reason, mutate, state] of cases) {
    const document = profileDocument('node:fs', 'readFile');
    mutate(document);
    const result = await normalizeContinuousSourceProfile(document, root, target());
    assert.equal(result.state, state);
    assert.equal(result.incomplete_reason, reason);
    assert.equal(result.complete, false);
    assert.deepEqual(result.candidates, []);
  }

  const mismatch = await normalizeContinuousSourceProfile(
    profileDocument('node:fs', 'readFile'),
    root,
    { ...target(), route: '/different' }
  );
  assert.equal(mismatch.incomplete_reason, 'target_mismatch');
});

test('bounds eligible repository candidates with deterministic ordering', async (context) => {
  const root = await fixtureRoot(context);
  const document = profileDocument('node:fs', 'startup');
  const sourceNodes = [];
  for (let index = 1; index <= 9; index += 1) {
    const file = join(root, 'src', `hot-${index}.mjs`);
    await writeFile(file, `export function hot${index}() {}\n`, 'utf8');
    sourceNodes.push(frame(index, pathToFileURL(file).href, `hot${index}`));
  }
  document.profile.nodes = [...sourceNodes, frame(10, 'node:fs', 'startup')];
  document.profile.samples = [
    ...Array.from({ length: 10 }, () => 10),
    ...sourceNodes.flatMap((node) => Array.from({ length: 5 }, () => node.id)),
    ...Array.from({ length: 2 }, () => 10),
  ];
  document.profile.timeDeltas = document.profile.samples.map(() => 1_000);
  document.response_commit_offset_ms = 45;
  const result = await normalizeContinuousSourceProfile(document, root, target());
  assert.equal(result.state, 'observed');
  assert.equal(result.candidates.length, 8);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.source.file),
    Array.from({ length: 8 }, (_, index) => `src/hot-${index + 1}.mjs`)
  );
});

test('contract rejects raw, causal, and edit-authority fields', async (context) => {
  const root = await fixtureRoot(context);
  const result = await normalizeContinuousSourceProfile(
    profileDocument('node:fs', 'readFile'),
    root,
    target()
  );
  assert.throws(
    () => assertContinuousSourceSummary({ ...result, command: 'curl production' }),
    /invalid/
  );
  assert.throws(
    () =>
      assertContinuousSourceSummary({
        ...result,
        authority: { ...result.authority, edit_eligible: true },
      }),
    /invalid/
  );
});

test('owned preload profiles from startup and selects only the derived request ordinal', async (context) => {
  const root = await fixtureRoot(context);
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
function expensiveWork() {
  let value = 0;
  const end = performance.now() + 100;
  while (performance.now() < end) value = (value + Math.sqrt(value + 1)) % 100000;
  return value;
}
const server = http.createServer((request, response) => {
  if (request.url === '/api/work') expensiveWork();
  response.end('ok');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const headers = { 'x-codevetter-capture': 'continuous-capture' };
const arm = await fetch('http://127.0.0.1:' + port + '/.codevetter/continuous-source-arm', {
  method: 'POST',
  headers: { 'x-codevetter-continuous-source-arm': 'continuous-capture' },
});
if (arm.status !== 204) throw new Error('continuous profiler was not armed');
await fetch('http://127.0.0.1:' + port + '/asset.js', { headers });
await fetch('http://127.0.0.1:' + port + '/api/work', { headers });
await new Promise((resolve) => setTimeout(resolve, 100));
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runContinuousNode(script, root, {
    ordinal: 2,
    method: 'GET',
    route: '/api/work',
  });
  const flow = await collectNodeFlowStreamEvents(root, {
    correlationId: 'continuous-capture',
  });
  const requests = flow.events.filter((event) => event.kind === 'http_server');
  const profiles = await collectServerRequestContinuousSourceProfiles(root, {
    repositoryRoot: root,
    requests,
  });
  const rawFiles = (await readdir(root)).filter((name) => name.startsWith('continuous-source-'));
  assert.equal(rawFiles.length, 1);
  const targetRequest = requests.find((request) => request.route === '/api/work');
  assert.equal(targetRequest.correlation_ordinal, 2);
  const result = profiles.get(targetRequest.event_id);
  assert.equal(result.state, 'observed');
  assert.equal(result.target.ordinal, 2);
  assert.equal(result.startup_attested, true);
  assert.equal(result.overlapping_precommit_dynamic_requests, 0);
  assert.equal(result.candidates[0].source.file, 'server.mjs');
  assert.ok(result.candidates[0].samples >= CONTINUOUS_SOURCE_POLICY.minimum_samples);
});

test('owned preload rejects another dynamic request that overlaps before commitment', async (context) => {
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
const headers = { 'x-codevetter-capture': 'continuous-capture' };
await Promise.all([
  fetch('http://127.0.0.1:' + port + '/api/one', { headers }),
  fetch('http://127.0.0.1:' + port + '/api/two', { headers }),
]);
await new Promise((resolve) => setTimeout(resolve, 100));
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runContinuousNode(script, root, { ordinal: 1, method: 'GET', route: '/api/one' });
  const flow = await collectNodeFlowStreamEvents(root, {
    correlationId: 'continuous-capture',
  });
  const requests = flow.events.filter((event) => event.kind === 'http_server');
  const profiles = await collectServerRequestContinuousSourceProfiles(root, {
    repositoryRoot: root,
    requests,
  });
  const targetRequest = requests.find((request) => request.route === '/api/one');
  const result = profiles.get(targetRequest.event_id);
  assert.equal(result.state, 'contaminated');
  assert.equal(result.incomplete_reason, 'precommit_overlap');
  assert.equal(result.overlapping_precommit_dynamic_requests, 1);
  assert.deepEqual(result.candidates, []);
});

test('post-commit redirect-style overlap does not contaminate the admitted interval', async (context) => {
  const root = await fixtureRoot(context);
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
function work() {
  const end = performance.now() + 35;
  while (performance.now() < end) Math.sqrt(12345);
}
const server = http.createServer((request, response) => {
  if (request.url === '/api/one') {
    work();
    response.writeHead(302, { location: '/api/two' });
    response.flushHeaders();
    setTimeout(() => response.end(), 50);
    return;
  }
  response.end('two');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const headers = { 'x-codevetter-capture': 'continuous-capture' };
await fetch('http://127.0.0.1:' + port + '/api/one', { headers });
await new Promise((resolve) => setTimeout(resolve, 100));
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runContinuousNode(script, root, { ordinal: 1, method: 'GET', route: '/api/one' });
  const flow = await collectNodeFlowStreamEvents(root, {
    correlationId: 'continuous-capture',
  });
  const requests = flow.events.filter((event) => event.kind === 'http_server');
  const profiles = await collectServerRequestContinuousSourceProfiles(root, {
    repositoryRoot: root,
    requests,
  });
  const targetRequest = requests.find((request) => request.route === '/api/one');
  const result = profiles.get(targetRequest.event_id);
  assert.equal(result.complete, true);
  assert.equal(result.overlapping_precommit_dynamic_requests, 0);
  assert.notEqual(result.state, 'contaminated');
});

function profileDocument(url, functionName) {
  return {
    schema_version: 'codevetter-node-continuous-source-profile/v1',
    parent_event_id: 'event-1',
    startup_attested: true,
    target: target(),
    target_match_count: 1,
    response_committed: true,
    response_commit_offset_ms: 20,
    stop_tail_ms: 2,
    sampling_interval_us: 1_000,
    overlapping_dynamic_requests: 0,
    overlapping_precommit_dynamic_requests: 0,
    capture_reason: null,
    profile: {
      nodes: [frame(1, url, functionName), frame(2, 'node:inspector', 'stop')],
      samples: [
        ...Array.from({ length: 10 }, () => 2),
        ...Array.from({ length: 20 }, () => 1),
        ...Array.from({ length: 2 }, () => 2),
      ],
      timeDeltas: Array.from({ length: 32 }, () => 1_000),
    },
  };
}

function frame(id, url, functionName) {
  return { id, callFrame: { url, functionName, lineNumber: 0, columnNumber: 0 } };
}

function target() {
  return { ordinal: 1, method: 'GET', route: '/api/work' };
}

async function fixtureRoot(context) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-continuous-source-'));
  await mkdir(join(root, 'src'), { recursive: true });
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function runContinuousNode(script, directory, target) {
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
        CODEVETTER_CONTINUOUS_SOURCE: '1',
        CODEVETTER_CONTINUOUS_SOURCE_ORDINAL: String(target.ordinal),
        CODEVETTER_CONTINUOUS_SOURCE_METHOD: target.method,
        CODEVETTER_CONTINUOUS_SOURCE_ROUTE: target.route,
        CODEVETTER_FLOW_CORRELATION_ID: 'continuous-capture',
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
      else reject(new Error(`continuous fixture exited ${code}: ${stderr}`));
    });
  });
}
