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
async function lifecycleStudy() {
  const cold = process.argv[2]?.match(/^cold:(\d)$/);
  if (cold) {
    const expected = JSON.parse(await readFile('study-348/expected.json', 'utf8'));
    expectedNames = expected.names;
    expectedAssertions = expected.assertions;
    study.setExpected(expectedNames, expectedAssertions);
    await fresh('node', 'minimal', `cold:${cold[1]}`);
    await writeFile(
      `study-348/cold-${cold[1]}.json`,
      JSON.stringify({ rows, controller_pid: process.pid })
    );
    return;
  }
  const setupStart = performance.now();
  await inventory();
  expectedNames = study.expectedNames;
  const ctx = await context('node', 'minimal');
  const preparation = await preparationIdentity();
  const current = async () =>
    assert.equal(await preparationIdentity(), preparation, 'warm preparation is stale');
  const pairs = [];
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
    const setupMs = performance.now() - setupStart + importMs;
    for (let pair = 0; pair < 5; pair++) {
      const result = { pair, order: pair % 2 ? ['warm', 'cold'] : ['cold', 'warm'] };
      for (const arm of result.order) {
        if (arm === 'cold') {
          const before = performance.now();
          const startedAt = Date.now();
          await promisify(execFile)(process.execPath, ['study-348/lifecycle.mjs', `cold:${pair}`], {
            cwd: process.cwd(),
            timeout: 30000,
            maxBuffer: 1048576,
          });
          const processMs = performance.now() - before;
          const finishedAt = Date.now();
          const report = JSON.parse(await readFile(`study-348/cold-${pair}.json`, 'utf8'));
          assert.equal(report.rows.length, 1);
          passed(report.rows[0]);
          result.cold = {
            ...report.rows[0],
            process_total_ms: processMs,
            controller_pid: report.controller_pid,
            started_at_ms: startedAt,
            finished_at_ms: finishedAt,
          };
        } else {
          const before = performance.now();
          const startedAt = Date.now();
          const row = await guardedCapture(ctx, `warm:${pair}`, current);
          passed(row);
          const elapsed = performance.now() - before;
          result.warm = {
            ...row,
            process_total_ms: elapsed,
            controller_pid: process.pid,
            started_at_ms: startedAt,
            finished_at_ms: Date.now(),
          };
        }
      }
      pairs.push(result);
    }
    const invalidations = await warmInvalidations(() =>
      guardedCapture(ctx, 'stale-must-not-run', current)
    );
    await controls();
    const cancellation = rows.find((row) => row.label === 'cancelled-after-entry');
    cancellation.body_completed_after_close = await access('study-348/completed').then(
      () => true,
      () => false
    );
    cancellation.context_closed = true;
    await domBoundary();
    const closeStart = performance.now();
    await ctx.close();
    closeMs = performance.now() - closeStart;
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
