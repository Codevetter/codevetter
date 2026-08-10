import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIMITS, isExcludedPath, repositoryRelative } from './contracts.mjs';
import { redactText } from './redact.mjs';

export async function collectV8FunctionCoverage(directory, repositoryRoot) {
  const root = resolve(repositoryRoot);
  let names;
  try {
    names = (await readdir(directory)).filter((name) => /^coverage-.*\.json$/.test(name)).sort();
  } catch {
    return emptyFunctionCoverage(['The V8 coverage artifact directory was unavailable.']);
  }

  const aggregates = new Map();
  const sourceCache = new Map();
  let bytes = 0;
  let redactionCount = 0;
  let truncated = names.length > LIMITS.coverageFiles;
  for (const name of names.slice(0, LIMITS.coverageFiles)) {
    const path = resolve(directory, name);
    let metadata;
    try {
      metadata = await stat(path);
    } catch {
      truncated = true;
      continue;
    }
    bytes += metadata.size;
    if (
      !metadata.isFile() ||
      metadata.size > LIMITS.coverageBytes ||
      bytes > LIMITS.coverageBytes
    ) {
      truncated = true;
      continue;
    }
    let document;
    try {
      document = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      truncated = true;
      continue;
    }
    for (const script of (Array.isArray(document?.result) ? document.result : []).slice(
      0,
      LIMITS.scanFiles
    )) {
      const source = await containedSource(script?.url, root, sourceCache);
      if (!source || isHarnessPath(source.relative)) continue;
      for (const functionEntry of Array.isArray(script?.functions) ? script.functions : []) {
        const name = functionEntry?.functionName?.trim();
        const range = functionEntry?.ranges?.[0];
        if (
          !name ||
          !Number.isInteger(range?.count) ||
          range.count <= 0 ||
          !Number.isInteger(range.startOffset) ||
          !Number.isInteger(range.endOffset)
        ) {
          continue;
        }
        const safeName = redactText(name, { repositoryRoot: root, limit: 160 });
        redactionCount += safeName.redaction_count;
        const startLine = offsetLine(source, range.startOffset);
        const endLine = offsetLine(source, range.endOffset);
        const key = `${source.relative}:${startLine}:${endLine}:${safeName.text}`;
        const aggregate = aggregates.get(key) ?? {
          function: safeName.text,
          file: source.relative,
          start_line: startLine,
          end_line: endLine,
          call_count: 0,
          role: 'application',
        };
        aggregate.call_count += range.count;
        aggregates.set(key, aggregate);
      }
    }
    for (const [sourcePath, coverage] of Object.entries(document).slice(0, LIMITS.scanFiles)) {
      if (!coverage?.fnMap || !coverage?.f) continue;
      const relative = repositoryRelative(root, sourcePath);
      if (!relative || isExcludedPath(relative) || isHarnessPath(relative)) continue;
      for (const [identifier, functionEntry] of Object.entries(coverage.fnMap)) {
        const count = coverage.f[identifier];
        const functionName = functionEntry?.name?.trim();
        const startLine = functionEntry?.decl?.start?.line;
        const endLine = functionEntry?.loc?.end?.line ?? functionEntry?.decl?.end?.line;
        if (
          !functionName ||
          /^\(?anonymous(?:_\d+)?\)?$/.test(functionName) ||
          !Number.isInteger(count) ||
          count <= 0 ||
          !Number.isInteger(startLine) ||
          !Number.isInteger(endLine)
        ) {
          continue;
        }
        const safeName = redactText(functionName, { repositoryRoot: root, limit: 160 });
        redactionCount += safeName.redaction_count;
        const key = `${relative}:${startLine}:${endLine}:${safeName.text}`;
        const aggregate = aggregates.get(key) ?? {
          function: safeName.text,
          file: relative,
          start_line: startLine,
          end_line: endLine,
          call_count: 0,
          role: 'application',
        };
        aggregate.call_count += count;
        aggregates.set(key, aggregate);
      }
    }
  }

  const functions = [...aggregates.values()]
    .toSorted(
      (left, right) =>
        right.call_count - left.call_count ||
        left.file.localeCompare(right.file) ||
        left.start_line - right.start_line
    )
    .slice(0, LIMITS.functionCoverage)
    .map((entry, index) => ({ id: `function-coverage-${index + 1}`, ...entry }));
  if (aggregates.size > functions.length) truncated = true;
  return {
    kind: 'v8_function_coverage',
    coverage_files: names.length,
    coverage_bytes: bytes,
    functions,
    truncated,
    redaction_count: redactionCount,
    limitations:
      names.length === 0 ? ['The diagnostic execution produced no V8 function coverage.'] : [],
  };
}

export function emptyFunctionCoverage(limitations = []) {
  return {
    kind: 'v8_function_coverage',
    coverage_files: 0,
    coverage_bytes: 0,
    functions: [],
    truncated: false,
    redaction_count: 0,
    limitations,
  };
}

async function containedSource(url, root, cache) {
  if (typeof url !== 'string' || !url.startsWith('file:')) return null;
  let path;
  try {
    path = fileURLToPath(url);
  } catch {
    return null;
  }
  const relative = repositoryRelative(root, path);
  if (!relative || isExcludedPath(relative)) return null;
  if (cache.has(relative)) return cache.get(relative);
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > LIMITS.sourceBytes) return null;
    const text = await readFile(path, 'utf8');
    const source = { relative, text, lineStarts: indexLineStarts(text) };
    cache.set(relative, source);
    return source;
  } catch {
    return null;
  }
}

function isHarnessPath(path) {
  return (
    /(^|\/)(test|tests|__tests__|benchmark|benchmarks)(\/|$)/.test(path) ||
    /(?:^|\.)+(?:test|spec)\.[cm]?[jt]sx?$/.test(path) ||
    /_test\.go$/.test(path)
  );
}

function indexLineStarts(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function offsetLine(source, offset) {
  const bounded = Math.max(0, Math.min(offset, source.text.length));
  let lower = 0;
  let upper = source.lineStarts.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (source.lineStarts[middle] <= bounded) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}
