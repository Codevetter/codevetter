import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  assertPerformanceExecutionPlanCurrent,
  planPerformanceExecution,
} from './execution-governance.mjs';
import { runClosedAdapter } from './runner.mjs';
import { qualifyJsdomSelection, qualifyLifecycleStudy } from './vitest-jsdom-evidence.mjs';
import { runObservedNative, attachProcessEvidence } from './vitest-jsdom-processes.mjs';

export const LIVE_BASE = 'b9fdac4715bf337d629a09d6ec4458a1406b62d5';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const fixtures = {
  'setup.ts': `import { afterEach, expect } from 'vitest';
import { readFileSync } from 'node:fs';
afterEach(({ task }) => {
 task.meta.studyAssertions = expect.getState().assertionCalls;
 task.meta.studyRunId = JSON.parse(readFileSync('study-348/run.json', 'utf8')).runId;
 task.meta.studyRss = process.memoryUsage().rss;
});`,
  'failure.test.ts': `import { it, expect } from 'vitest';
import { getBucketListSuggestions } from '../src/lib/bucket-list-insights';
it('seeded wrong product assertion', () => expect(getBucketListSuggestions([], 6, 0)).toHaveLength(7));`,
  'hook.test.ts': `import { it, expect, afterAll } from 'vitest';
it('body before hook error', () => expect(1).toBe(1));
afterAll(() => { throw Error('seeded afterAll error'); });`,
  'value.ts': 'export const value = 1;',
  'value.test.ts': `import { it, expect } from 'vitest'; import { value } from './value';
it('dependency value', () => expect(value).toBe(1));`,
  'dom.test.ts': `import { it, expect } from 'vitest';
it('requires a DOM', () => { const el = document.createElement('button'); el.textContent = 'ready'; expect(el.textContent).toBe('ready'); });`,
  'cancel.test.ts': `import { it, expect } from 'vitest'; import { writeFileSync } from 'node:fs';
it('active body', async () => { writeFileSync('study-348/started', 'started'); await new Promise(resolve => setTimeout(resolve, 500)); writeFileSync('study-348/completed', 'completed'); expect(1).toBe(1); });`,
};

async function identities(root) {
  const paths = [
    'package.json',
    'pnpm-lock.yaml',
    'vitest.config.ts',
    'src/lib/bucket-list-insights.ts',
    'src/lib/bucket-list-insights.test.ts',
    'src/lib/bucket-list-insights.performance.test.ts',
  ];
  return Object.fromEntries(
    await Promise.all(paths.map(async (path) => [path, digest(await readFile(join(root, path)))]))
  );
}

async function installation(root, files) {
  const tools = {};
  for (const name of ['vitest', 'jsdom', 'typescript', '@vitest/coverage-v8']) {
    const bytes = await readFile(join(root, 'node_modules', name, 'package.json'));
    tools[name] = { version: JSON.parse(bytes).version, package_sha256: digest(bytes) };
  }
  assert.equal(tools.vitest.version, '4.1.10');
  assert.equal(tools.jsdom.version, '29.1.1');
  assert.equal(
    digest(await readFile(join(root, 'node_modules/.pnpm/lock.yaml'))),
    files['pnpm-lock.yaml']
  );
  return tools;
}

function validateControls(report) {
  const find = (label) => {
    const row = report.rows.find((value) => value.label === label);
    assert.ok(row, label);
    return row;
  };
  for (const label of [
    'absent-selection',
    'collection-only',
    'failing-assertion',
    'afterAll-error',
    'dependency-edited',
    'cancelled-after-entry',
    'dom-required:node',
  ]) {
    const row = find(label);
    const names = row.tests.map((test) => test.name);
    assert.equal(
      qualifyJsdomSelection(row, {
        names,
        source_identity: row.source_identity,
        environment: row.environment,
      }),
      false,
      label
    );
  }
  for (const label of ['dependency-original', 'dependency-restored', 'dom-required:jsdom']) {
    const row = find(label);
    assert.equal(
      qualifyJsdomSelection(row, {
        names: row.tests.map((test) => test.name),
        source_identity: row.source_identity,
        environment: row.environment,
      }),
      true,
      label
    );
  }
  assert.ok(find('cancelled-after-entry').body_started);
}

