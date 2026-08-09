import { FLOW_SCHEMA_VERSION, validateFlowCapsule } from './contracts.mjs';
import { normalizeNodeFlowEvents } from './flow-capture.mjs';
import { diagnosePerformanceRepository } from './performance-diagnosis.mjs';
import { profileRepository } from './performance.mjs';

export async function captureFlowRepository(options) {
  const performanceCapsule = await profileRepository({ ...options, captureFlow: true });
  const diagnosis = await diagnosePerformanceRepository(performanceCapsule, options.repositoryRoot);
  return createFlowCapsule(performanceCapsule, diagnosis);
}

export function createFlowCapsule(performanceCapsule, diagnosis) {
  const normalized = normalizeNodeFlowEvents(
    performanceCapsule.observed.flow_evidence?.events,
    performanceCapsule.observed.wall_time_ms?.median
  );
  normalized.flows[0].name = performanceCapsule.scope.name ?? performanceCapsule.scope.target;
  const flowLimitations = performanceCapsule.observed.flow_evidence?.limitations ?? [];
  const limitations = [
    ...new Set([...performanceCapsule.limitations, ...diagnosis.limitations, ...flowLimitations]),
  ];
  const executionComplete = performanceCapsule.verdict.status !== 'no_confidence';
  const flowAnalysis = analyzeFlowOperations(normalized.flows);
  const functionAnalysis = analyzeFunctionFrequency(performanceCapsule, normalized.flows);
  const capsule = {
    schema_version: FLOW_SCHEMA_VERSION,
    subject: performanceCapsule.subject,
    adapter: performanceCapsule.adapter,
    scope: performanceCapsule.scope,
    capture_policy: {
      samples: performanceCapsule.sample_policy.samples,
      warmups: performanceCapsule.sample_policy.warmups,
      profile_runs: performanceCapsule.observed.profile_runs?.length ?? 0,
      flow_mechanisms: [
        'node_global_fetch',
        'node_http_server',
        'request_scoped_node_sqlite',
        'v8_function_coverage',
      ],
    },
    ...normalized,
    flow_analysis: flowAnalysis,
    function_analysis: functionAnalysis,
    diagnosis: {
      kind: diagnosis.diagnosis.kind,
      summary: diagnosis.diagnosis.summary,
      confidence: diagnosis.diagnosis.confidence,
      verdict: diagnosis.verdict,
      evidence_ids: diagnosis.diagnosis.evidence_ids,
    },
    observed: diagnosis.observed,
    inferred: diagnosis.inferred,
    unverified: diagnosis.unverified,
    next_action: diagnosis.next_action,
    limitations,
    performance_capsule: performanceCapsule,
    verdict: {
      status: executionComplete ? 'captured' : 'no_confidence',
      reason: executionComplete
        ? 'The exact local workload completed with bounded recursive flow evidence.'
        : 'The exact local workload did not complete with required bounded evidence.',
    },
  };
  const errors = validateFlowCapsule(capsule);
  if (errors.length > 0) throw new Error(`invalid flow capsule: ${errors.join(', ')}`);
  return capsule;
}

