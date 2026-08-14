import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  BROWSER_SERVER_FLOW_LIMITS,
  BROWSER_SERVER_FLOW_PRESENTATION_PROFILES,
  assertBrowserServerFlowSummary,
  createBrowserServerFlowSummary,
  unavailableBrowserServerFlow,
} from './browser-server-flow.mjs';
import { collectNodeFlowStreamEvents, normalizeEvent } from './flow-capture.mjs';

const FLOW_PRELOAD = fileURLToPath(new URL('./node-flow-preload.mjs', import.meta.url));

test('joins one unique browser request to scoped server and child work', () => {
  const summary = createBrowserServerFlowSummary({
    nodeFlow: flow([
      server('server-1', 1, '/api/items', 1_000, 30),
      database('db-1', 'server-1', 1_005, 8),
      client('fetch-1', 'server-1', 1_015, 5),
    ]),
    resources: [resource('/api/items', 120, 10, 2_048)],
    actions: actions([{ ordinal: 3, started_at_ms: 100, duration_ms: 50 }]),
  });

  assert.equal(summary.state, 'observed');
  assert.equal(summary.inventory.joined_unique_requests, 1);
  assert.equal(summary.requests[0].browser_join.state, 'joined_unique_identity');
  assert.equal(summary.requests[0].browser_join.action_ordinal, 3);
  assert.equal(summary.requests[0].browser_join.transfer_bytes, 2_048);
  assert.deepEqual(
    summary.requests[0].children.map((child) => child.kind),
    ['database', 'http_client']
  );
  assert.deepEqual(summary.requests[0].accounting, {
    covered_child_ms: 13,
    unaccounted_ms: 17,
  });
});

test('does not order duplicate browser or server request identities', () => {
  const summary = createBrowserServerFlowSummary({
    nodeFlow: flow([
      server('server-1', 1, '/api/items', 1_000, 5),
      server('server-2', 2, '/api/items', 1_010, 5),
    ]),
    resources: [resource('/api/items', 10, 2, 10), resource('/api/items', 20, 2, 10)],
    actions: actions([{ ordinal: 1, started_at_ms: 0, duration_ms: 100 }]),
  });

  assert.equal(summary.inventory.ambiguous_requests, 2);
  assert.ok(summary.requests.every((request) => request.browser_join.state === 'ambiguous'));
  assert.ok(summary.requests.every((request) => request.browser_join.action_ordinal === null));
});

test('classifies closed same-runtime preflight timing against one compatible browser request', () => {
  const scenarios = [
    { first: 400, repeat: 120, browser: 130, classification: 'first_preflight_outlier' },
    { first: 120, repeat: 110, browser: 300, classification: 'browser_request_outlier' },
    { first: 150, repeat: 120, browser: 130, classification: 'repeated_high_latency' },
    { first: 40, repeat: 30, browser: 35, classification: 'no_material_outlier' },
  ];
  for (const scenario of scenarios) {
    const summary = createBrowserServerFlowSummary({
      nodeFlow: flow([server('server-1', 1, '/', 1_000, scenario.browser)]),
      resources: [resource('/', 100, scenario.browser, 1_024)],
      preflight: completedPreflight(scenario.first, scenario.repeat),
      preflightRoute: '/',
    });
    assert.deepEqual(summary.preflight_comparison, {
      classification: scenario.classification,
      first_duration_ms: scenario.first,
      repeat_duration_ms: scenario.repeat,
      browser_duration_ms: scenario.browser,
      status_class: '2xx',
      provenance: 'owned_next_preflight_wall_and_correlated_server_wall',
    });
  }
});

test('preflight comparison fails closed for mismatched status, route, ambiguity, and incomplete evidence', () => {
  const base = {
    nodeFlow: flow([server('server-1', 1, '/', 1_000, 300)]),
    resources: [resource('/', 100, 300, 1_024)],
    preflight: completedPreflight(50, 50),
    preflightRoute: '/',
  };
  const mismatchedStatus = structuredClone(base);
  mismatchedStatus.preflight.requests[1].status_class = '4xx';
  const mismatchedRoute = { ...base, preflightRoute: '/other' };
  const ambiguous = { ...base, resources: [...base.resources, resource('/', 500, 300, 1_024)] };
  const incomplete = structuredClone(base);
  incomplete.preflight.state = 'failed';
  incomplete.preflight.inventory.complete = false;
  for (const input of [mismatchedStatus, mismatchedRoute, ambiguous, incomplete]) {
    assert.equal(
      createBrowserServerFlowSummary(input).preflight_comparison.classification,
      'insufficient_evidence'
    );
  }
});

test('bounds dynamic requests and children while preserving incomplete inventory', () => {
  const events = [];
  for (let index = 1; index <= BROWSER_SERVER_FLOW_LIMITS.requests + 2; index += 1) {
    events.push(server(`server-${index}`, index, `/api/${index}`, 1_000 + index, index));
  }
  for (let index = 1; index <= BROWSER_SERVER_FLOW_LIMITS.childrenPerRequest + 2; index += 1) {
    events.push(database(`db-${index}`, 'server-18', 1_020 + index, 1));
  }
  const summary = createBrowserServerFlowSummary({ nodeFlow: flow(events) });

  assert.equal(summary.requests.length, BROWSER_SERVER_FLOW_LIMITS.requests);
  assert.equal(summary.inventory.complete, false);
  const selected = summary.requests.find((request) => request.ordinal === 18);
  assert.equal(selected.children.length, BROWSER_SERVER_FLOW_LIMITS.childrenPerRequest);
  assert.equal(selected.child_inventory.complete, false);
});

test('returns a closed reason instead of fabricated server evidence', () => {
  const summary = unavailableBrowserServerFlow('go_instrumentation_not_authorized');
  assert.equal(summary.state, 'unavailable');
  assert.equal(summary.reason, 'go_instrumentation_not_authorized');
  assert.deepEqual(summary.requests, []);
});

