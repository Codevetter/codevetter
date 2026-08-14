import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BROWSER_SERVER_FLOW_PRESENTATION_PROFILES } from './browser-server-flow.mjs';
import {
  BROWSER_PROBE_RECAPTURE_SCHEMA_VERSION,
  assertBrowserProbeRecapture,
  recaptureDurableBrowserProbe,
} from './browser-probe-recapture.mjs';
import { createLowOverheadRuntimeCorroboration } from './low-overhead-runtime.mjs';

const SNAPSHOT = 'a'.repeat(64);

test('executes the exact inventory probe with expanded evidence and persists provenance', async (context) => {
  const root = await fixture(context);
  let captureInput = null;
  let stopped = false;
  const result = await recaptureDurableBrowserProbe(
    root,
    input('probe-recapture'),
    dependencies(root, {
      captureBrowser: async (value) => {
        captureInput = value;
        return captureFixture(root, value.captureId, 'succeeded');
      },
      establishRuntime: async () => runtimeFixture(() => (stopped = true)),
    })
  );

  assert.equal(result.schema_version, BROWSER_PROBE_RECAPTURE_SCHEMA_VERSION);
  assert.equal(result.state, 'completed');
  assert.equal(result.evidence.outcome, 'evidence_completed');
  assert.equal(result.evidence.correctness, 'passed');
  assert.equal(stopped, true);
  assert.equal(
    captureInput.serverPresentationProfile,
    BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.expandedAsyncFramework
  );
  assert.equal(captureInput.candidateId, 'exact-candidate');
  assert.equal(captureInput.loadServerFlow instanceof Function, true);
  assert.match(result.source_capture.receipt_sha256, /^[0-9a-f]{64}$/);
  assert.match(result.new_capture.receipt_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(root, '.codevetter/browser-probe-runs/probe-recapture/receipt.json'),
        'utf8'
      )
    ),
    result
  );
});

test('reports complete evidence independently from failed Playwright correctness', async (context) => {
  const root = await fixture(context);
  const result = await recaptureDurableBrowserProbe(
    root,
    input('failed-flow-recapture'),
    dependencies(root, {
      captureBrowser: (value) => captureFixture(root, value.captureId, 'failed'),
    })
  );
  assert.equal(result.state, 'completed');
  assert.equal(result.evidence.outcome, 'evidence_completed');
  assert.equal(result.evidence.correctness, 'failed');
  assert.equal(result.authority.edit_eligible, false);
  assert.equal(result.authority.correctness_required, true);
});

test('executes the main-thread runtime probe and keeps mechanism evidence separate', async (context) => {
  const root = await fixture(context, 'runtime');
  let captureInput = null;
  const runtimeInput = {
    capture_id: 'prior-capture',
    probe: 'inspect_main_thread_runtime',
    recapture_id: 'runtime-recapture',
    timeout_ms: 10_000,
  };
  const result = await recaptureDurableBrowserProbe(
    root,
    runtimeInput,
    dependencies(root, {
      inspectProbe: async () => inspectionFixture({ probe: 'inspect_main_thread_runtime' }),
      captureBrowser: async (value) => {
        captureInput = value;
        return captureFixture(root, value.captureId, 'succeeded');
      },
      loadCaptureResult: async () => runtimeResultFixture(),
    })
  );
  assert.equal(
    captureInput.serverPresentationProfile,
    BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.runtimeMechanisms
  );
  assert.equal(result.source_capture.probe, 'inspect_main_thread_runtime');
  assert.equal(result.evidence.outcome, 'evidence_completed');
  assert.equal(result.evidence.async_inventory, null);
  assert.equal(result.evidence.framework_inventory, null);
  assert.deepEqual(result.evidence.runtime_mechanism_inventory.mechanisms, [
    {
      mechanism: 'filesystem',
      samples: 10,
      self_time_ms: 10,
      runtime_sample_share: 1,
    },
  ]);
  assert.equal(result.authority.edit_eligible, false);
});

