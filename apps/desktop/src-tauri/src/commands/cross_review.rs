//! Deterministic reconciliation for independent Claude and Codex review passes.
//!
//! Each provider receives the original immutable target and context. This
//! module never invokes an LLM to merge results: only source-qualified identity
//! (path, resolved line, and source anchor) can correlate findings.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde_json::{json, Value};

use crate::db::queries::{self, LocalReviewFindingInput, LocalReviewInput, LocalReviewUpdate};
use crate::DbState;

use super::review::resolve_agent_cli_path;

pub const CROSS_REVIEW_SCHEMA: &str = "codevetter.cross-review/v1";

pub fn missing_executors() -> Vec<String> {
    ["claude", "codex"]
        .into_iter()
        .filter(|agent| !Path::new(&resolve_agent_cli_path(agent)).is_file())
        .map(str::to_string)
        .collect()
}

pub fn reconcile_complete(claude: Value, codex: Value) -> Result<Value, String> {
    let claude_target = target_identity(&claude)?;
    let codex_target = target_identity(&codex)?;
    if claude_target != codex_target {
        return Err("Cross-review passes do not bind the same immutable target".into());
    }
    let mut grouped = BTreeMap::<String, Vec<(&str, Value)>>::new();
    let mut unresolved = Vec::new();
    for (reviewer, evidence) in [("claude", &claude), ("codex", &codex)] {
        for finding in evidence
            .get("findings")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(identity) = finding_identity(finding) {
                grouped
                    .entry(identity)
                    .or_default()
                    .push((reviewer, finding.clone()));
            } else {
                unresolved.push(json!({
                    "reviewer": reviewer,
                    "reason": "missing_source_qualified_identity"
                }));
            }
        }
    }

    let mut findings = Vec::new();
    let mut counts = BTreeMap::from([
        ("corroborated", 0_u64),
        ("claude_only", 0),
        ("codex_only", 0),
        ("conflicting", 0),
        (
            "rejected",
            qualification_total(&claude, "rejected") + qualification_total(&codex, "rejected"),
        ),
        (
            "stale",
            qualification_total(&claude, "stale") + qualification_total(&codex, "stale"),
        ),
        (
            "unresolved",
            qualification_total(&claude, "unresolved") + qualification_total(&codex, "unresolved"),
        ),
    ]);
    for candidates in grouped.into_values() {
        let reviewers = candidates
            .iter()
            .map(|(reviewer, _)| *reviewer)
            .collect::<BTreeSet<_>>();
        let classification = match reviewers.iter().copied().collect::<Vec<_>>().as_slice() {
            ["claude"] => "claude_only",
            ["codex"] => "codex_only",
            _ if severities(&candidates).len() > 1 => "conflicting",
            _ => "corroborated",
        };
        *counts.entry(classification).or_default() += 1;
        let mut selected = candidates
            .iter()
            .max_by_key(|(_, finding)| finding_rank(finding))
            .map(|(_, finding)| finding.clone())
            .ok_or_else(|| {
                "Cross-review reconciliation received an empty finding group".to_string()
            })?;
        let object = selected
            .as_object_mut()
            .ok_or_else(|| "Qualified review finding is not an object".to_string())?;
        object.insert(
            "cross_review_class".into(),
            Value::String(classification.into()),
        );
        object.insert(
            "reviewers".into(),
            Value::Array(
                reviewers
                    .into_iter()
                    .map(|reviewer| Value::String(reviewer.into()))
                    .collect(),
            ),
        );
        findings.push(selected);
    }

    let claude_ready = review_ready(&claude);
    let codex_ready = review_ready(&codex);
    if let Some(count) = counts.get_mut("unresolved") {
        *count += unresolved.len() as u64;
    }
    let complete = claude_ready && codex_ready && unresolved.is_empty();
    if !complete {
        findings.clear();
    }
    let limitations = if complete {
        Vec::new()
    } else {
        vec!["Both independent passes and every source-qualified identity are required".to_string()]
    };
    Ok(json!({
        "schema_version": CROSS_REVIEW_SCHEMA,
        "strategy": "claude_then_codex_independent",
        "status": if complete { "completed" } else { "incomplete" },
        "target_identity": claude_target,
        "passes": [pass_summary("claude", &claude), pass_summary("codex", &codex)],
        "counts": counts,
        "findings": findings,
        "unresolved": unresolved,
        "limitations": limitations,
        "authority": "deterministic_source_qualified_union",
        "proof_boundary": "Reviewer agreement is review coverage, never executable proof."
    }))
}

