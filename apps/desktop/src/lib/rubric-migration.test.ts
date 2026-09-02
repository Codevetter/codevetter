import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReviewConfig } from '@/lib/review-service';
import type { RubricSettingsReceipt } from '@/lib/tauri-ipc';
import { migrateLegacyRubricConfig } from './rubric-migration';

const legacyConfig: ReviewConfig = {
  activeStandardsPack: 'team-safety',
  customRules: ['Preserve the audit trail.'],
  standardsPacks: [
    {
      id: 'team-safety',
      name: 'Team Safety',
      focus: 'Team-specific regressions',
      checks: ['Check the audit trail.'],
    },
  ],
};

function receipt(migrated: boolean): RubricSettingsReceipt {
  return {
    schema_version: 'codevetter.rubric-settings/v1',
    generated_at: '2026-09-02T00:00:00Z',
    operation: 'read',
    active_pack_id: 'team-safety',
    custom_rules: legacyConfig.customRules ?? [],
    packs: [],
    saved_pack_id: null,
    migrated_legacy_config: migrated,
  };
}

test('browser-only startup does not inspect or migrate WebView state', async () => {
  let loaded = false;
  let invoked = false;
  const status = await migrateLegacyRubricConfig({
    isTauriAvailable: () => false,
    loadReviewConfig: () => {
      loaded = true;
      return legacyConfig;
    },
    getRubricSettings: async () => {
      invoked = true;
      return receipt(true);
    },
  });
  assert.equal(status, 'not_tauri');
  assert.equal(loaded, false);
  assert.equal(invoked, false);
});

test('Tauri startup sends the exact sanitized legacy config to Rust once', async () => {
  let received: ReviewConfig | null = null;
  const status = await migrateLegacyRubricConfig({
    isTauriAvailable: () => true,
    loadReviewConfig: () => legacyConfig,
    getRubricSettings: async (config) => {
      received = config;
      return receipt(true);
    },
  });
  assert.equal(status, 'migrated');
  assert.deepEqual(received, legacyConfig);
});

test('startup distinguishes absent legacy state from an existing canonical preference', async () => {
  const noLegacy = await migrateLegacyRubricConfig({
    isTauriAvailable: () => true,
    loadReviewConfig: () => null,
    getRubricSettings: async () => assert.fail('Rust should not be called without legacy state'),
  });
  assert.equal(noLegacy, 'no_legacy_config');

  const canonical = await migrateLegacyRubricConfig({
    isTauriAvailable: () => true,
    loadReviewConfig: () => legacyConfig,
    getRubricSettings: async () => receipt(false),
  });
  assert.equal(canonical, 'already_canonical');
});

test('migration errors remain observable to the startup caller', async () => {
  await assert.rejects(
    migrateLegacyRubricConfig({
      isTauriAvailable: () => true,
      loadReviewConfig: () => legacyConfig,
      getRubricSettings: async () => {
        throw new Error('canonical store unavailable');
      },
    }),
    /canonical store unavailable/
  );
});
