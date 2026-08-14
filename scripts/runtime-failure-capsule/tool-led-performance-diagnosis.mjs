import {
  FINDING_LIMITS,
  PERFORMANCE_FINDINGS_SCHEMA_VERSION,
  assertPerformanceFindingsReport,
  createFinding,
} from './performance-findings-contracts.mjs';

export const TOOL_LED_DETECTOR_POLICY = Object.freeze({
  version: 'tool-led-performance-detectors/v1',
  repeated_operation_count: 3,
  serialized_operation_count: 3,
  serialized_combined_ms: 1,
  serialized_parent_share: 0.2,
  unaccounted_ms: 5,
  unaccounted_parent_share: 0.5,
  repeated_network_count: 3,
  dominant_network_ms: 100,
  dominant_network_parent_share: 0.2,
  browser_long_task_ms: 50,
  browser_cpu_minimum_samples: 5,
  browser_cpu_minimum_sample_share: 0.1,
  react_profiled_commit_count: 3,
  react_component_commit_count: 3,
  react_component_self_duration_ms: 5,
  react_component_self_duration_share: 0.1,
  server_cpu_minimum_samples: 5,
  server_cpu_minimum_sample_share: 0.1,
  server_async_delay_ms: 5,
  server_async_delay_parent_share: 0.2,
  server_framework_phase_ms: 5,
  server_framework_phase_parent_share: 0.2,
  server_response_interval_ms: 5,
  server_response_interval_parent_share: 0.5,
  server_precommit_cpu_minimum_ms: 5,
  server_precommit_cpu_high_ratio: 0.5,
  server_precommit_cpu_low_ratio: 0.2,
  server_precommit_main_thread_process_cpu_share: 0.5,
  server_precommit_worker_process_cpu_share: 0.2,
  server_precommit_worker_interval_tolerance_ms: 25,
  server_precommit_probe_interval_ms: 5,
  server_precommit_probe_parent_share: 0.2,
});

const BASE_DETECTORS = Object.freeze([
  'n_plus_one_shape',
  'repeated_application_work',
  'repeated_database_operation',
  'serialized_operations',
  'unaccounted_flow_time',
]);
const BROWSER_NETWORK_DETECTORS = Object.freeze([
  'dominant_network_operation',
  'failed_network_operation',
  'repeated_network_operation',
]);
const BROWSER_MAIN_THREAD_DETECTORS = Object.freeze([
  'browser_javascript_cpu_hotspot',
  'browser_main_thread_long_task',
  'browser_original_source_map',
]);
const BROWSER_REACT_DETECTORS = Object.freeze(['browser_react_component_commit_hotspot']);
const BROWSER_SERVER_DETECTORS = Object.freeze([
  'browser_server_async_delay',
  'browser_server_cpu_hotspot',
  'browser_server_framework_phase',
  'browser_server_preflight_timing',
  'browser_server_precommit_process_cpu',
  'browser_server_precommit_probe_route',
  'browser_server_response_interval',
  'browser_server_unaccounted_time',
]);

export function diagnoseToolLedPerformance(capsule, policy = TOOL_LED_DETECTOR_POLICY) {
  const flows = Array.isArray(capsule?.flows) ? capsule.flows : [];
  const flowById = new Map(flows.map((flow) => [flow.id, flow]));
  const findings = [];
  const coverage = [];

  const database = detectRepeatedDatabaseOperations(flows, flowById, policy);
  findings.push(...database.findings);
  coverage.push(...database.coverage);

  const serialized = detectSerializedOperations(flows, flowById, policy);
  findings.push(...serialized.findings);
  coverage.push(serialized.coverage);

  const repeatedWork = detectRepeatedApplicationWork(capsule);
  findings.push(...repeatedWork.findings);
  coverage.push(repeatedWork.coverage);

  const unaccounted = detectUnaccountedFlowTime(flows, policy);
  findings.push(...unaccounted.findings);
  coverage.push(unaccounted.coverage);

  const browser = capsule?.adapter?.kind === 'playwright-trace';
  if (browser) {
    const network = detectBrowserNetworkOperations(
      flows,
      flowById,
      policy,
      capsule.expected_http_statuses ?? [],
      capsule.browser_runtime?.configuration ?? null
    );
    findings.push(...network.findings);
    coverage.push(...network.coverage);
    const mainThread = detectBrowserMainThread(capsule, flows, policy);
    findings.push(...mainThread.findings);
    coverage.push(...mainThread.coverage);
    const react = detectBrowserReactCommitHotspot(capsule, policy);
    findings.push(...react.findings);
    coverage.push(react.coverage);
    const server = detectBrowserServerWork(capsule, policy);
    findings.push(...server.findings);
    coverage.push(server.coverage);
    const serverCpu = detectBrowserServerCpu(capsule, policy);
    findings.push(...serverCpu.findings);
    coverage.push(serverCpu.coverage);
    const serverAsync = detectBrowserServerAsyncDelay(capsule, policy);
    findings.push(...serverAsync.findings);
    coverage.push(serverAsync.coverage);
    const serverFramework = detectBrowserServerFrameworkPhase(capsule, policy);
    findings.push(...serverFramework.findings);
    coverage.push(serverFramework.coverage);
    const serverPreflight = detectBrowserServerPreflightTiming(capsule);
    findings.push(...serverPreflight.findings);
    coverage.push(serverPreflight.coverage);
    const serverResponse = detectBrowserServerResponseInterval(capsule, policy);
    findings.push(...serverResponse.findings);
    coverage.push(serverResponse.coverage);
    const serverPrecommitCpu = detectBrowserServerPrecommitProcessCpu(capsule, policy);
    findings.push(...serverPrecommitCpu.findings);
    coverage.push(serverPrecommitCpu.coverage);
    const serverPrecommitProbe = detectBrowserServerPrecommitProbe(capsule, policy);
    findings.push(...serverPrecommitProbe.findings);
    coverage.push(serverPrecommitProbe.coverage);
  }

  const sortedFindings = findings.toSorted((left, right) => left.id.localeCompare(right.id));
  const detectorCoverage = coverage.toSorted((left, right) =>
    left.detector.localeCompare(right.detector)
  );
  const ran = detectorCoverage.filter((entry) => entry.status === 'ran').length;
  const unavailableLimitations = detectorCoverage
    .filter((entry) => entry.status !== 'ran')
    .map((entry) => `${entry.detector}: ${entry.reason}`);
  const limitations =
    unavailableLimitations.length <= 16
      ? unavailableLimitations
      : [
          ...unavailableLimitations.slice(0, 15),
          `${unavailableLimitations.length - 15} additional detector limitation(s) remain in detector_coverage.`,
        ];
  return assertPerformanceFindingsReport({
    schema_version: PERFORMANCE_FINDINGS_SCHEMA_VERSION,
    subject: { repository_revision: capsule?.subject?.repository_revision ?? '<unknown>' },
    scope: {
      root_flow_id: capsule?.root_flow_id ?? '<unknown>',
      adapter: capsule?.adapter?.kind ?? '<unknown>',
      target: capsule?.scope?.target ?? '<unknown>',
      name: capsule?.scope?.name ?? null,
    },
    policy: {
      ...policy,
      detectors: [
        ...BASE_DETECTORS,
        ...(browser
          ? [
              ...BROWSER_NETWORK_DETECTORS,
              ...BROWSER_MAIN_THREAD_DETECTORS,
              ...BROWSER_REACT_DETECTORS,
              ...BROWSER_SERVER_DETECTORS,
            ]
          : []),
      ].toSorted(),
    },
    findings: sortedFindings,
    detector_coverage: detectorCoverage,
    limitations,
    verdict:
      ran === 0
        ? {
            status: 'no_confidence',
            reason: 'No detector had the runtime evidence required to run.',
          }
        : sortedFindings.length > 0
          ? {
              status: 'findings',
              reason: `${sortedFindings.length} deterministic finding(s) were derived from captured evidence.`,
            }
          : {
              status: 'no_findings',
              reason: 'Available detectors ran without crossing their recorded thresholds.',
            },
  });
}

function detectBrowserReactCommitHotspot(capsule, policy) {
  const evidence = capsule?.browser_react;
  const detector = 'browser_react_component_commit_hotspot';
  const evidenceKinds = [
    'react_commit_activity',
    'react_component_derived_self_duration',
    'react_component_static_source_attribution',
  ];
  if (!evidence || evidence.state === 'unavailable' || evidence.state === 'not_detected') {
    return {
      findings: [],
      coverage: coverage(
        detector,
        'unavailable',
        evidence?.state === 'not_detected'
          ? 'The declared React flow emitted no observable commit.'
          : 'No usable separate React commit diagnostic evidence was retained.',
        evidenceKinds
      ),
    };
  }
  if (
    evidence.schema_version !== 'runtime-playwright-react-commits/v2' ||
    evidence.attribution !== 'component_activity_observed' ||
    evidence.measurement_complete !== true ||
    evidence.self_duration_provenance !== 'inclusive_minus_direct_child_actual_duration' ||
    evidence.profiled_commit_count < policy.react_profiled_commit_count ||
    !(evidence.total_actual_duration_ms > 0)
  ) {
    return {
      findings: [],
      coverage: coverage(
        detector,
        'insufficient_evidence',
        'React evidence was legacy, incomplete, unprofiled, or below the fixed profiled-commit floor.',
        evidenceKinds
      ),
    };
  }
  if (evidence.source_attribution?.state !== 'complete') {
    return {
      findings: [],
      coverage: coverage(
        detector,
        'insufficient_evidence',
        'The bounded repository source-attribution scan was not complete.',
        evidenceKinds
      ),
    };
  }
  const repositoryComponents = (evidence.components ?? []).filter(
    (component) => component.ownership === 'repository' && component.source
  );
  if (repositoryComponents.length === 0) {
    return {
      findings: [],
      coverage: coverage(
        detector,
        'insufficient_evidence',
        'No profiled component had complete unique repository source ownership.',
        evidenceKinds
      ),
    };
  }
  const candidates = repositoryComponents
    .filter(
      (component) =>
        component.commits_present >= policy.react_component_commit_count &&
        component.self_actual_duration_ms >= policy.react_component_self_duration_ms &&
        component.self_actual_duration_ms / evidence.total_actual_duration_ms >=
          policy.react_component_self_duration_share
    )
    .toSorted(
      (left, right) =>
        right.self_actual_duration_ms - left.self_actual_duration_ms ||
        right.commits_present - left.commits_present ||
        left.source.file.localeCompare(right.source.file) ||
        left.source.line - right.source.line ||
        left.name.localeCompare(right.name)
    );
  const candidate = candidates[0];
  if (!candidate) {
    return {
      findings: [],
      coverage: coverage(
        detector,
        'ran',
        'Complete uniquely owned component evidence was checked against the fixed repetition, self-duration, and duration-share floors.',
        evidenceKinds
      ),
    };
  }
  const share = round(candidate.self_actual_duration_ms / evidence.total_actual_duration_ms, 4);
  return {
    findings: [
      createFinding({
        detector,
        kind: 'react_component_commit_hotspot',
        origin: 'tool_detected',
        flow_id: capsule.root_flow_id,
        source: candidate.source,
        observed: {
          component_name: candidate.name,
          operation_count: candidate.commits_present,
          profiled_commit_count: evidence.profiled_commit_count,
          self_actual_duration_ms: candidate.self_actual_duration_ms,
          total_react_actual_duration_ms: evidence.total_actual_duration_ms,
          self_duration_share: share,
          self_duration_provenance: evidence.self_duration_provenance,
          operation_kind: 'react_component_commit_activity',
          operation_shape: candidate.name,
          flow_ids: [capsule.root_flow_id],
        },
        inference: {
          summary: `${candidate.name} is the leading repeated uniquely owned React self-render candidate in the captured flow.`,
          mechanism: 'repeated_profiled_react_component_self_work',
        },
        unverified: [
          'Repeated component work does not prove that any render is redundant or removable.',
          'Derived self-render duration is not exact exclusive JavaScript CPU time or proof of source causation.',
          'The local flow does not establish production frequency, user impact, or representative device cost.',
        ],
        confidence: {
          level: 'medium',
          basis:
            'Complete bounded React profiling and a complete unique static source scan crossed fixed materiality floors.',
        },
        expected_effect: {
          metric: 'same_flow_component_derived_self_duration_ms',
          direction: 'decrease',
          scope: 'identical attested local browser flow',
        },
        verification: {
          required_observation:
            'Correctness passes and an identical paired browser flow reduces this component derived self duration without shifting work to another component.',
          rejection_condition:
            'Reject if correctness differs, evidence becomes incomplete, source ownership changes, or authoritative browser timing regresses.',
        },
        evidence_ids: ['playwright-react-commit-evidence'],
        limitations: [
          ...(evidence.presentation_truncated
            ? [
                'The component presentation was truncated after complete measurement and source attribution.',
              ]
            : []),
          'Static component ownership identifies an edit anchor, not a captured runtime call site.',
        ],
        eligible_for_experiment: true,
      }),
    ],
    coverage: coverage(
      detector,
      'ran',
      'Complete uniquely owned component evidence was checked against the fixed repetition, self-duration, and duration-share floors.',
      evidenceKinds
    ),
  };
}