test('main-thread recapture reuses the clean-snapshot runtime fallback and finalizes it', async (context) => {
  const root = await fixture(context, 'runtime');
  const cleanExecution = { finalize: async () => ({ state: 'removed' }) };
  let starts = 0;
  let captureInput = null;
  let finalized = 0;
  cleanExecution.finalize = async () => {
    finalized += 1;
    return { state: 'removed' };
  };
  const result = await recaptureDurableBrowserProbe(
    root,
    {
      capture_id: 'prior-capture',
      probe: 'inspect_main_thread_runtime',
      recapture_id: 'clean-runtime-recapture',
      timeout_ms: 10_000,
    },
    dependencies(root, {
      inspectProbe: async () => inspectionFixture({ probe: 'inspect_main_thread_runtime' }),
      qualify: async () => ({
        ...qualificationFixture([candidateFixture()]),
        subject: {
          ...qualificationFixture([]).subject,
          dirty: false,
        },
      }),
      createBrowserExecution: async () => cleanExecution,
      establishRuntime: async (input) => {
        starts += 1;
        if (starts === 1) {
          return {
            ready: false,
            summary: { state: 'environment_blocked', cleanup: 'not_started' },
          };
        }
        assert.equal(input.executionContext, cleanExecution);
        return runtimeFixture();
      },
      captureBrowser: async (input) => {
        captureInput = input;
        assert.equal(typeof input.prepareServerFlow, 'function');
        return captureFixture(root, input.captureId, 'succeeded');
      },
      loadCaptureResult: async () => runtimeResultFixture(),
    })
  );

  assert.equal(result.state, 'completed');
  assert.equal(starts, 2);
  assert.equal(captureInput.executionContext, cleanExecution);
  assert.equal(finalized, 1);
});

test('executes the profiler-disabled follow-up with independent corroboration', async (context) => {
  const root = await fixture(context, 'low-overhead');
  let runtimeInput = null;
  let captureInput = null;
  const result = await recaptureDurableBrowserProbe(
    root,
    {
      capture_id: 'prior-capture',
      probe: 'repeat_with_lower_overhead_cpu_measurement',
      recapture_id: 'low-overhead-recapture',
      timeout_ms: 10_000,
    },
    dependencies(root, {
      inspectProbe: async () =>
        inspectionFixture({ probe: 'repeat_with_lower_overhead_cpu_measurement' }),
      establishRuntime: async (value) => {
        runtimeInput = value;
        return runtimeFixture();
      },
      captureBrowser: async (value) => {
        captureInput = value;
        return captureFixture(root, value.captureId, 'succeeded');
      },
      loadCaptureResult: async () => lowOverheadResultFixture(),
    })
  );
  assert.equal(runtimeInput.diagnosticProfile, 'profiler_disabled_runtime');
  assert.equal(
    captureInput.serverPresentationProfile,
    BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.profilerDisabledRuntime
  );
  assert.equal(result.policy.diagnostic_profile, 'profiler_disabled_runtime');
  assert.equal(result.evidence.outcome, 'evidence_completed');
  assert.equal(result.evidence.runtime_mechanism_inventory, null);
  assert.equal(result.evidence.low_overhead_runtime.profiler.main_thread, 'disabled_by_probe');
  assert.equal(result.evidence.low_overhead_runtime.route.next_probe, 'inspect_gc_pressure');
  assert.equal(result.authority.edit_eligible, false);
});

test('executes profiler-disabled follow-up from an integrity-bound runtime recapture', async (context) => {
  const root = await fixture(context, 'low-overhead-chained');
  const upstreamDirectory = join(root, '.codevetter/browser-probe-runs/runtime-run');
  await mkdir(upstreamDirectory, { recursive: true });
  const upstreamBytes = '{"recapture_id":"runtime-run"}\n';
  await writeFile(join(upstreamDirectory, 'receipt.json'), upstreamBytes);
  const upstream = {
    recapture_id: 'runtime-run',
    receipt_sha256: createHash('sha256').update(upstreamBytes).digest('hex'),
    source_probe: 'inspect_main_thread_runtime',
    classification: 'observer_effect',
    next_probe: 'repeat_with_lower_overhead_cpu_measurement',
    server_request_ordinal: 1,
    correctness: 'passed',
  };
  const result = await recaptureDurableBrowserProbe(
    root,
    {
      capture_id: 'prior-capture',
      probe: 'repeat_with_lower_overhead_cpu_measurement',
      source_recapture_id: 'runtime-run',
      recapture_id: 'low-overhead-chained-recapture',
      timeout_ms: 10_000,
    },
    dependencies(root, {
      inspectProbe: async () =>
        inspectionFixture({
          probe: 'repeat_with_lower_overhead_cpu_measurement',
          upstream_recapture: upstream,
        }),
      establishRuntime: async () => runtimeFixture(),
      captureBrowser: async (value) => captureFixture(root, value.captureId, 'succeeded'),
      loadCaptureResult: async () => lowOverheadResultFixture(),
    })
  );
  assert.deepEqual(result.upstream_recapture, upstream);
  assert.equal(result.evidence.outcome, 'evidence_completed');
  assert.equal(result.authority.edit_eligible, false);
});

