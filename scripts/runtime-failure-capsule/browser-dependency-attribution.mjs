import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

import {
  BROWSER_OPTIMIZATION_LIMITS,
  assertContainedOptionalPath,
  browserOptimizationId,
} from './browser-optimization-contracts.mjs';

const SOURCE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs'];
const SENSITIVE_NAMES = new Set(['.npmrc', '.pypirc', '.netrc', 'credentials.json']);

export async function analyzeBrowserDependencies({
  repositoryRoot,
  entry = null,
  buildDirectory = null,
  subject = null,
  artifactAttestation = null,
}) {
  const root = await realpath(resolve(repositoryRoot));
  const entryPath = entry
    ? assertContainedOptionalPath(entry, 'entry')
    : await discoverBrowserEntry(root);
  const graph = entryPath
    ? await buildLiteralImportGraph(root, entryPath)
    : unavailableGraph('No bounded literal browser entry was found.');
  const config = await inspectViteManualChunks(root, graph.packages);
  const artifact = buildDirectory
    ? await inspectBuildArtifact({
        repositoryRoot: root,
        buildDirectory,
        subject,
        artifactAttestation,
      })
    : unavailableArtifact('No build artifact directory was declared.');
  return {
    schema_version: 'browser-dependency-attribution/v1',
    entry: entryPath,
    graph,
    vite: config,
    artifact,
    observations: dependencyObservations({ graph, config, artifact }),
    limitations: [
      'Literal static imports do not prove framework-generated or runtime-computed dependency edges.',
      ...(config.state === 'incomplete'
        ? ['Unsupported Vite configuration syntax was not evaluated.']
        : []),
      ...(artifact.state === 'observed' && artifact.verified === false
        ? ['The build artifact is hashed but is not bound to the current source snapshot.']
        : []),
    ],
  };
}

