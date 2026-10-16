import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const scratch = resolve(process.argv[3] ?? join(tmpdir(), 'codevetter-metric-study'));
await mkdir(scratch, { recursive: true });
const modulePath = join(root, 'scripts/runtime-failure-capsule/performance.mjs');
const source = await readFile(modulePath, 'utf8');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const output = await mkdtemp(join(scratch, 'full-metric-'));
let candidate = source;
for (const [before, after] of [
  [
    "if (['vitest', 'node-test', 'node-script'].includes(adapter)) {",
    "if (['vitest', 'node-script'].includes(adapter)) {",
  ],
  [
    "const metrics = ['node-test', 'node-script', 'vitest'].includes(adapter) ? samples : 0;",
    "const metrics = ['node-script', 'vitest'].includes(adapter) ? samples : 0;",
  ],
]) {
  assert.equal(candidate.split(before).length, 2, 'Candidate edit must match exactly once');
  candidate = candidate.replace(before, after);
}
candidate = candidate.replace(
  /from '(\.\/[^']+)'/g,
  (_, relative) => `from '${new URL(relative, pathToFileURL(modulePath)).href}'`
);
const candidatePath = join(output, 'candidate.mjs');
await writeFile(candidatePath, candidate);
const baseline = await import(pathToFileURL(modulePath));
const combined = await import(pathToFileURL(candidatePath));
const { diagnosePerformanceRepository } = await import(
  pathToFileURL(join(root, 'scripts/runtime-failure-capsule/performance-diagnosis.mjs'))
);
const target =
  'benchmarks/runtime-challenges/temperature-aggregation/metric-pass-workload.test.mjs';
const name = 'temperature metric-pass workload';
const scope = {
  repositoryRoot: root,
  adapter: 'node-test',
  target,
  name,
  samples: 3,
  warmups: 1,
  timeoutMs: 30_000,
  captureFlow: true,
};
const report = {
  schema_version: 'codevetter.full-metric-experiment/v1',
  source_revision: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  source_sha256: digest(source),
  candidate_sha256: digest(candidate),
  workload_sha256: digest(await readFile(join(root, target))),
  runtime: {
    node: process.version,
    node_binary_sha256: digest(await readFile(process.execPath)),
    platform: process.platform,
    architecture: process.arch,
    logical_cpus: cpus().length,
  },
  protocol: {
    pairs: 5,
    samples: 3,
    warmups: 1,
    capture_flow: true,
    minimum_median_saving_percent: 20,
    maximum_paired_metric_difference_percent: 20,
    baseline_processes: 11,
    candidate_processes: 8,
    order: 'alternating baseline/candidate and candidate/baseline, sequential arms',
    acceptance:
      'Preserve selected successful executions, three metric samples, both CPU profiles, flow/coverage capture, diagnosis class, zero egress and cleanup. Preserve wrong-selection and assertion-failure rejection. Missing cancellation/memory/Vitest qualification prevents default adoption regardless of bounded results.',
  },
  pairs: [],
  negative_controls: [],
  default_adoption_qualified: false,
  limitations: [
    'One repository-owned Node test workload; shared owner Mac and concurrent filesystem accounting, not an isolated performance host.',
    'Candidate is a private engine-module copy; the production module and CLI defaults are unchanged.',
    'Candidate has no canonical paired-optimization verdict; this component study is not a product speedup or agent-benefit qualification.',
    'Combined observations couple timings and metrics. Whole-process-tree memory, cancellation/reaping, warm reuse and Vitest reporter parity are unqualified.',
  ],
};
await writeFile(join(output, 'protocol.json'), JSON.stringify(report, null, 2));

async function arm(mode, armScope, identifier) {
  const hostBefore = loadavg();
  const started = performance.now();
  const capsule = await (mode === 'baseline' ? baseline : combined).profileRepository(armScope);
  const diagnosis = await diagnosePerformanceRepository(capsule, armScope.repositoryRoot);
  const wallMs = performance.now() - started;
  await writeFile(
    join(output, `${identifier}-${mode}.capsule.json`),
    JSON.stringify(capsule, null, 2)
  );
  await writeFile(
    join(output, `${identifier}-${mode}.diagnosis.json`),
    JSON.stringify(diagnosis, null, 2)
  );
  const entries = capsule.observed.executions;
  const metrics = capsule.observed.console_metrics.flatMap((group) =>
    group.metrics.map((metric) => ({
      kind: group.kind,
      name: metric.name,
      unit: metric.unit,
      samples: metric.sample_count,
      value: metric.value,
      provenance: group.provenance ?? metric.provenance ?? null,
    }))
  );
  const receipt = capsule.execution_governance?.receipt;
  return {
    wall_ms: wallMs,
    host_load_before: hostBefore,
    host_load_after: loadavg(),
    verdict: capsule.verdict,
    diagnosis: { kind: diagnosis.diagnosis.kind, status: diagnosis.verdict.status },
    executions: entries,
    metrics,
    capture: capsule.capture,
    execution_receipt: receipt,
    temporary_artifacts_retained: capsule.capture.temporary_artifacts_retained,
  };
}

