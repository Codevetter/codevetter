import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  CONTRACT_SCHEMA_VERSIONS,
  canonicalJson,
  sha256Bytes,
  validateContract,
} from './contracts.mjs';

export const CONTEXT_ATTEMPT_SCHEMA_VERSION = 'codevetter.context-provider-attempt.v1';
export const CONTEXT_FAMILY_ALPHA = 0.05;

const ID = /^[a-z0-9][a-z0-9._-]{0,199}$/;
const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const ATTEMPT_FIELDS = [
  'schema_version',
  'plan_id',
  'sequence',
  'provider_id',
  'task_id',
  'trial_index',
  'order',
  'workspace_id',
  'agent_session_id',
  'tool_configuration_sha256',
  'configured_tools',
  'observed_tool_calls',
  'generated_instruction_paths',
  'retained_state_detected',
  'snapshot_id',
  'indexed_revision',
  'receipt',
  'adapter',
];
const NOISE_ATTEMPT_FIELDS = [...ATTEMPT_FIELDS, 'comparison', 'arm'];

export function validateContextProviderAttempt(value, plan) {
  const errors = [];
  if (!plainObject(value)) return ['attempt: expected an object'];
  const preregisteredNoise = (plan?.aa_repetitions ?? 0) > 0;
  closed(value, preregisteredNoise ? NOISE_ATTEMPT_FIELDS : ATTEMPT_FIELDS, 'attempt', errors);
  exact(value.schema_version, CONTEXT_ATTEMPT_SCHEMA_VERSION, 'attempt.schema_version', errors);
  exact(value.plan_id, plan?.plan_id, 'attempt.plan_id', errors);
  integer(value.sequence, 'attempt.sequence', errors, 1, 1000);
  id(value.provider_id, 'attempt.provider_id', errors);
  id(value.task_id, 'attempt.task_id', errors);
  integer(value.trial_index, 'attempt.trial_index', errors, 1, 5);
  integer(value.order, 'attempt.order', errors, 1, 4);
  id(value.workspace_id, 'attempt.workspace_id', errors);
  id(value.agent_session_id, 'attempt.agent_session_id', errors);
  sha256(value.tool_configuration_sha256, 'attempt.tool_configuration_sha256', errors);
  stringArray(value.configured_tools, 'attempt.configured_tools', errors);
  stringArray(value.observed_tool_calls, 'attempt.observed_tool_calls', errors);
  stringArray(value.generated_instruction_paths, 'attempt.generated_instruction_paths', errors);
  if (typeof value.retained_state_detected !== 'boolean')
    errors.push('attempt.retained_state_detected: expected a boolean');
  nullableSnapshotId(value.snapshot_id, 'attempt.snapshot_id', errors);
  if (value.indexed_revision !== null && !REVISION.test(value.indexed_revision ?? ''))
    errors.push('attempt.indexed_revision: expected a Git revision or null');
  artifact(value.receipt, 'attempt.receipt', errors);
  artifact(value.adapter, 'attempt.adapter', errors);

  const schedule = plan?.schedule?.find((entry) => entry.sequence === value.sequence);
  if (!schedule) errors.push('attempt.sequence: not present in the plan schedule');
  else {
    for (const field of ['provider_id', 'task_id', 'trial_index', 'order', 'comparison', 'arm']) {
      if (value[field] !== schedule[field])
        errors.push(`attempt.${field}: does not match schedule`);
    }
  }
  return errors;
}