export async function discoverBrowserEntry(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const indexPath = join(root, 'index.html');
  let html;
  try {
    html = await boundedRead(indexPath, 256 * 1024);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  for (const match of html.matchAll(
    /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/gi
  )) {
    const candidate = normalizeAssetRoute(match[1]);
    if (!candidate || candidate.startsWith('@') || /^https?:/i.test(candidate)) continue;
    const absolute = resolve(root, candidate);
    if (contained(root, absolute) && (await regularFile(absolute)))
      return relativePath(root, absolute);
  }
  return null;
}

export async function buildLiteralImportGraph(repositoryRoot, entry) {
  const root = await realpath(resolve(repositoryRoot));
  const safeEntry = assertContainedOptionalPath(entry, 'entry');
  const entryAbsolute = await resolveSourceFile(root, resolve(root, safeEntry));
  if (!entryAbsolute) throw new Error('browser entry does not resolve to a contained source file');

  const queue = [entryAbsolute];
  const deferredQueue = [];
  const visited = new Set();
  const deferredVisited = new Set();
  const files = [];
  const edges = [];
  const deferredEdges = [];
  const packages = new Map();
  let totalBytes = 0;
  let truncated = false;

  while (queue.length > 0) {
    const absolute = queue.shift();
    const path = relativePath(root, absolute);
    if (visited.has(path)) continue;
    if (visited.size >= BROWSER_OPTIMIZATION_LIMITS.importFiles) {
      truncated = true;
      break;
    }
    visited.add(path);
    const source = await boundedRead(absolute, 512 * 1024);
    totalBytes += Buffer.byteLength(source);
    if (totalBytes > BROWSER_OPTIMIZATION_LIMITS.sourceBytes) {
      truncated = true;
      break;
    }
    files.push(path);
    for (const declaration of literalImports(source)) {
      if (edges.length >= BROWSER_OPTIMIZATION_LIMITS.importEdges) {
        truncated = true;
        break;
      }
      const specifier = declaration.specifier;
      if (isBareSpecifier(specifier)) {
        const packageName = packageFromSpecifier(specifier);
        const resolvedPath = await resolvePackageRealPath(root, packageName);
        const prior = packages.get(packageName);
        packages.set(packageName, {
          package: packageName,
          resolved_path: resolvedPath,
          imported_by: [...new Set([...(prior?.imported_by ?? []), path])].toSorted(),
          static_imported_by:
            declaration.kind === 'static'
              ? [...new Set([...(prior?.static_imported_by ?? []), path])].toSorted()
              : (prior?.static_imported_by ?? []),
          deferred_imported_by:
            declaration.kind === 'dynamic'
              ? [...new Set([...(prior?.deferred_imported_by ?? []), path])].toSorted()
              : (prior?.deferred_imported_by ?? []),
          static: (prior?.static ?? false) || declaration.kind === 'static',
        });
        edges.push({ from: path, to: packageName, kind: declaration.kind, external: true });
        continue;
      }
      const resolved = await resolveImport(root, absolute, specifier);
      edges.push({
        from: path,
        to: resolved ? relativePath(root, resolved) : specifier,
        kind: declaration.kind,
        external: false,
      });
      if (resolved && declaration.kind === 'static') queue.push(resolved);
      if (resolved && declaration.kind === 'dynamic') deferredQueue.push(resolved);
    }
    if (truncated) break;
  }

  while (!truncated && deferredQueue.length > 0) {
    const absolute = deferredQueue.shift();
    const path = relativePath(root, absolute);
    if (visited.has(path) || deferredVisited.has(path)) continue;
    if (visited.size + deferredVisited.size >= BROWSER_OPTIMIZATION_LIMITS.importFiles) {
      truncated = true;
      break;
    }
    deferredVisited.add(path);
    const source = await boundedRead(absolute, 512 * 1024);
    totalBytes += Buffer.byteLength(source);
    if (totalBytes > BROWSER_OPTIMIZATION_LIMITS.sourceBytes) {
      truncated = true;
      break;
    }
    for (const declaration of literalImports(source)) {
      if (edges.length + deferredEdges.length >= BROWSER_OPTIMIZATION_LIMITS.importEdges) {
        truncated = true;
        break;
      }
      const specifier = declaration.specifier;
      if (isBareSpecifier(specifier)) {
        const packageName = packageFromSpecifier(specifier);
        const resolvedPath = await resolvePackageRealPath(root, packageName);
        const prior = packages.get(packageName);
        packages.set(packageName, {
          package: packageName,
          resolved_path: resolvedPath,
          imported_by: [...new Set([...(prior?.imported_by ?? []), path])].toSorted(),
          static_imported_by: prior?.static_imported_by ?? [],
          deferred_imported_by: [
            ...new Set([...(prior?.deferred_imported_by ?? []), path]),
          ].toSorted(),
          static: prior?.static ?? false,
        });
        deferredEdges.push({
          from: path,
          to: packageName,
          kind: declaration.kind,
          external: true,
        });
        continue;
      }
      const resolved = await resolveImport(root, absolute, specifier);
      deferredEdges.push({
        from: path,
        to: resolved ? relativePath(root, resolved) : specifier,
        kind: declaration.kind,
        external: false,
      });
      if (resolved) deferredQueue.push(resolved);
    }
  }

  return {
    state: truncated ? 'incomplete' : 'observed',
    entry: relativePath(root, entryAbsolute),
    files: files.toSorted(),
    edges,
    deferred_files: [...deferredVisited].toSorted(),
    deferred_edges: deferredEdges,
    packages: [...packages.values()].toSorted((a, b) => a.package.localeCompare(b.package)),
    inventory: {
      files: files.length,
      edges: edges.length,
      packages: packages.size,
      deferred_files: deferredVisited.size,
      deferred_edges: deferredEdges.length,
      source_bytes: totalBytes,
      complete: !truncated,
    },
    provenance: 'bounded_literal_static_import_graph',
  };
}

export async function inspectViteManualChunks(repositoryRoot, packages) {
  const root = resolve(repositoryRoot);
  const configPath = await firstRegularFile(
    ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'].map((path) =>
      join(root, path)
    )
  );
  if (!configPath) {
    return {
      state: 'unavailable',
      source: null,
      rules: [],
      matches: [],
      unsupported: [],
      provenance: 'static_vite_manual_chunks_subset',
    };
  }
  const source = await boundedRead(configPath, 512 * 1024);
  return inspectViteManualChunksSource(source, packages, relativePath(root, configPath));
}

