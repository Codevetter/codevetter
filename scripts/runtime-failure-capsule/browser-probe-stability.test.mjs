import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BROWSER_PROBE_STABILITY_SCHEMA_VERSION,
  assessDurableBrowserProbeStability,
  assertBrowserProbeStability,
  createBrowserProbeStabilityAssessment,
  loadDurableProbeRun,
  selectCompatibleLinkedNextProbe,
} from './browser-probe-stability.mjs';

const SNAPSHOT = 'a'.repeat(64);
const CURRENT = { repository_revision: 'fixture-revision', source_snapshot_sha256: SNAPSHOT };

test('requires three unanimous compatible routes before following a probe', () => {
  const two = createBrowserProbeStabilityAssessment(
    [run('run-a'), run('run-b', { ratio: 0.22 })],
    CURRENT
  );
  assert.equal(two.state, 'insufficient_repetitions');
  assert.equal(two.decision.follow_up_eligible, false);
  assert.equal(two.decision.next_action, 'capture_one_more_compatible_probe_repetition');

  const three = createBrowserProbeStabilityAssessment(
    [run('run-a'), run('run-b', { ratio: 0.22 }), run('run-c', { ratio: 0.21 })],
    CURRENT
  );
  assert.equal(three.schema_version, BROWSER_PROBE_STABILITY_SCHEMA_VERSION);
  assert.equal(three.state, 'stable');
  assert.equal(three.decision.stable, true);
  assert.equal(three.decision.follow_up_eligible, true);
  assert.equal(three.decision.next_probe, 'inspect_main_thread_runtime');
  assert.deepEqual(three.cpu_ratio, {
    threshold: 0.2,
    minimum: 0.21,
    maximum: 0.22,
    range: 0.01,
  });
});

test('one contradictory route makes the assessment unstable without majority voting', () => {
  const assessment = createBrowserProbeStabilityAssessment(
    [
      run('run-a', { ratio: 0.2077 }),
      run('run-b', {
        ratio: 0.1946,
        classification: 'mixed_evidence',
        nextProbe: 'capture_narrower_precommit_evidence',
      }),
      run('run-c', { ratio: 0.22 }),
    ],
    CURRENT
  );
  assert.equal(assessment.state, 'unstable');
  assert.equal(assessment.routes.length, 2);
  assert.equal(assessment.routes[0].count, 2);
  assert.equal(assessment.decision.next_probe, null);
  assert.equal(assessment.decision.follow_up_eligible, false);
  assert.equal(assessment.decision.next_action, 'stabilize_measurement_before_following_probe');
});

test('compares narrowed main-thread runtime mechanism routes', () => {
  const runtimeOverrides = {
    sourceProbe: 'inspect_main_thread_runtime',
    presentationProfile: 'runtime_mechanisms',
    classification: 'runtime_filesystem',
    nextProbe: 'inspect_filesystem_runtime',
  };
  const stable = createBrowserProbeStabilityAssessment(
    [
      run('runtime-a', runtimeOverrides),
      run('runtime-b', runtimeOverrides),
      run('runtime-c', runtimeOverrides),
    ],
    CURRENT
  );
  assert.equal(stable.state, 'stable');
  assert.equal(stable.decision.next_probe, 'inspect_filesystem_runtime');
  assert.equal(stable.authority.edit_eligible, false);

  const unstable = createBrowserProbeStabilityAssessment(
    [
      run('runtime-a', runtimeOverrides),
      run('runtime-b', {
        ...runtimeOverrides,
        classification: 'runtime_http_streams',
        nextProbe: 'inspect_http_stream_runtime',
      }),
    ],
    CURRENT
  );
  assert.equal(unstable.state, 'unstable');
  assert.equal(unstable.decision.next_probe, null);
});

test('compares profiler-disabled corroboration routes without edit authority', () => {
  const low = {
    sourceProbe: 'repeat_with_lower_overhead_cpu_measurement',
    presentationProfile: 'profiler_disabled_runtime',
    classification: 'low_overhead_gc',
    nextProbe: 'inspect_gc_pressure',
  };
  const stable = createBrowserProbeStabilityAssessment(
    [run('low-a', low), run('low-b', low), run('low-c', low)],
    CURRENT
  );
  assert.equal(stable.state, 'stable');
  assert.equal(stable.decision.next_probe, 'inspect_gc_pressure');
  assert.equal(stable.authority.edit_eligible, false);

  const unresolved = createBrowserProbeStabilityAssessment(
    [
      run('low-a', low),
      run('low-b', { ...low, classification: 'low_overhead_unresolved', nextProbe: null }),
    ],
    CURRENT
  );
  assert.equal(unresolved.state, 'unstable');
  assert.equal(unresolved.decision.next_probe, null);
});

