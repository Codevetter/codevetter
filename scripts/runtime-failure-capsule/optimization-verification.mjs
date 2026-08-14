import {
  OPTIMIZATION_VERIFICATION_SCHEMA_VERSION,
  validateOptimizationVerification,
  validatePerformanceCapsule,
} from './contracts.mjs';
import { extractBenchmarkSeries } from './performance-diagnosis.mjs';
import { comparePerformanceCapsules } from './performance.mjs';

const DEFAULT_POLICY = Object.freeze({
  scale_improvement_percent: 10,
  allocation_bytes_improvement_percent: 5,
  allocation_count_improvement_percent: 10,
  go_latency_improvement_percent: 10,
  maximum_secondary_regression_percent: 20,
  playwright_duration_improvement_percent: 10,
  playwright_duration_improvement_ms: 10,
  playwright_wall_regression_percent: 20,
  shipping_minimum_samples: 10,
});

export function verifyOptimizationCapsules(baseline, current, policy = {}) {
  for (const [label, capsule] of [
    ['baseline', baseline],
    ['current', current],
  ]) {
    const errors = validatePerformanceCapsule(capsule);
    if (errors.length > 0)
      throw new Error(`invalid ${label} performance capsule: ${errors.join(', ')}`);
  }
  const resolvedPolicy = { ...DEFAULT_POLICY, ...policy };
  const limitations = [...new Set([...baseline.limitations, ...current.limitations])];
  let observed = [];
  let verdict;

  if (!compatibleScope(baseline, current)) {
    verdict = outcome(
      'no_confidence',
      'Baseline and current schema, adapter, target, or exact workload identity differ.'
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
    } else if (baseline.adapter.kind === 'playwright') {
      ({ observed, verdict } = comparePlaywrightFlow(baseline, current, resolvedPolicy));
    } else {
      ({ observed, verdict } = compareWallTime(baseline, current));
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

function comparePlaywrightFlow(baseline, current, policy) {
  const baselineDuration = baseline.observed.playwright_test?.duration_ms?.median;
  const currentDuration = current.observed.playwright_test?.duration_ms?.median;
  const baselineWall = baseline.observed.wall_time_ms?.median;
  const currentWall = current.observed.wall_time_ms?.median;
  if (
    !baseline.observed.playwright_test?.complete ||
    !current.observed.playwright_test?.complete ||
    !Number.isFinite(baselineDuration) ||
    !Number.isFinite(currentDuration) ||
    !Number.isFinite(baselineWall) ||
    !Number.isFinite(currentWall) ||
    baselineDuration <= 0 ||
    baselineWall <= 0
  ) {
    return {
      observed: [],
      verdict: outcome('no_confidence', 'Exact Playwright duration evidence is incomplete.'),
    };
  }
  const duration = metricDelta(baselineDuration, currentDuration);
  const wall = metricDelta(baselineWall, currentWall);
  const observed = [
    {
      kind: 'playwright_flow_comparison',
      exact_name: current.observed.playwright_test.exact_name,
      duration_ms: duration,
      process_wall_ms: wall,
      provenance: 'playwright_json_reporter_and_owned_process_clock',
    },
  ];
  const durationImproved =
    duration.delta <= -policy.playwright_duration_improvement_ms &&
    duration.delta_percent <= -policy.playwright_duration_improvement_percent;
  const wallRegressed = wall.delta_percent > policy.playwright_wall_regression_percent;
  if (durationImproved && !wallRegressed) {
    return {
      observed,
      verdict: outcome(
        'confirmed',
        'Exact Playwright test duration materially improved without a process-wall regression.'
      ),
    };
  }
  if (
    duration.delta >= policy.playwright_duration_improvement_ms ||
    duration.delta_percent >= policy.playwright_duration_improvement_percent ||
    wallRegressed
  ) {
    return {
      observed,
      verdict: outcome(
        'rejected',
        'Browser flow duration or process wall time materially regressed.'
      ),
    };
  }
  return {
    observed,
    verdict: outcome('inconclusive', 'Browser flow movement did not cross the recorded policy.'),
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

function compareWallTime(baseline, current) {
  const comparison = comparePerformanceCapsules(current, baseline);
  const observed = [{ kind: 'wall_time_comparison', comparison }];
  if (comparison.status === 'improved') {
    return { observed, verdict: outcome('confirmed', 'Compatible wall time materially improved.') };
  }
  if (comparison.status === 'regressed') {
    return { observed, verdict: outcome('rejected', 'Compatible wall time materially regressed.') };
  }
  if (comparison.status === 'stable') {
    return { observed, verdict: outcome('inconclusive', 'Wall-time movement was below policy.') };
  }
  return { observed, verdict: outcome('no_confidence', comparison.reason) };
}

function compatibleScope(baseline, current) {
  return (
    baseline.schema_version === current.schema_version &&
    baseline.adapter.kind === current.adapter.kind &&
    baseline.scope.target === current.scope.target &&
    (baseline.scope.name ?? null) === (current.scope.name ?? null)
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
  const limitationsClear = limitations.length === 0;
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
