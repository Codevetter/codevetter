import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { inspectDurableBrowserProbe } from './browser-probe-inspection.mjs';
import { recaptureDurableBrowserProbe } from './browser-probe-recapture.mjs';
import {
  assertBrowserProbeStability,
  createBrowserProbeStabilityAssessment,
  loadDurableProbeRun,
} from './browser-probe-stability.mjs';
import { boundedTimeout, repositoryRelative } from './contracts.mjs';
import { ensureCodeVetterEvidenceRoot } from './evidence-root.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import {
  PLAYWRIGHT_CAPTURE_LIMITS,
  assertPlaywrightCaptureId,
} from './playwright-capture-contracts.mjs';

export const BROWSER_PROBE_STABILITY_SCHEDULE_SCHEMA_VERSION =
  'runtime-browser-probe-stability-schedule/v2';
export const BROWSER_PROBE_STABILITY_SCHEDULE_LEGACY_SCHEMA_VERSION =
  'runtime-browser-probe-stability-schedule/v1';
export const BROWSER_PROBE_STABILITY_SCHEDULE_LIMITS = Object.freeze({
  totalObservations: 3,
  newRuns: 3,
  receiptBytes: 128 * 1024,
  scheduleIdCharacters: 77,
});

const SCHEDULE_DIRECTORY = '.codevetter/browser-probe-stability-schedules';
const PROBE_RUN_DIRECTORY = '.codevetter/browser-probe-runs';
const SUPPORTED_PROBES = new Set([
  'complete_async_and_framework_inventories',
  'inspect_main_thread_runtime',
  'repeat_with_lower_overhead_cpu_measurement',
  'inspect_gc_pressure',
  'inspect_continuous_main_thread_source',
]);
let temporarySequence = 0;

export async function stabilizeDurableBrowserProbe(
  repositoryRoot,
  input,
  {
    inspectProbe = inspectDurableBrowserProbe,
    loadRun = loadDurableProbeRun,
    recapture = recaptureDurableBrowserProbe,
    inspectCurrent = inspectGitDiff,
    digestProbeReceipt = digestDurableProbeReceipt,
  } = {}
) {
  const root = await realpath(resolve(repositoryRoot));
  const request = assertScheduleInput(input);
  const inspection = await inspectProbe(root, {
    capture_id: request.capture_id,
    probe: request.probe,
    ...(request.source_recapture_id ? { source_recapture_id: request.source_recapture_id } : {}),
  });
  const sourceReceiptSha256 = await digestContainedFile(
    root,
    `.codevetter/playwright-runs/${request.capture_id}/receipt.json`,
    PLAYWRIGHT_CAPTURE_LIMITS.receiptBytes,
    'browser schedule source receipt'
  );
  const current = await inspectCurrent(root);
  const base = scheduleBase(request, inspection, sourceReceiptSha256);
  const existingSchedule = await reuseExistingSchedule(
    root,
    request,
    base,
    current,
    digestProbeReceipt
  );
  if (existingSchedule) return existingSchedule;
  const store = await reserveSchedule(root, request.schedule_id);

  if (!inspectionCurrent(inspection, current)) {
    return persistTerminal(store, root, {
      ...base,
      state: 'stale',
      subject: { ...base.subject, current: false },
      budget: budgetSummary(request, {
        executed: 0,
        observations: 0,
        reused: 0,
      }),
      runs: [],
      assessment: null,
      terminal_reason: 'source_snapshot_not_current',
    });
  }

  if (inspection.state === 'correctness_blocked') {
    return persistTerminal(store, root, {
      ...base,
      state: 'correctness_failed',
      budget: budgetSummary(request, {
        executed: 0,
        observations: 0,
        reused: 0,
      }),
      runs: [],
      assessment: null,
      terminal_reason: 'included_exact_flow_failed',
    });
  }

  const runs = [];
  const references = [];
  for (const recaptureId of request.existing_recapture_ids) {
    const run = await loadRun(root, recaptureId);
    assertRunMatchesInspection(run, inspection, sourceReceiptSha256);
    runs.push(run);
    references.push(await runReference(root, run, 'reused', digestProbeReceipt));
  }
  assertExactlyCompatible(runs);

  const admittedNewRuns = Math.min(
    request.max_new_runs,
    BROWSER_PROBE_STABILITY_SCHEDULE_LIMITS.totalObservations - runs.length
  );
  let executed = 0;

  while (true) {
    const decision = terminalDecision(runs, current);
    if (decision) {
      return finalizeSchedule({
        store,
        root,
        base,
        request,
        runs,
        references,
        executed,
        admittedNewRuns,
        decision,
        inspectProbe,
        inspectCurrent,
      });
    }
    if (executed >= admittedNewRuns) {
      return finalizeSchedule({
        store,
        root,
        base,
        request,
        runs,
        references,
        executed,
        admittedNewRuns,
        decision: {
          state: 'budget_exhausted',
          assessment: assessmentOrNull(runs, current),
          terminal_reason: 'admitted_local_run_budget_consumed',
        },
        inspectProbe,
        inspectCurrent,
      });
    }

    const recaptureId = `${request.schedule_id}-r${runs.length + 1}`;
    executed += 1;
    let receipt;
    try {
      receipt = await recapture(root, {
        capture_id: request.capture_id,
        probe: request.probe,
        ...(request.source_recapture_id
          ? { source_recapture_id: request.source_recapture_id }
          : {}),
        recapture_id: recaptureId,
        timeout_ms: request.timeout_ms,
      });
    } catch {
      return finalizeSchedule({
        store,
        root,
        base,
        request,
        runs,
        references,
        executed,
        admittedNewRuns,
        decision: {
          state: 'operational_failure',
          assessment: assessmentOrNull(runs, current),
          terminal_reason: 'local_recapture_threw',
        },
        inspectProbe,
        inspectCurrent,
      });
    }
    const outcome = recaptureOutcome(receipt);
    if (outcome) {
      references.push(await receiptReference(root, receipt, 'executed', digestProbeReceipt));
      return finalizeSchedule({
        store,
        root,
        base,
        request,
        runs,
        references,
        executed,
        admittedNewRuns,
        decision: outcome,
        inspectProbe,
        inspectCurrent,
      });
    }
    try {
      const run = await loadRun(root, recaptureId);
      assertRunMatchesInspection(run, inspection, sourceReceiptSha256);
      assertExactlyCompatible([...runs, run]);
      runs.push(run);
      references.push(await runReference(root, run, 'executed', digestProbeReceipt));
    } catch {
      return finalizeSchedule({
        store,
        root,
        base,
        request,
        runs,
        references,
        executed,
        admittedNewRuns,
        decision: {
          state: 'operational_failure',
          assessment: assessmentOrNull(runs, current),
          terminal_reason: 'local_recapture_integrity_failed',
        },
        inspectProbe,
        inspectCurrent,
      });
    }
  }
}

