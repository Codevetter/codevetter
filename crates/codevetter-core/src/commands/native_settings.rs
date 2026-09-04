use crate::db::queries;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

pub const NATIVE_SETTINGS_SCHEMA_VERSION: &str = "codevetter.native-settings/v1";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NativeSettingKind {
    Toggle,
    Choice,
    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeSettingOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeSettingValue {
    pub key: String,
    pub section: String,
    pub label: String,
    pub description: String,
    pub kind: NativeSettingKind,
    pub value: String,
    pub default_value: String,
    pub options: Vec<NativeSettingOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeSettingsReceipt {
    pub schema_version: String,
    pub generated_at: String,
    pub database_available: bool,
    pub saved_key: Option<String>,
    pub settings: Vec<NativeSettingValue>,
    pub excluded_sensitive_keys: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
struct NativeSettingDefinition {
    key: &'static str,
    section: &'static str,
    label: &'static str,
    description: &'static str,
    kind: NativeSettingKind,
    default_value: &'static str,
    options: &'static [(&'static str, &'static str)],
}

const EMPTY_OPTIONS: &[(&str, &str)] = &[];
const REVIEW_TONES: &[(&str, &str)] = &[
    ("concise", "Concise"),
    ("thorough", "Thorough"),
    ("mentoring", "Mentoring"),
    ("strict", "Strict"),
];
const ADAPTERS: &[(&str, &str)] = &[("claude-code", "Claude Code"), ("codex", "Codex")];
const ROLES: &[(&str, &str)] = &[
    ("coder", "Coder"),
    ("reviewer", "Reviewer"),
    ("planner", "Planner"),
    ("debugger", "Debugger"),
];
const CONCURRENCY: &[(&str, &str)] =
    &[("1", "1"), ("2", "2"), ("3", "3"), ("5", "5"), ("10", "10")];
const TRAY_CADENCE: &[(&str, &str)] = &[
    ("manual", "Manual only"),
    ("60", "Every minute"),
    ("120", "Every 2 minutes"),
    ("300", "Every 5 minutes"),
    ("900", "Every 15 minutes"),
];
const ISLAND_VOLUME: &[(&str, &str)] = &[("0.5", "Quiet"), ("0.8", "Balanced"), ("1", "Full")];
const ISLAND_PACE: &[(&str, &str)] =
    &[("0.4", "Measured"), ("0.48", "Balanced"), ("0.56", "Quick")];
const ISLAND_COOLDOWN: &[(&str, &str)] = &[
    ("15", "15 seconds"),
    ("30", "30 seconds"),
    ("60", "1 minute"),
];
const ISLAND_QUIET_START: &[(&str, &str)] = &[
    ("", "Off"),
    ("20", "8 PM"),
    ("21", "9 PM"),
    ("22", "10 PM"),
    ("23", "11 PM"),
];
const ISLAND_QUIET_END: &[(&str, &str)] = &[
    ("", "Off"),
    ("6", "6 AM"),
    ("7", "7 AM"),
    ("8", "8 AM"),
    ("9", "9 AM"),
];

const DEFINITIONS: &[NativeSettingDefinition] = &[
    definition(
        "review_tone",
        "general",
        "Default Review Tone",
        "Default tone for a new review.",
        NativeSettingKind::Choice,
        "thorough",
        REVIEW_TONES,
    ),
    definition(
        "compact_mode",
        "appearance",
        "Compact Mode",
        "Use denser spacing on supported workbench surfaces.",
        NativeSettingKind::Toggle,
        "false",
        EMPTY_OPTIONS,
    ),
    definition(
        "show_line_numbers",
        "appearance",
        "Show Line Numbers",
        "Show line identities in source and finding references.",
        NativeSettingKind::Toggle,
        "true",
        EMPTY_OPTIONS,
    ),
    definition(
        "show_costs",
        "appearance",
        "Show Costs",
        "Show available local cost evidence without inferring cloud quota.",
        NativeSettingKind::Toggle,
        "true",
        EMPTY_OPTIONS,
    ),
    definition(
        "default_adapter",
        "agents",
        "Default Adapter",
        "Preferred coding-agent adapter for new work.",
        NativeSettingKind::Choice,
        "claude-code",
        ADAPTERS,
    ),
    definition(
        "default_role",
        "agents",
        "Default Role",
        "Default role assigned to a new agent launch.",
        NativeSettingKind::Choice,
        "coder",
        ROLES,
    ),
    definition(
        "max_concurrent_agents",
        "agents",
        "Max Concurrent Agents",
        "Maximum number of agent processes allowed by the current preference.",
        NativeSettingKind::Choice,
        "3",
        CONCURRENCY,
    ),
    definition(
        "claude_cli_path",
        "agents",
        "Claude Code CLI",
        "Optional explicit path; empty keeps executable discovery enabled.",
        NativeSettingKind::Text,
        "",
        EMPTY_OPTIONS,
    ),
    definition(
        "codex_cli_path",
        "agents",
        "Codex CLI",
        "Optional explicit path; empty keeps executable discovery enabled.",
        NativeSettingKind::Text,
        "",
        EMPTY_OPTIONS,
    ),
    definition(
        "notify_review_done",
        "notifications",
        "Review Completed",
        "Notify when a code review finishes.",
        NativeSettingKind::Toggle,
        "true",
        EMPTY_OPTIONS,
    ),
    definition(
        "notify_agent_error",
        "notifications",
        "Agent Error",
        "Notify when an agent reports a terminal error.",
        NativeSettingKind::Toggle,
        "true",
        EMPTY_OPTIONS,
    ),
    definition(
        "notify_task_complete",
        "notifications",
        "Task Completed",
        "Notify when an agent finishes a task.",
        NativeSettingKind::Toggle,
        "false",
        EMPTY_OPTIONS,
    ),
    definition(
        "notify_quota_thresholds",
        "notifications",
        "Provider Quota Thresholds",
        "Notify only from observed provider-window telemetry.",
        NativeSettingKind::Toggle,
        "true",
        EMPTY_OPTIONS,
    ),
    definition(
        "notify_session_usage_thresholds",
        "notifications",
        "Session Usage Thresholds",
        "Notify from indexed session context estimates when enabled.",
        NativeSettingKind::Toggle,
        "false",
        EMPTY_OPTIONS,
    ),
    definition(
        "notification_sound",
        "notifications",
        "Notification Sounds",
        "Play the configured local notification tone.",
        NativeSettingKind::Toggle,
        "true",
        EMPTY_OPTIONS,
    ),
    definition(
        "tray_refresh_cadence_secs",
        "notifications",
        "Menu Bar Refresh Cadence",
        "Polling cadence for observed live-provider usage.",
        NativeSettingKind::Choice,
        "300",
        TRAY_CADENCE,
    ),
    definition(
        "native_agent_island_enabled",
        "agent_island",
        "Native Agent Island",
        "Retain the opt-in preference for the supervised macOS agent-status surface.",
        NativeSettingKind::Toggle,
        "false",
        EMPTY_OPTIONS,
    ),
    definition(
        "native_agent_island_speech_muted",
        "agent_island",
        "Mute Voice Callouts",
        "Keep visual status available without speaking agent updates.",
        NativeSettingKind::Toggle,
        "false",
        EMPTY_OPTIONS,
    ),
    definition(
        "native_agent_island_speak_completion",
        "agent_island",
        "Speak Completions",
        "Announce the provider and project when a turn finishes.",
        NativeSettingKind::Toggle,
        "true",
        EMPTY_OPTIONS,
    ),
    definition(
        "native_agent_island_speak_attention",
        "agent_island",
        "Speak Attention Requests",
        "Announce confirmed questions and permission requests.",
        NativeSettingKind::Toggle,
        "true",
        EMPTY_OPTIONS,
    ),
    definition(
        "native_agent_island_speak_failure",
        "agent_island",
        "Speak Failures",
        "Announce when an owned agent session fails.",
        NativeSettingKind::Toggle,
        "true",
        EMPTY_OPTIONS,
    ),
    definition(
        "native_agent_island_speech_volume",
        "agent_island",
        "Voice Volume",
        "Set the local system voice volume for Agent Island callouts.",
        NativeSettingKind::Choice,
        "0.8",
        ISLAND_VOLUME,
    ),
    definition(
        "native_agent_island_speech_rate",
        "agent_island",
        "Voice Pace",
        "Choose a calm local speech rate.",
        NativeSettingKind::Choice,
        "0.48",
        ISLAND_PACE,
    ),
    definition(
        "native_agent_island_speech_cooldown",
        "agent_island",
        "Repeat Cooldown",
        "Coalesce repeated callouts for the same session and state.",
        NativeSettingKind::Choice,
        "30",
        ISLAND_COOLDOWN,
    ),
    definition(
        "native_agent_island_quiet_start",
        "agent_island",
        "Quiet Hours Start",
        "Optional local hour when voice callouts pause.",
        NativeSettingKind::Choice,
        "",
        ISLAND_QUIET_START,
    ),
    definition(
        "native_agent_island_quiet_end",
        "agent_island",
        "Quiet Hours End",
        "Optional local hour when voice callouts resume.",
        NativeSettingKind::Choice,
        "",
        ISLAND_QUIET_END,
    ),
    definition(
        "native_agent_island_codex_voice",
        "agent_island",
        "Codex Voice",
        "Optional macOS voice identifier; empty preserves the distinct system default.",
        NativeSettingKind::Text,
        "",
        EMPTY_OPTIONS,
    ),
    definition(
        "native_agent_island_claude_voice",
        "agent_island",
        "Claude Voice",
        "Optional macOS voice identifier; empty preserves the distinct system default.",
        NativeSettingKind::Text,
        "",
        EMPTY_OPTIONS,
    ),
];

const fn definition(
    key: &'static str,
    section: &'static str,
    label: &'static str,
    description: &'static str,
    kind: NativeSettingKind,
    default_value: &'static str,
    options: &'static [(&'static str, &'static str)],
) -> NativeSettingDefinition {
    NativeSettingDefinition {
        key,
        section,
        label,
        description,
        kind,
        default_value,
        options,
    }
}

pub fn list_native_settings(
    connection: Option<&Connection>,
) -> Result<NativeSettingsReceipt, String> {
    settings_receipt(connection, None)
}

pub fn set_native_setting(
    connection: &Connection,
    key: &str,
    value: &str,
) -> Result<NativeSettingsReceipt, String> {
    let definition = DEFINITIONS
        .iter()
        .find(|definition| definition.key == key)
        .ok_or_else(|| format!("setting `{key}` is not in the native non-secret allowlist"))?;
    validate_value(definition, value)?;
    queries::set_preference(connection, key, value)
        .map_err(|error| format!("save native setting `{key}`: {error}"))?;
    settings_receipt(Some(connection), Some(key.to_string()))
}

fn settings_receipt(
    connection: Option<&Connection>,
    saved_key: Option<String>,
) -> Result<NativeSettingsReceipt, String> {
    let mut settings = Vec::with_capacity(DEFINITIONS.len());
    for definition in DEFINITIONS {
        let persisted = connection
            .map(|connection| queries::get_preference(connection, definition.key))
            .transpose()
            .map_err(|error| format!("read native setting `{}`: {error}", definition.key))?
            .flatten();
        let value = persisted.unwrap_or_else(|| definition.default_value.to_string());
        validate_value(definition, &value).map_err(|error| {
            format!(
                "stored native setting `{}` is invalid and was not projected: {error}",
                definition.key
            )
        })?;
        settings.push(NativeSettingValue {
            key: definition.key.to_string(),
            section: definition.section.to_string(),
            label: definition.label.to_string(),
            description: definition.description.to_string(),
            kind: definition.kind,
            value,
            default_value: definition.default_value.to_string(),
            options: definition
                .options
                .iter()
                .map(|(value, label)| NativeSettingOption {
                    value: (*value).to_string(),
                    label: (*label).to_string(),
                })
                .collect(),
        });
    }
    Ok(NativeSettingsReceipt {
        schema_version: NATIVE_SETTINGS_SCHEMA_VERSION.to_string(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        database_available: connection.is_some(),
        saved_key,
        settings,
        excluded_sensitive_keys: vec!["github_token".to_string()],
    })
}

fn validate_value(definition: &NativeSettingDefinition, value: &str) -> Result<(), String> {
    if value.contains('\0') || value.len() > 1_024 {
        return Err("value must be at most 1024 characters and contain no NUL byte".to_string());
    }
    if matches!(
        definition.key,
        "native_agent_island_codex_voice" | "native_agent_island_claude_voice"
    ) && (value.chars().count() > 256 || value.chars().any(char::is_control))
    {
        return Err(
            "Agent Island voice identifiers must be at most 256 characters and contain no control characters"
                .to_string(),
        );
    }
    match definition.kind {
        NativeSettingKind::Toggle if value != "true" && value != "false" => {
            Err("toggle value must be true or false".to_string())
        }
        NativeSettingKind::Choice
            if !definition
                .options
                .iter()
                .any(|(candidate, _)| *candidate == value) =>
        {
            Err("value is not one of the declared options".to_string())
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn native_settings_project_only_allowlisted_non_secret_values() {
        let connection = Connection::open_in_memory().expect("database");
        db::schema::run_migrations(&connection).expect("schema");
        queries::set_preference(&connection, "github_token", "secret-value").expect("secret");
        let receipt = list_native_settings(Some(&connection)).expect("settings");

        assert_eq!(receipt.schema_version, NATIVE_SETTINGS_SCHEMA_VERSION);
        assert!(receipt
            .settings
            .iter()
            .all(|setting| setting.key != "github_token"));
        assert_eq!(receipt.excluded_sensitive_keys, vec!["github_token"]);
        assert!(!serde_json::to_string(&receipt)
            .expect("json")
            .contains("secret-value"));
    }

    #[test]
    fn native_settings_validate_and_round_trip_declared_values() {
        let connection = Connection::open_in_memory().expect("database");
        db::schema::run_migrations(&connection).expect("schema");

        let receipt = set_native_setting(&connection, "review_tone", "strict").expect("save");
        assert_eq!(receipt.saved_key.as_deref(), Some("review_tone"));
        assert_eq!(
            receipt
                .settings
                .iter()
                .find(|setting| setting.key == "review_tone")
                .map(|setting| setting.value.as_str()),
            Some("strict")
        );
        assert!(set_native_setting(&connection, "review_tone", "invented").is_err());
        assert!(set_native_setting(&connection, "github_token", "secret").is_err());

        let island = set_native_setting(&connection, "native_agent_island_enabled", "true")
            .expect("save island setting");
        let island_settings = island
            .settings
            .iter()
            .filter(|setting| setting.section == "agent_island")
            .collect::<Vec<_>>();
        assert_eq!(island_settings.len(), 12);
        assert_eq!(
            island_settings
                .iter()
                .find(|setting| setting.key == "native_agent_island_enabled")
                .map(|setting| setting.value.as_str()),
            Some("true")
        );
        assert!(set_native_setting(
            &connection,
            "native_agent_island_codex_voice",
            &"a".repeat(257),
        )
        .is_err());
    }
}
