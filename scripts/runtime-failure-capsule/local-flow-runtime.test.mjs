import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertFlowAdapter, validateFlowCapsule } from './contracts.mjs';
import { normalizeNodeFlowEvents, normalizeSqlShape } from './flow-capture.mjs';
import { analyzeFlowOperations, analyzeFunctionFrequency } from './flow.mjs';
import { compareFunctionFrequency, createLocalFlowService } from './flow-service.mjs';
import { collectV8FunctionCoverage } from './function-coverage.mjs';
import { createRuntimeMcpHandler, toolDefinitions } from './mcp.mjs';
import { diagnosePlaywrightTrace } from './playwright-trace-import.mjs';
import { diagnoseToolLedPerformance } from './tool-led-performance-diagnosis.mjs';

test('normalizes recursive HTTP flows without treating diagnostic time as root accounting', () => {
  const normalized = normalizeNodeFlowEvents(
    [
      {
        event_id: 'event-1',
        kind: 'http_client',
        method: 'GET',
        route: '/items/:value',
        status: 200,
        started_at_ms: 100,
        duration_ms: 12,
      },
      {
        event_id: 'event-2',
        kind: 'http_server',
        method: 'GET',
        route: '/items/:value',
        status: 200,
        started_at_ms: 102,
        duration_ms: 5,
      },
      {
        event_id: 'event-3',
        parent_event_id: 'event-2',
        kind: 'database',
        database: 'node_sqlite',
        operation: 'get',
        statement: 'SELECT value FROM items WHERE id = ? AND token = ?',
        outcome: 'ok',
        started_at_ms: 103,
        duration_ms: 2,
        source: {
          file: '../../private.js',
          line: 1,
          function: 'escape',
          provenance: 'untrusted',
        },
      },
    ],
    50
  );

  assert.equal(normalized.flows.length, 4);
  assert.equal(normalized.flows[2].parent_flow_id, 'flow-2');
  assert.equal(normalized.flows[3].parent_flow_id, 'flow-3');
  assert.deepEqual(normalized.flows[2].timing.accounting, {
    method: 'same_execution_child_interval_union',
    accounted_child_ms: 2,
    unaccounted_ms: 3,
  });
  assert.equal(normalized.flows[3].attributes.statement.includes('must-not-leak'), false);
  assert.equal(
    normalized.flows[3].attributes.statement,
    'SELECT value FROM items WHERE id = ? AND token = ?'
  );
  assert.equal(normalized.flows[3].attributes.source, null);
  assert.ok(normalized.relationships.some((item) => item.kind === 'caused'));
  assert.equal(normalized.coverage.root_accounting, 'unavailable_across_separate_executions');
  assert.equal(normalized.coverage.unaccounted_ms, null);
});