function assertScheduleInput(input) {
  if (
    !closedInput(
      input,
      ['capture_id', 'probe', 'schedule_id'],
      ['source_recapture_id', 'existing_recapture_ids', 'max_new_runs', 'timeout_ms']
    )
  ) {
    throw new Error('browser probe stability schedule input is invalid');
  }
  const captureId = assertPlaywrightCaptureId(input.capture_id);
  if (!SUPPORTED_PROBES.has(input.probe)) {
    throw new Error('browser probe stability schedule does not support the requested probe');
  }
  const scheduleId = assertScheduleId(input.schedule_id);
  const sourceRecaptureId =
    input.source_recapture_id === undefined
      ? null
      : assertPlaywrightCaptureId(input.source_recapture_id);
  const chainedProbe = ['inspect_gc_pressure', 'inspect_continuous_main_thread_source'].includes(
    input.probe
  );
  if (chainedProbe !== (sourceRecaptureId !== null)) {
    throw new Error('chained diagnostic schedule requires exactly one upstream recapture identity');
  }
  const existing = input.existing_recapture_ids ?? [];
  if (
    !Array.isArray(existing) ||
    existing.length > BROWSER_PROBE_STABILITY_SCHEDULE_LIMITS.totalObservations ||
    new Set(existing).size !== existing.length
  ) {
    throw new Error('browser probe stability schedule accepts zero to three unique recapture IDs');
  }
  const existingIds = existing.map(assertPlaywrightCaptureId);
  if (existingIds.some((id) => id === captureId || id.startsWith(`${scheduleId}-r`))) {
    throw new Error('browser probe stability schedule recapture identities conflict');
  }
  const maximumNewRuns = input.max_new_runs ?? BROWSER_PROBE_STABILITY_SCHEDULE_LIMITS.newRuns;
  if (!Number.isSafeInteger(maximumNewRuns) || maximumNewRuns < 0 || maximumNewRuns > 3) {
    throw new Error('browser probe stability schedule max_new_runs must be between zero and three');
  }
  return {
    capture_id: captureId,
    probe: input.probe,
    source_recapture_id: sourceRecaptureId,
    schedule_id: scheduleId,
    existing_recapture_ids: existingIds,
    max_new_runs: maximumNewRuns,
    timeout_ms: boundedTimeout(input.timeout_ms),
  };
}

function assertScheduleId(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > BROWSER_PROBE_STABILITY_SCHEDULE_LIMITS.scheduleIdCharacters ||
    !/^[a-z0-9][a-z0-9-]*$/.test(value)
  ) {
    throw new Error('browser probe stability schedule ID must use bounded lowercase identity');
  }
  return value;
}

