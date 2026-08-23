import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import {
  CONTRACT_SCHEMA_VERSIONS,
  CORPUS_LIMITS,
  deriveContextProviderApprovalId,
  deriveContextProviderPlanId,
  sha256Bytes,
  validateContract,
} from './contracts.mjs';
import { DEFAULT_CORPUS_ROOT, resolveArtifact, validateCorpus } from './validate-corpus.mjs';

export const CONTEXT_EXPERIMENT_ID = 'code-context-provider-comparison';
export const CONTEXT_PLAN_LIMITATIONS = Object.freeze([
  'Stage 0 creates plans and capability evidence only; it does not launch providers or agents.',
  'A provider capability probe is not evidence of agent-quality improvement.',
  'Hidden executable checks remain the outcome authority for any later execution.',
]);
export const CONTEXT_DIAGNOSTICS = Object.freeze([
  'agent-cost',
  'context-tool-calls',
  'files-inspected',
  'files-modified',
  'input-tokens',
  'output-tokens',
]);

export function loadContextProviderProbe(path, { root = process.cwd() } = {}) {
  const declaredPath = repositoryRelativePath(root, path);
  const resolvedPath = resolveArtifact(root, declaredPath, CORPUS_LIMITS.maxDocumentBytes);
  const bytes = readFileSync(resolvedPath);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`invalid provider probe JSON at ${declaredPath}: ${message(error)}`);
  }
  const errors = validateContract('context-provider-probe', value);
  if (errors.length > 0) {
    throw new Error(`invalid provider probe at ${declaredPath}:\n${errors.join('\n')}`);
  }
  return {
    artifact: { path: declaredPath, sha256: sha256Bytes(bytes) },
    value,
  };
}

