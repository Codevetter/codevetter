import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { admissibleUnderFixedIndex, planFixedIndex } from './tiers.mjs';

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'cr-fixed-index-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');

  const commit = (message, body) => {
    writeFileSync(join(repo, 'app.js'), body);
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', message);
    return git('rev-parse', 'HEAD').trim();
  };

  const oldest = commit('seed', 'export const value = 1;\n');
  const middle = commit('first fix', 'export const value = 2;\n');
  const newest = commit('second fix', 'export const value = 3;\n');
  return { repo, oldest, middle, newest };
}

test('a case is admissible only if the index predates it', (t) => {
  const state = fixture();
  t.after(() => rmSync(state.repo, { recursive: true, force: true }));

  assert.equal(
    admissibleUnderFixedIndex({
      repo: state.repo,
      indexRevision: state.oldest,
      caseRevision: state.newest,
    }),
    true
  );
  assert.equal(
    admissibleUnderFixedIndex({
      repo: state.repo,
      indexRevision: state.newest,
      caseRevision: state.oldest,
    }),
    false
  );
  assert.equal(
    admissibleUnderFixedIndex({
      repo: state.repo,
      indexRevision: state.middle,
      caseRevision: state.middle,
    }),
    false
  );
});

test('the fixed-index plan admits only cases valid against the common ancestor', (t) => {
  const state = fixture();
  t.after(() => rmSync(state.repo, { recursive: true, force: true }));

  const plan = planFixedIndex({
    repo: state.repo,
    cases: [
      {
        case_id: 'middle',
        commit: state.middle,
        base_revision: state.oldest,
        required_files: ['app.js'],
      },
      {
        case_id: 'newest',
        commit: state.newest,
        base_revision: state.middle,
        required_files: ['app.js'],
      },
      {
        case_id: 'missing',
        commit: state.newest,
        base_revision: state.middle,
        required_files: ['missing.js'],
      },
    ],
  });

  assert.equal(plan.index_revision, state.oldest);
  assert.deepEqual(
    plan.admitted.map((entry) => entry.case_id),
    ['middle', 'newest']
  );
  assert.deepEqual(plan.rejected, [
    {
      case_id: 'missing',
      reason: 'required paths absent from fixed index: missing.js',
    },
  ]);
});

test('an unknown revision is inadmissible rather than silently allowed', (t) => {
  const state = fixture();
  t.after(() => rmSync(state.repo, { recursive: true, force: true }));

  assert.equal(
    admissibleUnderFixedIndex({
      repo: state.repo,
      indexRevision: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      caseRevision: state.newest,
    }),
    false
  );
});
