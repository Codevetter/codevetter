#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export function normalizeBiomeSarif(sarif) {
  for (const run of sarif.runs ?? []) {
    for (const rule of run.tool?.driver?.rules ?? []) {
      if (!rule.shortDescription?.text?.trim()) {
        rule.shortDescription = { text: rule.id || 'Biome diagnostic' };
      }
      if (!rule.helpUri?.trim()) delete rule.helpUri;
    }

    for (const result of run.results ?? []) {
      if (!result.message?.text?.trim()) {
        result.message = { text: `Biome reported ${result.ruleId || 'a diagnostic'}.` };
      }
    }
  }
  return sarif;
}

export function normalizeBiomeSarifFile(outputPath) {
  if (!existsSync(outputPath)) {
    throw new Error(`Biome did not create the expected SARIF file: ${outputPath}`);
  }
  const sarif = JSON.parse(readFileSync(outputPath, 'utf8'));
  writeFileSync(outputPath, `${JSON.stringify(normalizeBiomeSarif(sarif), null, 2)}\n`, 'utf8');
}

export function runBiomeSarif({
  outputPath = resolve(process.env.BIOME_SARIF_PATH ?? 'artifacts/tooling/biome.sarif'),
  pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
} = {}) {
  mkdirSync(dirname(outputPath), { recursive: true });

  const result = spawnSync(
    pnpm,
    ['exec', 'biome', 'ci', '--reporter=sarif', `--reporter-file=${outputPath}`, '.'],
    { stdio: 'inherit' }
  );

  if (result.error) throw new Error(`Unable to run Biome: ${result.error.message}`);
  normalizeBiomeSarifFile(outputPath);
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runBiomeSarif();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
