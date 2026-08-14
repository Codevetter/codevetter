import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BROWSER_PROBE_STABILITY_SCHEDULE_SCHEMA_VERSION,
  assertBrowserProbeStabilitySchedule,
  loadDurableBrowserProbeStabilitySchedule,
  stabilizeDurableBrowserProbe,
} from './browser-probe-stability-scheduler.mjs';

const SNAPSHOT = 'a'.repeat(64);
const SOURCE_BYTES = '{"source":true}\n';
const SOURCE_SHA = createHash('sha256').update(SOURCE_BYTES).digest('hex');
const CURRENT = { repository_revision: 'fixture-revision', source_snapshot_sha256: SNAPSHOT };

test('reuses contradictory evidence and executes no local recapture', async (context) => {
  const root = await fixture(context, 'reuse');
  const runs = new Map([
    ['existing-a', run('existing-a')],
    [
      'existing-b',
      run('existing-b', {
        classification: 'mixed_evidence',
        nextProbe: 'capture_narrower_precommit_evidence',
        ratio: 0.19,
      }),
    ],
  ]);
  let recaptures = 0;
  const result = await stabilizeDurableBrowserProbe(
    root,
    input('reuse-schedule', {
      existing_recapture_ids: ['existing-a', 'existing-b'],
      max_new_runs: 1,
    }),
    dependencies(runs, { recapture: async () => (recaptures += 1) })
  );
  assert.equal(result.schema_version, BROWSER_PROBE_STABILITY_SCHEDULE_SCHEMA_VERSION);
  assert.equal(result.state, 'unstable');
  assert.equal(result.terminal_reason, 'compatible_routes_disagreed');
  assert.equal(recaptures, 0);
  assert.deepEqual(result.budget, {
    existing_requested: 2,
    reused: 2,
    new_runs_requested: 1,
    new_runs_admitted: 1,
    new_runs_executed: 0,
    total_observations: 2,
    remaining_new_runs: 1,
    remaining_observations: 1,
  });
  assert.equal(result.authority.edit_eligible, false);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(root, '.codevetter/browser-probe-stability-schedules/reuse-schedule/receipt.json'),
        'utf8'
      )
    ),
    result
  );
  await assert.rejects(
    () =>
      stabilizeDurableBrowserProbe(
        root,
        input('reuse-schedule', {
          existing_recapture_ids: ['existing-a', 'existing-b'],
          max_new_runs: 1,
        }),
        dependencies(runs, { digestProbeReceipt: async () => 'e'.repeat(64) })
      ),
    /run integrity check failed/
  );
});

test('runs derived recaptures sequentially and stops at three unanimous passing routes', async (context) => {
  const root = await fixture(context, 'sequential');
  const runs = new Map();
  const ids = [];
  let active = 0;
  let maximumActive = 0;
  const request = input('sequential-schedule');
  const schedulerDependencies = dependencies(runs, {
    recapture: async (_root, recaptureRequest) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      ids.push(recaptureRequest.recapture_id);
      runs.set(recaptureRequest.recapture_id, run(recaptureRequest.recapture_id));
      active -= 1;
      return completedReceipt(recaptureRequest.recapture_id);
    },
  });
  const result = await stabilizeDurableBrowserProbe(root, request, schedulerDependencies);
  assert.equal(result.state, 'stable');
  assert.deepEqual(ids, [
    'sequential-schedule-r1',
    'sequential-schedule-r2',
    'sequential-schedule-r3',
  ]);
  assert.equal(maximumActive, 1);
  assert.equal(result.budget.new_runs_executed, 3);
  assert.equal(result.budget.total_observations, 3);
  assert.equal(result.budget.remaining_new_runs, 0);
  assert.equal(result.assessment.decision.follow_up_eligible, true);
  const reusedSchedule = await stabilizeDurableBrowserProbe(root, request, schedulerDependencies);
  assert.deepEqual(reusedSchedule, result);
  assert.equal(ids.length, 3);
});

