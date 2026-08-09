import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePerformanceDiagnosis } from './contracts.mjs';
import { diagnosePerformanceCapsule, extractScaleCurve } from './performance-diagnosis.mjs';

test('diagnoses Go allocation pressure with evidence-linked verification', () => {
  const report = diagnosePerformanceCapsule(
    performanceCapsule({
      adapter: 'go-bench',
      goBenchmarks: [
        {
          name: 'BenchmarkMiddleware-18',
          ns_per_op: distribution(2423),
          bytes_per_op: distribution(7358),
          allocs_per_op: distribution(30),
          provenance: 'go_test_benchmark_output',
        },
      ],
      hotspots: [
        {
          function: 'example.(*Client).Middleware',
          file: 'middleware.go',
          line: 55,
          role: 'application',
          profile_kind: 'go_alloc_space',
          flat: 0,
          cumulative: 6_051_072,
          flat_share: 0,
          cumulative_share: 0.1059,
          sample_share: 0,
        },
      ],
      findings: [
        {
          kind: 'go_allocation_path_candidate',
          basis: 'repository_owned_go_alloc_space_cumulative_path',
          source: { file: 'middleware.go', line: 55, function: 'example.(*Client).Middleware' },
          flat_profile_bytes: 0,
          cumulative_profile_bytes: 6_051_072,
          flat_share: 0,
          cumulative_share: 0.1059,
        },
      ],
    })
  );

  assert.equal(report.diagnosis.kind, 'allocation_pressure');
  assert.equal(report.verdict.status, 'actionable');
  assert.equal(report.inferred[0].kind, 'allocation_path_candidate');
  assert.deepEqual(report.inferred[0].evidence_ids, report.diagnosis.evidence_ids);
  assert.match(report.unverified[0].falsification, /B\/op and allocs\/op/);
  assert.deepEqual(report.verification.success_criteria, [
    'B/op decreases',
    'allocs/op does not regress',
    'workload passes',
  ]);
  assert.equal(report.verification.baseline_json_pointer, '/performance_capsule');
  assert.deepEqual(validatePerformanceDiagnosis(report), []);
});

test('promotes a repository-owned Go cumulative CPU path after allocation pressure clears', () => {
  const report = diagnosePerformanceCapsule(
    performanceCapsule({
      adapter: 'go-bench',
      hotspots: [
        {
          function: 'example.aggregateReader',
          file: 'parser.go',
          line: 23,
          role: 'application',
          profile_kind: 'go_cpu',
          unit: 'ms',
          flat: 0,
          cumulative: 80,
          flat_share: 0,
          cumulative_share: 0.0899,
          sample_share: 0.0899,
        },
      ],
      findings: [
        {
          kind: 'application_hotspot_candidate',
          basis: 'repository_owned_go_cpu_cumulative_path',
          profile_kind: 'go_cpu',
          source: { file: 'parser.go', line: 23, function: 'example.aggregateReader' },
          self_time_ms: 80,
          sample_share: 0.0899,
        },
      ],
    })
  );

  assert.equal(report.diagnosis.kind, 'application_cpu_hotspot');
  assert.equal(report.verdict.status, 'actionable');
  assert.equal(
    report.observed.find((entry) => entry.kind === 'repository_cpu_hotspot').source.line,
    23
  );
  assert.equal(report.inferred[0].kind, 'cpu_path_candidate');
  assert.deepEqual(validatePerformanceDiagnosis(report), []);
});

test('diagnoses deterministic superlinear input scaling without claiming causation', () => {
  const report = diagnosePerformanceCapsule(
    performanceCapsule({
      consoleMetrics: scaleMetrics(),
      hotspots: [
        {
          function: 'scoreAnime',
          file: 'src/recommendations.ts',
          line: 38,
          role: 'application',
          self_time_ms: 67.581,
          samples: 60,
          sample_share: 0.0513,
        },
      ],
    }),
    {
      sourceContexts: [
        {
          source: {
            file: 'src/recommendations.ts',
            line: 38,
            function: 'scoreAnime',
            start_line: 30,
            end_line: 70,
          },
          excerpt: '60: .sort(compare)\n61: .slice(0, limit)',
          patterns: [
            {
              kind: 'full_sort_before_bounded_slice',
              lines: [60, 61],
              limit_expression: 'limit',
              observation: 'A complete collection sort occurs before a bounded prefix is retained.',
            },
          ],
          redaction_count: 0,
          truncated: false,
          provenance: 'bounded_runtime_selected_source',
        },
      ],
    }
  );

  assert.equal(report.diagnosis.kind, 'bounded_result_overwork');
  const curve = report.observed.find((entry) => entry.kind === 'input_scale_curve');
  assert.equal(curve.classification, 'superlinear');
  assert.equal(curve.input_ratio, 35);
  assert.equal(curve.value_ratio, 50.549);
  assert.equal(curve.exponent, 1.103);
  assert.match(report.inferred[0].summary, /fully sorts candidates/);
  assert.match(report.unverified[0].summary, /bounded top-k selection/);
  assert.match(report.unverified[0].falsification, /reject this hypothesis/);
});

