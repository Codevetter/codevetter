import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertCcusageMetadata,
  packageForTarget,
  prepareCcusageSidecar,
  resolveInstalledCcusage,
  rustHostTarget,
} from './prepare-ccusage-sidecar.mjs';

test('maps every published ccusage target package', () => {
  assert.deepEqual(packageForTarget('aarch64-apple-darwin'), {
    packageName: '@ccusage/ccusage-darwin-arm64',
    binarySubpath: 'bin/ccusage',
  });
  assert.deepEqual(packageForTarget('x86_64-unknown-linux-gnu'), {
    packageName: '@ccusage/ccusage-linux-x64',
    binarySubpath: 'bin/ccusage',
  });
  assert.deepEqual(packageForTarget('aarch64-pc-windows-msvc'), {
    packageName: '@ccusage/ccusage-win32-arm64',
    binarySubpath: 'bin/ccusage.exe',
  });
  assert.throws(() => packageForTarget('wasm32-unknown-unknown'), /Unsupported/);
});

test('rejects non-exact, mismatched, and non-MIT packages', () => {
  const valid = {
    expectedVersion: '20.0.20',
    wrapperVersion: '20.0.20',
    nativeVersion: '20.0.20',
    license: 'MIT',
  };
  assert.doesNotThrow(() => assertCcusageMetadata(valid));
  assert.throws(() => assertCcusageMetadata({ ...valid, expectedVersion: '^20.0.20' }), /exact/);
  assert.throws(() => assertCcusageMetadata({ ...valid, nativeVersion: '20.0.19' }), /mismatch/);
  assert.throws(() => assertCcusageMetadata({ ...valid, license: 'UNKNOWN' }), /license/);
});

test('resolves and executes the real installed native package', () => {
  const target = rustHostTarget();
  const installed = resolveInstalledCcusage(target);
  const destinationRoot = mkdtempSync(join(tmpdir(), 'codevetter-ccusage-'));
  const result = prepareCcusageSidecar({
    target,
    destinationRoot,
    installed,
    expectedVersion: '20.0.20',
  });
  assert.equal(result.version, '20.0.20');
  assert.equal(result.license, 'MIT');
});

test('rejects a missing or empty binary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codevetter-ccusage-empty-'));
  const empty = join(directory, 'ccusage');
  writeFileSync(empty, '');
  chmodSync(empty, 0o755);
  assert.throws(
    () =>
      prepareCcusageSidecar({
        target: 'aarch64-apple-darwin',
        destinationRoot: directory,
        installed: {
          binaryPath: empty,
          wrapperVersion: '20.0.20',
          nativeVersion: '20.0.20',
          license: 'MIT',
        },
        expectedVersion: '20.0.20',
      }),
    /missing or empty/
  );
});
