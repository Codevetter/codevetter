import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { validatePerformanceDiagnosis } from './contracts.mjs';
import {
  diagnosePerformanceCapsule,
  diagnosePerformanceRepository,
  extractScaleCurve,
} from './performance-diagnosis.mjs';
import { selectProfileExperimentFinding } from './profile-tool-diagnosis.mjs';

test('keeps cumulative-only Go allocation pressure below the experiment floor', () => {
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
          profile_kind: 'go_alloc_objects',
          unit: 'count',
          flat: 0,
          cumulative: 60_512,
          flat_share: 0,
          cumulative_share: 0.1059,
          sample_share: 0,
        },
      ],
      findings: [
        {
          kind: 'go_allocation_path_candidate',
          basis: 'repository_owned_go_alloc_objects_cumulative_path',
          profile_kind: 'go_alloc_objects',
          source: { file: 'middleware.go', line: 42, function: 'example.Middleware' },
          flat_profile_objects: 0,
          cumulative_profile_objects: 100_000,
          flat_share: 0,
          cumulative_share: 0.1,
        },
        {
          kind: 'go_allocation_path_candidate',
          basis: 'repository_owned_go_alloc_objects_cumulative_path',
          profile_kind: 'go_alloc_objects',
          source: { file: 'middleware.go', line: 55, function: 'example.(*Client).Middleware' },
          flat_profile_objects: 0,
          cumulative_profile_objects: 60_512,
          flat_share: 0,
          cumulative_share: 0.1059,
        },
      ],
    })
  );

  assert.equal(report.diagnosis.kind, 'allocation_signal_below_experiment_floor');
  assert.equal(report.verdict.status, 'measured');
  assert.deepEqual(report.inferred, []);
  assert.deepEqual(report.unverified, []);
  assert.deepEqual(report.verification.success_criteria, [
    'workload passes',
    'compatible evidence is captured',
  ]);
  assert.equal(report.next_action.kind, 'retain_guardrail_and_profile_another_flow');
  const toolFinding = report.tool_diagnosis.findings.find(
    (finding) => finding.kind === 'application_allocation_hotspot'
  );
  assert.equal(toolFinding.origin, 'tool_detected');
  assert.equal(toolFinding.eligible_for_experiment, false);
  assert.equal(toolFinding.observed.allocs_per_op, 30);
  assert.equal(toolFinding.source.file, 'middleware.go');
  assert.equal(selectProfileExperimentFinding(report), null);
  assert.equal(
    report.tool_diagnosis.detector_coverage.find(
      (entry) => entry.detector === 'repository_allocation_hotspot'
    ).status,
    'ran'
  );
  assert.equal(report.verification.baseline_json_pointer, '/performance_capsule');
  assert.deepEqual(validatePerformanceDiagnosis(report), []);
});

test('permits a material directly sampled repeated Go allocation line', () => {
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
          function: 'example.newEventID',
          file: 'uuid.go',
          line: 35,
          role: 'application',
          profile_kind: 'go_alloc_objects',
          unit: 'count',
          flat: 25_035,
          cumulative: 25_035,
          flat_share: 0.12,
          cumulative_share: 0.12,
          sample_share: 0.12,
        },
      ],
      findings: [
        {
          kind: 'go_allocation_path_candidate',
          basis: 'repository_owned_go_alloc_objects_repeated_direct_path',
          profile_kind: 'go_alloc_objects',
          source: { file: 'uuid.go', line: 35, function: 'example.newEventID' },
          flat_profile_objects: 25_035,
          cumulative_profile_objects: 25_035,
          flat_share: 0.12,
          cumulative_share: 0.12,
          objects_per_op: 1,
          per_run_objects_per_op: [1, 1],
        },
      ],
    })
  );

  const finding = selectProfileExperimentFinding(report);
  assert.equal(report.diagnosis.kind, 'allocation_pressure');
  assert.equal(finding.kind, 'application_allocation_hotspot');
  assert.equal(finding.source.file, 'uuid.go');
  assert.equal(finding.observed.allocation_profile_objects, 25_035);
  assert.equal(finding.observed.objects_per_op, 1);
  assert.equal(finding.inference.mechanism, 'repeatable_direct_go_allocation_source');
  assert.equal(finding.eligible_for_experiment, true);
});

