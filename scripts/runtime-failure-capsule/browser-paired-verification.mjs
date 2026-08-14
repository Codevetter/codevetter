import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { boundedTimeout, repositoryRelative } from './contracts.mjs';
import { ensureCodeVetterEvidenceRoot } from './evidence-root.mjs';
import { inspectGitDiff, inspectGitRevisionFiles } from './git-diff.mjs';
import { establishQualifiedViteRuntime } from './owned-vite-runtime.mjs';
import { captureQualifiedPlaywrightFlow } from './playwright-capture.mjs';
import { qualifyRepository } from './qualification.mjs';

export const BROWSER_PAIRED_VERIFICATION_SCHEMA_VERSION =
  'runtime-browser-optimization-verification/v1';

export const BROWSER_OPTIMIZATION_POLICY = Object.freeze({
  minimum_samples: 3,
  improvement_percent: 10,
  timing_material_ms: 10,
  rss_percent: 10,
  rss_material_bytes: 16 * 1024 * 1024,
  heap_percent: 10,
  heap_material_bytes: 1024 * 1024,
  transfer_percent: 10,
  transfer_material_bytes: 64 * 1024,
  retained_candidate_captures: 2,
});

export async function verifyPairedPlaywrightRepositories(
  {
    baselineRepositoryRoot,
    currentRepositoryRoot,
    target,
    name,
    project = null,
    source,
    sources,
    timeoutMs,
    samples,
    warmups,
  },
  {
    qualify = qualifyRepository,
    establishRuntime = establishQualifiedViteRuntime,
    capture = captureQualifiedPlaywrightFlow,
    loadResult = loadCaptureResult,
    inspectSnapshot = inspectGitDiff,
    inspectRevisionFiles = inspectGitRevisionFiles,
    now = () => Date.now(),
  } = {}
) {
  const roots = {
    baseline: await realpath(resolve(baselineRepositoryRoot)),
    current: await realpath(resolve(currentRepositoryRoot)),
  };
  const timeout = boundedTimeout(timeoutMs);
  if (roots.baseline === roots.current) {
    throw new Error('paired verification requires two distinct repository roots');
  }
  if (!Number.isInteger(samples) || samples < BROWSER_OPTIMIZATION_POLICY.minimum_samples) {
    throw new Error(
      `paired Playwright verification requires at least ${BROWSER_OPTIMIZATION_POLICY.minimum_samples} samples`
    );
  }
  const [baselineQualification, currentQualification, baselineTarget, currentTarget] =
    await Promise.all([
      qualify(roots.baseline),
      qualify(roots.current),
      targetDigest(roots.baseline, target),
      targetDigest(roots.current, target),
    ]);
  const qualifications = { baseline: baselineQualification, current: currentQualification };
  const sealedSources = normalizeSealedSources(source, sources);
  const dirtyCurrent = currentQualification.subject?.dirty === true;
  let exactSubjects = null;
  let changedFiles;
  if (dirtyCurrent) {
    const [baselineSubject, currentSubject] = await Promise.all([
      inspectSnapshot(roots.baseline),
      inspectSnapshot(roots.current),
    ]);
    exactSubjects = { baseline: baselineSubject, current: currentSubject };
    if (
      !sameSubject(baselineQualification.subject, baselineSubject) ||
      !sameSubject(currentQualification.subject, currentSubject)
    ) {
      throw new Error('paired browser qualification subject changed before execution');
    }
    changedFiles = currentSubject.changed_files ?? [];
  } else {
    changedFiles = await inspectRevisionFiles(
      roots.current,
      baselineQualification.subject.repository_revision,
      currentQualification.subject.repository_revision
    );
  }
  const verificationId = `browser-paired-${createHash('sha256')
    .update(`${baselineTarget}:${currentTarget}:${target}:${name}:${project ?? ''}:${now()}`)
    .digest('hex')
    .slice(0, 12)}`;
  const finish = async (value) => ({
    ...value,
    evidence_receipt: await persistVerification(roots.current, verificationId, value),
  });
  const preflight = pairedPreflight({
    qualifications,
    target,
    name,
    project,
    sources: sealedSources,
    changedFiles,
    baselineTarget,
    currentTarget,
  });
  if (preflight.failure) {
    return finish(
      incompleteReport({
        verificationId,
        qualifications,
        target,
        name,
        project,
        sources: sealedSources,
        changedFiles,
        reason: preflight.failure,
        schedule: [],
      })
    );
  }
  const measurements = { baseline: [], current: [] };
  const schedule = [];
  let terminalFailure = null;
  for (const phase of ['warmup', 'measurement']) {
    const count = phase === 'warmup' ? warmups : samples;
    for (let index = 0; index < count; index += 1) {
      for (const side of alternatingSides(index)) {
        const candidate = preflight.candidates[side];
        const captureId = `${verificationId}-${phase === 'warmup' ? 'w' : 'm'}${index}-${side[0]}`;
        if (exactSubjects) {
          await assertExactSubject(roots[side], exactSubjects[side], inspectSnapshot);
        }
        const runtime = await establishRuntime({
          repositoryRoot: roots[side],
          candidateId: candidate.id,
          timeoutMs: timeout,
        });
        let receipt = null;
        let result = null;
        let cleanup = runtime.summary;
        let failure = runtime.ready ? null : `runtime_${runtime.summary.state}`;
        try {
          if (runtime.ready) {
            receipt = await capture({
              repositoryRoot: roots[side],
              captureId,
              candidateId: candidate.id,
              timeoutMs: timeout,
              runtimeConfiguration: runtime.summary.configuration,
              runtimePreflight: runtime.summary.preflight,
            });
            if (receipt.state === 'succeeded') {
              if (exactSubjects && !sameSubject(receipt.subject, exactSubjects[side])) {
                throw new Error('capture subject differed from the sealed browser snapshot');
              }
              result = await loadResult(roots[side], receipt);
            } else {
              failure = `capture_${receipt.state}`;
            }
          }
        } catch (error) {
          failure = `capture_error:${boundedReason(error)}`;
        } finally {
          try {
            cleanup = await runtime.stop();
          } catch (error) {
            failure ??= `runtime_cleanup_error:${boundedReason(error)}`;
          }
        }
        if (cleanup?.cleanup === 'failed') failure ??= 'runtime_cleanup_failed';
        if (exactSubjects) {
          try {
            await assertExactSubject(roots[side], exactSubjects[side], inspectSnapshot);
          } catch {
            failure ??= 'source_snapshot_changed_during_capture';
          }
        }
        let normalized = null;
        if (receipt && result) {
          try {
            normalized = normalizeBrowserMeasurement({ receipt, result });
          } catch (error) {
            failure ??= `evidence_error:${boundedReason(error)}`;
          }
        }
        schedule.push({
          order: schedule.length + 1,
          side,
          phase,
          sample_index: index,
          capture_id: captureId,
          state: normalized ? 'succeeded' : 'failed',
          failure,
          runtime_state: cleanup?.state ?? runtime.summary.state,
          cleanup: cleanup?.cleanup ?? null,
        });
        if (phase === 'measurement' && normalized) measurements[side].push(normalized);
        if (failure) {
          terminalFailure = failure;
          break;
        }
      }
      if (terminalFailure) break;
    }
    if (terminalFailure) break;
  }
  if (terminalFailure) {
    return finish(
      incompleteReport({
        verificationId,
        qualifications,
        target,
        name,
        project,
        sources: sealedSources,
        changedFiles,
        reason: `A paired browser execution did not complete: ${terminalFailure}`,
        schedule,
        measurements,
      })
    );
  }
  return finish(
    comparePairedBrowserMeasurements({
      verificationId,
      qualifications,
      target,
      name,
      project,
      sources: sealedSources,
      changedFiles,
      schedule,
      measurements,
    })
  );
}

