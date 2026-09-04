#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fileArtifact,
  isMainModule,
  parsePathArguments,
  readJSON,
} from './native-script-utils.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseArguments(argv) {
  return parsePathArguments(argv, {
    paths: { '--qualification': 'qualification' },
    required: ['--qualification'],
  });
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

// `hdiutil create` appends `.dmg` when the output path lacks that extension, so
// the temporary archive must keep the final extension at the end of its name.
export function temporaryArchivePath(target) {
  const extension = target.slice(target.lastIndexOf('.'));
  return `${target.slice(0, -extension.length)}.finalizing${extension}`;
}

export function finalizeNativePackageArchives(
  options = parseArguments(process.argv.slice(2)),
  run = runCommand
) {
  const qualification = readJSON(options.qualification);
  const directory = dirname(options.qualification);
  const app = resolve(qualification.application?.path ?? '');
  if (app !== join(directory, 'CodeVetter.app')) {
    throw new Error('The qualification does not bind the staged CodeVetter.app');
  }
  const artifacts = [];
  for (const archive of qualification.archives ?? []) {
    const target = join(directory, archive.name);
    const temporary = temporaryArchivePath(target);
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
    artifacts.push(fileArtifact(target));
  }
  const finalized = updateArchiveReceipt(qualification, artifacts);
  writeFileSync(options.qualification, `${JSON.stringify(finalized, null, 2)}\n`);
  process.stdout.write(`${options.qualification}\n`);
  return finalized;
}

function runCommand(command, arguments_) {
  execFileSync(command, arguments_, { cwd: repositoryRoot, stdio: 'inherit' });
}

if (isMainModule(import.meta.url)) finalizeNativePackageArchives();
