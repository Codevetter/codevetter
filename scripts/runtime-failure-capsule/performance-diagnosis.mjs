import {
  LIMITS,
  PERFORMANCE_DIAGNOSIS_SCHEMA_VERSION,
  validatePerformanceCapsule,
  validatePerformanceDiagnosis,
} from './contracts.mjs';
import { collectRuntimeSourceContexts } from './source-context.mjs';

const SCALE_PREFIX = /^(?:size|items?|n)[._-]?(\d+)$/i;
const ACTIONABILITY_FLOOR_MS_PER_OP = 0.1;

export async function diagnosePerformanceRepository(capsule, repositoryRoot) {
  const source = await collectRuntimeSourceContexts(repositoryRoot, capsule);
  return diagnosePerformanceCapsule(capsule, {
    sourceContexts: source.contexts,
    sourceLimitations: source.limitations,
  });
}

export function diagnosePerformanceCapsule(
  capsule,
  { sourceContexts = [], sourceLimitations = [] } = {}
) {
  const capsuleErrors = validatePerformanceCapsule(capsule);
  if (capsuleErrors.length > 0) {
    throw new Error(`invalid performance capsule: ${capsuleErrors.join(', ')}`);
  }

  const scaleCurve = extractScaleCurve(capsule.observed.console_metrics);
  const comparison = capsule.comparison;
  const startup = capsule.findings.find((finding) => finding.kind === 'startup_dominated_scope');
  const allocation = capsule.findings.find(
    (finding) => finding.kind === 'go_allocation_path_candidate'
  );
  const qualifiedApplicationFinding = capsule.findings.find(
    (finding) => finding.kind === 'application_hotspot_candidate'
  );
  const capturedApplicationHotspot = qualifiedApplicationFinding
    ? capsule.observed.hotspots.find(
        (hotspot) =>
          hotspot.role === 'application' &&
          hotspot.file === qualifiedApplicationFinding.source.file &&
          hotspot.function === qualifiedApplicationFinding.source.function &&
          hotspot.line === qualifiedApplicationFinding.source.line &&
          (qualifiedApplicationFinding.profile_kind === undefined ||
            hotspot.profile_kind === qualifiedApplicationFinding.profile_kind)
      )
    : capsule.observed.profile_repeatability === undefined
      ? capsule.observed.hotspots.find((hotspot) => hotspot.role === 'application')
      : null;
  const applicationHotspot = alignHotspotToSourceContext(
    capturedApplicationHotspot,
    sourceContexts
  );
  const benchmark = capsule.observed.go_benchmarks[0] ?? null;
  const sourcePattern = selectSourcePattern(sourceContexts);

  const evidence = rankEvidence({
    capsule,
    comparison,
    scaleCurve,
    startup,
    allocation,
    applicationHotspot,
    benchmark,
    sourceContexts,
  }).map((entry, index) => ({ id: `evidence-${index + 1}`, ...entry }));

  const diagnosis = classifyDiagnosis({
    capsule,
    comparison,
    scaleCurve,
    startup,
    allocation,
    applicationHotspot,
    benchmark,
    sourcePattern,
  });
  const evidenceIds = evidence
    .filter((entry) => diagnosis.evidence_kinds.includes(entry.kind))
    .map((entry) => entry.id);
  const inferred = buildInferences({
    diagnosis,
    evidenceIds,
    scaleCurve,
    allocation,
    applicationHotspot,
    benchmark,
    comparison,
    startup,
    sourcePattern,
  });
  const unverified = buildHypotheses({
    diagnosis,
    evidenceIds,
    allocation,
    applicationHotspot,
    benchmark,
    scaleCurve,
    sourcePattern,
  });
  const nextAction = buildNextAction(diagnosis, evidenceIds);
  const report = {
    schema_version: PERFORMANCE_DIAGNOSIS_SCHEMA_VERSION,
    subject: capsule.subject,
    adapter: capsule.adapter,
    scope: capsule.scope,
    diagnosis: {
      kind: diagnosis.kind,
      summary: diagnosis.summary,
      confidence: diagnosis.confidence,
      evidence_ids: evidenceIds,
    },
    observed: evidence,
    inferred,
    unverified,
    next_action: nextAction,
    verification: {
      operation: 'diagnose-performance',
      adapter: capsule.adapter.kind,
      target: capsule.scope.target,
      name: capsule.scope.name,
      samples: capsule.sample_policy.samples,
      warmups: capsule.sample_policy.warmups,
      baseline_role: 'save_originating_performance_capsule_then_compare_same_scope',
      baseline_json_pointer: '/performance_capsule',
      success_criteria: verificationCriteria(diagnosis.kind),
    },
    limitations: [...new Set([...capsule.limitations, ...sourceLimitations])],
    performance_capsule: capsule,
    verdict: diagnosis.verdict,
  };
  const errors = validatePerformanceDiagnosis(report);
  if (errors.length > 0) throw new Error(`invalid performance diagnosis: ${errors.join(', ')}`);
  return report;
}