function detectBrowserServerPrecommitProbe(capsule, policy) {
  const requests = (capsule?.browser_server?.requests ?? [])
    .filter(
      (request) =>
        !/^\/_next\//.test(request.route) &&
        !/\.[a-z0-9]{1,8}$/i.test(request.route) &&
        request.response_timing?.complete === true &&
        request.response_timing.preparation_ms >= policy.server_precommit_probe_interval_ms
    )
    .toSorted(
      (left, right) =>
        right.response_timing.preparation_ms - left.response_timing.preparation_ms ||
        left.ordinal - right.ordinal
    );
  const request = requests[0];
  if (!request) {
    return {
      findings: [],
      coverage: coverage(
        'browser_server_precommit_probe_route',
        'insufficient_evidence',
        'No material complete dynamic pre-commit interval was retained.',
        ['owned_node_server_response_api_boundaries']
      ),
    };
  }
  const preparationMs = request.response_timing.preparation_ms;
  const processCpu = request.process_cpu;
  const cpuSlice = request.cpu?.precommit;
  const compatibleCpuSlice =
    cpuSlice?.complete === true &&
    Number.isFinite(cpuSlice.boundary_ms) &&
    Math.abs(cpuSlice.boundary_ms - preparationMs) <= 1 &&
    request.cpu?.complete === true &&
    request.cpu?.overlapping_dynamic_requests === 0;
  const processCpuUsable =
    processCpu?.complete === true &&
    processCpu.overlapping_preparation_request_count === 0 &&
    Number.isFinite(processCpu.preparation_cpu_ms) &&
    Number.isFinite(processCpu.preparation_cpu_to_wall_ratio);
  let route;
  if (!processCpuUsable) {
    route = probeRoute(
      'insufficient_evidence',
      'capture_non_overlapping_process_cpu',
      'A complete non-overlapping pre-commit process CPU delta is required.',
      ['server-response-boundary']
    );
  } else if (
    processCpu.preparation_cpu_ms >= policy.server_precommit_probe_interval_ms &&
    processCpu.preparation_cpu_to_wall_ratio > policy.server_precommit_cpu_low_ratio
  ) {
    const threadPartition = processCpu.thread_partition;
    const exactThreadPartition = threadPartition?.state === 'observed';
    const sampledShare =
      compatibleCpuSlice && processCpu.preparation_cpu_ms > 0
        ? cpuSlice.non_idle_sampled_time_ms / processCpu.preparation_cpu_ms
        : 0;
    const dominant = compatibleCpuSlice
      ? dominantMainThreadScope(cpuSlice.sample_scope_time_ms)
      : { scope: 'unresolved', duration_ms: 0 };
    if (exactThreadPartition) {
      const exactMainShare = threadPartition.preparation_main_thread_to_process_cpu_ratio ?? 0;
      if (
        threadPartition.preparation_main_thread_cpu_ms >=
          policy.server_precommit_probe_interval_ms &&
        exactMainShare >= policy.server_precommit_main_thread_process_cpu_share
      ) {
        route =
          compatibleCpuSlice &&
          cpuSlice.non_idle_sampled_time_ms >= policy.server_precommit_probe_interval_ms &&
          dominant.duration_ms > 0
            ? probeRoute(
                `main_thread_${dominant.scope}`,
                `inspect_main_thread_${dominant.scope}`,
                `${round(threadPartition.preparation_main_thread_cpu_ms)} ms of exact current-thread CPU represented ${round(exactMainShare * 100, 1)}% of process CPU, and ${round(dominant.duration_ms)} ms of retained V8 samples were ${dominant.scope}-scoped.`,
                [
                  'server-main-thread-cpu-partition',
                  'server-main-thread-precommit-profile',
                  'server-process-cpu',
                ]
              )
            : probeRoute(
                'main_thread_unattributed',
                'inspect_main_thread_runtime',
                `${round(threadPartition.preparation_main_thread_cpu_ms)} ms of exact current-thread CPU represented ${round(exactMainShare * 100, 1)}% of process CPU, but no compatible sampled source scope crossed the fixed floor.`,
                ['server-main-thread-cpu-partition', 'server-process-cpu']
              );
      } else {
        route = workerAwareProbeRoute(request, processCpu, preparationMs, policy, {
          fallbackSampledShare: sampledShare,
          otherThreadsCpuMs: threadPartition.preparation_other_threads_cpu_ms,
        });
      }
      route.observed = {
        ...route.observed,
        main_thread_cpu_state: threadPartition.state,
        main_thread_cpu_ms: threadPartition.preparation_main_thread_cpu_ms,
        other_threads_cpu_ms: threadPartition.preparation_other_threads_cpu_ms,
        main_thread_to_process_cpu_ratio: round(exactMainShare, 4),
      };
    } else if (!compatibleCpuSlice) {
      route = probeRoute(
        'insufficient_evidence',
        threadPartition?.state === 'inconsistent'
          ? 'recapture_consistent_thread_cpu_partition'
          : 'capture_main_thread_precommit_profile',
        threadPartition?.state === 'inconsistent'
          ? 'The exact current-thread CPU partition was inconsistent and no compatible sampled fallback was retained.'
          : 'Material process CPU was observed, but exact current-thread CPU and a compatible sampled fallback were unavailable.',
        ['server-process-cpu', 'server-response-boundary']
      );
    } else {
      route =
        dominant.duration_ms > 0 &&
        sampledShare >= policy.server_precommit_main_thread_process_cpu_share
          ? probeRoute(
              `main_thread_${dominant.scope}`,
              `inspect_main_thread_${dominant.scope}`,
              `${round(dominant.duration_ms)} ms of sampled pre-commit main-thread activity was ${dominant.scope}-scoped and non-idle sampled time was ${round(sampledShare * 100, 1)}% of observed process CPU; exact current-thread counters were ${threadPartition?.state ?? 'unavailable'}.`,
              ['server-main-thread-precommit-profile', 'server-process-cpu']
            )
          : workerAwareProbeRoute(request, processCpu, preparationMs, policy, {
              fallbackSampledShare: sampledShare,
              otherThreadsCpuMs: null,
            });
      route.observed = {
        ...route.observed,
        main_thread_cpu_state: threadPartition?.state ?? 'unavailable',
        main_thread_to_process_cpu_ratio: round(sampledShare, 4),
      };
    }
    route.observed = {
      ...route.observed,
      process_cpu_ms: processCpu.preparation_cpu_ms,
      main_thread_non_idle_sampled_ms: compatibleCpuSlice
        ? cpuSlice.non_idle_sampled_time_ms
        : null,
      dominant_main_thread_scope: dominant.scope,
      dominant_main_thread_sampled_ms: dominant.duration_ms,
    };
  } else {
    const asyncCandidate = (request.async_resources ?? [])
      .filter(
        (resource) =>
          resource.response_dependency === 'response_completion_descendant' &&
          resource.preparation_overlap_ms >= policy.server_precommit_probe_interval_ms
      )
      .toSorted(
        (left, right) =>
          right.preparation_overlap_ms - left.preparation_overlap_ms ||
          left.resource_kind.localeCompare(right.resource_kind)
      )[0];
    const asyncShare =
      request.async_overlap?.preparation_response_completion_delay_ms / preparationMs;
    if (
      request.async_resource_inventory?.complete === true &&
      asyncCandidate &&
      asyncShare >= policy.server_precommit_probe_parent_share
    ) {
      route = probeRoute(
        `response_linked_async_${asyncCandidate.resource_kind}`,
        `inspect_async_${asyncCandidate.resource_kind}`,
        `${round(request.async_overlap.preparation_response_completion_delay_ms)} ms of unioned response-linked async delay overlapped pre-commit; the largest retained resource kind was ${asyncCandidate.resource_kind}.`,
        ['server-response-linked-async', 'server-process-cpu']
      );
    } else {
      const phaseCandidate = (request.framework_phases ?? [])
        .map((phase) => ({
          ...phase,
          preparation_overlap_ms: Math.max(
            0,
            Math.min(preparationMs, phase.start_offset_ms + phase.duration_ms) -
              phase.start_offset_ms
          ),
        }))
        .filter(
          (phase) => phase.preparation_overlap_ms >= policy.server_precommit_probe_interval_ms
        )
        .toSorted(
          (left, right) =>
            right.preparation_overlap_ms - left.preparation_overlap_ms ||
            left.phase.localeCompare(right.phase)
        )[0];
      const phaseShare = request.framework_phase_preparation_overlap_ms / preparationMs;
      if (
        request.framework_phase_inventory?.complete === true &&
        phaseCandidate &&
        phaseShare >= policy.server_precommit_probe_parent_share
      ) {
        route = probeRoute(
          `framework_phase_${phaseCandidate.phase}`,
          `inspect_framework_phase_${phaseCandidate.phase}`,
          `${round(request.framework_phase_preparation_overlap_ms)} ms of unioned closed framework phases overlapped pre-commit; ${phaseCandidate.phase} was the largest retained phase.`,
          ['server-framework-precommit-phase', 'server-process-cpu']
        );
      } else if (
        request.async_resource_inventory?.complete !== true ||
        request.framework_phase_inventory?.complete !== true
      ) {
        route = probeRoute(
          'insufficient_evidence',
          'complete_async_and_framework_inventories',
          'Low observed process CPU did not authorize a route because async or framework evidence was incomplete.',
          ['server-process-cpu', 'server-response-boundary']
        );
      } else {
        route = probeRoute(
          'mixed_evidence',
          'capture_narrower_precommit_evidence',
          'No main-thread, async, or framework observation crossed the fixed routing thresholds.',
          ['server-process-cpu', 'server-response-boundary']
        );
      }
    }
  }
  const status = route.classification === 'insufficient_evidence' ? 'insufficient_evidence' : 'ran';
  return {
    findings: [
      createFinding({
        detector: 'browser_server_precommit_probe_route',
        kind: 'unaccounted_flow_time',
        origin: 'tool_detected',
        flow_id: capsule.root_flow_id,
        source: null,
        observed: {
          operation_count: 1,
          operation_kind: 'node_precommit_probe_route',
          operation_shape: `${request.method} ${request.route} ${route.classification}`,
          classification: route.classification,
          next_probe: route.next_probe,
          server_request_ordinal: request.ordinal,
          preparation_wall_ms: preparationMs,
          process_cpu_ms: processCpuUsable ? processCpu.preparation_cpu_ms : null,
          process_cpu_to_wall_ratio: processCpuUsable
            ? processCpu.preparation_cpu_to_wall_ratio
            : null,
          ...route.observed,
          flow_ids: [],
        },
        inference: {
          summary: route.reason,
          mechanism: 'closed_node_precommit_probe_router',
        },
        unverified: [
          'CPU samples, process CPU, async intervals, and framework phases are overlapping observations, not an exclusive decomposition.',
          'Native trace activity is elapsed overlap, not CPU time, attribution, or proof that it caused the exact other-thread CPU residual.',
          'The selected probe does not prove a worker, wait, framework, or source cause.',
        ],
        confidence: {
          level: 'low',
          basis:
            'One owned local request crossed fixed routing thresholds while retaining each observer and completeness boundary.',
        },
        expected_effect: {
          metric: 'next_supported_precommit_observation',
          direction: 'increase_confidence',
          scope: 'identical owned local browser flow',
        },
        verification: {
          required_observation: `Run ${route.next_probe} on the same exact correctness-passing flow and retain compatible evidence.`,
          rejection_condition:
            'Do not authorize a source edit or optimization from probe routing or a failed browser assertion.',
        },
        evidence_ids: route.evidence_ids,
        limitations: [
          'Sampled main-thread time is not exact or exclusive CPU time.',
          'Process CPU can include worker threads and unrelated background work.',
        ],
        eligible_for_experiment: false,
      }),
    ],
    coverage: coverage(
      'browser_server_precommit_probe_route',
      status,
      route.reason,
      route.evidence_ids
    ),
  };
}

