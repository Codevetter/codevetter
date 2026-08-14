import assert from 'node:assert/strict';
import test from 'node:test';

import { createFinding, validateFinding } from './performance-findings-contracts.mjs';
import { compactPlaywrightDiagnosis } from './playwright-capture-contracts.mjs';
import { selectProfileExperimentFinding } from './profile-tool-diagnosis.mjs';
import { diagnoseToolLedPerformance } from './tool-led-performance-diagnosis.mjs';

test('tool-led diagnosis groups repeated SQL and keeps N+1 semantic inference explicit', () => {
  const report = diagnoseToolLedPerformance(flowCapsule());

  assert.equal(report.verdict.status, 'findings');
  const repeated = report.findings.find(
    (finding) => finding.kind === 'repeated_database_operation'
  );
  assert.equal(repeated.observed.operation_count, 3);
  assert.equal(repeated.observed.operation_shape, 'SELECT name FROM items WHERE id = ?');
  assert.equal(repeated.source.file, 'src/items.js');
  assert.equal(repeated.eligible_for_experiment, true);
  assert.equal(repeated.origin, 'tool_detected');

  const nPlusOne = report.findings.find((finding) => finding.kind === 'n_plus_one_shape');
  assert.match(nPlusOne.inference.mechanism, /n_plus_one/);
  assert.ok(nPlusOne.unverified.some((entry) => entry.includes('does not prove')));
  assert.equal(nPlusOne.confidence.level, 'medium');

  const serialized = report.findings.find((finding) => finding.kind === 'serialized_operations');
  assert.equal(serialized.observed.operation_count, 3);
  assert.equal(serialized.eligible_for_experiment, false);
  assert.ok(serialized.unverified.some((entry) => entry.includes('ordering')));

  const unaccounted = report.findings.find((finding) => finding.kind === 'unaccounted_flow_time');
  assert.equal(unaccounted.eligible_for_experiment, false);
  assert.equal(unaccounted.inference.mechanism, 'instrumentation_depth_gap');

  const repeatedWork = report.findings.find(
    (finding) => finding.kind === 'repeated_application_work'
  );
  assert.equal(repeatedWork.observed.call_count, 8);
  assert.equal(repeatedWork.source.function, 'loadItem');
  assert.ok(report.detector_coverage.every((entry) => entry.status === 'ran'));
});

test('finding output is byte-stable when flow input order changes', () => {
  const first = flowCapsule();
  const second = flowCapsule();
  second.flows = second.flows.toReversed();

  assert.equal(
    JSON.stringify(diagnoseToolLedPerformance(first)),
    JSON.stringify(diagnoseToolLedPerformance(second))
  );
});

test('browser diagnosis ranks failed, repeated, dominant, and unexplained local evidence', () => {
  const report = diagnoseToolLedPerformance(browserFlowCapsule());

  const failed = report.findings.find((finding) => finding.kind === 'failed_network_operation');
  assert.equal(failed.observed.status, 403);
  assert.equal(failed.observed.host, 'fonts.example');
  assert.equal(failed.source.file, 'index.html');
  assert.equal(failed.eligible_for_experiment, false);
  assert.ok(failed.unverified.some((entry) => entry.includes('remote-denial policy')));

  const repeated = report.findings.find((finding) => finding.kind === 'repeated_network_operation');
  assert.equal(repeated.observed.operation_count, 3);
  assert.match(repeated.inference.mechanism, /possible_redundant/);
  assert.equal(repeated.eligible_for_experiment, false);

  const dominant = report.findings.find((finding) => finding.kind === 'dominant_network_operation');
  assert.equal(dominant.observed.max_duration_ms, 200);
  assert.equal(dominant.observed.duration_share, 0.4);
  assert.ok(dominant.unverified.some((entry) => entry.includes('production latency')));

  const unexplained = report.findings.find((finding) => finding.kind === 'unaccounted_flow_time');
  assert.equal(unexplained.observed.unaccounted_ms, 250);
  for (const detector of [
    'failed_network_operation',
    'repeated_network_operation',
    'dominant_network_operation',
  ]) {
    assert.equal(
      report.detector_coverage.find((entry) => entry.detector === detector).status,
      'ran'
    );
  }
});

test('React hotspot diagnosis accepts exact floors, presentation truncation, and stable identity', () => {
  const capsule = browserFlowCapsule();
  capsule.browser_react = reactEvidence([
    reactComponent('TieLater', 5, 3, 'src/Z.tsx', 4),
    reactComponent('TieWinner', 5, 3, 'src/A.tsx', 8),
  ]);
  capsule.browser_react.presentation_truncated = true;
  capsule.browser_react.truncated = true;
  const first = diagnoseToolLedPerformance(capsule);
  const finding = first.findings.find(
    (candidate) => candidate.kind === 'react_component_commit_hotspot'
  );
  assert.equal(finding.observed.component_name, 'TieWinner');
  assert.equal(finding.observed.self_actual_duration_ms, 5);
  assert.equal(finding.observed.self_duration_share, 0.1);
  assert.equal(finding.source.file, 'src/A.tsx');
  assert.equal(finding.eligible_for_experiment, true);
  assert.ok(finding.limitations.some((entry) => entry.includes('presentation was truncated')));
  assert.ok(finding.unverified.some((entry) => entry.includes('does not prove')));
  assert.ok(finding.unverified.some((entry) => entry.includes('not exact exclusive')));
  assert.ok(finding.unverified.some((entry) => entry.includes('production frequency')));
  assert.equal(selectProfileExperimentFinding({ tool_diagnosis: first }).id, finding.id);

  const reordered = structuredClone(capsule);
  reordered.browser_react.components.reverse();
  const second = diagnoseToolLedPerformance(reordered);
  assert.equal(second.findings.find((candidate) => candidate.kind === finding.kind).id, finding.id);
  const summary = compactPlaywrightDiagnosis({
    tool_diagnosis: first,
    react: capsule.browser_react,
  });
  assert.equal(summary.react.top_components[0].self_actual_duration_ms, 5);
  assert.equal(summary.react.measurement_complete, true);
  assert.equal(summary.react.source_attribution.state, 'complete');
});

test('React hotspot diagnosis selects one candidate by self duration before commit count', () => {
  const capsule = browserFlowCapsule();
  capsule.browser_react = reactEvidence([
    reactComponent('ManyCommits', 6, 8, 'src/Many.tsx', 1),
    reactComponent('MoreSelfWork', 7, 3, 'src/More.tsx', 1),
  ]);
  const findings = diagnoseToolLedPerformance(capsule).findings.filter(
    (candidate) => candidate.kind === 'react_component_commit_hotspot'
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].observed.component_name, 'MoreSelfWork');
});

