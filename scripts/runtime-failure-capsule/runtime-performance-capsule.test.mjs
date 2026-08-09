import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { PERFORMANCE_DIAGNOSIS_SCHEMA_VERSION, PERFORMANCE_SCHEMA_VERSION } from './contracts.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import {
  comparePerformanceCapsules,
  evaluateV8Repeatability,
  parseConsoleBenchmarkMetrics,
  summarizeConsoleBenchmarkMetrics,
  parseGoBenchmarks,
  parseGoPprofTop,
  parseVitestTimings,
  parseV8CpuProfileDocuments,
  profileRepository,
  requiredExecutionsCompleted,
  selectedWorkloadExecuted,
  summarizeDistribution,
  summarizeVitestExecutionShare,
} from './performance.mjs';
import { runClosedAdapter } from './runner.mjs';

function applicationHotspot({
  functionName = 'rankProjectRecommendations',
  line = 20,
  selfTimeMs = 100,
  samples = 80,
  sampleShare,
}) {
  return {
    function: functionName,
    file: 'src/lib/project-recommendations.ts',
    line,
    role: 'application',
    self_time_ms: selfTimeMs,
    samples,
    sample_share: sampleShare,
  };
}

test('summarizes timing distributions and Go benchmark measurements', () => {
  assert.deepEqual(summarizeDistribution([40, 10, 30, 20]), {
    count: 4,
    min: 10,
    median: 20,
    p95: 40,
    max: 40,
    spread_percent: 150,
  });
  const benchmarks = parseGoBenchmarks(
    [
      'BenchmarkNormalize-12  1000  120.5 ns/op  32 B/op  2 allocs/op',
      'BenchmarkNormalize-12  900  140 ns/op  40 B/op  3 allocs/op',
    ].join('\n')
  );
  assert.equal(benchmarks.length, 1);
  assert.equal(benchmarks[0].ns_per_op.median, 120.5);
  assert.equal(benchmarks[0].bytes_per_op.max, 40);
  assert.equal(benchmarks[0].allocs_per_op.p95, 3);
});

test('qualifies a repeated V8 frame when CPU is distributed across one application file', () => {
  const repeatability = evaluateV8Repeatability([
    {
      hotspots: [
        applicationHotspot({ selfTimeMs: 150, samples: 120, sampleShare: 0.08 }),
        applicationHotspot({ functionName: 'helper', line: 40, sampleShare: 0.14 }),
      ],
    },
    {
      hotspots: [
        applicationHotspot({ selfTimeMs: 140, samples: 110, sampleShare: 0.075 }),
        applicationHotspot({ functionName: 'helper', line: 40, sampleShare: 0.135 }),
      ],
    },
  ]);

  assert.equal(repeatability.qualified, true);
  assert.equal(repeatability.materiality_mode, 'distributed_file_cpu');
  assert.deepEqual(repeatability.candidate_file_sample_shares, [0.22, 0.21]);
});

test('rejects a repeated V8 frame when neither frame nor file CPU share is material', () => {
  const repeatability = evaluateV8Repeatability([
    { hotspots: [applicationHotspot({ sampleShare: 0.018 })] },
    { hotspots: [applicationHotspot({ sampleShare: 0.019 })] },
  ]);

  assert.equal(repeatability.qualified, false);
});

test('qualifies a dependency-dominated profile when one file owns material application CPU', () => {
  const runs = [0.024, 0.026].map((fileShare) => ({
    hotspots: [
      applicationHotspot({ selfTimeMs: 15, samples: 12, sampleShare: 0.009 }),
      applicationHotspot({
        functionName: 'normalizeEntry',
        line: 125,
        sampleShare: fileShare - 0.009,
      }),
      {
        ...applicationHotspot({ functionName: 'otherWork', line: 10, sampleShare: 0.012 }),
        file: 'src/lib/other.ts',
      },
    ],
  }));

  const repeatability = evaluateV8Repeatability(runs);

  assert.equal(repeatability.qualified, true);
  assert.equal(repeatability.materiality_mode, 'application_relative_file_cpu');
  assert.deepEqual(repeatability.application_sample_shares, [0.036, 0.038]);
  assert.deepEqual(repeatability.candidate_application_file_shares, [0.6667, 0.6842]);
});