test('retains bounded isolated request CPU evidence without changing wall-time accounting', () => {
  const request = server('server-1', 1, '/api/items', 1_000, 30);
  request.cpu = {
    schema_version: 'runtime-node-request-cpu/v2',
    state: 'observed',
    overlapping_dynamic_requests: 0,
    total_samples: 10,
    sampled_time_ms: 1,
    repository_samples: 8,
    repository_self_time_ms: 0.8,
    repository_sample_share: 0.8,
    sample_scope: {
      repository: 8,
      dependency: 1,
      generated: 1,
      runtime: 0,
      idle: 0,
      unresolved: 0,
    },
    candidates: [
      {
        source: {
          file: 'src/api/items.ts',
          line: 20,
          function: 'buildItems',
          provenance: 'node_request_cpu_sample',
        },
        samples: 8,
        sample_share: 0.8,
        self_time_ms: 0.8,
      },
    ],
    precommit: {
      state: 'observed',
      boundary_ms: 20,
      total_samples: 8,
      sampled_time_ms: 0.8,
      non_idle_sampled_time_ms: 0.8,
      sample_scope: {
        repository: 8,
        dependency: 0,
        generated: 0,
        runtime: 0,
        idle: 0,
        unresolved: 0,
      },
      sample_scope_time_ms: {
        repository: 0.8,
        dependency: 0,
        generated: 0,
        runtime: 0,
        idle: 0,
        unresolved: 0,
      },
      complete: true,
      provenance: 'v8_request_profile_cumulative_time_deltas',
    },
    complete: true,
    observer_effect: 'profiler_started_before_handler_dispatch',
  };
  const summary = createBrowserServerFlowSummary({ nodeFlow: flow([request]) });
  assert.equal(summary.requests[0].cpu.state, 'observed');
  assert.equal(summary.requests[0].cpu.candidates[0].source.file, 'src/api/items.ts');
  assert.deepEqual(summary.requests[0].accounting, {
    covered_child_ms: 0,
    unaccounted_ms: 30,
  });
});

test('retains async callback delay separately from explicit child accounting', () => {
  const summary = createBrowserServerFlowSummary({
    nodeFlow: flow([
      server('server-1', 1, '/api/items', 1_000, 30),
      asyncResource('async-1', 'server-1', 'timer', 1_002, 20),
    ]),
  });
  assert.equal(summary.requests[0].async_resource_inventory.total, 1);
  assert.equal(summary.requests[0].async_resources[0].resource_kind, 'timer');
  assert.equal(summary.requests[0].async_overlap.covered_delay_ms, 20);
  assert.equal(summary.requests[0].async_overlap.response_completion_delay_ms, 0);
  assert.deepEqual(summary.requests[0].accounting, {
    covered_child_ms: 0,
    unaccounted_ms: 30,
  });
});

test('retains ordered framework phases with overlap union outside child accounting', () => {
  const summary = createBrowserServerFlowSummary({
    nodeFlow: flow([
      server('server-1', 1, '/api/items', 1_000, 40),
      frameworkPhase('phase-1', 'server-1', 'route_resolution', 1_004, 20),
      frameworkPhase('phase-2', 'server-1', 'component_tree', 1_009, 20),
    ]),
  });
  const request = summary.requests[0];
  assert.deepEqual(request.framework_phase_inventory, { total: 2, retained: 2, complete: true });
  assert.deepEqual(request.framework_phases, [
    { phase: 'route_resolution', start_offset_ms: 4, duration_ms: 20 },
    { phase: 'component_tree', start_offset_ms: 9, duration_ms: 20 },
  ]);
  assert.equal(request.framework_phase_overlap_ms, 25);
  assert.deepEqual(request.accounting, { covered_child_ms: 0, unaccounted_ms: 40 });
});

test('projects a complete response partition without changing child accounting', () => {
  const requestEvent = server('server-1', 1, '/api/items', 1_000, 100);
  requestEvent.response_timing = responseTiming(20, 45, 90, 100);
  const summary = createBrowserServerFlowSummary({
    nodeFlow: flow([requestEvent, database('db-1', 'server-1', 1_010, 30)]),
  });
  assert.deepEqual(summary.requests[0].response_timing, {
    complete: true,
    commit_offset_ms: 20,
    first_body_offset_ms: 45,
    end_offset_ms: 90,
    finish_offset_ms: 100,
    preparation_ms: 20,
    emission_ms: 70,
    finish_tail_ms: 10,
  });
  assert.deepEqual(summary.requests[0].accounting, {
    covered_child_ms: 30,
    unaccounted_ms: 70,
  });
});

test('projects complete process CPU deltas outside response and child accounting', () => {
  const requestEvent = server('server-1', 1, '/api/items', 1_000, 100);
  requestEvent.response_timing = responseTiming(80, 80, 95, 100);
  requestEvent.process_cpu = processCpu(40, 10, 45, 15, 0, 80, 100);
  const summary = createBrowserServerFlowSummary({ nodeFlow: flow([requestEvent]) });
  assert.deepEqual(summary.requests[0].process_cpu, requestEvent.process_cpu);
  assert.deepEqual(summary.requests[0].accounting, {
    covered_child_ms: 0,
    unaccounted_ms: 100,
  });
  assert.equal(summary.requests[0].response_timing.preparation_ms, 80);
});

test('retains closed Worker CPU evidence on the exact request without changing accounting', () => {
  const requestEvent = server('server-1', 1, '/api/items', 1_000, 100);
  requestEvent.response_timing = responseTiming(80, 80, 95, 100);
  requestEvent.process_cpu = processCpu(40, 10, 45, 15, 0, 80, 100);
  requestEvent.worker_cpu = workerCpu();
  const summary = createBrowserServerFlowSummary({ nodeFlow: flow([requestEvent]) });

  assert.deepEqual(summary.requests[0].worker_cpu, requestEvent.worker_cpu);
  assert.equal(summary.requests[0].worker_cpu.workers[0].profile.sample_scope.repository, 10);
  assert.deepEqual(summary.requests[0].accounting, {
    covered_child_ms: 0,
    unaccounted_ms: 100,
  });
});

test('retains closed native activity on the exact request without treating it as accounting', () => {
  const requestEvent = server('server-1', 1, '/api/items', 1_000, 100);
  requestEvent.response_timing = responseTiming(80, 80, 95, 100);
  requestEvent.process_cpu = processCpu(40, 10, 45, 15, 0, 80, 100);
  requestEvent.native_activity = nativeActivity();
  const summary = createBrowserServerFlowSummary({ nodeFlow: flow([requestEvent]) });

  assert.deepEqual(summary.requests[0].native_activity, requestEvent.native_activity);
  assert.equal(summary.requests[0].native_activity.threadpool.union_activity_ms, 12);
  assert.deepEqual(summary.requests[0].accounting, {
    covered_child_ms: 0,
    unaccounted_ms: 100,
  });
});

