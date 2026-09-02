#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--qualification') {
      options.qualification = resolve(requiredValue(argv, ++index, argument));
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.qualification) throw new Error('--qualification is required');
  return options;
}

export function updateArchiveReceipt(qualification, artifacts) {
  if (qualification.schema_version !== 'codevetter.native-package-qualification/v1') {
    throw new Error('Unsupported native package qualification schema');
  }
  const expected = new Set((qualification.archives ?? []).map((item) => item.name));
  if (expected.size !== artifacts.length || artifacts.some((item) => !expected.has(item.name))) {
    throw new Error('Final archives do not match the qualified archive identities');
  }
  return {
    ...qualification,
    archives: artifacts,
    notarization_ticket_stapled: true,
  };
}

export function finalizeNativePackageArchives(
  options = parseArguments(process.argv.slice(2)),
  run = runCommand
) {
  const qualification = JSON.parse(readFileSync(options.qualification, 'utf8'));
  const directory = dirname(options.qualification);
  const app = resolve(qualification.application?.path ?? '');
  if (app !== join(directory, 'CodeVetter.app')) {
    throw new Error('The qualification does not bind the staged CodeVetter.app');
  }
  const artifacts = [];
  for (const archive of qualification.archives ?? []) {
    const target = join(directory, archive.name);
    const temporary = `${target}.finalizing`;
    rmSync(temporary, { recursive: true, force: true });
    if (archive.name.endsWith('.zip')) {
      run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, temporary]);
    } else if (archive.name.endsWith('.dmg')) {
      run('hdiutil', [
        'create',
        '-quiet',
        '-volname',
        'CodeVetter',
        '-srcfolder',
        app,
        '-format',
        'UDZO',
        temporary,
      ]);
    } else {
      throw new Error(`Unsupported native archive: ${archive.name}`);
    }
    renameSync(temporary, target);
    artifacts.push(artifact(target));
  }
  const finalized = updateArchiveReceipt(qualification, artifacts);
  writeFileSync(options.qualification, `${JSON.stringify(finalized, null, 2)}\n`);
  process.stdout.write(`${options.qualification}\n`);
  return finalized;
}

function artifact(path) {
  const bytes = readFileSync(path);
  return {
    name: basename(path),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function runCommand(command, arguments_) {
  execFileSync(command, arguments_, { cwd: repositoryRoot, stdio: 'inherit' });
}

function requiredValue(argv, index, argument) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
  return value;
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) finalizeNativePackageArchives();
