use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::observability::{
    agent_observability_from_connection, billing_config_from_connection,
    webhook_config_from_connection, TaskTypeStats,
};

pub const OPS_STATUS_SCHEMA_VERSION: &str = "codevetter.ops-status/v1";
pub const OPS_WINDOWS: &[u32] = &[7, 30, 90];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpsStatusReceipt {
    pub schema_version: String,
    pub generated_at: String,
    pub database_available: bool,
    pub window_days: u32,
    pub billing: OpsBillingStatus,
    pub webhook: OpsWebhookStatus,
    pub observability: Vec<TaskTypeStats>,
    pub excluded_sensitive_keys: Vec<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpsBillingStatus {
    pub anthropic_configured: bool,
    pub openai_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpsWebhookStatus {
    pub configured: bool,
    pub flavor: String,
}

pub fn inspect_ops_status(
    connection: Option<&Connection>,
    window_days: u32,
) -> Result<OpsStatusReceipt, String> {
    if !OPS_WINDOWS.contains(&window_days) {
        return Err("Ops window must be one of 7, 30, or 90 days".to_string());
    }

    let (billing, webhook, observability) = if let Some(connection) = connection {
        let billing = billing_config_from_connection(connection);
        let webhook = webhook_config_from_connection(connection);
        let flavor = match webhook.flavor.as_str() {
            "slack" | "discord" | "generic" => webhook.flavor,
            _ => "unknown".to_string(),
        };
        let observability = agent_observability_from_connection(connection, Some(window_days));
        (
            OpsBillingStatus {
                anthropic_configured: billing.anthropic_configured,
                openai_configured: billing.openai_configured,
            },
            OpsWebhookStatus {
                configured: webhook.configured,
                flavor,
            },
            observability.rows,
        )
    } else {
        (
            OpsBillingStatus {
                anthropic_configured: false,
                openai_configured: false,
            },
            OpsWebhookStatus {
                configured: false,
                flavor: "slack".to_string(),
            },
            Vec::new(),
        )
    };

    Ok(OpsStatusReceipt {
        schema_version: OPS_STATUS_SCHEMA_VERSION.to_string(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        database_available: connection.is_some(),
        window_days,
        billing,
        webhook,
        observability,
        excluded_sensitive_keys: vec![
            "anthropic_admin_key".to_string(),
            "openai_admin_key".to_string(),
            "notif_webhook_url".to_string(),
        ],
        limitations: vec![
            "This read-only receipt never returns credentials or webhook URLs.".to_string(),
            "It reads stored aggregate evidence only and never contacts a provider or webhook."
                .to_string(),
            "Credential writes, live billing refresh, and webhook tests remain incumbent authority."
                .to_string(),
            "Indexed sessions have no explicit failure signal and remain labelled as an aggregate proxy."
                .to_string(),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use rusqlite::params;

    #[test]
    fn ops_status_is_aggregate_only_and_excludes_sensitive_values() {
        let directory = tempfile::tempdir().expect("temporary app data");
        let connection = db::init_db(directory.path().to_path_buf()).expect("database");
        connection
            .execute(
                "INSERT OR REPLACE INTO preferences (key, value) VALUES (?1, ?2)",
                params!["anthropic_admin_key", "secret-anthropic-value"],
            )
            .expect("admin preference");
        connection
            .execute(
                "INSERT OR REPLACE INTO preferences (key, value) VALUES (?1, ?2)",
                params!["notif_webhook_url", "https://hooks.example.invalid/private"],
            )
            .expect("webhook preference");
        connection
            .execute(
                "INSERT OR REPLACE INTO preferences (key, value) VALUES (?1, ?2)",
                params!["notif_webhook_flavor", "discord"],
            )
            .expect("webhook flavor");

        let receipt = inspect_ops_status(Some(&connection), 30).expect("Ops receipt");
        let encoded = serde_json::to_string(&receipt).expect("serialize receipt");

        assert_eq!(receipt.schema_version, OPS_STATUS_SCHEMA_VERSION);
        assert!(receipt.billing.anthropic_configured);
        assert!(!receipt.billing.openai_configured);
        assert!(receipt.webhook.configured);
        assert_eq!(receipt.webhook.flavor, "discord");
        assert!(!encoded.contains("secret-anthropic-value"));
        assert!(!encoded.contains("hooks.example.invalid"));
        assert_eq!(receipt.excluded_sensitive_keys.len(), 3);
    }

    #[test]
    fn ops_status_rejects_unbounded_windows_and_unknown_flavors() {
        let directory = tempfile::tempdir().expect("temporary app data");
        let connection = db::init_db(directory.path().to_path_buf()).expect("database");
        assert!(inspect_ops_status(Some(&connection), 365).is_err());

        connection
            .execute(
                "INSERT OR REPLACE INTO preferences (key, value) VALUES (?1, ?2)",
                params!["notif_webhook_flavor", "custom-private-flavor"],
            )
            .expect("webhook flavor");
        let receipt = inspect_ops_status(Some(&connection), 7).expect("Ops receipt");
        assert_eq!(receipt.webhook.flavor, "unknown");
    }
}
