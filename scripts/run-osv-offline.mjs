#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RECEIPT_SCHEMA = 'codevetter.osv-offline-scan/v1';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_OUTPUT_DIR = resolve(REPOSITORY_ROOT, 'artifacts/tooling/osv');

function sha256File(path) {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  const descriptor = openSync(path, 'r');
  try {
    let bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    while (bytesRead > 0) {
      hash.update(buffer.subarray(0, bytesRead));
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

export function defaultDatabaseRoot({
  platform = process.platform,
  home = homedir(),
  xdgCacheHome = process.env.XDG_CACHE_HOME,
  localAppData = process.env.LOCALAPPDATA,
} = {}) {
  if (platform === 'darwin') return resolve(home, 'Library/Caches/osv-scalibr');
  if (platform === 'win32' && localAppData) return resolve(localAppData, 'osv-scalibr');
  return resolve(xdgCacheHome ?? resolve(home, '.cache'), 'osv-scalibr');
}

export function parseScannerVersion(stdout) {
  const match = stdout.match(/^osv-scanner version:\s*(\S+)/m);
  if (!match) throw new Error('Unable to parse osv-scanner version output');
  return match[1];
}

export function classifyScannerExit(status) {
  if (status === 0) return 'clean';
  if (status === 1) return 'findings';
  return 'operational_failure';
}

export function collectDatabaseIdentities(databaseRoot) {
  if (!existsSync(databaseRoot)) return [];
  return readdirSync(databaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ ecosystem: entry.name, path: resolve(databaseRoot, entry.name, 'all.zip') }))
    .filter((entry) => existsSync(entry.path))
    .map(({ ecosystem, path }) => {
      const stat = statSync(path);
      return {
        ecosystem,
        sha256: sha256File(path),
        bytes: stat.size,
        modified_at: stat.mtime.toISOString(),
      };
    })
    .sort((left, right) => left.ecosystem.localeCompare(right.ecosystem));
}

function gitRevision(repositoryRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error('Unable to resolve repository revision');
  return result.stdout.trim();
}

function sarifResultCount(path) {
  const sarif = JSON.parse(readFileSync(path, 'utf8'));
  return (sarif.runs ?? []).reduce((count, run) => count + (run.results?.length ?? 0), 0);
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

export function runOfflineScan({
  repositoryRoot = REPOSITORY_ROOT,
  outputDir = DEFAULT_OUTPUT_DIR,
  databaseRoot = defaultDatabaseRoot(),
  scanner = 'osv-scanner',
} = {}) {
  const versionResult = spawnSync(scanner, ['--version'], { encoding: 'utf8' });
  if (versionResult.status !== 0) {
    throw new Error('osv-scanner is unavailable; install the pinned qualified version first');
  }

  const databases = collectDatabaseIdentities(databaseRoot);
  if (databases.length === 0) {
    throw new Error('No offline OSV databases found; refresh them in an explicit network step');
  }

  mkdirSync(outputDir, { recursive: true });
  const sarifPath = resolve(outputDir, 'results.sarif');
  const receiptPath = resolve(outputDir, 'receipt.json');
  const startedAt = new Date();
  const scan = spawnSync(
    scanner,
    [
      'scan',
      'source',
      '--offline',
      '--offline-vulnerabilities',
      '--recursive',
      '--format=sarif',
      `--output-file=${sarifPath}`,
      '--verbosity=warn',
      '.',
    ],
    { cwd: repositoryRoot, encoding: 'utf8' }
  );
  const finishedAt = new Date();
  const outcome = classifyScannerExit(scan.status);

  const receipt = {
    schema: RECEIPT_SCHEMA,
    tool: {
      name: 'osv-scanner',
      version: parseScannerVersion(versionResult.stdout),
    },
    source: {
      revision: gitRevision(repositoryRoot),
      scan_root: '.',
      recursive: true,
    },
    execution: {
      network: 'disabled',
      vulnerability_source: 'preseeded-local-databases',
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      scanner_exit_code: scan.status,
      outcome,
    },
    databases,
    artifact: existsSync(sarifPath)
      ? {
          path: relative(repositoryRoot, sarifPath),
          sha256: sha256File(sarifPath),
          result_count: sarifResultCount(sarifPath),
        }
      : null,
    limitations: [
      'Database refresh is intentionally outside this offline command.',
      'A lockfile advisory does not by itself establish runtime reachability.',
      'OSV result count may include aliases for the same underlying vulnerability.',
    ],
  };
  writeJsonAtomic(receiptPath, receipt);

  if (scan.stderr) process.stderr.write(scan.stderr);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  return scan.status ?? 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runOfflineScan();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
