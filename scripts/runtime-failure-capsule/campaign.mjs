import { createHash } from 'node:crypto';
import { access, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

import {
  CAMPAIGN_LIMITS,
  CAMPAIGN_MANIFEST_SCHEMA_VERSION,
  CAMPAIGN_STATUS_SCHEMA_VERSION,
  assertCampaignManifest,
  assertCampaignRecord,
  createCampaignRecord,
  sha256,
  stableStringify,
} from './campaign-contracts.mjs';
import { assessChangeCost, inspectChangeCost } from './change-cost.mjs';
import { parseVitestSelection } from './capsule.mjs';
import { verifyOptimizationCapsules } from './optimization-verification.mjs';
import { verifyPairedRepositories } from './paired-verification.mjs';
import { profileRepository } from './performance.mjs';
import { redactText } from './redact.mjs';
import { runClosedAdapter } from './runner.mjs';

const MANIFEST_FILE = 'manifest.json';
const LEDGER_FILE = 'ledger.ndjson';
const EVIDENCE_DIRECTORY = 'evidence';
const ENGINE_FILES = [
  'campaign-contracts.mjs',
  'campaign.mjs',
  'capsule.mjs',
  'change-cost.mjs',
  'contracts.mjs',
  'optimization-verification.mjs',
  'paired-verification.mjs',
  'performance-diagnosis.mjs',
  'performance.mjs',
  'runner.mjs',
];

export async function createOptimizationCampaignService(repositoryRoot, overrides = {}) {
  const root = await realpath(resolve(repositoryRoot));
  const dependencies = {
    now: () => new Date(),
    engineIdentity: await optimizationCampaignEngineIdentity(),
    profileRepository,
    verifyOptimizationCapsules,
    verifyPairedRepositories,
    runClosedAdapter,
    ...overrides,
  };

  return {
    initialize: (input) => initializeCampaign(root, input, dependencies),
    baseline: (input) => baselineCampaign(root, input, dependencies),
    screen: (input) => screenCampaign(root, input, dependencies),
    promote: (input) => promoteCampaign(root, input, dependencies),
    inspect: (input) => inspectCampaign(root, input, dependencies),
    status: (input) => statusCampaign(root, input, dependencies),
    evidence: (input) => inspectCampaignEvidence(root, input),
  };
}

async function initializeCampaign(root, input, dependencies) {
  const campaign = await loadCampaignDirectory(root, requiredDirectory(input));
  campaign.engineIdentity = dependencies.engineIdentity;
  if (campaign.manifest.schema_version !== CAMPAIGN_MANIFEST_SCHEMA_VERSION) {
    throw new Error('campaign manifest schema is unsupported');
  }
  await assertMissing(campaign.ledgerPath, 'campaign ledger already exists');
  await mkdir(campaign.evidenceDirectory, { recursive: false });
  const repository = await inspectRepositoryState(root, campaign.manifest);
  assertAllowedChanges(campaign.manifest, repository.changed_files);
  const resolvedBase = (
    await runGit(root, ['rev-parse', `${campaign.manifest.repository_revision}^{commit}`])
  ).stdout.trim();
  if (repository.revision !== resolvedBase) {
    throw new Error('campaign must initialize at the declared repository revision');
  }
  const recordedAt = dependencies.now().toISOString();
  const record = createCampaignRecord({
    campaign_id: campaign.manifest.campaign_id,
    sequence: 0,
    attempt: 0,
    kind: 'initialized',
    recorded_at: recordedAt,
    manifest_digest: campaign.manifestDigest,
    engine: campaign.engineIdentity,
    repository,
    hypothesis: null,
    correctness: [],
    performance: null,
    complexity: complexityMovement(repository.complexity, repository.complexity),
    decision: {
      status: 'initialized',
      reason: 'Campaign scope and starting repository identity were recorded.',
    },
    limitations: [],
    previous_record_digest: null,
  });
  await appendRecord(campaign, record);
  return campaignReport(campaign.manifest, [record], dependencies.now());
}

async function baselineCampaign(root, input, dependencies) {
  const campaign = await loadCampaign(root, requiredDirectory(input));
  assertCampaignEngine(campaign, dependencies.engineIdentity);
  const priorStatus = deriveCampaignStatus(campaign.manifest, campaign.records, dependencies.now());
  if (priorStatus.incumbent) throw new Error('campaign baseline already exists');
  if (priorStatus.status === 'stopped')
    throw new Error(`campaign stopped: ${priorStatus.stop_reason}`);

  const repository = await inspectRepositoryState(root, campaign.manifest);
  assertAllowedChanges(campaign.manifest, repository.changed_files);
  const correctness = await runCorrectness(root, campaign.manifest.correctness, dependencies);
  let performance = null;
  let evidence = { correctness: correctness.results, performance_capsule: null };
  let decision;
  const limitations = [...correctness.limitations];

  if (correctness.status === 'passed') {
    try {
      const scope = campaign.manifest.performance;
      const capsule = await dependencies.profileRepository({
        repositoryRoot: root,
        adapter: scope.adapter,
        target: scope.target,
        name: scope.name,
        timeoutMs: scope.timeout_ms,
        samples: scope.screening.samples,
        warmups: scope.screening.warmups,
      });
      evidence = { correctness: correctness.results, performance_capsule: capsule };
      if (capsule.verdict.status === 'no_confidence') {
        limitations.push(...capsule.limitations);
        decision = {
          status: 'no_confidence',
          reason: 'The baseline performance scope did not produce qualified evidence.',
        };
      } else {
        decision = {
          status: 'baseline_ready',
          reason: 'All correctness scopes passed and the performance baseline completed.',
        };
      }
    } catch (error) {
      limitations.push(sanitizeMessage(error, root));
      decision = {
        status: 'no_confidence',
        reason: 'The baseline performance scope could not be captured.',
      };
    }
  } else {
    decision = {
      status: 'no_confidence',
      reason: 'The baseline did not pass every declared correctness scope.',
    };
  }

  const evidenceReference = await writeEvidence(
    campaign,
    campaign.records.length,
    'baseline',
    evidence
  );
  performance = evidenceReference;
  const record = nextRecord(campaign, {
    attempt: 0,
    kind: 'baseline',
    repository,
    hypothesis: null,
    correctness: correctness.results,
    performance,
    complexity: complexityMovement(
      campaign.records[0].repository.complexity,
      repository.complexity
    ),
    decision,
    limitations: [...new Set(limitations)],
    recordedAt: dependencies.now().toISOString(),
  });
  await appendRecord(campaign, record);
  return campaignReport(campaign.manifest, [...campaign.records, record], dependencies.now());
}

async function screenCampaign(root, input, dependencies) {
  const campaign = await loadCampaign(root, requiredDirectory(input));
  assertCampaignEngine(campaign, dependencies.engineIdentity);
  const status = deriveCampaignStatus(campaign.manifest, campaign.records, dependencies.now());
  if (status.status === 'stopped') throw new Error(`campaign stopped: ${status.stop_reason}`);
  if (!status.incumbent) throw new Error('campaign requires a qualified baseline');
  if (status.next_action?.kind === 'promote_candidate') {
    throw new Error('the latest promising candidate must be promoted or discarded first');
  }
  const hypothesis = sanitizeHypothesis(input?.hypothesis, root);
  const repository = await inspectRepositoryState(root, campaign.manifest);
  assertAllowedChanges(campaign.manifest, repository.changed_files);
  if (repository.diff_digest === status.incumbent.repository.diff_digest) {
    throw new Error('candidate source identity matches the incumbent');
  }
  const changeCost = assessChangeCost(
    await inspectChangeCost(root, repository.changed_files, repository.base_revision),
    { allowedFiles: campaign.manifest.allowed_files }
  );
  const attempt = status.experiments + 1;
  const correctness =
    changeCost.violations.length === 0
      ? await runCorrectness(root, campaign.manifest.correctness, dependencies)
      : { status: 'not_run', results: [], limitations: [] };
  const limitations = [...correctness.limitations];
  let evidence = {
    correctness: correctness.results,
    performance_capsule: null,
    verification: null,
    change_cost: changeCost,
  };
  let decision;

  if (changeCost.violations.length > 0) {
    decision = {
      status: 'discard',
      reason: `Candidate exceeded its change-cost budget: ${changeCost.violations.join(', ')}.`,
    };
  } else if (correctness.status !== 'passed') {
    decision = correctnessDecision(correctness.status);
  } else {
    try {
      const baselineEvidence = await loadEvidence(campaign, status.incumbent.performance);
      const baseline = incumbentCapsule(baselineEvidence, status.incumbent);
      const scope = campaign.manifest.performance;
      const current = await dependencies.profileRepository({
        repositoryRoot: root,
        adapter: scope.adapter,
        target: scope.target,
        name: scope.name,
        timeoutMs: scope.timeout_ms,
        samples: scope.screening.samples,
        warmups: scope.screening.warmups,
      });
      const verification = dependencies.verifyOptimizationCapsules(baseline, current);
      evidence = {
        correctness: correctness.results,
        performance_capsule: current,
        verification,
        change_cost: changeCost,
      };
      limitations.push(...verification.limitations);
      decision = screeningDecision(verification);
    } catch (error) {
      limitations.push(sanitizeMessage(error, root));
      decision = {
        status: 'no_confidence',
        reason: 'Candidate performance evidence could not be compared with the incumbent.',
      };
    }
  }

  const evidenceReference = await writeEvidence(
    campaign,
    campaign.records.length,
    `screen-${attempt}`,
    evidence
  );
  const record = nextRecord(campaign, {
    attempt,
    kind: 'screen',
    repository,
    hypothesis,
    correctness: correctness.results,
    performance: evidenceReference,
    complexity: complexityMovement(status.incumbent.repository.complexity, repository.complexity),
    decision,
    limitations: [...new Set(limitations)],
    recordedAt: dependencies.now().toISOString(),
  });
  await appendRecord(campaign, record);
  return campaignReport(campaign.manifest, [...campaign.records, record], dependencies.now());
}

async function promoteCampaign(root, input, dependencies) {
  const campaign = await loadCampaign(root, requiredDirectory(input));
  assertCampaignEngine(campaign, dependencies.engineIdentity);
  const status = deriveCampaignStatus(campaign.manifest, campaign.records, dependencies.now());
  if (status.status === 'stopped') throw new Error(`campaign stopped: ${status.stop_reason}`);
  if (status.next_action?.kind !== 'promote_candidate') {
    throw new Error('campaign has no promising candidate awaiting promotion');
  }
  const promising = campaign.records.at(-1);
  const hypothesis = sanitizeHypothesis(input?.hypothesis, root);
  if (hypothesis !== promising.hypothesis) {
    throw new Error('promotion hypothesis must exactly match the screened candidate');
  }
  if (typeof input?.incumbent_repository !== 'string' || input.incumbent_repository.trim() === '') {
    throw new Error('incumbent_repository is required for paired promotion');
  }
  const incumbentRoot = await realpath(resolve(input.incumbent_repository));
  if (incumbentRoot === root) throw new Error('incumbent and candidate repositories must differ');
  const [candidateRepository, incumbentRepository] = await Promise.all([
    inspectRepositoryState(root, campaign.manifest),
    inspectRepositoryState(incumbentRoot, campaign.manifest),
  ]);
  assertAllowedChanges(campaign.manifest, candidateRepository.changed_files);
  assertAllowedChanges(campaign.manifest, incumbentRepository.changed_files);
  if (candidateRepository.diff_digest !== promising.repository.diff_digest) {
    throw new Error('candidate source changed after screening');
  }
  if (incumbentRepository.diff_digest !== status.incumbent.repository.diff_digest) {
    throw new Error('incumbent checkout does not match the recorded incumbent');
  }

  const [incumbentCorrectness, candidateCorrectness] = await Promise.all([
    runCorrectness(incumbentRoot, campaign.manifest.correctness, dependencies, 'incumbent'),
    runCorrectness(root, campaign.manifest.correctness, dependencies, 'candidate'),
  ]);
  const correctness = [...incumbentCorrectness.results, ...candidateCorrectness.results];
  const limitations = [...incumbentCorrectness.limitations, ...candidateCorrectness.limitations];
  let evidence = { correctness, verification: null };
  let decision;

  if (incumbentCorrectness.status !== 'passed') {
    decision = {
      status: 'no_confidence',
      reason: 'The independently runnable incumbent failed its correctness gate.',
    };
  } else if (candidateCorrectness.status !== 'passed') {
    decision = correctnessDecision(candidateCorrectness.status);
  } else {
    try {
      const scope = campaign.manifest.performance;
      const verification = await dependencies.verifyPairedRepositories({
        baselineRepositoryRoot: incumbentRoot,
        currentRepositoryRoot: root,
        adapter: scope.adapter,
        target: scope.target,
        name: scope.name,
        timeoutMs: scope.timeout_ms,
        samples: scope.promotion.samples,
        warmups: scope.promotion.warmups,
      });
      evidence = { correctness, verification };
      limitations.push(...verification.limitations);
      decision = promotionDecision(verification);
    } catch (error) {
      limitations.push(sanitizeMessage(error, root, [incumbentRoot]));
      decision = {
        status: 'no_confidence',
        reason: 'Paired promotion evidence could not be completed.',
      };
    }
  }

  const evidenceReference = await writeEvidence(
    campaign,
    campaign.records.length,
    `promotion-${promising.attempt}`,
    evidence
  );
  const record = nextRecord(campaign, {
    attempt: promising.attempt,
    kind: 'promotion',
    repository: candidateRepository,
    hypothesis,
    correctness,
    performance: evidenceReference,
    complexity: complexityMovement(
      status.incumbent.repository.complexity,
      candidateRepository.complexity
    ),
    decision,
    limitations: [...new Set(limitations)],
    recordedAt: dependencies.now().toISOString(),
  });
  await appendRecord(campaign, record);
  return campaignReport(campaign.manifest, [...campaign.records, record], dependencies.now());
}

async function inspectCampaign(root, input, dependencies) {
  const campaign = await loadCampaign(root, requiredDirectory(input));
  return {
    manifest: campaign.manifest,
    manifest_digest: campaign.manifestDigest,
    records: campaign.records,
    status: deriveCampaignStatus(campaign.manifest, campaign.records, dependencies.now()),
  };
}

async function statusCampaign(root, input, dependencies) {
  const campaign = await loadCampaign(root, requiredDirectory(input));
  return deriveCampaignStatus(campaign.manifest, campaign.records, dependencies.now());
}

async function inspectCampaignEvidence(root, input) {
  const campaign = await loadCampaign(root, requiredDirectory(input));
  if (!Number.isInteger(input.record_sequence) || input.record_sequence < 0) {
    throw new Error('record_sequence must be a non-negative integer');
  }
  const record = campaign.records[input.record_sequence];
  if (!record?.performance) throw new Error('campaign record has no performance evidence');
  return { record, evidence: await loadEvidence(campaign, record.performance) };
}

export function deriveCampaignStatus(manifest, records, now = new Date()) {
  const incumbent = [...records]
    .reverse()
    .find((record) => ['baseline_ready', 'keep'].includes(record.decision.status));
  const screens = records.filter((record) => record.kind === 'screen');
  const attemptRecords = new Map();
  for (const record of records.filter((candidate) => candidate.attempt > 0)) {
    attemptRecords.set(record.attempt, record);
  }
  const terminalAttempts = [...attemptRecords.values()].sort(
    (left, right) => left.attempt - right.attempt
  );
  let consecutiveNonImprovements = 0;
  let consecutiveCrashes = 0;
  for (const record of terminalAttempts) {
    if (record.decision.status === 'keep') {
      consecutiveNonImprovements = 0;
      consecutiveCrashes = 0;
    } else if (record.decision.status === 'promising') {
      // Promotion is still pending, so this attempt is not terminal.
    } else {
      consecutiveNonImprovements += 1;
      consecutiveCrashes = record.decision.status === 'crash' ? consecutiveCrashes + 1 : 0;
    }
  }
  const startedAt = records[0]?.recorded_at ?? now.toISOString();
  const elapsedMinutes = Math.max(0, (now.getTime() - Date.parse(startedAt)) / 60_000);
  let stopReason = null;
  if (screens.length >= manifest.budgets.max_experiments) stopReason = 'experiment_budget';
  else if (elapsedMinutes >= manifest.budgets.max_elapsed_minutes)
    stopReason = 'elapsed_time_budget';
  else if (consecutiveCrashes >= manifest.budgets.max_consecutive_crashes)
    stopReason = 'consecutive_crashes';
  else if (consecutiveNonImprovements >= manifest.budgets.max_consecutive_non_improvements)
    stopReason = 'plateau';

  const latest = records.at(-1) ?? null;
  let status;
  let nextAction;
  if (stopReason) {
    status = 'stopped';
    nextAction = null;
  } else if (!incumbent) {
    status = latest?.kind === 'baseline' ? 'no_confidence' : 'needs_baseline';
    nextAction = {
      kind: 'capture_baseline',
      summary: 'Run all declared correctness scopes and capture the immutable baseline.',
    };
  } else if (latest?.decision.status === 'promising') {
    status = 'needs_promotion';
    nextAction = {
      kind: 'promote_candidate',
      attempt: latest.attempt,
      summary: 'Run paired promotion against an independently runnable incumbent checkout.',
    };
  } else {
    status = 'active';
    nextAction = {
      kind: 'propose_candidate',
      attempt: screens.length + 1,
      summary: 'Inspect incumbent evidence, apply one bounded hypothesis, and screen it.',
    };
  }
  return {
    schema_version: CAMPAIGN_STATUS_SCHEMA_VERSION,
    campaign_id: manifest.campaign_id,
    status,
    stop_reason: stopReason,
    experiments: screens.length,
    remaining_experiments: Math.max(0, manifest.budgets.max_experiments - screens.length),
    elapsed_minutes: round(elapsedMinutes),
    consecutive_non_improvements: consecutiveNonImprovements,
    consecutive_crashes: consecutiveCrashes,
    incumbent: incumbent ? compactRecord(incumbent) : null,
    latest: latest ? compactRecord(latest) : null,
    next_action: nextAction,
  };
}

async function runCorrectness(root, scopes, dependencies, role = 'candidate') {
  const results = [];
  const limitations = [];
  for (const scope of scopes) {
    const execution = await dependencies.runClosedAdapter({
      repositoryRoot: root,
      adapter: scope.adapter,
      target: scope.target,
      name: scope.name,
      timeoutMs: scope.timeout_ms,
    });
    const normalized = normalizeCorrectnessExecution(scope, execution, role);
    results.push(normalized);
    if (normalized.limitation) limitations.push(normalized.limitation);
  }
  const statuses = new Set(results.map((result) => result.status));
  const status = statuses.has('crash')
    ? 'crash'
    : statuses.has('failed')
      ? 'failed'
      : statuses.has('no_confidence')
        ? 'no_confidence'
        : 'passed';
  return { status, results, limitations };
}

export function normalizeCorrectnessExecution(scope, execution, role = 'candidate') {
  let selection = null;
  let status = 'no_confidence';
  let limitation = null;
  if (execution.status === 'timeout' || execution.status === 'operational_failure') {
    status = 'crash';
    limitation =
      execution.status === 'timeout'
        ? 'Correctness execution timed out.'
        : 'Correctness execution was operationally unavailable.';
  } else if (execution.status !== 'exited') {
    limitation = 'Correctness execution did not reach a terminal process result.';
  } else if (execution.exitCode !== 0) {
    status = 'failed';
  } else if (execution.truncated) {
    limitation = 'Correctness output was truncated before exact selection could be proven.';
  } else {
    selection = exactSelection(scope, execution.stdout);
    if (selection.executed === 1 && selection.failed === 0) status = 'passed';
    else {
      limitation = `Correctness scope selected ${selection.executed} passing or failing tests instead of exactly one.`;
    }
  }
  return {
    role,
    scope: { adapter: scope.adapter, target: scope.target, name: scope.name },
    status,
    exit_code: execution.exitCode,
    duration_ms: execution.durationMs,
    selection,
    limitation,
  };
}

function exactSelection(scope, stdout) {
  if (scope.adapter === 'vitest') {
    const parsed = parseVitestSelection(stdout);
    return {
      executed: parsed?.executed_tests ?? 0,
      failed: parsed?.failed_tests ?? 0,
    };
  }
  if (scope.adapter === 'node-test') {
    return {
      executed: numberFromOutput(stdout, /^# pass\s+(\d+)\s*$/m),
      failed: numberFromOutput(stdout, /^# fail\s+(\d+)\s*$/m),
    };
  }
  if (scope.adapter === 'go-test') {
    let executed = 0;
    let failed = 0;
    for (const line of String(stdout).split(/\r?\n/)) {
      try {
        const event = JSON.parse(line);
        if (event.Test === scope.name && ['pass', 'fail'].includes(event.Action)) {
          executed += 1;
          if (event.Action === 'fail') failed += 1;
        }
      } catch {
        // Go test JSON is line-delimited; non-JSON noise does not prove selection.
      }
    }
    return { executed, failed };
  }
  return { executed: 0, failed: 0 };
}

async function loadCampaignDirectory(root, campaignDirectory) {
  const relativeDirectory = safeCampaignDirectory(campaignDirectory);
  const absoluteDirectory = resolve(root, relativeDirectory);
  assertContained(root, absoluteDirectory, 'campaign directory');
  const canonicalDirectory = await realpath(absoluteDirectory);
  assertContained(root, canonicalDirectory, 'campaign directory');
  const manifestPath = resolve(canonicalDirectory, MANIFEST_FILE);
  const details = await stat(manifestPath);
  if (!details.isFile() || details.size > 128 * 1024) {
    throw new Error('campaign manifest must be a regular file no larger than 128 KiB');
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error('campaign manifest is not valid JSON');
  }
  assertCampaignManifest(manifest);
  if (manifest.artifact_directory !== relativeDirectory) {
    throw new Error('manifest artifact_directory does not match the selected campaign directory');
  }
  return {
    root,
    relativeDirectory,
    absoluteDirectory: canonicalDirectory,
    manifest,
    manifestDigest: sha256(stableStringify(manifest)),
    ledgerPath: resolve(canonicalDirectory, LEDGER_FILE),
    evidenceDirectory: resolve(canonicalDirectory, EVIDENCE_DIRECTORY),
  };
}

async function loadCampaign(root, campaignDirectory) {
  const campaign = await loadCampaignDirectory(root, campaignDirectory);
  const details = await stat(campaign.ledgerPath);
  if (!details.isFile() || details.size > CAMPAIGN_LIMITS.ledgerBytes) {
    throw new Error(
      `campaign ledger exceeds ${CAMPAIGN_LIMITS.ledgerBytes} bytes or is unavailable`
    );
  }
  const source = await readFile(campaign.ledgerPath, 'utf8');
  const lines = source.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0 || lines.length > CAMPAIGN_LIMITS.experiments * 3) {
    throw new Error('campaign ledger has an invalid record count');
  }
  const records = [];
  for (let index = 0; index < lines.length; index += 1) {
    let record;
    try {
      record = JSON.parse(lines[index]);
    } catch {
      throw new Error(`campaign ledger line ${index + 1} is not valid JSON`);
    }
    assertCampaignRecord(record, {
      manifestDigest: campaign.manifestDigest,
      sequence: index,
      previousDigest: records.at(-1)?.record_digest ?? null,
    });
    if (record.campaign_id !== campaign.manifest.campaign_id) {
      throw new Error('campaign record identity does not match the manifest');
    }
    records.push(record);
  }
  const loaded = { ...campaign, records };
  for (const record of records) {
    if (record.performance) await loadEvidence(loaded, record.performance);
  }
  return loaded;
}

async function appendRecord(campaign, record) {
  const records = campaign.records ?? [];
  assertCampaignRecord(record, {
    manifestDigest: campaign.manifestDigest,
    sequence: records.length,
    previousDigest: records.at(-1)?.record_digest ?? null,
  });
  const line = `${stableStringify(record)}\n`;
  let current = '';
  try {
    current = await readFile(campaign.ledgerPath, 'utf8');
  } catch {
    // The initialization record creates the ledger.
  }
  const expected = records.map((entry) => `${stableStringify(entry)}\n`).join('');
  if (current !== expected) {
    throw new Error('campaign ledger changed during the operation');
  }
  const next = `${current}${line}`;
  if (Buffer.byteLength(next) > CAMPAIGN_LIMITS.ledgerBytes) {
    throw new Error('campaign ledger size limit exceeded');
  }
  const temporary = `${campaign.ledgerPath}.codevetter-${process.pid}-${record.sequence}.tmp`;
  try {
    await writeFile(temporary, next, { flag: 'wx' });
    await rename(temporary, campaign.ledgerPath);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function writeEvidence(campaign, sequence, label, value) {
  const source = `${stableStringify(value)}\n`;
  const bytes = Buffer.byteLength(source);
  if (bytes > CAMPAIGN_LIMITS.evidenceBytes)
    throw new Error('campaign evidence size limit exceeded');
  const filename = `${String(sequence).padStart(4, '0')}-${label}.json`;
  const absolute = resolve(campaign.evidenceDirectory, filename);
  const temporary = `${absolute}.codevetter-${process.pid}.tmp`;
  await assertMissing(absolute, 'campaign evidence already exists');
  try {
    await writeFile(temporary, source, { flag: 'wx' });
    await rename(temporary, absolute);
  } finally {
    await rm(temporary, { force: true });
  }
  return {
    path: `${campaign.relativeDirectory}/${EVIDENCE_DIRECTORY}/${filename}`,
    sha256: sha256(source),
    bytes,
  };
}

async function loadEvidence(campaign, reference) {
  if (!reference?.path || !reference?.sha256) throw new Error('incumbent evidence is unavailable');
  const absolute = resolve(campaign.root, reference.path);
  assertContained(campaign.absoluteDirectory, absolute, 'campaign evidence');
  const details = await stat(absolute);
  if (!details.isFile() || details.size > CAMPAIGN_LIMITS.evidenceBytes) {
    throw new Error('campaign evidence is unavailable or oversized');
  }
  const source = await readFile(absolute, 'utf8');
  if (sha256(source) !== reference.sha256) throw new Error('campaign evidence digest mismatch');
  try {
    return JSON.parse(source);
  } catch {
    throw new Error('campaign evidence is not valid JSON');
  }
}

function incumbentCapsule(evidence, incumbent) {
  if (incumbent.kind === 'promotion') return evidence?.verification?.current_capsule;
  return evidence?.performance_capsule;
}

function nextRecord(campaign, payload) {
  return createCampaignRecord({
    campaign_id: campaign.manifest.campaign_id,
    sequence: campaign.records.length,
    attempt: payload.attempt,
    kind: payload.kind,
    recorded_at: payload.recordedAt,
    manifest_digest: campaign.manifestDigest,
    engine: campaign.engineIdentity,
    repository: payload.repository,
    hypothesis: payload.hypothesis,
    correctness: payload.correctness,
    performance: payload.performance,
    complexity: payload.complexity,
    decision: payload.decision,
    limitations: payload.limitations,
    previous_record_digest: campaign.records.at(-1).record_digest,
  });
}

function screeningDecision(verification) {
  if (
    verification.verdict.status === 'confirmed' &&
    verification.decisions.mechanically_confirmed &&
    verification.decisions.materially_useful
  ) {
    return {
      status: 'promising',
      reason:
        'Screening found a material correctness-preserving improvement; paired promotion is required.',
    };
  }
  if (verification.verdict.status === 'no_confidence') {
    return { status: 'no_confidence', reason: verification.verdict.reason };
  }
  return {
    status: 'discard',
    reason: `Screening did not confirm a material improvement: ${verification.verdict.reason}`,
  };
}

function promotionDecision(verification) {
  if (
    verification.verdict.status === 'confirmed' &&
    verification.decisions.mechanically_confirmed &&
    verification.decisions.materially_useful &&
    verification.decisions.shipping_recommended &&
    verification.limitations.length === 0
  ) {
    return {
      status: 'keep',
      reason: 'Correctness passed and stable paired evidence met the promotion policy.',
    };
  }
  if (verification.verdict.status === 'no_confidence') {
    return { status: 'no_confidence', reason: verification.verdict.reason };
  }
  return {
    status: 'discard',
    reason: `Promotion did not meet the keep policy: ${verification.verdict.reason}`,
  };
}

function correctnessDecision(status) {
  if (status === 'crash') {
    return { status: 'crash', reason: 'A declared correctness scope crashed or timed out.' };
  }
  if (status === 'failed') {
    return { status: 'discard', reason: 'A declared correctness scope failed.' };
  }
  return {
    status: 'no_confidence',
    reason: 'Exact correctness selection could not be proven.',
  };
}

export async function inspectRepositoryState(root, manifest) {
  const baseRevision = (
    await runGit(root, ['rev-parse', `${manifest.repository_revision}^{commit}`])
  ).stdout.trim();
  const revision = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const tracked = splitZero(
    (await runGit(root, ['diff', '--name-only', '-z', baseRevision, '--'])).stdout
  );
  const untracked = splitZero(
    (await runGit(root, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout
  );
  const changedFiles = [...new Set([...tracked, ...untracked])]
    .filter((path) => !insideDirectory(path, manifest.artifact_directory))
    .sort();
  const trackedChanged = changedFiles.filter((path) => tracked.includes(path));
  const untrackedChanged = changedFiles.filter((path) => untracked.includes(path));
  const hash = createHash('sha256');
  hash.update(`base:${baseRevision}\n`);
  if (trackedChanged.length > 0) {
    hash.update(
      (await runGit(root, ['diff', '--binary', baseRevision, '--', ...trackedChanged])).stdout
    );
  }
  let added = 0;
  let deleted = 0;
  if (trackedChanged.length > 0) {
    const numstat = (
      await runGit(root, ['diff', '--numstat', baseRevision, '--', ...trackedChanged])
    ).stdout;
    for (const line of numstat.split(/\r?\n/)) {
      const [left, right] = line.split('\t');
      if (/^\d+$/.test(left)) added += Number(left);
      if (/^\d+$/.test(right)) deleted += Number(right);
    }
  }
  let untrackedBytes = 0;
  for (const path of untrackedChanged) {
    const absolute = resolve(root, path);
    assertContained(root, absolute, 'untracked campaign source');
    const details = await stat(absolute);
    if (!details.isFile()) throw new Error(`changed source is not a regular file: ${path}`);
    untrackedBytes += details.size;
    if (untrackedBytes > CAMPAIGN_LIMITS.evidenceBytes) {
      throw new Error('untracked candidate source exceeds campaign evidence bounds');
    }
    const bytes = await readFile(absolute);
    hash.update(`untracked:${path}:${bytes.length}\n`);
    hash.update(bytes);
    added += countLines(bytes.toString('utf8'));
  }
  return {
    revision,
    base_revision: baseRevision,
    diff_digest: hash.digest('hex'),
    dirty: changedFiles.length > 0,
    changed_files: changedFiles,
    complexity: { files: changedFiles.length, added_lines: added, deleted_lines: deleted },
  };
}

function assertAllowedChanges(manifest, changedFiles) {
  const forbidden = changedFiles.filter(
    (path) => !manifest.allowed_files.some((allowed) => pathMatchesAllowed(path, allowed))
  );
  if (forbidden.length > 0) {
    throw new Error(
      `candidate changed files outside allowed_files: ${forbidden.slice(0, 8).join(', ')}`
    );
  }
}

function pathMatchesAllowed(path, allowed) {
  return allowed.endsWith('/') ? path.startsWith(allowed) : path === allowed;
}

function complexityMovement(incumbent, candidate) {
  const baseline = incumbent ?? { files: 0, added_lines: 0, deleted_lines: 0 };
  const current = candidate ?? { files: 0, added_lines: 0, deleted_lines: 0 };
  return {
    files_changed: current.files,
    added_lines: current.added_lines,
    deleted_lines: current.deleted_lines,
    delta_added_lines: current.added_lines - baseline.added_lines,
    delta_deleted_lines: current.deleted_lines - baseline.deleted_lines,
  };
}

function campaignReport(manifest, records, now) {
  return {
    campaign_id: manifest.campaign_id,
    record: compactRecord(records.at(-1)),
    status: deriveCampaignStatus(manifest, records, now),
  };
}

function compactRecord(record) {
  return {
    sequence: record.sequence,
    attempt: record.attempt,
    kind: record.kind,
    recorded_at: record.recorded_at,
    engine: record.engine,
    repository: record.repository,
    hypothesis: record.hypothesis,
    performance: record.performance,
    complexity: record.complexity,
    decision: record.decision,
    limitations: record.limitations,
    record_digest: record.record_digest,
  };
}

function assertCampaignEngine(campaign, engineIdentity) {
  const recorded = campaign.records[0]?.engine;
  if (
    recorded?.id !== engineIdentity.id ||
    recorded?.implementation_digest !== engineIdentity.implementation_digest
  ) {
    throw new Error('campaign evaluator implementation changed; start a new campaign');
  }
  campaign.engineIdentity = engineIdentity;
}

async function optimizationCampaignEngineIdentity() {
  const hash = createHash('sha256');
  for (const file of ENGINE_FILES) {
    hash.update(`${file}\n`);
    hash.update(await readFile(new URL(file, import.meta.url)));
  }
  return {
    id: 'codevetter-autonomous-optimization/v1',
    implementation_digest: hash.digest('hex'),
  };
}

function requiredDirectory(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('campaign input must be an object');
  }
  if (typeof input.campaign_directory !== 'string' || input.campaign_directory.trim() === '') {
    throw new Error('campaign_directory is required');
  }
  return input.campaign_directory;
}

function safeCampaignDirectory(value) {
  if (typeof value !== 'string' || isAbsolute(value) || value.includes('\\')) {
    throw new Error('campaign_directory must be a repository-relative POSIX path');
  }
  if (!value.startsWith('.codevetter/optimization-campaigns/')) {
    throw new Error('campaign_directory must be under .codevetter/optimization-campaigns/');
  }
  if (value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('campaign_directory contains an invalid path segment');
  }
  return value;
}

function sanitizeHypothesis(value, root) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('hypothesis is required');
  if (value.length > CAMPAIGN_LIMITS.hypothesisCharacters)
    throw new Error('hypothesis is too long');
  return redactText(value.trim(), {
    repositoryRoot: root,
    environmentValues: Object.values(process.env),
    limit: CAMPAIGN_LIMITS.hypothesisCharacters,
  }).text;
}

function sanitizeMessage(error, root, repositoryRoots = []) {
  return redactText(error?.message ?? String(error), {
    repositoryRoot: root,
    repositoryRoots,
    environmentValues: Object.values(process.env),
    limit: 500,
  }).text;
}

function numberFromOutput(output, pattern) {
  const match = pattern.exec(String(output));
  return match ? Number(match[1]) : 0;
}

function splitZero(value) {
  return String(value).split('\0').filter(Boolean);
}

function insideDirectory(path, directory) {
  return path === directory || path.startsWith(`${directory}/`);
}

function countLines(value) {
  if (value.length === 0) return 0;
  return value.split(/\r?\n/).length - (value.endsWith('\n') ? 1 : 0);
}

function assertContained(root, candidate, label) {
  const path = relative(root, candidate);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`${label} escapes repository scope`);
  }
}

async function assertMissing(path, message) {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new Error(message);
}

function runGit(cwd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`git ${args[0]} failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