export function inspectContextProviderAttempts({ plan, providerId, attempts }) {
  const planErrors = validateContract('context-provider-plan', plan);
  if (planErrors.length > 0)
    throw new Error(`invalid context-provider plan:\n${planErrors.join('\n')}`);
  const baseline = plan.providers.find((provider) => provider.role === 'baseline');
  const treatment = plan.providers.find((provider) => provider.provider_id === providerId);
  if (!baseline) throw new Error('context-provider plan has no baseline');
  if (!treatment || treatment.role !== 'treatment')
    throw new Error(`unknown treatment provider "${providerId}"`);

  const expected = plan.schedule.filter((entry) =>
    [baseline.provider_id, providerId].includes(entry.provider_id)
  );
  const expectedSequences = new Set(expected.map((entry) => entry.sequence));
  const relevant = attempts.filter((attempt) => expectedSequences.has(attempt.sequence));
  const errors = relevant.flatMap((attempt) => validateContextProviderAttempt(attempt, plan));
  const bySequence = indexAttempts(relevant, errors);
  const missingArms = expected
    .filter((entry) => !bySequence.has(entry.sequence))
    .map(scheduleArmName)
    .sort();
  uniqueIdentity(relevant, 'workspace_id', errors);
  uniqueIdentity(relevant, 'agent_session_id', errors);
  uniqueIdentity(relevant, 'tool_configuration_sha256', errors);

  const allProviderTools = new Set(
    plan.providers
      .filter((provider) => provider.role === 'treatment')
      .flatMap((provider) => provider.allowed_tools)
  );
  for (const attempt of relevant) {
    validateAttemptIsolation(attempt, plan, allProviderTools, errors);
  }
  return {
    baseline,
    treatment,
    expected,
    attempts: relevant.sort((left, right) => left.sequence - right.sequence),
    missing_arms: missingArms,
    errors: [...new Set(errors)].sort(),
  };
}

function indexAttempts(attempts, errors) {
  const bySequence = new Map();
  for (const attempt of attempts) {
    if (bySequence.has(attempt.sequence)) {
      errors.push(`duplicate attempt sequence ${attempt.sequence}`);
    } else {
      bySequence.set(attempt.sequence, attempt);
    }
  }
  return bySequence;
}

function validateAttemptIsolation(attempt, plan, allProviderTools, errors) {
  const provider = plan.providers.find(
    (candidate) => candidate.provider_id === attempt.provider_id
  );
  const task = plan.tasks.find((candidate) => candidate.task_id === attempt.task_id);
  if (!provider || !task) return;
  if (attempt.generated_instruction_paths.length > 0) {
    errors.push(`attempt ${attempt.sequence}: retained generated instructions`);
  }
  if (attempt.retained_state_detected) {
    errors.push(`attempt ${attempt.sequence}: retained cross-arm state`);
  }
  if (provider.role === 'baseline') {
    validateBaselineIsolation(attempt, allProviderTools, errors);
    return;
  }
  validateTreatmentIsolation(attempt, provider, task, allProviderTools, errors);
}

function validateBaselineIsolation(attempt, allProviderTools, errors) {
  if (attempt.configured_tools.length > 0) {
    errors.push(`attempt ${attempt.sequence}: baseline configured provider tools`);
  }
  if (attempt.observed_tool_calls.some((tool) => allProviderTools.has(tool))) {
    errors.push(`attempt ${attempt.sequence}: baseline invoked a provider tool`);
  }
  if (attempt.snapshot_id !== null || attempt.indexed_revision !== null) {
    errors.push(`attempt ${attempt.sequence}: baseline retained a provider snapshot`);
  }
}

function validateTreatmentIsolation(attempt, provider, task, allProviderTools, errors) {
  if (!sameSorted(attempt.configured_tools, provider.allowed_tools)) {
    errors.push(`attempt ${attempt.sequence}: configured tools differ from provider policy`);
  }
  const crossProviderTools = new Set(
    [...allProviderTools].filter((tool) => !provider.allowed_tools.includes(tool))
  );
  if (attempt.observed_tool_calls.some((tool) => crossProviderTools.has(tool))) {
    errors.push(`attempt ${attempt.sequence}: invoked another provider's tool`);
  }
  const snapshot = provider.snapshots.find((entry) => entry.task_id === task.task_id);
  if (attempt.snapshot_id !== snapshot?.snapshot_id) {
    errors.push(`attempt ${attempt.sequence}: provider snapshot identity drift`);
  }
  if (attempt.indexed_revision !== task.repository_revision) {
    errors.push(`attempt ${attempt.sequence}: stale provider index`);
  }
}

