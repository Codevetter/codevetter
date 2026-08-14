import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  comparePairedBrowserMeasurements,
  normalizeBrowserMeasurement,
  verifyPairedPlaywrightRepositories,
} from './browser-paired-verification.mjs';

test('confirms a material exact-flow browser improvement without memory regression', () => {
  const result = comparePairedBrowserMeasurements({
    qualifications: qualifications(),
    target: 'e2e/flow.spec.ts',
    name: 'renders the catalogue',
    schedule: successfulSchedule(),
    measurements: {
      baseline: [120, 125, 122].map((duration, index) =>
        measurement(`b${index}`, { duration, javascript: 70 })
      ),
      current: [90, 92, 91].map((duration, index) =>
        measurement(`c${index}`, { duration, javascript: 55 })
      ),
    },
  });

  assert.equal(result.verdict.status, 'confirmed');
  assert.equal(result.decisions.shipping_recommended, true);
  assert.equal(metric(result, 'workload_duration_ms').delta_percent < -10, true);
  assert.equal(metric(result, 'process_tree_peak_rss_bytes').regressed, false);
});

test('rejects a faster browser flow when process-tree RSS materially regresses', () => {
  const result = comparePairedBrowserMeasurements({
    qualifications: qualifications(),
    target: 'e2e/flow.spec.ts',
    name: 'renders the catalogue',
    schedule: successfulSchedule(),
    measurements: {
      baseline: [120, 125, 122].map((duration, index) =>
        measurement(`b${index}`, { duration, rss: 300 * 1024 * 1024 })
      ),
      current: [90, 92, 91].map((duration, index) =>
        measurement(`c${index}`, { duration, rss: 350 * 1024 * 1024 })
      ),
    },
  });

  assert.equal(result.verdict.status, 'rejected');
  assert.equal(metric(result, 'process_tree_peak_rss_bytes').regressed, true);
});

test('confirms a material local LCP improvement when total flow time is stable', () => {
  const result = comparePairedBrowserMeasurements({
    qualifications: qualifications(),
    target: 'e2e/flow.spec.ts',
    name: 'renders the catalogue',
    schedule: successfulSchedule(),
    measurements: {
      baseline: [310, 305, 315].map((lcp, index) => measurement(`b${index}`, { lcp })),
      current: [210, 215, 205].map((lcp, index) => measurement(`c${index}`, { lcp })),
    },
  });

  assert.equal(result.verdict.status, 'confirmed');
  assert.equal(metric(result, 'largest_contentful_paint_ms').delta_percent < -10, true);
});

test('unstable LCP candidates cannot confirm an optimization', () => {
  const result = comparePairedBrowserMeasurements({
    qualifications: qualifications(),
    target: 'e2e/flow.spec.ts',
    name: 'renders the catalogue',
    schedule: successfulSchedule(),
    measurements: {
      baseline: [300, 305, 295].map((lcp, index) => measurement(`b${index}`, { lcp })),
      current: [20, 200, 210].map((lcp, index) => measurement(`c${index}`, { lcp })),
    },
  });

  assert.equal(result.verdict.status, 'inconclusive');
  assert.equal(metric(result, 'largest_contentful_paint_ms').stable, false);
  assert.match(result.verdict.reason, /too unstable/);
});

test('compatible repeated React commit evidence can confirm an exact-flow improvement', () => {
  const result = comparePairedBrowserMeasurements({
    qualifications: qualifications(),
    target: 'e2e/flow.spec.ts',
    name: 'renders the catalogue',
    schedule: successfulSchedule(),
    measurements: {
      baseline: [80, 82, 81].map((reactDuration, index) =>
        measurement(`b${index}`, { reactDuration })
      ),
      current: [55, 56, 54].map((reactDuration, index) =>
        measurement(`c${index}`, { reactDuration })
      ),
    },
  });

  assert.equal(result.verdict.status, 'confirmed');
  assert.equal(metric(result, 'react_actual_duration_ms').improved, true);
});

test('a material React commit-duration regression rejects an otherwise stable flow', () => {
  const result = comparePairedBrowserMeasurements({
    qualifications: qualifications(),
    target: 'e2e/flow.spec.ts',
    name: 'renders the catalogue',
    schedule: successfulSchedule(),
    measurements: {
      baseline: [50, 52, 51].map((reactDuration, index) =>
        measurement(`b${index}`, { reactDuration })
      ),
      current: [75, 77, 76].map((reactDuration, index) =>
        measurement(`c${index}`, { reactDuration })
      ),
    },
  });

  assert.equal(result.verdict.status, 'rejected');
  assert.equal(metric(result, 'react_actual_duration_ms').regressed, true);
});