test('admits main-thread runtime probes and stops when narrowed mechanism routes disagree', async (context) => {
  const root = await fixture(context, 'runtime-routes');
  const runtimeOverrides = {
    sourceProbe: 'inspect_main_thread_runtime',
    presentationProfile: 'runtime_mechanisms',
  };
  const runs = new Map([
    [
      'runtime-existing-a',
      run('runtime-existing-a', {
        ...runtimeOverrides,
        classification: 'runtime_filesystem',
        nextProbe: 'inspect_filesystem_runtime',
      }),
    ],
    [
      'runtime-existing-b',
      run('runtime-existing-b', {
        ...runtimeOverrides,
        classification: 'runtime_http_streams',
        nextProbe: 'inspect_http_stream_runtime',
      }),
    ],
  ]);
  const result = await stabilizeDurableBrowserProbe(
    root,
    input('runtime-route-schedule', {
      probe: 'inspect_main_thread_runtime',
      existing_recapture_ids: ['runtime-existing-a', 'runtime-existing-b'],
      max_new_runs: 1,
    }),
    dependencies(runs, {
      inspectProbe: async () => inspection('inspect_main_thread_runtime'),
    })
  );
  assert.equal(result.state, 'unstable');
  assert.equal(result.budget.new_runs_executed, 0);
  assert.equal(result.source_capture.probe, 'inspect_main_thread_runtime');
});

test('admits profiler-disabled probes without weakening early stopping', async (context) => {
  const root = await fixture(context, 'low-overhead-routes');
  const low = {
    sourceProbe: 'repeat_with_lower_overhead_cpu_measurement',
    presentationProfile: 'profiler_disabled_runtime',
    classification: 'low_overhead_gc',
    nextProbe: 'inspect_gc_pressure',
  };
  const runs = new Map([
    ['low-existing-a', run('low-existing-a', low)],
    [
      'low-existing-b',
      run('low-existing-b', {
        ...low,
        classification: 'low_overhead_unresolved',
        nextProbe: null,
      }),
    ],
  ]);
  const result = await stabilizeDurableBrowserProbe(
    root,
    input('low-overhead-route-schedule', {
      probe: 'repeat_with_lower_overhead_cpu_measurement',
      existing_recapture_ids: ['low-existing-a', 'low-existing-b'],
      max_new_runs: 1,
    }),
    dependencies(runs, {
      inspectProbe: async () => inspection('repeat_with_lower_overhead_cpu_measurement'),
    })
  );
  assert.equal(result.state, 'unstable');
  assert.equal(result.budget.new_runs_executed, 0);
});

test('GC pressure schedule forwards provenance and stops on a stable sampled source diagnosis', async (context) => {
  const root = await fixture(context, 'gc-diagnosis');
  const upstreamDirectory = join(root, '.codevetter/browser-probe-runs/lower-source');
  await mkdir(upstreamDirectory, { recursive: true });
  const upstreamBytes = '{"recapture_id":"lower-source"}\n';
  await writeFile(join(upstreamDirectory, 'receipt.json'), upstreamBytes);
  const upstream = {
    recapture_id: 'lower-source',
    receipt_sha256: createHash('sha256').update(upstreamBytes).digest('hex'),
    source_probe: 'repeat_with_lower_overhead_cpu_measurement',
    classification: 'low_overhead_gc',
    next_probe: 'inspect_gc_pressure',
    server_request_ordinal: 1,
    correctness: 'passed',
  };
  const source = {
    file: 'src/allocate.ts',
    line: 10,
    function: 'allocateRows',
    provenance: 'request_scoped_v8_sampling_heap_profile',
  };
  const gc = {
    sourceProbe: 'inspect_gc_pressure',
    presentationProfile: 'gc_pressure_runtime',
    classification: 'gc_allocation_repository',
    nextProbe: null,
    leadingSource: source,
    upstreamRecapture: upstream,
  };
  const runs = new Map([
    ['gc-existing-a', run('gc-existing-a', gc)],
    ['gc-existing-b', run('gc-existing-b', gc)],
  ]);
  let recaptureRequest = null;
  const result = await stabilizeDurableBrowserProbe(
    root,
    input('gc-diagnosis-schedule', {
      probe: 'inspect_gc_pressure',
      source_recapture_id: 'lower-source',
      existing_recapture_ids: ['gc-existing-a', 'gc-existing-b'],
      max_new_runs: 1,
    }),
    dependencies(runs, {
      inspectProbe: async () => ({
        ...inspection('inspect_gc_pressure'),
        upstream_recapture: upstream,
      }),
      recapture: async (_root, request) => {
        recaptureRequest = request;
        runs.set(request.recapture_id, run(request.recapture_id, gc));
        return completedReceipt(request.recapture_id);
      },
    })
  );
  assert.equal(recaptureRequest.source_recapture_id, 'lower-source');
  assert.equal(result.state, 'diagnosis_stable');
  assert.equal(result.terminal_reason, 'three_unanimous_passing_diagnoses');
  assert.equal(result.assessment.decision.source_inspection_eligible, true);
  assert.deepEqual(result.assessment.decision.leading_source, source);
  assert.equal(result.assessment.decision.next_probe, null);
  assert.equal(result.authority.edit_eligible, false);
});

