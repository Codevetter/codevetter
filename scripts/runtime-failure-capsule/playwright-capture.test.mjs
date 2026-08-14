import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  captureQualifiedPlaywrightFlow,
  compactPlaywrightFailure,
  effectiveRuntimeBaseUrl,
  loadPlaywrightCaptureResult,
  ownedConfigSource,
  playwrightTestTimeout,
  prepareAndLoadServerFlow,
  qualifiedBrowserBaseUrl,
} from './playwright-capture.mjs';
import {
  PLAYWRIGHT_CAPTURE_SCHEMA_VERSION,
  assertLoopbackBaseUrl,
  assertPlaywrightCaptureReceipt,
  compactPlaywrightDiagnosis,
  validatePlaywrightCaptureReceipt,
} from './playwright-capture-contracts.mjs';
import { createBrowserServerFlowSummary } from './browser-server-flow.mjs';
import {
  collectSamePagePlaywrightMemory,
  collectRepeatedPlaywrightMemory,
  normalizeRepeatedPlaywrightMemory,
  normalizeSamePagePlaywrightMemory,
  supportsRepeatedPlaywrightMemory,
} from './playwright-memory.mjs';
import { LOCAL_SERVER_ATTESTATION_SCHEMA_VERSION } from './local-server-attestation-contracts.mjs';
import { extractPlaywrightTraceZip } from './playwright-trace-zip.mjs';

test('loopback and browser qualification contracts fail closed', () => {
  assert.equal(assertLoopbackBaseUrl('http://127.0.0.1:4173/'), 'http://127.0.0.1:4173');
  for (const value of [
    'https://127.0.0.1:4173',
    'http://example.com',
    'http://127.0.0.1:70000',
    'http://user@127.0.0.1:4173',
  ]) {
    assert.throws(() => assertLoopbackBaseUrl(value), /static loopback/);
  }
  const candidate = browserCandidate();
  assert.equal(qualifiedBrowserBaseUrl(candidate), 'http://127.0.0.1:4173');
  candidate.safety_flags.push({ kind: 'remote_network_signal', evidence: candidate.target });
  assert.equal(qualifiedBrowserBaseUrl(candidate), null);
});

test('owned capture may change only the declared loopback port', () => {
  assert.equal(
    effectiveRuntimeBaseUrl({
      declaredBaseUrl: 'http://127.0.0.1:3000',
      runtimeBaseUrl: 'http://127.0.0.1:43117',
      runtimeConfiguration: 'codevetter_config_disabled',
    }),
    'http://127.0.0.1:43117'
  );
  assert.throws(
    () =>
      effectiveRuntimeBaseUrl({
        declaredBaseUrl: 'http://127.0.0.1:3000',
        runtimeBaseUrl: 'http://localhost:43117',
        runtimeConfiguration: 'codevetter_config_disabled',
      }),
    /only the loopback port/
  );
  assert.throws(
    () =>
      effectiveRuntimeBaseUrl({
        declaredBaseUrl: 'http://127.0.0.1:3000',
        runtimeBaseUrl: 'http://127.0.0.1:43117',
        runtimeConfiguration: 'repository_declared',
      }),
    /CodeVetter-owned/
  );
});

test('owned primary config scopes requests while diagnostic configs omit the header', () => {
  const input = {
    root: '/tmp/project',
    outputDirectory: '/tmp/output',
    baseUrl: 'http://127.0.0.1:4173',
    proxyUrl: 'http://127.0.0.1:9000',
    testTimeoutMs: 1_000,
    browserProfile: {
      use: {
        viewport: { width: 1_280, height: 720 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
      },
    },
  };
  const primary = ownedConfigSource({ ...input, captureHeader: 'exact-capture' });
  const diagnostic = ownedConfigSource(input);

  assert.match(primary, /x-codevetter-capture/);
  assert.match(primary, /exact-capture/);
  assert.equal(diagnostic.includes('x-codevetter-capture'), false);
});

test('local Vite and Next flows may run while remote traffic remains denied', () => {
  const base = {
    adapter: 'playwright',
    safety_flags: [],
    signals: [
      { kind: 'loopback_browser_base_url', evidence: 'http://127.0.0.1:4173' },
      { kind: 'declared_browser_server_family', evidence: 'vite' },
    ],
  };
  assert.equal(qualifiedBrowserBaseUrl(base), 'http://127.0.0.1:4173');
  assert.equal(
    qualifiedBrowserBaseUrl({
      ...base,
      signals: [...base.signals, { kind: 'browser_request_fixture', evidence: 'flow.spec.ts' }],
    }),
    'http://127.0.0.1:4173'
  );
  assert.equal(
    qualifiedBrowserBaseUrl({
      ...base,
      signals: base.signals.map((signal) =>
        signal.kind === 'declared_browser_server_family' ? { ...signal, evidence: 'next' } : signal
      ),
    }),
    'http://127.0.0.1:4173'
  );
});

test('compact browser diagnosis explains main-thread work without a source candidate', () => {
  const mainThread = {
    phases: {
      javascript: { total_duration_ms: 63.934 },
      style: { total_duration_ms: 6.661 },
      layout: { total_duration_ms: 8.028 },
      paint: { total_duration_ms: 1.327 },
    },
    long_tasks: [{ duration_ms: 51.111 }, { duration_ms: 52.222 }],
    profile: {
      repository_sample_count: 7,
      candidates: [{ self_time_ms: 0.788 }, { self_time_ms: 0.672 }],
    },
  };
  const diagnosis = compactPlaywrightDiagnosis({
    main_thread: mainThread,
    tool_diagnosis: { findings: [], verdict: { status: 'no_findings' } },
  });

  assert.deepEqual(diagnosis.main_thread, {
    phases_ms: { javascript: 63.934, style: 6.661, layout: 8.028, paint: 1.327 },
    long_tasks: { count: 2, total_duration_ms: 103.333 },
    repository_cpu: { state: 'observed', sample_count: 7, self_time_ms: 1.46 },
  });
  assert.deepEqual(
    compactPlaywrightDiagnosis({
      main_thread: {
        ...mainThread,
        profile: { repository_sample_count: 0, candidates: [] },
      },
      tool_diagnosis: { findings: [], verdict: { status: 'no_findings' } },
    }).main_thread.repository_cpu,
    { state: 'observed_zero', sample_count: 0, self_time_ms: 0 }
  );
  assert.equal(
    compactPlaywrightDiagnosis({
      tool_diagnosis: { findings: [], verdict: { status: 'no_findings' } },
    }).main_thread,
    null
  );
});

test('compact browser diagnosis remains compatible with server-flow v15 evidence', () => {
  const server = createBrowserServerFlowSummary({
    nodeFlow: {
      state: 'observed',
      complete: true,
      events: [
        {
          event_id: 'request-1',
          parent_event_id: null,
          kind: 'http_server',
          method: 'GET',
          route: '/',
          status: 200,
          outcome: 'ok',
          started_at_ms: 1,
          duration_ms: 20,
          correlation_ordinal: 1,
        },
      ],
    },
  });
  server.schema_version = 'runtime-browser-server-flow/v15';
  delete server.requests[0].continuous_source;

  const diagnosis = compactPlaywrightDiagnosis({
    server,
    tool_diagnosis: { findings: [], verdict: { status: 'no_findings' } },
  });

  assert.equal(diagnosis.server.requests.length, 1);
  assert.equal(Object.hasOwn(diagnosis.server.requests[0], 'continuous_source'), false);
});

test('fresh-context Playwright memory samples remain bounded and explicitly non-leak evidence', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-memory-samples-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const candidate = browserCandidate();
  assert.equal(supportsRepeatedPlaywrightMemory(candidate), false);
  candidate.signals.push({ kind: 'browser_request_fixture', evidence: candidate.target });
  assert.equal(supportsRepeatedPlaywrightMemory(candidate), true);
  for (let index = 0; index < 3; index += 1) {
    await writeFile(
      join(directory, `repeat-${index}.json`),
      JSON.stringify(memorySample(index, 10_000 + index * 1_000))
    );
  }

  const evidence = await collectRepeatedPlaywrightMemory(directory);
  assert.equal(evidence.state, 'succeeded');
  assert.equal(evidence.summary.after_heap_used_bytes.median, 13_000);
  assert.equal(evidence.summary.delta_heap_used_bytes.median, 2_000);
  assert.equal(evidence.leak_assessment, 'not_evaluated_fresh_contexts');
  assert.deepEqual(normalizeRepeatedPlaywrightMemory(evidence), evidence);
});

