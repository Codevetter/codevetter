import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assessChangeCost, inspectChangeCost } from './change-cost.mjs';

test('records and accepts a small source-bounded candidate', async (context) => {
  const root = await fixture(context, { 'src/work.js': 'export const work = () => 1;\n' });
  await writeFile(join(root, 'src/work.js'), 'export const work = () => {\n  return 2;\n};\n');

  const observed = await inspectChangeCost(root, ['src/work.js']);
  const assessment = assessChangeCost(observed, { allowedFiles: ['src/work.js'] });

  assert.equal(observed.lines_added, 3);
  assert.equal(observed.lines_removed, 1);
  assert.equal(observed.gross_lines_changed, 4);
  assert.deepEqual(assessment.violations, []);
});

test('rejects growth and files outside the proposed boundary', () => {
  const assessment = assessChangeCost(
    cost({
      files_changed: 4,
      lines_added: 170,
      gross_lines_changed: 220,
      changed_files: ['src/work.js', 'src/helper.js', 'src/extra.js', 'README.md'],
    }),
    { allowedFiles: ['src/work.js'] }
  );

  assert.deepEqual(assessment.violations, [
    'source_boundary',
    'files_changed',
    'lines_added',
    'gross_lines_changed',
  ]);
});

test('detects a newly added production dependency', async (context) => {
  const root = await fixture(context, {
    'package.json': '{"dependencies":{"existing":"1.0.0"}}\n',
  });
  await writeFile(
    join(root, 'package.json'),
    '{"dependencies":{"existing":"1.0.0","new-runtime":"2.0.0"}}\n'
  );

  const observed = await inspectChangeCost(root, ['package.json']);
  assert.deepEqual(observed.production_dependencies_added, ['npm:new-runtime']);
  assert.deepEqual(assessChangeCost(observed).violations, ['production_dependencies_added']);
});

function cost(overrides = {}) {
  return {
    complete: true,
    files_changed: 1,
    changed_files: ['src/work.js'],
    lines_added: 1,
    lines_removed: 1,
    gross_lines_changed: 2,
    net_lines_changed: 0,
    untracked_files: [],
    binary_files: [],
    production_dependencies_added: [],
    ...overrides,
  };
}

async function fixture(context, files) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-change-cost-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  await command('git', ['init', '-q'], root);
  await command('git', ['add', '.'], root);
  await command(
    'git',
    [
      '-c',
      'user.name=CodeVetter Test',
      '-c',
      'user.email=codevetter@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'fixture baseline',
    ],
    root
  );
  return root;
}

function command(program, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${program} failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}
