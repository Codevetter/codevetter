import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { runCli } from './cli.mjs';
import { CONTRACT_SCHEMA_VERSIONS, sha256Bytes } from './contracts.mjs';
import { validateCorpus } from './validate-corpus.mjs';

const SAMPLE_ROOT = resolve('benchmarks/agent-tasks/sample');

async function copySample(t) {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-agent-corpus-'));
  const root = join(directory, 'sample');
  await cp(SAMPLE_ROOT, root, { recursive: true });
  t.after(() => rm(directory, { force: true, recursive: true }));
  return root;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

test('the owned sample is valid, deterministic, and explicitly not publishable', () => {
  const first = validateCorpus({ root: SAMPLE_ROOT });
  const second = validateCorpus({ root: SAMPLE_ROOT });

  assert.deepEqual(second, first);
  assert.equal(first.valid, true);
  assert.equal(first.publishable, false);
  assert.deepEqual(first.counts, { categories: 8, qualified_tasks: 8, tasks: 8 });
  assert.deepEqual(first.coverage.categories, [
    'api-contract',
    'authorization',
    'browser-state',
    'concurrency',
    'integration',
    'persistence',
    'regression',
    'validation',
  ]);
  assert.deepEqual(first.coverage.lanes, ['api', 'browser']);
  assert.deepEqual(first.coverage.runtimes, ['node', 'typescript']);
  assert.deepEqual(
    first.gates.map((gate) => [gate.id, gate.passed]),
    [
      ['task-count', false],
      ['qualification-count', true],
      ['lane-coverage', true],
      ['runtime-coverage', true],
      ['failure-category-count', true],
    ]
  );
});

test('non-strict CLI passes the sample while strict readiness fails with the same result', () => {
  const nonStrict = runCli(['--root', SAMPLE_ROOT, '--json']);
  const strict = runCli(['--root', SAMPLE_ROOT, '--strict', '--json']);

  assert.equal(nonStrict.exitCode, 0);
  assert.equal(strict.exitCode, 1);
  assert.deepEqual(strict.result, nonStrict.result);
  assert.equal(strict.output, nonStrict.output);
});

test('fails closed on hash drift and produces sorted deterministic errors', async (t) => {
  const root = await copySample(t);
  const packetPath = join(root, 'tasks/preserve-explicit-false/task.md');
  await writeFile(packetPath, '# Drifted packet\n');

  const first = validateCorpus({ root });
  const second = validateCorpus({ root });

  assert.deepEqual(second, first);
  assert.equal(first.valid, false);
  assert.match(first.errors.join('\n'), /artifact task_packet: SHA-256 mismatch/);
  assert.deepEqual(first.errors, [...first.errors].sort());
});

test('rejects traversal, duplicate task IDs, and malformed JSON', async (t) => {
  const traversalRoot = await copySample(t);
  const traversalIndexPath = join(traversalRoot, 'corpus.json');
  const traversalIndex = await readJson(traversalIndexPath);
  traversalIndex.tasks[0].manifest.path = '../private.json';
  await writeJson(traversalIndexPath, traversalIndex);
  assert.match(validateCorpus({ root: traversalRoot }).errors.join('\n'), /unsafe relative path/);

  const duplicateRoot = await copySample(t);
  const duplicateIndexPath = join(duplicateRoot, 'corpus.json');
  const duplicateIndex = await readJson(duplicateIndexPath);
  duplicateIndex.tasks.push(structuredClone(duplicateIndex.tasks[0]));
  await writeJson(duplicateIndexPath, duplicateIndex);
  assert.match(validateCorpus({ root: duplicateRoot }).errors.join('\n'), /duplicate value/);

  const malformedRoot = await copySample(t);
  await writeFile(join(malformedRoot, 'corpus.json'), '{not-json');
  assert.match(validateCorpus({ root: malformedRoot }).errors.join('\n'), /invalid JSON/);
});

test('rejects symbolic-link artifacts before reading them', async (t) => {
  const root = await copySample(t);
  const taskRoot = join(root, 'tasks/preserve-explicit-false');
  const packetPath = join(taskRoot, 'task.md');
  await unlink(packetPath);
  await symlink('fixture.json', packetPath);

  const result = validateCorpus({ root });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /symbolic links are forbidden/);
});

test('rejects invalid or mismatched qualification evidence', async (t) => {
  const root = await copySample(t);
  const indexPath = join(root, 'corpus.json');
  const index = await readJson(indexPath);
  const manifestPath = join(root, index.tasks[0].manifest.path);
  const receipt = {
    schema_version: CONTRACT_SCHEMA_VERSIONS['qualification-receipt'],
    task_id: 'different-task',
    manifest_sha256: sha256Bytes(await readFile(manifestPath)),
    qualified: true,
    baseline: {
      runs: 2,
      result_sha256: 'a'.repeat(64),
      status: 'wrong_failure',
    },
    known_good: {
      runs: 2,
      result_sha256: 'b'.repeat(64),
      status: 'pass',
    },
    limitations: [],
    unexpected: true,
  };
  const receiptPath = join(root, 'qualification.json');
  await writeJson(receiptPath, receipt);
  index.tasks[0].qualification = {
    path: 'qualification.json',
    sha256: sha256Bytes(await readFile(receiptPath)),
  };
  await writeJson(indexPath, index);

  const result = validateCorpus({ root });
  assert.equal(result.valid, false);
  const errors = result.errors.join('\n');
  assert.match(errors, /qualification: \$\.unexpected: unknown field/);
  assert.match(errors, /qualification: \$\.task_id must equal/);
  assert.match(errors, /must equal the baseline and known-good/);
});
