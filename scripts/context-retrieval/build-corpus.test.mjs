import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildRetrievalCorpus, pathTokens, tokenize } from './build-corpus.mjs';
import { retrieveByKeyword } from './adapters/keyword-search.mjs';
import { renderRetrievalScore, scoreRetrieval, validateRetrievalCorpus } from './score.mjs';

async function fixtureRepo() {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-retrieval-'));
  const run = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  run('init', '--initial-branch=main');
  run('config', 'user.email', 'fixture@example.com');
  run('config', 'user.name', 'Fixture');
  const commit = async (message, files) => {
    for (const [path, contents] of Object.entries(files)) {
      await writeFile(join(root, path), contents);
    }
    run('add', '-A');
    run('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', message);
  };
  await commit('feat: seed the fixture tree', {
    'ledger.ts': 'export function settle(rows) {\n  return rows;\n}\n',
    'ledger.test.ts': 'test("settle", () => {});\n',
    'account.go': 'package account\nfunc Settle() {}\n',
    'account_test.go': 'package account\nfunc TestSettle() {}\n',
    'profile.py': 'def settle():\n    return True\n',
    'test_profile.py': 'def test_settle():\n    assert True\n',
    'unrelated.ts': 'export const spare = 1;\n',
    'package.json': '{ "version": "1.0.0" }\n',
    'README.md': '# fixture\n',
  });
  await commit('fix: settle pending ledger rows before payout', {
    'ledger.ts': 'export function settle(rows) {\n  return rows.filter(Boolean);\n}\n',
    'ledger.test.ts': 'test("settle", () => { /* pending */ });\n',
    'account.go': 'package account\nfunc Settle() { /* pending */ }\n',
    'account_test.go': 'package account\nfunc TestSettle() { /* pending */ }\n',
    'profile.py': 'def settle():\n    return False\n',
    'test_profile.py': 'def test_settle():\n    assert False\n',
    'payout-report.ts': 'export const report = true;\n',
    'package.json': '{ "version": "1.0.1" }\n',
    'README.md': '# fixture updated\n',
  });
  await commit('release: cut 1.0.2', { 'package.json': '{ "version": "1.0.2" }\n' });
  return root;
}

test('tokenization splits camel case and drops noise words', () => {
  assert.deepEqual([...tokenize('settle PendingLedger rows with the payout')].sort(), [
    'ledger',
    'payout',
    'pending',
    'rows',
    'settle',
  ]);
  assert.deepEqual([...pathTokens('apps/desktop/src/lib/warm-verification.ts')].sort(), [
    'apps',
    'desktop',
    'verification',
    'warm',
  ]);
});

test('ground truth excludes docs, releases, derivable tests, and version manifests', async () => {
  const root = await fixtureRepo();
  try {
    const corpus = buildRetrievalCorpus({ repo: root, limit: 10 });
    assert.doesNotThrow(() => validateRetrievalCorpus(corpus));
    assert.equal(corpus.counts.cases, 1);
    const [entry] = corpus.cases;

    assert.equal(entry.query, 'settle pending ledger rows before payout');
    // Only pre-existing source files belong in the retrieval denominator.
    assert.deepEqual(entry.required_files, ['account.go', 'ledger.ts', 'profile.py']);
    // A test sharing its stem with a changed source is free recall, not ground truth.
    assert.deepEqual(entry.derivable_files, [
      'account_test.go',
      'ledger.test.ts',
      'test_profile.py',
    ]);
    // A version bump rode along; it is recorded but not scored.
    assert.deepEqual(entry.incidental_files, ['package.json']);
    assert.deepEqual(entry.excluded_files, ['README.md']);
    // A file created by the fix cannot be retrieved from the pre-fix revision.
    assert.deepEqual(entry.created_files, ['payout-report.ts']);
    assert.equal(entry.base_revision.length, 40);
    assert.notEqual(entry.base_revision, entry.commit);
    assert.equal(entry.retrieval.path_leak, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stale corpora fail closed before scoring', () => {
  assert.throws(
    () => validateRetrievalCorpus({ schema_version: 'codevetter.context-retrieval-corpus.v1' }),
    /rebuild it/
  );
});

test('a manifest-only change keeps the manifest as ground truth', async () => {
  const root = await fixtureRepo();
  try {
    await writeFile(join(root, 'package.json'), '{ "version": "1.0.3", "type": "module" }\n');
    execFileSync('git', ['-C', root, 'add', '-A'], { encoding: 'utf8' });
    execFileSync('git', ['-C', root, 'commit', '-m', 'fix: declare the module type correctly'], {
      encoding: 'utf8',
    });
    const corpus = buildRetrievalCorpus({ repo: root, limit: 10 });
    const manifestCase = corpus.cases.find((entry) => entry.query.includes('module type'));
    assert.deepEqual(manifestCase.required_files, ['package.json']);
    assert.deepEqual(manifestCase.incidental_files, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('keyword retrieval reads the pre-fix revision and reports its identity', async () => {
  const root = await fixtureRepo();
  try {
    const corpus = buildRetrievalCorpus({ repo: root, limit: 10 });
    const [entry] = corpus.cases;
    const response = retrieveByKeyword({
      repo: root,
      revision: entry.base_revision,
      query: entry.query,
      queryTokens: entry.query_tokens,
    });

    assert.equal(response.indexed_revision, entry.base_revision);
    assert.ok(response.files.includes('ledger.ts'));
    assert.ok(!response.files.includes('README.md'), 'markdown is outside the code pathspec');
    assert.ok(response.tokens_delivered > 0);
    assert.equal(
      response.ranking[0].path,
      'ledger.ts',
      'the file matching the most query terms ranks first'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scoring is deterministic and stratifies by what the baseline actually missed', async () => {
  const root = await fixtureRepo();
  try {
    const corpus = buildRetrievalCorpus({ repo: root, limit: 10 });
    const first = await scoreRetrieval({ corpus, repo: root });
    const second = await scoreRetrieval({ corpus, repo: root });

    const stable = (score) => ({
      ...score,
      cases: score.cases.map(({ latency_ms: _latency, ...rest }) => rest),
      providers: score.providers.map((provider) => ({
        provider_id: provider.provider_id,
        summary: Object.fromEntries(
          Object.entries(provider.summary).map(([name, row]) => {
            const { median_latency_ms: _median, ...rest } = row;
            return [name, rest];
          })
        ),
      })),
    });
    assert.deepEqual(stable(second), stable(first));

    const summary = first.providers[0].summary;
    assert.equal(summary.all.cases, corpus.counts.cases);
    assert.equal(
      summary.baseline_missed.cases + summary.baseline_solved.cases,
      summary.all.cases,
      'every case lands in exactly one difficulty stratum'
    );
    // By construction the solved stratum is the set with full recall at 10.
    assert.equal(summary.baseline_solved.full_recall_at_10, 1);
    assert.equal(summary.baseline_missed.full_recall_at_10, 0);
    assert.match(renderRetrievalScore(first), /baseline missed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
