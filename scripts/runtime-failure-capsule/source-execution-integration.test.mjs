import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { profileRepository } from './performance.mjs';
import { runClosedAdapter } from './runner.mjs';
import { planPerformanceExecution } from './execution-governance.mjs';
import { sourceDigest } from './source-execution.mjs';
import { capturedNames, currentNodeDigest, readCapture } from './source-execution-artifacts.mjs';
import { validateSourceExecutionSnapshot } from './source-execution-contract.mjs';

// Fixtures remain under the test runner's isolated temporary directory.
async function fixture(root, mode) {
  await mkdir(join(root, 'src'), { recursive: true });
  const url = pathToFileURL(join(root, 'src/app.ts')).href;
  const bait = Buffer.from(
    JSON.stringify({ version: 3, sources: [url], names: [], mappings: 'AAAA' })
  ).toString('base64');
  const source = `enum Mode { Bounded, Full }
export function choose(values: number[], mode: Mode): number[] {
  if (mode === Mode.Full) {
    return values.sort((a, b) => a - b);
  }
  return values.slice(0, 1);
}
${mode === 'bait' ? `const bait = "//# sourceMappingURL=data:application/json;base64,${bait}";` : ''}
`;
  await writeFile(join(root, 'src/app.ts'), source);
  const cold = mode === 'cold' || mode === 'late-exit';
  const selected = cold ? 'selected cold branch' : 'selected branch';
  const altered = mode === 'mismatch' ? "+'\\n// changed executed bytes'" : '';
  const partial =
    mode === 'partial'
      ? 'if(process.env.NODE_V8_COVERAGE){choose([3,1,2],0);takeCoverage();stopCoverage();}'
      : '';
  const stale =
    mode === 'stale'
      ? "if(process.env.NODE_V8_COVERAGE){const p=new URL('./src/app.ts',import.meta.url);writeFileSync(p,readFileSync(p,'utf8')+'\\n// changed source');}"
      : '';
  const late =
    mode === 'late-exit'
      ? "process.once('exit',()=>{assert.deepEqual(choose([3,1,2],1),[1,2,3]);if(process.env.NODE_V8_COVERAGE)writeFileSync(new URL('./.git/late-exit.txt',import.meta.url),'hot branch executed after owned flush');});"
      : '';
  await writeFile(
    join(root, 'app.test.mjs'),
    `import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {registerHooks,stripTypeScriptTypes} from 'node:module';
import {takeCoverage,stopCoverage} from 'node:v8';
registerHooks({load(url,context,next){if(url.endsWith('/src/app.ts'))return {shortCircuit:true,format:'module',source:stripTypeScriptTypes(readFileSync(new URL(url),'utf8'),{mode:'transform',sourceMap:true,sourceUrl:url})${altered}};return next(url,context);}});
const {choose}=await import('./src/app.ts');
${late}
test('${selected}',()=>{${partial}assert.deepEqual(choose([3,1,2],${cold ? 0 : 1}),${cold ? '[3]' : '[1,2,3]'});${stale}});
`
  );
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'snapshot fixture',
    ],
  ])
    execFileSync('git', args, { cwd: root });
  return selected;
}

for (const mode of ['hot', 'cold', 'bait', 'mismatch', 'partial', 'stale', 'late-exit']) {
  test(`production source snapshot: ${mode}`, async (context) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'codevetter-source-snapshot-test-')));
    context.after(() => rm(root, { recursive: true, force: true }));
    const selected = await fixture(root, mode);
    const run = () =>
      profileRepository({
        repositoryRoot: root,
        adapter: 'node-test',
        target: 'app.test.mjs',
        name: selected,
        timeoutMs: 5000,
        samples: 2,
        warmups: 0,
        captureFlow: true,
      });
    if (mode === 'stale') {
      await assert.rejects(run, /identity is stale/);
      return;
    }
    const capsule = await run();
    const snapshot = capsule.observed.source_execution;
    assert.deepEqual(validateSourceExecutionSnapshot(snapshot), []);
    assert.equal(snapshot.scope, 'selected_run_through_owned_flush');
    assert.equal(snapshot.recommendation_qualified, false);
    const owned = snapshot.snapshots.filter((item) => item.file === 'src/app.ts');
    if (mode === 'mismatch' || mode === 'partial') {
      assert.equal(owned.length, 0);
      assert.ok(
        snapshot.limitations.includes(
          mode === 'partial' ? 'capture_incomplete' : 'source_identity_mismatch'
        )
      );
      return;
    }
    assert.equal(owned.length, 1);
    const sort = owned[0].anchors.filter((item) => item.line === 4);
    const slice = owned[0].anchors.filter((item) => item.line === 6);
    assert.ok(sort.length && slice.length);
    const cold = mode === 'cold' || mode === 'late-exit';
    assert.ok(
      sort.every(
        (item) => item.status === (cold ? 'not_observed_in_snapshot' : 'executed_in_snapshot')
      )
    );
    assert.ok(
      slice.every(
        (item) => item.status === (cold ? 'executed_in_snapshot' : 'not_observed_in_snapshot')
      )
    );
    if (mode === 'late-exit')
      assert.match(await readFile(join(root, '.git/late-exit.txt'), 'utf8'), /after owned flush/);
  });
}

