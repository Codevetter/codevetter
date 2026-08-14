import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createPerformanceLabStore, runAutonomousPerformanceLab } from './performance-lab.mjs';
import {
  PERFORMANCE_LAB_SCHEMA_VERSION,
  assertPerformanceLabCorrectnessScope,
  assertPerformanceLabReceipt,
  boundedPerformanceCandidateExclusions,
  boundedPerformanceFindingExclusions,
  boundedPerformanceLabSteps,
} from './performance-lab-contracts.mjs';
import { composePerformanceFlowCoverage } from './flow-coverage-report.mjs';

test('one lab run measures an exact flow and stops at one source candidate', async () => {
  const reports = [
    coverage({ kind: 'measure_unmeasured_flow', candidate_id: 'flow-1', scope: scope() }),
    coverage({
      kind: 'inspect_profile_candidate',
      candidate_id: 'flow-1',
      run_id: 'lab-s1',
      scope: scope(),
    }),
  ];
  const writes = [];
  const receipt = await runAutonomousPerformanceLab(
    { repositoryRoot: process.cwd(), labId: 'compact-lab', maxSteps: 3, warmups: 0 },
    {
      reportCoverage: async () => reports.shift(),
      supervise: async (input) => {
        assert.equal(input.target, scope().target);
        return { state: 'succeeded' };
      },
      loadMeasurement: async () => ({
        result: {
          tool_diagnosis: { findings: [finding()] },
          diagnosis: { kind: 'application_cpu_hotspot' },
        },
      }),
      store: memoryStore(writes),
      now: clock(),
    }
  );

  assert.equal(receipt.state, 'stopped');
  assert.equal(receipt.stop.kind, 'source_edit_required');
  assert.deepEqual(
    receipt.steps.map((step) => step.action),
    ['measure_performance_flow', 'inspect_profile_candidate']
  );
  assert.equal(receipt.stop.candidate.source.file, 'src/work.js');
  assert.ok(writes.length >= 3);
});

test('stable dirty inventories execute while unsafe flows remain blocked', async () => {
  let executions = 0;
  const dirtyReports = [
    coverage(
      { kind: 'measure_unmeasured_flow', candidate_id: 'flow-1', scope: scope() },
      { dirty: true, source_snapshot_sha256: 'b'.repeat(64) }
    ),
    coverage(
      { kind: 'add_representative_executable_flow' },
      { dirty: true, source_snapshot_sha256: 'b'.repeat(64) }
    ),
  ];
  const dirty = await runAutonomousPerformanceLab(
    { repositoryRoot: process.cwd(), labId: 'dirty-lab' },
    {
      reportCoverage: async () => dirtyReports.shift(),
      supervise: async () => {
        executions += 1;
        return { state: 'succeeded' };
      },
      store: memoryStore(),
      now: clock(),
    }
  );
  assert.equal(dirty.stop.kind, 'safe_actions_exhausted');
  assert.equal(executions, 1);

  const unsafeCoverage = coverage({
    kind: 'measure_unmeasured_flow',
    candidate_id: 'flow-1',
    scope: scope(),
  });
  unsafeCoverage.flows = [{ id: 'flow-1', safe_to_execute: false }];
  const unsafe = await runAutonomousPerformanceLab(
    { repositoryRoot: process.cwd(), labId: 'unsafe-lab' },
    {
      reportCoverage: async () => unsafeCoverage,
      supervise: async () => {
        executions += 1;
      },
      store: memoryStore(),
      now: clock(),
    }
  );
  assert.equal(unsafe.stop.kind, 'unsafe_flow');
  assert.equal(executions, 1);
});

test('a truncated inventory still measures one qualified exact benchmark', async () => {
  let executions = 0;
  const measurement = coverage({
    kind: 'measure_unmeasured_flow',
    candidate_id: 'flow-1',
    scope: scope(),
  });
  measurement.summary.discovery_truncated = true;
  const candidate = coverage({
    kind: 'inspect_profile_candidate',
    candidate_id: 'flow-1',
    run_id: 'truncated-direct-lab-s1',
    scope: scope(),
  });
  candidate.summary.discovery_truncated = true;
  candidate.summary.measured_profile_flows = 1;
  candidate.summary.measured_measurement_ready_flows = 1;
  candidate.summary.candidate_ready_flows = 1;
  const reports = [measurement, candidate];

  const receipt = await runAutonomousPerformanceLab(
    { repositoryRoot: process.cwd(), labId: 'truncated-direct-lab' },
    {
      reportCoverage: async () => reports.shift(),
      supervise: async () => {
        executions += 1;
        return { state: 'succeeded' };
      },
      loadMeasurement: async () => ({
        result: {
          tool_diagnosis: { findings: [finding()] },
          diagnosis: { kind: 'application_cpu_hotspot' },
        },
      }),
      store: memoryStore(),
      now: clock(),
    }
  );

  assert.equal(executions, 1);
  assert.equal(receipt.steps[0].action, 'measure_performance_flow');
  assert.equal(receipt.final_summary.discovery_truncated, true);
  assert.equal(receipt.stop.kind, 'source_edit_required');
  assert.equal(receipt.stop.candidate.source.file, 'src/work.js');

  const unsupported = coverage({ kind: 'add_representative_executable_flow' });
  unsupported.summary.discovery_truncated = true;
  const stopped = await runAutonomousPerformanceLab(
    { repositoryRoot: process.cwd(), labId: 'truncated-unsupported-lab' },
    {
      reportCoverage: async () => unsupported,
      supervise: async () => {
        executions += 1;
      },
      store: memoryStore(),
      now: clock(),
    }
  );
  assert.equal(stopped.stop.kind, 'truncated_inventory');
  assert.equal(executions, 1);
});

