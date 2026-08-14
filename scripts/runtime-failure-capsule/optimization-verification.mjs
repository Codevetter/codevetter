import {
  OPTIMIZATION_VERIFICATION_SCHEMA_VERSION,
  validateOptimizationVerification,
  validatePerformanceCapsule,
} from './contracts.mjs';
import { extractBenchmarkSeries } from './performance-diagnosis.mjs';
import { comparePerformanceCapsules } from './performance.mjs';

export const OPTIMIZATION_POLICY = Object.freeze({
  scale_improvement_percent: 10,
  allocation_bytes_improvement_percent: 5,
  allocation_count_improvement_percent: 10,
  go_latency_improvement_percent: 10,
  memory_improvement_percent: 10,
  memory_material_bytes: 16 * 1024 * 1024,
  node_allocation_improvement_percent: 20,
  node_allocation_material_bytes: 64 * 1024,
  node_application_allocation_improvement_percent: 1,
  go_source_allocation_change_percent: 20,
  go_source_allocation_material_objects_per_op: 0.5,
  memory_regression_gate: true,
  maximum_secondary_regression_percent: 20,
  shipping_minimum_samples: 10,
});

const NON_BLOCKING_DIAGNOSTIC_LIMITATIONS = new Set([
  'Independent V8 profiles disagreed on the leading application source candidate.',
  'Independent V8 profiles did not all capture an application source candidate.',
  'The repeated V8 source candidate did not cross the recorded sample, duration, total-profile, or application-relative share thresholds.',
  'Peak process-tree RSS was unavailable on this host.',
  'Peak RSS is sampled process-tree evidence; it includes runtime and test-runner memory and does not identify an allocation source.',
  'Peak RSS is sampled from an owned Go benchmark binary with compilation excluded; it is a regression guard and does not identify an allocation source.',
  'The heap-allocation profiles contained no repository-owned application source.',
  'Independent V8 heap profiles did not all capture an application allocation source.',
  'Independent V8 heap profiles disagreed on the leading application allocation source.',
  'The repeated V8 allocation source did not cross the sampled-byte or share thresholds.',
  'Go pprof direct allocation values are normalized per benchmark operation; they do not represent retained heap or peak memory.',
]);

export function verifyOptimizationCapsules(baseline, current, policy = {}, selection = {}) {
  for (const [label, capsule] of [
    ['baseline', baseline],
    ['current', current],
  ]) {
    const errors = validatePerformanceCapsule(capsule);
    if (errors.length > 0)
      throw new Error(`invalid ${label} performance capsule: ${errors.join(', ')}`);
  }
  const resolvedPolicy = { ...OPTIMIZATION_POLICY, ...policy };
  const limitations = [...new Set([...baseline.limitations, ...current.limitations])];
  let observed = [];
  let verdict;
  const scopeCompatibility = compareScopeCompatibility(baseline, current);

  if (!scopeCompatibility.compatible) {
    verdict = outcome(
      'no_confidence',
      `Baseline and current ${scopeCompatibility.differences.join(', ')} differ.`
    );
  } else if (
    baseline.verdict.status === 'no_confidence' ||
    current.verdict.status === 'no_confidence'
  ) {
    verdict = outcome('no_confidence', 'Both workloads must complete with qualified evidence.');
  } else {
    const baselineSeries = extractBenchmarkSeries(baseline.observed.console_metrics);
    const currentSeries = extractBenchmarkSeries(current.observed.console_metrics);
    if (baselineSeries || currentSeries) {
      ({ observed, verdict } = compareBenchmarkSeries(
        baselineSeries,
        currentSeries,
        resolvedPolicy
      ));
    } else if (baseline.adapter.kind === 'go-bench') {
      ({ observed, verdict } = compareGoBenchmarks(baseline, current, resolvedPolicy));
    } else {
      ({ observed, verdict } = compareWallTime(baseline, current, resolvedPolicy));
    }
    const memory = comparePeakRss(baseline, current, resolvedPolicy);
    if (memory.observation && !observed.some((entry) => entry.kind === 'peak_rss_comparison')) {
      observed.push(memory.observation);
    }
    if (baseline.adapter.kind === 'go-bench') {
      const allocation = compareGoAllocationSource(baseline, current, resolvedPolicy);
      if (allocation.observation) observed.push(allocation.observation);
      verdict = applyGoAllocationSourceGate(verdict, allocation);
    } else {
      const allocation = compareNodeAllocationSource(
        baseline,
        current,
        resolvedPolicy,
        selection.nodeAllocationSource
      );
      if (allocation.observation) observed.push(allocation.observation);
      verdict = applyNodeAllocationGate(verdict, allocation);
    }
    if (memory.regressed && resolvedPolicy.memory_regression_gate) {
      verdict = outcome('rejected', 'Peak process-tree RSS materially regressed.');
    }
  }

  const report = {
    schema_version: OPTIMIZATION_VERIFICATION_SCHEMA_VERSION,
    subject: {
      baseline_revision: baseline.subject.repository_revision,
      current_revision: current.subject.repository_revision,
    },
    adapter: { kind: current.adapter.kind },
    scope: current.scope,
    observed,
    policy: resolvedPolicy,
    limitations,
    decisions: buildImpactDecisions({
      baseline,
      current,
      observed,
      verdict,
      limitations,
      policy: resolvedPolicy,
    }),
    baseline_capsule: baseline,
    current_capsule: current,
    verdict,
  };
  const errors = validateOptimizationVerification(report);
  if (errors.length > 0) {
    throw new Error(`invalid optimization verification: ${errors.join(', ')}`);
  }
  return report;
}

