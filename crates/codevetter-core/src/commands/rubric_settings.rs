use crate::db::queries;
use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::State;

use crate::DbState;

pub const RUBRIC_SETTINGS_SCHEMA_VERSION: &str = "codevetter.rubric-settings/v1";
const RUBRIC_PREFERENCE_KEY: &str = "review_rubric_config_v1";
const MAX_CUSTOM_PACKS: usize = 50;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RubricSettingsOperation {
    Read,
    Select,
    Upsert,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RubricPackInput {
    pub id: String,
    pub name: String,
    pub focus: String,
    pub checks: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyRubricConfig {
    pub custom_rules: Option<Vec<String>>,
    pub active_standards_pack: Option<String>,
    pub standards_packs: Option<Vec<RubricPackInput>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default, PartialEq, Eq)]
struct StoredRubricConfig {
    active_pack_id: Option<String>,
    custom_rules: Vec<String>,
    custom_packs: Vec<RubricPackInput>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct RubricPackReceipt {
    pub id: String,
    pub name: String,
    pub focus: String,
    pub checks: Vec<String>,
    pub built_in: bool,
    pub active: bool,
    pub review_count: i64,
    pub total_findings: i64,
    pub prompt_preview: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct RubricSettingsReceipt {
    pub schema_version: String,
    pub generated_at: String,
    pub operation: RubricSettingsOperation,
    pub active_pack_id: Option<String>,
    pub custom_rules: Vec<String>,
    pub packs: Vec<RubricPackReceipt>,
    pub saved_pack_id: Option<String>,
    pub migrated_legacy_config: bool,
}

#[tauri::command]
pub async fn get_rubric_settings(
    db: State<'_, DbState>,
    legacy_config: Option<LegacyRubricConfig>,
) -> Result<RubricSettingsReceipt, String> {
    let connection = db.0.lock().map_err(|error| error.to_string())?;
    read_rubric_settings(&connection, legacy_config)
}

#[tauri::command]
pub async fn set_active_rubric_pack(
    db: State<'_, DbState>,
    pack_id: String,
) -> Result<RubricSettingsReceipt, String> {
    let connection = db.0.lock().map_err(|error| error.to_string())?;
    select_rubric_pack(&connection, &pack_id)
}

#[tauri::command]
pub async fn save_rubric_pack(
    db: State<'_, DbState>,
    pack: RubricPackInput,
) -> Result<RubricSettingsReceipt, String> {
    let connection = db.0.lock().map_err(|error| error.to_string())?;
    upsert_rubric_pack(&connection, pack)
}

pub fn read_rubric_settings(
    connection: &Connection,
    legacy: Option<LegacyRubricConfig>,
) -> Result<RubricSettingsReceipt, String> {
    let (config, migrated) = load_or_migrate_config(connection, legacy)?;
    build_receipt(
        connection,
        RubricSettingsOperation::Read,
        config,
        None,
        migrated,
    )
}

pub fn active_rubric_prompt(connection: &Connection) -> Result<(Option<String>, String), String> {
    let receipt = read_rubric_settings(connection, None)?;
    let selected = receipt
        .active_pack_id
        .as_deref()
        .and_then(|id| receipt.packs.iter().find(|pack| pack.id == id))
        .or_else(|| receipt.packs.first())
        .ok_or_else(|| "No review rubric packs are available".to_string())?;
    Ok((receipt.active_pack_id, selected.prompt_preview.clone()))
}

pub fn select_rubric_pack(
    connection: &Connection,
    pack_id: &str,
) -> Result<RubricSettingsReceipt, String> {
    let mut config = load_config(connection)?.unwrap_or_default();
    let pack_id = validate_id(pack_id)?;
    if !all_pack_inputs(&config)
        .iter()
        .any(|pack| pack.id == pack_id)
    {
        return Err("Rubric pack not found".to_string());
    }
    config.active_pack_id = Some(pack_id.clone());
    save_config(connection, &config)?;
    build_receipt(
        connection,
        RubricSettingsOperation::Select,
        config,
        Some(pack_id),
        false,
    )
}

pub fn upsert_rubric_pack(
    connection: &Connection,
    pack: RubricPackInput,
) -> Result<RubricSettingsReceipt, String> {
    let mut config = load_config(connection)?.unwrap_or_default();
    let pack = validate_pack(pack)?;
    if built_in_packs()
        .iter()
        .any(|built_in| built_in.id == pack.id)
    {
        return Err("Built-in rubric packs cannot be overwritten".to_string());
    }
    if let Some(index) = config
        .custom_packs
        .iter()
        .position(|existing| existing.id == pack.id)
    {
        config.custom_packs[index] = pack.clone();
    } else {
        if config.custom_packs.len() >= MAX_CUSTOM_PACKS {
            return Err(format!(
                "At most {MAX_CUSTOM_PACKS} custom rubric packs are supported"
            ));
        }
        config.custom_packs.push(pack.clone());
    }
    config.active_pack_id = Some(pack.id.clone());
    validate_stored_config(&config)?;
    save_config(connection, &config)?;
    build_receipt(
        connection,
        RubricSettingsOperation::Upsert,
        config,
        Some(pack.id),
        false,
    )
}

fn load_or_migrate_config(
    connection: &Connection,
    legacy: Option<LegacyRubricConfig>,
) -> Result<(StoredRubricConfig, bool), String> {
    if let Some(config) = load_config(connection)? {
        return Ok((config, false));
    }
    let Some(legacy) = legacy else {
        return Ok((StoredRubricConfig::default(), false));
    };
    let config = StoredRubricConfig {
        active_pack_id: legacy.active_standards_pack,
        custom_rules: legacy.custom_rules.unwrap_or_default(),
        custom_packs: legacy.standards_packs.unwrap_or_default(),
    };
    let config = validate_stored_config(&config)?;
    save_config(connection, &config)?;
    Ok((config, true))
}

fn load_config(connection: &Connection) -> Result<Option<StoredRubricConfig>, String> {
    let Some(raw) = queries::get_preference(connection, RUBRIC_PREFERENCE_KEY)
        .map_err(|error| error.to_string())?
    else {
        return Ok(None);
    };
    let config: StoredRubricConfig = serde_json::from_str(&raw)
        .map_err(|_| "Stored rubric configuration is invalid".to_string())?;
    Ok(Some(validate_stored_config(&config)?))
}

fn save_config(connection: &Connection, config: &StoredRubricConfig) -> Result<(), String> {
    let value = serde_json::to_string(config).map_err(|error| error.to_string())?;
    queries::set_preference(connection, RUBRIC_PREFERENCE_KEY, &value)
        .map_err(|error| error.to_string())
}

fn validate_stored_config(config: &StoredRubricConfig) -> Result<StoredRubricConfig, String> {
    if config.custom_packs.len() > MAX_CUSTOM_PACKS {
        return Err(format!(
            "At most {MAX_CUSTOM_PACKS} custom rubric packs are supported"
        ));
    }
    let custom_rules = config
        .custom_rules
        .iter()
        .map(|rule| bounded_text(rule, "custom rule", 500))
        .collect::<Result<Vec<_>, _>>()?;
    if custom_rules.len() > 100 {
        return Err("At most 100 custom rubric rules are supported".to_string());
    }
    let custom_packs = config
        .custom_packs
        .iter()
        .cloned()
        .map(validate_pack)
        .collect::<Result<Vec<_>, _>>()?;
    let mut ids = HashSet::new();
    for pack in built_in_packs().into_iter().chain(custom_packs.clone()) {
        if !ids.insert(pack.id.clone()) {
            return Err(format!("Duplicate rubric pack id `{}`", pack.id));
        }
    }
    let active_pack_id = config
        .active_pack_id
        .as_deref()
        .map(validate_id)
        .transpose()?;
    if active_pack_id.as_ref().is_some_and(|id| !ids.contains(id)) {
        return Err("Active rubric pack does not exist".to_string());
    }
    Ok(StoredRubricConfig {
        active_pack_id,
        custom_rules,
        custom_packs,
    })
}

fn validate_pack(pack: RubricPackInput) -> Result<RubricPackInput, String> {
    let id = validate_id(&pack.id)?;
    let name = bounded_text(&pack.name, "pack name", 80)?;
    let focus = bounded_text(&pack.focus, "pack focus", 500)?;
    if pack.checks.is_empty() || pack.checks.len() > 32 {
        return Err("A rubric pack requires between 1 and 32 checks".to_string());
    }
    let checks = pack
        .checks
        .iter()
        .map(|check| bounded_text(check, "pack check", 500))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(RubricPackInput {
        id,
        name,
        focus,
        checks,
    })
}

fn validate_id(value: &str) -> Result<String, String> {
    let id = value.trim();
    if id.is_empty()
        || id.len() > 64
        || !id.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
    {
        return Err("Rubric pack ids use 1-64 lowercase letters, digits, or hyphens".to_string());
    }
    Ok(id.to_string())
}

fn bounded_text(value: &str, label: &str, max: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(format!(
            "A {label} between 1 and {max} characters is required"
        ));
    }
    Ok(value.to_string())
}

fn build_receipt(
    connection: &Connection,
    operation: RubricSettingsOperation,
    config: StoredRubricConfig,
    saved_pack_id: Option<String>,
    migrated_legacy_config: bool,
) -> Result<RubricSettingsReceipt, String> {
    let usage = queries::get_standards_pack_usage(connection)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|row| (row.standards_pack, (row.review_count, row.total_findings)))
        .collect::<HashMap<_, _>>();
    let built_in_ids = built_in_packs()
        .into_iter()
        .map(|pack| pack.id)
        .collect::<HashSet<_>>();
    let active_id = config.active_pack_id.clone();
    let packs = all_pack_inputs(&config)
        .into_iter()
        .map(|pack| {
            let (review_count, total_findings) = usage.get(&pack.id).copied().unwrap_or((0, 0));
            RubricPackReceipt {
                prompt_preview: build_prompt_preview(&pack, &config.custom_rules),
                built_in: built_in_ids.contains(&pack.id),
                active: active_id.as_deref() == Some(pack.id.as_str()),
                review_count,
                total_findings,
                id: pack.id,
                name: pack.name,
                focus: pack.focus,
                checks: pack.checks,
            }
        })
        .collect();
    Ok(RubricSettingsReceipt {
        schema_version: RUBRIC_SETTINGS_SCHEMA_VERSION.to_string(),
        generated_at: Utc::now().to_rfc3339(),
        operation,
        active_pack_id: config.active_pack_id,
        custom_rules: config.custom_rules,
        packs,
        saved_pack_id,
        migrated_legacy_config,
    })
}

fn all_pack_inputs(config: &StoredRubricConfig) -> Vec<RubricPackInput> {
    built_in_packs()
        .into_iter()
        .chain(config.custom_packs.clone())
        .collect()
}

fn build_prompt_preview(pack: &RubricPackInput, custom_rules: &[String]) -> String {
    let mut lines = vec![
        "CodeVetter review standards pack:".to_string(),
        format!("- Pack: {}", pack.name),
        format!("- Focus: {}", pack.focus),
    ];
    lines.extend(pack.checks.iter().map(|check| format!("- Check: {check}")));
    lines.extend(
        custom_rules
            .iter()
            .map(|rule| format!("- Custom rule: {rule}")),
    );
    lines.join("\n")
}

fn built_in_packs() -> Vec<RubricPackInput> {
    vec![
        RubricPackInput {
            id: "product-safety".to_string(),
            name: "Product Safety".to_string(),
            focus: "User-facing regressions, broken flows, data loss, and confusing states."
                .to_string(),
            checks: vec![
                "Flag behavior changes that can break an existing user workflow.".to_string(),
                "Check loading, empty, error, and permission states for user-facing screens."
                    .to_string(),
                "Prioritize concrete reproduction steps over style commentary.".to_string(),
            ],
        },
        RubricPackInput {
            id: "security-boundary".to_string(),
            name: "Security Boundary".to_string(),
            focus: "Auth, authorization, secret handling, trust boundaries, and injection risk."
                .to_string(),
            checks: vec![
                "Verify server-side authorization, not just hidden client controls.".to_string(),
                "Flag secrets, tokens, PII, or prompts that can leak into logs or analytics."
                    .to_string(),
                "Check untrusted input before database, shell, network, or model calls."
                    .to_string(),
            ],
        },
        RubricPackInput {
            id: "agent-handoff".to_string(),
            name: "Agent Handoff".to_string(),
            focus: "Review quality for multi-agent workflows and future task continuity."
                .to_string(),
            checks: vec![
                "Call out missing tests or verification commands the next agent must run."
                    .to_string(),
                "Prefer findings with file paths, line numbers, and a bounded fix.".to_string(),
                "Separate real blockers from optional cleanup so agents do not waste context."
                    .to_string(),
            ],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    fn fixture() -> Connection {
        let connection = Connection::open_in_memory().expect("database");
        schema::run_migrations(&connection).expect("schema");
        connection
    }

    #[test]
    fn legacy_config_migrates_once_and_prompt_preview_matches_review_format() {
        let connection = fixture();
        let legacy = LegacyRubricConfig {
            active_standards_pack: Some("custom-payments".to_string()),
            custom_rules: Some(vec!["Preserve ledger auditability.".to_string()]),
            standards_packs: Some(vec![RubricPackInput {
                id: "custom-payments".to_string(),
                name: "Payments".to_string(),
                focus: "Money movement".to_string(),
                checks: vec!["Check retry idempotency.".to_string()],
            }]),
        };
        let migrated = read_rubric_settings(&connection, Some(legacy.clone())).expect("migrate");
        assert!(migrated.migrated_legacy_config);
        let pack = migrated
            .packs
            .iter()
            .find(|pack| pack.id == "custom-payments")
            .expect("custom pack");
        assert!(pack.active);
        assert!(pack
            .prompt_preview
            .contains("- Check: Check retry idempotency."));
        assert!(pack
            .prompt_preview
            .contains("- Custom rule: Preserve ledger auditability."));

        let reread =
            read_rubric_settings(&connection, Some(LegacyRubricConfig::default())).expect("reread");
        assert!(!reread.migrated_legacy_config);
        assert_eq!(reread.active_pack_id.as_deref(), Some("custom-payments"));
    }

    #[test]
    fn existing_canonical_config_wins_over_conflicting_legacy_state() {
        let connection = fixture();
        let canonical = RubricPackInput {
            id: "canonical-pack".to_string(),
            name: "Canonical".to_string(),
            focus: "Persisted Rust authority".to_string(),
            checks: vec!["Keep the canonical pack.".to_string()],
        };
        upsert_rubric_pack(&connection, canonical).expect("canonical pack");

        let legacy = LegacyRubricConfig {
            active_standards_pack: Some("legacy-pack".to_string()),
            custom_rules: Some(vec!["Do not overwrite Rust.".to_string()]),
            standards_packs: Some(vec![RubricPackInput {
                id: "legacy-pack".to_string(),
                name: "Legacy".to_string(),
                focus: "WebView state".to_string(),
                checks: vec!["Legacy check.".to_string()],
            }]),
        };
        let receipt = read_rubric_settings(&connection, Some(legacy)).expect("read");

        assert!(!receipt.migrated_legacy_config);
        assert_eq!(receipt.active_pack_id.as_deref(), Some("canonical-pack"));
        assert!(receipt.packs.iter().any(|pack| pack.id == "canonical-pack"));
        assert!(!receipt.packs.iter().any(|pack| pack.id == "legacy-pack"));
    }

    #[test]
    fn invalid_legacy_state_fails_without_creating_a_canonical_preference() {
        let connection = fixture();
        let invalid = LegacyRubricConfig {
            active_standards_pack: Some("missing-pack".to_string()),
            custom_rules: None,
            standards_packs: Some(vec![]),
        };

        assert!(read_rubric_settings(&connection, Some(invalid)).is_err());
        assert!(queries::get_preference(&connection, RUBRIC_PREFERENCE_KEY)
            .expect("preference lookup")
            .is_none());
    }

    #[test]
    fn select_and_upsert_reject_unknown_or_built_in_overwrites() {
        let connection = fixture();
        assert!(select_rubric_pack(&connection, "missing").is_err());
        assert!(upsert_rubric_pack(
            &connection,
            RubricPackInput {
                id: "product-safety".to_string(),
                name: "Overwrite".to_string(),
                focus: "No".to_string(),
                checks: vec!["No".to_string()],
            }
        )
        .is_err());

        let receipt = upsert_rubric_pack(
            &connection,
            RubricPackInput {
                id: "performance-proof".to_string(),
                name: "Performance Proof".to_string(),
                focus: "Measured regressions".to_string(),
                checks: vec!["Require a reproducible baseline.".to_string()],
            },
        )
        .expect("upsert");
        assert_eq!(receipt.saved_pack_id.as_deref(), Some("performance-proof"));
        assert_eq!(receipt.active_pack_id.as_deref(), Some("performance-proof"));
        let (active_id, prompt) = active_rubric_prompt(&connection).expect("active prompt");
        assert_eq!(active_id.as_deref(), Some("performance-proof"));
        assert!(prompt.contains("- Check: Require a reproducible baseline."));
    }
}