export function projectContextProviderEvaluationBundle({ plan, providerId, attempts }) {
  const inspection = inspectContextProviderAttempts({ plan, providerId, attempts });
  if (inspection.errors.length > 0) {
    throw new Error(`context-provider evidence is contaminated:\n${inspection.errors.join('\n')}`);
  }
  const bySequence = new Map(inspection.attempts.map((attempt) => [attempt.sequence, attempt]));
  const runs = [];
  for (const task of plan.tasks) {
    for (let trial = 1; trial <= plan.repetitions; trial += 1) {
      const control = scheduledAttempt(inspection.expected, bySequence, {
        comparison: 'ab',
        taskId: task.task_id,
        trial,
        providerId: inspection.baseline.provider_id,
      });
      const treatment = scheduledAttempt(inspection.expected, bySequence, {
        comparison: 'ab',
        taskId: task.task_id,
        trial,
        providerId,
      });
      if (!control || !treatment) continue;
      const pairId = `${providerId}-${task.task_id}-${trial}`;
      // Plan order spans the whole cohort; a pairwise bundle records which of its two arms ran first.
      const controlFirst = control.order < treatment.order;
      runs.push(bundleRun(pairId, 'ab', 'control', control, noContext(), controlFirst ? 1 : 2));
      runs.push(
        bundleRun(
          pairId,
          'ab',
          'treatment',
          treatment,
          providerContext(inspection.treatment, task.task_id),
          controlFirst ? 2 : 1
        )
      );
    }
    for (let trial = 1; trial <= (plan.aa_repetitions ?? 0); trial += 1) {
      const arms = ['a', 'b'].map((arm) =>
        scheduledAttempt(inspection.expected, bySequence, {
          comparison: 'aa',
          taskId: task.task_id,
          trial,
          providerId,
          arm,
        })
      );
      if (arms.some((attempt) => !attempt)) continue;
      const pairId = `aa-${providerId}-${task.task_id}-${trial}`;
      const firstArm = arms[0].order < arms[1].order ? 0 : 1;
      for (const [index, attempt] of arms.entries()) {
        runs.push(
          bundleRun(
            pairId,
            'aa',
            index === 0 ? 'a' : 'b',
            attempt,
            providerContext(inspection.treatment, task.task_id),
            index === firstArm ? 1 : 2
          )
        );
      }
    }
  }
  if (!runs.some((run) => run.comparison === 'ab')) {
    throw new Error('no complete baseline-versus-provider pair is available');
  }
  const noisePairs = runs.filter((run) => run.comparison === 'aa').length / 2;
  const bundle = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['evaluation-bundle'],
    experiment: {
      id: `${plan.plan_id}-${providerId}`.slice(0, 200),
      title: `Baseline versus ${inspection.treatment.provider_id}`,
      evidence_kind: 'real',
      qualification_policy: {
        minimum_complete_pairs: plan.tasks.length * plan.repetitions,
        minimum_distinct_tasks: plan.tasks.length,
        minimum_aa_pairs: Math.max(1, plan.tasks.length * (plan.aa_repetitions ?? 0)),
        minimum_success_rate_delta: 0,
        maximum_regression_delta: 0,
        maximum_aa_discordance_rate: 0,
      },
      limitations: [
        ...(noisePairs === 0
          ? [
              'Provider comparison remains descriptive until independent A/A noise evidence is supplied.',
            ]
          : []),
        ...plan.limitations,
      ],
    },
    corpus: plan.corpus,
    tasks: plan.tasks.map((task) => ({
      task_id: task.task_id,
      repository_revision: task.repository_revision,
    })),
    runs,
  };
  const errors = validateContract('evaluation-bundle', bundle);
  if (errors.length > 0)
    throw new Error(`invalid projected evaluation bundle:\n${errors.join('\n')}`);
  return { bundle, inspection };
}