function compareGoAllocationSource(baseline, current, policy) {
  const candidate = repeatedGoAllocationCandidate(baseline);
  if (!candidate) return { status: 'not_activated', observation: null };
  const currentValues = goAllocationObjectsPerOperation(current, candidate.source);
  if (!currentValues) {
    return {
      status: 'no_confidence',
      observation: {
        kind: 'go_allocation_source_comparison',
        source: candidate.source,
        baseline_per_run_objects_per_op: candidate.values,
        current_per_run_objects_per_op: null,
        provenance: 'paired_go_pprof_alloc_objects_flat_per_benchmark_operation',
        status: 'incomplete',
      },
    };
  }
  const metric = metricDelta(median(candidate.values), median(currentValues));
  const material = Math.abs(metric.delta) >= policy.go_source_allocation_material_objects_per_op;
  const improved = material && metric.delta_percent <= -policy.go_source_allocation_change_percent;
  const regressed = material && metric.delta_percent >= policy.go_source_allocation_change_percent;
  return {
    status: improved ? 'improved' : regressed ? 'regressed' : 'stable',
    observation: {
      kind: 'go_allocation_source_comparison',
      source: candidate.source,
      baseline_per_run_objects_per_op: candidate.values,
      current_per_run_objects_per_op: currentValues,
      metric,
      provenance: 'paired_go_pprof_alloc_objects_flat_per_benchmark_operation',
      status: improved ? 'improved' : regressed ? 'regressed' : 'stable',
    },
  };
}

function repeatedGoAllocationCandidate(capsule) {
  const runs = capsule.observed.profile_runs;
  if (!Array.isArray(runs) || runs.length !== 2) return null;
  const firstCandidates = directGoAllocationHotspots(runs[0]);
  const candidates = [];
  for (const hotspot of firstCandidates) {
    const source = { file: hotspot.file, line: hotspot.line, function: hotspot.function };
    const values = goAllocationObjectsPerOperation(capsule, source);
    if (values) candidates.push({ source, values });
  }
  return (
    candidates.toSorted(
      (left, right) =>
        median(right.values) - median(left.values) ||
        left.source.file.localeCompare(right.source.file) ||
        left.source.function.localeCompare(right.source.function)
    )[0] ?? null
  );
}

function directGoAllocationHotspots(run) {
  return Array.isArray(run?.application_hotspots)
    ? run.application_hotspots.filter(
        (hotspot) =>
          hotspot.profile_kind === 'go_alloc_objects' &&
          hotspot.flat > 0 &&
          hotspot.cumulative_share >= 0.01
      )
    : [];
}

