//! Caller-reported outcomes attached to exact persisted verification evidence.

use std::collections::BTreeSet;

use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

const MAX_EVENTS: usize = 1000;
const MAX_RECEIPT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OutcomeSource {
    pub repo_path: String,
    pub run_id: String,
    pub receipt_sha256: String,
    pub base_sha: String,
    pub head_sha: String,
    pub source_input: String,
    pub source_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum OutcomeEvent {
    Incident,
    Revert,
    ConfirmedSafe { basis: String },
    HumanOverride { action: OverrideAction },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OverrideAction {
    Accept,
    Reject,
    Defer,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OutcomeObservation {
    pub event_id: String,
    pub reason: String,
    pub evidence_ref: String,
    pub group_id: Option<String>,
    pub event: OutcomeEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OutcomeRecord {
    pub source: OutcomeSource,
    pub observation: OutcomeObservation,
    pub recorded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutcomeSummary {
    pub caller_reported: bool,
    pub independent_correctness_evidence: bool,
    pub observation_count: usize,
    pub grouped_adverse_count: usize,
    pub confirmed_safe_count: usize,
    pub override_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutcomeProjection {
    pub schema_version: String,
    pub source: OutcomeSource,
    pub records: Vec<OutcomeRecord>,
    pub summary: OutcomeSummary,
}

pub(crate) struct StoredCheck {
    pub source: OutcomeSource,
    pub receipt: Value,
}

pub(crate) fn load_stored_check(
    connection: &Connection,
    repo_path: &str,
    run_id: &str,
) -> Result<StoredCheck, String> {
    bounded_text(run_id, "run id", 200)?;
    let row = connection.query_row(
        "SELECT repo_path, base_sha, head_sha, receipt_json FROM local_check_runs WHERE run_id = ?1 AND repo_path = ?2",
        rusqlite::params![run_id, repo_path],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?)),
    ).optional().map_err(|error| format!("Read persisted local-check source: {error}"))?
        .ok_or("Local-check receipt was not found in this repository scope")?;
    if row.3.len() > MAX_RECEIPT_BYTES {
        return Err("Persisted local-check receipt exceeds the bounded input size".into());
    }
    let receipt: Value = serde_json::from_str(&row.3)
        .map_err(|error| format!("Decode persisted local-check source: {error}"))?;
    let string = |pointer: &str| receipt.pointer(pointer).and_then(Value::as_str);
    if string("/schema_version") != Some("codevetter.local-check/v1")
        || string("/run_id") != Some(run_id)
        || string("/repo_path") != Some(row.0.as_str())
        || string("/source/base_sha") != Some(row.1.as_str())
        || string("/source/head_sha") != Some(row.2.as_str())
        || !full_sha(&row.1)
        || !full_sha(&row.2)
    {
        return Err("Persisted local-check source identity is inconsistent or incomplete".into());
    }
    let source_input = string("/source/input")
        .ok_or("Missing persisted source input")?
        .to_string();
    bounded_text(&source_input, "source input", 2048)?;
    let source_mode = string("/source/kind")
        .ok_or("Missing persisted source mode")?
        .to_string();
    if !matches!(source_mode.as_str(), "range" | "pull_request") {
        return Err("Unsupported persisted local-check source mode".into());
    }
    Ok(StoredCheck {
        source: OutcomeSource {
            repo_path: row.0,
            run_id: run_id.into(),
            receipt_sha256: format!("{:x}", Sha256::digest(row.3.as_bytes())),
            base_sha: row.1,
            head_sha: row.2,
            source_input,
            source_mode,
        },
        receipt,
    })
}

fn full_sha(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn bounded_text(value: &str, label: &str, max: usize) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > max || value.chars().any(|ch| ch.is_control()) {
        return Err(format!(
            "{label} must be nonempty, bounded to {max} bytes, and contain no control characters"
        ));
    }
    Ok(())
}

fn validate_observation(observation: &OutcomeObservation) -> Result<(), String> {
    bounded_text(&observation.event_id, "event id", 200)?;
    bounded_text(&observation.reason, "reason", 2048)?;
    bounded_text(&observation.evidence_ref, "evidence reference", 2048)?;
    if let Some(group) = &observation.group_id {
        bounded_text(group, "group id", 200)?;
        if !matches!(
            observation.event,
            OutcomeEvent::Incident | OutcomeEvent::Revert
        ) {
            return Err(
                "Only incident and revert observations can share an adverse-event group".into(),
            );
        }
    }
    if let OutcomeEvent::ConfirmedSafe { basis } = &observation.event {
        bounded_text(basis, "confirmed-safe basis", 2048)?;
    }
    Ok(())
}

pub fn record_outcome(
    connection: &Connection,
    repo_path: &str,
    run_id: &str,
    observation: OutcomeObservation,
) -> Result<OutcomeRecord, String> {
    validate_observation(&observation)?;
    let transaction =
        rusqlite::Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
            .map_err(|error| format!("Start outcome transaction: {error}"))?;
    let stored = load_stored_check(&transaction, repo_path, run_id)?;
    let projection = list_outcomes(&transaction, repo_path, run_id)?;
    let existing = transaction.query_row(
        "SELECT record_json FROM verification_outcome_events WHERE repo_path = ?1 AND event_id = ?2",
        rusqlite::params![repo_path, observation.event_id], |row| row.get::<_, String>(0),
    ).optional().map_err(|error| format!("Read outcome idempotency key: {error}"))?;
    if let Some(existing) = existing {
        let record: OutcomeRecord =
            serde_json::from_str(&existing).map_err(|error| error.to_string())?;
        if record.source != stored.source || record.observation != observation {
            return Err(
                "Outcome event id already identifies different source or event content".into(),
            );
        }
        transaction.commit().map_err(|error| error.to_string())?;
        return Ok(record);
    }
    if projection.records.len() >= MAX_EVENTS {
        return Err("Outcome observation bound reached for this exact run".into());
    }
    let record = OutcomeRecord {
        source: stored.source,
        observation,
        recorded_at: chrono::Utc::now().to_rfc3339(),
    };
    let json = serde_json::to_string(&record).map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO verification_outcome_events(repo_path, run_id, event_id, receipt_sha256, record_json) VALUES(?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![repo_path, run_id, record.observation.event_id, record.source.receipt_sha256, json],
    ).map_err(|error| format!("Append outcome: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Commit outcome: {error}"))?;
    Ok(record)
}

pub fn list_outcomes(
    connection: &Connection,
    repo_path: &str,
    run_id: &str,
) -> Result<OutcomeProjection, String> {
    let stored = load_stored_check(connection, repo_path, run_id)?;
    let mut statement = connection.prepare(
        "SELECT record_json FROM verification_outcome_events WHERE repo_path = ?1 AND run_id = ?2 ORDER BY event_id LIMIT ?3",
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            rusqlite::params![repo_path, run_id, (MAX_EVENTS + 1) as i64],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| error.to_string())?;
    let mut records = Vec::new();
    for row in rows {
        let record: OutcomeRecord = serde_json::from_str(&row.map_err(|error| error.to_string())?)
            .map_err(|error| format!("Decode outcome event: {error}"))?;
        if record.source != stored.source {
            return Err("Persisted receipt changed after an outcome was recorded; outcome source digest no longer matches".into());
        }
        records.push(record);
    }
    if records.len() > MAX_EVENTS {
        return Err("Outcome observation bound exceeded".into());
    }
    let mut summary = OutcomeSummary {
        caller_reported: true,
        independent_correctness_evidence: false,
        observation_count: 0,
        grouped_adverse_count: 0,
        confirmed_safe_count: 0,
        override_count: 0,
    };
    let mut adverse = BTreeSet::new();
    for record in &records {
        match &record.observation.event {
            OutcomeEvent::HumanOverride { .. } => summary.override_count += 1,
            OutcomeEvent::ConfirmedSafe { .. } => {
                summary.observation_count += 1;
                summary.confirmed_safe_count += 1;
            }
            OutcomeEvent::Incident | OutcomeEvent::Revert => {
                summary.observation_count += 1;
                adverse.insert(match &record.observation.group_id {
                    Some(group) => format!("group:{group}"),
                    None => format!("event:{}", record.observation.event_id),
                });
            }
        }
    }
    summary.grouped_adverse_count = adverse.len();
    Ok(OutcomeProjection {
        schema_version: "codevetter.verification-outcomes/v1".into(),
        source: stored.source,
        records,
        summary,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) fn fixture() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        crate::db::verification_workbench_schema::run_migration(&connection).unwrap();
        let finding = |name: &str, line: u64| {
            json!({
                "title":format!("Original {name}"), "summary":format!("Description {name}"),
                "suggestion":format!("Suggestion {name}"), "filePath":"src/private.ts", "line":line,
                "sourceAnchor":format!("anchor {line}"), "severity":"high", "qualification":{"state":"qualified"},
            })
        };
        let receipt = json!({
            "schema_version":"codevetter.local-check/v1", "run_id":"run-1", "repo_path":"/fixture/repo",
            "source":{"kind":"range", "input":"base..head", "base_sha":"a".repeat(40), "head_sha":"b".repeat(40)},
            "verdict":"needs_attention", "stages":{"review":{"status":"needs_attention", "evidence":{"review_status":"completed", "review_readiness":{"status":"ready"},
                "findings":[finding("first", 4), finding("second", 8), {"title":"Unqualified", "summary":"Ignore me"}],
                "passes":[{"findings":[finding("not-final", 10)]}]
            }}}
        });
        connection.execute("INSERT INTO local_check_runs(run_id,schema_version,repo_path,base_sha,head_sha,verdict,task,receipt_json,ran_at) VALUES('run-1','codevetter.local-check/v1','/fixture/repo',?1,?2,'needs_attention','fixture',?3,'2026-11-08')",
            rusqlite::params!["a".repeat(40), "b".repeat(40), receipt.to_string()]).unwrap();
        connection
    }

    fn observation(id: &str, event: OutcomeEvent) -> OutcomeObservation {
        OutcomeObservation {
            event_id: id.into(),
            reason: "Observed regression result".into(),
            evidence_ref: "fixture:ledger-result".into(),
            group_id: None,
            event,
        }
    }

    #[test]
    fn verification_learning_outcomes_idempotency_and_immutable_evidence() {
        let connection = fixture();
        let before: String = connection
            .query_row("SELECT receipt_json FROM local_check_runs", [], |row| {
                row.get(0)
            })
            .unwrap();
        let event = observation("incident-1", OutcomeEvent::Incident);
        let first = record_outcome(&connection, "/fixture/repo", "run-1", event.clone()).unwrap();
        let retry = record_outcome(&connection, "/fixture/repo", "run-1", event.clone()).unwrap();
        assert_eq!(first, retry);
        assert_eq!(first.source.head_sha, "b".repeat(40));
        assert_eq!(
            first.source.receipt_sha256,
            format!("{:x}", Sha256::digest(before.as_bytes()))
        );
        let mut conflict = event;
        conflict.reason = "Different event".into();
        assert!(record_outcome(&connection, "/fixture/repo", "run-1", conflict).is_err());
        let after: String = connection
            .query_row("SELECT receipt_json FROM local_check_runs", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(before, after);
        assert_eq!(
            list_outcomes(&connection, "/fixture/repo", "run-1")
                .unwrap()
                .records
                .len(),
            1
        );
        assert!(connection
            .execute(
                "UPDATE verification_outcome_events SET event_id='replacement'",
                []
            )
            .is_err());
        assert!(connection
            .execute("DELETE FROM verification_outcome_events", [])
            .is_err());
    }

    #[test]
    fn verification_learning_outcomes_reject_wrong_repo_missing_run_and_receipt_replacement() {
        let connection = fixture();
        let event = observation("event", OutcomeEvent::Revert);
        assert!(record_outcome(&connection, "/another/repo", "run-1", event.clone()).is_err());
        assert!(record_outcome(&connection, "/fixture/repo", "missing", event.clone()).is_err());
        record_outcome(&connection, "/fixture/repo", "run-1", event.clone()).unwrap();
        connection.execute("UPDATE local_check_runs SET receipt_json = replace(receipt_json, 'needs_attention', 'passed_with_limits')", []).unwrap();
        assert!(list_outcomes(&connection, "/fixture/repo", "run-1").is_err());
        assert!(record_outcome(&connection, "/fixture/repo", "run-1", event).is_err());
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM verification_outcome_events",
                    [],
                    |row| row.get::<_, u64>(0)
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn verification_learning_outcomes_group_labels_and_overrides_without_calibration_writes() {
        let connection = fixture();
        for (id, event) in [
            ("incident", OutcomeEvent::Incident),
            ("revert", OutcomeEvent::Revert),
            ("another", OutcomeEvent::Incident),
            (
                "safe",
                OutcomeEvent::ConfirmedSafe {
                    basis: "Regression replay passed for the exact source".into(),
                },
            ),
            (
                "override",
                OutcomeEvent::HumanOverride {
                    action: OverrideAction::Accept,
                },
            ),
        ] {
            let mut event = observation(id, event);
            if matches!(id, "incident" | "revert") {
                event.group_id = Some("same-production-incident".into());
            }
            record_outcome(&connection, "/fixture/repo", "run-1", event).unwrap();
        }
        let changes_before = connection
            .query_row("SELECT total_changes()", [], |row| row.get::<_, u64>(0))
            .unwrap();
        let projection = list_outcomes(&connection, "/fixture/repo", "run-1").unwrap();
        assert_eq!(projection.summary.observation_count, 4);
        assert_eq!(projection.summary.grouped_adverse_count, 2);
        assert_eq!(projection.summary.confirmed_safe_count, 1);
        assert_eq!(projection.summary.override_count, 1);
        assert!(projection.summary.caller_reported);
        assert!(!projection.summary.independent_correctness_evidence);
        assert_eq!(
            connection
                .query_row("SELECT total_changes()", [], |row| row.get::<_, u64>(0))
                .unwrap(),
            changes_before
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM outcome_calibration_observations",
                    [],
                    |row| row.get::<_, u64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM outcome_calibration_summaries",
                    [],
                    |row| row.get::<_, u64>(0)
                )
                .unwrap(),
            0
        );
        assert!(record_outcome(
            &connection,
            "/fixture/repo",
            "run-1",
            observation("empty", OutcomeEvent::ConfirmedSafe { basis: " ".into() })
        )
        .is_err());
        let mut invalid = observation(
            "invalid",
            OutcomeEvent::HumanOverride {
                action: OverrideAction::Defer,
            },
        );
        invalid.group_id = Some("group".into());
        assert!(record_outcome(&connection, "/fixture/repo", "run-1", invalid).is_err());
        crate::db::verification_workbench_schema::run_migration(&connection).unwrap();
        assert_eq!(
            list_outcomes(&connection, "/fixture/repo", "run-1")
                .unwrap()
                .records
                .len(),
            5
        );
    }

    #[test]
    fn verification_learning_outcomes_validates_receipt_columns_and_bounded_reasons() {
        let connection = fixture();
        let mut event = observation("invalid", OutcomeEvent::Incident);
        event.reason = "a".repeat(2049);
        assert!(record_outcome(&connection, "/fixture/repo", "run-1", event).is_err());
        connection
            .execute(
                "UPDATE local_check_runs SET head_sha = ?1",
                ["c".repeat(40)],
            )
            .unwrap();
        assert!(record_outcome(
            &connection,
            "/fixture/repo",
            "run-1",
            observation("invalid", OutcomeEvent::Incident)
        )
        .is_err());
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM verification_outcome_events",
                    [],
                    |row| row.get::<_, u64>(0)
                )
                .unwrap(),
            0
        );
    }
}
