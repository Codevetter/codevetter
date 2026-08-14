import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { createCleanBrowserExecution } from './clean-browser-execution.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import { establishQualifiedViteRuntime } from './owned-vite-runtime.mjs';
import { captureQualifiedPlaywrightFlow } from './playwright-capture.mjs';

const execute = promisify(execFile);

test('clean browser execution excludes ignored environment files and reports path-free provenance', async (context) => {
  const repository = await browserFixture(context);
  const subject = await inspectGitDiff(repository);
  const execution = await createCleanBrowserExecution(
    { repositoryRoot: repository, candidateId: 'browser-flow' },
    { qualify: qualification(subject) }
  );

  await assert.rejects(access(join(execution.executionRoot, '.env.local')), /ENOENT/);
  await assert.rejects(access(join(execution.executionRoot, '.env.example')), /ENOENT/);
  assert.equal(
    await readFile(join(execution.executionRoot, 'node_modules', 'next', 'marker.txt'), 'utf8'),
    'installed locally\n'
  );
  assert.equal(execution.provenance.mode, 'clean_git_snapshot');
  assert.equal(execution.provenance.graft_count, 1);
  assert.equal(execution.provenance.excluded_sensitive_path_count, 1);
  assert.match(execution.provenance.excluded_sensitive_paths_sha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(execution.provenance), new RegExp(repository));

  await mkdir(join(execution.executionRoot, '.codevetter', 'next-runtime'), { recursive: true });
  await writeFile(join(execution.executionRoot, '.codevetter', 'next-runtime', 'cache'), 'owned');
  await mkdir(join(execution.executionRoot, '.next', 'dev'), { recursive: true });
  await writeFile(join(execution.executionRoot, '.next', 'dev', 'manifest.json'), '{}');
  const materializedRoot = execution.executionRoot;
  assert.equal((await execution.finalize()).state, 'removed');
  await assert.rejects(access(materializedRoot), /ENOENT/);
  assert.equal(await readFile(join(repository, '.env.local'), 'utf8'), 'DO_NOT_READ=this\n');
});

test('clean browser execution refuses dirty authority before materialization', async (context) => {
  const repository = await browserFixture(context);
  const cleanSubject = await inspectGitDiff(repository);
  await writeFile(join(repository, 'app.mjs'), 'export const value = 2;\n');

  await assert.rejects(
    createCleanBrowserExecution(
      { repositoryRoot: repository, candidateId: 'browser-flow' },
      { qualify: qualification(cleanSubject) }
    ),
    /source identity changed/
  );
});

test('source mutation invalidates the snapshot but still disposes owned storage', async (context) => {
  const repository = await browserFixture(context);
  const subject = await inspectGitDiff(repository);
  const execution = await createCleanBrowserExecution(
    { repositoryRoot: repository, candidateId: 'browser-flow' },
    { qualify: qualification(subject) }
  );
  const materializedRoot = execution.executionRoot;
  await writeFile(join(materializedRoot, 'app.mjs'), 'export const value = 3;\n');

  await assert.rejects(execution.finalize(), /changed during paired review/);
  await assert.rejects(access(materializedRoot), /ENOENT/);
});

