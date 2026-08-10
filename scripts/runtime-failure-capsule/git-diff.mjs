import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { isExcludedPath } from './contracts.mjs';

export async function inspectGitDiff(repositoryRoot, range) {
  const root = resolve(repositoryRoot);
  if (range !== undefined && !isSafeRevisionRange(range)) {
    throw new Error('diff range must be a bounded Git revision expression and cannot be an option');
  }
  const revision = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const dirty =
    (await runGit(root, ['status', '--porcelain=v1', '--untracked-files=normal'])).stdout.trim()
      .length > 0;
  const args = ['diff', '--no-ext-diff', '--unified=0'];
  if (range) args.push(range);
  else args.push('HEAD');
  args.push('--');
  const result = await runGit(root, args);
  return {
    repository_revision: revision,
    diff_identity: range ?? 'HEAD..worktree',
    dirty,
    changed_lines: parseUnifiedDiff(result.stdout),
  };
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
