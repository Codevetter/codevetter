import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertLowOverheadRuntimeCorroboration,
  createLowOverheadRuntimeCorroboration,
} from './low-overhead-runtime.mjs';

test('routes every closed native mechanism above the fixed floor', () => {
  const cases = [
    ['gc', 'v8', 'inspect_gc_pressure'],
    ['compilation', 'v8', 'inspect_compilation_runtime'],
    ['crypto', 'threadpool', 'inspect_libuv_threadpool_crypto'],
    ['zlib', 'threadpool', 'inspect_libuv_threadpool_zlib'],
    ['filesystem', 'threadpool', 'inspect_libuv_threadpool_filesystem'],
    ['dns', 'threadpool', 'inspect_libuv_threadpool_dns'],
    ['network', 'threadpool', 'inspect_libuv_threadpool_network'],
    ['node_api', 'threadpool', 'inspect_libuv_threadpool_node_api'],
    ['blob', 'threadpool', 'inspect_libuv_threadpool_blob'],
    ['other', 'threadpool', 'inspect_libuv_threadpool_other'],
  ];
  for (const [kind, group, nextProbe] of cases) {
    const result = createLowOverheadRuntimeCorroboration(requestFixture({ kind, group }), {
      profilerDisabled: true,
    });
    assert.equal(result.state, 'observed');
    assert.equal(result.route.next_probe, nextProbe);
    assert.equal(result.route.source, null);
    assert.equal(result.route.edit_authority, 'none');
  }
});

test('applies the exact threshold and does not choose sub-threshold activity', () => {
  const exact = createLowOverheadRuntimeCorroboration(
    requestFixture({ kind: 'gc', group: 'v8', activityMs: 5 }),
    { profilerDisabled: true }
  );
  assert.equal(exact.route.next_probe, 'inspect_gc_pressure');

  const below = createLowOverheadRuntimeCorroboration(
    requestFixture({ kind: 'gc', group: 'v8', activityMs: 4.999 }),
    { profilerDisabled: true }
  );
  assert.equal(below.state, 'unresolved');
  assert.equal(below.route.next_probe, 'inspect_continuous_main_thread_source');

  const immaterial = createLowOverheadRuntimeCorroboration(
    requestFixture({ kind: 'gc', group: 'v8', activityMs: 8, mainThreadCpuMs: 4.999 }),
    { profilerDisabled: true }
  );
  assert.equal(immaterial.state, 'insufficient');
  assert.equal(immaterial.route.next_probe, null);
});

test('fails closed for profiler, CPU, native, overlap, and boundary gaps', () => {
  const fixture = requestFixture({ kind: 'gc', group: 'v8' });
  const cases = [
    [fixture, false],
    [{ ...fixture, cpu: { state: 'observed' } }, true],
    [{ ...fixture, worker_cpu: { state: 'observed_zero' } }, true],
    [{ ...fixture, process_cpu: { ...fixture.process_cpu, complete: false } }, true],
    [{ ...fixture, native_activity: { ...fixture.native_activity, complete: false } }, true],
    [
      {
        ...fixture,
        native_activity: { ...fixture.native_activity, overlapping_dynamic_requests: 1 },
      },
      true,
    ],
    [
      {
        ...fixture,
        native_activity: { ...fixture.native_activity, response_commit_offset_ms: 150 },
      },
      true,
    ],
  ];
  for (const [request, profilerDisabled] of cases) {
    const result = createLowOverheadRuntimeCorroboration(request, { profilerDisabled });
    assert.equal(result.state, 'incomplete');
    assert.equal(result.route.next_probe, null);
  }

  const oversized = structuredClone(fixture);
  oversized.native_activity = {
    ...oversized.native_activity,
    schema_version: 'runtime-node-request-native-activity/v2',
    state: 'incomplete',
    incomplete_reason: 'trace_oversized',
    inventory: { events_seen: 0, intervals_retained: 0, complete: false },
    threadpool: { total_count: 0, union_activity_ms: 0, mechanisms: [] },
    v8: { total_count: 0, union_activity_ms: 0, mechanisms: [] },
    complete: false,
  };
  const explained = createLowOverheadRuntimeCorroboration(oversized, {
    profilerDisabled: true,
  });
  assert.equal(explained.native.incomplete_reason, 'trace_oversized');
  assert.equal(explained.route.next_probe, null);
});

test('contract excludes raw native identity and rejects causal or private fields', () => {
  const result = createLowOverheadRuntimeCorroboration(
    requestFixture({ kind: 'gc', group: 'v8' }),
    { profilerDisabled: true }
  );
  assert.equal(assertLowOverheadRuntimeCorroboration(result), result);
  const serialized = JSON.stringify(result);
  for (const raw of ['MajorGC', 'private-secret', 'pid', 'tid', 'start_us', 'stop_us']) {
    assert.equal(serialized.includes(raw), false);
  }
  assert.throws(
    () => assertLowOverheadRuntimeCorroboration({ ...result, command: 'curl production' }),
    /invalid/
  );
  assert.throws(
    () =>
      assertLowOverheadRuntimeCorroboration({
        ...result,
        route: { ...result.route, edit_authority: 'allowed' },
      }),
    /invalid/
  );
});

function requestFixture({ kind, group, activityMs = 8, mainThreadCpuMs = 30 } = {}) {
  const otherThreadsCpuMs = 10;
  const empty = { total_count: 0, union_activity_ms: 0, mechanisms: [] };
  const mechanism = { kind, count: 2, union_activity_ms: activityMs };
  const selected = {
    total_count: 2,
    union_activity_ms: activityMs,
    mechanisms: [mechanism],
  };
  return {
    cpu: null,
    worker_cpu: null,
    response_timing: { complete: true, commit_offset_ms: 100 },
    process_cpu: {
      complete: true,
      overlapping_preparation_request_count: 0,
      preparation_cpu_ms: mainThreadCpuMs + otherThreadsCpuMs,
      thread_partition: {
        state: 'observed',
        preparation_main_thread_cpu_ms: mainThreadCpuMs,
        preparation_other_threads_cpu_ms: otherThreadsCpuMs,
      },
    },
    native_activity: {
      schema_version: 'runtime-node-request-native-activity/v1',
      state: 'observed',
      response_commit_offset_ms: 100,
      interval_ms: 100,
      overlapping_dynamic_requests: 0,
      inventory: { events_seen: 2, intervals_retained: 2, complete: true },
      threadpool: group === 'threadpool' ? selected : empty,
      v8: group === 'v8' ? selected : empty,
      complete: true,
      observer_effect: 'node_trace_events_enabled_before_handler_dispatch',
      provenance: 'bounded_request_scoped_node_trace_events',
    },
  };
}
