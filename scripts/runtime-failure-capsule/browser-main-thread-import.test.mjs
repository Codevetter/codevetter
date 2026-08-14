import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BROWSER_MAIN_THREAD_LIMITS,
  BROWSER_MAIN_THREAD_TRACE_BUFFER_KIB,
  BROWSER_MAIN_THREAD_TRACE_CATEGORIES,
  normalizeBrowserMainThreadTrace,
} from './browser-main-thread-import.mjs';
import { browserMainThreadTraceArguments } from './playwright-capture.mjs';
import { diagnoseToolLedPerformance } from './tool-led-performance-diagnosis.mjs';

const desktopRequire = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));

test('normalizes bounded renderer tasks, independent phases, and repository V8 samples', async (context) => {
  const root = await fixtureRoot(context);
  const normalized = await normalizeBrowserMainThreadTrace(root, JSON.stringify(traceFixture()));

  assert.equal(normalized.renderer_main_thread_count, 1);
  assert.deepEqual(normalized.long_tasks, [
    { started_at_ms: 100, duration_ms: 120, task_type: 'javascript_timer_delayed_low_nesting' },
  ]);
  assert.deepEqual(normalized.phases.javascript, {
    event_count: 2,
    total_duration_ms: 100,
    max_duration_ms: 100,
  });
  assert.equal(normalized.phases.layout.total_duration_ms, 5);
  assert.equal(normalized.phases.paint.total_duration_ms, 2);
  assert.deepEqual(normalized.page_load, {
    largest_contentful_paint_ms: 180,
    candidate_count: 2,
    candidate_size: 40_000,
    provenance: 'chromium_outer_main_frame_lcp_candidate',
  });
  assert.deepEqual(normalized.memory_counters, {
    sample_count: 3,
    renderer_process_count: 1,
    duration_ms: 130,
    first: {
      js_heap_used_bytes: 1_000,
      dom_nodes: 10,
      documents: 1,
      event_listeners: 2,
    },
    last: {
      js_heap_used_bytes: 4_000,
      dom_nodes: 25,
      documents: 2,
      event_listeners: 4,
    },
    peak: {
      js_heap_used_bytes: 5_000,
      dom_nodes: 30,
      documents: 2,
      event_listeners: 5,
    },
    delta: {
      js_heap_used_bytes: 3_000,
      dom_nodes: 15,
      documents: 1,
      event_listeners: 2,
    },
    provenance: 'chromium_update_counters',
  });
  assert.equal(normalized.profile.sample_count, 12);
  assert.equal(normalized.profile.repository_sample_count, 10);
  assert.deepEqual(normalized.profile.source_map, {
    candidate_count: 1,
    attempted_candidates: 0,
    loaded_responses: 0,
    verified_candidates: 0,
  });
  assert.deepEqual(normalized.profile.candidates[0], {
    file: 'src/app.js',
    line: 5,
    function: 'expensiveRender',
    provenance: 'browser_transformed_url',
    sample_count: 10,
    self_time_ms: 10,
    sample_share: 0.8333,
  });
  assert.equal(JSON.stringify(normalized).includes('cdn.example'), false);
  assert.equal(JSON.stringify(normalized).includes('?token='), false);
});

test('main-thread findings separate long-task evidence from attested browser CPU attribution', async (context) => {
  const root = await fixtureRoot(context);
  const mainThread = await normalizeBrowserMainThreadTrace(root, JSON.stringify(traceFixture()));
  const report = diagnoseToolLedPerformance({
    subject: { repository_revision: 'browser-revision' },
    adapter: { kind: 'playwright-trace' },
    scope: { target: 'tests/browser.spec.ts', name: 'renders app' },
    root_flow_id: 'flow-1',
    flows: [
      {
        id: 'flow-1',
        parent_flow_id: null,
        kind: 'workload',
        name: 'renders app',
        timing: { duration_ms: 200, provenance: 'playwright_trace_bounds' },
        evidence_ids: ['trace'],
        limitations: [],
      },
      {
        id: 'flow-2',
        parent_flow_id: 'flow-1',
        kind: 'browser_main_thread_task',
        name: 'Browser main-thread task',
        timing: {
          started_at_ms: 100,
          duration_ms: 120,
          provenance: 'bounded_chromium_trace_event',
        },
        attributes: { task_type: 'javascript_timer_delayed_low_nesting' },
        evidence_ids: ['chromium-main-thread-task-1'],
        limitations: [],
      },
    ],
    browser_main_thread: {
      ...mainThread,
      server_identity: 'verified_by_declared_process',
    },
    function_analysis: { observed_function_count: 0, repeated_work_candidate: null },
  });

  const task = report.findings.find((finding) => finding.kind === 'browser_main_thread_long_task');
  assert.equal(task.observed.max_duration_ms, 120);
  assert.equal(task.eligible_for_experiment, false);
  const cpu = report.findings.find((finding) => finding.kind === 'browser_javascript_cpu_hotspot');
  assert.equal(cpu.source.file, 'src/app.js');
  assert.equal(cpu.observed.cpu_sample_count, 10);
  assert.equal(cpu.eligible_for_experiment, true);
  assert.ok(cpu.unverified.some((entry) => entry.includes('transformed')));

  const unverified = diagnoseToolLedPerformance({
    ...reportFixture(mainThread),
    browser_main_thread: { ...mainThread, server_identity: 'unverified' },
  });
  assert.equal(
    unverified.findings.find((finding) => finding.kind === 'browser_javascript_cpu_hotspot')
      .eligible_for_experiment,
    false
  );
});

