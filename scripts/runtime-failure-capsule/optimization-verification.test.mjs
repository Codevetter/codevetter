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

test('does not let a post-change CPU attribution tie block stable benchmark evidence', () => {
  const baseline = capsule({ metrics: scaleMetrics([0.5, 6, 25]), samples: 10 });
  const current = capsule({ metrics: scaleMetrics([0.48, 4.5, 15]), samples: 10 });
  current.limitations.push(
    'Independent V8 profiles disagreed on the leading application source candidate.'
  );

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'confirmed');
  assert.equal(report.decisions.shipping_recommended, true);
  assert.equal(report.limitations.length, 1);
});

test('does not require every post-change CPU profile to repeat the original source frame', () => {
  const baseline = capsule({ metrics: scaleMetrics([0.5, 6, 25]), samples: 10 });
  const current = capsule({ metrics: scaleMetrics([0.48, 4.5, 15]), samples: 10 });
  current.limitations.push(
    'Independent V8 profiles did not all capture an application source candidate.'
  );

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'confirmed');
  assert.equal(report.decisions.shipping_recommended, true);
});

test('does not let an optimized CPU source falling below materiality block explicit metrics', () => {
  const baseline = capsule({ metrics: scaleMetrics([0.5, 6, 25]), samples: 10 });
  const current = capsule({ metrics: scaleMetrics([0.48, 4.5, 15]), samples: 10 });
  current.limitations.push(
    'The repeated V8 source candidate did not cross the recorded sample, duration, total-profile, or application-relative share thresholds.'
  );

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'confirmed');
  assert.equal(report.decisions.shipping_recommended, true);
  assert.equal(report.limitations.length, 1);
});

test('does not apply process-startup noise to explicit workload metrics', () => {
  const baseline = capsule({ metrics: scaleMetrics([0.5, 6, 25]), samples: 10 });
  const current = capsule({ metrics: scaleMetrics([0.48, 4.5, 15]), samples: 10 });
  current.limitations.push(
    'Wall-time samples varied by 117.048%; host load or startup noise may dominate the comparison.'
  );

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.decisions.shipping_recommended, true);
  assert.equal(report.limitations.length, 1);
});

test('does not require optional function coverage for explicit workload metrics', () => {
  const baseline = capsule({ metrics: scaleMetrics([0.5, 6, 25]), samples: 10 });
  const current = capsule({ metrics: scaleMetrics([0.48, 4.5, 15]), samples: 10 });
  baseline.limitations.push(
    'The diagnostic execution produced no V8 function coverage.',
    'Optional function coverage execution failed: exit 1.'
  );

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.decisions.shipping_recommended, true);
  assert.equal(report.limitations.length, 2);
});

test('does not let bounded attribution truncation override complete workload metrics', () => {
  const baseline = capsule({ metrics: scaleMetrics([0.5, 6, 25]), samples: 10 });
  const current = capsule({ metrics: scaleMetrics([0.48, 4.5, 15]), samples: 10 });
  current.limitations.push('Runtime profile evidence exceeded collection bounds.');

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'confirmed');
  assert.equal(report.decisions.shipping_recommended, true);
  assert.equal(report.limitations.length, 1);
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

test('refuses a Node comparison captured under a different runtime', () => {
  const baseline = capsule({ metrics: scaleMetrics([0.5, 6, 25]), samples: 10 });
  const current = capsule({ metrics: scaleMetrics([0.4, 4, 12]), samples: 10 });
  baseline.subject.node_version = 'v24.19.0';
  current.subject.node_version = 'v26.7.0';

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'no_confidence');
  assert.equal(report.decisions.shipping_recommended, false);
  assert.match(report.verdict.reason, /runtime identity/);
});