test('complete exact-flow transfer totals can confirm a material loading improvement', () => {
  const result = comparePairedBrowserMeasurements({
    qualifications: qualifications(),
    target: 'e2e/flow.spec.ts',
    name: 'renders the catalogue',
    schedule: successfulSchedule(),
    measurements: {
      baseline: [810_000, 800_000, 805_000].map((transfer, index) =>
        measurement(`b${index}`, { transfer })
      ),
      current: [600_000, 610_000, 605_000].map((transfer, index) =>
        measurement(`c${index}`, { transfer })
      ),
    },
  });

  assert.equal(result.verdict.status, 'confirmed');
  assert.equal(metric(result, 'browser_completed_response_transfer_bytes').improved, true);
});

test('a material exact-flow transfer regression rejects an otherwise stable flow', () => {
  const result = comparePairedBrowserMeasurements({
    qualifications: qualifications(),
    target: 'e2e/flow.spec.ts',
    name: 'renders the catalogue',
    schedule: successfulSchedule(),
    measurements: {
      baseline: [600_000, 610_000, 605_000].map((transfer, index) =>
        measurement(`b${index}`, { transfer })
      ),
      current: [810_000, 800_000, 805_000].map((transfer, index) =>
        measurement(`c${index}`, { transfer })
      ),
    },
  });

  assert.equal(result.verdict.status, 'rejected');
  assert.equal(metric(result, 'browser_completed_response_transfer_bytes').regressed, true);
});

test('partial transfer observations cannot enter paired verification', () => {
  const result = comparePairedBrowserMeasurements({
    qualifications: qualifications(),
    target: 'e2e/flow.spec.ts',
    name: 'renders the catalogue',
    schedule: successfulSchedule(),
    measurements: {
      baseline: [0, 1, 2].map((index) => measurement(`b${index}`, { transfer: 800_000 })),
      current: [
        measurement('c0', { transfer: 600_000 }),
        measurement('c1', { transfer: null }),
        measurement('c2', { transfer: 600_000 }),
      ],
    },
  });

  assert.equal(result.verdict.status, 'inconclusive');
  assert.equal(metric(result, 'browser_completed_response_transfer_bytes'), undefined);
});

test('a changed failed-resource identity prevents transfer-byte verification', () => {
  const result = comparePairedBrowserMeasurements({
    qualifications: qualifications(),
    target: 'e2e/flow.spec.ts',
    name: 'renders the catalogue',
    schedule: successfulSchedule(),
    measurements: {
      baseline: [0, 1, 2].map((index) =>
        measurement(`b${index}`, { transfer: 800_000, failedIdentity: 'a'.repeat(64) })
      ),
      current: [0, 1, 2].map((index) =>
        measurement(`c${index}`, { transfer: 600_000, failedIdentity: 'b'.repeat(64) })
      ),
    },
  });

  assert.equal(result.verdict.status, 'inconclusive');
  assert.equal(metric(result, 'browser_completed_response_transfer_bytes'), undefined);
});

test('normalization prefers the complete zero-failure navigation cohort over later request noise', () => {
  const receipt = captureReceipt('navigation-cohort');
  const result = browserResult('navigation-cohort');
  result.actions = {
    state: 'observed',
    inventory: { complete: true },
    sequence: [
      {
        category: 'navigation',
        state: 'succeeded',
        completed_responses: 8,
        failed_or_aborted_resources: 0,
        completed_response_transfer_bytes: 640_000,
      },
      {
        category: 'evaluation',
        state: 'succeeded',
        completed_responses: 0,
        failed_or_aborted_resources: 2,
        completed_response_transfer_bytes: 0,
      },
    ],
  };
  result.loading.completed_responses.complete_transfer_bytes = 700_000;
  result.loading.failed_or_aborted = {
    count: 2,
    request_identity_sha256: 'a'.repeat(64),
  };

  const normalized = normalizeBrowserMeasurement({ receipt, result });
  assert.deepEqual(normalized.loading, {
    completed_response_transfer_bytes: 640_000,
    completed_response_count: 8,
    failed_or_aborted_count: 0,
    failed_or_aborted_identity_sha256: '0'.repeat(64),
  });
});