test('React hotspot diagnosis reports every fail-closed evidence boundary', () => {
  const cases = [
    ['absent', undefined, 'unavailable'],
    ['unavailable', { state: 'unavailable' }, 'unavailable'],
    [
      'legacy',
      {
        ...reactEvidence([reactComponent('Legacy', 10, 3, 'src/Legacy.tsx', 1)]),
        schema_version: 'runtime-playwright-react-commits/v1',
      },
      'insufficient_evidence',
    ],
    [
      'unprofiled',
      {
        ...reactEvidence([]),
        attribution: 'commit_only',
        profiled_commit_count: 0,
        total_actual_duration_ms: 0,
      },
      'insufficient_evidence',
    ],
    ['immaterial', reactEvidence([reactComponent('Tiny', 4.999, 3, 'src/Tiny.tsx', 1)]), 'ran'],
    [
      'external',
      reactEvidence([
        {
          ...reactComponent('External', 10, 3, 'src/External.tsx', 1),
          ownership: 'external_or_ambiguous',
          source: null,
        },
      ]),
      'insufficient_evidence',
    ],
    [
      'ambiguous source',
      reactEvidence([
        {
          ...reactComponent('Ambiguous', 10, 3, 'src/Ambiguous.tsx', 1),
          ownership: 'external_or_ambiguous',
          source: null,
        },
      ]),
      'insufficient_evidence',
    ],
    [
      'partial source scan',
      {
        ...reactEvidence([reactComponent('Partial', 10, 3, 'src/Partial.tsx', 1)]),
        source_attribution: reactSourceAttribution('partial'),
      },
      'insufficient_evidence',
    ],
  ];
  for (const [label, evidence, expectedStatus] of cases) {
    const capsule = browserFlowCapsule();
    if (evidence !== undefined) capsule.browser_react = evidence;
    const report = diagnoseToolLedPerformance(capsule);
    const detector = report.detector_coverage.find(
      (entry) => entry.detector === 'browser_react_component_commit_hotspot'
    );
    assert.equal(detector.status, expectedStatus, label);
    assert.equal(
      report.findings.some((finding) => finding.kind === 'react_component_commit_hotspot'),
      false,
      label
    );
  }
});

test('browser network thresholds fail closed and remain byte-stable under flow reordering', () => {
  const capsule = browserFlowCapsule();
  capsule.flows = capsule.flows.filter(
    (flow) => !['network-api-3', 'network-bundle'].includes(flow.id)
  );
  const first = diagnoseToolLedPerformance(capsule);
  const reordered = diagnoseToolLedPerformance({ ...capsule, flows: capsule.flows.toReversed() });

  assert.equal(
    first.findings.some((finding) => finding.kind === 'repeated_network_operation'),
    false
  );
  assert.equal(
    first.findings.some((finding) => finding.kind === 'dominant_network_operation'),
    false
  );
  assert.equal(JSON.stringify(first), JSON.stringify(reordered));
});

test('browser diagnosis does not call an exact asserted HTTP status a failure', () => {
  const capsule = browserFlowCapsule();
  const expected = structuredClone(capsule.flows.find((flow) => flow.id === 'network-api-1'));
  expected.id = 'expected-missing';
  expected.name = 'GET /missing';
  expected.attributes = {
    ...expected.attributes,
    route: '/missing',
    status: 404,
    outcome: 'error',
  };
  expected.evidence_ids = ['evidence-expected-missing'];
  capsule.flows.push(expected);
  capsule.expected_http_statuses = [{ method: 'GET', route: '/missing', status: 404 }];

  const report = diagnoseToolLedPerformance(capsule);
  assert.equal(
    report.findings.some(
      (finding) =>
        finding.kind === 'failed_network_operation' &&
        finding.observed.operation_shape === 'GET /missing'
    ),
    false
  );
  assert.ok(report.findings.some((finding) => finding.kind === 'failed_network_operation'));
});

test('browser diagnosis does not merge redacted query variants into one request shape', () => {
  const capsule = browserFlowCapsule();
  for (const [index, flow] of capsule.flows
    .filter((entry) => entry.id.startsWith('network-api-'))
    .entries()) {
    flow.attributes.request_identity_sha256 = String(index + 1).padStart(64, '0');
  }

  const report = diagnoseToolLedPerformance(capsule);
  assert.equal(
    report.findings.some((finding) => finding.kind === 'repeated_network_operation'),
    false
  );
});

test('browser diagnosis excludes policy-denied and config-disabled development artifacts', () => {
  const capsule = browserFlowCapsule();
  for (const flow of capsule.flows) {
    if (flow.id === 'network-font' || flow.id.startsWith('network-api-')) {
      flow.attributes.status = -1;
      flow.attributes.outcome = 'error';
    }
    if (flow.id === 'network-bundle') flow.attributes.route = '/@vite/client';
  }

  const report = diagnoseToolLedPerformance(capsule);
  assert.equal(
    report.findings.some((finding) =>
      [
        'failed_network_operation',
        'repeated_network_operation',
        'dominant_network_operation',
      ].includes(finding.kind)
    ),
    false
  );

  const next = browserFlowCapsule();
  next.browser_runtime = { configuration: 'codevetter_config_disabled' };
  for (const flow of next.flows) {
    if (flow.id === 'network-font' || flow.id.startsWith('network-api-')) {
      flow.attributes.status = -1;
      flow.attributes.outcome = 'error';
    }
    if (flow.id === 'network-bundle') {
      flow.attributes.route = '/_next/static/chunks/main-app.js';
    }
  }
  const nextReport = diagnoseToolLedPerformance(next);
  assert.equal(
    nextReport.findings.some(
      (finding) =>
        finding.kind === 'dominant_network_operation' &&
        finding.observed.operation_shape === 'GET /_next/static/chunks/main-app.js'
    ),
    false
  );
});

test('browser diagnosis reports isolated repository CPU samples without authorizing an edit', () => {
  const capsule = browserFlowCapsule();
  capsule.browser_server = {
    state: 'observed',
    requests: [
      {
        ordinal: 1,
        method: 'GET',
        route: '/api/items',
        duration_ms: 40,
        accounting: { unaccounted_ms: 40 },
        source: null,
        cpu: {
          state: 'observed',
          total_samples: 20,
          repository_samples: 12,
          candidates: [
            {
              source: {
                file: 'src/api/items.ts',
                line: 18,
                function: 'buildItems',
                provenance: 'node_request_cpu_sample',
              },
              samples: 12,
              sample_share: 0.6,
              self_time_ms: 8,
            },
          ],
        },
      },
    ],
  };

  const report = diagnoseToolLedPerformance(capsule);
  const finding = report.findings.find(
    (candidate) => candidate.detector === 'browser_server_cpu_hotspot'
  );
  assert.equal(finding.kind, 'application_cpu_hotspot');
  assert.equal(finding.source.file, 'src/api/items.ts');
  assert.equal(finding.eligible_for_experiment, false);
  assert.equal(
    report.detector_coverage.find((entry) => entry.detector === 'browser_server_cpu_hotspot')
      .status,
    'ran'
  );
});

test('browser diagnosis withholds CPU attribution from overlapping profiles', () => {
  const capsule = browserFlowCapsule();
  capsule.browser_server = {
    state: 'observed',
    requests: [
      {
        ordinal: 1,
        method: 'GET',
        route: '/api/items',
        duration_ms: 40,
        accounting: { unaccounted_ms: 40 },
        source: null,
        cpu: { state: 'contaminated', candidates: [] },
      },
    ],
  };
  const report = diagnoseToolLedPerformance(capsule);
  assert.equal(
    report.findings.some((candidate) => candidate.detector === 'browser_server_cpu_hotspot'),
    false
  );
  assert.equal(
    report.detector_coverage.find((entry) => entry.detector === 'browser_server_cpu_hotspot')
      .status,
    'insufficient_evidence'
  );
});

