import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { threadId } from 'node:worker_threads';

import { LIMITS, isExcludedPath, repositoryRelative } from './contracts.mjs';

const directory = process.env.CODEVETTER_PROFILE_SOURCE_DIRECTORY;
if (directory) captureSourceIdentities(directory);

function captureSourceIdentities(outputDirectory) {
  const session = new Session();
  const identity = {
    schema_version: 1,
    process_id: process.pid,
    thread_id: threadId,
    sources: [],
    truncated: false,
  };
  let pending = 0;
  let full = false;
  session.connect();
  session.on('Debugger.scriptParsed', ({ params }) => {
    let path;
    try {
      path = fileURLToPath(params.url);
    } catch {
      return;
    }
    const relative = repositoryRelative(process.cwd(), path);
    if (!relative || isExcludedPath(relative)) return;
    if (
      full ||
      identity.sources.length + pending >= LIMITS.scanFiles ||
      params.length > LIMITS.sourceBytes
    ) {
      identity.truncated = true;
      return;
    }
    pending++;
    session.post('Debugger.getScriptSource', { scriptId: params.scriptId }, (error, result) => {
      pending--;
      const text = result?.scriptSource;
      if (error || typeof text !== 'string' || Buffer.byteLength(text) > LIMITS.sourceBytes) {
        identity.truncated = true;
        return;
      }
      full = !appendSourceIdentity(identity, {
        script_id: params.scriptId,
        url: pathToFileURL(path).href,
        sha256: createHash('sha256').update(text).digest('hex'),
      });
    });
  });
  session.post('Debugger.setSkipAllPauses', { skip: true }, (error) => {
    if (error) {
      identity.truncated = true;
      session.disconnect();
      return;
    }
    session.post('Debugger.enable', (enableError) => {
      if (enableError) identity.truncated = true;
    });
  });
  process.once('exit', () => {
    // No source text or external inspector port: only bounded local identities.
    try {
      writeFileSync(
        join(outputDirectory, `source-${process.pid}-${threadId}.json`),
        JSON.stringify({ ...identity, truncated: identity.truncated || pending > 0 }),
        { mode: 0o600 }
      );
    } catch {
      // Missing identity evidence is rejected by the parent collector.
    }
    session.disconnect();
  });
}

export function appendSourceIdentity(identity, source) {
  const candidate = { ...identity, sources: [...identity.sources, source], truncated: false };
  if (
    candidate.sources.length > LIMITS.scanFiles ||
    Buffer.byteLength(JSON.stringify(candidate)) > LIMITS.receiptBytes
  ) {
    identity.truncated = true;
    return false;
  }
  identity.sources.push(source);
  return true;
}
