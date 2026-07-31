import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  CONTRACT_SCHEMA_VERSIONS,
  canonicalJson,
  deriveRunPlanId,
  sha256Bytes,
  validateContract,
} from './contracts.mjs';

const DIGEST = 'a'.repeat(64);
const REVISION = 'b'.repeat(40);
const FIXTURE_BYTES = Buffer.from('fixture\n');
const FIXTURE_BASE64 = FIXTURE_BYTES.toString('base64');
const FIXTURE_SHA256 = sha256Bytes(FIXTURE_BYTES);
const AFTER_BYTES = Buffer.from('fixed\n');
const AFTER_BASE64 = AFTER_BYTES.toString('base64');
const AFTER_SHA256 = sha256Bytes(AFTER_BYTES);

test('all public contract schemas are closed and parseable', async () => {
  const names = [
    'acceptance-contract',
    'agent-adapter',
    'agent-adapter-v2',
    'check-result',
    'corpus-index',
    'fixture-bundle',
    'known-good-change',
    'qualification-receipt',
    'qualification-receipt-v2',
    'run-receipt',
    'run-plan',
    'run-receipt-v2',
    'task-manifest',
  ];
  for (const name of names) {
    const path = resolve(`benchmarks/agent-tasks/contracts/${name}.schema.json`);
    const schema = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
  }
});

