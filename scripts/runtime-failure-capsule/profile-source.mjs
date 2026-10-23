import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import Module from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIMITS, isExcludedPath, repositoryRelative } from './contracts.mjs';

const OMITTED =
  'CPU frames without matching executed/source byte identity were omitted; transformed coordinates require separate mapping qualification.';

export async function qualifyProfileSources(document, name, directory, root) {
  const identity = await readIdentity(name, directory);
  const sources = new Map(identity?.sources?.map((entry) => [entry.script_id, entry]) ?? []);
  const cache = new Map();
  let omitted = false;
  const nodes = [];
  for (const node of (document.nodes ?? []).slice(0, LIMITS.profileSamples)) {
    const frame = node?.callFrame;
    const path = sourcePath(frame?.url, root);
    if (!path) {
      nodes.push(node);
      continue;
    }
    const recorded = sources.get(frame.scriptId);
    const key = `${frame.scriptId}:${path}`;
    if (!cache.has(key)) cache.set(key, await matchesCurrentSource(recorded, path, root));
    if (cache.get(key)) nodes.push(node);
    else {
      omitted = true;
      nodes.push({ ...node, callFrame: { ...frame, url: '' } });
    }
  }
  return {
    document: { ...document, nodes },
    limitations: omitted ? [OMITTED] : [],
    truncated: identity?.truncated === true,
  };
}

async function readIdentity(name, directory) {
  // Node's default CPU filename binds the process and worker-thread isolate.
  const match = /^CPU\.\d{8}\.\d{6}\.(\d+)\.(\d+)\.\d+\.cpuprofile$/.exec(name);
  if (!match) return null;
  try {
    const path = join(directory, `source-${match[1]}-${match[2]}.json`);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.size > LIMITS.receiptBytes) return null;
    const data = JSON.parse(await readFile(path, 'utf8'));
    return data.schema_version === 1 &&
      data.process_id === Number(match[1]) &&
      data.thread_id === Number(match[2]) &&
      Array.isArray(data.sources) &&
      data.sources.length <= LIMITS.scanFiles
      ? data
      : null;
  } catch {
    return null;
  }
}

function sourcePath(url, root) {
  try {
    const path = fileURLToPath(url);
    const relative = repositoryRelative(root, path);
    return relative && !isExcludedPath(relative) ? path : null;
  } catch {
    return null;
  }
}

async function matchesCurrentSource(recorded, path, root) {
  if (!recorded || sourcePath(recorded.url, root) !== path) return false;
  try {
    const canonical = await realpath(path);
    const relative = repositoryRelative(root, canonical);
    if (!relative || isExcludedPath(relative)) return false;
    const metadata = await stat(canonical);
    if (!metadata.isFile() || metadata.size > LIMITS.sourceBytes) return false;
    const source = await readFile(canonical, 'utf8');
    // Node's standard CJS wrapper adds no prefix line; source line numbers agree.
    return [source, Module.wrap(source)].some(
      (text) => createHash('sha256').update(text).digest('hex') === recorded.sha256
    );
  } catch {
    return false;
  }
}
