import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  FLOW_CAMPAIGN_PLAN_SCHEMA_VERSION,
  FLOW_PRIORITY_MANIFEST_SCHEMA_VERSION,
  LIMITS,
  assertFlowCampaignPlan,
  assertFlowPriorityManifest,
  repositoryRelative,
} from './contracts.mjs';
import { diagnosePerformanceRepository } from './performance-diagnosis.mjs';
import { profileRepository } from './performance.mjs';
import { qualifyRepository } from './qualification.mjs';

const DIRECT_MEASUREMENT_SIGNALS = new Set(['explicit_go_benchmark', 'timing_measurement_source']);
const MANIFEST_BYTES = 256 * 1024;

export async function planFlowOptimizationCampaign({
  repositoryRoot,
  priorityManifestPath,
  maxFlows = 3,
  samples = LIMITS.defaultSamples,
  warmups = LIMITS.defaultWarmups,
  timeoutMs = LIMITS.timeoutMs,
  qualify = qualifyRepository,
  profile = profileRepository,
  diagnose = diagnosePerformanceRepository,
}) {
  if (!Number.isInteger(maxFlows) || maxFlows < 1 || maxFlows > LIMITS.campaignFlows) {
    throw new Error(`max flows must be an integer between 1 and ${LIMITS.campaignFlows}`);
  }

  const root = await realpath(resolve(repositoryRoot));
  const manifest = priorityManifestPath
    ? await loadFlowPriorityManifest(root, priorityManifestPath)
    : emptyPriorityManifest();
  const qualification = await qualify(root);
  const inventory = buildFlowInventory(qualification);
  const knownCandidates = new Set(qualification.candidates.map((candidate) => candidate.id));
  for (const entry of manifest.flows) {
    if (!knownCandidates.has(entry.candidate_id)) {
      throw new Error(`priority manifest references unknown candidate: ${entry.candidate_id}`);
    }
  }

  const weights = new Map(manifest.flows.map((entry) => [entry.candidate_id, entry]));
  const screened = [];
  const unverified = [];

  for (const candidate of inventory.eligible.slice(0, maxFlows)) {
    const configured = weights.get(candidate.id);
    const productContext = configured
      ? {
          frequency_weight: configured.frequency_weight,
          user_impact_weight: configured.user_impact_weight,
          rationale: configured.rationale,
          provenance: 'project_priority_manifest',
        }
      : {
          frequency_weight: 1,
          user_impact_weight: 1,
          rationale: 'No project-owned product context was supplied.',
          provenance: 'neutral_default',
        };
    if (!configured) {
      unverified.push({
        kind: 'product_context_missing',
        candidate_id: candidate.id,
        summary: 'Production frequency and user impact are unknown; neutral weights were used.',
      });
    }

    try {
      const capsule = await profile({
        repositoryRoot: root,
        adapter: candidate.adapter,
        target: candidate.target,
        name: candidate.name,
        timeoutMs,
        samples,
        warmups,
        captureFlow: ['node-test', 'vitest', 'jest'].includes(candidate.adapter),
      });
      const diagnosis = await diagnose(capsule, root);
      const cost = supportedScaleCost(diagnosis);
      const actionable = diagnosis.verdict.status === 'actionable' && cost !== null;
      screened.push({
        candidate: candidateScope(candidate),
        diagnosis: {
          kind: diagnosis.diagnosis.kind,
          summary: diagnosis.diagnosis.summary,
          confidence: diagnosis.diagnosis.confidence,
          verdict: diagnosis.verdict,
          next_action: diagnosis.next_action,
        },
        measurement: cost,
        product_context: productContext,
        priority_score: actionable
          ? round(
              cost.value_ms * productContext.frequency_weight * productContext.user_impact_weight,
              6
            )
          : null,
        evidence: {
          repository_revision: capsule.subject.repository_revision,
          dirty: capsule.subject.dirty,
          sample_policy: capsule.sample_policy,
          profile_repeatability: sourceAlignedRepeatability(capsule, diagnosis),
          flow_events: capsule.observed.flow_evidence?.events.length ?? 0,
          temporary_artifacts_retained: capsule.capture.temporary_artifacts_retained,
        },
        limitations: [...new Set(diagnosis.limitations)],
      });
    } catch {
      screened.push({
        candidate: candidateScope(candidate),
        diagnosis: {
          kind: 'screening_failed',
          summary: 'The exact workload could not be screened with bounded local evidence.',
          confidence: { level: 'low', basis: 'bounded_execution_failure' },
          verdict: { status: 'no_confidence', reason: 'Screening did not complete.' },
          next_action: { kind: 'repair_or_stabilize_profile' },
        },
        measurement: null,
        product_context: productContext,
        priority_score: null,
        evidence: null,
        limitations: ['Workload screening failed before a diagnosis was produced.'],
      });
    }
  }

  const ranked = screened
    .filter((entry) => entry.priority_score !== null)
    .map((entry) => ({
      candidate: entry.candidate,
      supported_scale_ms: entry.measurement.value_ms,
      cost_provenance: entry.measurement.provenance,
      frequency_weight: entry.product_context.frequency_weight,
      user_impact_weight: entry.product_context.user_impact_weight,
      product_context_provenance: entry.product_context.provenance,
      priority_score: entry.priority_score,
    }))
    .sort(
      (left, right) =>
        right.priority_score - left.priority_score ||
        left.candidate.id.localeCompare(right.candidate.id)
    );
  const nextAction = chooseNextAction({ ranked, screened, inventory });
  const verdict =
    ranked.length > 0
      ? { status: 'actionable', reason: 'At least one flow has comparable actionable evidence.' }
      : screened.some(
            (entry) =>
              entry.measurement === null ||
              ['no_confidence', 'needs_better_workload'].includes(entry.diagnosis.verdict.status)
          )
        ? {
            status: 'needs_better_workload',
            reason: 'Discovered flows lack comparable material application evidence.',
          }
        : screened.length > 0
          ? { status: 'measured', reason: 'Screened flows are measurable but not actionable.' }
          : { status: 'no_confidence', reason: 'No safe exact performance flow was discovered.' };

  return assertFlowCampaignPlan({
    schema_version: FLOW_CAMPAIGN_PLAN_SCHEMA_VERSION,
    subject: qualification.subject,
    policy: {
      max_flows: maxFlows,
      samples,
      warmups,
      timeout_ms: timeoutMs,
      ranking_formula: 'supported_scale_ms * frequency_weight * user_impact_weight',
    },
    inventory,
    screened,
    ranked,
    unverified,
    next_action: nextAction,
    limitations: [
      ...new Set([
        ...qualification.limitations,
        ...(priorityManifestPath
          ? []
          : ['No project priority manifest was supplied; production impact is not claimed.']),
      ]),
    ],
    verdict,
  });
}

