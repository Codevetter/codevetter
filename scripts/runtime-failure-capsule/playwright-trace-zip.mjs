import { inflateRawSync } from 'node:zlib';

import { PLAYWRIGHT_CAPTURE_LIMITS } from './playwright-capture-contracts.mjs';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export function extractPlaywrightTraceZip(value) {
  const archive = Buffer.from(value);
  if (archive.length === 0 || archive.length > PLAYWRIGHT_CAPTURE_LIMITS.zipBytes) {
    throw new Error('Playwright trace ZIP is empty or exceeds the capture bound');
  }
  const eocd = findEndOfCentralDirectory(archive);
  const entryCount = archive.readUInt16LE(eocd + 10);
  const centralBytes = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralBytes === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64 Playwright traces are unsupported');
  }
  if (entryCount > PLAYWRIGHT_CAPTURE_LIMITS.zipEntries || centralOffset + centralBytes > eocd) {
    throw new Error('Playwright trace ZIP central directory is invalid or exceeds bounds');
  }

  const streams = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('Playwright trace ZIP central entry is malformed');
    }
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const compressedBytes = archive.readUInt32LE(offset + 20);
    const uncompressedBytes = archive.readUInt32LE(offset + 24);
    const nameBytes = archive.readUInt16LE(offset + 28);
    const extraBytes = archive.readUInt16LE(offset + 30);
    const commentBytes = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const end = offset + 46 + nameBytes + extraBytes + commentBytes;
    if (end > archive.length) throw new Error('Playwright trace ZIP entry exceeds archive');
    const name = archive.subarray(offset + 46, offset + 46 + nameBytes).toString('utf8');
    assertSafeEntryName(name);
    if (flags & 1) throw new Error('Encrypted Playwright trace ZIP entries are unsupported');
    if (name.endsWith('.trace') || name.endsWith('.network')) {
      if (streams.length >= PLAYWRIGHT_CAPTURE_LIMITS.traceEntries) {
        throw new Error('Playwright trace stream count exceeds bound');
      }
      const stream = extractEntry({
        archive,
        name,
        method,
        compressedBytes,
        uncompressedBytes,
        localOffset,
      });
      const extractedBytes = streams.reduce((total, entry) => total + entry.length, 0);
      if (extractedBytes + stream.length > PLAYWRIGHT_CAPTURE_LIMITS.traceBytes) {
        throw new Error('Extracted Playwright trace evidence exceeds the trace bound');
      }
      streams.push(stream);
    }
    offset = end;
  }
  if (streams.length === 0) throw new Error('Playwright trace ZIP contains no trace streams');
  const source = streams
    .map((entry) => entry.toString('utf8').trim())
    .filter(Boolean)
    .join('\n');
  if (Buffer.byteLength(source) > PLAYWRIGHT_CAPTURE_LIMITS.traceBytes) {
    throw new Error('Extracted Playwright trace evidence exceeds the trace bound');
  }
  return source;
}

function extractEntry({ archive, name, method, compressedBytes, uncompressedBytes, localOffset }) {
  if (
    uncompressedBytes > PLAYWRIGHT_CAPTURE_LIMITS.traceBytes ||
    compressedBytes > PLAYWRIGHT_CAPTURE_LIMITS.zipBytes ||
    localOffset + 30 > archive.length ||
    archive.readUInt32LE(localOffset) !== LOCAL_SIGNATURE
  ) {
    throw new Error(`Playwright trace ZIP entry is invalid or oversized: ${name}`);
  }
  const localNameBytes = archive.readUInt16LE(localOffset + 26);
  const localExtraBytes = archive.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + localNameBytes + localExtraBytes;
  const dataEnd = dataStart + compressedBytes;
  if (dataEnd > archive.length) throw new Error(`Playwright trace ZIP entry is truncated: ${name}`);
  const payload = archive.subarray(dataStart, dataEnd);
  let extracted;
  if (method === 0) extracted = Buffer.from(payload);
  else if (method === 8) {
    extracted = inflateRawSync(payload, { maxOutputLength: PLAYWRIGHT_CAPTURE_LIMITS.traceBytes });
  } else {
    throw new Error(`Unsupported Playwright trace ZIP compression method: ${method}`);
  }
  if (extracted.length !== uncompressedBytes) {
    throw new Error(`Playwright trace ZIP entry size mismatch: ${name}`);
  }
  return extracted;
}

function findEndOfCentralDirectory(archive) {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('Playwright trace ZIP end record is missing');
}

function assertSafeEntryName(name) {
  if (
    name.length === 0 ||
    name.length > 1_000 ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.split('/').includes('..')
  ) {
    throw new Error('Playwright trace ZIP entry name is unsafe');
  }
}