test('three GC pressure runs terminate with a stable sampled source diagnosis', () => {
  const source = gcSource('src/allocate.ts', 10, 'allocateRows');
  const overrides = {
    sourceProbe: 'inspect_gc_pressure',
    presentationProfile: 'gc_pressure_runtime',
    classification: 'gc_allocation_repository',
    nextProbe: null,
    leadingSource: source,
    upstreamRecapture: gcUpstream(),
  };
  const two = createBrowserProbeStabilityAssessment(
    [run('gc-a', overrides), run('gc-b', overrides)],
    CURRENT
  );
  assert.equal(two.state, 'insufficient_repetitions');
  assert.equal(two.decision.source_inspection_eligible, false);

  const three = createBrowserProbeStabilityAssessment(
    [run('gc-a', overrides), run('gc-b', overrides), run('gc-c', overrides)],
    CURRENT
  );
  assert.equal(three.state, 'diagnosis_stable');
  assert.equal(three.decision.stable, true);
  assert.equal(three.decision.diagnosis_stable, true);
  assert.equal(three.decision.follow_up_eligible, false);
  assert.equal(three.decision.source_inspection_eligible, true);
  assert.deepEqual(three.decision.leading_source, source);
  assert.equal(three.decision.next_probe, null);
  assert.equal(three.authority.edit_eligible, false);

  const disagreement = createBrowserProbeStabilityAssessment(
    [
      run('gc-a', overrides),
      run('gc-b', {
        ...overrides,
        leadingSource: gcSource('src/other.ts', 20, 'allocateOther'),
      }),
    ],
    CURRENT
  );
  assert.equal(disagreement.state, 'unstable');
  assert.equal(disagreement.decision.source_inspection_eligible, false);
});

test('continuous source diagnosis requires three matching repository locations', () => {
  const source = continuousSource('src/hot.ts', 22, 'hotPath');
  const overrides = {
    sourceProbe: 'inspect_continuous_main_thread_source',
    presentationProfile: 'continuous_source_runtime',
    classification: 'continuous_source_observed',
    nextProbe: null,
    leadingSource: source,
    upstreamRecapture: continuousUpstream(),
  };
  const two = createBrowserProbeStabilityAssessment(
    [run('source-a', overrides), run('source-b', overrides)],
    CURRENT
  );
  assert.equal(two.state, 'insufficient_repetitions');

  const three = createBrowserProbeStabilityAssessment(
    [run('source-a', overrides), run('source-b', overrides), run('source-c', overrides)],
    CURRENT
  );
  assert.equal(three.state, 'diagnosis_stable');
  assert.equal(three.decision.source_inspection_eligible, true);
  assert.deepEqual(three.decision.leading_source, source);
  assert.equal(
    three.decision.next_action,
    'inspect_stable_sampled_cpu_source_before_candidate_edit'
  );
  assert.equal(three.authority.edit_eligible, false);

  const mismatch = createBrowserProbeStabilityAssessment(
    [
      run('source-a', overrides),
      run('source-b', {
        ...overrides,
        leadingSource: continuousSource('src/other.ts', 22, 'hotPath'),
      }),
    ],
    CURRENT
  );
  assert.equal(mismatch.state, 'unstable');
});

test('stable routing cannot bypass failed correctness', () => {
  const assessment = createBrowserProbeStabilityAssessment(
    [run('run-a'), run('run-b'), run('run-c', { correctness: 'failed' })],
    CURRENT
  );
  assert.equal(assessment.state, 'stable');
  assert.equal(assessment.decision.follow_up_eligible, false);
  assert.equal(assessment.decision.next_action, 'repair_or_replace_failed_correctness_flow');
  assert.equal(assessment.authority.edit_eligible, false);
});

test('current source drift makes compatible repeated evidence stale', () => {
  const assessment = createBrowserProbeStabilityAssessment([run('run-a'), run('run-b')], {
    ...CURRENT,
    source_snapshot_sha256: 'b'.repeat(64),
  });
  assert.equal(assessment.state, 'stale');
  assert.equal(assessment.subject.current, false);
  assert.equal(assessment.decision.follow_up_eligible, false);
});