test('executes chained GC pressure capture with owned sampling and retained upstream provenance', async (context) => {
  const root = await fixture(context, 'gc-pressure');
  const upstreamDirectory = join(root, '.codevetter/browser-probe-runs/lower-run');
  await mkdir(upstreamDirectory, { recursive: true });
  const upstreamBytes = '{"recapture_id":"lower-run"}\n';
  await writeFile(join(upstreamDirectory, 'receipt.json'), upstreamBytes);
  const upstream = {
    recapture_id: 'lower-run',
    receipt_sha256: createHash('sha256').update(upstreamBytes).digest('hex'),
    source_probe: 'repeat_with_lower_overhead_cpu_measurement',
    classification: 'low_overhead_gc',
    next_probe: 'inspect_gc_pressure',
    server_request_ordinal: 1,
    correctness: 'passed',
  };
  let runtimeInput = null;
  let captureInput = null;
  const result = await recaptureDurableBrowserProbe(
    root,
    {
      capture_id: 'prior-capture',
      probe: 'inspect_gc_pressure',
      source_recapture_id: 'lower-run',
      recapture_id: 'gc-recapture',
      timeout_ms: 10_000,
    },
    dependencies(root, {
      inspectProbe: async () =>
        inspectionFixture({ probe: 'inspect_gc_pressure', upstream_recapture: upstream }),
      establishRuntime: async (value) => {
        runtimeInput = value;
        return runtimeFixture();
      },
      captureBrowser: async (value) => {
        captureInput = value;
        return captureFixture(root, value.captureId, 'succeeded');
      },
      loadCaptureResult: async () => gcPressureResultFixture(),
    })
  );
  assert.equal(runtimeInput.diagnosticProfile, 'gc_pressure_runtime');
  assert.equal(
    captureInput.serverPresentationProfile,
    BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.gcPressureRuntime
  );
  assert.deepEqual(result.upstream_recapture, upstream);
  assert.equal(result.evidence.outcome, 'evidence_completed');
  assert.equal(result.evidence.gc_pressure.state, 'observed');
  assert.equal(result.evidence.gc_pressure.route.source_inspection_eligible, true);
  assert.equal(result.authority.edit_eligible, false);
});

test('GC pressure requires an upstream identity and correctness before runtime execution', async (context) => {
  const root = await fixture(context, 'gc-blocked');
  await assert.rejects(
    recaptureDurableBrowserProbe(
      root,
      {
        capture_id: 'prior-capture',
        probe: 'inspect_gc_pressure',
        recapture_id: 'gc-without-upstream',
      },
      dependencies(root)
    ),
    /requires exactly one upstream/
  );
  let runtimeStarted = false;
  const upstreamDirectory = join(root, '.codevetter/browser-probe-runs/lower-failed');
  await mkdir(upstreamDirectory, { recursive: true });
  const bytes = '{"recapture_id":"lower-failed"}\n';
  await writeFile(join(upstreamDirectory, 'receipt.json'), bytes);
  const blocked = await recaptureDurableBrowserProbe(
    root,
    {
      capture_id: 'prior-capture',
      probe: 'inspect_gc_pressure',
      source_recapture_id: 'lower-failed',
      recapture_id: 'gc-correctness-blocked',
    },
    dependencies(root, {
      inspectProbe: async () => ({
        ...inspectionFixture({
          probe: 'inspect_gc_pressure',
          state: 'correctness_blocked',
          upstream_recapture: {
            recapture_id: 'lower-failed',
            receipt_sha256: createHash('sha256').update(bytes).digest('hex'),
            source_probe: 'repeat_with_lower_overhead_cpu_measurement',
            classification: 'low_overhead_gc',
            next_probe: 'inspect_gc_pressure',
            server_request_ordinal: 1,
            correctness: 'failed',
          },
        }),
      }),
      establishRuntime: async () => {
        runtimeStarted = true;
        return runtimeFixture();
      },
    })
  );
  assert.equal(blocked.state, 'failed');
  assert.equal(blocked.evidence.outcome, 'not_executed');
  assert.equal(runtimeStarted, false);
});

