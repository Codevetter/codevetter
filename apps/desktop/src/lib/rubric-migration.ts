import { loadReviewConfig, type ReviewConfig } from '@/lib/review-service';
import { getRubricSettings, isTauriAvailable, type RubricSettingsReceipt } from '@/lib/tauri-ipc';

export type LegacyRubricMigrationStatus =
  | 'not_tauri'
  | 'no_legacy_config'
  | 'migrated'
  | 'already_canonical';

interface LegacyRubricMigrationDependencies {
  isTauriAvailable: () => boolean;
  loadReviewConfig: () => ReviewConfig | null;
  getRubricSettings: (legacyConfig: ReviewConfig) => Promise<RubricSettingsReceipt>;
}

const defaultDependencies: LegacyRubricMigrationDependencies = {
  isTauriAvailable,
  loadReviewConfig,
  getRubricSettings,
};

export async function migrateLegacyRubricConfig(
  dependencies: LegacyRubricMigrationDependencies = defaultDependencies
): Promise<LegacyRubricMigrationStatus> {
  if (!dependencies.isTauriAvailable()) return 'not_tauri';
  const legacyConfig = dependencies.loadReviewConfig();
  if (!legacyConfig) return 'no_legacy_config';
  const receipt = await dependencies.getRubricSettings(legacyConfig);
  return receipt.migrated_legacy_config ? 'migrated' : 'already_canonical';
}
