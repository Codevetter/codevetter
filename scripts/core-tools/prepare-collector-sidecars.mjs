import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coreRoot = join(repositoryRoot, 'crates/codevetter-core');
const releaseRoot = 'https://github.com';
const maxDownloadBytes = 128 * 1024 * 1024;

export const advisoryDatabase = Object.freeze({
  commit: '5a0ebedfe8bdd2e295b171f4162f8c977bcad9a5',
  sha256: 'b139452940da08da4428041130c80a30303a8b838901da7ab764972dc8350fe0',
  treeSha256: '902b61e08debfdd10f65807dfebc5d5603daf14879562189ff9033de758036e7',
  url: `${releaseRoot}/RustSec/advisory-db/archive/5a0ebedfe8bdd2e295b171f4162f8c977bcad9a5.tar.gz`,
});

export const coverageLicenses = Object.freeze({
  apache: {
    archive: 'cargo-llvm-cov-LICENSE-APACHE',
    sha256: '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594',
    url: 'https://raw.githubusercontent.com/taiki-e/cargo-llvm-cov/v0.9.0/LICENSE-APACHE',
  },
  mit: {
    archive: 'cargo-llvm-cov-LICENSE-MIT',
    sha256: '23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3',
    url: 'https://raw.githubusercontent.com/taiki-e/cargo-llvm-cov/v0.9.0/LICENSE-MIT',
  },
});

const targets = Object.freeze({
  'aarch64-apple-darwin': {
    gitleaks: {
      version: '8.30.1',
      sha256: 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
      archive: 'gitleaks_8.30.1_darwin_arm64.tar.gz',
      url: `${releaseRoot}/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_darwin_arm64.tar.gz`,
    },
    cargoAudit: {
      version: '0.22.2',
      sha256: 'ec7ca4263769593df4d909be85b94a6b79efa2897be5d2bb8ebd516e823175af',
      archive: 'cargo-audit-aarch64-apple-darwin-v0.22.2.tgz',
      url: `${releaseRoot}/rustsec/rustsec/releases/download/cargo-audit/v0.22.2/cargo-audit-aarch64-apple-darwin-v0.22.2.tgz`,
    },
    cargoLlvmCov: {
      version: '0.9.0',
      sha256: '1bbf5dc8ad82e0f6ff0eb923aa6a691c760adb60f797cdcb454e204b9399c4f0',
      archive: 'cargo-llvm-cov-aarch64-apple-darwin.tar.gz',
      url: `${releaseRoot}/taiki-e/cargo-llvm-cov/releases/download/v0.9.0/cargo-llvm-cov-aarch64-apple-darwin.tar.gz`,
    },
  },
  'x86_64-apple-darwin': {
    gitleaks: {
      version: '8.30.1',
      sha256: 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
      archive: 'gitleaks_8.30.1_darwin_x64.tar.gz',
      url: `${releaseRoot}/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_darwin_x64.tar.gz`,
    },
    cargoAudit: {
      version: '0.22.2',
      sha256: '847831323de932155b226ab60ee4a180e13e5d007a019f0d4b7b4d89a6de2ab2',
      archive: 'cargo-audit-x86_64-apple-darwin-v0.22.2.tgz',
      url: `${releaseRoot}/rustsec/rustsec/releases/download/cargo-audit/v0.22.2/cargo-audit-x86_64-apple-darwin-v0.22.2.tgz`,
    },
    cargoLlvmCov: {
      version: '0.9.0',
      sha256: '4595bc9310b009913570514eb0ff7c3aba74902562578038f1700d611783fdc2',
      archive: 'cargo-llvm-cov-x86_64-apple-darwin.tar.gz',
      url: `${releaseRoot}/taiki-e/cargo-llvm-cov/releases/download/v0.9.0/cargo-llvm-cov-x86_64-apple-darwin.tar.gz`,
    },
  },
});