test('bounds framework phase presentation and rejects invalid categories', () => {
  const events = [server('server-1', 1, '/api/items', 1_000, 100)];
  events.push(
    ...Array.from(
      { length: BROWSER_SERVER_FLOW_LIMITS.frameworkPhasesPerRequest + 2 },
      (_, index) =>
        frameworkPhase(
          `phase-${index}`,
          'server-1',
          index % 2 === 0 ? 'route_resolution' : 'component_tree',
          1_001 + index,
          index + 1
        )
    )
  );
  const summary = createBrowserServerFlowSummary({ nodeFlow: flow(events) });
  assert.equal(
    summary.requests[0].framework_phases.length,
    BROWSER_SERVER_FLOW_LIMITS.frameworkPhasesPerRequest
  );
  assert.equal(summary.requests[0].framework_phase_inventory.complete, false);
  summary.requests[0].framework_phases[0].phase = 'private-arbitrary-phase';
  assert.throws(
    () => assertBrowserServerFlowSummary(summary),
    /browser server-flow summary is invalid/
  );
});

test('bounds async resource presentation without summing overlapping delay', () => {
  const events = [server('server-1', 1, '/api/items', 1_000, 30)];
  events.push(
    ...Array.from({ length: BROWSER_SERVER_FLOW_LIMITS.asyncResourcesPerRequest + 2 }, (_, index) =>
      asyncResource(`async-${index}`, 'server-1', 'filesystem', 1_001, 10)
    ),
    asyncResource('async-linked', 'server-1', 'timer', 1_002, 5, 'response_completion_descendant')
  );
  const summary = createBrowserServerFlowSummary({ nodeFlow: flow(events) });
  const request = summary.requests[0];
  assert.equal(request.async_resources.length, BROWSER_SERVER_FLOW_LIMITS.asyncResourcesPerRequest);
  assert.equal(request.async_resource_inventory.complete, false);
  assert.equal(request.async_overlap.covered_delay_ms, 10);
  assert.equal(request.async_overlap.response_completion_delay_ms, 5);
  assert.ok(
    request.async_resources.some(
      (resource) => resource.response_dependency === 'response_completion_descendant'
    )
  );
});

test('expanded async/framework profile resolves ordinary truncation without changing accounting', () => {
  const request = server('server-1', 1, '/api/items', 1_000, 30);
  const events = [request];
  events.push(
    ...Array.from({ length: 12 }, (_, index) =>
      asyncResource(`async-${index}`, 'server-1', 'filesystem', 1_001, 10)
    ),
    ...Array.from({ length: 12 }, (_, index) =>
      frameworkPhase(
        `phase-${index}`,
        'server-1',
        index % 2 === 0 ? 'route_resolution' : 'component_tree',
        1_001 + index,
        1
      )
    )
  );
  const ordinary = createBrowserServerFlowSummary({ nodeFlow: flow(events) });
  const expanded = createBrowserServerFlowSummary({
    nodeFlow: flow(events),
    presentationProfile: BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.expandedAsyncFramework,
  });

  assert.equal(ordinary.requests[0].async_resource_inventory.complete, false);
  assert.equal(ordinary.requests[0].framework_phase_inventory.complete, false);
  assert.deepEqual(expanded.requests[0].async_resource_inventory, {
    total: 12,
    retained: 12,
    complete: true,
  });
  assert.deepEqual(expanded.requests[0].framework_phase_inventory, {
    total: 12,
    retained: 12,
    complete: true,
  });
  assert.deepEqual(expanded.requests[0].accounting, ordinary.requests[0].accounting);
  assert.deepEqual(expanded.requests[0].async_overlap, ordinary.requests[0].async_overlap);
});

test('expanded profile remains bounded and unknown profiles fail closed', () => {
  const events = [server('server-1', 1, '/api/items', 1_000, 30)];
  events.push(
    ...Array.from(
      { length: BROWSER_SERVER_FLOW_LIMITS.expandedAsyncResourcesPerRequest + 2 },
      (_, index) => asyncResource(`async-${index}`, 'server-1', 'filesystem', 1_001, 10)
    )
  );
  const expanded = createBrowserServerFlowSummary({
    nodeFlow: flow(events),
    presentationProfile: BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.expandedAsyncFramework,
  });
  assert.equal(
    expanded.requests[0].async_resources.length,
    BROWSER_SERVER_FLOW_LIMITS.expandedAsyncResourcesPerRequest
  );
  assert.equal(expanded.requests[0].async_resource_inventory.complete, false);
  assert.throws(
    () => createBrowserServerFlowSummary({ nodeFlow: flow(events), presentationProfile: 'all' }),
    /presentation profile is invalid/
  );
});

test('normalizes filesystem callback delay without resource arguments or async identity', () => {
  const event = normalizeEvent({
    id: 'event-1-2',
    kind: 'async_resource',
    resource_kind: 'filesystem',
    parent_event_id: 'event-1-1',
    started_at_ms: 10,
    duration_ms: 4,
    callback_active_ms: 0.2,
    response_dependency: 'response_completion_descendant',
    response_end_after_callback_ms: 2,
    filename: '/private/repository/secret.txt',
    resource: { private: true },
  });
  assert.deepEqual(event, {
    event_id: 'event-1-2',
    parent_event_id: 'event-1-1',
    kind: 'async_resource',
    started_at_ms: 10,
    duration_ms: 4,
    source: null,
    resource_kind: 'filesystem',
    callback_active_ms: 0.2,
    response_dependency: 'response_completion_descendant',
    response_end_after_callback_ms: 2,
    outcome: 'callback_completed',
  });
  assert.equal(normalizeEvent({ ...event, resource_kind: 'PROMISE' }), null);
});

test('normalizes only closed framework phase identity and timing', () => {
  assert.deepEqual(
    normalizeEvent({
      id: 'phase-1',
      kind: 'framework_phase',
      phase: 'component_tree',
      parent_event_id: 'request-1',
      started_at_ms: 10,
      duration_ms: 7.25,
      detail: { private: true },
      raw_name: 'private-name',
    }),
    {
      event_id: 'phase-1',
      parent_event_id: 'request-1',
      kind: 'framework_phase',
      started_at_ms: 10,
      duration_ms: 7.25,
      source: null,
      phase: 'component_tree',
      outcome: 'completed',
    }
  );
  assert.equal(
    normalizeEvent({
      id: 'phase-2',
      kind: 'framework_phase',
      phase: 'private-arbitrary-phase',
      started_at_ms: 10,
      duration_ms: 1,
    }),
    null
  );
});

