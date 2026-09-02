#!/usr/bin/env node

import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMainModule, parsePathArguments, readJSON, readPlist } from './native-script-utils.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaVersion = 'codevetter.native-appcast-qualification/v1';
const qualificationSchema = 'codevetter.native-package-qualification/v1';

export function parseArguments(argv) {
  return parsePathArguments(argv, {
    paths: {
      '--app': 'app',
      '--appcast': 'appcast',
      '--qualification': 'qualification',
      '--out': 'out',
    },
    required: ['--app', '--appcast', '--qualification'],
  });
}

export function evaluateNativeAppcast({ xml, info, qualification, archiveBytes, archiveName }) {
  if (qualification.schema_version !== qualificationSchema) {
    throw new Error('Unsupported native package qualification schema');
  }
  const enclosure = parseEnclosure(xml);
  const publicKey = canonicalPublicKey(info.SUPublicEDKey);
  const archive = (qualification.archives ?? []).find((item) => item.name === archiveName);
  const archiveSHA256 = createHash('sha256').update(archiveBytes).digest('hex');
  const signature = Buffer.from(enclosure.signature, 'base64');
  const signatureValid = verify(null, archiveBytes, ed25519PublicKey(publicKey), signature);
  const feedURL = new URL(info.SUFeedURL);
  const archiveURL = new URL(enclosure.url);

  const checks = [
    check('production_bundle', info.CFBundleIdentifier === 'com.codevetter.desktop'),
    check('https_feed', feedURL.protocol === 'https:'),
    check('https_archive', archiveURL.protocol === 'https:'),
    check('archive_name', basename(archiveURL.pathname) === archiveName),
    check(
      'archive_receipt',
      archive?.sha256 === archiveSHA256 && archive?.bytes === archiveBytes.length
    ),
    check('archive_length', enclosure.length === archiveBytes.length),
    check('version', enclosure.version === info.CFBundleVersion),
    check('short_version', enclosure.shortVersion === info.CFBundleShortVersionString),
    check('signature', signature.length === 64 && signatureValid),
  ];
  const blockers = checks.filter((item) => !item.passed).map((item) => item.id);
  return {
    schema_version: schemaVersion,
    authority: 'offline_cryptographic_inspection',
    status: blockers.length === 0 ? 'qualified' : 'blocked',
    qualified: blockers.length === 0,
    feed_url: feedURL.toString(),
    archive: {
      name: archiveName,
      url: archiveURL.toString(),
      bytes: archiveBytes.length,
      sha256: archiveSHA256,
    },
    application: {
      bundle_identifier: info.CFBundleIdentifier,
      version: info.CFBundleShortVersionString,
      build: info.CFBundleVersion,
    },
    public_key_sha256: createHash('sha256').update(publicKey).digest('hex'),
    checks,
    blockers,
    limitations: [
      'This receipt verifies the local appcast and archive without publishing either file.',
      'HTTPS reachability and installed updater behavior remain separate release gates.',
    ],
  };
}

export function inspectNativeAppcast(options = parseArguments(process.argv.slice(2))) {
  const info = readPlist(join(options.app, 'Contents/Info.plist'), repositoryRoot);
  const qualification = readJSON(options.qualification);
  const xml = readFileSync(options.appcast, 'utf8');
  const enclosure = parseEnclosure(xml);
  const archiveName = basename(new URL(enclosure.url).pathname);
  const archivePath = join(dirname(options.appcast), archiveName);
  const receipt = evaluateNativeAppcast({
    xml,
    info,
    qualification,
    archiveBytes: readFileSync(archivePath),
    archiveName,
  });
  const output = `${JSON.stringify(receipt, null, 2)}\n`;
  if (options.out) writeFileSync(options.out, output);
  process.stdout.write(output);
  if (!receipt.qualified) process.exitCode = 1;
  return receipt;
}

function parseEnclosure(xml) {
  const tag = xml.match(/<enclosure\s+[^>]*>/i)?.[0];
  if (!tag) throw new Error('Sparkle appcast enclosure is missing');
  return {
    url: requiredAttribute(tag, 'url'),
    version: requiredAttribute(tag, 'sparkle:version'),
    shortVersion: requiredAttribute(tag, 'sparkle:shortVersionString'),
    length: Number(requiredAttribute(tag, 'length')),
    signature: requiredAttribute(tag, 'sparkle:edSignature'),
  };
}

function requiredAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = tag.match(new RegExp(`\\s${escaped}="([^"]+)"`, 'i'))?.[1];
  if (!value) throw new Error(`Sparkle appcast enclosure is missing ${name}`);
  return decodeEntities(value);
}

function decodeEntities(value) {
  const entities = {
    '&amp;': '&',
    '&quot;': '"',
    '&lt;': '<',
    '&gt;': '>',
  };
  return value.replace(/&(amp|quot|lt|gt);/g, (entity) => entities[entity]);
}

function canonicalPublicKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error('The application does not contain a canonical Sparkle EdDSA public key');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== value) {
    throw new Error('The application does not contain a canonical Sparkle EdDSA public key');
  }
  return decoded;
}

function ed25519PublicKey(raw) {
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' });
}

function check(id, passed) {
  return { id, passed: passed === true };
}

if (isMainModule(import.meta.url)) inspectNativeAppcast();
