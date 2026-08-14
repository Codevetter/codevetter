import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_PROBE_INSPECTION_SCHEMA_VERSION,
  assertBrowserProbeInspection,
  createBrowserProbeInspection,
} from './browser-probe-inspection.mjs';

const SNAPSHOT = 'a'.repeat(64);

test('projects repository main-thread and Worker samples from one exact request', () => {
  const main = inspection('inspect_main_thread_repository', {
    family: 'main_thread',
    mechanism: 'repository',
  });
  assert.equal(main.schema_version, BROWSER_PROBE_INSPECTION_SCHEMA_VERSION);
  assert.deepEqual(main.source_candidates, [
    candidate('src/route.ts', 'main_thread_cpu_sample', 'repository', 18),
  ]);

  const worker = inspection('inspect_worker_thread_repository', {
    family: 'worker_thread',
    mechanism: 'repository',
  });
  assert.deepEqual(worker.source_candidates, [
    candidate('src/worker.ts', 'worker_cpu_sample', 'repository', 11),
  ]);
});

test('does not turn dependency or runtime CPU classifications into repository candidates', () => {
  for (const [probe, family] of [
    ['inspect_main_thread_dependency', { family: 'main_thread', mechanism: 'dependency' }],
    ['inspect_worker_thread_runtime', { family: 'worker_thread', mechanism: 'runtime' }],
  ]) {
    const result = inspection(probe, family);
    assert.deepEqual(result.source_candidates, []);
    assert.equal(result.authority.edit_eligible, false);
  }
});

test('projects a bounded runtime mechanism route without source or edit authority', () => {
  const result = createBrowserProbeInspection({
    receipt: {
      capture_id: 'browser-probe-fixture',
      subject: { repository_revision: 'fixture-revision', source_snapshot_sha256: SNAPSHOT },
      scope: {
        target: 'tests/browser.spec.ts',
        name: 'browser flow',
        browser_profile: { project_name: 'chromium' },
      },
      diagnosis: {
        next_probe: {
          classification: 'main_thread_runtime',
          probe: 'inspect_main_thread_runtime',
          server_request_ordinal: 1,
          required_observation: 'closed runtime mechanisms',
        },
      },
    },
    request: { ...requestFixture(), cpu: runtimeCpuFixture() },
    current: { repository_revision: 'fixture-revision', source_snapshot_sha256: SNAPSHOT },
    family: { family: 'main_thread', mechanism: 'runtime' },
    requestedProbe: 'inspect_main_thread_runtime',
  });
  assert.equal(result.request.runtime_route.classification, 'runtime_filesystem');
  assert.equal(result.request.runtime_route.next_probe, 'inspect_filesystem_runtime');
  assert.equal(result.request.runtime_route.source, null);
  assert.equal(result.next_action, 'inspect_filesystem_runtime');
  assert.deepEqual(result.source_candidates, []);
  assert.equal(result.authority.edit_eligible, false);
});

test('projects the derived profiler-disabled follow-up without execution authority', () => {
  const receipt = {
    capture_id: 'browser-probe-fixture',
    subject: { repository_revision: 'fixture-revision', source_snapshot_sha256: SNAPSHOT },
    scope: {
      target: 'tests/browser.spec.ts',
      name: 'browser flow',
      browser_profile: { project_name: 'chromium' },
    },
    diagnosis: {
      next_probe: {
        classification: 'main_thread_runtime',
        probe: 'inspect_main_thread_runtime',
        server_request_ordinal: 1,
        required_observation: 'closed runtime mechanisms',
      },
    },
  };
  const cpu = runtimeCpuFixture();
  cpu.runtime_mechanisms.precommit.mechanisms = [
    {
      mechanism: 'inspector',
      samples: 10,
      self_time_ms: 10,
      runtime_sample_share: 1,
    },
  ];
  cpu.runtime_mechanisms.request.mechanisms = cpu.runtime_mechanisms.precommit.mechanisms;
  const result = createBrowserProbeInspection({
    receipt,
    request: { ...requestFixture(), cpu },
    current: { repository_revision: 'fixture-revision', source_snapshot_sha256: SNAPSHOT },
    family: { family: 'low_overhead_runtime', mechanism: 'profiler_disabled' },
    requestedProbe: 'repeat_with_lower_overhead_cpu_measurement',
    probeDescriptor: {
      classification: 'observer_effect',
      probe: 'repeat_with_lower_overhead_cpu_measurement',
      server_request_ordinal: 1,
      required_observation: 'sampling profilers disabled',
    },
  });
  assert.equal(result.probe.family, 'low_overhead_runtime');
  assert.equal(result.next_action, 'recapture_same_exact_flow_with_sampling_profilers_disabled');
  assert.deepEqual(result.source_candidates, []);
  assert.equal(result.authority.edit_eligible, false);

  const upstream = {
    recapture_id: 'runtime-recapture',
    receipt_sha256: 'a'.repeat(64),
    source_probe: 'inspect_main_thread_runtime',
    classification: 'observer_effect',
    next_probe: 'repeat_with_lower_overhead_cpu_measurement',
    server_request_ordinal: 1,
    correctness: 'passed',
  };
  const chained = createBrowserProbeInspection({
    receipt,
    request: { ...requestFixture(), cpu },
    current: { repository_revision: 'fixture-revision', source_snapshot_sha256: SNAPSHOT },
    family: { family: 'low_overhead_runtime', mechanism: 'profiler_disabled' },
    requestedProbe: 'repeat_with_lower_overhead_cpu_measurement',
    probeDescriptor: {
      classification: 'observer_effect',
      probe: 'repeat_with_lower_overhead_cpu_measurement',
      server_request_ordinal: 1,
      required_observation: 'sampling profilers disabled',
    },
    upstreamRecapture: upstream,
  });
  assert.deepEqual(chained.upstream_recapture, upstream);
  assert.equal(chained.authority.edit_eligible, false);
});

