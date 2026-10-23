import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { collectV8FunctionCoverage } from './function-coverage.mjs';

const source = 'export function actual() { return true; }\n';

for (const mapData of [null, { version: 3, sources: ['app.ts'], names: [], mappings: 'AAAA' }]) {
  test(`omits unqualified mapped V8 source anchors with ${mapData ? 'present' : 'missing'} map data`, async (context) => {
    const fixture = await createFixture(context);
    const url = pathToFileURL(fixture.sourcePath).href;
    // A generated function span is not an original-source anchor merely because
    // its offsets also fit inside the original file. The executed bytes and
    // their mapping have not been qualified by this collector.
    await writeCoverage(fixture, {
      result: [{ url, functions: [v8Function('generatedActual', 7, source.length - 1)] }],
      'source-map-cache': {
        [url]: { lineLengths: [source.length], data: mapData, url: 'app.ts.map' },
      },
    });

    const result = await collectV8FunctionCoverage(fixture.coverageDirectory, fixture.root);
    assert.deepEqual(result.functions, []);
    assert.ok(result.limitations.some((entry) => /source.*unqualified/i.test(entry)));
  });
}

for (const format of ['v8', 'runner-native']) {
  test(`rejects ${format} source attribution through an out-of-repository symlink`, {
    skip: process.platform === 'win32' ? 'File symlink privileges are not assumed.' : false,
  }, async (context) => {
    const fixture = await createFixture(context);
    const outside = await temporaryRoot(context);
    const outsideSource = join(outside, 'external.js');
    const alias = join(fixture.root, 'src/linked.js');
    await writeFile(outsideSource, source);
    await symlink(outsideSource, alias);
    await writeCoverage(
      fixture,
      format === 'v8'
        ? { result: [{ url: pathToFileURL(alias).href, functions: [v8Function()] }] }
        : { [alias]: runnerCoverage() }
    );

    const result = await collectV8FunctionCoverage(fixture.coverageDirectory, fixture.root);
    assert.deepEqual(result.functions, []);
  });
}

test('retains contained aliases and merges their V8 and runner-native counts by real source', {
  skip: process.platform === 'win32' ? 'File symlink privileges are not assumed.' : false,
}, async (context) => {
  const fixture = await createFixture(context);
  const alias = join(fixture.root, 'src/alias.js');
  await symlink(fixture.sourcePath, alias);
  await writeCoverage(fixture, {
    result: [{ url: pathToFileURL(alias).href, functions: [v8Function()] }],
    [alias]: runnerCoverage(),
  });

  const result = await collectV8FunctionCoverage(fixture.coverageDirectory, fixture.root);
  assert.deepEqual(result.functions, [
    {
      id: 'function-coverage-1',
      function: 'actual',
      file: 'src/app.js',
      start_line: 1,
      end_line: 2,
      call_count: 2,
      role: 'application',
    },
  ]);
});

test('rejects invalid V8 offsets instead of clamping them onto an original source line', async (context) => {
  const fixture = await createFixture(context);
  await writeCoverage(fixture, {
    result: [
      {
        url: pathToFileURL(fixture.sourcePath).href,
        functions: [
          v8Function(),
          v8Function('negative', -5, 5),
          v8Function('reversed', 10, 5),
          v8Function('beyondSource', source.length + 5, source.length + 10),
        ],
      },
    ],
  });

  const result = await collectV8FunctionCoverage(fixture.coverageDirectory, fixture.root);
  assert.deepEqual(
    result.functions.map((entry) => entry.function),
    ['actual']
  );
});

function v8Function(functionName = 'actual', startOffset = 0, endOffset = source.length) {
  return { functionName, ranges: [{ startOffset, endOffset, count: 1 }] };
}

function runnerCoverage() {
  return {
    fnMap: { 0: { name: 'actual', decl: { start: { line: 1 } }, loc: { end: { line: 2 } } } },
    f: { 0: 1 },
  };
}

async function createFixture(context) {
  const root = await temporaryRoot(context);
  const coverageDirectory = join(root, 'coverage');
  const sourcePath = join(root, 'src/app.js');
  await mkdir(join(root, 'src'));
  await mkdir(coverageDirectory);
  await writeFile(sourcePath, source);
  return { root, coverageDirectory, sourcePath };
}

async function temporaryRoot(context) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-coverage-provenance-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeCoverage(fixture, document) {
  await writeFile(join(fixture.coverageDirectory, 'coverage-1.json'), JSON.stringify(document));
}
