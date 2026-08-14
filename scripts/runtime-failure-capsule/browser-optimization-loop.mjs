import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  BROWSER_OPTIMIZATION_EVENT_SCHEMA_VERSION,
  BROWSER_OPTIMIZATION_LIMITS,
  BROWSER_OPTIMIZATION_REPORT_SCHEMA_VERSION,
  assertBrowserOptimizationEvent,
  assertBrowserOptimizationLoopId,
  assertBrowserOptimizationPlan,
  assertBrowserOptimizationReport,
} from './browser-optimization-contracts.mjs';
import { createOptimizationCampaignService } from './campaign.mjs';
import { analyzeBrowserDependencies } from './browser-dependency-attribution.mjs';
import { verifyInitialRouteArtifactMovement } from './browser-artifact-verification.mjs';
import { ensureCodeVetterEvidenceRoot } from './evidence-root.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import { listPlaywrightCaptureEvidence } from './playwright-capture.mjs';
import { planBrowserOptimization } from './browser-optimization-planner.mjs';

const LOOPS_DIRECTORY = '.codevetter/browser-optimization-loops';
const LOOP_MANIFEST = 'loop.json';
const EVENTS_FILE = 'events.ndjson';

export async function createBrowserOptimizationLoopService(repositoryRoot, overrides = {}) {
  const root = await realpath(resolve(repositoryRoot));
  await ensureCodeVetterEvidenceRoot(root);
  const dependencies = {
    planner: planBrowserOptimization,
    campaignService: null,
    createCampaignService: createOptimizationCampaignService,
    inspectSubject: inspectGitDiff,
    inspectDependencies: analyzeBrowserDependencies,
    listCaptures: listPlaywrightCaptureEvidence,
    now: () => new Date(),
    ...overrides,
  };
  return {
    plan: (input) => planLoop(root, input, dependencies),
    next: (input) => nextExperiment(root, input, dependencies),
    evaluate: (input) => evaluateExperiment(root, input, dependencies),
    report: (input) => reportLoop(root, input, dependencies),
  };
}

async function planLoop(root, input, dependencies) {
  const request = assertPlanInput(input);
  const directory = await reserveLoopDirectory(root, request.loop_id);
  const plan = await dependencies.planner(root, request.planner);
  if (plan.loop_id !== request.loop_id || plan.generation !== 1) {
    throw new Error('browser optimization planner returned an incompatible initial plan');
  }
  await writeExclusiveJson(resolve(directory, `plan-${plan.generation}.json`), plan);
  await writeExclusiveJson(resolve(directory, LOOP_MANIFEST), {
    schema_version: 'browser-optimization-loop-manifest/v1',
    loop_id: request.loop_id,
    campaign_directory: request.campaign_directory,
    created_at: dependencies.now().toISOString(),
  });
  return deriveReport({ plan, events: [], current: plan.subject, now: dependencies.now() });
}

async function nextExperiment(root, input, dependencies) {
  const loopId = assertLoopInput(input);
  const loop = await loadLoop(root, loopId);
  const current = await dependencies.inspectSubject(root);
  return deriveReport({ ...loop, current, now: dependencies.now() });
}