test('normalizes ordered response boundaries and rejects malformed or private timing data', () => {
  const event = normalizeEvent({
    id: 'request-1',
    kind: 'http_server',
    method: 'GET',
    route: '/api/items',
    status: 200,
    outcome: 'ok',
    started_at_ms: 10,
    duration_ms: 100,
    response_timing: {
      commit_offset_ms: 20,
      first_body_offset_ms: 45,
      end_offset_ms: 90,
      finish_offset_ms: 100,
    },
  });
  assert.deepEqual(event.response_timing, responseTiming(20, 45, 90, 100));
  assert.equal(
    normalizeEvent({
      ...event,
      response_timing: {
        commit_offset_ms: 80,
        first_body_offset_ms: 40,
        end_offset_ms: 70,
        finish_offset_ms: 100,
      },
    }),
    null
  );
  assert.equal(
    normalizeEvent({
      ...event,
      response_timing: {
        commit_offset_ms: 20,
        first_body_offset_ms: null,
        end_offset_ms: 90,
        finish_offset_ms: 100,
        private_header: 'secret-value',
      },
    }),
    null
  );
  const incomplete = normalizeEvent({
    ...event,
    response_timing: undefined,
    process_cpu: undefined,
  });
  assert.equal(incomplete.response_timing.complete, false);
  assert.equal(incomplete.response_timing.finish_offset_ms, 100);
});

test('normalizes process CPU deltas and rejects absolute, inconsistent, or oversized evidence', () => {
  const event = {
    id: 'request-1',
    kind: 'http_server',
    method: 'GET',
    route: '/api/items',
    status: 200,
    outcome: 'ok',
    started_at_ms: 10,
    duration_ms: 100,
    response_timing: {
      commit_offset_ms: 80,
      first_body_offset_ms: 80,
      end_offset_ms: 95,
      finish_offset_ms: 100,
    },
    process_cpu: {
      complete: true,
      overlapping_request_count: 0,
      overlapping_preparation_request_count: 0,
      preparation_user_us: 40_000,
      preparation_system_us: 10_000,
      request_user_us: 45_000,
      request_system_us: 15_000,
    },
  };
  const normalized = normalizeEvent(event);
  assert.deepEqual(normalized.process_cpu, processCpu(40, 10, 45, 15, 0, 80, 100));
  assert.equal(normalized.process_cpu.thread_partition.state, 'unsupported');
  assert.equal(/_us"/.test(JSON.stringify(normalized)), false);

  const threaded = normalizeEvent({
    ...event,
    process_cpu: {
      ...event.process_cpu,
      thread_cpu_supported: true,
      thread_cpu_observer_effect:
        'process_counter_interval_encloses_current_thread_counter_interval',
      preparation_thread_user_us: 30_000,
      preparation_thread_system_us: 5_000,
      request_thread_user_us: 35_000,
      request_thread_system_us: 5_000,
    },
  });
  assert.deepEqual(threaded.process_cpu.thread_partition, {
    state: 'observed',
    preparation_main_thread_cpu_ms: 35,
    preparation_other_threads_cpu_ms: 15,
    preparation_main_thread_to_process_cpu_ratio: 0.7,
    request_main_thread_cpu_ms: 40,
    request_other_threads_cpu_ms: 20,
    request_main_thread_to_process_cpu_ratio: 0.6667,
    observer_effect: 'nested_process_and_current_thread_counter_snapshots',
    provenance: 'process_and_current_thread_cpu_usage_deltas',
  });

  const inconsistentThread = normalizeEvent({
    ...event,
    process_cpu: {
      ...event.process_cpu,
      thread_cpu_supported: true,
      thread_cpu_observer_effect:
        'process_counter_interval_encloses_current_thread_counter_interval',
      preparation_thread_user_us: 60_000,
      preparation_thread_system_us: 0,
      request_thread_user_us: 70_000,
      request_thread_system_us: 0,
    },
  });
  assert.equal(inconsistentThread.process_cpu.thread_partition.state, 'inconsistent');
  assert.equal(
    inconsistentThread.process_cpu.thread_partition.preparation_main_thread_cpu_ms,
    null
  );

  const incompleteThread = normalizeEvent({
    ...event,
    process_cpu: {
      ...event.process_cpu,
      thread_cpu_supported: true,
      thread_cpu_observer_effect:
        'process_counter_interval_encloses_current_thread_counter_interval',
      preparation_thread_user_us: null,
      preparation_thread_system_us: null,
      request_thread_user_us: null,
      request_thread_system_us: null,
    },
  });
  assert.equal(incompleteThread.process_cpu.thread_partition.state, 'incomplete');
  for (const processCpuEvidence of [
    { ...event.process_cpu, absolute_user_us: 123 },
    { ...event.process_cpu, preparation_user_us: 50_000, request_user_us: 45_000 },
    { ...event.process_cpu, request_user_us: 30_000_000_000 },
    {
      ...event.process_cpu,
      thread_cpu_supported: true,
      thread_cpu_observer_effect:
        'process_counter_interval_encloses_current_thread_counter_interval',
      preparation_thread_user_us: -1,
      preparation_thread_system_us: 0,
      request_thread_user_us: 0,
      request_thread_system_us: 0,
    },
  ]) {
    assert.equal(normalizeEvent({ ...event, process_cpu: processCpuEvidence }), null);
  }
  assert.equal(normalizeEvent({ ...event, process_cpu: undefined }).process_cpu.complete, false);
});

test('stream truncation metadata keeps async inventory explicitly incomplete', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-truncated-flow-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, 'flow-1.ndjson'),
    `${JSON.stringify({
      schema_version: 'codevetter-node-flow-event/v1',
      event: {
        id: 'request-1',
        kind: 'http_server',
        method: 'GET',
        route: '/api/items',
        status: 200,
        outcome: 'ok',
        started_at_ms: 10,
        duration_ms: 20,
        correlation_id: 'bounded-capture',
      },
    })}\n${JSON.stringify({
      schema_version: 'codevetter-node-flow-meta/v1',
      truncated: true,
    })}\n`,
    'utf8'
  );

  const evidence = await collectNodeFlowStreamEvents(root, {
    correlationId: 'bounded-capture',
  });
  const summary = createBrowserServerFlowSummary({ nodeFlow: evidence });
  assert.equal(evidence.truncated, true);
  assert.equal(evidence.complete, false);
  assert.equal(summary.requests[0].async_resource_inventory.complete, false);
});

test('async inventory contract rejects completeness when retained evidence is bounded', () => {
  const summary = createBrowserServerFlowSummary({
    nodeFlow: flow([
      server('server-1', 1, '/api/items', 1_000, 30),
      asyncResource('async-1', 'server-1', 'timer', 1_002, 20),
    ]),
  });
  summary.requests[0].async_resource_inventory.total = 2;
  assert.throws(
    () => assertBrowserServerFlowSummary(summary),
    /browser server-flow summary is invalid/
  );
});

