#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const outputPath = resolve(process.env.BIOME_SARIF_PATH ?? 'artifacts/tooling/biome.sarif');
mkdirSync(dirname(outputPath), { recursive: true });

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(
  pnpm,
  ['exec', 'biome', 'ci', '--reporter=sarif', `--reporter-file=${outputPath}`, '.'],
  { stdio: 'inherit' }
);

if (result.error) {
  console.error(`Unable to run Biome: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
