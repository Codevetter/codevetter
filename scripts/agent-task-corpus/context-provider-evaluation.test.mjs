import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CONTRACT_SCHEMA_VERSIONS,
  canonicalJson,
  sha256Bytes,
  sha256File,
  validateContract,
} from './contracts.mjs';
import {
  CONTEXT_ATTEMPT_SCHEMA_VERSION,
  aggregateContextProviderScores,
  exactMcNemarPValue,
  holmAdjust,
  inspectContextProviderAttempts,
  projectContextProviderEvaluationBundle,
  renderContextProviderComparison,
} from './context-provider-evaluation.mjs';
import { runContextProviderEvaluationCli } from './context-provider-evaluate-cli.mjs';
import { planContextProviderExperiment } from './context-provider-plan.mjs';

const BASELINE_PROBE = 'benchmarks/context-providers/stage0/probes/plain-repository-tools.json';
const CODEVETTER_PROBE =
  'benchmarks/context-providers/stage0/probes/codevetter-structural-context.json';
const ADAPTER_PATH = 'benchmarks/agent-tasks/sample/adapters/synthetic-false-fix.json';
const PROVIDER_ID = 'codevetter-structural-context';
const REVISION = '7a3dd934f68f4927b66d9e8b8ed317f8ba369aa3';
const DIGEST = 'a'.repeat(64);

async function fixturePlan() {
  return planContextProviderExperiment({
    probePaths: [BASELINE_PROBE, CODEVETTER_PROBE],
    stage: 'feasibility',
    agentProfile: {
      status: 'selected',
      agent: 'Hermetic fixture agent',
      model: 'none',
      adapter: { path: ADAPTER_PATH, sha256: sha256File(ADAPTER_PATH) },
      configuration_sha256: 'b'.repeat(64),
      environment_sha256: 'c'.repeat(64),
      environment_names: [],
      cost_posture: 'free',
      max_usd_per_attempt: 0,
    },
    providerSnapshots: {
      [PROVIDER_ID]: Object.fromEntries(
        [
          'accept-zero-duration',
          'await-transaction-commit',
          'deduplicate-visible-items',
          'ignore-stale-search-response',
        ].map((taskId) => [
          taskId,
          {
            status: 'ready',
            snapshot_id: `snapshot:${taskId}`,
            indexed_revision: REVISION,
          },
        ])
      ),
    },
  });
}

function fixtureAttempts(plan) {
  const providers = new Map(plan.providers.map((provider) => [provider.provider_id, provider]));
  return plan.schedule.map((entry) => {
    const provider = providers.get(entry.provider_id);
    const treatment = provider.role === 'treatment';
    const snapshot = provider.snapshots.find((candidate) => candidate.task_id === entry.task_id);
    return {
      schema_version: CONTEXT_ATTEMPT_SCHEMA_VERSION,
      plan_id: plan.plan_id,
      sequence: entry.sequence,
      provider_id: entry.provider_id,
      task_id: entry.task_id,
      trial_index: entry.trial_index,
      order: entry.order,
      workspace_id: `workspace-${entry.sequence}`,
      agent_session_id: `session-${entry.sequence}`,
      tool_configuration_sha256: entry.sequence.toString(16).padStart(64, '0'),
      configured_tools: [...provider.allowed_tools],
      observed_tool_calls: treatment ? [provider.allowed_tools[0]] : [],
      generated_instruction_paths: [],
      retained_state_detected: false,
      snapshot_id: treatment ? snapshot.snapshot_id : null,
      indexed_revision: treatment ? REVISION : null,
      receipt: {
        path: `stage1/receipts/attempt-${entry.sequence}.json`,
        sha256: (entry.sequence + 100).toString(16).padStart(64, '0'),
      },
      adapter: {
        path: `stage1/adapters/attempt-${entry.sequence}.json`,
        sha256: (entry.sequence + 200).toString(16).padStart(64, '0'),
      },
    };
  });
}

function evaluationScore({
  treatmentWins = 6,
  controlWins = 0,
  qualified = false,
  corpusSha = 'c'.repeat(64),
} = {}) {
  const completePairs = 8;
  const scorecard = {
    ab: {
      complete_pairs: completePairs,
      control_successes: 2,
      treatment_successes: 8,
      treatment_wins: treatmentWins,
      control_wins: controlWins,
      tie_pass: completePairs - treatmentWins - controlWins,
      tie_fail: 0,
      success_rate_delta: 0.75,
      regression_delta: 0,
      diagnostics: {
        input_tokens: { paired_count: 8 },
        output_tokens: { paired_count: 8 },
        cost_usd: { paired_count: 0 },
        tool_calls: { paired_count: 8 },
        files_inspected: { paired_count: 8 },
        files_modified: { paired_count: 8 },
      },
    },
    qualification: { state: qualified ? 'qualified' : 'unqualified' },
  };
  const draft = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['evaluation-score'],
    scorer: { version: 'codevetter.structural-context.v1', sha256: DIGEST },
    evidence: {
      bundle_sha256: 'b'.repeat(64),
      corpus_sha256: corpusSha,
      ground_truth_sha256: 'd'.repeat(64),
      projected_manifest_sha256: 'e'.repeat(64),
      receipts: [
        { path: 'receipts/a.json', sha256: '1'.repeat(64), run_id: 'run-a' },
        { path: 'receipts/b.json', sha256: '2'.repeat(64), run_id: 'run-b' },
      ],
    },
    scorecard,
  };
  return {
    ...draft,
    score_id: `score-${sha256Bytes(Buffer.from(canonicalJson(draft))).slice(0, 32)}`,
  };
}