function sourceAlignedRepeatability(capsule, diagnosis) {
  const repeatability = capsule.observed.profile_repeatability;
  if (!repeatability) return null;
  const hotspot = diagnosis.observed?.find(
    (observation) => observation.kind === 'repository_cpu_hotspot'
  )?.source;
  if (!hotspot?.reported_line || hotspot.reported_line === hotspot.line) return repeatability;

  const align = (candidate) => {
    if (
      !candidate ||
      candidate.file !== hotspot.file ||
      candidate.function !== hotspot.function ||
      candidate.line !== hotspot.reported_line
    ) {
      return candidate;
    }
    return { ...candidate, line: hotspot.line, reported_line: hotspot.reported_line };
  };

  return {
    ...repeatability,
    candidates: repeatability.candidates?.map(align) ?? [],
    candidate: align(repeatability.candidate),
  };
}

export async function loadFlowPriorityManifest(repositoryRoot, manifestPath) {
  const root = await realpath(resolve(repositoryRoot));
  const lexical = resolve(root, manifestPath);
  if (repositoryRelative(root, lexical) === null) {
    throw new Error('flow priority manifest must be contained by the repository');
  }
  const path = await realpath(lexical);
  if (repositoryRelative(root, path) === null) {
    throw new Error('flow priority manifest symlink escapes the repository');
  }
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MANIFEST_BYTES) {
    throw new Error('flow priority manifest must be a bounded regular file');
  }
  return assertFlowPriorityManifest(JSON.parse(await readFile(path, 'utf8')));
}