test('normalizes only repository-owned Go allocation profile rows', () => {
  const root = '/tmp/app-health/packages/go';
  const rows = parseGoPprofTop(
    [
      '  1950960B  0.63% 93.41%  1950960B  0.63%  example.test/app.newEventID /tmp/app-health/packages/go/uuid.go:35',
      '         0     0% 53.76% 34124368B 11.04%  example.test/app.(*responseWriter).Write /tmp/app-health/packages/go/middleware.go:137',
      '164855808B 53.32% 53.32% 164855808B 53.32%  bufio.NewReaderSize /usr/local/go/src/bufio/bufio.go:57',
    ].join('\n'),
    root,
    'go_alloc_space'
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    function: 'example.test/app.(*responseWriter).Write',
    file: 'middleware.go',
    line: 137,
    role: 'application',
    profile_kind: 'go_alloc_space',
    unit: 'bytes',
    flat: 0,
    cumulative: 34_124_368,
    flat_share: 0,
    cumulative_share: 0.1104,
    sample_share: 0,
  });

  const harnessRows = parseGoPprofTop(
    '1024B 1% 1% 2048B 2% example.test/app.BenchmarkMiddleware /tmp/app-health/packages/go/benchmark_test.go:45',
    root,
    'go_alloc_space'
  );
  assert.equal(harnessRows[0].role, 'test_or_harness');
});

test('normalizes Vitest durations and console benchmark metrics', () => {
  const root = '/tmp/performance-fixture';
  const timings = parseVitestTimings(
    [
      JSON.stringify({
        testResults: [
          {
            name: `${root}/test/benchmark.test.ts`,
            assertionResults: [
              { fullName: 'middleware benchmark stays bounded', status: 'passed', duration: 40 },
            ],
          },
        ],
      }),
      JSON.stringify({
        testResults: [
          {
            name: `${root}/test/benchmark.test.ts`,
            assertionResults: [
              { fullName: 'middleware benchmark stays bounded', status: 'passed', duration: 60 },
            ],
          },
        ],
      }),
    ],
    root
  );
  assert.equal(timings[0].file, 'test/benchmark.test.ts');
  assert.equal(timings[0].duration_ms.median, 40);
  const observations = parseConsoleBenchmarkMetrics(
    '[benchmark] bare=0.893ms/req instrumented=0.628ms/req overhead=-265.4us/req (300 iterations)'
  );
  assert.deepEqual(observations[0], {
    kind: 'console_benchmark_metrics',
    metrics: [
      { name: 'bare', value: 0.893, unit: 'ms/req' },
      { name: 'instrumented', value: 0.628, unit: 'ms/req' },
      { name: 'overhead', value: -265.4, unit: 'us/req' },
    ],
    iterations: 300,
    provenance: 'profile_execution_stdout',
  });
});

test('accepts an exact passed Vitest identity from a truncated JSON report', () => {
  const entry = {
    stdout: '…"fullName":"suite target work","status":"passed","title":"target work","duration":1',
    stderr: '',
  };
  assert.equal(selectedWorkloadExecuted(entry, 'vitest', 'target work'), true);
  assert.equal(selectedWorkloadExecuted(entry, 'vitest', 'other work'), false);
});

test('accepts repeated successful Vitest executions when one bounded output confirms selection', () => {
  const execution = { status: 'exited', exitCode: 0 };
  assert.equal(
    requiredExecutionsCompleted(
      [
        { phase: 'measurement', execution, stdout: '{truncated', stderr: '' },
        {
          phase: 'profile',
          execution,
          stdout: 'Test Files  1 passed (1)\nTests  1 passed | 33 skipped (34)',
          stderr: '',
        },
      ],
      'vitest',
      'target work'
    ),
    true
  );
});

test('classifies a Vitest scope dominated by runner startup', () => {
  const share = summarizeVitestExecutionShare(
    [{ duration_ms: { median: 1.25 } }, { duration_ms: { median: 0.75 } }],
    { median: 640 }
  );
  assert.deepEqual(share, {
    assertion_median_total_ms: 2,
    wall_median_ms: 640,
    assertion_share_percent: 0.313,
    classification: 'startup_dominated',
  });
});