function scheduleBase(request, inspection, sourceReceiptSha256) {
  return {
    schema_version: BROWSER_PROBE_STABILITY_SCHEDULE_SCHEMA_VERSION,
    schedule_id: request.schedule_id,
    subject: {
      repository_revision: inspection.subject.repository_revision,
      source_snapshot_sha256: inspection.subject.source_snapshot_sha256,
      current: inspection.subject.current,
    },
    source_capture: {
      capture_id: inspection.capture_id,
      receipt_sha256: sourceReceiptSha256,
      probe: inspection.probe.name,
      server_request_ordinal: inspection.request.ordinal,
      method: inspection.request.method,
      route: inspection.request.route,
    },
    upstream_recapture: inspection.upstream_recapture ?? null,
    scope: inspection.scope,
    policy: {
      total_observation_limit: BROWSER_PROBE_STABILITY_SCHEDULE_LIMITS.totalObservations,
      max_new_runs: request.max_new_runs,
      timeout_ms: request.timeout_ms,
      sequential: true,
      remote_http_denied: true,
    },
    authority: {
      confidence: 'low',
      source_causal: false,
      edit_eligible: false,
      correctness_required: true,
    },
    provenance: 'bounded_local_browser_probe_stability_schedule',
    limitations: [
      'The schedule runs at most three local observations sequentially and performs no cloud or production work.',
      'Repeated local development evidence does not establish production frequency, latency, scale, or impact.',
      'Stability permits only another bounded observation and never authorizes a source edit or optimization.',
    ],
  };
}

function terminalDecision(runs, current) {
  if (runs.length >= 2) {
    const assessment = createBrowserProbeStabilityAssessment(runs, current);
    if (assessment.state === 'stale') {
      return { state: 'stale', assessment, terminal_reason: 'source_snapshot_changed' };
    }
    if (assessment.state === 'unstable') {
      return { state: 'unstable', assessment, terminal_reason: 'compatible_routes_disagreed' };
    }
    if (assessment.state === 'insufficient_evidence') {
      return {
        state: 'evidence_incomplete',
        assessment,
        terminal_reason: 'compatible_runs_selected_no_follow_up_probe',
      };
    }
    if (assessment.state === 'stable' && assessment.decision.follow_up_eligible) {
      return { state: 'stable', assessment, terminal_reason: 'three_unanimous_passing_routes' };
    }
    if (assessment.state === 'diagnosis_stable' && assessment.decision.source_inspection_eligible) {
      return {
        state: 'diagnosis_stable',
        assessment,
        terminal_reason: 'three_unanimous_passing_diagnoses',
      };
    }
    if (runs.some((run) => run.correctness !== 'passed')) {
      return {
        state: 'correctness_failed',
        assessment,
        terminal_reason: 'included_exact_flow_failed',
      };
    }
  } else if (runs.some((run) => run.correctness !== 'passed')) {
    return {
      state: 'correctness_failed',
      assessment: null,
      terminal_reason: 'included_exact_flow_failed',
    };
  }
  return null;
}

function recaptureOutcome(receipt) {
  if (receipt.state === 'stale' || receipt.subject?.current === false) {
    return { state: 'stale', assessment: null, terminal_reason: 'source_snapshot_changed' };
  }
  if (receipt.state !== 'completed') {
    return {
      state: 'operational_failure',
      assessment: null,
      terminal_reason: 'local_recapture_failed',
    };
  }
  if (receipt.evidence?.outcome !== 'evidence_completed') {
    return {
      state: 'evidence_incomplete',
      assessment: null,
      terminal_reason: 'local_recapture_evidence_incomplete',
    };
  }
  return null;
}

async function finalizeSchedule({
  store,
  root,
  base,
  request,
  runs,
  references,
  executed,
  admittedNewRuns,
  decision,
  inspectProbe,
  inspectCurrent,
}) {
  let finalIsCurrent = false;
  try {
    const finalInspection = await inspectProbe(root, {
      capture_id: request.capture_id,
      probe: request.probe,
      ...(request.source_recapture_id ? { source_recapture_id: request.source_recapture_id } : {}),
    });
    const finalCurrent = await inspectCurrent(root);
    const finalReceiptSha256 = await digestContainedFile(
      root,
      `.codevetter/playwright-runs/${request.capture_id}/receipt.json`,
      PLAYWRIGHT_CAPTURE_LIMITS.receiptBytes,
      'browser schedule source receipt'
    );
    finalIsCurrent =
      inspectionCurrent(finalInspection, finalCurrent) &&
      finalReceiptSha256 === base.source_capture.receipt_sha256 &&
      finalInspection.subject.repository_revision === base.subject.repository_revision &&
      finalInspection.subject.source_snapshot_sha256 === base.subject.source_snapshot_sha256;
  } catch {
    finalIsCurrent = false;
  }
  const finalDecision = finalIsCurrent
    ? decision
    : { state: 'stale', assessment: null, terminal_reason: 'source_changed_during_schedule' };
  return persistTerminal(store, root, {
    ...base,
    state: finalDecision.state,
    subject: { ...base.subject, current: finalIsCurrent },
    budget: budgetSummary(request, {
      executed,
      observations: runs.length,
      reused: references.filter((reference) => reference.origin === 'reused').length,
      admitted: admittedNewRuns,
    }),
    runs: references,
    assessment: finalDecision.assessment,
    terminal_reason: finalDecision.terminal_reason,
  });
}

