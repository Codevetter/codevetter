import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

import { repositoryRelative } from './contracts.mjs';

export const NEXT_ROUTE_OWNERSHIP_SCHEMA_VERSION = 'runtime-next-route-ownership/v1';
export const NEXT_ROUTE_OWNERSHIP_LIMITS = Object.freeze({
  files: 256,
  depth: 12,
  fileBytes: 256 * 1024,
  sourceBytes: 2 * 1024 * 1024,
});

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const ROUTE_ROOTS = [
  { path: 'app', router: 'app' },
  { path: 'src/app', router: 'app' },
  { path: 'pages', router: 'pages' },
  { path: 'src/pages', router: 'pages' },
];

export async function resolveNextRouteOwnership(packageRoot, requests) {
  const root = await realpath(resolve(packageRoot));
  const inventory = await collectRouteCandidates(root);
  if (!inventory.complete) {
    return (Array.isArray(requests) ? requests : []).map(() => null);
  }
  const candidates = inventory.candidates;
  return (Array.isArray(requests) ? requests : []).map((request) => {
    if (!safeRequest(request)) return null;
    const matches = candidates.filter(
      (candidate) =>
        candidate.methods.has(request.method) && routeMatches(candidate.segments, request.route)
    );
    if (matches.length !== 1) return null;
    const candidate = matches[0];
    return {
      file: candidate.file,
      line: candidate.lines.get(request.method) ?? candidate.lines.get('GET') ?? 1,
      function: candidate.functionNames.get(request.method) ?? null,
      provenance: 'static_unique_next_route',
    };
  });
}

async function collectRouteCandidates(root) {
  const candidates = [];
  const inventory = { files: 0, sourceBytes: 0, complete: true };
  for (const routeRoot of ROUTE_ROOTS) {
    const directory = resolve(root, routeRoot.path);
    if (repositoryRelative(root, directory) === null) continue;
    await walk(
      directory,
      0,
      async (path) => {
        const metadata = await lstat(path).catch(() => null);
        const descriptor = routeDescriptor(root, directory, routeRoot.router, path);
        if (!descriptor) return true;
        inventory.files += 1;
        if (
          inventory.files > NEXT_ROUTE_OWNERSHIP_LIMITS.files ||
          !metadata?.isFile() ||
          metadata.isSymbolicLink() ||
          metadata.size > NEXT_ROUTE_OWNERSHIP_LIMITS.fileBytes ||
          inventory.sourceBytes + metadata.size > NEXT_ROUTE_OWNERSHIP_LIMITS.sourceBytes
        ) {
          inventory.complete = false;
          return false;
        }
        const source = await readFile(path, 'utf8').catch(() => null);
        if (source === null) {
          inventory.complete = false;
          return false;
        }
        inventory.sourceBytes += metadata.size;
        const authority = methodAuthority(descriptor, source);
        if (authority.methods.size > 0) candidates.push({ ...descriptor, ...authority });
        return true;
      },
      () => {
        inventory.complete = false;
      }
    );
    if (!inventory.complete) break;
  }
  return { candidates, complete: inventory.complete };
}

async function walk(directory, depth, visit, onDepthExceeded) {
  if (depth > NEXT_ROUTE_OWNERSHIP_LIMITS.depth) {
    onDepthExceeded();
    return false;
  }
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!(await walk(path, depth + 1, visit, onDepthExceeded))) return false;
    } else if ((await visit(path)) === false) return false;
  }
  return true;
}