function probeRoute(classification, nextProbe, reason, evidenceIds) {
  return { classification, next_probe: nextProbe, reason, evidence_ids: evidenceIds, observed: {} };
}

function dominantMainThreadScope(scopeTimes) {
  return ['repository', 'dependency', 'generated', 'runtime']
    .map((scope) => ({ scope, duration_ms: scopeTimes?.[scope] ?? 0 }))
    .toSorted(
      (left, right) => right.duration_ms - left.duration_ms || left.scope.localeCompare(right.scope)
    )[0];
}

function workerAwareProbeRoute(
  request,
  processCpu,
  preparationMs,
  policy,
  { fallbackSampledShare, otherThreadsCpuMs }
) {
  const worker = request.worker_cpu;
  const baseObserved = {
    worker_cpu_state: worker?.state ?? 'unavailable',
    worker_cpu_ms: Number.isFinite(worker?.total_cpu_ms) ? worker.total_cpu_ms : null,
  };
  if (!worker) {
    const route = probeRoute(
      'off_main_thread_or_background_cpu',
      'capture_worker_or_native_thread_cpu',
      `Only ${round(fallbackSampledShare * 100, 1)}% of observed process CPU was represented by retained non-idle main-thread sampled time, and no Worker observation was retained.`,
      ['server-main-thread-precommit-profile', 'server-process-cpu']
    );
    route.observed = baseObserved;
    return route;
  }
  if (worker.state === 'contaminated') {
    const route = probeRoute(
      'worker_cpu_contaminated',
      'recapture_isolated_worker_cpu',
      'Worker CPU evidence overlapped another selected dynamic request.',
      ['server-worker-cpu', 'server-process-cpu']
    );
    route.observed = baseObserved;
    return route;
  }
  if (worker.state === 'unsupported') {
    const route = probeRoute(
      'worker_cpu_unsupported',
      'capture_worker_cpu_on_supported_node',
      'The local Node runtime did not expose both parent-side Worker CPU observation APIs.',
      ['server-worker-cpu-runtime-support', 'server-process-cpu']
    );
    route.observed = baseObserved;
    return route;
  }
  if (!['observed', 'observed_zero'].includes(worker.state) || !worker.complete) {
    const route = probeRoute(
      'worker_cpu_incomplete',
      'capture_complete_worker_cpu',
      'Worker CPU evidence was incomplete, late, malformed, or unavailable and cannot be interpreted as zero activity.',
      ['server-worker-cpu', 'server-process-cpu']
    );
    route.observed = baseObserved;
    return route;
  }
  const compatible =
    Number.isFinite(worker.response_commit_offset_ms) &&
    Math.abs(worker.response_commit_offset_ms - preparationMs) <=
      policy.server_precommit_worker_interval_tolerance_ms &&
    worker.workers.every(
      (candidate) =>
        candidate.state === 'observed' &&
        candidate.start_offset_ms <= policy.server_precommit_worker_interval_tolerance_ms &&
        Math.abs(candidate.stop_offset_ms - preparationMs) <=
          policy.server_precommit_worker_interval_tolerance_ms
    );
  if (!compatible) {
    const route = probeRoute(
      'worker_cpu_incompatible_interval',
      'capture_compatible_worker_cpu_interval',
      'Worker CPU evidence did not cover a compatible pre-commit interval.',
      ['server-worker-cpu', 'server-response-boundary']
    );
    route.observed = baseObserved;
    return route;
  }
  const workerDenominator = Number.isFinite(otherThreadsCpuMs)
    ? otherThreadsCpuMs
    : processCpu.preparation_cpu_ms;
  if (Number.isFinite(otherThreadsCpuMs) && worker.total_cpu_ms > otherThreadsCpuMs + 1) {
    const route = probeRoute(
      'worker_cpu_inconsistent_partition',
      'recapture_compatible_thread_and_worker_cpu',
      'Observed Worker CPU exceeded the exact compatible other-thread CPU residual beyond tolerance.',
      ['server-worker-cpu', 'server-main-thread-cpu-partition', 'server-process-cpu']
    );
    route.observed = baseObserved;
    return route;
  }
  const workerShare = workerDenominator > 0 ? worker.total_cpu_ms / workerDenominator : 0;
  const scopes = ['repository', 'dependency', 'generated', 'runtime'];
  const scopeTimes = Object.fromEntries(scopes.map((scope) => [scope, 0]));
  let nonIdleSampledMs = 0;
  for (const observedWorker of worker.workers) {
    if (observedWorker.profile?.complete !== true) continue;
    nonIdleSampledMs += observedWorker.profile.non_idle_sampled_time_ms;
    for (const scope of scopes) {
      scopeTimes[scope] += observedWorker.profile.sample_scope_time_ms[scope];
    }
  }
  const dominant = dominantMainThreadScope(scopeTimes);
  let route;
  if (
    worker.total_cpu_ms >= policy.server_precommit_probe_interval_ms &&
    workerShare >= policy.server_precommit_worker_process_cpu_share
  ) {
    route =
      nonIdleSampledMs >= policy.server_precommit_probe_interval_ms && dominant.duration_ms > 0
        ? probeRoute(
            `worker_thread_${dominant.scope}`,
            `inspect_worker_thread_${dominant.scope}`,
            `${round(worker.total_cpu_ms)} ms of observed Worker CPU was material and ${round(dominant.duration_ms)} ms of retained non-idle Worker samples were ${dominant.scope}-scoped.`,
            ['server-worker-cpu', 'server-worker-cpu-profile', 'server-process-cpu']
          )
        : probeRoute(
            'worker_thread_unattributed',
            'capture_worker_source_profile',
            `${round(worker.total_cpu_ms)} ms of observed Worker CPU was material, but retained non-idle Worker samples did not cross the source-scope floor.`,
            ['server-worker-cpu', 'server-process-cpu']
          );
  } else {
    route = Number.isFinite(otherThreadsCpuMs)
      ? nativeAwareProbeRoute(request, preparationMs, policy)
      : probeRoute(
          'native_background_thread_or_sampling_gap',
          'capture_native_v8_libuv_thread_activity',
          `The complete public Worker inventory accounted for only ${round(workerShare * 100, 1)}% of observed process CPU, below the fixed routing threshold.`,
          ['server-worker-cpu', 'server-process-cpu', 'server-main-thread-precommit-profile']
        );
  }
  route.observed = {
    ...baseObserved,
    ...route.observed,
    worker_count: worker.inventory.retained,
    worker_to_other_threads_cpu_ratio: Number.isFinite(otherThreadsCpuMs)
      ? round(workerShare, 4)
      : null,
    worker_to_process_cpu_ratio: Number.isFinite(otherThreadsCpuMs) ? null : round(workerShare, 4),
    worker_non_idle_sampled_ms: round(nonIdleSampledMs),
    dominant_worker_scope: dominant.scope,
    dominant_worker_sampled_ms: round(dominant.duration_ms),
  };
  return route;
}

function nativeAwareProbeRoute(request, preparationMs, policy) {
  const native = request.native_activity;
  const baseObserved = {
    native_activity_state: native?.state ?? 'unavailable',
    native_threadpool_activity_ms: Number.isFinite(native?.threadpool?.union_activity_ms)
      ? native.threadpool.union_activity_ms
      : null,
    native_v8_activity_ms: Number.isFinite(native?.v8?.union_activity_ms)
      ? native.v8.union_activity_ms
      : null,
  };
  const result = (classification, nextProbe, reason, evidenceIds) => {
    const route = probeRoute(classification, nextProbe, reason, evidenceIds);
    route.observed = baseObserved;
    return route;
  };
  if (!native) {
    return result(
      'native_activity_unavailable',
      'capture_native_v8_libuv_thread_activity',
      'Exact other-thread CPU was material, but no request-scoped native activity summary was retained.',
      ['server-main-thread-cpu-partition', 'server-process-cpu']
    );
  }
  if (native.state === 'contaminated') {
    return result(
      'native_activity_contaminated',
      'recapture_isolated_native_activity',
      'Native activity tracing overlapped another selected dynamic request.',
      ['server-native-activity', 'server-main-thread-cpu-partition']
    );
  }
  if (native.state === 'unsupported') {
    return result(
      'native_activity_unsupported',
      'capture_native_activity_on_supported_node',
      'The local Node runtime did not support the bounded request-scoped trace observer.',
      ['server-native-activity-runtime-support', 'server-main-thread-cpu-partition']
    );
  }
  if (native.state === 'invalid') {
    return result(
      'native_activity_invalid',
      'recapture_valid_native_activity',
      'The private native trace failed its closed parser or evidence contract.',
      ['server-native-activity', 'server-main-thread-cpu-partition']
    );
  }
  if (!['observed', 'observed_zero'].includes(native.state) || !native.complete) {
    return result(
      'native_activity_incomplete',
      'capture_complete_native_activity',
      'Native activity evidence was incomplete and cannot be interpreted as zero activity.',
      ['server-native-activity', 'server-main-thread-cpu-partition']
    );
  }
  const compatible =
    Number.isFinite(native.response_commit_offset_ms) &&
    Math.abs(native.response_commit_offset_ms - preparationMs) <=
      policy.server_precommit_worker_interval_tolerance_ms &&
    Number.isFinite(native.interval_ms) &&
    Math.abs(native.interval_ms - preparationMs) <=
      policy.server_precommit_worker_interval_tolerance_ms;
  if (!compatible) {
    return result(
      'native_activity_incompatible_interval',
      'capture_compatible_native_activity_interval',
      'Native activity evidence did not cover a compatible pre-commit interval.',
      ['server-native-activity', 'server-response-boundary']
    );
  }
  const order = ['crypto', 'zlib', 'filesystem', 'dns', 'network', 'node_api', 'blob', 'other'];
  const dominant = native.threadpool.mechanisms
    .filter((item) => item.union_activity_ms >= policy.server_precommit_probe_interval_ms)
    .toSorted(
      (left, right) =>
        right.union_activity_ms - left.union_activity_ms ||
        order.indexOf(left.kind) - order.indexOf(right.kind)
    )[0];
  if (dominant) {
    const route = result(
      `libuv_threadpool_${dominant.kind}`,
      `inspect_libuv_threadpool_${dominant.kind}`,
      `${round(dominant.union_activity_ms)} ms of bounded libuv ${dominant.kind} execution activity overlapped the exact request interval; this selects a narrower probe but does not attribute CPU causality.`,
      ['server-native-activity', 'server-main-thread-cpu-partition', 'server-process-cpu']
    );
    route.observed = {
      ...route.observed,
      native_threadpool_mechanism: dominant.kind,
      native_threadpool_mechanism_count: dominant.count,
      native_threadpool_mechanism_activity_ms: dominant.union_activity_ms,
    };
    return route;
  }
  return result(
    'native_background_thread_or_sampling_gap',
    'capture_deeper_native_thread_cpu',
    native.state === 'observed_zero'
      ? 'A complete compatible trace observed no allowlisted native activity during material exact other-thread CPU.'
      : 'Compatible V8 or sub-threshold native activity did not explain material exact other-thread CPU; deeper native-thread CPU evidence is required.',
    ['server-native-activity', 'server-main-thread-cpu-partition', 'server-process-cpu']
  );
}

