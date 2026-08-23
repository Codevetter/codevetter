import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createGenericCliAdapter } from './generic-cli.mjs';

// Builds a one-commit repository so the adapter has a real revision to materialise.
function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cr-reuse-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  writeFileSync(join(dir, 'handler.go'), 'package main\n');
  writeFileSync(join(dir, 'package.json'), '{}\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { dir, revision: git('rev-parse', 'HEAD').trim() };
}

test('fixed-index mode returns the result instead of discarding it', () => {
  // This is the large tier's only protocol. The teardown skip was written as
  // `if (reuseIndex) return;` inside a finally block, and a return there does not merely
  // skip cleanup — it REPLACES the value the try block produced. Every fixed-index call
  // resolved to undefined, so the large tier recorded nothing at all and that was read
  // as retrieval tools failing to scale rather than as the harness dropping their work.
  const { dir, revision } = fixtureRepo();
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'cr-wt-'));
  const retrieve = createGenericCliAdapter({
    providerId: 'echo-probe',
    binary: '/bin/echo',
    queryArgs: () => ['handler.go package.json'],
    worktreeRoot,
    reuseIndex: true,
  });

  const first = retrieve({ repo: dir, revision, query: 'handler', limit: 20 });
  assert.ok(first, 'fixed-index call returned nothing');
  assert.deepEqual(first.files, ['handler.go', 'package.json']);

  // The second call must reuse the established worktree and still return a result.
  const second = retrieve({ repo: dir, revision, query: 'handler', limit: 20 });
  assert.ok(second, 'reused fixed-index call returned nothing');
  assert.deepEqual(second.files, ['handler.go', 'package.json']);
});

test('per-case mode still returns a result and tears its worktree down', () => {
  const { dir, revision } = fixtureRepo();
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'cr-wt-'));
  const retrieve = createGenericCliAdapter({
    providerId: 'echo-probe',
    binary: '/bin/echo',
    queryArgs: () => ['handler.go'],
    worktreeRoot,
  });
  const result = retrieve({ repo: dir, revision, query: 'handler', limit: 20 });
  assert.ok(result, 'per-case call returned nothing');
  assert.deepEqual(result.files, ['handler.go']);
});