test('GC pressure schedule persists failed upstream correctness without loading or running a probe', async (context) => {
  const root = await fixture(context, 'gc-correctness-blocked');
  const upstreamDirectory = join(root, '.codevetter/browser-probe-runs/lower-failed');
  await mkdir(upstreamDirectory, { recursive: true });
  const upstreamBytes = '{"recapture_id":"lower-failed"}\n';
  await writeFile(join(upstreamDirectory, 'receipt.json'), upstreamBytes);
  const upstream = {
    recapture_id: 'lower-failed',
    receipt_sha256: createHash('sha256').update(upstreamBytes).digest('hex'),
    source_probe: 'repeat_with_lower_overhead_cpu_measurement',
    classification: 'low_overhead_gc',
    next_probe: 'inspect_gc_pressure',
    server_request_ordinal: 1,
    correctness: 'failed',
  };
  const result = await stabilizeDurableBrowserProbe(
    root,
    input('gc-correctness-blocked-schedule', {
      probe: 'inspect_gc_pressure',
      source_recapture_id: 'lower-failed',
      existing_recapture_ids: ['gc-failed-recapture'],
      max_new_runs: 1,
    }),
    dependencies(new Map(), {
      inspectProbe: async () => ({
        ...inspection('inspect_gc_pressure'),
        state: 'correctness_blocked',
        upstream_recapture: upstream,
      }),
    })
  );
  assert.equal(result.state, 'correctness_failed');
  assert.equal(result.terminal_reason, 'included_exact_flow_failed');
  assert.equal(result.budget.new_runs_executed, 0);
  assert.equal(result.runs.length, 0);
  assert.deepEqual(result.upstream_recapture, upstream);
});