function budgetSummary(request, { executed, observations, reused, admitted: admittedOverride }) {
  const admitted =
    admittedOverride ??
    Math.min(
      request.max_new_runs,
      BROWSER_PROBE_STABILITY_SCHEDULE_LIMITS.totalObservations -
        request.existing_recapture_ids.length
    );
  return {
    existing_requested: request.existing_recapture_ids.length,
    reused,
    new_runs_requested: request.max_new_runs,
    new_runs_admitted: admitted,
    new_runs_executed: executed,
    total_observations: observations,
    remaining_new_runs: admitted - executed,
    remaining_observations:
      BROWSER_PROBE_STABILITY_SCHEDULE_LIMITS.totalObservations - observations,
  };
}

function assessmentOrNull(runs, current) {
  return runs.length >= 2 ? createBrowserProbeStabilityAssessment(runs, current) : null;
}

function inspectionCurrent(inspection, current) {
  return (
    ['observed', 'correctness_blocked'].includes(inspection.state) &&
    inspection.subject.current === true &&
    current.repository_revision === inspection.subject.repository_revision &&
    current.source_snapshot_sha256 === inspection.subject.source_snapshot_sha256
  );
}

function assertRunMatchesInspection(run, inspection, sourceReceiptSha256) {
  if (
    run.subject.repository_revision !== inspection.subject.repository_revision ||
    run.subject.source_snapshot_sha256 !== inspection.subject.source_snapshot_sha256 ||
    run.source_capture.capture_id !== inspection.capture_id ||
    run.source_capture.receipt_sha256 !== sourceReceiptSha256 ||
    run.source_capture.probe !== inspection.probe.name ||
    run.source_capture.server_request_ordinal !== inspection.request.ordinal ||
    run.source_capture.method !== inspection.request.method ||
    run.source_capture.route !== inspection.request.route ||
    JSON.stringify(run.upstream_recapture ?? null) !==
      JSON.stringify(inspection.upstream_recapture ?? null) ||
    run.scope.target !== inspection.scope.target ||
    run.scope.name !== inspection.scope.name ||
    run.scope.project !== inspection.scope.project
  ) {
    throw new Error('browser probe schedule recapture does not match the requested source flow');
  }
}

function assertExactlyCompatible(runs) {
  if (runs.length < 2) return;
  const first = compatibilityIdentity(runs[0]);
  if (runs.some((run) => compatibilityIdentity(run) !== first)) {
    throw new Error('browser probe schedule recaptures are not exactly compatible');
  }
}

function compatibilityIdentity(run) {
  return JSON.stringify({
    subject: run.subject,
    source_capture: run.source_capture,
    upstream_recapture: run.upstream_recapture ?? null,
    scope: run.scope,
    policy: run.policy,
    runtime: { family: run.runtime.family, configuration: run.runtime.configuration },
    evidence_outcome: run.evidence_outcome,
  });
}

async function runReference(root, run, origin, digestProbeReceipt) {
  return {
    recapture_id: run.recapture_id,
    origin,
    receipt_path: `${PROBE_RUN_DIRECTORY}/${run.recapture_id}/receipt.json`,
    receipt_sha256: await digestProbeReceipt(root, run.recapture_id),
    capture_id: run.capture_id,
    result_sha256: null,
    evidence_outcome: run.evidence_outcome,
    correctness: run.correctness,
    route: { ...run.route, leading_source: run.route.leading_source ?? null },
  };
}

async function receiptReference(root, receipt, origin, digestProbeReceipt) {
  return {
    recapture_id: receipt.recapture_id,
    origin,
    receipt_path: `${PROBE_RUN_DIRECTORY}/${receipt.recapture_id}/receipt.json`,
    receipt_sha256: await digestProbeReceipt(root, receipt.recapture_id),
    capture_id: receipt.new_capture?.capture_id ?? null,
    result_sha256: receipt.new_capture?.result_sha256 ?? null,
    evidence_outcome: receipt.evidence.outcome,
    correctness: receipt.evidence.correctness,
    route: { classification: null, next_probe: null, leading_source: null },
  };
}

async function digestDurableProbeReceipt(root, recaptureId) {
  return digestContainedFile(
    root,
    `${PROBE_RUN_DIRECTORY}/${assertPlaywrightCaptureId(recaptureId)}/receipt.json`,
    64 * 1024,
    'browser probe receipt'
  );
}

