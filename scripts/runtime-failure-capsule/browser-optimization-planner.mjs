import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import { analyzeBrowserDependencies } from './browser-dependency-attribution.mjs';
import {
  BROWSER_OPTIMIZATION_LIMITS,
  assertBrowserOptimizationLoopId,
  assertBrowserOptimizationPolicy,
  assertContainedOptionalPath,
  browserOptimizationId,
  createBrowserOptimizationPlan,
} from './browser-optimization-contracts.mjs';
import { repositoryRelative } from './contracts.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import { collectPerformanceReviewEvidence } from './performance-review-evidence.mjs';
import {
  PLAYWRIGHT_CAPTURE_LIMITS,
  assertPlaywrightCaptureId,
  assertPlaywrightCaptureReceipt,
} from './playwright-capture-contracts.mjs';
import { loadPlaywrightCaptureResult } from './playwright-capture.mjs';

const RUNS_DIRECTORY = '.codevetter/playwright-runs';

export async function planBrowserOptimization(repositoryRoot, input, overrides = {}) {
  const root = await realpath(resolve(repositoryRoot));
  const request = assertPlannerInput(input);
  const loadReceipt = overrides.loadReceipt ?? loadCaptureReceipt;
  const loadResult = overrides.loadResult ?? loadPlaywrightCaptureResult;
  const inspectDependencies = overrides.inspectDependencies ?? analyzeBrowserDependencies;
  const inspectReviewEvidence = overrides.inspectReviewEvidence ?? collectPerformanceReviewEvidence;
  const inspectSubject = overrides.inspectSubject ?? inspectGitDiff;
  const now = overrides.now ?? (() => new Date());
  const receipt = await loadReceipt(root, request.capture_id);
  if (receipt.state !== 'succeeded' || !receipt.result) {
    throw new Error('browser optimization planning requires one successful durable capture');
  }
  const current = await inspectSubject(root);
  if (
    current.repository_revision !== receipt.subject.repository_revision ||
    current.source_snapshot_sha256 !== receipt.subject.source_snapshot_sha256
  ) {
    throw new Error('browser optimization capture is stale for the current source snapshot');
  }
  const result = await loadResult(root, receipt);
  const dependency = await inspectDependencies({
    repositoryRoot: root,
    entry: request.entry,
    buildDirectory: request.build_directory,
    subject: current,
    artifactAttestation: request.artifact_attestation,
  });
  const review = await collectPlannerReviewEvidence(root, current, inspectReviewEvidence);
  return createPlanFromEvidence({
    loopId: request.loop_id,
    generation: request.generation,
    policy: request.policy,
    receipt,
    result,
    dependency,
    review,
    correctnessScope: request.correctness_scope,
    createdAt: now().toISOString(),
  });
}

export function createPlanFromEvidence({
  loopId,
  generation = 1,
  policy,
  receipt,
  result,
  dependency,
  review = null,
  correctnessScope = null,
  createdAt,
}) {
  const observations = [
    ...browserSummaryObservations(result),
    ...(dependency?.observations ?? []),
    ...dependencyCaptureJoinObservations(dependency, result?.loading),
    ...toolFindingObservations(result?.tool_diagnosis?.findings ?? []),
    ...reviewEvidenceObservations(review),
  ].slice(0, BROWSER_OPTIMIZATION_LIMITS.observations);
  const families = evidenceFamilies(result, dependency, review);
  const causeGroups = buildCauseGroups(observations, result?.tool_diagnosis?.findings ?? []);
  const queue = rankExperiments(
    causeGroups.map((cause) =>
      experimentForCause({
        cause,
        observations,
        receipt,
        correctnessScope: correctnessScope ?? reviewCorrectnessScope(review, cause.source),
      })
    ),
    policy.max_experiments
  );
  return createBrowserOptimizationPlan({
    loop_id: loopId,
    generation,
    subject: compactSubject(receipt.subject),
    flow: {
      candidate_id: receipt.scope.candidate_id,
      capture_id: receipt.capture_id,
      target: receipt.scope.target,
      name: receipt.scope.name,
      project: receipt.scope.browser_profile?.project_name ?? null,
    },
    policy,
    evidence: { families, observations },
    cause_groups: causeGroups,
    queue,
    created_at: createdAt,
    limitations: [
      ...(dependency?.limitations ?? []),
      ...reviewLimitations(review),
      'The queue prioritizes one exact local browser flow and does not establish application-wide or production impact.',
      'A connected coding agent must apply each bounded edit; only paired verification can retain it.',
    ].slice(0, BROWSER_OPTIMIZATION_LIMITS.limitations),
  });
}