export async function planContextProviderExperiment({
  root = process.cwd(),
  corpusRoot = DEFAULT_CORPUS_ROOT,
  probePaths = [],
  stage = 'feasibility',
  aaRepetitions,
  agentProfile = unselectedAgentProfile(),
  availableEnvironmentNames = [],
  providerSnapshots = {},
} = {}) {
  if (!['probe', 'feasibility', 'full'].includes(stage)) {
    throw new Error(`unsupported experiment stage "${stage}"`);
  }
  const workspaceRoot = resolve(root);
  const absoluteCorpusRoot = resolve(workspaceRoot, corpusRoot);
  const validation = validateCorpus({ root: absoluteCorpusRoot });
  if (!validation.valid || !validation.publishable) {
    throw new Error(
      !validation.valid
        ? `corpus validation failed:\n${validation.errors.join('\n')}`
        : 'context-provider planning requires a publishable corpus'
    );
  }
  const probes = probePaths
    .map((path) => loadContextProviderProbe(path, { root: workspaceRoot }))
    .sort((left, right) => left.value.provider_id.localeCompare(right.value.provider_id));
  validateProbeCohort(probes);

  const corpusPath = resolveArtifact(
    absoluteCorpusRoot,
    'corpus.json',
    CORPUS_LIMITS.maxDocumentBytes
  );
  const corpusBytes = readFileSync(corpusPath);
  const corpusIndex = JSON.parse(corpusBytes.toString('utf8'));
  const selectedRows = selectTaskRows(validation.tasks, stage);
  const tasks = selectedRows
    .map((row) => taskPlanEntry(absoluteCorpusRoot, corpusIndex, row))
    .sort((left, right) => left.task_id.localeCompare(right.task_id));
  const repetitions = stage === 'probe' ? 0 : stage === 'feasibility' ? 2 : 3;
  const noiseRepetitions = resolveNoiseRepetitions(stage, aaRepetitions);
  const providers = probes.map(({ artifact, value }) => {
    const snapshots = contextSnapshots(value, stage, tasks, providerSnapshots[value.provider_id]);
    return {
      provider_id: value.provider_id,
      provider_version: value.provider_version,
      configuration_sha256: value.configuration_sha256,
      probe_sha256: artifact.sha256,
      role: value.context_kind === 'baseline' ? 'baseline' : 'treatment',
      context_kind: value.context_kind,
      interface_kind: value.interface_kind,
      operating_mode: value.operating_mode,
      data_egress: value.data_egress,
      cost_posture: value.cost.posture,
      max_usd_per_attempt: value.cost.max_usd_per_attempt,
      environment_names: [...value.environment_names],
      allowed_tools: [...value.tools.allowed],
      snapshots,
    };
  });
  const abSchedule = buildBalancedSchedule(tasks, providers, repetitions);
  const schedule =
    noiseRepetitions === 0
      ? abSchedule
      : [
          ...annotateComparisonArms(abSchedule, providers),
          ...buildNoiseSchedule(tasks, providers, noiseRepetitions, abSchedule.length),
        ];
  const environmentNames = [
    ...new Set([
      ...providers.flatMap((provider) => provider.environment_names),
      ...(agentProfile.environment_names ?? []),
    ]),
  ].sort();
  const available = new Set(availableEnvironmentNames);
  const environment = environmentNames.map((name) => ({ name, available: available.has(name) }));
  const cost = calculateCost({
    providers,
    agentProfile,
    tasks,
    repetitions,
    noiseRepetitions,
    attempts: schedule.length,
  });
  const approvals = {
    execution_required: true,
    paid_required:
      agentProfile.cost_posture !== 'free' ||
      providers.some((provider) => provider.cost_posture !== 'free'),
    hosted_required: providers.some((provider) => provider.operating_mode !== 'local'),
    data_egress_required: providers.some((provider) => provider.data_egress !== 'none'),
  };
  const blockedReasons = buildBlockedReasons({
    stage,
    agentProfile,
    providers,
    environment,
    cost,
    noiseRepetitions,
  });
  const normalizedAgentProfile = normalizeAgentProfile(agentProfile);
  const draft = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['context-provider-plan'],
    experiment_id: CONTEXT_EXPERIMENT_ID,
    stage,
    corpus: {
      path: repositoryRelativePath(workspaceRoot, corpusPath),
      sha256: sha256Bytes(corpusBytes),
    },
    corpus_id: validation.corpus.id,
    corpus_version: validation.corpus.version,
    agent_profile: normalizedAgentProfile,
    provider_probes: probes
      .map((probe) => probe.artifact)
      .sort((left, right) => left.path.localeCompare(right.path)),
    providers,
    tasks,
    repetitions,
    ...(noiseRepetitions === 0 ? {} : { aa_repetitions: noiseRepetitions }),
    schedule,
    counts: {
      providers: providers.length,
      tasks: tasks.length,
      repetitions,
      attempts: schedule.length,
      ...(noiseRepetitions === 0
        ? {}
        : {
            ab_attempts: schedule.filter((entry) => entry.comparison !== 'aa').length,
            aa_attempts: schedule.filter((entry) => entry.comparison === 'aa').length,
          }),
    },
    cost,
    environment,
    approvals: { ...approvals, approval_id: undefined },
    blocked_reasons: blockedReasons,
    diagnostics: [...CONTEXT_DIAGNOSTICS],
    limitations: [...CONTEXT_PLAN_LIMITATIONS],
  };
  const planId = deriveContextProviderPlanId(draft);
  const plan = {
    ...draft,
    plan_id: planId,
    approvals: { ...approvals, approval_id: deriveContextProviderApprovalId(planId) },
  };
  const errors = validateContract('context-provider-plan', plan);
  if (errors.length > 0) throw new Error(`invalid context-provider plan:\n${errors.join('\n')}`);
  return plan;
}

export function buildBalancedSchedule(tasks, providers, repetitions) {
  const schedule = [];
  let sequence = 1;
  for (const [taskIndex, task] of tasks.entries()) {
    for (let trialIndex = 1; trialIndex <= repetitions; trialIndex += 1) {
      const rotation = (taskIndex + trialIndex - 1) % providers.length;
      const ordered = [...providers.slice(rotation), ...providers.slice(0, rotation)];
      for (const [order, provider] of ordered.entries()) {
        schedule.push({
          sequence,
          task_id: task.task_id,
          trial_index: trialIndex,
          provider_id: provider.provider_id,
          order: order + 1,
        });
        sequence += 1;
      }
    }
  }
  return schedule;
}