test('owned Node preload streams only the matching capture and its child work', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-server-flow-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
const database = new DatabaseSync(':memory:');
database.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)');
database.exec("INSERT INTO items (value) VALUES ('private-value')");
const server = http.createServer((request, response) => {
  if (request.url.startsWith('/api/captured')) {
    database.exec("INSERT INTO items (value) VALUES ('private-value')");
  }
  response.end('ok');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await fetch('http://127.0.0.1:' + port + '/api/ignored', {
  headers: { 'x-codevetter-capture': 'different-capture' },
});
await fetch('http://127.0.0.1:' + port + '/api/captured?secret=discarded', {
  headers: { 'x-codevetter-capture': 'exact-capture' },
});
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, {
    CODEVETTER_FLOW_DIRECTORY: root,
    CODEVETTER_REPOSITORY_ROOT: root,
    CODEVETTER_FLOW_STREAM: '1',
    CODEVETTER_FLOW_CORRELATION_ID: 'exact-capture',
  });

  const evidence = await collectNodeFlowStreamEvents(root, {
    correlationId: 'exact-capture',
  });
  assert.equal(evidence.state, 'observed');
  assert.equal(evidence.complete, true);
  assert.equal(evidence.events.filter((event) => event.kind === 'http_server').length, 1);
  const request = evidence.events.find((event) => event.kind === 'http_server');
  assert.equal(request.route, '/api/captured');
  const operation = evidence.events.find((event) => event.kind === 'database');
  assert.equal(operation.operation, 'exec');
  assert.equal(operation.statement, 'INSERT INTO items (value) VALUES (?)');
  assert.equal(request.response_timing.complete, true);
  assert.equal(request.response_timing.first_body_offset_ms, request.response_timing.end_offset_ms);
  assert.equal(request.process_cpu.complete, true);
  assert.equal(request.process_cpu.thread_partition.state, 'observed');
  assert.ok(request.process_cpu.thread_partition.request_main_thread_cpu_ms >= 0);
  assert.ok(request.process_cpu.thread_partition.request_other_threads_cpu_ms >= 0);
  assert.equal(request.process_cpu.overlapping_request_count, 0);
  assert.ok(request.process_cpu.request_cpu_ms >= request.process_cpu.preparation_cpu_ms);
  assert.ok(
    Math.abs(
      request.response_timing.preparation_ms +
        request.response_timing.emission_ms +
        request.response_timing.finish_tail_ms -
        request.duration_ms
    ) < 0.003
  );
  assert.ok(!JSON.stringify(evidence).includes('private-value'));
  assert.ok(!JSON.stringify(evidence).includes('discarded'));
  assert.ok(!JSON.stringify(evidence).includes('different-capture'));
  assert.ok(!JSON.stringify(evidence).match(/absolute_|_us"/));
});

test('owned preload contaminates every overlapping admitted request', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-process-cpu-overlap-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
const server = http.createServer(async (_request, response) => {
  await delay(20);
  response.end('private-body');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
await Promise.all(['/one', '/two'].map((route) => fetch(base + route, {
  headers: { 'x-codevetter-capture': 'overlap-capture' },
}).then((response) => response.text())));
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, {
    CODEVETTER_FLOW_DIRECTORY: root,
    CODEVETTER_REPOSITORY_ROOT: root,
    CODEVETTER_FLOW_STREAM: '1',
    CODEVETTER_FLOW_CORRELATION_ID: 'overlap-capture',
  });

  const evidence = await collectNodeFlowStreamEvents(root, {
    correlationId: 'overlap-capture',
  });
  const requests = evidence.events.filter((event) => event.kind === 'http_server');
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.process_cpu.complete));
  assert.ok(requests.every((request) => request.process_cpu.overlapping_request_count > 0));
  assert.ok(
    requests.every((request) => request.process_cpu.overlapping_preparation_request_count > 0)
  );
  assert.ok(!JSON.stringify(evidence).includes('private-body'));
});

