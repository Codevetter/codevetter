import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIMITS, isExcludedPath, repositoryRelative } from './contracts.mjs';

export const V8_HEAP_PROFILE_RUNS = 2;
export const V8_HEAP_CANDIDATE_LIMIT = 8;
export const V8_HEAP_PROFILE_INTERVAL_BYTES = 8 * 1024;
export const V8_HEAP_COLLECTION_SCOPE = 'includes_objects_collected_by_minor_and_major_gc';
const V8_HEAP_OBSERVER_PATHS = new Set([
  'scripts/runtime-failure-capsule/node-heap-profile-preload.mjs',
]);
export const V8_HEAP_MATERIALITY_POLICY = Object.freeze({
  minimum_sampled_bytes: 64 * 1024,
  minimum_sample_share: 0.01,
  minimum_application_sample_share: 0.002,
  minimum_application_function_share: 0.5,
});

export async function collectV8HeapProfileEvidence(directory, repositoryRoot) {
  const entries = await boundedEntries(directory);
  const files = entries.filter((entry) => entry.name.endsWith('.heapprofile'));
  const documents = [];
  let profileBytes = 0;
  let truncated = files.length > LIMITS.profileFiles;
  for (const entry of files.slice(0, LIMITS.profileFiles)) {
    profileBytes += entry.size;
    if (entry.size > LIMITS.profileBytes || profileBytes > LIMITS.profileBytes) {
      truncated = true;
      continue;
    }
    try {
      documents.push(JSON.parse(await readFile(join(directory, entry.name), 'utf8')));
    } catch {
      truncated = true;
    }
  }
  const parsed = parseV8HeapProfileDocuments(documents, repositoryRoot);
  return {
    kind: 'v8_heap_allocation',
    collection_scope: V8_HEAP_COLLECTION_SCOPE,
    sampling_interval_bytes: V8_HEAP_PROFILE_INTERVAL_BYTES,
    profile_files: files.length,
    profile_bytes: profileBytes,
    ...parsed,
    truncated: truncated || parsed.truncated,
  };
}

export function parseV8HeapProfileDocuments(documents, repositoryRoot) {
  const hotspots = new Map();
  let profileSamples = 0;
  let sampledBytes = 0;
  let visitedNodes = 0;
  let truncated = false;
  for (const document of documents) {
    if (!document?.head || !Array.isArray(document.samples)) {
      truncated = true;
      continue;
    }
    profileSamples += document.samples.length;
    if (profileSamples > LIMITS.profileSamples) truncated = true;
    const stack = [{ node: document.head, namedRepositoryFrame: null }];
    while (stack.length > 0 && visitedNodes < LIMITS.profileSamples) {
      const { node, namedRepositoryFrame } = stack.pop();
      visitedNodes += 1;
      const bytes = node?.selfSize;
      if (!Number.isSafeInteger(bytes) || bytes < 0) {
        truncated = true;
        continue;
      }
      if (!Number.isSafeInteger(sampledBytes + bytes)) {
        truncated = true;
        continue;
      }
      sampledBytes += bytes;
      const frame = normalizeFrame(node.callFrame, repositoryRoot);
      const inheritedNamedFrame =
        frame && frame.function !== '<anonymous>' ? frame : namedRepositoryFrame;
      const attributedFrame =
        frame?.function === '<anonymous>' && inheritedNamedFrame ? inheritedNamedFrame : frame;
      if (attributedFrame && bytes > 0) {
        const key = `${attributedFrame.file}:${attributedFrame.line}:${attributedFrame.function}`;
        const value = hotspots.get(key) ?? {
          ...attributedFrame,
          role: sourceRole(attributedFrame.file),
          sampled_bytes: 0,
        };
        value.sampled_bytes += bytes;
        hotspots.set(key, value);
      }
      if (!Array.isArray(node.children)) {
        truncated = true;
        continue;
      }
      if (visitedNodes + stack.length + node.children.length > LIMITS.profileSamples) {
        truncated = true;
      }
      stack.push(
        ...node.children
          .slice(0, Math.max(0, LIMITS.profileSamples - visitedNodes))
          .map((child) => ({ node: child, namedRepositoryFrame: inheritedNamedFrame }))
      );
    }
    if (stack.length > 0) truncated = true;
  }
  const ranked = [...hotspots.values()]
    .map((hotspot) => ({
      ...hotspot,
      sample_share: sampledBytes > 0 ? round(hotspot.sampled_bytes / sampledBytes, 6) : 0,
    }))
    .sort(compareHotspots);
  const selected = [
    ...ranked.filter((hotspot) => hotspot.role === 'application').slice(0, 16),
    ...ranked.filter((hotspot) => hotspot.role === 'test_or_harness').slice(0, 8),
  ].sort(compareHotspots);
  return {
    profile_samples: Math.min(profileSamples, LIMITS.profileSamples),
    sampled_bytes: sampledBytes,
    application_sampled_bytes: ranked
      .filter((hotspot) => hotspot.role === 'application')
      .reduce((total, hotspot) => total + hotspot.sampled_bytes, 0),
    hotspots: selected,
    truncated,
    redaction_count: 0,
  };
}

