import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  collectServerRequestNativeActivity,
  normalizeNativeActivity,
  scanCompleteTraceEvents,
  scanTraceEventFile,
  validServerRequestNativeActivitySummary,
} from './server-request-native-activity.mjs';

const FLOW_PRELOAD = fileURLToPath(new URL('./node-flow-preload.mjs', import.meta.url));

test('normalizes closed libuv and V8 intervals without private trace identity', () => {
  const marker = rawMarker();
  const summary = normalizeNativeActivity(
    marker,
    [
      event('node.threadpoolwork.sync', 'PBKDF2REQUEST', 'B', 101_000, { pid: 7, tid: 9 }),
      event('node.threadpoolwork.sync', 'PBKDF2REQUEST', 'E', 111_000, { pid: 7, tid: 9 }),
      event('node.threadpoolwork.sync', 'ZLIB', 'X', 105_000, {
        pid: 7,
        tid: 10,
        dur: 4_000,
      }),
      event('v8', 'MajorGC', 'X', 115_000, { pid: 7, tid: 1, dur: 3_000 }),
      event('v8', 'private-arbitrary-event-name', 'X', 119_000, {
        pid: 7,
        tid: 1,
        dur: 2_000,
        args: { secret: 'discard-me' },
      }),
    ],
    'live_partial'
  );

  assert.equal(summary.state, 'observed');
  assert.deepEqual(summary.threadpool, {
    total_count: 2,
    union_activity_ms: 10,
    mechanisms: [
      { kind: 'crypto', count: 1, union_activity_ms: 10 },
      { kind: 'zlib', count: 1, union_activity_ms: 4 },
    ],
  });
  assert.deepEqual(summary.v8, {
    total_count: 1,
    union_activity_ms: 3,
    mechanisms: [{ kind: 'gc', count: 1, union_activity_ms: 3 }],
  });
  assert.equal(validServerRequestNativeActivitySummary(summary), true);
  const serialized = JSON.stringify(summary);
  for (const privateValue of [
    'PBKDF2REQUEST',
    'MajorGC',
    'private-arbitrary-event-name',
    'discard-me',
    'pid',
    'tid',
    'start_us',
    'stop_us',
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test('accepts complete objects from a live partial trace container', () => {
  const trace = `{"traceEvents":[${JSON.stringify(
    event('v8', 'MinorGC', 'X', 101_000, { pid: 1, tid: 1, dur: 2_000 })
  )},`;
  const parsed = scanCompleteTraceEvents(trace);
  assert.equal(parsed.state, 'live_partial');
  assert.equal(parsed.events.length, 1);
  assert.equal(normalizeNativeActivity(rawMarker(), parsed.events, parsed.state).state, 'observed');
});

test('stream-scans a larger trace while retaining only admitted request intervals', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-native-stream-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'native-trace.json');
  const irrelevant = Array.from({ length: 2_000 }, (_, index) =>
    JSON.stringify({ cat: 'metadata', name: `ignored-${index}`, ph: 'X', ts: index, dur: 1 })
  );
  const relevant = JSON.stringify(
    event('v8', 'MinorGC', 'X', 101_000, { pid: 1, tid: 1, dur: 2_000 })
  );
  const document = `{"traceEvents":[${[...irrelevant, relevant].join(',')}]}`;
  await writeFile(path, document);

  const parsed = await scanTraceEventFile(path, [rawMarker()], {
    maximumBytes: Buffer.byteLength(document),
    chunkBytes: 97,
  });
  assert.equal(parsed.state, 'complete');
  assert.deepEqual(parsed.events, [JSON.parse(relevant)]);
  assert.deepEqual(
    await scanTraceEventFile(path, [rawMarker()], {
      maximumBytes: Buffer.byteLength(document) - 1,
      chunkBytes: 97,
    }),
    { state: 'oversized', events: [] }
  );
});

test('fails closed for unpaired, malformed, truncated-string, and contaminated evidence', () => {
  const unpaired = normalizeNativeActivity(
    rawMarker(),
    [event('node.threadpoolwork.sync', 'PBKDF2REQUEST', 'B', 101_000, { pid: 1, tid: 2 })],
    'live_partial'
  );
  assert.equal(unpaired.state, 'incomplete');
  assert.equal(scanCompleteTraceEvents('{"traceEvents":[oops').state, 'invalid');
  assert.equal(scanCompleteTraceEvents('{"prefix":"ignored","traceEvents":[]}').state, 'invalid');
  assert.equal(scanCompleteTraceEvents('{"traceEvents":[{"name":"unfinished').state, 'truncated');
  assert.equal(
    normalizeNativeActivity(
      rawMarker(),
      [event('v8', 'MajorGC', 'X', 101_000, { pid: 1, tid: 1 })],
      'complete'
    ).state,
    'incomplete'
  );
  assert.equal(
    normalizeNativeActivity({ ...rawMarker(), overlapping_dynamic_requests: 1 }, [], 'complete')
      .state,
    'contaminated'
  );
  assert.equal(
    normalizeNativeActivity(rawMarker(), [], 'oversized').incomplete_reason,
    'trace_oversized'
  );
  const valid = normalizeNativeActivity(
    rawMarker(),
    [event('v8', 'MajorGC', 'X', 101_000, { pid: 1, tid: 1, dur: 2_000 })],
    'complete'
  );
  valid.v8.mechanisms[0].union_activity_ms = 3;
  assert.equal(validServerRequestNativeActivitySummary(valid), false);
});

test('owned preload captures actual crypto worker activity for the exact request', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-native-activity-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import { pbkdf2 } from 'node:crypto';
import http from 'node:http';
const server = http.createServer((_request, response) => {
  pbkdf2('password', 'salt', 120000, 32, 'sha256', () => response.end('ok'));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
await fetch('http://127.0.0.1:' + server.address().port + '/crypto', {
  headers: { 'x-codevetter-capture': 'native-capture' },
});
await new Promise((resolve) => setTimeout(resolve, 100));
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, root);
  const markerName = (await readdir(root)).find((name) =>
    /^native-activity-\d+-1\.json$/.test(name)
  );
  const marker = JSON.parse(await readFile(join(root, markerName), 'utf8'));
  const eventId = marker.parent_event_id;
  const summaries = await collectServerRequestNativeActivity(root, { eventIds: [eventId] });
  const summary = summaries.get(eventId);
  assert.equal(summary.state, 'observed');
  assert.equal(summary.complete, true);
  assert.ok(summary.threadpool.union_activity_ms >= 5);
  assert.ok(summary.threadpool.mechanisms.some((item) => item.kind === 'crypto'));
});

test('owned preload marks an actual overlapping dynamic request as contaminated', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-native-overlap-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
const server = http.createServer(async (_request, response) => {
  await delay(25);
  response.end('ok');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
await Promise.all(['/one', '/two'].map((route) => fetch(base + route, {
  headers: { 'x-codevetter-capture': 'native-capture' },
})));
await new Promise((resolve) => setTimeout(resolve, 50));
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, root);
  const markerName = (await readdir(root)).find((name) =>
    /^native-activity-\d+-1\.json$/.test(name)
  );
  const marker = JSON.parse(await readFile(join(root, markerName), 'utf8'));
  const summaries = await collectServerRequestNativeActivity(root, {
    eventIds: [marker.parent_event_id],
  });
  assert.equal(marker.overlapping_dynamic_requests, 1);
  assert.equal(summaries.get(marker.parent_event_id).state, 'contaminated');
});

function rawMarker() {
  return {
    schema_version: 'codevetter-node-request-native-activity/v1',
    parent_event_id: 'event-1',
    supported: true,
    start_us: 100_000,
    stop_us: 130_000,
    response_commit_offset_ms: 30,
    overlapping_dynamic_requests: 0,
    complete: true,
  };
}

function event(cat, name, ph, ts, extra) {
  return { cat, name, ph, ts, ...extra };
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
          CODEVETTER_FLOW_CORRELATION_ID: 'native-capture',
          CODEVETTER_NATIVE_ACTIVITY: '1',
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