export function aggregateContextProviderScores({ plan, planArtifact, pairwise }) {
  const planErrors = validateContract('context-provider-plan', plan);
  if (planErrors.length > 0)
    throw new Error(`invalid context-provider plan:\n${planErrors.join('\n')}`);
  const planArtifactErrors = [];
  artifact(planArtifact, 'planArtifact', planArtifactErrors);
  if (planArtifactErrors.length > 0) throw new Error(planArtifactErrors.join('\n'));
  const treatments = plan.providers.filter((provider) => provider.role === 'treatment');
  const byProvider = new Map(pairwise.map((entry) => [entry.provider_id, entry]));
  if (byProvider.size !== pairwise.length) throw new Error('duplicate pairwise provider identity');
  validatePairwiseProviderIds(treatments, byProvider);
  const { rows, missingArms } = collectPairwiseRows(plan, treatments, byProvider);
  validateCommonPairwiseIdentities(plan, rows);
  const adjusted = holmAdjust(rows.map((row) => ({ id: row.provider.provider_id, p: row.rawP })));
  const providers = rows
    .map((row) => comparisonProvider(row, adjusted.get(row.provider.provider_id)))
    .sort((left, right) => left.provider_id.localeCompare(right.provider_id));
  const limitations = [
    'Holm adjustment uses a preregistered family-wise alpha of 0.05.',
    'Executable hidden checks remain authoritative; diagnostics do not determine success.',
  ];
  if (plan.stage !== 'full')
    limitations.push('Feasibility evidence is descriptive and cannot establish a provider winner.');
  if (missingArms.length > 0)
    limitations.push('One or more scheduled provider arms are missing terminal evidence.');
  if (providers.some((provider) => provider.noise.complete_pairs === 0)) {
    limitations.push(
      'A provider has no independent A/A noise evidence, so its comparison stays descriptive.'
    );
  }
  const draft = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['context-provider-comparison'],
    plan_sha256: planArtifact.sha256,
    scorer_sha256: commonScorerSha(rows),
    status: comparisonStatus(plan, providers, missingArms),
    providers,
    missing_arms: [...new Set(missingArms)].sort(),
    limitations,
  };
  const comparison = {
    ...draft,
    comparison_id: `comparison-${sha256Bytes(Buffer.from(canonicalJson(draft))).slice(0, 32)}`,
  };
  const errors = validateContract('context-provider-comparison', comparison);
  if (errors.length > 0)
    throw new Error(`invalid context-provider comparison:\n${errors.join('\n')}`);
  return comparison;
}

function validatePairwiseProviderIds(treatments, byProvider) {
  const treatmentIds = new Set(treatments.map((provider) => provider.provider_id));
  const unexpected = [...byProvider.keys()].filter((providerId) => !treatmentIds.has(providerId));
  if (unexpected.length > 0) {
    throw new Error(`unexpected pairwise provider identity: ${unexpected.sort().join(', ')}`);
  }
}

function collectPairwiseRows(plan, treatments, byProvider) {
  const rows = [];
  const missingArms = [];
  for (const provider of treatments) {
    const entry = byProvider.get(provider.provider_id);
    if (!entry) {
      missingArms.push(...scheduledArmNames(plan, provider.provider_id));
      continue;
    }
    const row = pairwiseRow(plan, provider, entry, missingArms);
    rows.push(row);
  }
  return { rows, missingArms };
}

function validateCommonPairwiseIdentities(plan, rows) {
  const fields = [
    ['scorer.version', (row) => row.entry.score.scorer.version],
    ['scorer.sha256', (row) => row.entry.score.scorer.sha256],
    ['ground_truth_sha256', (row) => row.entry.score.evidence.ground_truth_sha256],
    ['projected_manifest_sha256', (row) => row.entry.score.evidence.projected_manifest_sha256],
  ];
  for (const [label, read] of fields) {
    if (new Set(rows.map(read)).size > 1) throw new Error(`pairwise ${label} identity drift`);
  }
  for (const row of rows) {
    if (row.entry.score.evidence.corpus_sha256 !== plan.corpus.sha256) {
      throw new Error(`pairwise corpus identity drift for ${row.provider.provider_id}`);
    }
  }
}

