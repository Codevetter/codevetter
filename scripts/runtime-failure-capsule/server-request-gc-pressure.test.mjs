import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  SERVER_REQUEST_GC_PRESSURE_MARKER_SCHEMA_VERSION,
  collectServerRequestGcPressure,
  normalizeGcPressureEvidence,
} from './server-request-gc-pressure.mjs';
import { V8_HEAP_COLLECTION_SCOPE, V8_HEAP_PROFILE_INTERVAL_BYTES } from './v8-heap-profile.mjs';

const FLOW_PRELOAD = fileURLToPath(new URL('./node-flow-preload.mjs', import.meta.url));

test('normalizes material GC union and one contained sampled allocation source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-gc-root-'));
  await mkdir(join(root, 'src'));
  const profile = profileFixture(join(root, 'src/allocate.ts'));
  const marker = markerFixture(Buffer.byteLength(JSON.stringify(profile)));
  const result = await normalizeGcPressureEvidence({
    marker,
    traceEvents: traceFixture(),
    profile,
    profileBytes: marker.profile_bytes,
    repositoryRoot: root,
  });
  assert.equal(result.state, 'observed');
  assert.equal(result.gc.total_interval_count, 2);
  assert.equal(result.gc.union_activity_ms, 6.9);
  assert.equal(result.gc.longest_interval_ms, 6);
  assert.deepEqual(
    result.gc.kinds.map((item) => [item.kind, item.union_activity_ms]),
    [
      ['minor', 6],
      ['major', 5],
    ]
  );
  assert.equal(result.heap.delta.heap_used_bytes, 1000);
  assert.equal(result.allocations.candidates[0].source.file, 'src/allocate.ts');
  assert.equal(result.route.classification, 'gc_allocation_repository');
  assert.equal(result.route.source_inspection_eligible, true);
  assert.equal(result.route.edit_eligible, false);
});

test('fixed GC floor withholds a sampled source below five milliseconds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-gc-floor-'));
  await mkdir(join(root, 'src'));
  const profile = profileFixture(join(root, 'src/allocate.ts'));
  const marker = markerFixture(Buffer.byteLength(JSON.stringify(profile)));
  const result = await normalizeGcPressureEvidence({
    marker,
    traceEvents: [traceEvent('Scavenge', 100, 4_000)],
    profile,
    profileBytes: marker.profile_bytes,
    repositoryRoot: root,
  });
  assert.equal(result.state, 'insufficient');
  assert.equal(result.route.leading_source, null);
  assert.equal(result.route.source_inspection_eligible, false);
});

test('material GC without a contained source stays unresolved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-gc-unresolved-'));
  const profile = profileFixture('/outside/repository.js');
  const marker = markerFixture(Buffer.byteLength(JSON.stringify(profile)));
  const result = await normalizeGcPressureEvidence({
    marker,
    traceEvents: traceFixture(),
    profile,
    profileBytes: marker.profile_bytes,
    repositoryRoot: root,
  });
  assert.equal(result.state, 'unresolved');
  assert.deepEqual(result.allocations.candidates, []);
  assert.equal(result.route.leading_source, null);
});

test('overlap, incomplete trace, profile mismatch, and malformed markers fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-gc-closed-'));
  await mkdir(join(root, 'src'));
  const profile = profileFixture(join(root, 'src/allocate.ts'));
  const marker = markerFixture(Buffer.byteLength(JSON.stringify(profile)));
  const cases = [
    { marker: { ...marker, overlapping_dynamic_requests: 1 } },
    { marker, traceState: 'truncated' },
    { marker, profileBytes: marker.profile_bytes + 1 },
    { marker: { ...marker, profile_file: '../escape.heapprofile' } },
  ];
  for (const overrides of cases) {
    const result = await normalizeGcPressureEvidence({
      marker,
      traceEvents: traceFixture(),
      profile,
      profileBytes: marker.profile_bytes,
      repositoryRoot: root,
      ...overrides,
    });
    assert.equal(result.state, 'incomplete');
    assert.deepEqual(result.allocations.candidates, []);
    assert.equal(result.route.source_inspection_eligible, false);
  }
});

test('collector admits only exact event markers and bounded profile artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-gc-collector-'));
  const directory = join(root, 'artifacts');
  await mkdir(join(root, 'src'));
  await mkdir(directory);
  const profile = profileFixture(join(root, 'src/allocate.ts'));
  const serialized = JSON.stringify(profile);
  const marker = markerFixture(Buffer.byteLength(serialized));
  await writeFile(join(directory, marker.profile_file), serialized);
  await writeFile(join(directory, 'gc-pressure-123-1.json'), JSON.stringify(marker));
  await writeFile(
    join(directory, 'native-trace.json'),
    JSON.stringify({ traceEvents: traceFixture() })
  );
  const observed = await collectServerRequestGcPressure(directory, {
    repositoryRoot: root,
    eventIds: ['event-123-1'],
  });
  assert.equal(observed.get('event-123-1').state, 'observed');
  const denied = await collectServerRequestGcPressure(directory, {
    repositoryRoot: root,
    eventIds: ['event-123-2'],
  });
  assert.equal(denied.size, 0);
});

