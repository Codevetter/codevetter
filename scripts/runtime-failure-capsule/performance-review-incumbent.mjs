import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { repositoryRelative } from './contracts.mjs';
import { ensureCodeVetterEvidenceRoot } from './evidence-root.mjs';
import { isSensitiveSnapshotPath } from './git-diff.mjs';

const TREE_LIMITS = Object.freeze({
  files: 20_000,
  fileBytes: 64 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  listingBytes: 4 * 1024 * 1024,
  stderrBytes: 64 * 1024,
  timeoutMs: 60_000,
  sensitivePaths: 32,
});

export async function materializeCleanGitIncumbent(
  repositoryRoot,
  revision,
  { excludeSensitivePaths = false } = {}
) {
  const root = await realpath(resolve(repositoryRoot));
  assertRevision(revision);
  const listing = await runCaptured('git', ['ls-tree', '-r', '-z', '-l', '--full-tree', revision], {
    cwd: root,
    timeoutMs: 10_000,
    maximumStdoutBytes: TREE_LIMITS.listingBytes,
  });
  const tree = parseTreeListing(listing.stdout, { excludeSensitivePaths });
  const evidence = await ensureCodeVetterEvidenceRoot(root);
  const evidenceRoot = await realpath(evidence.directory);
  if (repositoryRelative(root, evidenceRoot) !== '.codevetter') {
    throw new Error('clean incumbent evidence root escapes repository');
  }
  const temporary = await mkdtemp(join(evidenceRoot, 'review-incumbent-'));
  const resolvedTemporary = await realpath(temporary);
  const checkout = join(temporary, 'checkout');
  await mkdir(checkout);
  try {
    await extractArchive(root, revision, checkout, tree.excludedSensitivePaths);
    const resolvedCheckout = await realpath(checkout);
    if (repositoryRelative(resolvedTemporary, resolvedCheckout) !== 'checkout') {
      throw new Error('materialized incumbent escapes owned temporary storage');
    }
    const fingerprint = await fingerprintMaterializedTree(resolvedCheckout);
    if (fingerprint.files !== tree.files || fingerprint.bytes !== tree.bytes) {
      throw new Error('materialized incumbent tree differs from Git inventory');
    }
    let disposed = false;
    const dependencyGrafts = new Map();
    return {
      root: resolvedCheckout,
      revision,
      fingerprint: fingerprint.sha256,
      files: fingerprint.files,
      bytes: fingerprint.bytes,
      sensitivePathExclusions: sensitivePathExclusionProvenance(tree.excludedSensitivePaths),
      async graftNodeDependencies(dependencyRepositoryRoot, targets) {
        if (disposed) throw new Error('materialized incumbent is already disposed');
        const dependencyRoot = await realpath(resolve(dependencyRepositoryRoot));
        const directories = dependencyAncestorDirectories(targets);
        for (const directory of directories) {
          const relativePath = directory === '.' ? 'node_modules' : `${directory}/node_modules`;
          if (dependencyGrafts.has(relativePath)) continue;
          const source = join(dependencyRoot, relativePath);
          let sourceMetadata;
          try {
            sourceMetadata = await lstat(source);
          } catch (error) {
            if (error?.code === 'ENOENT') continue;
            throw error;
          }
          if (!sourceMetadata.isDirectory() && !sourceMetadata.isSymbolicLink()) {
            throw new Error('current Node dependency graft is not a directory');
          }
          const resolvedSource = await realpath(source);
          const targetMetadata = await lstat(resolvedSource);
          const sourceRelative = repositoryRelative(dependencyRoot, resolvedSource);
          if (sourceRelative === null || !sourceRelative.split('/').includes('node_modules')) {
            throw new Error('current Node dependency graft escapes repository dependencies');
          }
          await assertNoDirectWorkspaceDependencyLinks(source, dependencyRoot);

          const destination = join(resolvedCheckout, relativePath);
          try {
            await lstat(destination);
            throw new Error('materialized incumbent already contains a Node dependency path');
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
          }
          const destinationParent = await realpath(dirname(destination));
          const parentRelative = repositoryRelative(resolvedCheckout, destinationParent);
          if (directory !== '.' && parentRelative !== directory) {
            throw new Error('materialized Node dependency graft parent differs');
          }
          await symlink(resolvedSource, destination, 'dir');
          dependencyGrafts.set(relativePath, {
            target: resolvedSource,
            dev: targetMetadata.dev,
            ino: targetMetadata.ino,
          });
        }
        return [...dependencyGrafts.keys()].sort();
      },
      dependencyProvenance() {
        if (disposed) throw new Error('materialized incumbent is already disposed');
        return dependencyGraftProvenance(dependencyGrafts);
      },
      async assertUnchanged() {
        if (disposed) throw new Error('materialized incumbent is already disposed');
        await assertDependencyGraftsUnchanged(resolvedCheckout, dependencyGrafts);
        const current = await fingerprintMaterializedTree(resolvedCheckout, dependencyGrafts);
        if (
          current.sha256 !== fingerprint.sha256 ||
          current.files !== fingerprint.files ||
          current.bytes !== fingerprint.bytes
        ) {
          throw new Error(
            `materialized incumbent changed during paired review${describeTreeChange(fingerprint, current)}`
          );
        }
      },
      async dispose() {
        if (disposed) return 'already_removed';
        disposed = true;
        await rm(temporary, { recursive: true, force: true });
        return 'removed';
      },
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function dependencyGraftProvenance(dependencyGrafts) {
  const grafts = [...dependencyGrafts.keys()].sort();
  const hash = createHash('sha256');
  hash.update('codevetter-node-dependency-grafts/v1\0');
  for (const relativePath of grafts) {
    const identity = dependencyGrafts.get(relativePath);
    hash.update(`${relativePath}\0${identity.dev}\0${identity.ino}\0`);
  }
  return {
    graft_count: grafts.length,
    grafts,
    graft_sha256: hash.digest('hex'),
  };
}

export function parseTreeListing(source, { excludeSensitivePaths = false } = {}) {
  const entries = String(source).split('\0').filter(Boolean);
  if (entries.length > TREE_LIMITS.files) {
    throw new Error('clean incumbent Git tree file inventory exceeds bound');
  }
  let totalBytes = 0;
  let retainedFiles = 0;
  const excludedSensitivePaths = [];
  for (const entry of entries) {
    const separator = entry.indexOf('\t');
    if (separator <= 0) throw new Error('clean incumbent Git tree entry is malformed');
    const [mode, type, object, sizeText] = entry.slice(0, separator).split(/ +/);
    const path = entry.slice(separator + 1);
    if (!['100644', '100755'].includes(mode) || type !== 'blob') {
      throw new Error(
        'clean incumbent Git tree contains a symlink, gitlink, or unsupported object'
      );
    }
    if (!/^[0-9a-f]{40,64}$/.test(object ?? '') || !/^\d+$/.test(sizeText ?? '')) {
      throw new Error('clean incumbent Git tree object identity is invalid');
    }
    assertSafePath(path);
    if (isSensitiveSnapshotPath(path)) {
      if (!excludeSensitivePaths) {
        throw new Error('clean incumbent Git tree contains a sensitive path');
      }
      excludedSensitivePaths.push(path);
      if (excludedSensitivePaths.length > TREE_LIMITS.sensitivePaths) {
        throw new Error('clean incumbent sensitive-path exclusions exceed bound');
      }
      continue;
    }
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size > TREE_LIMITS.fileBytes) {
      throw new Error('clean incumbent Git tree contains an oversized file');
    }
    totalBytes += size;
    retainedFiles += 1;
    if (totalBytes > TREE_LIMITS.totalBytes) {
      throw new Error('clean incumbent Git tree bytes exceed bound');
    }
  }
  return { files: retainedFiles, bytes: totalBytes, excludedSensitivePaths };
}

async function extractArchive(root, revision, destination, excludedSensitivePaths = []) {
  const pathspecs = excludedSensitivePaths.map((path) => `:(exclude,top,literal)${path}`);
  const archive = spawn('git', ['archive', '--format=tar', revision, '--', '.', ...pathspecs], {
    cwd: root,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const extractor = spawn('tar', ['-x', '-f', '-', '-C', destination], {
    cwd: destination,
    shell: false,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  archive.stdout.pipe(extractor.stdin);
  const [archiveResult, extractResult] = await Promise.all([
    waitForProcess(archive, 'git archive'),
    waitForProcess(extractor, 'tar extraction'),
  ]);
  if (archiveResult.code !== 0) {
    throw new Error(
      `clean incumbent git archive failed: ${archiveResult.stderr || 'non-zero exit'}`
    );
  }
  if (extractResult.code !== 0) {
    throw new Error(
      `clean incumbent tar extraction failed: ${extractResult.stderr || 'non-zero exit'}`
    );
  }
}

function sensitivePathExclusionProvenance(paths) {
  const hash = createHash('sha256');
  hash.update('codevetter-sensitive-path-exclusions/v1\0');
  for (const path of [...paths].sort()) hash.update(`${path}\0`);
  return {
    excluded_sensitive_path_count: paths.length,
    excluded_sensitive_paths_sha256: hash.digest('hex'),
  };
}

function waitForProcess(child, label) {
  return new Promise((resolvePromise, reject) => {
    const stderr = boundedCollector(TREE_LIMITS.stderrBytes);
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${label} timed out`));
    }, TREE_LIMITS.timeoutMs);
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolvePromise({ code, stderr: stderr.text() });
    });
  });
}

async function runCaptured(program, args, { cwd, timeoutMs, maximumStdoutBytes }) {
  const child = spawn(program, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = boundedCollector(maximumStdoutBytes);
  const stderr = boundedCollector(TREE_LIMITS.stderrBytes);
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${program} ${args[0]} timed out`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (stdout.truncated() || stderr.truncated()) {
        reject(new Error(`${program} ${args[0]} output exceeds bound`));
      } else if (code !== 0) {
        reject(new Error(`${program} ${args[0]} failed: ${stderr.text() || `exit ${code}`}`));
      } else {
        resolvePromise({ stdout: stdout.text(), stderr: stderr.text() });
      }
    });
  });
}

async function fingerprintMaterializedTree(root, dependencyGrafts = new Map()) {
  const files = [];
  const pending = [''];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(join(root, directory), { withFileTypes: true });
    for (const entry of entries) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      assertSafePath(path);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile()) {
        files.push(path);
      } else if (entry.isSymbolicLink() && dependencyGrafts.has(path)) {
        // Dependency grafts are verified separately and excluded from the Git tree fingerprint.
      } else {
        throw new Error('materialized incumbent contains an unsupported file kind');
      }
      if (files.length + pending.length > TREE_LIMITS.files) {
        throw new Error('materialized incumbent file inventory exceeds bound');
      }
    }
  }
  files.sort();
  const hash = createHash('sha256');
  hash.update('codevetter-materialized-incumbent/v1\0');
  let bytes = 0;
  for (const path of files) {
    if (isSensitiveSnapshotPath(path)) {
      throw new Error('materialized incumbent contains a sensitive path');
    }
    const absolute = join(root, path);
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.size > TREE_LIMITS.fileBytes) {
      throw new Error('materialized incumbent contains an unsafe file');
    }
    bytes += metadata.size;
    if (bytes > TREE_LIMITS.totalBytes) {
      throw new Error('materialized incumbent bytes exceed bound');
    }
    hash.update(`${path}\0${metadata.mode & 0o111}\0${metadata.size}\0`);
    await hashFile(hash, absolute);
    hash.update('\0');
  }
  return { sha256: hash.digest('hex'), files: files.length, bytes, paths: files };
}