function compactSubject(value) {
  return {
    repository_revision: value.repository_revision,
    source_snapshot_sha256: value.source_snapshot_sha256,
    dirty: value.dirty,
  };
}

function dependencyCaptureJoinObservations(dependency, loading) {
  if (!dependency?.graph?.packages || !loading?.largest_resources) return [];
  const resources = loading.largest_resources;
  return dependency.graph.packages
    .filter((entry) => entry.static === true)
    .flatMap((entry) => {
      const expectedRoutePackage = viteDependencyRouteName(entry.package);
      const match = resources.find(
        (resource) => viteDependencyRoutePackage(resource.route) === expectedRoutePackage
      );
      if (!match) return [];
      const repositoryImporters = [
        ...new Set(entry.static_imported_by ?? entry.imported_by),
      ].toSorted();
      if (
        repositoryImporters.length === 0 ||
        repositoryImporters.length > BROWSER_OPTIMIZATION_LIMITS.allowedFiles
      ) {
        return [];
      }
      return [
        observation({
          family: 'dependencies',
          kind: 'captured_initial_dependency',
          source: repositoryImporters[0],
          metric: {
            package: entry.package,
            route: match.route,
            transfer_bytes: match.transfer_bytes ?? null,
            repository_importer_count: repositoryImporters.length,
            repository_importers: repositoryImporters,
          },
          provenance: 'static_import_joined_to_bounded_browser_loading_resource',
          verified:
            dependency.graph.state === 'observed' &&
            (loading.inventory?.complete === true ||
              loading.completed_responses?.complete === true),
        }),
      ];
    })
    .slice(0, BROWSER_OPTIMIZATION_LIMITS.observations);
}

function viteDependencyRouteName(packageName) {
  return packageName.startsWith('@') ? packageName.replace('/', '_') : packageName;
}

