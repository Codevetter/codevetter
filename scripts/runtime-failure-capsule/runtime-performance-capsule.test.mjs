import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  LIMITS,
  PERFORMANCE_DIAGNOSIS_SCHEMA_VERSION,
  PERFORMANCE_SCHEMA_VERSION,
} from './contracts.mjs';
import { SOURCE_SNAPSHOT_LIMITS, inspectGitDiff } from './git-diff.mjs';
import { diagnosePerformanceCapsule } from './performance-diagnosis.mjs';
import { selectProfileExperimentFinding } from './profile-tool-diagnosis.mjs';
import {
  comparePerformanceCapsules,
  createPerformanceCapsule,
  evaluateV8Repeatability,
  goProfileIterationCount,
  parseConsoleBenchmarkMetrics,
  summarizeConsoleBenchmarkMetrics,
  parseGoBenchmarks,
  parseGoPprofTop,
  parseVitestTimings,
  parseV8CpuProfileDocuments,
  profileRepository,
  repeatableGoAllocationCandidates,
  requiredExecutionsCompleted,
  selectV8HeapAllocationCandidate,
  selectV8HeapAllocationCandidates,
  selectGoProfileRows,
  selectedWorkloadExecuted,
  summarizeDistribution,
  summarizeVitestExecutionShare,
} from './performance.mjs';
import { compileGoBenchmarkBinary, runClosedAdapter } from './runner.mjs';
import {
  V8_HEAP_PROFILE_INTERVAL_BYTES,
  collectV8HeapProfileEvidence,
  combineV8HeapProfileRuns,
  evaluateV8HeapRepeatability,
  parseV8HeapProfileDocuments,
  repeatableV8HeapAllocationCandidates,
} from './v8-heap-profile.mjs';

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

test('normalizes only direct Go allocation leaves repeated across two profile runs', () => {
  const profileRun = ({ iterations, leafObjects, includeLeaf = true }) => ({
    profile_files: 2,
    failed_kinds: [],
    benchmark: Number.isFinite(iterations) ? { iterations: { median: iterations } } : null,
    fixed_benchmark_iterations: Number.isFinite(iterations) ? iterations : null,
    hotspots: [
      {
        function: 'example.middleware',
        file: 'middleware.go',
        line: 30,
        role: 'application',
        profile_kind: 'go_alloc_objects',
        flat: 0,
        cumulative: leafObjects * 8,
        flat_share: 0,
        cumulative_share: 0.8,
      },
      ...(includeLeaf
        ? [
            {
              function: 'example.newEventID',
              file: 'uuid.go',
              line: 35,
              role: 'application',
              profile_kind: 'go_alloc_objects',
              flat: leafObjects,
              cumulative: leafObjects,
              flat_share: 0.1,
              cumulative_share: 0.1,
            },
          ]
        : []),
    ],
  });
  const first = profileRun({ iterations: 100, leafObjects: 100 });
  const second = profileRun({ iterations: 200, leafObjects: 210 });

  const candidates = repeatableGoAllocationCandidates([first, second]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source.function, 'example.newEventID');
  assert.deepEqual(candidates[0].per_run_objects_per_op, [1, 1.05]);
  assert.equal(candidates[0].objects_per_op, 1);
  assert.equal(candidates[0].basis, 'repository_owned_go_alloc_objects_repeated_direct_path');
  assert.deepEqual(repeatableGoAllocationCandidates([first]), []);
  assert.deepEqual(
    repeatableGoAllocationCandidates([
      first,
      profileRun({ iterations: 200, leafObjects: 200, includeLeaf: false }),
    ]),
    []
  );
  assert.deepEqual(repeatableGoAllocationCandidates([first, profileRun({ leafObjects: 200 })]), []);
  const calibrated = profileRun({ iterations: 200, leafObjects: 200 });
  calibrated.fixed_benchmark_iterations = 199;
  assert.deepEqual(repeatableGoAllocationCandidates([first, calibrated]), []);
});