test('prefers a Polaris-shaped concrete allocation leaf over a broader direct allocator', () => {
  const generic = {
    kind: 'go_allocation_path_candidate',
    basis: 'repository_owned_go_alloc_objects_cumulative_path',
    profile_kind: 'go_alloc_objects',
    source: {
      file: 'internal/api/asset_search.go',
      line: 1143,
      function: 'example.eodhdResultToItem',
    },
    flat_profile_objects: 77_360,
    cumulative_profile_objects: 77_360,
    flat_share: 0.1716,
    cumulative_share: 0.1716,
  };
  const concrete = {
    kind: 'go_allocation_path_candidate',
    basis: 'repository_owned_go_alloc_objects_cumulative_path',
    profile_kind: 'go_alloc_objects',
    source: {
      file: 'internal/logos/logodev.go',
      line: 64,
      function: 'example.forLogoDevTicker',
    },
    flat_profile_objects: 30_944,
    cumulative_profile_objects: 61_906,
    flat_share: 0.0686,
    cumulative_share: 0.1373,
  };
  const sourceContexts = [
    sourceContext(generic.source, []),
    sourceContext(concrete.source, [
      {
        kind: 'go_static_string_format',
        lines: [64],
        string_verbs: 3,
        observation: 'fmt.Sprintf constructs one string from literal text and %s verbs only.',
      },
    ]),
  ];
  const report = diagnosePerformanceCapsule(
    performanceCapsule({
      adapter: 'go-bench',
      goBenchmarks: [
        {
          name: 'BenchmarkCrossCategorySearchMerged-18',
          ns_per_op: distribution(15_873),
          bytes_per_op: distribution(36_746),
          allocs_per_op: distribution(484),
          provenance: 'go_test_benchmark_output',
        },
      ],
      findings: [generic, concrete],
    }),
    { sourceContexts }
  );

  const selected = selectProfileExperimentFinding(report);
  assert.equal(report.diagnosis.kind, 'allocation_pressure');
  assert.equal(selected.source.file, 'internal/logos/logodev.go');
  assert.equal(
    selected.observed.selection_basis,
    'direct_allocation_with_supported_source_pattern'
  );
  assert.deepEqual(selected.observed.source_pattern, {
    kind: 'go_static_string_format',
    lines: [64],
    string_verbs: 3,
  });
  assert.equal(selected.eligible_for_experiment, true);
  assert.match(selected.candidate_key, /^[0-9a-f]{24}$/);
  assert.match(selected.unverified.join(' '), /only a hypothesis/);
  assert.equal(
    report.tool_diagnosis.findings.filter(
      (finding) => finding.kind === 'application_allocation_hotspot'
    ).length,
    2
  );
  assert.equal(
    selectProfileExperimentFinding(report, { excludedFindingIds: [selected.id] }).source.file,
    'internal/api/asset_search.go'
  );

  const secondReport = diagnosePerformanceCapsule(
    performanceCapsule({
      adapter: 'go-bench',
      goBenchmarks: [
        {
          name: 'BenchmarkLiveSearch-18',
          ns_per_op: distribution(12_000),
          bytes_per_op: distribution(26_456),
          allocs_per_op: distribution(371),
          provenance: 'go_test_benchmark_output',
        },
      ],
      findings: [generic, concrete],
    }),
    { sourceContexts }
  );
  const secondSelected = selectProfileExperimentFinding(secondReport);
  assert.notEqual(secondSelected.id, selected.id);
  assert.equal(secondSelected.candidate_key, selected.candidate_key);
  assert.equal(
    selectProfileExperimentFinding(secondReport, {
      excludedCandidateKeys: [selected.candidate_key],
    }).source.file,
    'internal/api/asset_search.go'
  );

  const changedSnapshot = performanceCapsule({
    adapter: 'go-bench',
    sourceSnapshotSha256: '1'.repeat(64),
    goBenchmarks: [
      {
        name: 'BenchmarkLiveSearch-18',
        ns_per_op: distribution(12_000),
        bytes_per_op: distribution(26_456),
        allocs_per_op: distribution(371),
        provenance: 'go_test_benchmark_output',
      },
    ],
    findings: [generic, concrete],
  });
  const changedSelected = selectProfileExperimentFinding(
    diagnosePerformanceCapsule(changedSnapshot, { sourceContexts })
  );
  assert.notEqual(changedSelected.candidate_key, selected.candidate_key);
});

