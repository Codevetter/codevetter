import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FLOW_PRIORITY_MANIFEST_SCHEMA_VERSION,
  validateFlowCampaignPlan,
  validateFlowPriorityManifest,
} from './contracts.mjs';
import {
  buildFlowInventory,
  loadFlowPriorityManifest,
  planFlowOptimizationCampaign,
  supportedScaleCost,
} from './flow-campaign-planner.mjs';

test('priority manifest is closed, bounded, and candidate-addressed', () => {
  const valid = {
    schema_version: FLOW_PRIORITY_MANIFEST_SCHEMA_VERSION,
    flows: [
      {
        candidate_id: '0123456789abcdef',
        frequency_weight: 8,
        user_impact_weight: 5,
        rationale: 'Runs for every interactive request.',
      },
    ],
  };
  assert.deepEqual(validateFlowPriorityManifest(valid), []);
  assert.match(
    validateFlowPriorityManifest({ ...valid, secret: true }).join(', '),
    /unknown field/
  );
  assert.match(
    validateFlowPriorityManifest({
      ...valid,
      flows: [{ ...valid.flows[0], frequency_weight: 11 }],
    }).join(', '),
    /frequency_weight/
  );
});

test('inventory admits direct local measurements and explains exclusions', () => {
  const inventory = buildFlowInventory(
    qualification([
      candidate('aaaaaaaaaaaaaaaa', { signals: [{ kind: 'timing_measurement_source' }] }),
      candidate('dddddddddddddddd', {
        signals: [{ kind: 'timing_measurement_source' }],
        safetyFlags: [{ kind: 'local_service_signal' }],
      }),
      candidate('bbbbbbbbbbbbbbbb', {
        signals: [{ kind: 'timing_measurement_source' }],
        safetyFlags: [{ kind: 'remote_network_signal' }],
      }),
      candidate('cccccccccccccccc', { signals: [{ kind: 'generic_test_scope' }] }),
    ])
  );

  assert.deepEqual(
    inventory.eligible.map((entry) => entry.id),
    ['aaaaaaaaaaaaaaaa', 'dddddddddddddddd']
  );
  assert.deepEqual(inventory.excluded[0].reasons, ['remote_network_signal']);
  assert.deepEqual(inventory.excluded[1].reasons, ['missing_direct_timing_evidence']);
});

test('extracts comparable supported-scale Node and Go cost', () => {
  assert.deepEqual(
    supportedScaleCost({
      observed: [
        {
          kind: 'input_scale_curve',
          unit: 'ms/op',
          points: [{ input: 20_000, value: 5.8 }],
          provenance: 'console_benchmark_metrics',
        },
      ],
    }),
    {
      value_ms: 5.8,
      input: 20_000,
      unit: 'ms/op',
      provenance: 'console_benchmark_metrics',
    }
  );
  assert.equal(
    supportedScaleCost({
      observed: [
        {
          kind: 'go_benchmark_measurement',
          ns_per_op: { median: 2_500_000 },
          provenance: 'go_test_benchmark_output',
        },
      ],
    }).value_ms,
    2.5
  );
});

test('planner screens sequentially, ranks explicit impact, and preserves cheap guardrails', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-flow-plan-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, 'priorities.json'),
    JSON.stringify({
      schema_version: FLOW_PRIORITY_MANIFEST_SCHEMA_VERSION,
      flows: [
        {
          candidate_id: 'aaaaaaaaaaaaaaaa',
          frequency_weight: 4,
          user_impact_weight: 5,
          rationale: 'Interactive scoring path.',
        },
      ],
    })
  );
  const executionOrder = [];
  const plan = await planFlowOptimizationCampaign({
    repositoryRoot: root,
    priorityManifestPath: 'priorities.json',
    maxFlows: 2,
    samples: 3,
    warmups: 1,
    timeoutMs: 1_000,
    qualify: async () =>
      qualification([
        candidate('aaaaaaaaaaaaaaaa', {
          target: 'score.performance.test.ts',
          signals: [{ kind: 'timing_measurement_source' }],
        }),
        candidate('bbbbbbbbbbbbbbbb', {
          target: 'routing.performance.test.ts',
          signals: [{ kind: 'timing_measurement_source' }],
        }),
      ]),
    profile: async (input) => {
      executionOrder.push(input.target);
      return capsule(input);
    },
    diagnose: async (captured) =>
      diagnosis(captured.scope.target === 'score.performance.test.ts' ? 8 : 0.01),
  });

  assert.deepEqual(executionOrder, ['score.performance.test.ts', 'routing.performance.test.ts']);
  assert.equal(plan.ranked[0].priority_score, 160);
  assert.equal(plan.ranked[0].product_context_provenance, 'project_priority_manifest');
  assert.equal(plan.screened[1].diagnosis.kind, 'already_fast_at_supported_scale');
  assert.equal(plan.screened[1].priority_score, null);
  assert.equal(plan.unverified[0].candidate_id, 'bbbbbbbbbbbbbbbb');
  assert.equal(plan.next_action.kind, 'initialize_optimization_campaign');
  assert.equal(plan.next_action.candidate_id, 'aaaaaaaaaaaaaaaa');
  assert.deepEqual(validateFlowCampaignPlan(plan), []);
});

test('unknown priority identity fails before any workload executes', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-flow-plan-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, 'priorities.json'),
    JSON.stringify({
      schema_version: FLOW_PRIORITY_MANIFEST_SCHEMA_VERSION,
      flows: [
        {
          candidate_id: 'ffffffffffffffff',
          frequency_weight: 1,
          user_impact_weight: 1,
          rationale: 'Stale identity.',
        },
      ],
    })
  );
  let executions = 0;
  await assert.rejects(
    planFlowOptimizationCampaign({
      repositoryRoot: root,
      priorityManifestPath: 'priorities.json',
      qualify: async () => qualification([candidate('aaaaaaaaaaaaaaaa')]),
      profile: async () => {
        executions += 1;
      },
    }),
    /unknown candidate/
  );
  assert.equal(executions, 0);
});