test('local flow service captures, inspects, and explains a loopback HTTP workload', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'src/server.js': [
      "import { createServer } from 'node:http';",
      "import { DatabaseSync } from 'node:sqlite';",
      "const database = new DatabaseSync(':memory:');",
      'database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO items VALUES (1, \'initial\')");',
      'export function startServer() {',
      '  return createServer((request, response) => {',
      '    database.exec("UPDATE items SET value = \'sql-must-not-leak\' WHERE id = 1 -- private comment");',
      '    const rows = Array.from({ length: 3 }, () => database.prepare("SELECT value FROM items WHERE id = 1").get());',
      "    response.writeHead(200, { 'content-type': 'application/json' });",
      '    response.end(JSON.stringify({ ok: true, value: rows[0].value }));',
      '  });',
      '}',
      '',
    ].join('\n'),
    'test/http.test.js': [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "import { startServer } from '../src/server.js';",
      "test('captures local request', async () => {",
      '  const server = startServer();',
      '  await new Promise((resolve) => server.listen(0, resolve));',
      '  try {',
      '    const port = server.address().port;',
      `    const response = await fetch(\`http://127.0.0.1:\${port}/items/private-abcdef123456?token=must-not-leak\`);`,
      '    assert.equal(response.status, 200);',
      '  } finally {',
      '    await new Promise((resolve) => server.close(resolve));',
      '  }',
      '});',
      '',
    ].join('\n'),
  });
  const service = await createLocalFlowService(root);
  const captured = await service.capture({
    adapter: 'node-test',
    target: 'test/http.test.js',
    name: 'captures local request',
    samples: 2,
    warmups: 0,
    timeout_ms: 10_000,
  });

  assert.equal(captured.verdict.status, 'captured', JSON.stringify(captured));
  assert.deepEqual(captured.coverage.captured_kinds, ['database', 'http_client', 'http_server']);
  assert.equal(
    captured.coverage.operation_summary.find(
      (summary) => summary.kind === 'database' && summary.operation === 'exec'
    ).count,
    1
  );
  assert.equal(captured.capture.temporary_artifacts_retained, false);
  assert.ok(captured.limitations.some((entry) => entry.includes('source-map quality')));
  assert.ok(captured.capture.coverage_files > 0);
  assert.ok(captured.capture.coverage_functions > 0);
  assert.equal(captured.flow_analysis.database.count, 4);
  assert.ok(captured.function_analysis.observed_function_count > 0);
  assert.equal(captured.tool_diagnosis.schema_version, 'runtime-performance-findings/v2');
  assert.equal(captured.detector_coverage_matrix.lanes[0].lane, 'node');
  const toolDiagnosis = service.diagnose({ capture_id: captured.capture_id });
  assert.deepEqual(toolDiagnosis.findings, captured.tool_diagnosis.findings);
  if (toolDiagnosis.findings.length > 0) {
    const inspectedFinding = service.inspectFinding({
      capture_id: captured.capture_id,
      finding_id: toolDiagnosis.findings[0].id,
    });
    assert.equal(inspectedFinding.finding.id, toolDiagnosis.findings[0].id);
  }
  const rootFlow = service.inspect({ capture_id: captured.capture_id });
  assert.equal(rootFlow.flow.kind, 'workload');
  const client = rootFlow.children.find((flow) => flow.kind === 'http_client');
  assert.equal(client.name, 'GET /items/:value');
  assert.equal(JSON.stringify(rootFlow).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(rootFlow).includes('private-abcdef123456'), false);
  const clientFlow = service.inspect({ capture_id: captured.capture_id, flow_id: client.id });
  const server = clientFlow.children.find((flow) => flow.kind === 'http_server');
  assert.ok(server.timing.accounting);
  const serverFlow = service.inspect({ capture_id: captured.capture_id, flow_id: server.id });
  assert.deepEqual(
    serverFlow.children.map((flow) => flow.kind),
    ['database', 'database', 'database', 'database']
  );
  assert.equal(JSON.stringify(serverFlow).includes('sql-must-not-leak'), false);
  assert.equal(JSON.stringify(serverFlow).includes('private comment'), false);
  assert.ok(
    serverFlow.children.every((flow) => flow.attributes.source?.file === 'src/server.js'),
    JSON.stringify(serverFlow)
  );
  assert.equal(JSON.stringify(serverFlow).includes(root), false);
  const explanation = service.explain({ capture_id: captured.capture_id });
  assert.ok(explanation.profile_repeatability);
  assert.ok(explanation.flow_analysis.conclusion.kind);
  assert.ok(explanation.function_analysis.conclusion.kind);
  assert.notEqual(explanation.diagnosis.verdict.status, 'actionable');

  const current = await service.capture({
    adapter: 'node-test',
    target: 'test/http.test.js',
    name: 'captures local request',
    samples: 2,
    warmups: 0,
    timeout_ms: 10_000,
  });
  const verification = service.verify({
    baseline_capture_id: captured.capture_id,
    current_capture_id: current.capture_id,
  });
  assert.equal(typeof verification.decisions.mechanically_confirmed, 'boolean');
  assert.equal(typeof verification.decisions.materially_useful, 'boolean');
  assert.equal(typeof verification.decisions.shipping_recommended, 'boolean');
  assert.equal(verification.decisions.implementation_effect_confirmed, false);
  assert.deepEqual(verification.captures, {
    baseline: captured.capture_id,
    current: current.capture_id,
  });
  assert.equal('baseline_capsule' in verification, false);
  assert.equal('current_capsule' in verification, false);
});

