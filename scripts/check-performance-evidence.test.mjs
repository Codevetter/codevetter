import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assessPerformanceEvidence } from './check-performance-evidence.mjs';

const sourceScripts = path.dirname(fileURLToPath(import.meta.url));
const base = 'b'.repeat(40);
const jsonPath = 'evidence/performance/source-check-2026-10-14.json';
const mdPath = 'evidence/performance/source-check-2026-10-14.md';
const manifestPath = 'evidence/performance/reviewed-artifacts-2026-10-14.json';
const json = `${JSON.stringify(
  {
    schema_version: 'codevetter.source-check/v1',
    runtime: { node: '22' },
    implementation_sha256: 'a'.repeat(64),
  },
  null,
  2
)}\n`;
const markdown = '# Source check\n\nBounded experimental evidence.\n';
const sha = (content) => createHash('sha256').update(content).digest('hex');

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'codevetter-evidence-gate-'));
  const performance = path.join(root, 'evidence', 'performance');
  mkdirSync(performance, { recursive: true });
  const write = (file, content) => writeFileSync(path.join(root, file), content);
  write(jsonPath, json);
  write(mdPath, markdown);
  const manifest = {
    schemaVersion: 1,
    reviewedBase: base,
    reviewedHead: 'c'.repeat(40),
    scope: '#348 bounded source evidence',
    artifacts: [
      { path: jsonPath, sha256: sha(json) },
      { path: mdPath, sha256: sha(markdown) },
    ],
  };
  const saveManifest = () => write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  saveManifest();
  t.after(() => {
    for (const name of readdirSync(performance)) unlinkSync(path.join(performance, name));
    rmdirSync(performance);
    rmdirSync(path.join(root, 'evidence'));
    if (readdirSync(root).includes('src')) {
      for (const name of readdirSync(path.join(root, 'src')))
        unlinkSync(path.join(root, 'src', name));
      rmdirSync(path.join(root, 'src'));
    }
    if (readdirSync(root).includes('scripts')) {
      for (const name of readdirSync(path.join(root, 'scripts')))
        unlinkSync(path.join(root, 'scripts', name));
      rmdirSync(path.join(root, 'scripts'));
    }
    // Git fixtures on non-macOS CI are under the runner's ephemeral temp root.
    if (readdirSync(root).includes('.git')) {
      if (process.platform === 'darwin') execFileSync('/usr/bin/trash', [root]);
    } else rmdirSync(root);
  });
  const changed = [jsonPath, mdPath, manifestPath];
  return { root, manifest, saveManifest, write, changed, added: [...changed] };
}

test('accepts only a complete hashed batch with separate line and byte bounds', (t) => {
  const item = fixture(t);
  const result = assessPerformanceEvidence(item.root, base, item.changed, item.added);
  assert.equal(result.passed, true);
  assert.deepEqual(result.artifacts.sort(), [jsonPath, mdPath].sort());
  assert.ok(result.lines > 0 && result.lines < 4_000);
});

test('rejects altered hashes, malformed JSON, and missing source identity', (t) => {
  const item = fixture(t);
  item.write(jsonPath, `${json}x`);
  assert.match(
    assessPerformanceEvidence(item.root, base, item.changed, item.added).reason,
    /hash differs/
  );
  item.manifest.artifacts[0].sha256 = sha(`${json}x`);
  item.saveManifest();
  assert.match(
    assessPerformanceEvidence(item.root, base, item.changed, item.added).reason,
    /Unexpected non-whitespace|JSON/
  );
  const noIdentity = `${JSON.stringify({ schema_version: 'codevetter.test/v1', runtime: {} })}\n`;
  item.write(jsonPath, noIdentity);
  item.manifest.artifacts[0].sha256 = sha(noIdentity);
  item.saveManifest();
  assert.match(
    assessPerformanceEvidence(item.root, base, item.changed, item.added).reason,
    /source identity/
  );
});