test('accepts representative documents for all qualification and runner contracts', () => {
  const runPlanDraft = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['run-plan'],
    task_id: 'preserve-explicit-false',
    manifest_sha256: DIGEST,
    fixture_sha256: DIGEST,
    acceptance_contract_sha256: DIGEST,
    adapter_sha256: DIGEST,
    workspace_policy: 'public_fixture_and_task_packet_v1',
    environment: [{ name: 'FIXTURE_TOKEN', available: true }],
    filtered_input_bytes: 400,
    estimated_input_tokens: 164,
    reserved_output_tokens: 128,
    estimated_max_cost_usd: 0,
    max_cost_usd: 0,
    cost_posture: 'free',
    within_cost_limit: true,
    command: ['{node}', '{adapter_root}/fixture-agent.mjs', '{workspace}'],
    approval: { launch_required: true, paid_required: false },
    blocked_reasons: [],
    limitations: [],
  };
  const documents = {
    'acceptance-contract': {
      schema_version: CONTRACT_SCHEMA_VERSIONS['acceptance-contract'],
      task_id: 'preserve-explicit-false',
      task_defining_failures: ['explicit-false-preserved'],
      required_checks: [{ id: 'explicit-false-preserved', label: 'Explicit false is preserved' }],
      regression_checks: [{ id: 'label-preserved', label: 'Label is preserved' }],
      driver: { path: 'checks.mjs', sha256: DIGEST, timeout_ms: 5_000 },
      repetitions: 2,
    },
    'agent-adapter': {
      schema_version: CONTRACT_SCHEMA_VERSIONS['agent-adapter'],
      adapter_id: 'fixture-agent',
      agent: 'Fixture Agent',
      model: 'fixture-model',
      configuration: 'no-network',
      command: ['fixture-agent', '--task', '{task_packet}'],
      environment_names: [],
      timeout_ms: 30_000,
      cost_posture: 'free',
    },
    'agent-adapter-v2': {
      schema_version: CONTRACT_SCHEMA_VERSIONS['agent-adapter-v2'],
      adapter_id: 'fixture-agent',
      agent: 'Fixture Agent',
      model: 'none',
      configuration: 'offline',
      command: ['{node}', '{adapter_root}/fixture-agent.mjs', '{workspace}'],
      artifacts: [{ path: 'fixture-agent.mjs', sha256: DIGEST }],
      environment_names: ['FIXTURE_TOKEN'],
      timeout_ms: 30_000,
      cost_posture: 'free',
      planning: {
        prompt_overhead_tokens: 64,
        reserved_output_tokens: 128,
        input_usd_per_million: 0,
        output_usd_per_million: 0,
        max_cost_usd: 0,
      },
    },
    'check-result': {
      schema_version: CONTRACT_SCHEMA_VERSIONS['check-result'],
      task_id: 'preserve-explicit-false',
      acceptance_contract_sha256: DIGEST,
      results: [{ id: 'explicit-false-preserved', status: 'pass' }],
    },
    'corpus-index': {
      schema_version: CONTRACT_SCHEMA_VERSIONS['corpus-index'],
      corpus_id: 'fixture-corpus',
      version: '0.1.0',
      tasks: [
        {
          task_id: 'preserve-explicit-false',
          manifest: { path: 'tasks/preserve-explicit-false/task.json', sha256: DIGEST },
        },
      ],
    },
    'fixture-bundle': {
      schema_version: CONTRACT_SCHEMA_VERSIONS['fixture-bundle'],
      files: [
        {
          path: 'fixture.txt',
          content_base64: FIXTURE_BASE64,
          sha256: FIXTURE_SHA256,
        },
      ],
    },
    'known-good-change': {
      schema_version: CONTRACT_SCHEMA_VERSIONS['known-good-change'],
      task_id: 'preserve-explicit-false',
      files: [
        {
          path: 'fixture.txt',
          before_sha256: FIXTURE_SHA256,
          after_base64: AFTER_BASE64,
          after_sha256: AFTER_SHA256,
        },
      ],
    },
    'qualification-receipt': {
      schema_version: CONTRACT_SCHEMA_VERSIONS['qualification-receipt'],
      task_id: 'preserve-explicit-false',
      manifest_sha256: DIGEST,
      qualified: true,
      baseline: { runs: 2, result_sha256: DIGEST, status: 'intended_failure' },
      known_good: { runs: 2, result_sha256: DIGEST, status: 'pass' },
      limitations: [],
    },
    'qualification-receipt-v2': {
      schema_version: CONTRACT_SCHEMA_VERSIONS['qualification-receipt-v2'],
      task_id: 'preserve-explicit-false',
      manifest_sha256: DIGEST,
      fixture_sha256: DIGEST,
      acceptance_contract_sha256: DIGEST,
      known_good_sha256: DIGEST,
      workspace_policy: 'public_fixture_and_task_packet_v1',
      qualified: true,
      baseline: {
        status: 'intended_failure',
        attempts: [
          { attempt: 1, outcome: 'intended_failure', result_sha256: DIGEST },
          { attempt: 2, outcome: 'intended_failure', result_sha256: DIGEST },
        ],
      },
      known_good: {
        status: 'pass',
        attempts: [
          { attempt: 1, outcome: 'pass', result_sha256: DIGEST },
          { attempt: 2, outcome: 'pass', result_sha256: DIGEST },
        ],
      },
      cleanup: { status: 'complete' },
      limitations: [],
    },
    'run-receipt': {
      schema_version: CONTRACT_SCHEMA_VERSIONS['run-receipt'],
      run_id: 'fixture-run',
      task_id: 'preserve-explicit-false',
      manifest_sha256: DIGEST,
      adapter_sha256: DIGEST,
      environment_sha256: DIGEST,
      workspace_policy: 'withheld_workspace_v1',
      terminal_status: 'success',
      checks: [{ id: 'explicit-false-preserved', status: 'pass' }],
      regression_count: 0,
      elapsed_ms: 42,
      cleanup: { status: 'complete' },
      limitations: [],
    },
    'run-plan': {
      ...runPlanDraft,
      plan_id: deriveRunPlanId(runPlanDraft),
    },
    'run-receipt-v2': {
      schema_version: CONTRACT_SCHEMA_VERSIONS['run-receipt-v2'],
      run_id: 'fixture-run-v2',
      plan_id: 'plan-fixture',
      task_id: 'preserve-explicit-false',
      manifest_sha256: DIGEST,
      fixture_sha256: DIGEST,
      acceptance_contract_sha256: DIGEST,
      adapter_sha256: DIGEST,
      environment_sha256: DIGEST,
      workspace_policy: 'public_fixture_and_task_packet_v1',
      terminal_status: 'success',
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
        stdout_sha256: DIGEST,
        stderr_sha256: DIGEST,
        stdout_bytes: 10,
        stderr_bytes: 0,
        output_truncated: false,
      },
      checks: [{ id: 'explicit-false-preserved', status: 'pass' }],
      regression_count: 0,
      cleanup: { status: 'complete' },
      limitations: [],
    },
    'task-manifest': {
      schema_version: CONTRACT_SCHEMA_VERSIONS['task-manifest'],
      task_id: 'preserve-explicit-false',
      title: 'Preserve an explicit false value',
      lane: 'api',
      runtime: 'node',
      category: 'validation',
      failure_mode: 'falsy-defaulting',
      artifacts: {
        fixture: { path: 'fixture.json', sha256: DIGEST },
        task_packet: { path: 'task.md', sha256: DIGEST },
        acceptance_contract: { path: 'acceptance-contract.json', sha256: DIGEST },
        known_good_patch: { path: 'known-good.patch', sha256: DIGEST },
      },
      required_checks: ['explicit-false-preserved'],
      regression_checks: ['label-preserved'],
      provenance: {
        kind: 'owned',
        repository: 'Codevetter/codevetter',
        revision: REVISION,
      },
      license: { spdx: 'ISC', notice: 'Owned fixture.' },
    },
  };

  for (const [name, document] of Object.entries(documents)) {
    const kind =
      {
        'agent-adapter-v2': 'agent-adapter',
        'qualification-receipt-v2': 'qualification-receipt',
        'run-receipt-v2': 'run-receipt',
      }[name] ?? name;
    assert.deepEqual(validateContract(kind, document), [], name);
  }
});