test('executes continuous startup source capture only from unresolved lower-overhead evidence', async (context) => {
  const root = await fixture(context, 'continuous-source');
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
  let runtimeInput = null;
  let captureInput = null;
  let prepareCalls = 0;
  const result = await recaptureDurableBrowserProbe(
    root,
    {
      capture_id: 'prior-capture',
      probe: 'inspect_continuous_main_thread_source',
      source_recapture_id: 'lower-unresolved',
      recapture_id: 'continuous-source-recapture',
      timeout_ms: 10_000,
    },
    dependencies(root, {
      inspectProbe: async () =>
        inspectionFixture({
          probe: 'inspect_continuous_main_thread_source',
          upstream_recapture: upstream,
        }),
      establishRuntime: async (value) => {
        runtimeInput = value;
        return runtimeFixture(null, 'terminated', () => {
          prepareCalls += 1;
        });
      },
      captureBrowser: async (value) => {
        captureInput = value;
        return captureFixture(root, value.captureId, 'succeeded');
      },
      loadCaptureResult: async () => continuousSourceResultFixture(),
    })
  );

  assert.equal(runtimeInput.diagnosticProfile, 'continuous_source_runtime');
  assert.deepEqual(runtimeInput.diagnosticTarget, { ordinal: 1, method: 'GET', route: '/' });
  assert.equal(prepareCalls, 1);
  assert.equal(
    captureInput.serverPresentationProfile,
    BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.continuousSourceRuntime
  );
  assert.deepEqual(result.upstream_recapture, upstream);
  assert.equal(result.evidence.outcome, 'evidence_completed');
  assert.equal(result.evidence.continuous_source.state, 'observed');
  assert.equal(result.evidence.continuous_source.candidates[0].source.file, 'src/hot.ts');
  assert.equal(result.authority.edit_eligible, false);
});

test('expanded recapture remains explicitly incomplete above its fixed cap', async (context) => {
  const root = await fixture(context);
  const result = await recaptureDurableBrowserProbe(
    root,
    input('incomplete-recapture'),
    dependencies(root, {
      loadCaptureResult: async () => resultFixture({ total: 40, retained: 32, complete: false }),
    })
  );
  assert.equal(result.evidence.outcome, 'evidence_incomplete');
  assert.deepEqual(result.evidence.async_inventory, { total: 40, retained: 32, complete: false });
});

test('stale source and ambiguous scope stop before runtime execution', async (context) => {
  const staleRoot = await fixture(context, 'stale');
  let started = false;
  const stale = await recaptureDurableBrowserProbe(
    staleRoot,
    input('stale-recapture'),
    dependencies(staleRoot, {
      inspectProbe: async () =>
        inspectionFixture({ current: false, state: 'stale_source_snapshot' }),
      establishRuntime: async () => {
        started = true;
        return runtimeFixture();
      },
    })
  );
  assert.equal(stale.state, 'stale');
  assert.equal(stale.subject.current, false);
  assert.equal(started, false);

  const driftRoot = await fixture(context, 'qualification-drift');
  const drift = await recaptureDurableBrowserProbe(
    driftRoot,
    input('qualification-drift-recapture'),
    dependencies(driftRoot, {
      qualify: async () => ({
        ...qualificationFixture([candidateFixture()]),
        subject: {
          repository_revision: 'fixture-revision',
          source_snapshot_sha256: 'd'.repeat(64),
        },
      }),
    })
  );
  assert.equal(drift.state, 'stale');
  assert.equal(drift.subject.current, false);

  const ambiguousRoot = await fixture(context, 'ambiguous');
  const ambiguous = await recaptureDurableBrowserProbe(
    ambiguousRoot,
    input('ambiguous-recapture'),
    dependencies(ambiguousRoot, {
      qualify: async () => qualificationFixture([candidateFixture(), candidateFixture('other')]),
      establishRuntime: async () => {
        started = true;
        return runtimeFixture();
      },
    })
  );
  assert.equal(ambiguous.state, 'failed');
  assert.match(ambiguous.failure, /one exact qualified flow/);
  assert.equal(started, false);
});

test('runtime startup and timeout-shaped failures persist without invoking capture', async (context) => {
  const root = await fixture(context, 'runtime-failure');
  let captured = false;
  const result = await recaptureDurableBrowserProbe(
    root,
    input('runtime-failure-recapture'),
    dependencies(root, {
      establishRuntime: async () => ({
        ready: false,
        summary: {
          state: 'startup_failed',
          ownership: 'owned',
          family: 'next',
          configuration: 'codevetter_config_disabled',
          cleanup: 'force_terminated',
        },
      }),
      captureBrowser: async () => {
        captured = true;
      },
    })
  );
  assert.equal(result.state, 'failed');
  assert.equal(result.evidence.outcome, 'not_executed');
  assert.equal(result.runtime.state, 'startup_failed');
  assert.equal(captured, false);
});

