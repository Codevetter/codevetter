import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { verifyPairedRepositories } from './paired-verification.mjs';

const execute = promisify(execFile);

test('alternates two runnable repositories and confirms matching scale evidence', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-paired-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const baseline = await repositoryFixture(join(root, 'baseline'), [10, 100]);
  const current = await repositoryFixture(join(root, 'current'), [5, 40]);

  const report = await verifyPairedRepositories({
    baselineRepositoryRoot: baseline,
    currentRepositoryRoot: current,
    adapter: 'node-test',
    target: 'bench.test.mjs',
    name: 'paired benchmark',
    timeoutMs: 10_000,
    samples: 3,
    warmups: 1,
  });

  assert.equal(report.evidence_mode, 'paired_interleaved');
  assert.equal(report.verdict.status, 'confirmed', JSON.stringify(report));
  assert.deepEqual(
    report.paired_schedule
      .filter((entry) => entry.phase === 'measurement')
      .map((entry) => entry.side),
    ['baseline', 'current', 'current', 'baseline', 'baseline', 'current']
  );
  assert.equal(report.baseline_capsule.observed.console_metrics[0].metrics[0].sample_count, 3);
  assert.equal(report.paired_schedule.filter((entry) => entry.phase === 'memory').length, 6);
  assert.equal(report.paired_schedule.filter((entry) => entry.phase === 'heap_profile').length, 4);
  assert.ok(
    report.observed.some((entry) => entry.kind === 'peak_rss_comparison'),
    JSON.stringify(report)
  );
  const diagnosticLimitations = new Set([
    'The heap-allocation profiles contained no repository-owned application source.',
    'Independent V8 heap profiles did not all capture an application allocation source.',
    'Independent V8 heap profiles disagreed on the leading application allocation source.',
    'Peak RSS is sampled process-tree evidence; it includes runtime and test-runner memory and does not identify an allocation source.',
  ]);
  assert.ok(
    report.limitations.every(
      (limitation) =>
        limitation.startsWith('Wall-time samples varied by') ||
        diagnosticLimitations.has(limitation)
    ),
    JSON.stringify(report.limitations)
  );
});

test('confirms a source-matched paired Node allocation reduction', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-paired-allocation-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const baseline = await repositoryFixture(join(root, 'baseline'), [10, 100], 100_000);
  const current = await repositoryFixture(join(root, 'current'), [10, 100], 10_000);

  const report = await verifyPairedRepositories({
    baselineRepositoryRoot: baseline,
    currentRepositoryRoot: current,
    adapter: 'node-test',
    target: 'bench.test.mjs',
    name: 'paired benchmark',
    timeoutMs: 10_000,
    samples: 3,
    warmups: 0,
  });

  assert.equal(report.verdict.status, 'confirmed', JSON.stringify(report));
  const allocation = report.observed.find(
    (observation) => observation.kind === 'node_allocation_comparison'
  );
  assert.equal(allocation.status, 'improved', JSON.stringify(allocation));
  assert.equal(allocation.source.file, 'implementation.mjs');
  assert.equal(allocation.source.function, 'allocateRows');
  assert.ok(allocation.metric.delta_percent <= -20);
  assert.ok(allocation.metric.delta <= -(64 * 1024));
});

test('fails closed when one paired workload does not complete', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-paired-failure-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const baseline = await repositoryFixture(join(root, 'baseline'), [10, 100]);
  const current = await repositoryFixture(join(root, 'current'), [5, 40]);
  await writeFile(join(current, 'implementation.mjs'), "throw new Error('candidate failed');\n");

  const report = await verifyPairedRepositories({
    baselineRepositoryRoot: baseline,
    currentRepositoryRoot: current,
    adapter: 'node-test',
    target: 'bench.test.mjs',
    name: 'paired benchmark',
    timeoutMs: 10_000,
    samples: 2,
    warmups: 0,
  });

  assert.equal(report.verdict.status, 'no_confidence');
  assert.ok(report.current_capsule.limitations.some((entry) => entry.includes('failed')));
});

