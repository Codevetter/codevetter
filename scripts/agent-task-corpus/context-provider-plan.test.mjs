import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  CONTRACT_SCHEMA_VERSIONS,
  CORPUS_LIMITS,
  sha256File,
  validateContract,
} from './contracts.mjs';
import {
  loadContextProviderProbe,
  planContextProviderExperiment,
} from './context-provider-plan.mjs';

const BASELINE_PROBE = 'benchmarks/context-providers/stage0/probes/plain-repository-tools.json';
const CODEVETTER_PROBE =
  'benchmarks/context-providers/stage0/probes/codevetter-structural-context.json';
const PAID_PROBE = 'benchmarks/context-providers/fixtures/paid-provider.json';
const HOSTED_PROBE = 'benchmarks/context-providers/fixtures/hosted-provider.json';
const EXCLUDED_PROBE = 'benchmarks/context-providers/fixtures/excluded-provider.json';
const CONTAMINATED_PROBE = 'benchmarks/context-providers/fixtures/contaminated-provider.json';
const REVISION = '7a3dd934f68f4927b66d9e8b8ed317f8ba369aa3';
const DIGEST = 'a'.repeat(64);

test('Stage 0 probes are closed, privacy-safe, and exact about local capabilities', () => {
  const baseline = loadContextProviderProbe(BASELINE_PROBE);
  const codevetter = loadContextProviderProbe(CODEVETTER_PROBE);

  assert.equal(baseline.value.provider_id, 'plain-repository-tools');
  assert.deepEqual(baseline.value.tools.allowed, []);
  assert.equal(codevetter.value.provider_version, '1.7.0');
  assert.deepEqual(codevetter.value.tools.allowed, [
    'graph_get_neighbors',
    'graph_get_node',
    'graph_impact',
    'graph_path',
    'graph_query',
  ]);
  assert.equal(codevetter.value.data_egress, 'none');
});

test('probe validation rejects unknown fields, baseline contamination, private data, and oversized input', async () => {
  const baseline = loadContextProviderProbe(BASELINE_PROBE).value;
  assert.match(
    validateContract('context-provider-probe', { ...baseline, unexpected: true }).join('\n'),
    /unknown field/
  );
  assert.match(
    validateContract('context-provider-probe', {
      ...baseline,
      tools: { observable: true, allowed: ['graph_query'] },
    }).join('\n'),
    /baseline cannot declare provider tools/
  );
  assert.throws(() => loadContextProviderProbe(CONTAMINATED_PROBE), /absolute path/);
  assert.match(
    validateContract('context-provider-probe', {
      ...baseline,
      limitations: ['Contact provider-account@example.com'],
    }).join('\n'),
    /provider account identifier/
  );
  assert.match(
    validateContract('context-provider-probe', {
      ...baseline,
      provider_version: 'sk-fixturevalue1234',
    }).join('\n'),
    /credential/
  );
  assert.match(
    validateContract('context-provider-probe', {
      ...baseline,
      limitations: ['function privateSource() {\n  return true;\n}'],
    }).join('\n'),
    /raw source content/
  );

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'codevetter-context-probe-'));
  try {
    const oversized = resolve(temporaryRoot, 'oversized.json');
    await writeFile(
      oversized,
      JSON.stringify({ padding: 'x'.repeat(CORPUS_LIMITS.maxDocumentBytes) })
    );
    assert.throws(
      () => loadContextProviderProbe(oversized, { root: temporaryRoot }),
      /artifact size/
    );
  } finally {
    await rm(temporaryRoot, { recursive: true });
  }
});

test('probe, feasibility, and full plans have exact deterministic counts and balanced ordering', async () => {
  const options = { probePaths: [BASELINE_PROBE, CODEVETTER_PROBE] };
  const probe = await planContextProviderExperiment({ ...options, stage: 'probe' });
  const first = await planContextProviderExperiment({ ...options, stage: 'feasibility' });
  const second = await planContextProviderExperiment({ ...options, stage: 'feasibility' });
  const full = await planContextProviderExperiment({ ...options, stage: 'full' });

  assert.deepEqual(probe.counts, { providers: 2, tasks: 0, repetitions: 0, attempts: 0 });
  assert.deepEqual(first, second);
  assert.deepEqual(first.counts, { providers: 2, tasks: 4, repetitions: 2, attempts: 16 });
  assert.deepEqual(full.counts, { providers: 2, tasks: 30, repetitions: 3, attempts: 180 });
  assert.deepEqual(
    first.tasks.map((task) => task.lane),
    ['api', 'api', 'browser', 'browser']
  );
  assert.equal(new Set(first.tasks.map((task) => task.category)).size, 4);
  for (const provider of first.providers) {
    assert.equal(
      first.schedule.filter(
        (entry) => entry.provider_id === provider.provider_id && entry.order === 1
      ).length,
      4
    );
  }
  assert.deepEqual(validateContract('context-provider-plan', first), []);

  const invalidSchedule = structuredClone(first);
  invalidSchedule.schedule[1].order = 1;
  assert.match(
    validateContract('context-provider-plan', invalidSchedule).join('\n'),
    /must use each arm order exactly once/
  );
  const invalidCost = structuredClone(first);
  invalidCost.cost.context_max_usd = 1;
  assert.match(
    validateContract('context-provider-plan', invalidCost).join('\n'),
    /cost.context_max_usd: does not match plan inputs/
  );
});

