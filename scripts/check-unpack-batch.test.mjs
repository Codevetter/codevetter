import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assessUnpackBatch, isUnpackArtifact } from './check-unpack-batch.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const evidence = 'evidence/verification/repo-unpack-expansion-2026-10-02.json';
const corpus = 'benchmarks/repo-unpacks/';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'codevetter-unpack-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, data) => {
    const file = join(root, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(data));
  };
  put(`${corpus}old.json`, { slug: 'old' });
  put('apps/landing-page-astro/src/data/unpack-reports.json', [{ slug: 'old' }]);
  put('apps/landing-page-astro/public/api-ai.json', { surfaces: [] });
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('add', '.');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'baseline'
  );
  const sha = 'a'.repeat(40);
  put(`${corpus}new.json`, {
    slug: 'new',
    repo: 'owner/new',
    scan: {
      inventory: { commit_sha: sha, repo_path: '[local clone path omitted from public export]' },
    },
    analysis: {
      source_commit_sha: sha,
      citation_validation: { status: 'passed' },
      source_review: { status: 'reviewed_bounded' },
      runtime_verification: { upstream_code_executed: false },
    },
  });
  const receipt = {
    baseline_repositories: 1,
    added_repositories: 1,
    prepared_repositories: 2,
    baseline_sha256: { 'old.json': hash(readFileSync(join(root, `${corpus}old.json`))) },
    tests_executed_upstream: false,
    full_semantic_correctness_established: false,
    repositories: [
      {
        slug: 'new',
        repo: 'owner/new',
        commit_sha: sha,
        corpus_sha256: hash(readFileSync(join(root, `${corpus}new.json`))),
      },
    ],
  };
  put(evidence, receipt);
  const checks = evidence.replace(/\.json$/, '-checks.json');
  put(checks, { final_checks_passed: true, checks: [{ exit_code: 0 }] });
  const paths = [`${corpus}new.json`, evidence, checks];
  return { root, put, receipt, paths, assess: () => assessUnpackBatch(root, 'HEAD', paths, false) };
}

test('qualified data is separated from executable source paths', (t) => {
  const f = fixture(t);
  f.paths.push('crates/codevetter-core/src/main.rs');
  const result = f.assess();
  assert.equal(result.passed, true);
  assert.equal(result.additions, 1);
  assert.equal(result.artifacts.includes('crates/codevetter-core/src/main.rs'), false);
  assert.equal(isUnpackArtifact('benchmarks/repo-unpacks/../main.rs'), false);
  assert.equal(isUnpackArtifact('evidence/verification/unrelated.json'), false);
});

test('receipt binding rejects changed corpus bytes and baseline rewriting', (t) => {
  const f = fixture(t);
  f.put(`${corpus}new.json`, { changed: true });
  assert.match(f.assess().reason, /Corpus hash differs/);
  f.put(`${corpus}old.json`, { changed: true });
  assert.match(f.assess().reason, /Baseline changed/);
});

test('unreceipted additions, duplicated rows and failed checks fail closed', (t) => {
  const f = fixture(t);
  f.put(`${corpus}extra.json`, {});
  assert.match(f.assess().reason, /corpus count/);
  rmSync(join(f.root, `${corpus}extra.json`));
  f.receipt.repositories.push(f.receipt.repositories[0]);
  f.receipt.added_repositories = 2;
  f.put(evidence, f.receipt);
  assert.match(f.assess().reason, /Duplicate addition/);
  f.receipt.repositories.pop();
  f.receipt.added_repositories = 1;
  f.put(evidence, f.receipt);
  f.put(evidence.replace(/\.json$/, '-checks.json'), {
    final_checks_passed: true,
    checks: [{ exit_code: 1 }],
  });
  assert.match(f.assess().reason, /Qualification checks failed/);
});

test('stale projections and overlarge batches fail closed', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'scripts'));
  writeFileSync(join(f.root, 'scripts/sync-unpack-pages.mjs'), 'process.exit(1);');
  assert.equal(assessUnpackBatch(f.root, 'HEAD', f.paths).passed, false);
  f.receipt.added_repositories = 101;
  f.put(evidence, f.receipt);
  assert.match(f.assess().reason, /exceeds 100/);
});

test('symlinked corpus input is rejected before reading its contents', (t) => {
  const f = fixture(t);
  rmSync(join(f.root, `${corpus}new.json`));
  symlinkSync(join(f.root, 'missing-private-target'), join(f.root, `${corpus}new.json`));
  assert.match(f.assess().reason, /Not a regular file/);
});

test('baseline projection and unrelated API changes are rejected', (t) => {
  const f = fixture(t);
  f.put('apps/landing-page-astro/src/data/unpack-reports.json', [{ slug: 'old', changed: true }]);
  assert.match(assessUnpackBatch(f.root, 'HEAD', f.paths).reason, /Baseline projection changed/);
  f.put('apps/landing-page-astro/src/data/unpack-reports.json', [{ slug: 'old' }]);
  f.put('apps/landing-page-astro/public/api-ai.json', {
    surfaces: [{ id: 'unrelated', url: 'https://example.invalid/' }],
  });
  assert.match(assessUnpackBatch(f.root, 'HEAD', f.paths).reason, /Unrelated API addition/);
});
