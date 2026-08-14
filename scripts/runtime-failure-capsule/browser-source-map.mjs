import { lstat, readFile, realpath } from 'node:fs/promises';
import { get } from 'node:http';
import { SourceMap } from 'node:module';
import { extname, posix, resolve } from 'node:path';

import { EXCLUDED_PATH_PARTS, repositoryRelative } from './contracts.mjs';

export const BROWSER_SOURCE_MAP_SCHEMA_VERSION = 'runtime-browser-source-map/v1';
export const BROWSER_SOURCE_MAP_LIMITS = Object.freeze({
  candidates: 4,
  responseBytes: 2 * 1024 * 1024,
  mapBytes: 1024 * 1024,
  requestTimeoutMs: 1_000,
  sources: 128,
  names: 20_000,
});

const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const JAVASCRIPT_CONTENT_TYPE = /(?:java|type)script/i;
const INLINE_SOURCE_MAP =
  /\/\/[#@]\s*sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/;

export function createLocalBrowserSourceMapLoader({ baseUrl }) {
  const base = parseExactLoopbackOrigin(baseUrl);
  return async function loadLocalBrowserSource({ url }) {
    const target = sameOriginSourceUrl(base, url);
    if (!target) return null;
    return readBoundedModule(target);
  };
}

export async function mapBrowserGeneratedLocation({
  repositoryRoot,
  transformedSource,
  generatedFile,
  generatedLine,
  generatedColumn,
}) {
  if (
    typeof transformedSource !== 'string' ||
    Buffer.byteLength(transformedSource) > BROWSER_SOURCE_MAP_LIMITS.responseBytes ||
    typeof generatedFile !== 'string' ||
    !Number.isInteger(generatedLine) ||
    generatedLine < 0 ||
    !Number.isInteger(generatedColumn) ||
    generatedColumn < 0
  ) {
    return null;
  }
  const payload = inlineSourceMapPayload(transformedSource);
  if (!payload) return null;
  let entry;
  try {
    entry = new SourceMap(payload).findEntry(generatedLine, generatedColumn);
  } catch {
    return null;
  }
  if (
    entry?.generatedLine !== generatedLine ||
    !Number.isInteger(entry.generatedColumn) ||
    entry.generatedColumn > generatedColumn ||
    typeof entry.originalSource !== 'string' ||
    !Number.isInteger(entry.originalLine) ||
    entry.originalLine < 0 ||
    !Number.isInteger(entry.originalColumn) ||
    entry.originalColumn < 0
  ) {
    return null;
  }
  const sourceIndex = sourceIndexForEntry(payload, entry.originalSource);
  if (sourceIndex === null || typeof payload.sourcesContent[sourceIndex] !== 'string') return null;
  let root;
  try {
    root = await realpath(resolve(repositoryRoot));
  } catch {
    return null;
  }
  const source = await containedOriginalSource({
    root,
    generatedFile,
    sourceRoot: payload.sourceRoot,
    originalSource: payload.sources[sourceIndex],
  });
  if (!source) return null;
  let current;
  try {
    current = await readFile(source.path);
  } catch {
    return null;
  }
  const embedded = Buffer.from(payload.sourcesContent[sourceIndex], 'utf8');
  if (!current.equals(embedded)) return null;
  const lineCount = payload.sourcesContent[sourceIndex].split(/\r?\n/).length;
  if (entry.originalLine >= lineCount) return null;
  return {
    schema_version: BROWSER_SOURCE_MAP_SCHEMA_VERSION,
    file: source.file,
    line: entry.originalLine + 1,
    function:
      typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name.slice(0, 200) : null,
    provenance: 'browser_inline_source_map_verified',
  };
}

function parseExactLoopbackOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('browser source-map origin is invalid');
  }
  if (
    url.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('browser source-map origin is not exact loopback HTTP');
  }
  return url;
}

function sameOriginSourceUrl(base, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    url.hash ||
    !sourceLikeUrlPath(url.pathname)
  ) {
    return null;
  }
  return url;
}

function sourceLikeUrlPath(value) {
  let pathname;
  try {
    pathname = decodeURIComponent(value).replace(/^\/+/, '');
  } catch {
    return false;
  }
  return (
    pathname.length > 0 &&
    pathname.length <= 2_000 &&
    !pathname.includes('\\') &&
    !pathname.startsWith('@fs/') &&
    !pathname.startsWith('@id/') &&
    !pathname.split('/').includes('..') &&
    !pathname.split('/').some((part) => EXCLUDED_PATH_PARTS.includes(part)) &&
    SOURCE_EXTENSIONS.has(extname(pathname))
  );
}

