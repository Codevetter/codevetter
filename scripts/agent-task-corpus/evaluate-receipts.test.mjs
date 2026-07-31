import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { runEvaluationCli } from './evaluate-cli.mjs';
import {
  CONTRACT_SCHEMA_VERSIONS,
  canonicalJson,
  sha256Bytes,
  validateContract,
} from './contracts.mjs';
import { evaluateReceiptBundle } from './evaluate-receipts.mjs';

const SAMPLE_ROOT = resolve('benchmarks/agent-tasks/sample');
const TASK_ID = 'preserve-explicit-false';
const REVISION = '8b2c3a978ad98d642d4bb4b1df49eb6c23278124';
const HASH = 'a'.repeat(64);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-evaluation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(SAMPLE_ROOT, join(root, 'corpus'), { recursive: true });
  const corpus = await artifact(root, 'corpus/corpus.json');
  const adapter = await artifact(root, 'corpus/adapters/synthetic-false-fix.json');
  const task = JSON.parse(
    await readFile(join(root, 'corpus/tasks/preserve-explicit-false/task.json'), 'utf8')
  );
  const identities = {
    manifest: taskFileHash(root),
    fixture: task.artifacts.fixture.sha256,
    acceptance: task.artifacts.acceptance_contract.sha256,
    adapter: adapter.sha256,
  };
  identities.manifest = await identities.manifest;

  const receipts = {};
  for (const [name, status] of [
    ['ab-control', 'check_failure'],
    ['ab-treatment', 'success'],
    ['aa-a', 'success'],
    ['aa-b', 'success'],
  ]) {
    const value = receipt(name, status, identities);
    receipts[name] = await writeJson(root, `receipts/${name}.json`, value);
  }
  const bundle = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['evaluation-bundle'],
    experiment: {
      id: 'synthetic-receipt-composition',
      title: 'Synthetic receipt composition',
      evidence_kind: 'synthetic',
      qualification_policy: {
        minimum_complete_pairs: 1,
        minimum_distinct_tasks: 1,
        minimum_aa_pairs: 1,
        minimum_success_rate_delta: 0,
        maximum_regression_delta: 0,
        maximum_aa_discordance_rate: 0,
      },
      limitations: ['Synthetic receipts prove composition only.'],
    },
    corpus,
    tasks: [{ task_id: TASK_ID, repository_revision: REVISION }],
    runs: [
      run('ab-pair', 'ab', 'control', 1, receipts['ab-control'], adapter, noGraph()),
      run('ab-pair', 'ab', 'treatment', 2, receipts['ab-treatment'], adapter, graph()),
      run('aa-pair', 'aa', 'a', 1, receipts['aa-a'], adapter, noGraph()),
      run('aa-pair', 'aa', 'b', 2, receipts['aa-b'], adapter, noGraph()),
    ],
  };
  const bundlePath = join(root, 'bundle.json');
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  return { root, bundle, bundlePath, receipts };
}

function receipt(name, status, identities) {
  const checks = [
    {
      id: 'explicit-false-preserved',
      status: status === 'check_failure' ? 'fail' : 'pass',
    },
    { id: 'label-preserved', status: 'pass' },
    { id: 'public-inputs-only', status: 'pass' },
  ];
  return {
    schema_version: CONTRACT_SCHEMA_VERSIONS['run-receipt-v2'],
    run_id: `run-${name}`,
    plan_id: `plan-${name}`,
    task_id: TASK_ID,
    manifest_sha256: identities.manifest,
    fixture_sha256: identities.fixture,
    acceptance_contract_sha256: identities.acceptance,
    adapter_sha256: identities.adapter,
    environment_sha256: HASH,
    workspace_policy: 'public_fixture_and_task_packet_v1',
    terminal_status: status,
    lifecycle: [
      'workspace_prepared',
      'agent_started',
      'agent_terminated',
      'checks_started',
      'checks_finished',
      'cleanup_complete',
    ],
    agent: {
      status: 'exited',
      exit_code: 0,
      stdout_sha256: HASH,
      stderr_sha256: HASH,
      stdout_bytes: 0,
      stderr_bytes: 0,
      output_truncated: false,
    },
    checks,
    regression_count: 0,
    cleanup: { status: 'complete' },
    limitations: ['Synthetic receipt.'],
  };
}