test('rejects extra, modified, renamed, symlinked, and duplicate evidence paths', (t) => {
  const item = fixture(t);
  const extra = 'evidence/performance/extra-2026-10-14.json';
  item.write(extra, json);
  assert.match(
    assessPerformanceEvidence(item.root, base, [...item.changed, extra], [...item.added, extra])
      .reason,
    /exact changed artifact set/
  );
  // Both a modification and a rename are absent from the added-path set.
  assert.match(
    assessPerformanceEvidence(item.root, base, item.changed, [mdPath, manifestPath]).reason,
    /exact changed artifact set/
  );
  assert.match(
    assessPerformanceEvidence(item.root, base, item.changed, [jsonPath, manifestPath]).reason,
    /exact changed artifact set/
  );
  item.manifest.artifacts.push(item.manifest.artifacts[0]);
  item.saveManifest();
  assert.match(
    assessPerformanceEvidence(item.root, base, item.changed, item.added).reason,
    /exact changed artifact set/
  );
  item.manifest.artifacts.pop();
  item.saveManifest();
  unlinkSync(path.join(item.root, mdPath));
  symlinkSync(path.join(item.root, jsonPath), path.join(item.root, mdPath));
  assert.match(
    assessPerformanceEvidence(item.root, base, item.changed, item.added).reason,
    /Not a regular file/
  );
});

test('rejects evidence over 4,000 lines even when every byte is hashed', (t) => {
  const item = fixture(t);
  const large = `# Source check\n${'line\n'.repeat(4_000)}`;
  item.write(mdPath, large);
  item.manifest.artifacts[1].sha256 = sha(large);
  item.saveManifest();
  assert.match(
    assessPerformanceEvidence(item.root, base, item.changed, item.added).reason,
    /line cap/
  );
});

test('rejects oversized artifact and manifest before parsing their bytes', (t) => {
  const item = fixture(t);
  const oversized = `# Source check\n${'x'.repeat(1024 * 1024)}`;
  item.write(mdPath, oversized);
  item.manifest.artifacts[1].sha256 = sha(oversized);
  item.saveManifest();
  assert.match(
    assessPerformanceEvidence(item.root, base, item.changed, item.added).reason,
    /byte cap exceeded/
  );
  item.manifest.scope = 'x'.repeat(64 * 1024);
  item.saveManifest();
  assert.match(
    assessPerformanceEvidence(item.root, base, item.changed, item.added).reason,
    /reviewed-artifacts.*byte cap exceeded|byte cap exceeded.*reviewed-artifacts/
  );
});

test('integration: source growth still fails the unchanged 4,000-line gate', (t) => {
  const item = fixture(t);
  const scripts = path.join(item.root, 'scripts');
  mkdirSync(scripts);
  for (const file of [
    'check-change-size.mjs',
    'check-performance-evidence.mjs',
    'check-unpack-batch.mjs',
  ]) {
    copyFileSync(path.join(sourceScripts, file), path.join(scripts, file));
  }
  const git = (...args) => execFileSync('git', args, { cwd: item.root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', 'scripts');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base');
  const fixtureBase = git('rev-parse', 'HEAD');
  item.manifest.reviewedBase = fixtureBase;
  const largeEvidence = `# Source check\n${'line\n'.repeat(3_500)}`;
  item.write(mdPath, largeEvidence);
  item.manifest.artifacts[1].sha256 = sha(largeEvidence);
  item.saveManifest();
  mkdirSync(path.join(item.root, 'src'));
  item.write('src/small.mjs', 'export const value = 1;\n'.repeat(600));
  git('add', 'evidence', 'src');
  const env = { ...process.env, CODE_HEALTH_BASE: fixtureBase };
  const run = () =>
    spawnSync(process.execPath, ['scripts/check-change-size.mjs'], {
      cwd: item.root,
      env,
      encoding: 'utf8',
    });
  const admitted = run();
  assert.equal(admitted.status, 0, admitted.stderr);
  assert.match(admitted.stdout, /PASS qualified performance evidence/);
  item.write('src/huge.mjs', 'export const value = 1;\n'.repeat(4_001));
  git('add', 'src');
  const rejected = run();
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /source changes exceed standard limits/);
});