test('runtime MCP exposes product capabilities and fails closed on unknown captures', async (context) => {
  const root = await gitFixture(context, { 'package.json': JSON.stringify({ type: 'module' }) });
  const tools = toolDefinitions();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      'qualify_runtime_repository',
      'inspect_react_redundancy',
      'run_autonomous_performance_lab',
      'plan_browser_optimization_loop',
      'get_next_browser_experiment',
      'evaluate_browser_experiment',
      'inspect_performance_run',
      'inspect_browser_probe',
      'recapture_browser_probe',
      'assess_browser_probe_stability',
      'stabilize_browser_probe',
      'plan_flow_optimization_campaign',
      'capture_local_flow',
      'inspect_local_flow',
      'explain_local_flow',
      'verify_local_optimization',
      'initialize_optimization_campaign',
      'capture_optimization_baseline',
      'screen_optimization_candidate',
      'promote_optimization_candidate',
      'inspect_optimization_campaign',
      'get_optimization_campaign_status',
    ]
  );
  const performanceLab = tools.find((tool) => tool.name === 'run_autonomous_performance_lab');
  assert.equal(performanceLab.inputSchema.properties.max_steps.maximum, 8);
  assert.equal(performanceLab.inputSchema.properties.excluded_finding_ids.maxItems, 8);
  assert.equal(performanceLab.inputSchema.properties.excluded_candidate_keys.maxItems, 8);
  assert.equal(performanceLab.inputSchema.properties.continue_from.maxLength, 64);
  assert.equal(performanceLab.annotations.readOnlyHint, false);
  assert.equal(
    tools.find((tool) => tool.name === 'qualify_runtime_repository').annotations.readOnlyHint,
    true
  );
  assert.equal(
    tools.find((tool) => tool.name === 'inspect_react_redundancy').annotations.readOnlyHint,
    true
  );
  assert.equal(
    tools.find((tool) => tool.name === 'inspect_local_flow').annotations.readOnlyHint,
    true
  );
  assert.equal(
    tools.find((tool) => tool.name === 'inspect_browser_probe').annotations.readOnlyHint,
    true
  );
  assert.equal(
    tools.find((tool) => tool.name === 'recapture_browser_probe').annotations.readOnlyHint,
    false
  );
  assert.equal(
    tools.find((tool) => tool.name === 'assess_browser_probe_stability').annotations.readOnlyHint,
    true
  );
  assert.equal(
    tools.find((tool) => tool.name === 'stabilize_browser_probe').annotations.readOnlyHint,
    false
  );

  const handle = await createRuntimeMcpHandler(root);
  const listed = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(listed.result.tools.length, 22);
  const qualification = await handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'qualify_runtime_repository', arguments: {} },
  });
  assert.equal(qualification.result.structuredContent.result.status, 'no_representative_workload');
  const missing = await handle({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'inspect_local_flow', arguments: { capture_id: 'capture-missing' } },
  });
  assert.equal(missing.result.isError, true);
  assert.match(missing.result.structuredContent.error.message, /Unknown or expired/);

  const campaignService = {
    status: (input) => ({ campaign_id: 'fixture', input }),
  };
  const campaignHandle = await createRuntimeMcpHandler(root, { campaignService });
  const campaignStatus = await campaignHandle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'get_optimization_campaign_status',
      arguments: { campaign_directory: '.codevetter/optimization-campaigns/fixture' },
    },
  });
  assert.equal(campaignStatus.result.structuredContent.result.campaign_id, 'fixture');
  const escaped = await campaignHandle({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'get_optimization_campaign_status',
      arguments: {
        campaign_directory: '.codevetter/optimization-campaigns/fixture',
        command: 'rm',
      },
    },
  });
  assert.equal(escaped.result.isError, true);
  assert.match(escaped.result.structuredContent.error.message, /Unknown tool argument/);

  let plannerInput = null;
  const plannerHandle = await createRuntimeMcpHandler(root, {
    campaignService,
    flowCampaignPlanner: async (input) => {
      plannerInput = input;
      return { schema_version: 'runtime-flow-campaign-plan/v1', verdict: { status: 'measured' } };
    },
  });
  const planned = await plannerHandle({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'plan_flow_optimization_campaign',
      arguments: { max_flows: 2, samples: 3, warmups: 1, timeout_ms: 1_000 },
    },
  });
  assert.equal(planned.result.isError, false);
  assert.equal(plannerInput.repositoryRoot, root);
  assert.equal(plannerInput.maxFlows, 2);
  const invalidPlan = await plannerHandle({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: {
      name: 'plan_flow_optimization_campaign',
      arguments: { max_flows: 2, command: 'curl production' },
    },
  });
  assert.equal(invalidPlan.result.isError, true);
  assert.match(invalidPlan.result.structuredContent.error.message, /Unknown tool argument/);

  let laboratoryInput = null;
  const laboratoryHandle = await createRuntimeMcpHandler(root, {
    campaignService,
    incumbentRepositoryRoot: '/tmp/incumbent',
    performanceLabRunner: async (input) => {
      laboratoryInput = input;
      return { schema_version: 'runtime-performance-lab-run/v3', state: 'completed' };
    },
  });
  const laboratory = await laboratoryHandle({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: {
      name: 'run_autonomous_performance_lab',
      arguments: {
        lab_id: 'mcp-lab',
        max_steps: 2,
        warmups: 0,
        timeout_ms: 1_000,
        excluded_finding_ids: ['a'.repeat(24)],
        excluded_candidate_keys: ['b'.repeat(24)],
        continue_from: 'mcp-baseline',
      },
    },
  });
  assert.equal(laboratory.result.isError, false);
  assert.deepEqual(laboratoryInput, {
    repositoryRoot: root,
    labId: 'mcp-lab',
    maxSteps: 2,
    warmups: 0,
    timeoutMs: 1_000,
    excludedFindingIds: ['a'.repeat(24)],
    excludedCandidateKeys: ['b'.repeat(24)],
    continueFrom: 'mcp-baseline',
    incumbentRepository: '/tmp/incumbent',
  });
  const unsafeLaboratory = await laboratoryHandle({
    jsonrpc: '2.0',
    id: 8,
    method: 'tools/call',
    params: {
      name: 'run_autonomous_performance_lab',
      arguments: { lab_id: 'mcp-lab-unsafe', command: 'curl production' },
    },
  });
  assert.equal(unsafeLaboratory.result.isError, true);
  assert.match(unsafeLaboratory.result.structuredContent.error.message, /Unknown tool argument/);

  const loopCalls = [];
  const loopHandle = await createRuntimeMcpHandler(root, {
    campaignService,
    incumbentRepositoryRoot: '/tmp/incumbent',
    browserOptimizationLoopService: {
      plan: async (input) => {
        loopCalls.push(['plan', input]);
        return { state: 'active' };
      },
      next: async (input) => {
        loopCalls.push(['next', input]);
        return { state: 'active' };
      },
      evaluate: async (input) => {
        loopCalls.push(['evaluate', input]);
        return { state: 'queue_exhausted' };
      },
    },
  });
  for (const [id, name, args] of [
    [
      81,
      'plan_browser_optimization_loop',
      {
        loop_id: 'browser-loop',
        campaign_directory: '.codevetter/optimization-campaigns/browser-loop',
        capture_id: 'browser-capture',
      },
    ],
    [82, 'get_next_browser_experiment', { loop_id: 'browser-loop' }],
    [83, 'evaluate_browser_experiment', { loop_id: 'browser-loop' }],
  ]) {
    const response = await loopHandle({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    assert.equal(response.result.isError, false);
  }
  assert.deepEqual(loopCalls.at(-1), [
    'evaluate',
    { loop_id: 'browser-loop', incumbent_repository: '/tmp/incumbent' },
  ]);
  const unsafeLoop = await loopHandle({
    jsonrpc: '2.0',
    id: 84,
    method: 'tools/call',
    params: {
      name: 'evaluate_browser_experiment',
      arguments: { loop_id: 'browser-loop', command: 'curl production' },
    },
  });
  assert.equal(unsafeLoop.result.isError, true);
  assert.match(unsafeLoop.result.structuredContent.error.message, /Unknown tool argument/);

  let probeInput = null;
  const expectedProbe = { schema_version: 'runtime-browser-probe-inspection/v1' };
  const probeHandle = await createRuntimeMcpHandler(root, {
    campaignService,
    browserProbeInspector: async (input) => {
      probeInput = input;
      return expectedProbe;
    },
  });
  const inspectedProbe = await probeHandle({
    jsonrpc: '2.0',
    id: 9,
    method: 'tools/call',
    params: {
      name: 'inspect_browser_probe',
      arguments: {
        capture_id: 'browser-capture',
        probe: 'inspect_libuv_threadpool_crypto',
      },
    },
  });
  assert.deepEqual(probeInput, {
    capture_id: 'browser-capture',
    probe: 'inspect_libuv_threadpool_crypto',
  });
  assert.deepEqual(inspectedProbe.result.structuredContent.result, expectedProbe);
  const inspectedContinuousProbe = await probeHandle({
    jsonrpc: '2.0',
    id: 91,
    method: 'tools/call',
    params: {
      name: 'inspect_browser_probe',
      arguments: {
        capture_id: 'browser-capture',
        probe: 'inspect_continuous_main_thread_source',
        source_recapture_id: 'lower-unresolved',
      },
    },
  });
  assert.equal(inspectedContinuousProbe.result.isError, false);
  assert.deepEqual(probeInput, {
    capture_id: 'browser-capture',
    probe: 'inspect_continuous_main_thread_source',
    source_recapture_id: 'lower-unresolved',
  });
  const rejectedProbe = await probeHandle({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: {
      name: 'inspect_browser_probe',
      arguments: {
        capture_id: 'browser-capture',
        probe: 'inspect_libuv_threadpool_crypto',
        execute: true,
      },
    },
  });
  assert.equal(rejectedProbe.result.isError, true);
  assert.match(rejectedProbe.result.structuredContent.error.message, /Unknown tool argument/);

  let recaptureInput = null;
  const recaptureHandle = await createRuntimeMcpHandler(root, {
    campaignService,
    browserProbeRecapturer: async (input) => {
      recaptureInput = input;
      return { schema_version: 'runtime-browser-probe-recapture/v2', state: 'completed' };
    },
  });
  const recaptured = await recaptureHandle({
    jsonrpc: '2.0',
    id: 11,
    method: 'tools/call',
    params: {
      name: 'recapture_browser_probe',
      arguments: {
        capture_id: 'browser-capture',
        probe: 'complete_async_and_framework_inventories',
        recapture_id: 'browser-recapture',
        timeout_ms: 10_000,
      },
    },
  });
  assert.equal(recaptured.result.isError, false);
  assert.deepEqual(recaptureInput, {
    capture_id: 'browser-capture',
    probe: 'complete_async_and_framework_inventories',
    recapture_id: 'browser-recapture',
    timeout_ms: 10_000,
  });
  const continuousRecaptured = await recaptureHandle({
    jsonrpc: '2.0',
    id: 113,
    method: 'tools/call',
    params: {
      name: 'recapture_browser_probe',
      arguments: {
        capture_id: 'browser-capture',
        probe: 'inspect_continuous_main_thread_source',
        source_recapture_id: 'lower-unresolved',
        recapture_id: 'browser-continuous-source-recapture',
        timeout_ms: 10_000,
      },
    },
  });
  assert.equal(continuousRecaptured.result.isError, false);
  assert.deepEqual(recaptureInput, {
    capture_id: 'browser-capture',
    probe: 'inspect_continuous_main_thread_source',
    source_recapture_id: 'lower-unresolved',
    recapture_id: 'browser-continuous-source-recapture',
    timeout_ms: 10_000,
  });
  const lowerOverheadRecaptured = await recaptureHandle({
    jsonrpc: '2.0',
    id: 112,
    method: 'tools/call',
    params: {
      name: 'recapture_browser_probe',
      arguments: {
        capture_id: 'browser-capture',
        probe: 'repeat_with_lower_overhead_cpu_measurement',
        recapture_id: 'browser-lower-overhead-recapture',
        timeout_ms: 10_000,
      },
    },
  });
  assert.equal(lowerOverheadRecaptured.result.isError, false);
  assert.equal(recaptureInput.probe, 'repeat_with_lower_overhead_cpu_measurement');
  const runtimeRecaptured = await recaptureHandle({
    jsonrpc: '2.0',
    id: 111,
    method: 'tools/call',
    params: {
      name: 'recapture_browser_probe',
      arguments: {
        capture_id: 'browser-capture',
        probe: 'inspect_main_thread_runtime',
        recapture_id: 'browser-runtime-recapture',
        timeout_ms: 10_000,
      },
    },
  });
  assert.equal(runtimeRecaptured.result.isError, false);
  assert.deepEqual(recaptureInput, {
    capture_id: 'browser-capture',
    probe: 'inspect_main_thread_runtime',
    recapture_id: 'browser-runtime-recapture',
    timeout_ms: 10_000,
  });
  const rejectedRecapture = await recaptureHandle({
    jsonrpc: '2.0',
    id: 12,
    method: 'tools/call',
    params: {
      name: 'recapture_browser_probe',
      arguments: {
        capture_id: 'browser-capture',
        probe: 'complete_async_and_framework_inventories',
        recapture_id: 'browser-recapture',
        command: 'curl production',
      },
    },
  });
  assert.equal(rejectedRecapture.result.isError, true);
  assert.match(rejectedRecapture.result.structuredContent.error.message, /Unknown tool argument/);

  let stabilityInput = null;
  const stabilityHandle = await createRuntimeMcpHandler(root, {
    campaignService,
    browserProbeStabilityAssessor: async (input) => {
      stabilityInput = input;
      return { schema_version: 'runtime-browser-probe-stability/v1', state: 'unstable' };
    },
  });
  const assessed = await stabilityHandle({
    jsonrpc: '2.0',
    id: 13,
    method: 'tools/call',
    params: {
      name: 'assess_browser_probe_stability',
      arguments: { recapture_ids: ['browser-recapture-a', 'browser-recapture-b'] },
    },
  });
  assert.equal(assessed.result.isError, false);
  assert.deepEqual(stabilityInput, {
    recapture_ids: ['browser-recapture-a', 'browser-recapture-b'],
  });
  const rejectedAssessment = await stabilityHandle({
    jsonrpc: '2.0',
    id: 14,
    method: 'tools/call',
    params: {
      name: 'assess_browser_probe_stability',
      arguments: {
        recapture_ids: ['browser-recapture-a', 'browser-recapture-b'],
        command: 'curl production',
      },
    },
  });
  assert.equal(rejectedAssessment.result.isError, true);
  assert.match(rejectedAssessment.result.structuredContent.error.message, /Unknown tool argument/);

  let stabilizerInput = null;
  const stabilizerHandle = await createRuntimeMcpHandler(root, {
    campaignService,
    browserProbeStabilizer: async (input) => {
      stabilizerInput = input;
      return { schema_version: 'runtime-browser-probe-stability-schedule/v1', state: 'unstable' };
    },
  });
  const stabilized = await stabilizerHandle({
    jsonrpc: '2.0',
    id: 15,
    method: 'tools/call',
    params: {
      name: 'stabilize_browser_probe',
      arguments: {
        capture_id: 'browser-capture',
        probe: 'complete_async_and_framework_inventories',
        schedule_id: 'browser-schedule',
        existing_recapture_ids: ['browser-recapture-a', 'browser-recapture-b'],
        max_new_runs: 1,
        timeout_ms: 10_000,
      },
    },
  });
  assert.equal(stabilized.result.isError, false);
  assert.deepEqual(stabilizerInput, {
    capture_id: 'browser-capture',
    probe: 'complete_async_and_framework_inventories',
    schedule_id: 'browser-schedule',
    existing_recapture_ids: ['browser-recapture-a', 'browser-recapture-b'],
    max_new_runs: 1,
    timeout_ms: 10_000,
  });
  const runtimeStabilized = await stabilizerHandle({
    jsonrpc: '2.0',
    id: 115,
    method: 'tools/call',
    params: {
      name: 'stabilize_browser_probe',
      arguments: {
        capture_id: 'browser-capture',
        probe: 'inspect_main_thread_runtime',
        schedule_id: 'browser-runtime-schedule',
        max_new_runs: 0,
        timeout_ms: 10_000,
      },
    },
  });
  assert.equal(runtimeStabilized.result.isError, false);
  assert.equal(stabilizerInput.probe, 'inspect_main_thread_runtime');
  const lowerOverheadStabilized = await stabilizerHandle({
    jsonrpc: '2.0',
    id: 116,
    method: 'tools/call',
    params: {
      name: 'stabilize_browser_probe',
      arguments: {
        capture_id: 'browser-capture',
        probe: 'repeat_with_lower_overhead_cpu_measurement',
        schedule_id: 'browser-lower-overhead-schedule',
        max_new_runs: 0,
        timeout_ms: 10_000,
      },
    },
  });
  assert.equal(lowerOverheadStabilized.result.isError, false);
  assert.equal(stabilizerInput.probe, 'repeat_with_lower_overhead_cpu_measurement');
  const continuousStabilized = await stabilizerHandle({
    jsonrpc: '2.0',
    id: 117,
    method: 'tools/call',
    params: {
      name: 'stabilize_browser_probe',
      arguments: {
        capture_id: 'browser-capture',
        probe: 'inspect_continuous_main_thread_source',
        source_recapture_id: 'lower-unresolved',
        schedule_id: 'browser-continuous-source-schedule',
        max_new_runs: 0,
        timeout_ms: 10_000,
      },
    },
  });
  assert.equal(continuousStabilized.result.isError, false);
  assert.equal(stabilizerInput.probe, 'inspect_continuous_main_thread_source');
  const rejectedStabilizer = await stabilizerHandle({
    jsonrpc: '2.0',
    id: 16,
    method: 'tools/call',
    params: {
      name: 'stabilize_browser_probe',
      arguments: {
        capture_id: 'browser-capture',
        probe: 'complete_async_and_framework_inventories',
        schedule_id: 'browser-schedule',
        command: 'curl production',
      },
    },
  });
  assert.equal(rejectedStabilizer.result.isError, true);
  assert.match(rejectedStabilizer.result.structuredContent.error.message, /Unknown tool argument/);
});