async function reuseExistingSchedule(root, request, base, current, digestProbeReceipt) {
  let receipt;
  try {
    receipt = await loadDurableBrowserProbeStabilitySchedule(root, request.schedule_id, {
      digestProbeReceipt,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const nowCurrent = inspectionCurrent(
    {
      state: base.subject.current ? 'observed' : 'stale_source_snapshot',
      subject: base.subject,
    },
    current
  );
  const reusedIds = receipt.runs
    .filter((run) => run.origin === 'reused')
    .map((run) => run.recapture_id);
  if (
    receipt.schedule_id !== request.schedule_id ||
    receipt.subject.repository_revision !== base.subject.repository_revision ||
    receipt.subject.source_snapshot_sha256 !== base.subject.source_snapshot_sha256 ||
    receipt.subject.current !== nowCurrent ||
    JSON.stringify(receipt.source_capture) !== JSON.stringify(base.source_capture) ||
    JSON.stringify(receipt.upstream_recapture ?? null) !==
      JSON.stringify(base.upstream_recapture ?? null) ||
    JSON.stringify(receipt.scope) !== JSON.stringify(base.scope) ||
    receipt.policy.max_new_runs !== request.max_new_runs ||
    receipt.policy.timeout_ms !== request.timeout_ms ||
    JSON.stringify(reusedIds) !== JSON.stringify(request.existing_recapture_ids)
  ) {
    throw new Error('browser probe stability schedule ID is already bound to another request');
  }
  return receipt;
}

export async function loadDurableBrowserProbeStabilitySchedule(
  repositoryRoot,
  scheduleId,
  { digestProbeReceipt = digestDurableProbeReceipt } = {}
) {
  const root = await realpath(resolve(repositoryRoot));
  const safeId = assertScheduleId(scheduleId);
  const directory = resolve(root, SCHEDULE_DIRECTORY, safeId);
  if (repositoryRelative(root, directory) === null)
    throw new Error('browser probe schedule escapes');
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error('browser probe schedule receipt directory is unsafe');
  }
  const path = resolve(directory, 'receipt.json');
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > BROWSER_PROBE_STABILITY_SCHEDULE_LIMITS.receiptBytes
  ) {
    throw new Error('browser probe stability schedule receipt is unsafe');
  }
  const receipt = assertBrowserProbeStabilitySchedule(JSON.parse(await readFile(path, 'utf8')));
  const sourceDigest = await digestContainedFile(
    root,
    `.codevetter/playwright-runs/${receipt.source_capture.capture_id}/receipt.json`,
    PLAYWRIGHT_CAPTURE_LIMITS.receiptBytes,
    'browser schedule source receipt'
  );
  if (sourceDigest !== receipt.source_capture.receipt_sha256) {
    throw new Error('browser probe stability schedule source integrity check failed');
  }
  if (receipt.upstream_recapture) {
    const upstreamDigest = await digestContainedFile(
      root,
      `${PROBE_RUN_DIRECTORY}/${receipt.upstream_recapture.recapture_id}/receipt.json`,
      64 * 1024,
      'browser schedule upstream receipt'
    );
    if (upstreamDigest !== receipt.upstream_recapture.receipt_sha256) {
      throw new Error('browser probe stability schedule upstream integrity check failed');
    }
  }
  for (const run of receipt.runs) {
    if ((await digestProbeReceipt(root, run.recapture_id)) !== run.receipt_sha256) {
      throw new Error('browser probe stability schedule run integrity check failed');
    }
  }
  return receipt;
}

async function reserveSchedule(root, scheduleId) {
  const evidenceRoot = resolve(root, '.codevetter');
  try {
    const existingEvidenceMetadata = await lstat(evidenceRoot);
    if (!existingEvidenceMetadata.isDirectory() || existingEvidenceMetadata.isSymbolicLink()) {
      throw new Error('CodeVetter evidence root is unsafe');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await ensureCodeVetterEvidenceRoot(root);
  const parent = resolve(root, SCHEDULE_DIRECTORY);
  const directory = resolve(parent, scheduleId);
  if (repositoryRelative(root, directory) === null)
    throw new Error('browser probe schedule escapes');
  try {
    const existingParentMetadata = await lstat(parent);
    if (!existingParentMetadata.isDirectory() || existingParentMetadata.isSymbolicLink()) {
      throw new Error('browser probe schedule directory is unsafe');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const parentMetadata = await lstat(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    throw new Error('browser probe schedule directory is unsafe');
  }
  await mkdir(directory, { recursive: false, mode: 0o700 });
  return { directory };
}

async function persistTerminal(store, root, receipt) {
  let candidate = receipt;
  if (receipt.state !== 'stale') {
    try {
      const sourceDigest = await digestContainedFile(
        root,
        `.codevetter/playwright-runs/${receipt.source_capture.capture_id}/receipt.json`,
        PLAYWRIGHT_CAPTURE_LIMITS.receiptBytes,
        'browser schedule source receipt'
      );
      if (sourceDigest !== receipt.source_capture.receipt_sha256) throw new Error('changed');
      if (receipt.upstream_recapture) {
        const upstreamDigest = await digestContainedFile(
          root,
          `${PROBE_RUN_DIRECTORY}/${receipt.upstream_recapture.recapture_id}/receipt.json`,
          64 * 1024,
          'browser schedule upstream receipt'
        );
        if (upstreamDigest !== receipt.upstream_recapture.receipt_sha256) {
          throw new Error('changed');
        }
      }
    } catch {
      candidate = {
        ...receipt,
        state: 'stale',
        subject: { ...receipt.subject, current: false },
        assessment: null,
        terminal_reason: 'source_changed_before_persistence',
      };
    }
  }
  const complete = assertBrowserProbeStabilitySchedule(candidate);
  const serialized = `${JSON.stringify(complete)}\n`;
  if (Buffer.byteLength(serialized) > BROWSER_PROBE_STABILITY_SCHEDULE_LIMITS.receiptBytes) {
    throw new Error('browser probe stability schedule receipt exceeds bound');
  }
  const destination = resolve(store.directory, 'receipt.json');
  const temporary = resolve(store.directory, `.receipt-${process.pid}-${temporarySequence++}.tmp`);
  try {
    await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  return complete;
}

async function digestContainedFile(root, relativePath, maximumBytes, label) {
  const path = resolve(root, relativePath);
  if (repositoryRelative(root, path) === null) throw new Error(`${label} escapes repository`);
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumBytes
  ) {
    throw new Error(`${label} is unsafe`);
  }
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

export function assertBrowserProbeStabilitySchedule(value) {
  const legacy = value?.schema_version === BROWSER_PROBE_STABILITY_SCHEDULE_LEGACY_SCHEMA_VERSION;
  if (
    !closed(value, [
      'schema_version',
      'schedule_id',
      'state',
      'subject',
      'source_capture',
      ...(legacy ? [] : ['upstream_recapture']),
      'scope',
      'policy',
      'budget',
      'runs',
      'assessment',
      'terminal_reason',
      'authority',
      'provenance',
      'limitations',
    ]) ||
    ![
      BROWSER_PROBE_STABILITY_SCHEDULE_SCHEMA_VERSION,
      BROWSER_PROBE_STABILITY_SCHEDULE_LEGACY_SCHEMA_VERSION,
    ].includes(value.schema_version) ||
    !safeScheduleId(value.schedule_id) ||
    ![
      'stable',
      ...(legacy ? [] : ['diagnosis_stable']),
      'unstable',
      'correctness_failed',
      'evidence_incomplete',
      'stale',
      'operational_failure',
      'budget_exhausted',
    ].includes(value.state) ||
    !validSubject(value.subject) ||
    !validSourceCapture(value.source_capture) ||
    (!legacy &&
      !validUpstreamRecapture(value.upstream_recapture, value.source_capture, value.state)) ||
    !validScope(value.scope) ||
    !validPolicy(value.policy) ||
    !validBudget(value.budget, value.runs, value.policy) ||
    !Array.isArray(value.runs) ||
    value.runs.length > 3 ||
    value.runs.some((run) => !validRunReference(run, legacy)) ||
    new Set(value.runs.map((run) => run.recapture_id)).size !== value.runs.length ||
    !safeAssessment(value.assessment) ||
    ![
      'source_snapshot_not_current',
      'source_snapshot_changed',
      'compatible_routes_disagreed',
      'compatible_runs_selected_no_follow_up_probe',
      'three_unanimous_passing_routes',
      ...(legacy ? [] : ['three_unanimous_passing_diagnoses']),
      'included_exact_flow_failed',
      'admitted_local_run_budget_consumed',
      'local_recapture_failed',
      'local_recapture_threw',
      'local_recapture_integrity_failed',
      'local_recapture_evidence_incomplete',
      'source_changed_during_schedule',
      'source_changed_before_persistence',
    ].includes(value.terminal_reason) ||
    !validAuthority(value.authority) ||
    value.provenance !== 'bounded_local_browser_probe_stability_schedule' ||
    !Array.isArray(value.limitations) ||
    value.limitations.some((item) => typeof item !== 'string') ||
    (value.state === 'stale') !== (value.subject.current === false) ||
    (value.state === 'stable' &&
      (value.assessment?.state !== 'stable' ||
        value.assessment.decision.follow_up_eligible !== true)) ||
    (!legacy &&
      value.state === 'diagnosis_stable' &&
      (value.assessment?.state !== 'diagnosis_stable' ||
        value.assessment.decision.source_inspection_eligible !== true)) ||
    (value.assessment?.state === 'stable' &&
      !['stable', 'correctness_failed'].includes(value.state)) ||
    (!legacy &&
      value.assessment?.state === 'diagnosis_stable' &&
      !['diagnosis_stable', 'correctness_failed'].includes(value.state)) ||
    (value.state === 'unstable') !== (value.assessment?.state === 'unstable') ||
    value.runs.filter((run) => run.origin === 'reused').length !== value.budget.reused ||
    value.runs.filter((run) => run.origin === 'executed').length > value.budget.new_runs_executed ||
    value.runs.some(
      (run, index) =>
        (run.origin === 'reused' && run.recapture_id.startsWith(`${value.schedule_id}-r`)) ||
        (run.origin === 'executed' && run.recapture_id !== `${value.schedule_id}-r${index + 1}`)
    ) ||
    !validAssessmentBinding(value) ||
    !validStateBinding(value)
  ) {
    throw new Error('browser probe stability schedule receipt is invalid');
  }
  return value;
}

function validSubject(value) {
  return (
    closed(value, ['repository_revision', 'source_snapshot_sha256', 'current']) &&
    typeof value.repository_revision === 'string' &&
    /^[0-9a-f]{64}$/.test(value.source_snapshot_sha256) &&
    typeof value.current === 'boolean'
  );
}

function validSourceCapture(value) {
  return (
    closed(value, [
      'capture_id',
      'receipt_sha256',
      'probe',
      'server_request_ordinal',
      'method',
      'route',
    ]) &&
    safeCaptureId(value.capture_id) &&
    /^[0-9a-f]{64}$/.test(value.receipt_sha256) &&
    SUPPORTED_PROBES.has(value.probe) &&
    Number.isSafeInteger(value.server_request_ordinal) &&
    value.server_request_ordinal > 0 &&
    typeof value.method === 'string' &&
    typeof value.route === 'string' &&
    value.route.startsWith('/')
  );
}

function validUpstreamRecapture(value, sourceCapture, scheduleState) {
  if (
    !['inspect_gc_pressure', 'inspect_continuous_main_thread_source'].includes(sourceCapture.probe)
  ) {
    return value === null;
  }
  return (
    closed(value, [
      'recapture_id',
      'receipt_sha256',
      'source_probe',
      'classification',
      'next_probe',
      'server_request_ordinal',
      'correctness',
    ]) &&
    safeCaptureId(value.recapture_id) &&
    /^[0-9a-f]{64}$/.test(value.receipt_sha256) &&
    value.source_probe === 'repeat_with_lower_overhead_cpu_measurement' &&
    typeof value.classification === 'string' &&
    value.next_probe === sourceCapture.probe &&
    value.server_request_ordinal === sourceCapture.server_request_ordinal &&
    (value.correctness === 'passed' ||
      (value.correctness === 'failed' && scheduleState === 'correctness_failed'))
  );
}

function validScope(value) {
  return (
    closed(value, ['target', 'name', 'project']) &&
    typeof value.target === 'string' &&
    nullableString(value.name) &&
    nullableString(value.project)
  );
}

function validPolicy(value) {
  return (
    closed(value, [
      'total_observation_limit',
      'max_new_runs',
      'timeout_ms',
      'sequential',
      'remote_http_denied',
    ]) &&
    value.total_observation_limit === 3 &&
    Number.isSafeInteger(value.max_new_runs) &&
    value.max_new_runs >= 0 &&
    value.max_new_runs <= 3 &&
    Number.isSafeInteger(value.timeout_ms) &&
    value.timeout_ms > 0 &&
    value.sequential === true &&
    value.remote_http_denied === true
  );
}

function validBudget(value, runs, policy) {
  return (
    closed(value, [
      'existing_requested',
      'reused',
      'new_runs_requested',
      'new_runs_admitted',
      'new_runs_executed',
      'total_observations',
      'remaining_new_runs',
      'remaining_observations',
    ]) &&
    [
      value.existing_requested,
      value.reused,
      value.new_runs_requested,
      value.new_runs_admitted,
      value.new_runs_executed,
      value.total_observations,
      value.remaining_new_runs,
      value.remaining_observations,
    ].every((item) => Number.isSafeInteger(item) && item >= 0 && item <= 3) &&
    value.total_observations ===
      runs?.filter((run) => run.evidence_outcome === 'evidence_completed').length &&
    value.new_runs_executed + value.remaining_new_runs === value.new_runs_admitted &&
    value.total_observations + value.remaining_observations === 3 &&
    value.new_runs_admitted <= value.new_runs_requested &&
    value.new_runs_requested === policy?.max_new_runs &&
    value.new_runs_admitted === Math.min(value.new_runs_requested, 3 - value.existing_requested) &&
    (value.reused === value.existing_requested || value.total_observations === 0)
  );
}

function validRunReference(value, legacy) {
  return (
    closed(value, [
      'recapture_id',
      'origin',
      'receipt_path',
      'receipt_sha256',
      'capture_id',
      'result_sha256',
      'evidence_outcome',
      'correctness',
      'route',
    ]) &&
    safeCaptureId(value.recapture_id) &&
    ['reused', 'executed'].includes(value.origin) &&
    value.receipt_path === `${PROBE_RUN_DIRECTORY}/${value.recapture_id}/receipt.json` &&
    /^[0-9a-f]{64}$/.test(value.receipt_sha256) &&
    (value.capture_id === null || safeCaptureId(value.capture_id)) &&
    (value.result_sha256 === null || /^[0-9a-f]{64}$/.test(value.result_sha256)) &&
    ['evidence_completed', 'evidence_incomplete', 'not_executed', 'operational_failure'].includes(
      value.evidence_outcome
    ) &&
    ['passed', 'failed', 'unknown'].includes(value.correctness) &&
    closed(value.route, ['classification', 'next_probe', ...(legacy ? [] : ['leading_source'])]) &&
    nullableString(value.route.classification) &&
    nullableString(value.route.next_probe) &&
    (legacy || value.route.leading_source === null || validSource(value.route.leading_source))
  );
}

function validSource(value) {
  return (
    closed(value, ['file', 'line', 'function', 'provenance']) &&
    typeof value.file === 'string' &&
    !value.file.startsWith('/') &&
    !value.file.includes('\\') &&
    !value.file.split('/').includes('..') &&
    Number.isSafeInteger(value.line) &&
    value.line > 0 &&
    typeof value.function === 'string' &&
    ['request_scoped_v8_sampling_heap_profile', 'continuous_node_cpu_sample'].includes(
      value.provenance
    )
  );
}

function safeAssessment(value) {
  if (value === null) return true;
  try {
    assertBrowserProbeStability(value);
    return true;
  } catch {
    return false;
  }
}

function validAssessmentBinding(value) {
  if (value.assessment === null) return true;
  const completedIds = value.runs
    .filter((run) => run.evidence_outcome === 'evidence_completed')
    .map((run) => run.recapture_id);
  return (
    JSON.stringify(value.assessment.runs.map((run) => run.recapture_id)) ===
      JSON.stringify(completedIds) &&
    value.assessment.subject.repository_revision === value.subject.repository_revision &&
    value.assessment.subject.source_snapshot_sha256 === value.subject.source_snapshot_sha256 &&
    JSON.stringify(value.assessment.source_capture) === JSON.stringify(value.source_capture) &&
    JSON.stringify(value.assessment.runs[0]?.upstream_recapture ?? null) ===
      JSON.stringify(value.upstream_recapture ?? null) &&
    JSON.stringify(value.assessment.scope) === JSON.stringify(value.scope)
  );
}

function validStateBinding(value) {
  if (['stable', 'diagnosis_stable'].includes(value.state)) {
    return (
      value.runs.length === 3 &&
      value.runs.every(
        (run) => run.evidence_outcome === 'evidence_completed' && run.correctness === 'passed'
      )
    );
  }
  if (value.state === 'unstable') return value.runs.length >= 2;
  if (value.state === 'correctness_failed') {
    return (
      value.runs.some((run) => run.correctness === 'failed') ||
      (value.runs.length === 0 && value.upstream_recapture?.correctness === 'failed')
    );
  }
  if (value.state === 'evidence_incomplete') {
    return (
      value.runs.some((run) => run.evidence_outcome === 'evidence_incomplete') ||
      value.assessment?.state === 'insufficient_evidence'
    );
  }
  if (value.state === 'operational_failure') {
    return (
      value.budget.new_runs_executed > 0 &&
      (value.runs.some((run) =>
        ['not_executed', 'operational_failure'].includes(run.evidence_outcome)
      ) ||
        value.runs.filter((run) => run.origin === 'executed').length <
          value.budget.new_runs_executed)
    );
  }
  if (value.state === 'budget_exhausted') {
    return (
      value.budget.remaining_new_runs === 0 &&
      [null, 'insufficient_repetitions'].includes(value.assessment?.state ?? null)
    );
  }
  return value.state === 'stale';
}

function validAuthority(value) {
  return (
    closed(value, ['confidence', 'source_causal', 'edit_eligible', 'correctness_required']) &&
    value.confidence === 'low' &&
    value.source_causal === false &&
    value.edit_eligible === false &&
    value.correctness_required === true
  );
}

function safeScheduleId(value) {
  try {
    assertScheduleId(value);
    return true;
  } catch {
    return false;
  }
}

function safeCaptureId(value) {
  try {
    assertPlaywrightCaptureId(value);
    return true;
  } catch {
    return false;
  }
}

function nullableString(value) {
  return value === null || typeof value === 'string';
}

function closed(value, fields) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}

function closedInput(value, required, optional) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((field) => Object.hasOwn(value, field)) &&
    Object.keys(value).every((field) => allowed.has(field))
  );
}
