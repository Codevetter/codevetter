use crate::commands::native_settings::{list_native_settings, set_native_setting};
use crate::commands::review::resolve_cli_path;
use crate::db::queries;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const ONBOARDING_SCHEMA_VERSION: &str = "codevetter.onboarding/v1";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OnboardingOperation {
    Inspect,
    Complete,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OnboardingToolStatus {
    pub id: String,
    pub label: String,
    pub available: bool,
    pub role: String,
    pub authentication: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OnboardingReceipt {
    pub schema_version: String,
    pub generated_at: String,
    pub operation: OnboardingOperation,
    pub completed: bool,
    pub completion_source: String,
    pub default_adapter: String,
    pub tools: Vec<OnboardingToolStatus>,
    pub limitations: Vec<String>,
}

pub fn inspect_onboarding(connection: Option<&Connection>) -> Result<OnboardingReceipt, String> {
    onboarding_receipt(connection, OnboardingOperation::Inspect)
}

pub fn complete_onboarding(
    connection: &Connection,
    default_adapter: &str,
) -> Result<OnboardingReceipt, String> {
    connection
        .execute_batch("BEGIN IMMEDIATE TRANSACTION")
        .map_err(|error| format!("begin onboarding update: {error}"))?;
    let result = (|| {
        set_native_setting(connection, "default_adapter", default_adapter)?;
        queries::set_preference(connection, "onboarding_complete", "true")
            .map_err(|error| format!("save onboarding completion: {error}"))?;
        Ok::<(), String>(())
    })();
    match result {
        Ok(()) => connection
            .execute_batch("COMMIT")
            .map_err(|error| format!("commit onboarding update: {error}"))?,
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            return Err(error);
        }
    }
    onboarding_receipt(Some(connection), OnboardingOperation::Complete)
}

fn onboarding_receipt(
    connection: Option<&Connection>,
    operation: OnboardingOperation,
) -> Result<OnboardingReceipt, String> {
    let completed = connection
        .map(|connection| queries::get_preference(connection, "onboarding_complete"))
        .transpose()
        .map_err(|error| format!("read onboarding completion: {error}"))?
        .flatten()
        .is_some_and(|value| value == "true");
    let default_adapter = list_native_settings(connection)?
        .settings
        .into_iter()
        .find(|setting| setting.key == "default_adapter")
        .map(|setting| setting.value)
        .unwrap_or_else(|| "claude-code".to_string());
    let tools = [
        (
            "codex",
            "Codex CLI",
            "Runs configured Codex review and fix work",
        ),
        (
            "claude",
            "Claude Code CLI",
            "Runs configured Claude review and fix work",
        ),
        (
            "gh",
            "GitHub CLI",
            "Supplies optional repository and pull-request access",
        ),
    ]
    .into_iter()
    .map(|(id, label, role)| OnboardingToolStatus {
        id: id.to_string(),
        label: label.to_string(),
        available: Path::new(&resolve_cli_path(id)).is_file(),
        role: role.to_string(),
        authentication: "not_inspected".to_string(),
    })
    .collect::<Vec<_>>();
    let selected_binary = if default_adapter == "codex" {
        "codex"
    } else {
        "claude"
    };
    let mut limitations = vec![
        "Tool readiness checks executable presence only; authentication and credentials are never inspected."
            .to_string(),
        "Completing onboarding changes only the shared completion flag and default agent adapter."
            .to_string(),
    ];
    if !tools
        .iter()
        .any(|tool| tool.id == selected_binary && tool.available)
    {
        limitations.push(format!(
            "The selected {default_adapter} adapter is not currently discoverable; verification remains fail-closed until it is available."
        ));
    }
    Ok(OnboardingReceipt {
        schema_version: ONBOARDING_SCHEMA_VERSION.to_string(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        operation,
        completed,
        completion_source: "shared_tauri_native_preference".to_string(),
        default_adapter,
        tools,
        limitations,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn onboarding_reuses_legacy_completion_without_inspecting_credentials() {
        let connection = Connection::open_in_memory().expect("database");
        db::schema::run_migrations(&connection).expect("schema");
        queries::set_preference(&connection, "onboarding_complete", "true").expect("completion");
        queries::set_preference(&connection, "github_token", "fixture-secret").expect("secret");

        let receipt = inspect_onboarding(Some(&connection)).expect("receipt");

        assert!(receipt.completed);
        assert_eq!(receipt.completion_source, "shared_tauri_native_preference");
        assert!(receipt
            .tools
            .iter()
            .all(|tool| tool.authentication == "not_inspected"));
        assert!(!serde_json::to_string(&receipt)
            .expect("json")
            .contains("fixture-secret"));
    }

    #[test]
    fn onboarding_completion_updates_only_declared_non_secret_preferences() {
        let connection = Connection::open_in_memory().expect("database");
        db::schema::run_migrations(&connection).expect("schema");

        let receipt = complete_onboarding(&connection, "codex").expect("complete");

        assert!(receipt.completed);
        assert_eq!(receipt.operation, OnboardingOperation::Complete);
        assert_eq!(receipt.default_adapter, "codex");
        assert_eq!(
            queries::get_preference(&connection, "onboarding_complete").expect("completion"),
            Some("true".to_string())
        );
        assert_eq!(
            queries::get_preference(&connection, "default_adapter").expect("adapter"),
            Some("codex".to_string())
        );
        assert!(complete_onboarding(&connection, "unknown").is_err());
    }
}