function detectBrowserServerPrecommitProcessCpu(capsule, policy) {
  const dynamic = (capsule?.browser_server?.requests ?? []).filter(
    (request) => !/^\/_next\//.test(request.route) && !/\.[a-z0-9]{1,8}$/i.test(request.route)
  );
  const complete = dynamic.filter(
    (request) =>
      request.response_timing?.complete === true &&
      request.process_cpu?.complete === true &&
      request.process_cpu.overlapping_preparation_request_count === 0 &&
      request.response_timing.preparation_ms >= policy.server_precommit_cpu_minimum_ms
  );
  const selected = complete.toSorted(
    (left, right) =>
      right.response_timing.preparation_ms - left.response_timing.preparation_ms ||
      left.ordinal - right.ordinal
  )[0];
  if (!selected) {
    return {
      findings: [],
      coverage: coverage(
        'browser_server_precommit_process_cpu',
        dynamic.some(
          (request) =>
            request.response_timing?.complete === true && request.process_cpu?.complete === true
        )
          ? 'insufficient_evidence'
          : 'unavailable',
        'No material complete non-overlapping Node pre-commit process CPU observation was retained.',
        ['owned_node_process_cpu_deltas', 'owned_node_server_response_api_boundaries']
      ),
    };
  }
  const ratio = selected.process_cpu.preparation_cpu_to_wall_ratio;
  const classification =
    ratio >= policy.server_precommit_cpu_high_ratio
      ? 'high_process_cpu'
      : ratio <= policy.server_precommit_cpu_low_ratio
        ? 'low_observed_process_cpu'
        : 'mixed_process_cpu';
  const interpretation = {
    high_process_cpu:
      'Observed process CPU was at least half of pre-commit wall time; inspect CPU or framework work next.',
    low_observed_process_cpu:
      'Observed process CPU was at most one fifth of pre-commit wall time; inspect supported async or external waits next.',
    mixed_process_cpu:
      'Observed process CPU was between the fixed low and high thresholds; a narrower probe is required.',
  };
  return {
    findings: [
      createFinding({
        detector: 'browser_server_precommit_process_cpu',
        kind: 'unaccounted_flow_time',
        origin: 'tool_detected',
        flow_id: capsule.root_flow_id,
        source: null,
        observed: {
          operation_count: 1,
          operation_kind: 'node_process_cpu_interval',
          operation_shape: `${selected.method} ${selected.route} ${classification}`,
          classification,
          preparation_wall_ms: selected.response_timing.preparation_ms,
          preparation_cpu_ms: selected.process_cpu.preparation_cpu_ms,
          preparation_user_ms: selected.process_cpu.preparation_user_ms,
          preparation_system_ms: selected.process_cpu.preparation_system_ms,
          cpu_to_wall_ratio: ratio,
          overlapping_preparation_request_count: 0,
          overlapping_request_count: selected.process_cpu.overlapping_request_count,
          flow_ids: [],
        },
        inference: {
          summary: interpretation[classification],
          mechanism: 'node_process_cpu_to_precommit_wall_classification',
        },
        unverified: [
          'Process CPU is not exclusive request CPU and can include worker threads or unrelated background work.',
          'The classification does not identify compilation, rendering, I/O, async waiting, or a source cause.',
        ],
        confidence: {
          level: 'low',
          basis:
            'Complete process CPU deltas and response boundaries crossed a fixed materiality floor without admitted request overlap.',
        },
        expected_effect: {
          metric: 'same_flow_precommit_wall_and_process_cpu',
          direction: 'decrease',
          scope: 'identical owned local browser flow',
        },
        verification: {
          required_observation:
            'Use the classification only to choose a narrower supported probe, then pass exact correctness and paired verification.',
          rejection_condition:
            'Do not authorize a source edit or claim an async, I/O, framework, or CPU cause from process-wide deltas alone.',
        },
        evidence_ids: [`server-request-${selected.ordinal}`],
        limitations: [
          'The CPU-to-wall ratio may exceed one because process CPU can include multiple threads.',
          'Zero admitted request overlap does not exclude unrelated process background work.',
        ],
        eligible_for_experiment: false,
      }),
    ],
    coverage: coverage(
      'browser_server_precommit_process_cpu',
      'ran',
      `A material non-overlapping pre-commit interval was classified as ${classification}.`,
      ['owned_node_process_cpu_deltas', 'owned_node_server_response_api_boundaries']
    ),
  };
}

function detectBrowserServerResponseInterval(capsule, policy) {
  const requests = (capsule?.browser_server?.requests ?? []).filter(
    (request) => !/^\/_next\//.test(request.route) && !/\.[a-z0-9]{1,8}$/i.test(request.route)
  );
  const complete = requests.filter((request) => request.response_timing?.complete === true);
  if (complete.length === 0) {
    return {
      findings: [],
      coverage: coverage(
        'browser_server_response_interval',
        'insufficient_evidence',
        'No complete ordered Node response-boundary partition was retained for a dynamic request.',
        ['owned_node_server_response_api_boundaries']
      ),
    };
  }
  const intervalOrder = ['response_preparation', 'response_emission', 'response_finalization'];
  const selected = complete
    .flatMap((request) => [
      {
        request,
        interval: 'response_preparation',
        duration_ms: request.response_timing.preparation_ms,
      },
      {
        request,
        interval: 'response_emission',
        duration_ms: request.response_timing.emission_ms,
      },
      {
        request,
        interval: 'response_finalization',
        duration_ms: request.response_timing.finish_tail_ms,
      },
    ])
    .filter(
      ({ request, duration_ms }) =>
        duration_ms >= policy.server_response_interval_ms &&
        request.duration_ms > 0 &&
        duration_ms / request.duration_ms >= policy.server_response_interval_parent_share
    )
    .toSorted(
      (left, right) =>
        right.duration_ms - left.duration_ms ||
        left.request.ordinal - right.request.ordinal ||
        intervalOrder.indexOf(left.interval) - intervalOrder.indexOf(right.interval)
    )[0];
  if (!selected) {
    return {
      findings: [],
      coverage: coverage(
        'browser_server_response_interval',
        'ran',
        'Complete response partitions were checked without one interval crossing both fixed thresholds.',
        ['owned_node_server_response_api_boundaries']
      ),
    };
  }
  const { request, interval, duration_ms: durationMs } = selected;
  const share = durationMs / request.duration_ms;
  const intervalDescriptions = {
    response_preparation: 'before the first response commitment call',
    response_emission: 'from first response commitment through the response.end call',
    response_finalization: 'from the response.end call through the finish event',
  };
  return {
    findings: [
      createFinding({
        detector: 'browser_server_response_interval',
        kind: 'unaccounted_flow_time',
        origin: 'tool_detected',
        flow_id: capsule.root_flow_id,
        source: null,
        observed: {
          operation_count: 1,
          operation_kind: 'node_response_api_interval',
          operation_shape: `${request.method} ${request.route} ${interval}`,
          parent_duration_ms: request.duration_ms,
          response_interval: interval,
          response_interval_ms: durationMs,
          parent_share: round(share, 4),
          flow_ids: [],
        },
        inference: {
          summary: `${round(durationMs)} ms, ${round(share * 100, 1)}% of ${request.method} ${request.route}, elapsed ${intervalDescriptions[interval]}.`,
          mechanism: 'node_server_response_api_boundary_partition',
        },
        unverified: [
          'Server response API boundaries are not browser or network TTFB, byte delivery, exclusive application work, or a source cause.',
          interval === 'response_emission'
            ? 'The emission interval can include computation, async waits, stream production, and backpressure; this observation does not distinguish them.'
            : interval === 'response_finalization'
              ? 'The finish tail does not identify socket, kernel, framework, or client ownership.'
              : 'The preparation interval does not identify framework compilation, rendering, data access, or application CPU.',
        ],
        confidence: {
          level: 'low',
          basis:
            'A complete ordered response API partition crossed fixed duration and request-share thresholds without source attribution.',
        },
        expected_effect: {
          metric: 'same_flow_response_interval_and_end_to_end_duration',
          direction: 'decrease',
          scope: 'identical owned local browser flow',
        },
        verification: {
          required_observation:
            'Show a correctness-passing paired flow reduces the same response interval and authoritative request or action duration.',
          rejection_condition:
            'Do not authorize a source edit from response API timing boundaries or a single development capture.',
        },
        evidence_ids: [`browser-server-request-${request.ordinal}-response-timing`],
        limitations: [
          'The timing partitions Node method-call intervals and not exclusive sub-operation time.',
          'The local config-disabled development runtime does not establish production frequency, latency, or impact.',
        ],
        eligible_for_experiment: false,
      }),
    ],
    coverage: coverage(
      'browser_server_response_interval',
      'ran',
      'A complete response interval crossed the fixed duration and request-share thresholds.',
      ['owned_node_server_response_api_boundaries']
    ),
  };
}

function detectBrowserServerPreflightTiming(capsule) {
  const comparison = capsule?.browser_server?.preflight_comparison;
  if (!comparison || comparison.classification === 'insufficient_evidence') {
    return {
      findings: [],
      coverage: coverage(
        'browser_server_preflight_timing',
        'insufficient_evidence',
        'No complete compatible owned-Next preflight and browser-request comparison was retained.',
        ['owned_next_preflight_wall', 'owned_node_correlated_request_wall']
      ),
    };
  }
  if (comparison.classification === 'no_material_outlier') {
    return {
      findings: [],
      coverage: coverage(
        'browser_server_preflight_timing',
        'ran',
        'The compatible preflight and browser request did not cross the fixed outlier or repeated-latency thresholds.',
        ['owned_next_preflight_wall', 'owned_node_correlated_request_wall']
      ),
    };
  }
  const summaries = {
    first_preflight_outlier: `The first local preflight took ${round(comparison.first_duration_ms)} ms versus ${round(comparison.repeat_duration_ms)} ms for the immediate repeat; the later browser-correlated request took ${round(comparison.browser_duration_ms)} ms.`,
    browser_request_outlier: `The browser-correlated request took ${round(comparison.browser_duration_ms)} ms versus ${round(comparison.repeat_duration_ms)} ms for the immediate preflight repeat.`,
    repeated_high_latency: `The immediate preflight repeat and browser-correlated request remained high at ${round(comparison.repeat_duration_ms)} ms and ${round(comparison.browser_duration_ms)} ms.`,
  };
  return {
    findings: [
      createFinding({
        detector: 'browser_server_preflight_timing',
        kind: 'unaccounted_flow_time',
        origin: 'tool_detected',
        flow_id: capsule.root_flow_id,
        source: null,
        observed: {
          operation_count: 3,
          operation_kind: 'next_preflight_request_shape',
          operation_shape: comparison.classification,
          first_duration_ms: comparison.first_duration_ms,
          repeat_duration_ms: comparison.repeat_duration_ms,
          browser_duration_ms: comparison.browser_duration_ms,
          status_class: comparison.status_class,
          flow_ids: [],
        },
        inference: {
          summary: summaries[comparison.classification],
          mechanism: 'same_runtime_preflight_timing_shape',
        },
        unverified: [
          'The timing shape does not identify framework compilation, cache behavior, exclusive work, or an application source.',
          'Two preflights and one browser request are not a latency distribution or production sample.',
        ],
        confidence: {
          level: 'low',
          basis:
            'Three compatible local wall-time observations crossed fixed coarse thresholds without source attribution.',
        },
        expected_effect: {
          metric: 'same_flow_preflight_and_browser_request_duration',
          direction: 'decrease',
          scope: 'identical owned local browser flow',
        },
        verification: {
          required_observation:
            'Repeat the exact correctness-passing flow and require a compatible timing classification plus authoritative end-to-end improvement.',
          rejection_condition:
            'Do not authorize a source edit from preflight timing shape or a single config-disabled development capture.',
        },
        evidence_ids: ['browser-server-preflight-comparison'],
        limitations: [
          'Preflight and correlated server durations use different wall-time observers.',
          'The local config-disabled development runtime does not establish production frequency, latency, or impact.',
        ],
        eligible_for_experiment: false,
      }),
    ],
    coverage: coverage(
      'browser_server_preflight_timing',
      'ran',
      'A complete compatible preflight and browser-request comparison crossed the fixed timing-shape thresholds.',
      ['owned_next_preflight_wall', 'owned_node_correlated_request_wall']
    ),
  };
}

