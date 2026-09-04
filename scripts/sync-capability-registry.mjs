import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = resolve(root, 'crates/codevetter-core/Cargo.toml');
const output = resolve(
  root,
  'apps/macos/CodeVetterPackage/Sources/CodeVetterFeature/Resources/capabilities.v1.json'
);
const check = process.argv.includes('--check');

const result = spawnSync(
  'cargo',
  [
    'run',
    '--quiet',
    '--manifest-path',
    manifest,
    '--features',
    'browser-agent',
    '--bin',
    'codevetter',
    '--',
    'capabilities',
    '--json',
  ],
  {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }),
    },
  }
);

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const canonical = `${JSON.stringify(JSON.parse(result.stdout), null, 2)}\n`;
if (check) {
  const current = readFileSync(output, 'utf8');
  if (current !== canonical) {
    throw new Error('Native capability fixture is stale; run pnpm capabilities:sync');
  }
  process.stdout.write('Native capability fixture matches the Rust registry.\n');
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, canonical);
  process.stdout.write(`Updated ${output}\n`);
}