test('owned preload preserves streamed, explicit, empty, implicit, and throwing response behavior', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-response-boundaries-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
const server = http.createServer(async (request, response) => {
  await delay(8);
  if (request.url === '/stream') {
    if (response.writeHead(200, { 'x-private': 'secret-header' }) !== response) throw new Error('writeHead return changed');
    await delay(8);
    if (typeof response.write('secret-body-one') !== 'boolean') throw new Error('write return changed');
    await delay(8);
    if (response.end('secret-body-two') !== response) throw new Error('end return changed');
    return;
  }
  if (request.url === '/empty') {
    response.writeHead(204, { 'x-private': 'secret-empty' });
    response.end(() => {});
    return;
  }
  if (request.url === '/implicit') {
    response.write('implicit-secret');
    response.end();
    return;
  }
  if (request.url === '/throw') {
    try { response.writeHead(99); } catch { response.statusCode = 500; response.end('caught-secret'); }
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
for (const [route, expected] of [['/stream', 200], ['/empty', 204], ['/implicit', 200], ['/throw', 500]]) {
  const result = await fetch(base + route, { headers: { 'x-codevetter-capture': 'response-capture' } });
  if (result.status !== expected) throw new Error('status changed');
  await result.text();
}
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, {
    CODEVETTER_FLOW_DIRECTORY: root,
    CODEVETTER_REPOSITORY_ROOT: root,
    CODEVETTER_FLOW_STREAM: '1',
    CODEVETTER_FLOW_CORRELATION_ID: 'response-capture',
  });

  const evidence = await collectNodeFlowStreamEvents(root, {
    correlationId: 'response-capture',
  });
  const requests = evidence.events.filter((event) => event.kind === 'http_server');
  assert.equal(requests.length, 4);
  assert.ok(requests.every((request) => request.response_timing.complete));
  const stream = requests.find((request) => request.route === '/stream').response_timing;
  assert.ok(stream.preparation_ms >= 5);
  assert.ok(stream.first_body_offset_ms >= stream.commit_offset_ms);
  assert.ok(stream.end_offset_ms >= stream.first_body_offset_ms);
  const empty = requests.find((request) => request.route === '/empty').response_timing;
  assert.equal(empty.first_body_offset_ms, null);
  const implicit = requests.find((request) => request.route === '/implicit').response_timing;
  assert.equal(implicit.commit_offset_ms, implicit.first_body_offset_ms);
  assert.ok(!JSON.stringify(evidence).includes('secret-'));
  assert.ok(!JSON.stringify(evidence).includes('implicit-secret'));
  assert.ok(!JSON.stringify(evidence).includes('x-private'));
});

test('owned preload captures closed request phases and excludes static or arbitrary measures', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-server-framework-phases-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
const server = http.createServer(async (_request, response) => {
  const phaseStart = performance.now();
  await delay(20, 'private-phase-value');
  const phaseEnd = performance.now();
  performance.measure('codevetter-next-phase:next-find-page-components', { start: phaseStart, end: phaseEnd, detail: { private: true } });
  performance.measure('codevetter-next-phase:next-create-component-tree', { start: phaseStart + 5, end: phaseEnd });
  performance.measure('codevetter-next-phase:private-arbitrary-name', { start: phaseStart, end: phaseEnd });
  response.end('ok');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await fetch('http://127.0.0.1:' + port + '/_next/static/app.js', {
  headers: { 'x-codevetter-capture': 'phase-capture' },
});
await fetch('http://127.0.0.1:' + port + '/api/phases?private=query', {
  headers: { 'x-codevetter-capture': 'phase-capture' },
});
performance.measure('codevetter-next-phase:next-client-component-loading', { start: performance.now(), end: performance.now() });
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, {
    CODEVETTER_FLOW_DIRECTORY: root,
    CODEVETTER_REPOSITORY_ROOT: root,
    CODEVETTER_FLOW_STREAM: '1',
    CODEVETTER_FLOW_ASYNC: '1',
    CODEVETTER_FLOW_CORRELATION_ID: 'phase-capture',
    NEXT_OTEL_PERFORMANCE_PREFIX: 'codevetter-next-phase',
  });

  const evidence = await collectNodeFlowStreamEvents(root, { correlationId: 'phase-capture' });
  const phases = evidence.events.filter((event) => event.kind === 'framework_phase');
  const dynamicRequest = evidence.events.find(
    (event) => event.kind === 'http_server' && event.route === '/api/phases'
  );
  assert.deepEqual(
    phases.map((phase) => phase.phase),
    ['route_resolution', 'component_tree']
  );
  assert.ok(phases.every((phase) => phase.parent_event_id === dynamicRequest.event_id));
  const summary = createBrowserServerFlowSummary({ nodeFlow: evidence });
  const request = summary.requests.find((candidate) => candidate.route === '/api/phases');
  assert.equal(request.framework_phase_inventory.complete, true);
  assert.equal(request.framework_phases.length, 2);
  assert.ok(request.framework_phase_overlap_ms < 35);
  assert.ok(request.framework_phase_overlap_ms >= 10);
  assert.ok(!JSON.stringify(evidence).includes('private-arbitrary-name'));
  assert.ok(!JSON.stringify(evidence).includes('private-phase-value'));
  assert.ok(!JSON.stringify(evidence).includes('private=query'));
  assert.ok(!JSON.stringify(evidence).includes('detail'));
});

test('owned preload distinguishes awaited, context-only, and post-response timers', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-server-async-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
const server = http.createServer(async (_request, response) => {
  setTimeout(() => {}, 5, 'background-private-value');
  await new Promise((resolve) => setTimeout(resolve, 20, 'private-timer-value'));
  setTimeout(() => {}, 40, 'post-response-private-value');
  response.end('ok');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await fetch('http://127.0.0.1:' + port + '/_next/static/app.js', {
  headers: { 'x-codevetter-capture': 'async-capture' },
});
await fetch('http://127.0.0.1:' + port + '/api/async?private=query', {
  headers: { 'x-codevetter-capture': 'async-capture' },
});
await new Promise((resolve) => setTimeout(resolve, 70));
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, {
    CODEVETTER_FLOW_DIRECTORY: root,
    CODEVETTER_REPOSITORY_ROOT: root,
    CODEVETTER_FLOW_STREAM: '1',
    CODEVETTER_FLOW_ASYNC: '1',
    CODEVETTER_FLOW_CORRELATION_ID: 'async-capture',
  });

  const evidence = await collectNodeFlowStreamEvents(root, {
    correlationId: 'async-capture',
  });
  const resources = evidence.events.filter((event) => event.kind === 'async_resource');
  const staticRequest = evidence.events.find(
    (event) => event.kind === 'http_server' && event.route === '/_next/static/app.js'
  );
  assert.equal(resources.length, 2);
  assert.ok(resources.every((resource) => resource.parent_event_id !== staticRequest.event_id));
  const awaited = resources.find(
    (resource) => resource.response_dependency === 'response_completion_descendant'
  );
  const contextOnly = resources.find((resource) => resource.response_dependency === 'context_only');
  assert.equal(awaited.resource_kind, 'timer');
  assert.ok(awaited.duration_ms >= 10);
  assert.ok(awaited.response_end_after_callback_ms >= 0);
  assert.equal(awaited.source.file, 'server.mjs');
  assert.equal(contextOnly.resource_kind, 'timer');
  assert.ok(contextOnly.response_end_after_callback_ms >= 0);
  assert.ok(!JSON.stringify(evidence).includes('private-timer-value'));
  assert.ok(!JSON.stringify(evidence).includes('background-private-value'));
  assert.ok(!JSON.stringify(evidence).includes('post-response-private-value'));
  assert.ok(!JSON.stringify(evidence).includes('private=query'));
  assert.ok(!JSON.stringify(evidence).match(/async_id|trigger_async|resolved_by/));
});

test('owned preload preserves promise-based timer and filesystem creator callsites', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-server-promise-creators-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
import { pbkdf2 } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
const payload = new URL('./private-fs-payload.bin', import.meta.url);
await writeFile(payload, Buffer.alloc(16 * 1024 * 1024));
const blockers = Array.from({ length: 1 }, () => new Promise((resolve, reject) => {
  pbkdf2('private-password', 'private-salt', 2000000, 32, 'sha256', (error) => error ? reject(error) : resolve());
}));
const server = http.createServer(async (_request, response) => {
  const marker = await delay(15, 'private-resolution-value');
  const contents = await readFile(payload);
  response.end(marker === 'private-resolution-value' && contents.length > 0 ? 'ok' : 'bad');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const result = await fetch('http://127.0.0.1:' + server.address().port + '/promise-creators', {
  headers: { 'x-codevetter-capture': 'promise-creator-capture' },
});
if ((await result.text()) !== 'ok') throw new Error('unexpected response');
await Promise.all(blockers);
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, {
    CODEVETTER_FLOW_DIRECTORY: root,
    CODEVETTER_REPOSITORY_ROOT: root,
    CODEVETTER_FLOW_STREAM: '1',
    CODEVETTER_FLOW_ASYNC: '1',
    CODEVETTER_FLOW_CORRELATION_ID: 'promise-creator-capture',
    UV_THREADPOOL_SIZE: '1',
  });

  const evidence = await collectNodeFlowStreamEvents(root, {
    correlationId: 'promise-creator-capture',
  });
  const directlyAttributed = evidence.events.filter(
    (event) =>
      event.kind === 'async_resource' && event.source?.provenance === 'node_async_creator_callsite'
  );
  assert.ok(
    directlyAttributed.some(
      (event) =>
        event.resource_kind === 'timer' &&
        event.response_dependency === 'response_completion_descendant'
    ),
    JSON.stringify(evidence)
  );
  assert.ok(
    directlyAttributed.some(
      (event) =>
        event.resource_kind === 'filesystem' &&
        event.response_dependency === 'response_completion_descendant'
    ),
    JSON.stringify(evidence)
  );
  assert.ok(directlyAttributed.every((event) => event.source.file === 'server.mjs'));
  const summary = createBrowserServerFlowSummary({ nodeFlow: evidence });
  assert.ok(
    summary.requests[0].async_resources.some(
      (event) => event.source?.provenance === 'node_async_creator_callsite'
    )
  );
  assert.ok(!JSON.stringify(evidence).includes('private-fs-payload'));
  assert.ok(!JSON.stringify(evidence).includes('private-resolution-value'));
  assert.ok(!JSON.stringify(evidence).includes('private-password'));
  assert.ok(!JSON.stringify(evidence).match(/async_id|trigger_async|resolved_by/));
});

test('owned preload does not inherit an application ancestor across a dependency creator', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-server-dependency-creator-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dependencyDirectory = join(root, 'node_modules', 'framework-delay');
  await mkdir(dependencyDirectory, { recursive: true });
  await writeFile(
    join(dependencyDirectory, 'index.mjs'),
    `import { setTimeout as delay } from 'node:timers/promises';
export const frameworkDelay = () => delay(15, 'dependency-private-value');
`,
    'utf8'
  );
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
import { frameworkDelay } from './node_modules/framework-delay/index.mjs';
const server = http.createServer(async (_request, response) => {
  await frameworkDelay();
  response.end('ok');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
await fetch('http://127.0.0.1:' + server.address().port + '/dependency-creator', {
  headers: { 'x-codevetter-capture': 'dependency-creator-capture' },
});
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, {
    CODEVETTER_FLOW_DIRECTORY: root,
    CODEVETTER_REPOSITORY_ROOT: root,
    CODEVETTER_FLOW_STREAM: '1',
    CODEVETTER_FLOW_ASYNC: '1',
    CODEVETTER_FLOW_CORRELATION_ID: 'dependency-creator-capture',
  });

  const evidence = await collectNodeFlowStreamEvents(root, {
    correlationId: 'dependency-creator-capture',
  });
  const resource = evidence.events.find((event) => event.kind === 'async_resource');
  assert.equal(resource.response_dependency, 'response_completion_descendant');
  assert.equal(resource.source, null);
  assert.ok(!JSON.stringify(evidence).includes('dependency-private-value'));
  assert.ok(!JSON.stringify(evidence).includes('framework-delay'));
});

test('owned preload links a direct timer callback to response finalization', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-server-direct-async-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
const server = http.createServer((_request, response) => {
  setTimeout(() => response.end('ok'), 15, 'direct-private-value');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
await fetch('http://127.0.0.1:' + server.address().port + '/direct', {
  headers: { 'x-codevetter-capture': 'direct-capture' },
});
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, {
    CODEVETTER_FLOW_DIRECTORY: root,
    CODEVETTER_REPOSITORY_ROOT: root,
    CODEVETTER_FLOW_STREAM: '1',
    CODEVETTER_FLOW_ASYNC: '1',
    CODEVETTER_FLOW_CORRELATION_ID: 'direct-capture',
  });

  const evidence = await collectNodeFlowStreamEvents(root, {
    correlationId: 'direct-capture',
  });
  const resource = evidence.events.find((event) => event.kind === 'async_resource');
  assert.equal(resource.response_dependency, 'response_completion_descendant');
  assert.equal(resource.response_end_after_callback_ms, null);
  assert.ok(!JSON.stringify(evidence).includes('direct-private-value'));
});

test('owned preload makes a negative relationship unknown when lineage is bounded', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-server-bounded-lineage-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, 'server.mjs');
  await writeFile(
    script,
    `import http from 'node:http';
const server = http.createServer(async (_request, response) => {
  await Promise.all(Array.from({ length: 4200 }, () => Promise.resolve()));
  await new Promise((resolve) => setTimeout(resolve, 15));
  response.end('ok');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
await fetch('http://127.0.0.1:' + server.address().port + '/bounded', {
  headers: { 'x-codevetter-capture': 'bounded-lineage' },
});
await new Promise((resolve) => server.close(resolve));
`,
    'utf8'
  );
  await runNode(script, {
    CODEVETTER_FLOW_DIRECTORY: root,
    CODEVETTER_REPOSITORY_ROOT: root,
    CODEVETTER_FLOW_STREAM: '1',
    CODEVETTER_FLOW_ASYNC: '1',
    CODEVETTER_FLOW_CORRELATION_ID: 'bounded-lineage',
  });

  const evidence = await collectNodeFlowStreamEvents(root, {
    correlationId: 'bounded-lineage',
  });
  const resource = evidence.events.find((event) => event.kind === 'async_resource');
  assert.equal(resource.response_dependency, 'unknown');
  assert.ok(!JSON.stringify(evidence).match(/async_id|trigger_async|resolved_by/));
});