test('retains Go toolchain identity and alternating RSS evidence', {
  skip: process.env.CODEVETTER_SKIP_GO_PROFILE === '1',
}, async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-paired-go-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const baseline = await goRepositoryFixture(join(root, 'baseline'));
  const current = await goRepositoryFixture(join(root, 'current'));

  const report = await verifyPairedRepositories({
    baselineRepositoryRoot: baseline,
    currentRepositoryRoot: current,
    adapter: 'go-bench',
    target: 'bench_test.go',
    name: 'BenchmarkPaired',
    timeoutMs: 10_000,
    samples: 2,
    warmups: 0,
  });

  assert.match(report.baseline_capsule.subject.go_version, /^go\d+\.\d+/);
  assert.equal(
    report.current_capsule.subject.go_version,
    report.baseline_capsule.subject.go_version
  );
  assert.notEqual(report.verdict.status, 'no_confidence');
  assert.equal(report.paired_schedule.filter((entry) => entry.phase === 'memory').length, 6);
  assert.equal(report.paired_schedule.filter((entry) => entry.phase === 'profile').length, 4);
  assert.equal(report.baseline_capsule.observed.profile_runs.length, 2);
  assert.equal(
    report.baseline_capsule.observed.profile_runs[0].fixed_benchmark_iterations,
    report.current_capsule.observed.profile_runs[0].fixed_benchmark_iterations
  );
  assert.ok(
    report.observed.some((entry) => entry.kind === 'peak_rss_comparison'),
    JSON.stringify(report)
  );
  assert.ok(
    report.observed.some((entry) => entry.kind === 'go_allocation_source_comparison'),
    JSON.stringify(report)
  );
});

async function repositoryFixture(root, values, allocationCount = 0) {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'bench.test.mjs'),
    [
      "import test from 'node:test';",
      "import { setTimeout as delay } from 'node:timers/promises';",
      "import { allocateRows, stableMemory, values } from './implementation.mjs';",
      "test('paired benchmark', async () => {",
      '  const held = allocateRows();',
      '  await delay(75);',
      "  console.log('[benchmark] size100=' + values[0] + 'ms/op size1000=' + values[1] + 'ms/op (10 iterations)');",
      '  console.log(held.length + stableMemory.length);',
      '});',
      '',
    ].join('\n')
  );
  await writeFile(
    join(root, 'implementation.mjs'),
    [
      `export const values = ${JSON.stringify(values)};`,
      'export const stableMemory = Buffer.alloc(32 * 1024 * 1024, 1);',
      'function makeRow(index) {',
      '  return { value: String(index).repeat(4) };',
      '}',
      'export function allocateRows() {',
      `  return Array.from({ length: ${allocationCount} }, (_, index) => makeRow(index));`,
      '}',
      '',
    ].join('\n')
  );
  await execute('git', ['init', '-q'], { cwd: root });
  await execute('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  await execute('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  await execute('git', ['add', 'bench.test.mjs', 'implementation.mjs'], { cwd: root });
  await execute('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}

async function goRepositoryFixture(root) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'go.mod'), 'module example.test/paired\n\ngo 1.22\n');
  await writeFile(
    join(root, 'allocate.go'),
    [
      'package paired',
      '',
      'type row struct { value int }',
      '',
      '//go:noinline',
      'func allocateRow(value int) *row { return &row{value: value} }',
      '',
    ].join('\n')
  );
  await writeFile(
    join(root, 'bench_test.go'),
    [
      'package paired',
      '',
      'import "testing"',
      '',
      'var sink *row',
      '',
      'func BenchmarkPaired(b *testing.B) {',
      '  for i := 0; i < b.N; i++ { sink = allocateRow(i) }',
      '}',
      '',
    ].join('\n')
  );
  await execute('git', ['init', '-q'], { cwd: root });
  await execute('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  await execute('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  await execute('git', ['add', 'go.mod', 'allocate.go', 'bench_test.go'], { cwd: root });
  await execute('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}