test('requires a new sampled-live source to repeat across current captures', () => {
  const candidate = retainedCandidate('src/List.tsx', 'List');
  const once = pairedMeasurements({ currentCandidates: [candidate, null, null] });
  const repeated = pairedMeasurements({ currentCandidates: [candidate, candidate, null] });

  const ignored = comparePairedBrowserMeasurements({
    qualifications: qualifications(),
    target: 'e2e/flow.spec.ts',
    name: 'renders the catalogue',
    schedule: successfulSchedule(),
    measurements: once,
  });
  const rejected = comparePairedBrowserMeasurements({
    qualifications: qualifications(),
    target: 'e2e/flow.spec.ts',
    name: 'renders the catalogue',
    schedule: successfulSchedule(),
    measurements: repeated,
  });

  assert.equal(ignored.observed.retention_status, 'stable');
  assert.equal(ignored.verdict.status, 'inconclusive');
  assert.equal(rejected.observed.retention_status, 'regressed');
  assert.equal(rejected.verdict.status, 'rejected');
});

test('fails closed when either side lacks three successful captures', () => {
  const result = comparePairedBrowserMeasurements({
    qualifications: qualifications(),
    target: 'e2e/flow.spec.ts',
    name: 'renders the catalogue',
    schedule: [],
    measurements: {
      baseline: [measurement('b0'), measurement('b1')],
      current: [measurement('c0'), measurement('c1'), measurement('c2')],
    },
  });
  assert.equal(result.verdict.status, 'no_confidence');
});

test('fails closed when paired captures resolve different browser profiles', () => {
  const measurements = pairedMeasurements();
  measurements.current.forEach((entry) => {
    entry.browser_profile = {
      project_name: 'mobile',
      device_name: 'iPhone 13',
      viewport: { width: 390, height: 664 },
      device_scale_factor: 3,
      is_mobile: true,
      has_touch: true,
      provenance: 'static_playwright_device',
    };
  });
  const result = comparePairedBrowserMeasurements({
    qualifications: qualifications(),
    target: 'e2e/flow.spec.ts',
    name: 'renders the catalogue',
    schedule: successfulSchedule(),
    measurements,
  });
  assert.equal(result.verdict.status, 'no_confidence');
  assert.match(result.verdict.reason, /incompatible browser profiles/);
});

test('orchestrator alternates owned exact captures and retains references', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-paired-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const baseline = join(root, 'baseline');
  const current = join(root, 'current');
  await Promise.all([
    mkdir(join(baseline, 'e2e'), { recursive: true }),
    mkdir(join(current, 'e2e'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(baseline, 'e2e/flow.spec.ts'), 'test("renders the catalogue", () => {})\n'),
    writeFile(join(current, 'e2e/flow.spec.ts'), 'test("renders the catalogue", () => {})\n'),
  ]);
  const [realBaseline, realCurrent] = await Promise.all([realpath(baseline), realpath(current)]);
  const captured = [];
  const result = await verifyPairedPlaywrightRepositories(
    {
      baselineRepositoryRoot: baseline,
      currentRepositoryRoot: current,
      target: 'e2e/flow.spec.ts',
      name: 'renders the catalogue',
      source: 'src/App.tsx',
      timeoutMs: 30_000,
      samples: 3,
      warmups: 1,
    },
    {
      qualify: async (repositoryRoot) =>
        qualification(
          repositoryRoot.endsWith('/baseline') ? 'baseline-revision' : 'current-revision'
        ),
      establishRuntime: async () => ({
        ready: true,
        summary: { state: 'owned_attested', cleanup: 'pending' },
        stop: async () => ({ state: 'owned_attested', cleanup: 'terminated' }),
      }),
      capture: async ({ repositoryRoot, captureId }) => {
        captured.push(repositoryRoot);
        return captureReceipt(captureId);
      },
      loadResult: async (_repositoryRoot, receipt) => browserResult(receipt.capture_id),
      inspectRevisionFiles: async () => ['src/App.tsx'],
      now: () => 1,
    }
  );

  assert.deepEqual(captured, [
    realBaseline,
    realCurrent,
    realBaseline,
    realCurrent,
    realCurrent,
    realBaseline,
    realBaseline,
    realCurrent,
  ]);
  assert.equal(result.paired_schedule.length, 8);
  assert.equal(result.captures.baseline.length, 3);
  assert.equal(result.captures.current.length, 3);
  assert.equal(result.verdict.status, 'inconclusive');
  const durable = JSON.parse(
    await readFile(join(realCurrent, result.evidence_receipt.path), 'utf8')
  );
  assert.equal(durable.verification_id, result.verification_id);
  assert.equal(durable.paired_schedule.length, 8);
  assert.deepEqual(durable.scope.changed_files, ['src/App.tsx']);
});

