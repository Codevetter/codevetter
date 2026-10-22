import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { planPerformanceExecution } from './execution-governance.mjs';
import { runClosedAdapter } from './runner.mjs';
import { qualifyJsdomSelection } from './vitest-jsdom-evidence.mjs';

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

export async function vitestJsdomExperiment(consumerRoot, { controlsOnly = false } = {}) {
  const root = resolve(consumerRoot);
  assert.equal(git(root, ['rev-parse', 'HEAD']), LIVE_BASE);
  assert.equal(git(root, ['status', '--porcelain']), '', 'consumer must start clean');
  const files = await identities(root);
  const tools = await installation(root, files);
  const study = join(root, 'study-348');
  const retained = join(root, '.fleet-local/codevetter-jsdom-study-20261023');
  await assert.rejects(lstat(study), { code: 'ENOENT' });
  await assert.rejects(lstat(retained), { code: 'ENOENT' });
  git(root, ['check-ignore', '.fleet-local/proof.json']);
  await mkdir(study);
  const code = {};
  try {
    for (const [name, text] of Object.entries(fixtures)) await writeFile(join(study, name), text);
    for (const [source, target] of [
      ['vitest-jsdom-worker.mjs', 'worker.mjs'],
      ['vitest-jsdom-evidence.mjs', 'vitest-jsdom-evidence.mjs'],
    ]) {
      const bytes = await readFile(new URL(source, import.meta.url));
      code[source] = digest(bytes);
      await writeFile(join(study, target), bytes);
    }
    const sourceIdentity = digest(JSON.stringify({ commit: LIVE_BASE, files, tools }));
    await writeFile(join(study, 'identity.json'), JSON.stringify(sourceIdentity));
    await writeFile(join(study, 'mode.json'), JSON.stringify({ controls_only: controlsOnly }));
    const scope = {
      repositoryRoot: root,
      adapter: 'node-script',
      target: 'study-348/worker.mjs',
      timeoutMs: 120000,
    };
    const plan = await planPerformanceExecution(scope);
    assert.equal(plan.decision.status, 'admitted', JSON.stringify(plan.decision));
    const execution = await runClosedAdapter({ ...scope, executionPlan: plan });
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
    validateControls(report);
    assert.deepEqual(await identities(root), files);
    return {
      schema_version: 'codevetter.vitest-jsdom-study/v1',
      consumer: { repository: 'Significant-Hobbies/live', commit: LIVE_BASE, files },
      tools,
      implementation_sha256: code,
      source_identity: sourceIdentity,
      execution: {
        plan_id: plan.plan_id,
        enforcement: plan.enforcement,
        duration_ms: execution.durationMs,
        status: execution.status,
        exit_code: execution.exitCode,
      },
      ...report,
      limitations: [
        'Pinned public pure-logic consumer and controlled negative fixtures, not all jsdom tests or product-wide acceptance.',
        'Reporter and environment rows are component/context elapsed times. Initial module import and warm-context setup are recorded separately; no process-start or whole-CLI acceleration claim.',
        'RSS observations are controller/worker snapshots, not whole-tree or peak-memory qualification. No memory improvement is claimed.',
        'The source target has conditional assertions: retain fresh run identity and the complete identical assertion vector rather than invent assertions for unexecuted branches.',
        'Cancellation and invalidation are bounded Vitest observations, not detached-tree reaping or a production warm-cache lifecycle guarantee.',
        'Shared host and existing filesystem caches; no machine-cache flush, provider, browser foreground, paid call or installed-app replacement.',
      ],
      default_adoption_qualified: false,
    };
  } finally {
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const report = await vitestJsdomExperiment(process.argv[2], {
    controlsOnly: process.argv[3] === 'controls-only',
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