test('committed Stage 0 feasibility plan is byte-content equivalent to regeneration', async () => {
  const committed = JSON.parse(
    await readFile('benchmarks/context-providers/stage0/feasibility-plan.json', 'utf8')
  );
  const regenerated = await planContextProviderExperiment({
    probePaths: [BASELINE_PROBE, CODEVETTER_PROBE],
    stage: 'feasibility',
  });
  assert.deepEqual(committed, regenerated);
});

test('plan identity includes provider snapshots and stale snapshots block execution', async () => {
  const pending = await planContextProviderExperiment({
    probePaths: [BASELINE_PROBE, CODEVETTER_PROBE],
  });
  const ready = await planContextProviderExperiment({
    probePaths: [BASELINE_PROBE, CODEVETTER_PROBE],
    providerSnapshots: {
      'codevetter-structural-context': {
        status: 'ready',
        snapshot_id: 'snapshot-fixture',
        indexed_revision: REVISION,
      },
    },
  });
  const staleSnapshot = JSON.parse(
    await readFile('benchmarks/context-providers/fixtures/stale-snapshot.json', 'utf8')
  );
  const stale = await planContextProviderExperiment({
    probePaths: [BASELINE_PROBE, CODEVETTER_PROBE],
    providerSnapshots: { 'codevetter-structural-context': staleSnapshot },
  });

  assert.notEqual(pending.plan_id, ready.plan_id);
  assert.ok(
    pending.blocked_reasons.includes('provider-snapshot-pending-codevetter-structural-context')
  );
  assert.ok(!ready.blocked_reasons.some((reason) => reason.includes('provider-snapshot')));
  assert.ok(
    stale.blocked_reasons.includes('provider-snapshot-stale-codevetter-structural-context')
  );
});

test('paid, hosted, egress, credential, and unknown-cost inputs produce conservative gates', async () => {
  const selectedAgent = {
    status: 'selected',
    agent: 'Fixture Agent',
    model: 'fixture-model',
    adapter: {
      path: 'benchmarks/agent-tasks/sample/adapters/synthetic-false-fix.json',
      sha256: sha256File('benchmarks/agent-tasks/sample/adapters/synthetic-false-fix.json'),
    },
    configuration_sha256: DIGEST,
    environment_sha256: DIGEST,
    environment_names: [],
    cost_posture: 'free',
    max_usd_per_attempt: 0,
  };
  const paid = await planContextProviderExperiment({
    probePaths: [BASELINE_PROBE, PAID_PROBE],
    agentProfile: selectedAgent,
    availableEnvironmentNames: ['PROVIDER_TOKEN'],
    providerSnapshots: {
      'paid-provider': {
        status: 'ready',
        snapshot_id: 'paid-snapshot',
        indexed_revision: REVISION,
      },
    },
  });
  assert.equal(paid.cost.posture, 'paid');
  assert.equal(paid.cost.context_max_usd, 4);
  assert.equal(paid.cost.total_max_usd, 4);
  assert.equal(paid.approvals.paid_required, true);
  assert.deepEqual(paid.blocked_reasons, []);

  const hosted = await planContextProviderExperiment({
    probePaths: [BASELINE_PROBE, HOSTED_PROBE],
    agentProfile: selectedAgent,
    providerSnapshots: {
      'hosted-provider': {
        status: 'ready',
        snapshot_id: 'hosted-snapshot',
        indexed_revision: REVISION,
      },
    },
  });
  assert.equal(hosted.approvals.hosted_required, true);
  assert.equal(hosted.approvals.data_egress_required, true);
  assert.equal(hosted.approvals.paid_required, true);
  assert.ok(hosted.blocked_reasons.includes('missing-environment-hosted-provider-token'));
  assert.ok(hosted.blocked_reasons.includes('unknown-cost-bound'));
});

test('excluded provider probes cannot enter an experiment cohort', async () => {
  assert.deepEqual(validateContract('context-provider-probe', loadJson(EXCLUDED_PROBE)), []);
  await assert.rejects(
    planContextProviderExperiment({ probePaths: [BASELINE_PROBE, EXCLUDED_PROBE] }),
    /ineligible probes: excluded-provider/
  );
});

test('aggregate comparison schema is closed before later-stage aggregation is implemented', () => {
  const comparison = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['context-provider-comparison'],
    comparison_id: 'fixture-comparison',
    plan_sha256: DIGEST,
    scorer_sha256: DIGEST,
    status: 'descriptive',
    providers: [
      {
        provider_id: 'codevetter-structural-context',
        pairwise_score: { path: 'scores/codevetter.json', sha256: DIGEST },
        raw_p_value: null,
        adjusted_p_value: null,
        pairwise_qualified: false,
        family_qualified: false,
      },
    ],
    missing_arms: [],
    limitations: ['Fixture only; no aggregate was computed.'],
  };
  assert.deepEqual(validateContract('context-provider-comparison', comparison), []);
  assert.match(
    validateContract('context-provider-comparison', { ...comparison, extra: true }).join('\n'),
    /unknown field/
  );
});

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