test('caller exclusions advance to the next eligible source candidate', async () => {
  const first = finding();
  const second = {
    ...finding(),
    id: 'c'.repeat(24),
    source: { ...finding().source, file: 'src/next.js', line: 20 },
    observed: { cpu_sample_share: 0.3 },
  };
  const receipt = await runAutonomousPerformanceLab(
    {
      repositoryRoot: process.cwd(),
      labId: 'excluded-candidate-lab',
      excludedFindingIds: [first.id],
    },
    {
      reportCoverage: async () =>
        coverage({
          kind: 'inspect_profile_candidate',
          candidate_id: 'flow-1',
          run_id: 'existing-run',
          scope: scope(),
        }),
      loadMeasurement: async () => ({
        result: {
          tool_diagnosis: { findings: [first, second] },
          diagnosis: { kind: 'application_cpu_hotspot' },
        },
      }),
      store: memoryStore(),
      now: clock(),
    }
  );

  assert.equal(receipt.stop.kind, 'source_edit_required');
  assert.equal(receipt.stop.candidate.id, second.id);
  assert.deepEqual(receipt.policy.excluded_finding_ids, [first.id]);
});

test('excluding every eligible candidate completes with explicit exhaustion', async () => {
  const candidate = finding();
  const receipt = await runAutonomousPerformanceLab(
    {
      repositoryRoot: process.cwd(),
      labId: 'exhausted-candidate-lab',
      excludedFindingIds: [candidate.id],
    },
    {
      reportCoverage: async () =>
        coverage({
          kind: 'inspect_profile_candidate',
          candidate_id: 'flow-1',
          run_id: 'existing-run',
          scope: scope(),
        }),
      loadMeasurement: async () => ({
        result: {
          tool_diagnosis: { findings: [candidate] },
          diagnosis: { kind: 'application_cpu_hotspot' },
        },
      }),
      store: memoryStore(),
      now: clock(),
    }
  );

  assert.equal(receipt.state, 'completed');
  assert.equal(receipt.stop.kind, 'candidate_exclusions_exhausted');
  assert.equal(receipt.steps.length, 0);
});

test('a source snapshot change invalidates the laboratory before another action', async () => {
  let executions = 0;
  const reports = [
    coverage(
      { kind: 'measure_unmeasured_flow', candidate_id: 'flow-1', scope: scope() },
      { dirty: true, source_snapshot_sha256: 'b'.repeat(64) }
    ),
    coverage(
      { kind: 'measure_unmeasured_flow', candidate_id: 'flow-1', scope: scope() },
      { dirty: true, source_snapshot_sha256: 'c'.repeat(64) }
    ),
  ];
  const receipt = await runAutonomousPerformanceLab(
    { repositoryRoot: process.cwd(), labId: 'changed-snapshot-lab' },
    {
      reportCoverage: async () => reports.shift(),
      supervise: async () => {
        executions += 1;
        return { state: 'succeeded' };
      },
      store: memoryStore(),
      now: clock(),
    }
  );

  assert.equal(receipt.stop.kind, 'snapshot_changed');
  assert.equal(executions, 1);
});

test('an unattested browser listener stops before Playwright capture', async () => {
  let captures = 0;
  const receipt = await runAutonomousPerformanceLab(
    { repositoryRoot: process.cwd(), labId: 'browser-lab' },
    {
      reportCoverage: async () =>
        coverage({
          kind: 'capture_local_browser_flow',
          candidate_id: 'browser-1',
          scope: { adapter: 'playwright', target: 'tests/home.spec.ts', name: 'loads home' },
        }),
      establishBrowserRuntime: async () => ({
        ready: false,
        summary: { state: 'blocked_listener', cleanup: 'not_owned' },
      }),
      captureBrowser: async () => {
        captures += 1;
      },
      store: memoryStore(),
      now: clock(),
    }
  );
  assert.equal(receipt.stop.kind, 'browser_server_blocked');
  assert.equal(captures, 0);
});

test('an environment-blocked clean Next flow falls back to an owned clean snapshot', async () => {
  const browserAction = {
    kind: 'capture_local_browser_flow',
    candidate_id: 'browser-1',
    scope: { adapter: 'playwright', target: 'tests/home.spec.ts', name: 'loads home' },
  };
  const reports = [
    coverage(browserAction),
    coverage({ kind: 'add_representative_executable_flow' }),
  ];
  const cleanExecution = {
    provenance: { mode: 'clean_git_snapshot' },
    finalize: async () => ({
      state: 'removed',
      provenance: { mode: 'clean_git_snapshot' },
    }),
  };
  let starts = 0;
  let captureInput = null;
  const receipt = await runAutonomousPerformanceLab(
    { repositoryRoot: process.cwd(), labId: 'clean-browser-lab', maxSteps: 2 },
    {
      reportCoverage: async () => reports.shift(),
      createBrowserExecution: async () => cleanExecution,
      establishBrowserRuntime: async (input) => {
        starts += 1;
        if (starts === 1) {
          return {
            ready: false,
            summary: { state: 'environment_blocked', cleanup: 'not_started' },
          };
        }
        assert.equal(input.executionContext, cleanExecution);
        return {
          ready: true,
          baseUrl: 'http://127.0.0.1:43117',
          summary: {
            state: 'owned_attested',
            configuration: 'codevetter_config_disabled',
            preflight: { state: 'not_applicable' },
            cleanup: 'pending',
          },
          stop: async () => ({ state: 'owned_attested', cleanup: 'terminated' }),
        };
      },
      captureBrowser: async (input) => {
        captureInput = input;
        return {
          state: 'succeeded',
          diagnosis: {
            verdict: 'no_findings',
            finding_count: 0,
            finding_ids: [],
            eligible_experiment_findings: 0,
          },
        };
      },
      store: memoryStore(),
      now: clock(),
    }
  );

  assert.equal(starts, 2);
  assert.equal(captureInput.executionContext, cleanExecution);
  assert.equal(receipt.steps[0].execution_source.state, 'removed');
  assert.equal(receipt.steps[0].result, 'succeeded');
});