test('probe mismatch, unsupported probes, and duplicate IDs reject before execution', async (context) => {
  const root = await fixture(context);
  let started = false;
  const deps = dependencies(root, {
    establishRuntime: async () => {
      started = true;
      return runtimeFixture();
    },
  });
  await assert.rejects(
    () =>
      recaptureDurableBrowserProbe(root, input('mismatch-recapture'), {
        ...deps,
        inspectProbe: async () => {
          throw new Error('requested probe does not match the durable browser diagnosis');
        },
      }),
    /does not match/
  );
  await assert.rejects(
    () =>
      recaptureDurableBrowserProbe(
        root,
        { ...input('unsupported-recapture'), probe: 'inspect_main_thread_repository' },
        {
          ...deps,
          inspectProbe: async () => inspectionFixture({ probe: 'inspect_main_thread_repository' }),
        }
      ),
    /not executable/
  );
  await assert.rejects(
    () =>
      recaptureDurableBrowserProbe(root, {
        ...input('prior-capture'),
        recapture_id: 'prior-capture',
      }),
    /requires a new ID/
  );
  assert.equal(started, false);
});

test('capture and cleanup failures stay bounded and edit-ineligible', async (context) => {
  const captureRoot = await fixture(context, 'capture-error');
  const captureFailure = await recaptureDurableBrowserProbe(
    captureRoot,
    input('capture-error-recapture'),
    dependencies(captureRoot, {
      captureBrowser: async () => {
        throw new Error(`${captureRoot}/private/capture failed`);
      },
    })
  );
  assert.equal(captureFailure.state, 'failed');
  assert.equal(captureFailure.evidence.outcome, 'operational_failure');
  assert.equal(
    JSON.stringify(captureFailure).includes(captureRoot),
    false,
    JSON.stringify(captureFailure)
  );

  const cleanupRoot = await fixture(context, 'cleanup-error');
  const cleanupFailure = await recaptureDurableBrowserProbe(
    cleanupRoot,
    input('cleanup-error-recapture'),
    dependencies(cleanupRoot, {
      establishRuntime: async () => runtimeFixture(null, 'failed'),
    })
  );
  assert.equal(cleanupFailure.state, 'failed');
  assert.match(cleanupFailure.failure, /cleanup failed/);
  assert.equal(cleanupFailure.authority.edit_eligible, false);
});

test('source receipt mutation during execution invalidates the recapture', async (context) => {
  const root = await fixture(context, 'receipt-drift');
  let stopped = false;
  await assert.rejects(
    () =>
      recaptureDurableBrowserProbe(
        root,
        input('receipt-drift-recapture'),
        dependencies(root, {
          establishRuntime: async () => runtimeFixture(() => (stopped = true)),
          captureBrowser: async (value) => {
            await writeFile(
              join(root, '.codevetter/playwright-runs/prior-capture/receipt.json'),
              '{"capture_id":"changed"}\n'
            );
            return captureFixture(root, value.captureId, 'succeeded');
          },
        })
      ),
    /source receipt changed during recapture/
  );
  assert.equal(stopped, true);
});

test('public receipt contract rejects private and causal authority fields', () => {
  const value = receiptFixture();
  assert.equal(assertBrowserProbeRecapture(value), value);
  assert.throws(
    () => assertBrowserProbeRecapture({ ...value, command: 'curl production' }),
    /invalid/
  );
  assert.throws(
    () =>
      assertBrowserProbeRecapture({
        ...value,
        authority: { ...value.authority, edit_eligible: true },
      }),
    /invalid/
  );
});

test('reloads immediate v4 recapture and v2 lower-overhead evidence without fabrication', () => {
  const v4 = structuredClone(receiptFixture());
  v4.schema_version = 'runtime-browser-probe-recapture/v4';
  delete v4.evidence.continuous_source;
  assert.equal(assertBrowserProbeRecapture(v4), v4);

  const lower = lowOverheadResultFixture().server.requests[0];
  const v2Corroboration = structuredClone(
    // Exercise a mechanism route whose v2 and v3 semantics are identical.
    createLowOverheadRuntimeCorroboration(lower, { profilerDisabled: true })
  );
  v2Corroboration.schema_version = 'runtime-node-low-overhead-corroboration/v2';
  const current = structuredClone(receiptFixture());
  current.source_capture.probe = 'repeat_with_lower_overhead_cpu_measurement';
  current.policy.presentation_profile = 'profiler_disabled_runtime';
  current.policy.diagnostic_profile = 'profiler_disabled_runtime';
  current.evidence.async_inventory = null;
  current.evidence.framework_inventory = null;
  current.evidence.low_overhead_runtime = v2Corroboration;
  assert.equal(assertBrowserProbeRecapture(current), current);
});