export function buildFlowInventory(qualification) {
  const eligible = [];
  const excluded = [];
  for (const candidate of qualification.candidates) {
    const reasons = [];
    const unsafeFlags = candidate.safety_flags.filter(
      (flag) =>
        flag.kind !== 'local_service_signal' ||
        !['node-test', 'vitest', 'jest'].includes(candidate.adapter)
    );
    if (unsafeFlags.length > 0) {
      reasons.push(...unsafeFlags.map((flag) => flag.kind));
    }
    if (!candidate.signals.some((signal) => DIRECT_MEASUREMENT_SIGNALS.has(signal.kind))) {
      reasons.push('missing_direct_timing_evidence');
    }
    const summary = candidateScope(candidate);
    if (reasons.length === 0) eligible.push(summary);
    else excluded.push({ candidate: summary, reasons: [...new Set(reasons)] });
  }
  return { eligible, excluded };
}

export function supportedScaleCost(diagnosis) {
  const scaleCurve = diagnosis.observed.find((entry) => entry.kind === 'input_scale_curve');
  const point = scaleCurve?.points?.at(-1);
  if (point && scaleCurve.unit === 'ms/op' && Number.isFinite(point.value)) {
    return {
      value_ms: point.value,
      input: point.input,
      unit: scaleCurve.unit,
      provenance: scaleCurve.provenance,
    };
  }
  const benchmark = diagnosis.observed.find((entry) => entry.kind === 'go_benchmark_measurement');
  const nanoseconds = benchmark?.ns_per_op?.median;
  if (Number.isFinite(nanoseconds)) {
    return {
      value_ms: round(nanoseconds / 1_000_000, 6),
      input: null,
      unit: 'ns/op',
      provenance: benchmark.provenance,
    };
  }
  return null;
}

function chooseNextAction({ ranked, screened, inventory }) {
  if (ranked.length > 0) {
    const leader = ranked[0];
    return {
      kind: 'initialize_optimization_campaign',
      candidate_id: leader.candidate.id,
      scope: {
        adapter: leader.candidate.adapter,
        target: leader.candidate.target,
        name: leader.candidate.name,
      },
      priority_score: leader.priority_score,
      required_manifest_inputs: [
        'allowed mutable files',
        'exact correctness scopes',
        'experiment budget',
        'stop conditions',
      ],
    };
  }
  const inadequate = screened.find(
    (entry) =>
      entry.measurement === null ||
      ['no_confidence', 'needs_better_workload'].includes(entry.diagnosis.verdict.status)
  );
  if (inadequate) {
    return {
      kind: 'author_representative_workload',
      candidate_id: inadequate.candidate.id,
      scope: {
        adapter: inadequate.candidate.adapter,
        target: inadequate.candidate.target,
        name: inadequate.candidate.name,
      },
    };
  }
  if (inventory.eligible.length === 0) {
    return { kind: 'author_local_performance_workload' };
  }
  return { kind: 'profile_another_repository' };
}

function candidateScope(candidate) {
  return {
    id: candidate.id,
    adapter: candidate.adapter,
    target: candidate.target,
    name: candidate.name,
    package_scope: candidate.package_scope,
    qualification_score: candidate.score,
  };
}

function emptyPriorityManifest() {
  return { schema_version: FLOW_PRIORITY_MANIFEST_SCHEMA_VERSION, flows: [] };
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