test('attributes contained Next webpack-internal frames without treating them as verified maps', async (context) => {
  const root = await fixtureRoot(context);
  const fixture = traceFixture();
  fixture.traceEvents.find(
    (event) => event.name === 'ProfileChunk'
  ).args.data.cpuProfile.nodes[0].callFrame.url =
    'webpack-internal:///(app-pages-browser)/./src/app.js?private';

  const normalized = await normalizeBrowserMainThreadTrace(root, JSON.stringify(fixture));
  assert.equal(normalized.profile.repository_sample_count, 10);
  assert.deepEqual(normalized.profile.candidates[0], {
    file: 'src/app.js',
    line: 5,
    function: 'expensiveRender',
    provenance: 'browser_webpack_internal_url',
    sample_count: 10,
    self_time_ms: 10,
    sample_share: 0.8333,
  });
});

test('main-thread parser rejects malformed and oversized evidence', async (context) => {
  const root = await fixtureRoot(context);
  await assert.rejects(normalizeBrowserMainThreadTrace(root, '{not-json'), /not valid JSON/);
  await assert.rejects(
    normalizeBrowserMainThreadTrace(root, ' '.repeat(BROWSER_MAIN_THREAD_LIMITS.traceBytes + 1)),
    /exceeds the raw evidence bound/
  );
  await assert.rejects(
    normalizeBrowserMainThreadTrace(
      root,
      JSON.stringify({ traceEvents: Array(BROWSER_MAIN_THREAD_LIMITS.traceEvents + 1) })
    ),
    /event inventory/
  );
  await assert.rejects(
    normalizeBrowserMainThreadTrace(
      root,
      JSON.stringify({
        traceEvents: [
          { ph: 'M', name: 'process_name', pid: 1, tid: 1, args: { name: 'Renderer' } },
          { ph: 'M', name: 'thread_name', pid: 1, tid: 1, args: { name: 'CrRendererMain' } },
          {
            ph: 'P',
            name: 'ProfileChunk',
            pid: 1,
            tid: 2,
            args: {
              data: {
                cpuProfile: { nodes: Array(BROWSER_MAIN_THREAD_LIMITS.profileNodes + 1) },
              },
            },
          },
        ],
      })
    ),
    /profile node inventory/
  );
  await assert.rejects(
    normalizeBrowserMainThreadTrace(
      root,
      JSON.stringify({
        traceEvents: [
          { ph: 'M', name: 'process_name', pid: 1, tid: 1, args: { name: 'Renderer' } },
          { ph: 'M', name: 'thread_name', pid: 1, tid: 1, args: { name: 'CrRendererMain' } },
          {
            ph: 'P',
            name: 'ProfileChunk',
            pid: 1,
            tid: 2,
            args: {
              data: {
                cpuProfile: { samples: Array(BROWSER_MAIN_THREAD_LIMITS.profileSamples + 1) },
              },
            },
          },
        ],
      })
    ),
    /sample inventory/
  );
});