function routeDescriptor(root, routeRoot, router, path) {
  const extension = extname(path);
  if (!SOURCE_EXTENSIONS.has(extension)) return null;
  const relativePath = relative(routeRoot, path).split(sep).join('/');
  const withoutExtension = relativePath.slice(0, -extension.length);
  const parts = withoutExtension.split('/');
  const filename = parts.at(-1);
  let routeParts;
  let kind;
  if (router === 'app') {
    if (!['page', 'route'].includes(filename)) return null;
    kind = filename;
    routeParts = parts.slice(0, -1);
  } else {
    if (filename.startsWith('_')) return null;
    kind = parts[0] === 'api' ? 'pages_api' : 'pages_page';
    routeParts = parts;
    if (routeParts.at(-1) === 'index') routeParts = routeParts.slice(0, -1);
  }
  const segments = routeParts.flatMap((part) => normalizeRoutePart(part));
  if (segments === null || segments.some((segment) => segment === null)) return null;
  return {
    file: relative(root, path).split(sep).join('/'),
    kind,
    segments,
  };
}

function normalizeRoutePart(part) {
  if (/^\([^/]+\)$/.test(part) || /^@[^/]+$/.test(part)) return [];
  if (/^\[\[\.\.\.[A-Za-z0-9_]+\]\]$/.test(part)) return [{ kind: 'optional_catch_all' }];
  if (/^\[\.\.\.[A-Za-z0-9_]+\]$/.test(part)) return [{ kind: 'catch_all' }];
  if (/^\[[A-Za-z0-9_]+\]$/.test(part)) return [{ kind: 'dynamic' }];
  if (!/^[A-Za-z0-9._~-]+$/.test(part)) return [null];
  return [{ kind: 'static', value: part }];
}

function methodAuthority(descriptor, source) {
  const methods = new Set();
  const lines = new Map();
  const functionNames = new Map();
  if (descriptor.kind === 'page' || descriptor.kind === 'pages_page') {
    methods.add('GET');
    methods.add('HEAD');
    lines.set('GET', defaultExportLine(source));
    lines.set('HEAD', defaultExportLine(source));
    return { methods, lines, functionNames };
  }
  if (descriptor.kind === 'pages_api') {
    for (const method of HTTP_METHODS) methods.add(method);
    const line = defaultExportLine(source);
    for (const method of HTTP_METHODS) lines.set(method, line);
    return { methods, lines, functionNames };
  }
  for (const match of source.matchAll(
    /^\s*export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm
  )) {
    const method = match[1];
    methods.add(method);
    lines.set(method, source.slice(0, match.index).split(/\r?\n/).length);
    functionNames.set(method, method);
  }
  for (const match of source.matchAll(
    /^\s*export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=/gm
  )) {
    const method = match[1];
    methods.add(method);
    lines.set(method, source.slice(0, match.index).split(/\r?\n/).length);
    functionNames.set(method, method);
  }
  return { methods, lines, functionNames };
}

function defaultExportLine(source) {
  const match = /^\s*export\s+default\b/m.exec(source);
  return match ? source.slice(0, match.index).split(/\r?\n/).length : 1;
}

function routeMatches(pattern, route) {
  const parts = route.split('/').filter(Boolean);
  return matchSegments(pattern, parts, 0, 0);
}

function matchSegments(pattern, parts, patternIndex, partIndex) {
  if (patternIndex === pattern.length) return partIndex === parts.length;
  const segment = pattern[patternIndex];
  if (segment.kind === 'optional_catch_all') {
    return (
      matchSegments(pattern, parts, patternIndex + 1, partIndex) ||
      (partIndex < parts.length && matchSegments(pattern, parts, patternIndex, partIndex + 1))
    );
  }
  if (segment.kind === 'catch_all') {
    return (
      partIndex < parts.length &&
      (patternIndex === pattern.length - 1 ||
        matchSegments(pattern, parts, patternIndex + 1, partIndex + 1) ||
        matchSegments(pattern, parts, patternIndex, partIndex + 1))
    );
  }
  if (partIndex >= parts.length) return false;
  if (segment.kind === 'static' && segment.value !== parts[partIndex]) return false;
  return matchSegments(pattern, parts, patternIndex + 1, partIndex + 1);
}

function safeRequest(request) {
  return (
    HTTP_METHODS.has(request?.method) &&
    typeof request.route === 'string' &&
    request.route.startsWith('/') &&
    !request.route.includes('?') &&
    request.route.length <= 256
  );
}