function pairwiseRow(plan, provider, entry, missingArms) {
  if (provider.snapshots.some((snapshot) => snapshot.status !== 'ready')) {
    throw new Error(`provider snapshot is not ready: ${provider.provider_id}`);
  }
  const scoreErrors = validateContract('evaluation-score', entry.score);
  if (scoreErrors.length > 0) {
    throw new Error(
      `invalid pairwise score for ${provider.provider_id}:\n${scoreErrors.join('\n')}`
    );
  }
  validatePairwiseArtifacts(entry);
  const ab = entry.score.scorecard.ab;
  const aa = entry.score.scorecard.aa;
  if (!aa) throw new Error(`pairwise score omits A/A noise evidence: ${provider.provider_id}`);
  const expectedAttempts = scheduledArmNames(plan, provider.provider_id).length;
  const completeAttempts = ab.complete_pairs * 2;
  const expectedNoiseAttempts = scheduledArmNames(plan, provider.provider_id, 'aa').length;
  const completeNoiseAttempts = aa.complete_pairs * 2;
  if (completeAttempts > expectedAttempts || completeNoiseAttempts > expectedNoiseAttempts) {
    throw new Error(`pairwise score exceeds the schedule for ${provider.provider_id}`);
  }
  appendMissingArms(provider, entry, expectedAttempts, completeAttempts, missingArms, 'ab');
  appendMissingArms(
    provider,
    entry,
    expectedNoiseAttempts,
    completeNoiseAttempts,
    missingArms,
    'aa'
  );
  return {
    provider,
    entry,
    expectedAttempts,
    completeAttempts,
    expectedNoiseAttempts,
    completeNoiseAttempts,
    rawP: exactMcNemarPValue(ab.treatment_wins, ab.control_wins),
  };
}

function validatePairwiseArtifacts(entry) {
  for (const descriptor of [entry.score_artifact, entry.bundle_artifact]) {
    const errors = [];
    artifact(descriptor, 'pairwise artifact', errors);
    if (errors.length > 0) throw new Error(errors.join('\n'));
  }
}

function appendMissingArms(provider, entry, expected, complete, missingArms, comparison) {
  if (complete >= expected) return;
  const declared = (entry.missing_arms ?? []).filter(
    (name) => name.startsWith('aa:') === (comparison === 'aa')
  );
  if (declared.length === expected - complete) missingArms.push(...declared);
  else
    missingArms.push(
      `${provider.provider_id}:incomplete-${comparison === 'aa' ? 'aa' : 'pairwise'}-evidence`
    );
}

