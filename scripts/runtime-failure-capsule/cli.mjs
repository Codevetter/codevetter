#!/usr/bin/env node

import { isAbsolute, normalize, resolve } from 'node:path';

import { capsuleFromExecution, capsuleFromReceipt } from './capsule.mjs';
import {
  LIMITS,
  assertAdapter,
  assertFlowAdapter,
  assertImportKind,
  assertPairedAdapter,
  assertProfileAdapter,
  boundedCount,
  boundedThreshold,
  boundedTimeout,
} from './contracts.mjs';
import { detectRuntimeLanes } from './detect.mjs';
import { captureFlowRepository } from './flow.mjs';
import { planFlowOptimizationCampaign } from './flow-campaign-planner.mjs';
import { diagnosePerformanceRepository } from './performance-diagnosis.mjs';
import { verifyOptimizationCapsules } from './optimization-verification.mjs';
import { verifyPairedRepositories } from './paired-verification.mjs';
import { loadPerformanceCapsule, profileRepository } from './performance.mjs';
import { runAutonomousPerformanceLab } from './performance-lab.mjs';
import { boundedPerformanceLabSteps } from './performance-lab-contracts.mjs';
import { collectPerformanceReviewEvidence } from './performance-review-evidence.mjs';
import { verifyPerformanceReviewCorrectness } from './performance-review-correctness.mjs';
import { characterizePerformanceForReview } from './performance-review-characterization.mjs';
import { qualifyPortfolioManifest, qualifyRepository } from './qualification.mjs';
import { redactText } from './redact.mjs';
import { runClosedAdapter } from './runner.mjs';
import { inspectSupervisedRun, supervisePerformanceRun } from './supervision.mjs';
import { inspectStaticRedundancy } from './static-redundancy.mjs';
import { inspectDurableBrowserProbe } from './browser-probe-inspection.mjs';
import { recaptureDurableBrowserProbe } from './browser-probe-recapture.mjs';
import { assessDurableBrowserProbeStability } from './browser-probe-stability.mjs';
import { stabilizeDurableBrowserProbe } from './browser-probe-stability-scheduler.mjs';
import { createBrowserOptimizationLoopService } from './browser-optimization-loop.mjs';