test('refuses Node allocation evidence captured at a different sampling interval', () => {
  const baseline = capsule({ metrics: scaleMetrics([0.5, 6, 25]), samples: 10 });
  const current = capsule({ metrics: scaleMetrics([0.4, 4, 12]), samples: 10 });
  baseline.capture.heap_sampling_interval_bytes = 32 * 1024;
  current.capture.heap_sampling_interval_bytes = 8 * 1024;

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'no_confidence');
  assert.equal(report.decisions.shipping_recommended, false);
  assert.match(report.verdict.reason, /capture identity/);
});

test('refuses a comparison captured with different ordered runner arguments', () => {
  const baseline = capsule({ metrics: scaleMetrics([0.5, 6, 25]), samples: 10 });
  const current = capsule({ metrics: scaleMetrics([0.4, 4, 12]), samples: 10 });
  baseline.adapter.arguments = ['run', '--pool=forks', '--maxWorkers=8'];
  current.adapter.arguments = ['run', '--pool=forks', '--maxWorkers=1'];

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'no_confidence');
  assert.equal(report.decisions.shipping_recommended, false);
  assert.match(report.verdict.reason, /adapter arguments/);

  current.adapter.arguments = ['--maxWorkers=8', '--pool=forks', 'run'];
  assert.match(verifyOptimizationCapsules(baseline, current).verdict.reason, /adapter arguments/);
});

test('refuses executable and working-directory drift while accepting identical commands', () => {
  const baseline = capsule({ metrics: scaleMetrics([0.5, 6, 25]), samples: 10 });
  const current = capsule({ metrics: scaleMetrics([0.4, 4, 12]), samples: 10 });
  baseline.adapter.arguments = ['run', '--pool=forks', '--maxWorkers=1'];
  current.adapter.arguments = [...baseline.adapter.arguments];
  baseline.adapter.working_directory = 'apps/web';
  current.adapter.working_directory = 'apps/web';

  assert.equal(verifyOptimizationCapsules(baseline, current).verdict.status, 'confirmed');

  current.adapter.executable_identity = 'local:vitest-next';
  assert.match(
    verifyOptimizationCapsules(baseline, current).verdict.reason,
    /adapter executable identity/
  );

  current.adapter.executable_identity = baseline.adapter.executable_identity;
  current.adapter.working_directory = 'apps/other';
  assert.match(
    verifyOptimizationCapsules(baseline, current).verdict.reason,
    /adapter working directory/
  );
});

test('refuses missing recorded runner-command identity', () => {
  const baseline = capsule({ metrics: scaleMetrics([0.5, 6, 25]), samples: 10 });
  const current = capsule({ metrics: scaleMetrics([0.4, 4, 12]), samples: 10 });
  delete baseline.adapter.arguments;
  delete current.adapter.arguments;

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'no_confidence');
  assert.match(report.verdict.reason, /adapter arguments/);
});

test('treats peak process-tree memory as an independent regression gate', () => {
  const baseline = capsule({ samples: 10, wall: 735, peakRss: 256 * 1024 * 1024 });
  const lowerMemory = capsule({ samples: 10, wall: 735, peakRss: 220 * 1024 * 1024 });
  const fasterButLarger = capsule({
    samples: 10,
    wall: 580,
    peakRss: 304 * 1024 * 1024,
  });

  const improved = verifyOptimizationCapsules(baseline, lowerMemory);
  assert.equal(improved.verdict.status, 'confirmed');
  assert.match(improved.verdict.reason, /RSS materially improved/);
  const rejected = verifyOptimizationCapsules(baseline, fasterButLarger);
  assert.equal(rejected.verdict.status, 'rejected');
  assert.match(rejected.verdict.reason, /RSS materially regressed/);
});

test('confirms a material repeated Node allocation reduction without a latency regression', () => {
  const baseline = capsule({
    samples: 10,
    wall: 735,
    heapCandidateBytes: [512 * 1024, 544 * 1024],
  });
  const current = capsule({
    samples: 10,
    wall: 735,
    heapRuns: [128 * 1024, 160 * 1024],
  });

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'confirmed');
  const allocation = report.observed.find(
    (observation) => observation.kind === 'node_allocation_comparison'
  );
  assert.equal(allocation.status, 'improved');
  assert.equal(allocation.metric.delta_percent, -72.727);
  assert.equal(allocation.conservative_range.improvement.delta_percent, -68.75);
  assert.equal(report.decisions.materially_useful, true);
});