function describeTreeChange(expected, current) {
  const before = new Set(expected.paths ?? []);
  const after = new Set(current.paths ?? []);
  const added = [...after]
    .filter((path) => !before.has(path))
    .sort()
    .slice(0, 4);
  const removed = [...before]
    .filter((path) => !after.has(path))
    .sort()
    .slice(0, 4);
  const parts = [];
  if (added.length > 0) parts.push(`added ${added.join(', ')}`);
  if (removed.length > 0) parts.push(`removed ${removed.join(', ')}`);
  if (parts.length === 0) parts.push('tracked file contents changed');
  return `: ${parts.join('; ')}`;
}

function dependencyAncestorDirectories(targets) {
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > 8) {
    throw new Error('Node dependency graft targets are invalid');
  }
  const directories = new Set(['.']);
  for (const target of targets) {
    assertSafePath(target);
    let directory = dirname(target).split('\\').join('/');
    while (directory !== '.') {
      directories.add(directory);
      directory = dirname(directory).split('\\').join('/');
    }
  }
  return [...directories].sort((left, right) => right.split('/').length - left.split('/').length);
}

async function assertNoDirectWorkspaceDependencyLinks(nodeModules, repositoryRoot) {
  const entries = await readdir(nodeModules, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.pnpm') continue;
    const path = join(nodeModules, entry.name);
    await assertDependencyEntryContained(path, repositoryRoot);
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      const scoped = await readdir(path, { withFileTypes: true });
      for (const child of scoped) {
        await assertDependencyEntryContained(join(path, child.name), repositoryRoot);
      }
    }
  }
}