export function combineV8HeapProfileRuns(runs) {
  if (runs.length === 0) return emptyV8HeapProfileEvidence();
  const aggregates = new Map();
  for (const run of runs) {
    for (const hotspot of run.hotspots) {
      const key = `${hotspot.file}:${hotspot.line}:${hotspot.function}`;
      const value = aggregates.get(key) ?? { ...hotspot, sampled_bytes: 0, run_count: 0 };
      value.sampled_bytes += hotspot.sampled_bytes;
      value.run_count += 1;
      aggregates.set(key, value);
    }
  }
  const sampledBytes = runs.reduce((total, run) => total + run.sampled_bytes, 0);
  const hotspots = [...aggregates.values()]
    .map((hotspot) => ({
      ...hotspot,
      sample_share: sampledBytes > 0 ? round(hotspot.sampled_bytes / sampledBytes, 6) : 0,
    }))
    .sort(compareHotspots)
    .slice(0, LIMITS.hotspots);
  return {
    kind: 'v8_heap_allocation',
    collection_scope: V8_HEAP_COLLECTION_SCOPE,
    sampling_interval_bytes: V8_HEAP_PROFILE_INTERVAL_BYTES,
    profile_runs: runs.length,
    profile_files: runs.reduce((total, run) => total + run.profile_files, 0),
    profile_bytes: runs.reduce((total, run) => total + run.profile_bytes, 0),
    profile_samples: runs.reduce((total, run) => total + run.profile_samples, 0),
    sampled_bytes: sampledBytes,
    application_sampled_bytes: runs.reduce(
      (total, run) => total + run.application_sampled_bytes,
      0
    ),
    hotspots,
    truncated: runs.some((run) => run.truncated),
    redaction_count: 0,
    repeatability: evaluateV8HeapRepeatability(runs),
  };
}

export function evaluateV8HeapRepeatability(runs) {
  const candidates = runs.map((run) => run.hotspots.find((item) => item.role === 'application'));
  if (candidates.length < V8_HEAP_PROFILE_RUNS || candidates.some((candidate) => !candidate)) {
    return result(
      false,
      candidates.filter(Boolean),
      'Independent V8 heap profiles did not all capture an application allocation source.'
    );
  }
  const [first, ...rest] = candidates;
  const repeated = rest.every(
    (candidate) => candidate.file === first.file && candidate.function === first.function
  );
  const applicationFunctionShares = candidates.map((candidate, index) =>
    applicationFunctionShare(candidate, runs[index])
  );
  const applicationSampleShares = runs.map((run) =>
    run.sampled_bytes > 0 ? run.application_sampled_bytes / run.sampled_bytes : 0
  );
  const material = candidates.every((candidate, index) =>
    isMaterialV8HeapCandidate(candidate, runs[index])
  );
  const combinedBytes = candidates.reduce((total, candidate) => total + candidate.sampled_bytes, 0);
  return {
    qualified: repeated && material,
    policy: V8_HEAP_MATERIALITY_POLICY,
    candidates,
    application_sample_shares: applicationSampleShares.map((value) => round(value, 6)),
    candidate_application_function_shares: applicationFunctionShares.map((value) =>
      round(value, 6)
    ),
    ...(repeated
      ? {
          candidate: {
            file: first.file,
            line: first.line,
            function: first.function,
            role: 'application',
            sampled_bytes: combinedBytes,
            per_run_sampled_bytes: candidates.map((candidate) => candidate.sampled_bytes),
            provenance: 'two_independent_v8_sampling_heap_profiles',
          },
        }
      : {}),
    reason: !repeated
      ? 'Independent V8 heap profiles disagreed on the leading application allocation source.'
      : !material
        ? 'The repeated V8 allocation source did not cross the sampled-byte or share thresholds.'
        : 'Independent V8 heap profiles repeated a material application allocation source.',
  };
}