test('summarizes repeated unprofiled console metrics by median', () => {
  const observations = summarizeConsoleBenchmarkMetrics([
    '[benchmark] size1000=0.5ms/op size35000=10ms/op (40 iterations)',
    '[benchmark] size1000=0.7ms/op size35000=30ms/op (40 iterations)',
    '[benchmark] size1000=0.6ms/op size35000=12ms/op (40 iterations)',
  ]);

  assert.deepEqual(observations[0], {
    kind: 'console_benchmark_metrics',
    metrics: [
      { name: 'size1000', value: 0.6, unit: 'ms/op', sample_count: 3 },
      { name: 'size35000', value: 12, unit: 'ms/op', sample_count: 3 },
    ],
    iterations: 40,
    provenance: 'unprofiled_metrics_execution_median',
  });
});

test('untracked files make the performance snapshot dirty without fabricated changed lines', async (context) => {
  const root = await gitFixture(context, { 'tracked.js': 'export const value = 1;\n' });
  await writeFile(join(root, 'untracked.txt'), 'owner artifact\n');
  const git = await inspectGitDiff(root);
  assert.equal(git.dirty, true);
  assert.equal(git.changed_lines.size, 0);
});

test('merges repository-owned V8 samples and labels harness work', async (context) => {
  const root = await temporaryRoot(context);
  const source = join(root, 'src', 'hot.js');
  const harness = join(root, 'test', 'hot.test.js');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'test'), { recursive: true });
  const parsed = parseV8CpuProfileDocuments(
    [
      {
        nodes: [
          {
            id: 1,
            callFrame: {
              functionName: 'hotLoop',
              url: pathToFileURL(source).href,
              lineNumber: 7,
            },
          },
          {
            id: 2,
            callFrame: {
              functionName: 'runTest',
              url: pathToFileURL(harness).href,
              lineNumber: 3,
            },
          },
          {
            id: 3,
            callFrame: {
              functionName: 'dependency',
              url: pathToFileURL(join(root, 'node_modules', 'dep.js')).href,
              lineNumber: 1,
            },
          },
        ],
        samples: [1, 1, 2, 3],
        timeDeltas: [1_000, 2_000, 1_000, 8_000],
      },
    ],
    root
  );
  assert.equal(parsed.hotspots.length, 2);
  assert.deepEqual(
    parsed.hotspots.map((hotspot) => [hotspot.function, hotspot.role]),
    [
      ['hotLoop', 'application'],
      ['runTest', 'test_or_harness'],
    ]
  );
  assert.equal(parsed.hotspots[0].self_time_ms, 3);
  assert.equal(parsed.hotspots[0].sample_share, 0.25);
});

test('compares only compatible baselines using absolute and relative thresholds', () => {
  const baseline = capsuleShape({ median: 100, count: 3 });
  const regressed = comparePerformanceCapsules(capsuleShape({ median: 150, count: 3 }), baseline, {
    regressionPercent: 20,
    regressionMs: 25,
  });
  assert.equal(regressed.status, 'regressed');
  assert.equal(regressed.delta_percent, 50);

  const stable = comparePerformanceCapsules(capsuleShape({ median: 120, count: 3 }), baseline, {
    regressionPercent: 20,
    regressionMs: 25,
  });
  assert.equal(stable.status, 'stable');

  const incompatible = comparePerformanceCapsules(
    { ...capsuleShape({ median: 150, count: 3 }), scope: { target: 'other.js', name: null } },
    baseline
  );
  assert.equal(incompatible.status, 'incompatible');
});

test('compares Go benchmark ns/op without treating process startup variance as workload variance', () => {
  const goCapsule = (median) => ({
    ...capsuleShape({ median: 700, count: 3, spread_percent: 80 }),
    adapter: { kind: 'go-bench' },
    scope: { target: 'hot_test.go', name: 'BenchmarkHot' },
    observed: {
      wall_time_ms: { median: 700, count: 3, spread_percent: 80 },
      go_benchmarks: [
        {
          name: 'BenchmarkHot-12',
          ns_per_op: { median, count: 3, spread_percent: 4 },
        },
      ],
    },
  });
  const comparison = comparePerformanceCapsules(goCapsule(3_000), goCapsule(10_000), {
    regressionPercent: 20,
  });

  assert.equal(comparison.status, 'improved');
  assert.equal(comparison.metric, 'median_ns_per_op');
  assert.equal(comparison.delta_percent, -70);
});

