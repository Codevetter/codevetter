import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractPaths } from './generic-cli.mjs';

const WORKTREE = '/private/tmp/wt/ck-gin-abcdef012345';
// Stand in for the filesystem so these cases are about extraction, not about a fixture
// repository. Anything listed here "exists as a regular file"; everything else does not.
const files = (...paths) => {
  const set = new Set(paths.map((p) => `${WORKTREE}/${p}`));
  return (absolute) => set.has(absolute);
};

test('ground-truth file types outside the source-code vocabulary are extractable', () => {
  // Every path here is a real ground-truth entry from the corpus. Under the previous
  // extension allowlist (ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|swift|kt|astro)
  // none of them could be matched, so 174 of 764 cases were unscoreable by construction
  // and no tool could score them however good its answer was.
  const nonCode = [
    'package.json',
    'go.mod',
    'go.sum',
    'CHANGES.rst',
    'wrangler.toml',
    'src/styles/globals.css',
    'scripts/deploy-health.sh',
    'pnpm-workspace.yaml',
    'data/people.csv',
    'index.html',
    '.gitignore',
    'Dockerfile',
    'LICENSE',
    'public/_headers',
    '.husky/pre-push',
  ];
  const found = extractPaths({
    text: nonCode.map((p) => `  ${p}`).join('\n'),
    worktree: WORKTREE,
    isFile: files(...nonCode),
  });
  assert.deepEqual(
    found.map((entry) => entry.path),
    nonCode
  );
});

test('absolute paths survive extraction', () => {
  // ck emits absolute paths. The old capture group began with [\w.-], which cannot match
  // a leading slash, so a full 2,597-token payload of four correct files scored 0%.
  const found = extractPaths({
    text: `${WORKTREE}/context.go:12: func (c *Context) Bind\n${WORKTREE}/gin.go:88: engine`,
    worktree: WORKTREE,
    isFile: files('context.go', 'gin.go'),
  });
  assert.deepEqual(
    found.map((entry) => entry.path),
    ['context.go', 'gin.go']
  );
});

test('directories never occupy a result slot', () => {
  // The extension-agnostic pattern matches "src/handlers" as readily as a filename, so
  // the isFile check is load-bearing: without it a tool that prints the directories it
  // searched would have those slots counted against its ranking depth.
  const isFile = (absolute) => absolute === `${WORKTREE}/src/handlers/auth.ts`;
  const found = extractPaths({
    text: 'searched src/handlers, src/lib, tests/ and found src/handlers/auth.ts',
    worktree: WORKTREE,
    isFile,
  });
  assert.deepEqual(
    found.map((entry) => entry.path),
    ['src/handlers/auth.ts']
  );
});

test('rank reflects the order the tool emitted, not the order discovered on disk', () => {
  const found = extractPaths({
    text: 'third.ts\nfirst.ts\nsecond.ts',
    worktree: WORKTREE,
    isFile: files('first.ts', 'second.ts', 'third.ts'),
  });
  assert.deepEqual(found, [
    { path: 'third.ts', rank: 1 },
    { path: 'first.ts', rank: 2 },
    { path: 'second.ts', rank: 3 },
  ]);
});

test('trailing prose punctuation is not absorbed into the path', () => {
  const found = extractPaths({
    text: 'The handler lives in src/app.ts. See also (src/util.ts), or src/x.ts;',
    worktree: WORKTREE,
    isFile: files('src/app.ts', 'src/util.ts', 'src/x.ts'),
  });
  assert.deepEqual(
    found.map((entry) => entry.path),
    ['src/app.ts', 'src/util.ts', 'src/x.ts']
  );
});

test('a bare extensionless word is not treated as a path', () => {
  // "Dockerfile" at a root is a real ground-truth file, but a prose word like "results"
  // is not. The separator-or-extension rule is what distinguishes them, so a tool whose
  // output is chatty does not accumulate phantom hits on common English words.
  const found = extractPaths({
    text: 'results summary complete Dockerfile',
    worktree: WORKTREE,
    // Deliberately claim all three exist: the filter under test is shape, not existence.
    isFile: files('results', 'summary', 'complete', 'Dockerfile'),
  });
  assert.deepEqual(
    found.map((entry) => entry.path),
    ['Dockerfile']
  );
});

test('repo-name self-prefix is stripped', () => {
  // gortex reports paths relative to the worktree's parent.
  const found = extractPaths({
    text: 'ck-gin-abcdef012345/routes.go',
    worktree: WORKTREE,
    isFile: files('routes.go'),
  });
  assert.deepEqual(
    found.map((entry) => entry.path),
    ['routes.go']
  );
});

test('duplicate mentions collapse to one ranked entry', () => {
  const found = extractPaths({
    text: 'src/app.ts\nsrc/app.ts\n./src/app.ts',
    worktree: WORKTREE,
    isFile: files('src/app.ts'),
  });
  assert.equal(found.length, 1);
});
