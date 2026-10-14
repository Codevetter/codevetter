// Copied into an isolated, pinned public consumer by vitest-consumer-experiment.mjs.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
// This file executes only after being copied beside the consumer's frozen node_modules.
const { createVitest, rolldownVersion } = await import(
  pathToFileURL(resolve('node_modules/vitest/dist/node.js')).href
);

const target = 'src/lib/spa-route.test.ts';
const dependency = 'src/lib/spa-route.ts';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const rows = [];

async function context(environment) {
  const ctx = await createVitest('test', {
    root: process.cwd(),
    config: 'vitest.config.ts',
    watch: false,
    ...(environment ? { environment } : {}),
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    reporters: [{}],
    setupFiles: ['src/test/setup.ts', 'study/setup.ts'],
    expect: { requireAssertions: true },
    provide: { studyEnvironment: environment },
  });
  await ctx.standalone();
  return ctx;
}

async function capture(ctx, label, file = target, pattern = undefined, collect = false) {
  const runId = randomUUID();
  await writeFile('study/run.json', JSON.stringify({ runId }));
  const specs = await ctx.globTestSpecifications([file]);
  assert.equal(specs.length, 1, 'the exact published test module must be selected');
  specs[0].testNamePattern = pattern;
  const result = await (collect ? ctx.collectTests(specs) : ctx.runTestSpecifications(specs));
  const modules = result.testModules.filter((mod) => mod.moduleId === resolve(file));
  const tests = modules.flatMap((mod) =>
    [...mod.children.allTests()].map((test) => ({
      name: test.fullName,
      state: test.result().state,
      assertions: test.meta().studyAssertions ?? 0,
      run_id: test.meta().studyRunId ?? null,
      errors: (test.result().errors ?? []).map((error) => error.message),
    }))
  );
  const row = {
    label,
    run_id: runId,
    environment: ctx.config.environment,
    collected_only: collect,
    source_sha256: hash(await readFile(dependency)),
    test_sha256: hash(await readFile(file)),
    config_sha256: hash(await readFile('vitest.config.ts')),
    lock_sha256: hash(await readFile('pnpm-lock.yaml')),
    selection: { file, pattern: pattern?.source ?? null },
    transforms: transforms(ctx),
    tests,
    unhandled_errors: result.unhandledErrors.map((error) => error.message),
    module_errors: modules.flatMap((mod) => mod.errors().map((error) => error.message)),
  };
  rows.push(row);
  // Expected failing controls set process.exitCode; the outer study asserts their results.
  process.exitCode = 0;
  return row;
}

function transforms(ctx) {
  return ctx.projects.flatMap((project) =>
    Object.entries(project.vite.environments).flatMap(([environment, value]) =>
      [...(value.moduleGraph.getModulesByFile(resolve(dependency)) ?? [])].map((module) => ({
        environment,
        source_sha256: module.transformResult?.map?.sourcesContent?.[0]
          ? hash(module.transformResult.map.sourcesContent[0])
          : null,
        code_sha256: module.transformResult?.code ? hash(module.transformResult.code) : null,
        map_sha256: module.transformResult?.map
          ? hash(JSON.stringify(module.transformResult.map))
          : null,
      }))
    )
  );
}

function passed(row, count) {
  assert.equal(row.unhandled_errors.length, 0);
  assert.equal(row.module_errors.length, 0);
  const executed = row.tests.filter((test) => test.state === 'passed');
  assert.equal(executed.length, count, JSON.stringify(row));
  assert.ok(executed.every((test) => test.assertions > 0 && test.run_id === row.run_id));
  assert.equal(row.tests.filter((test) => test.state === 'failed').length, 0);
}

async function environmentStudy(environment) {
  const ctx = await context(environment);
  try {
    passed(await capture(ctx, `${environment}:cold`), 18);
    passed(await capture(ctx, `${environment}:warm`), 18);
    passed(
      await capture(
        ctx,
        `${environment}:selected`,
        target,
        /keeps \/app on the application shell$/
      ),
      1
    );
    const absent = await capture(ctx, `${environment}:absent`, target, /^absent$/);
    assert.ok(absent.tests.every((test) => test.assertions === 0));
    const collection = await capture(ctx, `${environment}:collection`, target, undefined, true);
    assert.ok(collection.tests.every((test) => test.assertions === 0));
    for (let index = 0; index < 2; index++)
      passed(await capture(ctx, `${environment}:reset-${index}`, 'src/study-reset.test.ts'), 4);
    const hook = await capture(ctx, `${environment}:hook-error`, 'src/study-hook.test.ts');
    assert.equal(hook.tests.filter((test) => test.state === 'passed').length, 1);
    assert.deepEqual(hook.module_errors, ['seeded afterAll failure']);
    const leak = await capture(ctx, `${environment}:unreset`, 'src/study-leak.test.ts');
    assert.equal(leak.tests.filter((test) => test.state === 'failed').length, 1);
    await invalidationStudy(ctx, environment);
  } finally {
    await ctx.close();
  }
}

