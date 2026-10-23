import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex');
let binaryDigest;
export const currentNodeDigest = () =>
  (binaryDigest ??= readBounded(process.execPath, 268435456).then(hash));

export async function readBounded(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) throw new Error('capture_bound_exceeded');
    const buffer = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== stat.size) throw new Error('capture_bound_exceeded');
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function capturedNames(directory) {
  const names = (await readdir(directory))
    .filter((name) => /^source-execution-context-[0-9]+-[0-9]+\.json$/.test(name))
    .sort();
  return { names: names.slice(0, 16), truncated: names.length > 16 };
}

// Artifact identity is observed by the child producer and independently compared here.
export async function readCapture(directory, name, expected) {
  const match = /^source-execution-context-([0-9]+)-([0-9]+)\.json$/.exec(name);
  if (!match) throw new Error('capture_identity_mismatch');
  const [processId, threadId] = match.slice(1).map(Number);
  const contextBytes = await readBounded(join(directory, name), 4096);
  const producer = JSON.parse(contextBytes);
  if (producer.status !== 'complete') throw new Error('capture_incomplete');
  const file = producer.coverage_file;
  if (
    typeof file !== 'string' ||
    !new RegExp(`^coverage-${processId}-[0-9]+-${threadId}\\.json$`).test(file)
  )
    throw new Error('capture_identity_mismatch');
  const coverageBytes = await readBounded(join(directory, file), 16777216);
  const identityBytes = await readBounded(
    join(directory, `source-${processId}-${threadId}.json`),
    262144
  );
  const observed = {
    ...expected,
    schema_version: 1,
    process_id: processId,
    thread_id: threadId,
    coverage_sha256: hash(coverageBytes),
    source_identity_sha256: hash(identityBytes),
  };
  if (
    Object.entries(observed).some(([key, value]) => value === undefined || producer[key] !== value)
  )
    throw new Error('capture_identity_mismatch');
  const identity = JSON.parse(identityBytes);
  const document = JSON.parse(coverageBytes);
  if (
    identity.schema_version !== 1 ||
    identity.process_id !== processId ||
    identity.thread_id !== threadId ||
    !Array.isArray(identity.sources) ||
    identity.sources.length > 500 ||
    !Array.isArray(document.result)
  )
    throw new Error('capture_identity_mismatch');
  return { identity, document, captureId: hash(contextBytes) };
}