test('owned Next runtime resolves dependencies from authority and executes only the clean tree', async (context) => {
  const repository = await browserFixture(context);
  const subject = await inspectGitDiff(repository);
  const execution = await createCleanBrowserExecution(
    { repositoryRoot: repository, candidateId: 'browser-flow' },
    { qualify: qualification(subject) }
  );
  let dependencyLookupRoot = null;
  let spawnInput = null;
  let checks = 0;
  const runtime = await establishQualifiedViteRuntime(
    {
      repositoryRoot: repository,
      candidateId: 'browser-flow',
      captureId: 'clean-runtime',
      timeoutMs: 5_000,
      executionContext: execution,
    },
    {
      resolveNext: async (root) => {
        dependencyLookupRoot = root;
        return join(root, 'node_modules', 'next', 'marker.txt');
      },
      reachable: async () => checks++ > 0,
      spawnProcess: (input) => {
        spawnInput = input;
        return { exited: () => false, stop: async () => 'terminated' };
      },
      attest: async () => ({ state: 'verified_by_declared_process' }),
      warmNext: async () => ({
        state: 'completed',
        inventory: { total: 2, retained: 2, complete: true },
        requests: [
          { ordinal: 1, duration_ms: 10, status_class: '2xx' },
          { ordinal: 2, duration_ms: 5, status_class: '2xx' },
        ],
      }),
    }
  );

  assert.equal(runtime.ready, true);
  assert.equal(dependencyLookupRoot, repository);
  assert.equal(spawnInput.packageRoot, execution.executionRoot);
  assert.notEqual(spawnInput.packageRoot, repository);
  assert.equal(await readFile(join(repository, '.env.local'), 'utf8'), 'DO_NOT_READ=this\n');
  assert.equal((await runtime.stop()).cleanup, 'terminated');
  assert.equal((await execution.finalize()).state, 'removed');
});

test('browser capture stores authoritative evidence with clean-snapshot provenance', async (context) => {
  const repository = await browserFixture(context);
  const subject = await inspectGitDiff(repository);
  const execution = await createCleanBrowserExecution(
    { repositoryRoot: repository, candidateId: 'browser-flow' },
    { qualify: qualification(subject) }
  );
  const receipt = await captureQualifiedPlaywrightFlow({
    repositoryRoot: repository,
    captureId: 'clean-capture',
    candidateId: 'browser-flow',
    timeoutMs: 500,
    executionContext: execution,
  });

  assert.equal(receipt.state, 'local_server_required', JSON.stringify(receipt));
  assert.deepEqual(receipt.execution_source, execution.provenance);
  assert.equal(receipt.subject.repository_revision, subject.repository_revision);
  assert.equal(
    JSON.parse(
      await readFile(
        join(repository, '.codevetter', 'playwright-runs', 'clean-capture', 'receipt.json')
      )
    ).execution_source.mode,
    'clean_git_snapshot'
  );
  await assert.rejects(
    access(join(execution.executionRoot, '.codevetter', 'playwright-runs', 'clean-capture')),
    /ENOENT/
  );
  assert.equal((await execution.finalize()).state, 'removed');
});

function qualification(subject) {
  return async () => ({
    subject,
    flows: [
      {
        id: 'browser-flow',
        adapter: 'playwright',
        target: 'tests/landing.spec.ts',
        name: 'landing',
        package_scope: '.',
        signals: [
          { kind: 'loopback_browser_base_url', evidence: 'http://127.0.0.1:9' },
          { kind: 'declared_browser_server_family', evidence: 'next' },
          { kind: 'declared_browser_server_command_sha256', evidence: 'a'.repeat(64) },
          { kind: 'declared_browser_warmup_path', evidence: '/' },
        ],
        safety_flags: [{ kind: 'browser_signal', evidence: 'tests/landing.spec.ts' }],
        evidence: [{ kind: 'literal_test_declaration', file: 'tests/landing.spec.ts', line: 1 }],
      },
    ],
  });
}

async function browserFixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-clean-browser-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await execute('git', ['init', '--initial-branch=main'], { cwd: root });
  await mkdir(join(root, 'tests'));
  await writeFile(join(root, '.gitignore'), '.env.local\nnode_modules\n.codevetter\n');
  await writeFile(join(root, '.env.example'), 'EXAMPLE_ONLY=placeholder\n');
  await writeFile(join(root, 'app.mjs'), 'export const value = 1;\n');
  await writeFile(join(root, 'tests', 'landing.spec.ts'), 'export {};\n');
  await execute('git', ['add', '.'], { cwd: root });
  await execute(
    'git',
    [
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=CodeVetter Test',
      '-c',
      'user.email=codevetter@example.invalid',
      'commit',
      '-m',
      'fixture',
    ],
    { cwd: root }
  );
  await writeFile(join(root, '.env.local'), 'DO_NOT_READ=this\n');
  await mkdir(join(root, 'node_modules', 'next'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'next', 'marker.txt'), 'installed locally\n');
  return realpath(root);
}
