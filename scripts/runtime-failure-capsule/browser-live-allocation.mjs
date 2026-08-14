import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BROWSER_LIVE_ALLOCATION_SCHEMA_VERSION = 'runtime-browser-live-allocation-profile/v1';
export const BROWSER_LIVE_ALLOCATION_INTERVAL_BYTES = 32 * 1024;
const MAX_PROFILE_NODES = 100_000;
const MAX_APPLICATION_HOTSPOTS = 16;
const MAX_HARNESS_HOTSPOTS = 8;
const EXCLUDED_PARTS = new Set([
  '.codevetter',
  '.git',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

export function normalizeBrowserLiveAllocationProfile(profile, repositoryRoot) {
  if (!profile?.head || !Array.isArray(profile.samples)) {
    throw new Error('browser sampling heap profile is malformed');
  }
  const root = realpathSync(resolve(repositoryRoot));
  const hotspots = new Map();
  let sampledLiveBytes = 0;
  let visitedNodes = 0;
  let truncated = false;
  const stack = [{ node: profile.head, namedRepositoryFrame: null }];

  while (stack.length > 0 && visitedNodes < MAX_PROFILE_NODES) {
    const { node, namedRepositoryFrame } = stack.pop();
    visitedNodes += 1;
    const bytes = node?.selfSize;
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      truncated = true;
      continue;
    }
    if (!Number.isSafeInteger(sampledLiveBytes + bytes)) {
      truncated = true;
      continue;
    }
    sampledLiveBytes += bytes;
    const frame = normalizeFrame(node.callFrame, root);
    const inheritedNamedFrame =
      frame && frame.function !== '<anonymous>' ? frame : namedRepositoryFrame;
    const attributedFrame =
      frame?.function === '<anonymous>' && inheritedNamedFrame ? inheritedNamedFrame : frame;
    if (attributedFrame && bytes > 0) {
      const key = `${attributedFrame.file}:${attributedFrame.line}:${attributedFrame.function}`;
      const hotspot = hotspots.get(key) ?? {
        ...attributedFrame,
        role: sourceRole(attributedFrame.file),
        sampled_live_bytes: 0,
      };
      hotspot.sampled_live_bytes += bytes;
      hotspots.set(key, hotspot);
    }
    if (!Array.isArray(node.children)) {
      truncated = true;
      continue;
    }
    if (visitedNodes + stack.length + node.children.length > MAX_PROFILE_NODES) {
      truncated = true;
    }
    stack.push(
      ...node.children
        .slice(0, Math.max(0, MAX_PROFILE_NODES - visitedNodes))
        .map((child) => ({ node: child, namedRepositoryFrame: inheritedNamedFrame }))
    );
  }
  if (stack.length > 0) truncated = true;

  const ranked = [...hotspots.values()]
    .map((hotspot) => ({
      ...hotspot,
      sample_share:
        sampledLiveBytes > 0 ? round(hotspot.sampled_live_bytes / sampledLiveBytes, 6) : 0,
    }))
    .sort(compareHotspots);
  const selected = [
    ...ranked
      .filter((hotspot) => hotspot.role === 'application')
      .slice(0, MAX_APPLICATION_HOTSPOTS),
    ...ranked
      .filter((hotspot) => hotspot.role === 'test_or_harness')
      .slice(0, MAX_HARNESS_HOTSPOTS),
  ].sort(compareHotspots);

  return {
    schema_version: BROWSER_LIVE_ALLOCATION_SCHEMA_VERSION,
    collection_scope: 'objects_alive_after_forced_gc_allocated_during_same_page_probe',
    sampling_interval_bytes: BROWSER_LIVE_ALLOCATION_INTERVAL_BYTES,
    sampled_live_bytes: sampledLiveBytes,
    application_sampled_live_bytes: ranked
      .filter((hotspot) => hotspot.role === 'application')
      .reduce((total, hotspot) => total + hotspot.sampled_live_bytes, 0),
    hotspots: selected,
    truncated: truncated || ranked.length > selected.length,
  };
}

function normalizeFrame(frame, root) {
  if (!frame || typeof frame.url !== 'string') return null;
  let candidate;
  try {
    if (frame.url.startsWith('file:')) {
      candidate = fileURLToPath(frame.url);
    } else {
      const url = new URL(frame.url);
      if (!['http:', 'https:'].includes(url.protocol) || !isLoopback(url.hostname)) return null;
      const pathname = decodeURIComponent(url.pathname);
      if (!pathname.startsWith('/') || pathname.startsWith('/@')) return null;
      candidate = resolve(root, `.${pathname}`);
    }
    if (!isAbsolute(candidate)) return null;
    candidate = realpathSync(candidate);
  } catch {
    return null;
  }
  const file = repositoryRelative(root, candidate);
  if (!file || file.split('/').some((part) => EXCLUDED_PARTS.has(part))) return null;
  return {
    function:
      typeof frame.functionName === 'string' && frame.functionName.length > 0
        ? frame.functionName
        : '<anonymous>',
    file,
    line: Math.max(1, Number(frame.lineNumber ?? 0) + 1),
    provenance: 'repository_contained_browser_runtime_frame',
  };
}

function repositoryRelative(root, candidate) {
  const path = relative(root, candidate);
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || path.startsWith(sep)) {
    return null;
  }
  return path.split(sep).join('/');
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function sourceRole(file) {
  return /(?:^|\/)(?:e2e|test|tests|__tests__|benchmark)(?:\/|\.)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(
    file
  )
    ? 'test_or_harness'
    : 'application';
}

function compareHotspots(left, right) {
  return (
    right.sampled_live_bytes - left.sampled_live_bytes ||
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.function.localeCompare(right.function)
  );
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