test('dirty source never enters clean-snapshot browser fallback', async () => {
  let snapshots = 0;
  let captures = 0;
  const receipt = await runAutonomousPerformanceLab(
    { repositoryRoot: process.cwd(), labId: 'dirty-browser-lab' },
    {
      reportCoverage: async () =>
        coverage(
          {
            kind: 'capture_local_browser_flow',
            candidate_id: 'browser-1',
            scope: { adapter: 'playwright', target: 'tests/home.spec.ts', name: 'loads home' },
          },
          { dirty: true }
        ),
      establishBrowserRuntime: async () => ({
        ready: false,
        summary: { state: 'environment_blocked', cleanup: 'not_started' },
      }),
      createBrowserExecution: async () => {
        snapshots += 1;
      },
      captureBrowser: async () => {
        captures += 1;
      },
      store: memoryStore(),
      now: clock(),
    }
  );

  assert.equal(receipt.stop.kind, 'browser_server_environment_blocked');
  assert.equal(snapshots, 0);
  assert.equal(captures, 0);
});

test('clean-snapshot cleanup failure invalidates an otherwise successful capture', async () => {
  const reports = [
    coverage({
      kind: 'capture_local_browser_flow',
      candidate_id: 'browser-1',
      scope: { adapter: 'playwright', target: 'tests/home.spec.ts', name: 'loads home' },
    }),
  ];
  let starts = 0;
  const receipt = await runAutonomousPerformanceLab(
    { repositoryRoot: process.cwd(), labId: 'clean-browser-cleanup-lab' },
    {
      reportCoverage: async () => reports[0],
      createBrowserExecution: async () => ({
        finalize: async () => {
          throw new Error('owned snapshot cleanup failed');
        },
      }),
      establishBrowserRuntime: async () => {
        starts += 1;
        return starts === 1
          ? { ready: false, summary: { state: 'environment_blocked', cleanup: 'not_started' } }
          : {
              ready: true,
              baseUrl: 'http://127.0.0.1:43117',
              summary: { state: 'owned_attested', cleanup: 'pending' },
              stop: async () => ({ state: 'owned_attested', cleanup: 'terminated' }),
            };
      },
      captureBrowser: async () => ({
        state: 'succeeded',
        diagnosis: {
          verdict: 'no_findings',
          finding_count: 0,
          finding_ids: [],
          eligible_experiment_findings: 0,
        },
      }),
      store: memoryStore(),
      now: clock(),
    }
  );

  assert.equal(receipt.state, 'failed');
  assert.equal(receipt.stop.kind, 'operational_failure');
  assert.equal(receipt.steps[0].result, 'capture_threw');
  assert.equal(receipt.steps[0].diagnosis, null);
});

test('browser memory observations remain visible in the one lab response', async () => {
  const browserAction = {
    kind: 'capture_local_browser_flow',
    candidate_id: 'browser-1',
    scope: { adapter: 'playwright', target: 'tests/home.spec.ts', name: 'loads home' },
  };
  const reports = [
    coverage(browserAction),
    coverage({ kind: 'add_representative_executable_flow' }),
  ];
  const memory = {
    process_tree_peak_rss_bytes: 512 * 1024 * 1024,
    renderer: {
      samples: 12,
      heap_peak_bytes: 24 * 1024 * 1024,
      heap_delta_bytes: 4 * 1024 * 1024,
      dom_nodes_peak: 500,
      dom_nodes_delta: 100,
      documents_peak: 2,
      documents_delta: 1,
      event_listeners_peak: 80,
      event_listeners_delta: 20,
    },
    repeated: {
      samples: 3,
      after_heap_used_bytes: distribution(20_000_000, 20_100_000, 20_200_000),
      delta_heap_used_bytes: distribution(19_000_000, 19_100_000, 19_200_000),
      after_dom_nodes: distribution(360, 361, 362),
      after_event_listeners: distribution(228, 228, 228),
      context_scope: 'fresh_context_exact_flow_repeats',
    },
    same_page: {
      samples: 3,
      after_heap_used_bytes: sequence(20_000_000, 20_010_000, 20_020_000),
      after_dom_nodes: sequence(361, 361, 361),
      after_event_listeners: sequence(228, 228, 228),
      context_scope: 'same_page_and_context_exact_flow_repeats',
      interaction_scope: 'full_project_test_callback',
      retained_attribution_state: 'unavailable',
      retained_candidate: null,
    },
    leak_assessment: 'not_evaluated',
  };
  let captureInput = null;
  const receipt = await runAutonomousPerformanceLab(
    { repositoryRoot: process.cwd(), labId: 'browser-memory-lab', maxSteps: 1 },
    {
      reportCoverage: async () => reports.shift(),
      establishBrowserRuntime: async () => ({
        ready: true,
        baseUrl: 'http://127.0.0.1:43117',
        summary: { state: 'owned_attested', cleanup: 'pending' },
        stop: async () => ({ state: 'owned_attested', cleanup: 'terminated' }),
      }),
      captureBrowser: async (input) => {
        captureInput = input;
        return {
          state: 'succeeded',
          diagnosis: {
            verdict: 'no_findings',
            finding_count: 0,
            finding_ids: [],
            eligible_experiment_findings: 0,
            memory,
          },
        };
      },
      store: memoryStore(),
      now: clock(),
    }
  );

  assert.deepEqual(receipt.steps[0].diagnosis.memory, memory);
  assert.equal(captureInput.runtimeBaseUrl, 'http://127.0.0.1:43117');
});

