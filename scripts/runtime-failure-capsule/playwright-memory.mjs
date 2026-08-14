import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const PLAYWRIGHT_MEMORY_REPEATS = 3;
export const PLAYWRIGHT_SAME_PAGE_MEMORY_REPEATS = 3;
export const PLAYWRIGHT_LIVE_RETENTION_POLICY = Object.freeze({
  minimum_growth_percent: 20,
  minimum_growth_bytes: 64 * 1024,
  minimum_profiles_present: 2,
});
const LOADER_PATH = fileURLToPath(new URL('./playwright-memory-loader.mjs', import.meta.url));
const SAMPLE_FIELDS = [
  'heap_used_bytes',
  'heap_total_bytes',
  'embedder_heap_used_bytes',
  'backing_storage_bytes',
  'dom_nodes',
  'documents',
  'event_listeners',
];

export function supportsRepeatedPlaywrightMemory(candidate) {
  return (
    candidate?.adapter === 'playwright' &&
    (candidate.signals ?? []).some((signal) => signal.kind === 'browser_request_fixture')
  );
}

export function playwrightMemoryEnvironment({
  repositoryRoot,
  target,
  outputDirectory,
  mode = 'fresh_contexts',
  testName = null,
}) {
  if (!['fresh_contexts', 'same_page'].includes(mode)) {
    throw new Error('Playwright memory mode is invalid');
  }
  return {
    NODE_OPTIONS: `--experimental-loader=${JSON.stringify(LOADER_PATH)}`,
    CODEVETTER_REPOSITORY_ROOT: repositoryRoot,
    CODEVETTER_PLAYWRIGHT_TARGET: target,
    CODEVETTER_BROWSER_MEMORY_DIRECTORY: outputDirectory,
    CODEVETTER_BROWSER_MEMORY_MODE: mode,
    ...(testName === null ? {} : { CODEVETTER_BROWSER_MEMORY_TEST_NAME: testName }),
  };
}

export async function collectRepeatedPlaywrightMemory(directory) {
  let entries;
  try {
    entries = await readdir(directory);
  } catch {
    return unavailable([], 'The repeated browser-memory pass emitted no sample directory.');
  }
  if (entries.length > 16) {
    return unavailable([], 'The repeated browser-memory sample inventory exceeded its bound.');
  }
  const samples = [];
  for (let index = 0; index < PLAYWRIGHT_MEMORY_REPEATS; index += 1) {
    try {
      const value = JSON.parse(await readFile(`${directory}/repeat-${index}.json`, 'utf8'));
      samples.push(normalizeSample(value, index));
    } catch {
      // A missing, malformed, duplicate, or unavailable sample remains an explicit gap.
    }
  }
  if (samples.length !== PLAYWRIGHT_MEMORY_REPEATS) {
    return unavailable(
      samples,
      `Only ${samples.length}/${PLAYWRIGHT_MEMORY_REPEATS} forced-GC memory repeats were usable.`
    );
  }
  return {
    schema_version: 'runtime-playwright-repeated-memory/v1',
    state: 'succeeded',
    context_scope: 'fresh_context_exact_flow_repeats',
    forced_gc: true,
    samples,
    summary: summarize(samples),
    leak_assessment: 'not_evaluated_fresh_contexts',
    limitations: [
      'Each repeat uses a fresh Playwright context; the distribution is comparable memory evidence but cannot prove same-page retained-object leakage.',
    ],
  };
}

export function unavailableRepeatedPlaywrightMemory(limitation) {
  return unavailable([], limitation);
}

export async function collectSamePagePlaywrightMemory(directory) {
  let sequence;
  try {
    sequence = JSON.parse(await readFile(`${directory}/sequence.json`, 'utf8'));
  } catch {
    return unavailableSamePage([], 'The same-page browser-memory pass emitted no usable sequence.');
  }
  let samples = [];
  try {
    if (
      sequence?.schema_version !== 'runtime-playwright-same-page-memory-sequence/v1' ||
      sequence.retry !== 0 ||
      !Array.isArray(sequence.samples) ||
      sequence.samples.length > PLAYWRIGHT_SAME_PAGE_MEMORY_REPEATS
    ) {
      throw new Error('invalid sequence');
    }
    samples = sequence.samples.map((sample, index) =>
      normalizeSample(sample, index, { retainedProfile: true })
    );
  } catch {
    return unavailableSamePage([], 'The same-page browser-memory sequence was malformed.');
  }
  if (sequence.limitation !== null || samples.length !== PLAYWRIGHT_SAME_PAGE_MEMORY_REPEATS) {
    return unavailableSamePage(
      samples,
      `Only ${samples.length}/${PLAYWRIGHT_SAME_PAGE_MEMORY_REPEATS} same-page forced-GC cycles were usable.`
    );
  }
  return samePageEvidence(
    'succeeded',
    samples,
    [],
    normalizeProfileLimitation(sequence.retained_profile_limitation)
  );
}

