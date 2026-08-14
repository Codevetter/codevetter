#!/usr/bin/env node

import { resolve } from 'node:path';

import { capsuleFromExecution, capsuleFromReceipt } from './capsule.mjs';
import {
  LIMITS,
  assertAdapter,
  assertFlowAdapter,
  assertImportKind,
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
import { qualifyPortfolioManifest, qualifyRepository } from './qualification.mjs';
import { redactText } from './redact.mjs';
import { runClosedAdapter } from './runner.mjs';
import { inspectSupervisedRun, supervisePerformanceRun } from './supervision.mjs';

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
      const verification = await verifyPairedRepositories({
        baselineRepositoryRoot: required(options, 'baseline-repo'),
        currentRepositoryRoot: repositoryRoot,
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
        viteBuildDirectory: options['vite-build-dir'],
        viteEntry: options['vite-entry'],
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
        viteBuildDirectory: options['vite-build-dir'],
        viteEntry: options['vite-entry'],
      });
      if (operation === 'diagnose-performance') {
        writeJson(await diagnosePerformanceRepository(capsule, repositoryRoot));
      } else if (operation === 'verify-optimization') {
        const baseline = await loadPerformanceCapsule(repositoryRoot, baselinePath);
        const verification = verifyOptimizationCapsules(baseline, capsule);
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
      'supervise-performance',
      'inspect-performance-run',
      'plan-flow-campaign',
    ].includes(operation)
  ) {
    throw new Error(
      'usage: cli.mjs <detect|qualify|qualify-portfolio|plan-flow-campaign|supervise-performance|inspect-performance-run|run|import|profile|diagnose-performance|verify-optimization|verify-paired-optimization|capture-flow> [--repo PATH] [operation options] [--json]'
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
  const allowed = new Set(
    operation === 'detect' || operation === 'qualify'
      ? ['repo', 'json']
      : operation === 'qualify-portfolio'
        ? ['manifest', 'json']
        : operation === 'plan-flow-campaign'
          ? ['repo', 'priority-manifest', 'max-flows', 'timeout-ms', 'samples', 'warmups', 'json']
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
                ? ['repo', 'adapter', 'target', 'name', 'diff', 'timeout-ms', 'json']
                : operation === 'import'
                  ? ['repo', 'kind', 'receipt', 'diff', 'json']
                  : operation === 'verify-paired-optimization'
                    ? [
                        'repo',
                        'baseline-repo',
                        'adapter',
                        'target',
                        'name',
                        'timeout-ms',
                        'samples',
                        'warmups',
                        'vite-build-dir',
                        'vite-entry',
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
                        'vite-build-dir',
                        'vite-entry',
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