pub fn incomplete_after_pass(
    completed_reviewer: Option<(&str, Value)>,
    failed_reviewer: &str,
    error: &str,
) -> Value {
    let passes = completed_reviewer
        .map(|(reviewer, evidence)| vec![pass_summary(reviewer, &evidence)])
        .unwrap_or_default();
    json!({
        "schema_version": CROSS_REVIEW_SCHEMA,
        "strategy": "claude_then_codex_independent",
        "status": "incomplete",
        "passes": passes,
        "failed_reviewer": failed_reviewer,
        "findings": [],
        "limitations": [format!("{failed_reviewer} pass did not complete: {}", bounded(error, 320))],
        "authority": "deterministic_source_qualified_union",
        "proof_boundary": "A partial run cannot produce a composite cross-review claim."
    })
}

pub fn project_stage_evidence(cross_review: Value) -> Value {
    let findings = cross_review
        .get("findings")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let complete = cross_review.get("status").and_then(Value::as_str) == Some("completed");
    let limitations = cross_review
        .get("limitations")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    json!({
        "agent": "cross",
        "review_status": if complete { "completed" } else { "incomplete" },
        "review_readiness": {
            "status": if complete { "ready" } else { "incomplete" },
            "complete_coverage": complete,
            "limitations": limitations,
        },
        "findings_count": findings.as_array().map_or(0, Vec::len),
        "findings": findings,
        "cross_review": cross_review,
        "summary": "Independent Claude and Codex passes reconciled by source-qualified identity."
    })
}

pub fn persist_composite_review(
    db: &DbState,
    repo_path: &str,
    diff_range: &str,
    standards_pack: Option<String>,
    evidence: &mut Value,
) -> Result<(), String> {
    let status = evidence
        .get("review_status")
        .and_then(Value::as_str)
        .unwrap_or("incomplete")
        .to_string();
    let connection = db.0.lock().map_err(|error| error.to_string())?;
    let review_id = queries::create_local_review(
        &connection,
        &LocalReviewInput {
            review_type: Some("cross_review".into()),
            source_label: Some(format!("cli:cross:{diff_range}")),
            repo_path: Some(repo_path.into()),
            repo_full_name: None,
            pr_number: None,
            agent_used: Some("claude+codex".into()),
            status: Some(status.clone()),
            standards_pack,
        },
    )
    .map_err(|error| error.to_string())?;
    let findings = evidence
        .get_mut("findings")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Cross-review evidence omitted its finding union".to_string())?;
    for finding in findings.iter_mut() {
        let fingerprint = finding_identity(finding);
        let object = finding
            .as_object_mut()
            .ok_or_else(|| "Cross-review finding is not an object".to_string())?;
        let finding_id = queries::insert_review_finding(
            &connection,
            &LocalReviewFindingInput {
                review_id: review_id.clone(),
                severity: string(object, "severity").unwrap_or("medium").into(),
                title: string(object, "title").unwrap_or("Untitled").into(),
                summary: string(object, "summary").unwrap_or("").into(),
                suggestion: string(object, "suggestion").map(str::to_string),
                file_path: string(object, "filePath").map(str::to_string),
                line: object.get("line").and_then(Value::as_i64),
                confidence: object.get("confidence").and_then(Value::as_f64),
                fingerprint,
                discovery_method: Some("independent_cross_review".into()),
            },
        )
        .map_err(|error| error.to_string())?;
        object.insert("id".into(), Value::String(finding_id));
    }
    queries::update_local_review(
        &connection,
        &review_id,
        &LocalReviewUpdate {
            findings_count: Some(findings.len() as i64),
            summary_markdown: Some(
                "Independent Claude then Codex review; source-qualified union only. Agreement does not create executable proof."
                    .into(),
            ),
            status: Some(status),
            completed_at: Some(chrono::Utc::now().to_rfc3339()),
            ..LocalReviewUpdate::default()
        },
    )
    .map_err(|error| error.to_string())?;
    evidence
        .as_object_mut()
        .ok_or_else(|| "Cross-review stage evidence is not an object".to_string())?
        .insert("review_id".into(), Value::String(review_id));
    Ok(())
}