test('same-page Playwright memory retains an ordered forced-GC sequence without leak attribution', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-same-page-memory-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, 'sequence.json'),
    JSON.stringify({
      schema_version: 'runtime-playwright-same-page-memory-sequence/v1',
      retry: 0,
      samples: [
        memorySample(0, 10_000, 100_000),
        memorySample(1, 11_000, 200_000),
        memorySample(2, 12_000, 300_000),
      ],
      limitation: null,
      retained_profile_limitation: null,
    })
  );

  const evidence = await collectSamePagePlaywrightMemory(directory);
  assert.equal(evidence.state, 'succeeded');
  assert.equal(evidence.context_scope, 'same_page_and_context_exact_flow_repeats');
  assert.equal(evidence.interaction_scope, 'full_project_test_callback');
  assert.equal(evidence.trend.after_heap_used_bytes.first, 12_000);
  assert.equal(evidence.trend.after_heap_used_bytes.last, 14_000);
  assert.equal(evidence.trend.after_heap_used_bytes.delta, 2_000);
  assert.equal(evidence.retained_attribution.state, 'succeeded');
  assert.equal(evidence.retained_attribution.candidate.source.file, 'src/App.tsx');
  assert.deepEqual(
    evidence.retained_attribution.candidate.per_cycle_sampled_live_bytes,
    [100_000, 200_000, 300_000]
  );
  assert.equal(evidence.retained_attribution.candidate.delta_sampled_live_bytes, 200_000);
  assert.equal(evidence.leak_assessment, 'not_evaluated_full_callback_replay');
  assert.deepEqual(normalizeSamePagePlaywrightMemory(evidence), evidence);
});

test('same-page sampled-live attribution rejects a source present in only one profile', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-same-page-single-profile-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, 'sequence.json'),
    JSON.stringify({
      schema_version: 'runtime-playwright-same-page-memory-sequence/v1',
      retry: 0,
      samples: [
        memorySample(0, 10_000, 0),
        memorySample(1, 11_000, 0),
        memorySample(2, 12_000, 66_012),
      ],
      limitation: null,
      retained_profile_limitation: null,
    })
  );

  const evidence = await collectSamePagePlaywrightMemory(directory);
  assert.equal(evidence.retained_attribution.state, 'succeeded');
  assert.equal(evidence.retained_attribution.candidate, null);
});

test('extracts only bounded stored Playwright trace streams from ZIP', () => {
  const trace = [
    { type: 'before', callId: 'call-1', apiName: 'page.goto', startTime: 1, params: { url: '/' } },
    { type: 'after', callId: 'call-1', endTime: 2 },
  ]
    .map(JSON.stringify)
    .join('\n');
  assert.equal(extractPlaywrightTraceZip(storedZip('0-trace.trace', trace)), trace);
  assert.throws(
    () => extractPlaywrightTraceZip(storedZip('../escape.trace', trace)),
    /entry name is unsafe/
  );
  assert.throws(
    () => extractPlaywrightTraceZip(storedZip('asset.txt', 'not a trace')),
    /no trace streams/
  );

  const ordinaryBrowserTrace = `${' '.repeat(2 * 1024 * 1024)}${trace}`;
  assert.equal(
    extractPlaywrightTraceZip(storedZip('0-trace.network', ordinaryBrowserTrace)).length,
    ordinaryBrowserTrace.trim().length
  );
});