test('retains direct Go allocation leaves ahead of larger cumulative callers', () => {
  const row = (index, flat) => ({
    function: flat > 0 ? `example.leaf${index}` : `example.caller${index}`,
    file: flat > 0 ? `leaf-${index}.go` : `caller-${index}.go`,
    line: index + 1,
    role: 'application',
    profile_kind: 'go_alloc_objects',
    unit: 'count',
    flat,
    cumulative: flat > 0 ? flat : 10_000 - index,
    flat_share: flat > 0 ? 0.01 : 0,
    cumulative_share: flat > 0 ? 0.01 : 0.2,
    sample_share: flat > 0 ? 0.01 : 0,
  });
  const rows = [
    ...Array.from({ length: 16 }, (_, index) => row(index, 0)),
    row(16, 100),
    row(17, 90),
  ];

  const selected = selectGoProfileRows(rows, 'go_alloc_objects', 12);

  assert.equal(selected.length, 12);
  assert.deepEqual(
    selected.slice(0, 2).map((entry) => entry.function),
    ['example.leaf16', 'example.leaf17']
  );
});

test('derives a bounded fixed Go profile iteration count from unprofiled timing', () => {
  assert.equal(goProfileIterationCount({ ns_per_op: { median: 1_000_000 } }), 250);
  assert.equal(goProfileIterationCount({ ns_per_op: { median: 1 } }), 25_000);
  assert.equal(goProfileIterationCount({ ns_per_op: { median: 1_000_000_000 } }), 1);
  assert.equal(goProfileIterationCount({ ns_per_op: { median: null } }), null);
});

test('normalizes and repeats bounded repository-owned V8 sampled allocations', async (context) => {
  assert.equal(V8_HEAP_PROFILE_INTERVAL_BYTES, 8 * 1024);
  const root = await temporaryRoot(context);
  const document = (bytes, url) => ({
    head: {
      callFrame: { functionName: '(root)', url: '', lineNumber: -1 },
      selfSize: 0,
      children: [
        {
          callFrame: {
            functionName: 'allocateRows',
            url,
            lineNumber: 4,
          },
          selfSize: bytes,
          children: [],
        },
      ],
    },
    samples: [{ size: bytes, nodeId: 2, ordinal: 1 }],
  });
  const run = (bytes, url) => ({
    kind: 'v8_heap_allocation',
    profile_files: 1,
    profile_bytes: 1_000,
    ...parseV8HeapProfileDocuments([document(bytes, url)], root),
  });
  const source = join(root, 'src/allocate.js');
  const runs = [run(256 * 1024, pathToFileURL(source).href), run(288 * 1024, source)];

  const repeatability = evaluateV8HeapRepeatability(runs);
  assert.equal(repeatability.qualified, true);
  assert.equal(repeatability.candidate.file, 'src/allocate.js');
  assert.deepEqual(repeatability.candidate.per_run_sampled_bytes, [256 * 1024, 288 * 1024]);
  const combined = combineV8HeapProfileRuns(runs);
  assert.equal(combined.sampled_bytes, 544 * 1024);
  assert.equal(combined.repeatability.qualified, true);
});

test('keeps heap-profiler observer allocation visible but ineligible', async (context) => {
  const root = await temporaryRoot(context);
  const applicationUrl = pathToFileURL(join(root, 'src/operation.js')).href;
  const observerUrl = pathToFileURL(
    join(root, 'scripts/runtime-failure-capsule/node-heap-profile-preload.mjs')
  ).href;
  const document = {
    head: {
      callFrame: { functionName: '(root)', url: '', lineNumber: -1 },
      selfSize: 0,
      children: [
        {
          callFrame: { functionName: 'measuredOperation', url: applicationUrl, lineNumber: 4 },
          selfSize: 128 * 1024,
          children: [],
        },
        {
          callFrame: { functionName: 'writeProfile', url: observerUrl, lineNumber: 72 },
          selfSize: 256 * 1024,
          children: [],
        },
      ],
    },
    samples: [
      { size: 128 * 1024, nodeId: 2, ordinal: 1 },
      { size: 256 * 1024, nodeId: 3, ordinal: 2 },
    ],
  };
  const run = {
    kind: 'v8_heap_allocation',
    profile_files: 1,
    profile_bytes: 1_000,
    ...parseV8HeapProfileDocuments([document], root),
  };

  assert.equal(run.sampled_bytes, 384 * 1024);
  assert.equal(run.application_sampled_bytes, 128 * 1024);
  assert.deepEqual(
    run.hotspots.map(({ function: functionName, role }) => [functionName, role]),
    [
      ['writeProfile', 'test_or_harness'],
      ['measuredOperation', 'application'],
    ]
  );
  const repeatable = repeatableV8HeapAllocationCandidates([run, run]);
  assert.deepEqual(
    repeatable.map((candidate) => candidate.function),
    ['measuredOperation']
  );
});

