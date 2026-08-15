#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { createOptimizationCampaignService } from './campaign.mjs';
import { createOptimizationContributionService } from './contribution.mjs';
import { planPerformanceExecution } from './execution-governance.mjs';
import {
  LIMITS,
  PROFILE_ADAPTERS,
  assertProfileAdapter,
  boundedCount,
  boundedTimeout,
} from './contracts.mjs';
import { createLocalFlowService } from './flow-service.mjs';
import { planFlowOptimizationCampaign } from './flow-campaign-planner.mjs';
import { qualifyRepository } from './qualification.mjs';
import { redactText } from './redact.mjs';
import { inspectSupervisedRun } from './supervision.mjs';
import { plannedProfileProcessCount, profileRepository } from './performance.mjs';
import { verifyPairedRepositories } from './paired-verification.mjs';

const PROTOCOL_VERSION = '2025-03-26';
const SERVER_INFO = { name: 'codevetter-local-runtime', version: '0.1.0' };
const PERFORMANCE_TOOLS = new Set([
  'plan_local_performance',
  'profile_local_performance',
  'verify_paired_performance',
]);

export async function createRuntimeMcpHandler(repositoryRoot, options = {}) {
  const flowService = options.flowService ?? (await createLocalFlowService(repositoryRoot));
  const campaignService =
    options.campaignService ?? (await createOptimizationCampaignService(repositoryRoot));
  const contributionService =
    options.contributionService ??
    (await createOptimizationContributionService(repositoryRoot, { campaignService }));
  const flowCampaignPlanner =
    options.flowCampaignPlanner ?? ((input) => planFlowOptimizationCampaign(input));
  return async function handle(request) {
    if (request?.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return failure(request?.id ?? null, -32600, 'Invalid JSON-RPC request');
    }
    if (request.method === 'notifications/initialized') return null;
    if (request.method === 'initialize') {
      return success(request.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    if (request.method === 'tools/list') return success(request.id, { tools: toolDefinitions() });
    if (request.method !== 'tools/call') return failure(request.id, -32601, 'Method not found');

    try {
      const result = await callTool(
        flowService,
        campaignService,
        contributionService,
        flowCampaignPlanner,
        repositoryRoot,
        options.incumbentRepositoryRoot,
        request.params?.name,
        request.params?.arguments
      );
      return success(request.id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: { result },
        isError: false,
      });
    } catch (error) {
      const sanitized = redactText(error?.message ?? String(error), {
        repositoryRoot,
        limit: 500,
      });
      return success(request.id, {
        content: [{ type: 'text', text: sanitized.text }],
        structuredContent: {
          error: { code: 'runtime_tool_error', message: sanitized.text },
        },
        isError: true,
      });
    }
  };
}

async function callTool(
  flowService,
  campaignService,
  contributionService,
  flowCampaignPlanner,
  repositoryRoot,
  incumbentRepositoryRoot,
  name,
  args
) {
  if (name === 'qualify_runtime_repository') {
    closedArguments(args, []);
    return qualifyRepository(repositoryRoot);
  }
  if (name === 'plan_flow_optimization_campaign') {
    closedArguments(
      args,
      [],
      ['priority_manifest', 'max_flows', 'samples', 'warmups', 'timeout_ms']
    );
    return flowCampaignPlanner({
      repositoryRoot,
      priorityManifestPath: args.priority_manifest,
      maxFlows: args.max_flows,
      samples: args.samples,
      warmups: args.warmups,
      timeoutMs: args.timeout_ms,
    });
  }
  if (name === 'inspect_performance_run') {
    closedArguments(args, ['run_id']);
    return inspectSupervisedRun(repositoryRoot, args.run_id);
  }
  if (PERFORMANCE_TOOLS.has(name)) {
    return callPerformanceTool({
      name,
      args,
      repositoryRoot,
      incumbentRepositoryRoot,
    });
  }
  if (name === 'capture_local_flow') {
    closedArguments(args, ['adapter', 'target'], ['name', 'samples', 'warmups', 'timeout_ms']);
    return flowService.capture(args);
  }
  if (name === 'inspect_local_flow') {
    closedArguments(args, ['capture_id'], ['flow_id']);
    return flowService.inspect(args);
  }
  if (name === 'explain_local_flow') {
    closedArguments(args, ['capture_id']);
    return flowService.explain(args);
  }
  if (name === 'verify_local_optimization') {
    closedArguments(args, ['baseline_capture_id', 'current_capture_id']);
    return flowService.verify(args);
  }
  if (name === 'initialize_optimization_campaign') {
    closedArguments(args, ['campaign_directory']);
    return campaignService.initialize(args);
  }
  if (name === 'capture_optimization_baseline') {
    closedArguments(args, ['campaign_directory']);
    return campaignService.baseline(args);
  }
  if (name === 'screen_optimization_candidate') {
    closedArguments(args, ['campaign_directory', 'hypothesis']);
    return campaignService.screen(args);
  }
  if (name === 'promote_optimization_candidate') {
    closedArguments(args, ['campaign_directory', 'hypothesis']);
    if (!incumbentRepositoryRoot) {
      throw new Error('Paired promotion requires --incumbent-repo when the MCP server starts');
    }
    return campaignService.promote({
      ...args,
      incumbent_repository: incumbentRepositoryRoot,
    });
  }
  if (name === 'inspect_optimization_campaign') {
    closedArguments(args, ['campaign_directory']);
    return campaignService.inspect(args);
  }
  if (name === 'get_optimization_campaign_status') {
    closedArguments(args, ['campaign_directory']);
    return campaignService.status(args);
  }
  if (name === 'challenge_optimization_candidate') {
    closedArguments(
      args,
      ['campaign_directory'],
      ['simpler_not_applicable_reason'],
      ['selected_sequence'],
      ['comparison_sequence']
    );
    return contributionService.challenge(args);
  }
  if (['inspect_optimization_contribution', 'refresh_optimization_contribution'].includes(name)) {
    closedArguments(
      args,
      ['campaign_directory', 'challenge_path', 'pull_request_url', 'trex_policy'],
      ['trex_receipt', 'trex_not_applicable_reason']
    );
    return contributionService[name.startsWith('inspect') ? 'inspect' : 'refresh'](args);
  }
  throw new Error('Unknown local runtime tool');
}

async function callPerformanceTool({ name, args, repositoryRoot, incumbentRepositoryRoot }) {
  if (name === 'plan_local_performance') {
    return callPerformancePlan(args, repositoryRoot);
  }
  closedArguments(
    args,
    ['adapter', 'target'],
    ['name', 'vite_build_directory', 'vite_entry'],
    [],
    ['samples', 'warmups', 'timeout_ms']
  );
  const input = {
    currentRepositoryRoot: repositoryRoot,
    repositoryRoot,
    adapter: assertProfileAdapter(args.adapter),
    target: args.target,
    name: args.name,
    timeoutMs: boundedTimeout(args.timeout_ms),
    samples: boundedSamples(args.samples),
    warmups: boundedWarmups(args.warmups),
    viteBuildDirectory: args.vite_build_directory,
    viteEntry: args.vite_entry,
  };
  if (name === 'verify_paired_performance') {
    if (!incumbentRepositoryRoot) {
      throw new Error('Paired verification requires --incumbent-repo when the MCP server starts');
    }
    return verifyPairedRepositories({ ...input, baselineRepositoryRoot: incumbentRepositoryRoot });
  }
  return profileRepository(input);
}

function callPerformancePlan(args, repositoryRoot) {
  closedArguments(
    args,
    ['adapter', 'target'],
    ['name', 'approval_identity'],
    [],
    ['samples', 'warmups', 'timeout_ms']
  );
  const adapter = assertProfileAdapter(args.adapter);
  const samples = boundedSamples(args.samples);
  const warmups = boundedWarmups(args.warmups);
  return planPerformanceExecution({
    repositoryRoot,
    adapter,
    target: args.target,
    name: args.name,
    timeoutMs: boundedTimeout(args.timeout_ms),
    processCount: plannedProfileProcessCount({ adapter, samples, warmups }),
    approvalIdentity: args.approval_identity,
  });
}

function closedArguments(
  value,
  required,
  optional = [],
  requiredIntegers = [],
  optionalIntegers = []
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool arguments must be an object');
  }
  const allowed = new Set([...required, ...optional, ...requiredIntegers, ...optionalIntegers]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter(
    (key) => typeof value[key] !== 'string' || value[key].trim() === ''
  );
  const missingIntegers = requiredIntegers.filter(
    (key) => !Number.isInteger(value[key]) || value[key] < 0
  );
  const invalidOptionalIntegers = optionalIntegers.filter(
    (key) => value[key] !== undefined && (!Number.isInteger(value[key]) || value[key] < 0)
  );
  if (unknown.length > 0) throw new Error(`Unknown tool argument: ${unknown.join(', ')}`);
  if (missing.length > 0) throw new Error(`Missing tool argument: ${missing.join(', ')}`);
  if (missingIntegers.length > 0) {
    throw new Error(`Missing integer tool argument: ${missingIntegers.join(', ')}`);
  }
  if (invalidOptionalIntegers.length > 0) {
    throw new Error(`Invalid integer tool argument: ${invalidOptionalIntegers.join(', ')}`);
  }
}

export function toolDefinitions() {
  const executeAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  };
  const readAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  return [
    {
      name: 'qualify_runtime_repository',
      description:
        'Inspect bounded local metadata and rank exact performance workload candidates without executing project code.',
      annotations: readAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: 'plan_local_performance',
      description:
        'Dry-run one exact performance scope and report immutable zero-egress, duration, retry, request, service, and cost bounds without executing project code.',
      annotations: readAnnotations,
      inputSchema: {
        ...performanceInputSchema(),
        properties: {
          ...performanceInputSchema().properties,
          approval_identity: {
            type: 'string',
            pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',
          },
        },
      },
    },
    {
      name: 'profile_local_performance',
      description:
        'Measure one exact local performance scope; Playwright scopes use exact reporter duration and optional unverified existing Vite artifacts.',
      annotations: executeAnnotations,
      inputSchema: performanceInputSchema(),
    },
    {
      name: 'verify_paired_performance',
      description:
        'Alternately compare one exact performance scope against the incumbent checkout fixed when this MCP server starts.',
      annotations: executeAnnotations,
      inputSchema: performanceInputSchema(),
    },
    {
      name: 'inspect_performance_run',
      description:
        'Read one durable local performance supervisor receipt and its validated result summary.',
      annotations: readAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['run_id'],
        properties: {
          run_id: {
            type: 'string',
            pattern: '^[a-z0-9][a-z0-9-]*$',
            maxLength: 80,
          },
        },
      },
    },
    {
      name: 'plan_flow_optimization_campaign',
      description:
        'Discover, screen, and impact-rank bounded exact local performance flows before starting an optimization campaign.',
      annotations: executeAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          priority_manifest: {
            type: 'string',
            description: 'Optional repository-relative flow priority manifest.',
          },
          max_flows: { type: 'integer', minimum: 1, maximum: 8 },
          samples: { type: 'integer', minimum: 2, maximum: 10 },
          warmups: { type: 'integer', minimum: 0, maximum: 5 },
          timeout_ms: { type: 'integer', minimum: 100, maximum: 120000 },
        },
      },
    },
    {
      name: 'capture_local_flow',
      description:
        'Run one exact bounded local Node or Vitest workload and capture recursive runtime evidence.',
      annotations: executeAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['adapter', 'target'],
        properties: {
          adapter: { type: 'string', enum: ['node-test', 'vitest'] },
          target: { type: 'string', description: 'Repository-relative exact test file.' },
          name: { type: 'string', description: 'Optional exact test name.' },
          samples: { type: 'integer', minimum: 2, maximum: 10 },
          warmups: { type: 'integer', minimum: 0, maximum: 5 },
          timeout_ms: { type: 'integer', minimum: 100, maximum: 120000 },
        },
      },
    },
    {
      name: 'inspect_local_flow',
      description: 'Inspect one captured flow and its direct child flows and relationships.',
      annotations: readAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['capture_id'],
        properties: {
          capture_id: { type: 'string' },
          flow_id: { type: 'string' },
        },
      },
    },
    {
      name: 'explain_local_flow',
      description:
        'Return evidence, inference, materiality, missing evidence, and the next experiment for a capture.',
      annotations: readAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['capture_id'],
        properties: { capture_id: { type: 'string' } },
      },
    },
    {
      name: 'verify_local_optimization',
      description: 'Compare two compatible captured flows and evaluate optimization impact.',
      annotations: readAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['baseline_capture_id', 'current_capture_id'],
        properties: {
          baseline_capture_id: { type: 'string' },
          current_capture_id: { type: 'string' },
        },
      },
    },
    campaignTool(
      'initialize_optimization_campaign',
      'Record one immutable local optimization campaign manifest and repository identity.',
      ['campaign_directory'],
      executeAnnotations
    ),
    campaignTool(
      'capture_optimization_baseline',
      'Run exact correctness scopes and capture the campaign performance incumbent.',
      ['campaign_directory'],
      executeAnnotations
    ),
    campaignTool(
      'screen_optimization_candidate',
      'Correctness-gate and screen one externally edited candidate against the incumbent.',
      ['campaign_directory', 'hypothesis'],
      executeAnnotations
    ),
    campaignTool(
      'promote_optimization_candidate',
      'Run paired promotion against the incumbent checkout fixed when this MCP server started.',
      ['campaign_directory', 'hypothesis'],
      executeAnnotations
    ),
    campaignTool(
      'inspect_optimization_campaign',
      'Read the manifest, complete tamper-checked history, incumbent, and next action.',
      ['campaign_directory'],
      readAnnotations
    ),
    campaignTool(
      'get_optimization_campaign_status',
      'Read campaign budgets, stop conditions, incumbent, latest result, and next action.',
      ['campaign_directory'],
      readAnnotations
    ),
    {
      name: 'challenge_optimization_candidate',
      description:
        'Challenge one kept optimization against deterministic diff complexity before publication.',
      annotations: executeAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['campaign_directory', 'selected_sequence'],
        properties: {
          campaign_directory: campaignDirectorySchema(),
          selected_sequence: { type: 'integer', minimum: 0, maximum: 300 },
          comparison_sequence: { type: 'integer', minimum: 0, maximum: 300 },
          simpler_not_applicable_reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    contributionTool(
      'inspect_optimization_contribution',
      'Inspect one GitHub pull request read-only and emit a revision-bound contribution receipt.',
      executeAnnotations
    ),
    contributionTool(
      'refresh_optimization_contribution',
      'Refresh existing read-only GitHub evidence once without polling or notifying maintainers.',
      executeAnnotations
    ),
  ];
}

function performanceInputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['adapter', 'target'],
    properties: {
      adapter: { type: 'string', enum: PROFILE_ADAPTERS },
      target: { type: 'string', description: 'Repository-relative exact workload file.' },
      name: { type: 'string', description: 'Exact workload name; required for Playwright.' },
      samples: { type: 'integer', minimum: 2, maximum: 10 },
      warmups: { type: 'integer', minimum: 0, maximum: 5 },
      timeout_ms: { type: 'integer', minimum: 100, maximum: 120000 },
      vite_build_directory: {
        type: 'string',
        description: 'Optional repository-relative existing Vite output; no build is run.',
      },
      vite_entry: { type: 'string', description: 'Optional HTML entry, default index.html.' },
    },
  };
}

function boundedSamples(value) {
  return boundedCount(value, {
    name: 'samples',
    defaultValue: LIMITS.defaultSamples,
    minimum: LIMITS.minimumSamples,
    maximum: LIMITS.maximumSamples,
  });
}

function boundedWarmups(value) {
  return boundedCount(value, {
    name: 'warmups',
    defaultValue: LIMITS.defaultWarmups,
    maximum: LIMITS.maximumWarmups,
  });
}

function campaignTool(name, description, required, annotations) {
  const properties = {
    campaign_directory: campaignDirectorySchema(),
  };
  if (required.includes('hypothesis')) {
    properties.hypothesis = {
      type: 'string',
      maxLength: 1000,
      description: 'One bounded, redacted hypothesis describing the external source edit.',
    };
  }
  return {
    name,
    description,
    annotations,
    inputSchema: { type: 'object', additionalProperties: false, required, properties },
  };
}