test('normalizes current Playwright action and HAR timing fields', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'src/main.tsx': 'export const Main = () => null;\n',
  });
  const { diagnosePlaywrightTraceSource } = await import('./playwright-trace-import.mjs');
  const result = await diagnosePlaywrightTraceSource(
    root,
    [
      {
        type: 'action',
        callId: 'call-1',
        title: 'page.goto',
        class: 'Frame',
        method: 'goto',
        startTime: 10,
        endTime: 14,
        params: { url: '/' },
      },
      {
        type: 'resource-snapshot',
        snapshot: {
          _monotonicTime: 10.5,
          time: 2.25,
          request: { method: 'GET', url: 'http://127.0.0.1:4173/src/main.tsx' },
          _resourceType: 'script',
          response: {
            status: 200,
            _transferSize: 120_000,
            bodySize: 110_000,
            content: { size: 130_000, mimeType: 'application/javascript' },
          },
          timings: { wait: 1, receive: 1.25 },
        },
      },
      {
        type: 'before',
        callId: 'call-2',
        apiName: 'locator.click',
        startTime: 15,
        params: { selector: 'text=private account' },
      },
      { type: 'after', callId: 'call-2', endTime: 18 },
    ]
      .map(JSON.stringify)
      .join('\n'),
    {
      target: 'tests/browser.spec.ts',
      name: 'browser flow',
      serverFlow: {
        state: 'observed',
        complete: true,
        events: [
          {
            event_id: 'server-1',
            parent_event_id: null,
            kind: 'http_server',
            method: 'GET',
            route: '/src/main.tsx',
            status: 200,
            outcome: 'ok',
            started_at_ms: 1_000,
            duration_ms: 8,
            correlation_ordinal: 1,
            source: {
              file: 'src/main.tsx',
              line: 1,
              function: null,
              provenance: 'static_unique_next_route',
            },
          },
          {
            event_id: 'database-1',
            parent_event_id: 'server-1',
            kind: 'database',
            database: 'node_sqlite',
            operation: 'get',
            statement: 'SELECT value FROM items WHERE id = ?',
            outcome: 'ok',
            started_at_ms: 1_002,
            duration_ms: 2,
            source: {
              file: 'src/main.tsx',
              line: 1,
              function: 'Main',
              provenance: 'node_diagnostic_callsite',
            },
          },
        ],
      },
    }
  );

  assert.equal(result.flows.find((flow) => flow.kind === 'navigation').timing.duration_ms, 4);
  assert.deepEqual(result.flows.find((flow) => flow.kind === 'navigation').timing.accounting, {
    accounted_child_ms: 2.25,
    unaccounted_ms: 1.75,
  });
  assert.equal(result.flows.find((flow) => flow.kind === 'http_client').timing.duration_ms, 2.25);
  assert.equal(result.loading.inventory.complete, true);
  assert.equal(result.loading.complete_transfer_bytes, 120_000);
  assert.equal(result.loading.largest_resources[0].source.file, 'src/main.tsx');
  assert.equal(compactPlaywrightDiagnosis(result).loading.complete_transfer_bytes, 120_000);
  assert.deepEqual(
    result.actions.sequence.map((action) => [action.name, action.duration_ms]),
    [
      ['page.goto', 4],
      ['locator.click', 3],
    ]
  );
  assert.equal(result.actions.sequence[0].resources_started, 1);
  assert.equal(result.actions.sequence[0].completed_response_transfer_bytes, 120_000);
  assert.equal(JSON.stringify(result.actions).includes('private account'), false);
  assert.equal(compactPlaywrightDiagnosis(result).actions.sequence.length, 2);
  assert.equal(result.server.inventory.joined_unique_requests, 1);
  assert.equal(result.server.requests[0].browser_join.action_ordinal, 1);
  assert.equal(result.server.requests[0].children[0].kind, 'database');
  assert.equal(result.server.requests[0].source.file, 'src/main.tsx');
  assert.equal(compactPlaywrightDiagnosis(result).server.requests.length, 1);
  assert.equal(
    result.tool_diagnosis.findings.some(
      (finding) => finding.detector === 'browser_server_unaccounted_time'
    ),
    true
  );
  assert.equal(
    result.detector_coverage_matrix.lanes[0].mechanisms.find(
      (entry) => entry.mechanism === 'browser_loading_total'
    ).status,
    'ran'
  );
  assert.equal(
    result.detector_coverage_matrix.lanes[0].mechanisms.find(
      (entry) => entry.mechanism === 'browser_action_timeline'
    ).status,
    'ran'
  );
  assert.equal(
    result.detector_coverage_matrix.lanes[0].mechanisms.find(
      (entry) => entry.mechanism === 'browser_server_database'
    ).status,
    'ran'
  );
});

test('keeps repeated resources in separate navigation parents', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
  });
  const { diagnosePlaywrightTraceSource } = await import('./playwright-trace-import.mjs');
  const events = [];
  for (const [index, route] of ['/', '/blog', '/daily'].entries()) {
    const start = 10 + index * 20;
    events.push(
      {
        type: 'action',
        callId: `call-${index}`,
        title: 'page.goto',
        class: 'Frame',
        method: 'goto',
        startTime: start,
        endTime: start + 10,
        params: { url: route },
      },
      {
        type: 'resource-snapshot',
        snapshot: {
          _monotonicTime: start + 1,
          time: 2,
          request: { method: 'GET', url: 'http://127.0.0.1:4173/shared.js' },
          response: { status: 200 },
        },
      }
    );
  }

  const result = await diagnosePlaywrightTraceSource(root, events.map(JSON.stringify).join('\n'), {
    target: 'tests/browser.spec.ts',
    name: 'multi navigation flow',
  });
  const navigations = result.flows.filter((flow) => flow.kind === 'navigation');
  const resources = result.flows.filter((flow) => flow.kind === 'http_client');
  assert.equal(navigations.length, 3);
  assert.equal(new Set(resources.map((flow) => flow.parent_flow_id)).size, 3);
  assert.equal(
    result.tool_diagnosis.findings.some((finding) => finding.kind === 'repeated_network_operation'),
    false
  );
});

test('redacts opaque credential-shaped route segments while retaining request identity', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
  });
  const token = `phc_${'A1b2'.repeat(10)}`;
  const { diagnosePlaywrightTraceSource } = await import('./playwright-trace-import.mjs');
  const result = await diagnosePlaywrightTraceSource(
    root,
    JSON.stringify({
      type: 'resource-snapshot',
      snapshot: {
        _monotonicTime: 1,
        time: 2,
        _resourceType: 'fetch',
        request: { method: 'GET', url: `https://example.com/array/${token}/config` },
        response: { status: -1 },
      },
    }),
    { target: 'tests/browser.spec.ts', name: 'redacted route flow' }
  );
  const resource = result.flows.find((flow) => flow.kind === 'http_client');

  assert.equal(resource.attributes.route, '/array/<redacted:opaque>/config');
  assert.match(resource.attributes.request_identity_sha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('browser diagnosis retains bounded process-tree memory without claiming renderer heap', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
  });
  const { diagnosePlaywrightTraceSource } = await import('./playwright-trace-import.mjs');
  const result = await diagnosePlaywrightTraceSource(
    root,
    JSON.stringify({
      type: 'resource-snapshot',
      snapshot: {
        _monotonicTime: 1,
        time: 2,
        request: { method: 'GET', url: 'http://127.0.0.1:4173/' },
        response: { status: 200 },
      },
    }),
    {
      target: 'tests/browser.spec.ts',
      name: 'browser memory flow',
      browserMemory: {
        peak_process_tree_rss_bytes: 256 * 1024 * 1024,
        samples: 20,
        interval_ms: 50,
        provenance: 'local_process_tree_rss_sampling',
      },
    }
  );

  assert.equal(result.memory.peak_process_tree_rss_bytes, 256 * 1024 * 1024);
  assert.equal(
    result.detector_coverage_matrix.lanes[0].mechanisms.find(
      (entry) => entry.mechanism === 'browser_memory'
    ).status,
    'ran'
  );
  assert.equal(
    result.detector_coverage_matrix.lanes[0].mechanisms.find(
      (entry) => entry.mechanism === 'browser_renderer_heap'
    ).status,
    'unavailable'
  );
  assert.match(result.limitations.join(' '), /does not isolate renderer heap/);
});