test('browser diagnosis reports request-context async delay without calling it awaited work', () => {
  const capsule = browserFlowCapsule();
  capsule.browser_server = {
    state: 'observed',
    requests: [
      {
        ordinal: 1,
        method: 'GET',
        route: '/api/items',
        duration_ms: 40,
        accounting: { unaccounted_ms: 40 },
        source: null,
        cpu: null,
        async_resources: [
          {
            resource_kind: 'timer',
            wait_ms: 30,
            callback_active_ms: 0.1,
            response_dependency: 'context_only',
            response_end_after_callback_ms: 2,
            source: null,
          },
          {
            resource_kind: 'timer',
            wait_ms: 20,
            callback_active_ms: 0.1,
            response_dependency: 'response_completion_descendant',
            response_end_after_callback_ms: 1,
            source: {
              file: 'src/api/items.ts',
              line: 22,
              function: 'loadItems',
              provenance: 'node_async_creator_callsite',
            },
          },
        ],
      },
    ],
  };
  const report = diagnoseToolLedPerformance(capsule);
  const finding = report.findings.find(
    (candidate) => candidate.detector === 'browser_server_async_delay'
  );
  assert.equal(finding.source.file, 'src/api/items.ts');
  assert.equal(finding.observed.async_delay_ms, 20);
  assert.equal(finding.observed.response_dependency, 'response_completion_descendant');
  assert.equal(finding.eligible_for_experiment, false);
  assert.match(finding.confidence.basis, /allowlisted public-creator call site/i);
  assert.match(finding.unverified[0], /does not prove JavaScript await syntax/i);
});

test('browser diagnosis dismisses complete context-only delay as a response bottleneck', () => {
  const capsule = browserFlowCapsule();
  capsule.browser_server = {
    state: 'observed',
    requests: [
      {
        ordinal: 1,
        method: 'GET',
        route: '/api/items',
        duration_ms: 100,
        accounting: { unaccounted_ms: 100 },
        source: null,
        cpu: null,
        async_resources: [
          {
            resource_kind: 'timer',
            wait_ms: 80,
            callback_active_ms: 0.1,
            response_dependency: 'context_only',
            response_end_after_callback_ms: 10,
            source: { file: 'src/background.ts', line: 4 },
          },
        ],
      },
    ],
  };

  const report = diagnoseToolLedPerformance(capsule);
  assert.equal(
    report.findings.some((candidate) => candidate.detector === 'browser_server_async_delay'),
    false
  );
  assert.match(
    report.detector_coverage.find((entry) => entry.detector === 'browser_server_async_delay')
      .reason,
    /context-only work was dismissed/i
  );
});

test('browser diagnosis retains a material delay when response lineage is incomplete', () => {
  const capsule = browserFlowCapsule();
  capsule.browser_server = {
    state: 'observed',
    requests: [
      {
        ordinal: 1,
        method: 'GET',
        route: '/api/items',
        duration_ms: 100,
        accounting: { unaccounted_ms: 100 },
        source: null,
        cpu: null,
        async_resources: [
          {
            resource_kind: 'timer',
            wait_ms: 30,
            callback_active_ms: 0.1,
            response_dependency: 'unknown',
            response_end_after_callback_ms: 10,
            source: null,
          },
        ],
      },
    ],
  };

  const finding = diagnoseToolLedPerformance(capsule).findings.find(
    (candidate) => candidate.detector === 'browser_server_async_delay'
  );
  assert.equal(finding.observed.response_dependency, 'unknown');
  assert.match(finding.unverified[0], /incomplete or unavailable/i);
});

test('browser diagnosis reports a material framework phase without source edit authority', () => {
  const capsule = browserFlowCapsule();
  capsule.browser_server = {
    state: 'observed',
    requests: [
      {
        ordinal: 1,
        method: 'GET',
        route: '/',
        duration_ms: 100,
        accounting: { unaccounted_ms: 100 },
        source: null,
        cpu: null,
        async_resources: [],
        framework_phase_inventory: { total: 2, retained: 2, complete: true },
        framework_phases: [
          { phase: 'route_resolution', start_offset_ms: 2, duration_ms: 10 },
          { phase: 'component_tree', start_offset_ms: 8, duration_ms: 70 },
        ],
      },
    ],
  };

  const report = diagnoseToolLedPerformance(capsule);
  const finding = report.findings.find(
    (candidate) => candidate.detector === 'browser_server_framework_phase'
  );
  assert.equal(finding.source, null);
  assert.equal(finding.observed.phase, 'component_tree');
  assert.equal(finding.observed.phase_duration_ms, 70);
  assert.equal(finding.observed.parent_share, 0.7);
  assert.equal(finding.eligible_for_experiment, false);
  assert.match(finding.unverified[0], /framework and application work/i);
  assert.match(finding.verification.rejection_condition, /Do not authorize a source edit/i);
});

test('browser diagnosis does not rank an incomplete phase inventory', () => {
  const capsule = browserFlowCapsule();
  capsule.browser_server = {
    state: 'observed',
    requests: [
      {
        ordinal: 1,
        method: 'GET',
        route: '/',
        duration_ms: 100,
        accounting: { unaccounted_ms: 100 },
        source: null,
        cpu: null,
        async_resources: [],
        framework_phase_inventory: { total: 3, retained: 1, complete: false },
        framework_phases: [{ phase: 'component_tree', start_offset_ms: 8, duration_ms: 70 }],
      },
    ],
  };

  const report = diagnoseToolLedPerformance(capsule);
  assert.equal(
    report.findings.some((candidate) => candidate.detector === 'browser_server_framework_phase'),
    false
  );
  assert.equal(
    report.detector_coverage.find((entry) => entry.detector === 'browser_server_framework_phase')
      .status,
    'insufficient_evidence'
  );
});

test('browser diagnosis reports material preflight timing shapes without source authority', () => {
  for (const [classification, durations] of Object.entries({
    first_preflight_outlier: [400, 120, 130],
    browser_request_outlier: [120, 110, 300],
    repeated_high_latency: [150, 120, 130],
  })) {
    const capsule = browserFlowCapsule();
    capsule.browser_server = {
      state: 'observed',
      requests: [],
      preflight_comparison: preflightComparison(classification, ...durations),
    };
    const report = diagnoseToolLedPerformance(capsule);
    const finding = report.findings.find(
      (candidate) => candidate.detector === 'browser_server_preflight_timing'
    );
    assert.equal(finding.source, null);
    assert.equal(finding.observed.operation_shape, classification);
    assert.equal(finding.eligible_for_experiment, false);
    assert.equal(finding.confidence.level, 'low');
    assert.match(finding.unverified[0], /does not identify framework compilation/i);
    assert.match(finding.verification.rejection_condition, /Do not authorize a source edit/i);
  }
});