test('continuous source schedule forwards the derived lower-overhead identity', async (context) => {
  const root = await fixture(context, 'continuous-source-diagnosis');
  const upstreamDirectory = join(root, '.codevetter/browser-probe-runs/lower-unresolved');
  await mkdir(upstreamDirectory, { recursive: true });
  const upstreamBytes = '{"recapture_id":"lower-unresolved"}\n';
  await writeFile(join(upstreamDirectory, 'receipt.json'), upstreamBytes);
  const upstream = {
    recapture_id: 'lower-unresolved',
    receipt_sha256: createHash('sha256').update(upstreamBytes).digest('hex'),
    source_probe: 'repeat_with_lower_overhead_cpu_measurement',
    classification: 'low_overhead_unresolved',
    next_probe: 'inspect_continuous_main_thread_source',
    server_request_ordinal: 1,
    correctness: 'passed',
  };
  const source = {
    file: 'src/hot.ts',
    line: 20,
    function: 'hotPath',
    provenance: 'continuous_node_cpu_sample',
  };
  const continuous = {
    sourceProbe: 'inspect_continuous_main_thread_source',
    presentationProfile: 'continuous_source_runtime',
    classification: 'continuous_source_observed',
    nextProbe: null,
    leadingSource: source,
    upstreamRecapture: upstream,
  };
  const runs = new Map([
    ['source-existing-a', run('source-existing-a', continuous)],
    ['source-existing-b', run('source-existing-b', continuous)],
  ]);
  let recaptureRequest = null;
  const result = await stabilizeDurableBrowserProbe(
    root,
    input('continuous-source-schedule', {
      probe: 'inspect_continuous_main_thread_source',
      source_recapture_id: 'lower-unresolved',
      existing_recapture_ids: ['source-existing-a', 'source-existing-b'],
      max_new_runs: 1,
    }),
    dependencies(runs, {
      inspectProbe: async () => ({
        ...inspection('inspect_continuous_main_thread_source'),
        upstream_recapture: upstream,
      }),
      recapture: async (_root, request) => {
        recaptureRequest = request;
        runs.set(request.recapture_id, run(request.recapture_id, continuous));
        return completedReceipt(request.recapture_id);
      },
    })
  );
  assert.equal(recaptureRequest.source_recapture_id, 'lower-unresolved');
  assert.equal(result.state, 'diagnosis_stable');
  assert.deepEqual(result.assessment.decision.leading_source, source);
  assert.equal(
    result.assessment.decision.next_action,
    'inspect_stable_sampled_cpu_source_before_candidate_edit'
  );
  assert.equal(result.authority.edit_eligible, false);
});

test('zero, one, and two observations exhaust only the admitted budget', async (context) => {
  for (const count of [0, 1, 2]) {
    const root = await fixture(context, `budget-${count}`);
    const ids = Array.from({ length: count }, (_, index) => `existing-${index + 1}`);
    const runs = new Map(ids.map((id) => [id, run(id)]));
    const result = await stabilizeDurableBrowserProbe(
      root,
      input(`budget-${count}-schedule`, {
        existing_recapture_ids: ids,
        max_new_runs: 0,
      }),
      dependencies(runs)
    );
    assert.equal(result.state, 'budget_exhausted');
    assert.equal(result.budget.new_runs_executed, 0);
    assert.equal(result.budget.total_observations, count);
    assert.equal(result.assessment?.state ?? null, count === 2 ? 'insufficient_repetitions' : null);
  }
});

test('failed correctness stops after one completed observation', async (context) => {
  const root = await fixture(context, 'correctness');
  const runs = new Map();
  let calls = 0;
  const result = await stabilizeDurableBrowserProbe(
    root,
    input('correctness-schedule'),
    dependencies(runs, {
      recapture: async (_root, request) => {
        calls += 1;
        runs.set(request.recapture_id, run(request.recapture_id, { correctness: 'failed' }));
        return completedReceipt(request.recapture_id, { correctness: 'failed' });
      },
    })
  );
  assert.equal(result.state, 'correctness_failed');
  assert.equal(result.terminal_reason, 'included_exact_flow_failed');
  assert.equal(calls, 1);
  assert.equal(result.budget.new_runs_executed, 1);
});

test('incomplete, failed, and thrown recaptures terminate without another run', async (context) => {
  const cases = [
    {
      name: 'incomplete',
      receipt: (id) => completedReceipt(id, { outcome: 'evidence_incomplete' }),
      state: 'evidence_incomplete',
      reason: 'local_recapture_evidence_incomplete',
    },
    {
      name: 'failed',
      receipt: (id) => failedReceipt(id),
      state: 'operational_failure',
      reason: 'local_recapture_failed',
    },
    {
      name: 'thrown',
      receipt: () => {
        throw new Error('private failure');
      },
      state: 'operational_failure',
      reason: 'local_recapture_threw',
    },
  ];
  for (const item of cases) {
    const root = await fixture(context, item.name);
    let calls = 0;
    const result = await stabilizeDurableBrowserProbe(
      root,
      input(`${item.name}-schedule`),
      dependencies(new Map(), {
        recapture: async (_root, request) => {
          calls += 1;
          return item.receipt(request.recapture_id);
        },
      })
    );
    assert.equal(result.state, item.state);
    assert.equal(result.terminal_reason, item.reason);
    assert.equal(calls, 1);
    assert.equal(result.budget.new_runs_executed, 1);
    assert.equal(result.budget.total_observations, 0);
  }
});