export async function vitestJsdomExperiment(
  consumerRoot,
  { controlsOnly = false, lifecycle = false, nativeLifecycle = false } = {}
) {
  const root = resolve(consumerRoot);
  assert.equal(git(root, ['rev-parse', 'HEAD']), LIVE_BASE);
  assert.equal(git(root, ['status', '--porcelain']), '', 'consumer must start clean');
  const files = await identities(root);
  const tools = await installation(root, files);
  const preparation = await Promise.all(
    ['src/lib/bucket-list-insights.ts', 'vitest.config.ts', 'pnpm-lock.yaml'].map(async (path) => [
      path,
      await readFile(join(root, path)),
    ])
  );
  const study = join(root, 'study-348');
  const retained = join(
    root,
    lifecycle
      ? '.fleet-local/codevetter-lifecycle-study-20261029'
      : '.fleet-local/codevetter-jsdom-study-20261023'
  );
  await assert.rejects(lstat(study), { code: 'ENOENT' });
  await assert.rejects(lstat(retained), { code: 'ENOENT' });
  git(root, ['check-ignore', '.fleet-local/proof.json']);
  await mkdir(study);
  const code = {};
  code['vitest-jsdom-experiment.mjs'] = digest(
    await readFile(new URL('./vitest-jsdom-experiment.mjs', import.meta.url))
  );
  try {
    for (const [name, text] of Object.entries(fixtures)) await writeFile(join(study, name), text);
    for (const [source, target] of [
      ['vitest-jsdom-worker.mjs', lifecycle ? 'vitest-jsdom-worker.mjs' : 'worker.mjs'],
      ['vitest-jsdom-evidence.mjs', 'vitest-jsdom-evidence.mjs'],
      ...(lifecycle ? [['vitest-jsdom-lifecycle.mjs', 'lifecycle.mjs']] : []),
    ]) {
      const bytes = await readFile(new URL(source, import.meta.url));
      code[source] = digest(bytes);
      await writeFile(join(study, target), bytes);
    }
    const sourceIdentity = digest(JSON.stringify({ commit: LIVE_BASE, files, tools }));
    await writeFile(join(study, 'identity.json'), JSON.stringify(sourceIdentity));
    await writeFile(
      join(study, 'mode.json'),
      JSON.stringify({ controls_only: controlsOnly, lifecycle })
    );
    const scope = {
      repositoryRoot: root,
      adapter: 'node-script',
      target: lifecycle ? 'study-348/lifecycle.mjs' : 'study-348/worker.mjs',
      timeoutMs: 120000,
    };
    const plan = await planPerformanceExecution(scope);
    assertStudyAdmission(plan, nativeLifecycle, lifecycle);
    const invalidations = lifecycle ? await preparationInvalidations(root, scope, plan) : null;
    const execution = nativeLifecycle
      ? await runNativeLifecycle(root, scope.target)
      : await runClosedAdapter({ ...scope, executionPlan: plan });
    await writeFile(join(study, 'execution-plan.json'), JSON.stringify(plan, null, 2));
    await writeFile(join(study, 'execution.json'), JSON.stringify(execution, null, 2));
    assert.equal(execution.exitCode, 0, execution.stderr);
    const marker = execution.stdout
      .split('\n')
      .find((line) => line.startsWith('CODEVETTER_JSDOM_STUDY='));
    assert.ok(marker, 'exit zero alone is not a completed comparison');
    const bytes = await readFile(join(study, 'report.json'));
    assert.ok(bytes.length < 1048576, 'bounded raw comparison report');
    assert.equal(digest(bytes), marker.slice('CODEVETTER_JSDOM_STUDY='.length));
    const report = JSON.parse(bytes);
    if (nativeLifecycle) attachProcessEvidence(report, execution.process_observation);
    validateControls(report);
    if (lifecycle) {
      assert.equal(
        qualifyLifecycleStudy(report, sourceIdentity),
        true,
        'every arm must execute the complete frozen acceptance'
      );
      const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid='], {
        timeout: 2000,
        maxBuffer: 1048576,
      });
      assert.ok(
        !stdout.trim().split(/\s+/).map(Number).includes(report.lifecycle.controller_pid),
        'closed adapter process must be reaped'
      );
      report.lifecycle.controller_reaped = true;
      report.lifecycle.preparation_invalidations = invalidations;
    }
    assert.deepEqual(await identities(root), files);
    return {
      schema_version: 'codevetter.vitest-jsdom-study/v1',
      consumer: { repository: 'Significant-Hobbies/live', commit: LIVE_BASE, files },
      tools,
      producer: {
        commit: git(fileURLToPath(new URL('../../', import.meta.url)), ['rev-parse', 'HEAD']),
        dirty:
          git(fileURLToPath(new URL('../../', import.meta.url)), ['status', '--porcelain']) !== '',
      },
      runtime_identity: {
        node: process.version,
        binary_sha256: digest(await readFile(process.execPath)),
        platform: process.platform,
        arch: process.arch,
      },
      implementation_sha256: code,
      source_identity: sourceIdentity,
      execution: {
        kind: nativeLifecycle ? 'native_macos_lifecycle' : 'codevetter_closed_adapter',
        plan_id: nativeLifecycle ? null : plan.plan_id,
        admission: nativeLifecycle ? plan : null,
        enforcement: execution.enforcement ?? plan.enforcement,
        duration_ms: execution.durationMs,
        status: execution.status,
        exit_code: execution.exitCode,
      },
      ...report,
      limitations: studyLimitations(lifecycle, nativeLifecycle),
      default_adoption_qualified: false,
    };
  } finally {
    for (const [path, original] of preparation) {
      const current = await readFile(join(root, path)).catch(() => null);
      if (!current?.equals(original)) await writeFile(join(root, path), original);
    }
    assert.deepEqual(await identities(root), files, 'published source must remain byte-identical');
    await mkdir(join(root, '.fleet-local'), { recursive: true });
    await rename(study, retained);
    assert.equal(
      git(root, ['status', '--porcelain']),
      '',
      'all owned study fixtures retained privately'
    );
  }
}