test('runtime MCP process speaks line-delimited JSON-RPC without network setup', async (context) => {
  const root = await gitFixture(context, { 'package.json': JSON.stringify({ type: 'module' }) });
  const responses = await mcpProcess(root, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ]);
  assert.equal(responses[0].result.serverInfo.name, 'codevetter-local-runtime');
  assert.equal(responses[1].result.tools.length, 22);
});

test('validates the required recursive flow contract', () => {
  const capsule = {
    schema_version: 'runtime-flow-capsule/v1',
    subject: { repository_revision: 'abc123' },
    adapter: { kind: 'node-test' },
    scope: { target: 'test/http.test.js' },
    root_flow_id: 'flow-1',
    flows: [
      {
        id: 'flow-1',
        kind: 'workload',
        evidence_ids: [],
        limitations: [],
      },
    ],
    relationships: [],
    limitations: [],
    verdict: { status: 'captured' },
  };
  capsule.tool_diagnosis = diagnoseToolLedPerformance(capsule);
  assert.deepEqual(validateFlowCapsule(capsule), []);
  capsule.tool_diagnosis.findings = [
    {
      ...diagnoseToolLedPerformance({
        ...capsule,
        flows: [
          ...capsule.flows,
          {
            id: 'flow-2',
            parent_flow_id: 'flow-1',
            kind: 'http_server',
            name: 'GET /fixture',
            timing: {
              duration_ms: 10,
              started_at_ms: 1,
              accounting: { unaccounted_ms: 10 },
            },
            attributes: { method: 'GET', route: '/fixture', status: 200, outcome: 'ok' },
            evidence_ids: ['event-2'],
            limitations: [],
          },
        ],
      }).findings[0],
      evidence_ids: ['missing-evidence'],
    },
  ];
  assert.ok(
    validateFlowCapsule(capsule).includes('finding evidence_id does not identify captured evidence')
  );
  capsule.tool_diagnosis = diagnoseToolLedPerformance(capsule);
  capsule.flows.push({ ...capsule.flows[0] });
  assert.ok(validateFlowCapsule(capsule).includes('flow identifiers must be unique'));
});

