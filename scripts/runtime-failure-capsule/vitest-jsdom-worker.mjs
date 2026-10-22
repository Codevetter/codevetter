// Executed once inside an explicitly owned, pinned Live consumer checkout.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  assertionVector,
  qualifyJsdomSelection,
  studyRuntimeErrors,
  studyTestReceipt,
} from './vitest-jsdom-evidence.mjs';

const started = performance.now();
const { createVitest } = await import(pathToFileURL(resolve('node_modules/vitest/dist/node.js')));
const importMs = performance.now() - started;
const targets = [
  'src/lib/bucket-list-insights.test.ts',
  'src/lib/bucket-list-insights.performance.test.ts',
];
const sourceIdentity = JSON.parse(await readFile('study-348/identity.json', 'utf8'));
const controlsOnly = JSON.parse(await readFile('study-348/mode.json', 'utf8')).controls_only;
const rows = [];
let expectedNames;
let expectedAssertions;

async function context(environment, reporter) {
  return createVitest('test', {
    root: process.cwd(),
    config: 'vitest.config.ts',
    watch: false,
    environment,
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    include: [...targets, 'study-348/*.test.ts'],
    setupFiles: ['study-348/setup.ts'],
    reporters: reporter === 'default' ? ['default'] : [{}],
  });
}

async function capture(ctx, label, files = targets, pattern = undefined, collect = false) {
  const runId = randomUUID();
  await writeFile('study-348/run.json', JSON.stringify({ runId }));
  const before = performance.now();
  const specs = await ctx.globTestSpecifications(files);
  assert.equal(specs.length, files.length, 'exact requested files must be selected');
  for (const spec of specs) spec.testNamePattern = pattern;
  const result = await (collect ? ctx.collectTests(specs) : ctx.runTestSpecifications(specs));
  const selected = new Set(files.map((file) => resolve(file)));
  const modules = result.testModules.filter((mod) => selected.has(mod.moduleId));
  assert.equal(modules.length, files.length, 'cached modules outside the selection are excluded');
  const row = {
    label,
    run_id: runId,
    environment: ctx.config.environment,
    source_identity: sourceIdentity,
    collected_only: collect,
    execution_ms: performance.now() - before,
    controller_rss_bytes: process.memoryUsage().rss,
    tests: modules.flatMap((mod) => Array.from(mod.children.allTests(), studyTestReceipt)),
    ...studyRuntimeErrors(result, modules),
  };
  rows.push(row);
  process.exitCode = 0;
  return row;
}

function passed(row) {
  assert.equal(
    qualifyJsdomSelection(row, {
      names: expectedNames,
      source_identity: sourceIdentity,
      environment: row.environment,
    }),
    true,
    JSON.stringify(row)
  );
  const vector = assertionVector(row);
  expectedAssertions ??= vector;
  assert.deepEqual(vector, expectedAssertions, 'all arms retain the same assertion vector');
}

async function fresh(environment, reporter, label) {
  const before = performance.now();
  const ctx = await context(environment, reporter);
  let row;
  try {
    await ctx.standalone();
    row = await capture(ctx, label);
    passed(row);
    row.reporter = reporter;
  } finally {
    await ctx.close();
  }
  row.context_total_ms = performance.now() - before;
}

async function inventory() {
  const ctx = await context('jsdom', 'minimal');
  try {
    await ctx.standalone();
    const row = await capture(ctx, 'inventory-only', targets, undefined, true);
    expectedNames = row.tests.map((test) => test.name).sort();
    assert.equal(expectedNames.length, 23, 'frozen public acceptance inventory');
    assert.ok(row.tests.every((test) => test.run_id === null));
  } finally {
    await ctx.close();
  }
}

async function warm(environment) {
  const before = performance.now();
  const ctx = await context(environment, 'minimal');
  try {
    await ctx.standalone();
    for (let index = 0; index < 5; index++)
      passed(await capture(ctx, `warm:${environment}:${index}`));
  } finally {
    await ctx.close();
  }
  return { environment, total_ms: performance.now() - before, selected_runs: 5 };
}

async function controls() {
  const ctx = await context('node', 'minimal');
  try {
    await ctx.standalone();
    await capture(ctx, 'absent-selection', targets, /^absent-study-name$/);
    await capture(ctx, 'collection-only', targets, undefined, true);
    await capture(ctx, 'failing-assertion', ['study-348/failure.test.ts']);
    await capture(ctx, 'afterAll-error', ['study-348/hook.test.ts']);
    await capture(ctx, 'dependency-original', ['study-348/value.test.ts']);
    await writeFile('study-348/value.ts', 'export const value = 2;');
    ctx.invalidateFile(resolve('study-348/value.ts'));
    await capture(ctx, 'dependency-edited', ['study-348/value.test.ts']);
    await writeFile('study-348/value.ts', 'export const value = 1;');
    ctx.invalidateFile(resolve('study-348/value.ts'));
    await capture(ctx, 'dependency-restored', ['study-348/value.test.ts']);
    await cancellation(ctx);
  } finally {
    await ctx.close();
  }
}

async function domBoundary() {
  for (const environment of ['jsdom', 'node']) {
    const ctx = await context(environment, 'minimal');
    try {
      await ctx.standalone();
      await capture(ctx, `dom-required:${environment}`, ['study-348/dom.test.ts']);
    } finally {
      await ctx.close();
    }
  }
}

async function cancellation(ctx) {
  const running = capture(ctx, 'cancelled-after-entry', ['study-348/cancel.test.ts']);
  for (let index = 0; index < 500; index++) {
    if (
      await access('study-348/started').then(
        () => true,
        () => false
      )
    )
      break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  await access('study-348/started');
  await ctx.cancelCurrentRun('keyboard-input');
  const row = await running;
  row.cancelled = true;
  row.body_started = true;
  row.body_completed_after_cancel = await access('study-348/completed').then(
    () => true,
    () => false
  );
}

await inventory();
if (!controlsOnly) {
  for (let pair = 0; pair < 5; pair++) {
    for (const environment of pair % 2 ? ['node', 'jsdom'] : ['jsdom', 'node'])
      await fresh(environment, 'default', `environment:${pair}:${environment}`);
  }
  for (let pair = 0; pair < 5; pair++) {
    for (const reporter of pair % 2 ? ['minimal', 'default'] : ['default', 'minimal'])
      await fresh('jsdom', reporter, `reporter:${pair}:${reporter}`);
  }
}
const warmContexts = controlsOnly ? [] : [await warm('jsdom'), await warm('node')];
await controls();
await domBoundary();
const report = JSON.stringify({
  runtime: process.version,
  import_ms: importMs,
  total_ms: performance.now() - started,
  expected_names: expectedNames,
  controls_only: controlsOnly,
  assertion_vector: expectedAssertions,
  warm_contexts: warmContexts,
  rows,
});
await writeFile('study-348/report.json', report);
process.stdout.write(
  `CODEVETTER_JSDOM_STUDY=${createHash('sha256').update(report).digest('hex')}\n`
);
process.exitCode = 0;