test('profiles an exact Node workload and captures an application hotspot', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'src/hot.js': [
      'export function hotLoop() {',
      '  const until = performance.now() + 200;',
      '  let value = 0;',
      '  while (performance.now() < until) value += Math.sqrt(value + 2);',
      '  return value;',
      '}',
      '',
    ].join('\n'),
    'test/hot.test.js': [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { hotLoop } from '../src/hot.js';",
      "test('profiles hot loop', () => { console.log('token=supersecret'); assert.ok(hotLoop() > 0); });",
      '',
    ].join('\n'),
  });
  const capsule = await profileRepository({
    repositoryRoot: root,
    adapter: 'node-test',
    target: 'test/hot.test.js',
    name: 'profiles hot loop',
    timeoutMs: 10_000,
    samples: 2,
    warmups: 0,
  });
  assert.equal(capsule.verdict.status, 'profiled', JSON.stringify(capsule));
  assert.equal(capsule.observed.wall_time_ms.count, 2);
  assert.ok(capsule.capture.profile_files > 0);
  assert.ok(
    capsule.observed.hotspots.some(
      (hotspot) => hotspot.file === 'src/hot.js' && hotspot.role === 'application'
    ),
    JSON.stringify(capsule.observed.hotspots)
  );
  assert.ok(capsule.findings.some((finding) => finding.kind === 'application_hotspot_candidate'));
  assert.equal(JSON.stringify(capsule).includes('supersecret'), false);
  assert.ok(capsule.capture.redaction_count > 0);
  assert.equal(capsule.capture.temporary_artifacts_retained, false);
});

test('profile CLI emits one JSON result and fails closed for an unsuccessful workload', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'failing.test.js': [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('profile failure', () => { console.error('token=supersecret'); assert.equal(1, 2); });",
      '',
    ].join('\n'),
  });
  const result = await commandCapture(process.execPath, [
    join(import.meta.dirname, 'cli.mjs'),
    'profile',
    '--repo',
    root,
    '--adapter',
    'node-test',
    '--target',
    'failing.test.js',
    '--name',
    'profile failure',
    '--samples',
    '2',
    '--warmups',
    '0',
    '--timeout-ms',
    '5000',
    '--json',
  ]);
  assert.equal(result.code, 2, result.stderr);
  assert.equal(result.stdout.trim().split('\n').length, 1);
  const capsule = JSON.parse(result.stdout);
  assert.equal(capsule.verdict.status, 'no_confidence');
  assert.ok(capsule.observed.executions.every((execution) => execution.failure_evidence));
  assert.ok(
    capsule.observed.executions.some(
      (execution) => execution.failure_evidence.stdout || execution.failure_evidence.stderr
    )
  );
  assert.equal(JSON.stringify(capsule).includes('supersecret'), false);
});

test('profiles a standalone Node benchmark script with no test-runner fiction', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'src/work.js': [
      'export function hotLoop() {',
      '  const until = performance.now() + 120;',
      '  let value = 0;',
      '  while (performance.now() < until) value += Math.sqrt(value + 2);',
      '  return value;',
      '}',
      '',
    ].join('\n'),
    'benchmark-work.mjs': [
      "import { hotLoop } from './src/work.js';",
      'const started = performance.now();',
      'hotLoop();',
      "console.log('[benchmark] elapsed=' + (performance.now() - started) + 'ms (1 iteration)');",
      '',
    ].join('\n'),
  });
  const capsule = await profileRepository({
    repositoryRoot: root,
    adapter: 'node-script',
    target: 'benchmark-work.mjs',
    timeoutMs: 10_000,
    samples: 2,
    warmups: 0,
  });

  assert.equal(capsule.verdict.status, 'profiled', JSON.stringify(capsule));
  assert.equal(capsule.adapter.kind, 'node-script');
  assert.ok(capsule.capture.profile_files > 0);
  assert.equal(capsule.observed.console_metrics[0].metrics[0].name, 'elapsed');
  assert.equal(capsule.observed.console_metrics[0].metrics[0].sample_count, 2);
});