test('keeps local flow capture scoped to the qualified Node adapters', () => {
  assert.equal(assertFlowAdapter('node-test'), 'node-test');
  assert.equal(assertFlowAdapter('vitest'), 'vitest');
  assert.equal(assertFlowAdapter('jest'), 'jest');
  assert.throws(() => assertFlowAdapter('go-bench'), /unsupported local flow adapter/);
});

test('normalizes bounded Playwright navigation and network evidence without URL queries', async (context) => {
  const trace = [
    {
      type: 'before',
      callId: 'call-1',
      apiName: 'page.goto',
      startTime: 100,
      params: { url: 'http://localhost/items?token=must-not-leak' },
    },
    { type: 'after', callId: 'call-1', endTime: 130 },
    { type: 'frame-snapshot', snapshot: { timestamp: 128, frameId: 'main' } },
    ...[0, 5, 10].map((offset) => ({
      type: 'resource-snapshot',
      snapshot: {
        request: {
          method: 'GET',
          url: `http://localhost/api/items?secret=${offset}`,
        },
        response: { status: 200 },
        timing: { startTime: 102 + offset, responseEnd: 105 + offset },
      },
    })),
  ]
    .map(JSON.stringify)
    .join('\n');
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '1.0.0' } }),
    'trace.trace': trace,
  });
  const report = await diagnosePlaywrightTrace(root, 'trace.trace');
  assert.equal(report.flows.filter((flow) => flow.kind === 'http_client').length, 3);
  assert.equal(report.flows.filter((flow) => flow.kind === 'render_observation').length, 1);
  assert.equal(JSON.stringify(report).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(report).includes('?secret='), false);
  const react = report.detector_coverage_matrix.lanes.find((lane) => lane.lane === 'react');
  assert.equal(
    react.mechanisms.find((entry) => entry.mechanism === 'browser_navigation').status,
    'ran'
  );
  assert.equal(
    react.mechanisms.find((entry) => entry.mechanism === 'browser_render').status,
    'insufficient_evidence'
  );
});