test('rejects a Node allocation regression even when the benchmark metric improves', () => {
  const baseline = capsule({
    metrics: scaleMetrics([0.5, 6, 25]),
    heapCandidateBytes: [256 * 1024, 288 * 1024],
  });
  const current = capsule({
    metrics: scaleMetrics([0.4, 4, 12]),
    heapRuns: [512 * 1024, 544 * 1024],
  });

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'rejected');
  assert.match(report.verdict.reason, /allocation source materially regressed/);
});

test('keeps median-only V8 allocation movement stable when paired ranges do not clear policy', () => {
  const baseline = capsule({
    samples: 10,
    wall: 735,
    heapCandidateBytes: [1_606_440, 1_344_176],
  });
  const current = capsule({
    samples: 10,
    wall: 580,
    heapRuns: [1_835_944, 1_835_872],
  });

  const report = verifyOptimizationCapsules(baseline, current);
  const allocation = report.observed.find(
    (observation) => observation.kind === 'node_allocation_comparison'
  );

  assert.equal(allocation.metric.delta_percent, 24.442);
  assert.equal(allocation.conservative_range.regression.delta_percent, 14.282);
  assert.equal(allocation.status, 'stable');
  assert.equal(report.verdict.status, 'confirmed');
});

test('verifies an explicitly selected alternate Node allocation source', () => {
  const primaryBytes = [512 * 1024, 520 * 1024];
  const selectedSource = { file: 'src/coverage.js', line: 40, function: 'indexLines' };
  const baseline = capsule({ samples: 10, wall: 100, heapCandidateBytes: primaryBytes });
  const current = capsule({ samples: 10, wall: 100, heapRuns: primaryBytes });
  addHeapSource(baseline, selectedSource, [256 * 1024, 272 * 1024], true);
  addHeapSource(current, selectedSource, [96 * 1024, 104 * 1024], false);

  assert.equal(verifyOptimizationCapsules(baseline, current).verdict.status, 'inconclusive');
  const report = verifyOptimizationCapsules(
    baseline,
    current,
    {},
    {
      nodeAllocationSource: {
        file: selectedSource.file,
        function: selectedSource.function,
      },
    }
  );
  const allocation = report.observed.find(
    (observation) => observation.kind === 'node_allocation_comparison'
  );
  assert.equal(allocation.source.function, 'indexLines');
  assert.equal(allocation.status, 'improved');
  assert.equal(report.verdict.status, 'confirmed');
});

test('does not confirm a source-only allocation shift', () => {
  const primaryBytes = [512 * 1024, 520 * 1024];
  const selectedSource = { file: 'src/coverage.js', line: 40, function: 'indexLines' };
  const baseline = capsule({ samples: 10, wall: 100, heapCandidateBytes: primaryBytes });
  const current = capsule({ samples: 10, wall: 100, heapRuns: primaryBytes });
  addHeapSource(baseline, selectedSource, [256 * 1024, 272 * 1024], true);
  addHeapSource(current, selectedSource, [0, 0], false);
  current.observed.heap_profile_runs.forEach((run, index) => {
    run.application_sampled_bytes =
      baseline.observed.heap_profile_runs[index].application_sampled_bytes;
  });

  const report = verifyOptimizationCapsules(
    baseline,
    current,
    {},
    { nodeAllocationSource: { file: selectedSource.file, function: selectedSource.function } }
  );
  const allocation = report.observed.find(
    (observation) => observation.kind === 'node_allocation_comparison'
  );
  assert.equal(allocation.metric.delta_percent, -100);
  assert.equal(
    allocation.attribution_status,
    'source_reduction_not_confirmed_by_application_total'
  );
  assert.equal(allocation.status, 'stable');
  assert.equal(report.verdict.status, 'inconclusive');
});