fn target_identity(evidence: &Value) -> Result<String, String> {
    evidence
        .pointer("/review_manifest/target/identity")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Review pass omitted its immutable target identity".into())
}

fn finding_identity(finding: &Value) -> Option<String> {
    let path = finding.get("filePath").and_then(Value::as_str)?.trim();
    let line = finding.get("line").and_then(Value::as_i64)?;
    let anchor = finding.get("sourceAnchor").and_then(Value::as_str)?.trim();
    (!path.is_empty() && line > 0 && !anchor.is_empty())
        .then(|| format!("{path}\0{line}\0{anchor}"))
}

fn severities(candidates: &[(&str, Value)]) -> BTreeSet<String> {
    candidates
        .iter()
        .filter_map(|(_, finding)| finding.get("severity").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

fn finding_rank(finding: &Value) -> (u8, u64) {
    let severity = match finding.get("severity").and_then(Value::as_str) {
        Some("critical") => 4,
        Some("high") => 3,
        Some("medium") => 2,
        Some("low") => 1,
        _ => 0,
    };
    let confidence = finding
        .get("confidence")
        .and_then(Value::as_f64)
        .map_or(0, |value| (value.clamp(0.0, 1.0) * 1_000_000.0) as u64);
    (severity, confidence)
}

fn review_ready(evidence: &Value) -> bool {
    evidence
        .pointer("/review_readiness/status")
        .and_then(Value::as_str)
        == Some("ready")
        && evidence.get("review_status").and_then(Value::as_str) == Some("completed")
}

fn qualification_total(evidence: &Value, state: &str) -> u64 {
    evidence
        .pointer(&format!("/review_manifest/qualification_counts/{state}"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn pass_summary(reviewer: &str, evidence: &Value) -> Value {
    json!({
        "reviewer": reviewer,
        "status": evidence.get("review_status").cloned().unwrap_or(Value::String("incomplete".into())),
        "review_id": evidence.get("review_id").cloned().unwrap_or(Value::Null),
        "duration_ms": evidence.get("duration_ms").cloned().unwrap_or(Value::Null),
        "findings_count": evidence.get("findings_count").cloned().unwrap_or(Value::from(0)),
        "qualified_findings": evidence.get("findings").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        "review_readiness": evidence.get("review_readiness").cloned().unwrap_or(Value::Null),
        "review_manifest": evidence.get("review_manifest").cloned().unwrap_or(Value::Null),
        "usage": evidence.get("usage").cloned().unwrap_or(Value::Null),
        "raw_candidate_access": "not_exposed_by_review_contract; qualification diagnostics remain in review_manifest",
    })
}

fn string<'a>(object: &'a serde_json::Map<String, Value>, key: &str) -> Option<&'a str> {
    object.get(key).and_then(Value::as_str)
}

fn bounded(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pass(reviewer: &str, findings: Value) -> Value {
        json!({
            "review_id": format!("{reviewer}-review"),
            "review_status": "completed",
            "review_readiness": {"status": "ready"},
            "findings": findings,
            "findings_count": findings.as_array().map_or(0, Vec::len),
            "duration_ms": 25,
            "review_manifest": {
                "target": {"identity": "immutable-target"},
                "executor_id": reviewer,
                "policy_fingerprint": format!("{reviewer}-policy")
            }
        })
    }

    fn finding(severity: &str, title: &str, path: &str, line: i64, anchor: &str) -> Value {
        json!({
            "severity": severity,
            "title": title,
            "summary": format!("{title} evidence"),
            "filePath": path,
            "line": line,
            "sourceAnchor": anchor,
            "confidence": 0.9
        })
    }

    #[test]
    fn source_identity_reconciles_corroborated_unique_and_conflicting_findings() {
        let shared = finding("high", "Claude title", "src/a.rs", 8, "danger();");
        let mut codex_shared = shared.clone();
        codex_shared["title"] = Value::String("Different title, same exact source".into());
        let conflicting = finding("medium", "Claude severity", "src/b.rs", 9, "other();");
        let mut codex_conflicting = conflicting.clone();
        codex_conflicting["severity"] = Value::String("critical".into());
        let receipt = reconcile_complete(
            pass(
                "claude",
                json!([
                    shared,
                    conflicting,
                    finding("low", "Claude only", "src/c.rs", 2, "c();")
                ]),
            ),
            pass(
                "codex",
                json!([
                    codex_shared,
                    codex_conflicting,
                    finding("high", "Codex only", "src/d.rs", 3, "d();")
                ]),
            ),
        )
        .expect("cross review");
        assert_eq!(receipt["status"], "completed");
        assert_eq!(receipt["counts"]["corroborated"], 1);
        assert_eq!(receipt["counts"]["conflicting"], 1);
        assert_eq!(receipt["counts"]["claude_only"], 1);
        assert_eq!(receipt["counts"]["codex_only"], 1);
        assert_eq!(receipt["findings"].as_array().map(Vec::len), Some(4));
        assert_eq!(
            receipt["findings"]
                .as_array()
                .and_then(|items| items.iter().find(|item| item["filePath"] == "src/b.rs"))
                .map(|item| &item["severity"]),
            Some(&Value::String("critical".into()))
        );
    }

    #[test]
    fn title_similarity_never_merges_different_source_locations() {
        let receipt = reconcile_complete(
            pass(
                "claude",
                json!([finding("high", "Same title", "src/a.rs", 1, "a();")]),
            ),
            pass(
                "codex",
                json!([finding("high", "Same title", "src/b.rs", 1, "b();")]),
            ),
        )
        .expect("cross review");
        assert_eq!(receipt["findings"].as_array().map(Vec::len), Some(2));
    }

    #[test]
    fn missing_anchor_and_partial_execution_fail_closed() {
        let receipt = reconcile_complete(
            pass(
                "claude",
                json!([{"severity":"high","title":"x","summary":"x"}]),
            ),
            pass("codex", json!([])),
        )
        .expect("cross review");
        assert_eq!(receipt["status"], "incomplete");
        assert!(receipt["findings"].as_array().is_some_and(Vec::is_empty));
        assert_eq!(
            receipt["passes"][0]["qualified_findings"]
                .as_array()
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(receipt["passes"][0]["review_readiness"]["status"], "ready");

        let partial = incomplete_after_pass(
            Some(("claude", pass("claude", json!([])))),
            "codex",
            "cancelled",
        );
        assert_eq!(partial["status"], "incomplete");
        assert_eq!(partial["passes"].as_array().map(Vec::len), Some(1));
        assert!(partial["findings"].as_array().is_some_and(Vec::is_empty));
    }

    #[test]
    fn different_targets_never_form_a_composite() {
        let claude = pass("claude", json!([]));
        let mut codex = pass("codex", json!([]));
        codex["review_manifest"]["target"]["identity"] = Value::String("other".into());
        assert!(reconcile_complete(claude, codex).is_err());
    }

    #[test]
    fn composite_and_qualified_union_persist_under_one_review_identity() {
        let connection = rusqlite::Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("schema");
        let db = DbState(std::sync::Arc::new(std::sync::Mutex::new(connection)));
        let receipt = reconcile_complete(
            pass(
                "claude",
                json!([finding(
                    "high",
                    "Shared finding",
                    "src/a.rs",
                    8,
                    "danger();"
                )]),
            ),
            pass(
                "codex",
                json!([finding(
                    "high",
                    "Shared finding",
                    "src/a.rs",
                    8,
                    "danger();"
                )]),
            ),
        )
        .expect("cross review");
        let mut evidence = project_stage_evidence(receipt);
        persist_composite_review(&db, "/fixture/repo", "main...HEAD", None, &mut evidence)
            .expect("persist composite");

        let review_id = evidence["review_id"].as_str().expect("review id");
        let connection = db.0.lock().expect("database lock");
        let (review, findings) =
            queries::get_local_review_with_findings(&connection, review_id).expect("stored review");
        assert_eq!(review.review_type.as_deref(), Some("cross_review"));
        assert_eq!(review.agent_used, "claude+codex");
        assert_eq!(review.findings_count, Some(1));
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].file_path.as_deref(), Some("src/a.rs"));
    }
}