export function extractScaleCurve(consoleMetrics) {
  const candidate = extractBenchmarkSeries(consoleMetrics);
  if (!candidate || candidate.points.length < 2) return null;
  const first = candidate.points[0];
  const last = candidate.points.at(-1);
  const inputRatio = last.input / first.input;
  const valueRatio = last.value / first.value;
  const normalizedCostRatio = valueRatio / inputRatio;
  const exponent = Math.log(valueRatio) / Math.log(inputRatio);
  const classification =
    exponent >= 1.1 ? 'superlinear' : exponent >= 0.8 ? 'approximately_linear' : 'sublinear';
  return {
    ...candidate,
    first_input: first.input,
    last_input: last.input,
    input_ratio: round(inputRatio),
    value_ratio: round(valueRatio),
    normalized_cost_ratio: round(normalizedCostRatio),
    exponent: round(exponent),
    classification,
    provenance: 'console_benchmark_metrics',
  };
}

export function extractBenchmarkSeries(consoleMetrics) {
  const groups = new Map();
  for (const observation of Array.isArray(consoleMetrics) ? consoleMetrics : []) {
    for (const metric of Array.isArray(observation?.metrics) ? observation.metrics : []) {
      const match = SCALE_PREFIX.exec(metric?.name ?? '');
      if (!match || !Number.isFinite(metric?.value) || metric.value <= 0 || !metric.unit) continue;
      const input = Number(match[1]);
      if (!Number.isSafeInteger(input) || input <= 0) continue;
      const group = groups.get(metric.unit) ?? new Map();
      group.set(input, { name: metric.name, input, value: metric.value });
      groups.set(metric.unit, group);
    }
  }
  const candidates = [...groups.entries()]
    .map(([unit, points]) => ({
      unit,
      points: [...points.values()].sort((a, b) => a.input - b.input),
    }))
    .filter((candidate) => candidate.points.length >= 1)
    .sort(
      (left, right) =>
        right.points.length - left.points.length || left.unit.localeCompare(right.unit)
    );
  const candidate = candidates[0];
  if (!candidate) return null;
  return {
    unit: candidate.unit,
    points: candidate.points.slice(0, LIMITS.observations),
    provenance: 'console_benchmark_metrics',
  };
}

function rankEvidence({
  capsule,
  comparison,
  scaleCurve,
  startup,
  allocation,
  applicationHotspot,
  benchmark,
  sourceContexts,
}) {
  const evidence = [];
  if (comparison && ['regressed', 'improved', 'stable'].includes(comparison.status)) {
    evidence.push({ kind: 'baseline_comparison', comparison });
  }
  if (scaleCurve) evidence.push({ kind: 'input_scale_curve', ...scaleCurve });
  for (const context of sourceContexts) {
    evidence.push({ kind: 'runtime_source_context', ...context });
  }
  if (benchmark) {
    evidence.push({
      kind: 'go_benchmark_measurement',
      name: benchmark.name,
      ns_per_op: benchmark.ns_per_op,
      bytes_per_op: benchmark.bytes_per_op,
      allocs_per_op: benchmark.allocs_per_op,
      provenance: benchmark.provenance,
    });
  }
  if (allocation) {
    evidence.push({
      kind: 'repository_allocation_path',
      source: allocation.source,
      flat_profile_bytes: allocation.flat_profile_bytes,
      cumulative_profile_bytes: allocation.cumulative_profile_bytes,
      flat_share: allocation.flat_share,
      cumulative_share: allocation.cumulative_share,
      provenance: allocation.basis,
    });
  }
  if (applicationHotspot) {
    evidence.push({
      kind: 'repository_cpu_hotspot',
      source: {
        file: applicationHotspot.file,
        line: applicationHotspot.line,
        ...(applicationHotspot.reported_line === undefined
          ? {}
          : { reported_line: applicationHotspot.reported_line }),
        function: applicationHotspot.function,
        ...(applicationHotspot.reported_function === undefined
          ? {}
          : { reported_function: applicationHotspot.reported_function }),
      },
      self_time_ms: applicationHotspot.self_time_ms ?? null,
      sample_share: applicationHotspot.sample_share,
      provenance: applicationHotspot.profile_kind ?? 'v8_cpu_profile',
    });
  }
  if (startup) evidence.push({ kind: 'startup_execution_share', ...startup });
  evidence.push({
    kind: 'wall_time_distribution',
    ...capsule.observed.wall_time_ms,
    provenance: 'closed_adapter_process_timing',
  });
  return evidence.slice(0, LIMITS.hotspots);
}