test('isolated attempts project every scheduled baseline and provider arm', async () => {
  const plan = await fixturePlan();
  const attempts = fixtureAttempts(plan);
  const result = projectContextProviderEvaluationBundle({
    plan,
    providerId: PROVIDER_ID,
    attempts,
  });

  assert.deepEqual(result.inspection.errors, []);
  assert.deepEqual(result.inspection.missing_arms, []);
  assert.equal(result.bundle.runs.length, 16);
  assert.equal(result.bundle.runs.filter((run) => run.arm === 'control').length, 8);
  assert.equal(result.bundle.runs.filter((run) => run.arm === 'treatment').length, 8);
  assert.equal(
    new Set(
      result.bundle.runs
        .filter((run) => run.arm === 'treatment')
        .map((run) => run.context.graph.snapshot_id)
    ).size,
    4
  );
  assert.deepEqual(validateContract('evaluation-bundle', result.bundle), []);
  assert.equal(new Set(attempts.map((attempt) => attempt.workspace_id)).size, 16);
  assert.equal(new Set(attempts.map((attempt) => attempt.agent_session_id)).size, 16);
});

test('stale indexes, baseline tool calls, cross-arm state, and reused isolation fail closed', async () => {
  const plan = await fixturePlan();
  const attempts = fixtureAttempts(plan);
  attempts[1].observed_tool_calls = ['graph_query'];
  attempts[0].indexed_revision = 'f'.repeat(40);
  attempts[2].retained_state_detected = true;
  attempts[3].workspace_id = attempts[2].workspace_id;
  const inspection = inspectContextProviderAttempts({
    plan,
    providerId: PROVIDER_ID,
    attempts,
  });
  assert.match(inspection.errors.join('\n'), /baseline invoked a provider tool/);
  assert.match(inspection.errors.join('\n'), /stale provider index/);
  assert.match(inspection.errors.join('\n'), /retained cross-arm state/);
  assert.match(inspection.errors.join('\n'), /workspace_id: must be fresh/);
  assert.throws(
    () => projectContextProviderEvaluationBundle({ plan, providerId: PROVIDER_ID, attempts }),
    /evidence is contaminated/
  );
});

test('missing scheduled arms remain explicit instead of shrinking the denominator', async () => {
  const plan = await fixturePlan();
  const attempts = fixtureAttempts(plan).slice(0, -1);
  const inspection = inspectContextProviderAttempts({
    plan,
    providerId: PROVIDER_ID,
    attempts,
  });
  assert.equal(inspection.missing_arms.length, 1);
  assert.match(inspection.missing_arms[0], /plain-repository-tools/);
});

test('a valid snapshot from another task is rejected as context drift', async () => {
  const plan = await fixturePlan();
  const attempts = fixtureAttempts(plan);
  const firstTreatment = attempts.find(
    (attempt) => attempt.provider_id === PROVIDER_ID && attempt.task_id === 'accept-zero-duration'
  );
  const otherTreatment = attempts.find(
    (attempt) =>
      attempt.provider_id === PROVIDER_ID && attempt.task_id === 'await-transaction-commit'
  );
  firstTreatment.snapshot_id = otherTreatment.snapshot_id;
  const inspection = inspectContextProviderAttempts({
    plan,
    providerId: PROVIDER_ID,
    attempts,
  });
  assert.match(inspection.errors.join('\n'), /provider snapshot identity drift/);
});

test('McNemar and Holm adjustment are deterministic and monotone', () => {
  assert.equal(exactMcNemarPValue(6, 0), 0.03125);
  assert.equal(exactMcNemarPValue(0, 0), null);
  const adjusted = holmAdjust([
    { id: 'a', p: 0.01 },
    { id: 'b', p: 0.03 },
    { id: 'c', p: 0.2 },
    { id: 'd', p: null },
  ]);
  assert.deepEqual(Object.fromEntries(adjusted), { a: 0.03, b: 0.06, c: 0.2, d: null });
});