test('incompatible flow, probe, profile, and runtime fail closed', () => {
  const mutations = [
    { scope: { target: 'tests/other.spec.ts', name: 'browser flow', project: 'chromium' } },
    { sourceProbe: 'other-probe' },
    { presentationProfile: 'ordinary' },
    { runtimeFamily: 'vite' },
  ];
  for (const mutation of mutations) {
    assert.throws(
      () => createBrowserProbeStabilityAssessment([run('run-a'), run('run-b', mutation)], CURRENT),
      /not exactly compatible/
    );
  }
  assert.throws(
    () =>
      createBrowserProbeStabilityAssessment(
        [
          run('run-a', { evidenceOutcome: 'evidence_incomplete' }),
          run('run-b', { evidenceOutcome: 'evidence_incomplete' }),
        ],
        CURRENT
      ),
    /requires completed evidence/
  );
});

test('closed result contract rejects extra fields and inconsistent authority', () => {
  const assessment = createBrowserProbeStabilityAssessment(
    [run('run-a'), run('run-b'), run('run-c')],
    CURRENT
  );
  const mutations = [
    (value) => (value.private = true),
    (value) => (value.source_capture.private = true),
    (value) => (value.runs[0].policy.command = 'curl production'),
    (value) => (value.runs[1].recapture_id = 'run-a'),
    (value) => (value.decision.follow_up_eligible = false),
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(assessment);
    mutate(invalid);
    assert.throws(() => assertBrowserProbeStability(invalid), /invalid|inconsistent/);
  }
});

test('durable loader rejects symlinked and integrity-mismatched receipts', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-probe-stability-'));
  context.after(() => rm(root, { recursive: true, force: true }));

  const symlinkDirectory = join(root, '.codevetter/browser-probe-runs/symlink-run');
  await mkdir(symlinkDirectory, { recursive: true });
  const target = join(root, 'probe-target.json');
  await writeFile(target, '{}\n');
  await symlink(target, join(symlinkDirectory, 'receipt.json'));
  await assert.rejects(() => loadDurableProbeRun(root, 'symlink-run'), /unsafe/);

  const probeDirectory = join(root, '.codevetter/browser-probe-runs/tampered-run');
  const captureDirectory = join(root, '.codevetter/playwright-runs/tampered-run');
  await mkdir(probeDirectory, { recursive: true });
  await mkdir(captureDirectory, { recursive: true });
  await writeFile(
    join(probeDirectory, 'receipt.json'),
    `${JSON.stringify(recaptureReceipt('tampered-run'))}\n`
  );
  await writeFile(join(captureDirectory, 'receipt.json'), '{"tampered":true}\n');
  await assert.rejects(() => loadDurableProbeRun(root, 'tampered-run'), /integrity check failed/);
});

test('self-routed evidence ignores an unrelated flow-level next probe', () => {
  const unrelated = { probe: 'inspect_main_thread_runtime', server_request_ordinal: 2 };
  assert.equal(
    selectCompatibleLinkedNextProbe('repeat_with_lower_overhead_cpu_measurement', unrelated, 1),
    null
  );
  assert.equal(
    selectCompatibleLinkedNextProbe('inspect_main_thread_runtime', unrelated, 2),
    unrelated
  );
  assert.throws(
    () => selectCompatibleLinkedNextProbe('complete_async_and_framework_inventories', unrelated, 1),
    /different request/
  );
});

test('assessment input is bounded, unique, and invokes only the durable loader', async () => {
  let loads = 0;
  const result = await assessDurableBrowserProbeStability(
    process.cwd(),
    { recapture_ids: ['run-a', 'run-b'] },
    {
      loadRun: async (_root, id) => {
        loads += 1;
        return run(id);
      },
      inspectCurrent: async () => CURRENT,
    }
  );
  assert.equal(loads, 2);
  assert.equal(result.state, 'insufficient_repetitions');
  for (const ids of [
    ['run-a'],
    ['run-a', 'run-a'],
    ['run-a', 'run-b', 'run-c', 'run-d', 'run-e', 'run-f'],
    ['../run-a', 'run-b'],
  ]) {
    await assert.rejects(
      () =>
        assessDurableBrowserProbeStability(
          process.cwd(),
          { recapture_ids: ids },
          { loadRun: async () => run('run-a'), inspectCurrent: async () => CURRENT }
        ),
      /two to five unique|lowercase/
    );
  }
});