test('retains superlinear scaling diagnosis without a source-pattern intersection', () => {
  const report = diagnosePerformanceCapsule(performanceCapsule({ consoleMetrics: scaleMetrics() }));
  assert.equal(report.diagnosis.kind, 'superlinear_scaling');
});

test('diagnoses repeated traversal on a measured growing CPU path', () => {
  const report = diagnosePerformanceCapsule(
    performanceCapsule({
      consoleMetrics: [metric('size1000', 0.5), metric('size10000', 3), metric('size35000', 9)],
      hotspots: [
        {
          function: 'getRecommendations',
          file: 'src/recommendations.ts',
          line: 4,
          role: 'application',
          self_time_ms: 120,
          samples: 100,
          sample_share: 0.1,
        },
      ],
    }),
    {
      sourceContexts: [
        {
          source: {
            file: 'src/recommendations.ts',
            line: 12,
            reported_line: 4,
            function: 'getRecommendations',
            start_line: 1,
            end_line: 100,
          },
          excerpt: '17: for (const phase of phases)\n43: for (let i = 0; i < phases.length; i++)',
          patterns: [
            {
              kind: 'repeated_source_traversal',
              lines: [17, 43],
              collection: 'phases',
              observation: 'phases is traversed 2 times.',
            },
          ],
          redaction_count: 0,
          truncated: false,
          provenance: 'bounded_runtime_selected_source',
        },
      ],
    }
  );

  assert.equal(report.diagnosis.kind, 'repeated_input_traversal');
  assert.match(report.diagnosis.summary, /phases is traversed 2 times/);
  assert.match(report.inferred[0].summary, /17 and 43/);
  assert.match(report.unverified[0].summary, /Combining the passes over phases/);
  assert.deepEqual(report.verification.success_criteria, [
    'largest-input time decreases',
    'scale exponent does not regress',
    'workload passes',
  ]);
  const hotspot = report.observed.find((entry) => entry.kind === 'repository_cpu_hotspot');
  assert.equal(hotspot.source.line, 12);
  assert.equal(hotspot.source.reported_line, 4);
});

test('diagnoses a nested catalog lookup on a measured growing CPU path', () => {
  const report = diagnosePerformanceCapsule(
    performanceCapsule({
      consoleMetrics: [metric('size1000', 0.5), metric('size35000', 10)],
      hotspots: [
        {
          function: 'getRecommendations',
          file: 'src/recommendations.ts',
          line: 12,
          role: 'application',
          self_time_ms: 100,
          samples: 90,
          sample_share: 0.09,
        },
      ],
    }),
    {
      sourceContexts: [
        {
          source: {
            file: 'src/hobbies.ts',
            line: 250,
            function: 'getCategoryForHobby',
            start_line: 250,
            end_line: 253,
          },
          excerpt: '252: return categories.find((cat) => cat.hobbies.some(matches));',
          patterns: [
            {
              kind: 'nested_collection_lookup',
              lines: [252],
              operations: ['find', 'some'],
              observation: 'A lookup scans nested collections.',
            },
          ],
          redaction_count: 0,
          truncated: false,
          provenance: 'bounded_runtime_selected_source',
        },
      ],
    }
  );

  assert.equal(report.diagnosis.kind, 'nested_lookup_hotspot');
  assert.match(report.inferred[0].summary, /find plus some/);
  assert.match(report.unverified[0].summary, /Pre-indexing the catalog/);
});