function goAllocationObjectsPerOperation(capsule, source) {
  const runs = capsule.observed.profile_runs;
  if (!Array.isArray(runs) || runs.length !== 2) return null;
  const values = [];
  for (const run of runs) {
    const iterations = run?.benchmark?.iterations?.median;
    if (
      run.profile_files < 2 ||
      run.failed_kinds?.includes('go_alloc_objects') ||
      !Number.isFinite(iterations) ||
      iterations <= 0 ||
      !Number.isInteger(run.fixed_benchmark_iterations) ||
      run.fixed_benchmark_iterations !== iterations ||
      !Array.isArray(run.application_hotspots)
    ) {
      return null;
    }
    const matching = run.application_hotspots.filter(
      (hotspot) =>
        hotspot.profile_kind === 'go_alloc_objects' &&
        hotspot.file === source.file &&
        hotspot.function === source.function
    );
    if (matching.length === 0 && run.truncated) return null;
    values.push(
      round(matching.reduce((total, hotspot) => total + hotspot.flat, 0) / iterations, 6)
    );
  }
  return values;
}

function applyGoAllocationSourceGate(verdict, allocation) {
  if (allocation.status === 'regressed') {
    return outcome('rejected', 'The repeated Go allocation source materially regressed.');
  }
  if (allocation.status === 'no_confidence' && verdict.status !== 'rejected') {
    return outcome(
      'no_confidence',
      'The repeated Go allocation source activated the gate, but paired profiles were incomplete.'
    );
  }
  return verdict;
}

function compareNodeAllocationSource(baseline, current, policy, selectedSource) {
  const candidates = baseline.findings.filter(
    (finding) =>
      finding.kind === 'node_allocation_candidate' &&
      finding.source?.file &&
      typeof finding.source.function === 'string' &&
      baseline.capture?.heap_profile_truncated !== true
  );
  const candidate = selectedSource
    ? candidates.find(
        (finding) =>
          finding.source.file === selectedSource.file &&
          finding.source.function === selectedSource.function
      )
    : candidates[0];
  if (selectedSource && !candidate) {
    return {
      status: 'no_confidence',
      observation: {
        kind: 'node_allocation_comparison',
        source: selectedSource,
        baseline_per_run_sampled_bytes: null,
        current_per_run_sampled_bytes: null,
        provenance: 'paired_v8_sampling_heap_profiles',
        status: 'incomplete',
      },
    };
  }
  if (!candidate) return { status: 'not_activated', observation: null };
  const baselineRuns = allocationBytesByRun(baseline, candidate.source);
  const currentRuns = allocationBytesByRun(current, candidate.source);
  const baselineApplicationRuns = applicationAllocationBytesByRun(baseline);
  const currentApplicationRuns = applicationAllocationBytesByRun(current);
  if (!baselineRuns || !currentRuns || !baselineApplicationRuns || !currentApplicationRuns) {
    return {
      status: 'no_confidence',
      observation: {
        kind: 'node_allocation_comparison',
        source: candidate.source,
        baseline_per_run_sampled_bytes: baselineRuns,
        current_per_run_sampled_bytes: currentRuns,
        provenance: 'paired_v8_sampling_heap_profiles',
        status: 'incomplete',
      },
    };
  }
  const baselineMedian = median(baselineRuns);
  const currentMedian = median(currentRuns);
  const metric = metricDelta(baselineMedian, currentMedian);
  const conservativeRange = {
    improvement: metricDelta(Math.min(...baselineRuns), Math.max(...currentRuns)),
    regression: metricDelta(Math.max(...baselineRuns), Math.min(...currentRuns)),
  };
  const sourceImproved =
    Math.abs(conservativeRange.improvement.delta) >= policy.node_allocation_material_bytes &&
    conservativeRange.improvement.delta_percent <= -policy.node_allocation_improvement_percent;
  const sourceRegressed =
    Math.abs(conservativeRange.regression.delta) >= policy.node_allocation_material_bytes &&
    conservativeRange.regression.delta_percent >= policy.node_allocation_improvement_percent;
  const applicationMetric = metricDelta(
    median(baselineApplicationRuns),
    median(currentApplicationRuns)
  );
  const applicationConservativeRange = {
    improvement: metricDelta(
      Math.min(...baselineApplicationRuns),
      Math.max(...currentApplicationRuns)
    ),
    regression: metricDelta(
      Math.max(...baselineApplicationRuns),
      Math.min(...currentApplicationRuns)
    ),
  };
  const applicationImproved =
    Math.abs(applicationConservativeRange.improvement.delta) >=
      policy.node_allocation_material_bytes &&
    applicationConservativeRange.improvement.delta_percent <=
      -policy.node_application_allocation_improvement_percent;
  const applicationRegressed =
    Math.abs(applicationConservativeRange.regression.delta) >=
      policy.node_allocation_material_bytes &&
    applicationConservativeRange.regression.delta_percent >=
      policy.maximum_secondary_regression_percent;
  const improved = sourceImproved && applicationImproved;
  const regressed = sourceRegressed || applicationRegressed;
  return {
    status: improved ? 'improved' : regressed ? 'regressed' : 'stable',
    observation: {
      kind: 'node_allocation_comparison',
      source: candidate.source,
      baseline_per_run_sampled_bytes: baselineRuns,
      current_per_run_sampled_bytes: currentRuns,
      metric,
      conservative_range: conservativeRange,
      application_baseline_per_run_sampled_bytes: baselineApplicationRuns,
      application_current_per_run_sampled_bytes: currentApplicationRuns,
      application_metric: applicationMetric,
      application_conservative_range: applicationConservativeRange,
      attribution_status:
        sourceImproved && !applicationImproved
          ? 'source_reduction_not_confirmed_by_application_total'
          : 'source_and_application_total_agree',
      provenance: 'paired_v8_sampling_heap_profiles',
      status: improved ? 'improved' : regressed ? 'regressed' : 'stable',
    },
  };
}

