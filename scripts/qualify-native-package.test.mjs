import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  architectureForTarget,
  assertFrameworkRPath,
  assertNoCoverageInstrumentation,
  assertPackagedCliCapabilities,
  assertPreviewBundle,
  assertProductionBundle,
  codesignArguments,
  hostTarget,
  parseArguments,
  runtimeFiles,
} from './qualify-native-package.mjs';

test('local preview collectors can omit hardened runtime without weakening production signing', () => {
  assert.deepEqual(codesignArguments('/tmp/gitleaks', '-', undefined, false), [
    '--force',
    '--sign',
    '-',
    '--timestamp=none',
    '/tmp/gitleaks',
  ]);
  assert.deepEqual(codesignArguments('/tmp/gitleaks', 'Developer ID Application: Example'), [
    '--force',
    '--sign',
    'Developer ID Application: Example',
    '--options',
    'runtime',
    '/tmp/gitleaks',
  ]);
});

test('packaged CLI preserves rich repository-query parity', () => {
  const help = [
    'list|inspect|scan|compare|export|query|query-worker',
    '--query-domain <name>',
    '--query-mode <name>',
    '--query-target <value>',
    '--query-direction <name>',
    '--query-depth <n>',
    '--history-selector <name>',
  ].join('\n');
  assert.doesNotThrow(() => assertPackagedCliCapabilities(help));
  assert.throws(
    () => assertPackagedCliCapabilities(help.replace('--query-mode <name>', '')),
    /missing repository-query parity/
  );
});

test('production packaging requires the canonical identifier and Sparkle inputs', () => {
  const publicKey = Buffer.alloc(32, 7).toString('base64');
  assert.doesNotThrow(() =>
    assertProductionBundle({
      CFBundleIdentifier: 'com.codevetter.desktop',
      CFBundleExecutable: 'CodeVetterNative',
      SUFeedURL: 'https://github.com/Codevetter/codevetter/releases/latest/download/appcast.xml',
      SUPublicEDKey: publicKey,
    })
  );
  assert.throws(
    () =>
      assertProductionBundle({
        CFBundleIdentifier: 'com.codevetter.desktop.native-preview',
        CFBundleExecutable: 'CodeVetterNative',
        SUFeedURL: 'https://updates.example.test/appcast.xml',
        SUPublicEDKey: publicKey,
      }),
    /require com\.codevetter\.desktop/
  );
  assert.throws(
    () =>
      assertProductionBundle({
        CFBundleIdentifier: 'com.codevetter.desktop',
        CFBundleExecutable: 'CodeVetterNative',
        SUFeedURL: 'http://updates.example.test/appcast.xml',
        SUPublicEDKey: publicKey,
      }),
    /HTTPS Sparkle feed/
  );
});

test('native executable must resolve frameworks inside its own bundle', () => {
  assert.doesNotThrow(() =>
    assertFrameworkRPath('path @executable_path/../Frameworks (offset 12)')
  );
  assert.throws(() => assertFrameworkRPath('path /usr/lib/swift'), /cannot resolve/);
});

test('native Release executable excludes test coverage instrumentation', () => {
  assert.doesNotThrow(() =>
    assertNoCoverageInstrumentation('segname __TEXT\nsectname __text\nsegname __LINKEDIT')
  );
  assert.throws(
    () => assertNoCoverageInstrumentation('segname __LLVM_COV\nsectname __llvm_covfun'),
    /contains test coverage instrumentation/
  );
  assert.throws(
    () => assertNoCoverageInstrumentation('segname __DATA\nsectname __llvm_prf_cnts'),
    /contains test coverage instrumentation/
  );
});

test('preview packaging fails closed on identity, executable, and updater inputs', () => {
  assert.doesNotThrow(() =>
    assertPreviewBundle({
      CFBundleIdentifier: 'com.codevetter.desktop.native-preview',
      CFBundleExecutable: 'CodeVetterNative',
    })
  );
  assert.throws(
    () =>
      assertPreviewBundle({
        CFBundleIdentifier: 'com.codevetter.desktop',
        CFBundleExecutable: 'CodeVetterNative',
      }),
    /non-preview/
  );
  assert.throws(
    () =>
      assertPreviewBundle({
        CFBundleIdentifier: 'com.codevetter.desktop.native-preview',
        CFBundleExecutable: 'CodeVetter',
      }),
    /distinct/
  );
  assert.throws(
    () =>
      assertPreviewBundle({
        CFBundleIdentifier: 'com.codevetter.desktop.native-preview',
        CFBundleExecutable: 'CodeVetterNative',
        SUFeedURL: 'https://updates.example.test/appcast.xml',
      }),
    /must not contain/
  );
});

test('runtime packaging includes executable modules and excludes tests', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codevetter-native-package-'));
  writeFileSync(join(directory, 'cli.mjs'), '');
  writeFileSync(join(directory, 'capsule.mjs'), '');
  writeFileSync(join(directory, 'capsule.test.mjs'), '');
  writeFileSync(join(directory, 'README.md'), '');
  assert.deepEqual(runtimeFiles(directory), ['capsule.mjs', 'cli.mjs']);
});

test('host and argument parsing preserve explicit operator choices', () => {
  assert.equal(hostTarget('rustc 1.90.0\nhost: aarch64-apple-darwin\n'), 'aarch64-apple-darwin');
  assert.equal(architectureForTarget('aarch64-apple-darwin'), 'arm64');
  assert.equal(architectureForTarget('x86_64-apple-darwin'), 'x86_64');
  assert.throws(() => architectureForTarget('x86_64-unknown-linux-gnu'), /Unsupported/);
  const options = parseArguments([
    '--app',
    '/tmp/CodeVetter.app',
    '--out-root',
    '/tmp/native-package',
    '--identity',
    'Developer ID Application: Example',
    '--channel',
    'production',
    '--target',
    'x86_64-apple-darwin',
    '--skip-sidecar-build',
  ]);
  assert.equal(options.app, '/tmp/CodeVetter.app');
  assert.equal(options.outputRoot, '/tmp/native-package');
  assert.equal(options.identity, 'Developer ID Application: Example');
  assert.equal(options.channel, 'production');
  assert.equal(options.target, 'x86_64-apple-darwin');
  assert.equal(options.prepareSidecars, false);
});