test('renderer memory counters never fabricate growth across processes', async (context) => {
  const root = await fixtureRoot(context);
  const metadata = (pid) => [
    { ph: 'M', name: 'process_name', pid, tid: 1, args: { name: 'Renderer' } },
    { ph: 'M', name: 'thread_name', pid, tid: 1, args: { name: 'CrRendererMain' } },
  ];
  const counter = (pid, ts, heap) => ({
    ph: 'I',
    name: 'UpdateCounters',
    pid,
    tid: 1,
    ts,
    args: {
      data: { jsHeapSizeUsed: heap, nodes: heap / 10, documents: 1, jsEventListeners: 2 },
    },
  });
  const normalized = await normalizeBrowserMainThreadTrace(
    root,
    JSON.stringify({
      traceEvents: [
        ...metadata(1),
        ...metadata(2),
        counter(1, 100_000, 100),
        counter(1, 200_000, 200),
        counter(2, 300_000, 9_000),
        { ...counter(1, 400_000, 300), args: { data: { jsHeapSizeUsed: 300 } } },
      ],
    })
  );

  assert.equal(normalized.memory_counters.renderer_process_count, 2);
  assert.equal(normalized.memory_counters.sample_count, 2);
  assert.equal(normalized.memory_counters.delta.js_heap_used_bytes, 100);
  assert.equal(normalized.memory_counters.peak.js_heap_used_bytes, 200);
  assert.match(normalized.limitations.join(' '), /without cross-process aggregation/);
});

test('owned Chromium arguments use the fixed closed trace contract', () => {
  assert.deepEqual(
    browserMainThreadTraceArguments({ path: '/owned/trace.json', durationSeconds: 7 }),
    [
      `--trace-startup=${BROWSER_MAIN_THREAD_TRACE_CATEGORIES.join(',')}`,
      '--trace-startup-format=json',
      '--trace-startup-file=/owned/trace.json',
      '--trace-startup-duration=7',
      '--trace-startup-record-mode=record-until-full',
      `--default-trace-buffer-size-limit-in-kb=${BROWSER_MAIN_THREAD_TRACE_BUFFER_KIB}`,
    ]
  );
  assert.throws(
    () => browserMainThreadTraceArguments({ path: '/owned/trace.json', durationSeconds: 121 }),
    /launch boundary/
  );
});

test('real installed Chromium emits a repository-attributed long task and V8 samples', {
  timeout: 15_000,
  skip: !installedChromiumAvailable(),
}, async (context) => {
  const root = await fixtureRoot(context, browserScript());
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-main-thread-proof-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const tracePath = join(directory, 'trace.json');
  const server = createServer(async (request, response) => {
    if (request.url === '/src/app.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(await readFile(join(root, 'src/app.js'), 'utf8'));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><script src="/src/app.js"></script>');
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  context.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));

  const { chromium } = desktopRequire('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: browserMainThreadTraceArguments({ path: tracePath, durationSeconds: 5 }),
  });
  context.after(() => browser.close().catch(() => {}));
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.body.dataset.done === 'yes');
  await page.waitForTimeout(100);
  await browser.close();

  const normalized = await normalizeBrowserMainThreadTrace(root, await readFile(tracePath, 'utf8'));
  assert.ok(normalized.long_tasks.some((entry) => entry.duration_ms >= 100));
  assert.ok(normalized.phases.layout.event_count > 0, JSON.stringify(normalized.phases));
  assert.ok(normalized.phases.paint.event_count > 0, JSON.stringify(normalized.phases));
  assert.ok(normalized.memory_counters?.sample_count > 0, JSON.stringify(normalized));
  const candidate = normalized.profile.candidates.find(
    (entry) => entry.file === 'src/app.js' && entry.function === 'expensiveRender'
  );
  assert.ok(candidate, JSON.stringify(normalized.profile));
  assert.ok(candidate.sample_count >= 5);
});