export function unavailableSamePagePlaywrightMemory(limitation) {
  return unavailableSamePage([], limitation);
}

export function normalizeSamePagePlaywrightMemory(value) {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== 'object' ||
    value.schema_version !== 'runtime-playwright-same-page-memory/v1' ||
    !['succeeded', 'unavailable'].includes(value.state) ||
    value.context_scope !== 'same_page_and_context_exact_flow_repeats' ||
    value.interaction_scope !== 'full_project_test_callback' ||
    value.forced_gc !== true ||
    value.leak_assessment !== 'not_evaluated_full_callback_replay' ||
    !Array.isArray(value.samples) ||
    value.samples.length > PLAYWRIGHT_SAME_PAGE_MEMORY_REPEATS ||
    !Array.isArray(value.limitations) ||
    value.limitations.length > 8 ||
    value.limitations.some((entry) => typeof entry !== 'string' || entry.length > 500)
  ) {
    throw new Error('same-page Playwright memory evidence is invalid');
  }
  const samples = value.samples.map((sample, index) =>
    normalizeSample(sample, index, { retainedProfile: true })
  );
  if (value.state === 'succeeded' && samples.length !== PLAYWRIGHT_SAME_PAGE_MEMORY_REPEATS) {
    throw new Error('successful same-page Playwright memory evidence is incomplete');
  }
  return samePageEvidence(value.state, samples, [...value.limitations]);
}

export function normalizeRepeatedPlaywrightMemory(value) {
  if (value === null) return null;
  const allowed = [
    'schema_version',
    'state',
    'context_scope',
    'forced_gc',
    'samples',
    'summary',
    'leak_assessment',
    'limitations',
  ];
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    value.schema_version !== 'runtime-playwright-repeated-memory/v1' ||
    !['succeeded', 'unavailable'].includes(value.state) ||
    value.context_scope !== 'fresh_context_exact_flow_repeats' ||
    value.forced_gc !== true ||
    !Array.isArray(value.samples) ||
    value.samples.length > PLAYWRIGHT_MEMORY_REPEATS ||
    !Array.isArray(value.limitations) ||
    value.limitations.length > 8 ||
    value.limitations.some((entry) => typeof entry !== 'string' || entry.length > 500) ||
    value.leak_assessment !== 'not_evaluated_fresh_contexts'
  ) {
    throw new Error('repeated Playwright memory evidence is invalid');
  }
  const samples = value.samples
    .map((sample) => normalizeSample(sample, sample?.repeat_index))
    .toSorted((left, right) => left.repeat_index - right.repeat_index);
  if (
    new Set(samples.map((sample) => sample.repeat_index)).size !== samples.length ||
    (value.state === 'succeeded' &&
      (samples.length !== PLAYWRIGHT_MEMORY_REPEATS ||
        samples.some((sample, index) => sample.repeat_index !== index)))
  ) {
    throw new Error('successful repeated Playwright memory evidence is incomplete');
  }
  return {
    schema_version: value.schema_version,
    state: value.state,
    context_scope: value.context_scope,
    forced_gc: true,
    samples,
    summary: value.state === 'succeeded' ? summarize(samples) : null,
    leak_assessment: value.leak_assessment,
    limitations: [...value.limitations],
  };
}

function normalizeSample(value, index, { retainedProfile = false } = {}) {
  if (
    !value ||
    typeof value !== 'object' ||
    value.schema_version !== 'runtime-playwright-memory-sample/v1' ||
    value.repeat_index !== index ||
    value.retry !== 0 ||
    value.limitation !== null
  ) {
    throw new Error('Playwright memory sample identity is invalid');
  }
  const before = normalizeCounters(value.before);
  const after = normalizeCounters(value.after);
  const normalized = {
    schema_version: value.schema_version,
    repeat_index: index,
    retry: 0,
    before,
    after,
    delta: Object.fromEntries(SAMPLE_FIELDS.map((field) => [field, after[field] - before[field]])),
    limitation: null,
  };
  if (retainedProfile)
    normalized.retained_profile = normalizeLiveAllocationProfile(value.retained_profile);
  return normalized;
}

function normalizeCounters(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    value.provenance !== 'playwright_cdp_after_forced_gc'
  ) {
    throw new Error('Playwright memory counters are invalid');
  }
  const counters = { provenance: value.provenance };
  for (const field of SAMPLE_FIELDS) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) {
      throw new Error(`Playwright memory counter ${field} is invalid`);
    }
    counters[field] = value[field];
  }
  return counters;
}