function annotateComparisonArms(schedule, providers) {
  const roleById = new Map(providers.map((provider) => [provider.provider_id, provider.role]));
  return schedule.map((entry) => ({
    ...entry,
    comparison: 'ab',
    arm: roleById.get(entry.provider_id) === 'baseline' ? 'control' : 'treatment',
  }));
}

function buildNoiseSchedule(tasks, providers, repetitions, startSequence = 0) {
  const schedule = [];
  let sequence = startSequence + 1;
  for (const provider of providers.filter((candidate) => candidate.role === 'treatment')) {
    for (const task of tasks) {
      for (let trialIndex = 1; trialIndex <= repetitions; trialIndex += 1) {
        for (const [index, arm] of ['a', 'b'].entries()) {
          schedule.push({
            sequence,
            task_id: task.task_id,
            trial_index: trialIndex,
            provider_id: provider.provider_id,
            order: index + 1,
            comparison: 'aa',
            arm,
          });
          sequence += 1;
        }
      }
    }
  }
  return schedule;
}

export async function writeContextProviderPlan(path, plan) {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, destination);
}

function validateProbeCohort(probes) {
  if (probes.length < 1 || probes.length > 4)
    throw new Error('provider cohort requires 1-4 probes');
  const ids = probes.map((probe) => probe.value.provider_id);
  if (new Set(ids).size !== ids.length)
    throw new Error('provider cohort has duplicate provider identities');
  const baselines = probes.filter((probe) => probe.value.context_kind === 'baseline');
  if (baselines.length !== 1) throw new Error('provider cohort requires exactly one baseline');
  const unavailable = probes.filter((probe) => probe.value.setup.status !== 'eligible');
  if (unavailable.length > 0) {
    throw new Error(
      `provider cohort contains ineligible probes: ${unavailable.map((probe) => probe.value.provider_id).join(', ')}`
    );
  }
}

function selectTaskRows(rows, stage) {
  const qualified = rows
    .filter((row) => row.valid && row.qualified)
    .sort((left, right) => left.task_id.localeCompare(right.task_id));
  if (stage === 'probe') return [];
  if (stage === 'full') {
    if (qualified.length !== 30)
      throw new Error(`full stage requires exactly 30 tasks, found ${qualified.length}`);
    return qualified;
  }
  const selected = [];
  const categories = new Set();
  for (const lane of ['api', 'browser']) {
    const candidates = qualified.filter((row) => row.lane === lane);
    for (let count = 0; count < 2; count += 1) {
      const candidate =
        candidates.find((row) => !selected.includes(row) && !categories.has(row.category)) ??
        candidates.find((row) => !selected.includes(row));
      if (!candidate) throw new Error(`feasibility stage requires two qualified ${lane} tasks`);
      selected.push(candidate);
      categories.add(candidate.category);
    }
  }
  if (categories.size < 4)
    throw new Error('feasibility stage requires four distinct task categories');
  return selected;
}

function taskPlanEntry(corpusRoot, corpusIndex, row) {
  const entry = corpusIndex.tasks.find((candidate) => candidate.task_id === row.task_id);
  if (!entry) throw new Error(`task "${row.task_id}" is missing from the corpus index`);
  const manifestPath = resolveArtifact(
    corpusRoot,
    entry.manifest.path,
    CORPUS_LIMITS.maxDocumentBytes
  );
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return {
    task_id: row.task_id,
    manifest_sha256: row.manifest_sha256,
    fixture_sha256: manifest.artifacts.fixture.sha256,
    repository_revision: manifest.provenance.revision,
    lane: row.lane,
    runtime: row.runtime,
    category: row.category,
  };
}

