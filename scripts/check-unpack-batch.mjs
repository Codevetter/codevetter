import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

const corpus = 'benchmarks/repo-unpacks/';
const receiptPattern = /^evidence\/verification\/repo-unpack-expansion-\d{4}-\d{2}-\d{2}\.json$/;
const projections = new Set([
  'apps/landing-page-astro/src/data/unpack-reports.json',
  'apps/landing-page-astro/public/api-ai.json',
]);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function isUnpackArtifact(path) {
  return (
    /^benchmarks\/repo-unpacks\/[a-z0-9-]+\.json$/.test(path) ||
    /^evidence\/verification\/repo-unpack-expansion-\d{4}-\d{2}-\d{2}(?:-checks)?\.json$/.test(
      path
    ) ||
    projections.has(path)
  );
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(root, path) {
  requireCondition(lstatSync(join(root, path)).isFile(), `Not a regular file: ${path}`);
  requireCondition(
    lstatSync(join(root, path)).size <= 32 * 1024 * 1024,
    `Oversized artifact: ${path}`
  );
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function verifyBaseline(root, base, receipt) {
  const names = execFileSync('git', ['ls-tree', '--name-only', `${base}:${corpus.slice(0, -1)}`], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter((name) => name.endsWith('.json'));
  requireCondition(names.length === receipt.baseline_repositories, 'Baseline count differs');
  requireCondition(
    Object.keys(receipt.baseline_sha256).length === names.length,
    'Incomplete baseline hashes'
  );
  for (const name of names) {
    const bytes = execFileSync('git', ['show', `${base}:${corpus}${name}`], {
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    requireCondition(
      hash(bytes) === receipt.baseline_sha256[name],
      `Baseline receipt differs: ${name}`
    );
    requireCondition(
      lstatSync(join(root, corpus, name)).isFile(),
      `Not a regular baseline file: ${name}`
    );
    requireCondition(
      hash(readFileSync(join(root, corpus, name))) === hash(bytes),
      `Baseline changed: ${name}`
    );
  }
  return new Set(names);
}

function verifyAddition(root, row) {
  requireCondition(/^[a-z0-9-]+$/.test(row.slug), 'Invalid repository slug');
  requireCondition(/^[a-f0-9]{40}$/.test(row.commit_sha), `Invalid source pin: ${row.slug}`);
  const path = `${corpus}${row.slug}.json`;
  const record = readJson(root, path);
  requireCondition(
    hash(readFileSync(join(root, path))) === row.corpus_sha256,
    `Corpus hash differs: ${row.slug}`
  );
  requireCondition(
    record.slug === row.slug && record.repo === row.repo,
    `Repository identity differs: ${row.slug}`
  );
  requireCondition(
    record.scan.inventory.commit_sha === row.commit_sha,
    `Scan pin differs: ${row.slug}`
  );
  requireCondition(
    record.scan.inventory.repo_path === '[local clone path omitted from public export]',
    `Private clone path: ${row.slug}`
  );
  requireCondition(
    record.analysis.source_commit_sha === row.commit_sha,
    `Analysis pin differs: ${row.slug}`
  );
  requireCondition(
    record.analysis.citation_validation.status === 'passed',
    `Unqualified citations: ${row.slug}`
  );
  requireCondition(
    record.analysis.source_review.status === 'reviewed_bounded',
    `Missing bounded review: ${row.slug}`
  );
  requireCondition(
    record.analysis.runtime_verification.upstream_code_executed === false,
    `Unexpected runtime claim: ${row.slug}`
  );
  return path;
}

function verifyProjectionBaseline(root, base, rows) {
  const oldJson = (path) =>
    JSON.parse(
      execFileSync('git', ['show', `${base}:${path}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 })
    );
  const [reportPath, apiPath] = [...projections];
  const oldReports = oldJson(reportPath);
  const reports = readJson(root, reportPath);
  for (const old of oldReports)
    requireCondition(
      JSON.stringify(reports.find((row) => row.slug === old.slug)) === JSON.stringify(old),
      `Baseline projection changed: ${old.slug}`
    );
  const oldApi = oldJson(apiPath);
  const api = readJson(root, apiPath);
  const newSlugs = new Set(rows.map((row) => row.slug));
  for (const old of oldApi.surfaces)
    requireCondition(
      JSON.stringify(api.surfaces.find((row) => row.id === old.id)) === JSON.stringify(old),
      `Baseline API surface changed: ${old.id}`
    );
  const known = new Set(oldApi.surfaces.map((row) => row.id));
  for (const surface of api.surfaces.filter((row) => !known.has(row.id))) {
    const slug = surface.url.replace('https://codevetter.com/unpack/', '').split('/')[0];
    requireCondition(
      newSlugs.has(slug) && surface.id.startsWith(`unpack-${slug}`),
      `Unrelated API addition: ${surface.id}`
    );
  }
  requireCondition(
    JSON.stringify({ ...api, surfaces: [] }) === JSON.stringify({ ...oldApi, surfaces: [] }),
    'Unrelated API metadata changed'
  );
}

// Large source-evidence imports are measured separately from executable code.
// This validates immutable receipt binding and projection reproducibility;
// it does not repeat source inspection or establish semantic/runtime correctness.
export function assessUnpackBatch(root, base, changedPaths, checkProjection = true) {
  try {
    const receipts = changedPaths.filter((path) => receiptPattern.test(path));
    requireCondition(receipts.length === 1, 'Exactly one dated expansion receipt required');
    const receipt = readJson(root, receipts[0]);
    requireCondition(
      receipt.added_repositories > 0 && receipt.added_repositories <= 100,
      'Batch exceeds 100 additions'
    );
    requireCondition(
      receipt.repositories.length === receipt.added_repositories,
      'Addition count differs'
    );
    requireCondition(
      receipt.tests_executed_upstream === false &&
        receipt.full_semantic_correctness_established === false,
      'Evidence boundary differs'
    );
    const baseline = verifyBaseline(root, base, receipt);
    const additions = receipt.repositories.map((row) => verifyAddition(root, row));
    requireCondition(new Set(additions).size === additions.length, 'Duplicate addition');
    const expected = new Set([...baseline].map((name) => `${corpus}${name}`).concat(additions));
    const actual = readdirSync(join(root, corpus)).filter((name) => name.endsWith('.json'));
    requireCondition(
      actual.length === receipt.prepared_repositories && actual.length === expected.size,
      'Prepared corpus count differs'
    );
    requireCondition(
      actual.every((name) => expected.has(`${corpus}${name}`)),
      'Unreceipted corpus addition'
    );
    const checksPath = receipts[0].replace(/\.json$/, '-checks.json');
    const checks = readJson(root, checksPath);
    requireCondition(
      checks.final_checks_passed === true &&
        checks.checks.length > 0 &&
        checks.checks.every((check) => check.exit_code === 0),
      'Qualification checks failed'
    );
    const allowed = new Set([...additions, ...projections, receipts[0], checksPath]);
    const artifacts = changedPaths.filter(isUnpackArtifact);
    requireCondition(
      artifacts.every((path) => allowed.has(path)),
      'Unexpected corpus artifact change'
    );
    const bytes = artifacts.reduce((total, path) => total + lstatSync(join(root, path)).size, 0);
    requireCondition(bytes <= 128 * 1024 * 1024, 'Batch exceeds 128 MiB');
    if (checkProjection) {
      verifyProjectionBaseline(root, base, receipt.repositories);
      execFileSync(process.execPath, ['scripts/sync-unpack-pages.mjs', '--check'], {
        cwd: root,
        stdio: 'pipe',
      });
    }
    return { passed: true, artifacts, additions: additions.length, bytes };
  } catch (error) {
    return { passed: false, reason: error.message, artifacts: [] };
  }
}