for (const extension of ['mjs', 'cjs']) {
  test(`plain ${extension} retains counters and execution multiplicity`, async (context) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'codevetter-source-plain-test-')));
    context.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'src'));
    const exported = extension === 'mjs' ? 'export ' : '';
    const commonJs = extension === 'cjs' ? 'module.exports = { counted };' : '';
    await writeFile(
      join(root, `src/counter.${extension}`),
      `${exported}function counted(value) { return value + 1; }\n${commonJs}`
    );
    await writeFile(
      join(root, 'counter.test.mjs'),
      `import test from 'node:test'; import assert from 'node:assert/strict'; import {counted} from './src/counter.${extension}'; test('five calls',()=>{for(let i=0;i<5;i++)assert.equal(counted(i),i+1);});`
    );
    for (const args of [
      ['init', '-q'],
      ['add', '.'],
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '-qm',
        'plain counter fixture',
      ],
    ])
      execFileSync('git', args, { cwd: root });
    for (const captureFlow of [true, false]) {
      const capsule = await profileRepository({
        repositoryRoot: root,
        adapter: 'node-test',
        target: 'counter.test.mjs',
        name: 'five calls',
        timeoutMs: 5000,
        samples: 2,
        warmups: 0,
        captureFlow,
      });
      assert.deepEqual(
        capsule.observed.executions.map((run) => run.phase),
        [
          'measurement',
          'measurement',
          'metrics',
          'metrics',
          ...(captureFlow ? ['flow', 'coverage'] : []),
          'profile',
          'profile',
        ]
      );
      assert.ok(capsule.observed.executions.every((run) => run.exit_code === 0));
      assert.equal(Object.hasOwn(capsule.observed, 'source_execution'), captureFlow);
      const coverage = capsule.observed.function_coverage;
      assert.equal(coverage.coverage_files, captureFlow ? 1 : 0);
      assert.equal(coverage.truncated, false);
      if (captureFlow) {
        const counted = coverage.functions.filter(
          (item) => item.function === 'counted' && item.file === `src/counter.${extension}`
        );
        assert.equal(counted.length, 1);
        assert.equal(counted[0].call_count, 5);
      }
    }
  });
}

test('actual producer receipt rejects cross-run, selection, isolate and byte mismatches', async (context) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codevetter-source-binding-test-')));
  context.after(() => rm(root, { recursive: true, force: true }));
  const name = await fixture(root, 'hot');
  const coverageDirectory = join(root, '.git/coverage');
  await mkdir(coverageDirectory);
  const plan = await planPerformanceExecution({
    repositoryRoot: root,
    adapter: 'node-test',
    target: 'app.test.mjs',
    name,
    timeoutMs: 5000,
    processCount: 1,
  });
  const execution = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'node-test',
    target: 'app.test.mjs',
    name,
    timeoutMs: 5000,
    coverageDirectory,
    executionPlan: plan,
  });
  assert.equal(execution.exitCode, 0);
  const expected = {
    nonce: execution.coverageContext.nonce,
    run_id: plan.plan_id,
    runtime: process.version,
    node_binary_sha256: await currentNodeDigest(),
    selection_sha256: sourceDigest(JSON.stringify({ target: 'app.test.mjs', name })),
  };
  const listing = await capturedNames(coverageDirectory);
  let selected;
  for (const filename of listing.names) {
    const capture = await readCapture(coverageDirectory, filename, expected);
    if (capture.identity.sources.some((item) => item.url.endsWith('/src/app.ts')))
      selected = filename;
  }
  assert.ok(selected);
  for (const [key, value] of Object.entries({
    nonce: 'prior-run-nonce',
    run_id: 'other-run',
    runtime: 'v0',
    node_binary_sha256: 'a'.repeat(64),
    selection_sha256: 'b'.repeat(64),
  })) {
    await assert.rejects(
      readCapture(coverageDirectory, selected, { ...expected, [key]: value }),
      /capture_identity_mismatch/
    );
  }
  const receiptPath = join(coverageDirectory, selected);
  const receiptBytes = await readFile(receiptPath);
  const producer = JSON.parse(receiptBytes);
  for (const key of ['process_id', 'thread_id']) {
    await writeFile(receiptPath, JSON.stringify({ ...producer, [key]: producer[key] + 1 }));
    await assert.rejects(
      readCapture(coverageDirectory, selected, expected),
      /capture_identity_mismatch/
    );
    await writeFile(receiptPath, receiptBytes);
  }
  for (const file of [
    producer.coverage_file,
    `source-${producer.process_id}-${producer.thread_id}.json`,
  ]) {
    const path = join(coverageDirectory, file);
    const bytes = await readFile(path);
    await writeFile(path, Buffer.concat([bytes, Buffer.from(' ')]));
    await assert.rejects(
      readCapture(coverageDirectory, selected, expected),
      /capture_identity_mismatch/
    );
    await writeFile(path, bytes);
  }
  await readCapture(coverageDirectory, selected, expected);
});