function detectBrowserServerAsyncDelay(capsule, policy) {
  const requests = Array.isArray(capsule?.browser_server?.requests)
    ? capsule.browser_server.requests
    : [];
  const observed = requests.flatMap((request) =>
    (request.async_resources ?? []).map((resource) => ({ request, resource }))
  );
  if (observed.length === 0) {
    return {
      findings: [],
      coverage: coverage(
        'browser_server_async_delay',
        'unavailable',
        'No supported request-context async callback delay was retained.',
        ['owned_node_async_resource']
      ),
    };
  }
  const selected = observed
    .filter(({ request, resource }) => {
      const share = request.duration_ms > 0 ? resource.wait_ms / request.duration_ms : 0;
      const dependency = resource.response_dependency;
      return (
        resource.wait_ms >= policy.server_async_delay_ms &&
        dependency !== 'context_only' &&
        (dependency === 'response_completion_descendant' ||
          share >= policy.server_async_delay_parent_share) &&
        !/^\/_next\//.test(request.route)
      );
    })
    .toSorted(
      (left, right) =>
        asyncDependencyRank(left.resource.response_dependency) -
          asyncDependencyRank(right.resource.response_dependency) ||
        right.resource.wait_ms - left.resource.wait_ms ||
        left.request.ordinal - right.request.ordinal ||
        left.resource.resource_kind.localeCompare(right.resource.resource_kind)
    )[0];
  if (!selected) {
    return {
      findings: [],
      coverage: coverage(
        'browser_server_async_delay',
        'ran',
        'Response-linked and incomplete-lineage async callback delays were checked; complete context-only work was dismissed as a response bottleneck.',
        ['owned_node_async_resource']
      ),
    };
  }
  const { request, resource } = selected;
  const share = resource.wait_ms / request.duration_ms;
  const responseLinked = resource.response_dependency === 'response_completion_descendant';
  const relationshipKnown = resource.response_dependency !== 'unknown';
  const directCreator = resource.source?.provenance === 'node_async_creator_callsite';
  return {
    findings: [
      createFinding({
        detector: 'browser_server_async_delay',
        kind: 'unaccounted_flow_time',
        origin: 'tool_detected',
        flow_id: capsule.root_flow_id,
        source: resource.source,
        observed: {
          operation_count: 1,
          operation_kind: 'async_resource_delay',
          operation_shape: `${request.method} ${request.route} ${resource.resource_kind}`,
          parent_duration_ms: request.duration_ms,
          async_delay_ms: resource.wait_ms,
          callback_active_ms: resource.callback_active_ms,
          response_dependency: resource.response_dependency,
          response_end_after_callback_ms: resource.response_end_after_callback_ms,
          parent_share: round(share, 4),
          flow_ids: [],
        },
        inference: {
          summary: responseLinked
            ? `${resource.resource_kind} work created in ${request.method} ${request.route} waited ${round(resource.wait_ms)} ms before its first callback, and response finalization ran in a bounded async scheduling lineage descended from that callback.`
            : `${resource.resource_kind} work created in ${request.method} ${request.route} waited ${round(resource.wait_ms)} ms before its first callback, ${round(share * 100, 1)}% of the request interval.`,
          mechanism: responseLinked
            ? 'response_completion_async_dependency'
            : 'request_context_async_callback_delay',
        },
        unverified: [
          responseLinked
            ? 'The scheduling lineage links the callback to response.end; it does not prove JavaScript await syntax, exclusive blocking time, or a complete critical path.'
            : relationshipKnown
              ? 'The resource inherited request context but was not in the complete bounded response-finalization lineage; context alone is not awaited work.'
              : 'The bounded response-finalization lineage was incomplete or unavailable, so context and temporal overlap cannot establish a response dependency.',
          'The resource category omits filenames, hosts, addresses, delay values, callback arguments, and object state.',
        ],
        confidence: {
          level: responseLinked && resource.source ? 'medium' : 'low',
          basis:
            responseLinked && resource.source
              ? directCreator
                ? 'The callback delay, contained allowlisted public-creator call site, and bounded scheduling lineage to response.end were observed.'
                : 'The callback delay, contained creation call site, and bounded scheduling lineage to response.end were observed.'
              : responseLinked
                ? 'The bounded scheduling lineage reached response.end, but no contained creation call site was resolved.'
                : 'The callback delay was observed under request context without a source-backed response-completion dependency.',
        },
        expected_effect: {
          metric: 'same_flow_async_callback_delay_and_end_to_end_duration',
          direction: 'decrease',
          scope: 'identical owned local browser flow',
        },
        verification: {
          required_observation:
            'Show a correctness-passing paired flow reduces both the same categorized delay and authoritative request or action duration.',
          rejection_condition:
            'Do not authorize a source edit from scheduling lineage, context propagation, temporal overlap, or a single development capture alone.',
        },
        evidence_ids: [`browser-server-request-${request.ordinal}-async`],
        limitations: [
          'Delay to first callback is not exclusive wait time and may overlap other request work.',
          'The local config-disabled development runtime does not establish production frequency, latency, or impact.',
        ],
        eligible_for_experiment: false,
      }),
    ],
    coverage: coverage(
      'browser_server_async_delay',
      'ran',
      'Response-linked and incomplete-lineage async callback delays were checked; complete context-only work was dismissed as a response bottleneck.',
      [
        'owned_node_async_resource',
        'async_local_storage_parent',
        ...(relationshipKnown ? ['bounded_async_promise_lineage'] : []),
      ]
    ),
  };
}

function asyncDependencyRank(value) {
  if (value === 'response_completion_descendant') return 0;
  if (value === 'context_only') return 1;
  return 2;
}

function detectBrowserServerFrameworkPhase(capsule, policy) {
  const requests = Array.isArray(capsule?.browser_server?.requests)
    ? capsule.browser_server.requests
    : [];
  const observed = requests.flatMap((request) =>
    (request.framework_phases ?? []).map((phase) => ({ request, phase }))
  );
  if (observed.length === 0) {
    return {
      findings: [],
      coverage: coverage(
        'browser_server_framework_phase',
        'unavailable',
        'No closed framework-emitted request phase was retained.',
        ['owned_next_performance_measure']
      ),
    };
  }
  const selected = observed
    .filter(({ request, phase }) => {
      const share = request.duration_ms > 0 ? phase.duration_ms / request.duration_ms : 0;
      return (
        request.framework_phase_inventory?.complete === true &&
        phase.duration_ms >= policy.server_framework_phase_ms &&
        share >= policy.server_framework_phase_parent_share
      );
    })
    .toSorted(
      (left, right) =>
        right.phase.duration_ms - left.phase.duration_ms ||
        left.request.ordinal - right.request.ordinal ||
        left.phase.start_offset_ms - right.phase.start_offset_ms ||
        left.phase.phase.localeCompare(right.phase.phase)
    )[0];
  if (!selected) {
    const incomplete = requests.filter(
      (request) =>
        (request.framework_phase_inventory?.total ?? 0) > 0 &&
        request.framework_phase_inventory?.complete !== true
    ).length;
    return {
      findings: [],
      coverage: coverage(
        'browser_server_framework_phase',
        incomplete > 0 ? 'insufficient_evidence' : 'ran',
        incomplete > 0
          ? `${incomplete} request phase inventory or inventories were incomplete.`
          : 'Closed framework phases were checked without crossing the fixed duration and request-share thresholds.',
        ['owned_next_performance_measure']
      ),
    };
  }
  const { request, phase } = selected;
  const share = phase.duration_ms / request.duration_ms;
  return {
    findings: [
      createFinding({
        detector: 'browser_server_framework_phase',
        kind: 'unaccounted_flow_time',
        origin: 'tool_detected',
        flow_id: capsule.root_flow_id,
        source: null,
        observed: {
          operation_count: 1,
          operation_kind: 'framework_request_phase',
          operation_shape: `${request.method} ${request.route} ${phase.phase}`,
          parent_duration_ms: request.duration_ms,
          phase: phase.phase,
          phase_start_offset_ms: phase.start_offset_ms,
          phase_duration_ms: phase.duration_ms,
          parent_share: round(share, 4),
          flow_ids: [],
        },
        inference: {
          summary: `${phase.phase} occupied ${round(phase.duration_ms)} ms, ${round(share * 100, 1)}% of the observed ${request.method} ${request.route} request interval.`,
          mechanism: 'framework_emitted_request_phase',
        },
        unverified: [
          'The framework phase can contain framework and application work; it is not exclusive time and does not identify a source cause.',
          'A single config-disabled development capture does not establish that reducing this phase will improve a correct production flow.',
        ],
        confidence: {
          level: 'low',
          basis:
            'The closed framework phase and request interval were observed in one owned diagnostic execution, but no application source was attributed.',
        },
        expected_effect: {
          metric: 'same_flow_framework_phase_and_end_to_end_duration',
          direction: 'decrease',
          scope: 'identical owned local browser flow',
        },
        verification: {
          required_observation:
            'Show a correctness-passing paired flow reduces both the same framework phase and authoritative request or action duration.',
          rejection_condition:
            'Do not authorize a source edit from a framework phase name, interval overlap, or one development capture.',
        },
        evidence_ids: [`browser-server-request-${request.ordinal}-phase`],
        limitations: [
          'The phase is emitted by the local Next runtime and may change or disappear across framework versions.',
          'The local config-disabled development runtime does not establish production frequency, latency, or impact.',
        ],
        eligible_for_experiment: false,
      }),
    ],
    coverage: coverage(
      'browser_server_framework_phase',
      'ran',
      'Closed complete framework phases were checked against fixed duration and request-share thresholds.',
      ['owned_next_performance_measure', 'async_local_storage_parent']
    ),
  };
}

function detectBrowserServerCpu(capsule, policy) {
  const requests = Array.isArray(capsule?.browser_server?.requests)
    ? capsule.browser_server.requests
    : [];
  const profiles = requests.filter((request) => request.cpu !== null);
  if (profiles.length === 0) {
    return {
      findings: [],
      coverage: coverage(
        'browser_server_cpu_hotspot',
        'unavailable',
        'No bounded request-scoped V8 profile was retained.',
        ['owned_node_request_v8_profile']
      ),
    };
  }
  const candidates = profiles.flatMap((request) =>
    request.cpu?.state === 'observed'
      ? request.cpu.candidates
          .filter(
            (candidate) =>
              candidate.samples >= policy.server_cpu_minimum_samples &&
              candidate.sample_share >= policy.server_cpu_minimum_sample_share
          )
          .map((candidate) => ({ request, candidate }))
      : []
  );
  const selected = candidates.toSorted(
    (left, right) =>
      right.candidate.self_time_ms - left.candidate.self_time_ms ||
      right.candidate.samples - left.candidate.samples ||
      left.request.ordinal - right.request.ordinal ||
      left.candidate.source.file.localeCompare(right.candidate.source.file)
  )[0];
  if (!selected) {
    const contaminated = profiles.filter((request) => request.cpu?.state === 'contaminated').length;
    return {
      findings: [],
      coverage: coverage(
        'browser_server_cpu_hotspot',
        'insufficient_evidence',
        contaminated > 0
          ? `${contaminated} request profile(s) were contaminated by overlapping dynamic work.`
          : 'Request CPU samples did not cross the fixed repository sample and share thresholds.',
        ['owned_node_request_v8_profile']
      ),
    };
  }
  const { request, candidate } = selected;
  return {
    findings: [
      createFinding({
        detector: 'browser_server_cpu_hotspot',
        kind: 'application_cpu_hotspot',
        origin: 'tool_detected',
        flow_id: capsule.root_flow_id,
        source: candidate.source,
        observed: {
          operation_count: 1,
          operation_kind: 'http_server_cpu_sample',
          operation_shape: `${request.method} ${request.route}`,
          parent_duration_ms: request.duration_ms,
          profile_samples: request.cpu.total_samples,
          repository_samples: request.cpu.repository_samples,
          source_samples: candidate.samples,
          source_sample_share: candidate.sample_share,
          source_self_time_ms: candidate.self_time_ms,
          flow_ids: [],
        },
        inference: {
          summary: `${candidate.source.file}:${candidate.source.line} accounted for ${candidate.samples} isolated V8 sample(s), ${round(candidate.sample_share * 100, 1)}% of the request profile.`,
          mechanism: 'repository_cpu_inside_owned_server_request',
        },
        unverified: [
          'Sampling began immediately before handler dispatch and perturbed the diagnostic request.',
          'One local development capture does not establish production frequency, latency, scale, cache behavior, or user impact.',
        ],
        confidence: {
          level: 'medium',
          basis:
            'The source was observed in an isolated request-scoped V8 profile and resolved to a regular contained repository file.',
        },
        expected_effect: {
          metric: 'same_flow_server_repository_cpu_self_time',
          direction: 'decrease',
          scope: 'identical owned local browser flow',
        },
        verification: {
          required_observation:
            'Show a correctness-passing paired flow reduces the source samples and request or action duration under compatible runtime conditions.',
          rejection_condition:
            'Reject when profiles overlap, correctness changes, the source candidate disappears without end-to-end improvement, or runtime identity differs.',
        },
        evidence_ids: [`browser-server-request-${request.ordinal}-cpu`],
        limitations: [
          'V8 samples estimate on-CPU work; they do not measure waiting, database, network, or exclusive source-line cost.',
          'The sampled development request is diagnostic evidence, not an authoritative benchmark.',
        ],
        eligible_for_experiment: false,
      }),
    ],
    coverage: coverage(
      'browser_server_cpu_hotspot',
      'ran',
      'Isolated request-scoped V8 samples were checked against fixed repository thresholds.',
      ['owned_node_request_v8_profile', 'repository_source_resolution']
    ),
  };
}