function positiveGates(result, mode) {
  return {
    receipt_completed: result.execution_receipt?.status === 'completed',
    process_count: result.execution_receipt?.observed?.processes === (mode === 'baseline' ? 11 : 8),
    zero_egress: result.execution_receipt?.observed?.successful_external_requests === 0,
    selected_and_successful: result.executions.every(
      (entry) => entry.status === 'exited' && entry.exit_code === 0 && entry.workload_selected
    ),
    three_measurements:
      result.executions.filter((entry) => entry.phase === 'measurement').length === 3,
    phases_preserved:
      ['warmup', 'flow', 'coverage'].every((phase) =>
        result.executions.some((entry) => entry.phase === phase)
      ) && result.executions.filter((entry) => entry.phase === 'profile').length === 2,
    metric_inventory: result.metrics.length === 1 && result.metrics[0].samples === 3,
    metric_provenance:
      result.metrics[0]?.provenance ===
      (mode === 'baseline'
        ? 'unprofiled_metrics_execution_median'
        : 'unprofiled_measurement_execution_median'),
    truthful_metric_phases:
      result.executions.filter((entry) => entry.phase === 'metrics').length ===
      (mode === 'baseline' ? 3 : 0),
    profile_flow_coverage:
      result.capture.profile_files === 2 &&
      result.capture.flow_files > 0 &&
      result.capture.coverage_files > 0,
    cleanup: result.temporary_artifacts_retained === false,
  };
}

try {
  for (let index = 0; index < 5; index++) {
    const order = index % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    const arms = {};
    for (const mode of order) arms[mode] = await arm(mode, scope, `pair-${index}`);
    const metricDifference =
      (100 * Math.abs(arms.candidate.metrics[0]?.value - arms.baseline.metrics[0]?.value)) /
      arms.baseline.metrics[0]?.value;
    const pair = {
      index,
      order,
      arms,
      gates: {
        baseline: positiveGates(arms.baseline, 'baseline'),
        candidate: positiveGates(arms.candidate, 'candidate'),
        metric_difference_percent: metricDifference,
        metric_tolerance: metricDifference <= 20,
        same_diagnosis_class:
          JSON.stringify(arms.baseline.diagnosis) === JSON.stringify(arms.candidate.diagnosis),
      },
      wall_saving_percent:
        (100 * (arms.baseline.wall_ms - arms.candidate.wall_ms)) / arms.baseline.wall_ms,
    };
    report.pairs.push(pair);
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        pair: index,
        wall_saving_percent: pair.wall_saving_percent,
        gates: pair.gates,
      })
    );
  }
  for (const mode of ['baseline', 'candidate']) {
    const result = await arm(
      mode,
      { ...scope, name: 'nonexistent negative selection', samples: 1, warmups: 0 },
      'wrong-selection'
    );
    report.negative_controls.push({
      kind: 'wrong_selection',
      mode,
      rejected:
        result.verdict.status === 'no_confidence' &&
        result.executions.some((entry) => !entry.workload_selected),
      result,
    });
  }
  const fixture = await mkdtemp(join(tmpdir(), 'codevetter-metric-failing-'));
  try {
    execFileSync('git', ['init', '-q', fixture]);
    await writeFile(
      join(fixture, 'failure.test.mjs'),
      "import test from 'node:test'; import assert from 'node:assert/strict'; test('assertion negative', () => { console.log('[benchmark] aggregate=1ms/op (5 iterations)'); assert.equal(1,2); });\n"
    );
    execFileSync('git', ['-C', fixture, 'add', 'failure.test.mjs']);
    execFileSync('git', [
      '-C',
      fixture,
      '-c',
      'user.name=CodeVetter fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--no-gpg-sign',
      '-qm',
      'Synthetic negative fixture',
    ]);
    for (const mode of ['baseline', 'candidate']) {
      const result = await arm(
        mode,
        {
          ...scope,
          repositoryRoot: fixture,
          target: 'failure.test.mjs',
          name: 'assertion negative',
          samples: 1,
          warmups: 0,
        },
        'assertion-failure'
      );
      report.negative_controls.push({
        kind: 'assertion_failure',
        mode,
        rejected:
          result.verdict.status === 'no_confidence' &&
          result.executions.some((entry) => entry.exit_code !== 0),
        result,
      });
    }
  } finally {
    const cleanup = spawnSync('/usr/bin/trash', [fixture]);
    report.owned_failure_fixture_retained = cleanup.status !== 0;
  }
  const savings = report.pairs
    .map((pair) => pair.wall_saving_percent)
    .sort((left, right) => left - right);
  report.median_paired_wall_saving_percent = savings[2];
  report.bounded_gates_pass =
    report.pairs.every(
      (pair) =>
        Object.values(pair.gates.baseline).every(Boolean) &&
        Object.values(pair.gates.candidate).every(Boolean) &&
        pair.gates.metric_tolerance &&
        pair.gates.same_diagnosis_class
    ) && report.negative_controls.every((control) => control.rejected);
} catch (error) {
  report.operational_error = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(
    join(scratch, 'codevetter-full-metric-report-path.txt'),
    join(output, 'report.json') + '\n'
  );
  console.log(
    JSON.stringify({
      report: join(output, 'report.json'),
      pairs: report.pairs.length,
      bounded_gates_pass: report.bounded_gates_pass,
      default_adoption_qualified: false,
      error: report.operational_error ?? null,
    })
  );
}
