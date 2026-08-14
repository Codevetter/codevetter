import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  createPlanFromEvidence,
  planBrowserOptimization,
  rankExperiments,
} from './browser-optimization-planner.mjs';
import {
  assertBrowserOptimizationPolicy,
  browserOptimizationId,
} from './browser-optimization-contracts.mjs';

const fixture = resolve('scripts/runtime-failure-capsule/fixtures/browser-optimization-vite');

test('flow planner gathers breadth and ranks measured chunk contamination before React work', () => {
  const receipt = captureReceipt();
  const result = captureResult();
  const dependencyObservation = {
    observation_id: browserOptimizationId('dependency-observation'),
    family: 'dependencies',
    kind: 'surprising_chunk_rule_match',
    source: 'vite.config.ts',
    metric: {
      package: '@radix-ui/react-dropdown-menu',
      chunk: 'react',
      rule_line: 8,
      path_only_match: true,
      affected_bytes: 120_000,
    },
    provenance: 'static_vite_manual_chunks_subset',
    verified: true,
  };
  const plan = createPlanFromEvidence({
    loopId: 'fixture-home',
    policy: assertBrowserOptimizationPolicy({ max_experiments: 4 }),
    receipt,
    result,
    dependency: {
      graph: {
        state: 'observed',
        packages: [
          {
            package: '@radix-ui/react-dropdown-menu',
            static: true,
            imported_by: ['src/Navigation.tsx'],
          },
        ],
      },
      vite: { state: 'observed' },
      artifact: { state: 'observed', verified: false, reason: 'artifact_not_bound' },
      observations: [dependencyObservation],
      limitations: [],
    },
    review: reviewBinding('vite.config.ts'),
    createdAt: '2026-08-14T00:00:00.000Z',
  });
  assert.deepEqual(
    plan.evidence.families.map((family) => family.name),
    [
      'browser_timing',
      'loading',
      'memory',
      'react',
      'actions',
      'dependencies',
      'build_artifact',
      'review',
    ]
  );
  assert.equal(plan.queue.length, 2);
  assert.ok(
    plan.evidence.observations.some(
      (observation) => observation.kind === 'captured_initial_dependency'
    )
  );
  assert.equal(plan.queue[0].allowed_files[0], 'vite.config.ts');
  assert.match(plan.queue[0].hypothesis, /manual chunk predicate/);
  assert.match(plan.queue[0].confidence_basis, /review selector/);
  assert.deepEqual(plan.queue[0].correctness_scope, {
    adapter: 'vitest',
    target: 'src/chunks.test.ts',
    name: 'keeps route behavior',
  });
  assert.ok(
    plan.queue[0].evidence_ids.some((id) =>
      plan.evidence.observations.some(
        (observation) => observation.observation_id === id && observation.family === 'review'
      )
    )
  );
  assert.equal(plan.queue[1].allowed_files[0], 'src/HomePage.tsx');
});

test('public planner gives current changed files to review evidence selection', async () => {
  const receipt = captureReceipt();
  const calls = [];
  const plan = await planBrowserOptimization(
    fixture,
    {
      loop_id: 'fixture-home-review',
      capture_id: receipt.capture_id,
      policy: {},
    },
    {
      loadReceipt: async () => receipt,
      loadResult: async () => captureResult(),
      inspectSubject: async () => ({ ...receipt.subject, changed_files: ['src/HomePage.tsx'] }),
      inspectDependencies: async () => ({ limitations: [] }),
      inspectReviewEvidence: async (_root, options) => {
        calls.push(options.reviewChangedFiles);
        return reviewBinding('src/HomePage.tsx');
      },
      now: () => new Date('2026-08-14T00:00:00.000Z'),
    }
  );

  assert.deepEqual(calls, [['src/HomePage.tsx']]);
  assert.equal(plan.evidence.families.at(-1).name, 'review');
  assert.deepEqual(plan.queue[0].correctness_scope, {
    adapter: 'vitest',
    target: 'src/chunks.test.ts',
    name: 'keeps route behavior',
  });
});

test('exact Vite dependency routes create one repository-bounded large dependency experiment', () => {
  const receipt = captureReceipt();
  const result = captureResult();
  result.tool_diagnosis.findings = [];
  result.loading.largest_resources = [
    {
      route: '/node_modules/.vite/deps/lucide-react.js',
      transfer_bytes: 4_263_394,
    },
  ];
  result.loading.repository_modules.largest = [{ source: { file: 'components/Navigation.tsx' } }];
  const plan = createPlanFromEvidence({
    loopId: 'fixture-large-dependency',
    policy: assertBrowserOptimizationPolicy(),
    receipt,
    result,
    dependency: {
      graph: {
        state: 'observed',
        packages: [
          {
            package: 'lucide-react',
            static: true,
            imported_by: ['components/Navigation.tsx', 'components/Deferred.tsx'],
          },
          {
            package: 'react',
            static: true,
            imported_by: ['src/main.tsx'],
          },
        ],
      },
      limitations: [],
    },
    createdAt: '2026-08-14T00:00:00.000Z',
  });

  const joined = plan.evidence.observations.filter(
    (observation) => observation.kind === 'captured_initial_dependency'
  );
  assert.equal(joined.length, 1);
  assert.equal(joined[0].metric.package, 'lucide-react');
  assert.equal(joined[0].source, 'components/Deferred.tsx');
  assert.deepEqual(plan.queue[0].allowed_files, [
    'components/Deferred.tsx',
    'components/Navigation.tsx',
  ]);
  assert.equal(plan.queue[0].predicted_metric.name, 'completed_response_transfer_bytes');
});

