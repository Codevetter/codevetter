import { copyFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coreRoot = join(repositoryRoot, 'crates/codevetter-core');

export function prepareRustSidecar({ binary, release = false, features = [] }) {
  const configuredTarget = process.env.CODEVETTER_TARGET_TRIPLE;
  const target = configuredTarget ?? rustHostTarget();
  const executable = process.platform === 'win32' ? `${binary}.exe` : binary;
  const profile = release ? 'release' : 'debug';
  const cargoTargetRoot = process.env.CARGO_TARGET_DIR
    ? resolve(repositoryRoot, process.env.CARGO_TARGET_DIR)
    : join(coreRoot, 'target');
  const cargoArgs = ['build', '--manifest-path', join(coreRoot, 'Cargo.toml'), '--bin', binary];
  if (release) cargoArgs.push('--release');
  if (configuredTarget) cargoArgs.push('--target', target);
  if (features.length > 0) cargoArgs.push('--features', features.join(','));

  execFileSync('cargo', cargoArgs, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: process.env,
  });

  const built = configuredTarget
    ? join(cargoTargetRoot, target, profile, executable)
    : join(cargoTargetRoot, profile, executable);
  assertNonEmpty(built, `built ${binary} sidecar`);

  const suffix = process.platform === 'win32' ? '.exe' : '';
  const destination = join(coreRoot, 'binaries', `${binary}-${target}${suffix}`);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dirname(destination), { recursive: true });

  try {
    copyFileSync(built, temporary);
    assertNonEmpty(temporary, `prepared ${binary} sidecar`);
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }

  console.log(`Prepared ${destination}`);
  return destination;
}

function rustHostTarget() {
  const target = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
    .split('\n')
    .find((line) => line.startsWith('host: '))
    ?.slice('host: '.length);
  if (!target) throw new Error('Could not determine the Rust target triple for a sidecar');
  return target;
}

function assertNonEmpty(path, label) {
  const stats = statSync(path);
  if (!stats.isFile() || stats.size === 0) throw new Error(`${label} is missing or empty: ${path}`);
}