export function comparePairedBrowserMeasurements({
  verificationId = 'in-memory-comparison',
  qualifications,
  target,
  name,
  project = null,
  source = null,
  sources = null,
  changedFiles = [],
  schedule,
  measurements,
  policy = BROWSER_OPTIMIZATION_POLICY,
}) {
  const baseline = measurements.baseline ?? [];
  const current = measurements.current ?? [];
  if (baseline.length < policy.minimum_samples || current.length < policy.minimum_samples) {
    return incompleteReport({
      verificationId,
      qualifications,
      target,
      name,
      project,
      sources: normalizeSealedSources(source, sources),
      changedFiles,
      reason: 'Both sides require at least three complete exact-flow browser captures.',
      schedule,
      measurements,
      policy,
    });
  }
  const profiles = [...baseline, ...current].map((entry) => JSON.stringify(entry.browser_profile));
  if (new Set(profiles).size !== 1) {
    return incompleteReport({
      verificationId,
      qualifications,
      target,
      name,
      project,
      sources: normalizeSealedSources(source, sources),
      changedFiles,
      reason: 'Paired browser captures resolved incompatible browser profiles.',
      schedule,
      measurements,
      policy,
    });
  }
  const metrics = [
    timingMetric(
      'workload_duration_ms',
      baseline,
      current,
      (entry) => entry.workload_duration_ms,
      policy
    ),
    timingMetric(
      'renderer_javascript_ms',
      baseline,
      current,
      (entry) => entry.renderer_phases.javascript_ms,
      policy
    ),
    timingMetric(
      'renderer_style_ms',
      baseline,
      current,
      (entry) => entry.renderer_phases.style_ms,
      policy
    ),
    timingMetric(
      'renderer_layout_ms',
      baseline,
      current,
      (entry) => entry.renderer_phases.layout_ms,
      policy
    ),
    timingMetric(
      'renderer_paint_ms',
      baseline,
      current,
      (entry) => entry.renderer_phases.paint_ms,
      policy
    ),
    memoryMetric(
      'process_tree_peak_rss_bytes',
      baseline,
      current,
      (entry) => entry.process_tree_peak_rss_bytes,
      policy.rss_percent,
      policy.rss_material_bytes
    ),
  ];
  const postGcHeap = optionalMemoryMetric(
    'same_page_final_heap_used_bytes',
    baseline,
    current,
    (entry) => entry.same_page_final?.heap_used_bytes,
    policy.heap_percent,
    policy.heap_material_bytes
  );
  if (postGcHeap) metrics.push(postGcHeap);
  const largestContentfulPaint = optionalTimingMetric(
    'largest_contentful_paint_ms',
    baseline,
    current,
    (entry) => entry.largest_contentful_paint_ms,
    policy
  );
  if (largestContentfulPaint) metrics.push(largestContentfulPaint);
  const reactActualDuration = optionalReactTimingMetric(baseline, current, policy);
  if (reactActualDuration) metrics.push(reactActualDuration);
  const browserTransfer = optionalCompletedResponseTransferMetric(baseline, current, policy);
  if (browserTransfer) metrics.push(browserTransfer);

  const repeatedRetention = {
    baseline: repeatedRetentionCandidate(baseline, policy.retained_candidate_captures),
    current: repeatedRetentionCandidate(current, policy.retained_candidate_captures),
  };
  const retentionStatus = compareRetention(repeatedRetention);
  const timingImprovements = metrics.filter(
    (metric) =>
      [
        'workload_duration_ms',
        'renderer_javascript_ms',
        'largest_contentful_paint_ms',
        'react_actual_duration_ms',
      ].includes(metric.kind) && metric.improved
  );
  const memoryImprovements = metrics.filter(
    (metric) =>
      ['process_tree_peak_rss_bytes', 'same_page_final_heap_used_bytes'].includes(metric.kind) &&
      metric.improved
  );
  const loadingImprovements = metrics.filter(
    (metric) => metric.kind === 'browser_completed_response_transfer_bytes' && metric.improved
  );
  const unstableMetrics = metrics.filter((metric) => metric.stable === false);
  const regressions = metrics.filter((metric) => metric.regressed);
  let verdict;
  if (regressions.length > 0 || retentionStatus === 'regressed') {
    verdict = outcome(
      'rejected',
      regressions.length > 0
        ? `${regressions[0].kind} materially regressed.`
        : 'A new sampled-live application retention source repeated across current captures.'
    );
  } else if (
    timingImprovements.length > 0 ||
    memoryImprovements.length > 0 ||
    loadingImprovements.length > 0 ||
    retentionStatus === 'improved'
  ) {
    verdict = outcome(
      'confirmed',
      'The exact local browser flow materially improved without a demonstrated timing, memory, or loading regression.'
    );
  } else {
    verdict = outcome(
      'inconclusive',
      unstableMetrics.length > 0
        ? `${unstableMetrics[0].kind} was too unstable to support a paired optimization verdict.`
        : 'No exact-flow browser timing, memory, or loading metric cleared the materiality policy.'
    );
  }
  return report({
    verificationId,
    qualifications,
    target,
    name,
    project,
    sources: normalizeSealedSources(source, sources),
    changedFiles,
    schedule,
    measurements,
    policy,
    observed: { metrics, repeated_retention: repeatedRetention, retention_status: retentionStatus },
    verdict,
  });
}