export function inspectViteManualChunksSource(source, packages, sourcePath = 'vite.config.ts') {
  const parsed = extractManualChunkRules(source);
  const matches = [];
  for (const dependency of packages) {
    for (const rule of parsed.rules) {
      const evaluation = evaluateChunkCondition(rule.condition, {
        id: dependency.resolved_path,
        packagePath: packagePathFromId(dependency.resolved_path),
      });
      if (evaluation.supported && evaluation.value) {
        const pathOnlyMatch =
          evaluation.literals.some(
            (literal) =>
              dependency.resolved_path.includes(literal) && !dependency.package.includes(literal)
          ) && !evaluation.literals.some((literal) => dependency.package.includes(literal));
        matches.push({
          rule_id: rule.rule_id,
          line: rule.line,
          condition: rule.condition,
          chunk: rule.chunk,
          package: dependency.package,
          resolved_path: dependency.resolved_path,
          initial_route_static: dependency.static,
          path_only_match: pathOnlyMatch,
          surprising: surprisingChunkMatch(rule.chunk, dependency.package, pathOnlyMatch),
        });
        break;
      }
    }
  }
  return {
    state: parsed.unsupported.length > 0 ? 'incomplete' : 'observed',
    source: assertContainedOptionalPath(sourcePath, 'Vite config source'),
    rules: parsed.rules,
    matches,
    unsupported: parsed.unsupported,
    provenance: 'static_vite_manual_chunks_subset',
  };
}