async function evaluateExperiment(root, input, dependencies) {
  const request = assertEvaluateInput(input);
  const loop = await loadLoop(root, request.loop_id);
  const before = await dependencies.inspectSubject(root);
  const report = deriveReport({
    ...loop,
    current: before,
    now: dependencies.now(),
    forcedState: 'active',
  });
  const experiment = report.next_experiment;
  if (!experiment) throw new Error(`browser optimization loop cannot evaluate in ${report.state}`);
  if (before.source_snapshot_sha256 === loop.plan.subject.source_snapshot_sha256) {
    throw new Error('browser optimization candidate source edit was not observed');
  }
  assertExperimentBoundary(before.changed_files ?? [], experiment.allowed_files);

  const campaign = dependencies.campaignService ?? (await dependencies.createCampaignService(root));
  const campaignInput = {
    campaign_directory: loop.manifest.campaign_directory,
    hypothesis: experiment.hypothesis,
    incumbent_repository: request.incumbent_repository,
  };
  const artifactVerification = await verifyArtifactExperiment({
    root,
    experiment,
    plan: loop.plan,
    current: before,
    request,
    dependencies,
  });
  if (artifactVerification) campaignInput.artifact_verification = artifactVerification;
  let campaignResult = await campaign.screen(campaignInput);
  if (campaignResult.record.decision.status === 'promising') {
    campaignResult = await campaign.promote(campaignInput);
  }
  const decision = normalizeCampaignDecision(campaignResult.record.decision.status);
  const event = {
    schema_version: BROWSER_OPTIMIZATION_EVENT_SCHEMA_VERSION,
    sequence: loop.events.length + 1,
    generation: loop.plan.generation,
    experiment_id: experiment.experiment_id,
    decision,
    reason: campaignResult.record.decision.reason,
    campaign_record_digest: campaignResult.record.record_digest ?? null,
    subject: compactSubject(before),
    plan_digest: loop.plan.planner_digest,
    recorded_at: dependencies.now().toISOString(),
  };
  assertBrowserOptimizationEvent(event, {
    sequence: loop.events.length + 1,
    planDigest: loop.plan.planner_digest,
  });
  await appendEvent(loop.directory, loop.events, event);
  const events = [...loop.events, event];

  if (decision !== 'kept') {
    return deriveReport({ plan: loop.plan, events, current: before, now: dependencies.now() });
  }

  const captures = await dependencies.listCaptures(root);
  const capture = captures
    .filter(
      (entry) =>
        entry.state === 'succeeded' &&
        entry.subject?.repository_revision === before.repository_revision &&
        entry.subject?.source_snapshot_sha256 === before.source_snapshot_sha256 &&
        sameFlow(entry.scope, loop.plan.flow)
    )
    .at(-1);
  if (!capture) {
    return deriveReport({
      plan: loop.plan,
      events,
      current: before,
      now: dependencies.now(),
      forcedState: 'blocked_on_host',
    });
  }
  const nextPlan = await dependencies.planner(root, {
    ...request.replan,
    loop_id: request.loop_id,
    capture_id: capture.capture_id,
    generation: loop.plan.generation + 1,
    policy: loop.plan.policy,
    correctness_scope: experiment.correctness_scope,
  });
  await writeExclusiveJson(resolve(loop.directory, `plan-${nextPlan.generation}.json`), nextPlan);
  return deriveReport({ plan: nextPlan, events, current: before, now: dependencies.now() });
}

async function reportLoop(root, input, dependencies) {
  const loopId = assertLoopInput(input);
  const loop = await loadLoop(root, loopId);
  const current = await dependencies.inspectSubject(root);
  return deriveReport({ ...loop, current, now: dependencies.now() });
}

export function deriveReport({ plan, events, current, now, forcedState = null }) {
  const generationEvents = events.filter((event) => event.generation === plan.generation);
  const tried = new Set(generationEvents.map((event) => event.experiment_id));
  const untested = plan.queue.filter((experiment) => !tried.has(experiment.experiment_id));
  const rejected = events.filter((event) => event.decision === 'rejected');
  const verified = events.filter((event) => event.decision === 'kept');
  const failures = consecutive(events, new Set(['crash', 'no_confidence']));
  const nonImprovements = consecutive(events, new Set(['rejected', 'crash', 'no_confidence']));
  const elapsedMinutes = Math.max(0, (now.getTime() - Date.parse(plan.created_at)) / 60_000);
  const sourceMatches = current.source_snapshot_sha256 === plan.subject.source_snapshot_sha256;
  let state = forcedState ?? 'active';
  if (!forcedState && failures >= plan.policy.max_failures) state = 'operational_failure';
  else if (!forcedState && nonImprovements >= plan.policy.max_failures) state = 'plateau';
  else if (
    !forcedState &&
    (events.length >= plan.policy.max_experiments ||
      elapsedMinutes >= plan.policy.max_elapsed_minutes)
  ) {
    state = 'budget_exhausted';
  } else if (!forcedState && untested.length === 0) state = 'queue_exhausted';
  else if (!forcedState && events.at(-1)?.decision !== 'kept' && !sourceMatches) {
    state = 'blocked_on_host';
  }
  const next = state === 'active' ? (untested[0] ?? null) : null;
  return assertBrowserOptimizationReport({
    schema_version: BROWSER_OPTIMIZATION_REPORT_SCHEMA_VERSION,
    loop_id: plan.loop_id,
    generation: plan.generation,
    state,
    incumbent: plan.subject,
    next_experiment: next,
    verified_improvements: verified.map(compactEvent),
    rejected_experiments: events
      .filter((event) => ['rejected', 'crash', 'no_confidence'].includes(event.decision))
      .map(compactEvent),
    untested_experiments: untested,
    coverage: {
      evidence_families: plan.evidence.families,
      cause_groups: plan.cause_groups.length,
      queued: plan.queue.length,
      tested: tried.size,
      source_restoration_required: state === 'blocked_on_host' && !sourceMatches,
    },
    local_cost: {
      elapsed_minutes: Number(elapsedMinutes.toFixed(3)),
      experiments: events.length,
      failures,
    },
    limitations: plan.limitations,
  });
}

