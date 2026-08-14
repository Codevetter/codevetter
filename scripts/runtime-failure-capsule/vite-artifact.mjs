import { gzipSync } from 'node:zlib';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { repositoryRelative } from './contracts.mjs';

const ARTIFACT_LIMITS = Object.freeze({ files: 64, bytes: 8 * 1024 * 1024, depth: 16 });

export async function inspectExistingViteArtifact(
  repositoryRoot,
  buildDirectory,
  entry = 'index.html'
) {
  if (!buildDirectory) return null;
  const limitations = [
    'Existing build freshness and source-revision identity are unverified.',
    'Build bytes do not measure production transfer, parsing, rendering, or browser memory.',
  ];
  const files = [];
  let rawBytes = 0;
  let gzipBytes = 0;
  let buildRoot;
  try {
    buildRoot = await containedDirectory(repositoryRoot, buildDirectory);
  } catch (error) {
    return incomplete(entry, files, rawBytes, gzipBytes, [...limitations, error.message]);
  }
  const queue = [{ reference: entry, importer: buildRoot, depth: 0, kind: 'html' }];
  const visited = new Set();
  while (queue.length > 0) {
    const item = queue.shift();
    if (item.depth > ARTIFACT_LIMITS.depth) {
      limitations.push(`Initial JavaScript closure exceeded depth ${ARTIFACT_LIMITS.depth}.`);
      break;
    }
    let path;
    try {
      path = await resolveArtifactReference(buildRoot, item.importer, item.reference);
    } catch (error) {
      limitations.push(error.message);
      continue;
    }
    const relative = repositoryRelative(buildRoot, path);
    if (relative === null || visited.has(relative)) continue;
    if (files.length >= ARTIFACT_LIMITS.files) {
      limitations.push(`Initial JavaScript closure exceeded ${ARTIFACT_LIMITS.files} files.`);
      break;
    }
    let bytes;
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile()) throw new Error('not a regular file');
      if (rawBytes + metadata.size > ARTIFACT_LIMITS.bytes) {
        limitations.push(`Initial JavaScript closure exceeded ${ARTIFACT_LIMITS.bytes} raw bytes.`);
        break;
      }
      bytes = await readFile(path);
    } catch {
      limitations.push(`Artifact file ${relative} could not be read.`);
      continue;
    }
    visited.add(relative);
    const compressed = gzipSync(bytes, { level: 9 }).byteLength;
    files.push({ file: relative, raw_bytes: bytes.byteLength, gzip_bytes: compressed });
    rawBytes += bytes.byteLength;
    gzipBytes += compressed;
    const source = bytes.toString('utf8');
    const references = item.kind === 'html' ? htmlModuleScripts(source) : staticImports(source);
    if (item.kind === 'javascript' && /\bimport\s*\(/.test(source)) {
      limitations.push(`Dynamic imports in ${relative} were not included in the initial closure.`);
    }
    for (const reference of references) {
      queue.push({
        reference,
        importer: dirname(path),
        depth: item.depth + 1,
        kind: 'javascript',
      });
    }
  }
  const structuralLimitations = limitations.slice(2);
  return {
    entry,
    complete: structuralLimitations.length === 0,
    file_count: files.length,
    raw_bytes: rawBytes,
    gzip_bytes: gzipBytes,
    files,
    limitations: [...new Set(limitations)],
    provenance: 'existing_unverified_vite_artifact',
  };
}

function incomplete(entry, files, rawBytes, gzipBytes, limitations) {
  return {
    entry,
    complete: false,
    file_count: files.length,
    raw_bytes: rawBytes,
    gzip_bytes: gzipBytes,
    files,
    limitations: [...new Set(limitations)],
    provenance: 'existing_unverified_vite_artifact',
  };
}

async function containedDirectory(repositoryRoot, candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0 || isAbsolute(candidate)) {
    throw new Error('Vite build directory must be repository-relative.');
  }
  const repository = await realpath(resolve(repositoryRoot));
  let directory;
  try {
    directory = await realpath(resolve(repository, candidate));
  } catch {
    throw new Error('Vite build directory is not readable.');
  }
  if (repositoryRelative(repository, directory) === null) {
    throw new Error('Vite build directory escapes the repository.');
  }
  const metadata = await lstat(directory);
  if (!metadata.isDirectory()) throw new Error('Vite build path is not a directory.');
  return directory;
}

async function resolveArtifactReference(buildRoot, importer, reference) {
  if (typeof reference !== 'string' || reference.length === 0) {
    throw new Error('Artifact closure contained an empty reference.');
  }
  const clean = reference.split(/[?#]/, 1)[0];
  if (/^(?:[a-z]+:|\/\/)/i.test(clean)) {
    throw new Error(`Artifact reference ${reference} is external.`);
  }
  const lexical = clean.startsWith('/')
    ? resolve(buildRoot, clean.slice(1))
    : resolve(importer, clean);
  if (repositoryRelative(buildRoot, lexical) === null) {
    throw new Error(`Artifact reference ${reference} escapes the build directory.`);
  }
  let path;
  try {
    path = await realpath(lexical);
  } catch {
    throw new Error(`Artifact reference ${reference} is missing.`);
  }
  if (repositoryRelative(buildRoot, path) === null) {
    throw new Error(`Artifact reference ${reference} resolves outside the build directory.`);
  }
  return path;
}

function htmlModuleScripts(source) {
  return [
    ...source.matchAll(
      /<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
    ),
  ].map((match) => match[1]);
}

function staticImports(source) {
  const references = [];
  const pattern = /\b(?:import|export)\s*(?:[^'";()]*?\bfrom\s*)?["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1].startsWith('.') || match[1].startsWith('/')) references.push(match[1]);
  }
  return references;
}
