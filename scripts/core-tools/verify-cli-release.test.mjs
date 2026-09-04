import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { qualifyCli, readMarketingVersion } from './verify-cli-release.mjs';

test('reads the native app version as the CLI release authority', () => {
  const root = mkdtempSync(join(tmpdir(), 'codevetter-native-version-'));
  const config = join(root, 'Shared.xcconfig');
  writeFileSync(config, 'PRODUCT_NAME = CodeVetter\nMARKETING_VERSION = 1.12.0\n');
  assert.equal(readMarketingVersion(config), '1.12.0');
});

test('qualifies a CLI against the native version and help contract', () => {
  const root = mkdtempSync(join(tmpdir(), 'codevetter-cli-qualification-'));
  const binary = join(root, 'codevetter');
  const help = [
    'codevetter check (--pr <url> | --range <base..head>) --task <text>',
    'codevetter trex (--pr <url> | --range <base..head>) --preview <url>',
    '--pr <url>',
    '--range <range>',
    '--preview <url>',
    '--repo <path>',
    '--task <text>',
    '--preflight',
    '--spec <path>',
    '--requirement <id>',
    '--baseline-repo <path>',
    '--json',
  ].join(' ');
  writeFileSync(
    binary,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codevetter 1.12.0"; else echo '${help}'; fi\n`
  );
  chmodSync(binary, 0o755);
  const receipt = qualifyCli({ binaryPath: binary, expectedVersion: '1.12.0' });
  assert.equal(receipt.version, '1.12.0');
  assert.equal(receipt.bundleEntry, 'Contents/MacOS/codevetter');
});