test('orchestrator accepts one exact sealed dirty candidate and rechecks both snapshots', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-dirty-paired-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const baseline = join(root, 'baseline');
  const current = join(root, 'current');
  await Promise.all([
    mkdir(join(baseline, 'e2e'), { recursive: true }),
    mkdir(join(current, 'e2e'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(baseline, 'e2e/flow.spec.ts'), 'same\n'),
    writeFile(join(current, 'e2e/flow.spec.ts'), 'same\n'),
  ]);
  const revision = 'a'.repeat(40);
  const subjects = {
    baseline: {
      repository_revision: revision,
      source_snapshot_sha256: 'b'.repeat(64),
      dirty: false,
      changed_files: [],
    },
    current: {
      repository_revision: revision,
      source_snapshot_sha256: 'c'.repeat(64),
      dirty: true,
      changed_files: ['src/App.tsx'],
    },
  };
  let snapshotChecks = 0;
  const result = await verifyPairedPlaywrightRepositories(
    {
      baselineRepositoryRoot: baseline,
      currentRepositoryRoot: current,
      target: 'e2e/flow.spec.ts',
      name: 'renders the catalogue',
      source: 'src/App.tsx',
      timeoutMs: 30_000,
      samples: 3,
      warmups: 0,
    },
    {
      qualify: async (repositoryRoot) => ({
        ...qualification(revision),
        subject: repositoryRoot.endsWith('/baseline') ? subjects.baseline : subjects.current,
      }),
      inspectSnapshot: async (repositoryRoot) => {
        snapshotChecks += 1;
        return repositoryRoot.endsWith('/baseline') ? subjects.baseline : subjects.current;
      },
      establishRuntime: async () => ({
        ready: true,
        summary: { state: 'owned_attested', cleanup: 'pending' },
        stop: async () => ({ state: 'owned_attested', cleanup: 'terminated' }),
      }),
      capture: async ({ repositoryRoot, captureId }) => ({
        ...captureReceipt(captureId),
        subject: repositoryRoot.endsWith('/baseline') ? subjects.baseline : subjects.current,
      }),
      loadResult: async (_repositoryRoot, receipt) => browserResult(receipt.capture_id),
      now: () => 4,
    }
  );

  assert.equal(result.verdict.status, 'inconclusive');
  assert.deepEqual(result.scope.changed_files, ['src/App.tsx']);
  assert.equal(snapshotChecks, 14);
});

test('dirty paired verification stops when its exact source snapshot moves', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-dirty-moving-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const baseline = join(root, 'baseline');
  const current = join(root, 'current');
  await Promise.all([
    mkdir(join(baseline, 'e2e'), { recursive: true }),
    mkdir(join(current, 'e2e'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(baseline, 'e2e/flow.spec.ts'), 'same\n'),
    writeFile(join(current, 'e2e/flow.spec.ts'), 'same\n'),
  ]);
  const revision = 'a'.repeat(40);
  const baselineSubject = {
    repository_revision: revision,
    source_snapshot_sha256: 'b'.repeat(64),
    dirty: false,
    changed_files: [],
  };
  const currentSubject = {
    repository_revision: revision,
    source_snapshot_sha256: 'c'.repeat(64),
    dirty: true,
    changed_files: ['src/App.tsx'],
  };
  let currentChecks = 0;
  let executions = 0;

  await assert.rejects(
    verifyPairedPlaywrightRepositories(
      {
        baselineRepositoryRoot: baseline,
        currentRepositoryRoot: current,
        target: 'e2e/flow.spec.ts',
        name: 'renders the catalogue',
        source: 'src/App.tsx',
        timeoutMs: 30_000,
        samples: 3,
        warmups: 0,
      },
      {
        qualify: async (repositoryRoot) => ({
          ...qualification(revision),
          subject: repositoryRoot.endsWith('/baseline') ? baselineSubject : currentSubject,
        }),
        inspectSnapshot: async (repositoryRoot) => {
          if (repositoryRoot.endsWith('/baseline')) return baselineSubject;
          currentChecks += 1;
          return currentChecks === 1
            ? currentSubject
            : { ...currentSubject, source_snapshot_sha256: 'd'.repeat(64) };
        },
        establishRuntime: async () => {
          executions += 1;
          return {
            ready: true,
            summary: { state: 'owned_attested', cleanup: 'pending' },
            stop: async () => ({ state: 'owned_attested', cleanup: 'terminated' }),
          };
        },
        capture: async ({ captureId }) => ({
          ...captureReceipt(captureId),
          subject: baselineSubject,
        }),
        loadResult: async (_repositoryRoot, receipt) => browserResult(receipt.capture_id),
        now: () => 5,
      }
    ),
    /source snapshot changed/
  );
  assert.equal(executions, 1);
});