test('browser diagnosis dismisses stable preflight timing and refuses incomplete comparison', () => {
  for (const [classification, expectedStatus] of [
    ['no_material_outlier', 'ran'],
    ['insufficient_evidence', 'insufficient_evidence'],
  ]) {
    const capsule = browserFlowCapsule();
    capsule.browser_server = {
      state: 'observed',
      requests: [],
      preflight_comparison:
        classification === 'insufficient_evidence'
          ? preflightComparison(classification, null, null, null, null)
          : preflightComparison(classification, 40, 30, 35),
    };
    const report = diagnoseToolLedPerformance(capsule);
    assert.equal(
      report.findings.some((candidate) => candidate.detector === 'browser_server_preflight_timing'),
      false
    );
    assert.equal(
      report.detector_coverage.find((entry) => entry.detector === 'browser_server_preflight_timing')
        .status,
      expectedStatus
    );
  }
});

test('browser diagnosis classifies dominant response preparation, emission, and finalization', () => {
  for (const [expected, timing] of Object.entries({
    response_preparation: responseTiming(80, 10, 10),
    response_emission: responseTiming(10, 80, 10),
    response_finalization: responseTiming(10, 10, 80),
  })) {
    const capsule = browserFlowCapsule();
    capsule.browser_server = {
      state: 'observed',
      requests: [responseRequest(timing)],
    };
    const report = diagnoseToolLedPerformance(capsule);
    const finding = report.findings.find(
      (candidate) => candidate.detector === 'browser_server_response_interval'
    );
    assert.equal(finding.observed.response_interval, expected);
    assert.equal(finding.source, null);
    assert.equal(finding.confidence.level, 'low');
    assert.equal(finding.eligible_for_experiment, false);
    assert.match(finding.unverified[0], /not browser or network TTFB/i);
    assert.match(finding.verification.rejection_condition, /Do not authorize a source edit/i);
  }
});

test('response interval ties use request order while immaterial and incomplete evidence fail closed', () => {
  const tied = browserFlowCapsule();
  tied.browser_server = {
    state: 'observed',
    requests: [responseRequest(responseTiming(50, 50, 0))],
  };
  const tiedFinding = diagnoseToolLedPerformance(tied).findings.find(
    (candidate) => candidate.detector === 'browser_server_response_interval'
  );
  assert.equal(tiedFinding.observed.response_interval, 'response_preparation');

  for (const [timing, expectedStatus] of [
    [responseTiming(34, 33, 33), 'ran'],
    [
      {
        ...responseTiming(80, 10, 10),
        complete: false,
        preparation_ms: null,
        emission_ms: null,
        finish_tail_ms: null,
      },
      'insufficient_evidence',
    ],
  ]) {
    const capsule = browserFlowCapsule();
    capsule.browser_server = { state: 'observed', requests: [responseRequest(timing)] };
    const report = diagnoseToolLedPerformance(capsule);
    assert.equal(
      report.findings.some(
        (candidate) => candidate.detector === 'browser_server_response_interval'
      ),
      false
    );
    assert.equal(
      report.detector_coverage.find(
        (entry) => entry.detector === 'browser_server_response_interval'
      ).status,
      expectedStatus
    );
  }
});

test('browser diagnosis classifies high, low, and mixed pre-commit process CPU', () => {
  for (const [classification, ratio] of [
    ['high_process_cpu', 0.8],
    ['low_observed_process_cpu', 0.1],
    ['mixed_process_cpu', 0.3],
  ]) {
    const capsule = browserFlowCapsule();
    capsule.browser_server = {
      state: 'observed',
      requests: [responseRequest(responseTiming(80, 10, 10), processCpu(ratio, 0))],
    };
    const report = diagnoseToolLedPerformance(capsule);
    const finding = report.findings.find(
      (candidate) => candidate.detector === 'browser_server_precommit_process_cpu'
    );
    assert.equal(finding.observed.classification, classification);
    assert.equal(finding.observed.cpu_to_wall_ratio, ratio);
    assert.equal(finding.source, null);
    assert.equal(finding.confidence.level, 'low');
    assert.equal(finding.eligible_for_experiment, false);
    assert.match(finding.unverified[0], /not exclusive request CPU/i);
    assert.match(finding.verification.rejection_condition, /Do not authorize a source edit/i);
  }
});

test('pre-commit process CPU classification refuses overlap, incompleteness, and immaterial time', () => {
  for (const [timing, cpu, expectedStatus] of [
    [responseTiming(80, 10, 10), processCpu(0.8, 1), 'insufficient_evidence'],
    [responseTiming(80, 10, 10), { ...processCpu(0.8, 0), complete: false }, 'unavailable'],
    [responseTiming(4, 48, 48), processCpu(0.8, 0), 'insufficient_evidence'],
  ]) {
    const capsule = browserFlowCapsule();
    capsule.browser_server = {
      state: 'observed',
      requests: [responseRequest(timing, cpu)],
    };
    const report = diagnoseToolLedPerformance(capsule);
    assert.equal(
      report.findings.some(
        (candidate) => candidate.detector === 'browser_server_precommit_process_cpu'
      ),
      false
    );
    assert.equal(
      report.detector_coverage.find(
        (entry) => entry.detector === 'browser_server_precommit_process_cpu'
      ).status,
      expectedStatus
    );
  }
});

test('pre-commit probe routing selects every supported evidence family without edit authority', () => {
  for (const scope of ['repository', 'dependency', 'generated', 'runtime']) {
    const request = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0));
    request.cpu = precommitCpu(scope, 40);
    const finding = precommitRouteFinding(request);
    assert.equal(finding.observed.classification, `main_thread_${scope}`);
    assert.equal(finding.observed.next_probe, `inspect_main_thread_${scope}`);
    assert.equal(finding.eligible_for_experiment, false);
    assert.equal(finding.source, null);
  }

  const offMain = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0));
  offMain.cpu = precommitCpu('runtime', 8);
  assert.equal(
    precommitRouteFinding(offMain).observed.classification,
    'off_main_thread_or_background_cpu'
  );

  const asyncRequest = responseRequest(responseTiming(80, 10, 10), processCpu(0.1, 0));
  asyncRequest.async_resources = [
    {
      resource_kind: 'timer',
      response_dependency: 'response_completion_descendant',
      preparation_overlap_ms: 30,
    },
  ];
  asyncRequest.async_overlap.preparation_response_completion_delay_ms = 30;
  assert.equal(
    precommitRouteFinding(asyncRequest).observed.classification,
    'response_linked_async_timer'
  );

  const frameworkRequest = responseRequest(responseTiming(80, 10, 10), processCpu(0.1, 0));
  frameworkRequest.framework_phase_inventory = { total: 1, retained: 1, complete: true };
  frameworkRequest.framework_phases = [
    { phase: 'component_tree', start_offset_ms: 10, duration_ms: 30 },
  ];
  frameworkRequest.framework_phase_preparation_overlap_ms = 30;
  assert.equal(
    precommitRouteFinding(frameworkRequest).observed.classification,
    'framework_phase_component_tree'
  );

  const mixed = responseRequest(responseTiming(80, 10, 10), processCpu(0.1, 0));
  assert.equal(precommitRouteFinding(mixed).observed.classification, 'mixed_evidence');
});

