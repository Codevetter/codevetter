//! Content-free projection of skill-recorder sessions for future Runs clients.
//!
//! This service accepts already loaded records. It does not discover personal
//! ledgers, read transcripts, execute commands, or backfill historical skill use.
//! Receipt integrity identifies bytes, not correctness or causal agent benefit.

use std::collections::BTreeMap;

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

const SUPPORTED_STATES: &[&str] = &[
    "running",
    "completed",
    "failed",
    "unavailable",
    "interrupted",
    "timed_out",
    "output_limit",
];
const SUPPORTED_SKILLS: &[&str] = &[
    "codevetter-review",
    "codevetter-testing",
    "codevetter-performance",
    "codevetter-evaluate",
];

const RECORD_SCHEMA: &str = "codevetter.skill-invocation/v1";
pub(crate) const SUPPORTED_COMMANDS: &[&str] = &[
    "check",
    "scope",
    "qa",
    "trex",
    "warm",
    "differential",
    "scenario",
    "performance",
    "runs",
    "capabilities",
    "collect",
];
const ASSESSMENT_SCHEMA: &str = "codevetter.skill-usefulness/v1";
const MAX_METADATA_BYTES: usize = 16 * 1024;
const MAX_RECEIPT_BYTES: usize = 2 * 1024 * 1024;

/// A recorder session, not a provider conversation. No transcript is required.
pub struct InvocationSession {
    pub invocation: Value,
    pub assessments: Vec<Value>,
    pub receipt_bytes: Option<Vec<u8>>,
}

