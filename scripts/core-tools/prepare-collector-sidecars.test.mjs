import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  advisoryDatabase,
  artifactsForTarget,
  assertArtifactIdentity,
  coverageLicenses,
  fetchAndVerify,
  hashDirectory,
  removeStaleTemporaryFiles,
  writeDownloadBody,
} from './prepare-collector-sidecars.mjs';

test('pins both supported macOS collector artifact sets', () => {
  for (const target of ['aarch64-apple-darwin', 'x86_64-apple-darwin']) {
    const artifacts = artifactsForTarget(target);
    assert.equal(artifacts.gitleaks.version, '8.30.1');
    assert.equal(artifacts.cargoAudit.version, '0.22.2');
    assert.equal(artifacts.cargoLlvmCov.version, '0.9.0');
    assert.match(artifacts.gitleaks.sha256, /^[a-f0-9]{64}$/);
    assert.match(artifacts.cargoAudit.sha256, /^[a-f0-9]{64}$/);
    assert.match(artifacts.cargoLlvmCov.sha256, /^[a-f0-9]{64}$/);
  }
  assert.throws(() => artifactsForTarget('aarch64-unknown-linux-gnu'), /Unsupported/);
  assert.match(advisoryDatabase.commit, /^[a-f0-9]{40}$/);
  assert.equal(
    advisoryDatabase.treeSha256,
    '902b61e08debfdd10f65807dfebc5d5603daf14879562189ff9033de758036e7'
  );
  assert.match(coverageLicenses.apache.sha256, /^[a-f0-9]{64}$/);
  assert.match(coverageLicenses.mit.sha256, /^[a-f0-9]{64}$/);
});

test('artifact digest verification fails closed', () => {
  const bytes = Buffer.from('fixture');
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(assertArtifactIdentity(bytes, digest, 'fixture'), digest);
  assert.throws(() => assertArtifactIdentity(bytes, '0'.repeat(64), 'fixture'), /mismatch/);
  assert.throws(() => assertArtifactIdentity(bytes, 'latest', 'fixture'), /invalid/);
});

test('verified archives are reused from the content-addressed build cache', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'codevetter-collector-cache-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const scratch = join(root, 'scratch');
  const cache = join(root, 'cache');
  const bytes = Buffer.from('publisher archive fixture');
  const artifact = {
    archive: 'fixture.tar.gz',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    url: 'https://example.invalid/fixture.tar.gz',
  };
  let downloads = 0;
  const fetchArchive = async (_url, destination) => {
    downloads += 1;
    writeFileSync(destination, bytes);
  };
  mkdirSync(scratch, { recursive: true });
  const first = await fetchAndVerify(artifact, scratch, cache, fetchArchive);
  assert.deepEqual(readFileSync(first), bytes);
  assert.equal(downloads, 1);

  const secondScratch = join(root, 'second');
  mkdirSync(secondScratch);
  const second = await fetchAndVerify(artifact, secondScratch, cache, fetchArchive);
  assert.deepEqual(readFileSync(second), bytes);
  assert.equal(downloads, 1);
  assert.equal(existsSync(join(cache, `${artifact.sha256}-${artifact.archive}`)), true);
});

test('download writer enforces declared and streamed byte limits without partial files', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'codevetter-collector-download-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const small = join(root, 'small.bin');
  await writeDownloadBody(
    {
      headers: new Headers({ 'content-length': '4' }),
      body: Readable.from([Buffer.from('safe')]),
    },
    small,
    4
  );
  assert.equal(readFileSync(small, 'utf8'), 'safe');

  const declaredLarge = join(root, 'declared-large.bin');
  await assert.rejects(
    writeDownloadBody(
      {
        headers: new Headers({ 'content-length': '5' }),
        body: Readable.from([Buffer.from('large')]),
      },
      declaredLarge,
      4
    ),
    /exceeds/
  );
  assert.equal(existsSync(declaredLarge), false);

  const streamedLarge = join(root, 'streamed-large.bin');
  await assert.rejects(
    writeDownloadBody(
      { headers: new Headers(), body: Readable.from([Buffer.from('ab'), Buffer.from('cde')]) },
      streamedLarge,
      4
    ),
    /exceeds/
  );
  assert.equal(existsSync(streamedLarge), false);
});

test('stale atomic-copy files are removed without touching prepared collectors', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'codevetter-collector-temp-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'gitleaks'), 'current');
  writeFileSync(join(root, 'gitleaks.123.456.tmp'), 'stale');
  writeFileSync(join(root, 'unrelated.txt'), 'keep');
  removeStaleTemporaryFiles(root);
  assert.equal(readFileSync(join(root, 'gitleaks'), 'utf8'), 'current');
  assert.equal(existsSync(join(root, 'gitleaks.123.456.tmp')), false);
  assert.equal(readFileSync(join(root, 'unrelated.txt'), 'utf8'), 'keep');
});

test('RustSec tree identity is deterministic and rejects symlinks', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'codevetter-rustsec-tree-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'crates'));
  writeFileSync(join(root, 'crates', 'fixture.toml'), "id='fixture'\n");
  const identity = hashDirectory(root);
  assert.deepEqual(identity, hashDirectory(root));
  assert.equal(identity.sha256, '0d0f9df93274d31a49a4c819d75a33eeb790589021e388626f141c57d92528a3');

  if (process.platform !== 'win32') {
    symlinkSync(join(root, 'crates', 'fixture.toml'), join(root, 'crates', 'linked.toml'));
    assert.throws(() => hashDirectory(root), /must not contain symlinks/);
  }
});