test('priority manifest path must remain inside the repository', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-flow-plan-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(loadFlowPriorityManifest(root, '../outside.json'), /contained/);
});

test('planner requests a representative workload when no domain metric is comparable', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-flow-plan-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const plan = await planFlowOptimizationCampaign({
    repositoryRoot: root,
    qualify: async () => qualification([candidate('aaaaaaaaaaaaaaaa')]),
    profile: async (input) => capsule(input),
    diagnose: async () => ({
      diagnosis: {
        kind: 'application_cpu_hotspot',
        summary: 'CPU samples exist without an application metric.',
        confidence: { level: 'medium', basis: 'deterministic_evidence_rules' },
      },
      observed: [],
      next_action: { kind: 'optimize_one_candidate' },
      limitations: [],
      verdict: { status: 'actionable', reason: 'CPU candidate only.' },
    }),
  });

  assert.equal(plan.ranked.length, 0);
  assert.equal(plan.verdict.status, 'needs_better_workload');
  assert.equal(plan.next_action.kind, 'author_representative_workload');
});

test('plan-flow-campaign CLI discovers and screens one exact local workload', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }),
    'src/work.js': [
      'export function sumSquares(size) {',
      '  let total = 0;',
      '  for (let index = 0; index < size; index += 1) total += index * index;',
      '  return total;',
      '}',
      '',
    ].join('\n'),
    'src/work.performance.test.js': [
      "import assert from 'node:assert/strict';",
      "import { performance } from 'node:perf_hooks';",
      "import test from 'node:test';",
      "import { sumSquares } from './work.js';",
      "test('sum squares performance flow', () => {",
      '  const metrics = [];',
      '  for (const size of [1000, 10000]) {',
      '    const started = performance.now();',
      '    for (let iteration = 0; iteration < 200; iteration += 1) {',
      '      assert.equal(sumSquares(size) >= 0, true);',
      '    }',
      '    metrics.push("size" + size + "=" + ((performance.now() - started) / 200).toFixed(6) + "ms/op");',
      '  }',
      '  console.log("[benchmark] " + metrics.join(" ") + " (200 iterations)");',
      '});',
      '',
    ].join('\n'),
  });
  const result = await processResult(
    process.execPath,
    [
      fileURLToPath(new URL('./cli.mjs', import.meta.url)),
      'plan-flow-campaign',
      '--repo',
      root,
      '--max-flows',
      '1',
      '--samples',
      '2',
      '--warmups',
      '0',
      '--timeout-ms',
      '10000',
      '--json',
    ],
    root
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.schema_version, 'runtime-flow-campaign-plan/v1');
  assert.equal(plan.inventory.eligible.length, 1);
  assert.equal(plan.screened.length, 1);
  assert.equal(plan.screened[0].candidate.target, 'src/work.performance.test.js');
  assert.equal(plan.screened[0].evidence.temporary_artifacts_retained, false);
});

function qualification(candidates) {
  return {
    schema_version: 'runtime-qualification/v1',
    status: 'ready',
    subject: { repository_revision: 'abc123', dirty: false },
    lanes: [],
    candidates,
    recommended: null,
    next_action: { kind: 'profile_exact_workload' },
    limitations: [],
    scan: {},
  };
}

function candidate(
  id,
  {
    target = `${id}.performance.test.ts`,
    signals = [{ kind: 'timing_measurement_source' }],
    safetyFlags = [],
  } = {}
) {
  return {
    id,
    adapter: 'vitest',
    target,
    name: `performance flow ${id}`,
    package_scope: '.',
    score: 70,
    signals,
    safety_flags: safetyFlags,
    evidence: [],
  };
}

function capsule(input) {
  return {
    subject: { repository_revision: 'abc123', dirty: false },
    scope: { target: input.target, name: input.name },
    sample_policy: { samples: input.samples, warmups: input.warmups },
    observed: {
      profile_repeatability: { qualified: true },
      flow_evidence: { events: [] },
    },
    capture: { temporary_artifacts_retained: false },
  };
}

function diagnosis(cost) {
  const alreadyFast = cost <= 0.1;
  return {
    diagnosis: {
      kind: alreadyFast ? 'already_fast_at_supported_scale' : 'application_cpu_hotspot',
      summary: alreadyFast ? 'Already fast.' : 'Actionable CPU path.',
      confidence: { level: 'high', basis: 'deterministic_evidence_rules' },
    },
    observed: [
      {
        kind: 'input_scale_curve',
        unit: 'ms/op',
        points: [{ input: 20_000, value: cost }],
        provenance: 'console_benchmark_metrics',
      },
    ],
    next_action: { kind: alreadyFast ? 'retain_guardrail' : 'optimize_one_candidate' },
    limitations: [],
    verdict: {
      status: alreadyFast ? 'measured' : 'actionable',
      reason: alreadyFast ? 'Cheap.' : 'Material.',
    },
  };
}

async function gitFixture(context, files) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-flow-plan-cli-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  await processResult('git', ['init', '-q'], root, true);
  await processResult('git', ['add', '.'], root, true);
  await processResult(
    'git',
    [
      '-c',
      'user.name=CodeVetter Test',
      '-c',
      'user.email=codevetter@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'fixture baseline',
    ],
    root,
    true
  );
  return root;
}

function processResult(program, args, cwd, requireSuccess = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (requireSuccess && code !== 0) {
        reject(new Error(`${program} failed: ${stderr.trim() || `exit ${code}`}`));
      } else {
        resolvePromise({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}