export function artifactsForTarget(target) {
  const artifacts = targets[target];
  if (!artifacts) throw new Error(`Unsupported collector sidecar target: ${target}`);
  return structuredClone(artifacts);
}

export function assertArtifactIdentity(bytes, expected, label) {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error(`${label} has an invalid pinned digest`);
  const observed = createHash('sha256').update(bytes).digest('hex');
  if (observed !== expected) {
    throw new Error(`${label} digest mismatch: expected ${expected}, received ${observed}`);
  }
  return observed;
}

export async function prepareCollectorSidecars({
  target = process.env.CODEVETTER_TARGET_TRIPLE ?? rustHostTarget(),
  binaryRoot = join(coreRoot, 'resources/collectors'),
  resourceRoot = join(coreRoot, 'resources/rustsec-advisory-db/snapshot'),
  cacheRoot = join(coreRoot, 'target/codevetter-collector-archives'),
  fetchArchive = download,
} = {}) {
  if (!target.endsWith('-apple-darwin')) {
    process.stdout.write(`Collector sidecars are macOS-only; skipped ${target}\n`);
    return { skipped: true, target };
  }
  const artifacts = artifactsForTarget(target);
  mkdirSync(binaryRoot, { recursive: true });
  removeStaleTemporaryFiles(binaryRoot);
  mkdirSync(cacheRoot, { recursive: true });
  removeStaleTemporaryFiles(cacheRoot);
  const scratch = mkdtempSync(join(tmpdir(), 'codevetter-collector-sidecars-'));
  try {
    const gitleaksArchive = await fetchAndVerify(
      artifacts.gitleaks,
      scratch,
      cacheRoot,
      fetchArchive
    );
    const auditArchive = await fetchAndVerify(
      artifacts.cargoAudit,
      scratch,
      cacheRoot,
      fetchArchive
    );
    const coverageArchive = await fetchAndVerify(
      artifacts.cargoLlvmCov,
      scratch,
      cacheRoot,
      fetchArchive
    );
    const databaseArchive = await fetchAndVerify(
      { ...advisoryDatabase, archive: 'rustsec-advisory-db.tar.gz' },
      scratch,
      cacheRoot,
      fetchArchive
    );
    const coverageApacheLicense = await fetchAndVerify(
      coverageLicenses.apache,
      scratch,
      cacheRoot,
      fetchArchive
    );
    const coverageMitLicense = await fetchAndVerify(
      coverageLicenses.mit,
      scratch,
      cacheRoot,
      fetchArchive
    );
    const gitleaksDirectory = join(scratch, 'gitleaks');
    const auditDirectory = join(scratch, 'cargo-audit');
    const coverageDirectory = join(scratch, 'cargo-llvm-cov');
    const databaseDirectory = join(scratch, 'advisory-db');
    for (const directory of [
      gitleaksDirectory,
      auditDirectory,
      coverageDirectory,
      databaseDirectory,
    ]) {
      mkdirSync(directory, { recursive: true });
    }
    execFileSync('tar', ['-xzf', gitleaksArchive, '-C', gitleaksDirectory]);
    execFileSync('tar', ['-xzf', auditArchive, '-C', auditDirectory]);
    execFileSync('tar', ['-xzf', coverageArchive, '-C', coverageDirectory]);
    execFileSync('tar', ['-xzf', databaseArchive, '-C', databaseDirectory]);

    const gitleaksBinary = findFile(gitleaksDirectory, 'gitleaks');
    const auditBinary = findFile(auditDirectory, 'cargo-audit');
    const coverageBinary = findFile(coverageDirectory, 'cargo-llvm-cov');
    if (!gitleaksBinary || !auditBinary || !coverageBinary) {
      throw new Error('Collector archive omitted its expected executable');
    }
    assertLicense(join(gitleaksDirectory, 'LICENSE'), 'MIT License');
    const auditLicenseRoot = dirname(auditBinary);
    assertLicense(join(auditLicenseRoot, 'LICENSE-APACHE'), 'Apache License');
    assertLicense(join(auditLicenseRoot, 'LICENSE-MIT'), 'Permission is hereby granted');
    assertLicense(coverageApacheLicense, 'Apache License');
    assertLicense(coverageMitLicense, 'Permission is hereby granted');
    removePreparedCollectors(binaryRoot);
    const preparedGitleaks = atomicCopy(gitleaksBinary, join(binaryRoot, 'gitleaks'));
    const preparedAudit = atomicCopy(auditBinary, join(binaryRoot, 'cargo-audit'));
    const preparedCoverage = atomicCopy(coverageBinary, join(binaryRoot, 'cargo-llvm-cov'));

    const databaseSource = singleDirectory(databaseDirectory);
    const preparedDatabase = join(scratch, 'prepared-advisory-db');
    cpSync(databaseSource, preparedDatabase, { recursive: true, dereference: false });
    writeFileSync(
      join(preparedDatabase, 'CODEVETTER_DB_IDENTITY.json'),
      `${JSON.stringify(
        {
          schema_version: 'codevetter.rustsec-db/v1',
          commit: advisoryDatabase.commit,
          sha256: advisoryDatabase.sha256,
          url: advisoryDatabase.url,
        },
        null,
        2
      )}\n`
    );
    if (!existsSync(join(preparedDatabase, 'crates'))) {
      throw new Error('Prepared RustSec database omitted the crates catalog');
    }
    const databaseIdentity = hashDirectory(preparedDatabase);
    if (databaseIdentity.sha256 !== advisoryDatabase.treeSha256) {
      throw new Error(
        `Prepared RustSec database tree mismatch: expected ${advisoryDatabase.treeSha256}, received ${databaseIdentity.sha256}`
      );
    }
    rmSync(resourceRoot, { recursive: true, force: true });
    cpSync(preparedDatabase, resourceRoot, { recursive: true, dereference: false });

    const gitleaksVersion = execute(preparedGitleaks, ['version']);
    const auditVersion = execute(preparedAudit, ['--version']);
    const coverageVersion = execute(preparedCoverage, ['llvm-cov', '--version']);
    if (!gitleaksVersion.includes(artifacts.gitleaks.version)) {
      throw new Error(`Prepared gitleaks version mismatch: ${gitleaksVersion}`);
    }
    if (!auditVersion.includes(artifacts.cargoAudit.version)) {
      throw new Error(`Prepared cargo-audit version mismatch: ${auditVersion}`);
    }
    if (!coverageVersion.includes(artifacts.cargoLlvmCov.version)) {
      throw new Error(`Prepared cargo-llvm-cov version mismatch: ${coverageVersion}`);
    }
    const result = {
      target,
      licenses: {
        gitleaks: 'MIT',
        cargo_audit: 'Apache-2.0 OR MIT',
        cargo_llvm_cov: 'Apache-2.0 OR MIT',
      },
      gitleaks: artifact(preparedGitleaks, artifacts.gitleaks),
      cargoAudit: artifact(preparedAudit, artifacts.cargoAudit),
      cargoLlvmCov: artifact(preparedCoverage, artifacts.cargoLlvmCov),
      advisoryDatabase: {
        commit: advisoryDatabase.commit,
        archive_sha256: advisoryDatabase.sha256,
        tree_sha256: databaseIdentity.sha256,
        file_count: databaseIdentity.fileCount,
        bytes: databaseIdentity.bytes,
      },
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function fetchAndVerify(artifact, scratch, cacheRoot, fetchArchive) {
  const destination = join(scratch, artifact.archive);
  const cached = join(cacheRoot, `${artifact.sha256}-${artifact.archive}`);
  mkdirSync(cacheRoot, { recursive: true });
  if (existsSync(cached)) {
    try {
      assertArtifactIdentity(readFileSync(cached), artifact.sha256, artifact.archive);
      copyFileSync(cached, destination);
      return destination;
    } catch {
      rmSync(cached, { force: true });
    }
  }
  await fetchArchive(artifact.url, destination);
  assertArtifactIdentity(readFileSync(destination), artifact.sha256, artifact.archive);
  atomicCacheCopy(destination, cached);
  return destination;
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body)
    throw new Error(`Download failed (${response.status}): ${url}`);
  await writeDownloadBody(response, destination);
}

export async function writeDownloadBody(response, destination, byteLimit = maxDownloadBytes) {
  const declaredBytes = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > byteLimit) {
    throw new Error(`Collector download exceeds the ${byteLimit} byte limit`);
  }
  let receivedBytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > byteLimit) {
        callback(new Error(`Collector download exceeds the ${byteLimit} byte limit`));
      } else {
        callback(null, chunk);
      }
    },
  });
  try {
    await pipeline(response.body, limiter, createWriteStream(destination, { flags: 'wx' }));
  } catch (error) {
    rmSync(destination, { force: true });
    throw error;
  }
}

