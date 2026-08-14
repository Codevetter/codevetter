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
  let buildRoot;
  try {
    buildRoot = await containedDirectory(repositoryRoot, buildDirectory);
  } catch (error) {
    return incomplete(entry, [], 0, 0, [...limitations, error.message]);
  }
  const closure = await readArtifactClosure(buildRoot, entry);
  limitations.push(...closure.limitations);
  return artifactResult(entry, closure, limitations);
}

async function readArtifactClosure(buildRoot, entry) {
  const files = [];
  const limitations = [];
  let rawBytes = 0;
  let gzipBytes = 0;
  const queue = [{ reference: entry, importer: buildRoot, depth: 0, kind: 'html' }];
  const visited = new Set();
  while (queue.length > 0) {
    const item = queue.shift();
    const result = await readClosureItem({ buildRoot, item, visited, files, rawBytes });
    if (result.stop) {
      limitations.push(result.limitation);
      break;
    }
    if (result.limitation) limitations.push(result.limitation);
    if (!result.file) continue;
    visited.add(result.file.file);
    files.push(result.file);
    rawBytes += result.file.raw_bytes;
    gzipBytes += result.file.gzip_bytes;
    limitations.push(...result.limitations);
    for (const reference of result.references) {
      queue.push({
        reference,
        importer: result.importer,
        depth: item.depth + 1,
        kind: 'javascript',
      });
    }
  }
  return { files, rawBytes, gzipBytes, limitations };
}

async function readClosureItem({ buildRoot, item, visited, files, rawBytes }) {
  if (item.depth > ARTIFACT_LIMITS.depth) {
    return {
      stop: true,
      limitation: `Initial JavaScript closure exceeded depth ${ARTIFACT_LIMITS.depth}.`,
    };
  }
  let path;
  try {
    path = await resolveArtifactReference(buildRoot, item.importer, item.reference);
  } catch (error) {
    return { limitation: error.message };
  }
  const relative = repositoryRelative(buildRoot, path);
  if (relative === null || visited.has(relative)) return {};
  if (files.length >= ARTIFACT_LIMITS.files) {
    return {
      stop: true,
      limitation: `Initial JavaScript closure exceeded ${ARTIFACT_LIMITS.files} files.`,
    };
  }
  const content = await readArtifactFile(path, relative, rawBytes);
  if (content.limitation || content.stop) return content;
  const source = content.bytes.toString('utf8');
  return {
    file: {
      file: relative,
      raw_bytes: content.bytes.byteLength,
      gzip_bytes: gzipSync(content.bytes, { level: 9 }).byteLength,
    },
    importer: dirname(path),
    references: item.kind === 'html' ? htmlModuleScripts(source) : staticImports(source),
    limitations:
      item.kind === 'javascript' && /\bimport\s*\(/.test(source)
        ? [`Dynamic imports in ${relative} were not included in the initial closure.`]
        : [],
  };
}

async function readArtifactFile(path, relative, rawBytes) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile()) throw new Error('not a regular file');
    if (rawBytes + metadata.size > ARTIFACT_LIMITS.bytes) {
      return {
        stop: true,
        limitation: `Initial JavaScript closure exceeded ${ARTIFACT_LIMITS.bytes} raw bytes.`,
      };
    }
    return { bytes: await readFile(path) };
  } catch {
    return { limitation: `Artifact file ${relative} could not be read.` };
  }
}

function artifactResult(entry, closure, limitations) {
  return {
    entry,
    complete: closure.limitations.length === 0,
    file_count: closure.files.length,
    raw_bytes: closure.rawBytes,
    gzip_bytes: closure.gzipBytes,
    files: closure.files,
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