test('bounds fully parsed heap hotspots without calling evidence truncated', async (context) => {
  const root = await temporaryRoot(context);
  const children = Array.from({ length: 30 }, (_, index) => ({
    callFrame: {
      functionName: `operation${String(index).padStart(2, '0')}`,
      url: pathToFileURL(join(root, `src/operation-${index}.js`)).href,
      lineNumber: index,
    },
    selfSize: (30 - index) * 64 * 1024,
    children: [],
  }));
  const parsed = parseV8HeapProfileDocuments(
    [
      {
        head: {
          callFrame: { functionName: '(root)', url: '', lineNumber: -1 },
          selfSize: 0,
          children,
        },
        samples: children.map((child, index) => ({
          size: child.selfSize,
          nodeId: index + 2,
          ordinal: index + 1,
        })),
      },
    ],
    root
  );

  assert.equal(parsed.hotspots.length, 16);
  assert.equal(parsed.hotspots[0].function, 'operation00');
  assert.equal(parsed.truncated, false);
  assert.equal(
    parsed.application_sampled_bytes,
    children.reduce((total, child) => total + child.selfSize, 0)
  );
});

test('bounds the combined heap union without calling complete runs truncated', () => {
  const run = (suffix, truncated = false) => {
    const hotspots = [
      {
        function: 'leadingOperation',
        file: 'src/leading.js',
        line: 10,
        role: 'application',
        sampled_bytes: 512 * 1024,
        sample_share: 0.25,
      },
      ...Array.from({ length: 15 }, (_, index) => ({
        function: `operation${suffix}${index}`,
        file: `src/operation-${suffix}-${index}.js`,
        line: index + 1,
        role: 'application',
        sampled_bytes: (15 - index) * 8 * 1024,
        sample_share: 0.01,
      })),
    ];
    return {
      kind: 'v8_heap_allocation',
      profile_files: 1,
      profile_bytes: 1_000,
      profile_samples: 100,
      sampled_bytes: 2 * 1024 * 1024,
      application_sampled_bytes: hotspots.reduce(
        (total, hotspot) => total + hotspot.sampled_bytes,
        0
      ),
      hotspots,
      truncated,
    };
  };

  const complete = combineV8HeapProfileRuns([run('a'), run('b')]);
  assert.equal(complete.hotspots.length, LIMITS.hotspots);
  assert.equal(complete.truncated, false);
  assert.equal(complete.repeatability.qualified, true);

  const incomplete = combineV8HeapProfileRuns([run('a'), run('b', true)]);
  assert.equal(incomplete.truncated, true);
});

test('marks malformed heap evidence truncated', async (context) => {
  const root = await temporaryRoot(context);
  const parsed = parseV8HeapProfileDocuments([{ head: null, samples: [] }], root);
  assert.equal(parsed.truncated, true);
  assert.deepEqual(parsed.hotspots, []);
});

test('node-test adapter runs a nested TypeScript target with its local TSX loader', async () => {
  const repositoryRoot = await realpath(join(import.meta.dirname, '../..'));
  const execution = await runClosedAdapter({
    repositoryRoot,
    adapter: 'node-test',
    target: 'apps/desktop/src/lib/history-workbench.test.ts',
    name: 'announces stale partial evidence, ambiguity, annotations, and bounds',
    timeoutMs: 10_000,
  });

  assert.equal(execution.status, 'exited', JSON.stringify(execution));
  assert.equal(execution.exitCode, 0, execution.stderr);
  assert.equal(execution.scope.target, 'apps/desktop/src/lib/history-workbench.test.ts');
  assert.equal(execution.command.executable_identity, 'local:node-test+tsx');
  assert.equal(execution.command.working_directory, 'apps/desktop');
  assert.deepEqual(execution.command.arguments.slice(0, 3), [
    '--import=<local:tsx>',
    '--test',
    '--test-reporter=tap',
  ]);
  assert.equal(execution.command.arguments.at(-1), 'src/lib/history-workbench.test.ts');
});