export function extractManualChunkRules(source) {
  if (typeof source !== 'string' || source.length > 512 * 1024) {
    throw new Error('Vite config source must be bounded text');
  }
  const anchor = source.indexOf('manualChunks');
  if (anchor === -1) return { rules: [], unsupported: [] };
  const rules = [];
  const unsupported = [];
  let cursor = anchor;
  while ((cursor = findIfToken(source, cursor)) !== -1) {
    const open = source.indexOf('(', cursor + 2);
    if (open === -1) break;
    const close = matchingParen(source, open);
    if (close === -1) {
      unsupported.push({ line: lineAt(source, cursor), reason: 'unclosed_if_condition' });
      break;
    }
    const after = source.slice(close + 1, close + 401);
    const returnMatch = after.match(/^\s*(?:\{\s*)?return\s+['"]([^'"]+)['"]\s*;/);
    if (!returnMatch) {
      cursor = close + 1;
      continue;
    }
    const condition = source.slice(open + 1, close).trim();
    const evaluation = evaluateChunkCondition(condition, { id: '', packagePath: '' });
    if (!evaluation.supported) {
      unsupported.push({
        line: lineAt(source, cursor),
        reason: 'unsupported_condition',
        condition: boundedText(condition, 240),
      });
    } else {
      const line = lineAt(source, cursor);
      rules.push({
        rule_id: browserOptimizationId(`${line}\0${condition}\0${returnMatch[1]}`),
        line,
        condition,
        chunk: returnMatch[1],
        literals: evaluation.literals,
      });
    }
    cursor = close + returnMatch.index + returnMatch[0].length;
  }
  return { rules, unsupported };
}

export function evaluateChunkCondition(expression, variables) {
  const literals = [];
  try {
    const value = evaluateBoolean(stripOuterParens(expression.trim()), variables, literals);
    return { supported: true, value, literals: [...new Set(literals)] };
  } catch {
    return { supported: false, value: false, literals: [] };
  }
}

async function inspectBuildArtifact({
  repositoryRoot,
  buildDirectory,
  subject,
  artifactAttestation,
}) {
  const safeDirectory = assertContainedOptionalPath(buildDirectory, 'build_directory');
  const absolute = resolve(repositoryRoot, safeDirectory);
  const real = await realpath(absolute).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!real) return unavailableArtifact('The declared build artifact does not exist.');
  if (!contained(repositoryRoot, real))
    throw new Error('build artifact directory escapes repository');
  const indexPath = join(real, 'index.html');
  if (!(await regularFile(indexPath))) {
    return unavailableArtifact('The declared build artifact has no index.html.');
  }
  const html = await boundedRead(indexPath, 512 * 1024);
  const entries = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js)["']/gi)]
    .map((match) => normalizeAssetRoute(match[1]))
    .filter(Boolean);
  const queue = entries.map((entry) => resolve(real, entry));
  const visited = new Set();
  const chunks = [];
  let totalBytes = 0;
  while (queue.length > 0) {
    if (visited.size >= BROWSER_OPTIMIZATION_LIMITS.artifactFiles) {
      return incompleteArtifact(chunks, totalBytes, 'Build artifact file inventory exceeded.');
    }
    const path = queue.shift();
    if (!contained(real, path)) throw new Error('build artifact import escapes its directory');
    const relativeChunk = relativePath(real, path);
    if (visited.has(relativeChunk)) continue;
    visited.add(relativeChunk);
    const bytes = await readFile(path);
    totalBytes += bytes.length;
    if (totalBytes > BROWSER_OPTIMIZATION_LIMITS.artifactBytes) {
      return incompleteArtifact(chunks, totalBytes, 'Build artifact bytes exceeded the bound.');
    }
    const source = bytes.toString('utf8');
    const imports = [...source.matchAll(/(?:from\s*|import\s*)["']\.\/([^"']+\.js)["']/g)].map(
      (match) => match[1]
    );
    chunks.push({
      path: relativeChunk,
      bytes: bytes.length,
      gzip_bytes: gzipSync(bytes).length,
      imports: imports.toSorted(),
    });
    for (const imported of imports) queue.push(resolve(dirname(path), imported));
  }
  const artifactDigest = await digestFiles(
    real,
    chunks.map((chunk) => chunk.path)
  );
  const verified = Boolean(
    subject?.source_snapshot_sha256 &&
      artifactAttestation?.source_snapshot_sha256 === subject.source_snapshot_sha256 &&
      artifactAttestation?.artifact_sha256 === artifactDigest
  );
  return {
    state: 'observed',
    directory: safeDirectory,
    entry_chunks: entries,
    chunks,
    total_bytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
    total_gzip_bytes: chunks.reduce((sum, chunk) => sum + chunk.gzip_bytes, 0),
    artifact_sha256: artifactDigest,
    verified,
    reason: verified ? null : 'artifact_not_bound_to_source_snapshot',
    provenance: verified
      ? 'attested_static_build_chunk_closure'
      : 'unverified_static_build_chunk_closure',
  };
}

function dependencyObservations({ graph, config, artifact }) {
  const observations = [];
  for (const match of config.matches.filter((entry) => entry.surprising)) {
    observations.push({
      observation_id: browserOptimizationId(
        `chunk-rule\0${match.rule_id}\0${match.package}\0${match.chunk}`
      ),
      family: 'dependencies',
      kind: 'surprising_chunk_rule_match',
      source: config.source,
      metric: {
        package: match.package,
        chunk: match.chunk,
        rule_line: match.line,
        path_only_match: match.path_only_match,
        initial_route_static: match.initial_route_static,
        affected_bytes: artifactBytesForChunk(artifact, match.chunk),
      },
      provenance: config.provenance,
      verified: graph.state === 'observed' && config.state === 'observed',
    });
  }
  if (artifact.state === 'observed') {
    observations.push({
      observation_id: browserOptimizationId(`artifact-summary\0${artifact.artifact_sha256}`),
      family: 'build_artifact',
      kind: 'initial_route_artifact_summary',
      source: null,
      metric: {
        total_bytes: artifact.total_bytes,
        total_gzip_bytes: artifact.total_gzip_bytes,
        artifact_sha256: artifact.artifact_sha256,
      },
      provenance: artifact.provenance,
      verified: artifact.verified,
    });
    for (const chunk of artifact.chunks) {
      observations.push({
        observation_id: browserOptimizationId(
          `artifact-chunk\0${artifact.artifact_sha256}\0${chunk.path}`
        ),
        family: 'build_artifact',
        kind: 'initial_route_chunk',
        source: null,
        metric: { path: chunk.path, bytes: chunk.bytes, gzip_bytes: chunk.gzip_bytes },
        provenance: artifact.provenance,
        verified: artifact.verified,
      });
    }
  }
  return observations.slice(0, BROWSER_OPTIMIZATION_LIMITS.observations);
}