test('diagnoses split-for-prefix work on a measured growing CPU path', () => {
  const report = diagnosePerformanceCapsule(
    performanceCapsule({
      consoleMetrics: [metric('size100', 1), metric('size5000', 40)],
      hotspots: [
        {
          function: 'inlineTokens',
          file: 'src/Lexer.ts',
          line: 303,
          role: 'application',
          self_time_ms: 100,
          samples: 80,
          sample_share: 0.16,
        },
      ],
    }),
    {
      sourceContexts: [
        {
          source: {
            file: 'src/Tokenizer.ts',
            line: 238,
            function: 'list',
            start_line: 220,
            end_line: 300,
          },
          excerpt: "263: const line = src.split('\\n', 1)[0];",
          patterns: [
            {
              kind: 'split_for_prefix',
              lines: [263],
              delimiter: '\\n',
              observation: 'A split retains only the prefix.',
            },
          ],
          redaction_count: 0,
          truncated: false,
          provenance: 'bounded_runtime_selected_source',
        },
      ],
    }
  );

  assert.equal(report.diagnosis.kind, 'prefix_split_hotspot');
  assert.match(report.inferred[0].summary, /retains only element zero/);
  assert.match(report.unverified[0].summary, /direct delimiter search and slicing/);
});

test('diagnoses repeated linear membership on a superlinear CPU path', () => {
  const report = diagnosePerformanceCapsule(
    performanceCapsule({
      consoleMetrics: [metric('size100', 1), metric('size2000', 160)],
      hotspots: [
        {
          function: 'inlineTokens',
          file: 'src/Lexer.ts',
          line: 303,
          role: 'application',
          self_time_ms: 100,
          samples: 80,
          sample_share: 0.16,
        },
      ],
    }),
    {
      sourceContexts: [
        {
          source: {
            file: 'src/Lexer.ts',
            line: 303,
            function: 'inlineTokens',
            start_line: 303,
            end_line: 490,
          },
          excerpt: '308: const links = Object.keys(...)\n311: links.includes(...)',
          patterns: [
            {
              kind: 'linear_membership_over_keys',
              lines: [308, 311],
              collection: 'links',
              observation: 'Linear membership over keys.',
            },
          ],
          redaction_count: 0,
          truncated: false,
          provenance: 'bounded_runtime_selected_source',
        },
      ],
    }
  );

  assert.equal(report.diagnosis.kind, 'repeated_linear_membership');
  assert.match(report.inferred[0].summary, /materializes links/);
  assert.match(report.unverified[0].summary, /indexed membership/);
});

test('prioritizes startup-dominated evidence over sparse application samples', () => {
  const report = diagnosePerformanceCapsule(
    performanceCapsule({
      hotspots: [
        {
          function: 'tinyFunction',
          file: 'src/tiny.ts',
          line: 4,
          role: 'application',
          self_time_ms: 1,
          samples: 1,
          sample_share: 0.001,
        },
      ],
      findings: [
        {
          kind: 'startup_dominated_scope',
          basis: 'vitest_reported_assertion_time_vs_process_wall_time',
          assertion_median_total_ms: 2,
          wall_median_ms: 700,
          assertion_share_percent: 0.286,
          threshold_percent: 10,
        },
      ],
    })
  );

  assert.equal(report.diagnosis.kind, 'startup_dominated_workload');
  assert.equal(report.verdict.status, 'needs_better_workload');
  assert.equal(report.next_action.kind, 'design_representative_workload');
  assert.doesNotMatch(report.diagnosis.summary, /src\/tiny/);
});

test('preserves a demonstrated compatible-baseline regression as the primary issue', () => {
  const capsule = performanceCapsule();
  capsule.verdict = { status: 'regressed', reason: 'Compatible baseline regressed.' };
  capsule.comparison = {
    status: 'regressed',
    metric: 'median_wall_time_ms',
    baseline: { median: 100, samples: 3 },
    current: { median: 140, samples: 3 },
    delta_ms: 40,
    delta_percent: 40,
    policy: { minimum_delta_ms: 25, minimum_delta_percent: 20 },
  };
  const report = diagnosePerformanceCapsule(capsule);

  assert.equal(report.diagnosis.kind, 'demonstrated_regression');
  assert.equal(report.diagnosis.confidence.level, 'high');
  assert.equal(report.inferred[0].kind, 'compatible_baseline_regression');
  assert.equal(report.next_action.kind, 'isolate_regression_candidate');
});

test('reports a repository CPU candidate when no stronger signal exists', () => {
  const report = diagnosePerformanceCapsule(
    performanceCapsule({
      hotspots: [
        {
          function: 'renderResults',
          file: 'src/results.ts',
          line: 88,
          role: 'application',
          self_time_ms: 45,
          samples: 40,
          sample_share: 0.12,
        },
      ],
    })
  );

  assert.equal(report.diagnosis.kind, 'application_cpu_hotspot');
  assert.equal(report.diagnosis.confidence.level, 'medium');
  assert.equal(report.unverified[0].kind, 'cpu_reduction_hypothesis');
});