test('diagnose-performance CLI emits one evidence-linked JSON report', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'src/work.js': [
      'export function runWork() {',
      '  const until = performance.now() + 200;',
      '  let value = 0;',
      '  while (performance.now() < until) value += Math.sqrt(value + 2);',
      '  return value;',
      '}',
      '',
    ].join('\n'),
    'work.test.js': [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { runWork } from './src/work.js';",
      "test('agent diagnosis workload', () => assert.ok(runWork() > 0));",
      '',
    ].join('\n'),
  });
  const result = await commandCapture(process.execPath, [
    join(import.meta.dirname, 'cli.mjs'),
    'diagnose-performance',
    '--',
    '--repo',
    root,
    '--adapter',
    'node-test',
    '--target',
    'work.test.js',
    '--name',
    'agent diagnosis workload',
    '--samples',
    '2',
    '--warmups',
    '0',
    '--timeout-ms',
    '5000',
    '--json',
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim().split('\n').length, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema_version, PERFORMANCE_DIAGNOSIS_SCHEMA_VERSION);
  assert.notEqual(report.verdict.status, 'no_confidence');
  assert.ok(report.observed.length > 0);
  assert.ok(report.observed.some((entry) => entry.kind === 'runtime_source_context'));
  assert.equal(report.verification.operation, 'diagnose-performance');
  assert.equal(report.performance_capsule.scope.name, 'agent diagnosis workload');
});

test('verify-optimization CLI confirms a same-scope wall-time improvement', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'src/work.js': [
      'export function runWork() {',
      '  const until = performance.now() + 120;',
      '  while (performance.now() < until) {}',
      '}',
      '',
    ].join('\n'),
    'work.test.js': [
      "import test from 'node:test';",
      "import { runWork } from './src/work.js';",
      "test('optimization workload', () => runWork());",
      '',
    ].join('\n'),
  });
  const baseline = await profileRepository({
    repositoryRoot: root,
    adapter: 'node-test',
    target: 'work.test.js',
    name: 'optimization workload',
    timeoutMs: 5_000,
    samples: 2,
    warmups: 0,
  });
  await writeFile(join(root, 'baseline.json'), JSON.stringify(baseline));
  await writeFile(
    join(root, 'src/work.js'),
    [
      'export function runWork() {',
      '  const until = performance.now() + 10;',
      '  while (performance.now() < until) {}',
      '}',
      '',
    ].join('\n')
  );
  const result = await commandCapture(process.execPath, [
    join(import.meta.dirname, 'cli.mjs'),
    'verify-optimization',
    '--repo',
    root,
    '--adapter',
    'node-test',
    '--target',
    'work.test.js',
    '--name',
    'optimization workload',
    '--baseline',
    'baseline.json',
    '--samples',
    '2',
    '--warmups',
    '0',
    '--timeout-ms',
    '5000',
    '--json',
  ]);

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema_version, 'runtime-optimization-verification/v1');
  assert.equal(report.verdict.status, 'confirmed');
  assert.equal(report.observed[0].kind, 'wall_time_comparison');
  assert.equal(report.current_capsule.comparison, null);
});

test('profile operation compares a compatible saved baseline', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'src/work.js': [
      'export function runWork(durationMs) {',
      '  const until = performance.now() + durationMs;',
      '  while (performance.now() < until) {}',
      '}',
      '',
    ].join('\n'),
    'work.test.js': [
      "import test from 'node:test';",
      "import { runWork } from './src/work.js';",
      "test('baseline workload', () => runWork(20));",
      '',
    ].join('\n'),
  });
  const baseline = await profileRepository({
    repositoryRoot: root,
    adapter: 'node-test',
    target: 'work.test.js',
    name: 'baseline workload',
    timeoutMs: 10_000,
    samples: 2,
    warmups: 0,
  });
  await writeFile(join(root, 'baseline.json'), JSON.stringify(baseline));
  await writeFile(
    join(root, 'work.test.js'),
    [
      "import test from 'node:test';",
      "import { runWork } from './src/work.js';",
      "test('baseline workload', () => runWork(250));",
      '',
    ].join('\n')
  );
  const current = await profileRepository({
    repositoryRoot: root,
    adapter: 'node-test',
    target: 'work.test.js',
    name: 'baseline workload',
    timeoutMs: 10_000,
    samples: 2,
    warmups: 0,
    baselinePath: 'baseline.json',
  });
  assert.equal(current.verdict.status, 'regressed', JSON.stringify(current.comparison));
  assert.equal(current.comparison.status, 'regressed');
  assert.ok(current.comparison.delta_ms >= 25);
});