function contextSnapshots(probe, stage, tasks, supplied = {}) {
  if (stage === 'probe' || probe.context_kind === 'baseline') {
    return [];
  }
  return tasks.map((task) => ({
    ...(supplied[task.task_id] ?? {
      status: 'pending',
      snapshot_id: null,
      indexed_revision: null,
    }),
    task_id: task.task_id,
    source_sha256: task.fixture_sha256,
  }));
}

function resolveNoiseRepetitions(stage, requested) {
  if (stage === 'probe') return 0;
  const value = requested ?? (stage === 'full' ? 2 : 0);
  if (!Number.isInteger(value) || value < 0 || value > 5) {
    throw new Error('A/A repetitions must be an integer between 0 and 5');
  }
  if (value === 1) {
    throw new Error('A/A noise evidence requires at least two repetitions per task');
  }
  return value;
}

function calculateCost({
  providers,
  agentProfile,
  tasks,
  repetitions,
  noiseRepetitions,
  attempts,
}) {
  const perAttempt = (cohort) =>
    cohort.reduce((total, provider) => total + provider.max_usd_per_attempt, 0);
  const contextMax = roundCost(
    perAttempt(providers) * tasks.length * repetitions +
      perAttempt(providers.filter((provider) => provider.role === 'treatment')) *
        tasks.length *
        noiseRepetitions *
        2
  );
  const agentMax =
    agentProfile.status === 'selected'
      ? roundCost(agentProfile.max_usd_per_attempt * attempts)
      : null;
  const unknown =
    agentProfile.cost_posture === 'unknown' ||
    providers.some((provider) => provider.cost_posture === 'unknown');
  const paid =
    agentProfile.cost_posture === 'paid' ||
    providers.some((provider) => provider.cost_posture === 'paid');
  return {
    posture: unknown ? 'unknown' : paid ? 'paid' : 'free',
    context_max_usd: contextMax,
    agent_max_usd: agentMax,
    total_max_usd: agentMax === null ? null : roundCost(contextMax + agentMax),
  };
}

function buildBlockedReasons({
  stage,
  agentProfile,
  providers,
  environment,
  cost,
  noiseRepetitions,
}) {
  if (stage === 'probe') return [];
  const reasons = [];
  if (stage === 'full' && noiseRepetitions === 0) reasons.push('aa-schedule-missing');
  if (agentProfile.status !== 'selected') reasons.push('agent-profile-unselected');
  if (cost.posture === 'unknown') reasons.push('unknown-cost-bound');
  for (const entry of environment) {
    if (!entry.available)
      reasons.push(`missing-environment-${entry.name.toLowerCase().replaceAll('_', '-')}`);
  }
  for (const provider of providers) {
    for (const snapshot of provider.snapshots) {
      if (snapshot.status === 'pending')
        reasons.push(`provider-snapshot-pending-${provider.provider_id}-${snapshot.task_id}`);
      if (snapshot.status === 'stale')
        reasons.push(`provider-snapshot-stale-${provider.provider_id}-${snapshot.task_id}`);
    }
  }
  return [...new Set(reasons)].sort();
}

function unselectedAgentProfile() {
  return {
    status: 'unselected',
    agent: null,
    model: null,
    adapter: null,
    configuration_sha256: null,
    environment_sha256: null,
    environment_names: [],
    cost_posture: 'unknown',
    max_usd_per_attempt: null,
  };
}

function normalizeAgentProfile(profile) {
  const { environment_names: _environmentNames, ...normalized } = profile;
  return normalized;
}

function repositoryRelativePath(root, path) {
  const absolute = resolve(root, path);
  const declared = relative(resolve(root), absolute).split(sep).join('/');
  if (declared === '' || declared.startsWith('../')) {
    throw new Error(`path must be inside the repository root: ${path}`);
  }
  return declared;
}

function roundCost(value) {
  if (value === 0) return 0;
  return Math.ceil(value * 1_000_000) / 1_000_000;
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
