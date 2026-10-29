import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { study } from './vitest-jsdom-worker.mjs';
const {
  context,
  capture,
  passed,
  inventory,
  fresh,
  controls,
  domBoundary,
  rows,
  started,
  importMs,
} = study;
let expectedNames;
let expectedAssertions;
async function processTable() {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      '/bin/ps',
      ['-axo', 'pid=,ppid=,rss=,lstart='],
      { timeout: 2000, maxBuffer: 1048576 },
      (error, stdout) => {
        if (error) return reject(error);
        try {
          const rows = stdout
            .trim()
            .split('\n')
            .map((line) => {
              const [, pid, parent, rss, birth] =
                line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/) ?? [];
              assert.ok(birth, 'process inventory must be complete');
              return {
                pid: Number(pid),
                parent: Number(parent),
                rss_bytes: Number(rss) * 1024,
                birth,
              };
            });
          resolvePromise({ rows, sampler_pid: child.pid });
        } catch (failure) {
          reject(failure);
        }
      }
    );
  });
}

async function sampleOwnedTree() {
  const observed = new Map();
  let samples = 0;
  let intervalSamples = 0;
  let maximum = 0;
  let pending = Promise.resolve();
  const sample = async () => {
    const { rows: table, sampler_pid: samplerPid } = await processTable();
    const owned = new Set([process.pid]);
    for (let before = -1; before !== owned.size; ) {
      before = owned.size;
      for (const row of table) if (owned.has(row.parent)) owned.add(row.pid);
    }
    const rows = table.filter((row) => owned.has(row.pid) && row.pid !== samplerPid);
    for (const row of rows) observed.set(`${row.pid}:${row.birth}`, row);
    maximum = Math.max(
      maximum,
      rows.reduce((total, row) => total + row.rss_bytes, 0)
    );
    samples++;
  };
  await sample();
  const timer = setInterval(() => {
    intervalSamples++;
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
      interval_samples: intervalSamples,
      controller_pid: process.pid,
      descendants_observed: [...observed.values()].filter((row) => row.pid !== process.pid).length,
      maximum_sampled_tree_rss_bytes: maximum,
      processes: [...observed.values()],
    };
  };
}

async function closedTree(processes) {
  const { rows: table } = await processTable();
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
    study.setExpected(expectedNames, expectedAssertions);
    const stop = await sampleOwnedTree();
    await fresh('node', 'minimal', `cold:${cold[1]}`);
    const memory = await stop();
    const orphaned = await closedTree(memory.processes);
    assert.deepEqual(orphaned, []);
    await writeFile(`study-348/cold-${cold[1]}.json`, JSON.stringify({ rows, memory, orphaned }));
    return;
  }
  const setupStart = performance.now();
  await inventory();
  expectedNames = study.expectedNames;
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
    expectedAssertions = study.expectedAssertions;
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
    for (let pair = 0; pair < 5; pair++) {
      const result = { pair, order: pair % 2 ? ['warm', 'cold'] : ['cold', 'warm'] };
      for (const arm of result.order) {
        if (arm === 'cold') {
          const before = performance.now();
          await promisify(execFile)(process.execPath, ['study-348/lifecycle.mjs', `cold:${pair}`], {
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
          const row = await guardedCapture(ctx, `warm:${pair}`, current);
          passed(row);
          const memory = await stop();
          const elapsed = performance.now() - before;
          memories.push(memory);
          result.warm = { ...row, process_total_ms: elapsed, memory };
        }
      }
      pairs.push(result);
    }
    const invalidations = await warmInvalidations(() =>
      guardedCapture(ctx, 'stale-must-not-run', current)
    );
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

async function guardedCapture(ctx, label, current) {
  await current();
  return capture(ctx, label);
}

async function warmInvalidations(attempt) {
  const results = [];
  for (const path of ['src/lib/bucket-list-insights.ts', 'vitest.config.ts', 'pnpm-lock.yaml']) {
    const original = await readFile(path);
    const before = await readFile('study-348/run.json', 'utf8');
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
      await assert.rejects(attempt, /warm preparation is stale/);
      const unchanged = (await readFile('study-348/run.json', 'utf8')) === before;
      assert.ok(unchanged, 'stale warm preparation must reject before capture starts');
      results.push({ path, stale_rejected: true, capture_run_identity_unchanged: unchanged });
    } finally {
      await writeFile(path, original);
    }
  }
  return results;
}

await lifecycleStudy();