export function repeatableV8HeapAllocationCandidates(runs, { file = null } = {}) {
  if (runs.length < V8_HEAP_PROFILE_RUNS) return [];
  const candidates = [];
  for (const first of runs[0].hotspots.filter((hotspot) => hotspot.role === 'application')) {
    if (file && first.file !== file) continue;
    const matches = runs.map((run) =>
      run.hotspots.find(
        (hotspot) =>
          hotspot.role === 'application' &&
          hotspot.file === first.file &&
          hotspot.function === first.function
      )
    );
    if (
      matches.some((candidate) => !candidate) ||
      matches.some((candidate, index) => !isMaterialV8HeapCandidate(candidate, runs[index]))
    ) {
      continue;
    }
    const perRunSampledBytes = matches.map((candidate) => candidate.sampled_bytes);
    const sampledBytes = perRunSampledBytes.reduce((total, value) => total + value, 0);
    const totalSampledBytes = runs.reduce((total, run) => total + run.sampled_bytes, 0);
    candidates.push({
      file: first.file,
      line: first.line,
      function: first.function,
      role: 'application',
      sampled_bytes: sampledBytes,
      per_run_sampled_bytes: perRunSampledBytes,
      sample_share: totalSampledBytes > 0 ? round(sampledBytes / totalSampledBytes, 6) : 0,
      provenance: 'two_independent_v8_sampling_heap_profiles',
    });
  }
  return candidates
    .sort(
      (left, right) =>
        right.sampled_bytes - left.sampled_bytes ||
        left.file.localeCompare(right.file) ||
        left.line - right.line ||
        left.function.localeCompare(right.function)
    )
    .slice(0, V8_HEAP_CANDIDATE_LIMIT);
}

export function emptyV8HeapProfileEvidence() {
  return {
    kind: 'v8_heap_allocation',
    collection_scope: V8_HEAP_COLLECTION_SCOPE,
    sampling_interval_bytes: V8_HEAP_PROFILE_INTERVAL_BYTES,
    profile_runs: 0,
    profile_files: 0,
    profile_bytes: 0,
    profile_samples: 0,
    sampled_bytes: 0,
    application_sampled_bytes: 0,
    hotspots: [],
    truncated: false,
    redaction_count: 0,
    repeatability: null,
  };
}

export function v8HeapProfileRunSummary(run, index) {
  const applicationHotspots = run.hotspots
    .filter((hotspot) => hotspot.role === 'application')
    .slice(0, 16);
  return {
    index,
    profile_kind: run.kind,
    sampling_interval_bytes: run.sampling_interval_bytes,
    profile_files: run.profile_files,
    profile_bytes: run.profile_bytes,
    profile_samples: run.profile_samples,
    sampled_bytes: run.sampled_bytes,
    collection_scope: run.collection_scope,
    application_sampled_bytes: run.application_sampled_bytes,
    leading_application_hotspot: applicationHotspots[0] ?? null,
    application_hotspots: applicationHotspots,
    truncated: run.truncated,
  };
}

async function boundedEntries(directory) {
  const entries = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).slice(
    0,
    LIMITS.profileFiles + 1
  )) {
    if (!entry.isFile()) continue;
    entries.push({ name: entry.name, size: (await stat(join(directory, entry.name))).size });
  }
  return entries;
}

function normalizeFrame(frame, root) {
  if (!frame || typeof frame.url !== 'string') return null;
  let path;
  if (frame.url.startsWith('file:')) {
    try {
      path = fileURLToPath(frame.url);
    } catch {
      return null;
    }
  } else {
    if (!isAbsolute(frame.url)) return null;
    path = frame.url;
  }
  const file = repositoryRelative(root, path);
  if (file === null || isExcludedPath(file)) return null;
  return {
    function:
      typeof frame.functionName === 'string' && frame.functionName.length > 0
        ? frame.functionName
        : '<anonymous>',
    file,
    line: Math.max(1, Number(frame.lineNumber ?? 0) + 1),
  };
}

export function isMaterialV8HeapCandidate(candidate, run) {
  const direct = candidate.sample_share >= V8_HEAP_MATERIALITY_POLICY.minimum_sample_share;
  const applicationRelative =
    run.sampled_bytes > 0 &&
    run.application_sampled_bytes / run.sampled_bytes >=
      V8_HEAP_MATERIALITY_POLICY.minimum_application_sample_share &&
    applicationFunctionShare(candidate, run) >=
      V8_HEAP_MATERIALITY_POLICY.minimum_application_function_share;
  return (
    candidate.sampled_bytes >= V8_HEAP_MATERIALITY_POLICY.minimum_sampled_bytes &&
    (direct || applicationRelative)
  );
}

function applicationFunctionShare(candidate, run) {
  return run.application_sampled_bytes > 0
    ? candidate.sampled_bytes / run.application_sampled_bytes
    : 0;
}

function sourceRole(file) {
  return V8_HEAP_OBSERVER_PATHS.has(file) ||
    /(?:^|\/)(?:test|tests|__tests__|benchmark)(?:\/|\.)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)
    ? 'test_or_harness'
    : 'application';
}

function compareHotspots(left, right) {
  return (
    right.sampled_bytes - left.sampled_bytes ||
    left.file.localeCompare(right.file) ||
    left.line - right.line
  );
}

function result(qualified, candidates, reason) {
  return { qualified, policy: V8_HEAP_MATERIALITY_POLICY, candidates, reason };
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
