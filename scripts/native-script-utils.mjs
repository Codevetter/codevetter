import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parsePathArguments(argv, { paths, required = [] }) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    const property = paths[argument];
    if (!property) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    options[property] = resolve(value);
  }
  for (const argument of required) {
    const property = paths[argument];
    if (!options[property]) throw new Error(`${argument} is required`);
  }
  return options;
}

export function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readPlist(path, cwd) {
  return JSON.parse(
    execFileSync('plutil', ['-convert', 'json', '-o', '-', path], {
      cwd,
      encoding: 'utf8',
    })
  );
}

export function fileArtifact(path) {
  const bytes = readFileSync(path);
  return {
    name: basename(path),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function isMainModule(importMetaURL) {
  return Boolean(
    process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(importMetaURL))
  );
}
