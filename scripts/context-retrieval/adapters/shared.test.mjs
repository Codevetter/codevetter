import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { materialiseWorktree, run, unavailableShape } from './shared.mjs';

test('run refuses a positional cwd instead of silently ignoring it', () => {
  // Three adapters passed a bare worktree path as the third argument during
  // consolidation. Because spreading a string contributes no keys, cwd was never set and
  // ripgrep searched the harness's own repository — returning this repo's files while
  // claiming to have searched the tree under test. A silent wrong answer is the worst
  // failure mode available here, so the signature now rejects it.
  assert.throws(() => run('/bin/echo', ['x'], '/some/path'), /options object/);
});

test('run honours an explicit cwd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cr-shared-'));
  const out = run('/bin/sh', ['-c', 'pwd'], { cwd: dir }).trim();
  // macOS resolves /var through a symlink to /private/var, so compare the leaf.
  assert.equal(out.split('/').pop(), dir.split('/').pop());
});

test('materialiseWorktree reports failure rather than throwing', () => {
  // A tree that cannot be created is an unavailable arm, not a retrieval failure. The
  // two must stay distinguishable: collapsing "could not run" into "found nothing" is
  // the single largest distortion available in this benchmark.
  const result = materialiseWorktree({
    repo: '/nonexistent/repo',
    revision: 'deadbeef',
    worktree: join(mkdtempSync(join(tmpdir(), 'cr-shared-')), 'wt'),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /^worktree-failed:/);
});

test('materialiseWorktree checks out the requested revision', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cr-shared-repo-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  execFileSync('touch', [join(dir, 'a.ts')]);
  git('add', '-A');
  git('commit', '-qm', 'one');
  const revision = git('rev-parse', 'HEAD').trim();

  const worktree = join(mkdtempSync(join(tmpdir(), 'cr-shared-wt-')), 'wt');
  assert.equal(materialiseWorktree({ repo: dir, revision, worktree }).ok, true);
  assert.equal(
    execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    revision
  );
});

test('the unavailable shape carries no results and no cost', () => {
  const shape = unavailableShape({
    providerId: 'x',
    query: 'q',
    revision: 'r',
    started: process.hrtime.bigint(),
    payloadKind: 'chunks',
    reason: 'because',
  });
  assert.deepEqual(shape.files, []);
  assert.deepEqual(shape.ranking, []);
  assert.equal(shape.tokens_delivered, 0);
  assert.equal(shape.unavailable_reason, 'because');
});