test('prefers a material heap source intersecting the repeated CPU candidate', () => {
  const run = (setupBytes, parserBytes) => {
    const sampledBytes = setupBytes + parserBytes + 64 * 1024;
    return {
      kind: 'v8_heap_allocation',
      profile_files: 1,
      profile_bytes: 1_000,
      profile_samples: 20,
      sampled_bytes: sampledBytes,
      application_sampled_bytes: setupBytes + parserBytes,
      hotspots: [
        {
          function: 'buildFixture',
          file: 'fixture.mjs',
          line: 10,
          role: 'application',
          sampled_bytes: setupBytes,
          sample_share: setupBytes / sampledBytes,
        },
        {
          function: 'parseRows',
          file: 'parser.mjs',
          line: 20,
          role: 'application',
          sampled_bytes: parserBytes,
          sample_share: parserBytes / sampledBytes,
        },
      ],
      truncated: false,
      redaction_count: 0,
    };
  };
  const runs = [run(300 * 1024, 150 * 1024), run(320 * 1024, 160 * 1024)];
  const combined = combineV8HeapProfileRuns(runs);
  assert.equal(combined.repeatability.candidate.function, 'buildFixture');

  const selected = selectV8HeapAllocationCandidate(combined, runs, {
    file: 'parser.mjs',
    function: 'parseRows',
  });
  assert.equal(selected.candidate.function, 'parseRows');
  assert.deepEqual(selected.candidate.per_run_sampled_bytes, [150 * 1024, 160 * 1024]);
  assert.equal(
    selected.basis,
    'repository_owned_v8_sampled_allocation_bytes_intersecting_cpu_candidate'
  );

  const heapOnly = selectV8HeapAllocationCandidate(combined, runs, null);
  assert.equal(heapOnly.candidate.function, 'buildFixture');
  assert.equal(heapOnly.basis, 'repository_owned_v8_sampled_allocation_bytes');
});

test('does not prefer a CPU-aligned heap source below materiality', () => {
  const run = (parserBytes) => ({
    kind: 'v8_heap_allocation',
    profile_files: 1,
    profile_bytes: 1_000,
    profile_samples: 20,
    sampled_bytes: 512 * 1024,
    application_sampled_bytes: 400 * 1024,
    hotspots: [
      {
        function: 'buildFixture',
        file: 'fixture.mjs',
        line: 10,
        role: 'application',
        sampled_bytes: 390 * 1024,
        sample_share: 390 / 512,
      },
      {
        function: 'parseRows',
        file: 'parser.mjs',
        line: 20,
        role: 'application',
        sampled_bytes: parserBytes,
        sample_share: parserBytes / (512 * 1024),
      },
    ],
    truncated: false,
    redaction_count: 0,
  });
  const runs = [run(10 * 1024), run(12 * 1024)];
  const combined = combineV8HeapProfileRuns(runs);
  const selected = selectV8HeapAllocationCandidate(combined, runs, {
    file: 'parser.mjs',
    function: 'parseRows',
  });
  assert.equal(selected.candidate.function, 'buildFixture');
  assert.equal(selected.basis, 'repository_owned_v8_sampled_allocation_bytes');
});