export async function main(argv = process.argv.slice(2)) {
  let repositoryRoot = resolve(process.cwd());
  try {
    const { operation, options } = parseArguments(argv);
    repositoryRoot = resolve(options.repo ?? process.cwd());
    if (operation === 'detect') {
      writeJson(await detectRuntimeLanes(repositoryRoot));
      return 0;
    }
    if (operation === 'qualify') {
      const qualification = await qualifyRepository(repositoryRoot);
      writeJson(qualification);
      return qualification.status === 'inaccessible' ? 2 : 0;
    }
    if (operation === 'qualify-portfolio') {
      writeJson(await qualifyPortfolioManifest(required(options, 'manifest')));
      return 0;
    }
    if (operation === 'inspect-react-redundancy') {
      const result = await inspectStaticRedundancy(repositoryRoot, {
        timeoutMs: options['timeout-ms'] === undefined ? undefined : Number(options['timeout-ms']),
      });
      writeJson(result);
      return ['unavailable', 'no_confidence'].includes(result.verdict.status) ? 2 : 0;
    }
    if (operation === 'inspect-browser-probe') {
      writeJson(
        await inspectDurableBrowserProbe(repositoryRoot, {
          capture_id: required(options, 'capture-id'),
          probe: required(options, 'probe'),
          source_recapture_id: options['source-recapture-id'],
        })
      );
      return 0;
    }
    if (operation === 'recapture-browser-probe') {
      const result = await recaptureDurableBrowserProbe(repositoryRoot, {
        capture_id: required(options, 'capture-id'),
        probe: required(options, 'probe'),
        recapture_id: required(options, 'recapture-id'),
        source_recapture_id: options['source-recapture-id'],
        timeout_ms: options['timeout-ms'] === undefined ? undefined : Number(options['timeout-ms']),
      });
      writeJson(result);
      return result.state === 'completed' ? 0 : 2;
    }
    if (operation === 'assess-browser-probe-stability') {
      writeJson(
        await assessDurableBrowserProbeStability(repositoryRoot, {
          recapture_ids: parseBoundedIds(required(options, 'recapture-ids')),
        })
      );
      return 0;
    }
    if (operation === 'stabilize-browser-probe') {
      const result = await stabilizeDurableBrowserProbe(repositoryRoot, {
        capture_id: required(options, 'capture-id'),
        probe: required(options, 'probe'),
        schedule_id: required(options, 'schedule-id'),
        source_recapture_id: options['source-recapture-id'],
        existing_recapture_ids:
          options['existing-recapture-ids'] === undefined
            ? undefined
            : parseBoundedIds(options['existing-recapture-ids']),
        max_new_runs:
          options['max-new-runs'] === undefined ? undefined : Number(options['max-new-runs']),
        timeout_ms: options['timeout-ms'] === undefined ? undefined : Number(options['timeout-ms']),
      });
      writeJson(result);
      return ['stale', 'operational_failure'].includes(result.state) ? 2 : 0;
    }
    if (operation === 'plan-browser-optimization-loop') {
      const service = await createBrowserOptimizationLoopService(repositoryRoot);
      const result = await service.plan({
        loop_id: required(options, 'loop-id'),
        campaign_directory: required(options, 'campaign'),
        capture_id: required(options, 'capture-id'),
        entry: options.entry,
        build_directory: options['build-dir'],
        artifact_attestation: parseArtifactAttestation(options),
        correctness_scope:
          options['correctness-adapter'] ||
          options['correctness-target'] ||
          options['correctness-name']
            ? {
                adapter: options['correctness-adapter'],
                target: options['correctness-target'],
                name: options['correctness-name'],
              }
            : undefined,
        policy: {
          max_experiments: optionalNumber(options['max-experiments']),
          max_elapsed_minutes: optionalNumber(options['max-elapsed-minutes']),
          max_failures: optionalNumber(options['max-failures']),
        },
      });
      writeJson(result);
      return 0;
    }
    if (operation === 'get-next-browser-experiment') {
      const service = await createBrowserOptimizationLoopService(repositoryRoot);
      writeJson(await service.next({ loop_id: required(options, 'loop-id') }));
      return 0;
    }
    if (operation === 'evaluate-browser-experiment') {
      const service = await createBrowserOptimizationLoopService(repositoryRoot);
      const result = await service.evaluate({
        loop_id: required(options, 'loop-id'),
        incumbent_repository: required(options, 'incumbent-repo'),
        entry: options.entry,
        build_directory: options['build-dir'],
        artifact_attestation: parseArtifactAttestation(options),
      });
      writeJson(result);
      return ['operational_failure', 'blocked_on_host'].includes(result.state) ? 2 : 0;
    }
    if (operation === 'run-performance-lab') {
      const receipt = await runAutonomousPerformanceLab({
        repositoryRoot,
        labId: required(options, 'lab-id'),
        maxSteps: boundedPerformanceLabSteps(options['max-steps']),
        warmups: boundedCount(options.warmups, {
          name: 'warmups',
          defaultValue: LIMITS.defaultWarmups,
          maximum: LIMITS.maximumWarmups,
        }),
        timeoutMs: boundedTimeout(options['timeout-ms']),
        excludedFindingIds: parseFindingExclusions(options['exclude-finding-ids']),
        excludedCandidateKeys: parseFindingExclusions(options['exclude-candidate-keys']),
        continueFrom: options['continue-from'],
        incumbentRepository: options['incumbent-repo'],
        correctnessScope:
          options['correctness-adapter'] ||
          options['correctness-target'] ||
          options['correctness-name']
            ? {
                adapter: options['correctness-adapter'],
                target: options['correctness-target'],
                name: options['correctness-name'],
              }
            : undefined,
      });
      writeJson(receipt);
      return receipt.state === 'failed' ? 2 : 0;
    }
    if (operation === 'review-evidence') {
      writeJson(
        await collectPerformanceReviewEvidence(repositoryRoot, {
          reviewChangedFiles: parseReviewChangedFiles(options['changed-files-json']),
        })
      );
      return 0;
    }
    if (operation === 'verify-review-correctness') {
      writeJson(
        await verifyPerformanceReviewCorrectness({
          repositoryRoot,
          scope: {
            adapter: options.adapter,
            target: options.target,
            name: options.name,
          },
          manifestSha256: required(options, 'manifest-sha256'),
          expectedSubject: {
            repository_revision: required(options, 'expected-revision'),
            source_snapshot_sha256: required(options, 'expected-snapshot'),
          },
        })
      );
      return 0;
    }
    if (operation === 'characterize-review-performance') {
      writeJson(
        await characterizePerformanceForReview({
          repositoryRoot,
          source: required(options, 'source'),
          performanceScope: {
            adapter: options['performance-adapter'],
            target: options['performance-target'],
            name: options['performance-name'] ?? null,
          },
          correctnessScope: {
            adapter: options['correctness-adapter'],
            target: options['correctness-target'],
            name: options['correctness-name'],
          },
          manifestSha256: required(options, 'manifest-sha256'),
          expectedSubject: {
            repository_revision: required(options, 'expected-revision'),
            source_snapshot_sha256: required(options, 'expected-snapshot'),
          },
        })
      );
      return 0;
    }
    if (operation === 'plan-flow-campaign') {
      const result = await planFlowOptimizationCampaign({
        repositoryRoot,
        priorityManifestPath: options['priority-manifest'],
        maxFlows: boundedCount(options['max-flows'], {
          name: 'max flows',
          defaultValue: 3,
          minimum: 1,
          maximum: LIMITS.campaignFlows,
        }),
        samples: boundedCount(options.samples, {
          name: 'samples',
          defaultValue: LIMITS.defaultSamples,
          minimum: LIMITS.minimumSamples,
          maximum: LIMITS.maximumSamples,
        }),
        warmups: boundedCount(options.warmups, {
          name: 'warmups',
          defaultValue: LIMITS.defaultWarmups,
          maximum: LIMITS.maximumWarmups,
        }),
        timeoutMs: boundedTimeout(options['timeout-ms']),
      });
      writeJson(result);
      return result.verdict.status === 'no_confidence' ? 2 : 0;
    }
    if (operation === 'supervise-performance') {
      const receipt = await supervisePerformanceRun({
        repositoryRoot,
        runId: required(options, 'run-id'),
        adapter: assertProfileAdapter(required(options, 'adapter')),
        target: required(options, 'target'),
        name: options.name,
        timeoutMs: boundedTimeout(options['timeout-ms']),
        samples: boundedCount(options.samples, {
          name: 'samples',
          defaultValue: LIMITS.defaultSamples,
          minimum: LIMITS.minimumSamples,
          maximum: LIMITS.maximumSamples,
        }),
        warmups: boundedCount(options.warmups, {
          name: 'warmups',
          defaultValue: LIMITS.defaultWarmups,
          maximum: LIMITS.maximumWarmups,
        }),
      });
      writeJson(receipt);
      return receipt.state === 'succeeded' ? 0 : 2;
    }
    if (operation === 'inspect-performance-run') {
      writeJson(await inspectSupervisedRun(repositoryRoot, required(options, 'run-id')));
      return 0;
    }
    if (operation === 'run') {
      const adapter = assertAdapter(required(options, 'adapter'));
      const target = required(options, 'target');
      const execution = await runClosedAdapter({
        repositoryRoot,
        adapter,
        target,
        name: options.name,
        timeoutMs: boundedTimeout(options['timeout-ms']),
      });
      const capsule = await capsuleFromExecution({
        repositoryRoot,
        adapter,
        execution,
        diffRange: options.diff,
      });
      writeJson(capsule);
      return capsule.verdict.status === 'failed' ? 1 : 2;
    }
    if (operation === 'import') {
      const kind = assertImportKind(required(options, 'kind'));
      const capsule = await capsuleFromReceipt({
        repositoryRoot,
        kind,
        receiptPath: required(options, 'receipt'),
        diffRange: options.diff,
      });
      writeJson(capsule);
      return capsule.verdict.status === 'failed' ? 1 : 2;
    }
    if (operation === 'verify-paired-optimization') {
      const pairedAdapter = assertPairedAdapter(required(options, 'adapter'));
      const verification = await verifyPairedRepositories({
        baselineRepositoryRoot: required(options, 'baseline-repo'),
        currentRepositoryRoot: repositoryRoot,
        adapter: pairedAdapter,
        target: required(options, 'target'),
        name: options.name,
        project: options.project,
        source: options.source,
        timeoutMs: boundedTimeout(options['timeout-ms']),
        samples: boundedCount(options.samples, {
          name: 'samples',
          defaultValue: LIMITS.defaultSamples,
          minimum: pairedAdapter === 'playwright' ? 3 : LIMITS.minimumSamples,
          maximum: LIMITS.maximumSamples,
        }),
        warmups: boundedCount(options.warmups, {
          name: 'warmups',
          defaultValue: LIMITS.defaultWarmups,
          maximum: LIMITS.maximumWarmups,
        }),
      });
      writeJson(verification);
      if (verification.verdict.status === 'confirmed') return 0;
      if (verification.verdict.status === 'rejected') return 1;
      return 2;
    }
    if (operation === 'capture-flow') {
      const capsule = await captureFlowRepository({
        repositoryRoot,
        adapter: assertFlowAdapter(required(options, 'adapter')),
        target: required(options, 'target'),
        name: options.name,
        timeoutMs: boundedTimeout(options['timeout-ms']),
        samples: boundedCount(options.samples, {
          name: 'samples',
          defaultValue: LIMITS.defaultSamples,
          minimum: LIMITS.minimumSamples,
          maximum: LIMITS.maximumSamples,
        }),
        warmups: boundedCount(options.warmups, {
          name: 'warmups',
          defaultValue: LIMITS.defaultWarmups,
          maximum: LIMITS.maximumWarmups,
        }),
      });
      writeJson(capsule);
      return capsule.verdict.status === 'captured' ? 0 : 2;
    }
    if (
      operation === 'profile' ||
      operation === 'diagnose-performance' ||
      operation === 'verify-optimization'
    ) {
      const baselinePath =
        operation === 'verify-optimization' ? required(options, 'baseline') : options.baseline;
      const capsule = await profileRepository({
        repositoryRoot,
        adapter: assertProfileAdapter(required(options, 'adapter')),
        target: required(options, 'target'),
        name: options.name,
        timeoutMs: boundedTimeout(options['timeout-ms']),
        samples: boundedCount(options.samples, {
          name: 'samples',
          defaultValue: LIMITS.defaultSamples,
          minimum: LIMITS.minimumSamples,
          maximum: LIMITS.maximumSamples,
        }),
        warmups: boundedCount(options.warmups, {
          name: 'warmups',
          defaultValue: LIMITS.defaultWarmups,
          maximum: LIMITS.maximumWarmups,
        }),
        baselinePath: operation === 'verify-optimization' ? undefined : baselinePath,
        regressionPercent: boundedThreshold(options['regression-percent'], {
          name: 'regression-percent',
          defaultValue: 20,
          minimum: 1,
          maximum: 1_000,
        }),
        regressionMs: boundedThreshold(options['regression-ms'], {
          name: 'regression-ms',
          defaultValue: 25,
          minimum: 0,
          maximum: 60_000,
        }),
      });
      if (operation === 'diagnose-performance') {
        const diagnosis = await diagnosePerformanceRepository(capsule, repositoryRoot);
        writeJson(diagnosis);
      } else if (operation === 'verify-optimization') {
        const baseline = await loadPerformanceCapsule(repositoryRoot, baselinePath);
        const verification = verifyOptimizationCapsules(
          baseline,
          capsule,
          {},
          parseNodeAllocationSelection(options)
        );
        writeJson(verification);
        if (verification.verdict.status === 'confirmed') return 0;
        if (verification.verdict.status === 'rejected') return 1;
        return 2;
      } else {
        writeJson(capsule);
      }
      if (capsule.verdict.status === 'regressed') return 1;
      return capsule.verdict.status === 'no_confidence' ? 2 : 0;
    }
    throw new Error(`unsupported operation: ${operation ?? '<missing>'}`);
  } catch (error) {
    const sanitized = redactText(error?.message ?? String(error), { repositoryRoot });
    writeJson({
      schema_version: 'runtime-failure-capsule-error/v1',
      error: { type: error?.name ?? 'Error', message: sanitized.text },
      verdict: { status: 'no_confidence' },
    });
    return 2;
  }
}