test('a completed recapture that cannot be integrity-loaded becomes an operational failure', async (context) => {
  const root = await fixture(context, 'integrity');
  let calls = 0;
  const result = await stabilizeDurableBrowserProbe(
    root,
    input('integrity-schedule'),
    dependencies(new Map(), {
      recapture: async (_root, request) => {
        calls += 1;
        return completedReceipt(request.recapture_id);
      },
    })
  );
  assert.equal(result.state, 'operational_failure');
  assert.equal(result.terminal_reason, 'local_recapture_integrity_failed');
  assert.equal(result.budget.new_runs_executed, 1);
  assert.equal(calls, 1);
});

test('source drift before terminal persistence overrides another decision', async (context) => {
  const root = await fixture(context, 'drift');
  let currentReads = 0;
  const result = await stabilizeDurableBrowserProbe(
    root,
    input('drift-schedule', {
      existing_recapture_ids: ['existing-a', 'existing-b'],
      max_new_runs: 0,
    }),
    dependencies(
      new Map([
        ['existing-a', run('existing-a')],
        ['existing-b', run('existing-b')],
      ]),
      {
        inspectCurrent: async () => {
          currentReads += 1;
          return currentReads === 1
            ? CURRENT
            : { ...CURRENT, source_snapshot_sha256: 'b'.repeat(64) };
        },
      }
    )
  );
  assert.equal(result.state, 'stale');
  assert.equal(result.subject.current, false);
  assert.equal(result.assessment, null);
  assert.equal(result.authority.edit_eligible, false);
});

test('source receipt mutation during final validation persists only stale authority', async (context) => {
  const root = await fixture(context, 'receipt-drift');
  let currentReads = 0;
  const result = await stabilizeDurableBrowserProbe(
    root,
    input('receipt-drift-schedule', { max_new_runs: 0 }),
    dependencies(new Map(), {
      inspectCurrent: async () => {
        currentReads += 1;
        if (currentReads === 2) {
          await writeFile(
            join(root, '.codevetter/playwright-runs/source-capture/receipt.json'),
            '{"changed":true}\n'
          );
        }
        return CURRENT;
      },
    })
  );
  assert.equal(result.state, 'stale');
  assert.equal(result.subject.current, false);
  assert.equal(result.terminal_reason, 'source_changed_during_schedule');
  assert.equal(result.authority.edit_eligible, false);
});

test('invalid, incompatible, and unsafe inputs reject before execution', async (context) => {
  const root = await fixture(context, 'invalid');
  let calls = 0;
  const baseDependencies = dependencies(
    new Map([
      ['existing-a', run('existing-a')],
      ['existing-b', run('existing-b', { target: 'tests/other.spec.ts' })],
    ]),
    { recapture: async () => (calls += 1) }
  );
  await assert.rejects(
    () =>
      stabilizeDurableBrowserProbe(
        root,
        { ...input('extra-schedule'), command: 'curl production' },
        baseDependencies
      ),
    /input is invalid/
  );
  await assert.rejects(
    () =>
      stabilizeDurableBrowserProbe(
        root,
        input('duplicate-schedule', {
          existing_recapture_ids: ['existing-a', 'existing-a'],
        }),
        baseDependencies
      ),
    /unique recapture IDs/
  );
  await assert.rejects(
    () =>
      stabilizeDurableBrowserProbe(
        root,
        input('incompatible-schedule', {
          existing_recapture_ids: ['existing-a', 'existing-b'],
        }),
        baseDependencies
      ),
    /does not match|not exactly compatible/
  );
  assert.equal(calls, 0);

  const oversizedRoot = await fixture(context, 'oversized');
  await writeFile(
    join(oversizedRoot, '.codevetter/playwright-runs/source-capture/receipt.json'),
    'x'.repeat(256 * 1024 + 1)
  );
  await assert.rejects(
    () =>
      stabilizeDurableBrowserProbe(
        oversizedRoot,
        input('oversized-schedule'),
        dependencies(new Map())
      ),
    /unsafe/
  );

  const symlinkRoot = await fixture(context, 'symlink');
  const outside = await mkdtemp(join(tmpdir(), 'codevetter-schedule-outside-'));
  context.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(symlinkRoot, '.codevetter/browser-probe-stability-schedules'));
  await assert.rejects(
    () =>
      stabilizeDurableBrowserProbe(symlinkRoot, input('symlink-schedule'), dependencies(new Map())),
    /directory is unsafe/
  );
});