test('projects continuous exact-interval source candidates without edit authority', () => {
  const result = inspection(
    'inspect_continuous_main_thread_source',
    { family: 'continuous_main_thread_source', mechanism: 'startup_sampling' },
    {},
    { ...requestFixture(), cpu: runtimeCpuFixture() }
  );
  assert.deepEqual(result.source_candidates, [
    {
      source: {
        file: 'src/continuous.ts',
        line: 20,
        function: 'hotPath',
        provenance: 'continuous_node_cpu_sample',
      },
      evidence_kind: 'continuous_main_thread_cpu_sample',
      mechanism: 'startup_sampling',
      metric: { kind: 'sampled_self_time_ms', value: 14 },
      relationship: 'sampled_on_exact_precommit_interval_not_exclusive_or_causal',
    },
  ]);
  assert.equal(result.next_action, 'inspect_candidate_source_then_recapture_correctness');
  assert.equal(result.request.runtime_mechanisms, null);
  assert.equal(result.request.runtime_route, null);
  assert.equal(result.authority.source_causal, false);
  assert.equal(result.authority.edit_eligible, false);
});

test('maps only compatible libuv and response-linked async callsites', () => {
  const crypto = inspection('inspect_libuv_threadpool_crypto', {
    family: 'libuv_threadpool',
    mechanism: 'crypto',
  });
  assert.deepEqual(crypto.source_candidates, [
    candidate('src/crypto.ts', 'async_resource_callsite', 'crypto', 23),
  ]);

  const filesystem = inspection('inspect_libuv_threadpool_filesystem', {
    family: 'libuv_threadpool',
    mechanism: 'filesystem',
  });
  assert.deepEqual(filesystem.source_candidates, [
    candidate('src/files.ts', 'async_resource_callsite', 'filesystem', 7),
  ]);

  const responseLinked = inspection('inspect_async_connect', {
    family: 'response_linked_async',
    mechanism: 'connect',
  });
  assert.deepEqual(responseLinked.source_candidates, [
    candidate('src/network.ts', 'async_resource_callsite', 'connect', 5),
  ]);

  const unsupportedCallsite = inspection('inspect_libuv_threadpool_zlib', {
    family: 'libuv_threadpool',
    mechanism: 'zlib',
  });
  assert.deepEqual(unsupportedCallsite.source_candidates, []);
  assert.equal(unsupportedCallsite.next_action, 'capture_libuv_zlib_async_callsite');
});

test('keeps framework probes contextual and source drift stale', () => {
  const contextual = inspection('inspect_framework_phase_route_resolution', {
    family: 'framework_phase',
    mechanism: 'route_resolution',
  });
  assert.deepEqual(contextual.source_candidates, []);
  assert.equal(contextual.request.source.file, 'src/route.ts');
  assert.equal(contextual.authority.source_causal, false);

  const inventoryGap = inspection('complete_async_and_framework_inventories', {
    family: 'evidence_gap',
    mechanism: 'async_and_framework_inventories',
  });
  assert.deepEqual(inventoryGap.source_candidates, []);
  assert.equal(
    inventoryGap.next_action,
    'recapture_same_exact_flow_with_complete_async_and_framework_inventories'
  );

  const stale = inspection(
    'inspect_main_thread_repository',
    { family: 'main_thread', mechanism: 'repository' },
    { source_snapshot_sha256: 'b'.repeat(64) }
  );
  assert.equal(stale.state, 'stale_source_snapshot');
  assert.deepEqual(stale.source_candidates, []);
  assert.equal(stale.next_action, 'recapture_probe_on_current_source_snapshot');
});

test('rejects probe identity drift in the public inspection contract', () => {
  const value = inspection('inspect_main_thread_repository', {
    family: 'main_thread',
    mechanism: 'repository',
  });
  assert.throws(
    () =>
      assertBrowserProbeInspection({
        ...value,
        probe: { ...value.probe, mechanism: 'dependency' },
      }),
    /invalid/
  );
});

