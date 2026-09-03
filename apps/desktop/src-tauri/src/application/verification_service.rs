//! Tauri-independent application service for the native verification loop.
//!
//! Transport adapters supply one stable request identity. The service owns the
//! versioned command contract, correlates every progress event and terminal
//! receipt, and delegates verification semantics to the existing Rust engine.

use serde::{Deserialize, Serialize};

use crate::commands::local_check::{
    preflight_local_check, run_local_check_with_progress, LocalCheckInput,
    LocalCheckPreflightReceipt, LocalCheckReceipt,
};

pub const VERIFICATION_COMMAND_SCHEMA: &str = "codevetter.verification-command/v1";
pub const VERIFICATION_PROGRESS_SCHEMA: &str = "codevetter.progress/v2";
pub const VERIFICATION_CANCELLATION_SCHEMA: &str = "codevetter.verification-cancel/v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerificationOperation {
    Preflight,
    Execute,
}

#[derive(Debug, Clone)]
pub struct VerificationCommand {
    pub schema_version: &'static str,
    pub request_id: String,
    pub operation: VerificationOperation,
    pub input: LocalCheckInput,
}

impl VerificationCommand {
    pub fn new(
        request_id: Option<String>,
        operation: VerificationOperation,
        input: LocalCheckInput,
    ) -> Result<Self, String> {
        Ok(Self {
            schema_version: VERIFICATION_COMMAND_SCHEMA,
            request_id: resolve_request_id(request_id.as_deref())?,
            operation,
            input,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationProgress {
    pub schema_version: String,
    pub request_id: String,
    pub sequence: u32,
    pub stage: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationCancellation {
    pub schema_version: String,
    pub request_id: String,
}

impl VerificationCancellation {
    pub fn new(request_id: &str) -> Result<Self, String> {
        validate_request_id(request_id)?;
        Ok(Self {
            schema_version: VERIFICATION_CANCELLATION_SCHEMA.into(),
            request_id: request_id.into(),
        })
    }
}

#[derive(Debug, Clone)]
pub enum VerificationResult {
    Preflight(Box<LocalCheckPreflightReceipt>),
    Complete(Box<LocalCheckReceipt>),
}

pub async fn run_verification_command<F>(
    command: VerificationCommand,
    mut on_progress: F,
) -> Result<VerificationResult, String>
where
    F: FnMut(VerificationProgress),
{
    if command.schema_version != VERIFICATION_COMMAND_SCHEMA {
        return Err(format!(
            "unsupported verification command schema `{}`",
            command.schema_version
        ));
    }
    validate_request_id(&command.request_id)?;
    let mut sequence = 0_u32;
    let mut emit = |stage: &str, state: &str| {
        let event = VerificationProgress {
            schema_version: VERIFICATION_PROGRESS_SCHEMA.into(),
            request_id: command.request_id.clone(),
            sequence,
            stage: stage.into(),
            state: state.into(),
        };
        sequence = sequence.saturating_add(1);
        on_progress(event);
    };

    match command.operation {
        VerificationOperation::Preflight => {
            emit("preflight", "running");
            let mut receipt = preflight_local_check(&command.input).await?;
            receipt.request_id = Some(command.request_id.clone());
            emit("preflight", "completed");
            Ok(VerificationResult::Preflight(Box::new(receipt)))
        }
        VerificationOperation::Execute => {
            let request_id = command.request_id.clone();
            let mut receipt = run_local_check_with_progress(command.input, |progress| {
                emit(progress.stage, progress.state)
            })
            .await?;
            receipt.request_id = Some(request_id);
            Ok(VerificationResult::Complete(Box::new(receipt)))
        }
    }
}

pub fn resolve_request_id(request_id: Option<&str>) -> Result<String, String> {
    match request_id.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => {
            validate_request_id(value)?;
            Ok(value.to_string())
        }
        None => Ok(uuid::Uuid::new_v4().to_string()),
    }
}

fn validate_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("request id must contain between 1 and 128 characters".into());
    }
    if !request_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(
            "request id may contain only ASCII letters, numbers, dash, underscore, dot, or colon"
                .into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::commands::local_check::{LocalCheckStatus, LocalCheckTarget, LocalCheckVerdict};

    const LOCAL_CHECK_PARITY_FIXTURE: &str =
        include_str!("../../tests/fixtures/surface-parity/local-check-v1.json");

    fn git(repo: &Path, arguments: &[&str]) {
        let output = std::process::Command::new("git")
            .args(arguments)
            .current_dir(repo)
            .output()
            .expect("git command");
        assert!(
            output.status.success(),
            "git {:?}: {}",
            arguments,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn request_identity_is_bounded_and_generated_when_absent() {
        assert_eq!(
            resolve_request_id(Some("native.review:fixture-1")).expect("valid request"),
            "native.review:fixture-1"
        );
        assert!(
            uuid::Uuid::parse_str(&resolve_request_id(None).expect("generated request")).is_ok()
        );
        assert!(resolve_request_id(Some("../unsafe path")).is_err());
        assert!(resolve_request_id(Some(&"x".repeat(129))).is_err());
    }

    #[test]
    fn progress_contract_carries_request_identity_and_order() {
        let progress = VerificationProgress {
            schema_version: VERIFICATION_PROGRESS_SCHEMA.into(),
            request_id: "native-review-fixture".into(),
            sequence: 3,
            stage: "correctness".into(),
            state: "running".into(),
        };
        let value = serde_json::to_value(&progress).expect("progress JSON");
        assert_eq!(value["schema_version"], VERIFICATION_PROGRESS_SCHEMA);
        assert_eq!(value["request_id"], "native-review-fixture");
        assert_eq!(value["sequence"], 3);
        let cancellation =
            VerificationCancellation::new("native-review-fixture").expect("cancellation contract");
        assert_eq!(
            cancellation.schema_version,
            VERIFICATION_CANCELLATION_SCHEMA
        );
        assert_eq!(cancellation.request_id, progress.request_id);
    }

    #[test]
    fn authoritative_service_owns_the_shared_local_check_receipt_contract() {
        let fixture: serde_json::Value =
            serde_json::from_str(LOCAL_CHECK_PARITY_FIXTURE).expect("local-check parity fixture");
        let receipt: LocalCheckReceipt =
            serde_json::from_value(fixture["canonical_receipt"].clone())
                .expect("canonical local-check receipt");
        let request = &fixture["request"];

        assert_eq!(fixture["authority"]["rust"], "authoritative_service");
        assert_eq!(request["schema_version"], VERIFICATION_COMMAND_SCHEMA);
        assert_eq!(
            receipt.schema_version,
            fixture["expected"]["receipt_schema"]
        );
        assert_eq!(
            receipt.request_id.as_deref(),
            request["request_id"].as_str()
        );
        assert_eq!(receipt.run_id, fixture["expected"]["run_id"]);
        assert_eq!(receipt.verdict, LocalCheckVerdict::NoConfidence);
        assert_eq!(
            receipt.stages.performance.status,
            LocalCheckStatus::NoConfidence
        );
        assert!(receipt
            .limitations
            .iter()
            .any(|value| value == fixture["expected"]["limitation"].as_str().unwrap()));
    }

    #[tokio::test]
    async fn preflight_runs_through_the_service_and_correlates_every_projection() {
        let repo = tempfile::tempdir().expect("repository");
        git(repo.path(), &["init", "--initial-branch", "main"]);
        git(
            repo.path(),
            &["config", "user.email", "fixture@example.test"],
        );
        git(repo.path(), &["config", "user.name", "CodeVetter Fixture"]);
        std::fs::create_dir_all(repo.path().join("test")).expect("test directory");
        std::fs::write(repo.path().join("source.js"), "export const value = 1;\n").expect("source");
        std::fs::write(repo.path().join("test/source.test.js"), "// fixture\n").expect("test");
        git(repo.path(), &["add", "."]);
        git(repo.path(), &["commit", "-m", "base"]);
        std::fs::write(repo.path().join("source.js"), "export const value = 2;\n")
            .expect("changed source");
        git(repo.path(), &["add", "source.js"]);
        git(repo.path(), &["commit", "-m", "change"]);

        let command = VerificationCommand::new(
            Some("native-review-service-fixture".into()),
            VerificationOperation::Preflight,
            LocalCheckInput {
                repo_path: repo.path().to_path_buf(),
                change: "HEAD^...HEAD".into(),
                task: "Preserve the source contract".into(),
                standards_pack: None,
                standards_context: None,
                spec_paths: Vec::new(),
                selected_requirement_ids: Vec::new(),
                review_agent: "codex".into(),
                test_target: Some(LocalCheckTarget {
                    adapter: "node-test".into(),
                    target: "test/source.test.js".into(),
                    name: None,
                    source: "explicit:fixture".into(),
                }),
                performance_target: None,
                baseline_repo_path: None,
                samples: 3,
                warmups: 1,
                timeout_ms: 30_000,
            },
        )
        .expect("command");
        let mut progress = Vec::new();
        let result = run_verification_command(command, |event| progress.push(event))
            .await
            .expect("service preflight");
        let VerificationResult::Preflight(receipt) = result else {
            panic!("expected preflight receipt");
        };

        assert_eq!(
            receipt.request_id.as_deref(),
            Some("native-review-service-fixture")
        );
        assert_eq!(receipt.status, LocalCheckStatus::Ready);
        assert_eq!(progress.len(), 2);
        assert!(progress
            .iter()
            .all(|event| event.request_id == "native-review-service-fixture"));
        assert_eq!(
            progress
                .iter()
                .map(|event| event.sequence)
                .collect::<Vec<_>>(),
            vec![0, 1]
        );
        assert_eq!(progress[0].state, "running");
        assert_eq!(progress[1].state, "completed");
    }
}