test('changed browser revisions fail before execution when files escape the sealed source', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-boundary-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const baseline = join(root, 'baseline');
  const current = join(root, 'current');
  await Promise.all([
    mkdir(join(baseline, 'e2e'), { recursive: true }),
    mkdir(join(current, 'e2e'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(baseline, 'e2e/flow.spec.ts'), 'same\n'),
    writeFile(join(current, 'e2e/flow.spec.ts'), 'same\n'),
  ]);
  let executions = 0;
  const result = await verifyPairedPlaywrightRepositories(
    {
      baselineRepositoryRoot: baseline,
      currentRepositoryRoot: current,
      target: 'e2e/flow.spec.ts',
      name: 'renders the catalogue',
      source: 'src/App.tsx',
      timeoutMs: 30_000,
      samples: 3,
      warmups: 0,
    },
    {
      qualify: async (repositoryRoot) =>
        qualification(
          repositoryRoot.endsWith('/baseline') ? 'baseline-revision' : 'current-revision'
        ),
      inspectRevisionFiles: async () => ['src/App.tsx', 'src/Other.tsx'],
      establishRuntime: async () => {
        executions += 1;
        throw new Error('must not execute');
      },
      now: () => 2,
    }
  );
  assert.equal(result.verdict.status, 'no_confidence');
  assert.match(result.verdict.reason, /outside the sealed source boundaries/);
  assert.equal(executions, 0);
});

test('changed browser revisions accept multiple explicitly sealed source files', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-multi-boundary-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const baseline = join(root, 'baseline');
  const current = join(root, 'current');
  await Promise.all([
    mkdir(join(baseline, 'e2e'), { recursive: true }),
    mkdir(join(current, 'e2e'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(baseline, 'e2e/flow.spec.ts'), 'same\n'),
    writeFile(join(current, 'e2e/flow.spec.ts'), 'same\n'),
  ]);
  let executions = 0;
  const result = await verifyPairedPlaywrightRepositories(
    {
      baselineRepositoryRoot: baseline,
      currentRepositoryRoot: current,
      target: 'e2e/flow.spec.ts',
      name: 'renders the catalogue',
      sources: ['src/App.tsx', 'src/shell.tsx'],
      timeoutMs: 30_000,
      samples: 3,
      warmups: 0,
    },
    {
      qualify: async (repositoryRoot) =>
        qualification(
          repositoryRoot.endsWith('/baseline') ? 'baseline-revision' : 'current-revision'
        ),
      inspectRevisionFiles: async () => ['src/App.tsx', 'src/shell.tsx'],
      establishRuntime: async () => ({
        ready: true,
        summary: { state: 'owned_attested', cleanup: 'pending' },
        stop: async () => ({ state: 'owned_attested', cleanup: 'terminated' }),
      }),
      capture: async ({ captureId }) => {
        executions += 1;
        return captureReceipt(captureId);
      },
      loadResult: async (_repositoryRoot, receipt) => browserResult(receipt.capture_id),
      now: () => 3,
    }
  );
  assert.equal(executions, 6);
  assert.deepEqual(result.scope.sealed_sources, ['src/App.tsx', 'src/shell.tsx']);
  assert.equal(result.verdict.status, 'inconclusive');
});

function pairedMeasurements({ currentCandidates = [null, null, null] } = {}) {
  return {
    baseline: [0, 1, 2].map((index) => measurement(`b${index}`)),
    current: [0, 1, 2].map((index) =>
      measurement(`c${index}`, { candidate: currentCandidates[index] })
    ),
  };
}

