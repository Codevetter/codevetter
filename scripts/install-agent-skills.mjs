#!/usr/bin/env node
import { lstatSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const skillNames = [
  'codevetter-review',
  'codevetter-testing',
  'codevetter-performance',
  'codevetter-evaluate',
];

export function installAgentSkills({
  sourceRoot = join(repositoryRoot, 'skills'),
  destination = join(homedir(), '.codex', 'skills'),
} = {}) {
  const plans = skillNames.map((name) => {
    const source = realpathSync(join(sourceRoot, name));
    const target = join(destination, name);
    let existing;
    try {
      existing = lstatSync(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (existing) {
      let same = false;
      if (existing.isSymbolicLink()) {
        try {
          same = realpathSync(target) === source;
        } catch {
          // Dangling or unreadable links are unrelated state and remain untouched.
        }
      }
      if (!same) throw new Error(`Existing skill preserved: ${target}`);
      return { name, source, target, status: 'already_installed' };
    }
    return { name, source, target, status: 'installed' };
  });
  // Check every collision before adding any links. symlinkSync also refuses races.
  mkdirSync(destination, { recursive: true });
  for (const plan of plans) {
    if (plan.status === 'installed') symlinkSync(plan.source, plan.target, 'dir');
  }
  return plans;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--destination')) {
      throw new Error('Usage: node scripts/install-agent-skills.mjs [--destination <directory>]');
    }
    const plans = installAgentSkills(args.length ? { destination: resolve(args[1]) } : {});
    for (const plan of plans) console.log(`${plan.name}: ${plan.status}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