function traceFixture() {
  return {
    traceEvents: [
      { ph: 'M', name: 'process_name', pid: 1, tid: 1, args: { name: 'Renderer' } },
      { ph: 'M', name: 'thread_name', pid: 1, tid: 1, args: { name: 'CrRendererMain' } },
      { ph: 'M', name: 'thread_name', pid: 1, tid: 3, args: { name: 'v8:ProfEvntProc' } },
      { ph: 'M', name: 'process_name', pid: 2, tid: 2, args: { name: 'Browser' } },
      { ph: 'M', name: 'thread_name', pid: 2, tid: 2, args: { name: 'CrBrowserMain' } },
      {
        ph: 'X',
        name: 'ThreadControllerImpl::RunTask',
        pid: 1,
        tid: 1,
        ts: 100_000,
        dur: 120_000,
        args: {
          renderer_main_thread_task_execution: {
            task_type: 'TASK_TYPE_JAVASCRIPT_TIMER_DELAYED_LOW_NESTING',
          },
        },
      },
      { ph: 'X', name: 'FunctionCall', pid: 1, tid: 1, ts: 105_000, dur: 100_000 },
      { ph: 'X', name: 'FunctionCall', pid: 1, tid: 1, ts: 110_000, dur: 40_000 },
      { ph: 'X', name: 'Layout', pid: 1, tid: 1, ts: 205_000, dur: 5_000 },
      { ph: 'X', name: 'Paint', pid: 1, tid: 1, ts: 210_000, dur: 2_000 },
      {
        ph: 'R',
        name: 'navigationStart',
        pid: 1,
        tid: 1,
        ts: 40_000,
        args: { data: { navigationId: 'navigation-1' } },
      },
      {
        ph: 'R',
        name: 'largestContentfulPaint::Candidate',
        pid: 1,
        tid: 1,
        ts: 180_000,
        args: {
          data: {
            navigationId: 'navigation-1',
            candidateIndex: 1,
            isOutermostMainFrame: true,
            size: 20_000,
          },
        },
      },
      {
        ph: 'R',
        name: 'largestContentfulPaint::Candidate',
        pid: 1,
        tid: 1,
        ts: 220_000,
        args: {
          data: {
            navigationId: 'navigation-1',
            candidateIndex: 2,
            isOutermostMainFrame: true,
            size: 40_000,
          },
        },
      },
      {
        ph: 'I',
        name: 'UpdateCounters',
        pid: 1,
        tid: 1,
        ts: 100_000,
        args: {
          data: { jsHeapSizeUsed: 1_000, nodes: 10, documents: 1, jsEventListeners: 2 },
        },
      },
      {
        ph: 'I',
        name: 'UpdateCounters',
        pid: 1,
        tid: 1,
        ts: 220_000,
        args: {
          data: { jsHeapSizeUsed: 5_000, nodes: 30, documents: 2, jsEventListeners: 5 },
        },
      },
      {
        ph: 'I',
        name: 'UpdateCounters',
        pid: 1,
        tid: 1,
        ts: 230_000,
        args: {
          data: { jsHeapSizeUsed: 4_000, nodes: 25, documents: 2, jsEventListeners: 4 },
        },
      },
      {
        ph: 'P',
        name: 'ProfileChunk',
        pid: 1,
        tid: 3,
        args: {
          data: {
            cpuProfile: {
              nodes: [
                {
                  id: 10,
                  callFrame: {
                    codeType: 'JS',
                    functionName: 'expensiveRender',
                    url: 'http://127.0.0.1:4173/src/app.js?token=private',
                    lineNumber: 4,
                    columnNumber: 2,
                  },
                },
                {
                  id: 11,
                  callFrame: {
                    codeType: 'JS',
                    functionName: 'externalWork',
                    url: 'https://cdn.example/private.js',
                    lineNumber: 1,
                    columnNumber: 1,
                  },
                },
              ],
              samples: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 11, 11],
            },
            timeDeltas: Array(12).fill(1_000),
          },
        },
      },
      {
        ph: 'P',
        name: 'ProfileChunk',
        pid: 2,
        tid: 2,
        args: {
          data: {
            cpuProfile: {
              nodes: [
                {
                  id: 20,
                  callFrame: {
                    codeType: 'JS',
                    functionName: 'wrongProcess',
                    url: 'http://127.0.0.1:4173/src/app.js',
                    lineNumber: 0,
                    columnNumber: 0,
                  },
                },
              ],
              samples: [20, 20],
            },
            timeDeltas: [1_000, 1_000],
          },
        },
      },
    ],
  };
}

function reportFixture(mainThread) {
  return {
    subject: { repository_revision: 'browser-revision' },
    adapter: { kind: 'playwright-trace' },
    scope: { target: 'tests/browser.spec.ts', name: 'renders app' },
    root_flow_id: 'flow-1',
    flows: [
      {
        id: 'flow-1',
        parent_flow_id: null,
        kind: 'workload',
        name: 'renders app',
        timing: { duration_ms: 200, provenance: 'playwright_trace_bounds' },
        evidence_ids: ['trace'],
        limitations: [],
      },
    ],
    browser_main_thread: mainThread,
    function_analysis: { observed_function_count: 0, repeated_work_candidate: null },
  };
}

async function fixtureRoot(context, source = 'export function expensiveRender() {}\n') {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-main-thread-fixture-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/app.js'), source);
  return root;
}

function browserScript() {
  return [
    'function expensiveRender() {',
    '  const end = performance.now() + 140;',
    '  while (performance.now() < end) {}',
    "  document.body.dataset.done = 'yes';",
    '}',
    'setTimeout(expensiveRender, 50);',
    '',
  ].join('\n');
}

function installedChromiumAvailable() {
  try {
    return existsSync(desktopRequire('playwright').chromium.executablePath());
  } catch {
    return false;
  }
}
