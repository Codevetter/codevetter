import { createHash } from 'node:crypto';
import { SourceMap } from 'node:module';

export const sourceDigest = (value) => createHash('sha256').update(value).digest('hex');

// Qualification of an explicit generated span, never a function-name match or a
// source-pattern recommendation. The caller supplies independently observed current
// identity. This is a local evidence consistency check, not an authenticity signature.
export function qualifySourceExecution({ source, generated, map, expected, capture, span }) {
  const unknown = (reason) => ({ status: 'unknown', reason, recommendation_qualified: false });
  if (
    !expected ||
    !capture ||
    !span ||
    typeof source !== 'string' ||
    typeof generated !== 'string' ||
    !map ||
    typeof map !== 'object'
  )
    return unknown('missing_evidence');
  if (source.length > 524288 || generated.length > 524288) return unknown('source_bound_exceeded');
  const identity = {
    ...expected,
    source_sha256: sourceDigest(source),
    generated_sha256: sourceDigest(generated),
    map_sha256: sourceDigest(JSON.stringify(map)),
  };
  const keys = [
    'source_sha256',
    'generated_sha256',
    'map_sha256',
    'compiler',
    'runtime',
    'node_binary_sha256',
    'selection_sha256',
    'run_id',
  ];
  if (
    keys.some(
      (key) =>
        typeof identity[key] !== 'string' ||
        !identity[key] ||
        expected[key] !== identity[key] ||
        capture.identity?.[key] !== identity[key]
    )
  )
    return unknown('identity_mismatch');
  if (!completeExecution(capture)) return unknown('incomplete_execution');
  if (capture.executed_source_sha256 !== identity.generated_sha256)
    return unknown('executed_source_mismatch');
  if (
    !Number.isInteger(span.start) ||
    !Number.isInteger(span.end) ||
    span.start < 0 ||
    span.end <= span.start ||
    span.end > generated.length
  )
    return unknown('invalid_generated_span');
  if (!supportedMap(map, source)) return unknown('unsupported_source_map');
  const prefix = generated.slice(0, span.start).split('\n');
  const line = prefix.length - 1;
  const column = prefix.at(-1).length;
  let anchor;
  try {
    anchor = new SourceMap(map).findEntry(line, column);
  } catch {
    return unknown('invalid_source_map');
  }
  if (
    anchor.generatedLine !== line ||
    anchor.generatedColumn !== column ||
    anchor.originalSource !== map.sources[0] ||
    anchor.originalLine !== span.original_line ||
    anchor.originalColumn !== span.original_column
  )
    return unknown('unmapped_or_ambiguous_anchor');
  if (
    !Array.isArray(capture.functions) ||
    capture.functions.some((entry) => !Array.isArray(entry?.ranges))
  )
    return unknown('missing_or_invalid_block_coverage');
  if (
    capture.functions.some(
      (entry) =>
        entry.isBlockCoverage !== true &&
        entry.ranges.some(
          (range) =>
            range?.count > 0 && range.startOffset < span.end && range.endOffset > span.start
        )
    )
  )
    return unknown('function_only_coverage');
  // Uncalled functions often have isBlockCoverage=false. Their zero count must
  // still override a positive enclosing script; never discard negative evidence.
  const ranges = capture.functions.flatMap((entry) => entry.ranges);
  if (ranges.length === 0 || ranges.some((range) => !validRange(range, generated.length)))
    return unknown('missing_or_invalid_block_coverage');
  const count = spanCount(ranges, span);
  if (count === null) return unknown('uncovered_generated_span');
  return {
    status: count > 0 ? 'executed' : 'not_executed',
    identity,
    mapped_anchor: {
      source: anchor.originalSource,
      line: anchor.originalLine + 1,
      column: anchor.originalColumn + 1,
    },
    generated_span: span,
    minimum_count: count,
    recommendation_qualified: false,
    limitation:
      'Exact span execution is not CPU attribution, acceptance completeness, or optimization benefit.',
  };
}

function validRange(range, length) {
  return (
    Number.isSafeInteger(range?.startOffset) &&
    Number.isSafeInteger(range.endOffset) &&
    Number.isSafeInteger(range.count) &&
    range.count >= 0 &&
    range.startOffset >= 0 &&
    range.endOffset > range.startOffset &&
    range.endOffset <= length
  );
}

function spanCount(ranges, span) {
  const points = [
    ...new Set([
      span.start,
      span.end,
      ...ranges.flatMap((range) =>
        [range.startOffset, range.endOffset].filter(
          (point) => point > span.start && point < span.end
        )
      ),
    ]),
  ].sort((a, b) => a - b);
  let minimum = Infinity;
  for (let index = 0; index < points.length - 1; index++) {
    const covering = ranges.filter(
      (range) => range.startOffset <= points[index] && range.endOffset >= points[index + 1]
    );
    if (!covering.length) return null;
    const width = Math.min(...covering.map((range) => range.endOffset - range.startOffset));
    // Nested zero-count branches override positive enclosing function counts.
    minimum = Math.min(
      minimum,
      ...covering
        .filter((range) => range.endOffset - range.startOffset === width)
        .map((range) => range.count)
    );
  }
  return minimum;
}

function completeExecution(capture) {
  return (
    capture.status === 'completed' &&
    Number.isSafeInteger(capture.executed_tests) &&
    capture.executed_tests > 0 &&
    capture.selected_tests === capture.executed_tests &&
    capture.errors === 0
  );
}

function supportedMap(map, source) {
  return (
    map.version === 3 &&
    map.sources?.length === 1 &&
    map.sourcesContent?.[0] === source &&
    !map.sections &&
    !map.sourceRoot
  );
}