test('browser diagnosis exposes React activity as separate diagnostic evidence', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module', dependencies: { react: '19.1.0' } }),
  });
  const { diagnosePlaywrightTraceSource } = await import('./playwright-trace-import.mjs');
  const result = await diagnosePlaywrightTraceSource(
    root,
    JSON.stringify({
      type: 'resource-snapshot',
      snapshot: {
        _monotonicTime: 1,
        time: 2,
        request: { method: 'GET', url: 'http://127.0.0.1:4173/' },
        response: { status: 200 },
      },
    }),
    {
      target: 'tests/browser.spec.ts',
      name: 'React browser flow',
      reactCommits: {
        schema_version: 'runtime-playwright-react-commits/v2',
        state: 'succeeded',
        framework: 'react',
        authority: {
          package_path: 'package.json',
          declared_packages: ['react'],
          provenance: 'nearest_package_manifest_declared_dependency',
        },
        documents_observed: 1,
        renderer_versions: ['19.1.0'],
        commit_count: 3,
        profiled_commit_count: 3,
        total_actual_duration_ms: 24,
        max_commit_duration_ms: 10,
        measurement_complete: true,
        presentation_truncated: false,
        self_duration_provenance: 'inclusive_minus_direct_child_actual_duration',
        source_attribution: {
          state: 'complete',
          files_scanned: 1,
          bytes_scanned: 100,
          file_limit: 512,
          byte_limit: 4 * 1024 * 1024,
          provenance: 'bounded_static_component_declaration_scan',
        },
        components: [
          {
            name: 'ResultsList',
            active_fiber_count: 3,
            commits_present: 3,
            inclusive_actual_duration_ms: 18,
            max_actual_duration_ms: 8,
            self_actual_duration_ms: 8,
            max_self_actual_duration_ms: 4,
            ownership: 'repository',
            source: {
              file: 'src/ResultsList.tsx',
              line: 1,
              provenance: 'static_unique_react_component_declaration',
            },
          },
        ],
        attribution: 'component_activity_observed',
        truncated: false,
        provenance: 'react_devtools_hook_separate_exact_flow_pass',
        limitations: ['Diagnostic pass only.'],
      },
    }
  );

  assert.equal(result.react.components[0].name, 'ResultsList');
  assert.equal(compactPlaywrightDiagnosis(result).react.top_components[0].name, 'ResultsList');
  assert.equal(
    result.tool_diagnosis.findings.find(
      (finding) => finding.kind === 'react_component_commit_hotspot'
    ).source.file,
    'src/ResultsList.tsx'
  );
  assert.equal(
    result.detector_coverage_matrix.lanes[0].mechanisms.find(
      (entry) => entry.mechanism === 'react_commit_activity'
    ).status,
    'ran'
  );
  assert.equal(
    result.detector_coverage_matrix.lanes[0].mechanisms.find(
      (entry) => entry.mechanism === 'react_component_hotspot_diagnosis'
    ).status,
    'ran'
  );
});

test('navigation accounting unions overlapping resource intervals and refuses incomplete evidence', async () => {
  const { navigationWithResourceAccounting } = await import('./playwright-trace-import.mjs');
  const navigation = { started_at_ms: 100, duration_ms: 20 };
  const resources = [
    { started_at_ms: 98, duration_ms: 7 },
    { started_at_ms: 103, duration_ms: 7 },
    { started_at_ms: 108, duration_ms: 20 },
  ];
  assert.deepEqual(
    navigationWithResourceAccounting(navigation, resources, { complete: true }).accounting,
    { accounted_child_ms: 20, unaccounted_ms: 0 }
  );
  assert.equal(
    navigationWithResourceAccounting(navigation, resources, { complete: false }).accounting,
    undefined
  );
});

test('large traces retain early and slow network evidence instead of failing wholesale', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
  });
  const { diagnosePlaywrightTraceSource } = await import('./playwright-trace-import.mjs');
  const noise = Array.from({ length: 1_100 }, (_, index) => ({
    type: 'console',
    message: `irrelevant-${index}`,
  }));
  const resources = Array.from({ length: 300 }, (_, index) => ({
    type: 'resource-snapshot',
    snapshot: {
      _monotonicTime: index + 1,
      time: index === 299 ? 5_000 : 1,
      _resourceType: 'script',
      request: {
        method: 'GET',
        url: `http://127.0.0.1:4173/${
          index === 299 ? 'slow-tail' : index === 298 ? 'large-tail' : `asset-${index}`
        }`,
      },
      response: {
        status: 200,
        _transferSize: index === 298 ? 900_000_000 : 1_000,
        bodySize: 1_000,
        content: { size: 1_000, mimeType: 'application/javascript' },
      },
    },
  }));
  const actions = Array.from({ length: 100 }, (_, index) => ({
    type: 'action',
    title: 'locator.click',
    startTime: 6_000 + index * 200,
    endTime: 6_001 + index * 200 + index,
    params: { selector: `private-${index}` },
  }));
  const result = await diagnosePlaywrightTraceSource(
    root,
    [...noise, ...resources, ...actions].map(JSON.stringify).join('\n'),
    {
      target: 'tests/browser.spec.ts',
      name: 'large browser flow',
      mainThreadTraceSource: JSON.stringify({
        traceEvents: [
          { ph: 'M', name: 'process_name', pid: 1, tid: 1, args: { name: 'Renderer' } },
          { ph: 'M', name: 'thread_name', pid: 1, tid: 1, args: { name: 'CrRendererMain' } },
          ...Array.from({ length: 128 }, (_, index) => ({
            ph: 'X',
            name: 'ThreadControllerImpl::RunTask',
            pid: 1,
            tid: 1,
            ts: index * 1_000_000,
            dur: (60 + index) * 1_000,
          })),
        ],
      }),
    }
  );

  assert.ok(result.flows.some((flow) => flow.attributes?.route === '/slow-tail'));
  assert.equal(result.loading.largest_resources[0].route, '/large-tail');
  assert.equal(result.loading.inventory.complete, false);
  assert.equal(result.loading.complete_transfer_bytes, null);
  assert.deepEqual(result.actions.inventory, {
    started_action_count: 100,
    completed_action_count: 100,
    observed_completed_action_count: 64,
    complete: false,
    sampled: true,
  });
  assert.equal(result.actions.sequence[0].ordinal, 1);
  assert.equal(result.actions.slowest[0].ordinal, 100);
  assert.equal(JSON.stringify(result.actions).includes('private-'), false);
  assert.equal(
    result.detector_coverage_matrix.lanes[0].mechanisms.find(
      (entry) => entry.mechanism === 'browser_loading_total'
    ).status,
    'insufficient_evidence'
  );
  assert.ok(result.flows.length <= 128);
  assert.equal(
    Math.max(
      ...result.flows
        .filter((flow) => flow.kind === 'browser_main_thread_task')
        .map((flow) => flow.timing.duration_ms)
    ),
    187
  );
  assert.equal(
    result.tool_diagnosis.findings.find(
      (finding) => finding.kind === 'browser_main_thread_long_task'
    ).observed.operation_count,
    128
  );
  assert.match(result.limitations.join(' '), /earliest and slowest resources/);
});