function artifactBytesForChunk(artifact, chunkLabel) {
  if (artifact.state !== 'observed') return null;
  const match = artifact.chunks.find((chunk) =>
    chunk.path.split('/').at(-1)?.startsWith(`${chunkLabel}-`)
  );
  return match?.bytes ?? null;
}

function literalImports(source) {
  const declarations = [];
  const dynamicRanges = [];
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    declarations.push({ specifier: match[1], kind: 'dynamic' });
    dynamicRanges.push([match.index, match.index + match[0].length]);
  }
  const pattern = /\b(?:import|export)\s+(?!type\b)(?:[^;'"`]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (dynamicRanges.some(([start, end]) => match.index >= start && match.index < end)) continue;
    declarations.push({ specifier: match[1], kind: 'static' });
  }
  return declarations;
}

async function resolveImport(root, importer, specifier) {
  const base = specifier.startsWith('@/')
    ? resolve(root, specifier.slice(2))
    : specifier.startsWith('/')
      ? resolve(root, specifier.slice(1))
      : resolve(dirname(importer), specifier);
  if (!contained(root, base)) return null;
  return resolveSourceFile(root, base);
}

async function resolveSourceFile(root, base) {
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (contained(root, candidate) && (await regularFile(candidate))) return realpath(candidate);
  }
  for (const name of INDEX_FILES) {
    const candidate = join(base, name);
    if (contained(root, candidate) && (await regularFile(candidate))) return realpath(candidate);
  }
  return null;
}

async function resolvePackageRealPath(root, packageName) {
  const candidate = resolve(root, 'node_modules', packageName);
  try {
    const real = await realpath(candidate);
    return real;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return candidate;
  }
}