function assertPlanInput(value) {
  if (!plain(value)) throw new Error('browser optimization loop plan input must be an object');
  const allowed = new Set([
    'loop_id',
    'campaign_directory',
    'capture_id',
    'entry',
    'build_directory',
    'artifact_attestation',
    'correctness_scope',
    'policy',
  ]);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0)
    throw new Error(`loop plan input has unknown field: ${unknown.join(', ')}`);
  const loopId = assertBrowserOptimizationLoopId(value.loop_id);
  const campaignDirectory = assertCampaignDirectory(value.campaign_directory);
  return {
    loop_id: loopId,
    campaign_directory: campaignDirectory,
    planner: {
      loop_id: loopId,
      capture_id: value.capture_id,
      entry: value.entry,
      build_directory: value.build_directory,
      artifact_attestation: value.artifact_attestation,
      correctness_scope: value.correctness_scope,
      policy: value.policy,
      generation: 1,
    },
  };
}

function assertEvaluateInput(value) {
  if (!plain(value)) throw new Error('browser optimization evaluate input must be an object');
  const allowed = new Set([
    'loop_id',
    'incumbent_repository',
    'entry',
    'build_directory',
    'artifact_attestation',
  ]);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0)
    throw new Error(`loop evaluate input has unknown field: ${unknown.join(', ')}`);
  const loopId = assertBrowserOptimizationLoopId(value.loop_id);
  if (typeof value.incumbent_repository !== 'string' || value.incumbent_repository.length === 0) {
    throw new Error('incumbent_repository is required');
  }
  return {
    loop_id: loopId,
    incumbent_repository: value.incumbent_repository,
    build_directory: value.build_directory,
    artifact_attestation: assertArtifactAttestation(value.artifact_attestation),
    replan: {
      entry: value.entry,
      build_directory: value.build_directory,
      artifact_attestation: value.artifact_attestation,
    },
  };
}

function assertArtifactAttestation(value) {
  if (value === null || value === undefined) return null;
  if (
    !plain(value) ||
    Object.keys(value).some(
      (field) => !['source_snapshot_sha256', 'artifact_sha256'].includes(field)
    ) ||
    !/^[0-9a-f]{64}$/.test(value.source_snapshot_sha256 ?? '') ||
    !/^[0-9a-f]{64}$/.test(value.artifact_sha256 ?? '')
  ) {
    throw new Error('browser optimization artifact attestation is invalid');
  }
  return value;
}

async function verifyArtifactExperiment({
  root,
  experiment,
  plan,
  current,
  request,
  dependencies,
}) {
  if (experiment.predicted_metric.name !== 'initial_route_javascript_bytes') return null;
  const baseline = plan.evidence.observations.find(
    (entry) => entry.kind === 'initial_route_artifact_summary' && entry.verified === true
  );
  if (!baseline) {
    throw new Error('initial-route experiment requires an attested baseline build artifact');
  }
  const dependency = await dependencies.inspectDependencies({
    repositoryRoot: root,
    entry: request.replan.entry,
    buildDirectory: request.build_directory,
    subject: current,
    artifactAttestation: request.artifact_attestation,
  });
  const verification = verifyInitialRouteArtifactMovement({
    baseline: { state: 'observed', verified: true, ...baseline.metric },
    current: dependency.artifact,
    baselineSubject: plan.subject,
    currentSubject: current,
  });
  if (verification.verdict.status === 'no_confidence') {
    throw new Error(verification.verdict.reason);
  }
  return verification;
}

function assertLoopInput(value) {
  if (!plain(value) || Object.keys(value).some((field) => field !== 'loop_id')) {
    throw new Error('browser optimization loop input accepts only loop_id');
  }
  return assertBrowserOptimizationLoopId(value.loop_id);
}

function assertCampaignDirectory(value) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('.codevetter/optimization-campaigns/') ||
    value.split(/[\\/]/).includes('..') ||
    value.includes('\0')
  ) {
    throw new Error(
      'campaign_directory must be contained under .codevetter/optimization-campaigns'
    );
  }
  return value.replaceAll('\\', '/');
}