function pairedPreflight({
  qualifications,
  target,
  name,
  project,
  sources,
  changedFiles,
  baselineTarget,
  currentTarget,
}) {
  if (qualifications.baseline.subject?.dirty) {
    return { failure: 'Paired browser verification requires a clean incumbent snapshot.' };
  }
  if (qualifications.current.subject?.dirty) {
    if (
      qualifications.baseline.subject.repository_revision !==
      qualifications.current.subject.repository_revision
    ) {
      return { failure: 'A dirty browser candidate must share the incumbent base revision.' };
    }
    if (sources.length === 0 || changedFiles.length === 0) {
      return { failure: 'A dirty browser candidate requires sealed changed source files.' };
    }
    if (changedFiles.some((file) => !sources.includes(file))) {
      return {
        failure: 'The dirty browser candidate changed files outside the sealed source boundaries.',
      };
    }
  }
  if (baselineTarget !== currentTarget) {
    return { failure: 'Paired browser verification requires byte-identical test source.' };
  }
  const revisionsDiffer =
    qualifications.baseline.subject.repository_revision !==
    qualifications.current.subject.repository_revision;
  if (revisionsDiffer && (sources.length === 0 || changedFiles.length === 0)) {
    return { failure: 'A changed revision requires sealed application source boundaries.' };
  }
  if (revisionsDiffer && changedFiles.some((file) => !sources.includes(file))) {
    return { failure: 'The paired revision changed files outside the sealed source boundaries.' };
  }
  const candidates = {};
  for (const side of ['baseline', 'current']) {
    const matching = (qualifications[side].flows ?? []).filter(
      (flow) =>
        flow.adapter === 'playwright' &&
        flow.target === target &&
        flow.name === name &&
        (flow.browser_profile?.project_name ?? null) === project
    );
    if (matching.length !== 1) {
      return {
        failure: `The ${side} repository did not resolve one exact Playwright declaration.`,
      };
    }
    candidates[side] = matching[0];
  }
  const baselineOrigin = loopbackSignal(candidates.baseline);
  const currentOrigin = loopbackSignal(candidates.current);
  if (!baselineOrigin || baselineOrigin !== currentOrigin) {
    return { failure: 'Paired browser verification requires the same declared loopback origin.' };
  }
  if (
    JSON.stringify(candidates.baseline.browser_profile ?? null) !==
    JSON.stringify(candidates.current.browser_profile ?? null)
  ) {
    return { failure: 'Paired browser verification requires the same declared project profile.' };
  }
  return { candidates, sources };
}