function dependencies(root, overrides = {}) {
  return {
    inspectProbe: async () => inspectionFixture(),
    qualify: async () => qualificationFixture([candidateFixture()]),
    establishRuntime: async () => runtimeFixture(),
    captureBrowser: (value) => captureFixture(root, value.captureId, 'succeeded'),
    loadCaptureResult: async () => resultFixture(),
    ...overrides,
  };
}

function input(recaptureId) {
  return {
    capture_id: 'prior-capture',
    probe: 'complete_async_and_framework_inventories',
    recapture_id: recaptureId,
    timeout_ms: 10_000,
  };
}

function inspectionFixture(overrides = {}) {
  const probe = overrides.probe ?? 'complete_async_and_framework_inventories';
  const runtime = probe === 'inspect_main_thread_runtime';
  const lower = probe === 'repeat_with_lower_overhead_cpu_measurement';
  const gc = probe === 'inspect_gc_pressure';
  const continuous = probe === 'inspect_continuous_main_thread_source';
  return {
    schema_version: 'runtime-browser-probe-inspection/v1',
    state: overrides.state ?? 'observed',
    capture_id: 'prior-capture',
    upstream_recapture: overrides.upstream_recapture ?? null,
    subject: {
      repository_revision: 'fixture-revision',
      source_snapshot_sha256: SNAPSHOT,
      current: overrides.current ?? true,
    },
    scope: { target: 'tests/browser.spec.ts', name: 'browser flow', project: 'chromium' },
    probe: {
      classification: 'insufficient_evidence',
      name: probe,
      family: continuous
        ? 'continuous_main_thread_source'
        : gc
          ? 'gc_pressure'
          : lower
            ? 'low_overhead_runtime'
            : runtime
              ? 'main_thread'
              : 'evidence_gap',
      mechanism: continuous
        ? 'startup_sampling'
        : gc
          ? 'allocation_sampling'
          : lower
            ? 'profiler_disabled'
            : runtime
              ? 'runtime'
              : 'async_and_framework_inventories',
      required_observation: 'complete inventories',
    },
    request: {
      ordinal: 1,
      method: 'GET',
      route: '/',
      status: 200,
      outcome: 'ok',
      duration_ms: 100,
      source: null,
      response_timing: {},
      process_cpu: {},
      worker_cpu: null,
      native_activity: null,
      continuous_source: null,
      runtime_mechanisms: null,
      runtime_route: null,
    },
    source_inventory: { total: 0, retained: 0, complete: true },
    source_candidates: [],
    next_action: 'recapture_same_exact_flow_with_complete_async_and_framework_inventories',
    authority: {
      confidence: 'low',
      source_causal: false,
      edit_eligible: false,
      correctness_required: true,
    },
    provenance: 'integrity_checked_durable_playwright_probe_projection',
    limitations: [],
  };
}

function continuousSourceResultFixture() {
  return {
    server: {
      requests: [
        {
          ordinal: 1,
          method: 'GET',
          route: '/',
          continuous_source: {
            schema_version: 'runtime-node-continuous-source-profile/v1',
            state: 'observed',
            incomplete_reason: null,
            target: { ordinal: 1, method: 'GET', route: '/' },
            startup_attested: true,
            interval: {
              response_commit_offset_ms: 20,
              stop_tail_ms: 2,
              sampling_interval_us: 1_000,
              boundary_uncertainty_ms: 3,
              profile_duration_ms: 32,
              request_start_position_ms: 10,
              commit_position_ms: 30,
            },
            overlapping_dynamic_requests: 0,
            overlapping_precommit_dynamic_requests: 0,
            total_samples: 20,
            sampled_time_ms: 20,
            non_idle_sampled_time_ms: 20,
            sample_scope: {
              repository: 20,
              dependency: 0,
              generated: 0,
              runtime: 0,
              idle: 0,
              unresolved: 0,
            },
            sample_scope_time_ms: {
              repository: 20,
              dependency: 0,
              generated: 0,
              runtime: 0,
              idle: 0,
              unresolved: 0,
            },
            candidates: [
              {
                source: {
                  file: 'src/hot.ts',
                  line: 10,
                  function: 'hot',
                  provenance: 'continuous_node_cpu_sample',
                },
                samples: 20,
                self_time_ms: 20,
                non_idle_sample_share: 1,
              },
            ],
            complete: true,
            observer_effect: 'continuous_v8_sampling_from_owned_runtime_startup',
            authority: {
              confidence: 'low',
              source_causal: false,
              edit_eligible: false,
              optimization_eligible: false,
              production_representative: false,
            },
          },
        },
      ],
    },
  };
}