test('fails closed when an activated Node allocation gate lacks paired profiles', () => {
  const baseline = capsule({ heapCandidateBytes: [256 * 1024, 288 * 1024] });
  const current = capsule();

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'no_confidence');
  assert.match(report.verdict.reason, /paired profiles were incomplete/);
});

test('does not activate a Node allocation gate from truncated baseline evidence', () => {
  const baseline = capsule({ heapCandidateBytes: [256 * 1024, 288 * 1024] });
  baseline.capture.heap_profile_truncated = true;
  const current = capsule();

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'inconclusive');
  assert.equal(
    report.observed.some((observation) => observation.kind === 'node_allocation_comparison'),
    false
  );
});

test('applies the peak RSS regression gate to explicit Node benchmark metrics', () => {
  const baseline = capsule({
    metrics: scaleMetrics([0.5, 6, 25]),
    peakRss: 256 * 1024 * 1024,
  });
  const current = capsule({
    metrics: scaleMetrics([0.4, 4, 12]),
    peakRss: 304 * 1024 * 1024,
  });

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'rejected');
  assert.match(report.verdict.reason, /RSS materially regressed/);
  assert.ok(report.observed.some((observation) => observation.kind === 'peak_rss_comparison'));
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

test('keeps standard Go RSS and pprof claim boundaries non-blocking at the shipping floor', () => {
  const baseline = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(52_500, 16, 1)],
    samples: 10,
  });
  const current = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(45_000, 0, 0)],
    samples: 10,
  });
  const claimBoundaries = [
    'Peak RSS is sampled from an owned Go benchmark binary with compilation excluded; it is a regression guard and does not identify an allocation source.',
    'Go pprof direct allocation values are normalized per benchmark operation; they do not represent retained heap or peak memory.',
  ];
  baseline.limitations.push(...claimBoundaries);
  current.limitations.push(...claimBoundaries);

  const report = verifyOptimizationCapsules(baseline, current);
  assert.equal(report.verdict.status, 'confirmed');
  assert.equal(report.decisions.shipping_recommended, true);
});

test('rejects a faster Go benchmark when process-tree RSS materially regresses', () => {
  const baseline = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(52_500, 0, 0)],
    peakRss: 300 * 1024 * 1024,
  });
  const current = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(45_000, 0, 0)],
    peakRss: 350 * 1024 * 1024,
  });

  const report = verifyOptimizationCapsules(baseline, current);
  assert.equal(report.verdict.status, 'rejected');
  assert.match(report.verdict.reason, /RSS materially regressed/);
  assert.ok(report.observed.some((observation) => observation.kind === 'peak_rss_comparison'));
});

test('records but does not reject non-interleaved screening RSS movement', () => {
  const baseline = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(52_500, 16, 1)],
    peakRss: 200 * 1024 * 1024,
  });
  const current = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(25_000, 0, 0)],
    peakRss: 260 * 1024 * 1024,
  });

  const report = verifyOptimizationCapsules(baseline, current, {
    memory_regression_gate: false,
  });
  assert.equal(report.verdict.status, 'confirmed');
  assert.equal(report.policy.memory_regression_gate, false);
  assert.ok(report.observed.some((observation) => observation.kind === 'peak_rss_comparison'));
});

test('rejects a faster Go benchmark when its repeated direct allocation source regresses', () => {
  const baseline = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(52_500, 16, 1)],
    goProfileObjects: [1, 1],
  });
  const current = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(45_000, 8, 0)],
    goProfileObjects: [2, 2],
  });

  const report = verifyOptimizationCapsules(baseline, current);
  assert.equal(report.verdict.status, 'rejected');
  assert.match(report.verdict.reason, /Go allocation source materially regressed/);
  const source = report.observed.find(
    (observation) => observation.kind === 'go_allocation_source_comparison'
  );
  assert.equal(source.status, 'regressed');
  assert.deepEqual(source.baseline_per_run_objects_per_op, [1, 1]);
  assert.deepEqual(source.current_per_run_objects_per_op, [2, 2]);
});

