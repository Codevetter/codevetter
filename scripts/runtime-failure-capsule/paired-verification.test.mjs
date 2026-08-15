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
  assert.equal(report.verdict.status, 'confirmed');
  assert.deepEqual(
    report.paired_schedule
      .filter((entry) => entry.phase === 'measurement')
      .map((entry) => entry.side),
    ['baseline', 'current', 'current', 'baseline', 'baseline', 'current']
  );
  assert.equal(report.baseline_capsule.observed.console_metrics[0].metrics[0].sample_count, 3);
  assert.equal(report.limitations.length, 0, JSON.stringify(report.limitations));
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

async function repositoryFixture(root, values) {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'bench.test.mjs'),
    [
      "import test from 'node:test';",
      "import { values } from './implementation.mjs';",
      "test('paired benchmark', () => {",
      "  console.log('[benchmark] size100=' + values[0] + 'ms/op size1000=' + values[1] + 'ms/op (10 iterations)');",
      '});',
      '',
    ].join('\n')
  );
  await writeFile(
    join(root, 'implementation.mjs'),
    `export const values = ${JSON.stringify(values)};\n`
  );
  await execute('git', ['init', '-q'], { cwd: root });
  await execute('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  await execute('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  await execute('git', ['add', 'bench.test.mjs', 'implementation.mjs'], { cwd: root });
  await execute('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}