test('retains eight repeated material Node allocation candidates and advances by source', () => {
  const source = (functionName, sampledBytes, file = 'src/coverage.js') => ({
    function: functionName,
    file,
    line: functionName.length,
    role: 'application',
    sampled_bytes: sampledBytes,
    sample_share: sampledBytes / (2 * 1024 * 1024),
  });
  const run = (suffixBytes) => ({
    kind: 'v8_heap_allocation',
    profile_files: 1,
    profile_bytes: 1_000,
    profile_samples: 40,
    sampled_bytes: 2 * 1024 * 1024,
    application_sampled_bytes: 1500 * 1024,
    hotspots: [
      source('buildFixture', 320 * 1024, 'test/fixture.js'),
      source('parseDocument', 280 * 1024),
      source('aggregateRows', 180 * 1024),
      source('redactName', 120 * 1024),
      source('boundedOutput', 80 * 1024),
      source('candidateFive', 76 * 1024),
      source('candidateSix', 72 * 1024),
      source('candidateSeven', 68 * 1024),
      source('candidateEight', 66 * 1024),
      source('candidateNine', 65 * 1024),
      source('oneRunOnly', suffixBytes),
    ],
    truncated: false,
    redaction_count: 0,
  });
  const runs = [run(70 * 1024), run(20 * 1024)];
  const repeated = repeatableV8HeapAllocationCandidates(runs, { file: 'src/coverage.js' });
  assert.deepEqual(
    repeated.map((candidate) => candidate.function),
    [
      'parseDocument',
      'aggregateRows',
      'redactName',
      'boundedOutput',
      'candidateFive',
      'candidateSix',
      'candidateSeven',
      'candidateEight',
    ]
  );
  assert.deepEqual(repeated[1].per_run_sampled_bytes, [180 * 1024, 180 * 1024]);

  const combined = combineV8HeapProfileRuns(runs);
  const selected = selectV8HeapAllocationCandidates(combined, runs, {
    file: 'src/coverage.js',
    function: 'aggregateRows',
  });
  assert.equal(selected.length, 8);
  assert.equal(selected[0].candidate.function, 'aggregateRows');
  assert.equal(selected[1].candidate.function, 'parseDocument');
  assert.ok(selected.some((selection) => selection.candidate.function === 'boundedOutput'));
  assert.equal(
    selected.some((selection) => selection.candidate.function === 'candidateNine'),
    false
  );
  assert.equal(
    selected.some((selection) => selection.candidate.function === 'buildFixture'),
    false
  );
  assert.equal(
    selected[0].basis,
    'repository_owned_v8_sampled_allocation_bytes_intersecting_cpu_candidate'
  );

  const report = {
    diagnosis: { kind: 'node_allocation_source' },
    tool_diagnosis: {
      findings: selected.slice(0, 4).map((selection, index) => ({
        id: index.toString(16).padStart(24, '0'),
        candidate_key: (index + 16).toString(16).padStart(24, '0'),
        kind: 'application_allocation_hotspot',
        eligible_for_experiment: true,
        observed: { allocation_profile_share: selection.candidate.sample_share },
        inference: {
          mechanism:
            index === 0
              ? 'repeatable_v8_sampling_heap_path_intersecting_cpu_candidate'
              : 'repeatable_v8_sampling_heap_path',
        },
      })),
    },
  };
  const exclusions = [];
  const progression = [];
  for (let index = 0; index < 4; index += 1) {
    const finding = selectProfileExperimentFinding(report, {
      excludedCandidateKeys: exclusions,
    });
    progression.push(finding.id);
    exclusions.push(finding.candidate_key);
  }
  assert.deepEqual(progression, [
    '000000000000000000000000',
    '000000000000000000000001',
    '000000000000000000000002',
    '000000000000000000000003',
  ]);
});

