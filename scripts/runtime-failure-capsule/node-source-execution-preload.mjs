import './node-profile-source-preload.mjs';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { takeCoverage, stopCoverage } from 'node:v8';
import { threadId } from 'node:worker_threads';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const directory = process.env.NODE_V8_COVERAGE;
const context = parseContext(process.env.CODEVETTER_COVERAGE_CONTEXT);
const selection = parseContext(process.env.CODEVETTER_NODE_TEST_SCOPE);
if (directory && context && selection) captureSnapshot(directory, context, selection);

function parseContext(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function captureSnapshot(outputDirectory, identity, scope) {
  const runtime = process.version;
  const nodeBinary = hash(readFileSync(process.execPath));
  let flushedFile = null;
  let failure = 'no_final_owned_flush';
  const files = () =>
    readdirSync(outputDirectory).filter((name) =>
      new RegExp(`^coverage-${process.pid}-[0-9]+-${threadId}\\.json$`).test(name)
    );
  // A selected-run snapshot, not evidence about later user exit handlers.
  process.prependOnceListener('exit', () => {
    try {
      if (files().length) {
        failure = 'preexisting_coverage_artifact';
        stopCoverage();
        return;
      }
      takeCoverage();
      stopCoverage();
      const created = files();
      if (created.length === 1) flushedFile = created[0];
    } catch {
      failure = 'final_flush_failed';
    }
  });
  // The imported identity preload writes its bounded source sidecar first.
  process.once('exit', () => {
    try {
      const base = {
        schema_version: 1,
        nonce: identity.nonce,
        run_id: identity.run_id,
        process_id: process.pid,
        thread_id: threadId,
      };
      let receipt = { ...base, status: 'incomplete', reason: failure };
      if (flushedFile && files().length === 1 && files()[0] === flushedFile) {
        receipt = {
          ...base,
          status: 'complete',
          runtime,
          node_binary_sha256: nodeBinary,
          selection_sha256: hash(JSON.stringify(scope)),
          coverage_file: flushedFile,
          coverage_sha256: hash(readBounded(join(outputDirectory, flushedFile), 16 * 1024 * 1024)),
          source_identity_sha256: hash(
            readBounded(join(outputDirectory, `source-${process.pid}-${threadId}.json`), 262144)
          ),
        };
      }
      writeFileSync(
        join(outputDirectory, `source-execution-context-${process.pid}-${threadId}.json`),
        JSON.stringify(receipt),
        { mode: 0o600, flag: 'wx' }
      );
    } catch {
      /* Parent treats absent or malformed producer evidence as unknown. */
    }
  });
}

function readBounded(path, maximum) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maximum) throw new Error('artifact bound');
    const buffer = Buffer.alloc(maximum + 1);
    const bytes = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytes > maximum) throw new Error('artifact bound');
    return buffer.subarray(0, bytes);
  } finally {
    closeSync(descriptor);
  }
}
