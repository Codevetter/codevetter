import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { repositoryRelative } from './contracts.mjs';

export const CHANGE_COST_POLICY = Object.freeze({
  max_files_changed: 3,
  max_lines_added: 160,
  max_gross_lines_changed: 200,
  max_production_dependencies_added: 0,
});

const DEPENDENCY_MANIFESTS = new Set(['package.json', 'go.mod']);
const DEPENDENCY_LIMIT = 32;

export async function inspectChangeCost(repositoryRoot, changedFiles, baseRevision = 'HEAD') {
  const root = resolve(repositoryRoot);
  const numstat = parseNumstat(
    (await git(root, ['diff', '--numstat', '--no-renames', baseRevision, '--'])).stdout
  );
  const untracked = changedFiles.filter((path) => !numstat.has(path));
  const binaryFiles = [...numstat].filter(([, value]) => value.binary).map(([path]) => path);
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const value of numstat.values()) {
    linesAdded += value.added;
    linesRemoved += value.removed;
  }
  for (const path of untracked) {
    const counted = await countTextLines(root, path);
    if (counted === null) binaryFiles.push(path);
    else linesAdded += counted;
  }
  const dependencies = await addedProductionDependencies(root, changedFiles, baseRevision);
  return {
    complete: true,
    files_changed: changedFiles.length,
    changed_files: [...changedFiles],
    lines_added: linesAdded,
    lines_removed: linesRemoved,
    gross_lines_changed: linesAdded + linesRemoved,
    net_lines_changed: linesAdded - linesRemoved,
    untracked_files: untracked,
    binary_files: [...new Set(binaryFiles)].sort(),
    production_dependencies_added: dependencies,
  };
}

export function assessChangeCost(changeCost, { allowedFiles, policy = {} } = {}) {
  const resolvedPolicy = { ...CHANGE_COST_POLICY, ...policy };
  if (!changeCost?.complete) {
    return { observed: changeCost ?? null, policy: resolvedPolicy, violations: ['incomplete'] };
  }
  const outsideBoundary = Array.isArray(allowedFiles)
    ? changeCost.changed_files.filter(
        (path) =>
          !allowedFiles.some((allowed) => path === allowed || path.startsWith(`${allowed}/`))
      )
    : [];
  const violations = [
    ...(outsideBoundary.length ? ['source_boundary'] : []),
    ...(changeCost.files_changed > resolvedPolicy.max_files_changed ? ['files_changed'] : []),
    ...(changeCost.lines_added > resolvedPolicy.max_lines_added ? ['lines_added'] : []),
    ...(changeCost.gross_lines_changed > resolvedPolicy.max_gross_lines_changed
      ? ['gross_lines_changed']
      : []),
    ...(changeCost.production_dependencies_added.length >
    resolvedPolicy.max_production_dependencies_added
      ? ['production_dependencies_added']
      : []),
  ];
  return {
    observed: changeCost,
    policy: resolvedPolicy,
    violations,
    outside_boundary_files: outsideBoundary,
  };
}

function parseNumstat(value) {
  const entries = new Map();
  for (const line of String(value).split('\n')) {
    if (!line) continue;
    const [added, removed, path] = line.split('\t');
    if (!path) continue;
    entries.set(path, {
      added: added === '-' ? 0 : Number(added),
      removed: removed === '-' ? 0 : Number(removed),
      binary: added === '-' || removed === '-',
    });
  }
  return entries;
}

async function countTextLines(root, path) {
  const absolute = resolve(root, path);
  if (repositoryRelative(root, absolute) !== path.replaceAll('\\', '/')) return null;
  const content = await readFile(absolute);
  if (content.includes(0)) return null;
  if (content.length === 0) return 0;
  let lines = content.at(-1) === 10 ? 0 : 1;
  for (const byte of content) if (byte === 10) lines += 1;
  return lines;
}

async function addedProductionDependencies(root, changedFiles, baseRevision) {
  const manifests = changedFiles.filter((path) => DEPENDENCY_MANIFESTS.has(basename(path)));
  if (manifests.length === 0) return [];
  const prefix = (await git(root, ['rev-parse', '--show-prefix'])).stdout.trim();
  const additions = [];
  for (const path of manifests) {
    const [before, after] = await Promise.all([
      git(root, ['show', `${baseRevision}:${prefix}${path}`], true).then((result) => result.stdout),
      readFile(resolve(root, path), 'utf8').catch(() => ''),
    ]);
    const previous = manifestDependencies(path, before);
    for (const dependency of manifestDependencies(path, after)) {
      if (!previous.has(dependency)) additions.push(dependency);
    }
  }
  return [...new Set(additions)].sort().slice(0, DEPENDENCY_LIMIT);
}

function manifestDependencies(path, source) {
  if (basename(path) === 'package.json') {
    try {
      const value = JSON.parse(source || '{}');
      return new Set(
        [
          ...Object.keys(value.dependencies ?? {}),
          ...Object.keys(value.optionalDependencies ?? {}),
        ].map((name) => `npm:${name}`)
      );
    } catch {
      return new Set();
    }
  }
  const dependencies = [];
  let inRequireBlock = false;
  for (const raw of String(source).split('\n')) {
    const line = raw.trim();
    if (line === 'require (') {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line === ')') {
      inRequireBlock = false;
      continue;
    }
    const match = (inRequireBlock ? line : line.replace(/^require\s+/, '')).match(
      /^([^\s]+)\s+v[^\s]+(?:\s+\/\/\s+indirect)?$/
    );
    if (match && !line.includes('// indirect')) dependencies.push(`go:${match[1]}`);
  }
  return new Set(dependencies);
}

function git(cwd, args, allowMissing = false) {
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
      if (code === 0 || allowMissing) resolvePromise({ stdout, stderr });
      else reject(new Error(`git ${args[0]} failed`));
    });
  });
}
