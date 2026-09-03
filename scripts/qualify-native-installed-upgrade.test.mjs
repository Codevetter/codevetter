import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertHostedUpgradeContext,
  buildInstalledUpgradeProof,
  parseArguments,
} from './qualify-native-installed-upgrade.mjs';

function input() {
  const continuity = {
    schema_version: 'codevetter.native-data-continuity/v1',
    app_data_identity: 'com.codevetter.desktop',
    database_filename: 'codevetter.db',
    preserved_record_count: 4,
    before_sha256: 'a'.repeat(64),
    after_upgrade_sha256: 'a'.repeat(64),
    after_rollback_sha256: 'a'.repeat(64),
  };
  return {
    qualification: {
      schema_version: 'codevetter.native-package-qualification/v1',
      archives: [{ name: 'CodeVetter-1.11.0-arm64.zip', sha256: 'b'.repeat(64) }],
    },
    nativeInfo: {
      CFBundleIdentifier: 'com.codevetter.desktop',
      CFBundleShortVersionString: '1.11.0',
      CFBundleVersion: '11100',
    },
    continuity,
    launches: ['tauri_before', 'native_upgrade', 'native_relaunch', 'tauri_rollback'].map(
      (kind) => ({ kind, visible_window: true })
    ),
    rubricPreserved: true,
    recordedAt: '2026-09-02T00:00:00.000Z',
  };
}

test('hosted upgrade proof requires every launch, rubric, and durable identity', () => {
  const proof = buildInstalledUpgradeProof(input());
  assert.equal(proof.status, 'passed');
  assert.equal(proof.upgrade, true);
  assert.equal(proof.custom_rubric_preserved, true);

  const failed = buildInstalledUpgradeProof({
    ...input(),
    launches: input().launches.filter((item) => item.kind !== 'native_relaunch'),
  });
  assert.equal(failed.status, 'failed');
});

test('execution is restricted to an explicit GitHub-hosted temporary child', () => {
  const options = {
    foregroundApproved: true,
    hostedEphemeral: true,
    runRoot: '/runner/temp/native-upgrade',
    incumbentApp: '/runner/temp/incumbent/CodeVetter.app',
    nativeApp: '/runner/temp/native/CodeVetter.app',
  };
  assert.deepEqual(
    assertHostedUpgradeContext(options, {
      GITHUB_ACTIONS: 'true',
      RUNNER_TEMP: '/runner/temp',
    }),
    { runnerTemp: '/runner/temp', runRoot: '/runner/temp/native-upgrade' }
  );
  assert.throws(() => assertHostedUpgradeContext(options, {}), /only on an isolated/);
  assert.throws(
    () =>
      assertHostedUpgradeContext(
        { ...options, nativeApp: '/Applications/CodeVetter.app' },
        { GITHUB_ACTIONS: 'true', RUNNER_TEMP: '/runner/temp' }
      ),
    /outside hosted qualification authority/
  );
});

test('argument parsing keeps hosted and foreground consent explicit', () => {
  const options = parseArguments([
    '--incumbent-app',
    '/tmp/incumbent.app',
    '--native-app',
    '/tmp/native.app',
    '--qualification',
    '/tmp/qualification.json',
    '--run-root',
    '/tmp/run',
    '--out',
    '/tmp/proof.json',
    '--foreground',
    '--hosted-ephemeral',
  ]);
  assert.equal(options.foregroundApproved, true);
  assert.equal(options.hostedEphemeral, true);
  assert.throws(() => parseArguments([]), /--incumbent-app is required/);
});