function normalizeSealedSources(source, sources) {
  const values = sources ?? (source === undefined || source === null ? [] : [source]);
  if (
    !Array.isArray(values) ||
    values.length > 64 ||
    values.some((value) => !safeRelativeSource(value))
  ) {
    return [];
  }
  return [...new Set(values)].sort();
}

async function assertExactSubject(root, expected, inspectSnapshot) {
  if (!sameSubject(await inspectSnapshot(root), expected)) {
    throw new Error('paired browser source snapshot changed during execution');
  }
}

function sameSubject(left, right) {
  return (
    left?.repository_revision === right?.repository_revision &&
    left?.source_snapshot_sha256 === right?.source_snapshot_sha256 &&
    left?.dirty === right?.dirty
  );
}

async function targetDigest(root, target) {
  const path = await realpath(resolve(root, target));
  if (repositoryRelative(root, path) === null) throw new Error('paired target escapes repository');
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function loadCaptureResult(root, receipt) {
  const path = resolve(root, receipt.result.path);
  if (repositoryRelative(root, path) === null) throw new Error('browser result escapes repository');
  const bytes = await readFile(path);
  if (
    bytes.byteLength !== receipt.result.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== receipt.result.sha256
  ) {
    throw new Error('browser result integrity check failed');
  }
  return JSON.parse(bytes);
}

export function normalizeBrowserMeasurement({ receipt, result }) {
  const workload = result.flows?.find(
    (flow) => flow.kind === 'workload' && flow.parent_flow_id === null
  );
  const phases = result.main_thread?.phases;
  const rss = receipt.execution?.memory?.peak_rss_bytes;
  if (
    receipt.state !== 'succeeded' ||
    receipt.execution?.exit_code !== 0 ||
    !positive(workload?.timing?.duration_ms) ||
    !phases ||
    !positiveInteger(rss)
  ) {
    throw new Error('browser capture lacks comparable exact-flow evidence');
  }
  return {
    capture_id: receipt.capture_id,
    result: receipt.result,
    browser_profile: receipt.scope.browser_profile,
    workload_duration_ms: round(workload.timing.duration_ms),
    renderer_phases: {
      javascript_ms: phaseDuration(phases.javascript),
      style_ms: phaseDuration(phases.style),
      layout_ms: phaseDuration(phases.layout),
      paint_ms: phaseDuration(phases.paint),
    },
    process_tree_peak_rss_bytes: rss,
    largest_contentful_paint_ms: positive(
      result.main_thread?.page_load?.largest_contentful_paint_ms
    )
      ? result.main_thread.page_load.largest_contentful_paint_ms
      : null,
    same_page_final: samePageFinal(result.same_page_memory),
    retained_candidate:
      result.same_page_memory?.retained_attribution?.state === 'succeeded'
        ? result.same_page_memory.retained_attribution.candidate
        : null,
    react:
      result.react?.state === 'succeeded' &&
      result.react.profiled_commit_count > 0 &&
      positive(result.react.total_actual_duration_ms)
        ? {
            total_actual_duration_ms: result.react.total_actual_duration_ms,
            profiled_commit_count: result.react.profiled_commit_count,
            renderer_versions: result.react.renderer_versions,
            provenance: result.react.provenance,
          }
        : null,
    loading: exactNavigationLoading(result.actions) ?? completeLoading(result.loading),
  };
}

function exactNavigationLoading(actions) {
  if (actions?.state !== 'observed' || actions.inventory?.complete !== true) return null;
  const navigation = actions.sequence?.filter(
    (entry) => entry.category === 'navigation' && entry.state === 'succeeded'
  );
  if (
    navigation?.length !== 1 ||
    !nonnegativeInteger(navigation[0].completed_response_transfer_bytes) ||
    !nonnegativeInteger(navigation[0].completed_responses) ||
    navigation[0].failed_or_aborted_resources !== 0
  ) {
    return null;
  }
  return {
    completed_response_transfer_bytes: navigation[0].completed_response_transfer_bytes,
    completed_response_count: navigation[0].completed_responses,
    failed_or_aborted_count: 0,
    failed_or_aborted_identity_sha256: '0'.repeat(64),
  };
}

function completeLoading(loading) {
  if (
    loading?.completed_responses?.complete !== true ||
    !nonnegativeInteger(loading.completed_responses.complete_transfer_bytes) ||
    !nonnegativeInteger(loading.completed_responses.count) ||
    !nonnegativeInteger(loading.failed_or_aborted?.count) ||
    !/^[0-9a-f]{64}$/.test(loading.failed_or_aborted?.request_identity_sha256 ?? '')
  ) {
    return null;
  }
  return {
    completed_response_transfer_bytes: loading.completed_responses.complete_transfer_bytes,
    completed_response_count: loading.completed_responses.count,
    failed_or_aborted_count: loading.failed_or_aborted.count,
    failed_or_aborted_identity_sha256: loading.failed_or_aborted.request_identity_sha256,
  };
}

function samePageFinal(value) {
  if (value?.state !== 'succeeded' || value.samples?.length !== 3) return null;
  const after = value.samples.at(-1)?.after;
  if (!positiveInteger(after?.heap_used_bytes)) return null;
  return {
    heap_used_bytes: after.heap_used_bytes,
    dom_nodes: after.dom_nodes,
    event_listeners: after.event_listeners,
  };
}

function timingMetric(kind, baseline, current, select, policy) {
  return metric(
    kind,
    baseline.map(select),
    current.map(select),
    policy.improvement_percent,
    policy.timing_material_ms
  );
}

function memoryMetric(kind, baseline, current, select, percent, absolute) {
  return metric(kind, baseline.map(select), current.map(select), percent, absolute);
}

function optionalMemoryMetric(kind, baseline, current, select, percent, absolute) {
  const baselineValues = baseline.map(select);
  const currentValues = current.map(select);
  if ([...baselineValues, ...currentValues].some((value) => !positiveInteger(value))) return null;
  return metric(kind, baselineValues, currentValues, percent, absolute);
}

function optionalByteMetric(kind, baseline, current, select, percent, absolute) {
  const baselineValues = baseline.map(select);
  const currentValues = current.map(select);
  if (
    [...baselineValues, ...currentValues].some((value) => !nonnegativeInteger(value)) ||
    baselineValues.every((value) => value === 0)
  ) {
    return null;
  }
  const result = metric(kind, baselineValues, currentValues, percent, absolute);
  const stable = [result.baseline, result.current].every(
    (value) => value.median === 0 || (value.max - value.min) / value.median <= 0.5
  );
  return stable
    ? { ...result, stable: true }
    : { ...result, stable: false, improved: false, regressed: false };
}

function optionalCompletedResponseTransferMetric(baseline, current, policy) {
  const observations = [...baseline, ...current].map((entry) => entry.loading);
  if (
    observations.some(
      (value) =>
        !value ||
        !nonnegativeInteger(value.completed_response_transfer_bytes) ||
        !nonnegativeInteger(value.completed_response_count) ||
        !nonnegativeInteger(value.failed_or_aborted_count) ||
        !/^[0-9a-f]{64}$/.test(value.failed_or_aborted_identity_sha256 ?? '')
    )
  ) {
    return null;
  }
  const failures = observations.map((value) =>
    JSON.stringify([value.failed_or_aborted_count, value.failed_or_aborted_identity_sha256])
  );
  if (new Set(failures).size !== 1) return null;
  return optionalByteMetric(
    'browser_completed_response_transfer_bytes',
    baseline,
    current,
    (entry) => entry.loading.completed_response_transfer_bytes,
    policy.transfer_percent,
    policy.transfer_material_bytes
  );
}

function optionalTimingMetric(kind, baseline, current, select, policy) {
  const baselineValues = baseline.map(select);
  const currentValues = current.map(select);
  if ([...baselineValues, ...currentValues].some((value) => !positive(value))) return null;
  const result = metric(
    kind,
    baselineValues,
    currentValues,
    policy.improvement_percent,
    policy.timing_material_ms
  );
  const stable = [result.baseline, result.current].every(
    (value) => value.median > 0 && (value.max - value.min) / value.median <= 0.5
  );
  return stable
    ? { ...result, stable: true }
    : { ...result, stable: false, improved: false, regressed: false };
}

function optionalReactTimingMetric(baseline, current, policy) {
  const observations = [...baseline, ...current].map((entry) => entry.react);
  if (
    observations.some(
      (value) =>
        !value ||
        !positive(value.total_actual_duration_ms) ||
        !Number.isSafeInteger(value.profiled_commit_count) ||
        value.profiled_commit_count < 1 ||
        !Array.isArray(value.renderer_versions) ||
        value.provenance !== 'react_devtools_hook_separate_exact_flow_pass'
    )
  ) {
    return null;
  }
  const profiles = observations.map((value) => JSON.stringify(value.renderer_versions));
  if (new Set(profiles).size !== 1) return null;
  return optionalTimingMetric(
    'react_actual_duration_ms',
    baseline,
    current,
    (entry) => entry.react.total_actual_duration_ms,
    policy
  );
}

function metric(kind, baselineValues, currentValues, percent, absolute) {
  const baselineMedian = median(baselineValues);
  const currentMedian = median(currentValues);
  const delta = round(currentMedian - baselineMedian);
  const deltaPercent = baselineMedian === 0 ? null : round((delta / baselineMedian) * 100);
  const relativeMaterial =
    baselineMedian === 0 ? currentMedian > 0 : Math.abs(deltaPercent) >= percent;
  const material = Math.abs(delta) >= absolute && relativeMaterial;
  return {
    kind,
    baseline: distribution(baselineValues),
    current: distribution(currentValues),
    delta,
    delta_percent: deltaPercent,
    improved: material && delta < 0,
    regressed: material && delta > 0,
  };
}

function repeatedRetentionCandidate(measurements, minimumCaptures) {
  const identities = new Map();
  for (const measurement of measurements) {
    const candidate = measurement.retained_candidate;
    if (!candidate?.source?.file || typeof candidate.source.function !== 'string') continue;
    const key = `${candidate.source.file}:${candidate.source.function}`;
    const current = identities.get(key) ?? { source: candidate.source, captures: 0, deltas: [] };
    current.captures += 1;
    current.deltas.push(candidate.delta_sampled_live_bytes);
    identities.set(key, current);
  }
  return (
    [...identities.values()]
      .filter((entry) => entry.captures >= minimumCaptures)
      .sort((left, right) => median(right.deltas) - median(left.deltas))[0] ?? null
  );
}

function compareRetention(value) {
  if (!value.baseline && value.current) return 'regressed';
  if (value.baseline && !value.current) return 'improved';
  if (!value.baseline && !value.current) return 'stable';
  const same =
    value.baseline.source.file === value.current.source.file &&
    value.baseline.source.function === value.current.source.function;
  if (!same) return 'regressed';
  const baseline = median(value.baseline.deltas);
  const current = median(value.current.deltas);
  const delta = current - baseline;
  if (delta >= 64 * 1024 && delta / baseline >= 0.2) return 'regressed';
  if (delta <= -(64 * 1024) && -delta / baseline >= 0.2) return 'improved';
  return 'stable';
}

function incompleteReport({
  verificationId = 'in-memory-comparison',
  qualifications,
  target,
  name,
  project = null,
  sources = [],
  changedFiles = [],
  reason,
  schedule,
  measurements = { baseline: [], current: [] },
  policy = BROWSER_OPTIMIZATION_POLICY,
}) {
  return report({
    verificationId,
    qualifications,
    target,
    name,
    project,
    sources,
    changedFiles,
    schedule,
    measurements,
    policy,
    observed: { metrics: [], repeated_retention: { baseline: null, current: null } },
    verdict: outcome('no_confidence', reason),
  });
}

function report({
  verificationId,
  qualifications,
  target,
  name,
  project,
  sources,
  changedFiles,
  schedule,
  measurements,
  policy,
  observed,
  verdict,
}) {
  return {
    schema_version: BROWSER_PAIRED_VERIFICATION_SCHEMA_VERSION,
    verification_id: verificationId,
    subject: {
      baseline_revision: qualifications.baseline.subject?.repository_revision ?? null,
      current_revision: qualifications.current.subject?.repository_revision ?? null,
    },
    adapter: { kind: 'playwright' },
    scope: {
      target,
      name,
      project,
      browser_profile: measurements.baseline?.[0]?.browser_profile ?? null,
      sealed_sources: sources,
      changed_files: changedFiles,
    },
    policy,
    evidence_mode: 'paired_interleaved_owned_browser',
    paired_schedule: schedule,
    observed,
    captures: {
      baseline: (measurements.baseline ?? []).map(captureReference),
      current: (measurements.current ?? []).map(captureReference),
    },
    verdict,
    decisions: {
      mechanically_confirmed: verdict.status === 'confirmed',
      materially_useful: verdict.status === 'confirmed',
      shipping_recommended: verdict.status === 'confirmed',
      basis:
        verdict.status === 'confirmed'
          ? 'Material paired browser movement cleared timing, memory, and loading regression gates.'
          : verdict.reason,
    },
    limitations: [
      'Paired browser evidence covers one exact local Chromium flow; it does not establish production traffic, remote-network, representative-device, or user impact.',
      project
        ? 'The owned capture applies one statically qualified repository Playwright project; it remains local and does not establish representative-device or production impact.'
        : "The owned capture uses CodeVetter's generic headless Chromium profile because no static project profile qualified.",
      'Sampled-live candidates are approximate post-GC allocation evidence, not exact retained bytes or confirmed leaks.',
      'Local development-server transfer sizes do not establish production bundles, compression, CDN, cache, device, network, or user impact.',
    ],
  };
}

async function persistVerification(root, verificationId, report) {
  await ensureCodeVetterEvidenceRoot(root);
  const directory = resolve(root, '.codevetter/browser-verifications');
  await mkdir(directory, { recursive: true });
  const realDirectory = await realpath(directory);
  if (repositoryRelative(root, realDirectory) === null) {
    throw new Error('browser verification directory escapes repository');
  }
  const serialized = `${JSON.stringify(report)}\n`;
  if (Buffer.byteLength(serialized) > 512 * 1024) {
    throw new Error('browser verification receipt exceeds bound');
  }
  await writeFile(resolve(realDirectory, `${verificationId}.json`), serialized, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return {
    path: `.codevetter/browser-verifications/${verificationId}.json`,
    sha256: createHash('sha256').update(serialized).digest('hex'),
    bytes: Buffer.byteLength(serialized),
  };
}

function captureReference(value) {
  return { capture_id: value.capture_id, result: value.result };
}

function distribution(values) {
  return {
    count: values.length,
    min: Math.min(...values),
    median: median(values),
    max: Math.max(...values),
  };
}

function median(values) {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function phaseDuration(value) {
  return Number.isFinite(value?.total_duration_ms) && value.total_duration_ms >= 0
    ? round(value.total_duration_ms)
    : 0;
}

function loopbackSignal(candidate) {
  return candidate.signals?.find((signal) => signal.kind === 'loopback_browser_base_url')?.evidence;
}

function safeRelativeSource(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 300 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.split('/').includes('..')
  );
}

function alternatingSides(index) {
  return index % 2 === 0 ? ['baseline', 'current'] : ['current', 'baseline'];
}

function outcome(status, reason) {
  return { status, reason };
}

function boundedReason(error) {
  return String(error?.message ?? error)
    .replaceAll(/\s+/g, ' ')
    .slice(0, 160);
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