async function assertDependencyEntryContained(path, repositoryRoot) {
  const metadata = await lstat(path);
  if (!metadata.isSymbolicLink()) return;
  const resolved = await realpath(path);
  const relativePath = repositoryRelative(repositoryRoot, resolved);
  if (relativePath === null || !relativePath.split('/').includes('node_modules')) {
    throw new Error('current Node dependency tree links to mutable workspace source');
  }
}

async function assertDependencyGraftsUnchanged(root, dependencyGrafts) {
  for (const [relativePath, expected] of dependencyGrafts) {
    const path = join(root, relativePath);
    const metadata = await lstat(path);
    if (!metadata.isSymbolicLink() || (await realpath(path)) !== expected.target) {
      throw new Error('materialized incumbent Node dependency graft changed');
    }
    const targetMetadata = await lstat(expected.target);
    if (targetMetadata.dev !== expected.dev || targetMetadata.ino !== expected.ino) {
      throw new Error('current Node dependency graft identity changed');
    }
  }
}

function hashFile(hash, path) {
  return new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolvePromise);
  });
}

function boundedCollector(maximumBytes) {
  const chunks = [];
  let bytes = 0;
  let wasTruncated = false;
  return {
    push(chunk) {
      const value = Buffer.from(chunk);
      const remaining = maximumBytes - bytes;
      if (remaining > 0) chunks.push(value.subarray(0, remaining));
      bytes += value.length;
      if (bytes > maximumBytes) wasTruncated = true;
    },
    text: () => Buffer.concat(chunks).toString('utf8').trim(),
    truncated: () => wasTruncated,
  };
}

function assertRevision(value) {
  if (!/^[0-9a-f]{40,64}$/.test(value ?? '')) {
    throw new Error('clean incumbent revision is invalid');
  }
}

function assertSafePath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    /[\0\r\n]/.test(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error('clean incumbent Git tree path is unsafe');
  }
}
