#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { inspectDurableBrowserProbe } from './browser-probe-inspection.mjs';
import { recaptureDurableBrowserProbe } from './browser-probe-recapture.mjs';
import { assessDurableBrowserProbeStability } from './browser-probe-stability.mjs';
import { stabilizeDurableBrowserProbe } from './browser-probe-stability-scheduler.mjs';
import { createBrowserOptimizationLoopService } from './browser-optimization-loop.mjs';
import { createOptimizationCampaignService } from './campaign.mjs';
import { createOptimizationContributionService } from './contribution.mjs';
import { createLocalFlowService } from './flow-service.mjs';
import { planFlowOptimizationCampaign } from './flow-campaign-planner.mjs';
import { runAutonomousPerformanceLab } from './performance-lab.mjs';
import { qualifyRepository } from './qualification.mjs';
import { redactText } from './redact.mjs';
import { inspectSupervisedRun } from './supervision.mjs';
import { inspectStaticRedundancy } from './static-redundancy.mjs';

const PROTOCOL_VERSION = '2025-03-26';
const SERVER_INFO = { name: 'codevetter-local-runtime', version: '0.1.0' };

export async function createRuntimeMcpHandler(repositoryRoot, options = {}) {
  const flowService = options.flowService ?? (await createLocalFlowService(repositoryRoot));
  const campaignService =
    options.campaignService ?? (await createOptimizationCampaignService(repositoryRoot));
  const contributionService =
    options.contributionService ??
    (await createOptimizationContributionService(repositoryRoot, { campaignService }));
  const flowCampaignPlanner =
    options.flowCampaignPlanner ?? ((input) => planFlowOptimizationCampaign(input));
  const performanceLabRunner =
    options.performanceLabRunner ?? ((input) => runAutonomousPerformanceLab(input));
  const staticRedundancyInspector =
    options.staticRedundancyInspector ??
    ((input) => inspectStaticRedundancy(repositoryRoot, input));
  const browserProbeInspector =
    options.browserProbeInspector ?? ((input) => inspectDurableBrowserProbe(repositoryRoot, input));
  const browserProbeRecapturer =
    options.browserProbeRecapturer ??
    ((input) => recaptureDurableBrowserProbe(repositoryRoot, input));
  const browserProbeStabilityAssessor =
    options.browserProbeStabilityAssessor ??
    ((input) => assessDurableBrowserProbeStability(repositoryRoot, input));
  const browserProbeStabilizer =
    options.browserProbeStabilizer ??
    ((input) => stabilizeDurableBrowserProbe(repositoryRoot, input));
  const browserOptimizationLoopService =
    options.browserOptimizationLoopService ??
    (await createBrowserOptimizationLoopService(repositoryRoot));
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
        performanceLabRunner,
        staticRedundancyInspector,
        browserProbeInspector,
        browserProbeRecapturer,
        browserProbeStabilityAssessor,
        browserProbeStabilizer,
        browserOptimizationLoopService,
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
  performanceLabRunner,
  staticRedundancyInspector,
  browserProbeInspector,
  browserProbeRecapturer,
  browserProbeStabilityAssessor,
  browserProbeStabilizer,
  browserOptimizationLoopService,
  repositoryRoot,
  incumbentRepositoryRoot,
  name,
  args
) {
  if (name === 'qualify_runtime_repository') {
    closedArguments(args, []);
    return qualifyRepository(repositoryRoot);
  }
  if (name === 'inspect_react_redundancy') {
    closedArguments(args, [], ['timeout_ms']);
    return staticRedundancyInspector({ timeoutMs: args.timeout_ms });
  }
  if (name === 'run_autonomous_performance_lab') {
    closedArguments(
      args,
      ['lab_id'],
      [
        'max_steps',
        'warmups',
        'timeout_ms',
        'excluded_finding_ids',
        'excluded_candidate_keys',
        'continue_from',
      ]
    );
    return performanceLabRunner({
      repositoryRoot,
      labId: args.lab_id,
      maxSteps: args.max_steps,
      warmups: args.warmups,
      timeoutMs: args.timeout_ms,
      excludedFindingIds: args.excluded_finding_ids,
      excludedCandidateKeys: args.excluded_candidate_keys,
      continueFrom: args.continue_from,
      incumbentRepository: args.continue_from ? incumbentRepositoryRoot : undefined,
    });
  }
  if (name === 'plan_browser_optimization_loop') {
    closedArguments(
      args,
      ['loop_id', 'campaign_directory', 'capture_id'],
      ['entry', 'build_directory', 'artifact_attestation', 'correctness_scope', 'policy']
    );
    return browserOptimizationLoopService.plan(args);
  }
  if (name === 'get_next_browser_experiment') {
    closedArguments(args, ['loop_id']);
    return browserOptimizationLoopService.next(args);
  }
  if (name === 'evaluate_browser_experiment') {
    closedArguments(args, ['loop_id'], ['entry', 'build_directory', 'artifact_attestation']);
    if (!incumbentRepositoryRoot) {
      throw new Error(
        'Browser experiment evaluation requires --incumbent-repo when the MCP server starts'
      );
    }
    return browserOptimizationLoopService.evaluate({
      ...args,
      incumbent_repository: incumbentRepositoryRoot,
    });
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
  if (name === 'inspect_browser_probe') {
    closedArguments(args, ['capture_id', 'probe'], ['source_recapture_id']);
    return browserProbeInspector(args);
  }
  if (name === 'recapture_browser_probe') {
    closedArguments(
      args,
      ['capture_id', 'probe', 'recapture_id'],
      ['source_recapture_id', 'timeout_ms']
    );
    return browserProbeRecapturer(args);
  }
  if (name === 'assess_browser_probe_stability') {
    closedArguments(args, [], ['recapture_ids']);
    return browserProbeStabilityAssessor(args);
  }
  if (name === 'stabilize_browser_probe') {
    closedArguments(
      args,
      ['capture_id', 'probe', 'schedule_id'],
      ['source_recapture_id', 'existing_recapture_ids', 'max_new_runs', 'timeout_ms']
    );
    return browserProbeStabilizer(args);
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
    return campaignService.screen({
      ...args,
      incumbent_repository: incumbentRepositoryRoot,
    });
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
      name: 'inspect_react_redundancy',
      description:
        'Run installed project-owned Knip and jscpd analyzers and return bounded dead-code and implementation-clone candidates; no removal is claimed or performed.',
      annotations: readAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          timeout_ms: { type: 'integer', minimum: 100, maximum: 120000 },
        },
      },
    },
    {
      name: 'run_autonomous_performance_lab',
      description:
        'Run or continue the bounded local performance loop; a configured incumbent and flow-owned correctness binding can finish paired acceptance.',
      annotations: executeAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['lab_id'],
        properties: {
          lab_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', maxLength: 64 },
          continue_from: {
            type: 'string',
            pattern: '^[a-z0-9][a-z0-9-]*$',
            maxLength: 64,
          },
          max_steps: { type: 'integer', minimum: 1, maximum: 8 },
          warmups: { type: 'integer', minimum: 0, maximum: 5 },
          timeout_ms: { type: 'integer', minimum: 100, maximum: 120000 },
          excluded_finding_ids: {
            type: 'array',
            maxItems: 8,
            uniqueItems: true,
            items: { type: 'string', pattern: '^[0-9a-f]{24}$' },
          },
          excluded_candidate_keys: {
            type: 'array',
            maxItems: 8,
            uniqueItems: true,
            items: { type: 'string', pattern: '^[0-9a-f]{24}$' },
          },
        },
      },
    },
    {
      name: 'plan_browser_optimization_loop',
      description:
        'Inspect all supported evidence families for one exact captured browser flow and persist a deterministic bounded experiment queue.',
      annotations: executeAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['loop_id', 'campaign_directory', 'capture_id'],
        properties: {
          loop_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', maxLength: 80 },
          campaign_directory: {
            type: 'string',
            pattern: '^\\.codevetter/optimization-campaigns/[a-z0-9][a-z0-9/-]*$',
            maxLength: 1000,
          },
          capture_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', maxLength: 80 },
          entry: { type: 'string', maxLength: 1000 },
          build_directory: { type: 'string', maxLength: 1000 },
          artifact_attestation: artifactAttestationSchema(),
          correctness_scope: {
            type: 'object',
            additionalProperties: false,
            required: ['adapter', 'target', 'name'],
            properties: {
              adapter: { type: 'string', enum: ['node-test', 'vitest', 'jest', 'go-test'] },
              target: { type: 'string', maxLength: 1000 },
              name: { type: 'string', maxLength: 1000 },
            },
          },
          policy: {
            type: 'object',
            additionalProperties: false,
            properties: {
              max_experiments: { type: 'integer', minimum: 1, maximum: 16 },
              max_elapsed_minutes: { type: 'integer', minimum: 1, maximum: 1440 },
              max_failures: { type: 'integer', minimum: 1, maximum: 8 },
            },
          },
        },
      },
    },
    {
      name: 'get_next_browser_experiment',
      description:
        'Read the next untried bounded source experiment and current coverage-qualified loop report.',
      annotations: readAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['loop_id'],
        properties: {
          loop_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', maxLength: 80 },
        },
      },
    },
    {
      name: 'evaluate_browser_experiment',
      description:
        'Evaluate the externally edited bounded candidate through correctness-first screening and paired promotion, then reject or replan.',
      annotations: executeAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['loop_id'],
        properties: {
          loop_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', maxLength: 80 },
          entry: { type: 'string', maxLength: 1000 },
          build_directory: { type: 'string', maxLength: 1000 },
          artifact_attestation: artifactAttestationSchema(),
        },
      },
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
      name: 'inspect_browser_probe',
      description:
        'Project one durable Playwright next probe onto its exact integrity-checked server request and bounded source candidates without executing application code.',
      annotations: readAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['capture_id', 'probe'],
        properties: {
          capture_id: {
            type: 'string',
            pattern: '^[a-z0-9][a-z0-9-]*$',
            maxLength: 80,
          },
          probe: {
            type: 'string',
            pattern:
              '^(?:inspect_(?:main_thread_(?:repository|dependency|generated|runtime)|continuous_main_thread_source|worker_thread_(?:repository|dependency|generated|runtime)|libuv_threadpool_(?:crypto|zlib|filesystem|dns|network|node_api|blob|other)|async_(?:connect|dns|filesystem|scheduler|timer|worker_pool)|framework_phase_(?:route_resolution|component_tree|client_component_loading)|gc_pressure)|complete_async_and_framework_inventories|repeat_with_lower_overhead_cpu_measurement)$',
            maxLength: 80,
          },
          source_recapture_id: {
            type: 'string',
            pattern: '^[a-z0-9][a-z0-9-]*$',
            maxLength: 80,
          },
        },
      },
    },
    {
      name: 'recapture_browser_probe',
      description:
        'Execute a supported durable inventory, main-thread runtime, profiler-disabled corroboration, chained GC-pressure, or continuous startup-source probe on the same exact bounded local Playwright flow and persist recapture provenance.',
      annotations: executeAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['capture_id', 'probe', 'recapture_id'],
        properties: {
          capture_id: {
            type: 'string',
            pattern: '^[a-z0-9][a-z0-9-]*$',
            maxLength: 80,
          },
          probe: {
            type: 'string',
            enum: [
              'complete_async_and_framework_inventories',
              'inspect_main_thread_runtime',
              'repeat_with_lower_overhead_cpu_measurement',
              'inspect_gc_pressure',
              'inspect_continuous_main_thread_source',
            ],
          },
          source_recapture_id: {
            type: 'string',
            pattern: '^[a-z0-9][a-z0-9-]*$',
            maxLength: 80,
          },
          recapture_id: {
            type: 'string',
            pattern: '^[a-z0-9][a-z0-9-]*$',
            maxLength: 80,
          },
          timeout_ms: { type: 'integer', minimum: 100, maximum: 120000 },
        },
      },
    },
    {
      name: 'assess_browser_probe_stability',
      description:
        'Compare two to five integrity-checked browser probe recaptures and require three unanimous compatible routes before treating a next probe as stable.',
      annotations: readAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['recapture_ids'],
        properties: {
          recapture_ids: {
            type: 'array',
            minItems: 2,
            maxItems: 5,
            uniqueItems: true,
            items: {
              type: 'string',
              pattern: '^[a-z0-9][a-z0-9-]*$',
              maxLength: 80,
            },
          },
        },
      },
    },
    {
      name: 'stabilize_browser_probe',
      description:
        'Reuse compatible durable evidence, then execute at most three total sequential local browser-probe observations until stable or terminal; this can consume local CPU, memory, and wall time but never calls production or cloud infrastructure.',
      annotations: executeAnnotations,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['capture_id', 'probe', 'schedule_id'],
        properties: {
          capture_id: {
            type: 'string',
            pattern: '^[a-z0-9][a-z0-9-]*$',
            maxLength: 80,
          },
          probe: {
            type: 'string',
            enum: [
              'complete_async_and_framework_inventories',
              'inspect_main_thread_runtime',
              'repeat_with_lower_overhead_cpu_measurement',
              'inspect_gc_pressure',
              'inspect_continuous_main_thread_source',
            ],
          },
          source_recapture_id: {
            type: 'string',
            pattern: '^[a-z0-9][a-z0-9-]*$',
            maxLength: 80,
          },
          schedule_id: {
            type: 'string',
            pattern: '^[a-z0-9][a-z0-9-]*$',
            maxLength: 77,
          },
          existing_recapture_ids: {
            type: 'array',
            maxItems: 3,
            uniqueItems: true,
            items: {
              type: 'string',
              pattern: '^[a-z0-9][a-z0-9-]*$',
              maxLength: 80,
            },
          },
          max_new_runs: { type: 'integer', minimum: 0, maximum: 3 },
          timeout_ms: { type: 'integer', minimum: 100, maximum: 120000 },
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
          adapter: { type: 'string', enum: ['node-test', 'vitest', 'jest'] },
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
      'Correctness-gate and screen one externally edited candidate against the incumbent; browser campaigns use the incumbent checkout fixed at server start.',
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

function artifactAttestationSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['source_snapshot_sha256', 'artifact_sha256'],
    properties: {
      source_snapshot_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      artifact_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    },
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