test('browser capture receipts remain closed and state consistent', () => {
  const receipt = successfulReceipt();
  assert.deepEqual(validatePlaywrightCaptureReceipt(receipt), []);
  const mainThread = {
    phases_ms: { javascript: 10, style: 2, layout: 3, paint: 1 },
    long_tasks: { count: 0, total_duration_ms: 0 },
    repository_cpu: { state: 'observed_zero', sample_count: 0, self_time_ms: 0 },
  };
  assert.deepEqual(
    validatePlaywrightCaptureReceipt({
      ...receipt,
      diagnosis: { ...receipt.diagnosis, main_thread: mainThread },
    }),
    []
  );
  assert.match(
    validatePlaywrightCaptureReceipt({
      ...receipt,
      diagnosis: {
        ...receipt.diagnosis,
        main_thread: {
          ...mainThread,
          repository_cpu: { ...mainThread.repository_cpu, source: 'hidden' },
        },
      },
    }).join(', '),
    /repository_cpu has unknown field/
  );
  assert.match(
    validatePlaywrightCaptureReceipt({
      ...receipt,
      schema_version: 'runtime-playwright-capture/v2',
    }).join(', '),
    /schema_version is invalid/
  );
  assert.match(
    validatePlaywrightCaptureReceipt({ ...receipt, command: 'pnpm dev' }).join(', '),
    /unknown field/
  );
  assert.deepEqual(validatePlaywrightCaptureReceipt({ ...receipt, state: 'failed' }), []);
  assert.match(
    validatePlaywrightCaptureReceipt({ ...receipt, state: 'local_server_required' }).join(', '),
    /cannot have result/
  );
  assert.match(
    validatePlaywrightCaptureReceipt({
      ...receipt,
      policy: { ...receipt.policy, server_identity: 'verified_by_declared_process' },
    }).join(', '),
    /requires verified declared-process attestation/
  );
  assert.match(
    validatePlaywrightCaptureReceipt({ ...receipt, diagnosis: null }).join(', '),
    /result and diagnosis must be present together/
  );
  assert.match(
    validatePlaywrightCaptureReceipt({
      ...receipt,
      diagnosis: { ...receipt.diagnosis, finding_count: 1 },
    }).join(', '),
    /finding_ids is invalid/
  );
});

test('durable failed-browser diagnosis reload verifies bytes, hash, and compact diagnosis', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-load-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, '.codevetter/playwright-runs/browser-run');
  await mkdir(directory, { recursive: true });
  const result = {
    tool_diagnosis: { findings: [], verdict: { status: 'no_findings' } },
  };
  const serialized = Buffer.from(JSON.stringify(result));
  const path = join(directory, 'result.json');
  await writeFile(path, serialized);
  const receipt = assertPlaywrightCaptureReceipt({
    ...successfulReceipt(),
    state: 'failed',
    diagnosis: compactPlaywrightDiagnosis(result),
    result: {
      path: '.codevetter/playwright-runs/browser-run/result.json',
      sha256: createHash('sha256').update(serialized).digest('hex'),
      bytes: serialized.byteLength,
    },
  });

  assert.deepEqual(await loadPlaywrightCaptureResult(root, receipt), result);
  await writeFile(path, `${serialized} `);
  await assert.rejects(() => loadPlaywrightCaptureResult(root, receipt), /integrity check failed/);
});

test('Playwright reporter output outranks non-actionable stderr warnings', () => {
  const failure = compactPlaywrightFailure(process.cwd(), {
    operationalError: null,
    stdout: 'TimeoutError: heading was not visible',
    stderr: "Warning: The 'NO_COLOR' env is ignored",
    status: 'exited',
  });
  assert.equal(failure, 'TimeoutError: heading was not visible');

  const temporary = '/tmp/codevetter-playwright-private';
  const relativeTemporary = '../../tmp/codevetter-playwright-private';
  assert.equal(
    compactPlaywrightFailure(
      '/workspace/repository',
      {
        operationalError: null,
        stdout: `trace: ${relativeTemporary}/output/trace.zip`,
        stderr: '',
        status: 'exited',
      },
      { temporaryRoot: temporary }
    ),
    'trace: <repo>/output/trace.zip'
  );
});

test('browser test timeout reserves the outer deadline for trace finalization', () => {
  assert.equal(playwrightTestTimeout(20_000), 12_000);
  assert.equal(playwrightTestTimeout(30_000), 18_000);
  assert.equal(playwrightTestTimeout(100), 100);
});

test('server-flow loading remains bounded when owned process sealing fails', async () => {
  const order = [];
  const observed = await prepareAndLoadServerFlow(
    async () => {
      order.push('seal');
      throw new Error('owned process seal failed');
    },
    async () => {
      order.push('load');
      return { state: 'observed', events: [], complete: true };
    }
  );
  assert.deepEqual(order, ['seal', 'load']);
  assert.equal(observed.state, 'observed');

  assert.deepEqual(await prepareAndLoadServerFlow(null, async () => Promise.reject()), {
    state: 'unavailable',
    reason: 'artifact_directory_unavailable',
    events: [],
    complete: false,
  });
});

test('missing loopback server produces durable non-execution evidence', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.0.0' } }),
    'playwright.config.ts': [
      "throw new Error('config-must-not-run');",
      "export default { use: { baseURL: 'http://127.0.0.1:49199' }, webServer: { command: 'curl production' } };",
      '',
    ].join('\n'),
    'tests/browser.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('local browser flow', async ({ page }) => page.goto('/'));",
      '',
    ].join('\n'),
  });
  const candidate = await (await import('./qualification.mjs'))
    .qualifyRepository(root)
    .then((result) => result.flows[0]);
  const receipt = await captureQualifiedPlaywrightFlow({
    repositoryRoot: root,
    captureId: 'missing-server',
    candidateId: candidate.id,
    timeoutMs: 1_000,
  });
  assert.equal(receipt.state, 'local_server_required');
  assert.equal(receipt.execution.status, 'not_started');
  assert.match(receipt.limitations.join(' '), /webServer commands were not evaluated/);
  assert.deepEqual(
    JSON.parse(
      await readFile(join(root, '.codevetter/playwright-runs/missing-server/receipt.json'), 'utf8')
    ),
    receipt
  );
});

test('a source change during browser setup invalidates the capture receipt', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.0.0' } }),
    'playwright.config.ts': "export default { use: { baseURL: 'http://127.0.0.1:49198' } };\n",
    'tests/browser.spec.ts': [
      "import { test } from '@playwright/test';",
      "test('local browser flow', async ({ page }) => page.goto('/'));",
      '',
    ].join('\n'),
  });
  const qualification = await (await import('./qualification.mjs')).qualifyRepository(root);
  const candidate = qualification.flows[0];

  const receipt = await captureQualifiedPlaywrightFlow({
    repositoryRoot: root,
    captureId: 'changed-browser-source',
    candidateId: candidate.id,
    timeoutMs: 1_000,
    attestServer: async () => {
      await writeFile(join(root, 'tests/browser.spec.ts'), '// changed during setup\n');
      return verifiedServerAttestation();
    },
  });

  assert.equal(receipt.state, 'failed');
  assert.equal(receipt.result, null);
  assert.equal(receipt.diagnosis, null);
  assert.match(receipt.failure, /source snapshot changed/i);
});