test('pre-commit probe routing requests missing evidence instead of guessing', () => {
  const missingCpu = responseRequest(responseTiming(80, 10, 10), null);
  let finding = precommitRouteFinding(missingCpu);
  assert.equal(finding.observed.classification, 'insufficient_evidence');
  assert.equal(finding.observed.next_probe, 'capture_non_overlapping_process_cpu');

  const missingMainThread = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0));
  finding = precommitRouteFinding(missingMainThread);
  assert.equal(finding.observed.classification, 'insufficient_evidence');
  assert.equal(finding.observed.next_probe, 'capture_main_thread_precommit_profile');

  const incompleteWait = responseRequest(responseTiming(80, 10, 10), processCpu(0.1, 0));
  incompleteWait.async_resource_inventory.complete = false;
  finding = precommitRouteFinding(incompleteWait);
  assert.equal(finding.observed.classification, 'insufficient_evidence');
  assert.equal(finding.observed.next_probe, 'complete_async_and_framework_inventories');
});

test('worker-aware routing distinguishes sampled Worker CPU from unresolved process CPU', () => {
  for (const scope of ['repository', 'dependency', 'generated', 'runtime']) {
    const scoped = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0));
    scoped.cpu = precommitCpu('runtime', 8);
    scoped.worker_cpu = workerCpuEvidence({ cpuMs: 20, scope, sampledMs: 12 });
    const scopedFinding = precommitRouteFinding(scoped);
    assert.equal(scopedFinding.observed.classification, `worker_thread_${scope}`);
    assert.equal(scopedFinding.observed.next_probe, `inspect_worker_thread_${scope}`);
    assert.equal(scopedFinding.observed.worker_to_process_cpu_ratio, 0.3125);
    assert.equal(scopedFinding.source, null);
    assert.equal(scopedFinding.eligible_for_experiment, false);
  }

  const unattributed = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0));
  unattributed.cpu = precommitCpu('runtime', 8);
  unattributed.worker_cpu = workerCpuEvidence({ cpuMs: 20, sampledMs: 1 });
  let finding = precommitRouteFinding(unattributed);
  assert.equal(finding.observed.classification, 'worker_thread_unattributed');
  assert.equal(finding.observed.next_probe, 'capture_worker_source_profile');

  const zero = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0));
  zero.cpu = precommitCpu('runtime', 8);
  zero.worker_cpu = workerCpuEvidence({ state: 'observed_zero', cpuMs: 0, workers: [] });
  finding = precommitRouteFinding(zero);
  assert.equal(finding.observed.classification, 'native_background_thread_or_sampling_gap');
  assert.equal(finding.observed.next_probe, 'capture_native_v8_libuv_thread_activity');
});

test('worker-aware routing includes threshold edges and preserves main-thread precedence', () => {
  const edge = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0));
  edge.cpu = precommitCpu('runtime', 8);
  edge.worker_cpu = workerCpuEvidence({
    cpuMs: 12.8,
    scope: 'repository',
    sampledMs: 5,
    commitMs: 105,
    workers: [
      {
        state: 'observed',
        start_offset_ms: 25,
        stop_offset_ms: 105,
        profile: {
          complete: true,
          non_idle_sampled_time_ms: 5,
          sample_scope_time_ms: { repository: 5, dependency: 0, generated: 0, runtime: 0 },
        },
      },
    ],
  });
  assert.equal(precommitRouteFinding(edge).observed.classification, 'worker_thread_repository');

  const below = structuredClone(edge);
  below.worker_cpu.total_cpu_ms = 12.799;
  assert.equal(
    precommitRouteFinding(below).observed.classification,
    'native_background_thread_or_sampling_gap'
  );

  const mainThread = structuredClone(edge);
  mainThread.cpu = precommitCpu('repository', 40);
  assert.equal(precommitRouteFinding(mainThread).observed.classification, 'main_thread_repository');
});

test('worker-aware routing refuses unsupported, incomplete, contaminated, and incompatible evidence', () => {
  for (const [state, expectedClassification, expectedProbe] of [
    ['unsupported', 'worker_cpu_unsupported', 'capture_worker_cpu_on_supported_node'],
    ['insufficient', 'worker_cpu_incomplete', 'capture_complete_worker_cpu'],
    ['contaminated', 'worker_cpu_contaminated', 'recapture_isolated_worker_cpu'],
  ]) {
    const request = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0));
    request.cpu = precommitCpu('runtime', 8);
    request.worker_cpu = workerCpuEvidence({ state, complete: false });
    const finding = precommitRouteFinding(request);
    assert.equal(finding.observed.classification, expectedClassification);
    assert.equal(finding.observed.next_probe, expectedProbe);
  }

  const incompatible = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0));
  incompatible.cpu = precommitCpu('runtime', 8);
  incompatible.worker_cpu = workerCpuEvidence({ commitMs: 120 });
  const finding = precommitRouteFinding(incompatible);
  assert.equal(finding.observed.classification, 'worker_cpu_incompatible_interval');
  assert.equal(finding.observed.next_probe, 'capture_compatible_worker_cpu_interval');
});

test('exact current-thread CPU owns routing while V8 samples only select scope', () => {
  const scoped = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0, 0, 0.75));
  scoped.cpu = precommitCpu('repository', 5);
  let finding = precommitRouteFinding(scoped);
  assert.equal(finding.observed.classification, 'main_thread_repository');
  assert.equal(finding.observed.main_thread_cpu_ms, 48);
  assert.equal(finding.observed.other_threads_cpu_ms, 16);
  assert.equal(finding.observed.main_thread_to_process_cpu_ratio, 0.75);

  const unattributed = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0, 0, 0.75));
  unattributed.cpu = precommitCpu('runtime', 4.999);
  finding = precommitRouteFinding(unattributed);
  assert.equal(finding.observed.classification, 'main_thread_unattributed');
  assert.equal(finding.observed.next_probe, 'inspect_main_thread_runtime');

  const exactOtherThreads = responseRequest(
    responseTiming(80, 10, 10),
    processCpu(0.8, 0, 0, 0.25)
  );
  exactOtherThreads.cpu = precommitCpu('repository', 50);
  exactOtherThreads.worker_cpu = workerCpuEvidence({
    cpuMs: 20,
    scope: 'dependency',
    sampledMs: 8,
  });
  finding = precommitRouteFinding(exactOtherThreads);
  assert.equal(finding.observed.classification, 'worker_thread_dependency');
  assert.equal(finding.observed.worker_to_other_threads_cpu_ratio, 0.4167);
  assert.equal(finding.observed.worker_to_process_cpu_ratio, null);

  exactOtherThreads.worker_cpu = workerCpuEvidence({
    cpuMs: 50,
    scope: 'dependency',
    sampledMs: 8,
  });
  finding = precommitRouteFinding(exactOtherThreads);
  assert.equal(finding.observed.classification, 'worker_cpu_inconsistent_partition');
  assert.equal(finding.observed.next_probe, 'recapture_compatible_thread_and_worker_cpu');
});

test('inconsistent thread CPU fails closed and child processes never appear in residual routes', () => {
  const inconsistent = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0));
  inconsistent.process_cpu.thread_partition = threadPartition('inconsistent');
  let finding = precommitRouteFinding(inconsistent);
  assert.equal(finding.observed.classification, 'insufficient_evidence');
  assert.equal(finding.observed.next_probe, 'recapture_consistent_thread_cpu_partition');

  const native = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0, 0, 0.25));
  native.cpu = precommitCpu('runtime', 2);
  native.worker_cpu = workerCpuEvidence({ state: 'observed_zero', cpuMs: 0, workers: [] });
  finding = precommitRouteFinding(native);
  assert.equal(finding.observed.classification, 'native_activity_unavailable');
  assert.equal(finding.observed.next_probe, 'capture_native_v8_libuv_thread_activity');
  assert.equal(JSON.stringify(finding.observed).includes('child'), false);
  assert.equal(finding.source, null);
  assert.equal(finding.confidence.level, 'low');
  assert.equal(finding.eligible_for_experiment, false);
});