test('closed receipt contract rejects private fields and inconsistent budget', async (context) => {
  const root = await fixture(context, 'contract');
  const result = await stabilizeDurableBrowserProbe(
    root,
    input('contract-schedule', { max_new_runs: 0 }),
    dependencies(new Map())
  );
  for (const mutate of [
    (value) => (value.private = true),
    (value) => (value.policy.command = 'curl production'),
    (value) => (value.budget.new_runs_executed = 2),
    (value) => (value.authority.edit_eligible = true),
  ]) {
    const invalid = structuredClone(result);
    mutate(invalid);
    assert.throws(() => assertBrowserProbeStabilitySchedule(invalid), /invalid/);
  }
});

test('durable schedule loader rejects tampered, symlinked, and oversized receipts', async (context) => {
  const missingRoot = await fixture(context, 'missing-receipt');
  await assert.rejects(
    () => loadDurableBrowserProbeStabilitySchedule(missingRoot, 'missing-schedule'),
    /ENOENT/
  );

  const tamperedRoot = await fixture(context, 'tampered-receipt');
  await stabilizeDurableBrowserProbe(
    tamperedRoot,
    input('tampered-receipt-schedule', { max_new_runs: 0 }),
    dependencies(new Map())
  );
  const tamperedPath = join(
    tamperedRoot,
    '.codevetter/browser-probe-stability-schedules/tampered-receipt-schedule/receipt.json'
  );
  const tampered = JSON.parse(await readFile(tamperedPath, 'utf8'));
  tampered.private = true;
  await writeFile(tamperedPath, `${JSON.stringify(tampered)}\n`);
  await assert.rejects(
    () => loadDurableBrowserProbeStabilitySchedule(tamperedRoot, 'tampered-receipt-schedule'),
    /invalid/
  );

  const symlinkRoot = await fixture(context, 'symlink-receipt');
  await stabilizeDurableBrowserProbe(
    symlinkRoot,
    input('symlink-receipt-schedule', { max_new_runs: 0 }),
    dependencies(new Map())
  );
  const symlinkPath = join(
    symlinkRoot,
    '.codevetter/browser-probe-stability-schedules/symlink-receipt-schedule/receipt.json'
  );
  const outside = join(symlinkRoot, 'outside-receipt.json');
  await writeFile(outside, '{}\n');
  await rm(symlinkPath);
  await symlink(outside, symlinkPath);
  await assert.rejects(
    () => loadDurableBrowserProbeStabilitySchedule(symlinkRoot, 'symlink-receipt-schedule'),
    /unsafe/
  );

  const oversizedRoot = await fixture(context, 'oversized-receipt');
  await stabilizeDurableBrowserProbe(
    oversizedRoot,
    input('oversized-receipt-schedule', { max_new_runs: 0 }),
    dependencies(new Map())
  );
  const oversizedPath = join(
    oversizedRoot,
    '.codevetter/browser-probe-stability-schedules/oversized-receipt-schedule/receipt.json'
  );
  await writeFile(oversizedPath, 'x'.repeat(128 * 1024 + 1));
  await assert.rejects(
    () => loadDurableBrowserProbeStabilitySchedule(oversizedRoot, 'oversized-receipt-schedule'),
    /unsafe/
  );
});