test('real browser capture selects one exact flow, denies remote HTTP, and normalizes its trace', {
  skip: !playwrightChromiumAvailable(),
  timeout: 60_000,
}, async (context) => {
  const requests = [];
  const applicationSource = [
    'function expensiveRender() {',
    '  const end = performance.now() + 800;',
    '  while (performance.now() < end) {}',
    '}',
    'expensiveRender();',
    '',
  ].join('\n');
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/src/app.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(applicationSource);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      '<!doctype html><title>CodeVetter local proof</title><main>local</main>' +
        "<script>window.remoteRequestState='pending'</script>" +
        '<script src="http://example.com/codevetter-proof" ' +
        'onload="window.remoteRequestState=\'loaded\'" ' +
        'onerror="window.remoteRequestState=\'denied\'"></script>' +
        '<script src="/src/app.js"></script>'
    );
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  context.after(
    () =>
      new Promise((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise()))
      )
  );
  const port = server.address().port;
  const root = await gitFixture(context, {
    '.gitignore': 'node_modules\n',
    'design.html': '<script src="http://example.com/codevetter-proof"></script>\n',
    'index.html': '<script src="http://example.com/codevetter-proof"></script>\n',
    'src/app.js': applicationSource,
    'package.json': JSON.stringify({
      type: 'module',
      devDependencies: { '@playwright/test': '1.59.1' },
    }),
    'playwright.config.ts': [
      "throw new Error('project-config-must-not-run');",
      `export default { use: { baseURL: 'http://127.0.0.1:${port}' }, projects: [{ name: 'mobile', use: { ...devices['iPhone 13'], viewport: { width: 412, height: 700 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false } }], webServer: { command: 'curl production' } };`,
      '',
    ].join('\n'),
    'tests/browser.spec.js': [
      "import { expect, test } from '@playwright/test';",
      "test('captured local browser flow', async ({ page }) => {",
      "  await page.route('**/fixture', (route) => route.fulfill({ json: { ok: true } }));",
      "  await page.goto('/');",
      "  await expect(page).toHaveTitle('CodeVetter local proof');",
      "  expect(await page.evaluate(() => window.remoteRequestState)).toBe('denied');",
      '});',
      "test('unselected browser flow', async () => { throw new Error('unselected-flow-executed'); });",
      "test('fresh-context-only browser flow', async ({ page }) => {",
      "  await page.route('**/fixture', (route) => route.fulfill({ json: { ok: true } }));",
      "  await page.goto('/');",
      '  const visits = await page.evaluate(() => {',
      "    const next = Number(localStorage.getItem('codevetter-visits') ?? 0) + 1;",
      "    localStorage.setItem('codevetter-visits', String(next));",
      '    return next;',
      '  });',
      '  expect(visits).toBe(1);',
      '});',
      "test('failing traced browser flow', async ({ page }) => {",
      "  await page.goto('/');",
      "  expect('observed').toBe('expected');",
      '});',
      '',
    ].join('\n'),
  });
  await copyPlaywrightDependencies(root);
  const qualification = await (await import('./qualification.mjs')).qualifyRepository(root);
  const candidate = qualification.flows.find(
    (flow) => flow.adapter === 'playwright' && flow.name === 'captured local browser flow'
  );
  assert.ok(candidate);

  const receipt = await captureQualifiedPlaywrightFlow({
    repositoryRoot: root,
    captureId: 'real-browser-proof',
    candidateId: candidate.id,
    timeoutMs: 20_000,
    attestServer: async () => verifiedServerAttestation(),
  });

  assert.equal(receipt.state, 'succeeded', receipt.failure);
  assert.equal(receipt.scope.target, 'tests/browser.spec.js');
  assert.equal(receipt.scope.name, 'captured local browser flow');
  assert.deepEqual(receipt.scope.browser_profile, {
    project_name: 'mobile',
    device_name: 'iPhone 13',
    viewport: { width: 412, height: 700 },
    device_scale_factor: 2,
    is_mobile: false,
    has_touch: false,
    provenance: 'static_playwright_device',
  });
  assert.equal(receipt.policy.remote_http_denied, true);
  assert.equal(receipt.policy.server_identity, 'verified_by_declared_process');
  assert.equal(receipt.server_attestation.state, 'verified_by_declared_process');
  assert.ok(receipt.execution.memory?.peak_rss_bytes > 0, JSON.stringify(receipt.execution));
  assert.equal(receipt.diagnosis.verdict, 'findings');
  assert.equal(receipt.diagnosis.finding_count > 0, true);
  assert.ok(receipt.diagnosis.memory.process_tree_peak_rss_bytes > 0);
  assert.ok(receipt.diagnosis.memory.renderer.samples > 0);
  assert.ok(receipt.diagnosis.memory.repeated, JSON.stringify(receipt.limitations));
  assert.equal(receipt.diagnosis.memory.repeated.samples, 3);
  assert.equal(receipt.diagnosis.memory.repeated.context_scope, 'fresh_context_exact_flow_repeats');
  assert.ok(receipt.diagnosis.memory.same_page, JSON.stringify(receipt.limitations));
  assert.equal(receipt.diagnosis.memory.same_page.samples, 3);
  assert.equal(
    receipt.diagnosis.memory.same_page.context_scope,
    'same_page_and_context_exact_flow_repeats'
  );
  assert.equal(receipt.diagnosis.memory.same_page.retained_attribution_state, 'succeeded');
  assert.equal(receipt.diagnosis.memory.same_page.retained_candidate, null);
  assert.equal(receipt.diagnosis.memory.leak_assessment, 'not_evaluated');
  assert.match(receipt.limitations.join(' '), /does not prove.*repository-intended runtime/);
  assert.ok(requests.includes('/'));
  assert.equal(
    requests.every((path) => path === '/' || path === '/favicon.ico' || path === '/src/app.js'),
    true
  );
  const result = JSON.parse(
    await readFile(join(root, '.codevetter/playwright-runs/real-browser-proof/result.json'), 'utf8')
  );
  assert.deepEqual(result.scope, {
    target: 'tests/browser.spec.js',
    name: 'captured local browser flow',
  });
  assert.ok(
    result.flows.some((flow) => flow.kind === 'navigation'),
    JSON.stringify(result.flows)
  );
  assert.ok(
    result.flows.some((flow) => flow.kind === 'http_client'),
    JSON.stringify(result.flows)
  );
  assert.ok(result.main_thread?.renderer_main_thread_count > 0, JSON.stringify(result.main_thread));
  assert.ok(
    result.main_thread.memory_counters?.sample_count > 0,
    JSON.stringify(result.main_thread)
  );
  assert.equal(result.memory.peak_process_tree_rss_bytes, receipt.execution.memory.peak_rss_bytes);
  assert.equal(result.repeated_memory.state, 'succeeded');
  assert.equal(result.repeated_memory.samples.length, 3);
  assert.equal(result.repeated_memory.leak_assessment, 'not_evaluated_fresh_contexts');
  assert.equal(result.same_page_memory.state, 'succeeded');
  assert.equal(result.same_page_memory.samples.length, 3);
  assert.equal(result.same_page_memory.leak_assessment, 'not_evaluated_full_callback_replay');
  assert.equal(result.same_page_memory.retained_attribution.state, 'succeeded');
  assert.equal(result.same_page_memory.retained_attribution.candidate, null);
  assert.equal(
    result.detector_coverage_matrix.lanes[0].mechanisms.find(
      (entry) => entry.mechanism === 'browser_renderer_heap'
    ).status,
    'ran'
  );
  assert.equal(
    result.detector_coverage_matrix.lanes[0].mechanisms.find(
      (entry) => entry.mechanism === 'browser_memory_leak'
    ).status,
    'unavailable'
  );
  assert.equal(
    result.detector_coverage_matrix.lanes[0].mechanisms.find(
      (entry) => entry.mechanism === 'browser_repeated_memory'
    ).status,
    'ran'
  );
  assert.equal(
    result.detector_coverage_matrix.lanes[0].mechanisms.find(
      (entry) => entry.mechanism === 'browser_same_page_memory'
    ).status,
    'ran'
  );
  assert.equal(
    result.detector_coverage_matrix.lanes[0].mechanisms.find(
      (entry) => entry.mechanism === 'browser_retained_allocation_source'
    ).status,
    'insufficient_evidence'
  );
  assert.ok(
    result.flows.some(
      (flow) => flow.kind === 'browser_main_thread_task' && flow.timing.duration_ms >= 50
    ),
    JSON.stringify(result.flows)
  );
  assert.ok(
    result.main_thread.profile.candidates.some(
      (candidate) => candidate.file === 'src/app.js' && candidate.function === 'expensiveRender'
    ),
    JSON.stringify(result.main_thread.profile)
  );
  const deniedRemote = result.flows.find(
    (flow) => flow.kind === 'http_client' && flow.attributes.route === '/codevetter-proof'
  );
  assert.equal(deniedRemote.attributes.status, 403);
  assert.equal(deniedRemote.attributes.outcome, 'error');
  assert.equal(deniedRemote.attributes.host, 'example.com');
  assert.equal(deniedRemote.attributes.network_scope, 'remote');
  assert.deepEqual(deniedRemote.attributes.source, {
    file: 'index.html',
    line: 1,
    function: null,
    provenance: 'static_network_literal',
  });
  const failedNetwork = result.tool_diagnosis.findings.find(
    (finding) => finding.kind === 'failed_network_operation'
  );
  assert.equal(failedNetwork.observed.host, 'example.com');
  assert.equal(failedNetwork.source.file, 'index.html');
  const browserCpu = result.tool_diagnosis.findings.find(
    (finding) => finding.kind === 'browser_javascript_cpu_hotspot'
  );
  assert.equal(browserCpu.source.file, 'src/app.js');
  assert.equal(browserCpu.eligible_for_experiment, true);
  assert.deepEqual(
    receipt.diagnosis.finding_ids,
    result.tool_diagnosis.findings.map((finding) => finding.id)
  );
  assert.equal(JSON.stringify(result).includes('unselected-flow-executed'), false);
  assert.deepEqual(
    (await readdir(join(root, '.codevetter/playwright-runs/real-browser-proof'))).toSorted(),
    ['receipt.json', 'result.json']
  );

  const freshContextOnlyCandidate = qualification.flows.find(
    (flow) => flow.adapter === 'playwright' && flow.name === 'fresh-context-only browser flow'
  );
  const freshContextOnly = await captureQualifiedPlaywrightFlow({
    repositoryRoot: root,
    captureId: 'same-page-unavailable-proof',
    candidateId: freshContextOnlyCandidate.id,
    timeoutMs: 20_000,
    attestServer: async () => verifiedServerAttestation(),
  });
  assert.equal(freshContextOnly.state, 'succeeded', freshContextOnly.failure);
  assert.equal(freshContextOnly.diagnosis.memory.repeated.samples, 3);
  assert.equal(freshContextOnly.diagnosis.memory.same_page, null);
  assert.match(freshContextOnly.limitations.join(' '), /same-page.*did not complete/i);
  const freshContextOnlyResult = JSON.parse(
    await readFile(
      join(root, '.codevetter/playwright-runs/same-page-unavailable-proof/result.json'),
      'utf8'
    )
  );
  assert.equal(freshContextOnlyResult.same_page_memory.state, 'unavailable');

  const failingCandidate = qualification.flows.find(
    (flow) => flow.adapter === 'playwright' && flow.name === 'failing traced browser flow'
  );
  const failed = await captureQualifiedPlaywrightFlow({
    repositoryRoot: root,
    captureId: 'real-browser-failure-proof',
    candidateId: failingCandidate.id,
    timeoutMs: 20_000,
  });
  assert.equal(failed.state, 'failed');
  assert.ok(failed.result);
  const failedResult = JSON.parse(
    await readFile(
      join(root, '.codevetter/playwright-runs/real-browser-failure-proof/result.json'),
      'utf8'
    )
  );
  assert.ok(failedResult.flows.some((flow) => flow.kind === 'navigation'));
});

