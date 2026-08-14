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

  const aggregateIndexes = new Map();
  const aggregateFunctions = [];
  const aggregateFiles = [];
  const aggregateStartLines = [];
  const aggregateEndLines = [];
  const aggregateCallCounts = [];
  const aggregateCollisionNext = [];
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
        const safeName = redactCoverageFunctionName(name, root);
        const functionName = typeof safeName === 'string' ? safeName : safeName.text;
        if (typeof safeName !== 'string') redactionCount += safeName.redaction_count;
        const startLine = offsetLine(source, range.startOffset);
        const endLine = offsetLine(source, range.endOffset);
        addFunction(functionName, source.relative, startLine, endLine, range.count);
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
        const safeName = redactCoverageFunctionName(functionName, root);
        const redactedFunctionName = typeof safeName === 'string' ? safeName : safeName.text;
        if (typeof safeName !== 'string') redactionCount += safeName.redaction_count;
        addFunction(redactedFunctionName, relative, startLine, endLine, count);
      }
    }
  }

  const functions = Array.from({ length: aggregateCallCounts.length }, (_, index) => index)
    .toSorted(
      (left, right) =>
        aggregateCallCounts[right] - aggregateCallCounts[left] ||
        aggregateFiles[left].localeCompare(aggregateFiles[right]) ||
        aggregateStartLines[left] - aggregateStartLines[right]
    )
    .slice(0, LIMITS.functionCoverage)
    .map((entry, index) => ({
      id: `function-coverage-${index + 1}`,
      function: aggregateFunctions[entry],
      file: aggregateFiles[entry],
      start_line: aggregateStartLines[entry],
      end_line: aggregateEndLines[entry],
      call_count: aggregateCallCounts[entry],
      role: 'application',
    }));
  if (aggregateCallCounts.length > functions.length) truncated = true;
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

  function addFunction(name, file, startLine, endLine, count) {
    const key = functionIdentityHash(name, file, startLine, endLine);
    let existing = aggregateIndexes.get(key);
    while (existing !== undefined && existing !== -1) {
      if (
        aggregateFunctions[existing] === name &&
        aggregateFiles[existing] === file &&
        aggregateStartLines[existing] === startLine &&
        aggregateEndLines[existing] === endLine
      ) {
        aggregateCallCounts[existing] += count;
        return;
      }
      existing = aggregateCollisionNext[existing];
    }
    const index = aggregateCallCounts.length;
    aggregateCollisionNext.push(aggregateIndexes.get(key) ?? -1);
    aggregateIndexes.set(key, index);
    aggregateFunctions.push(name);
    aggregateFiles.push(file);
    aggregateStartLines.push(startLine);
    aggregateEndLines.push(endLine);
    aggregateCallCounts.push(count);
  }
}

function functionIdentityHash(name, file, startLine, endLine) {
  let hash = 2_166_136_261;
  for (let index = 0; index < file.length; index += 1) {
    hash = Math.imul(hash ^ file.charCodeAt(index), 16_777_619);
  }
  hash = Math.imul(hash ^ startLine, 16_777_619);
  hash = Math.imul(hash ^ endLine, 16_777_619);
  for (let index = 0; index < name.length; index += 1) {
    hash = Math.imul(hash ^ name.charCodeAt(index), 16_777_619);
  }
  return hash >>> 0;
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

function redactCoverageFunctionName(name, repositoryRoot) {
  if (name.length <= 160) {
    let sensitiveSyntax = false;
    for (let index = 0; index < name.length; index += 1) {
      const code = name.charCodeAt(index);
      if (
        code === 10 ||
        code === 13 ||
        code === 47 ||
        code === 58 ||
        code === 61 ||
        code === 63 ||
        code === 92
      ) {
        sensitiveSyntax = true;
        break;
      }
    }
    if (!sensitiveSyntax) return name;
  }
  return redactText(name, { repositoryRoot, limit: 160 });
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
