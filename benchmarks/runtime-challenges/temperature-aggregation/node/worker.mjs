import { parentPort, workerData } from 'node:worker_threads';

import { aggregateFileRange } from './file-parser.mjs';

try {
  const aggregates = await aggregateFileRange(workerData.path, workerData.start, workerData.end);
  parentPort.postMessage({ entries: [...aggregates] });
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