function packageFromSpecifier(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isBareSpecifier(value) {
  return !value.startsWith('.') && !value.startsWith('/') && !value.startsWith('@/');
}

function evaluateBoolean(expression, variables, literals) {
  const outer = stripOuterParens(expression);
  const or = splitTopLevel(outer, '||');
  if (or.length > 1) return or.some((entry) => evaluateBoolean(entry, variables, literals));
  const and = splitTopLevel(outer, '&&');
  if (and.length > 1) return and.every((entry) => evaluateBoolean(entry, variables, literals));
  if (outer.startsWith('!')) return !evaluateBoolean(outer.slice(1), variables, literals);
  const call = outer.match(
    /^(\w+)(?:\?\.)?\.(includes|startsWith|endsWith)\(\s*(['"])([^'"]+)\3\s*\)$/
  );
  if (call) {
    const value = variables[call[1]];
    if (typeof value !== 'string') throw new Error('unknown variable');
    literals.push(call[4]);
    return value[call[2]](call[4]);
  }
  const equality = outer.match(/^(\w+)\s*(===|==)\s*(['"])([^'"]+)\3$/);
  if (equality) {
    const value = variables[equality[1]];
    if (typeof value !== 'string') throw new Error('unknown variable');
    literals.push(equality[4]);
    return value === equality[4];
  }
  if (outer === 'true') return true;
  if (outer === 'false') return false;
  throw new Error('unsupported condition');
}

function splitTopLevel(value, operator) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (depth === 0 && value.startsWith(operator, index)) {
      parts.push(value.slice(start, index).trim());
      start = index + operator.length;
      index += operator.length - 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function stripOuterParens(value) {
  let result = value.trim();
  while (result.startsWith('(') && matchingParen(result, 0) === result.length - 1) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

function matchingParen(source, open) {
  let depth = 0;
  let quote = null;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(') depth += 1;
    else if (character === ')' && --depth === 0) return index;
  }
  return -1;
}

function findIfToken(source, from) {
  const match = /\bif\s*\(/g;
  match.lastIndex = from;
  const result = match.exec(source);
  return result?.index ?? -1;
}

function surprisingChunkMatch(chunk, packageName, pathOnlyMatch) {
  if (pathOnlyMatch) return true;
  const normalized = chunk.toLowerCase();
  if (normalized === 'react') return !['react', 'react-dom'].includes(packageName);
  if (normalized === 'router') return !packageName.includes('router');
  return false;
}

function packagePathFromId(id) {
  return id.split('/node_modules/').at(-1) ?? id;
}

async function boundedRead(path, maximum) {
  assertNonSensitive(path);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximum) {
    throw new Error('bounded source input is not a supported regular file');
  }
  return readFile(path, 'utf8');
}

function assertNonSensitive(path) {
  const parts = resolve(path).toLowerCase().split(sep);
  const name = parts.at(-1);
  if (
    parts.some((part) => ['.ssh', '.aws', '.kube'].includes(part)) ||
    /^\.env(?:\.|$)/.test(name) ||
    SENSITIVE_NAMES.has(name) ||
    /\.(?:key|pem|p12|pfx)$/.test(name)
  ) {
    throw new Error('sensitive input path was not read');
  }
}

async function firstRegularFile(paths) {
  for (const path of paths) if (await regularFile(path)) return path;
  return null;
}

async function regularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function normalizeAssetRoute(value) {
  if (typeof value !== 'string' || value.includes('\0')) return null;
  const clean = value.split(/[?#]/)[0].replace(/^\.\//, '').replace(/^\//, '');
  if (!clean || clean.split('/').includes('..')) return null;
  return clean;
}

function contained(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsoluteLike(rel));
}

function isAbsoluteLike(value) {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function relativePath(root, path) {
  const value = relative(resolve(root), resolve(path)).replaceAll('\\', '/');
  if (!value || value.startsWith('../') || value === '..') throw new Error('path escapes root');
  return value;
}

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function boundedText(value, maximum) {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

async function digestFiles(root, paths) {
  const hash = createHash('sha256');
  for (const path of paths.toSorted()) {
    hash.update(path);
    hash.update('\0');
    await hashFile(hash, resolve(root, path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function hashFile(hash, path) {
  return new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolvePromise);
  });
}

function unavailableGraph(reason) {
  return {
    state: 'unavailable',
    entry: null,
    files: [],
    edges: [],
    deferred_files: [],
    deferred_edges: [],
    packages: [],
    inventory: {
      files: 0,
      edges: 0,
      packages: 0,
      deferred_files: 0,
      deferred_edges: 0,
      source_bytes: 0,
      complete: false,
    },
    reason,
    provenance: 'bounded_literal_static_import_graph',
  };
}

function unavailableArtifact(reason) {
  return {
    state: 'unavailable',
    directory: null,
    entry_chunks: [],
    chunks: [],
    total_bytes: null,
    total_gzip_bytes: null,
    artifact_sha256: null,
    verified: false,
    reason,
    provenance: 'unavailable_static_build_chunk_closure',
  };
}

function incompleteArtifact(chunks, totalBytes, reason) {
  return {
    state: 'incomplete',
    directory: null,
    entry_chunks: [],
    chunks,
    total_bytes: totalBytes,
    total_gzip_bytes: null,
    artifact_sha256: null,
    verified: false,
    reason,
    provenance: 'bounded_static_build_chunk_closure',
  };
}
