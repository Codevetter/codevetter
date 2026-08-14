import { writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import * as base from 'codevetter-playwright-memory-base';
import {
  BROWSER_LIVE_ALLOCATION_INTERVAL_BYTES,
  normalizeBrowserLiveAllocationProfile,
} from './browser-live-allocation.mjs';

export * from 'codevetter-playwright-memory-base';

const outputDirectory = process.env.CODEVETTER_BROWSER_MEMORY_DIRECTORY;
const memoryMode = process.env.CODEVETTER_BROWSER_MEMORY_MODE ?? 'fresh_contexts';
const selectedTestName = process.env.CODEVETTER_BROWSER_MEMORY_TEST_NAME;
const repositoryRoot = process.env.CODEVETTER_REPOSITORY_ROOT;
const SAME_PAGE_REPEATS = 3;

const instrumentedTest = base.test.extend({
  codevetterMemoryProbe: [
    async ({ context, page }, use, testInfo) => {
      if (memoryMode === 'same_page') {
        await use();
        return;
      }
      let session = null;
      let before = null;
      let after = null;
      let limitation = null;
      try {
        session = await context.newCDPSession(page);
        before = await sample(session);
      } catch {
        limitation = 'before_sample_unavailable';
      }
      await use();
      try {
        after = session ? await sample(session) : null;
        if (!after) limitation = limitation ?? 'after_sample_unavailable';
      } catch {
        limitation = limitation ?? 'after_sample_unavailable';
      }
      persist({
        schema_version: 'runtime-playwright-memory-sample/v1',
        repeat_index: testInfo.repeatEachIndex,
        retry: testInfo.retry,
        before,
        after,
        limitation,
      });
      await session?.detach().catch(() => {});
    },
    { auto: true },
  ],
});

const samePageTest = new Proxy(instrumentedTest, {
  apply(target, thisArgument, argumentsList) {
    if (
      memoryMode !== 'same_page' ||
      argumentsList[0] !== selectedTestName ||
      typeof argumentsList.at(-1) !== 'function'
    ) {
      return Reflect.apply(target, thisArgument, argumentsList);
    }
    const wrappedArguments = [...argumentsList];
    const projectCallback = wrappedArguments.at(-1);
    wrappedArguments[wrappedArguments.length - 1] = async ({ context, page }, testInfo) => {
      const samples = [];
      let limitation = null;
      let retainedProfileLimitation = null;
      let session = null;
      let liveAllocationSampling = false;
      try {
        session = await context.newCDPSession(page);
        await session.send('HeapProfiler.enable');
        await session.send('HeapProfiler.collectGarbage');
        try {
          await session.send('HeapProfiler.startSampling', {
            samplingInterval: BROWSER_LIVE_ALLOCATION_INTERVAL_BYTES,
            stackDepth: 128,
            includeObjectsCollectedByMajorGC: false,
            includeObjectsCollectedByMinorGC: false,
          });
          liveAllocationSampling = true;
        } catch {
          retainedProfileLimitation = 'live_allocation_sampling_unavailable';
        }
        for (let index = 0; index < SAME_PAGE_REPEATS; index += 1) {
          const before = await sample(session);
          await projectCallback({ context, page }, testInfo);
          const after = await sample(session);
          let retainedProfile = null;
          if (liveAllocationSampling) {
            try {
              const result = await session.send('HeapProfiler.getSamplingProfile');
              retainedProfile = normalizeBrowserLiveAllocationProfile(
                result?.profile,
                repositoryRoot
              );
            } catch {
              retainedProfileLimitation ??= 'live_allocation_profile_unavailable';
            }
          }
          samples.push(memorySample(index, testInfo, before, after, retainedProfile));
        }
      } catch (error) {
        limitation =
          samples.length === SAME_PAGE_REPEATS
            ? 'same_page_probe_cleanup_failed'
            : 'same_page_callback_or_sample_failed';
        throw error;
      } finally {
        if (liveAllocationSampling) {
          try {
            await session?.send('HeapProfiler.stopSampling');
          } catch {
            retainedProfileLimitation ??= 'live_allocation_profile_cleanup_failed';
          }
        }
        persistSamePage({
          schema_version: 'runtime-playwright-same-page-memory-sequence/v1',
          retry: testInfo.retry,
          samples,
          limitation,
          retained_profile_limitation: retainedProfileLimitation,
        });
        await session?.detach().catch(() => {});
      }
    };
    return Reflect.apply(target, thisArgument, wrappedArguments);
  },
});

export const test = memoryMode === 'same_page' ? samePageTest : instrumentedTest;

async function sample(session) {
  await session.send('HeapProfiler.enable');
  await session.send('HeapProfiler.collectGarbage');
  const [heap, dom] = await Promise.all([
    session.send('Runtime.getHeapUsage'),
    session.send('Memory.getDOMCounters'),
  ]);
  return {
    heap_used_bytes: boundedNumber(heap?.usedSize),
    heap_total_bytes: boundedNumber(heap?.totalSize),
    embedder_heap_used_bytes: boundedNumber(heap?.embedderHeapUsedSize),
    backing_storage_bytes: boundedNumber(heap?.backingStorageSize),
    dom_nodes: boundedInteger(dom?.nodes),
    documents: boundedInteger(dom?.documents),
    event_listeners: boundedInteger(dom?.jsEventListeners),
    provenance: 'playwright_cdp_after_forced_gc',
  };
}

function persist(value) {
  if (typeof outputDirectory !== 'string' || !isAbsolute(outputDirectory)) return;
  const index = value.repeat_index;
  const retry = value.retry;
  if (!Number.isInteger(index) || index < 0 || index > 8 || retry !== 0) return;
  const serialized = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(serialized) > 16 * 1024) return;
  try {
    writeFileSync(resolve(outputDirectory, `repeat-${index}.json`), serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch {
    // The parent reports a missing or duplicate sample as an evidence gap.
  }
}

function persistSamePage(value) {
  if (
    typeof outputDirectory !== 'string' ||
    !isAbsolute(outputDirectory) ||
    value.retry !== 0 ||
    !Array.isArray(value.samples) ||
    value.samples.length > SAME_PAGE_REPEATS
  ) {
    return;
  }
  const serialized = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(serialized) > 32 * 1024) return;
  try {
    writeFileSync(resolve(outputDirectory, 'sequence.json'), serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch {
    // The parent reports a missing or duplicate sequence as an evidence gap.
  }
}

function memorySample(index, testInfo, before, after, retainedProfile) {
  return {
    schema_version: 'runtime-playwright-memory-sample/v1',
    repeat_index: index,
    retry: testInfo.retry,
    before,
    after,
    retained_profile: retainedProfile,
    limitation: null,
  };
}

function boundedNumber(value) {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error('invalid CDP memory value');
  }
  return Math.round(value);
}

function boundedInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid CDP counter');
  return value;
}
