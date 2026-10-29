// Executed once inside an explicitly owned, pinned Live consumer checkout.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
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
const lifecycle = JSON.parse(await readFile('study-348/mode.json', 'utf8')).lifecycle;
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

async function processTable() {
  const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,ppid=,rss=,lstart='], {
    timeout: 2000,
    maxBuffer: 1048576,
  });
  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [, pid, parent, rss, birth] = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/) ?? [];
      assert.ok(birth, 'process inventory must be complete');
      return { pid: Number(pid), parent: Number(parent), rss_bytes: Number(rss) * 1024, birth };
    });
}

async function sampleOwnedTree() {
  const observed = new Map();
  let samples = 0;
  let maximum = 0;
  let pending = Promise.resolve();
  const sample = async () => {
    const table = await processTable();
    const owned = new Set([process.pid]);
    for (let before = -1; before !== owned.size; ) {
      before = owned.size;
      for (const row of table) if (owned.has(row.parent)) owned.add(row.pid);
    }
    const rows = table.filter((row) => owned.has(row.pid));
    for (const row of rows) observed.set(`${row.pid}:${row.birth}`, row);
    maximum = Math.max(
      maximum,
      rows.reduce((total, row) => total + row.rss_bytes, 0)
    );
    samples++;
  };
  await sample();
  const timer = setInterval(() => {
    pending = pending.then(sample);
  }, 100);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
    await sample();
    return {
      interval_ms: 100,
      samples,
      maximum_sampled_tree_rss_bytes: maximum,
      processes: [...observed.values()],
    };
  };
}

async function closedTree(processes) {
  const table = await processTable();
  return processes.filter(
    (owned) =>
      owned.pid !== process.pid &&
      table.some((row) => row.pid === owned.pid && row.birth === owned.birth)
  );
}

async function lifecycleStudy() {
  const cold = process.argv[2]?.match(/^cold:(\d)$/);
  if (cold) {
    const expected = JSON.parse(await readFile('study-348/expected.json', 'utf8'));
    expectedNames = expected.names;
    expectedAssertions = expected.assertions;
    const stop = await sampleOwnedTree();
    await fresh('node', 'minimal', `cold:${cold[1]}`);
    const memory = await stop();
    const orphaned = await closedTree(memory.processes);
    assert.deepEqual(orphaned, []);
    await writeFile(`study-348/cold-${cold[1]}.json`, JSON.stringify({ rows, memory, orphaned }));
    return;
  }
  await inventory();
  const setupStart = performance.now();
  const setupMemory = await sampleOwnedTree();
  const ctx = await context('node', 'minimal');
  const preparation = await preparationIdentity();
  const current = async () =>
    assert.equal(await preparationIdentity(), preparation, 'warm preparation is stale');
  const pairs = [];
  const memories = [];
  let closeMs;
  try {
    await ctx.standalone();
    const baseline = await capture(ctx, 'lifecycle-baseline');
    passed(baseline);
    assert.equal(
      expectedAssertions.reduce((total, [, count]) => total + count, 0),
      82
    );
    await writeFile(
      'study-348/expected.json',
      JSON.stringify({ names: expectedNames, assertions: expectedAssertions })
    );
    memories.push(await setupMemory());
    const setupMs = performance.now() - setupStart + importMs;
    for (let pair = 0; pair < 3; pair++) {
      const result = { pair, order: pair % 2 ? ['warm', 'cold'] : ['cold', 'warm'] };
      for (const arm of result.order) {
        if (arm === 'cold') {
          const before = performance.now();
          await promisify(execFile)(process.execPath, ['study-348/worker.mjs', `cold:${pair}`], {
            cwd: process.cwd(),
            timeout: 30000,
            maxBuffer: 1048576,
          });
          const processMs = performance.now() - before;
          const report = JSON.parse(await readFile(`study-348/cold-${pair}.json`, 'utf8'));
          assert.equal(report.rows.length, 1);
          passed(report.rows[0]);
          result.cold = {
            ...report.rows[0],
            process_total_ms: processMs,
            memory: report.memory,
            orphaned: report.orphaned,
          };
        } else {
          const before = performance.now();
          const stop = await sampleOwnedTree();
          await current();
          const row = await capture(ctx, `warm:${pair}`);
          passed(row);
          const memory = await stop();
          const elapsed = performance.now() - before;
          memories.push(memory);
          result.warm = { ...row, process_total_ms: elapsed, memory };
        }
      }
      pairs.push(result);
    }
    const invalidations = await warmInvalidations(current);
    const controlMemory = await sampleOwnedTree();
    await controls();
    const cancellation = rows.find((row) => row.label === 'cancelled-after-entry');
    cancellation.body_completed_after_close = await access('study-348/completed').then(
      () => true,
      () => false
    );
    cancellation.context_closed = true;
    await domBoundary();
    memories.push(await controlMemory());
    const closeStart = performance.now();
    await ctx.close();
    const orphaned = await closedTree(memories.flatMap((row) => row.processes));
    closeMs = performance.now() - closeStart;
    assert.deepEqual(orphaned, []);
    const report = JSON.stringify({
      runtime: process.version,
      import_ms: importMs,
      total_ms: performance.now() - started,
      expected_names: expectedNames,
      assertion_vector: expectedAssertions,
      rows,
      lifecycle: {
        pairs,
        setup_ms: setupMs,
        close_ms: closeMs,
        orphaned,
        controller_pid: process.pid,
        warm_preparation_invalidations: invalidations,
        warm_total_ms:
          setupMs + pairs.reduce((total, pair) => total + pair.warm.process_total_ms, 0) + closeMs,
        cold_total_ms: pairs.reduce((total, pair) => total + pair.cold.process_total_ms, 0),
        default_adoption_qualified: false,
      },
    });
    await writeFile('study-348/report.json', report);
    process.stdout.write(
      `CODEVETTER_JSDOM_STUDY=${createHash('sha256').update(report).digest('hex')}\n`
    );
  } finally {
    await ctx.close();
  }
}

async function preparationIdentity() {
  const files = ['src/lib/bucket-list-insights.ts', 'vitest.config.ts', 'pnpm-lock.yaml'];
  const values = await Promise.all(
    files.map(async (path) => [
      path,
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    ])
  );
  return JSON.stringify(values);
}

async function warmInvalidations(current) {
  const results = [];
  for (const path of ['src/lib/bucket-list-insights.ts', 'vitest.config.ts', 'pnpm-lock.yaml']) {
    const original = await readFile(path);
    try {
      await writeFile(
        path,
        Buffer.concat([
          original,
          Buffer.from(
            path.endsWith('.yaml')
              ? '\n# owned warm invalidation\n'
              : '\n// owned warm invalidation\n'
          ),
        ])
      );
      await assert.rejects(current, /warm preparation is stale/);
      results.push({ path, stale_rejected: true, selected_execution_started: false });
    } finally {
      await writeFile(path, original);
    }
    await current();
  }
  return results;
}

if (lifecycle) await lifecycleStudy();
else {
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
}