function classifyDiagnosis({
  capsule,
  comparison,
  scaleCurve,
  startup,
  allocation,
  applicationHotspot,
  sourcePattern,
}) {
  if (capsule.verdict.status === 'no_confidence') {
    return classification(
      'insufficient_evidence',
      'The required profiling evidence is incomplete, so no bottleneck is attributed.',
      'low',
      ['wall_time_distribution'],
      'no_confidence',
      'The diagnosis requires a successful bounded profile.'
    );
  }
  if (comparison?.status === 'regressed') {
    return classification(
      'demonstrated_regression',
      `Median wall time regressed by ${comparison.delta_percent}% (${comparison.delta_ms} ms) against a compatible baseline.`,
      'high',
      ['baseline_comparison', 'wall_time_distribution'],
      'actionable',
      'A compatible baseline crossed both materiality thresholds.'
    );
  }
  if (startup) {
    return classification(
      'startup_dominated_workload',
      `Application assertions account for only ${startup.assertion_share_percent}% of exact-scope wall time.`,
      'high',
      ['startup_execution_share', 'wall_time_distribution'],
      'needs_better_workload',
      'The selected workload is too small for source-level attribution.'
    );
  }
  if (
    scaleCurve?.unit === 'ms/op' &&
    scaleCurve.points.at(-1)?.value <= ACTIONABILITY_FLOOR_MS_PER_OP
  ) {
    return classification(
      'already_fast_at_supported_scale',
      `The largest measured input completes in ${scaleCurve.points.at(-1).value} ms/op, below the ${ACTIONABILITY_FLOOR_MS_PER_OP} ms/op actionability floor.`,
      'high',
      applicationHotspot ? ['input_scale_curve', 'repository_cpu_hotspot'] : ['input_scale_curve'],
      'measured',
      'The exact operation is already cheap at the largest recorded supported input.'
    );
  }
  if (
    sourcePattern?.pattern.kind === 'repeated_source_traversal' &&
    scaleCurve &&
    scaleCurve.input_ratio >= 10 &&
    applicationHotspot
  ) {
    return classification(
      'repeated_input_traversal',
      `${sourcePattern.pattern.collection} is traversed ${sourcePattern.pattern.lines.length} times along a measured repository CPU path.`,
      'medium',
      ['input_scale_curve', 'runtime_source_context', 'repository_cpu_hotspot'],
      'actionable',
      'A growing deterministic workload intersects repeated traversal of the same source collection.'
    );
  }
  if (
    sourcePattern?.pattern.kind === 'nested_collection_lookup' &&
    scaleCurve &&
    scaleCurve.input_ratio >= 10 &&
    applicationHotspot
  ) {
    return classification(
      'nested_lookup_hotspot',
      `${sourcePattern.source.function} performs a nested collection scan along a measured growing CPU path.`,
      'medium',
      ['input_scale_curve', 'runtime_source_context', 'repository_cpu_hotspot'],
      'actionable',
      'A growing deterministic workload intersects a nested repository-owned lookup.'
    );
  }
  if (
    sourcePattern?.pattern.kind === 'split_for_prefix' &&
    scaleCurve &&
    scaleCurve.input_ratio >= 10 &&
    applicationHotspot
  ) {
    return classification(
      'prefix_split_hotspot',
      `${sourcePattern.source.function} splits a string only to retain its prefix along a measured growing CPU path.`,
      'medium',
      ['input_scale_curve', 'runtime_source_context', 'repository_cpu_hotspot'],
      'actionable',
      'A growing deterministic workload intersects an avoidable temporary split result.'
    );
  }
  if (
    sourcePattern?.pattern.kind === 'linear_membership_over_keys' &&
    scaleCurve &&
    scaleCurve.input_ratio >= 10 &&
    scaleCurve.normalized_cost_ratio >= 1.15 &&
    applicationHotspot
  ) {
    return classification(
      'repeated_linear_membership',
      `${sourcePattern.source.function} repeatedly scans materialized object keys along a superlinear CPU path.`,
      'medium',
      ['input_scale_curve', 'runtime_source_context', 'repository_cpu_hotspot'],
      'actionable',
      'A superlinear deterministic workload intersects repeated linear membership checks.'
    );
  }
  if (
    sourcePattern &&
    sourcePattern.pattern.kind === 'full_sort_before_bounded_slice' &&
    scaleCurve &&
    scaleCurve.input_ratio >= 10 &&
    scaleCurve.normalized_cost_ratio >= 1.15
  ) {
    return classification(
      'bounded_result_overwork',
      `Per-input cost grew ${scaleCurve.normalized_cost_ratio}x while the measured source fully sorts before retaining a bounded prefix.`,
      'medium',
      ['input_scale_curve', 'runtime_source_context', 'repository_cpu_hotspot'],
      'actionable',
      'A growing deterministic workload intersects a concrete full-sort/bounded-result source pattern.'
    );
  }
  if (scaleCurve?.classification === 'superlinear') {
    return classification(
      'superlinear_scaling',
      `Measured cost grew ${scaleCurve.value_ratio}x for ${scaleCurve.input_ratio}x more input.`,
      'medium',
      sourcePattern
        ? ['input_scale_curve', 'runtime_source_context', 'repository_cpu_hotspot']
        : ['input_scale_curve', 'repository_cpu_hotspot'],
      'actionable',
      'The deterministic endpoint exponent exceeds the superlinear threshold.'
    );
  }
  if (allocation) {
    return classification(
      'allocation_pressure',
      `The strongest repository allocation path carries ${round(allocation.cumulative_share * 100)}% cumulative profile share.`,
      'medium',
      ['go_benchmark_measurement', 'repository_allocation_path'],
      'actionable',
      'Benchmark allocation measurements and a repository-owned cumulative path agree.'
    );
  }
  if (applicationHotspot) {
    return classification(
      'application_cpu_hotspot',
      `${applicationHotspot.file}:${applicationHotspot.line} has the largest captured repository-owned application CPU share.`,
      applicationHotspot.sample_share >= 0.05 ? 'medium' : 'low',
      ['repository_cpu_hotspot'],
      'actionable',
      'Repository-owned CPU samples identify a candidate, not a demonstrated cause.'
    );
  }
  if (
    capsule.adapter.kind !== 'go-bench' &&
    capsule.observed.profile_repeatability &&
    !capsule.observed.profile_repeatability.qualified
  ) {
    return classification(
      'insufficient_source_evidence',
      capsule.observed.profile_repeatability.reason,
      'low',
      ['wall_time_distribution'],
      'no_confidence',
      'Independent source profiles must agree and cross the recorded materiality policy.'
    );
  }
  return classification(
    'no_material_bottleneck_identified',
    'The workload completed, but the captured evidence does not isolate a material application bottleneck.',
    'low',
    ['wall_time_distribution'],
    'measured',
    'A baseline or more representative workload is required.'
  );
}