test('normalizes SQL literals and comments without collecting query values', () => {
  assert.equal(
    normalizeSqlShape(
      "SELECT * FROM private_items WHERE id = 123 AND token = 'secret' /* hidden */"
    ),
    'SELECT * FROM private_items WHERE id = ? AND token = ?'
  );
});

test('labels SQLite as material only when it dominates the slowest server flow', () => {
  const analysis = analyzeFlowOperations([
    { id: 'flow-1', kind: 'workload', timing: { duration_ms: 50 } },
    {
      id: 'flow-2',
      kind: 'http_server',
      name: 'GET /items',
      parent_flow_id: 'flow-1',
      timing: { duration_ms: 10, accounting: { unaccounted_ms: 3 } },
    },
    {
      id: 'flow-3',
      kind: 'database',
      parent_flow_id: 'flow-2',
      timing: { duration_ms: 7 },
    },
  ]);
  assert.equal(analysis.conclusion.kind, 'database_material_candidate');
  assert.equal(analysis.slowest_server.database_share, 0.7);
  assert.equal(analysis.next_boundary, 'inspect_slowest_database_flow');
});

test('normalizes only repository application function coverage with source anchors', async (context) => {
  const root = await temporaryRoot(context);
  const coverageDirectory = join(root, 'coverage');
  const sourcePath = join(root, 'src/app.js');
  const harnessPath = join(root, 'test/app.test.js');
  const source = [
    'export function repeatedWork(items) {',
    '  return items.map((item) => item * 2);',
    '}',
    '',
  ].join('\n');
  const harness = 'export function harnessOnly() { return true; }\n';
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'test'), { recursive: true });
  await mkdir(coverageDirectory);
  await writeFile(sourcePath, source);
  await writeFile(harnessPath, harness);
  await writeFile(
    join(coverageDirectory, 'coverage-1.json'),
    JSON.stringify({
      result: [
        {
          url: pathToFileURL(sourcePath).href,
          functions: [
            {
              functionName: 'repeatedWork',
              ranges: [{ startOffset: 0, endOffset: source.length, count: 8 }],
            },
          ],
        },
        {
          url: pathToFileURL(harnessPath).href,
          functions: [
            {
              functionName: 'harnessOnly',
              ranges: [{ startOffset: 0, endOffset: harness.length, count: 99 }],
            },
          ],
        },
      ],
    })
  );

  const result = await collectV8FunctionCoverage(coverageDirectory, root);
  assert.equal(result.functions.length, 1);
  assert.deepEqual(result.functions[0], {
    id: 'function-coverage-1',
    function: 'repeatedWork',
    file: 'src/app.js',
    start_line: 1,
    end_line: 4,
    call_count: 8,
    role: 'application',
  });
});