function browserCandidate() {
  return {
    id: 'browser-flow',
    adapter: 'playwright',
    target: 'tests/browser.spec.ts',
    name: 'local browser flow',
    signals: [
      { kind: 'generic_test_scope', weight: 5, evidence: 'tests/browser.spec.ts' },
      { kind: 'loopback_browser_base_url', weight: 0, evidence: 'http://127.0.0.1:4173' },
    ],
    safety_flags: [{ kind: 'browser_signal', evidence: 'tests/browser.spec.ts' }],
  };
}

function memorySample(repeatIndex, beforeHeap, sampledLiveBytes = null) {
  const counters = (heap, offset) => ({
    heap_used_bytes: heap,
    heap_total_bytes: heap + 10_000,
    embedder_heap_used_bytes: 1_000 + offset,
    backing_storage_bytes: 500 + offset,
    dom_nodes: 10 + offset,
    documents: 1,
    event_listeners: 2 + offset,
    provenance: 'playwright_cdp_after_forced_gc',
  });
  const sample = {
    schema_version: 'runtime-playwright-memory-sample/v1',
    repeat_index: repeatIndex,
    retry: 0,
    before: counters(beforeHeap, repeatIndex),
    after: counters(beforeHeap + 2_000, repeatIndex + 5),
    limitation: null,
  };
  if (sampledLiveBytes !== null) {
    sample.retained_profile = {
      schema_version: 'runtime-browser-live-allocation-profile/v1',
      collection_scope: 'objects_alive_after_forced_gc_allocated_during_same_page_probe',
      sampling_interval_bytes: 32 * 1024,
      sampled_live_bytes: sampledLiveBytes + 500_000,
      application_sampled_live_bytes: sampledLiveBytes,
      hotspots: [
        ...(sampledLiveBytes > 0
          ? [
              {
                function: 'renderRows',
                file: 'src/App.tsx',
                line: 12,
                role: 'application',
                sampled_live_bytes: sampledLiveBytes,
                sample_share: sampledLiveBytes / (sampledLiveBytes + 500_000),
                provenance: 'repository_contained_browser_runtime_frame',
              },
            ]
          : []),
        {
          function: 'fixture',
          file: 'tests/browser.spec.ts',
          line: 4,
          role: 'test_or_harness',
          sampled_live_bytes: 500_000,
          sample_share: 500_000 / (sampledLiveBytes + 500_000),
          provenance: 'repository_contained_browser_runtime_frame',
        },
      ],
      truncated: false,
    };
  }
  return sample;
}

