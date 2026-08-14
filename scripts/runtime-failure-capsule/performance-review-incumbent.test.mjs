import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { materializeCleanGitIncumbent, parseTreeListing } from './performance-review-incumbent.mjs';

const execute = promisify(execFile);

test('materializes one clean revision without changing the developer checkout', async (context) => {
  const repository = await gitFixture(context);
  const revision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim();
  await mkdir(join(repository, 'node_modules', 'fixture-dependency'), { recursive: true });
  await writeFile(
    join(repository, 'node_modules', 'fixture-dependency', 'index.mjs'),
    'export const dependency = true;\n'
  );
  await writeFile(join(repository, 'src.mjs'), 'export const value = 2;\n');

  const incumbent = await materializeCleanGitIncumbent(repository, revision);
  assert.match(incumbent.root, /\.codevetter\/review-incumbent-/);
  assert.equal(
    await readFile(join(incumbent.root, 'src.mjs'), 'utf8'),
    'export const value = 1;\n'
  );
  assert.equal(await readFile(join(repository, 'src.mjs'), 'utf8'), 'export const value = 2;\n');
  assert.deepEqual(await incumbent.graftNodeDependencies(repository, ['src.mjs']), [
    'node_modules',
  ]);
  assert.deepEqual(incumbent.dependencyProvenance().grafts, ['node_modules']);
  assert.equal(incumbent.dependencyProvenance().graft_count, 1);
  assert.match(incumbent.dependencyProvenance().graft_sha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(incumbent.dependencyProvenance()), /codevetter-incumbent/);
  assert.equal(
    await readFile(join(incumbent.root, 'node_modules', 'fixture-dependency', 'index.mjs'), 'utf8'),
    'export const dependency = true;\n'
  );
  await incumbent.assertUnchanged();

  await writeFile(join(incumbent.root, 'src.mjs'), 'export const value = 3;\n');
  await assert.rejects(incumbent.assertUnchanged(), /changed during paired review/);
  const materializedRoot = incumbent.root;
  assert.equal(await incumbent.dispose(), 'removed');
  assert.equal(await incumbent.dispose(), 'already_removed');
  await assert.rejects(access(materializedRoot), /ENOENT/);
});

test('dependency graft rejects direct links back into mutable workspace source', async (context) => {
  const repository = await gitFixture(context);
  const revision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim();
  await mkdir(join(repository, 'node_modules'), { recursive: true });
  await symlink(repository, join(repository, 'node_modules', 'workspace-source'), 'dir');
  const incumbent = await materializeCleanGitIncumbent(repository, revision);
  context.after(() => incumbent.dispose());

  await assert.rejects(
    incumbent.graftNodeDependencies(repository, ['src.mjs']),
    /links to mutable workspace source/
  );
});

test('tree admission rejects unsafe object kinds and sensitive names before extraction', () => {
  assert.throws(
    () => parseTreeListing(`120000 blob ${'a'.repeat(40)} 8\tlinked-file\0`),
    /symlink, gitlink, or unsupported object/
  );
  assert.throws(
    () => parseTreeListing(`100644 blob ${'a'.repeat(40)} 8\tprivate-key.pem\0`),
    /sensitive path/
  );
  assert.deepEqual(
    parseTreeListing(`100644 blob ${'a'.repeat(40)} 8\t.env.example\0`, {
      excludeSensitivePaths: true,
    }),
    { files: 0, bytes: 0, excludedSensitivePaths: ['.env.example'] }
  );
  assert.throws(
    () => parseTreeListing(`100644 blob ${'a'.repeat(40)} 8\t../escape\0`),
    /path is unsafe/
  );
});

async function gitFixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-incumbent-fixture-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await execute('git', ['init', '--initial-branch=main'], { cwd: root });
  await writeFile(join(root, 'src.mjs'), 'export const value = 1;\n');
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
  return root;
}