test('confirms aggregate Go allocation improvement and records the disappearing source', () => {
  const baseline = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(52_500, 16, 1)],
    goProfileObjects: [1, 1],
  });
  const current = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(52_500, 0, 0)],
    goProfileObjects: [0, 0],
  });

  const report = verifyOptimizationCapsules(baseline, current);
  assert.equal(report.verdict.status, 'confirmed');
  const source = report.observed.find(
    (observation) => observation.kind === 'go_allocation_source_comparison'
  );
  assert.equal(source.status, 'improved');
  assert.deepEqual(source.current_per_run_objects_per_op, [0, 0]);
});

test('fails closed when an activated Go allocation source lacks paired profiles', () => {
  const baseline = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(52_500, 16, 1)],
    goProfileObjects: [1, 1],
  });
  const current = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(45_000, 8, 0)],
  });

  const report = verifyOptimizationCapsules(baseline, current);
  assert.equal(report.verdict.status, 'no_confidence');
  assert.match(report.verdict.reason, /paired profiles were incomplete/);
});

test('refuses a Go benchmark captured under a different toolchain', () => {
  const baseline = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(50_000, 16, 1)],
    samples: 10,
  });
  const current = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(25_000, 16, 1)],
    samples: 10,
  });
  baseline.subject.go_version = 'go1.24.0';
  current.subject.go_version = 'go1.25.0';

  const report = verifyOptimizationCapsules(baseline, current);

  assert.equal(report.verdict.status, 'no_confidence');
  assert.match(report.verdict.reason, /runtime identity/);
});

test('refuses Go source evidence captured with a different or missing fixed profile denominator', () => {
  const baseline = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(50_000, 16, 1)],
    samples: 10,
  });
  const current = capsule({
    adapter: 'go-bench',
    benchmarks: [goBenchmark(25_000, 16, 1)],
    samples: 10,
  });
  baseline.capture.go_profile_iterations = 20_000;
  current.capture.go_profile_iterations = 25_000;

  assert.match(verifyOptimizationCapsules(baseline, current).verdict.reason, /capture identity/);
  delete current.capture.go_profile_iterations;
  assert.match(verifyOptimizationCapsules(baseline, current).verdict.reason, /capture identity/);
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