test('keeps an already-fast supported-scale operation as a guardrail instead of optimization work', () => {
  const report = diagnosePerformanceCapsule(
    performanceCapsule({
      consoleMetrics: [metric('size20', 0.005), metric('size50', 0.007), metric('size79', 0.013)],
      hotspots: [
        {
          function: 'selectCandidates',
          file: 'src/router/select-model.ts',
          line: 171,
          role: 'application',
          self_time_ms: 75,
          samples: 70,
          sample_share: 0.3,
        },
      ],
    })
  );

  assert.equal(report.diagnosis.kind, 'already_fast_at_supported_scale');
  assert.equal(report.diagnosis.confidence.level, 'high');
  assert.equal(report.verdict.status, 'measured');
  assert.equal(report.inferred[0].kind, 'absolute_cost_guardrail');
  assert.equal(report.unverified.length, 0);
  assert.equal(report.next_action.kind, 'retain_guardrail_and_profile_another_flow');
  assert.deepEqual(report.verification.success_criteria, [
    'largest-input cost remains at or below 0.1 ms/op',
    'workload passes',
  ]);
});

test('refuses an unstable or immaterial V8 source candidate', () => {
  const capsule = performanceCapsule({
    hotspots: [
      {
        function: 'renderResults',
        file: 'src/results.ts',
        line: 88,
        role: 'application',
        self_time_ms: 5,
        samples: 4,
        sample_share: 0.06,
      },
    ],
  });
  capsule.observed.profile_repeatability = {
    qualified: false,
    reason: 'The repeated V8 source candidate did not cross the recorded thresholds.',
  };
  const report = diagnosePerformanceCapsule(capsule);

  assert.equal(report.diagnosis.kind, 'insufficient_source_evidence');
  assert.equal(report.verdict.status, 'no_confidence');
  assert.equal(report.unverified.length, 0);
  assert.equal(report.next_action.kind, 'capture_more_material_source_evidence');
});

test('incomplete profiles request better evidence instead of an optimization', () => {
  const capsule = performanceCapsule();
  capsule.verdict = { status: 'no_confidence', reason: 'Required evidence was incomplete.' };
  capsule.limitations = ['The runtime produced no V8 CPU profile.'];
  const report = diagnosePerformanceCapsule(capsule);

  assert.equal(report.diagnosis.kind, 'insufficient_evidence');
  assert.equal(report.verdict.status, 'no_confidence');
  assert.equal(report.next_action.kind, 'repair_or_stabilize_profile');
  assert.equal(report.unverified.length, 0);
  assert.deepEqual(report.limitations, capsule.limitations);
});

test('extracts only same-unit metrics with encoded input sizes', () => {
  const curve = extractScaleCurve([
    ...scaleMetrics(),
    {
      metrics: [
        { name: 'p95', value: 99, unit: 'ms/op' },
        { name: 'size50000', value: 2, unit: 'requests/s' },
      ],
    },
  ]);

  assert.deepEqual(
    curve.points.map((point) => point.input),
    [1_000, 10_000, 35_000]
  );
});

function performanceCapsule({
  adapter = 'vitest',
  hotspots = [],
  goBenchmarks = [],
  consoleMetrics = [],
  findings = [],
} = {}) {
  return {
    schema_version: 'runtime-performance-capsule/v1',
    subject: { repository_revision: 'abc123', dirty: false },
    adapter: { kind: adapter, executable_identity: `local:${adapter}`, arguments: [] },
    scope: {
      target: adapter === 'go-bench' ? 'benchmark_test.go' : 'src/work.test.ts',
      name: 'exact workload',
    },
    sample_policy: { samples: 3, warmups: 1 },
    observed: {
      executions: [],
      wall_time_ms: distribution(735),
      hotspots,
      go_benchmarks: goBenchmarks,
      vitest_tests: [],
      vitest_execution_share: null,
      console_metrics: consoleMetrics,
    },
    findings,
    relationships: [],
    unverified: [],
    comparison: null,
    limitations: [],
    capture: {},
    verdict: { status: 'profiled', reason: 'Profiled.' },
  };
}

function scaleMetrics() {
  return [metric('size1000', 0.448), metric('size10000', 5.662), metric('size35000', 22.646)];
}

function metric(name, value) {
  return {
    kind: 'console_benchmark_metrics',
    metrics: [{ name, value, unit: 'ms/op' }],
    provenance: 'profile_execution_stdout',
  };
}

function distribution(median) {
  return { count: 3, min: median, median, p95: median, max: median, spread_percent: 0 };
}