function viteDependencyRoutePackage(route) {
  if (typeof route !== 'string') return null;
  const match = /\/node_modules\/\.vite\/deps\/([^/?]+)\.js(?:[?#]|$)/.exec(route);
  return match?.[1] ?? null;
}

export function rankExperiments(experiments, maximum) {
  const deduplicated = new Map();
  for (const experiment of experiments) {
    const prior = deduplicated.get(experiment.cause_id);
    if (!prior || compareExperimentPriority(experiment, prior) < 0) {
      deduplicated.set(experiment.cause_id, experiment);
    }
  }
  return [...deduplicated.values()]
    .toSorted(compareExperimentPriority)
    .slice(0, maximum)
    .map((experiment, index) => {
      const { _priority, ...bounded } = experiment;
      void _priority;
      return { ...bounded, rank: index + 1 };
    });
}

function assertPlannerInput(value) {
  if (!plain(value)) throw new Error('browser optimization planner input must be an object');
  const allowed = new Set([
    'loop_id',
    'capture_id',
    'generation',
    'entry',
    'build_directory',
    'artifact_attestation',
    'correctness_scope',
    'policy',
  ]);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0) throw new Error(`planner input has unknown field: ${unknown.join(', ')}`);
  const loopId = assertBrowserOptimizationLoopId(value.loop_id);
  const captureId = assertPlaywrightCaptureId(value.capture_id);
  const generation = value.generation ?? 1;
  if (!Number.isInteger(generation) || generation < 1 || generation > 10_000) {
    throw new Error('planner generation is invalid');
  }
  const entry = assertContainedOptionalPath(value.entry, 'entry');
  const buildDirectory = assertContainedOptionalPath(value.build_directory, 'build_directory');
  const artifactAttestation = validateArtifactAttestation(value.artifact_attestation);
  const correctnessScope = validateCorrectnessScope(value.correctness_scope);
  return {
    loop_id: loopId,
    capture_id: captureId,
    generation,
    entry,
    build_directory: buildDirectory,
    artifact_attestation: artifactAttestation,
    correctness_scope: correctnessScope,
    policy: assertBrowserOptimizationPolicy(value.policy),
  };
}

function validateArtifactAttestation(value) {
  if (value === null || value === undefined) return null;
  if (
    !plain(value) ||
    Object.keys(value).some(
      (field) => !['source_snapshot_sha256', 'artifact_sha256'].includes(field)
    ) ||
    !/^[0-9a-f]{64}$/.test(value.source_snapshot_sha256 ?? '') ||
    !/^[0-9a-f]{64}$/.test(value.artifact_sha256 ?? '')
  ) {
    throw new Error('artifact attestation is invalid');
  }
  return value;
}

function validateCorrectnessScope(value) {
  if (value === null || value === undefined) return null;
  if (
    !plain(value) ||
    Object.keys(value).some((field) => !['adapter', 'target', 'name'].includes(field)) ||
    !['node-test', 'vitest', 'jest', 'go-test'].includes(value.adapter)
  ) {
    throw new Error('browser optimization correctness scope is invalid');
  }
  return {
    adapter: value.adapter,
    target: assertContainedOptionalPath(value.target, 'correctness target'),
    name: boundedText(value.name, 'correctness name'),
  };
}

function browserSummaryObservations(result) {
  const observations = [];
  if (result?.main_thread) {
    observations.push(
      observation({
        family: 'browser_timing',
        kind: 'browser_main_thread_summary',
        source: null,
        metric: {
          javascript_ms: result.main_thread.phases_ms?.javascript ?? null,
          long_task_ms: result.main_thread.long_tasks?.total_duration_ms ?? null,
          repository_cpu_ms: result.main_thread.repository_cpu?.self_time_ms ?? null,
        },
        provenance: result.main_thread.provenance ?? 'chromium_main_thread_trace',
        verified: true,
      })
    );
  }
  if (result?.loading) {
    observations.push(
      observation({
        family: 'loading',
        kind: 'browser_loading_summary',
        source: null,
        metric: {
          observed_transfer_bytes: result.loading.observed_transfer_bytes ?? null,
          repository_module_bytes:
            result.loading.repository_modules?.observed_transfer_bytes ?? null,
          complete: result.loading.inventory?.complete === true,
        },
        provenance: result.loading.provenance ?? 'bounded_browser_loading_evidence',
        verified: result.loading.state === 'observed',
      })
    );
  }
  if (result?.memory) {
    observations.push(
      observation({
        family: 'memory',
        kind: 'browser_memory_summary',
        source: null,
        metric: {
          process_tree_peak_rss_bytes: result.memory.process_tree_peak_rss_bytes ?? null,
          renderer_heap_peak_bytes: result.memory.renderer?.heap_peak_bytes ?? null,
        },
        provenance: result.memory.provenance ?? 'sampled_browser_process_tree_memory',
        verified: true,
      })
    );
  }
  if (result?.react) {
    observations.push(
      observation({
        family: 'react',
        kind: 'react_commit_summary',
        source: null,
        metric: {
          commit_count: result.react.commit_count ?? null,
          total_actual_duration_ms: result.react.total_actual_duration_ms ?? null,
          measurement_complete: result.react.measurement_complete === true,
        },
        provenance: result.react.provenance ?? 'react_devtools_hook',
        verified: result.react.state === 'succeeded' && result.react.measurement_complete === true,
      })
    );
  }
  if (result?.actions) {
    observations.push(
      observation({
        family: 'actions',
        kind: 'browser_action_summary',
        source: null,
        metric: {
          completed_actions: result.actions.inventory?.completed_action_count ?? null,
          slowest_duration_ms: result.actions.slowest?.[0]?.duration_ms ?? null,
          complete: result.actions.inventory?.complete === true,
        },
        provenance: result.actions.provenance ?? 'bounded_playwright_trace_actions',
        verified: result.actions.state === 'observed',
      })
    );
  }
  return observations;
}

function toolFindingObservations(findings) {
  return findings
    .filter((finding) => finding?.eligible_for_experiment === true && finding?.source?.file)
    .slice(0, BROWSER_OPTIMIZATION_LIMITS.causeGroups)
    .map((finding) =>
      observation({
        family: finding.kind.startsWith('react_') ? 'react' : 'browser_timing',
        kind: finding.kind,
        source: finding.source.file,
        metric: {
          finding_id: finding.id,
          runtime_share:
            finding.observed?.self_duration_share ?? finding.observed?.cpu_sample_share ?? null,
          self_duration_ms: finding.observed?.self_actual_duration_ms ?? null,
          operation_count: finding.observed?.operation_count ?? null,
        },
        provenance: finding.source.provenance,
        verified: true,
      })
    );
}

function evidenceFamilies(result, dependency, review) {
  const family = (name, present, incomplete = false, reason = null) => ({
    name,
    state: present ? (incomplete ? 'incomplete' : 'observed') : 'unavailable',
    reason: present ? (incomplete ? reason : null) : reason,
  });
  return [
    family(
      'browser_timing',
      Boolean(result?.main_thread),
      false,
      'Main-thread evidence unavailable.'
    ),
    family(
      'loading',
      Boolean(result?.loading),
      result?.loading?.inventory?.complete !== true,
      'Loading inventory is incomplete.'
    ),
    family('memory', Boolean(result?.memory), false, 'Memory evidence unavailable.'),
    family(
      'react',
      Boolean(result?.react),
      result?.react?.measurement_complete !== true,
      'React evidence is incomplete.'
    ),
    family(
      'actions',
      Boolean(result?.actions),
      result?.actions?.inventory?.complete !== true,
      'Action evidence is incomplete.'
    ),
    family(
      'dependencies',
      Boolean(dependency?.graph),
      dependency?.graph?.state !== 'observed' || dependency?.vite?.state === 'incomplete',
      'Dependency or Vite-rule attribution is incomplete.'
    ),
    family(
      'build_artifact',
      dependency?.artifact?.state === 'observed',
      dependency?.artifact?.verified !== true,
      dependency?.artifact?.reason ?? 'Build artifact unavailable.'
    ),
    reviewEvidenceFamily(review),
  ];
}

function buildCauseGroups(observations, findings) {
  const groups = new Map();
  for (const observation of observations) {
    if (observation.kind === 'surprising_chunk_rule_match') {
      const key = `chunk-rule\0${observation.source}\0${observation.metric.rule_line}\0${observation.metric.chunk}`;
      mergeCause(groups, key, {
        mechanism: 'broad_vite_manual_chunk_rule',
        source: observation.source,
        observation,
        affectedBytes: observation.metric.affected_bytes,
        runtimeShare: null,
      });
    }
    if (
      observation.kind === 'captured_initial_dependency' &&
      observation.verified === true &&
      observation.source &&
      Number.isFinite(observation.metric.transfer_bytes) &&
      observation.metric.transfer_bytes >= 64 * 1024 &&
      !['react', 'react-dom'].includes(observation.metric.package)
    ) {
      const key = `initial-dependency\0${observation.source}\0${observation.metric.package}`;
      mergeCause(groups, key, {
        mechanism: 'large_initial_dependency',
        source: observation.source,
        observation,
        affectedBytes: observation.metric.transfer_bytes,
        runtimeShare: null,
      });
    }
  }
  for (const finding of findings.filter(
    (entry) => entry?.eligible_for_experiment === true && entry?.source?.file
  )) {
    const matching = observations.find(
      (entry) => entry.metric?.finding_id === finding.id && entry.source === finding.source.file
    );
    if (!matching) continue;
    const key = `${finding.inference?.mechanism ?? finding.kind}\0${finding.source.file}`;
    mergeCause(groups, key, {
      mechanism: finding.inference?.mechanism ?? finding.kind,
      source: finding.source.file,
      observation: matching,
      affectedBytes: null,
      runtimeShare:
        finding.observed?.self_duration_share ?? finding.observed?.cpu_sample_share ?? null,
    });
  }
  return [...groups.values()]
    .map((group) => ({
      cause_id: browserOptimizationId(group.key),
      mechanism: group.mechanism,
      source: group.source,
      observation_ids: [...group.observationIds].toSorted(),
      affected_bytes: group.affectedBytes,
      runtime_share: group.runtimeShare,
    }))
    .slice(0, BROWSER_OPTIMIZATION_LIMITS.causeGroups);
}

function mergeCause(groups, key, input) {
  const prior = groups.get(key) ?? {
    key,
    mechanism: input.mechanism,
    source: input.source,
    observationIds: new Set(),
    affectedBytes: null,
    runtimeShare: null,
  };
  prior.observationIds.add(input.observation.observation_id);
  prior.affectedBytes = maximumNullable(prior.affectedBytes, input.affectedBytes);
  prior.runtimeShare = maximumNullable(prior.runtimeShare, input.runtimeShare);
  groups.set(key, prior);
}

function experimentForCause({ cause, observations, receipt, correctnessScope }) {
  const causeEvidence = observations.filter((entry) =>
    cause.observation_ids.includes(entry.observation_id)
  );
  const reviewEvidence = observations.filter(
    (entry) => entry.family === 'review' && entry.source === cause.source
  );
  const evidence = [...causeEvidence, ...reviewEvidence].filter(
    (entry, index, entries) =>
      entries.findIndex((candidate) => candidate.observation_id === entry.observation_id) === index
  );
  const dependency = cause.mechanism === 'broad_vite_manual_chunk_rule';
  const initialDependency = cause.mechanism === 'large_initial_dependency';
  const dependencyImporters = initialDependency
    ? [...new Set(causeEvidence.flatMap((entry) => entry.metric.repository_importers ?? []))]
        .toSorted()
        .slice(0, BROWSER_OPTIMIZATION_LIMITS.allowedFiles)
    : [];
  const hypothesis = dependency
    ? 'Narrow the Vite manual chunk predicate so unrelated initial-route packages are not assigned by peer-dependency path substrings.'
    : initialDependency
      ? 'Replace the captured package-root imports with narrower subpath or deferred boundaries while preserving the rendered flow.'
      : `Reduce the repeated ${cause.mechanism.replaceAll('_', ' ')} anchored at ${cause.source}.`;
  return {
    experiment_id: browserOptimizationId(
      `${cause.cause_id}\0${cause.source}\0${
        dependency
          ? 'initial_route_javascript_bytes'
          : initialDependency
            ? 'completed_response_transfer_bytes'
            : 'browser_runtime'
      }`
    ),
    cause_id: cause.cause_id,
    rank: 1,
    hypothesis,
    confidence_basis: `${
      dependency
        ? 'A statically recognized chunk rule matched an initial dependency through its resolved package path.'
        : initialDependency
          ? 'The exact captured dependency resource is joined to every statically reachable repository importer in the selected flow.'
          : 'A deterministic browser detector produced one uniquely source-attributed eligible finding.'
    }${reviewConfidenceSuffix(reviewEvidence)}`,
    allowed_files: initialDependency ? dependencyImporters : [cause.source],
    predicted_metric: dependency
      ? { name: 'initial_route_javascript_bytes', direction: 'decrease' }
      : initialDependency
        ? { name: 'completed_response_transfer_bytes', direction: 'decrease' }
        : { name: 'same_flow_runtime_candidate', direction: 'decrease' },
    correctness_scope: correctnessScope,
    performance_scope: {
      adapter: 'playwright',
      target: receipt.scope.target,
      name: receipt.scope.name,
      project: receipt.scope.browser_profile?.project_name ?? null,
    },
    rejection_condition: dependency
      ? 'Reject unless paired initial-route bytes decrease and authoritative browser timing, memory, and correctness do not regress.'
      : initialDependency
        ? 'Reject unless paired complete response bytes materially decrease without correctness, timing, or memory regression.'
        : 'Reject unless paired candidate evidence decreases without correctness, browser timing, or memory regression.',
    evidence_ids: evidence.map((entry) => entry.observation_id).toSorted(),
    limitations: dependency
      ? [
          'Static rule attribution does not prove that changing the chunk boundary improves field performance.',
        ]
      : initialDependency
        ? [
            'A large development dependency response may differ from the production bundle and requires paired flow verification.',
          ]
        : ['A runtime hotspot is a prioritization signal, not proof that removable work exists.'],
    _priority: {
      exact: evidence.some((entry) => entry.verified) ? 1 : 0,
      affected_bytes: cause.affected_bytes ?? 0,
      runtime_share: cause.runtime_share ?? 0,
      file_count: initialDependency ? dependencyImporters.length : 1,
    },
  };
}

async function collectPlannerReviewEvidence(root, current, inspectReviewEvidence) {
  const changedFiles = current.changed_files ?? [];
  if (changedFiles.length > 64) {
    return { status: 'unavailable', reason: 'review_changed_file_inventory_exceeds_bound' };
  }
  try {
    return await inspectReviewEvidence(root, {
      ...(changedFiles.length > 0 ? { reviewChangedFiles: changedFiles } : {}),
      inspectSnapshot: async () => current,
    });
  } catch {
    return { status: 'unavailable', reason: 'review_evidence_collection_failed' };
  }
}

function reviewEvidenceFamily(review) {
  if (review?.status === 'qualified') {
    return { name: 'review', state: 'observed', reason: null };
  }
  if (['cold_start_correctness_required', 'reverification_required'].includes(review?.status)) {
    return {
      name: 'review',
      state: 'incomplete',
      reason: 'Review found a source-owned correctness binding that still requires execution.',
    };
  }
  return {
    name: 'review',
    state: 'unavailable',
    reason: review?.reason ?? 'Review evidence unavailable.',
  };
}

function reviewEvidenceObservations(review) {
  const source = review?.observed?.candidate_source ?? review?.plan?.candidate_source;
  if (!source?.file) return [];
  const performance = review?.observed?.performance_flow ?? review?.plan?.performance_flow;
  const correctness = review?.observed?.correctness_flow ?? review?.plan?.correctness_scope;
  return [
    observation({
      family: 'review',
      kind:
        review.status === 'qualified'
          ? 'qualified_review_evidence'
          : 'source_owned_correctness_binding',
      source: source.file,
      metric: {
        status: review.status,
        performance_adapter: performance?.adapter ?? null,
        performance_target: performance?.target ?? null,
        correctness_adapter: correctness?.adapter ?? null,
        correctness_target: correctness?.target ?? null,
      },
      provenance:
        review.status === 'qualified'
          ? 'digest_bound_performance_review_receipt'
          : (source.provenance ?? 'repository_manifest_source_binding'),
      verified: review.status === 'qualified',
    }),
  ];
}

function reviewCorrectnessScope(review, experimentSource) {
  const source = review?.observed?.candidate_source ?? review?.plan?.candidate_source;
  const scope = review?.observed?.correctness_flow ?? review?.plan?.correctness_scope;
  if (
    source?.file !== experimentSource ||
    !scope ||
    !['node-test', 'vitest', 'jest', 'go-test'].includes(scope.adapter) ||
    typeof scope.target !== 'string' ||
    typeof scope.name !== 'string'
  ) {
    return null;
  }
  return { adapter: scope.adapter, target: scope.target, name: scope.name };
}

function reviewConfidenceSuffix(reviewEvidence) {
  if (reviewEvidence.some((entry) => entry.kind === 'qualified_review_evidence')) {
    return ' Digest-bound review evidence independently links this source to accepted local correctness and performance evidence.';
  }
  if (reviewEvidence.length > 0) {
    return ' The review selector links this source to a repository-owned correctness scope that must pass before promotion.';
  }
  return '';
}

function reviewLimitations(review) {
  if (!review || review.status === 'qualified') return [];
  if (['cold_start_correctness_required', 'reverification_required'].includes(review.status)) {
    return [
      'Review supplied a correctness binding, but current correctness still requires execution.',
    ];
  }
  return [`Review evidence was unavailable: ${review.reason ?? 'no qualified evidence'}.`];
}

function compareExperimentPriority(left, right) {
  const a = left._priority ?? priorityFromExperiment(left);
  const b = right._priority ?? priorityFromExperiment(right);
  return (
    b.exact - a.exact ||
    b.affected_bytes - a.affected_bytes ||
    b.runtime_share - a.runtime_share ||
    a.file_count - b.file_count ||
    left.experiment_id.localeCompare(right.experiment_id)
  );
}

function priorityFromExperiment(value) {
  return {
    exact: value.confidence_basis ? 1 : 0,
    affected_bytes: value.predicted_metric?.affected_bytes ?? 0,
    runtime_share: value.predicted_metric?.runtime_share ?? 0,
    file_count: value.allowed_files?.length ?? BROWSER_OPTIMIZATION_LIMITS.allowedFiles,
  };
}

function observation({ family, kind, source, metric, provenance, verified }) {
  return {
    observation_id: browserOptimizationId(
      `${family}\0${kind}\0${source ?? ''}\0${JSON.stringify(metric)}`
    ),
    family,
    kind,
    source,
    metric,
    provenance,
    verified,
  };
}

function maximumNullable(left, right) {
  if (!Number.isFinite(right)) return left;
  if (!Number.isFinite(left)) return right;
  return Math.max(left, right);
}

function boundedText(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1_000 ||
    value.includes('\0')
  ) {
    throw new Error(`${label} must be bounded text`);
  }
  return value;
}

async function loadCaptureReceipt(root, captureId) {
  const path = resolve(root, RUNS_DIRECTORY, captureId, 'receipt.json');
  if (repositoryRelative(root, path) === null) throw new Error('browser capture receipt escapes');
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > PLAYWRIGHT_CAPTURE_LIMITS.receiptBytes
  ) {
    throw new Error('browser capture receipt is unsafe');
  }
  return assertPlaywrightCaptureReceipt(JSON.parse(await readFile(path, 'utf8')));
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
