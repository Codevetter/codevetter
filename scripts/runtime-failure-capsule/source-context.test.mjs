import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { analyzeSourcePatterns, collectRuntimeSourceContexts } from './source-context.mjs';

test('detects full sort, eager mapping, and repeated collection passes', () => {
  const patterns = analyzeSourcePatterns(
    [
      'const results = catalog',
      '  .filter((item) => item.visible)',
      '  .map((item) => score(item))',
      '  .filter((item) => item.score > 0)',
      '  .sort((left, right) => right.score - left.score)',
      '  .slice(0, limit);',
    ],
    40
  );

  assert.deepEqual(
    patterns.map((pattern) => pattern.kind),
    ['full_sort_before_bounded_slice', 'eager_map_before_sort', 'repeated_collection_passes']
  );
  assert.deepEqual(patterns[0].lines, [44, 45]);
  assert.equal(patterns[0].limit_expression, 'limit');
});

test('detects repeated traversal of the same source collection', () => {
  const patterns = analyzeSourcePatterns(
    [
      'for (const phase of phases) {',
      '  collect(phase);',
      '}',
      'for (let index = 0; index < phases.length; index += 1) {',
      '  score(phases[index]);',
      '}',
    ],
    17
  );

  const repeated = patterns.find((pattern) => pattern.kind === 'repeated_source_traversal');
  assert.deepEqual(repeated, {
    kind: 'repeated_source_traversal',
    lines: [17, 20],
    collection: 'phases',
    observation: 'phases is traversed 2 times in the bounded runtime-selected source window.',
  });
});

test('detects a nested collection lookup', () => {
  const patterns = analyzeSourcePatterns([
    'return categories.find((category) =>',
    '  category.items.some((item) => item.key === key)',
    ');',
    'return categories.find((category) => category.items.some(matches));',
  ]);

  assert.deepEqual(
    patterns.find((pattern) => pattern.kind === 'nested_collection_lookup'),
    {
      kind: 'nested_collection_lookup',
      lines: [4],
      operations: ['find', 'some'],
      observation: 'A lookup scans one collection and then scans members of each candidate.',
    }
  );
});

test('detects repeated linear membership over materialized object keys', () => {
  const patterns = analyzeSourcePatterns(
    [
      'const links = Object.keys(this.tokens.links);',
      'masked = masked.replace(pattern, match =>',
      "  links.includes(match) ? 'yes' : 'no');",
    ],
    308
  );

  assert.deepEqual(
    patterns.find((pattern) => pattern.kind === 'linear_membership_over_keys'),
    {
      kind: 'linear_membership_over_keys',
      lines: [308, 310],
      collection: 'links',
      observation:
        'Materialized object keys are scanned with linear membership checks inside later work.',
    }
  );
});

test('detects only string-only one-line Go formatting', () => {
  const supported = analyzeSourcePatterns(
    [
      'return fmt.Sprintf("https://img.example/%s?token=%s&%%", ticker, token)',
      'return fmt.Sprintf("count=%d", count)',
      'return fmt.Sprintf(dynamicFormat, ticker)',
    ],
    40
  );

  assert.deepEqual(
    supported.filter((pattern) => pattern.kind === 'go_static_string_format'),
    [
      {
        kind: 'go_static_string_format',
        lines: [40],
        string_verbs: 2,
        observation: 'fmt.Sprintf constructs one string from literal text and %s verbs only.',
      },
    ]
  );
});

test('does not join mutually exclusive traversals separated by a return', () => {
  const patterns = analyzeSourcePatterns([
    'for (const item of catalog) collect(item);',
    'return result;',
    'for (const item of catalog) score(item);',
  ]);

  assert.equal(
    patterns.some((pattern) => pattern.kind === 'repeated_source_traversal'),
    false
  );
});

test('does not join conditionally gated and unconditional traversals', () => {
  const patterns = analyzeSourcePatterns([
    'if (options.charsetSentinel) {',
    '  for (const part of parts) inspect(part);',
    '}',
    'for (const part of parts) parse(part);',
  ]);

  assert.equal(
    patterns.some((pattern) => pattern.kind === 'repeated_source_traversal'),
    false
  );
});

