#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const proofSchema = 'codevetter.native-notarization-proof/v1';

export function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--app') options.app = resolve(requiredValue(argv, ++index, argument));
    else if (argument === '--archive') {
      options.archive = resolve(requiredValue(argv, ++index, argument));
    } else if (argument === '--qualification') {
      options.qualification = resolve(requiredValue(argv, ++index, argument));
    } else if (argument === '--submission') {
      options.submission = resolve(requiredValue(argv, ++index, argument));
    } else if (argument === '--out') options.out = resolve(requiredValue(argv, ++index, argument));
    else throw new Error(`Unknown argument: ${argument}`);
  }
  for (const required of ['app', 'archive', 'qualification', 'submission', 'out']) {
    if (!options[required]) throw new Error(`--${required} is required`);
  }
  return options;
}

export function buildNativeNotarizationProof({
  submission,
  archiveSHA256,
  qualification,
  stapleValidated,
  recordedAt = new Date().toISOString(),
}) {
  const archiveQualified = (qualification.archives ?? []).some(
    (archive) => archive.sha256 === archiveSHA256
  );
  const accepted =
    String(submission.status).toLowerCase() === 'accepted' &&
    typeof submission.id === 'string' &&
    submission.id.length > 0;
  if (!accepted) throw new Error(`Apple notarization was not accepted: ${submission.status}`);
  if (!archiveQualified) throw new Error('The notarized archive is not bound to the qualification');
  if (!stapleValidated) throw new Error('The notarization ticket is not stapled and validated');
  return {
    schema_version: proofSchema,
    authority: 'apple_notary_service_and_stapler',
    recorded_at: recordedAt,
    status: 'accepted',
    submission_id: submission.id,
    archive_sha256: archiveSHA256,
    stapled: true,
    limitations: [
      'This proof binds Apple acceptance and a validated ticket to the qualified archive and app.',
      'Publication and replacement of an installed application remain separate actions.',
    ],
  };
}

export function createNativeNotarizationProof(options = parseArguments(process.argv.slice(2))) {
  const qualification = JSON.parse(readFileSync(options.qualification, 'utf8'));
  const submission = JSON.parse(readFileSync(options.submission, 'utf8'));
  const archiveSHA256 = createHash('sha256').update(readFileSync(options.archive)).digest('hex');
  const developerDirectory = execFileSync('xcode-select', ['-p'], { encoding: 'utf8' }).trim();
  const stapler = join(developerDirectory, 'usr/bin/stapler');
  const result = spawnSync(stapler, ['validate', options.app], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  const proof = buildNativeNotarizationProof({
    submission,
    archiveSHA256,
    qualification,
    stapleValidated: result.status === 0,
  });
  writeFileSync(options.out, `${JSON.stringify(proof, null, 2)}\n`);
  process.stdout.write(`${options.out}\n`);
  return proof;
}

function requiredValue(argv, index, argument) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
  return value;
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) createNativeNotarizationProof();
