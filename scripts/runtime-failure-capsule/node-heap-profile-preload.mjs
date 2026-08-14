import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { isAbsolute, resolve } from 'node:path';
import { threadId } from 'node:worker_threads';

import { V8_HEAP_PROFILE_INTERVAL_BYTES as SAMPLE_INTERVAL_BYTES } from './v8-heap-profile.mjs';

const outputDirectory = process.env.CODEVETTER_HEAP_PROFILE_DIRECTORY;
const CHECKPOINT_INTERVAL_MS = 50;
const MAX_PROFILE_BYTES = 16 * 1024 * 1024;
let session = null;
let stopped = false;
let checkpointInFlight = false;
let checkpointTimer = null;

const readiness = start();
process.once('beforeExit', () => {
  void stop();
});

async function start() {
  if (typeof outputDirectory !== 'string' || !isAbsolute(outputDirectory)) return false;
  try {
    session = new Session();
    session.connect();
    await post('HeapProfiler.startSampling', {
      samplingInterval: SAMPLE_INTERVAL_BYTES,
      stackDepth: 128,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    checkpointTimer = setInterval(() => {
      void checkpoint();
    }, CHECKPOINT_INTERVAL_MS);
    checkpointTimer.unref();
    return true;
  } catch {
    session?.disconnect();
    session = null;
    return false;
  }
}

async function stop() {
  if (stopped) return;
  stopped = true;
  if (checkpointTimer) clearInterval(checkpointTimer);
  try {
    if (!(await readiness) || !session) return;
    const result = await post('HeapProfiler.stopSampling');
    writeProfile(result?.profile);
  } catch {
    // The parent reports absent or malformed profiles as an optional evidence gap.
  } finally {
    session?.disconnect();
    session = null;
  }
}

async function checkpoint() {
  if (stopped || checkpointInFlight || !(await readiness) || !session) return;
  checkpointInFlight = true;
  try {
    const result = await post('HeapProfiler.getSamplingProfile');
    writeProfile(result?.profile);
  } catch {
    // A later checkpoint or the final stop may still produce usable evidence.
  } finally {
    checkpointInFlight = false;
  }
}

function writeProfile(profile) {
  const serialized = `${JSON.stringify(profile)}\n`;
  const bytes = Buffer.byteLength(serialized);
  if (bytes < 2 || bytes > MAX_PROFILE_BYTES) return;
  writeFileSync(
    resolve(outputDirectory, `Heap.${process.pid}.${threadId}.heapprofile`),
    serialized,
    {
      encoding: 'utf8',
      flag: 'w',
      mode: 0o600,
    }
  );
}

function post(method, parameters = undefined) {
  return new Promise((resolvePromise, reject) => {
    session.post(method, parameters, (error, result) => {
      if (error) reject(error);
      else resolvePromise(result);
    });
  });
}