function atomicCopy(source, destination) {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    cpSync(source, temporary);
    chmodSync(temporary, 0o755);
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
  return destination;
}

function atomicCacheCopy(source, destination) {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    copyFileSync(source, temporary);
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function removeStaleTemporaryFiles(root) {
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    if (name.endsWith('.tmp')) rmSync(join(root, name), { force: true });
  }
}

export function hashDirectory(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const candidate = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error('Prepared RustSec advisory database must not contain symlinks');
      }
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile()) files.push(candidate);
    }
  };
  visit(root);
  // Rust's PathBuf ordering is byte-lexicographic for these ASCII archive
  // paths. Default JS string ordering matches it; locale collation does not.
  files.sort();
  if (files.length > 5_000) {
    throw new Error('Prepared RustSec advisory database exceeds the file-count bound');
  }
  const digest = createHash('sha256');
  let bytes = 0;
  for (const file of files) {
    const contents = readFileSync(file);
    bytes += contents.length;
    if (bytes > 64 * 1024 * 1024) {
      throw new Error('Prepared RustSec advisory database exceeds the byte bound');
    }
    digest.update(file.slice(root.length + 1));
    digest.update(Buffer.from([0]));
    digest.update(contents);
  }
  return { sha256: digest.digest('hex'), fileCount: files.length, bytes };
}