function gcPressureResultFixture() {
  return {
    server: {
      requests: [
        {
          ordinal: 1,
          method: 'GET',
          route: '/',
          response_timing: { complete: true, commit_offset_ms: 100 },
          gc_pressure: gcPressureFixture(),
        },
      ],
    },
  };
}

function gcPressureFixture() {
  const source = {
    file: 'src/allocate.ts',
    line: 10,
    function: 'allocateRows',
    provenance: 'request_scoped_v8_sampling_heap_profile',
  };
  const heap = {
    rss_bytes: 10_000,
    heap_total_bytes: 5_000,
    heap_used_bytes: 2_000,
    external_bytes: 200,
    array_buffers_bytes: 100,
  };
  return {
    schema_version: 'runtime-node-request-gc-pressure/v1',
    state: 'observed',
    interval: {
      response_commit_offset_ms: 100,
      overlapping_dynamic_requests: 0,
      complete: true,
    },
    gc: {
      total_interval_count: 2,
      union_activity_ms: 8,
      longest_interval_ms: 5,
      kinds: [
        {
          kind: 'minor',
          interval_count: 2,
          union_activity_ms: 8,
          longest_interval_ms: 5,
        },
      ],
      complete: true,
    },
    heap: {
      before: { ...heap, heap_used_bytes: 1_000 },
      commit: heap,
      delta: {
        rss_bytes: 0,
        heap_total_bytes: 0,
        heap_used_bytes: 1_000,
        external_bytes: 0,
        array_buffers_bytes: 0,
      },
      complete: true,
    },
    allocations: {
      sampling_interval_bytes: 8_192,
      collection_scope: 'includes_objects_collected_by_minor_and_major_gc',
      profile_samples: 10,
      sampled_bytes: 131_072,
      application_sampled_bytes: 131_072,
      inventory: { total: 1, retained: 1, complete: true },
      candidates: [
        {
          source,
          sampled_bytes: 131_072,
          sample_share: 1,
          application_function_share: 1,
        },
      ],
      complete: true,
    },
    route: {
      classification: 'gc_allocation_repository',
      dominant_gc_kind: 'minor',
      observed_union_activity_ms: 8,
      leading_source: source,
      source_inspection_eligible: true,
      edit_eligible: false,
      confidence: 'low',
    },
    complete: true,
    provenance: 'request_scoped_node_trace_heap_observation_and_v8_allocation_sampling',
    limitations: [
      'GC trace values are elapsed union activity, not exact or exclusive CPU.',
      'Heap deltas are process observations and allocation samples are neither exact allocated bytes nor retained bytes.',
      'A sampled repository callsite is non-causal, low-confidence, source-inspection evidence and never edit authority.',
    ],
  };
}

function qualificationFixture(flows) {
  return {
    subject: { repository_revision: 'fixture-revision', source_snapshot_sha256: SNAPSHOT },
    flows,
  };
}

function candidateFixture(id = 'exact-candidate') {
  return {
    id,
    adapter: 'playwright',
    target: 'tests/browser.spec.ts',
    name: 'browser flow',
    browser_profile: { project_name: 'chromium' },
  };
}

function runtimeFixture(onStop = null, cleanup = 'terminated', onPrepare = null) {
  const summary = {
    state: 'owned_attested',
    ownership: 'owned',
    family: 'next',
    configuration: 'codevetter_config_disabled',
    cleanup: 'pending',
    preflight: null,
  };
  return {
    ready: true,
    baseUrl: 'http://127.0.0.1:4173',
    summary,
    prepareDiagnostic: async () => {
      onPrepare?.();
      return 'continuous_source_armed';
    },
    prepareServerFlow: async () => 'terminated',
    collectServerFlow: async () => ({ state: 'observed', events: [], complete: true }),
    async stop() {
      onStop?.();
      return { ...summary, cleanup };
    },
  };
}

async function captureFixture(root, captureId, state) {
  const directory = join(root, '.codevetter/playwright-runs', captureId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'receipt.json'),
    `${JSON.stringify({ capture_id: captureId })}\n`
  );
  return {
    capture_id: captureId,
    state,
    result: {
      path: `.codevetter/playwright-runs/${captureId}/result.json`,
      sha256: 'b'.repeat(64),
      bytes: 100,
    },
  };
}