function capsule({
  adapter = 'vitest',
  metrics = [],
  benchmarks = [],
  samples = 3,
  wall = 735,
  peakRss,
  heapCandidateBytes,
  heapRuns = heapCandidateBytes,
  goProfileObjects,
} = {}) {
  const allocationSource = { file: 'src/allocate.ts', line: 12, function: 'allocateRows' };
  const goAllocationSource = { file: 'allocate.go', line: 12, function: 'allocateRows' };
  return {
    schema_version: 'runtime-performance-capsule/v1',
    subject: {
      repository_revision: 'abc123',
      dirty: false,
      platform: 'darwin',
      architecture: 'arm64',
      node_version: 'v24.19.0',
      go_version: adapter === 'go-bench' ? 'go1.25.0' : null,
    },
    adapter: {
      kind: adapter,
      executable_identity: `local:${adapter}`,
      arguments: [],
      working_directory: '.',
    },
    scope: {
      target: adapter === 'go-bench' ? 'benchmark_test.go' : 'src/work.test.ts',
      name: 'exact workload',
    },
    sample_policy: { samples, warmups: 1 },
    observed: {
      executions: [],
      wall_time_ms: distribution(wall),
      peak_rss_bytes:
        peakRss === undefined
          ? { count: 0, min: null, median: null, p95: null, max: null, spread_percent: null }
          : distribution(peakRss),
      hotspots: [],
      go_benchmarks: benchmarks,
      vitest_tests: [],
      vitest_execution_share: null,
      console_metrics: metrics,
      profile_runs: Array.isArray(goProfileObjects)
        ? goProfileObjects.map((objectsPerOp, index) => ({
            index,
            profile_kind: 'go_cpu_and_allocation',
            profile_files: 2,
            profile_bytes: 1_000,
            profile_samples: 10,
            leading_application_hotspot:
              objectsPerOp > 0
                ? {
                    ...goAllocationSource,
                    role: 'application',
                    profile_kind: 'go_alloc_objects',
                    unit: 'count',
                    flat: objectsPerOp * 1_000,
                    cumulative: objectsPerOp * 1_000,
                    flat_share: 0.5,
                    cumulative_share: 0.5,
                    sample_share: 0.5,
                  }
                : null,
            application_hotspots:
              objectsPerOp > 0
                ? [
                    {
                      ...goAllocationSource,
                      role: 'application',
                      profile_kind: 'go_alloc_objects',
                      unit: 'count',
                      flat: objectsPerOp * 1_000,
                      cumulative: objectsPerOp * 1_000,
                      flat_share: 0.5,
                      cumulative_share: 0.5,
                      sample_share: 0.5,
                    },
                  ]
                : [],
            benchmark: {
              name: 'BenchmarkMiddleware-18',
              iterations: distribution(1_000),
            },
            fixed_benchmark_iterations: 1_000,
            failed_kinds: [],
            truncated: false,
          }))
        : [],
      heap_profile_runs: Array.isArray(heapRuns)
        ? heapRuns.map((sampledBytes, index) => ({
            index,
            profile_kind: 'v8_heap_allocation',
            profile_files: 1,
            profile_bytes: 1_000,
            profile_samples: 10,
            sampled_bytes: sampledBytes,
            collection_scope: 'includes_objects_collected_by_minor_and_major_gc',
            application_sampled_bytes: sampledBytes,
            leading_application_hotspot: {
              ...allocationSource,
              role: 'application',
              sampled_bytes: sampledBytes,
              sample_share: 0.5,
            },
            application_hotspots: [
              {
                ...allocationSource,
                role: 'application',
                sampled_bytes: sampledBytes,
                sample_share: 0.5,
              },
            ],
            truncated: false,
          }))
        : [],
    },
    findings: Array.isArray(heapCandidateBytes)
      ? [
          {
            kind: 'node_allocation_candidate',
            basis: 'repository_owned_v8_sampled_allocation_bytes',
            source: allocationSource,
            sampled_bytes: heapCandidateBytes.reduce((total, value) => total + value, 0),
            per_run_sampled_bytes: heapCandidateBytes,
            sample_share: 0.5,
            provenance: 'two_independent_v8_sampling_heap_profiles',
          },
        ]
      : [],
    relationships: [],
    unverified: [],
    comparison: null,
    limitations: [],
    capture: adapter === 'go-bench' ? { go_profile_iterations: 1_000 } : {},
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

function addHeapSource(capsule, source, perRunBytes, includeFinding) {
  for (const [index, sampledBytes] of perRunBytes.entries()) {
    capsule.observed.heap_profile_runs[index].application_sampled_bytes += sampledBytes;
    capsule.observed.heap_profile_runs[index].application_hotspots.push({
      ...source,
      role: 'application',
      sampled_bytes: sampledBytes,
      sample_share: 0.2,
    });
  }
  if (!includeFinding) return;
  capsule.findings.push({
    kind: 'node_allocation_candidate',
    basis: 'repository_owned_v8_sampled_allocation_bytes',
    source,
    sampled_bytes: perRunBytes.reduce((total, value) => total + value, 0),
    per_run_sampled_bytes: perRunBytes,
    sample_share: 0.2,
    provenance: 'two_independent_v8_sampling_heap_profiles',
  });
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
