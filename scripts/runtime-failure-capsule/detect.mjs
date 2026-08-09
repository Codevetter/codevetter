import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

import {
  DETECTION_SCHEMA_VERSION,
  EXCLUDED_PATH_PARTS,
  LIMITS,
  validateDetection,
} from './contracts.mjs';

const CONFIG_PATTERN = /^(?:vitest|playwright)\.config\.[cm]?[jt]s$|^wrangler\.(?:toml|jsonc?)$/;

export async function detectRuntimeLanes(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const files = await scanEvidenceFiles(root);
  const packageFiles = files.filter((path) => basename(path) === 'package.json');
  const manifests = await Promise.all(packageFiles.map((path) => readPackage(join(root, path))));
  const vitestConfigs = files.filter((path) => basename(path).startsWith('vitest.config.'));
  const playwrightConfigs = files.filter((path) => basename(path).startsWith('playwright.config.'));
  const wranglerConfigs = files.filter((path) => basename(path).startsWith('wrangler.'));
  const goModules = files.filter((path) => basename(path) === 'go.mod');
  const goTests = files.filter((path) => path.endsWith('_test.go'));
  const hasDependency = (name) =>
    manifests.some((manifest) => manifest && dependencyNames(manifest).includes(name));
  const lanes = [];

  if (packageFiles.length > 0) {
    lanes.push({
      kind: 'node-test',
      adapters: ['node-test', 'node-script'],
      evidence: packageFiles.slice(0, 16),
      limitations: ['A package manifest establishes a Node lane, not a runnable test.'],
    });
  }
  if (vitestConfigs.length > 0 || hasDependency('vitest')) {
    lanes.push({
      kind: 'vitest',
      adapters: ['vitest'],
      evidence: [...vitestConfigs, ...packageFiles].slice(0, 16),
      limitations: ['Vitest availability is checked only when a diagnostic run is requested.'],
    });
  }
  if (playwrightConfigs.length > 0 || hasDependency('@playwright/test')) {
    lanes.push({
      kind: 'browser',
      adapters: ['playwright'],
      evidence: [...playwrightConfigs, ...packageFiles].slice(0, 16),
      limitations: ['Detection does not install browsers or prove a browser launch.'],
    });
  }
  if (wranglerConfigs.length > 0) {
    lanes.push({
      kind: 'cloudflare-worker',
      adapters: vitestConfigs.length > 0 || hasDependency('vitest') ? ['vitest'] : [],
      evidence: [...wranglerConfigs, ...vitestConfigs, ...packageFiles].slice(0, 16),
      limitations: [
        'Worker diagnostics reuse the repository Vitest or imported receipt runtime; Node emulation is not used.',
      ],
    });
  }
  if (goModules.length > 0) {
    lanes.push({
      kind: 'go-test',
      adapters: ['go-test'],
      evidence: [...goModules, ...goTests].slice(0, 16),
      limitations: ['A Go module establishes support; the Go executable is checked at run time.'],
    });
  }

  const report = {
    schema_version: DETECTION_SCHEMA_VERSION,
    repository: '.',
    lanes,
    limitations:
      lanes.length === 0
        ? ['No supported runtime lane was established from bounded repository evidence.']
        : [],
    scan: { evidence_files: files.length, maximum_files: LIMITS.scanFiles },
  };
  const errors = validateDetection(report);
  if (errors.length > 0) throw new Error(errors.join('; '));
  return report;
}

async function scanEvidenceFiles(root) {
  const found = [];
  const queue = [{ directory: root, depth: 0 }];
  while (queue.length > 0 && found.length < LIMITS.scanFiles) {
    const current = queue.shift();
    let entries;
    try {
      entries = await readdir(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (found.length >= LIMITS.scanFiles) break;
      if (EXCLUDED_PATH_PARTS.includes(entry.name)) continue;
      const absolute = join(current.directory, entry.name);
      if (entry.isDirectory() && current.depth < LIMITS.scanDepth) {
        queue.push({ directory: absolute, depth: current.depth + 1 });
      } else if (
        entry.isFile() &&
        (entry.name === 'package.json' ||
          entry.name === 'go.mod' ||
          entry.name.endsWith('_test.go') ||
          CONFIG_PATTERN.test(entry.name))
      ) {
        found.push(relative(root, absolute).split('\\').join('/'));
      }
    }
  }
  return found;
}

async function readPackage(path) {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > 512 * 1024) return null;
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function dependencyNames(manifest) {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];
}