test('detects split-for-prefix work inside the selected TypeScript class method only', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-method-context-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await writeFile(
    join(root, 'src/tokenizer.ts'),
    [
      'export class Tokenizer {',
      '  unrelated(src: string): string {',
      "    return src.split('\\n', 1)[0];",
      '  }',
      '',
      '  list(src: string): string {',
      "    const first = src.split('\\n', 1)[0];",
      '    return first;',
      '  }',
      '}',
    ].join('\n')
  );

  const result = await collectRuntimeSourceContexts(root, {
    findings: [],
    observed: {
      hotspots: [{ file: 'src/tokenizer.ts', line: 7, function: 'list', role: 'application' }],
    },
  });

  assert.equal(result.contexts[0].source.line, 6);
  assert.deepEqual(result.contexts[0].patterns, [
    {
      kind: 'split_for_prefix',
      lines: [7],
      delimiter: '\\n',
      observation: 'A complete split result is created only to retain the first segment.',
    },
  ]);
});

test('collects only contained runtime-selected source windows', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-source-context-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await writeFile(
    join(root, 'src/recommendations.ts'),
    [
      'export function recommend(catalog, limit) {',
      '  return catalog',
      '    .map(score)',
      '    .filter(Boolean)',
      '    .sort(compare)',
      '    .slice(0, limit);',
      '}',
      '',
    ].join('\n')
  );

  const result = await collectRuntimeSourceContexts(root, {
    findings: [],
    observed: {
      hotspots: [
        {
          file: 'src/recommendations.ts',
          line: 3,
          function: 'recommend',
          role: 'application',
        },
        { file: '../outside.ts', line: 1, function: 'outside', role: 'application' },
      ],
    },
  });

  assert.equal(result.contexts.length, 1);
  assert.equal(result.contexts[0].source.file, 'src/recommendations.ts');
  assert.equal(result.contexts[0].source.line, 1);
  assert.equal(result.contexts[0].source.reported_line, 3);
  assert.match(result.contexts[0].excerpt, /\.sort\(compare\)/);
  assert.equal(result.contexts[0].patterns[0].kind, 'full_sort_before_bounded_slice');
  assert.ok(result.limitations.some((limitation) => limitation.includes('escaped')));
});

test('deduplicates line-level Go allocation rows before the source-context bound', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-go-context-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, 'api.go'),
    [
      'package example',
      'func mapResult(value string) string {',
      '  copy := value',
      '  return copy',
      '}',
      '',
    ].join('\n')
  );
  await writeFile(
    join(root, 'logo.go'),
    [
      'package example',
      'import "fmt"',
      'func formatLogo(ticker, token string) string {',
      '  return fmt.Sprintf("https://img.example/%s?token=%s", ticker, token)',
      '}',
      '',
    ].join('\n')
  );
  const allocation = (file, line, functionName, flatShare) => ({
    kind: 'go_allocation_path_candidate',
    profile_kind: 'go_alloc_objects',
    source: { file, line, function: functionName },
    flat_profile_objects: 10_000,
    flat_share: flatShare,
    cumulative_share: flatShare,
  });
  const result = await collectRuntimeSourceContexts(root, {
    findings: [
      allocation('api.go', 2, 'example.mapResult', 0.17),
      allocation('api.go', 3, 'example.mapResult', 0.09),
      allocation('api.go', 4, 'example.mapResult', 0.08),
      allocation('logo.go', 4, 'example.formatLogo', 0.06),
    ],
    observed: { hotspots: [] },
  });

  assert.deepEqual(
    result.contexts.map((entry) => entry.source.function),
    ['mapResult', 'formatLogo']
  );
  assert.equal(result.contexts[1].source.reported_function, 'example.formatLogo');
  assert.equal(result.contexts[1].patterns[0].kind, 'go_static_string_format');
});