function run(id, overrides = {}) {
  const sourceProbe = overrides.sourceProbe ?? 'complete_async_and_framework_inventories';
  return {
    recapture_id: id,
    capture_id: `${id}-capture`,
    subject: { repository_revision: 'fixture-revision', source_snapshot_sha256: SNAPSHOT },
    source_capture: {
      capture_id: 'source-capture',
      receipt_sha256: 'c'.repeat(64),
      probe: sourceProbe,
      server_request_ordinal: 1,
      method: 'GET',
      route: '/',
    },
    upstream_recapture: overrides.upstreamRecapture ?? null,
    scope: overrides.scope ?? {
      target: 'tests/browser.spec.ts',
      name: 'browser flow',
      project: 'chromium',
    },
    policy: {
      presentation_profile: overrides.presentationProfile ?? 'expanded_async_framework',
      remote_http_denied: true,
    },
    runtime: {
      family: overrides.runtimeFamily ?? 'next',
      configuration: 'codevetter_config_disabled',
      cleanup: 'terminated',
    },
    evidence_outcome: overrides.evidenceOutcome ?? 'evidence_completed',
    correctness: overrides.correctness ?? 'passed',
    route: {
      classification: overrides.classification ?? 'main_thread_runtime',
      next_probe: Object.hasOwn(overrides, 'nextProbe')
        ? overrides.nextProbe
        : 'inspect_main_thread_runtime',
      leading_source: overrides.leadingSource ?? null,
    },
    preparation_wall_ms: 1_000,
    preparation_process_cpu_ms: 210,
    preparation_cpu_to_wall_ratio: overrides.ratio ?? 0.21,
  };
}

function gcSource(file, line, functionName) {
  return {
    file,
    line,
    function: functionName,
    provenance: 'request_scoped_v8_sampling_heap_profile',
  };
}

function gcUpstream() {
  return {
    recapture_id: 'lower-source',
    receipt_sha256: 'e'.repeat(64),
    source_probe: 'repeat_with_lower_overhead_cpu_measurement',
    classification: 'low_overhead_gc',
    next_probe: 'inspect_gc_pressure',
    server_request_ordinal: 1,
    correctness: 'passed',
  };
}

function continuousSource(file, line, functionName) {
  return { file, line, function: functionName, provenance: 'continuous_node_cpu_sample' };
}

function continuousUpstream() {
  return {
    recapture_id: 'lower-unresolved',
    receipt_sha256: 'f'.repeat(64),
    source_probe: 'repeat_with_lower_overhead_cpu_measurement',
    classification: 'low_overhead_unresolved',
    next_probe: 'inspect_continuous_main_thread_source',
    server_request_ordinal: 1,
    correctness: 'passed',
  };
}

function recaptureReceipt(id) {
  return {
    schema_version: 'runtime-browser-probe-recapture/v1',
    recapture_id: id,
    state: 'completed',
    subject: { ...CURRENT, current: true },
    source_capture: {
      capture_id: 'source-capture',
      receipt_sha256: 'c'.repeat(64),
      probe: 'complete_async_and_framework_inventories',
      server_request_ordinal: 1,
      method: 'GET',
      route: '/',
    },
    scope: { target: 'tests/browser.spec.ts', name: 'browser flow', project: 'chromium' },
    policy: {
      timeout_ms: 10_000,
      presentation_profile: 'expanded_async_framework',
      remote_http_denied: true,
    },
    new_capture: {
      capture_id: id,
      state: 'succeeded',
      receipt_path: `.codevetter/playwright-runs/${id}/receipt.json`,
      receipt_sha256: 'b'.repeat(64),
      result_path: `.codevetter/playwright-runs/${id}/result.json`,
      result_sha256: 'd'.repeat(64),
    },
    evidence: {
      outcome: 'evidence_completed',
      correctness: 'passed',
      server_request_ordinal: 1,
      async_inventory: { total: 1, retained: 1, complete: true },
      framework_inventory: { total: 1, retained: 1, complete: true },
    },
    runtime: {
      state: 'owned_attested',
      ownership: 'owned',
      family: 'next',
      configuration: 'codevetter_config_disabled',
      cleanup: 'terminated',
    },
    authority: {
      confidence: 'low',
      source_causal: false,
      edit_eligible: false,
      correctness_required: true,
    },
    failure: null,
    provenance: 'durable_browser_probe_owned_local_recapture',
    limitations: [],
  };
}
