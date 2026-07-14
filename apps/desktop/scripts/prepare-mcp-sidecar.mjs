import { closeSync, copyFileSync, mkdirSync, openSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tauriRoot = join(desktopRoot, 'src-tauri');
const release = process.argv.includes('--release');
const target =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
    .split('\n')
    .find((line) => line.startsWith('host: '))
    ?.slice('host: '.length);

if (!target) throw new Error('Could not determine the Rust target triple for the MCP sidecar');

const cargoArgs = [
  'build',
  '--manifest-path',
  join(tauriRoot, 'Cargo.toml'),
  '--bin',
  'codevetter-mcp',
];
if (release) cargoArgs.push('--release');
if (process.env.TAURI_ENV_TARGET_TRIPLE) cargoArgs.push('--target', target);
const executable = process.platform === 'win32' ? 'codevetter-mcp.exe' : 'codevetter-mcp';
const profile = release ? 'release' : 'debug';
const built = process.env.TAURI_ENV_TARGET_TRIPLE
  ? join(tauriRoot, 'target', target, profile, executable)
  : join(tauriRoot, 'target', profile, executable);
const destination = join(
  tauriRoot,
  'binaries',
  `codevetter-mcp-${target}${process.platform === 'win32' ? '.exe' : ''}`
);

mkdirSync(dirname(destination), { recursive: true });
// tauri-build validates externalBin before Cargo can produce this package's
// sidecar. A zero-byte ignored placeholder breaks that bootstrap cycle; it is
// replaced atomically enough for the single-process build immediately below.
closeSync(openSync(destination, 'a'));
execFileSync('cargo', cargoArgs, { cwd: desktopRoot, stdio: 'inherit' });
copyFileSync(built, destination);
console.log(`Prepared ${destination}`);