test('one failed browser assertion remains evidence while later safe flows continue', async () => {
  const browserAction = (id, name) => ({
    kind: 'capture_local_browser_flow',
    candidate_id: id,
    scope: { adapter: 'playwright', target: `tests/${id}.spec.ts`, name },
  });
  const reports = [
    coverage(browserAction('browser-1', 'fails locally')),
    coverage(browserAction('browser-2', 'still runs')),
    coverage({ kind: 'add_representative_executable_flow' }),
  ];
  let captures = 0;
  const receipt = await runAutonomousPerformanceLab(
    { repositoryRoot: process.cwd(), labId: 'browser-failure-evidence-lab', maxSteps: 3 },
    {
      reportCoverage: async () => reports.shift(),
      establishBrowserRuntime: async () => ({
        ready: true,
        summary: { state: 'owned_attested', cleanup: 'pending' },
        stop: async () => ({ state: 'owned_attested', cleanup: 'terminated' }),
      }),
      captureBrowser: async () => {
        captures += 1;
        return {
          state: captures === 1 ? 'failed' : 'succeeded',
          diagnosis: {
            verdict: captures === 1 ? 'findings' : 'no_findings',
            finding_count: captures === 1 ? 1 : 0,
            finding_ids: captures === 1 ? ['browser-assertion'] : [],
            eligible_experiment_findings: 0,
            memory: null,
          },
        };
      },
      store: memoryStore(),
      now: clock(),
    }
  );

  assert.equal(receipt.state, 'completed');
  assert.equal(captures, 2);
  assert.deepEqual(
    receipt.steps.map((step) => step.result),
    ['failed', 'succeeded']
  );
});

test('a continuation remeasures the predecessor flow and requires paired verification', async () => {
  const predecessor = sourceEditReceipt('origin-lab');
  const currentCoverage = coverage(
    { kind: 'add_representative_executable_flow' },
    { source_snapshot_sha256: '1'.repeat(64), dirty: true }
  );
  currentCoverage.flows = [continuationFlow()];
  let executions = 0;
  const receipt = await runAutonomousPerformanceLab(
    {
      repositoryRoot: process.cwd(),
      labId: 'continued-lab',
      continueFrom: 'origin-lab',
      warmups: 0,
    },
    {
      reportCoverage: async () => currentCoverage,
      supervise: async (input) => {
        executions += 1;
        assert.equal(input.target, 'src/work.test.js');
        return { state: 'succeeded' };
      },
      loadMeasurement: async (_root, runId) => ({
        result: {
          performance_capsule:
            runId === 'origin-lab-s1'
              ? performanceCapsule(100, '0'.repeat(64))
              : performanceCapsule(50, '1'.repeat(64)),
        },
      }),
      store: memoryStore([], predecessor),
      now: clock(),
    }
  );

  assert.equal(executions, 1);
  assert.equal(receipt.stop.kind, 'paired_verification_required');
  assert.equal(receipt.screening.verdict.status, 'confirmed');
  assert.equal(receipt.continuation.predecessor_lab_id, 'origin-lab');
  assert.equal(receipt.continuation.predecessor_receipt_sha256, 'd'.repeat(64));
  assert.equal(receipt.steps[0].scope.target, 'src/work.test.js');
});

test('a continuation can finish exact correctness and paired acceptance in one command', async () => {
  const predecessor = sourceEditReceipt('origin-acceptance');
  const currentCoverage = coverage(
    { kind: 'add_representative_executable_flow' },
    { source_snapshot_sha256: '1'.repeat(64), dirty: true }
  );
  currentCoverage.flows = [continuationFlow()];
  let acceptanceInput = null;
  const receipt = await runAutonomousPerformanceLab(
    {
      repositoryRoot: process.cwd(),
      labId: 'accepted-lab',
      continueFrom: 'origin-acceptance',
      incumbentRepository: '/tmp/incumbent',
      correctnessScope: {
        adapter: 'node-test',
        target: 'src/work.test.js',
        name: 'does work',
      },
      warmups: 0,
    },
    {
      reportCoverage: async () => currentCoverage,
      supervise: async () => ({ state: 'succeeded' }),
      loadMeasurement: async (_root, runId) => ({
        result: {
          performance_capsule:
            runId === 'origin-acceptance-s1'
              ? performanceCapsule(100, '0'.repeat(64))
              : performanceCapsule(50, '1'.repeat(64)),
        },
      }),
      acceptContinuation: async (input) => {
        acceptanceInput = input;
        return {
          verdict: { status: 'accepted', reason: 'Correct and materially faster.' },
          change_cost: acceptedChangeCost(),
          correctness: {
            scope: input.correctnessScope,
            incumbent: { status: 'passed' },
            current: { status: 'passed' },
          },
          paired: {
            decisions: { shipping_recommended: true },
            verdict: { status: 'confirmed' },
          },
        };
      },
      store: memoryStore([], predecessor),
      now: clock(),
    }
  );

  assert.equal(receipt.state, 'completed');
  assert.equal(receipt.stop.kind, 'candidate_accepted');
  assert.equal(receipt.acceptance.verdict.status, 'accepted');
  assert.match(receipt.acceptance.paired_verification.evidence.sha256, /^[0-9a-f]{64}$/);
  assert.equal(acceptanceInput.baselineSubject.source_snapshot_sha256, '0'.repeat(64));
});

test('an incumbent-only continuation resolves correctness from the exact flow binding', async () => {
  const predecessor = sourceEditReceipt('origin-bound-flow');
  const currentCoverage = coverage(
    { kind: 'add_representative_executable_flow' },
    { source_snapshot_sha256: '1'.repeat(64), dirty: true }
  );
  currentCoverage.flows = [
    {
      ...continuationFlow(),
      correctness_binding: {
        scope: {
          adapter: 'node-test',
          target: 'src/work.test.js',
          name: 'does work',
        },
        manifest_sha256: 'f'.repeat(64),
      },
    },
  ];
  let acceptanceInput = null;
  const receipt = await runAutonomousPerformanceLab(
    {
      repositoryRoot: process.cwd(),
      labId: 'bound-accepted-lab',
      continueFrom: 'origin-bound-flow',
      incumbentRepository: '/tmp/incumbent',
      warmups: 0,
    },
    {
      reportCoverage: async () => currentCoverage,
      supervise: async () => ({ state: 'succeeded' }),
      loadMeasurement: async (_root, runId) => ({
        result: {
          performance_capsule:
            runId === 'origin-bound-flow-s1'
              ? performanceCapsule(100, '0'.repeat(64))
              : performanceCapsule(50, '1'.repeat(64)),
        },
      }),
      acceptContinuation: async (input) => {
        acceptanceInput = input;
        return {
          verdict: { status: 'accepted', reason: 'bound and faster' },
          change_cost: acceptedChangeCost(),
          correctness: {
            scope: input.correctnessScope,
            binding: input.correctnessBinding,
            incumbent: { status: 'passed' },
            current: { status: 'passed' },
          },
          paired: {
            decisions: { shipping_recommended: true },
            verdict: { status: 'confirmed' },
          },
        };
      },
      store: memoryStore([], predecessor),
      now: clock(),
    }
  );

  assert.equal(receipt.stop.kind, 'candidate_accepted');
  assert.equal(acceptanceInput.correctnessScope.name, 'does work');
  assert.deepEqual(acceptanceInput.correctnessBinding, {
    source: 'repository_manifest',
    manifest_sha256: 'f'.repeat(64),
  });
});