function run(pairId, comparison, arm, executionOrder, receiptArtifact, adapter, context) {
  return {
    pair_id: pairId,
    comparison,
    arm,
    task_id: TASK_ID,
    trial_index: 1,
    execution_order: executionOrder,
    receipt: receiptArtifact,
    adapter,
    context,
  };
}

function noGraph() {
  return {
    structural_context_enabled: false,
    policy_identity: 'no-graph-v1',
    graph: null,
    allowed_graph_tools: [],
  };
}

function graph() {
  return {
    structural_context_enabled: true,
    policy_identity: 'graph-v1',
    graph: {
      engine_id: 'codevetter-graph',
      engine_version: '1',
      snapshot_id: 'synthetic-snapshot',
      indexed_revision: REVISION,
    },
    allowed_graph_tools: ['graph_query'],
  };
}

async function taskFileHash(root) {
  return sha256Bytes(await readFile(join(root, 'corpus/tasks/preserve-explicit-false/task.json')));
}

async function artifact(root, path) {
  return { path, sha256: sha256Bytes(await readFile(join(root, path))) };
}

async function writeJson(root, path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return { path, sha256: sha256Bytes(bytes) };
}

async function rewriteBundle(context) {
  await writeFile(context.bundlePath, `${JSON.stringify(context.bundle, null, 2)}\n`);
}

async function mutateReceipt(context, name, mutate) {
  const descriptor = context.bundle.runs.find((entry) =>
    entry.receipt.path.endsWith(`${name}.json`)
  );
  const absolute = join(context.root, descriptor.receipt.path);
  const value = JSON.parse(await readFile(absolute, 'utf8'));
  mutate(value);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(absolute, bytes);
  descriptor.receipt.sha256 = sha256Bytes(bytes);
  await rewriteBundle(context);
}

test('validates closed bundle and derived score contracts', async (t) => {
  const context = await fixture(t);
  assert.deepEqual(validateContract('evaluation-bundle', context.bundle), []);
  context.bundle.unknown = true;
  assert.match(validateContract('evaluation-bundle', context.bundle).join('\n'), /unknown field/);
});

test('projects immutable receipts and rescoring is byte-deterministic', async (t) => {
  const context = await fixture(t);
  const rawBefore = await readFile(join(context.root, context.receipts['ab-treatment'].path));
  const first = await evaluateReceiptBundle({
    bundlePath: context.bundlePath,
    root: context.root,
  });
  const second = await evaluateReceiptBundle({
    bundlePath: context.bundlePath,
    root: context.root,
  });

  assert.deepEqual(second, first);
  assert.equal(canonicalJson(second.score), canonicalJson(first.score));
  assert.match(first.score.score_id, /^score-[a-f0-9]{32}$/);
  assert.equal(first.score.scorer.version, 'codevetter.structural-context.v1');
  assert.equal(first.score.evidence.receipts.length, 4);
  assert.equal(first.score.scorecard.ab.complete_pairs, 1);
  assert.equal(first.score.scorecard.ab.treatment_wins, 1);
  assert.equal(first.score.scorecard.aa.complete_pairs, 1);
  assert.deepEqual(first.score.scorecard.invalid_pairs, []);
  assert.equal(first.score.scorecard.qualification.state, 'unqualified');
  assert.equal(validateContract('evaluation-score', first.score).length, 0);
  assert.deepEqual(
    await readFile(join(context.root, context.receipts['ab-treatment'].path)),
    rawBefore
  );
  assert.equal(first.manifest.runs[0].diagnostics, undefined);
});

test('projects available adapter diagnostics without changing outcome authority', async (t) => {
  const context = await fixture(t);
  await mutateReceipt(context, 'ab-treatment', (value) => {
    value.diagnostics = {
      input_tokens: 120,
      output_tokens: 40,
      cost_usd: 0.002,
      tool_calls: ['apply_patch', 'read_file'],
      files_inspected: ['TASK.md', 'transformer.mjs'],
      files_modified: ['transformer.mjs'],
    };
  });
  const result = await evaluateReceiptBundle({
    bundlePath: context.bundlePath,
    root: context.root,
  });
  const treatment = result.manifest.runs.find(
    (run) => run.pair_id === 'ab-pair' && run.arm === 'treatment'
  );

  assert.deepEqual(treatment.diagnostics, {
    input_tokens: 120,
    output_tokens: 40,
    cost_usd: 0.002,
    tool_calls: ['apply_patch', 'read_file'],
    files_inspected: ['TASK.md', 'transformer.mjs'],
    files_modified: ['transformer.mjs'],
  });
  assert.equal(treatment.outcome.status, 'completed');
  assert.ok(treatment.outcome.checks.every((check) => check.status === 'pass'));
});

