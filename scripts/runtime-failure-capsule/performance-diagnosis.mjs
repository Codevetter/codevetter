import {
  LIMITS,
  PERFORMANCE_DIAGNOSIS_SCHEMA_VERSION,
  validatePerformanceCapsule,
  validatePerformanceDiagnosis,
} from './contracts.mjs';
import { collectRuntimeSourceContexts } from './source-context.mjs';
import {
  ALLOCATION_EXPERIMENT_MINIMUM_DIRECT_SHARE,
  ALLOCATION_PATTERN_MINIMUM_DIRECT_SHARE,
  diagnoseProfileToolFinding,
} from './profile-tool-diagnosis.mjs';

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
  const allocations = rankAllocationCandidates(
    capsule.findings.filter((finding) => finding.kind === 'go_allocation_path_candidate'),
    sourceContexts
  );
  const allocation = allocations[0] ?? null;
  const allocationExperimentEligible = Boolean(
    allocation?.profile_kind === 'go_alloc_objects' &&
      allocation.flat_profile_objects > 0 &&
      (allocation.flat_share >= ALLOCATION_EXPERIMENT_MINIMUM_DIRECT_SHARE ||
        patternBackedAllocationCandidate(allocation, sourceContexts))
  );
  const heapAllocations = capsule.findings
    .filter(
      (finding) =>
        finding.kind === 'node_allocation_candidate' &&
        finding.sampled_bytes > 0 &&
        finding.sample_share > 0
    )
    .map((finding) => ({
      ...finding,
      source: alignSourceToSourceContext(finding.source, sourceContexts),
    }));
  const heapAllocation = heapAllocations[0] ?? null;
  const qualifiedApplicationFinding = capsule.findings.find(
    (finding) =>
      finding.kind === 'application_hotspot_candidate' &&
      finding.basis !== 'repository_owned_go_cpu_cumulative_path' &&
      finding.self_time_ms > 0 &&
      finding.sample_share > 0
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
    : capsule.adapter.kind !== 'go-bench' && capsule.observed.profile_repeatability === undefined
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
    allocations,
    heapAllocations,
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
    allocationExperimentEligible,
    heapAllocation,
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
    heapAllocation,
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
    heapAllocation,
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
  report.tool_diagnosis = diagnoseProfileToolFinding(report);
  const errors = validatePerformanceDiagnosis(report);
  if (errors.length > 0) throw new Error(`invalid performance diagnosis: ${errors.join(', ')}`);
  return report;
}