test('missing and conflicting flow correctness bindings stop before measurement', async () => {
  const predecessor = sourceEditReceipt('origin-binding-boundary');
  for (const [labId, flowBinding, correctnessScope, expected] of [
    ['missing-binding-lab', null, undefined, 'correctness_binding_required'],
    [
      'conflicting-binding-lab',
      {
        scope: {
          adapter: 'node-test',
          target: 'src/work.test.js',
          name: 'does work',
        },
        manifest_sha256: 'f'.repeat(64),
      },
      {
        adapter: 'node-test',
        target: 'src/work.test.js',
        name: 'different work',
      },
      'correctness_binding_conflict',
    ],
  ]) {
    const report = coverage(
      { kind: 'add_representative_executable_flow' },
      { source_snapshot_sha256: '1'.repeat(64), dirty: true }
    );
    report.flows = [{ ...continuationFlow(), correctness_binding: flowBinding }];
    let executions = 0;
    const receipt = await runAutonomousPerformanceLab(
      {
        repositoryRoot: process.cwd(),
        labId,
        continueFrom: 'origin-binding-boundary',
        incumbentRepository: '/tmp/incumbent',
        correctnessScope,
      },
      {
        reportCoverage: async () => report,
        supervise: async () => {
          executions += 1;
        },
        loadMeasurement: async () => ({
          result: { performance_capsule: performanceCapsule(100, '0'.repeat(64)) },
        }),
        store: memoryStore([], predecessor),
        now: clock(),
      }
    );
    assert.equal(receipt.stop.kind, expected);
    assert.equal(executions, 0);
  }
});

test('continuation fails closed for unchanged snapshots and unavailable exact flows', async () => {
  const predecessor = sourceEditReceipt('origin-boundary');
  for (const [labId, sourceSnapshot, flows, expected] of [
    ['unchanged-continuation', '0'.repeat(64), [continuationFlow()], 'source_edit_not_observed'],
    ['missing-flow-continuation', '1'.repeat(64), [], 'continuation_flow_unavailable'],
  ]) {
    let executions = 0;
    const report = coverage(
      { kind: 'add_representative_executable_flow' },
      { source_snapshot_sha256: sourceSnapshot }
    );
    report.flows = flows;
    const receipt = await runAutonomousPerformanceLab(
      { repositoryRoot: process.cwd(), labId, continueFrom: 'origin-boundary' },
      {
        reportCoverage: async () => report,
        supervise: async () => {
          executions += 1;
        },
        loadMeasurement: async () => ({
          result: { performance_capsule: performanceCapsule(100, '0'.repeat(64)) },
        }),
        store: memoryStore([], predecessor),
        now: clock(),
      }
    );
    assert.equal(receipt.stop.kind, expected);
    assert.equal(executions, 0);
  }
});

test('continuation distinguishes a regression from incompatible evidence', async () => {
  const predecessor = sourceEditReceipt('origin-screen');
  for (const [labId, currentCapsule, expected] of [
    ['regressed-continuation', performanceCapsule(150, '1'.repeat(64)), 'candidate_rejected'],
    [
      'incompatible-continuation',
      performanceCapsule(50, '1'.repeat(64), { workingDirectory: 'nested' }),
      'verification_no_confidence',
    ],
  ]) {
    const report = coverage(
      { kind: 'add_representative_executable_flow' },
      { source_snapshot_sha256: '1'.repeat(64) }
    );
    report.flows = [continuationFlow()];
    const receipt = await runAutonomousPerformanceLab(
      { repositoryRoot: process.cwd(), labId, continueFrom: 'origin-screen' },
      {
        reportCoverage: async () => report,
        supervise: async () => ({ state: 'succeeded' }),
        loadMeasurement: async (_root, runId) => ({
          result: {
            performance_capsule:
              runId === 'origin-screen-s1'
                ? performanceCapsule(100, '0'.repeat(64))
                : currentCapsule,
          },
        }),
        store: memoryStore([], predecessor),
        now: clock(),
      }
    );
    assert.equal(receipt.stop.kind, expected);
  }
});