function successfulReceipt() {
  return assertPlaywrightCaptureReceipt({
    schema_version: PLAYWRIGHT_CAPTURE_SCHEMA_VERSION,
    capture_id: 'browser-run',
    state: 'succeeded',
    subject: { repository_revision: 'abc123', dirty: false },
    scope: {
      adapter: 'playwright',
      candidate_id: 'browser-flow',
      target: 'tests/browser.spec.ts',
      name: 'local browser flow',
      base_url: 'http://127.0.0.1:4173',
      browser_profile: {
        project_name: null,
        device_name: null,
        viewport: { width: 1_280, height: 720 },
        device_scale_factor: 1,
        is_mobile: false,
        has_touch: false,
        provenance: 'codevetter_generic_desktop',
      },
    },
    policy: {
      timeout_ms: 1_000,
      workers: 1,
      retries: 0,
      remote_http_denied: true,
      server_identity: 'unverified',
    },
    lifecycle: {
      started_at: '2026-08-12T00:00:00.000Z',
      completed_at: '2026-08-12T00:00:01.000Z',
    },
    execution: {
      status: 'exited',
      exit_code: 0,
      duration_ms: 1,
      stdout_bytes: 0,
      stderr_bytes: 0,
      truncated: false,
      memory: null,
    },
    server_attestation: unverifiedServerAttestation(),
    diagnosis: {
      verdict: 'no_findings',
      finding_count: 0,
      finding_ids: [],
      eligible_experiment_findings: 0,
      page_load: null,
      memory: null,
      next_probe: null,
    },
    result: {
      path: '.codevetter/playwright-runs/browser-run/result.json',
      sha256: 'a'.repeat(64),
      bytes: 100,
    },
    failure: null,
    limitations: [],
  });
}

function unverifiedServerAttestation() {
  return {
    schema_version: LOCAL_SERVER_ATTESTATION_SCHEMA_VERSION,
    state: 'expected_family_unavailable',
    expected_family: null,
    declared_command_sha256: null,
    checks: {
      listener_count: 0,
      repository_cwd_match: false,
      declared_family_match: false,
    },
    limitations: ['Static server family unavailable.'],
  };
}

function verifiedServerAttestation() {
  return {
    schema_version: LOCAL_SERVER_ATTESTATION_SCHEMA_VERSION,
    state: 'verified_by_declared_process',
    expected_family: 'node',
    declared_command_sha256: 'b'.repeat(64),
    checks: {
      listener_count: 1,
      repository_cwd_match: true,
      declared_family_match: true,
    },
    limitations: ['Local process identity is not production equivalence.'],
  };
}

function storedZip(name, source) {
  const nameBuffer = Buffer.from(name);
  const data = Buffer.from(source);
  const local = Buffer.alloc(30 + nameBuffer.length + data.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26);
  nameBuffer.copy(local, 30);
  data.copy(local, 30 + nameBuffer.length);

  const central = Buffer.alloc(46 + nameBuffer.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuffer.length, 28);
  central.writeUInt32LE(0, 42);
  nameBuffer.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

function playwrightChromiumAvailable() {
  const sourceStore = fileURLToPath(new URL('../../node_modules/.pnpm/', import.meta.url));
  let revisions;
  try {
    const playwrightCore = readdirSync(sourceStore).find((entry) =>
      entry.startsWith('playwright-core@')
    );
    if (!playwrightCore) return false;
    const browsers = JSON.parse(
      readFileSync(join(sourceStore, playwrightCore, 'node_modules/playwright-core/browsers.json'))
    ).browsers;
    const headlessShell = browsers.find((browser) => browser.name === 'chromium-headless-shell');
    revisions = new Set(
      [headlessShell?.revision, ...Object.values(headlessShell?.revisionOverrides ?? {})].filter(
        Boolean
      )
    );
  } catch {
    return false;
  }
  for (const cache of [
    join(homedir(), 'Library/Caches/ms-playwright'),
    join(homedir(), '.cache/ms-playwright'),
  ]) {
    try {
      const found = readdirSync(cache)
        .filter((entry) =>
          [...revisions].some((revision) => entry === `chromium_headless_shell-${revision}`)
        )
        .some((entry) =>
          [
            'chrome-headless-shell-mac-arm64/chrome-headless-shell',
            'chrome-headless-shell-mac-x64/chrome-headless-shell',
            'chrome-headless-shell-linux/chrome-headless-shell',
          ].some((relativePath) => existsSync(join(cache, entry, relativePath)))
        );
      if (found) return true;
    } catch {
      // Continue to the next standard Playwright cache location.
    }
  }
  return false;
}

async function copyPlaywrightDependencies(root) {
  const sourceStore = fileURLToPath(new URL('../../node_modules/.pnpm/', import.meta.url));
  const entries = await readdir(sourceStore);
  const packageEntries = [
    entries.find((entry) => entry.startsWith('@playwright+test@')),
    entries.find((entry) => entry.startsWith('playwright@')),
    entries.find((entry) => entry.startsWith('playwright-core@')),
  ];
  assert.equal(packageEntries.every(Boolean), true, 'local Playwright packages are required');
  const targetStore = join(root, 'node_modules/.pnpm');
  await mkdir(targetStore, { recursive: true });
  for (const entry of packageEntries) {
    await cp(join(sourceStore, entry), join(targetStore, entry), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
  }
  await mkdir(join(root, 'node_modules/@playwright'), { recursive: true });
  await symlink(
    `../.pnpm/${packageEntries[0]}/node_modules/@playwright/test`,
    join(root, 'node_modules/@playwright/test')
  );
}

async function gitFixture(context, files) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-playwright-capture-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  await command('git', ['init', '-q'], root);
  await command('git', ['add', '.'], root);
  await command(
    'git',
    [
      '-c',
      'user.name=CodeVetter Test',
      '-c',
      'user.email=codevetter@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'fixture baseline',
    ],
    root
  );
  return root;
}

function command(program, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${program} failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}
