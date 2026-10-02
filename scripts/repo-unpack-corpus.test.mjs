import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { validateUnpackCitations } from './repo-unpack-corpus.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const names = [
  'system_map',
  'feature_catalog',
  'data_flow',
  'behavior_traces',
  'testing_signals',
  'risk_map',
  'extension_points',
  'agent_handoff',
];
const report = (source) =>
  Object.fromEntries(
    names.map((name) => [
      name,
      {
        summary: 'Source inspection, not runtime qualification.',
        claims: [
          {
            claim: 'The corpus helper imports child_process.',
            sources: [source],
            kind: 'evidence',
          },
        ],
      },
    ])
  );

test('accepts exact tracked blob anchors at a pinned revision', () => {
  for (const source of [
    'scripts/repo-unpack-corpus.mjs#L1-5',
    'scripts/repo-unpack-corpus.mjs#L1-L5',
  ])
    assert.deepEqual(validateUnpackCitations(report(source), root, sha), []);
});

test('rejects directories, invalid ranges, traversal and untracked working-tree files', () => {
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  const fixture = mkdtempSync(join(root, 'artifacts/citation-test-'));
  writeFileSync(join(fixture, 'untracked.txt'), 'This file exists only in the worktree.\n');
  const untracked = relative(root, join(fixture, 'untracked.txt'));
  try {
    for (const source of [
      'scripts#L1',
      'scripts/repo-unpack-corpus.mjs#L5-1',
      'scripts/repo-unpack-corpus.mjs#L5-L1',
      'scripts/repo-unpack-corpus.mjs#L999999',
      '../package.json#L1',
      '/package.json#L1',
      `${untracked}#L1`,
      'scripts/repo-unpack-corpus.mjs',
      'scripts/./repo-unpack-corpus.mjs#L1',
    ]) {
      assert.ok(validateUnpackCitations(report(source), root, sha).length, source);
    }
  } finally {
    rmSync(fixture, { recursive: true });
  }
});

test('fails closed on symbolic revisions and malformed claims or sections', () => {
  assert.ok(validateUnpackCitations(report('package.json#L1'), root, 'HEAD').length);
  assert.ok(validateUnpackCitations(null, root, sha).length);
  const bad = report('package.json#L1');
  bad.system_map.summary = {};
  bad.risk_map.claims[0].claim = {};
  bad.testing_signals.claims[0].sources = [];
  assert.equal(validateUnpackCitations(bad, root, sha).length, 3);
});

test('rejects sensitive-file citations before inspecting Git objects', () => {
  for (const path of [
    '.env',
    '.env.example',
    'certs/server.pem',
    'id_ed25519',
    '.aws/credentials',
  ]) {
    const errors = validateUnpackCitations(report(`${path}#L1`), '/nonexistent-checkout', sha);
    assert.equal(errors.length, names.length);
    assert.ok(errors.every((error) => error.includes('prohibited sensitive-file')));
  }
});
