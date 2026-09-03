import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertBundleInfo,
  assertSafeApplicationPath,
  comparisonOrder,
  parseArguments,
  parseProcessTable,
  processTree,
  summarize,
} from './compare-desktop-runtime.mjs';

test('argument parsing requires explicit app paths and bounded repeated samples', () => {
  assert.throws(() => parseArguments([]), /--native-app is required/);
  assert.throws(
    () =>
      parseArguments([
        '--native-app',
        '/tmp/Native.app',
        '--tauri-app',
        '/tmp/Tauri.app',
        '--runs',
        '2',
      ]),
    /at least 3/
  );
  assert.throws(
    () => parseArguments(['--native-app', '/tmp/Native.app', '--tauri-app', '/tmp/Tauri.app']),
    /requires --foreground/
  );
  const options = parseArguments([
    '--native-app',
    '/tmp/Native.app',
    '--tauri-app',
    '/tmp/Tauri.app',
    '--runs',
    '7',
    '--settle-ms',
    '2500',
    '--out',
    '/tmp/runtime.json',
    '--foreground',
  ]);
  assert.equal(options.runs, 7);
  assert.equal(options.settleMs, 2500);
  assert.equal(options.output, '/tmp/runtime.json');
  assert.equal(options.foregroundApproved, true);
});

test('installed and non-bundle application paths fail closed before launch', () => {
  assert.throws(
    () => assertSafeApplicationPath('/Applications/CodeVetter.app'),
    /Refusing to launch/
  );
  assert.throws(() => assertSafeApplicationPath('/tmp/codevetter'), /Expected a macOS/);
});

test('bundle identity distinguishes the native preview from the Tauri incumbent', () => {
  assert.doesNotThrow(() =>
    assertBundleInfo('native', {
      CFBundleIdentifier: 'com.codevetter.desktop.native-preview',
      CFBundleExecutable: 'CodeVetterNative',
    })
  );
  assert.doesNotThrow(() =>
    assertBundleInfo('tauri', {
      CFBundleIdentifier: 'com.codevetter.desktop',
      CFBundleExecutable: 'codevetter-desktop',
    })
  );
  assert.throws(
    () =>
      assertBundleInfo('native', {
        CFBundleIdentifier: 'com.codevetter.desktop',
        CFBundleExecutable: 'codevetter-desktop',
      }),
    /bundle identifier/
  );
});

test('process-table parsing and recursive ownership include only descendants', () => {
  const rows = parseProcessTable(`
  10 1 100 /tmp/App
  11 10 50 /tmp/Child
  12 11 25 /tmp/Grandchild --flag
  20 1 999 /tmp/Unrelated
`);
  assert.deepEqual(
    processTree(rows, 10).map((row) => row.pid),
    [10, 11, 12]
  );
  assert.deepEqual(processTree(rows, 999), []);
});

test('summary uses nearest-rank p95 and preserves acquisition-order samples', () => {
  assert.deepEqual(summarize([9, 1, 4, 2, 5]), {
    samples: [9, 1, 4, 2, 5],
    minimum: 1,
    median: 4,
    average: 4.2,
    p95: 9,
    maximum: 9,
  });
  assert.deepEqual(summarize([1, 3, 5, 7]), {
    samples: [1, 3, 5, 7],
    minimum: 1,
    median: 4,
    average: 4,
    p95: 7,
    maximum: 7,
  });
});

test('launch order alternates to reduce temperature and ordering bias', () => {
  assert.deepEqual(comparisonOrder(4), [
    ['native', 'tauri'],
    ['tauri', 'native'],
    ['native', 'tauri'],
    ['tauri', 'native'],
  ]);
});