function comparisonProvider(row, adjustedP) {
  const {
    provider,
    entry,
    expectedAttempts,
    completeAttempts,
    expectedNoiseAttempts,
    completeNoiseAttempts,
    rawP,
  } = row;
  const ab = entry.score.scorecard.ab;
  const aa = entry.score.scorecard.aa;
  // The pairwise scorer reports qualified_improvement / qualified_no_improvement / unqualified.
  const pairwiseQualified = entry.score.scorecard.qualification.state !== 'unqualified';
  return {
    provider_id: provider.provider_id,
    provider_version: provider.provider_version,
    configuration_sha256: provider.configuration_sha256,
    context_kind: provider.context_kind,
    snapshots: provider.snapshots.map((snapshot) => ({ ...snapshot })),
    allowed_tools: [...provider.allowed_tools],
    pairwise_score: entry.score_artifact,
    pairwise_bundle: entry.bundle_artifact,
    scheduled_attempts: expectedAttempts,
    complete_attempts: completeAttempts,
    outcomes: {
      complete_pairs: ab.complete_pairs,
      control_successes: ab.control_successes,
      treatment_successes: ab.treatment_successes,
      treatment_wins: ab.treatment_wins,
      control_wins: ab.control_wins,
      ties: ab.tie_pass + ab.tie_fail,
      success_rate_delta: ab.success_rate_delta,
      regression_delta: ab.regression_delta,
    },
    noise: {
      scheduled_attempts: expectedNoiseAttempts,
      complete_attempts: completeNoiseAttempts,
      complete_pairs: aa.complete_pairs,
      discordant_pairs: aa.discordant_pairs,
      discordance_rate: aa.discordance_rate,
    },
    diagnostics_available: Object.entries(ab.diagnostics)
      .filter(([, value]) => value.paired_count > 0)
      .map(([name]) => name)
      .sort(),
    raw_p_value: rawP,
    adjusted_p_value: adjustedP,
    pairwise_qualified: pairwiseQualified,
    family_qualified:
      pairwiseQualified &&
      adjustedP !== null &&
      adjustedP <= CONTEXT_FAMILY_ALPHA &&
      ab.success_rate_delta > 0,
  };
}

function comparisonStatus(plan, providers, missingArms) {
  if (missingArms.length > 0) return 'invalid';
  if (
    plan.stage === 'full' &&
    providers.length > 0 &&
    providers.every((row) => row.family_qualified)
  ) {
    return 'qualified';
  }
  return 'descriptive';
}

export function exactMcNemarPValue(treatmentWins, controlWins) {
  const discordant = treatmentWins + controlWins;
  if (discordant === 0) return null;
  const tail = Math.min(treatmentWins, controlWins);
  let probability = 0;
  for (let successes = 0; successes <= tail; successes += 1) {
    probability += binomial(discordant, successes) * 0.5 ** discordant;
  }
  return round(Math.min(1, probability * 2));
}

export function holmAdjust(entries) {
  const comparable = entries
    .filter((entry) => entry.p !== null)
    .sort((left, right) => left.p - right.p || left.id.localeCompare(right.id));
  const adjusted = new Map(entries.map((entry) => [entry.id, null]));
  let previous = 0;
  for (const [index, entry] of comparable.entries()) {
    const value = Math.min(1, Math.max(previous, entry.p * (comparable.length - index)));
    previous = value;
    adjusted.set(entry.id, round(value));
  }
  return adjusted;
}