test('native-aware routing selects libuv activity and fails closed for every unsafe state', () => {
  const request = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0, 0, 0.25));
  request.cpu = precommitCpu('runtime', 2);
  request.worker_cpu = workerCpuEvidence({ state: 'observed_zero', cpuMs: 0, workers: [] });
  request.native_activity = nativeActivityEvidence({ kind: 'crypto', activityMs: 12 });
  let finding = precommitRouteFinding(request);
  assert.equal(finding.observed.classification, 'libuv_threadpool_crypto');
  assert.equal(finding.observed.next_probe, 'inspect_libuv_threadpool_crypto');
  assert.equal(finding.observed.native_threadpool_mechanism_activity_ms, 12);
  assert.equal(
    Object.keys(finding.observed).some((key) => key.includes('native') && key.includes('ratio')),
    false
  );
  assert.match(finding.inference.summary, /does not attribute CPU causality/);
  assert.equal(finding.source, null);
  assert.equal(finding.confidence.level, 'low');
  assert.equal(finding.eligible_for_experiment, false);

  for (const [state, classification, probe] of [
    ['unsupported', 'native_activity_unsupported', 'capture_native_activity_on_supported_node'],
    ['incomplete', 'native_activity_incomplete', 'capture_complete_native_activity'],
    ['contaminated', 'native_activity_contaminated', 'recapture_isolated_native_activity'],
    ['invalid', 'native_activity_invalid', 'recapture_valid_native_activity'],
  ]) {
    request.native_activity = nativeActivityEvidence({ state, complete: false });
    finding = precommitRouteFinding(request);
    assert.equal(finding.observed.classification, classification);
    assert.equal(finding.observed.next_probe, probe);
  }

  request.native_activity = nativeActivityEvidence({ commitMs: 120 });
  finding = precommitRouteFinding(request);
  assert.equal(finding.observed.classification, 'native_activity_incompatible_interval');
  assert.equal(finding.observed.next_probe, 'capture_compatible_native_activity_interval');

  request.native_activity = nativeActivityEvidence({ state: 'observed_zero', kind: null });
  finding = precommitRouteFinding(request);
  assert.equal(finding.observed.classification, 'native_background_thread_or_sampling_gap');
  assert.equal(finding.observed.next_probe, 'capture_deeper_native_thread_cpu');
});

test('compact diagnosis retains Worker routing without granting edit authority', () => {
  const request = responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 0));
  request.cpu = precommitCpu('runtime', 8);
  request.worker_cpu = workerCpuEvidence({ cpuMs: 20, scope: 'repository', sampledMs: 12 });
  const capsule = browserFlowCapsule();
  capsule.browser_server = { state: 'observed', requests: [request] };
  const toolDiagnosis = diagnoseToolLedPerformance(capsule);
  const compact = compactPlaywrightDiagnosis({ tool_diagnosis: toolDiagnosis });

  assert.equal(compact.next_probe.classification, 'worker_thread_repository');
  assert.equal(compact.next_probe.probe, 'inspect_worker_thread_repository');
  assert.equal(compact.next_probe.confidence, 'low');
  assert.equal(compact.next_probe.edit_eligible, false);
  assert.equal(compact.next_probe.failed_flow_requires_correctness, true);
});

test('post-commit request overlap does not erase an isolated pre-commit CPU interval', () => {
  const capsule = browserFlowCapsule();
  capsule.browser_server = {
    state: 'observed',
    requests: [responseRequest(responseTiming(80, 10, 10), processCpu(0.8, 7, 0))],
  };
  const finding = diagnoseToolLedPerformance(capsule).findings.find(
    (candidate) => candidate.detector === 'browser_server_precommit_process_cpu'
  );
  assert.equal(finding.observed.classification, 'high_process_cpu');
  assert.equal(finding.observed.overlapping_request_count, 7);
  assert.equal(finding.observed.overlapping_preparation_request_count, 0);
});

test('browser diagnosis collapses many repeated request shapes into one reload-cluster finding', () => {
  const capsule = browserFlowCapsule();
  const template = capsule.flows.find((flow) => flow.id === 'network-api-1');
  capsule.flows.push(
    ...[1, 2, 3].map((index) => ({
      ...structuredClone(template),
      id: `network-route-${index}`,
      name: 'GET /route-module.js',
      attributes: { ...template.attributes, route: '/route-module.js' },
      evidence_ids: [`evidence-route-${index}`],
    }))
  );

  const report = diagnoseToolLedPerformance(capsule);
  const repeated = report.findings.filter(
    (finding) => finding.kind === 'repeated_network_operation'
  );
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].observed.operation_count, 6);
  assert.equal(repeated[0].observed.operation_shape, '2 repeated request shapes');
  assert.equal(
    repeated[0].inference.mechanism,
    'possible_browser_reload_or_duplicate_fetch_cluster'
  );
});

test('detectors respect repetition thresholds and do not mistake overlap for serialization', () => {
  const belowThreshold = flowCapsule();
  belowThreshold.flows = belowThreshold.flows.filter((flow) => flow.id !== 'flow-db-3');
  const thresholdReport = diagnoseToolLedPerformance(belowThreshold);
  assert.equal(
    thresholdReport.findings.some((finding) => finding.kind === 'repeated_database_operation'),
    false
  );

  const overlapping = flowCapsule();
  for (const flow of overlapping.flows.filter((entry) => entry.kind === 'database')) {
    flow.timing.started_at_ms = 102;
    flow.timing.duration_ms = 5;
  }
  const overlapReport = diagnoseToolLedPerformance(overlapping);
  assert.equal(
    overlapReport.findings.some((finding) => finding.kind === 'serialized_operations'),
    false
  );
});

test('high-cardinality I/O preserves exact aggregates with bounded evidence identifiers', () => {
  const capsule = flowCapsule();
  capsule.flows = capsule.flows.slice(0, 2);
  capsule.flows[1].timing.duration_ms = 100;
  capsule.flows.push(
    ...Array.from({ length: 70 }, (_, index) => ({
      id: `flow-http-${index + 1}`,
      parent_flow_id: 'flow-server',
      kind: 'http_client',
      name: `GET /asset-${index + 1}`,
      timing: {
        started_at_ms: 100 + index,
        duration_ms: 1,
        provenance: 'playwright_trace',
      },
      attributes: {
        method: 'GET',
        route: `/asset-${index + 1}`,
        status: 200,
        outcome: 'ok',
        source: null,
      },
      evidence_ids: [`event-http-${index + 1}`],
      limitations: [],
    }))
  );
  capsule.function_analysis = { observed_function_count: 0, repeated_work_candidate: null };

  const report = diagnoseToolLedPerformance(capsule);
  const serialized = report.findings.find((finding) => finding.kind === 'serialized_operations');
  assert.equal(serialized.observed.operation_count, 70);
  assert.equal(serialized.observed.flow_ids.length, 64);
  assert.equal(serialized.evidence_ids.length, 64);
});

