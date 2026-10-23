import * as nodeModule from 'node:module';
import { qualifySourceExecution, sourceDigest } from './source-execution.mjs';
import { SOURCE_EXECUTION_LIMITS } from './source-execution-contract.mjs';

export const SOURCE_EXECUTION_WORK_LIMITS = Object.freeze({
  functions: 128,
  ranges: 2048,
  attempts: 128,
  characters: 65536,
});

// Called only for a validated producer capture, never to accept caller-supplied branch proof.
export function mapCapturedSource({
  source,
  url,
  generatedDigest,
  functions,
  identity,
  selectedTests,
}) {
  if (typeof nodeModule.stripTypeScriptTypes !== 'function') return { reason: 'unsupported_map' };
  if (!boundedCoverage(functions)) return { reason: 'capture_bound_exceeded' };
  const generated = nodeModule.stripTypeScriptTypes(source, {
    mode: 'transform',
    sourceMap: true,
    sourceUrl: url,
  });
  if (
    Buffer.byteLength(generated) > SOURCE_EXECUTION_LIMITS.bytes * 4 ||
    sourceDigest(generated) !== generatedDigest
  )
    return { reason: 'source_identity_mismatch' };
  const map = terminalCompilerMap(generated, source, url);
  if (!map) return { reason: 'unsupported_map' };
  const expected = {
    ...identity,
    source_sha256: sourceDigest(source),
    generated_sha256: generatedDigest,
    map_sha256: sourceDigest(JSON.stringify(map)),
    compiler: `node:stripTypeScriptTypes/transform:${process.version}`,
  };
  const capture = {
    identity: expected,
    status: 'completed',
    selected_tests: selectedTests,
    executed_tests: selectedTests,
    errors: 0,
    functions,
    executed_source_sha256: generatedDigest,
  };
  const mapped = mappedAnchors({ source, generated, map, expected, capture });
  return {
    source_sha256: expected.source_sha256,
    generated_sha256: generatedDigest,
    map_sha256: expected.map_sha256,
    ...mapped,
  };
}

function terminalCompilerMap(generated, source, url) {
  const encoded =
    /(?:^|\n)\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/]+={0,2})\n?$/.exec(
      generated
    )?.[1];
  if (!encoded || encoded.length > 349528) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > SOURCE_EXECUTION_LIMITS.bytes || bytes.toString('base64') !== encoded)
    return null;
  let map;
  try {
    map = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  if (
    map.version !== 3 ||
    map.sources?.length !== 1 ||
    map.sources[0] !== url ||
    map.sections ||
    map.sourceRoot
  )
    return null;
  // The exact executed bytes were reproduced by this runtime's known compiler above.
  // This supplies only that compiler input, never an arbitrary map's guessed source.
  map.sourcesContent = [source];
  return map;
}

function mappedAnchors(context) {
  const mapper = new nodeModule.SourceMap(context.map);
  const state = { anchors: [], offset: 0, unknown: false, attempts: 0, characters: 0 };
  for (const [line, text] of context.generated.split('\n').entries()) {
    if (text.startsWith('//# sourceMappingURL=')) break;
    if (!mapLine(context, mapper, state, line, text))
      return { anchors: state.anchors, truncated: true, unknown: state.unknown };
    state.offset += text.length + 1;
  }
  return { anchors: state.anchors, truncated: false, unknown: state.unknown };
}

function mapLine(context, mapper, state, line, text) {
  for (let column = 0; column < text.length; column++) {
    if (++state.characters > SOURCE_EXECUTION_WORK_LIMITS.characters) return false;
    const entry = mapper.findEntry(line, column);
    if (
      entry.generatedLine !== line ||
      entry.generatedColumn !== column ||
      entry.originalSource !== context.map.sources[0]
    )
      continue;
    if (
      ++state.attempts > SOURCE_EXECUTION_WORK_LIMITS.attempts ||
      state.anchors.length >= SOURCE_EXECUTION_LIMITS.anchors
    )
      return false;
    const span = {
      start: state.offset + column,
      end: state.offset + column + 1,
      original_line: entry.originalLine,
      original_column: entry.originalColumn,
    };
    const result = qualifySourceExecution({ ...context, span });
    if (result.status === 'unknown') {
      state.unknown = true;
      continue;
    }
    state.anchors.push({
      line: entry.originalLine + 1,
      column: entry.originalColumn + 1,
      generated_start: span.start,
      generated_end: span.end,
      status: result.status === 'executed' ? 'executed_in_snapshot' : 'not_observed_in_snapshot',
      count: result.minimum_count,
    });
  }
  return true;
}

function boundedCoverage(functions) {
  if (!Array.isArray(functions) || functions.length > SOURCE_EXECUTION_WORK_LIMITS.functions)
    return false;
  let ranges = 0;
  for (const entry of functions) {
    if (!Array.isArray(entry?.ranges)) return false;
    ranges += entry.ranges.length;
    if (ranges > SOURCE_EXECUTION_WORK_LIMITS.ranges) return false;
  }
  return true;
}