test('rejects receipt hash drift and immutable identity drift', async (t) => {
  const context = await fixture(t);
  const path = join(context.root, context.receipts['ab-control'].path);
  await writeFile(path, `${await readFile(path, 'utf8')}\n`);
  await assert.rejects(
    evaluateReceiptBundle({ bundlePath: context.bundlePath, root: context.root }),
    /artifact SHA-256 mismatch/
  );

  const identityContext = await fixture(t);
  await mutateReceipt(identityContext, 'ab-control', (value) => {
    value.environment_sha256 = 'b'.repeat(64);
  });
  await assert.rejects(
    evaluateReceiptBundle({
      bundlePath: identityContext.bundlePath,
      root: identityContext.root,
    }),
    /arms use different common identities/
  );
});

test('rejects missing checks after check execution', async (t) => {
  const context = await fixture(t);
  await mutateReceipt(context, 'ab-control', (value) => {
    value.checks.pop();
  });
  await assert.rejects(
    evaluateReceiptBundle({ bundlePath: context.bundlePath, root: context.root }),
    /missing or adds acceptance checks/
  );
});

test('rejects incomplete, misordered, stale, and contaminated pairs', async (t) => {
  const incomplete = await fixture(t);
  incomplete.bundle.runs.pop();
  await rewriteBundle(incomplete);
  await assert.rejects(
    evaluateReceiptBundle({ bundlePath: incomplete.bundlePath, root: incomplete.root }),
    /missing b arm/
  );

  const misordered = await fixture(t);
  misordered.bundle.runs[1].execution_order = 1;
  await rewriteBundle(misordered);
  await assert.rejects(
    evaluateReceiptBundle({ bundlePath: misordered.bundlePath, root: misordered.root }),
    /same execution order/
  );

  const stale = await fixture(t);
  stale.bundle.runs[1].context.graph.indexed_revision = 'b'.repeat(40);
  await rewriteBundle(stale);
  await assert.rejects(
    evaluateReceiptBundle({ bundlePath: stale.bundlePath, root: stale.root }),
    /treatment graph snapshot is stale/
  );

  const contaminated = await fixture(t);
  contaminated.bundle.runs[0].context.structural_context_enabled = true;
  contaminated.bundle.runs[0].context.graph = graph().graph;
  await rewriteBundle(contaminated);
  await assert.rejects(
    evaluateReceiptBundle({
      bundlePath: contaminated.bundlePath,
      root: contaminated.root,
    }),
    /control enabled structural context/
  );
});

test('projects pre-check failures as explicit skipped evidence', async (t) => {
  const context = await fixture(t);
  await mutateReceipt(context, 'ab-control', (value) => {
    value.terminal_status = 'agent_failure';
    value.lifecycle = [
      'workspace_prepared',
      'agent_started',
      'agent_terminated',
      'cleanup_complete',
    ];
    value.agent.status = 'failed';
    value.agent.exit_code = 1;
    value.checks = [];
  });
  const result = await evaluateReceiptBundle({
    bundlePath: context.bundlePath,
    root: context.root,
  });
  const control = result.manifest.runs.find((run) => run.arm === 'control');
  assert.equal(control.outcome.status, 'agent_failed');
  assert.ok(control.outcome.checks.every((check) => check.status === 'skipped'));
});

test('CLI writes a separate derived score and reports errors without partial output', async (t) => {
  const context = await fixture(t);
  const outputPath = join(context.root, 'derived', 'score.json');
  const result = await runEvaluationCli([
    '--bundle',
    context.bundlePath,
    '--root',
    context.root,
    '--out',
    outputPath,
    '--json',
  ]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.output), result.score);
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), result.score);

  const rejectedPath = join(context.root, 'derived', 'rejected.json');
  context.bundle.runs[1].execution_order = 1;
  await rewriteBundle(context);
  const rejected = await runEvaluationCli([
    '--bundle',
    context.bundlePath,
    '--root',
    context.root,
    '--out',
    rejectedPath,
    '--json',
  ]);
  assert.equal(rejected.exitCode, 2);
  assert.match(JSON.parse(rejected.output).error, /same execution order/);
  await assert.rejects(readFile(rejectedPath), /ENOENT/);
});