test('retains repeated Vitest domain metrics when paired runs omit a profile pass', () => {
  const execution = (value) => ({
    status: 'exited',
    exitCode: 0,
    signal: null,
    durationMs: 250,
    stdout: `[benchmark] size35000=${value}ms/op\nTest Files 1 passed\nTests 1 passed`,
    stderr: '',
    operationalError: '',
    environmentValues: [],
    stdoutBytes: 80,
    stderrBytes: 0,
    truncated: false,
  });
  const capsule = createPerformanceCapsule({
    root: '/tmp/codevetter-vitest-paired-fixture',
    lexicalRoot: '/tmp/codevetter-vitest-paired-fixture',
    git: {
      repository_revision: 'abc123',
      diff_identity: 'HEAD..worktree',
      dirty: false,
      changed_lines: new Map(),
    },
    adapter: 'vitest',
    target: 'src/work.performance.test.ts',
    name: 'paired benchmark',
    samples: 3,
    warmups: 0,
    executions: [10, 12, 11].map((value, index) => ({
      phase: 'measurement',
      index,
      execution: execution(value),
    })),
    profileEvidence: {
      kind: 'paired_timing_only',
      profile_files: 0,
      profile_bytes: 0,
      profile_samples: 0,
      hotspots: [],
      truncated: false,
      redaction_count: 0,
      failed_kinds: [],
    },
  });

  assert.deepEqual(capsule.observed.console_metrics, [
    {
      kind: 'console_benchmark_metrics',
      metrics: [{ name: 'size35000', value: 11, unit: 'ms/op', sample_count: 3 }],
      iterations: null,
      provenance: 'unprofiled_measurement_execution_median',
    },
  ]);
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

  const objectRows = parseGoPprofTop(
    [
      ' 25035 2.68% 88.97% 25035 2.68% example.test/app.newEventID /tmp/app-health/packages/go/uuid.go:35',
      '     0    0% 79.66% 50104 5.36% example.test/app.(*Client).Record /tmp/app-health/packages/go/client.go:182',
    ].join('\n'),
    root,
    'go_alloc_objects'
  );
  assert.deepEqual(objectRows[0], {
    function: 'example.test/app.(*Client).Record',
    file: 'client.go',
    line: 182,
    role: 'application',
    profile_kind: 'go_alloc_objects',
    unit: 'count',
    flat: 0,
    cumulative: 50_104,
    flat_share: 0,
    cumulative_share: 0.0536,
    sample_share: 0,
  });
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

test('retains embedded Vitest JSON timings beside console benchmark metrics', () => {
  const root = '/tmp/performance-fixture';
  const report = JSON.stringify({
    numTotalTests: 1,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTests: 0,
    testResults: [
      {
        name: `${root}/test/scale.performance.test.ts`,
        assertionResults: [{ fullName: 'scale benchmark', status: 'passed', duration: 42 }],
      },
    ],
  });
  const output = [
    'stdout | test/scale.performance.test.ts > scale benchmark',
    '[benchmark] size10=2.5ms/op size50=8.75ms/op (4 iterations)',
    report,
    'Test Files  1 passed (1)',
  ].join('\n');

  assert.equal(
    selectedWorkloadExecuted({ stdout: output, stderr: '' }, 'vitest', 'scale benchmark'),
    true
  );
  const timings = parseVitestTimings([output], root);
  assert.equal(timings[0].duration_ms.median, 42);
  assert.deepEqual(parseConsoleBenchmarkMetrics(output)[0], {
    kind: 'console_benchmark_metrics',
    metrics: [
      { name: 'size10', value: 2.5, unit: 'ms/op' },
      { name: 'size50', value: 8.75, unit: 'ms/op' },
    ],
    iterations: 4,
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
  assert.deepEqual(git.changed_files, ['untracked.txt']);
  assert.equal(git.changed_lines.size, 0);
  assert.match(git.source_snapshot_sha256, /^[0-9a-f]{64}$/);

  const repeated = await inspectGitDiff(root);
  assert.equal(repeated.source_snapshot_sha256, git.source_snapshot_sha256);
  await writeFile(join(root, 'untracked.txt'), 'changed owner artifact\n');
  const changed = await inspectGitDiff(root);
  assert.notEqual(changed.source_snapshot_sha256, git.source_snapshot_sha256);
});

test('source snapshots reject sensitive changed paths before profiling', async (context) => {
  const root = await gitFixture(context, { 'tracked.js': 'export const value = 1;\n' });
  await writeFile(join(root, '.env.local'), 'TOKEN=fixture-value\n');

  await assert.rejects(
    () => inspectGitDiff(root),
    /source snapshot contains a sensitive path and was not read/
  );
});

test('source snapshots distinguish executable-mode and deleted tracked state', async (context) => {
  const root = await gitFixture(context, { 'tracked.js': 'export const value = 1;\n' });
  const clean = await inspectGitDiff(root);

  await chmod(join(root, 'tracked.js'), 0o755);
  const executable = await inspectGitDiff(root);
  assert.equal(executable.dirty, true);
  assert.deepEqual(executable.changed_files, ['tracked.js']);
  assert.notEqual(executable.source_snapshot_sha256, clean.source_snapshot_sha256);

  await rm(join(root, 'tracked.js'));
  const deleted = await inspectGitDiff(root);
  assert.equal(deleted.dirty, true);
  assert.deepEqual(deleted.changed_files, ['tracked.js']);
  assert.notEqual(deleted.source_snapshot_sha256, executable.source_snapshot_sha256);
});

test('source snapshots hash contained symlinks and reject escaping symlinks', async (context) => {
  const root = await gitFixture(context, { 'tracked.js': 'export const value = 1;\n' });
  await symlink('tracked.js', join(root, 'contained-link.js'));
  const contained = await inspectGitDiff(root);
  assert.deepEqual(contained.changed_files, ['contained-link.js']);
  assert.match(contained.source_snapshot_sha256, /^[0-9a-f]{64}$/);

  await symlink('../outside.js', join(root, 'escaping-link.js'));
  await assert.rejects(() => inspectGitDiff(root), /source snapshot contains an escaping symlink/);
});

test('source snapshots reject oversized changed files before content hashing', async (context) => {
  const root = await gitFixture(context, { 'tracked.js': 'export const value = 1;\n' });
  await writeFile(join(root, 'oversized.bin'), '');
  await truncate(join(root, 'oversized.bin'), SOURCE_SNAPSHOT_LIMITS.fileBytes + 1);

  await assert.rejects(
    () => inspectGitDiff(root),
    /source snapshot contains an oversized changed file/
  );
});

test('nested repository scopes use local paths and exclude owned ledgers', async (context) => {
  const root = await gitFixture(context, {
    'packages/go/normalize.go': 'package example\n',
  });
  const nested = join(root, 'packages', 'go');
  await writeFile(join(nested, 'normalize.go'), 'package example\n// candidate\n');
  await mkdir(join(nested, '.codevetter', 'performance-experiments', 'abc'), {
    recursive: true,
  });
  await writeFile(
    join(nested, '.codevetter', 'performance-experiments', 'abc', 'candidate.json'),
    '{}\n'
  );

  const git = await inspectGitDiff(nested);

  assert.equal(git.dirty, true);
  assert.deepEqual(git.changed_files, ['normalize.go']);
  assert.deepEqual([...git.changed_lines.keys()], ['normalize.go']);
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
      '  const held = Array.from({ length: 50000 }, (_, index) => ({',
      '    value: String(index).repeat(20),',
      '    index,',
      '  }));',
      '  const until = performance.now() + 200;',
      '  let value = 0;',
      '  while (performance.now() < until) value += Math.sqrt(value + 2);',
      '  return value + held.length;',
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
  assert.deepEqual(
    capsule.observed.executions.map((execution) => execution.phase),
    [
      'measurement',
      'measurement',
      'memory',
      'memory',
      'memory',
      'profile',
      'profile',
      'heap_profile',
      'heap_profile',
    ]
  );
  assert.ok(capsule.capture.profile_files > 0);
  assert.ok(
    capsule.observed.hotspots.some(
      (hotspot) => hotspot.file === 'src/hot.js' && hotspot.role === 'application'
    ),
    JSON.stringify(capsule.observed.hotspots)
  );
  assert.ok(capsule.findings.some((finding) => finding.kind === 'application_hotspot_candidate'));
  assert.ok(capsule.capture.heap_profile_files > 0);
  assert.equal(
    capsule.observed.heap_profile_repeatability.qualified,
    true,
    JSON.stringify(capsule)
  );
  assert.ok(
    capsule.observed.heap_profile_runs.every((run) =>
      run.application_hotspots.some((hotspot) => hotspot.file === 'src/hot.js')
    )
  );
  const allocationFinding = capsule.findings.find(
    (finding) => finding.kind === 'node_allocation_candidate'
  );
  assert.ok(allocationFinding.sampled_bytes >= 128 * 1024);
  assert.equal(allocationFinding.per_run_sampled_bytes.length, 2);
  const diagnosis = diagnosePerformanceCapsule(capsule);
  assert.equal(diagnosis.diagnosis.kind, 'node_allocation_source');
  const toolAllocation = diagnosis.tool_diagnosis.findings.find(
    (finding) => finding.detector === 'repository_heap_allocation_hotspot'
  );
  assert.equal(toolAllocation.eligible_for_experiment, true);
  assert.deepEqual(toolAllocation.limitations, []);
  assert.equal(selectProfileExperimentFinding(diagnosis)?.id, toolAllocation.id);
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

  assert.equal(result.stdout.trim().split('\n').length, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(result.code, 0, JSON.stringify({ stderr: result.stderr, report }));
  assert.equal(report.schema_version, PERFORMANCE_DIAGNOSIS_SCHEMA_VERSION);
  assert.notEqual(report.verdict.status, 'no_confidence');
  assert.ok(report.observed.length > 0);
  assert.ok(report.observed.some((entry) => entry.kind === 'runtime_source_context'));
  assert.equal(report.verification.operation, 'diagnose-performance');
  assert.equal(report.tool_diagnosis.verdict.status, 'findings');
  assert.equal(report.tool_diagnosis.findings[0].origin, 'tool_detected');
  assert.ok(report.tool_diagnosis.findings.some((finding) => finding.eligible_for_experiment));
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
      "test('baseline workload', () => runWork(500));",
      '',
    ].join('\n'),
  });
  const baseline = await profileRepository({
    repositoryRoot: root,
    adapter: 'node-test',
    target: 'work.test.js',
    name: 'baseline workload',
    timeoutMs: 10_000,
    samples: 3,
    warmups: 1,
  });
  await writeFile(join(root, 'baseline.json'), JSON.stringify(baseline));
  await writeFile(
    join(root, 'work.test.js'),
    [
      "import test from 'node:test';",
      "import { runWork } from './src/work.js';",
      "test('baseline workload', () => runWork(1500));",
      '',
    ].join('\n')
  );
  const current = await profileRepository({
    repositoryRoot: root,
    adapter: 'node-test',
    target: 'work.test.js',
    name: 'baseline workload',
    timeoutMs: 10_000,
    samples: 3,
    warmups: 1,
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
  const binaryDirectory = await mkdtemp(join(tmpdir(), 'codevetter-go-memory-test-'));
  context.after(() => rm(binaryDirectory, { recursive: true, force: true }));
  const preparation = await compileGoBenchmarkBinary({
    repositoryRoot: root,
    target: 'hot_test.go',
    timeoutMs: 20_000,
    outputDirectory: binaryDirectory,
  });
  assert.ok(preparation.prepared_binary, preparation.stderr);
  const memoryExecution = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'go-bench',
    target: 'hot_test.go',
    name: 'BenchmarkHotLoop',
    timeoutMs: 20_000,
    measureMemory: true,
    goBenchmarkBinary: preparation.prepared_binary,
  });
  assert.equal(memoryExecution.status, 'exited', memoryExecution.stderr);
  assert.equal(memoryExecution.exitCode, 0, memoryExecution.stderr);
  assert.equal(memoryExecution.command.executable_identity, 'owned:go-test-binary');
  assert.ok(memoryExecution.memory?.peak_rss_bytes > 0);
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
  assert.match(capsule.subject.go_version, /^go\d+\.\d+/);
  assert.equal(capsule.observed.go_benchmarks.length, 1);
  assert.ok(capsule.observed.go_benchmarks[0].ns_per_op.median > 0);
  assert.equal(capsule.observed.peak_rss_bytes.count, 3);
  assert.ok(capsule.observed.peak_rss_bytes.median > 0);
  assert.ok(
    capsule.limitations.includes(
      'Peak RSS is sampled from an owned Go benchmark binary with compilation excluded; it is a regression guard and does not identify an allocation source.'
    )
  );
  assert.equal(capsule.capture.profile_files, 4);
  assert.equal(capsule.observed.profile_runs.length, 2);
  assert.ok(capsule.observed.profile_runs.every((run) => run.benchmark?.iterations?.median > 0));
  assert.ok(
    capsule.observed.profile_runs.every(
      (run) => run.benchmark.iterations.median === run.fixed_benchmark_iterations
    )
  );
  assert.ok(
    capsule.observed.hotspots.some(
      (hotspot) =>
        hotspot.profile_kind === 'go_alloc_space' &&
        hotspot.file === 'hot.go' &&
        hotspot.role === 'application'
    ),
    JSON.stringify(capsule.observed.hotspots)
  );
  assert.ok(
    capsule.observed.hotspots.some(
      (hotspot) =>
        hotspot.profile_kind === 'go_alloc_objects' &&
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

test('Node memory pass records bounded process-tree peak RSS evidence', async (context) => {
  const root = await gitFixture(context, {
    'memory.js':
      'const held = Buffer.alloc(24 * 1024 * 1024); setTimeout(() => console.log(held.length), 150);\n',
  });
  const execution = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'node-script',
    target: 'memory.js',
    timeoutMs: 2_000,
    measureMemory: true,
  });

  assert.equal(execution.exitCode, 0);
  assert.ok(execution.memory?.peak_rss_bytes > 0, JSON.stringify(execution.memory));
  assert.ok(execution.memory.samples > 0);
});

test('Jest runInBand forwards bounded heap profiling into the test process', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'src/allocate.js': [
      'export function allocateRows() {',
      '  return Array.from({ length: 50000 }, (_, index) => ({ value: String(index) }));',
      '}',
      '',
    ].join('\n'),
    'test/allocate.test.js': '// Selected by the closed Jest adapter.\n',
    'node_modules/jest/bin/jest.js': [
      "import { allocateRows } from '../../../src/allocate.js';",
      'const held = allocateRows();',
      'await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));',
      'console.log(held.length);',
      '',
    ].join('\n'),
  });
  const profileDirectory = join(root, '.heap-profiles');
  await mkdir(profileDirectory);

  const execution = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'jest',
    target: 'test/allocate.test.js',
    timeoutMs: 2_000,
    heapProfileDirectory: profileDirectory,
  });
  const evidence = await collectV8HeapProfileEvidence(profileDirectory, await realpath(root));

  assert.equal(execution.exitCode, 0, JSON.stringify(execution));
  assert.equal(evidence.profile_files, 1);
  assert.ok(
    evidence.hotspots.some(
      (hotspot) => hotspot.file === 'src/allocate.js' && hotspot.role === 'application'
    ),
    JSON.stringify(evidence)
  );
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
