import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseMunchPaths } from './jcodemunch.mjs';

const SYMBOLS = [
  '#MUNCH/1 tool=search_symbols enc=ss1',
  '',
  '@1=context_test.go',
  '@2=context.go',
  '',
  'result_count=2 __tables=s:results:id|name|kind|file|line|score|signature|summary',
  '',
  's,@2::Context#type,Context,type,@2,61,,"type Context struct {',
  '\tfullPath string, comma inside a quoted signature',
  '}",Context is the most important part of gin.',
  's,@1::TestX#function,TestX,function,@1,3,,func TestX(t *testing.T),',
].join('\n');

test('resolves interned refs to paths', () => {
  assert.deepEqual(parseMunchPaths({ text: SYMBOLS }), ['context.go', 'context_test.go']);
});

test('ranks by result order, not the sorted legend', () => {
  // The legend lists context_test.go first. Trusting it would score an alphabetical
  // permutation of the answer instead of the ordering the tool actually returned.
  const [first] = parseMunchPaths({ text: SYMBOLS });
  assert.equal(first, 'context.go');
});

test('a quoted signature containing commas and newlines does not shift the file column', () => {
  // Naive split(',') puts "61" in the file column and yields nothing.
  assert.ok(parseMunchPaths({ text: SYMBOLS }).includes('context.go'));
});

test('falls back to reference order when there is no results table', () => {
  const spans = [
    '#MUNCH/1 tool=search_text enc=ss1',
    '',
    '@1=a.go',
    '@2=b.go',
    '',
    'hit @2:14',
    'hit @1:3',
  ].join('\n');
  assert.deepEqual(parseMunchPaths({ text: spans }), ['b.go', 'a.go']);
});

test('non-munch payloads are left to the default reader', () => {
  assert.deepEqual(parseMunchPaths({ text: '{"files":["a.go"]}' }), []);
  assert.deepEqual(parseMunchPaths({ text: undefined }), []);
});