test('function coverage fast path still redacts credential and URL-shaped names', async (context) => {
  const root = await temporaryRoot(context);
  const coverageDirectory = join(root, 'coverage');
  const sourcePath = join(root, 'src/app.js');
  const source = 'export function safeName() { return true; }\n';
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(coverageDirectory);
  await writeFile(sourcePath, source);
  await writeFile(
    join(coverageDirectory, 'coverage-1.json'),
    JSON.stringify({
      result: [
        {
          url: pathToFileURL(sourcePath).href,
          functions: [
            {
              functionName: 'safeName',
              ranges: [{ startOffset: 0, endOffset: source.length, count: 2 }],
            },
            {
              functionName: 'token=supersecret',
              ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }],
            },
            {
              functionName: 'https://example.test/function?token=url-secret',
              ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }],
            },
          ],
        },
      ],
    })
  );

  const result = await collectV8FunctionCoverage(coverageDirectory, root);
  assert.deepEqual(
    result.functions.map((entry) => entry.function),
    ['safeName', 'token=<redacted>', 'https://example.test/function?<redacted:query>']
  );
  assert.equal(result.redaction_count, 3);
  assert.equal(JSON.stringify(result).includes('supersecret'), false);
  assert.equal(JSON.stringify(result).includes('url-secret'), false);
});