test('large dependencies with more importers than the edit seal are not proposed', () => {
  const receipt = captureReceipt();
  const result = captureResult();
  result.tool_diagnosis.findings = [];
  result.loading.largest_resources = [
    { route: '/node_modules/.vite/deps/lucide-react.js', transfer_bytes: 4_263_394 },
  ];
  const plan = createPlanFromEvidence({
    loopId: 'fixture-unbounded-dependency',
    policy: assertBrowserOptimizationPolicy(),
    receipt,
    result,
    dependency: {
      graph: {
        state: 'observed',
        packages: [
          {
            package: 'lucide-react',
            static: true,
            imported_by: Array.from({ length: 17 }, (_, index) => `components/Icon${index}.tsx`),
          },
        ],
      },
      limitations: [],
    },
    createdAt: '2026-08-14T00:00:00.000Z',
  });

  assert.equal(plan.queue.length, 0);
});

test('review correctness authority never crosses to another source experiment', () => {
  const plan = createPlanFromEvidence({
    loopId: 'fixture-review-boundary',
    policy: assertBrowserOptimizationPolicy(),
    receipt: captureReceipt(),
    result: captureResult(),
    dependency: { limitations: [] },
    review: reviewBinding('src/recommendations.ts'),
    createdAt: '2026-08-14T00:00:00.000Z',
  });

  assert.equal(plan.queue[0].allowed_files[0], 'src/HomePage.tsx');
  assert.equal(plan.queue[0].correctness_scope, null);
  assert.doesNotMatch(plan.queue[0].confidence_basis, /review selector/);
});

test('experiment ranking deduplicates causes and uses stable identity as a tie break', () => {
  const base = experiment('a'.repeat(24), '1'.repeat(24));
  const duplicate = { ...base, experiment_id: 'b'.repeat(24) };
  const other = experiment('c'.repeat(24), '2'.repeat(24));
  const ranked = rankExperiments([other, duplicate, base], 8);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].experiment_id, 'a'.repeat(24));
  assert.deepEqual(
    ranked.map((entry) => entry.rank),
    [1, 2]
  );
});

test('public planner rejects a stale durable capture before dependency inspection', async () => {
  const receipt = captureReceipt();
  await assert.rejects(
    planBrowserOptimization(
      fixture,
      {
        loop_id: 'fixture-home',
        capture_id: receipt.capture_id,
        policy: {},
      },
      {
        loadReceipt: async () => receipt,
        inspectSubject: async () => ({
          ...receipt.subject,
          source_snapshot_sha256: 'f'.repeat(64),
        }),
        loadResult: async () => captureResult(),
        inspectDependencies: async () => {
          throw new Error('must not inspect stale capture');
        },
      }
    ),
    /capture is stale/
  );
});

function captureReceipt() {
  return {
    capture_id: 'fixture-home-capture',
    state: 'succeeded',
    result: { path: '.codevetter/result.json' },
    subject: {
      repository_revision: 'a'.repeat(40),
      source_snapshot_sha256: 'b'.repeat(64),
      dirty: true,
    },
    scope: {
      candidate_id: 'c'.repeat(16),
      target: 'e2e/home.spec.ts',
      name: 'loads home',
      browser_profile: { project_name: 'desktop' },
    },
  };
}

function captureResult() {
  return {
    main_thread: {
      phases_ms: { javascript: 50 },
      long_tasks: { total_duration_ms: 0 },
      repository_cpu: { self_time_ms: 4 },
    },
    loading: {
      state: 'observed',
      inventory: { complete: true },
      observed_transfer_bytes: 500_000,
      repository_modules: {
        observed_transfer_bytes: 100_000,
        largest: [{ source: { file: 'src/Navigation.tsx' } }],
      },
      largest_resources: [
        {
          route: '/node_modules/.vite/deps/@radix-ui_react-dropdown-menu.js',
          transfer_bytes: 50_000,
        },
      ],
    },
    memory: { process_tree_peak_rss_bytes: 100_000_000, renderer: { heap_peak_bytes: 10_000 } },
    react: {
      state: 'succeeded',
      commit_count: 5,
      total_actual_duration_ms: 10,
      measurement_complete: true,
    },
    actions: {
      state: 'observed',
      inventory: { completed_action_count: 2, complete: true },
      slowest: [{ duration_ms: 100 }],
    },
    tool_diagnosis: {
      findings: [
        {
          id: 'd'.repeat(24),
          kind: 'react_component_commit_hotspot',
          source: { file: 'src/HomePage.tsx', provenance: 'static_unique_component' },
          observed: { self_duration_share: 0.5, self_actual_duration_ms: 5, operation_count: 4 },
          inference: { mechanism: 'repeated_profiled_react_component_self_work' },
          eligible_for_experiment: true,
        },
      ],
    },
  };
}

function experiment(experimentId, causeId) {
  return {
    experiment_id: experimentId,
    cause_id: causeId,
    rank: 1,
    hypothesis: 'test hypothesis',
    confidence_basis: 'test evidence',
    allowed_files: ['src/main.ts'],
    predicted_metric: { name: 'javascript', direction: 'decrease' },
    correctness_scope: null,
    performance_scope: { adapter: 'playwright' },
    rejection_condition: 'reject on regression',
    evidence_ids: [],
    limitations: [],
    _priority: { exact: 1, affected_bytes: 1, runtime_share: 0, file_count: 1 },
  };
}

function reviewBinding(file) {
  return {
    status: 'cold_start_correctness_required',
    plan: {
      candidate_source: { file, provenance: 'repository_manifest_source_binding' },
      performance_flow: { adapter: 'playwright', target: 'e2e/home.spec.ts', name: 'loads home' },
      correctness_scope: {
        adapter: 'vitest',
        target: 'src/chunks.test.ts',
        name: 'keeps route behavior',
      },
    },
  };
}
