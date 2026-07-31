import { execFileSync } from 'node:child_process';
import { constants, accessSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredHelpFragments = [
  'codevetter trex (--pr <url> | --range <base..head>) --preview <url>',
  '--pr <url>',
  '--range <range>',
  '--preview <url>',
  '--repo <path>',
  '--json',
];

export function qualifyCli({
  binaryPath = resolvePreparedBinary(),
  projectRoot = desktopRoot,
} = {}) {
  const resolvedBinary = resolve(binaryPath);
  const stats = statSync(resolvedBinary);
  if (!stats.isFile() || stats.size === 0) {
    throw new Error(`CLI artifact is missing or empty: ${resolvedBinary}`);
  }
  accessSync(resolvedBinary, constants.X_OK);

  const tauriConfigPath = join(projectRoot, 'src-tauri', 'tauri.conf.json');
  const macosConfigPath = join(projectRoot, 'src-tauri', 'tauri.macos.conf.json');
  const tauriConfig = readJson(tauriConfigPath);
  const macosConfig = readJson(macosConfigPath);
  const expectedBundleEntry = 'binaries/codevetter';
  assertBundleEntry(tauriConfig, tauriConfigPath, expectedBundleEntry);
  assertBundleEntry(macosConfig, macosConfigPath, expectedBundleEntry);

  const expectedVersion = tauriConfig.version;
  if (typeof expectedVersion !== 'string' || expectedVersion.length === 0) {
    throw new Error(`Tauri version is missing: ${tauriConfigPath}`);
  }

  const versionOutput = runBinary(resolvedBinary, ['--version']).trim();
  const expectedVersionOutput = `codevetter ${expectedVersion}`;
  if (versionOutput !== expectedVersionOutput) {
    throw new Error(
      `CLI version mismatch: expected "${expectedVersionOutput}", received "${versionOutput}"`
    );
  }

  const helpOutput = runBinary(resolvedBinary, ['--help']);
  for (const fragment of requiredHelpFragments) {
    if (!helpOutput.includes(fragment)) {
      throw new Error(`CLI help is missing required contract: ${fragment}`);
    }
  }

  return {
    binary: resolvedBinary,
    bytes: stats.size,
    version: expectedVersion,
    bundleEntry: expectedBundleEntry,
    helpContracts: requiredHelpFragments.length,
  };
}

export function resolvePreparedBinary() {
  const target = rustHostTarget();
  return join(
    desktopRoot,
    'src-tauri',
    'binaries',
    `codevetter-${target}${process.platform === 'win32' ? '.exe' : ''}`
  );
}

function assertBundleEntry(config, path, expected) {
  const entries = config?.bundle?.externalBin;
  if (!Array.isArray(entries) || !entries.includes(expected)) {
    throw new Error(`${path} does not declare ${expected}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runBinary(binary, args) {
  return execFileSync(binary, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function rustHostTarget() {
  const target = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
    .split('\n')
    .find((line) => line.startsWith('host: '))
    ?.slice('host: '.length);
  if (!target) {
    throw new Error('Could not determine the Rust host target');
  }
  return target;
}

function parseArgs(args) {
  let binaryPath;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== '--binary') {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('--binary requires a path');
    }
    binaryPath = value;
    index += 1;
  }
  return { binaryPath };
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const result = qualifyCli(parseArgs(process.argv.slice(2)));
    process.stdout.write(
      `T-Rex CLI qualification passed: ${result.version}, ${result.bytes} bytes, ${result.helpContracts} help contracts\n`
    );
  } catch (error) {
    process.stderr.write(
      `T-Rex CLI qualification failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