test('function coverage hash collisions retain exact identities and duplicate counts', async (context) => {
  const root = await temporaryRoot(context);
  const coverageDirectory = join(root, 'coverage');
  const sourcePath = join(root, 'src/app.js');
  const source = 'export const value = true;\n';
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(coverageDirectory);
  await writeFile(sourcePath, source);
  await writeFile(
    join(coverageDirectory, 'coverage-1.json'),
    JSON.stringify({
      result: [
        {
          url: pathToFileURL(sourcePath).href,
          functions: [
            {
              functionName: 'fnjd43lfoyh',
              ranges: [{ startOffset: 0, endOffset: source.length, count: 2 }],
            },
            {
              functionName: 'fn1bfz2ipvb3',
              ranges: [{ startOffset: 0, endOffset: source.length, count: 4 }],
            },
            {
              functionName: 'fnjd43lfoyh',
              ranges: [{ startOffset: 0, endOffset: source.length, count: 3 }],
            },
          ],
        },
      ],
    })
  );

  const result = await collectV8FunctionCoverage(coverageDirectory, root);
  assert.deepEqual(
    result.functions.map((entry) => [entry.function, entry.call_count]),
    [
      ['fnjd43lfoyh', 5],
      ['fn1bfz2ipvb3', 4],
    ]
  );
});

test('normalizes runner-native Vitest function counts from original TypeScript anchors', async (context) => {
  const root = await temporaryRoot(context);
  const coverageDirectory = join(root, 'coverage');
  const sourcePath = join(root, 'src/recommendations.ts');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(coverageDirectory);
  await writeFile(sourcePath, 'export function recommend() { return []; }\n');
  await writeFile(
    join(coverageDirectory, 'coverage-final.json'),
    JSON.stringify({
      [sourcePath]: {
        fnMap: {
          0: {
            name: 'recommend',
            decl: { start: { line: 1 }, end: { line: 1 } },
            loc: { start: { line: 1 }, end: { line: 1 } },
          },
          1: {
            name: '(anonymous_1)',
            decl: { start: { line: 1 }, end: { line: 1 } },
            loc: { start: { line: 1 }, end: { line: 1 } },
          },
        },
        f: { 0: 7, 1: 100 },
      },
    })
  );

  const coverage = await collectV8FunctionCoverage(coverageDirectory, root);
  assert.deepEqual(coverage.functions, [
    {
      id: 'function-coverage-1',
      function: 'recommend',
      file: 'src/recommendations.ts',
      start_line: 1,
      end_line: 1,
      call_count: 7,
      role: 'application',
    },
  ]);
});

test('joins repeated function counts to CPU ranges without assigning coverage duration', () => {
  const analysis = analyzeFunctionFrequency(
    {
      observed: {
        function_coverage: {
          functions: [
            {
              id: 'function-coverage-1',
              function: 'buildProjection',
              file: 'src/projection.js',
              start_line: 5,
              end_line: 20,
              call_count: 8,
            },
          ],
        },
        hotspots: [
          {
            function: '<anonymous>',
            file: 'src/projection.js',
            line: 12,
            role: 'application',
            self_time_ms: 4,
            samples: 4,
            sample_share: 0.05,
          },
        ],
      },
    },
    [
      { kind: 'http_server' },
      { kind: 'http_server' },
      { kind: 'http_server' },
      { kind: 'http_server' },
    ]
  );
  assert.equal(analysis.conclusion.kind, 'repeated_application_work_candidate');
  assert.equal(analysis.conclusion.actionability, 'unverified');
  assert.equal(analysis.repeated_work_candidate.calls_per_server_flow, 2);
  assert.equal(analysis.policy.coverage_assigns_duration, false);
});

test('verifies a repeated-work implementation effect without claiming duration', () => {
  const baseline = {
    function_analysis: {
      repeated_work_candidate: {
        function: 'buildProjection',
        file: 'src/projection.js',
        start_line: 5,
        call_count: 8,
      },
    },
  };
  const current = {
    performance_capsule: {
      observed: {
        function_coverage: {
          functions: [
            {
              function: 'buildProjection',
              file: 'src/projection.js',
              start_line: 5,
              call_count: 6,
            },
          ],
        },
      },
    },
  };
  assert.deepEqual(compareFunctionFrequency(baseline, current), {
    function: 'buildProjection',
    file: 'src/projection.js',
    start_line: 5,
    baseline_call_count: 8,
    current_call_count: 6,
    delta: -2,
    delta_percent: -25,
    provenance: 'exact_scope_v8_function_coverage',
    duration_claimed: false,
  });
});

async function temporaryRoot(context) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-flow-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function gitFixture(context, files) {
  const root = await temporaryRoot(context);
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  await command('git', ['init', '-q'], root);
  await command('git', ['add', '.'], root);
  await command(
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
    root
  );
  return root;
}

function command(program, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${program} failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

function commandCapture(program, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function mcpProcess(repositoryRoot, requests) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./mcp.mjs', import.meta.url)), '--', '--repo', repositoryRoot],
      { cwd: repositoryRoot, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`runtime MCP failed: ${stderr.trim() || `exit ${code}`}`));
        return;
      }
      try {
        resolvePromise(stdout.trim().split('\n').filter(Boolean).map(JSON.parse));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(`${requests.map((request) => JSON.stringify(request)).join('\n')}\n`);
  });
}