function summarize(samples) {
  return Object.fromEntries(
    ['heap_used_bytes', 'dom_nodes', 'documents', 'event_listeners'].flatMap((field) => [
      [`after_${field}`, distribution(samples.map((sample) => sample.after[field]))],
      [`delta_${field}`, distribution(samples.map((sample) => sample.delta[field]))],
    ])
  );
}

function samePageEvidence(state, samples, limitations, profileLimitation = null) {
  return {
    schema_version: 'runtime-playwright-same-page-memory/v1',
    state,
    context_scope: 'same_page_and_context_exact_flow_repeats',
    interaction_scope: 'full_project_test_callback',
    forced_gc: true,
    samples,
    trend:
      state === 'succeeded'
        ? Object.fromEntries(
            ['heap_used_bytes', 'dom_nodes', 'documents', 'event_listeners'].map((field) => [
              `after_${field}`,
              sequenceSummary(samples.map((sample) => sample.after[field])),
            ])
          )
        : null,
    retained_attribution:
      state === 'succeeded'
        ? summarizeLiveRetention(samples, profileLimitation)
        : unavailableLiveRetention(profileLimitation ?? limitations[0]),
    leak_assessment: 'not_evaluated_full_callback_replay',
    limitations:
      state === 'succeeded'
        ? [
            'The same project callback repeats in one page and context, but callback-owned fixtures and setup repeat too; sampled repository-source retention can identify a candidate, but it cannot prove a leak or distinguish intentional caching.',
          ]
        : limitations,
  };
}

function unavailableSamePage(samples, limitation) {
  return samePageEvidence('unavailable', samples, [limitation], limitation);
}

function normalizeLiveAllocationProfile(value) {
  if (value === null || value === undefined) return null;
  if (
    !value ||
    typeof value !== 'object' ||
    value.schema_version !== 'runtime-browser-live-allocation-profile/v1' ||
    value.collection_scope !== 'objects_alive_after_forced_gc_allocated_during_same_page_probe' ||
    value.sampling_interval_bytes !== 32 * 1024 ||
    !Number.isSafeInteger(value.sampled_live_bytes) ||
    value.sampled_live_bytes < 0 ||
    !Number.isSafeInteger(value.application_sampled_live_bytes) ||
    value.application_sampled_live_bytes < 0 ||
    value.application_sampled_live_bytes > value.sampled_live_bytes ||
    typeof value.truncated !== 'boolean' ||
    !Array.isArray(value.hotspots) ||
    value.hotspots.length > 24
  ) {
    throw new Error('browser sampled-live allocation profile is invalid');
  }
  return {
    schema_version: value.schema_version,
    collection_scope: value.collection_scope,
    sampling_interval_bytes: value.sampling_interval_bytes,
    sampled_live_bytes: value.sampled_live_bytes,
    application_sampled_live_bytes: value.application_sampled_live_bytes,
    hotspots: value.hotspots.map(normalizeLiveHotspot),
    truncated: value.truncated,
  };
}

function normalizeLiveHotspot(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.file !== 'string' ||
    value.file.length < 1 ||
    value.file.length > 300 ||
    value.file.startsWith('/') ||
    value.file.includes('\\') ||
    value.file.split('/').includes('..') ||
    typeof value.function !== 'string' ||
    value.function.length > 300 ||
    !Number.isSafeInteger(value.line) ||
    value.line < 1 ||
    !['application', 'test_or_harness'].includes(value.role) ||
    !Number.isSafeInteger(value.sampled_live_bytes) ||
    value.sampled_live_bytes < 1 ||
    !Number.isFinite(value.sample_share) ||
    value.sample_share < 0 ||
    value.sample_share > 1 ||
    value.provenance !== 'repository_contained_browser_runtime_frame'
  ) {
    throw new Error('browser sampled-live allocation hotspot is invalid');
  }
  return {
    function: value.function,
    file: value.file,
    line: value.line,
    role: value.role,
    sampled_live_bytes: value.sampled_live_bytes,
    sample_share: value.sample_share,
    provenance: value.provenance,
  };
}

