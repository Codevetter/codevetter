import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateNativeReleaseReadiness,
  parseArguments,
} from './inspect-native-release-readiness.mjs';

function input(overrides = {}) {
  return {
    appPath: '/fixture/CodeVetter.app',
    recordedAt: '2026-09-02T00:00:00.000Z',
    qualification: {
      schema_version: 'codevetter.native-package-qualification/v1',
      status: 'local_package_qualified',
      application: { path: '/fixture/CodeVetter.app', version: '1.11.0', build: '11100' },
      sidecars: [{ name: 'codevetter' }, { name: 'codevetter-mcp' }, { name: 'ccusage' }],
      archives: [{ sha256: 'archive-sha' }],
    },
    info: {
      CFBundleIdentifier: 'com.codevetter.desktop',
      CFBundleExecutable: 'CodeVetterNative',
      CFBundleShortVersionString: '1.11.0',
      CFBundleVersion: '11100',
      SUFeedURL: 'https://updates.example.test/appcast.xml',
      SUPublicEDKey: Buffer.alloc(32, 7).toString('base64'),
    },
    signature: {
      kind: 'developer_id',
      developerID: true,
      hardenedRuntime: true,
      teamIdentifier: 'TEAM123',
    },
    companionSignatures: [
      { developerID: true, teamIdentifier: 'TEAM123' },
      { developerID: true, teamIdentifier: 'TEAM123' },
      { developerID: true, teamIdentifier: 'TEAM123' },
    ],
    entitlements: {},
    deepSignatureValid: true,
    gatekeeper: { accepted: true, detail: 'accepted' },
    notarizationProof: {
      schema_version: 'codevetter.native-notarization-proof/v1',
      status: 'accepted',
      stapled: true,
      archive_sha256: 'archive-sha',
    },
    installedProof: {
      schema_version: 'codevetter.native-installed-upgrade-proof/v1',
      status: 'passed',
      bundle_identifier: 'com.codevetter.desktop',
      version: '1.11.0',
      build: '11100',
      archive_sha256: 'archive-sha',
      upgrade: true,
      relaunch: true,
      rollback: true,
      data_continuity: {
        schema_version: 'codevetter.native-data-continuity/v1',
        app_data_identity: 'com.codevetter.desktop',
        database_filename: 'codevetter.db',
        preserved_record_count: 3,
        before_sha256: 'a'.repeat(64),
        after_upgrade_sha256: 'a'.repeat(64),
        after_rollback_sha256: 'a'.repeat(64),
      },
    },
    ...overrides,
  };
}

test('production evidence passes only when every release boundary is proven', () => {
  const receipt = evaluateNativeReleaseReadiness(input());
  assert.equal(receipt.status, 'ready');
  assert.equal(receipt.shipping_ready, true);
  assert.deepEqual(receipt.blockers, []);
});

test('preview package fails closed on identity, signing, updater, and release proof', () => {
  const receipt = evaluateNativeReleaseReadiness(
    input({
      info: {
        CFBundleIdentifier: 'com.codevetter.desktop.native-preview',
        CFBundleExecutable: 'CodeVetterNative',
        CFBundleShortVersionString: '1.11.0',
        CFBundleVersion: '11100',
      },
      signature: {
        kind: 'ad_hoc',
        developerID: false,
        hardenedRuntime: true,
        teamIdentifier: null,
      },
      companionSignatures: [
        { developerID: false, teamIdentifier: null },
        { developerID: false, teamIdentifier: null },
        { developerID: false, teamIdentifier: null },
      ],
      entitlements: { 'com.apple.security.cs.disable-library-validation': true },
      gatekeeper: { accepted: false, detail: 'rejected' },
      notarizationProof: null,
      installedProof: null,
    })
  );
  assert.equal(receipt.status, 'blocked');
  assert.equal(receipt.shipping_ready, false);
  assert.equal(receipt.blockers.length, 9);
});

test('proof files must bind to the qualified archive, installed version, and build', () => {
  const receipt = evaluateNativeReleaseReadiness(
    input({
      notarizationProof: {
        schema_version: 'codevetter.native-notarization-proof/v1',
        status: 'accepted',
        stapled: true,
        archive_sha256: 'another-archive',
      },
      installedProof: {
        ...input().installedProof,
        version: '1.10.0',
        archive_sha256: 'another-archive',
      },
    })
  );
  assert.deepEqual(
    receipt.checks.filter((check) => !check.passed).map((check) => check.id),
    ['notarization', 'installed_upgrade']
  );
});

test('installed proof requires a stable non-empty data fingerprint through rollback', () => {
  const malformedProofs = [
    {
      ...input().installedProof,
      data_continuity: {
        ...input().installedProof.data_continuity,
        preserved_record_count: 0,
      },
    },
    {
      ...input().installedProof,
      data_continuity: {
        ...input().installedProof.data_continuity,
        app_data_identity: 'com.codevetter.desktop.native-preview',
      },
    },
    {
      ...input().installedProof,
      data_continuity: {
        ...input().installedProof.data_continuity,
        after_upgrade_sha256: 'b'.repeat(64),
      },
    },
    {
      ...input().installedProof,
      data_continuity: {
        ...input().installedProof.data_continuity,
        after_rollback_sha256: 'b'.repeat(64),
      },
    },
  ];

  for (const installedProof of malformedProofs) {
    const receipt = evaluateNativeReleaseReadiness(input({ installedProof }));
    assert.equal(receipt.checks.find((check) => check.id === 'installed_upgrade')?.passed, false);
  }
});

test('package qualification must bind to the exact inspected application', () => {
  const receipt = evaluateNativeReleaseReadiness(
    input({
      qualification: {
        ...input().qualification,
        application: {
          ...input().qualification.application,
          path: '/fixture/Another.app',
        },
      },
    })
  );
  assert.deepEqual(
    receipt.checks.filter((check) => !check.passed).map((check) => check.id),
    ['qualification']
  );
});

test('Sparkle public key must be canonical base64 for exactly 32 bytes', () => {
  const malformed = evaluateNativeReleaseReadiness(
    input({
      info: {
        ...input().info,
        SUPublicEDKey: `${Buffer.alloc(32, 7).toString('base64')}ignored`,
      },
    })
  );
  assert.equal(malformed.checks.find((check) => check.id === 'sparkle_public_key')?.passed, false);
});

test('argument parsing requires an app and qualification without reading credentials', () => {
  const options = parseArguments([
    '--app',
    '/tmp/CodeVetter.app',
    '--qualification',
    '/tmp/qualification.json',
    '--notarization-proof',
    '/tmp/notary.json',
    '--installed-proof',
    '/tmp/installed.json',
    '--out',
    '/tmp/readiness.json',
  ]);
  assert.equal(options.app, '/tmp/CodeVetter.app');
  assert.equal(options.qualification, '/tmp/qualification.json');
  assert.throws(() => parseArguments(['--app', '/tmp/CodeVetter.app']), /qualification/);
});