function measurement(
  captureId,
  {
    duration = 100,
    javascript = 50,
    rss = 300 * 1024 * 1024,
    heap = 20 * 1024 * 1024,
    lcp = null,
    candidate = null,
    reactDuration = null,
    transfer = null,
    failedIdentity = 'f'.repeat(64),
    failedCount = 0,
  } = {}
) {
  return {
    capture_id: captureId,
    browser_profile: genericBrowserProfile(),
    result: {
      path: `.codevetter/playwright-runs/${captureId}/result.json`,
      sha256: 'a'.repeat(64),
      bytes: 100,
    },
    workload_duration_ms: duration,
    renderer_phases: { javascript_ms: javascript, style_ms: 10, layout_ms: 10, paint_ms: 10 },
    process_tree_peak_rss_bytes: rss,
    largest_contentful_paint_ms: lcp,
    same_page_final: { heap_used_bytes: heap, dom_nodes: 100, event_listeners: 20 },
    retained_candidate: candidate,
    react:
      reactDuration === null
        ? null
        : {
            total_actual_duration_ms: reactDuration,
            profiled_commit_count: 3,
            renderer_versions: ['19.1.0'],
            provenance: 'react_devtools_hook_separate_exact_flow_pass',
          },
    loading:
      transfer === null
        ? null
        : {
            completed_response_transfer_bytes: transfer,
            completed_response_count: 10,
            failed_or_aborted_count: failedCount,
            failed_or_aborted_identity_sha256: failedIdentity,
          },
  };
}

function retainedCandidate(file, fn) {
  return {
    source: {
      file,
      line: 10,
      function: fn,
      provenance: 'repository_contained_browser_runtime_frame',
    },
    delta_sampled_live_bytes: 100_000,
  };
}

function qualifications() {
  return {
    baseline: qualification('baseline-revision'),
    current: qualification('current-revision'),
  };
}

function qualification(revision) {
  return {
    subject: { repository_revision: revision, dirty: false },
    flows: [
      {
        id: `${revision}-flow`,
        adapter: 'playwright',
        target: 'e2e/flow.spec.ts',
        name: 'renders the catalogue',
        signals: [
          { kind: 'loopback_browser_base_url', evidence: 'http://127.0.0.1:4173' },
          { kind: 'browser_request_fixture', evidence: 'e2e/flow.spec.ts' },
        ],
      },
    ],
  };
}

function successfulSchedule() {
  return [0, 1, 2].flatMap((index) => [
    { side: 'baseline', phase: 'measurement', sample_index: index, state: 'succeeded' },
    { side: 'current', phase: 'measurement', sample_index: index, state: 'succeeded' },
  ]);
}

function metric(result, kind) {
  return result.observed.metrics.find((entry) => entry.kind === kind);
}

function captureReceipt(captureId) {
  return {
    capture_id: captureId,
    state: 'succeeded',
    execution: {
      exit_code: 0,
      memory: { peak_rss_bytes: 300 * 1024 * 1024 },
    },
    scope: { browser_profile: genericBrowserProfile() },
    result: {
      path: `.codevetter/playwright-runs/${captureId}/result.json`,
      sha256: 'b'.repeat(64),
      bytes: 100,
    },
  };
}

function genericBrowserProfile() {
  return {
    project_name: null,
    device_name: null,
    viewport: { width: 1_280, height: 720 },
    device_scale_factor: 1,
    is_mobile: false,
    has_touch: false,
    provenance: 'codevetter_generic_desktop',
  };
}

function browserResult(captureId) {
  return {
    flows: [
      {
        id: 'flow-1',
        parent_flow_id: null,
        kind: 'workload',
        timing: { duration_ms: 100, provenance: 'playwright_trace_bounds' },
      },
    ],
    main_thread: {
      page_load: {
        largest_contentful_paint_ms: 100,
        candidate_count: 1,
        candidate_size: 1_000,
        provenance: 'chromium_outer_main_frame_lcp_candidate',
      },
      phases: Object.fromEntries(
        ['javascript', 'style', 'layout', 'paint'].map((phase) => [
          phase,
          { total_duration_ms: phase === 'javascript' ? 50 : 10 },
        ])
      ),
    },
    same_page_memory: {
      state: 'succeeded',
      samples: [0, 1, 2].map((index) => ({
        after: { heap_used_bytes: 20_000_000 + index, dom_nodes: 100, event_listeners: 20 },
      })),
      retained_attribution: { state: 'succeeded', candidate: null },
    },
    loading: {
      completed_responses: {
        count: 10,
        complete: true,
        complete_transfer_bytes: 100_000,
      },
      failed_or_aborted: {
        count: 0,
        request_identity_sha256: 'f'.repeat(64),
      },
    },
    capture_id: captureId,
  };
}