function allocationBytesByRun(capsule, source) {
  const runs = capsule.observed.heap_profile_runs;
  if (!Array.isArray(runs) || runs.length !== 2) return null;
  const values = [];
  for (const run of runs) {
    if (run.profile_files < 1 || run.truncated || !Array.isArray(run.application_hotspots)) {
      return null;
    }
    values.push(
      run.application_hotspots
        .filter((hotspot) => hotspot.file === source.file && hotspot.function === source.function)
        .reduce((total, hotspot) => total + hotspot.sampled_bytes, 0)
    );
  }
  return values;
}

function applicationAllocationBytesByRun(capsule) {
  const runs = capsule.observed.heap_profile_runs;
  if (!Array.isArray(runs) || runs.length !== 2) return null;
  const values = runs.map((run) => run.application_sampled_bytes);
  return values.every((value) => Number.isSafeInteger(value) && value >= 0) ? values : null;
}

function applyNodeAllocationGate(verdict, allocation) {
  if (allocation.status === 'regressed') {
    return outcome('rejected', 'The baseline allocation source materially regressed.');
  }
  if (allocation.status === 'no_confidence' && verdict.status !== 'rejected') {
    return outcome(
      'no_confidence',
      'The baseline allocation source activated the gate, but paired profiles were incomplete.'
    );
  }
  if (allocation.status === 'improved' && verdict.status === 'inconclusive') {
    return outcome(
      'confirmed',
      'The baseline allocation source materially improved without a demonstrated latency regression.'
    );
  }
  return verdict;
}

function comparePeakRss(baseline, current, policy) {
  const metric = metricDelta(
    baseline.observed.peak_rss_bytes?.median,
    current.observed.peak_rss_bytes?.median
  );
  if (!metric) return { observation: null, regressed: false };
  const material = Math.abs(metric.delta) >= policy.memory_material_bytes;
  return {
    observation: {
      kind: 'peak_rss_comparison',
      metric,
      provenance: 'sampled_local_process_tree_rss',
    },
    regressed: material && metric.delta_percent >= policy.memory_improvement_percent,
  };
}