function inspection(probe, family, currentOverride = {}, request = requestFixture()) {
  return createBrowserProbeInspection({
    receipt: {
      capture_id: 'browser-probe-fixture',
      state: 'failed',
      subject: { repository_revision: 'fixture-revision', source_snapshot_sha256: SNAPSHOT },
      scope: {
        target: 'tests/browser.spec.ts',
        name: 'browser flow',
        browser_profile: { project_name: 'chromium' },
      },
      diagnosis: {
        next_probe: {
          classification: 'precommit_cpu_pressure',
          probe,
          server_request_ordinal: 1,
          required_observation: 'bounded request evidence',
        },
      },
    },
    request,
    current: {
      repository_revision: 'fixture-revision',
      source_snapshot_sha256: SNAPSHOT,
      ...currentOverride,
    },
    family,
    requestedProbe: probe,
    upstreamRecapture:
      probe === 'inspect_continuous_main_thread_source'
        ? {
            recapture_id: 'lower-unresolved',
            receipt_sha256: 'f'.repeat(64),
            source_probe: 'repeat_with_lower_overhead_cpu_measurement',
            classification: 'low_overhead_unresolved',
            next_probe: 'inspect_continuous_main_thread_source',
            server_request_ordinal: 1,
            correctness: 'passed',
          }
        : null,
  });
}

function requestFixture() {
  return {
    ordinal: 1,
    method: 'GET',
    route: '/items',
    status: 500,
    outcome: 'failed',
    duration_ms: 100,
    source: source('src/route.ts'),
    response_timing: { preparation_ms: 90 },
    process_cpu: { total_ms: 50 },
    cpu: {
      candidates: [{ source: source('src/route.ts'), self_time_ms: 18 }],
    },
    worker_cpu: {
      workers: [
        {
          profile: {
            candidates: [{ source: source('src/worker.ts'), self_time_ms: 11 }],
          },
        },
      ],
    },
    native_activity: { intervals: [] },
    continuous_source: {
      candidates: [
        {
          source: {
            file: 'src/continuous.ts',
            line: 20,
            function: 'hotPath',
            provenance: 'continuous_node_cpu_sample',
          },
          self_time_ms: 14,
        },
      ],
    },
    async_resources: [
      asyncResource('worker_pool', 'src/crypto.ts', 23),
      asyncResource('filesystem', 'src/files.ts', 7),
      asyncResource('connect', 'src/network.ts', 5, 'response_completion_descendant'),
      asyncResource('connect', 'src/not-linked.ts', 99, 'request_context_only'),
    ],
  };
}

function runtimeCpuFixture() {
  const scopes = {
    repository: 0,
    dependency: 0,
    generated: 0,
    runtime: 10,
    idle: 0,
    unresolved: 0,
  };
  const mechanism = {
    mechanism: 'filesystem',
    samples: 10,
    self_time_ms: 10,
    runtime_sample_share: 1,
  };
  return {
    schema_version: 'runtime-node-request-cpu/v3',
    state: 'insufficient',
    overlapping_dynamic_requests: 0,
    total_samples: 10,
    sampled_time_ms: 10,
    repository_samples: 0,
    repository_self_time_ms: 0,
    repository_sample_share: 0,
    sample_scope: scopes,
    candidates: [],
    precommit: {
      state: 'observed',
      boundary_ms: 10,
      total_samples: 10,
      sampled_time_ms: 10,
      non_idle_sampled_time_ms: 10,
      sample_scope: scopes,
      sample_scope_time_ms: { ...scopes, runtime: 10 },
      complete: true,
      provenance: 'v8_request_profile_cumulative_time_deltas',
    },
    runtime_mechanisms: {
      state: 'observed',
      request: {
        boundary_ms: null,
        total_samples: 10,
        sampled_time_ms: 10,
        mechanisms: [mechanism],
        complete: true,
      },
      precommit: {
        boundary_ms: 10,
        total_samples: 10,
        sampled_time_ms: 10,
        mechanisms: [mechanism],
        complete: true,
      },
      complete: true,
      provenance: 'closed_node_v8_runtime_sample_classification',
    },
    complete: true,
    observer_effect: 'profiler_started_before_handler_dispatch',
  };
}

function asyncResource(resourceKind, file, overlap, responseDependency = 'request_context_only') {
  return {
    resource_kind: resourceKind,
    source: source(file),
    preparation_overlap_ms: overlap,
    response_dependency: responseDependency,
  };
}

function source(file) {
  return { file, line: 10, function: 'handler', provenance: 'repository_contained_frame' };
}

function candidate(file, evidenceKind, mechanism, value) {
  return {
    source: source(file),
    evidence_kind: evidenceKind,
    mechanism,
    metric: {
      kind:
        evidenceKind === 'async_resource_callsite'
          ? 'preparation_overlap_ms'
          : 'sampled_self_time_ms',
      value,
    },
    relationship:
      evidenceKind === 'main_thread_cpu_sample'
        ? 'sampled_on_exact_request_not_exclusive_or_causal'
        : evidenceKind === 'worker_cpu_sample'
          ? 'sampled_on_compatible_worker_interval_not_exclusive_or_causal'
          : mechanism === 'connect'
            ? 'response_lineage_and_temporal_overlap_not_await_or_causality'
            : 'async_context_and_temporal_overlap_not_native_cpu_attribution',
  };
}