function classification(kind, summary, level, evidenceKinds, status, reason) {
  return {
    kind,
    summary,
    confidence: { level, basis: 'deterministic_evidence_rules' },
    evidence_kinds: evidenceKinds,
    verdict: { status, reason },
  };
}

function buildInferences({
  diagnosis,
  evidenceIds,
  scaleCurve,
  allocation,
  applicationHotspot,
  benchmark,
  comparison,
  startup,
  sourcePattern,
}) {
  const shared = { confidence: diagnosis.confidence, evidence_ids: evidenceIds };
  if (diagnosis.kind === 'demonstrated_regression') {
    const delta = Number.isFinite(comparison.delta_ms)
      ? `${comparison.delta_ms} ms`
      : `${comparison.delta_ns} ns/op`;
    return [
      {
        kind: 'compatible_baseline_regression',
        summary: `${comparison.metric} moved by ${comparison.delta_percent}% (${delta}) and crossed the recorded materiality threshold.`,
        ...shared,
      },
    ];
  }
  if (diagnosis.kind === 'repeated_input_traversal') {
    return [
      {
        kind: 'duplicate_pass_candidate',
        summary: `${sourcePattern.source.file}:${sourcePattern.pattern.lines.join(' and ')} traverses ${sourcePattern.pattern.collection} more than once; this observed source pattern intersects the measured ${scaleCurve.exponent} scaling exponent and ${applicationHotspot.file}:${applicationHotspot.line} CPU candidate.`,
        ...shared,
      },
    ];
  }
  if (diagnosis.kind === 'nested_lookup_hotspot') {
    return [
      {
        kind: 'nested_lookup_candidate',
        summary: `${sourcePattern.source.file}:${sourcePattern.pattern.lines[0]} performs ${sourcePattern.pattern.operations.join(' plus ')} for each lookup; this observed source pattern is on the path of the measured ${applicationHotspot.file}:${applicationHotspot.line} CPU candidate.`,
        ...shared,
      },
    ];
  }
  if (diagnosis.kind === 'prefix_split_hotspot') {
    return [
      {
        kind: 'temporary_split_candidate',
        summary: `${sourcePattern.source.file}:${sourcePattern.pattern.lines[0]} splits on ${JSON.stringify(sourcePattern.pattern.delimiter)} and retains only element zero; this observed source pattern is on the path of the measured ${applicationHotspot.file}:${applicationHotspot.line} CPU candidate.`,
        ...shared,
      },
    ];
  }
  if (diagnosis.kind === 'repeated_linear_membership') {
    return [
      {
        kind: 'linear_membership_candidate',
        summary: `${sourcePattern.source.file}:${sourcePattern.pattern.lines.join(' and ')} materializes ${sourcePattern.pattern.collection} and scans it for membership on the measured ${applicationHotspot.file}:${applicationHotspot.line} CPU path.`,
        ...shared,
      },
    ];
  }
  if (diagnosis.kind === 'superlinear_scaling' || diagnosis.kind === 'bounded_result_overwork') {
    return [
      {
        kind: 'scaling_bottleneck_candidate',
        summary: sourcePattern
          ? `${sourcePattern.source.file}:${sourcePattern.pattern.lines[0]} fully sorts candidates before retaining a bounded prefix; this observed source pattern intersects the measured ${scaleCurve.exponent} scaling exponent and ${applicationHotspot?.file ?? sourcePattern.source.file}:${applicationHotspot?.line ?? sourcePattern.source.line} CPU candidate.`
          : applicationHotspot
            ? `The high-end scaling cost is concentrated around ${applicationHotspot.file}:${applicationHotspot.line}; the current evidence is consistent with repeated per-item work.`
            : `The measured endpoint exponent of ${scaleCurve.exponent} is consistent with a superlinear algorithmic path.`,
        ...shared,
      },
    ];
  }
  if (diagnosis.kind === 'allocation_pressure') {
    return [
      {
        kind: 'allocation_path_candidate',
        summary: `${allocation.source.file}:${allocation.source.line} is the strongest captured repository-owned cumulative allocation path for ${benchmark?.name ?? 'the selected benchmark'}.`,
        ...shared,
      },
    ];
  }
  if (diagnosis.kind === 'startup_dominated_workload') {
    return [
      {
        kind: 'workload_too_short',
        summary: `Runner startup dominates because application assertions represent ${startup.assertion_share_percent}% of wall time.`,
        ...shared,
      },
    ];
  }
  if (diagnosis.kind === 'already_fast_at_supported_scale') {
    const largestPoint = scaleCurve.points.at(-1);
    return [
      {
        kind: 'absolute_cost_guardrail',
        summary: `${largestPoint.name} completed in ${largestPoint.value} ${scaleCurve.unit}; source hotspots explain where that small budget is spent, not a material product bottleneck.`,
        ...shared,
      },
    ];
  }
  if (diagnosis.kind === 'application_cpu_hotspot') {
    return [
      {
        kind: 'cpu_path_candidate',
        summary: `${applicationHotspot.file}:${applicationHotspot.line} is the leading captured application CPU candidate.`,
        ...shared,
      },
    ];
  }
  return [];
}

