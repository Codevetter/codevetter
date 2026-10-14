import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import {
  createPerformanceExecutionReceipt,
  planPerformanceExecution,
} from './execution-governance.mjs';
import { selectedWorkloadExecuted, summarizeConsoleBenchmarkMetrics } from './performance.mjs';
import { runClosedAdapter } from './runner.mjs';

const target =
  'benchmarks/runtime-challenges/temperature-aggregation/metric-pass-workload.test.mjs';
const name = 'temperature metric-pass workload';
const samples = 3;
const pairs = 5;
const minimumSavingPercent = 20;

export async function metricPassExperiment(repositoryRoot = resolve('.')) {
  const scope = { repositoryRoot, adapter: 'node-test', target, name, timeoutMs: 30_000 };
  const results = [];
  for (let pair = 0; pair < pairs; pair += 1) {
    const order = pair % 2 === 0 ? ['separate', 'combined'] : ['combined', 'separate'];
    const arms = {};
    for (const mode of order) arms[mode] = await runArm(scope, mode);
    assert.deepEqual(arms.combined.metric_inventory, arms.separate.metric_inventory);
    results.push({ pair, order, arms });
  }

  const pairedSavings = results.map(
    ({ arms }) =>
      (100 * (arms.separate.wall_time_ms - arms.combined.wall_time_ms)) / arms.separate.wall_time_ms
  );
  return {
    schema_version: 'codevetter.metric-pass-experiment/v1',
    source_sha256: Object.fromEntries(
      await Promise.all(
        [
          target,
          'benchmarks/runtime-challenges/temperature-aggregation/parser.mjs',
          'scripts/runtime-failure-capsule/metric-pass-experiment.mjs',
        ].map(async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(resolve(repositoryRoot, path)))
            .digest('hex'),
        ])
      )
    ),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    protocol: {
      pairs,
      samples_per_arm: samples,
      baseline: 'three timing executions followed by three separate metric executions',
      candidate: 'three executions supplying both timing and metric observations',
      order: 'alternating AB/BA, one arm at a time',
      decision_rule: `Consider only if median paired wall saving is at least ${minimumSavingPercent}% with all assertions, metric inventory, and sample counts intact; full diagnosis parity and memory bounds remain separate gates.`,
    },
    pairs: results,
    paired_saving_percent: {
      values: pairedSavings,
      median: median(pairedSavings),
      minimum: Math.min(...pairedSavings),
      maximum: Math.max(...pairedSavings),
    },
    threshold_met: median(pairedSavings) >= minimumSavingPercent,
    limitations: [
      'One repository-owned Node test workload on a shared host; host caches and competing work were not controlled.',
      'Combined samples couple wall timing and console metrics; independent metric repeatability was not established.',
      'This measures only the metric stage. Profile, flow, full diagnosis verdict, Vitest reporter parity, warm reuse, cancellation, and memory bounds were not compared.',
      'No production optimization or real-agent benefit follows from this experiment.',
    ],
  };
}

async function runArm(scope, mode) {
  const processCount = mode === 'separate' ? samples * 2 : samples;
  const plan = await planPerformanceExecution({ ...scope, processCount });
  assert.equal(plan.decision.status, 'admitted', JSON.stringify(plan.decision));
  const executions = [];
  const started = performance.now();
  for (const phase of mode === 'separate' ? ['measurement', 'metrics'] : ['measurement']) {
    for (let index = 0; index < samples; index += 1) {
      const execution = await runClosedAdapter({ ...scope, executionPlan: plan });
      assert.equal(execution.status, 'exited');
      assert.equal(execution.exitCode, 0);
      assert.equal(selectedWorkloadExecuted(execution, scope.adapter, scope.name), true);
      assert.match(execution.stdout, /# tests 1\b/);
      assert.match(execution.stdout, /# pass 1\b/);
      assert.match(execution.stdout, /# fail 0\b/);
      executions.push({ phase, index, execution });
    }
  }
  const wallTimeMs = performance.now() - started;
  const receipt = createPerformanceExecutionReceipt(plan, executions);
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.observed.processes, processCount);
  assert.equal(receipt.observed.successful_external_requests, 0);
  const metricEntries = executions.filter(
    (entry) => entry.phase === (mode === 'separate' ? 'metrics' : 'measurement')
  );
  const metrics = summarizeConsoleBenchmarkMetrics(
    metricEntries.map(({ execution }) => `${execution.stdout}\n${execution.stderr}`)
  );
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].metrics.length, 1);
  assert.equal(metrics[0].metrics[0].sample_count, samples);
  return {
    plan_id: plan.plan_id,
    wall_time_ms: Number(wallTimeMs.toFixed(3)),
    child_duration_ms: executions.map(({ execution }) => execution.durationMs),
    execution_status: receipt.status,
    metric_inventory: metrics.flatMap(({ metrics: values }) =>
      values.map(({ name: metricName, unit, sample_count }) => ({
        name: metricName,
        unit,
        sample_count,
      }))
    ),
    metric_median: metrics[0].metrics[0].value,
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.stdout.write(`${JSON.stringify(await metricPassExperiment(), null, 2)}\n`);
}
