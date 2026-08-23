import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { retrieveRandomCodeFiles, retrieveRandomFiles } from './controls.mjs';

// A repository whose tracked files are deliberately a mix of code and everything else,
// because the distinction between the two random draws is the thing under test.
const CODE = ['src/app.ts', 'src/util.go', 'lib/handler.py'];
const NON_CODE = ['package.json', 'go.sum', 'CHANGES.rst', 'docs/guide.md', 'assets/logo.webp'];

function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cr-controls-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  for (const path of [...CODE, ...NON_CODE]) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), 'x\n');
  }
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { dir, revision: git('rev-parse', 'HEAD').trim() };
}

test('the honest null draws from every tracked file, not just code', () => {
  // Restricting the pool to source files was the old behaviour and it is wrong: ground
  // truth is "the files the fix touched", and the corpus contains .rst, .css, .sh, .mod
  // and .webp answers. A floor that cannot draw them is not a floor for those cases.
  const { dir, revision } = fixtureRepo();
  const result = retrieveRandomFiles({ repo: dir, revision, query: 'anything', limit: 50 });
  assert.equal(result.corpus_size, CODE.length + NON_CODE.length);
  assert.deepEqual([...result.files].sort(), [...CODE, ...NON_CODE].sort());
});

test('the conservative floor draws only source files', () => {
  const { dir, revision } = fixtureRepo();
  const result = retrieveRandomCodeFiles({ repo: dir, revision, query: 'anything', limit: 50 });
  assert.equal(result.corpus_size, CODE.length);
  assert.deepEqual([...result.files].sort(), [...CODE].sort());
});

test('the conservative floor is the harder one to beat', () => {
  // This is why both are reported. Widening the pool makes the random control weaker,
  // and a weaker floor flatters every real provider and makes the controls-lose gate
  // easier to pass — so the run has to clear the strict draw too, not only the honest
  // one. Same limit, fewer wasted slots.
  const { dir, revision } = fixtureRepo();
  const limit = 3;
  const wide = retrieveRandomFiles({ repo: dir, revision, query: 'q', limit });
  const strict = retrieveRandomCodeFiles({ repo: dir, revision, query: 'q', limit });
  const codeIn = (files) => files.filter((path) => CODE.includes(path)).length;
  assert.ok(
    codeIn(strict.files) >= codeIn(wide.files),
    `strict draw returned ${codeIn(strict.files)} code files, wide returned ${codeIn(wide.files)}`
  );
  assert.equal(codeIn(strict.files), limit);
});

test('both draws are reproducible from case identity alone', () => {
  // A control that varies run to run cannot be cited as a floor.
  const { dir, revision } = fixtureRepo();
  for (const draw of [retrieveRandomFiles, retrieveRandomCodeFiles]) {
    const a = draw({ repo: dir, revision, query: 'stable', limit: 3 });
    const b = draw({ repo: dir, revision, query: 'stable', limit: 3 });
    assert.deepEqual(a.files, b.files);
  }
  // A different query must reshuffle, or the "random" draw is a fixed answer key.
  const first = retrieveRandomFiles({ repo: dir, revision, query: 'one', limit: 3 });
  const second = retrieveRandomFiles({ repo: dir, revision, query: 'two', limit: 3 });
  assert.notDeepEqual(first.files, second.files);
});

test('the ranking a control reports matches the files it returned', () => {
  const { dir, revision } = fixtureRepo();
  const result = retrieveRandomCodeFiles({ repo: dir, revision, query: 'q', limit: 3 });
  assert.deepEqual(
    result.ranking.map((entry) => entry.path),
    result.files
  );
  assert.deepEqual(
    result.ranking.map((entry) => entry.rank),
    [1, 2, 3]
  );
});