export function renderContextProviderComparison(comparison, format = 'json') {
  if (format === 'json') return `${JSON.stringify(comparison, null, 2)}\n`;
  const lines = [
    '# Context-provider comparison',
    '',
    `Status: **${comparison.status}**`,
    '',
    '| Provider | Complete | Control | Treatment | Delta | Raw p | Holm p | Qualified |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...comparison.providers.map(
      (provider) =>
        `| ${provider.provider_id} | ${provider.complete_attempts}/${provider.scheduled_attempts} | ${provider.outcomes.control_successes} | ${provider.outcomes.treatment_successes} | ${signed(provider.outcomes.success_rate_delta)} | ${decimal(provider.raw_p_value)} | ${decimal(provider.adjusted_p_value)} | ${provider.family_qualified ? 'yes' : 'no'} |`
    ),
    '',
    '## Provider evidence',
    '',
    ...comparison.providers.flatMap(markdownProviderEvidence),
    '',
    '## Limitations',
    '',
    ...comparison.limitations.map((item) => `- ${item}`),
  ];
  if (comparison.missing_arms.length > 0) {
    lines.push('', '## Missing arms', '', ...comparison.missing_arms.map((item) => `- ${item}`));
  }
  const markdown = `${lines.join('\n')}\n`;
  if (format === 'markdown') return markdown;
  if (format !== 'html') throw new Error(`unsupported comparison format "${format}"`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Context-provider comparison</title><style>body{font:16px/1.5 system-ui;max-width:1100px;margin:40px auto;padding:0 20px;color:#201d18}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d8d1c5;padding:8px;text-align:left;vertical-align:top}code{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><h1>Context-provider comparison</h1><p>Status: <strong>${escapeHtml(comparison.status)}</strong></p><table><thead><tr><th>Provider identity</th><th>Schedule</th><th>Outcome</th><th>Evidence</th><th>Qualified</th></tr></thead><tbody>${comparison.providers.map(htmlProviderEvidence).join('')}</tbody></table>${htmlList('Missing arms', comparison.missing_arms)}${htmlList('Limitations', comparison.limitations)}</body></html>\n`;
}

function markdownProviderEvidence(provider) {
  const snapshots = provider.snapshots
    .map((snapshot) => `${snapshot.task_id}=${snapshot.snapshot_id}`)
    .join(', ');
  return [
    `### ${provider.provider_id}`,
    '',
    `- Version: \`${provider.provider_version}\`; configuration: \`${provider.configuration_sha256}\``,
    `- Snapshots: ${snapshots}`,
    `- Tools: ${provider.allowed_tools.join(', ') || 'none'}`,
    `- A/A noise: ${noiseSummary(provider.noise)}`,
    `- Diagnostics: ${provider.diagnostics_available.join(', ') || 'unavailable'}`,
    `- Pairwise bundle: \`${provider.pairwise_bundle.path}\`; score: \`${provider.pairwise_score.path}\``,
    '',
  ];
}

function htmlProviderEvidence(provider) {
  const identity = `${provider.provider_id} ${provider.provider_version}\n${provider.configuration_sha256}`;
  const snapshots = provider.snapshots
    .map((snapshot) => `${snapshot.task_id}=${snapshot.snapshot_id}`)
    .join('\n');
  const outcome = `${provider.outcomes.control_successes} → ${provider.outcomes.treatment_successes}\n${signed(provider.outcomes.success_rate_delta)} · Holm ${decimal(provider.adjusted_p_value)}`;
  const evidence = `snapshots:\n${snapshots}\ntools: ${provider.allowed_tools.join(', ') || 'none'}\nA/A noise: ${noiseSummary(provider.noise)}\ndiagnostics: ${provider.diagnostics_available.join(', ') || 'unavailable'}`;
  return `<tr><td><code>${escapeHtml(identity)}</code></td><td>${provider.complete_attempts}/${provider.scheduled_attempts}</td><td><code>${escapeHtml(outcome)}</code></td><td><code>${escapeHtml(evidence)}</code></td><td>${provider.family_qualified ? 'yes' : 'no'}</td></tr>`;
}

function noiseSummary(noise) {
  if (noise.complete_pairs === 0) {
    return `unavailable (${noise.complete_attempts}/${noise.scheduled_attempts} arms)`;
  }
  return `${noise.discordant_pairs}/${noise.complete_pairs} discordant pairs (${decimal(
    noise.discordance_rate
  )})`;
}

function htmlList(title, items) {
  if (items.length === 0) return '';
  return `<h2>${escapeHtml(title)}</h2><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

export async function writeContextProviderArtifact(path, content) {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, content, { flag: 'wx' });
  await rename(temporary, destination);
}

function scheduledAttempt(expected, bySequence, { comparison, taskId, trial, providerId, arm }) {
  const entry = expected.find(
    (candidate) =>
      (candidate.comparison ?? 'ab') === comparison &&
      candidate.task_id === taskId &&
      candidate.trial_index === trial &&
      candidate.provider_id === providerId &&
      (arm === undefined || candidate.arm === arm)
  );
  return entry === undefined ? undefined : bySequence.get(entry.sequence);
}

function scheduleArmName(entry) {
  return entry.comparison === 'aa'
    ? `aa:${entry.task_id}:trial-${entry.trial_index}:${entry.provider_id}:${entry.arm}`
    : `${entry.task_id}:trial-${entry.trial_index}:${entry.provider_id}`;
}

function bundleRun(pairId, comparison, arm, attempt, context, executionOrder) {
  return {
    pair_id: pairId,
    comparison,
    arm,
    task_id: attempt.task_id,
    trial_index: attempt.trial_index,
    execution_order: executionOrder,
    receipt: attempt.receipt,
    adapter: attempt.adapter,
    context,
  };
}

function noContext() {
  return {
    structural_context_enabled: false,
    policy_identity: 'plain-repository-tools',
    graph: null,
    allowed_graph_tools: [],
  };
}

function providerContext(provider, taskId) {
  const snapshot = provider.snapshots.find((entry) => entry.task_id === taskId);
  if (!snapshot) throw new Error(`provider snapshot is missing for task ${taskId}`);
  return {
    structural_context_enabled: true,
    policy_identity: provider.provider_id,
    graph: {
      engine_id: provider.provider_id,
      engine_version: provider.provider_version,
      snapshot_id: snapshot.snapshot_id,
      indexed_revision: snapshot.indexed_revision,
    },
    allowed_graph_tools: [...provider.allowed_tools],
  };
}

function scheduledArmNames(plan, providerId, comparison = 'ab') {
  const baseline = plan.providers.find((provider) => provider.role === 'baseline');
  const cohort = comparison === 'aa' ? [providerId] : [baseline.provider_id, providerId];
  return plan.schedule
    .filter(
      (entry) => (entry.comparison ?? 'ab') === comparison && cohort.includes(entry.provider_id)
    )
    .map(scheduleArmName)
    .sort();
}

function commonScorerSha(rows) {
  const values = new Set(rows.map((row) => row.entry.score.scorer.sha256));
  if (values.size !== 1) throw new Error('pairwise scores use different scorer identities');
  return [...values][0];
}

function uniqueIdentity(attempts, field, errors) {
  const values = attempts.map((attempt) => attempt[field]);
  if (new Set(values).size !== values.length) errors.push(`${field}: must be fresh for every arm`);
}

function sameSorted(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function binomial(n, k) {
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = (result * (n - index + 1)) / index;
  return result;
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function signed(value) {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function decimal(value) {
  return value === null ? 'n/a' : value.toFixed(6);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function closed(value, fields, path, errors) {
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) errors.push(`${path}.${field}: unknown field`);
  }
  for (const field of fields) {
    if (!(field in value)) errors.push(`${path}.${field}: required`);
  }
}

function exact(value, expected, path, errors) {
  if (value !== expected) errors.push(`${path}: expected ${expected}`);
}

function id(value, path, errors) {
  if (!ID.test(value ?? '')) errors.push(`${path}: invalid identity`);
}

function nullableId(value, path, errors) {
  if (value !== null) id(value, path, errors);
}

function nullableSnapshotId(value, path, errors) {
  if (value !== null && !SNAPSHOT_ID.test(value ?? '')) {
    errors.push(`${path}: invalid snapshot identity`);
  }
}

function sha256(value, path, errors) {
  if (!SHA256.test(value ?? '')) errors.push(`${path}: invalid SHA-256`);
}

function integer(value, path, errors, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    errors.push(`${path}: invalid integer`);
}

function stringArray(value, path, errors) {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((item) => typeof item !== 'string')
  ) {
    errors.push(`${path}: expected a bounded string array`);
    return;
  }
  if (new Set(value).size !== value.length) errors.push(`${path}: duplicate values`);
  if (JSON.stringify(value) !== JSON.stringify([...value].sort()))
    errors.push(`${path}: must be sorted`);
}

function artifact(value, path, errors) {
  if (!plainObject(value)) return errors.push(`${path}: expected an artifact`);
  closed(value, ['path', 'sha256'], path, errors);
  if (typeof value.path !== 'string' || value.path.length === 0 || value.path.startsWith('/'))
    errors.push(`${path}.path: expected a repository-relative path`);
  sha256(value.sha256, `${path}.sha256`, errors);
}