test('lab contracts and filesystem store stay bounded', async (context) => {
  assert.equal(boundedPerformanceLabSteps(undefined), 8);
  assert.throws(() => boundedPerformanceLabSteps(9), /between 1 and 8/);
  assert.deepEqual(boundedPerformanceFindingExclusions(['b'.repeat(24), 'a'.repeat(24)]), [
    'a'.repeat(24),
    'b'.repeat(24),
  ]);
  assert.throws(
    () => boundedPerformanceFindingExclusions(['not-a-finding']),
    /canonical 24-character/
  );
  assert.throws(
    () => boundedPerformanceFindingExclusions(Array(9).fill('a'.repeat(24))),
    /at most 8/
  );
  assert.deepEqual(boundedPerformanceCandidateExclusions(['b'.repeat(24), 'a'.repeat(24)]), [
    'a'.repeat(24),
    'b'.repeat(24),
  ]);
  assert.throws(
    () => boundedPerformanceCandidateExclusions(['src/work.js']),
    /canonical 24-character/
  );
  assert.deepEqual(
    assertPerformanceLabCorrectnessScope({
      adapter: 'vitest',
      target: 'src/work.test.ts',
      name: 'does work',
    }),
    { adapter: 'vitest', target: 'src/work.test.ts', name: 'does work' }
  );
  assert.throws(
    () =>
      assertPerformanceLabCorrectnessScope({
        adapter: 'vitest',
        target: '../escape.test.ts',
        name: 'does work',
      }),
    /contained relative path/
  );
  const root = await mkdtemp(join(tmpdir(), 'codevetter-lab-store-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = await createPerformanceLabStore(root);
  await store.reserve('stored-lab');
  const receipt = terminalReceipt('stored-lab');
  await store.write(receipt);
  const evidence = await store.writeArtifact('stored-lab', 'paired-verification', {
    verdict: { status: 'confirmed' },
  });
  const stored = await store.read('stored-lab');
  assert.deepEqual(stored.receipt, receipt);
  assert.match(stored.sha256, /^[0-9a-f]{64}$/);
  assert.equal(evidence.path, '.codevetter/performance-labs/stored-lab/paired-verification.json');
  assert.match(evidence.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    JSON.parse(await readFile(join(root, '.codevetter/performance-labs/stored-lab/receipt.json'))),
    receipt
  );
  await assert.rejects(() => store.reserve('stored-lab'), /exist/);
});

test('domain performance filenames do not authorize autonomous screening', () => {
  const report = composePerformanceFlowCoverage({
    qualification: {
      status: 'needs_selection',
      subject: { repository_revision: 'a'.repeat(40), dirty: false },
      scan: { truncated: false },
      flows: [
        {
          id: 'finance-chart',
          adapter: 'jest',
          target: 'performance-chart-model.test.ts',
          name: 'All has no lower bound',
          score: 45,
          signals: [{ kind: 'performance_file_name', evidence: 'performance-chart-model.test.ts' }],
          safety_flags: [],
        },
      ],
    },
  });
  assert.equal(report.flows[0].screening_eligible, false);
  assert.equal(report.next_action.kind, 'add_representative_executable_flow');
});

test('coverage joins only exact correctness bindings and reports stale entries', () => {
  const exactFlow = {
    id: 'work-scale',
    adapter: 'vitest',
    target: 'src/work.performance.test.ts',
    name: 'scales with input size',
    package_scope: '.',
    score: 100,
    signals: [{ kind: 'performance_workload_name', evidence: 'scales with input size' }],
    safety_flags: [],
  };
  const correctness = {
    adapter: 'vitest',
    target: 'src/work.test.ts',
    name: 'preserves output',
  };
  const report = composePerformanceFlowCoverage({
    qualification: {
      status: 'ready',
      subject: { repository_revision: 'a'.repeat(40), dirty: false },
      scan: { truncated: false },
      flows: [exactFlow],
    },
    flowContract: {
      present: true,
      manifest_sha256: 'f'.repeat(64),
      bindings: [
        {
          performance: {
            adapter: exactFlow.adapter,
            target: exactFlow.target,
            name: exactFlow.name,
          },
          correctness,
          manifest_sha256: 'f'.repeat(64),
        },
        {
          performance: {
            adapter: 'vitest',
            target: 'src/stale.performance.test.ts',
            name: 'stale flow',
          },
          correctness,
          manifest_sha256: 'f'.repeat(64),
        },
      ],
    },
  });

  assert.deepEqual(report.flows[0].correctness_binding?.scope, correctness);
  assert.equal(report.summary.correctness_bound_flows, 1);
  assert.equal(report.summary.stale_correctness_bindings, 1);
  assert.match(report.limitations.join(' '), /match no discovered exact flow/);
});

test('an exhausted measured flow yields to the next safe unmeasured flow', () => {
  const subject = {
    repository_revision: 'a'.repeat(40),
    source_snapshot_sha256: '0'.repeat(64),
    dirty: false,
  };
  const declaration = (id, target) => ({
    id,
    adapter: 'go-bench',
    target,
    name: `Benchmark${id}`,
    package_scope: '.',
    score: 100,
    signals: [{ kind: 'explicit_go_benchmark', evidence: `Benchmark${id}` }],
    safety_flags: [],
  });
  const qualification = {
    status: 'needs_selection',
    subject,
    scan: { truncated: false },
    flows: [declaration('first', 'first_test.go'), declaration('second', 'second_test.go')],
  };
  const exhaustedMeasurement = {
    run_id: 'first-run',
    state: 'succeeded',
    subject,
    scope: {
      adapter: 'go-bench',
      target: 'first_test.go',
      name: 'Benchmarkfirst',
    },
    policy: { samples: 10 },
    completed_at: '2026-08-12T00:00:00.000Z',
    eligible_experiment_findings: 0,
    eligible_experiment_findings_total: 1,
    candidate_exclusions_exhausted: true,
  };

  const report = composePerformanceFlowCoverage({
    qualification,
    measurements: [exhaustedMeasurement],
  });
  assert.equal(report.flows[0].evidence_status, 'candidate_exhausted');
  assert.deepEqual(report.flows[0].measurement_run_ids, ['first-run']);
  assert.equal(report.summary.candidate_exhausted_flows, 1);
  assert.equal(report.next_action.kind, 'measure_unmeasured_flow');
  assert.equal(report.next_action.candidate_id, 'second');

  const terminal = composePerformanceFlowCoverage({
    qualification: { ...qualification, flows: [qualification.flows[0]] },
    measurements: [exhaustedMeasurement],
  });
  assert.equal(terminal.next_action.kind, 'candidate_exclusions_exhausted');
});

test('browser coverage keeps desktop and mobile project evidence separate', () => {
  const browserProfile = (projectName, deviceName) => ({
    project_name: projectName,
    device_name: deviceName,
    viewport: null,
    device_scale_factor: null,
    is_mobile: null,
    has_touch: null,
    provenance: 'static_playwright_device',
  });
  const declaration = (id, projectName, deviceName) => ({
    id,
    adapter: 'playwright',
    target: 'e2e/home.spec.ts',
    name: 'renders home',
    package_scope: '.',
    score: 0,
    signals: [{ kind: 'loopback_browser_base_url', evidence: 'http://127.0.0.1:4173' }],
    safety_flags: [],
    browser_profile: browserProfile(projectName, deviceName),
  });
  const report = composePerformanceFlowCoverage({
    qualification: {
      status: 'needs_selection',
      subject: { repository_revision: 'a'.repeat(40), dirty: false },
      scan: { truncated: false },
      flows: [
        declaration('desktop-flow', 'desktop', 'Desktop Chrome'),
        declaration('mobile-flow', 'mobile', 'iPhone 13'),
      ],
    },
    browserCaptures: [
      {
        capture_id: 'mobile-capture',
        state: 'succeeded',
        subject: { repository_revision: 'a'.repeat(40), dirty: false },
        scope: {
          adapter: 'playwright',
          target: 'e2e/home.spec.ts',
          name: 'renders home',
          browser_profile: {
            project_name: 'mobile',
            device_name: 'iPhone 13',
          },
        },
        policy: { server_identity: 'verified_by_declared_process' },
      },
    ],
  });

  assert.equal(report.flows.find((flow) => flow.id === 'desktop-flow').runtime_measured, false);
  assert.equal(report.flows.find((flow) => flow.id === 'mobile-flow').runtime_measured, true);
  assert.equal(report.next_action.scope.project, 'desktop');
});

test('coverage preserves the exact diagnosed failure when a later attempt also fails', () => {
  const declaration = {
    id: 'browser-flow',
    adapter: 'playwright',
    target: 'e2e/home.spec.ts',
    name: 'renders home',
    package_scope: '.',
    score: 0,
    signals: [{ kind: 'loopback_browser_base_url', evidence: 'http://127.0.0.1:4173' }],
    safety_flags: [],
  };
  const diagnosis = failedBrowserDiagnosis();
  const capture = (captureId, diagnosed) => ({
    capture_id: captureId,
    state: 'failed',
    subject: { repository_revision: 'a'.repeat(40), dirty: false },
    scope: {
      adapter: 'playwright',
      target: declaration.target,
      name: declaration.name,
      browser_profile: null,
    },
    policy: { server_identity: 'verified_by_declared_process' },
    server_attestation: { state: 'verified_by_declared_process' },
    result: diagnosed ? { path: 'result.json', sha256: 'b'.repeat(64), bytes: 1 } : null,
    diagnosis: diagnosed ? diagnosis : null,
  });
  const report = composePerformanceFlowCoverage({
    qualification: {
      status: 'needs_selection',
      subject: { repository_revision: 'a'.repeat(40), dirty: false },
      scan: { truncated: false },
      flows: [declaration],
    },
    browserCaptures: [capture('diagnosed-capture', true), capture('later-failure', false)],
  });

  assert.equal(report.flows[0].evidence_status, 'failure_diagnosed');
  assert.equal(report.flows[0].latest_browser_capture.capture_id, 'later-failure');
  assert.equal(report.flows[0].diagnosed_browser_capture.capture_id, 'diagnosed-capture');
  assert.equal(report.summary.browser_failure_diagnosed_flows, 1);
  assert.equal(report.next_action.kind, 'inspect_failed_browser_diagnosis');
  assert.equal(report.next_action.capture_id, 'diagnosed-capture');
  assert.deepEqual(report.next_action.next_probe, diagnosis.next_probe);
});

test('the lab inspects a durable failed-flow diagnosis without rerunning or authorizing edits', async () => {
  const diagnosis = failedBrowserDiagnosis();
  const report = coverage({
    kind: 'inspect_failed_browser_diagnosis',
    candidate_id: 'browser-flow',
    capture_id: 'failed-capture',
    scope: {
      adapter: 'playwright',
      target: 'e2e/home.spec.ts',
      name: 'renders home',
    },
    next_probe: diagnosis.next_probe,
  });
  report.flows = [
    {
      id: 'browser-flow',
      safe_to_execute: true,
      diagnosed_browser_capture: { capture_id: 'failed-capture', diagnosis },
    },
  ];
  let loads = 0;
  const receipt = await runAutonomousPerformanceLab(
    { repositoryRoot: process.cwd(), labId: 'failed-diagnosis-lab' },
    {
      reportCoverage: async () => report,
      loadBrowserDiagnosis: async (_root, capture) => {
        loads += 1;
        assert.equal(capture.capture_id, 'failed-capture');
        return { assertion: 'failed' };
      },
      supervise: async () => assert.fail('measurement must not run'),
      captureBrowser: async () => assert.fail('browser capture must not rerun'),
      store: memoryStore(),
      now: clock(),
    }
  );

  assert.equal(loads, 1);
  assert.equal(receipt.state, 'stopped');
  assert.equal(receipt.stop.kind, 'failed_flow_diagnosed');
  assert.equal(receipt.stop.capture_id, 'failed-capture');
  assert.equal(receipt.steps[0].action, 'inspect_failed_browser_diagnosis');
  assert.equal(receipt.steps[0].result, 'failure_diagnosed');
  assert.equal(receipt.steps[0].diagnosis.next_probe.edit_eligible, false);
  assert.match(receipt.limitations.at(-1), /cannot authorize an optimization/i);
});

function coverage(nextAction, subject = {}) {
  const summary = {
    discovered_flows: 1,
    profile_capable_flows: 1,
    measured_profile_flows: 0,
    measurement_ready_flows: 1,
    measured_measurement_ready_flows: 0,
    screening_eligible_flows: 0,
    screened_existing_flows: 0,
    browser_capture_eligible_flows: 0,
    browser_traced_flows: 0,
    browser_failure_diagnosed_flows: 0,
    browser_capture_failures: 0,
    candidate_ready_flows: 0,
    candidate_exhausted_flows: 0,
    discovery_truncated: false,
  };
  return {
    subject: {
      repository_revision: 'a'.repeat(40),
      source_snapshot_sha256: '0'.repeat(64),
      dirty: false,
      ...subject,
    },
    summary,
    flows: [{ id: nextAction.candidate_id ?? 'flow-1', safe_to_execute: true }],
    next_action: { scope: scope(), ...nextAction },
  };
}

function failedBrowserDiagnosis() {
  return {
    verdict: 'findings',
    finding_count: 1,
    finding_ids: ['c'.repeat(24)],
    eligible_experiment_findings: 0,
    page_load: null,
    main_thread: null,
    memory: null,
    react: null,
    loading: null,
    actions: null,
    server: null,
    next_probe: {
      classification: 'off_main_thread_or_background_cpu',
      probe: 'capture_worker_or_background_cpu',
      confidence: 'low',
      edit_eligible: false,
      required_observation: 'Capture the next supported observation.',
      evidence_ids: ['server-process-cpu'],
      failed_flow_requires_correctness: true,
    },
  };
}

function scope() {
  return { adapter: 'node-test', target: 'src/work.test.js', name: 'does work' };
}

function distribution(min, median, max) {
  return { count: 3, min, median, max, spread_percent: 0 };
}

function sequence(first, middle, last) {
  const values = [first, middle, last];
  return {
    count: 3,
    first,
    last,
    min: Math.min(...values),
    max: Math.max(...values),
    delta: last - first,
    delta_percent: first === 0 ? null : ((last - first) / first) * 100,
    monotonically_non_decreasing: values.every(
      (value, index) => index === 0 || value >= values[index - 1]
    ),
  };
}

function finding() {
  return {
    id: 'b'.repeat(24),
    kind: 'application_cpu_hotspot',
    source: { file: 'src/work.js', line: 12, function: 'work', provenance: 'cpu_profile' },
    observed: { cpu_sample_share: 0.4 },
    inference: { summary: 'work is the leading local CPU candidate.' },
    unverified: ['A faster equivalent is not yet proven.'],
    expected_effect: { metric: 'cpu_share', direction: 'decrease', scope: 'same flow' },
    verification: {
      required_observation: 'CPU share falls and correctness passes.',
      rejection_condition: 'Reject on regression or failed correctness.',
    },
    eligible_for_experiment: true,
  };
}

function memoryStore(writes = [], predecessor = null) {
  return {
    async read() {
      if (!predecessor) throw new Error('missing predecessor');
      return { receipt: structuredClone(predecessor), sha256: 'd'.repeat(64) };
    },
    async reserve() {},
    async write(value) {
      writes.push(structuredClone(value));
    },
    async writeArtifact(_labId, _name, value) {
      const serialized = `${JSON.stringify(value)}\n`;
      return {
        path: '.codevetter/performance-labs/accepted-lab/paired-verification.json',
        sha256: 'e'.repeat(64),
        bytes: Buffer.byteLength(serialized),
      };
    },
  };
}

function continuationFlow() {
  return {
    id: 'flow-1',
    adapter: 'node-test',
    target: 'src/work.test.js',
    name: 'does work',
    profile_capable: true,
    safe_to_execute: true,
    direct_measurement: true,
    screening_eligible: false,
  };
}

function sourceEditReceipt(labId) {
  const receipt = terminalReceipt(labId);
  receipt.state = 'stopped';
  receipt.subject = {
    repository_revision: 'a'.repeat(40),
    source_snapshot_sha256: '0'.repeat(64),
    dirty: true,
  };
  receipt.stop = {
    kind: 'source_edit_required',
    reason: 'candidate',
    next_action_kind: 'inspect_profile_candidate',
    run_id: `${labId}-s1`,
    candidate: finding(),
  };
  return assertPerformanceLabReceipt(receipt);
}

function performanceCapsule(median, sourceSnapshotSha256, { workingDirectory = '.' } = {}) {
  return {
    schema_version: 'runtime-performance-capsule/v1',
    subject: {
      repository_revision: 'a'.repeat(40),
      source_snapshot_sha256: sourceSnapshotSha256,
      dirty: true,
    },
    adapter: {
      kind: 'node-test',
      executable_identity: 'local:node',
      arguments: [],
      working_directory: workingDirectory,
    },
    scope: { target: 'src/work.test.js', name: 'does work' },
    sample_policy: { samples: 10, warmups: 0 },
    observed: {
      executions: Array.from({ length: 10 }, () => ({ wall_time_ms: median })),
      wall_time_ms: {
        count: 10,
        min: median,
        median,
        p95: median,
        max: median,
        spread_percent: 0,
      },
      hotspots: [],
      go_benchmarks: [],
      vitest_tests: [],
      vitest_execution_share: null,
      console_metrics: [],
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

function clock() {
  let tick = 0;
  return () => `2026-08-12T00:00:0${tick++}.000Z`;
}

function acceptedChangeCost() {
  return {
    observed: {
      complete: true,
      files_changed: 1,
      changed_files: ['src/work.js'],
      lines_added: 4,
      lines_removed: 2,
      gross_lines_changed: 6,
      net_lines_changed: 2,
      untracked_files: [],
      binary_files: [],
      production_dependencies_added: [],
    },
    policy: {
      max_files_changed: 3,
      max_lines_added: 160,
      max_gross_lines_changed: 200,
      max_production_dependencies_added: 0,
    },
    violations: [],
    outside_boundary_files: [],
  };
}

function terminalReceipt(labId) {
  return assertPerformanceLabReceipt({
    schema_version: PERFORMANCE_LAB_SCHEMA_VERSION,
    lab_id: labId,
    state: 'completed',
    subject: { repository_revision: 'a'.repeat(40), dirty: false },
    policy: {
      max_steps: 1,
      samples: 10,
      warmups: 0,
      timeout_ms: 1_000,
      excluded_finding_ids: [],
      excluded_candidate_keys: [],
    },
    lifecycle: {
      started_at: '2026-08-12T00:00:00.000Z',
      completed_at: '2026-08-12T00:00:01.000Z',
    },
    initial_summary: null,
    final_summary: null,
    steps: [],
    continuation: null,
    screening: null,
    acceptance: null,
    stop: { kind: 'safe_actions_exhausted', reason: 'done', next_action_kind: 'none' },
    limitations: [],
  });
}