test('owned preload captures one exact request-scoped allocation profile with CPU sampling off', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-gc-live-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
function allocateRows() {
  return Array.from({ length: 80000 }, (_, index) => ({ index, label: 'row-' + index }));
}
const server = http.createServer((_request, response) => {
  const rows = allocateRows();
  response.end(String(rows.length));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
await fetch('http://127.0.0.1:' + server.address().port + '/allocate', {
  headers: { 'x-codevetter-capture': 'gc-capture' },
});
await new Promise((resolve) => setTimeout(resolve, 150));
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, root);
  const markerName = (await readdir(root)).find((name) => /^gc-pressure-\d+-1\.json$/.test(name));
  assert.ok(markerName);
  const marker = JSON.parse(await readFile(join(root, markerName), 'utf8'));
  assert.equal(marker.supported, true);
  assert.equal(marker.complete, true);
  const summaries = await collectServerRequestGcPressure(root, {
    repositoryRoot: await realpath(root),
    eventIds: [marker.parent_event_id],
  });
  const summary = summaries.get(marker.parent_event_id);
  assert.equal(summary.complete, true);
  assert.ok(summary.allocations.sampled_bytes > 0);
  assert.ok(
    summary.allocations.candidates.some(
      (candidate) => candidate.source.file === 'server.mjs' && candidate.sampled_bytes > 0
    ),
    JSON.stringify(summary.allocations)
  );
  assert.equal(summary.route.edit_eligible, false);
});

function markerFixture(profileBytes) {
  return {
    schema_version: SERVER_REQUEST_GC_PRESSURE_MARKER_SCHEMA_VERSION,
    parent_event_id: 'event-123-1',
    supported: true,
    start_us: 0,
    stop_us: 10_000,
    response_commit_offset_ms: 10,
    overlapping_dynamic_requests: 0,
    sampling_interval_bytes: V8_HEAP_PROFILE_INTERVAL_BYTES,
    collection_scope: V8_HEAP_COLLECTION_SCOPE,
    heap_before: heapPoint(1000),
    heap_commit: heapPoint(2000),
    profile_file: 'gc-allocation-123-1.heapprofile',
    profile_bytes: profileBytes,
    complete: true,
  };
}

function heapPoint(heapUsed) {
  return {
    rss_bytes: 10_000,
    heap_total_bytes: 5_000,
    heap_used_bytes: heapUsed,
    external_bytes: 200,
    array_buffers_bytes: 100,
  };
}

function profileFixture(file) {
  return {
    head: {
      callFrame: { functionName: '(root)', url: '', lineNumber: 0 },
      selfSize: 0,
      children: [
        {
          callFrame: { functionName: 'allocateRows', url: file, lineNumber: 9 },
          selfSize: 128 * 1024,
          children: [],
        },
      ],
    },
    samples: [{ size: 128 * 1024, nodeId: 2, ordinal: 1 }],
  };
}

function traceFixture() {
  return [traceEvent('Scavenge', 100, 6_000), traceEvent('MarkSweepCompact', 2_000, 5_000)];
}

function traceEvent(name, ts, dur) {
  return { cat: 'v8', name, ph: 'X', pid: 123, tid: 1, ts, dur };
}

function runNode(script, root) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [
        `--trace-event-file-pattern=${join(root, 'native-trace.json')}`,
        '--import',
        pathToFileURL(FLOW_PRELOAD).href,
        script,
      ],
      {
        cwd: root,
        env: {
          CI: '1',
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          ...Object.fromEntries(
            ['PATH', 'TMPDIR', 'TMP', 'TEMP'].flatMap((name) =>
              typeof process.env[name] === 'string' ? [[name, process.env[name]]] : []
            )
          ),
          CODEVETTER_FLOW_DIRECTORY: root,
          CODEVETTER_REPOSITORY_ROOT: root,
          CODEVETTER_FLOW_STREAM: '1',
          CODEVETTER_FLOW_CORRELATION_ID: 'gc-capture',
          CODEVETTER_NATIVE_ACTIVITY: '1',
          CODEVETTER_GC_PRESSURE: '1',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      }
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`fixture failed: ${stderr.slice(0, 500)}`))
    );
  });
}