function assertExperimentBoundary(changedFiles, allowedFiles) {
  const forbidden = changedFiles.filter(
    (path) => !allowedFiles.some((allowed) => path === allowed || path.startsWith(`${allowed}/`))
  );
  if (forbidden.length > 0) {
    throw new Error(
      `browser experiment changed files outside its boundary: ${forbidden.slice(0, 8).join(', ')}`
    );
  }
}

function normalizeCampaignDecision(value) {
  if (value === 'keep') return 'kept';
  if (value === 'discard') return 'rejected';
  if (value === 'crash') return 'crash';
  return 'no_confidence';
}

async function reserveLoopDirectory(root, loopId) {
  const parent = resolve(root, LOOPS_DIRECTORY);
  await mkdir(parent, { recursive: true });
  const directory = resolve(parent, loopId);
  await mkdir(directory, { recursive: false });
  const real = await realpath(directory);
  if (!real.startsWith(`${await realpath(parent)}/`)) throw new Error('loop directory escapes');
  return real;
}

async function loadLoop(root, loopId) {
  const directory = resolve(root, LOOPS_DIRECTORY, loopId);
  const real = await realpath(directory);
  if (!real.startsWith(`${await realpath(resolve(root, LOOPS_DIRECTORY))}/`)) {
    throw new Error('browser optimization loop directory escapes');
  }
  const manifest = JSON.parse(await readFile(resolve(real, LOOP_MANIFEST), 'utf8'));
  if (
    manifest.schema_version !== 'browser-optimization-loop-manifest/v1' ||
    manifest.loop_id !== loopId ||
    assertCampaignDirectory(manifest.campaign_directory) !== manifest.campaign_directory
  ) {
    throw new Error('browser optimization loop manifest is invalid');
  }
  const entries = (await readdir(real))
    .map((name) => /^plan-(\d+)\.json$/.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .toSorted((left, right) => left - right);
  const generation = entries.at(-1);
  if (!generation) throw new Error('browser optimization loop has no plan');
  const plan = assertBrowserOptimizationPlan(
    JSON.parse(await readFile(resolve(real, `plan-${generation}.json`), 'utf8'))
  );
  const events = await loadEvents(real);
  return { directory: real, manifest, plan, events };
}

async function loadEvents(directory) {
  let source;
  try {
    source = await readFile(resolve(directory, EVENTS_FILE), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  if (Buffer.byteLength(source) > BROWSER_OPTIMIZATION_LIMITS.eventsBytes) {
    throw new Error('browser optimization event ledger exceeds its bound');
  }
  const events = [];
  for (const line of source.split('\n').filter(Boolean)) {
    events.push(assertBrowserOptimizationEvent(JSON.parse(line), { sequence: events.length + 1 }));
  }
  return events;
}

async function appendEvent(directory, existing, event) {
  const path = resolve(directory, EVENTS_FILE);
  const current = existing.map((entry) => `${JSON.stringify(entry)}\n`).join('');
  let disk = '';
  try {
    disk = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (disk !== current) throw new Error('browser optimization event ledger changed');
  const next = `${current}${JSON.stringify(event)}\n`;
  if (Buffer.byteLength(next) > BROWSER_OPTIMIZATION_LIMITS.eventsBytes) {
    throw new Error('browser optimization event ledger exceeds its bound');
  }
  await atomicReplace(path, next);
}

async function writeExclusiveJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 });
}

async function atomicReplace(path, value) {
  const temporary = `${path}.codevetter-${process.pid}.tmp`;
  try {
    await writeFile(temporary, value, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function sameFlow(scope, flow) {
  return (
    scope?.target === flow.target &&
    scope?.name === flow.name &&
    (scope?.browser_profile?.project_name ?? null) === flow.project
  );
}

function consecutive(events, decisions) {
  let count = 0;
  for (const event of events.toReversed()) {
    if (!decisions.has(event.decision)) break;
    count += 1;
  }
  return count;
}

function compactEvent(event) {
  return {
    generation: event.generation,
    experiment_id: event.experiment_id,
    decision: event.decision,
    reason: event.reason,
    recorded_at: event.recorded_at,
  };
}

function compactSubject(value) {
  return {
    repository_revision: value.repository_revision,
    source_snapshot_sha256: value.source_snapshot_sha256,
    dirty: value.dirty,
  };
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