function compareBenchmarkSeries(baseline, current, policy) {
  if (!compatibleScaleCurves(baseline, current)) {
    return {
      observed: [],
      verdict: outcome(
        'no_confidence',
        'Scale units or encoded input sizes differ between baseline and current.'
      ),
    };
  }
  const points = baseline.points.map((baselinePoint, index) => {
    const currentPoint = current.points[index];
    return {
      input: baselinePoint.input,
      unit: baseline.unit,
      baseline: baselinePoint.value,
      current: currentPoint.value,
      delta: round(currentPoint.value - baselinePoint.value),
      delta_percent: percentDelta(baselinePoint.value, currentPoint.value),
    };
  });
  const largest = points.at(-1);
  const secondaryRegression = points.some(
    (point) => point.delta_percent > policy.maximum_secondary_regression_percent
  );
  const largestImprovement = -largest.delta_percent;
  const observed = [
    { kind: 'scale_point_comparison', points, provenance: 'console_benchmark_metrics' },
  ];
  if (baseline.points.length >= 2) {
    const baselineExponent = endpointExponent(baseline.points);
    const currentExponent = endpointExponent(current.points);
    observed.push({
      kind: 'scale_exponent_comparison',
      baseline: baselineExponent,
      current: currentExponent,
      delta: round(currentExponent - baselineExponent),
      provenance: 'derived_endpoint_ratio',
    });
  }
  if (largestImprovement >= policy.scale_improvement_percent && !secondaryRegression) {
    return {
      observed,
      verdict: outcome(
        'confirmed',
        `Largest-input time improved by ${round(largestImprovement)}% without a material smaller-input regression.`
      ),
    };
  }
  if (largest.delta_percent >= policy.scale_improvement_percent || secondaryRegression) {
    return {
      observed,
      verdict: outcome(
        'rejected',
        'The target scale metric or a recorded input materially regressed.'
      ),
    };
  }
  return {
    observed,
    verdict: outcome('inconclusive', 'The scale movement did not cross the recorded policy.'),
  };
}

function compareGoBenchmarks(baseline, current, policy) {
  const baselineBenchmark = baseline.observed.go_benchmarks[0];
  const currentBenchmark = current.observed.go_benchmarks.find(
    (benchmark) => benchmark.name === baselineBenchmark?.name
  );
  if (!baselineBenchmark || !currentBenchmark) {
    return {
      observed: [],
      verdict: outcome('no_confidence', 'The identical Go benchmark was not captured twice.'),
    };
  }
  const metrics = {
    ns_per_op: metricDelta(baselineBenchmark.ns_per_op?.median, currentBenchmark.ns_per_op?.median),
    bytes_per_op: metricDelta(
      baselineBenchmark.bytes_per_op?.median,
      currentBenchmark.bytes_per_op?.median
    ),
    allocs_per_op: metricDelta(
      baselineBenchmark.allocs_per_op?.median,
      currentBenchmark.allocs_per_op?.median
    ),
  };
  if (Object.values(metrics).some((metric) => metric === null)) {
    return {
      observed: [],
      verdict: outcome(
        'no_confidence',
        'Go benchmark timing and allocation metrics are incomplete.'
      ),
    };
  }
  const allocationImproved =
    metrics.allocs_per_op.delta <= -1 ||
    metrics.bytes_per_op.delta_percent <= -policy.allocation_bytes_improvement_percent;
  const latencyImproved = metrics.ns_per_op.delta_percent <= -policy.go_latency_improvement_percent;
  const secondaryRegression =
    metrics.ns_per_op.delta_percent > policy.maximum_secondary_regression_percent;
  const allocationRegressed =
    metrics.allocs_per_op.delta >= 1 ||
    metrics.bytes_per_op.delta_percent >= policy.allocation_bytes_improvement_percent;
  const observed = [
    {
      kind: 'go_benchmark_comparison',
      name: baselineBenchmark.name,
      metrics,
      provenance: 'go_test_benchmark_output',
    },
  ];
  if ((allocationImproved || latencyImproved) && !secondaryRegression && !allocationRegressed) {
    return {
      observed,
      verdict: outcome(
        'confirmed',
        latencyImproved && allocationImproved
          ? 'Latency and allocation cost materially improved.'
          : latencyImproved
            ? 'Latency materially improved without an allocation regression.'
            : 'Allocation cost improved without an unacceptable ns/op regression.'
      ),
    };
  }
  if (allocationRegressed || secondaryRegression) {
    return {
      observed,
      verdict: outcome('rejected', 'Allocation cost or benchmark latency materially regressed.'),
    };
  }
  return {
    observed,
    verdict: outcome(
      'inconclusive',
      'Latency and allocation movement did not cross the recorded policy.'
    ),
  };
}