test('the repository diagnosis pipeline reaches a crowded Polaris-shaped allocation leaf', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-polaris-shaped-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, 'asset_search.go'),
    [
      'package example',
      'func eodhdResultToItem(value string) map[string]any {',
      '  meta := map[string]any{"value": value}',
      '  meta["copy"] = value',
      '  return meta',
      '}',
      '',
    ].join('\n')
  );
  await writeFile(
    join(root, 'logodev.go'),
    [
      'package example',
      'import "fmt"',
      'func forLogoDevTicker(ticker, token string) string {',
      '  return fmt.Sprintf("https://img.example/ticker/%s?token=%s", ticker, token)',
      '}',
      '',
    ].join('\n')
  );
  const generic = directGoAllocation('asset_search.go', 3, 'example.eodhdResultToItem', 0.1716);
  const sameFunctionLine = directGoAllocation(
    'asset_search.go',
    4,
    'example.eodhdResultToItem',
    0.0858
  );
  const concrete = directGoAllocation('logodev.go', 4, 'example.forLogoDevTicker', 0.0686);
  const report = await diagnosePerformanceRepository(
    performanceCapsule({
      adapter: 'go-bench',
      goBenchmarks: [
        {
          name: 'BenchmarkCrossCategorySearchMerged-18',
          ns_per_op: distribution(15_873),
          bytes_per_op: distribution(36_746),
          allocs_per_op: distribution(484),
          provenance: 'go_test_benchmark_output',
        },
      ],
      findings: [generic, sameFunctionLine, concrete],
    }),
    root
  );

  const selected = selectProfileExperimentFinding(report);
  assert.equal(selected.source.file, 'logodev.go');
  assert.equal(selected.inference.mechanism, 'direct_allocation_source_with_static_string_format');
  assert.match(selected.candidate_context_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    report.observed
      .filter((entry) => entry.kind === 'runtime_source_context')
      .map((entry) => entry.source.function),
    ['eodhdResultToItem', 'forLogoDevTicker']
  );

  await writeFile(
    join(root, 'logodev.go'),
    [
      'package example',
      'import "fmt"',
      '',
      '',
      'func forLogoDevTicker(ticker, token string) string {',
      '  return fmt.Sprintf("https://img.example/ticker/%s?token=%s", ticker, token)',
      '}',
      '',
    ].join('\n')
  );
  const lineMovedSnapshot = await diagnosePerformanceRepository(
    performanceCapsule({
      adapter: 'go-bench',
      sourceSnapshotSha256: '1'.repeat(64),
      goBenchmarks: [
        {
          name: 'BenchmarkCrossCategorySearchMerged-18',
          ns_per_op: distribution(15_873),
          bytes_per_op: distribution(36_746),
          allocs_per_op: distribution(484),
          provenance: 'go_test_benchmark_output',
        },
      ],
      findings: [generic, sameFunctionLine, concrete],
    }),
    root
  );
  assert.equal(
    selectProfileExperimentFinding(lineMovedSnapshot).candidate_key,
    selected.candidate_key
  );

  await writeFile(join(root, 'unrelated.go'), 'package example\nconst unrelated = true\n');
  const unrelatedSnapshot = await diagnosePerformanceRepository(
    performanceCapsule({
      adapter: 'go-bench',
      sourceSnapshotSha256: '1'.repeat(64),
      goBenchmarks: [
        {
          name: 'BenchmarkCrossCategorySearchMerged-18',
          ns_per_op: distribution(15_873),
          bytes_per_op: distribution(36_746),
          allocs_per_op: distribution(484),
          provenance: 'go_test_benchmark_output',
        },
      ],
      findings: [generic, sameFunctionLine, concrete],
    }),
    root
  );
  assert.equal(
    selectProfileExperimentFinding(unrelatedSnapshot).candidate_key,
    selected.candidate_key
  );

  await writeFile(
    join(root, 'logodev.go'),
    [
      'package example',
      'import "fmt"',
      'func forLogoDevTicker(ticker, token string) string {',
      '  return fmt.Sprintf("https://changed.example/ticker/%s?token=%s", ticker, token)',
      '}',
      '',
    ].join('\n')
  );
  const changedSource = await diagnosePerformanceRepository(
    performanceCapsule({
      adapter: 'go-bench',
      sourceSnapshotSha256: '2'.repeat(64),
      goBenchmarks: [
        {
          name: 'BenchmarkCrossCategorySearchMerged-18',
          ns_per_op: distribution(15_873),
          bytes_per_op: distribution(36_746),
          allocs_per_op: distribution(484),
          provenance: 'go_test_benchmark_output',
        },
      ],
      findings: [generic, sameFunctionLine, concrete],
    }),
    root
  );
  assert.notEqual(
    selectProfileExperimentFinding(changedSource).candidate_key,
    selected.candidate_key
  );
});