test('missing runtime mechanisms produce detector coverage instead of findings', () => {
  const capsule = flowCapsule();
  capsule.flows = [capsule.flows[0]];
  capsule.function_analysis = { observed_function_count: 0, repeated_work_candidate: null };

  const report = diagnoseToolLedPerformance(capsule);

  assert.equal(report.verdict.status, 'no_confidence');
  assert.equal(report.findings.length, 0);
  assert.equal(
    report.detector_coverage.find((entry) => entry.detector === 'repeated_database_operation')
      .status,
    'unavailable'
  );
  assert.equal(
    report.detector_coverage.find((entry) => entry.detector === 'unaccounted_flow_time').status,
    'unavailable'
  );
});

test('finding contracts reject unknown fields and content identity drift', () => {
  const finding = createFinding({
    detector: 'repeated_database_operation',
    kind: 'repeated_database_operation',
    origin: 'tool_detected',
    flow_id: 'flow-1',
    source: null,
    observed: {
      operation_count: 3,
      operation_kind: 'database',
      operation_shape: 'SELECT ?',
      flow_ids: ['flow-2', 'flow-3', 'flow-4'],
    },
    inference: { summary: 'Repeated operation.', mechanism: 'repeated_database_round_trips' },
    unverified: ['Semantic necessity is unknown.'],
    confidence: { level: 'medium', basis: 'Observed count.' },
    expected_effect: { metric: 'query_count', direction: 'decrease', scope: 'same flow' },
    verification: {
      required_observation: 'Query count decreases.',
      rejection_condition: 'Correctness changes.',
    },
    evidence_ids: ['e-1'],
    limitations: ['No source.'],
    eligible_for_experiment: false,
  });

  assert.deepEqual(validateFinding(finding), []);
  assert.ok(validateFinding({ ...finding, command: 'rm' }).some((error) => /unknown/.test(error)));
  assert.ok(
    validateFinding({ ...finding, flow_id: 'changed' }).some((error) => /canonical/.test(error))
  );
});

function flowCapsule() {
  const source = {
    file: 'src/items.js',
    line: 12,
    function: 'loadItem',
    provenance: 'node_diagnostic_callsite',
  };
  const database = [0, 4, 8].map((offset, index) => ({
    id: `flow-db-${index + 1}`,
    parent_flow_id: 'flow-server',
    kind: 'database',
    name: 'SQLite GET SELECT name FROM items WHERE id = ?',
    timing: {
      started_at_ms: 102 + offset,
      duration_ms: 2,
      provenance: 'node_diagnostic_flow_pass',
    },
    attributes: {
      database: 'node_sqlite',
      operation: 'get',
      statement: 'SELECT name FROM items WHERE id = ?',
      outcome: 'ok',
      source,
    },
    evidence_ids: [`event-db-${index + 1}`],
    limitations: [],
  }));
  return {
    subject: { repository_revision: 'revision-1' },
    adapter: { kind: 'node-test' },
    scope: { target: 'test/items.test.js', name: 'lists items' },
    root_flow_id: 'flow-root',
    flows: [
      {
        id: 'flow-root',
        parent_flow_id: null,
        kind: 'workload',
        name: 'lists items',
        timing: { duration_ms: 50, provenance: 'measurement' },
        evidence_ids: ['wall-time'],
        limitations: [],
      },
      {
        id: 'flow-server',
        parent_flow_id: 'flow-root',
        kind: 'http_server',
        name: 'GET /items',
        timing: {
          started_at_ms: 100,
          duration_ms: 30,
          provenance: 'node_diagnostic_flow_pass',
          accounting: { accounted_child_ms: 6, unaccounted_ms: 24 },
        },
        attributes: { method: 'GET', route: '/items', status: 200, outcome: 'ok' },
        evidence_ids: ['event-server'],
        limitations: [],
      },
      ...database,
    ],
    function_analysis: {
      observed_function_count: 10,
      repeated_work_candidate: {
        function: 'loadItem',
        file: 'src/items.js',
        start_line: 12,
        end_line: 16,
        call_count: 8,
        cpu_evidence: { self_time_ms: 4, samples: 4, sample_share: 0.2 },
        evidence_ids: ['coverage:loadItem', 'cpu:loadItem'],
      },
    },
  };
}

function browserFlowCapsule() {
  const source = {
    file: 'index.html',
    line: 8,
    function: null,
    provenance: 'static_network_literal',
  };
  const request = (id, route, start, duration, attributes = {}) => ({
    id,
    parent_flow_id: 'navigation',
    kind: 'http_client',
    name: `GET ${route}`,
    timing: {
      started_at_ms: start,
      duration_ms: duration,
      provenance: 'bounded_playwright_trace',
    },
    attributes: {
      method: 'GET',
      route,
      host: null,
      network_scope: 'loopback',
      status: 200,
      outcome: 'ok',
      source: null,
      ...attributes,
    },
    evidence_ids: [`evidence-${id}`],
    limitations: [],
  });
  return {
    subject: { repository_revision: 'browser-revision' },
    adapter: { kind: 'playwright-trace' },
    scope: { target: 'tests/browser.spec.ts', name: 'loads dashboard' },
    root_flow_id: 'root',
    flows: [
      {
        id: 'root',
        parent_flow_id: null,
        kind: 'workload',
        name: 'loads dashboard',
        timing: { duration_ms: 500, provenance: 'playwright_trace_bounds' },
        evidence_ids: ['trace'],
        limitations: [],
      },
      {
        id: 'navigation',
        parent_flow_id: 'root',
        kind: 'navigation',
        name: 'page.goto',
        timing: {
          started_at_ms: 0,
          duration_ms: 500,
          provenance: 'bounded_playwright_trace',
          accounting: { accounted_child_ms: 250, unaccounted_ms: 250 },
        },
        attributes: { route: '/', source: null },
        evidence_ids: ['navigation'],
        limitations: [],
      },
      request('network-font', '/font.css', 1, 10, {
        host: 'fonts.example',
        network_scope: 'remote',
        status: 403,
        outcome: 'error',
        source,
      }),
      request('network-api-1', '/api/items', 20, 20),
      request('network-api-2', '/api/items', 20, 20),
      request('network-api-3', '/api/items', 20, 20),
      request('network-bundle', '/bundle.js', 50, 200),
    ],
    function_analysis: { observed_function_count: 0, repeated_work_candidate: null },
  };
}

function reactEvidence(components) {
  return {
    schema_version: 'runtime-playwright-react-commits/v2',
    state: 'succeeded',
    framework: 'react',
    authority: {
      package_path: 'package.json',
      declared_packages: ['react'],
      provenance: 'nearest_package_manifest_declared_dependency',
    },
    documents_observed: 1,
    renderer_versions: ['19.1.0'],
    commit_count: 3,
    profiled_commit_count: 3,
    total_actual_duration_ms: 50,
    max_commit_duration_ms: 20,
    measurement_complete: true,
    presentation_truncated: false,
    self_duration_provenance: 'inclusive_minus_direct_child_actual_duration',
    source_attribution: reactSourceAttribution('complete'),
    components,
    attribution: components.length > 0 ? 'component_activity_observed' : 'commit_only',
    truncated: false,
    provenance: 'react_devtools_hook_separate_exact_flow_pass',
    delivery: null,
    limitations: [],
  };
}