function buildHypotheses({
  diagnosis,
  evidenceIds,
  allocation,
  applicationHotspot,
  benchmark,
  scaleCurve,
  sourcePattern,
}) {
  if (diagnosis.kind === 'allocation_pressure') {
    return [
      {
        kind: 'allocation_reduction_hypothesis',
        summary: `Reducing transient work along ${allocation.source.file}:${allocation.source.line} may lower ${benchmark?.bytes_per_op?.median ?? 'measured'} B/op and ${benchmark?.allocs_per_op?.median ?? 'measured'} allocs/op.`,
        evidence_ids: evidenceIds,
        falsification:
          'Rerun the identical benchmark; reject this hypothesis if B/op and allocs/op do not decrease.',
      },
    ];
  }
  if (diagnosis.kind === 'repeated_input_traversal') {
    return [
      {
        kind: 'single_pass_hypothesis',
        summary: `Combining the passes over ${sourcePattern.pattern.collection} at ${sourcePattern.source.file}:${sourcePattern.pattern.lines.join(' and ')} may lower largest-input cost without changing output.`,
        evidence_ids: evidenceIds,
        falsification:
          'Rerun every recorded input size; reject this hypothesis if the largest-input cost does not improve or the scale curve regresses.',
      },
    ];
  }
  if (diagnosis.kind === 'nested_lookup_hotspot') {
    return [
      {
        kind: 'indexed_lookup_hypothesis',
        summary: `Pre-indexing the catalog used by ${sourcePattern.source.function} at ${sourcePattern.source.file}:${sourcePattern.pattern.lines[0]} may lower the largest-input cost by replacing repeated nested scans with direct lookup.`,
        evidence_ids: evidenceIds,
        falsification:
          'Rerun every recorded input size; reject this hypothesis if the largest-input cost does not improve or the scale curve regresses.',
      },
    ];
  }
  if (diagnosis.kind === 'prefix_split_hotspot') {
    return [
      {
        kind: 'direct_prefix_hypothesis',
        summary: `Replacing the split at ${sourcePattern.source.file}:${sourcePattern.pattern.lines[0]} with direct delimiter search and slicing may reduce temporary work and largest-input cost.`,
        evidence_ids: evidenceIds,
        falsification:
          'Rerun every recorded input size; reject this hypothesis if the largest-input cost does not improve or the scale curve regresses.',
      },
    ];
  }
  if (diagnosis.kind === 'repeated_linear_membership') {
    return [
      {
        kind: 'indexed_membership_hypothesis',
        summary: `Using indexed membership for ${sourcePattern.pattern.collection} at ${sourcePattern.source.file}:${sourcePattern.pattern.lines.join(' and ')} may reduce the largest-input cost and current ${scaleCurve.exponent} exponent.`,
        evidence_ids: evidenceIds,
        falsification:
          'Rerun every recorded input size; reject this hypothesis if the largest-input cost and scale curve do not improve.',
      },
    ];
  }
  if (diagnosis.kind === 'superlinear_scaling' || diagnosis.kind === 'bounded_result_overwork') {
    return [
      {
        kind: 'scaling_reduction_hypothesis',
        summary: sourcePattern
          ? `Replacing the full sort with bounded top-k selection and deferring mapped result materialization may lower the largest-input cost and the current ${scaleCurve.exponent} endpoint exponent.`
          : applicationHotspot
            ? `Reducing full-input work around ${applicationHotspot.file}:${applicationHotspot.line} may lower the largest-input cost and the current ${scaleCurve.exponent} endpoint exponent.`
            : `Reducing full-input work may lower the largest-input cost and the current ${scaleCurve.exponent} endpoint exponent.`,
        evidence_ids: evidenceIds,
        falsification:
          'Rerun every recorded input size; reject this hypothesis if the largest-input cost and scale curve do not improve.',
      },
    ];
  }
  if (diagnosis.kind === 'application_cpu_hotspot') {
    return [
      {
        kind: 'cpu_reduction_hypothesis',
        summary: `Reducing work at ${applicationHotspot.file}:${applicationHotspot.line} may lower same-scope CPU share and wall time.`,
        evidence_ids: evidenceIds,
        falsification:
          'Compare an identical bounded profile and reject this hypothesis if CPU share and wall time do not improve.',
      },
    ];
  }
  return [];
}