test('aggregate comparison preserves identities, outcomes, diagnostics, and deterministic reports', async () => {
  const plan = await fixturePlan();
  const score = evaluationScore({ corpusSha: plan.corpus.sha256 });
  assert.deepEqual(validateContract('evaluation-score', score), []);
  const input = {
    plan,
    planArtifact: { path: 'stage1/plan.json', sha256: '3'.repeat(64) },
    pairwise: [
      {
        provider_id: PROVIDER_ID,
        score,
        score_artifact: { path: 'stage1/scores/codevetter.json', sha256: '4'.repeat(64) },
        bundle_artifact: { path: 'stage1/bundles/codevetter.json', sha256: '5'.repeat(64) },
        missing_arms: [],
      },
    ],
  };
  const first = aggregateContextProviderScores(input);
  const second = aggregateContextProviderScores(input);
  assert.deepEqual(second, first);
  assert.deepEqual(validateContract('context-provider-comparison', first), []);
  assert.equal(first.status, 'descriptive');
  assert.equal(first.providers[0].outcomes.treatment_wins, 6);
  assert.deepEqual(first.providers[0].diagnostics_available, [
    'files_inspected',
    'files_modified',
    'input_tokens',
    'output_tokens',
    'tool_calls',
  ]);
  assert.equal(first.providers[0].raw_p_value, 0.03125);
  assert.equal(first.providers[0].adjusted_p_value, 0.03125);
  assert.match(renderContextProviderComparison(first, 'markdown'), /snapshot:accept-zero/);
  assert.match(renderContextProviderComparison(first, 'markdown'), /Feasibility evidence/);
  assert.match(renderContextProviderComparison(first, 'html'), /snapshot:accept-zero/);
  assert.equal(
    renderContextProviderComparison(first, 'json'),
    renderContextProviderComparison(second, 'json')
  );
});

test('aggregate comparison rejects undeclared providers and incomplete evidence', async () => {
  const plan = await fixturePlan();
  const score = evaluationScore({ corpusSha: plan.corpus.sha256 });
  const artifacts = {
    score_artifact: { path: 'stage1/scores/codevetter.json', sha256: '4'.repeat(64) },
    bundle_artifact: { path: 'stage1/bundles/codevetter.json', sha256: '5'.repeat(64) },
  };
  assert.throws(
    () =>
      aggregateContextProviderScores({
        plan,
        planArtifact: { path: 'stage1/plan.json', sha256: '3'.repeat(64) },
        pairwise: [{ provider_id: 'undeclared-provider', score, ...artifacts }],
      }),
    /unexpected pairwise provider identity/
  );

  const drifted = structuredClone(score);
  drifted.evidence.corpus_sha256 = 'f'.repeat(64);
  const { score_id: _driftedScoreId, ...driftedDraft } = drifted;
  drifted.score_id = `score-${sha256Bytes(Buffer.from(canonicalJson(driftedDraft))).slice(0, 32)}`;
  assert.throws(
    () =>
      aggregateContextProviderScores({
        plan,
        planArtifact: { path: 'stage1/plan.json', sha256: '3'.repeat(64) },
        pairwise: [{ provider_id: PROVIDER_ID, score: drifted, ...artifacts }],
      }),
    /pairwise corpus identity drift/
  );

  const incomplete = structuredClone(score);
  incomplete.scorecard.ab.complete_pairs = 7;
  const { score_id: _scoreId, ...incompleteDraft } = incomplete;
  incomplete.score_id = `score-${sha256Bytes(Buffer.from(canonicalJson(incompleteDraft))).slice(0, 32)}`;
  const comparison = aggregateContextProviderScores({
    plan,
    planArtifact: { path: 'stage1/plan.json', sha256: '3'.repeat(64) },
    pairwise: [{ provider_id: PROVIDER_ID, score: incomplete, ...artifacts }],
  });
  assert.equal(comparison.status, 'invalid');
  assert.deepEqual(comparison.missing_arms, [
    'codevetter-structural-context:incomplete-pairwise-evidence',
  ]);
  assert.match(renderContextProviderComparison(comparison, 'html'), /incomplete-pairwise-evidence/);
});

test('evaluation CLI projects isolated attempts and fails closed on unsafe paths', async () => {
  const plan = await fixturePlan();
  const root = await mkdtemp(join(tmpdir(), 'codevetter-context-evaluate-'));
  try {
    await writeFile(join(root, 'plan.json'), JSON.stringify(plan));
    await writeFile(join(root, 'attempts.json'), JSON.stringify(fixtureAttempts(plan)));
    const result = await runContextProviderEvaluationCli([
      'project',
      '--root',
      root,
      '--plan',
      'plan.json',
      '--provider',
      PROVIDER_ID,
      '--attempts',
      'attempts.json',
      '--json',
    ]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.value.runs.length, 16);

    const unsafe = await runContextProviderEvaluationCli([
      'project',
      '--root',
      root,
      '--plan',
      '../plan.json',
      '--provider',
      PROVIDER_ID,
      '--attempts',
      'attempts.json',
    ]);
    assert.equal(unsafe.exitCode, 2);
    assert.match(unsafe.output, /unsafe relative path/);
  } finally {
    await rm(root, { recursive: true });
  }
});