async function invalidationStudy(ctx, environment) {
  const original = await readFile(dependency, 'utf8');
  try {
    await writeFile(dependency, original.replace("'/app', ", ''));
    ctx.invalidateFile(resolve(dependency));
    const broken = await capture(ctx, `${environment}:dependency-edited`);
    assert.equal(
      broken.tests.filter((test) => test.state === 'failed').length,
      1,
      JSON.stringify(broken)
    );
    assert.ok(broken.tests.find((test) => test.state === 'failed').name.includes('/app'));
  } finally {
    await writeFile(dependency, original);
    ctx.invalidateFile(resolve(dependency));
  }
  passed(await capture(ctx, `${environment}:dependency-restored`), 18);
  const originalTest = await readFile(target, 'utf8');
  try {
    await writeFile(target, originalTest.replace('.toBe(true)', '.toBe(false)'));
    ctx.invalidateFile(resolve(target));
    const broken = await capture(ctx, `${environment}:assertion-oracle`);
    assert.equal(broken.tests.filter((test) => test.state === 'failed').length, 5);
  } finally {
    await writeFile(target, originalTest);
    ctx.invalidateFile(resolve(target));
  }
  passed(await capture(ctx, `${environment}:oracle-restored`), 18);
}

async function cancellationStudy() {
  const ctx = await context('node');
  try {
    const running = capture(ctx, 'node:cancelled', 'src/study-cancel.test.ts');
    let started = false;
    for (let attempt = 0; attempt < 500; attempt++) {
      try {
        await access('study/started');
        started = true;
        break;
      } catch {
        await delay(10);
      }
    }
    assert.ok(started, 'cancel only after the actual assertion body has started');
    await ctx.cancelCurrentRun('keyboard-input');
    const row = await running;
    row.cancelled = true;
    row.body_started = true;
    row.body_completed_after_cancel = await access('study/completed').then(
      () => true,
      () => false
    );
    row.queued_body_executed = await access('study/queued').then(
      () => true,
      () => false
    );
    row.execution_qualified = false;
    row.worker_pid = JSON.parse(await readFile('study/started', 'utf8')).pid;
    await ctx.close();
    try {
      process.kill(row.worker_pid, 0);
      row.worker_gone_after_close = false;
    } catch (error) {
      assert.equal(error.code, 'ESRCH');
      row.worker_gone_after_close = true;
    }
    row.body_completed_after_close = await access('study/completed').then(
      () => true,
      () => false
    );
    row.study_cleanup_signal_sent = false;
    if (!row.worker_gone_after_close) {
      process.kill(row.worker_pid, 'SIGKILL');
      row.study_cleanup_signal_sent = true;
    }
  } finally {
    await ctx.close();
  }
}

async function configurationStudy() {
  const file = 'vitest.config.ts';
  const original = await readFile(file, 'utf8');
  try {
    await writeFile(file, original.replace("environment: 'happy-dom'", "environment: 'node'"));
    const ctx = await context();
    try {
      assert.equal(ctx.config.environment, 'node');
      passed(await capture(ctx, 'node:config-recreated'), 18);
    } finally {
      await ctx.close();
    }
  } finally {
    await writeFile(file, original);
  }
  const ctx = await context();
  try {
    assert.equal(ctx.config.environment, 'happy-dom');
    passed(await capture(ctx, 'happy-dom:config-restored'), 18);
  } finally {
    await ctx.close();
  }
}

await environmentStudy('happy-dom');
await environmentStudy('node');
await cancellationStudy();
await configurationStudy();
process.stdout.write(
  `CODEVETTER_VITEST_STUDY=${JSON.stringify({ compiler: { vite_transform: 'rolldown/oxc', rolldown: rolldownVersion }, rows })}\n`
);