function summarizeLiveRetention(samples, profileLimitation) {
  const profiles = samples.map((sample) => sample.retained_profile).filter(Boolean);
  if (
    profileLimitation ||
    profiles.length !== PLAYWRIGHT_SAME_PAGE_MEMORY_REPEATS ||
    profiles.some((profile) => profile.truncated)
  ) {
    return unavailableLiveRetention(
      profileLimitation ??
        `Only ${profiles.length}/${PLAYWRIGHT_SAME_PAGE_MEMORY_REPEATS} complete sampled-live profiles were usable.`
    );
  }
  const identities = new Map();
  for (const profile of profiles) {
    for (const hotspot of profile.hotspots.filter((entry) => entry.role === 'application')) {
      const key = liveHotspotIdentity(hotspot);
      if (!identities.has(key)) identities.set(key, hotspot);
    }
  }
  const candidates = [...identities.entries()]
    .map(([key, source]) => {
      const values = profiles.map((profile) =>
        profile.hotspots
          .filter(
            (hotspot) => hotspot.role === 'application' && liveHotspotIdentity(hotspot) === key
          )
          .reduce((total, hotspot) => total + hotspot.sampled_live_bytes, 0)
      );
      const first = values[0];
      const last = values.at(-1);
      const delta = last - first;
      const deltaPercent = first === 0 ? null : round((delta / first) * 100);
      const monotonic = values.every((value, index) => index === 0 || value >= values[index - 1]);
      const profilesPresent = values.filter((value) => value > 0).length;
      const relativeMaterial = first === 0 ? last > 0 : deltaPercent >= 20;
      return {
        source: {
          file: source.file,
          line: source.line,
          function: source.function,
          provenance: source.provenance,
        },
        per_cycle_sampled_live_bytes: values,
        first_sampled_live_bytes: first,
        last_sampled_live_bytes: last,
        delta_sampled_live_bytes: delta,
        delta_percent: deltaPercent,
        monotonically_non_decreasing: monotonic,
        material:
          monotonic &&
          profilesPresent >= PLAYWRIGHT_LIVE_RETENTION_POLICY.minimum_profiles_present &&
          delta >= PLAYWRIGHT_LIVE_RETENTION_POLICY.minimum_growth_bytes &&
          relativeMaterial,
      };
    })
    .filter((candidate) => candidate.material)
    .sort(
      (left, right) =>
        right.delta_sampled_live_bytes - left.delta_sampled_live_bytes ||
        left.source.file.localeCompare(right.source.file) ||
        left.source.line - right.source.line
    );
  const candidate = candidates[0] ?? null;
  return {
    schema_version: 'runtime-browser-live-retention/v1',
    state: 'succeeded',
    profiles: profiles.length,
    collection_scope: profiles[0].collection_scope,
    materiality_policy: PLAYWRIGHT_LIVE_RETENTION_POLICY,
    candidate,
    leak_assessment: 'not_evaluated_sampled_live_allocations',
    limitations: [
      candidate
        ? 'The candidate is sampled live allocation growth after forced GC, not exact retained bytes, a dominator path, proof of unbounded growth, or a confirmed leak.'
        : 'No material monotonically growing repository application source was observed in the three sampled-live profiles.',
    ],
  };
}

function unavailableLiveRetention(limitation) {
  return {
    schema_version: 'runtime-browser-live-retention/v1',
    state: 'unavailable',
    profiles: 0,
    collection_scope: 'objects_alive_after_forced_gc_allocated_during_same_page_probe',
    materiality_policy: PLAYWRIGHT_LIVE_RETENTION_POLICY,
    candidate: null,
    leak_assessment: 'not_evaluated_sampled_live_allocations',
    limitations: [limitation ?? 'Sampled-live retention attribution was unavailable.'],
  };
}

function normalizeProfileLimitation(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) {
    throw new Error('browser sampled-live profile limitation is invalid');
  }
  return value;
}

function liveHotspotIdentity(hotspot) {
  return hotspot.function === '<anonymous>'
    ? `${hotspot.file}:${hotspot.line}:<anonymous>`
    : `${hotspot.file}:${hotspot.function}`;
}

function sequenceSummary(values) {
  const first = values[0];
  const last = values.at(-1);
  return {
    count: values.length,
    first,
    last,
    min: Math.min(...values),
    max: Math.max(...values),
    delta: last - first,
    delta_percent: first === 0 ? null : round(((last - first) / first) * 100),
    monotonically_non_decreasing: values.every(
      (value, index) => index === 0 || value >= values[index - 1]
    ),
  };
}

function distribution(values) {
  const sorted = values.toSorted((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  return {
    count: sorted.length,
    min: sorted[0],
    median,
    max: sorted.at(-1),
    spread_percent:
      median === 0 ? null : round(((sorted.at(-1) - sorted[0]) / Math.abs(median)) * 100),
  };
}

function unavailable(samples, limitation) {
  return {
    schema_version: 'runtime-playwright-repeated-memory/v1',
    state: 'unavailable',
    context_scope: 'fresh_context_exact_flow_repeats',
    forced_gc: true,
    samples,
    summary: null,
    leak_assessment: 'not_evaluated_fresh_contexts',
    limitations: [limitation],
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}
