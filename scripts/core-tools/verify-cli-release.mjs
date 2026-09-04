import { execFileSync } from 'node:child_process';
import { constants, accessSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const requiredHelpFragments = [
  'codevetter check (--pr <url> | --range <base..head>) --task <text>',
  'codevetter trex (--pr <url> | --range <base..head>) --preview <url>',
  '--pr <url>',
  '--range <range>',
  '--preview <url>',
  '--repo <path>',
  '--task <text>',
  '--preflight',
  '--spec <path>',
  '--requirement <id>',
  '--baseline-repo <path>',
  '--json',
];

export function readMarketingVersion(
  configPath = join(repositoryRoot, 'apps/macos/Config/Shared.xcconfig')
) {
  const match = readFileSync(configPath, 'utf8').match(/^MARKETING_VERSION\s*=\s*(\S+)\s*$/m);
  if (!match) throw new Error(`Native marketing version is missing: ${configPath}`);
  return match[1];
}

export function qualifyCli({
  binaryPath = resolvePreparedBinary(),
  expectedVersion = readMarketingVersion(),
} = {}) {
  const resolvedBinary = resolve(binaryPath);
  const stats = statSync(resolvedBinary);
  if (!stats.isFile() || stats.size === 0) {
    throw new Error(`CLI artifact is missing or empty: ${resolvedBinary}`);
  }
  accessSync(resolvedBinary, constants.X_OK);

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
    bundleEntry: 'Contents/MacOS/codevetter',
    helpContracts: requiredHelpFragments.length,
  };
}

export function resolvePreparedBinary() {
  const target = rustHostTarget();
  return join(
    repositoryRoot,
    'crates/codevetter-core/binaries',
    `codevetter-${target}${process.platform === 'win32' ? '.exe' : ''}`
  );
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
  if (!target) throw new Error('Could not determine the Rust host target');
  return target;
}

function parseArgs(args) {
  let binaryPath;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== '--binary') throw new Error(`Unknown argument: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('--binary requires a path');
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
      `CodeVetter CLI qualification passed: ${result.version}, ${result.bytes} bytes, ${result.helpContracts} help contracts\n`
    );
  } catch (error) {
    process.stderr.write(
      `CodeVetter CLI qualification failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