function studyLimitations(lifecycle, nativeLifecycle) {
  return [
    'Pinned public pure-logic consumer and controlled negative fixtures, not all jsdom tests or product-wide acceptance.',
    'Reporter and environment rows are component/context elapsed times. Initial module import and warm-context setup are recorded separately; no process-start or whole-CLI acceleration claim.',
    lifecycle
      ? 'RSS observations include the sampled owned tree with the limits below; no peak-memory or memory-improvement claim.'
      : 'RSS observations are controller/worker snapshots, not whole-tree or peak-memory qualification. No memory improvement is claimed.',
    'The source target has conditional assertions: retain fresh run identity and the complete identical assertion vector rather than invent assertions for unexecuted branches.',
    'Cancellation and invalidation are bounded Vitest observations, not detached-tree reaping or a production warm-cache lifecycle guarantee.',
    ...(lifecycle
      ? [
          'Five interleaved process-cold versus persistent-context pairs compare an experimental real-consumer adapter, not the installed CodeVetter warm CLI or a production cache.',
          ...(nativeLifecycle
            ? [
                'CodeVetter admission rejected subprocess launch. The explicitly selected native lane uses macOS network sandboxing and the Node egress preload; this is native measurement, not a CodeVetter admitted execution or paired-verification verdict.',
              ]
            : []),
          'Warm total includes module import, priming inventory, context setup, baseline acceptance, all five selected runs and close; cold total includes process launch, import, setup, one selected run and close for every pair. Warm also includes preparation hashing. A separate native observer samples both arms throughout execution and can perturb host timing; negative controls are outside the compared totals.',
          'The native parent samples owned process-tree RSS every20ms, outside the workload sandbox. Short-lived descendants and peaks may be missed. Cleanup proves recorded PID/birth identities are gone after close, not portable ownership of arbitrary detached descendants.',
          'Source/configuration/lock byte changes are rejected by the preparation identity before execution and restored; this does not qualify a changed dependency graph without a frozen reinstall.',
        ]
      : []),
    'Shared host and existing filesystem caches; no machine-cache flush, provider, browser foreground, paid call or installed-app replacement.',
  ];
}

function assertStudyAdmission(plan, nativeLifecycle, lifecycle) {
  if (nativeLifecycle) {
    assert.ok(
      lifecycle && process.platform === 'darwin',
      'native lifecycle requires the explicit macOS lane'
    );
    assert.equal(plan.decision.status, 'blocked');
    assert.ok(
      plan.decision.blockers.length === 1 &&
        /^The workload can launch a subprocess outside the portable Node zero-egress guard \(.+\)\.$/.test(
          plan.decision.blockers[0]
        ),
      'native lifecycle only supports the known subprocess admission gap'
    );
    return;
  }
  assert.equal(plan.decision.status, 'admitted', JSON.stringify(plan.decision));
}

async function runNativeLifecycle(root, target) {
  const started = performance.now();
  const environment = Object.fromEntries(
    ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'NO_COLOR']
      .filter((name) => process.env[name])
      .map((name) => [name, process.env[name]])
  );
  environment.NODE_OPTIONS = `--import=${new URL('./node-egress-preload.mjs', import.meta.url).href}`;
  environment.CODEVETTER_NETWORK_POLICY = 'loopback-only';
  const policy =
    '(version 1)(allow default)(deny network*)(allow network-inbound (local ip "*:*"))(allow network-outbound (remote ip "localhost:*"))';
  const result = await runObservedNative(
    '/usr/bin/sandbox-exec',
    ['-p', policy, process.execPath, target],
    { cwd: root, env: environment }
  );
  return {
    ...result,
    durationMs: performance.now() - started,
    enforcement: { kind: 'native_macos_sandbox_node_preload', network_scope: 'loopback_only' },
  };
}

async function preparationInvalidations(root, scope, plan) {
  const results = [];
  for (const path of ['src/lib/bucket-list-insights.ts', 'vitest.config.ts', 'pnpm-lock.yaml']) {
    const absolute = join(root, path);
    const original = await readFile(absolute);
    try {
      await writeFile(
        absolute,
        Buffer.concat([
          original,
          Buffer.from(
            path.endsWith('.yaml')
              ? '\n# owned invalidation control\n'
              : '\n// owned invalidation control\n'
          ),
        ])
      );
      await assert.rejects(
        () => assertPerformanceExecutionPlanCurrent({ ...scope, plan }),
        /stale/
      );
      results.push({ path, stale_rejected: true });
    } finally {
      await writeFile(absolute, original);
    }
    await assertPerformanceExecutionPlanCurrent({ ...scope, plan });
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const report = await vitestJsdomExperiment(process.argv[2], {
    controlsOnly: process.argv[3] === 'controls-only',
    lifecycle: ['lifecycle', 'native-lifecycle'].includes(process.argv[3]),
    nativeLifecycle: process.argv[3] === 'native-lifecycle',
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
