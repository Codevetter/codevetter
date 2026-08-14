import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyOptimizationCapsules } from './optimization-verification.mjs';
import { loadPerformanceCapsule } from './performance.mjs';

test('confirms a material largest-input scale improvement', () => {
  const baseline = capsule({ metrics: scaleMetrics([0.5, 6, 25]) });
  const current = capsule({ metrics: scaleMetrics([0.48, 4.5, 15]) });
  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'confirmed');
  assert.equal(report.decisions.mechanically_confirmed, true);
  assert.equal(report.decisions.materially_useful, true);
  assert.equal(report.decisions.shipping_recommended, false);
  const points = report.observed[0].points;
  assert.equal(points.at(-1).delta_percent, -40);
  assert.ok(report.observed[1].current < report.observed[1].baseline);
});

test('compares a repeated single-input benchmark metric without falling back to process startup', () => {
  const baseline = capsule({ metrics: [metric('size100000', 0.894)] });
  const current = capsule({ metrics: [metric('size100000', 0.098)] });
  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'confirmed');
  assert.equal(report.observed.length, 1);
  assert.equal(report.observed[0].kind, 'scale_point_comparison');
  assert.equal(report.observed[0].points[0].delta_percent, -89.038);
});

test('distinguishes shipping sample gaps from recorded evidence limitations', () => {
  const baseline = capsule({ metrics: scaleMetrics([0.5, 6, 25]), samples: 10 });
  const current = capsule({ metrics: scaleMetrics([0.48, 4.5, 15]), samples: 10 });
  const qualified = verifyOptimizationCapsules(baseline, current);
  assert.equal(qualified.decisions.shipping_recommended, true);
  assert.match(qualified.decisions.basis, /shipping sample floor/);

  current.limitations.push('The optimized source candidate fell below the attribution threshold.');
  const limited = verifyOptimizationCapsules(baseline, current);
  assert.equal(limited.decisions.shipping_recommended, false);
  assert.match(limited.decisions.basis, /evidence limitations/);
});

test('rejects a material scale regression and refuses different inputs', () => {
  const baseline = capsule({ metrics: scaleMetrics([0.5, 6, 25]) });
  const regressed = capsule({ metrics: scaleMetrics([0.5, 6, 30]) });
  assert.equal(verifyOptimizationCapsules(baseline, regressed).verdict.status, 'rejected');

  const incompatible = capsule({
    metrics: [metric('size1000', 0.5), metric('size12000', 6), metric('size35000', 20)],
  });
  assert.equal(verifyOptimizationCapsules(baseline, incompatible).verdict.status, 'no_confidence');
});

test('confirms Go allocation improvement only when latency remains bounded', () => {
  const baseline = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(2_500, 7_000, 30)],
  });
  const improved = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(2_600, 6_000, 28)],
  });
  const slower = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(3_100, 6_000, 28)],
  });

  assert.equal(verifyOptimizationCapsules(baseline, improved).verdict.status, 'confirmed');
  assert.equal(verifyOptimizationCapsules(baseline, slower).verdict.status, 'rejected');
});

test('separates a mechanical one-allocation improvement from material impact', () => {
  const baseline = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(2_500, 7_000, 30)],
  });
  const current = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(2_500, 7_000, 29)],
  });
  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'confirmed');
  assert.equal(report.decisions.mechanically_confirmed, true);
  assert.equal(report.decisions.materially_useful, false);
  assert.equal(report.decisions.shipping_recommended, false);
});

test('confirms a material Go latency improvement only without allocation regression', () => {
  const baseline = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(52_500, 0, 0)],
  });
  const faster = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(45_000, 0, 0)],
  });
  const allocating = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(45_000, 16, 1)],
  });

  const confirmed = verifyOptimizationCapsules(baseline, faster);
  assert.equal(confirmed.verdict.status, 'confirmed');
  assert.equal(confirmed.decisions.materially_useful, true);
  assert.equal(verifyOptimizationCapsules(baseline, allocating).verdict.status, 'rejected');
});

test('loads a performance capsule from a full diagnosis document', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-baseline-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const baseline = capsule();
  await writeFile(
    join(root, 'diagnosis.json'),
    JSON.stringify({
      schema_version: 'runtime-performance-diagnosis/v1',
      performance_capsule: baseline,
    })
  );

  assert.deepEqual(await loadPerformanceCapsule(root, 'diagnosis.json'), baseline);
});

test('confirms exact Playwright flow duration while guarding process wall time', () => {
  const baseline = capsule({ adapter: 'playwright', samples: 10 });
  const current = capsule({ adapter: 'playwright', samples: 10 });
  baseline.observed.playwright_test = playwrightTest(200);
  current.observed.playwright_test = playwrightTest(170);
  baseline.observed.wall_time_ms = distribution(1_000);
  current.observed.wall_time_ms = distribution(1_050);

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'confirmed');
  assert.equal(report.observed[0].duration_ms.delta, -30);
  assert.equal(report.decisions.shipping_recommended, true);
});

test('rejects a faster Playwright flow when process wall time materially regresses', () => {
  const baseline = capsule({ adapter: 'playwright', samples: 10 });
  const current = capsule({ adapter: 'playwright', samples: 10 });
  baseline.observed.playwright_test = playwrightTest(200);
  current.observed.playwright_test = playwrightTest(170);
  baseline.observed.wall_time_ms = distribution(1_000);
  current.observed.wall_time_ms = distribution(1_250);

  assert.equal(verifyOptimizationCapsules(baseline, current).verdict.status, 'rejected');
});

function capsule({ adapter = 'vitest', metrics = [], benchmarks = [], samples = 3 } = {}) {
  return {
    schema_version: 'runtime-performance-capsule/v1',
    subject: { repository_revision: 'abc123', dirty: false },
    adapter: { kind: adapter, executable_identity: `local:${adapter}`, arguments: [] },
    scope: {
      target: adapter === 'go-bench' ? 'benchmark_test.go' : 'src/work.test.ts',
      name: 'exact workload',
    },
    sample_policy: { samples, warmups: 1 },
    observed: {
      executions: [],
      wall_time_ms: distribution(735),
      hotspots: [],
      go_benchmarks: benchmarks,
      vitest_tests: [],
      vitest_execution_share: null,
      console_metrics: metrics,
    },
    findings: [],
    relationships: [],
    unverified: [],
    comparison: null,
    limitations: [],
    capture: {},
    verdict: { status: 'profiled', reason: 'Profiled.' },
  };
}

function scaleMetrics(values) {
  return [
    metric('size1000', values[0]),
    metric('size10000', values[1]),
    metric('size35000', values[2]),
  ];
}

function metric(name, value) {
  return {
    kind: 'console_benchmark_metrics',
    metrics: [{ name, value, unit: 'ms/op' }],
    provenance: 'profile_execution_stdout',
  };
}

function goBenchmark(nsPerOp, bytesPerOp, allocsPerOp) {
  return {
    name: 'BenchmarkMiddleware-18',
    ns_per_op: distribution(nsPerOp),
    bytes_per_op: distribution(bytesPerOp),
    allocs_per_op: distribution(allocsPerOp),
    provenance: 'go_test_benchmark_output',
  };
}

function distribution(median) {
  return { count: 3, min: median, median, p95: median, max: median, spread_percent: 0 };
}

function playwrightTest(median) {
  return {
    exact_name: 'exact workload',
    duration_ms: distribution(median),
    expected_samples: 10,
    captured_samples: 10,
    complete: true,
    limitations: [],
    provenance: 'playwright_json_reporter',
  };
}