test('unsupported formatting does not displace the ordinary direct-allocation floor', () => {
  const generic = directGoAllocation('generic.go', 10, 'example.generic', 0.12);
  const unsupported = directGoAllocation('format.go', 20, 'example.formatCount', 0.06);
  const report = diagnosePerformanceCapsule(
    performanceCapsule({
      adapter: 'go-bench',
      goBenchmarks: [
        {
          name: 'BenchmarkFormat-18',
          ns_per_op: distribution(1_000),
          bytes_per_op: distribution(100),
          allocs_per_op: distribution(2),
          provenance: 'go_test_benchmark_output',
        },
      ],
      findings: [generic, unsupported],
    }),
    { sourceContexts: [sourceContext(generic.source, []), sourceContext(unsupported.source, [])] }
  );

  assert.equal(selectProfileExperimentFinding(report).source.file, 'generic.go');
});

test('falls back to an eligible CPU finding when the preferred allocation path is ineligible', () => {
  const allocation = { kind: 'application_allocation_hotspot', eligible_for_experiment: false };
  const cpu = { kind: 'application_cpu_hotspot', eligible_for_experiment: true };
  const selected = selectProfileExperimentFinding({
    diagnosis: { kind: 'allocation_pressure' },
    tool_diagnosis: { findings: [allocation, cpu] },
  });

  assert.equal(selected, cpu);
});

test('does not promote a cumulative-only Go CPU path as direct source evidence', () => {
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

  assert.equal(report.diagnosis.kind, 'no_material_bottleneck_identified');
  assert.equal(report.verdict.status, 'measured');
  assert.equal(
    report.observed.some((entry) => entry.kind === 'repository_cpu_hotspot'),
    false
  );
  assert.equal(
    report.tool_diagnosis.findings.some((finding) => finding.kind === 'application_cpu_hotspot'),
    false
  );
  assert.equal(report.tool_diagnosis.detector_coverage[0].status, 'insufficient_evidence');
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

test('anchors a V8 heap candidate to the unique current source definition', () => {
  const report = diagnosePerformanceCapsule(
    performanceCapsule({
      findings: [
        {
          kind: 'node_allocation_candidate',
          basis: 'repository_owned_v8_sampled_allocation_bytes_intersecting_cpu_candidate',
          source: {
            file: 'src/lib/recommendations.ts',
            line: 177,
            function: 'calculateGymGuidance',
          },
          sampled_bytes: 296_884_248,
          per_run_sampled_bytes: [148_696_496, 148_187_752],
          sample_share: 0.830705,
          provenance: 'repeated_v8_heap_source_intersecting_repeated_cpu_candidate',
        },
      ],
    }),
    {
      sourceContexts: [
        {
          source: {
            file: 'src/lib/recommendations.ts',
            line: 254,
            reported_line: 177,
            function: 'calculateGymGuidance',
            start_line: 230,
            end_line: 310,
          },
          source_context_sha256: 'a'.repeat(64),
          excerpt: '254: export function calculateGymGuidance() {',
          patterns: [],
          redaction_count: 0,
          truncated: false,
          provenance: 'bounded_runtime_selected_source',
        },
      ],
    }
  );

  const observed = report.observed.find(
    (entry) => entry.kind === 'repository_heap_allocation_source'
  );
  assert.equal(observed.source.line, 254);
  assert.equal(observed.source.reported_line, 177);
  const finding = selectProfileExperimentFinding(report);
  assert.equal(finding.source.line, 254);
  assert.equal(finding.source.reported_line, 177);
  assert.match(finding.inference.summary, /recommendations\.ts:254/);
  assert.match(finding.candidate_key, /^[0-9a-f]{24}$/);
  assert.deepEqual(validatePerformanceDiagnosis(report), []);
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
  sourceSnapshotSha256 = '0'.repeat(64),
} = {}) {
  return {
    schema_version: 'runtime-performance-capsule/v1',
    subject: {
      repository_revision: 'abc123',
      source_snapshot_sha256: sourceSnapshotSha256,
      dirty: false,
    },
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

function directGoAllocation(file, line, functionName, share) {
  return {
    kind: 'go_allocation_path_candidate',
    basis: 'repository_owned_go_alloc_objects_cumulative_path',
    profile_kind: 'go_alloc_objects',
    source: { file, line, function: functionName },
    flat_profile_objects: 10_000,
    cumulative_profile_objects: 10_000,
    flat_share: share,
    cumulative_share: share,
  };
}

function sourceContext(source, patterns) {
  return {
    source: {
      file: source.file,
      line: source.line,
      function: source.function.split('.').at(-1),
      reported_function: source.function,
      start_line: Math.max(1, source.line - 2),
      end_line: source.line + 2,
    },
    excerpt: '',
    patterns,
    redaction_count: 0,
    truncated: false,
    provenance: 'bounded_runtime_selected_source',
  };
}
