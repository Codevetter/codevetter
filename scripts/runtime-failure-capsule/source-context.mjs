import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

import { LIMITS, repositoryRelative } from './contracts.mjs';
import { redactText } from './redact.mjs';

const SUPPORTED_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.go',
]);
const COLLECTION_OPERATION = /\.(filter|map|flatMap|reduce|sort|slice)\s*\(/g;

export async function collectRuntimeSourceContexts(repositoryRoot, capsule) {
  const root = await realpath(resolve(repositoryRoot));
  const candidates = sourceCandidates(capsule).slice(0, LIMITS.sourceFiles);
  const contexts = [];
  const limitations = [];

  for (const candidate of candidates) {
    const result = await readSourceWindow(root, candidate);
    if (result.context) contexts.push(result.context);
    if (result.limitation) limitations.push(result.limitation);
  }

  return { contexts, limitations: [...new Set(limitations)] };
}

export function analyzeSourcePatterns(lines, startLine = 1) {
  const operations = [];
  const traversals = [];
  const patterns = [];
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = startLine + index;
    for (const match of lines[index].matchAll(COLLECTION_OPERATION)) {
      operations.push({ operation: match[1], line: lineNumber });
    }
    const forOf = /for\s*\(\s*(?:const|let|var)\s+[^;]+?\s+of\s+([A-Za-z_$][\w$]*)\s*\)/.exec(
      lines[index]
    );
    const indexed = /for\s*\([^;]*;[^;]*<\s*([A-Za-z_$][\w$]*)\.length\b/.exec(lines[index]);
    const collection = forOf?.[1] ?? indexed?.[1];
    if (collection) {
      traversals.push({
        collection,
        line: lineNumber,
        indentation: /^\s*/.exec(lines[index])?.[0].length ?? 0,
      });
    }
    if (/\.split\(\s*(['"])\\n\1\s*,\s*1\s*\)\s*\[\s*0\s*\]/.test(lines[index])) {
      patterns.push({
        kind: 'split_for_prefix',
        lines: [startLine + index],
        delimiter: '\\n',
        observation: 'A complete split result is created only to retain the first segment.',
      });
    }
    const stringFormat = supportedGoStringFormat(lines[index]);
    if (stringFormat) {
      patterns.push({
        kind: 'go_static_string_format',
        lines: [lineNumber],
        string_verbs: stringFormat.stringVerbs,
        observation: 'fmt.Sprintf constructs one string from literal text and %s verbs only.',
      });
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (/\.find\s*\(/.test(lines[index]) && /\.some\s*\(/.test(lines[index])) {
      patterns.push({
        kind: 'nested_collection_lookup',
        lines: [startLine + index],
        operations: ['find', 'some'],
        observation: 'A lookup scans one collection and then scans members of each candidate.',
      });
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    const keys = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*Object\.keys\s*\(/.exec(lines[index]);
    if (!keys) continue;
    const membership = lines
      .slice(index + 1, index + 21)
      .findIndex((line) => new RegExp(`\\b${keys[1]}\\.includes\\s*\\(`).test(line));
    if (membership === -1) continue;
    patterns.push({
      kind: 'linear_membership_over_keys',
      lines: [startLine + index, startLine + index + membership + 1],
      collection: keys[1],
      observation:
        'Materialized object keys are scanned with linear membership checks inside later work.',
    });
  }
  const sort = operations.find((entry) => entry.operation === 'sort');
  const slice = operations.find(
    (entry) =>
      entry.operation === 'slice' && sort && entry.line >= sort.line && entry.line - sort.line <= 12
  );
  if (sort && slice) {
    const sliceText = lines[slice.line - startLine] ?? '';
    const limit = /\.slice\(\s*0\s*,\s*([^),]+)/.exec(sliceText)?.[1]?.trim() ?? 'unknown';
    patterns.push({
      kind: 'full_sort_before_bounded_slice',
      lines: [sort.line, slice.line],
      limit_expression: limit,
      observation: 'A complete collection sort occurs before a bounded prefix is retained.',
    });
  }

  const eagerMap = operations.find(
    (entry) =>
      entry.operation === 'map' && sort && entry.line <= sort.line && sort.line - entry.line <= 20
  );
  if (eagerMap && sort) {
    patterns.push({
      kind: 'eager_map_before_sort',
      lines: [eagerMap.line, sort.line],
      observation: 'Every candidate is mapped before the collection is sorted.',
    });
  }

  const fullPasses = operations.filter((entry) =>
    ['filter', 'map', 'flatMap', 'reduce', 'sort'].includes(entry.operation)
  );
  if (fullPasses.length >= 3) {
    patterns.push({
      kind: 'repeated_collection_passes',
      lines: fullPasses.slice(0, 8).map((entry) => entry.line),
      operations: fullPasses.slice(0, 8).map((entry) => entry.operation),
      observation: `${fullPasses.length} collection-wide operations appear in the bounded runtime-selected source window.`,
    });
  }

  const traversalsByCollection = new Map();
  for (const traversal of traversals) {
    const key = `${traversal.collection}:${traversal.indentation}`;
    const existing = traversalsByCollection.get(key) ?? {
      collection: traversal.collection,
      lines: [],
    };
    existing.lines.push(traversal.line);
    traversalsByCollection.set(key, existing);
  }
  for (const { collection, lines: linesForCollection } of traversalsByCollection.values()) {
    if (linesForCollection.length < 2) continue;
    const firstIndex = linesForCollection[0] - startLine;
    const lastIndex = linesForCollection.at(-1) - startLine;
    if (lines.slice(firstIndex + 1, lastIndex).some((line) => /^\s*return\b/.test(line))) {
      continue;
    }
    patterns.push({
      kind: 'repeated_source_traversal',
      lines: linesForCollection.slice(0, 8),
      collection,
      observation: `${collection} is traversed ${linesForCollection.length} times in the bounded runtime-selected source window.`,
    });
  }

  return patterns;
}

function sourceCandidates(capsule) {
  const candidates = [];
  for (const finding of capsule?.findings ?? []) {
    if (finding?.source?.file) {
      candidates.push({
        source: finding.source,
        priority: sourceFindingPriority(finding),
        share: sourceFindingShare(finding),
      });
    }
  }
  for (const hotspot of capsule?.observed?.hotspots ?? []) {
    if (hotspot?.role === 'application' && hotspot.file) {
      candidates.push({
        source: { file: hotspot.file, line: hotspot.line, function: hotspot.function },
        priority: hotspot.profile_kind === 'go_alloc_objects' && hotspot.flat > 0 ? 0 : 3,
        share: hotspot.flat_share ?? hotspot.sample_share ?? 0,
      });
    }
  }
  candidates.sort(
    (left, right) =>
      left.priority - right.priority ||
      right.share - left.share ||
      left.source.file.localeCompare(right.source.file) ||
      String(left.source.function ?? '').localeCompare(String(right.source.function ?? '')) ||
      left.source.line - right.source.line
  );
  const seen = new Set();
  return candidates
    .map((candidate) => candidate.source)
    .filter((candidate) => {
      const key =
        typeof candidate.function === 'string' && candidate.function.length > 0
          ? `${candidate.file}\0${candidate.function}`
          : `${candidate.file}:${candidate.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sourceFindingPriority(finding) {
  if (
    finding.kind === 'go_allocation_path_candidate' &&
    finding.profile_kind === 'go_alloc_objects' &&
    finding.flat_profile_objects > 0
  ) {
    return 0;
  }
  if (['node_allocation_candidate', 'application_hotspot_candidate'].includes(finding.kind)) {
    return 1;
  }
  if (finding.kind === 'go_allocation_path_candidate') return 2;
  return 3;
}

function sourceFindingShare(finding) {
  return finding.flat_share ?? finding.sample_share ?? finding.cumulative_share ?? 0;
}

async function readSourceWindow(root, candidate) {
  if (
    typeof candidate.file !== 'string' ||
    !Number.isInteger(candidate.line) ||
    candidate.line < 1 ||
    !SUPPORTED_EXTENSIONS.has(extname(candidate.file))
  ) {
    return { limitation: `Source context is unavailable for ${candidate.file ?? '<unknown>'}.` };
  }
  const lexical = resolve(root, candidate.file);
  if (repositoryRelative(root, lexical) === null) {
    return { limitation: `Source context escaped the repository: ${candidate.file}.` };
  }

  let metadata;
  let path;
  try {
    metadata = await lstat(lexical);
    path = await realpath(lexical);
  } catch {
    return { limitation: `Source context file is unreadable: ${candidate.file}.` };
  }
  if (
    (!metadata.isFile() && !metadata.isSymbolicLink()) ||
    repositoryRelative(root, path) === null
  ) {
    return { limitation: `Source context is not a contained regular file: ${candidate.file}.` };
  }
  const resolvedMetadata = await stat(path);
  if (!resolvedMetadata.isFile() || resolvedMetadata.size > LIMITS.sourceBytes) {
    return { limitation: `Source context exceeds the regular-file bound: ${candidate.file}.` };
  }

  const source = await readFile(path, 'utf8');
  const allLines = source.split(/\r?\n/);
  const anchor = findFunctionAnchor(allLines, candidate);
  const reportedLine = candidate.line;
  const anchoredLine = anchor.line;
  const before = 24;
  const startLine = Math.max(1, anchoredLine - before);
  const endLine = Math.min(allLines.length, startLine + LIMITS.sourceLines - 1);
  const lines = allLines.slice(startLine - 1, endLine);
  const analysisRange =
    findFunctionBodyRange(allLines, anchoredLine) ??
    findEnclosingFunctionRange(allLines, anchoredLine);
  const analysisStartLine = analysisRange?.start ?? startLine;
  const analysisEndLine = analysisRange?.end ?? endLine;
  const analysisLines = allLines.slice(analysisStartLine - 1, analysisEndLine);
  const excerpt = lines.map((line, index) => `${startLine + index}: ${line}`).join('\n');
  const redacted = redactText(excerpt, { repositoryRoot: root, limit: LIMITS.summaryCharacters });

  return {
    context: {
      source: {
        file: candidate.file,
        line: anchoredLine,
        ...(anchoredLine === reportedLine ? {} : { reported_line: reportedLine }),
        function: anchor.function,
        ...(anchor.function === candidate.function
          ? {}
          : { reported_function: candidate.function ?? null }),
        start_line: startLine,
        end_line: endLine,
      },
      source_context_sha256: createHash('sha256').update(analysisLines.join('\n')).digest('hex'),
      excerpt: redacted.text,
      patterns: analyzeSourcePatterns(analysisLines, analysisStartLine),
      redaction_count: redacted.redaction_count,
      truncated: redacted.truncated || endLine < allLines.length,
      provenance: 'bounded_runtime_selected_source',
    },
  };
}

function findFunctionAnchor(lines, candidate) {
  const reportedFunction = candidate.function;
  const functionName = simpleFunctionName(reportedFunction);
  if (!functionName) {
    const enclosing = findEnclosingFunctionRange(lines, candidate.line);
    return {
      line: enclosing?.start ?? candidate.line,
      function: enclosing?.function ?? reportedFunction ?? null,
    };
  }
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp(
    `(?:function\\s+${escaped}\\b|(?:const|let|var)\\s+${escaped}\\s*=|\\b${escaped}\\s*\\([^)]*\\)\\s*(?::[^{}]+)?\\{|^\\s*func(?:\\s*\\([^)]*\\))?\\s+${escaped}\\s*\\()`
  );
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (declaration.test(lines[index])) matches.push(index + 1);
  }
  return {
    line: matches.length === 1 ? matches[0] : candidate.line,
    function: functionName,
  };
}

function simpleFunctionName(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (/^[A-Za-z_$][\w$]*$/.test(value)) return value;
  const suffix = /\.([A-Za-z_$][\w$]*)$/.exec(value)?.[1] ?? null;
  return suffix && /^[A-Za-z_$][\w$]*$/.test(suffix) ? suffix : null;
}

function supportedGoStringFormat(line) {
  const match = /\bfmt\.Sprintf\(\s*"((?:\\.|[^"\\])*)"\s*,/.exec(line);
  if (!match) return null;
  const verbs = [...match[1].matchAll(/%(?:%|s)/g)].map((entry) => entry[0]);
  const stringVerbs = verbs.filter((verb) => verb === '%s').length;
  if (stringVerbs === 0 || match[1].replaceAll('%%', '').replaceAll('%s', '').includes('%')) {
    return null;
  }
  return { stringVerbs };
}

function findFunctionBodyRange(lines, startLine) {
  let depth = 0;
  let opened = false;
  for (let index = startLine - 1; index < lines.length; index += 1) {
    for (const character of lines[index]) {
      if (character === '{') {
        depth += 1;
        opened = true;
      } else if (character === '}' && opened) {
        depth -= 1;
      }
    }
    if (opened && depth === 0) {
      return { start: startLine, end: index + 1 };
    }
  }
  return null;
}

function findEnclosingFunctionRange(lines, lineNumber) {
  const declarations = [];
  const declaration = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/;
  for (let index = 0; index < lines.length; index += 1) {
    const match = declaration.exec(lines[index]);
    if (match) declarations.push({ start: index + 1, function: match[1] });
  }
  const current = declarations.filter((entry) => entry.start <= lineNumber).at(-1);
  if (!current) return null;
  const next = declarations.find((entry) => entry.start > current.start);
  return {
    ...current,
    end: next ? next.start - 1 : lines.length,
  };
}
