import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, readlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { isExcludedPath, repositoryRelative } from './contracts.mjs';
import { inspectChangeCost } from './change-cost.mjs';

export const SOURCE_SNAPSHOT_LIMITS = Object.freeze({
  files: 256,
  fileBytes: 8 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
});

export async function inspectGitDiff(repositoryRoot, range) {
  const root = resolve(repositoryRoot);
  if (range !== undefined && !isSafeRevisionRange(range)) {
    throw new Error('diff range must be a bounded Git revision expression and cannot be an option');
  }
  const revision = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const args = ['diff', '--relative', '--no-ext-diff', '--unified=0'];
  if (range) args.push(range);
  else args.push('HEAD');
  args.push('--');
  const result = await runGit(root, args);
  const trackedFiles = splitZero(
    (
      await runGit(root, [
        'diff',
        '--relative',
        '--name-only',
        '-z',
        ...(range ? [range] : ['HEAD']),
        '--',
      ])
    ).stdout
  );
  const untrackedFiles = splitZero(
    (await runGit(root, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout
  );
  const changedFiles = [...new Set([...trackedFiles, ...untrackedFiles])]
    .filter((path) => path !== '.codevetter' && !path.startsWith('.codevetter/'))
    .sort();
  if (changedFiles.length > SOURCE_SNAPSHOT_LIMITS.files) {
    const error = new Error('source snapshot changed-file inventory exceeds bound');
    error.code = 'SOURCE_SNAPSHOT_CHANGED_FILE_INVENTORY_EXCEEDED';
    error.snapshot = {
      repository_revision: revision,
      dirty: true,
      changed_file_count: changedFiles.length,
      changed_file_limit: SOURCE_SNAPSHOT_LIMITS.files,
    };
    throw error;
  }
  const snapshotSha256 = await fingerprintChangedFiles(root, revision, changedFiles);
  const changeCost = range ? null : await inspectChangeCost(root, changedFiles);
  return {
    repository_revision: revision,
    diff_identity: range ?? 'HEAD..worktree',
    source_snapshot_sha256: snapshotSha256,
    dirty: changedFiles.length > 0,
    changed_files: changedFiles,
    changed_lines: parseUnifiedDiff(result.stdout),
    change_cost: changeCost,
  };
}

async function fingerprintChangedFiles(root, revision, changedFiles) {
  if (changedFiles.length > SOURCE_SNAPSHOT_LIMITS.files) {
    throw new Error('source snapshot changed-file inventory exceeds bound');
  }
  const hash = createHash('sha256');
  hash.update('codevetter-source-snapshot/v1\0');
  hash.update(revision);
  hash.update('\0');
  let totalBytes = 0;
  for (const path of changedFiles) {
    if (isSensitiveSnapshotPath(path)) {
      throw new Error('source snapshot contains a sensitive path and was not read');
    }
    const absolute = resolve(root, path);
    if (repositoryRelative(root, absolute) !== path.replaceAll('\\', '/')) {
      throw new Error('source snapshot path escapes repository');
    }
    hash.update(path);
    hash.update('\0');
    let metadata;
    try {
      metadata = await lstat(absolute);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        hash.update('deleted\0');
        continue;
      }
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      const target = await readlink(absolute);
      if (repositoryRelative(root, resolve(dirname(absolute), target)) === null) {
        throw new Error('source snapshot contains an escaping symlink');
      }
      const bytes = Buffer.byteLength(target);
      totalBytes += bytes;
      assertSnapshotSize(bytes, totalBytes);
      hash.update(`symlink\0${bytes}\0${target}\0`);
      continue;
    }
    if (!metadata.isFile()) throw new Error('source snapshot contains an unsupported file kind');
    totalBytes += metadata.size;
    assertSnapshotSize(metadata.size, totalBytes);
    hash.update(`file\0${metadata.mode & 0o111}\0${metadata.size}\0`);
    await hashFile(hash, absolute);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function assertSnapshotSize(fileBytes, totalBytes) {
  if (fileBytes > SOURCE_SNAPSHOT_LIMITS.fileBytes) {
    throw new Error('source snapshot contains an oversized changed file');
  }
  if (totalBytes > SOURCE_SNAPSHOT_LIMITS.totalBytes) {
    throw new Error('source snapshot changed-file bytes exceed bound');
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

export function isSensitiveSnapshotPath(path) {
  const normalized = path.replaceAll('\\', '/').toLowerCase();
  const parts = normalized.split('/');
  const name = parts.at(-1);
  return (
    parts.includes('.ssh') ||
    parts.includes('.aws') ||
    parts.includes('.kube') ||
    /^\.env(?:\.|$)/.test(name) ||
    ['.npmrc', '.pypirc', '.netrc', 'kubeconfig', 'credentials.json'].includes(name) ||
    /(?:^|[-_.])(?:service-account|private-key)(?:[-_.]|$)/.test(name) ||
    /\.(?:key|pem|p12|pfx)$/.test(name)
  );
}

export function cleanSourceSnapshotSha256(revision) {
  if (!isSafeRevisionRange(revision)) {
    throw new Error('clean source snapshot revision is invalid');
  }
  return createHash('sha256').update(`codevetter-source-snapshot/v1\0${revision}\0`).digest('hex');
}

export async function inspectGitRevisionFiles(repositoryRoot, baselineRevision, currentRevision) {
  const root = resolve(repositoryRoot);
  if (!isSafeRevisionRange(baselineRevision) || !isSafeRevisionRange(currentRevision)) {
    throw new Error('paired revisions must be bounded Git identities');
  }
  const files = splitZero(
    (
      await runGit(root, [
        'diff',
        '--relative',
        '--name-only',
        '-z',
        '--no-renames',
        baselineRevision,
        currentRevision,
        '--',
      ])
    ).stdout
  ).filter((path) => path !== '.codevetter' && !path.startsWith('.codevetter/'));
  if (files.length > 64) throw new Error('paired revision file inventory exceeds bound');
  return [...new Set(files)].sort();
}

function splitZero(value) {
  return String(value).split('\0').filter(Boolean);
}

function isSafeRevisionRange(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !value.startsWith('-') &&
    !/[\s\\]/.test(value)
  );
}

export function parseUnifiedDiff(diff) {
  const changed = new Map();
  let currentFile = null;
  for (const line of String(diff).split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const name = line.slice(4).replace(/^b\//, '');
      currentFile = name === '/dev/null' || isExcludedPath(name) ? null : name;
      continue;
    }
    if (!currentFile || !line.startsWith('@@')) continue;
    const match = /\+(\d+)(?:,(\d+))?/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count === 0) continue;
    const lines = changed.get(currentFile) ?? new Set();
    for (let value = start; value < start + count; value += 1) lines.add(value);
    changed.set(currentFile, lines);
  }
  return changed;
}

export function rankRelevantChanges(frames, changedLines) {
  const candidates = [];
  for (const frame of frames) {
    const lines = changedLines.get(frame.file);
    if (!lines || lines.size === 0) continue;
    if (lines.has(frame.line)) {
      candidates.push({
        file: frame.file,
        line: frame.line,
        frame_line: frame.line,
        reason: 'changed_frame_intersection',
        distance: 0,
      });
      continue;
    }
    let nearest = null;
    for (const line of lines) {
      const distance = Math.abs(frame.line - line);
      if (nearest === null || distance < nearest.distance) nearest = { line, distance };
    }
    if (nearest) {
      candidates.push({
        file: frame.file,
        line: nearest.line,
        frame_line: frame.line,
        reason: 'same_changed_file_proximity',
        distance: nearest.distance,
      });
    }
  }
  candidates.sort(
    (left, right) =>
      left.distance - right.distance ||
      left.file.localeCompare(right.file) ||
      left.line - right.line
  );
  return candidates.filter(
    (candidate, index) =>
      index ===
      candidates.findIndex(
        (other) => other.file === candidate.file && other.line === candidate.line
      )
  );
}

function runGit(cwd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`git ${args[0]} failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}
