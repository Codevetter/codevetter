import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

import { repositoryRelative } from './contracts.mjs';

export const BROWSER_LOADING_SCHEMA_VERSION = 'runtime-browser-loading/v1';
export const BROWSER_LOADING_LIMITS = Object.freeze({
  largestResources: 8,
  categories: 12,
  resourceBytes: 1024 * 1024 * 1024,
});

const SOURCE_EXTENSIONS = new Set(['.css', '.html', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const EXCLUDED_ROUTE_PREFIXES = [
  '@',
  '_next/',
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  'coverage/',
];
const RESOURCE_TYPES = new Set([
  'document',
  'stylesheet',
  'image',
  'media',
  'font',
  'script',
  'texttrack',
  'xhr',
  'fetch',
  'eventsource',
  'websocket',
  'manifest',
  'other',
]);

export async function attributeBrowserLoadingSources(repositoryRoot, resources) {
  const root = await realpath(resolve(repositoryRoot));
  return Promise.all(
    resources.map(async (resource) => {
      if (resource.attributes?.network_scope !== 'loopback') return resource;
      const source = await exactRouteSource(root, resource.attributes.route);
      return source
        ? {
            ...resource,
            attributes: { ...resource.attributes, source },
            limitations: [
              'The source is an exact local development-server route, not a production bundle module or JavaScript initiator.',
            ],
          }
        : resource;
    })
  );
}

export function normalizeBrowserResourceSize(snapshot) {
  return {
    resource_type: normalizeResourceType(snapshot?._resourceType),
    mime_category: normalizeMimeCategory(snapshot?.response?.content?.mimeType),
    transfer_bytes: boundedBytes(snapshot?.response?._transferSize),
    encoded_body_bytes: boundedBytes(snapshot?.response?.bodySize),
    decoded_body_bytes: boundedBytes(snapshot?.response?.content?.size),
    wait_ms: boundedDuration(snapshot?.timings?.wait),
    receive_ms: boundedDuration(snapshot?.timings?.receive),
  };
}

export function createBrowserLoadingSummary(resources, { traceResourceCount, samplingApplied }) {
  if (
    !Array.isArray(resources) ||
    !Number.isSafeInteger(traceResourceCount) ||
    traceResourceCount < resources.length ||
    typeof samplingApplied !== 'boolean'
  ) {
    throw new Error('browser loading inventory is invalid');
  }
  const sized = resources.map((resource) => normalizeLoadingResource(resource));
  const allTransferSizes = sized.every((resource) => resource.transfer_bytes !== null);
  const completedResponses = sized.filter((resource) => resource.completed_response);
  const failedOrAborted = sized.filter((resource) => !resource.completed_response);
  const repositoryModules = sized.filter(
    (resource) => resource.source?.provenance === 'exact_local_module_route'
  );
  const completedResponseCoverage = completedResponses.every(
    (resource) => resource.transfer_bytes !== null
  );
  const completeObservedInventory = !samplingApplied && resources.length === traceResourceCount;
  const complete = sized.length > 0 && completeObservedInventory && allTransferSizes;
  const categories = new Map();
  for (const resource of sized) {
    const current = categories.get(resource.resource_type) ?? {
      resource_type: resource.resource_type,
      count: 0,
      observed_transfer_bytes: 0,
      resources_with_transfer_size: 0,
    };
    current.count += 1;
    if (resource.transfer_bytes !== null) {
      current.observed_transfer_bytes += resource.transfer_bytes;
      current.resources_with_transfer_size += 1;
    }
    categories.set(resource.resource_type, current);
  }
  return {
    schema_version: BROWSER_LOADING_SCHEMA_VERSION,
    state: sized.length > 0 ? 'observed' : 'unavailable',
    inventory: {
      trace_resource_count: traceResourceCount,
      observed_resource_count: sized.length,
      resources_with_transfer_size: sized.filter((resource) => resource.transfer_bytes !== null)
        .length,
      complete,
    },
    complete_transfer_bytes: complete ? sum(sized, 'transfer_bytes') : null,
    observed_transfer_bytes: sum(sized, 'transfer_bytes'),
    completed_responses: {
      count: completedResponses.length,
      resources_with_transfer_size: completedResponses.filter(
        (resource) => resource.transfer_bytes !== null
      ).length,
      complete:
        completedResponses.length > 0 && completeObservedInventory && completedResponseCoverage,
      complete_transfer_bytes:
        completedResponses.length > 0 && completeObservedInventory && completedResponseCoverage
          ? sum(completedResponses, 'transfer_bytes')
          : null,
      observed_transfer_bytes: sum(completedResponses, 'transfer_bytes'),
    },
    failed_or_aborted: {
      count: failedOrAborted.length,
      request_identity_sha256: identityDigest(failedOrAborted),
    },
    repository_modules: {
      count: repositoryModules.length,
      resources_with_transfer_size: repositoryModules.filter(
        (resource) => resource.transfer_bytes !== null
      ).length,
      observed_transfer_bytes: sum(repositoryModules, 'transfer_bytes'),
      largest: repositoryModules
        .filter((resource) => resource.transfer_bytes !== null)
        .toSorted(
          (left, right) =>
            right.transfer_bytes - left.transfer_bytes ||
            right.duration_ms - left.duration_ms ||
            left.route.localeCompare(right.route)
        )
        .slice(0, BROWSER_LOADING_LIMITS.largestResources)
        .map(publicLoadingResource),
    },
    observed_encoded_body_bytes: sum(sized, 'encoded_body_bytes'),
    observed_decoded_body_bytes: sum(sized, 'decoded_body_bytes'),
    categories: [...categories.values()]
      .toSorted(
        (left, right) =>
          right.observed_transfer_bytes - left.observed_transfer_bytes ||
          right.count - left.count ||
          left.resource_type.localeCompare(right.resource_type)
      )
      .slice(0, BROWSER_LOADING_LIMITS.categories),
    largest_resources: sized
      .filter((resource) => resource.transfer_bytes !== null)
      .toSorted(
        (left, right) =>
          right.transfer_bytes - left.transfer_bytes ||
          right.duration_ms - left.duration_ms ||
          left.route.localeCompare(right.route)
      )
      .slice(0, BROWSER_LOADING_LIMITS.largestResources)
      .map(publicLoadingResource),
    initiator_graph: 'unavailable',
    provenance: 'bounded_playwright_har_resource_snapshots',
    scope: 'local_development_server_exact_flow',
    limitations: [
      'Local development-server transfer sizes do not establish production bundle, compression, CDN, cache, device, or user-network cost.',
      'Playwright HAR snapshots do not provide a trustworthy JavaScript initiator graph; no dependency or critical chain is inferred.',
      'Completed-response transfer bytes exclude failed or aborted requests and do not include a trustworthy request-byte total.',
      ...(complete
        ? []
        : [
            'The resource inventory or transfer-size coverage is partial; observed bytes are not a complete exact-flow total.',
          ]),
    ],
  };
}

function normalizeLoadingResource(resource) {
  const attributes = resource?.attributes;
  if (
    !resource ||
    typeof resource !== 'object' ||
    !attributes ||
    typeof attributes.route !== 'string' ||
    attributes.route.length < 1 ||
    attributes.route.length > 256 ||
    !['loopback', 'relative', 'remote', 'invalid'].includes(attributes.network_scope) ||
    !RESOURCE_TYPES.has(attributes.resource_type) ||
    !validMimeCategory(attributes.mime_category) ||
    !nullableBytes(attributes.transfer_bytes) ||
    !nullableBytes(attributes.encoded_body_bytes) ||
    !nullableBytes(attributes.decoded_body_bytes) ||
    !Number.isFinite(resource.duration_ms) ||
    resource.duration_ms < 0 ||
    !validSource(attributes.source)
  ) {
    throw new Error('browser loading resource is invalid');
  }
  return {
    route: attributes.route,
    network_scope: attributes.network_scope,
    resource_type: attributes.resource_type,
    mime_category: attributes.mime_category,
    transfer_bytes: attributes.transfer_bytes,
    encoded_body_bytes: attributes.encoded_body_bytes,
    decoded_body_bytes: attributes.decoded_body_bytes,
    duration_ms: round3(resource.duration_ms),
    source: attributes.source ?? null,
    completed_response:
      Number.isSafeInteger(attributes.status) &&
      attributes.status >= 100 &&
      attributes.status <= 599,
    request_identity_sha256: /^[0-9a-f]{64}$/.test(attributes.request_identity_sha256 ?? '')
      ? attributes.request_identity_sha256
      : null,
  };
}

function publicLoadingResource({
  completed_response: _completedResponse,
  request_identity_sha256: _requestIdentity,
  ...resource
}) {
  return resource;
}

function identityDigest(resources) {
  return createHash('sha256')
    .update(
      resources
        .map((resource) => resource.request_identity_sha256 ?? '<unavailable>')
        .toSorted()
        .join('\n')
    )
    .digest('hex');
}

async function exactRouteSource(root, route) {
  if (typeof route !== 'string' || route.length < 2 || route.length > 256) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(route).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (
    decoded.length === 0 ||
    decoded.includes('\0') ||
    decoded.split('/').includes('..') ||
    EXCLUDED_ROUTE_PREFIXES.some((prefix) => decoded.startsWith(prefix)) ||
    !SOURCE_EXTENSIONS.has(extname(decoded))
  ) {
    return null;
  }
  const candidate = resolve(root, decoded);
  if (repositoryRelative(root, candidate) === null) return null;
  try {
    const metadata = await lstat(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    const canonical = await realpath(candidate);
    const file = repositoryRelative(root, canonical);
    return file === null
      ? null
      : { file, line: 1, function: null, provenance: 'exact_local_module_route' };
  } catch {
    return null;
  }
}

function normalizeResourceType(value) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : 'other';
  return RESOURCE_TYPES.has(normalized) ? normalized : 'other';
}

function normalizeMimeCategory(value) {
  if (typeof value !== 'string') return 'unknown';
  const mime = value.split(';')[0].trim().toLowerCase();
  if (mime.includes('javascript') || mime.includes('ecmascript')) return 'script';
  if (mime === 'text/css') return 'style';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'document';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('font/') || mime.includes('font')) return 'font';
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return 'media';
  if (mime.includes('json')) return 'json';
  if (mime.startsWith('text/')) return 'text';
  if (mime === 'application/wasm') return 'wasm';
  return mime ? 'other' : 'unknown';
}

function validMimeCategory(value) {
  return [
    'script',
    'style',
    'document',
    'image',
    'font',
    'media',
    'json',
    'text',
    'wasm',
    'other',
    'unknown',
  ].includes(value);
}

function boundedBytes(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= BROWSER_LOADING_LIMITS.resourceBytes
    ? value
    : null;
}

function nullableBytes(value) {
  return value === null || boundedBytes(value) !== null;
}

function boundedDuration(value) {
  return Number.isFinite(value) && value >= 0 && value <= 60 * 60 * 1_000 ? round3(value) : null;
}

function validSource(value) {
  return (
    value === null ||
    value === undefined ||
    (value &&
      typeof value === 'object' &&
      typeof value.file === 'string' &&
      !value.file.startsWith('/') &&
      !value.file.split('/').includes('..') &&
      Number.isSafeInteger(value.line) &&
      value.line > 0 &&
      value.function === null &&
      ['exact_local_module_route', 'static_network_literal'].includes(value.provenance))
  );
}

function sum(resources, field) {
  return resources.reduce((total, resource) => total + (resource[field] ?? 0), 0);
}

function round3(value) {
  return Math.round(value * 1_000) / 1_000;
}