function flow(events) {
  return { state: 'observed', events, complete: true };
}

function server(id, ordinal, route, startedAt, duration) {
  return {
    event_id: id,
    parent_event_id: null,
    kind: 'http_server',
    method: 'GET',
    route,
    status: 200,
    outcome: 'ok',
    started_at_ms: startedAt,
    duration_ms: duration,
    correlation_ordinal: ordinal,
  };
}

function database(id, parent, startedAt, duration) {
  return {
    event_id: id,
    parent_event_id: parent,
    kind: 'database',
    database: 'node_sqlite',
    operation: 'get',
    statement: 'SELECT value FROM items WHERE id = ?',
    outcome: 'ok',
    started_at_ms: startedAt,
    duration_ms: duration,
    source: {
      file: 'src/store.ts',
      line: 12,
      function: 'read',
      provenance: 'node_diagnostic_callsite',
    },
  };
}

function client(id, parent, startedAt, duration) {
  return {
    event_id: id,
    parent_event_id: parent,
    kind: 'http_client',
    method: 'GET',
    route: '/internal',
    status: 200,
    outcome: 'ok',
    started_at_ms: startedAt,
    duration_ms: duration,
    source: null,
  };
}

function asyncResource(
  id,
  parent,
  resourceKind,
  startedAt,
  duration,
  responseDependency = 'context_only'
) {
  return {
    event_id: id,
    parent_event_id: parent,
    kind: 'async_resource',
    resource_kind: resourceKind,
    outcome: 'callback_completed',
    started_at_ms: startedAt,
    duration_ms: duration,
    callback_active_ms: 0.1,
    response_dependency: responseDependency,
    response_end_after_callback_ms: 1,
    source: {
      file: 'src/async.ts',
      line: 8,
      function: 'loadItems',
      provenance: 'node_diagnostic_callsite',
    },
  };
}