#[derive(Debug, Default, Clone, Deserialize, PartialEq, Eq)]
pub struct InvocationFilter {
    pub repo_path: Option<String>,
    pub task_id: Option<String>,
    pub skill: Option<String>,
    pub state: Option<String>,
    pub assessment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InvocationEventsReceipt {
    pub schema_version: String,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub invocations: Vec<InvocationEvent>,
    pub unreadable_records: usize,
    /// Repository identity is missing/unreadable; never attributed to a scope.
    pub unattributed_records: usize,
    pub unreadable_assessments: usize,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InvocationEvent {
    pub source_schema_version: String,
    pub invocation_id: String,
    pub skill: String,
    pub repo_path: String,
    pub task_id: Option<String>,
    pub parent_invocation_id: Option<String>,
    pub command: String,
    pub command_provenance: String,
    pub operation: Option<String>,
    /// Originating coding agent, not the provider used by CodeVetter.
    pub agent: Option<String>,
    /// Only an explicit metadata provider is projected; never inferred from agent.
    pub provider: Option<String>,
    pub provider_provenance: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub duration_ms: Option<u64>,
    pub context_capture_ms: Option<u64>,
    pub state: String,
    pub exit_code: Option<i32>,
    pub cli_exit_code: Option<i32>,
    pub receipt_path: Option<String>,
    pub receipt_sha256: Option<String>,
    pub receipt_schema_version: Option<Value>,
    pub receipt_integrity: ReceiptIntegrity,
    pub assessment: String,
    pub usefulness: Option<UsefulnessObservation>,
    pub unreadable_assessments: usize,
    /// Activity, observations and receipt hashes cannot establish benefit.
    pub independently_verified_benefit: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReceiptIntegrity {
    NotRecorded,
    Unavailable,
    HashMatched,
    Changed,
    Invalid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UsefulnessObservation {
    pub assessment_id: String,
    pub recorded_at: String,
    pub outcome: String,
    pub provenance: String,
    pub independently_verified: bool,
    pub measured_cost_usd: Option<f64>,
}

#[derive(Deserialize)]
struct Metadata {
    schema_version: String,
    invocation_id: String,
    skill: String,
    repo_path: String,
    #[serde(default)]
    task_id: Option<String>,
    #[serde(default)]
    parent_invocation_id: Option<String>,
    command: String,
    #[serde(default)]
    operation: Option<String>,
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    provider: Option<String>,
    started_at: String,
    #[serde(default)]
    finished_at: Option<String>,
    #[serde(default)]
    duration_ms: Option<u64>,
    #[serde(default)]
    context_capture_ms: Option<u64>,
    state: String,
    #[serde(default)]
    exit_code: Option<i32>,
    #[serde(default)]
    cli_exit_code: Option<i32>,
    #[serde(default)]
    receipt_path: Option<String>,
    #[serde(default)]
    receipt_sha256: Option<String>,
    #[serde(default)]
    receipt_schema_version: Option<Value>,
}

/// Deterministic newest-first ordering by timestamp instant, then invocation ID.
/// Filters and total precede pagination. Duplicate identities are rejected in
/// full rather than choosing a winner according to collection order.
pub fn project_invocation_events(
    sessions: &[InvocationSession],
    filter: &InvocationFilter,
    offset: usize,
    limit: usize,
) -> Result<InvocationEventsReceipt, String> {
    if !(1..=100).contains(&limit) {
        return Err("Invocation limit must be 1-100".into());
    }
    if filter.task_id.as_deref().is_some_and(|id| !valid_id(id)) {
        return Err("Invalid invocation task identity".into());
    }
    for (value, supported) in [
        (filter.skill.as_deref(), SUPPORTED_SKILLS),
        (filter.state.as_deref(), SUPPORTED_STATES),
        (
            filter.assessment.as_deref(),
            &[
                "helped",
                "did_not_help",
                "inconclusive",
                "blocked",
                "unassessed",
                "unavailable",
            ] as &[&str],
        ),
    ] {
        if value.is_some_and(|value| !supported.contains(&value)) {
            return Err("Unsupported invocation filter".into());
        }
    }
    if filter
        .repo_path
        .as_ref()
        .is_some_and(|path| path.is_empty() || path.len() > 4096)
    {
        return Err("Invalid invocation repository filter".into());
    }
    let mut identities = BTreeMap::new();
    for session in sessions {
        if !in_repository_scope(&session.invocation, filter) {
            continue;
        }
        if let Some(id) = session
            .invocation
            .get("invocation_id")
            .and_then(Value::as_str)
        {
            *identities.entry(id).or_insert(0usize) += 1;
        }
    }
    let mut records = Vec::new();
    let mut unreadable_records = 0;
    let mut unattributed_records = 0;
    let mut unreadable_assessments = 0;
    for session in sessions {
        if !in_repository_scope(&session.invocation, filter) {
            if repository_identity(&session.invocation).is_none() {
                unattributed_records += 1;
            }
            continue;
        }
        let Some(metadata) = parse_metadata(&session.invocation) else {
            unreadable_records += 1;
            continue;
        };
        if identities[metadata.invocation_id.as_str()] > 1 {
            unreadable_records += 1;
            continue;
        }
        let (usefulness, errors) = latest_observation(session, &metadata);
        unreadable_assessments += errors;
        let event = project_event(
            metadata,
            session.receipt_bytes.as_deref(),
            usefulness,
            errors,
        );
        if matches_filter(&event, filter) {
            records.push(event);
        }
    }
    records.sort_by(|left, right| {
        timestamp(&right.started_at)
            .cmp(&timestamp(&left.started_at))
            .then_with(|| right.invocation_id.cmp(&left.invocation_id))
    });
    Ok(InvocationEventsReceipt {
        schema_version: "codevetter.invocation-events/v1".into(),
        total: records.len(),
        offset,
        limit,
        invocations: records.into_iter().skip(offset).take(limit).collect(),
        unreadable_records,
        unattributed_records,
        unreadable_assessments,
        limitations: vec![
            "Only supplied skill-recorder sessions are counted; legacy transcripts are not backfilled.".into(),
            "Usefulness is agent-reported; receipt integrity does not establish correctness or causal benefit.".into(),
            "Missing provider, timing, cost and historical context remain unknown; no provider is inferred from the originating agent.".into(),
        ],
    })
}

pub(super) fn repository_identity(value: &Value) -> Option<&str> {
    value
        .get("repo_path")
        .and_then(Value::as_str)
        .filter(|repo| !repo.is_empty())
}

fn in_repository_scope(value: &Value, filter: &InvocationFilter) -> bool {
    filter
        .repo_path
        .as_deref()
        .is_none_or(|repo| repository_identity(value) == Some(repo))
}

fn valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|parsed| parsed.to_string() == id)
}

fn timestamp(value: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(value).ok()
}

fn parse_metadata(value: &Value) -> Option<Metadata> {
    if serde_json::to_vec(value).ok()?.len() > MAX_METADATA_BYTES {
        return None;
    }
    let record: Metadata = serde_json::from_value(value.clone()).ok()?;
    let supported_operation = [
        "preflight",
        "inspect",
        "plan",
        "diagnose",
        "verify-paired",
        "prepare",
        "run",
        "cancel",
        "status",
        "start",
        "stop",
        "current",
        "generate",
        "validate",
        "dry-run",
        "unrecognized",
    ];
    if record.schema_version != RECORD_SCHEMA
        || !valid_id(&record.invocation_id)
        || !SUPPORTED_SKILLS.contains(&record.skill.as_str())
        || !SUPPORTED_COMMANDS.contains(&record.command.as_str())
        || !SUPPORTED_STATES.contains(&record.state.as_str())
        || record.repo_path.is_empty()
        || timestamp(&record.started_at).is_none()
        || record
            .finished_at
            .as_deref()
            .is_some_and(|t| timestamp(t).is_none())
        || record.task_id.as_deref().is_some_and(|id| !valid_id(id))
        || record
            .parent_invocation_id
            .as_deref()
            .is_some_and(|id| !valid_id(id))
        || (record.parent_invocation_id.is_some() && record.task_id.is_none())
        || record
            .operation
            .as_deref()
            .is_some_and(|op| !supported_operation.contains(&op))
        || record.agent.as_deref().is_some_and(|agent| {
            !["codex", "claude", "gemini", "other", "unknown"].contains(&agent)
        })
        || record.provider.as_deref().is_some_and(|provider| {
            ![
                "openai",
                "anthropic",
                "openrouter",
                "local",
                "other",
                "unknown",
            ]
            .contains(&provider)
        })
        || record
            .receipt_schema_version
            .as_ref()
            .is_some_and(|schema| {
                !(schema
                    .as_str()
                    .is_some_and(|s| !s.is_empty() && s.len() <= 128)
                    || schema.as_u64().is_some_and(|n| n <= i32::MAX as u64))
            })
    {
        return None;
    }
    Some(record)
}

fn matches_filter(record: &InvocationEvent, filter: &InvocationFilter) -> bool {
    filter
        .task_id
        .as_ref()
        .is_none_or(|id| record.task_id.as_ref() == Some(id))
        && filter
            .skill
            .as_ref()
            .is_none_or(|skill| skill == &record.skill)
        && filter
            .state
            .as_ref()
            .is_none_or(|state| state == &record.state)
        && filter
            .assessment
            .as_ref()
            .is_none_or(|assessment| assessment == &record.assessment)
}

fn receipt_integrity(record: &Metadata, bytes: Option<&[u8]>) -> ReceiptIntegrity {
    let Some(expected) = record.receipt_sha256.as_deref() else {
        return ReceiptIntegrity::NotRecorded;
    };
    if expected.len() != 64 || !expected.bytes().all(|b| b.is_ascii_hexdigit()) {
        return ReceiptIntegrity::Invalid;
    }
    let Some(bytes) = bytes else {
        return ReceiptIntegrity::Unavailable;
    };
    if bytes.len() > MAX_RECEIPT_BYTES {
        return ReceiptIntegrity::Invalid;
    }
    if format!("{:x}", Sha256::digest(bytes)) != expected {
        return ReceiptIntegrity::Changed;
    }
    let Ok(receipt) = serde_json::from_slice::<Value>(bytes) else {
        return ReceiptIntegrity::Invalid;
    };
    if record.receipt_schema_version.is_none()
        || !receipt.is_object()
        || receipt.get("schema_version") != record.receipt_schema_version.as_ref()
    {
        return ReceiptIntegrity::Invalid;
    }
    ReceiptIntegrity::HashMatched
}

fn latest_observation(
    session: &InvocationSession,
    record: &Metadata,
) -> (Option<UsefulnessObservation>, usize) {
    let mut observations = Vec::new();
    let mut errors = 0;
    let mut identities = BTreeMap::new();
    for value in &session.assessments {
        if let Some(id) = value["assessment_id"].as_str() {
            *identities.entry(id).or_insert(0usize) += 1;
        }
    }
    for value in &session.assessments {
        let valid = serde_json::to_vec(value).is_ok_and(|v| v.len() <= MAX_METADATA_BYTES)
            && value["schema_version"] == ASSESSMENT_SCHEMA
            && value["invocation_id"] == record.invocation_id
            && value["provenance"] == "agent_reported"
            && value["independently_verified"] == false;
        let observation = serde_json::from_value::<UsefulnessObservation>(value.clone()).ok();
        if let Some(observation) = observation.filter(|o| {
            valid
                && valid_id(&o.assessment_id)
                && identities[o.assessment_id.as_str()] == 1
                && timestamp(&o.recorded_at).is_some()
                && ["helped", "did_not_help", "inconclusive", "blocked"]
                    .contains(&o.outcome.as_str())
                && o.measured_cost_usd
                    .is_none_or(|cost| cost.is_finite() && cost >= 0.0)
                && record.state != "running"
                && (o.outcome != "helped"
                    || (["completed", "failed"].contains(&record.state.as_str())
                        && receipt_integrity(record, session.receipt_bytes.as_deref())
                            == ReceiptIntegrity::HashMatched
                        && has_bound_evidence(value, record, session.receipt_bytes.as_deref())))
        }) {
            observations.push(observation);
        } else {
            errors += 1;
        }
    }
    observations.sort_by(|left, right| {
        timestamp(&right.recorded_at)
            .cmp(&timestamp(&left.recorded_at))
            .then_with(|| right.assessment_id.cmp(&left.assessment_id))
    });
    (observations.into_iter().next(), errors)
}

fn has_bound_evidence(value: &Value, record: &Metadata, bytes: Option<&[u8]>) -> bool {
    let Some(evidence) = value["evidence"]
        .as_array()
        .filter(|items| !items.is_empty() && items.len() <= 8)
    else {
        return false;
    };
    let Some(receipt) = bytes.and_then(|b| serde_json::from_slice::<Value>(b).ok()) else {
        return false;
    };
    evidence.iter().all(|item| {
        item["receipt_sha256"].as_str() == record.receipt_sha256.as_deref()
            && item["json_pointer"].as_str().is_some_and(|pointer| {
                pointer.starts_with('/')
                    && pointer.len() <= 512
                    && valid_pointer(pointer)
                    && receipt.pointer(pointer).is_some_and(|v| {
                        !v.is_null()
                            && v != ""
                            && v != &serde_json::json!([])
                            && v != &serde_json::json!({})
                    })
            })
    })
}

fn valid_pointer(pointer: &str) -> bool {
    // Match the recorder's escape rules rather than accepting malformed ~ keys.
    pointer.split('/').skip(1).all(|part| {
        let mut chars = part.chars();
        while let Some(character) = chars.next() {
            if character == '~' && !matches!(chars.next(), Some('0' | '1')) {
                return false;
            }
        }
        true
    })
}

fn project_event(
    record: Metadata,
    bytes: Option<&[u8]>,
    usefulness: Option<UsefulnessObservation>,
    unreadable_assessments: usize,
) -> InvocationEvent {
    let integrity = receipt_integrity(&record, bytes);
    InvocationEvent {
        source_schema_version: record.schema_version,
        invocation_id: record.invocation_id,
        skill: record.skill,
        repo_path: record.repo_path,
        task_id: record.task_id,
        parent_invocation_id: record.parent_invocation_id,
        command: record.command,
        command_provenance: "invocation_metadata".into(),
        operation: record.operation,
        agent: record.agent,
        provider_provenance: record
            .provider
            .as_ref()
            .map(|_| "invocation_metadata".into()),
        provider: record.provider,
        started_at: record.started_at,
        finished_at: record.finished_at,
        duration_ms: record.duration_ms,
        context_capture_ms: record.context_capture_ms,
        state: record.state,
        exit_code: record.exit_code,
        cli_exit_code: record.cli_exit_code,
        receipt_path: record.receipt_path,
        receipt_sha256: record.receipt_sha256,
        receipt_schema_version: record.receipt_schema_version,
        receipt_integrity: integrity,
        assessment: usefulness
            .as_ref()
            .map(|o| o.outcome.clone())
            .unwrap_or_else(|| {
                if unreadable_assessments > 0 {
                    "unavailable"
                } else {
                    "unassessed"
                }
                .into()
            }),
        usefulness,
        unreadable_assessments,
        independently_verified_benefit: None,
    }
}

#[cfg(test)]
#[path = "invocation_events_tests.rs"]
mod tests;