function detectBrowserServerWork(capsule, policy) {
  const server = capsule?.browser_server;
  if (server?.state !== 'observed' || !Array.isArray(server.requests)) {
    return {
      findings: [],
      coverage: coverage(
        'browser_server_unaccounted_time',
        'unavailable',
        'No capture-scoped owned Node request evidence was retained.',
        ['owned_node_http_server']
      ),
    };
  }
  const candidates = server.requests.filter((request) => {
    const duration = request.duration_ms;
    const unaccounted = request.accounting?.unaccounted_ms;
    return (
      Number.isFinite(duration) &&
      duration > 0 &&
      Number.isFinite(unaccounted) &&
      unaccounted >= policy.unaccounted_ms &&
      unaccounted / duration >= policy.unaccounted_parent_share &&
      !/^\/_next\//.test(request.route)
    );
  });
  const request = candidates.toSorted(
    (left, right) =>
      right.accounting.unaccounted_ms - left.accounting.unaccounted_ms ||
      left.ordinal - right.ordinal
  )[0];
  if (!request) {
    return {
      findings: [],
      coverage: coverage(
        'browser_server_unaccounted_time',
        'ran',
        'Owned Node request accounting was checked against fixed unaccounted-time thresholds.',
        ['owned_node_http_server', 'async_context_child_operation']
      ),
    };
  }
  const share = request.accounting.unaccounted_ms / request.duration_ms;
  return {
    findings: [
      createFinding({
        detector: 'browser_server_unaccounted_time',
        kind: 'unaccounted_flow_time',
        origin: 'tool_detected',
        flow_id: capsule.root_flow_id,
        source: request.source?.provenance === 'node_diagnostic_callsite' ? request.source : null,
        observed: {
          operation_count: 1,
          operation_kind: 'http_server',
          operation_shape: `${request.method} ${request.route}`,
          parent_duration_ms: request.duration_ms,
          unaccounted_ms: request.accounting.unaccounted_ms,
          parent_share: round(share, 4),
          flow_ids: [],
        },
        inference: {
          summary: `${request.method} ${request.route} spent ${round(request.accounting.unaccounted_ms)} ms outside supported child database or loopback HTTP observations, ${round(share * 100, 1)}% of its server interval.`,
          mechanism: 'owned_server_handler_or_unsupported_child_work',
        },
        unverified: [
          'Unaccounted request time may include handler CPU, framework compilation, unsupported I/O, waiting, streaming, or diagnostic overhead.',
          'The local config-disabled development runtime does not establish production latency, frequency, cache behavior, or user impact.',
        ],
        confidence: {
          level: 'medium',
          basis:
            'Request duration and supported child intervals were captured in one scoped AsyncLocalStorage context; the residual mechanism is not attributed.',
        },
        expected_effect: {
          metric: 'same_flow_server_request_unaccounted_ms',
          direction: 'decrease',
          scope: 'identical owned local browser flow',
        },
        verification: {
          required_observation:
            'Add or resolve bounded handler evidence, then show an identical correctness-passing paired flow reduces both request residual and browser action duration.',
          rejection_condition:
            'Do not authorize a source edit from residual time alone or when flow assertions, runtime configuration, or request identity differ.',
        },
        evidence_ids: [`browser-server-request-${request.ordinal}`],
        limitations: [
          'Residual accounting is an observed gap, not exclusive handler CPU or source causation.',
          ...(request.source?.provenance === 'static_unique_next_route'
            ? [
                `${request.source.file}:${request.source.line} is the unique static Next route owner, not a captured runtime call site.`,
              ]
            : []),
        ],
        eligible_for_experiment: false,
      }),
    ],
    coverage: coverage(
      'browser_server_unaccounted_time',
      'ran',
      'Owned Node request accounting was checked against fixed unaccounted-time thresholds.',
      ['owned_node_http_server', 'async_context_child_operation']
    ),
  };
}

function detectBrowserMainThread(capsule, flows, policy) {
  const evidence = capsule?.browser_main_thread;
  if (!evidence) {
    const reason = 'The exact browser flow contains no bounded Chromium main-thread evidence.';
    return {
      findings: [],
      coverage: [
        coverage('browser_javascript_cpu_hotspot', 'unavailable', reason, ['browser_v8_profile']),
        coverage('browser_main_thread_long_task', 'unavailable', reason, [
          'browser_main_thread_task',
        ]),
        coverage('browser_original_source_map', 'unavailable', reason, [
          'browser_inline_source_map',
        ]),
      ],
    };
  }
  const findings = [];
  const longTaskFlows = flows.filter(
    (flow) =>
      flow.kind === 'browser_main_thread_task' &&
      flow.timing?.duration_ms >= policy.browser_long_task_ms
  );
  const observedLongTasks = (evidence.long_tasks ?? []).filter(
    (task) => task.duration_ms >= policy.browser_long_task_ms
  );
  if (observedLongTasks.length > 0) {
    const ordered = observedLongTasks.toSorted(
      (left, right) =>
        right.duration_ms - left.duration_ms || left.started_at_ms - right.started_at_ms
    );
    findings.push(
      createFinding({
        detector: 'browser_main_thread_long_task',
        kind: 'browser_main_thread_long_task',
        origin: 'tool_detected',
        flow_id: capsule.root_flow_id,
        source: null,
        observed: {
          operation_count: observedLongTasks.length,
          total_duration_ms: round(
            observedLongTasks.reduce((total, task) => total + task.duration_ms, 0)
          ),
          max_duration_ms: round(ordered[0].duration_ms),
          operation_kind: 'browser_main_thread_task',
          operation_shape: 'Browser main-thread task',
          flow_ids: longTaskFlows.map((flow) => flow.id).toSorted(),
        },
        inference: {
          summary: `${observedLongTasks.length} renderer main-thread task${observedLongTasks.length === 1 ? '' : 's'} crossed ${policy.browser_long_task_ms} ms; the largest took ${round(ordered[0].duration_ms)} ms.`,
          mechanism: 'browser_main_thread_blocking_interval',
        },
        unverified: [
          'A long renderer task may contain application JavaScript, framework work, style/layout, paint, garbage collection, or browser instrumentation.',
          'Local task duration does not establish production frequency, responsiveness, or user impact.',
        ],
        confidence: {
          level: 'high',
          basis: 'Top-level task duration was observed directly on Chromium CrRendererMain.',
        },
        expected_effect: {
          metric: 'same_flow_max_renderer_main_thread_task_ms',
          direction: 'decrease',
          scope: 'identical attested local browser flow',
        },
        verification: {
          required_observation:
            'A source candidate lowers maximum and total long-task duration in an identical paired flow while assertions pass.',
          rejection_condition:
            'Do not authorize a source optimization until repository CPU or phase evidence identifies a plausible owned mechanism.',
        },
        evidence_ids: evidenceIdsForFlows(longTaskFlows),
        limitations: [
          'Long-task evidence identifies blocked main-thread intervals, not source causation.',
        ],
        eligible_for_experiment: false,
      })
    );
  }

  const candidate = evidence.profile?.candidates?.[0];
  const cpuQualified = Boolean(
    candidate &&
      candidate.sample_count >= policy.browser_cpu_minimum_samples &&
      candidate.sample_share >= policy.browser_cpu_minimum_sample_share
  );
  if (cpuQualified) {
    const originalSourceVerified = candidate.provenance === 'browser_inline_source_map_verified';
    const source = {
      file: candidate.file,
      line: candidate.line,
      function: candidate.function,
      provenance: candidate.provenance,
    };
    const attested = evidence.server_identity === 'verified_by_declared_process';
    findings.push(
      createFinding({
        detector: 'browser_javascript_cpu_hotspot',
        kind: 'browser_javascript_cpu_hotspot',
        origin: 'tool_detected',
        flow_id: capsule.root_flow_id,
        source,
        observed: {
          cpu_self_time_ms: candidate.self_time_ms,
          cpu_sample_count: candidate.sample_count,
          cpu_sample_share: candidate.sample_share,
          operation_kind: 'browser_javascript',
          operation_shape: candidate.function ?? '<anonymous>',
          flow_ids: [capsule.root_flow_id],
        },
        inference: {
          summary: `${candidate.file}:${candidate.line} is the leading repository-owned sampled browser JavaScript candidate.`,
          mechanism: 'repository_browser_javascript_cpu_path',
        },
        unverified: [
          'V8 CPU sampling is approximate and may miss short or distributed work.',
          ...(originalSourceVerified
            ? []
            : [
                'The served browser line may be transformed; original TypeScript attribution requires a separately proven source map.',
              ]),
          'Local browser CPU does not establish production frequency or user impact.',
        ],
        confidence: {
          level: attested && originalSourceVerified ? 'high' : attested ? 'medium' : 'low',
          basis:
            attested && originalSourceVerified
              ? 'A content-identical inline source map resolved material browser samples to current repository source in an attested local flow.'
              : attested
                ? 'A repository-contained browser URL crossed fixed sample count/share floors in an attested local flow.'
                : 'Repository-contained browser samples crossed fixed floors, but local server identity was not verified.',
        },
        expected_effect: {
          metric: 'same_flow_repository_browser_cpu_sample_share',
          direction: 'decrease',
          scope: 'identical attested local browser flow',
        },
        verification: {
          required_observation:
            'Correctness passes and an identical paired browser flow reduces candidate sample share plus long-task or flow duration.',
          rejection_condition:
            'Reject if server identity is unverified, correctness differs, only sample share moves, or end-to-end timing does not materially improve.',
        },
        evidence_ids: ['chromium-v8-profile'],
        limitations: [
          originalSourceVerified
            ? 'Original source identity is proven for this local transformed response; production representativeness remains unverified.'
            : 'Source attribution is a repository-contained transformed browser URL, not a proven original source-map location.',
        ],
        eligible_for_experiment: attested,
      })
    );
  }
  return {
    findings,
    coverage: [
      coverage(
        'browser_javascript_cpu_hotspot',
        evidence.profile?.sample_count > 0 ? 'ran' : 'unavailable',
        evidence.profile?.sample_count > 0
          ? 'Bounded Chromium V8 samples were checked for repository-contained browser source candidates.'
          : 'The Chromium trace contained no bounded V8 samples.',
        ['browser_source_url', 'browser_v8_profile']
      ),
      coverage(
        'browser_main_thread_long_task',
        evidence.renderer_main_thread_count > 0 ? 'ran' : 'unavailable',
        evidence.renderer_main_thread_count > 0
          ? 'Top-level Chromium renderer-main-thread tasks were checked against the fixed long-task threshold.'
          : 'The Chromium trace identified no renderer main thread.',
        ['browser_main_thread_task']
      ),
      originalSourceMapCoverage(evidence),
    ],
  };
}

function originalSourceMapCoverage(evidence) {
  const summary = evidence.profile?.source_map;
  if (summary?.verified_candidates > 0) {
    return coverage(
      'browser_original_source_map',
      'ran',
      `${summary.verified_candidates} browser CPU candidate(s) mapped to content-identical current repository source.`,
      ['browser_inline_source_map', 'repository_source_identity']
    );
  }
  if (summary?.candidate_count > 0) {
    return coverage(
      'browser_original_source_map',
      'insufficient_evidence',
      'Repository browser CPU candidates existed, but no content-identical inline source map was verified.',
      ['browser_inline_source_map', 'repository_source_identity']
    );
  }
  return coverage(
    'browser_original_source_map',
    'unavailable',
    'No repository browser CPU candidate was available for original-source mapping.',
    ['browser_inline_source_map']
  );
}