test('profiles an exact Go benchmark and captures time and allocation measurements', {
  skip: process.env.CODEVETTER_SKIP_GO_PROFILE === '1',
}, async (context) => {
  const root = await gitFixture(context, {
    'go.mod': 'module example.test/performance\n\ngo 1.22\n',
    'hot.go': [
      'package performance',
      '',
      'var Sink []byte',
      'func hotLoop() []byte { return make([]byte, 128) }',
      '',
    ].join('\n'),
    'hot_test.go': [
      'package performance',
      '',
      'import "testing"',
      '',
      'func BenchmarkHotLoop(b *testing.B) {',
      '  b.ReportAllocs()',
      '  for i := 0; i < b.N; i++ {',
      '    Sink = hotLoop()',
      '  }',
      '}',
      '',
    ].join('\n'),
  });
  const capsule = await profileRepository({
    repositoryRoot: root,
    adapter: 'go-bench',
    target: 'hot_test.go',
    name: 'BenchmarkHotLoop',
    timeoutMs: 20_000,
    samples: 2,
    warmups: 0,
  });
  assert.equal(capsule.verdict.status, 'profiled', JSON.stringify(capsule));
  assert.equal(capsule.observed.go_benchmarks.length, 1);
  assert.ok(capsule.observed.go_benchmarks[0].ns_per_op.median > 0);
  assert.equal(capsule.capture.profile_files, 2);
  assert.ok(
    capsule.observed.hotspots.some(
      (hotspot) =>
        hotspot.profile_kind === 'go_alloc_space' &&
        hotspot.file === 'hot.go' &&
        hotspot.role === 'application'
    ),
    JSON.stringify(capsule.observed.hotspots)
  );
  assert.equal(capsule.capture.temporary_artifacts_retained, false);
});

test('Go benchmark selection anchors every slash-separated name component', {
  skip: process.env.CODEVETTER_SKIP_GO_PROFILE === '1',
}, async (context) => {
  const root = await gitFixture(context, {
    'go.mod': 'module example.test/selection\n\ngo 1.22\n',
    'selection_test.go': [
      'package selection',
      '',
      'import "testing"',
      '',
      'func BenchmarkWalk(b *testing.B) {',
      '  b.Run("n=1", func(b *testing.B) { for i := 0; i < b.N; i++ {} })',
      '}',
      'func BenchmarkWalkFast(b *testing.B) {',
      '  b.Run("n=1", func(b *testing.B) { for i := 0; i < b.N; i++ {} })',
      '}',
      '',
    ].join('\n'),
  });
  const execution = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'go-bench',
    target: 'selection_test.go',
    name: 'BenchmarkWalk/n=1',
    timeoutMs: 10_000,
    benchmarkCount: 1,
  });

  assert.equal(execution.status, 'exited');
  assert.equal(execution.exitCode, 0);
  assert.match(execution.stdout, /BenchmarkWalk\/n=1-/);
  assert.doesNotMatch(execution.stdout, /BenchmarkWalkFast/);
});

function capsuleShape(wallTime) {
  return {
    schema_version: PERFORMANCE_SCHEMA_VERSION,
    subject: { repository_revision: 'abc123' },
    adapter: { kind: 'node-test' },
    scope: { target: 'test.js', name: null },
    sample_policy: { samples: wallTime.count, warmups: 0 },
    observed: { wall_time_ms: wallTime, executions: [], hotspots: [] },
    findings: [],
    unverified: [],
    limitations: [],
    verdict: { status: 'profiled' },
  };
}

async function temporaryRoot(context) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-performance-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function gitFixture(context, files) {
  const root = await temporaryRoot(context);
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  await command('git', ['init', '-q'], root);
  await command('git', ['add', '.'], root);
  await command(
    'git',
    [
      '-c',
      'user.name=CodeVetter Test',
      '-c',
      'user.email=codevetter@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'fixture baseline',
    ],
    root
  );
  return root;
}

function command(program, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${program} failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

function commandCapture(program, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}