function resultFixture(asyncInventory = { total: 12, retained: 12, complete: true }) {
  return {
    server: {
      requests: [
        {
          ordinal: 1,
          method: 'GET',
          route: '/',
          cpu: null,
          worker_cpu: null,
          async_resource_inventory: asyncInventory,
          framework_phase_inventory: { total: 3, retained: 3, complete: true },
        },
      ],
    },
  };
}

function runtimeResultFixture() {
  return {
    server: {
      requests: [
        {
          ordinal: 1,
          method: 'GET',
          route: '/',
          cpu: {
            runtime_mechanisms: {
              state: 'observed',
              request: {},
              precommit: {
                total_samples: 10,
                sampled_time_ms: 10,
                mechanisms: [
                  {
                    mechanism: 'filesystem',
                    samples: 10,
                    self_time_ms: 10,
                    runtime_sample_share: 1,
                  },
                ],
                complete: true,
              },
              complete: true,
            },
          },
        },
      ],
    },
  };
}

function lowOverheadResultFixture() {
  return {
    server: {
      requests: [
        {
          ordinal: 1,
          method: 'GET',
          route: '/',
          cpu: null,
          worker_cpu: null,
          response_timing: { complete: true, commit_offset_ms: 100 },
          process_cpu: {
            complete: true,
            overlapping_preparation_request_count: 0,
            preparation_cpu_ms: 40,
            thread_partition: {
              state: 'observed',
              preparation_main_thread_cpu_ms: 30,
              preparation_other_threads_cpu_ms: 10,
            },
          },
          native_activity: nativeActivityFixture(),
        },
      ],
    },
  };
}

function nativeActivityFixture() {
  return {
    schema_version: 'runtime-node-request-native-activity/v1',
    state: 'observed',
    response_commit_offset_ms: 100,
    interval_ms: 100,
    overlapping_dynamic_requests: 0,
    inventory: { events_seen: 2, intervals_retained: 2, complete: true },
    threadpool: { total_count: 0, union_activity_ms: 0, mechanisms: [] },
    v8: {
      total_count: 2,
      union_activity_ms: 8,
      mechanisms: [{ kind: 'gc', count: 2, union_activity_ms: 8 }],
    },
    complete: true,
    observer_effect: 'node_trace_events_enabled_before_handler_dispatch',
    provenance: 'bounded_request_scoped_node_trace_events',
  };
}

async function fixture(context, suffix = 'base') {
  const root = await mkdtemp(join(tmpdir(), `codevetter-probe-recapture-${suffix}-`));
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, '.codevetter/playwright-runs/prior-capture');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'receipt.json'), '{"capture_id":"prior-capture"}\n');
  return root;
}

function receiptFixture() {
  return {
    schema_version: BROWSER_PROBE_RECAPTURE_SCHEMA_VERSION,
    recapture_id: 'probe-recapture',
    state: 'completed',
    subject: {
      repository_revision: 'fixture-revision',
      source_snapshot_sha256: SNAPSHOT,
      current: true,
    },
    source_capture: {
      capture_id: 'prior-capture',
      receipt_sha256: 'a'.repeat(64),
      probe: 'complete_async_and_framework_inventories',
      server_request_ordinal: 1,
      method: 'GET',
      route: '/',
    },
    upstream_recapture: null,
    scope: { target: 'tests/browser.spec.ts', name: 'browser flow', project: 'chromium' },
    policy: {
      timeout_ms: 10_000,
      presentation_profile: 'expanded_async_framework',
      diagnostic_profile: 'standard',
      remote_http_denied: true,
    },
    new_capture: {
      capture_id: 'probe-recapture',
      state: 'succeeded',
      receipt_path: '.codevetter/playwright-runs/probe-recapture/receipt.json',
      receipt_sha256: 'b'.repeat(64),
      result_path: '.codevetter/playwright-runs/probe-recapture/result.json',
      result_sha256: 'c'.repeat(64),
    },
    evidence: {
      outcome: 'evidence_completed',
      correctness: 'passed',
      server_request_ordinal: 1,
      async_inventory: { total: 12, retained: 12, complete: true },
      framework_inventory: { total: 3, retained: 3, complete: true },
      runtime_mechanism_inventory: null,
      low_overhead_runtime: null,
      gc_pressure: null,
      continuous_source: null,
    },
    runtime: {
      state: 'owned_attested',
      ownership: 'owned',
      family: 'next',
      configuration: 'codevetter_config_disabled',
      cleanup: 'terminated',
    },
    authority: {
      confidence: 'low',
      source_causal: false,
      edit_eligible: false,
      correctness_required: true,
    },
    failure: null,
    provenance: 'durable_browser_probe_owned_local_recapture',
    limitations: [],
  };
}