test('rejects unknown fields, unsafe paths, bounds, duplicates, and false qualification', () => {
  const adapter = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['agent-adapter'],
    adapter_id: 'fixture-agent',
    agent: 'Fixture Agent',
    model: 'fixture-model',
    configuration: 'no-network',
    command: ['fixture-agent'],
    environment_names: ['TOKEN', 'TOKEN'],
    timeout_ms: 3_600_001,
    cost_posture: 'free',
    secret_value: 'forbidden',
  };
  assert.deepEqual(validateContract('agent-adapter', adapter), [
    '$.environment_names: duplicate value "TOKEN"',
    '$.secret_value: unknown field',
    '$.timeout_ms: expected an integer from 1000 to 3600000',
  ]);

  const unsafeV2Adapter = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['agent-adapter-v2'],
    adapter_id: 'fixture-agent',
    agent: 'Fixture Agent',
    model: 'none',
    configuration: 'offline',
    command: ['{node}', '{adapter_root}/fixture-agent.mjs', '{workspace}/../hidden'],
    artifacts: [{ path: 'fixture-agent.mjs', sha256: DIGEST }],
    environment_names: [],
    timeout_ms: 30_000,
    cost_posture: 'free',
    planning: {
      prompt_overhead_tokens: 0,
      reserved_output_tokens: 1,
      input_usd_per_million: 0,
      output_usd_per_million: 0,
      max_cost_usd: 0,
    },
  };
  assert.match(
    validateContract('agent-adapter', unsafeV2Adapter).join('\n'),
    /safe POSIX relative path/
  );

  const qualification = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['qualification-receipt'],
    task_id: 'fixture-task',
    manifest_sha256: DIGEST,
    qualified: true,
    baseline: { runs: 2, result_sha256: DIGEST, status: 'wrong_failure' },
    known_good: { runs: 2, result_sha256: DIGEST, status: 'pass' },
    limitations: [],
  };
  assert.match(
    validateContract('qualification-receipt', qualification).join('\n'),
    /must equal the baseline/
  );

  const index = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['corpus-index'],
    corpus_id: 'fixture-corpus',
    version: '0.1.0',
    tasks: [
      {
        task_id: 'fixture-task',
        manifest: { path: '../private/task.json', sha256: DIGEST },
      },
      {
        task_id: 'fixture-task',
        manifest: { path: 'tasks/fixture-task/task.json', sha256: DIGEST },
      },
    ],
  };
  const errors = validateContract('corpus-index', index).join('\n');
  assert.match(errors, /safe POSIX relative path/);
  assert.match(errors, /duplicate value "fixture-task"/);
});

test('canonical JSON sorts object keys without reordering arrays', () => {
  assert.equal(
    canonicalJson({ z: 1, nested: { b: 2, a: 1 }, values: [{ b: 2, a: 1 }, 'z'] }),
    '{"nested":{"a":1,"b":2},"values":[{"a":1,"b":2},"z"],"z":1}'
  );
});