function frameworkPhase(id, parent, phase, startedAt, duration) {
  return {
    event_id: id,
    parent_event_id: parent,
    kind: 'framework_phase',
    phase,
    outcome: 'completed',
    started_at_ms: startedAt,
    duration_ms: duration,
    source: null,
  };
}

function resource(route, startedAt, duration, transferBytes) {
  return {
    kind: 'http_client',
    started_at_ms: startedAt,
    duration_ms: duration,
    attributes: {
      method: 'GET',
      route,
      network_scope: 'loopback',
      transfer_bytes: transferBytes,
    },
  };
}

function completedPreflight(firstDurationMs, secondDurationMs) {
  return {
    state: 'completed',
    inventory: { total: 2, retained: 2, complete: true },
    requests: [
      { ordinal: 1, duration_ms: firstDurationMs, status_class: '2xx' },
      { ordinal: 2, duration_ms: secondDurationMs, status_class: '2xx' },
    ],
  };
}

function responseTiming(commit, firstBody, end, finish) {
  return {
    complete: true,
    commit_offset_ms: commit,
    first_body_offset_ms: firstBody,
    end_offset_ms: end,
    finish_offset_ms: finish,
    preparation_ms: commit,
    emission_ms: end - commit,
    finish_tail_ms: finish - end,
  };
}

function processCpu(
  preparationUserMs,
  preparationSystemMs,
  requestUserMs,
  requestSystemMs,
  overlappingRequestCount,
  preparationWallMs,
  requestWallMs
) {
  const preparationCpuMs = preparationUserMs + preparationSystemMs;
  const requestCpuMs = requestUserMs + requestSystemMs;
  return {
    complete: true,
    overlapping_request_count: overlappingRequestCount,
    overlapping_preparation_request_count: overlappingRequestCount,
    preparation_user_ms: preparationUserMs,
    preparation_system_ms: preparationSystemMs,
    preparation_cpu_ms: preparationCpuMs,
    preparation_cpu_to_wall_ratio: preparationCpuMs / preparationWallMs,
    request_user_ms: requestUserMs,
    request_system_ms: requestSystemMs,
    request_cpu_ms: requestCpuMs,
    request_cpu_to_wall_ratio: requestCpuMs / requestWallMs,
    thread_partition: {
      state: 'unsupported',
      preparation_main_thread_cpu_ms: null,
      preparation_other_threads_cpu_ms: null,
      preparation_main_thread_to_process_cpu_ratio: null,
      request_main_thread_cpu_ms: null,
      request_other_threads_cpu_ms: null,
      request_main_thread_to_process_cpu_ratio: null,
      observer_effect: 'nested_process_and_current_thread_counter_snapshots',
      provenance: 'process_and_current_thread_cpu_usage_deltas',
    },
  };
}

function workerCpu() {
  return {
    schema_version: 'runtime-node-request-worker-cpu/v1',
    state: 'observed',
    runtime_support: 'supported',
    response_commit_offset_ms: 80,
    overlapping_dynamic_requests: 0,
    inventory: {
      registered_total: 1,
      registered_current: 1,
      online_at_admission: 1,
      attempted: 1,
      retained: 1,
      created_during_interval: 0,
      registry_truncated: false,
      admitted_truncated: false,
      complete: true,
    },
    total_user_ms: 14,
    total_system_ms: 1,
    total_cpu_ms: 15,
    workers: [
      {
        ordinal: 1,
        state: 'observed',
        start_request_offset_ms: 0.1,
        start_offset_ms: 0.2,
        stop_offset_ms: 80.1,
        user_ms: 14,
        system_ms: 1,
        cpu_ms: 15,
        profile: {
          state: 'observed',
          total_samples: 10,
          sampled_time_ms: 1,
          non_idle_sampled_time_ms: 1,
          sample_scope: {
            repository: 10,
            dependency: 0,
            generated: 0,
            runtime: 0,
            idle: 0,
            unresolved: 0,
          },
          sample_scope_time_ms: {
            repository: 1,
            dependency: 0,
            generated: 0,
            runtime: 0,
            idle: 0,
            unresolved: 0,
          },
          candidates: [
            {
              source: {
                file: 'src/worker.ts',
                line: 4,
                function: 'work',
                provenance: 'node_worker_cpu_sample',
              },
              samples: 10,
              sample_share: 1,
              self_time_ms: 1,
            },
          ],
          complete: true,
        },
      },
    ],
    complete: true,
    observer_effect: 'worker_profilers_started_before_handler_dispatch',
  };
}

function actions(values) {
  return { sequence: values, slowest: values };
}

function nativeActivity() {
  return {
    schema_version: 'runtime-node-request-native-activity/v1',
    state: 'observed',
    response_commit_offset_ms: 80,
    interval_ms: 80,
    overlapping_dynamic_requests: 0,
    inventory: { events_seen: 2, intervals_retained: 1, complete: true },
    threadpool: {
      total_count: 1,
      union_activity_ms: 12,
      mechanisms: [{ kind: 'crypto', count: 1, union_activity_ms: 12 }],
    },
    v8: { total_count: 0, union_activity_ms: 0, mechanisms: [] },
    complete: true,
    observer_effect: 'node_trace_events_enabled_before_handler_dispatch',
    provenance: 'bounded_request_scoped_node_trace_events',
  };
}

function runNode(script, environment) {
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
        ...environment,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`fixture failed: ${stderr.slice(0, 500)}`))
    );
  });
}
