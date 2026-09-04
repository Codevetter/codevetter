import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coreRoot = join(repositoryRoot, 'crates/codevetter-core');
const rootRequire = createRequire(import.meta.url);

const TARGET_PACKAGES = new Map([
  ['aarch64-apple-darwin', ['@ccusage/ccusage-darwin-arm64', 'bin/ccusage']],
  ['x86_64-apple-darwin', ['@ccusage/ccusage-darwin-x64', 'bin/ccusage']],
  ['aarch64-unknown-linux-gnu', ['@ccusage/ccusage-linux-arm64', 'bin/ccusage']],
  ['x86_64-unknown-linux-gnu', ['@ccusage/ccusage-linux-x64', 'bin/ccusage']],
  ['aarch64-pc-windows-msvc', ['@ccusage/ccusage-win32-arm64', 'bin/ccusage.exe']],
  ['x86_64-pc-windows-msvc', ['@ccusage/ccusage-win32-x64', 'bin/ccusage.exe']],
]);

export function packageForTarget(target) {
  const entry = TARGET_PACKAGES.get(target);
  if (!entry) throw new Error(`Unsupported ccusage sidecar target: ${target}`);
  return { packageName: entry[0], binarySubpath: entry[1] };
}

export function assertCcusageMetadata({ expectedVersion, wrapperVersion, nativeVersion, license }) {
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
    throw new Error(`ccusage must use an exact version, received: ${expectedVersion}`);
  }
  if (wrapperVersion !== expectedVersion || nativeVersion !== expectedVersion) {
    throw new Error(
      `ccusage version mismatch: expected ${expectedVersion}, wrapper ${wrapperVersion}, native ${nativeVersion}`
    );
  }
  if (license !== 'MIT') throw new Error(`Unexpected ccusage license: ${license}`);
}

export function resolveInstalledCcusage(target) {
  const { packageName, binarySubpath } = packageForTarget(target);
  let cliPath;
  try {
    cliPath = rootRequire.resolve('ccusage/src/cli.js');
  } catch {
    throw new Error('ccusage is not installed. Run pnpm install from the repository root.');
  }
  const wrapperPackage = readJson(join(dirname(cliPath), '..', 'package.json'));
  const nativeRequire = createRequire(cliPath);
  let binaryPath;
  let nativePackagePath;
  try {
    binaryPath = nativeRequire.resolve(`${packageName}/${binarySubpath}`);
    nativePackagePath = nativeRequire.resolve(`${packageName}/package.json`);
  } catch {
    throw new Error(
      `The optional native package ${packageName} is missing for ${target}. Reinstall dependencies on that target.`
    );
  }
  const nativePackage = readJson(nativePackagePath);
  return {
    binaryPath,
    wrapperVersion: wrapperPackage.version,
    nativeVersion: nativePackage.version,
    license: nativePackage.license,
  };
}

export function prepareCcusageSidecar({
  target = process.env.CODEVETTER_TARGET_TRIPLE ?? rustHostTarget(),
  destinationRoot = join(coreRoot, 'binaries'),
  installed = resolveInstalledCcusage(target),
  expectedVersion = pinnedVersion(),
} = {}) {
  assertCcusageMetadata({ expectedVersion, ...installed });
  assertNonEmpty(installed.binaryPath, 'installed ccusage binary');

  const suffix = target.includes('windows') ? '.exe' : '';
  const destination = join(destinationRoot, `ccusage-${target}${suffix}`);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dirname(destination), { recursive: true });
  try {
    copyFileSync(installed.binaryPath, temporary);
    if (!suffix) chmodSync(temporary, 0o755);
    assertNonEmpty(temporary, 'prepared ccusage sidecar');
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }

  const output = execFileSync(destination, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!output.includes(expectedVersion)) {
    throw new Error(
      `Prepared ccusage version mismatch: expected ${expectedVersion}, received ${output}`
    );
  }
  console.log(`Prepared ${destination} (${output}, MIT)`);
  return { destination, version: expectedVersion, license: installed.license };
}

function pinnedVersion() {
  const packageJson = readJson(join(repositoryRoot, 'package.json'));
  return packageJson.devDependencies?.ccusage ?? '';
}

export function rustHostTarget() {
  const target = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
    .split('\n')
    .find((line) => line.startsWith('host: '))
    ?.slice('host: '.length);
  if (!target) throw new Error('Could not determine the Rust target triple for ccusage');
  return target;
}

function assertNonEmpty(path, label) {
  const stats = statSync(path);
  if (!stats.isFile() || stats.size === 0) throw new Error(`${label} is missing or empty: ${path}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) prepareCcusageSidecar();