function rankAllocationCandidates(candidates, sourceContexts) {
  const ranked = candidates.toSorted(
    (left, right) =>
      Number(patternBackedAllocationCandidate(right, sourceContexts)) -
        Number(patternBackedAllocationCandidate(left, sourceContexts)) ||
      Number(right.profile_kind === 'go_alloc_objects' && right.flat_profile_objects > 0) -
        Number(left.profile_kind === 'go_alloc_objects' && left.flat_profile_objects > 0) ||
      Number(right.profile_kind === 'go_alloc_objects') -
        Number(left.profile_kind === 'go_alloc_objects') ||
      (right.cumulative_share ?? 0) - (left.cumulative_share ?? 0) ||
      String(left.source?.file ?? '').localeCompare(String(right.source?.file ?? '')) ||
      String(left.source?.function ?? '').localeCompare(String(right.source?.function ?? '')) ||
      (left.source?.line ?? 0) - (right.source?.line ?? 0)
  );
  const seen = new Set();
  return ranked
    .filter((candidate) => {
      const key = `${candidate.source?.file ?? ''}\0${candidate.source?.function ?? candidate.source?.line ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, LIMITS.sourceFiles);
}

function patternBackedAllocationCandidate(candidate, sourceContexts) {
  return Boolean(
    candidate.profile_kind === 'go_alloc_objects' &&
      candidate.flat_profile_objects > 0 &&
      candidate.flat_share >= ALLOCATION_PATTERN_MINIMUM_DIRECT_SHARE &&
      sourceContextForCandidate(candidate, sourceContexts)?.patterns?.some(
        (pattern) => pattern.kind === 'go_static_string_format'
      )
  );
}

function sourceContextForCandidate(candidate, sourceContexts) {
  return sourceContexts.find(
    (context) =>
      context.source?.file === candidate.source?.file &&
      (context.source?.reported_function === candidate.source?.function ||
        context.source?.function === candidate.source?.function)
  );
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
  allocations,
  heapAllocations,
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
  for (const allocation of allocations) {
    evidence.push({
      kind: 'repository_allocation_path',
      source: allocation.source,
      profile_kind: allocation.profile_kind ?? 'go_alloc_space',
      ...(allocation.profile_kind === 'go_alloc_objects'
        ? {
            flat_profile_objects: allocation.flat_profile_objects,
            cumulative_profile_objects: allocation.cumulative_profile_objects,
          }
        : {
            flat_profile_bytes: allocation.flat_profile_bytes,
            cumulative_profile_bytes: allocation.cumulative_profile_bytes,
          }),
      flat_share: allocation.flat_share,
      cumulative_share: allocation.cumulative_share,
      ...(Number.isFinite(allocation.objects_per_op)
        ? {
            objects_per_op: allocation.objects_per_op,
            per_run_objects_per_op: allocation.per_run_objects_per_op,
          }
        : {}),
      provenance: allocation.basis,
    });
  }
  for (const heapAllocation of heapAllocations) {
    evidence.push({
      kind: 'repository_heap_allocation_source',
      source: heapAllocation.source,
      sampled_bytes: heapAllocation.sampled_bytes,
      per_run_sampled_bytes: heapAllocation.per_run_sampled_bytes,
      sample_share: heapAllocation.sample_share,
      provenance: heapAllocation.basis,
      interpretation: 'sampled_allocations_including_objects_collected_by_minor_and_major_gc',
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
  allocationExperimentEligible,
  heapAllocation,
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
  if (allocation && !allocationExperimentEligible) {
    const repeatedDirect = Number.isFinite(allocation.objects_per_op);
    return classification(
      'allocation_signal_below_experiment_floor',
      repeatedDirect
        ? `The strongest repeated direct allocation leaf contributes ${round(allocation.objects_per_op)} objects/op but only ${round(allocation.flat_share * 100)}% of total allocation objects.`
        : 'The captured repository allocation evidence contains only cumulative callers or immaterial direct leaves.',
      'high',
      ['go_benchmark_measurement', 'repository_allocation_path'],
      'measured',
      'No direct source crossed the autonomous allocation experiment floor.'
    );
  }
  if (allocation) {
    const repeatedDirect = Number.isFinite(allocation.objects_per_op);
    return classification(
      'allocation_pressure',
      repeatedDirect
        ? `The strongest repeated direct allocation leaf contributes ${round(allocation.objects_per_op)} objects/op and ${round(allocation.flat_share * 100)}% direct object share.`
        : `The strongest repository repeated-allocation path carries ${round(allocation.cumulative_share * 100)}% cumulative object share.`,
      'medium',
      ['go_benchmark_measurement', 'repository_allocation_path'],
      'actionable',
      'Benchmark allocation measurements and a repository-owned alloc_objects path agree.'
    );
  }
  if (heapAllocation) {
    const intersectsCpu = heapAllocation.basis.endsWith('_intersecting_cpu_candidate');
    return classification(
      'node_allocation_source',
      intersectsCpu
        ? `${heapAllocation.source.file}:${heapAllocation.source.line} repeated as a material sampled heap-allocation source on the leading CPU path.`
        : `${heapAllocation.source.file}:${heapAllocation.source.line} repeated as the leading repository-owned sampled heap-allocation source.`,
      'medium',
      ['repository_heap_allocation_source'],
      'actionable',
      intersectsCpu
        ? 'Two independent V8 sampling heap profiles repeated a material source matching the repeated CPU candidate.'
        : 'Two independent V8 sampling heap profiles repeated the same material application source.'
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
  heapAllocation,
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
        summary: Number.isFinite(allocation.objects_per_op)
          ? `${allocation.source.file}:${allocation.source.line} repeated as a direct allocation leaf at ${allocation.objects_per_op} objects/op across both profiles for ${benchmark?.name ?? 'the selected benchmark'}.`
          : `${allocation.source.file}:${allocation.source.line} is the strongest captured repository-owned cumulative allocation path for ${benchmark?.name ?? 'the selected benchmark'}.`,
        ...shared,
      },
    ];
  }
  if (diagnosis.kind === 'node_allocation_source') {
    return [
      {
        kind: 'heap_allocation_source_candidate',
        summary: `${heapAllocation.source.file}:${heapAllocation.source.line} accounts for ${heapAllocation.sampled_bytes} combined sampled bytes across two independent completion-time heap profiles.`,
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
  if (diagnosis.kind === 'allocation_signal_below_experiment_floor') {
    return [];
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
  heapAllocation,
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
  if (diagnosis.kind === 'node_allocation_source') {
    return [
      {
        kind: 'heap_allocation_reduction_hypothesis',
        summary: `Reducing heap retained through ${heapAllocation.source.file}:${heapAllocation.source.line} may lower the repeated completion-time sampled-byte signal.`,
        evidence_ids: evidenceIds,
        falsification:
          'Rerun two identical heap profiles; reject if the same source does not repeat with fewer sampled bytes or if correctness, latency, or peak RSS regresses.',
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
  if (diagnosis.kind === 'allocation_signal_below_experiment_floor') {
    return {
      kind: 'retain_guardrail_and_profile_another_flow',
      summary:
        'Keep this allocation benchmark as a regression guardrail and profile another flow with a material direct source candidate.',
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
  if (kind === 'node_allocation_source')
    return [
      'repeated candidate sampled bytes decrease',
      'median wall time and peak RSS do not regress',
      'workload passes',
    ];
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
  const source = alignSourceToSourceContext(
    { file: hotspot.file, line: hotspot.line, function: hotspot.function },
    sourceContexts
  );
  if (source.line === hotspot.line) return hotspot;
  return {
    ...hotspot,
    line: source.line,
    function: source.function,
    reported_line: source.reported_line,
    ...(source.reported_function === undefined
      ? {}
      : { reported_function: source.reported_function }),
  };
}

function alignSourceToSourceContext(source, sourceContexts) {
  if (!source) return source;
  const context = sourceContexts.find(
    (candidate) =>
      candidate.source.file === source.file &&
      (candidate.source.function === source.function ||
        candidate.source.reported_function === source.function)
  );
  if (!context || context.source.line === source.line) return source;
  return {
    ...source,
    line: context.source.line,
    function: context.source.function,
    reported_line: source.line,
    ...(context.source.reported_function === undefined
      ? {}
      : { reported_function: source.function }),
  };
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