function compareWallTime(baseline, current, policy) {
  const comparison = comparePerformanceCapsules(current, baseline);
  const memory = metricDelta(
    baseline.observed.peak_rss_bytes?.median,
    current.observed.peak_rss_bytes?.median
  );
  const observed = [
    { kind: 'wall_time_comparison', comparison },
    ...(memory
      ? [
          {
            kind: 'peak_rss_comparison',
            metric: memory,
            provenance: 'sampled_local_process_tree_rss',
          },
        ]
      : []),
  ];
  const materialMemoryMovement = memory && Math.abs(memory.delta) >= policy.memory_material_bytes;
  const memoryImproved =
    policy.memory_regression_gate &&
    materialMemoryMovement &&
    memory.delta_percent <= -policy.memory_improvement_percent;
  const memoryRegressed =
    policy.memory_regression_gate &&
    materialMemoryMovement &&
    memory.delta_percent >= policy.memory_improvement_percent;
  if (memoryRegressed) {
    return {
      observed,
      verdict: outcome('rejected', 'Peak process-tree RSS materially regressed.'),
    };
  }
  if (comparison.status === 'regressed') {
    return { observed, verdict: outcome('rejected', 'Compatible wall time materially regressed.') };
  }
  if (comparison.status === 'improved' || memoryImproved) {
    return {
      observed,
      verdict: outcome(
        'confirmed',
        comparison.status === 'improved' && memoryImproved
          ? 'Compatible wall time and peak process-tree RSS materially improved.'
          : comparison.status === 'improved'
            ? 'Compatible wall time materially improved without a material memory regression.'
            : 'Peak process-tree RSS materially improved without a material wall-time regression.'
      ),
    };
  }
  if (comparison.status === 'stable') {
    return { observed, verdict: outcome('inconclusive', 'Wall-time movement was below policy.') };
  }
  return { observed, verdict: outcome('no_confidence', comparison.reason) };
}

function compareScopeCompatibility(baseline, current) {
  const differences = [];
  const sameHost =
    (!baseline.subject.platform || baseline.subject.platform === current.subject.platform) &&
    (!baseline.subject.architecture ||
      baseline.subject.architecture === current.subject.architecture);
  const sameNodeRuntime =
    baseline.adapter.kind === 'go-bench' ||
    !baseline.subject.node_version ||
    baseline.subject.node_version === current.subject.node_version;
  const sameGoRuntime =
    baseline.adapter.kind !== 'go-bench' ||
    (typeof baseline.subject.go_version === 'string' &&
      baseline.subject.go_version === current.subject.go_version);
  const sameHeapSamplingInterval =
    (baseline.capture?.heap_sampling_interval_bytes ?? null) ===
    (current.capture?.heap_sampling_interval_bytes ?? null);
  const sameGoProfileIterations =
    baseline.adapter.kind !== 'go-bench' ||
    (Number.isInteger(baseline.capture?.go_profile_iterations) &&
      baseline.capture.go_profile_iterations === current.capture?.go_profile_iterations);
  if (baseline.schema_version !== current.schema_version) differences.push('schema');
  if (baseline.adapter.kind !== current.adapter.kind) differences.push('adapter kind');
  if (
    typeof baseline.adapter.executable_identity !== 'string' ||
    baseline.adapter.executable_identity.length === 0 ||
    baseline.adapter.executable_identity !== current.adapter.executable_identity
  ) {
    differences.push('adapter executable identity');
  }
  if (!sameStringArray(baseline.adapter.arguments, current.adapter.arguments)) {
    differences.push('adapter arguments');
  }
  if (
    typeof baseline.adapter.working_directory !== 'string' ||
    baseline.adapter.working_directory.length === 0 ||
    baseline.adapter.working_directory !== current.adapter.working_directory
  ) {
    differences.push('adapter working directory');
  }
  if (baseline.scope.target !== current.scope.target) differences.push('target');
  if ((baseline.scope.name ?? null) !== (current.scope.name ?? null)) {
    differences.push('exact workload');
  }
  if (!sameHost) differences.push('host identity');
  if (!sameNodeRuntime || !sameGoRuntime) differences.push('runtime identity');
  if (!sameHeapSamplingInterval || !sameGoProfileIterations) differences.push('capture identity');
  return { compatible: differences.length === 0, differences };
}