function detectBrowserNetworkOperations(
  flows,
  flowById,
  policy,
  expectedHttpStatuses,
  runtimeConfiguration
) {
  const network = flows.filter(
    (flow) =>
      flow.kind === 'http_client' &&
      typeof flow.attributes?.method === 'string' &&
      typeof flow.attributes?.route === 'string'
  );
  if (network.length === 0) {
    const reason = 'The Playwright trace contains no normalized browser network operations.';
    return {
      findings: [],
      coverage: BROWSER_NETWORK_DETECTORS.map((detector) =>
        coverage(detector, 'unavailable', reason, ['http_client'])
      ),
    };
  }

  const findings = [];
  const successfulApplicationNetwork = network.filter(
    (flow) =>
      flow.attributes.status >= 200 &&
      flow.attributes.status < 400 &&
      !isBrowserDevelopmentResource(flow.attributes.route, runtimeConfiguration)
  );
  for (const group of groupNetworkOperations(
    network.filter(
      (flow) =>
        flow.attributes.status >= 400 &&
        flow.attributes.status <= 599 &&
        !expectedBrowserStatus(flow, expectedHttpStatuses)
    )
  ).values()) {
    const ordered = stableFlows(group);
    const parent = flowById.get(ordered[0].parent_flow_id);
    const observed = networkObservation(ordered, parent);
    findings.push(
      createFinding({
        detector: 'failed_network_operation',
        kind: 'failed_network_operation',
        origin: 'tool_detected',
        flow_id: ordered[0].parent_flow_id ?? ordered[0].id,
        source: sharedSource(ordered),
        observed,
        inference: {
          summary: `${ordered.length} exact browser request${ordered.length === 1 ? '' : 's'} ended in an observed error state.`,
          mechanism: 'observed_browser_network_failure',
        },
        unverified: [
          'The trace does not prove whether remote-denial policy, application behavior, or the destination caused the failure.',
          'A failed resource does not by itself establish material user-visible performance impact.',
        ],
        confidence: {
          level: 'high',
          basis:
            'Request identity, status, outcome, and interval were captured in the exact browser trace.',
        },
        expected_effect: {
          metric: 'same_flow_failed_network_operation_count',
          direction: 'decrease',
          scope: 'identical attested local browser flow',
        },
        verification: {
          required_observation:
            'The identical attested flow completes with fewer matching failed requests and unchanged assertions.',
          rejection_condition:
            'Do not optimize if the failure is an intentional policy denial, expected fallback, or immaterial to the flow.',
        },
        evidence_ids: evidenceIdsForFlows(ordered),
        limitations: networkLimitations(ordered),
        eligible_for_experiment: false,
      })
    );
  }

  const repeatedByParent = new Map();
  for (const group of groupNetworkOperations(successfulApplicationNetwork).values()) {
    if (group.length < policy.repeated_network_count) continue;
    const ordered = stableFlows(group);
    const parentId = ordered[0].parent_flow_id ?? ordered[0].id;
    const repeated = repeatedByParent.get(parentId) ?? [];
    repeated.push(ordered);
    repeatedByParent.set(parentId, repeated);
  }
  for (const [parentId, repeatedGroups] of repeatedByParent) {
    const ordered = stableFlows(repeatedGroups.flat());
    const parent = flowById.get(parentId);
    const groupedShapes = repeatedGroups.length;
    const observed =
      groupedShapes === 1
        ? networkObservation(ordered, parent)
        : repeatedNetworkClusterObservation(ordered, parent, groupedShapes);
    findings.push(
      createFinding({
        detector: 'repeated_network_operation',
        kind: 'repeated_network_operation',
        origin: 'tool_detected',
        flow_id: parentId,
        source: groupedShapes === 1 ? sharedSource(ordered) : null,
        observed,
        inference: {
          summary:
            groupedShapes === 1
              ? `One exact browser request shape ran ${ordered.length} times in the same flow.`
              : `${groupedShapes} exact browser request shapes repeated across ${ordered.length} requests in the same flow.`,
          mechanism:
            groupedShapes === 1
              ? 'possible_redundant_browser_request'
              : 'possible_browser_reload_or_duplicate_fetch_cluster',
        },
        unverified: [
          'Repeated request identity does not prove the responses, initiators, or cache semantics are equivalent.',
          'The requests may be required by polling, pagination, retries, or product behavior.',
        ],
        confidence: {
          level: 'medium',
          basis:
            'The exact bounded request shape and count are observed; semantic redundancy is not.',
        },
        expected_effect: {
          metric: 'same_flow_matching_network_operation_count',
          direction: 'decrease',
          scope: 'identical attested local browser flow',
        },
        verification: {
          required_observation:
            'A bounded cache or deduplication experiment lowers the exact request count and paired flow duration while assertions pass.',
          rejection_condition:
            'Reject if response semantics differ, freshness changes, request count is unchanged, or timing is not materially better.',
        },
        evidence_ids: evidenceIdsForFlows(ordered),
        limitations: networkLimitations(ordered),
        eligible_for_experiment: false,
      })
    );
  }

  const byParent = new Map();
  for (const flow of successfulApplicationNetwork) {
    if (!flow.parent_flow_id) continue;
    const siblings = byParent.get(flow.parent_flow_id) ?? [];
    siblings.push(flow);
    byParent.set(flow.parent_flow_id, siblings);
  }
  for (const [parentId, siblings] of byParent) {
    const parent = flowById.get(parentId);
    if (!Number.isFinite(parent?.timing?.duration_ms) || parent.timing.duration_ms <= 0) continue;
    const slowest = siblings.toSorted(
      (left, right) =>
        right.timing.duration_ms - left.timing.duration_ms || left.id.localeCompare(right.id)
    )[0];
    const share = slowest.timing.duration_ms / parent.timing.duration_ms;
    if (
      slowest.timing.duration_ms < policy.dominant_network_ms ||
      share < policy.dominant_network_parent_share
    ) {
      continue;
    }
    findings.push(
      createFinding({
        detector: 'dominant_network_operation',
        kind: 'dominant_network_operation',
        origin: 'tool_detected',
        flow_id: parentId,
        source: slowest.attributes?.source ?? null,
        observed: networkObservation([slowest], parent),
        inference: {
          summary: `The slowest local browser request took ${round(slowest.timing.duration_ms)} ms, ${round(share * 100, 1)}% of its parent interval.`,
          mechanism: 'local_network_duration_candidate',
        },
        unverified: [
          'Duration share does not prove the request is on the navigation critical path.',
          'Local fixture timing does not establish production latency, frequency, cache behavior, or user impact.',
        ],
        confidence: {
          level: 'medium',
          basis:
            'The local interval and parent share are observed; causal and production relevance are not.',
        },
        expected_effect: {
          metric: 'same_flow_matching_network_duration_ms',
          direction: 'decrease',
          scope: 'paired identical attested local browser flow',
        },
        verification: {
          required_observation:
            'An identical paired local flow materially reduces both this request interval and overall navigation without behavior changes.',
          rejection_condition:
            'Reject if only isolated request timing moves, overall navigation does not improve, or assertions differ.',
        },
        evidence_ids: evidenceIdsForFlows([slowest]),
        limitations: networkLimitations([slowest]),
        eligible_for_experiment: false,
      })
    );
  }

  return {
    findings,
    coverage: [
      coverage(
        'dominant_network_operation',
        'ran',
        'Browser request duration and parent share were checked against fixed local thresholds.',
        ['http_client', 'navigation']
      ),
      coverage(
        'failed_network_operation',
        'ran',
        'Browser request outcomes were grouped by exact bounded request shape.',
        ['http_client']
      ),
      coverage(
        'repeated_network_operation',
        'ran',
        'Browser requests were grouped by exact bounded request shape and parent flow.',
        ['http_client']
      ),
    ],
  };
}

function expectedBrowserStatus(flow, expected) {
  return expected.some(
    (entry) =>
      entry?.method === flow.attributes.method &&
      entry?.route === flow.attributes.route &&
      entry?.status === flow.attributes.status
  );
}

function isBrowserDevelopmentResource(route, runtimeConfiguration) {
  if (/^(?:\/@(?:vite|id|fs)\/|\/node_modules\/)/.test(route)) return true;
  return (
    runtimeConfiguration === 'codevetter_config_disabled' &&
    /^\/_next\/(?:static\/|webpack-hmr(?:\?|$))/.test(route)
  );
}

function groupNetworkOperations(flows) {
  const groups = new Map();
  for (const flow of flows) {
    const key = [
      flow.parent_flow_id ?? '<root>',
      flow.attributes.method,
      flow.attributes.network_scope ?? '<unknown>',
      flow.attributes.host ?? '<none>',
      flow.attributes.route,
      flow.attributes.request_identity_sha256 ?? '<route-only>',
      flow.attributes.status ?? '<none>',
    ].join('\u0000');
    const group = groups.get(key) ?? [];
    group.push(flow);
    groups.set(key, group);
  }
  return groups;
}

function stableFlows(flows) {
  return flows.toSorted(
    (left, right) =>
      (left.timing?.started_at_ms ?? 0) - (right.timing?.started_at_ms ?? 0) ||
      left.id.localeCompare(right.id)
  );
}

function networkObservation(flows, parent) {
  const observed = operationObservation(flows, parent);
  return {
    ...observed,
    status: flows[0].attributes?.status ?? null,
    network_scope: flows[0].attributes?.network_scope ?? 'invalid',
    host: flows[0].attributes?.host ?? null,
  };
}

function repeatedNetworkClusterObservation(flows, parent, groupedShapes) {
  const observed = operationObservation(flows, parent);
  const scopes = [...new Set(flows.map((flow) => flow.attributes?.network_scope))];
  return {
    ...observed,
    operation_shape: `${groupedShapes} repeated request shapes`,
    network_scope: scopes.length === 1 ? scopes[0] : 'invalid',
    host: null,
  };
}

function networkLimitations(flows) {
  return [
    ...(sharedSource(flows)
      ? ['The source is an exact static URL literal, not a captured runtime JavaScript callsite.']
      : ['The trace did not capture one shared repository source anchor for this request shape.']),
    'Browser network timing is local and machine-relative.',
  ];
}

function detectRepeatedDatabaseOperations(flows, flowById, policy) {
  const databaseFlows = flows.filter(
    (flow) => flow.kind === 'database' && typeof flow.attributes?.statement === 'string'
  );
  if (databaseFlows.length === 0) {
    const reason = 'The capsule contains no request-scoped database operations.';
    return {
      findings: [],
      coverage: [
        coverage('n_plus_one_shape', 'unavailable', reason, ['database']),
        coverage('repeated_database_operation', 'unavailable', reason, ['database']),
      ],
    };
  }

  const groups = new Map();
  for (const flow of databaseFlows) {
    const key = [
      flow.parent_flow_id ?? '<root>',
      flow.attributes.database ?? '<unknown>',
      flow.attributes.operation ?? '<unknown>',
      flow.attributes.statement,
    ].join('\u0000');
    const group = groups.get(key) ?? [];
    group.push(flow);
    groups.set(key, group);
  }

  const repeatedFindings = [];
  const nPlusOneFindings = [];
  for (const group of groups.values()) {
    if (group.length < policy.repeated_operation_count) continue;
    const ordered = group.toSorted((left, right) => left.id.localeCompare(right.id));
    const parent = flowById.get(ordered[0].parent_flow_id);
    const source = sharedSource(ordered);
    const observed = operationObservation(ordered, parent);
    const evidenceIds = evidenceIdsForFlows(ordered);
    const common = {
      origin: 'tool_detected',
      flow_id: parent?.id ?? ordered[0].parent_flow_id ?? ordered[0].id,
      source,
      observed,
      evidence_ids: evidenceIds,
      limitations: source
        ? []
        : ['The database adapter did not capture a repository source callsite.'],
      eligible_for_experiment: Boolean(source),
    };
    repeatedFindings.push(
      createFinding({
        ...common,
        detector: 'repeated_database_operation',
        kind: 'repeated_database_operation',
        inference: {
          summary: `One normalized database operation ran ${group.length} times within the same parent flow.`,
          mechanism: 'repeated_database_round_trips',
        },
        unverified: [
          'The operations may be required by transaction, consistency, or ordering semantics.',
          'Local diagnostic duration does not establish production database latency.',
        ],
        confidence: {
          level: source ? 'high' : 'medium',
          basis:
            'The operation count and normalized statement shape were captured directly in one request context.',
        },
        expected_effect: {
          metric: 'same_flow_database_operation_count',
          direction: 'decrease',
          scope: 'identical local flow',
        },
        verification: {
          required_observation:
            'The identical flow executes fewer matching database operations and all correctness checks pass.',
          rejection_condition:
            'Reject if query count is unchanged, correctness changes, or another protected resource regresses.',
        },
      })
    );

    if (looksLikeNPlusOne(ordered[0])) {
      nPlusOneFindings.push(
        createFinding({
          ...common,
          detector: 'n_plus_one_shape',
          kind: 'n_plus_one_shape',
          inference: {
            summary: `A SELECT-shaped operation repeated ${group.length} times under one parent flow, matching an N+1 access shape.`,
            mechanism: 'possible_n_plus_one_query_pattern',
          },
          unverified: [
            'Normalized statement repetition does not prove the calls load distinct entities or can be batched.',
            'Source inspection or a bounded batching experiment must confirm semantic equivalence.',
          ],
          confidence: {
            level: 'medium',
            basis:
              'The repeated SELECT shape is observed; the N+1 interpretation is deterministic but semantic independence is unverified.',
          },
          expected_effect: {
            metric: 'same_flow_select_operation_count',
            direction: 'decrease',
            scope: 'identical local flow',
          },
          verification: {
            required_observation:
              'A batch or preload candidate lowers the repeated SELECT count while returning equivalent results.',
            rejection_condition:
              'Reject if results, ordering, transaction behavior, or correctness checks differ.',
          },
        })
      );
    }
  }

  return {
    findings: [...repeatedFindings, ...nPlusOneFindings],
    coverage: [
      coverage(
        'n_plus_one_shape',
        'ran',
        'Request-scoped database statements were grouped by normalized shape.',
        ['database']
      ),
      coverage(
        'repeated_database_operation',
        'ran',
        'Request-scoped database statements were grouped by normalized shape.',
        ['database']
      ),
    ],
  };
}