function selectSourcePattern(sourceContexts) {
  for (const context of sourceContexts) {
    const pattern = context.patterns.find(
      (candidate) => candidate.kind === 'repeated_source_traversal'
    );
    if (pattern) return { source: context.source, pattern };
  }
  for (const context of sourceContexts) {
    const pattern = context.patterns.find(
      (candidate) => candidate.kind === 'nested_collection_lookup'
    );
    if (pattern) return { source: context.source, pattern };
  }
  for (const context of sourceContexts) {
    const pattern = context.patterns.find((candidate) => candidate.kind === 'split_for_prefix');
    if (pattern) return { source: context.source, pattern };
  }
  for (const context of sourceContexts) {
    const pattern = context.patterns.find(
      (candidate) => candidate.kind === 'linear_membership_over_keys'
    );
    if (pattern) return { source: context.source, pattern };
  }
  for (const context of sourceContexts) {
    const pattern = context.patterns.find(
      (candidate) => candidate.kind === 'full_sort_before_bounded_slice'
    );
    if (pattern) return { source: context.source, pattern };
  }
  return null;
}

function buildNextAction(diagnosis, evidenceIds) {
  if (diagnosis.kind === 'demonstrated_regression') {
    return {
      kind: 'isolate_regression_candidate',
      summary:
        'Inspect evidence-linked changed paths, make one candidate change, and compare the identical workload.',
      evidence_ids: evidenceIds,
    };
  }
  if (diagnosis.kind === 'startup_dominated_workload') {
    return {
      kind: 'design_representative_workload',
      summary:
        'Batch or scale the same application operation until application time is material, then profile again.',
      evidence_ids: evidenceIds,
    };
  }
  if (diagnosis.kind === 'insufficient_evidence') {
    return {
      kind: 'repair_or_stabilize_profile',
      summary: 'Resolve the recorded execution or capture limitation before changing product code.',
      evidence_ids: evidenceIds,
    };
  }
  if (diagnosis.kind === 'insufficient_source_evidence') {
    return {
      kind: 'capture_more_material_source_evidence',
      summary:
        'Scale or repeat the same application operation until independent profiles agree on a material source candidate.',
      evidence_ids: evidenceIds,
    };
  }
  if (diagnosis.kind === 'already_fast_at_supported_scale') {
    return {
      kind: 'retain_guardrail_and_profile_another_flow',
      summary:
        'Keep this workload as a regression guardrail and spend the next profiling run on a higher-cost user flow.',
      evidence_ids: evidenceIds,
    };
  }
  if (diagnosis.verdict.status === 'actionable') {
    return {
      kind: 'optimize_one_candidate_then_compare',
      summary:
        'Change one evidence-linked candidate, then compare the identical workload with this capsule as the baseline.',
      evidence_ids: evidenceIds,
    };
  }
  return {
    kind: 'capture_compatible_baseline',
    summary: 'Retain this capsule and compare the identical workload after a relevant code change.',
    evidence_ids: evidenceIds,
  };
}