function readBoundedModule(url) {
  return new Promise((resolvePromise) => {
    let finished = false;
    let deadline = null;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      if (deadline !== null) clearTimeout(deadline);
      resolvePromise(value);
    };
    const request = get(
      url,
      {
        agent: false,
        headers: { accept: 'application/javascript,text/javascript,*/*;q=0.1' },
      },
      (response) => {
        if (
          response.statusCode !== 200 ||
          !JAVASCRIPT_CONTENT_TYPE.test(String(response.headers['content-type'] ?? '')) ||
          numericHeader(response.headers['content-length']) >
            BROWSER_SOURCE_MAP_LIMITS.responseBytes
        ) {
          response.resume();
          finish(null);
          return;
        }
        const chunks = [];
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > BROWSER_SOURCE_MAP_LIMITS.responseBytes) {
            finish(null);
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.once('end', () => {
          finish(Buffer.concat(chunks).toString('utf8'));
        });
        response.once('error', () => finish(null));
      }
    );
    deadline = setTimeout(() => {
      finish(null);
      request.destroy();
    }, BROWSER_SOURCE_MAP_LIMITS.requestTimeoutMs);
    deadline.unref?.();
    request.once('error', () => finish(null));
  });
}

function inlineSourceMapPayload(source) {
  const encoded = source.match(INLINE_SOURCE_MAP)?.[1];
  if (
    !encoded ||
    encoded.length > Math.ceil((BROWSER_SOURCE_MAP_LIMITS.mapBytes * 4) / 3) + 4 ||
    encoded.length % 4 !== 0
  ) {
    return null;
  }
  const decoded = Buffer.from(encoded, 'base64');
  if (
    decoded.length === 0 ||
    decoded.length > BROWSER_SOURCE_MAP_LIMITS.mapBytes ||
    decoded.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')
  ) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(decoded.toString('utf8'));
  } catch {
    return null;
  }
  if (
    !plainObject(payload) ||
    payload.version !== 3 ||
    Object.hasOwn(payload, 'sections') ||
    !Array.isArray(payload.sources) ||
    payload.sources.length === 0 ||
    payload.sources.length > BROWSER_SOURCE_MAP_LIMITS.sources ||
    !payload.sources.every((value) => typeof value === 'string' && value.length <= 2_000) ||
    !Array.isArray(payload.sourcesContent) ||
    payload.sourcesContent.length !== payload.sources.length ||
    !Array.isArray(payload.names) ||
    payload.names.length > BROWSER_SOURCE_MAP_LIMITS.names ||
    !payload.names.every((value) => typeof value === 'string' && value.length <= 200) ||
    typeof payload.mappings !== 'string' ||
    Buffer.byteLength(payload.mappings) > BROWSER_SOURCE_MAP_LIMITS.mapBytes ||
    (payload.sourceRoot !== undefined &&
      payload.sourceRoot !== null &&
      (typeof payload.sourceRoot !== 'string' || payload.sourceRoot.length > 2_000))
  ) {
    return null;
  }
  return payload;
}

function sourceIndexForEntry(payload, originalSource) {
  const matches = [];
  for (const [index, source] of payload.sources.entries()) {
    const rooted = safeMapPath(payload.sourceRoot ?? '', source);
    if (source === originalSource || rooted === originalSource) matches.push(index);
  }
  return matches.length === 1 ? matches[0] : null;
}

async function containedOriginalSource({ root, generatedFile, sourceRoot, originalSource }) {
  if (
    typeof originalSource !== 'string' ||
    originalSource.length === 0 ||
    originalSource.includes('\\') ||
    originalSource.includes('?') ||
    originalSource.includes('#')
  ) {
    return null;
  }
  const rooted = safeMapPath(sourceRoot ?? '', originalSource);
  if (!rooted) return null;
  const relative = posix.normalize(posix.join(posix.dirname(generatedFile), rooted));
  if (
    relative === '..' ||
    relative.startsWith('../') ||
    relative.startsWith('/') ||
    relative.split('/').some((part) => EXCLUDED_PATH_PARTS.includes(part)) ||
    !SOURCE_EXTENSIONS.has(extname(relative))
  ) {
    return null;
  }
  try {
    const path = await realpath(resolve(root, relative));
    const metadata = await lstat(path);
    const file = metadata.isFile() ? repositoryRelative(root, path) : null;
    return file ? { file, path } : null;
  } catch {
    return null;
  }
}

function safeMapPath(root, source) {
  if (
    typeof root !== 'string' ||
    typeof source !== 'string' ||
    root.includes('\\') ||
    source.includes('\\') ||
    root.includes('?') ||
    root.includes('#') ||
    source.includes('?') ||
    source.includes('#') ||
    /^[a-z][a-z\d+.-]*:/i.test(root) ||
    /^[a-z][a-z\d+.-]*:/i.test(source) ||
    root.startsWith('/') ||
    source.startsWith('/')
  ) {
    return null;
  }
  return posix.normalize(posix.join(root, source));
}

function numericHeader(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