function removePreparedCollectors(root) {
  for (const name of readdirSync(root)) {
    if (
      name === 'gitleaks' ||
      name.startsWith('gitleaks-') ||
      name === 'cargo-audit' ||
      name.startsWith('cargo-audit-') ||
      name === 'cargo-llvm-cov' ||
      name.startsWith('cargo-llvm-cov-')
    ) {
      rmSync(join(root, name), { force: true });
    }
  }
}

function assertLicense(source, marker) {
  if (!readFileSync(source, 'utf8').includes(marker)) {
    throw new Error(`Collector archive license check failed: ${basename(source)}`);
  }
}

function findFile(root, name) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidate = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(candidate, name);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name === name) {
      return candidate;
    }
  }
  return null;
}

function singleDirectory(root) {
  const entries = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) throw new Error('Collector archive must contain one root directory');
  return join(root, entries[0].name);
}

function execute(binary, arguments_) {
  return execFileSync(binary, arguments_, {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function artifact(source, pinned) {
  const stats = statSync(source);
  if (!stats.isFile() || stats.size === 0) throw new Error(`Prepared artifact is empty: ${source}`);
  const bytes = readFileSync(source);
  return {
    version: pinned.version,
    bytes: stats.size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function rustHostTarget() {
  const target = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
    .split('\n')
    .find((line) => line.startsWith('host: '))
    ?.slice('host: '.length);
  if (!target) throw new Error('Could not determine the Rust host target for collectors');
  return target;
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await prepareCollectorSidecars();