export function analyzeFunctionFrequency(performanceCapsule, flows) {
  const minimumCalls = 3;
  const coverage = performanceCapsule.observed.function_coverage;
  const functions = Array.isArray(coverage?.functions) ? coverage.functions : [];
  const repeated = functions.filter((entry) => entry.call_count >= minimumCalls);
  const hotspots = (performanceCapsule.observed.hotspots ?? []).filter(
    (entry) => entry.role === 'application'
  );
  const intersections = [];
  for (const entry of repeated) {
    const hotspot = hotspots.find(
      (candidate) =>
        candidate.file === entry.file &&
        candidate.line >= entry.start_line &&
        candidate.line <= entry.end_line
    );
    if (hotspot) intersections.push({ entry, hotspot });
  }
  intersections.sort(
    (left, right) =>
      right.hotspot.self_time_ms - left.hotspot.self_time_ms ||
      right.entry.call_count - left.entry.call_count
  );
  const serverCount = flows.filter((flow) => flow.kind === 'http_server').length;
  const leading = intersections[0];
  const candidate = leading
    ? {
        function: leading.entry.function,
        file: leading.entry.file,
        start_line: leading.entry.start_line,
        end_line: leading.entry.end_line,
        call_count: leading.entry.call_count,
        calls_per_server_flow:
          serverCount > 0 ? round(leading.entry.call_count / serverCount, 3) : null,
        cpu_evidence: {
          line: leading.hotspot.line,
          sampled_function: leading.hotspot.function,
          self_time_ms: leading.hotspot.self_time_ms,
          samples: leading.hotspot.samples,
          sample_share: leading.hotspot.sample_share,
        },
        evidence_ids: [
          leading.entry.id,
          `cpu-hotspot:${leading.hotspot.file}:${leading.hotspot.line}`,
        ],
      }
    : null;
  return {
    policy: {
      minimum_call_count: minimumCalls,
      cpu_intersection_required: true,
      coverage_assigns_duration: false,
    },
    observed_function_count: functions.length,
    repeated_function_count: repeated.length,
    repeated_work_candidate: candidate,
    frequency_only: repeated
      .filter((entry) => !intersections.some((item) => item.entry.id === entry.id))
      .slice(0, 10),
    conclusion: {
      kind: candidate ? 'repeated_application_work_candidate' : 'observed_frequency_only',
      actionability: candidate ? 'unverified' : 'not_actionable',
      basis: candidate
        ? 'A repeated named function contains a repository-owned CPU sample in the same exact workload.'
        : 'Function call counts lack intersecting repository CPU evidence and do not establish cost.',
    },
    next_action: candidate
      ? {
          kind: 'scale_repeated_function_workload',
          verification_required:
            'Increase representative state size, then compare identical-scope wall time and function call count before and after one caching or incremental-work candidate.',
        }
      : {
          kind: 'capture_material_cpu_workload',
          verification_required:
            'Use a representative exact workload that produces repository-owned CPU evidence.',
        },
  };
}

export function analyzeFlowOperations(flows) {
  const servers = flows.filter((flow) => flow.kind === 'http_server');
  const slowestServer = servers.toSorted(
    (left, right) => right.timing.duration_ms - left.timing.duration_ms
  )[0];
  const databaseFlows = flows.filter((flow) => flow.kind === 'database');
  const databaseSummary = {
    count: databaseFlows.length,
    total_duration_ms: round(
      databaseFlows.reduce((total, flow) => total + flow.timing.duration_ms, 0)
    ),
    max_duration_ms: round(
      databaseFlows.reduce((maximum, flow) => Math.max(maximum, flow.timing.duration_ms), 0)
    ),
  };
  if (!slowestServer) {
    return {
      policy: { database_primary_minimum_share: 0.5, database_primary_minimum_ms: 1 },
      database: databaseSummary,
      slowest_server: null,
      conclusion: { kind: 'no_http_server_flow', evidence_flow_ids: [] },
      next_boundary: 'capture_supported_request_boundary',
    };
  }
  const requestDatabaseFlows = databaseFlows.filter(
    (flow) => flow.parent_flow_id === slowestServer.id
  );
  const databaseMs = Math.min(
    slowestServer.timing.duration_ms,
    requestDatabaseFlows.reduce((total, flow) => total + flow.timing.duration_ms, 0)
  );
  const databaseShare =
    slowestServer.timing.duration_ms > 0 ? databaseMs / slowestServer.timing.duration_ms : 0;
  const databasePrimary = databaseMs >= 1 && databaseShare >= 0.5;
  const unaccountedMs =
    slowestServer.timing.accounting?.unaccounted_ms ?? slowestServer.timing.duration_ms;
  return {
    policy: { database_primary_minimum_share: 0.5, database_primary_minimum_ms: 1 },
    database: databaseSummary,
    slowest_server: {
      flow_id: slowestServer.id,
      name: slowestServer.name,
      duration_ms: slowestServer.timing.duration_ms,
      database_child_count: requestDatabaseFlows.length,
      database_duration_ms: round(databaseMs),
      database_share: round(databaseShare, 4),
      unaccounted_ms: unaccountedMs,
    },
    conclusion: {
      kind: databasePrimary ? 'database_material_candidate' : 'database_not_primary',
      evidence_flow_ids: [slowestServer.id, ...requestDatabaseFlows.map((flow) => flow.id)],
      basis: databasePrimary
        ? 'Request-scoped SQLite operations cross the recorded duration and share thresholds.'
        : 'Request-scoped SQLite operations do not explain most of the slowest server flow.',
    },
    next_boundary: databasePrimary
      ? 'inspect_slowest_database_flow'
      : unaccountedMs > 0
        ? 'capture_synchronous_application_spans'
        : 'verify_database_candidate',
  };
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
