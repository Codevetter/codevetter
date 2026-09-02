import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  classifyScannerExit,
  collectDatabaseIdentities,
  defaultDatabaseRoot,
  parseScannerVersion,
  RECEIPT_SCHEMA,
} from './run-osv-offline.mjs';

test('defines a versioned receipt contract', () => {
  assert.equal(RECEIPT_SCHEMA, 'codevetter.osv-offline-scan/v1');
});

test('resolves platform cache roots without exposing them in evidence', () => {
  assert.equal(
    defaultDatabaseRoot({ platform: 'darwin', home: '/Users/example' }),
    '/Users/example/Library/Caches/osv-scalibr'
  );
  assert.equal(
    defaultDatabaseRoot({ platform: 'linux', home: '/home/example' }),
    '/home/example/.cache/osv-scalibr'
  );
  assert.equal(
    defaultDatabaseRoot({
      platform: 'linux',
      home: '/home/example',
      xdgCacheHome: '/cache',
    }),
    '/cache/osv-scalibr'
  );
});

test('parses scanner identity and keeps findings distinct from operational failure', () => {
  assert.equal(
    parseScannerVersion('osv-scanner version: 2.5.1\nosv-scalibr version: 0.5.2'),
    '2.5.1'
  );
  assert.equal(classifyScannerExit(0), 'clean');
  assert.equal(classifyScannerExit(1), 'findings');
  assert.equal(classifyScannerExit(2), 'operational_failure');
  assert.equal(classifyScannerExit(null), 'operational_failure');
  assert.equal(
    classifyScannerExit(
      1,
      'Error during extraction: unable to fetch OSV database: no offline version is available'
    ),
    'operational_failure'
  );
  assert.equal(classifyScannerExit(1, 'warning: advisory metadata is incomplete'), 'findings');
});

test('hashes databases by ecosystem without retaining absolute cache paths', (context) => {
  const root = join(tmpdir(), `codevetter-osv-db-${process.pid}-${Date.now()}`);
  context.after(() => {
    // The test runner owns this unique temporary directory; removal is bounded.
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'npm'), { recursive: true });
  mkdirSync(join(root, 'crates.io'), { recursive: true });
  writeFileSync(join(root, 'npm', 'all.zip'), 'npm-db');
  writeFileSync(join(root, 'crates.io', 'all.zip'), 'rust-db');

  const identities = collectDatabaseIdentities(root);
  assert.deepEqual(
    identities.map(({ ecosystem, bytes }) => ({ ecosystem, bytes })),
    [
      { ecosystem: 'crates.io', bytes: 7 },
      { ecosystem: 'npm', bytes: 6 },
    ]
  );
  assert.ok(identities.every((entry) => !('path' in entry)));
  assert.ok(identities.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
});