function detectSerializedOperations(flows, flowById, policy) {
  const candidates = flows.filter((flow) => ['database', 'http_client'].includes(flow.kind));
  if (candidates.length === 0) {
    return {
      findings: [],
      coverage: coverage(
        'serialized_operations',
        'unavailable',
        'The capsule contains no database or outbound HTTP child operations.',
        ['database', 'http_client']
      ),
    };
  }
  const byParent = new Map();
  for (const flow of candidates) {
    if (!flow.parent_flow_id || !Number.isFinite(flow.timing?.started_at_ms)) continue;
    const siblings = byParent.get(flow.parent_flow_id) ?? [];
    siblings.push(flow);
    byParent.set(flow.parent_flow_id, siblings);
  }
  const findings = [];
  for (const [parentId, siblings] of byParent) {
    const ordered = siblings.toSorted(
      (left, right) => left.timing.started_at_ms - right.timing.started_at_ms
    );
    if (ordered.length < policy.serialized_operation_count || !isFullySerialized(ordered)) {
      continue;
    }
    const total = ordered.reduce((sum, flow) => sum + flow.timing.duration_ms, 0);
    const parent = flowById.get(parentId);
    const parentDuration = parent?.timing?.duration_ms;
    const share =
      Number.isFinite(parentDuration) && parentDuration > 0 ? total / parentDuration : 0;
    if (total < policy.serialized_combined_ms || share < policy.serialized_parent_share) continue;
    const source = sharedSource(ordered);
    findings.push(
      createFinding({
        detector: 'serialized_operations',
        kind: 'serialized_operations',
        origin: 'tool_detected',
        flow_id: parentId,
        source,
        observed: operationObservation(ordered, parent),
        inference: {
          summary: `${ordered.length} sibling I/O operations ran without overlap and consumed ${round(total)} ms in one parent flow.`,
          mechanism: 'possible_serial_io_on_critical_path',
        },
        unverified: [
          'The operations may have data, transaction, rate-limit, or ordering dependencies.',
          'Non-overlap does not prove that parallel execution is safe or beneficial.',
        ],
        confidence: {
          level: 'low',
          basis:
            'Serialization and duration are observed, but independence is not available from runtime timing alone.',
        },
        expected_effect: {
          metric: 'same_flow_critical_path_duration',
          direction: 'decrease',
          scope: 'identical local flow',
        },
        verification: {
          required_observation:
            'After independence is established, a bounded concurrency candidate reduces paired wall time without changing behavior.',
          rejection_condition:
            'Reject if operations are dependent, ordering changes, errors increase, or paired timing is not materially better.',
        },
        evidence_ids: evidenceIdsForFlows(ordered),
        limitations: [
          ...(source
            ? []
            : ['The operation adapter did not capture a shared repository source callsite.']),
          'Semantic independence requires source or domain confirmation.',
        ],
        eligible_for_experiment: false,
      })
    );
  }
  return {
    findings,
    coverage: coverage(
      'serialized_operations',
      'ran',
      'Sibling database and outbound HTTP intervals were checked for non-overlap.',
      ['database', 'http_client']
    ),
  };
}

function detectRepeatedApplicationWork(capsule) {
  const candidate = capsule?.function_analysis?.repeated_work_candidate;
  const coverageAvailable =
    Number.isInteger(capsule?.function_analysis?.observed_function_count) &&
    capsule.function_analysis.observed_function_count > 0;
  if (!coverageAvailable) {
    return {
      findings: [],
      coverage: coverage(
        'repeated_application_work',
        'unavailable',
        'The exact flow contains no normalized function-frequency evidence.',
        ['function_coverage', 'cpu_profile']
      ),
    };
  }
  if (!candidate) {
    return {
      findings: [],
      coverage: coverage(
        'repeated_application_work',
        'ran',
        'Function frequency was available but did not intersect repository-owned CPU evidence.',
        ['function_coverage', 'cpu_profile']
      ),
    };
  }
  const source = {
    file: candidate.file,
    line: candidate.start_line,
    function: candidate.function,
    provenance: 'v8_function_coverage_and_cpu_profile',
  };
  return {
    findings: [
      createFinding({
        detector: 'repeated_application_work',
        kind: 'repeated_application_work',
        origin: 'tool_detected',
        flow_id: capsule.root_flow_id,
        source,
        observed: {
          call_count: candidate.call_count,
          cpu_self_time_ms: candidate.cpu_evidence.self_time_ms,
          operation_kind: 'application_function',
          operation_shape: candidate.function,
          flow_ids: [capsule.root_flow_id],
        },
        inference: {
          summary: `${candidate.function} ran ${candidate.call_count} times and intersects repository CPU evidence.`,
          mechanism: 'possible_repeated_application_computation',
        },
        unverified: [
          'Function coverage assigns call frequency but not per-call duration.',
          'The repeated calls may be necessary for the workload semantics.',
        ],
        confidence: {
          level: 'medium',
          basis:
            'Named function frequency and CPU sampling intersect in the same repository source region.',
        },
        expected_effect: {
          metric: 'same_flow_function_call_count',
          direction: 'decrease',
          scope: 'identical local flow',
        },
        verification: {
          required_observation:
            'A caching or incremental-work candidate lowers both call count and paired wall time while correctness passes.',
          rejection_condition:
            'Reject if only call count changes, paired wall time is not materially better, or behavior differs.',
        },
        evidence_ids: [...new Set(candidate.evidence_ids)].toSorted(),
        limitations: ['The CPU profile is sampled and does not assign complete function duration.'],
        eligible_for_experiment: true,
      }),
    ],
    coverage: coverage(
      'repeated_application_work',
      'ran',
      'Function frequency was joined with repository-owned CPU evidence.',
      ['function_coverage', 'cpu_profile']
    ),
  };
}

function detectUnaccountedFlowTime(flows, policy) {
  const accounted = flows.filter((flow) =>
    Number.isFinite(flow.timing?.accounting?.unaccounted_ms)
  );
  if (accounted.length === 0) {
    return {
      findings: [],
      coverage: coverage(
        'unaccounted_flow_time',
        'unavailable',
        'No parent flow has same-execution child interval accounting.',
        ['flow_timing']
      ),
    };
  }
  const findings = [];
  for (const flow of accounted) {
    const unaccounted = flow.timing.accounting.unaccounted_ms;
    const share = flow.timing.duration_ms > 0 ? unaccounted / flow.timing.duration_ms : 0;
    if (unaccounted < policy.unaccounted_ms || share < policy.unaccounted_parent_share) continue;
    findings.push(
      createFinding({
        detector: 'unaccounted_flow_time',
        kind: 'unaccounted_flow_time',
        origin: 'tool_detected',
        flow_id: flow.id,
        source: null,
        observed: {
          unaccounted_ms: unaccounted,
          parent_duration_ms: flow.timing.duration_ms,
          duration_share: round(share, 4),
          operation_kind: flow.kind,
          operation_shape: flow.name,
          flow_ids: [flow.id],
        },
        inference: {
          summary: `${round(unaccounted)} ms (${round(share * 100, 1)}%) of the flow is not explained by captured child operations.`,
          mechanism: 'instrumentation_depth_gap',
        },
        unverified: [
          'The unaccounted interval may contain application CPU, unsupported I/O, scheduler wait, or instrumentation gaps.',
        ],
        confidence: {
          level: 'high',
          basis:
            'Unaccounted time is computed from same-execution child interval union; its cause is not inferred.',
        },
        expected_effect: {
          metric: 'captured_flow_coverage',
          direction: 'increase',
          scope: 'diagnostic execution only',
        },
        verification: {
          required_observation:
            'A deeper adapter explains a larger portion of the same flow without changing the unprofiled baseline.',
          rejection_condition:
            'Do not authorize a source optimization until the missing boundary is observed.',
        },
        evidence_ids: evidenceIdsForFlows([flow]),
        limitations: [
          'This is an instrumentation finding, not evidence that application code is slow.',
        ],
        eligible_for_experiment: false,
      })
    );
  }
  return {
    findings,
    coverage: coverage(
      'unaccounted_flow_time',
      'ran',
      'Same-execution child interval accounting was available.',
      ['flow_timing']
    ),
  };
}

function coverage(detector, status, reason, evidenceKinds) {
  return { detector, status, reason, evidence_kinds: [...evidenceKinds].toSorted() };
}

function operationObservation(flows, parent) {
  const total = flows.reduce((sum, flow) => sum + flow.timing.duration_ms, 0);
  const maximum = flows.reduce((value, flow) => Math.max(value, flow.timing.duration_ms), 0);
  const parentDuration = parent?.timing?.duration_ms;
  return {
    operation_count: flows.length,
    total_duration_ms: round(total),
    max_duration_ms: round(maximum),
    ...(Number.isFinite(parentDuration)
      ? {
          parent_duration_ms: parentDuration,
          duration_share: parentDuration > 0 ? round(total / parentDuration, 4) : 0,
        }
      : {}),
    operation_kind: flows[0].kind,
    operation_shape:
      flows[0].attributes?.statement ??
      (`${flows[0].attributes?.method ?? ''} ${flows[0].attributes?.route ?? ''}`.trim() ||
        flows[0].name),
    flow_ids: flows
      .map((flow) => flow.id)
      .toSorted()
      .slice(0, FINDING_LIMITS.flowIds),
  };
}

function evidenceIdsForFlows(flows) {
  return [...new Set(flows.flatMap((flow) => flow.evidence_ids ?? []))]
    .toSorted()
    .slice(0, FINDING_LIMITS.evidenceIds);
}

function sharedSource(flows) {
  const sources = flows.map((flow) => flow.attributes?.source).filter(Boolean);
  if (sources.length !== flows.length) return null;
  const first = sources[0];
  if (
    !sources.every(
      (source) =>
        source.file === first.file &&
        source.line === first.line &&
        (source.function ?? null) === (first.function ?? null)
    )
  ) {
    return null;
  }
  return { ...first };
}

function looksLikeNPlusOne(flow) {
  const statement = flow.attributes?.statement?.trim().toUpperCase() ?? '';
  return ['get', 'all'].includes(flow.attributes?.operation) && statement.startsWith('SELECT ');
}

function isFullySerialized(flows) {
  for (let index = 1; index < flows.length; index += 1) {
    const previousEnd = flows[index - 1].timing.started_at_ms + flows[index - 1].timing.duration_ms;
    if (flows[index].timing.started_at_ms < previousEnd) return false;
  }
  return true;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