function verificationCriteria(kind) {
  if (kind === 'allocation_pressure')
    return ['B/op decreases', 'allocs/op does not regress', 'workload passes'];
  if (
    kind === 'superlinear_scaling' ||
    kind === 'bounded_result_overwork' ||
    kind === 'repeated_input_traversal' ||
    kind === 'nested_lookup_hotspot' ||
    kind === 'prefix_split_hotspot' ||
    kind === 'repeated_linear_membership'
  )
    return ['largest-input time decreases', 'scale exponent does not regress', 'workload passes'];
  if (kind === 'startup_dominated_workload')
    return [
      'application assertion share becomes material',
      'repository source samples are captured',
    ];
  if (kind === 'demonstrated_regression')
    return ['median wall time returns within baseline thresholds', 'workload passes'];
  if (kind === 'application_cpu_hotspot')
    return [
      'candidate CPU share decreases',
      'median wall time does not regress',
      'workload passes',
    ];
  if (kind === 'already_fast_at_supported_scale')
    return [
      `largest-input cost remains at or below ${ACTIONABILITY_FLOOR_MS_PER_OP} ms/op`,
      'workload passes',
    ];
  return ['workload passes', 'compatible evidence is captured'];
}

function alignHotspotToSourceContext(hotspot, sourceContexts) {
  if (!hotspot) return null;
  const context = sourceContexts.find(
    (candidate) =>
      candidate.source.file === hotspot.file &&
      (candidate.source.function === hotspot.function ||
        candidate.source.reported_function === hotspot.function)
  );
  if (!context || context.source.line === hotspot.line) return hotspot;
  return {
    ...hotspot,
    line: context.source.line,
    function: context.source.function,
    reported_line: hotspot.line,
    ...(context.source.reported_function === undefined
      ? {}
      : { reported_function: hotspot.function }),
  };
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