function reactComponent(name, selfDuration, commits, file, line) {
  return {
    name,
    active_fiber_count: commits,
    commits_present: commits,
    inclusive_actual_duration_ms: selfDuration,
    max_actual_duration_ms: selfDuration,
    self_actual_duration_ms: selfDuration,
    max_self_actual_duration_ms: selfDuration,
    ownership: 'repository',
    source: {
      file,
      line,
      provenance: 'static_unique_react_component_declaration',
    },
  };
}

function reactSourceAttribution(state) {
  return {
    state,
    files_scanned: 12,
    bytes_scanned: 20_000,
    file_limit: 512,
    byte_limit: 4 * 1024 * 1024,
    provenance: 'bounded_static_component_declaration_scan',
  };
}

function preflightComparison(
  classification,
  firstDurationMs,
  repeatDurationMs,
  browserDurationMs,
  statusClass = '2xx'
) {
  return {
    classification,
    first_duration_ms: firstDurationMs,
    repeat_duration_ms: repeatDurationMs,
    browser_duration_ms: browserDurationMs,
    status_class: statusClass,
    provenance: 'owned_next_preflight_wall_and_correlated_server_wall',
  };
}

function responseTiming(preparationMs, emissionMs, finishTailMs) {
  const end = preparationMs + emissionMs;
  const finish = end + finishTailMs;
  return {
    complete: true,
    commit_offset_ms: preparationMs,
    first_body_offset_ms: preparationMs,
    end_offset_ms: end,
    finish_offset_ms: finish,
    preparation_ms: preparationMs,
    emission_ms: emissionMs,
    finish_tail_ms: finishTailMs,
  };
}

function responseRequest(responseTimingEvidence, processCpuEvidence = null) {
  return {
    ordinal: 1,
    method: 'GET',
    route: '/',
    duration_ms: 100,
    accounting: { unaccounted_ms: 100 },
    source: null,
    cpu: null,
    async_resource_inventory: { total: 0, retained: 0, complete: true },
    async_resources: [],
    async_overlap: { preparation_response_completion_delay_ms: 0 },
    framework_phase_inventory: { total: 0, retained: 0, complete: true },
    framework_phases: [],
    framework_phase_preparation_overlap_ms: 0,
    response_timing: responseTimingEvidence,
    process_cpu: processCpuEvidence,
  };
}

function precommitCpu(scope, durationMs) {
  const scopes = ['repository', 'dependency', 'generated', 'runtime', 'idle', 'unresolved'];
  return {
    complete: true,
    overlapping_dynamic_requests: 0,
    precommit: {
      complete: true,
      boundary_ms: 80,
      non_idle_sampled_time_ms: durationMs,
      sample_scope_time_ms: Object.fromEntries(
        scopes.map((candidate) => [candidate, candidate === scope ? durationMs : 0])
      ),
    },
  };
}

function workerCpuEvidence({
  state = 'observed',
  cpuMs = 20,
  scope = 'runtime',
  sampledMs = 10,
  commitMs = 80,
  complete = true,
  workers,
} = {}) {
  const observedWorkers =
    workers ??
    (state === 'observed'
      ? [
          {
            state: 'observed',
            start_offset_ms: 1,
            stop_offset_ms: 81,
            profile: {
              complete: true,
              non_idle_sampled_time_ms: sampledMs,
              sample_scope_time_ms: {
                repository: scope === 'repository' ? sampledMs : 0,
                dependency: scope === 'dependency' ? sampledMs : 0,
                generated: scope === 'generated' ? sampledMs : 0,
                runtime: scope === 'runtime' ? sampledMs : 0,
              },
            },
          },
        ]
      : []);
  return {
    state,
    complete,
    response_commit_offset_ms: commitMs,
    total_cpu_ms: cpuMs,
    inventory: { retained: observedWorkers.length },
    workers: observedWorkers,
  };
}

function nativeActivityEvidence({
  state = 'observed',
  kind = 'crypto',
  activityMs = 10,
  commitMs = 80,
  complete = ['observed', 'observed_zero'].includes(state),
} = {}) {
  const mechanisms = kind ? [{ kind, count: 1, union_activity_ms: activityMs }] : [];
  return {
    state,
    complete,
    response_commit_offset_ms: commitMs,
    interval_ms: 80,
    threadpool: {
      total_count: mechanisms.length,
      union_activity_ms: mechanisms.length ? activityMs : 0,
      mechanisms,
    },
    v8: { total_count: 0, union_activity_ms: 0, mechanisms: [] },
  };
}

function precommitRouteFinding(request) {
  const capsule = browserFlowCapsule();
  capsule.browser_server = { state: 'observed', requests: [request] };
  const report = diagnoseToolLedPerformance(capsule);
  return report.findings.find(
    (candidate) => candidate.detector === 'browser_server_precommit_probe_route'
  );
}

function processCpu(
  ratio,
  overlappingRequestCount,
  overlappingPreparationRequestCount = overlappingRequestCount,
  threadMainShare = null
) {
  const preparationCpuMs = 80 * ratio;
  return {
    complete: true,
    overlapping_request_count: overlappingRequestCount,
    overlapping_preparation_request_count: overlappingPreparationRequestCount,
    preparation_user_ms: preparationCpuMs,
    preparation_system_ms: 0,
    preparation_cpu_ms: preparationCpuMs,
    preparation_cpu_to_wall_ratio: ratio,
    request_user_ms: preparationCpuMs,
    request_system_ms: 0,
    request_cpu_ms: preparationCpuMs,
    request_cpu_to_wall_ratio: preparationCpuMs / 100,
    thread_partition:
      threadMainShare === null
        ? threadPartition('unsupported')
        : threadPartition('observed', preparationCpuMs, threadMainShare),
  };
}

function threadPartition(state, processCpuMs = null, mainShare = null) {
  if (state !== 'observed') {
    return {
      state,
      preparation_main_thread_cpu_ms: null,
      preparation_other_threads_cpu_ms: null,
      preparation_main_thread_to_process_cpu_ratio: null,
      request_main_thread_cpu_ms: null,
      request_other_threads_cpu_ms: null,
      request_main_thread_to_process_cpu_ratio: null,
      observer_effect: 'nested_process_and_current_thread_counter_snapshots',
      provenance: 'process_and_current_thread_cpu_usage_deltas',
    };
  }
  const mainCpuMs = processCpuMs * mainShare;
  const otherCpuMs = processCpuMs - mainCpuMs;
  return {
    state,
    preparation_main_thread_cpu_ms: mainCpuMs,
    preparation_other_threads_cpu_ms: otherCpuMs,
    preparation_main_thread_to_process_cpu_ratio: mainShare,
    request_main_thread_cpu_ms: mainCpuMs,
    request_other_threads_cpu_ms: otherCpuMs,
    request_main_thread_to_process_cpu_ratio: mainShare,
    observer_effect: 'nested_process_and_current_thread_counter_snapshots',
    provenance: 'process_and_current_thread_cpu_usage_deltas',
  };
}