function parseArguments(argv) {
  const [operation, ...rest] = argv;
  if (
    ![
      'detect',
      'run',
      'import',
      'profile',
      'diagnose-performance',
      'verify-optimization',
      'verify-paired-optimization',
      'capture-flow',
      'qualify',
      'qualify-portfolio',
      'run-performance-lab',
      'supervise-performance',
      'inspect-performance-run',
      'plan-flow-campaign',
      'review-evidence',
      'verify-review-correctness',
      'characterize-review-performance',
      'inspect-react-redundancy',
      'inspect-browser-probe',
      'recapture-browser-probe',
      'assess-browser-probe-stability',
      'stabilize-browser-probe',
      'plan-browser-optimization-loop',
      'get-next-browser-experiment',
      'evaluate-browser-experiment',
    ].includes(operation)
  ) {
    throw new Error(
      'usage: cli.mjs <detect|qualify|qualify-portfolio|inspect-react-redundancy|inspect-browser-probe|recapture-browser-probe|assess-browser-probe-stability|stabilize-browser-probe|plan-browser-optimization-loop|get-next-browser-experiment|evaluate-browser-experiment|run-performance-lab|review-evidence|verify-review-correctness|characterize-review-performance|plan-flow-campaign|supervise-performance|inspect-performance-run|run|import|profile|diagnose-performance|verify-optimization|verify-paired-optimization|capture-flow> [--repo PATH] [operation options] [--json]'
    );
  }
  const normalizedRest = rest[0] === '--' ? rest.slice(1) : rest;
  const options = {};
  for (let index = 0; index < normalizedRest.length; index += 1) {
    const argument = normalizedRest[index];
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (!argument.startsWith('--')) throw new Error(`unexpected positional argument: ${argument}`);
    const equals = argument.indexOf('=');
    if (equals !== -1) {
      const key = argument.slice(2, equals);
      if (!key) throw new Error('empty option name');
      if (Object.hasOwn(options, key)) throw new Error(`duplicate option: --${key}`);
      options[key] = argument.slice(equals + 1);
      continue;
    }
    const key = argument.slice(2);
    const value = normalizedRest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    if (Object.hasOwn(options, key)) throw new Error(`duplicate option: --${key}`);
    options[key] = value;
    index += 1;
  }
  if (operation === 'verify-review-correctness') {
    const allowed = new Set([
      'repo',
      'adapter',
      'target',
      'name',
      'manifest-sha256',
      'expected-revision',
      'expected-snapshot',
      'json',
    ]);
    const unknown = Object.keys(options).find((key) => !allowed.has(key));
    if (unknown) throw new Error(`unknown option for ${operation}: --${unknown}`);
    return { operation, options };
  }
  if (operation === 'characterize-review-performance') {
    const allowed = new Set([
      'repo',
      'source',
      'performance-adapter',
      'performance-target',
      'performance-name',
      'correctness-adapter',
      'correctness-target',
      'correctness-name',
      'manifest-sha256',
      'expected-revision',
      'expected-snapshot',
      'json',
    ]);
    const unknown = Object.keys(options).find((key) => !allowed.has(key));
    if (unknown) throw new Error(`unknown option for ${operation}: --${unknown}`);
    return { operation, options };
  }
  const allowed = new Set(
    operation === 'detect' || operation === 'qualify'
      ? ['repo', 'json']
      : operation === 'inspect-react-redundancy'
        ? ['repo', 'timeout-ms', 'json']
        : operation === 'inspect-browser-probe'
          ? ['repo', 'capture-id', 'probe', 'source-recapture-id', 'json']
          : operation === 'recapture-browser-probe'
            ? [
                'repo',
                'capture-id',
                'probe',
                'recapture-id',
                'source-recapture-id',
                'timeout-ms',
                'json',
              ]
            : operation === 'assess-browser-probe-stability'
              ? ['repo', 'recapture-ids', 'json']
              : operation === 'stabilize-browser-probe'
                ? [
                    'repo',
                    'capture-id',
                    'probe',
                    'schedule-id',
                    'source-recapture-id',
                    'existing-recapture-ids',
                    'max-new-runs',
                    'timeout-ms',
                    'json',
                  ]
                : operation === 'plan-browser-optimization-loop'
                  ? [
                      'repo',
                      'loop-id',
                      'campaign',
                      'capture-id',
                      'entry',
                      'build-dir',
                      'artifact-source-snapshot',
                      'artifact-sha256',
                      'correctness-adapter',
                      'correctness-target',
                      'correctness-name',
                      'max-experiments',
                      'max-elapsed-minutes',
                      'max-failures',
                      'json',
                    ]
                  : operation === 'get-next-browser-experiment'
                    ? ['repo', 'loop-id', 'json']
                    : operation === 'evaluate-browser-experiment'
                      ? [
                          'repo',
                          'loop-id',
                          'incumbent-repo',
                          'entry',
                          'build-dir',
                          'artifact-source-snapshot',
                          'artifact-sha256',
                          'json',
                        ]
                      : operation === 'review-evidence'
                        ? ['repo', 'changed-files-json', 'json']
                        : operation === 'qualify-portfolio'
                          ? ['manifest', 'json']
                          : operation === 'run-performance-lab'
                            ? [
                                'repo',
                                'lab-id',
                                'max-steps',
                                'warmups',
                                'timeout-ms',
                                'exclude-finding-ids',
                                'exclude-candidate-keys',
                                'continue-from',
                                'incumbent-repo',
                                'correctness-adapter',
                                'correctness-target',
                                'correctness-name',
                                'json',
                              ]
                            : operation === 'plan-flow-campaign'
                              ? [
                                  'repo',
                                  'priority-manifest',
                                  'max-flows',
                                  'timeout-ms',
                                  'samples',
                                  'warmups',
                                  'json',
                                ]
                              : operation === 'inspect-performance-run'
                                ? ['repo', 'run-id', 'json']
                                : operation === 'supervise-performance'
                                  ? [
                                      'repo',
                                      'run-id',
                                      'adapter',
                                      'target',
                                      'name',
                                      'timeout-ms',
                                      'samples',
                                      'warmups',
                                      'json',
                                    ]
                                  : operation === 'run'
                                    ? [
                                        'repo',
                                        'adapter',
                                        'target',
                                        'name',
                                        'diff',
                                        'timeout-ms',
                                        'json',
                                      ]
                                    : operation === 'import'
                                      ? ['repo', 'kind', 'receipt', 'diff', 'json']
                                      : operation === 'verify-paired-optimization'
                                        ? [
                                            'repo',
                                            'baseline-repo',
                                            'adapter',
                                            'target',
                                            'name',
                                            'project',
                                            'source',
                                            'timeout-ms',
                                            'samples',
                                            'warmups',
                                            'json',
                                          ]
                                        : [
                                            'repo',
                                            'adapter',
                                            'target',
                                            'name',
                                            'timeout-ms',
                                            'samples',
                                            'warmups',
                                            'baseline',
                                            'regression-percent',
                                            'regression-ms',
                                            ...(operation === 'verify-optimization'
                                              ? [
                                                  'allocation-source-file',
                                                  'allocation-source-function',
                                                ]
                                              : []),
                                            'json',
                                          ]
  );
  const unknown = Object.keys(options).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`unknown option for ${operation}: --${unknown}`);
  return { operation, options };
}