function input(scheduleId, overrides = {}) {
  return {
    capture_id: 'source-capture',
    probe: 'complete_async_and_framework_inventories',
    schedule_id: scheduleId,
    ...overrides,
  };
}

function dependencies(runs, overrides = {}) {
  return {
    inspectProbe: overrides.inspectProbe ?? (async () => inspection()),
    inspectCurrent: overrides.inspectCurrent ?? (async () => CURRENT),
    loadRun:
      overrides.loadRun ??
      (async (_root, id) => {
        const value = runs.get(id);
        if (!value) throw new Error('missing fixture run');
        return value;
      }),
    recapture:
      overrides.recapture ??
      (async () => {
        throw new Error('unexpected recapture');
      }),
    digestProbeReceipt: overrides.digestProbeReceipt ?? (async () => 'd'.repeat(64)),
  };
}

function inspection(probe = 'complete_async_and_framework_inventories') {
  return {
    state: 'observed',
    capture_id: 'source-capture',
    subject: { ...CURRENT, current: true },
    scope: { target: 'tests/browser.spec.ts', name: 'browser flow', project: 'chromium' },
    probe: { name: probe },
    request: { ordinal: 1, method: 'GET', route: '/' },
  };
}

function run(id, overrides = {}) {
  const sourceProbe = overrides.sourceProbe ?? 'complete_async_and_framework_inventories';
  return {
    recapture_id: id,
    capture_id: id,
    subject: CURRENT,
    source_capture: {
      capture_id: 'source-capture',
      receipt_sha256: SOURCE_SHA,
      probe: sourceProbe,
      server_request_ordinal: 1,
      method: 'GET',
      route: '/',
    },
    upstream_recapture: overrides.upstreamRecapture ?? null,
    scope: {
      target: overrides.target ?? 'tests/browser.spec.ts',
      name: 'browser flow',
      project: 'chromium',
    },
    policy: {
      presentation_profile: overrides.presentationProfile ?? 'expanded_async_framework',
      remote_http_denied: true,
    },
    runtime: { family: 'next', configuration: 'codevetter_config_disabled', cleanup: 'terminated' },
    evidence_outcome: 'evidence_completed',
    correctness: overrides.correctness ?? 'passed',
    route: {
      classification: overrides.classification ?? 'main_thread_runtime',
      next_probe: Object.hasOwn(overrides, 'nextProbe')
        ? overrides.nextProbe
        : 'inspect_main_thread_runtime',
      leading_source: overrides.leadingSource ?? null,
    },
    preparation_wall_ms: 1_000,
    preparation_process_cpu_ms: 210,
    preparation_cpu_to_wall_ratio: overrides.ratio ?? 0.21,
  };
}

function completedReceipt(id, overrides = {}) {
  return {
    recapture_id: id,
    state: 'completed',
    subject: { ...CURRENT, current: true },
    new_capture: { capture_id: id, result_sha256: 'e'.repeat(64) },
    evidence: {
      outcome: overrides.outcome ?? 'evidence_completed',
      correctness: overrides.correctness ?? 'passed',
    },
  };
}

function failedReceipt(id) {
  return {
    recapture_id: id,
    state: 'failed',
    subject: { ...CURRENT, current: true },
    new_capture: null,
    evidence: { outcome: 'operational_failure', correctness: 'unknown' },
  };
}

async function fixture(context, name) {
  const root = await mkdtemp(join(tmpdir(), `codevetter-browser-schedule-${name}-`));
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, '.codevetter/playwright-runs/source-capture');
  await mkdir(directory, { recursive: true });
  await writeFile(join(root, '.codevetter/.gitignore'), '*\n');
  await writeFile(join(directory, 'receipt.json'), SOURCE_BYTES);
  return root;
}