function campaignDirectorySchema() {
  return {
    type: 'string',
    description: 'Repository-relative directory under .codevetter/optimization-campaigns/.',
  };
}

function contributionTool(name, description, annotations) {
  return {
    name,
    description,
    annotations,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['campaign_directory', 'challenge_path', 'pull_request_url', 'trex_policy'],
      properties: {
        campaign_directory: campaignDirectorySchema(),
        challenge_path: { type: 'string', maxLength: 500 },
        pull_request_url: {
          type: 'string',
          pattern: '^https://github\\.com/[^/]+/[^/]+/pull/[0-9]+/?$',
          maxLength: 300,
        },
        trex_policy: { type: 'string', enum: ['optional', 'required', 'not_applicable'] },
        trex_receipt: { type: 'string', maxLength: 500 },
        trex_not_applicable_reason: { type: 'string', minLength: 1, maxLength: 1000 },
      },
    },
  };
}

function success(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function failure(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function serve() {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  if (![2, 4].includes(args.length) || args[0] !== '--repo') {
    throw new Error('usage: mcp.mjs --repo <repository> [--incumbent-repo <repository>]');
  }
  if (args.length === 4 && args[2] !== '--incumbent-repo') {
    throw new Error('usage: mcp.mjs --repo <repository> [--incumbent-repo <repository>]');
  }
  const handle = await createRuntimeMcpHandler(args[1], {
    incumbentRepositoryRoot: args[3],
  });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    let response;
    try {
      response = await handle(JSON.parse(line));
    } catch {
      response = failure(null, -32700, 'Parse error');
    }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  serve().catch((error) => {
    process.stderr.write(`codevetter local runtime MCP: ${error.message}\n`);
    process.exitCode = 1;
  });
}