function required(options, key) {
  const value = options[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`missing --${key}`);
  return value;
}

function optionalNumber(value) {
  return value === undefined ? undefined : Number(value);
}

function parseArtifactAttestation(options) {
  const source = options['artifact-source-snapshot'];
  const artifact = options['artifact-sha256'];
  if (source === undefined && artifact === undefined) return undefined;
  if (!/^[0-9a-f]{64}$/.test(source ?? '') || !/^[0-9a-f]{64}$/.test(artifact ?? '')) {
    throw new Error(
      '--artifact-source-snapshot and --artifact-sha256 must be supplied together as SHA-256 digests'
    );
  }
  return { source_snapshot_sha256: source, artifact_sha256: artifact };
}

function parseFindingExclusions(value) {
  if (value === undefined) return undefined;
  return value.split(',').filter((entry) => entry.length > 0);
}

function parseBoundedIds(value) {
  if (typeof value !== 'string' || value.length > 512) {
    throw new Error('--recapture-ids exceeds its bound');
  }
  return value.split(',').filter((entry) => entry.length > 0);
}

function parseNodeAllocationSelection(options) {
  const file = options['allocation-source-file'];
  const functionName = options['allocation-source-function'];
  if (file === undefined && functionName === undefined) return {};
  if (typeof file !== 'string' || typeof functionName !== 'string') {
    throw new Error(
      '--allocation-source-file and --allocation-source-function must be supplied together'
    );
  }
  if (
    file.length === 0 ||
    file.length > 512 ||
    isAbsolute(file) ||
    normalize(file) !== file ||
    file.startsWith('../') ||
    file.includes('\\') ||
    /[\0\r\n]/.test(file)
  ) {
    throw new Error('--allocation-source-file must be a bounded repository-relative path');
  }
  if (functionName.length === 0 || functionName.length > 256 || /[\0\r\n]/.test(functionName)) {
    throw new Error('--allocation-source-function must be a bounded function name');
  }
  return { nodeAllocationSource: { file, function: functionName } };
}

function parseReviewChangedFiles(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || Buffer.byteLength(value) > 32 * 1024) {
    throw new Error('--changed-files-json exceeds its bound');
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('--changed-files-json must be valid JSON');
  }
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.on('error', (error) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });
  process.exitCode = await main();
}