function sameStringArray(baseline, current) {
  return (
    Array.isArray(baseline) &&
    Array.isArray(current) &&
    baseline.length === current.length &&
    baseline.every((value, index) => typeof value === 'string' && value === current[index])
  );
}

function compatibleScaleCurves(baseline, current) {
  return (
    baseline &&
    current &&
    baseline.unit === current.unit &&
    baseline.points.length === current.points.length &&
    baseline.points.every((point, index) => point.input === current.points[index].input)
  );
}

function endpointExponent(points) {
  const first = points[0];
  const last = points.at(-1);
  return round(Math.log(last.value / first.value) / Math.log(last.input / first.input));
}

function metricDelta(baseline, current) {
  if (!Number.isFinite(baseline) || !Number.isFinite(current) || baseline < 0) return null;
  return {
    baseline,
    current,
    delta: round(current - baseline),
    delta_percent: percentDelta(baseline, current),
  };
}

function median(values) {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function percentDelta(baseline, current) {
  if (baseline === 0) return current === 0 ? 0 : Number.POSITIVE_INFINITY;
  return round(((current - baseline) / baseline) * 100);
}

function outcome(status, reason) {
  return { status, reason };
}

function buildImpactDecisions({ baseline, current, observed, verdict, limitations, policy }) {
  const mechanicallyConfirmed = verdict.status === 'confirmed';
  let materiallyUseful = mechanicallyConfirmed;
  if (mechanicallyConfirmed && current.adapter.kind === 'go-bench') {
    const metrics = observed.find((entry) => entry.kind === 'go_benchmark_comparison')?.metrics;
    materiallyUseful = Boolean(
      metrics &&
        (metrics.ns_per_op.delta_percent <= -policy.go_latency_improvement_percent ||
          metrics.bytes_per_op.delta_percent <= -policy.allocation_bytes_improvement_percent ||
          metrics.allocs_per_op.delta_percent <= -policy.allocation_count_improvement_percent)
    );
  }
  const baselineSamples = Number(baseline.sample_policy?.samples) || 0;
  const currentSamples = Number(current.sample_policy?.samples) || 0;
  const sampleFloorMet =
    baselineSamples >= policy.shipping_minimum_samples &&
    currentSamples >= policy.shipping_minimum_samples;
  const usesWorkloadMetrics = observed.some((entry) =>
    ['scale_point_comparison', 'go_benchmark_comparison'].includes(entry.kind)
  );
  const limitationsClear = limitations.every(
    (limitation) =>
      NON_BLOCKING_DIAGNOSTIC_LIMITATIONS.has(limitation) ||
      (usesWorkloadMetrics &&
        (limitation.startsWith('Wall-time samples varied by ') ||
          limitation === 'Runtime profile evidence exceeded collection bounds.' ||
          limitation === 'The diagnostic execution produced no V8 function coverage.' ||
          limitation.startsWith('Optional function coverage execution failed:')))
  );
  const shippingRecommended = materiallyUseful && sampleFloorMet && limitationsClear;
  return {
    mechanically_confirmed: mechanicallyConfirmed,
    materially_useful: materiallyUseful,
    shipping_recommended: shippingRecommended,
    basis: shippingRecommended
      ? 'Material movement was confirmed with the recorded shipping sample floor.'
      : materiallyUseful
        ? !sampleFloorMet
          ? 'Material movement was observed, but the evidence does not meet the shipping sample floor.'
          : 'Material movement was confirmed, but recorded evidence limitations still block a shipping recommendation.'
        : mechanicallyConfirmed
          ? 'The measured metric improved, but the practical materiality policy was not crossed.'
          : 'The optimization was not mechanically confirmed.',
  };
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
