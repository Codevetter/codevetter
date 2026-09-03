//! Deterministic intent diagnostics for completed reviews.
//!
//! This projection explains what evidence exists around the operator's stated
//! goal. It never closes intent automatically: only an explicit human
//! disposition may make that product claim.

use std::collections::BTreeSet;

use serde::Serialize;
use serde_json::Value;

pub const REVIEW_INTENT_DIAGNOSTIC_SCHEMA: &str = "codevetter.review-intent-diagnostic/v1";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ReviewIntentDiagnostic {
    pub schema_version: String,
    pub intent: IntentCapture,
    pub changed_surfaces: Vec<String>,
    pub signals: IntentSignals,
    pub gaps: Vec<String>,
    pub timeline: Vec<IntentTimelineItem>,
    pub closure: IntentClosure,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct IntentCapture {
    pub summary: String,
    pub status: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct IntentSignals {
    pub changed_paths: usize,
    pub findings: usize,
    pub high_risk_findings: usize,
    pub qa_runs: usize,
    pub passed_qa_runs: usize,
    pub failed_qa_runs: usize,
    pub qa_artifacts: usize,
    pub complete_review_coverage: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct IntentTimelineItem {
    pub id: String,
    pub label: String,
    pub detail: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct IntentClosure {
    pub status: String,
    pub reason: String,
    pub requires_human_disposition: bool,
}

pub fn build_review_intent_diagnostic(
    change_description: &str,
    changed_files: &[String],
    findings: &[Value],
    qa_runs: &[Value],
    complete_review_coverage: bool,
) -> ReviewIntentDiagnostic {
    let intent_summary = change_description.trim();
    let intent_captured = !intent_summary.is_empty();
    let high_risk_findings = findings
        .iter()
        .filter(|finding| {
            matches!(
                finding.get("severity").and_then(Value::as_str),
                Some("critical" | "high")
            )
        })
        .count();
    let passed_qa_runs = qa_runs
        .iter()
        .filter(|run| run.get("pass").and_then(Value::as_bool) == Some(true))
        .count();
    let failed_qa_runs = qa_runs.len().saturating_sub(passed_qa_runs);
    let qa_artifacts = qa_runs
        .iter()
        .map(|run| {
            let artifacts = run
                .get("artifacts")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            let screenshot = usize::from(
                run.get("screenshot_path")
                    .and_then(Value::as_str)
                    .is_some_and(|path| !path.trim().is_empty()),
            );
            artifacts + screenshot
        })
        .sum();

    let mut gaps = Vec::new();
    if !intent_captured {
        gaps.push("Original task intent was not captured.".to_string());
    }
    if !complete_review_coverage {
        gaps.push("Deterministic source-review coverage is incomplete.".to_string());
    }
    if high_risk_findings > 0 {
        gaps.push(format!(
            "{high_risk_findings} high-risk finding{} require disposition and executable re-check.",
            if high_risk_findings == 1 { "" } else { "s" }
        ));
    }
    if qa_runs.is_empty() {
        gaps.push("No synthetic user-flow evidence was recorded.".to_string());
    } else if failed_qa_runs > 0 {
        gaps.push(format!(
            "{failed_qa_runs} recorded synthetic QA run{} did not pass.",
            if failed_qa_runs == 1 { "" } else { "s" }
        ));
    }

    let (closure_status, closure_reason) = if !intent_captured {
        (
            "missing_intent",
            "Capture the original goal before judging whether the change satisfies it.",
        )
    } else if !complete_review_coverage || high_risk_findings > 0 || failed_qa_runs > 0 {
        (
            "evidence_conflict",
            "Recorded review or runtime evidence still conflicts with the stated intent.",
        )
    } else if qa_runs.is_empty() {
        (
            "insufficient_evidence",
            "Source review is complete, but no recorded user-flow evidence supports intent closure.",
        )
    } else {
        (
            "ready_for_human_disposition",
            "Recorded evidence is ready for an explicit human intent disposition.",
        )
    };

    ReviewIntentDiagnostic {
        schema_version: REVIEW_INTENT_DIAGNOSTIC_SCHEMA.into(),
        intent: IntentCapture {
            summary: if intent_captured {
                intent_summary.to_string()
            } else {
                "No explicit task intent captured".into()
            },
            status: if intent_captured {
                "captured"
            } else {
                "missing"
            }
            .into(),
            source: "operator_task".into(),
        },
        changed_surfaces: classify_changed_surfaces(changed_files),
        signals: IntentSignals {
            changed_paths: changed_files.len(),
            findings: findings.len(),
            high_risk_findings,
            qa_runs: qa_runs.len(),
            passed_qa_runs,
            failed_qa_runs,
            qa_artifacts,
            complete_review_coverage,
        },
        gaps,
        timeline: vec![
            IntentTimelineItem {
                id: "intent".into(),
                label: "Intent captured".into(),
                detail: if intent_captured {
                    intent_summary.to_string()
                } else {
                    "No explicit task goal was supplied.".into()
                },
                status: if intent_captured { "done" } else { "missing" }.into(),
            },
            IntentTimelineItem {
                id: "review".into(),
                label: "Source review".into(),
                detail: format!(
                    "{} findings across {} changed paths; {} high risk.",
                    findings.len(),
                    changed_files.len(),
                    high_risk_findings
                ),
                status: if complete_review_coverage && high_risk_findings == 0 {
                    "done"
                } else {
                    "warning"
                }
                .into(),
            },
            IntentTimelineItem {
                id: "synthetic_qa".into(),
                label: "Synthetic QA".into(),
                detail: if qa_runs.is_empty() {
                    "No recorded user-flow run.".into()
                } else {
                    format!(
                        "{} passed, {} failed, {} retained artifact references.",
                        passed_qa_runs, failed_qa_runs, qa_artifacts
                    )
                },
                status: if qa_runs.is_empty() {
                    "missing"
                } else if failed_qa_runs > 0 {
                    "warning"
                } else {
                    "done"
                }
                .into(),
            },
            IntentTimelineItem {
                id: "human_disposition".into(),
                label: "Intent disposition".into(),
                detail: "Requires an explicit human decision; CodeVetter does not infer closure."
                    .into(),
                status: "pending".into(),
            },
        ],
        closure: IntentClosure {
            status: closure_status.into(),
            reason: closure_reason.into(),
            requires_human_disposition: true,
        },
        limitations: vec![
            "Intent closure is never inferred from review or test output.".into(),
            "Legacy synthetic QA is recorded evidence and is not assumed revision-exact.".into(),
        ],
    }
}

fn classify_changed_surfaces(changed_files: &[String]) -> Vec<String> {
    let mut surfaces = BTreeSet::new();
    for path in changed_files {
        let path = path.to_ascii_lowercase();
        if path.contains("test") || path.contains("spec.") {
            surfaces.insert("tests".to_string());
        }
        if path.starts_with("docs/") || path.ends_with(".md") {
            surfaces.insert("documentation".to_string());
        }
        if path.ends_with(".tsx")
            || path.ends_with(".jsx")
            || path.ends_with(".css")
            || path.ends_with(".swift")
        {
            surfaces.insert("user_interface".to_string());
        }
        if path.ends_with(".rs")
            || path.ends_with(".ts")
            || path.ends_with(".js")
            || path.contains("src-tauri")
            || path.contains("commands/")
            || path.contains("/api/")
            || path.contains("server")
        {
            surfaces.insert("runtime".to_string());
        }
        if path.starts_with("scripts/") || path.starts_with(".github/") {
            surfaces.insert("automation".to_string());
        }
        if path.ends_with(".sql") || path.contains("migration") {
            surfaces.insert("data".to_string());
        }
    }
    if surfaces.is_empty() && !changed_files.is_empty() {
        surfaces.insert("other".to_string());
    }
    surfaces.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn failed_runtime_and_high_risk_review_block_intent_disposition() {
        let diagnostic = build_review_intent_diagnostic(
            "Preserve checkout totals",
            &["src/cart.ts".into(), "src/cart.test.ts".into()],
            &[json!({"severity": "high"})],
            &[json!({
                "pass": false,
                "artifacts": ["artifacts/trace.zip"],
                "screenshot_path": "artifacts/failure.png"
            })],
            true,
        );

        assert_eq!(diagnostic.schema_version, REVIEW_INTENT_DIAGNOSTIC_SCHEMA);
        assert_eq!(diagnostic.closure.status, "evidence_conflict");
        assert!(diagnostic.closure.requires_human_disposition);
        assert_eq!(diagnostic.signals.high_risk_findings, 1);
        assert_eq!(diagnostic.signals.failed_qa_runs, 1);
        assert_eq!(diagnostic.signals.qa_artifacts, 2);
        assert_eq!(diagnostic.changed_surfaces, vec!["runtime", "tests"]);
    }

    #[test]
    fn source_only_review_stays_insufficient_for_intent_closure() {
        let diagnostic = build_review_intent_diagnostic(
            "Keep settings readable",
            &["src/SettingsView.swift".into()],
            &[],
            &[],
            true,
        );

        assert_eq!(diagnostic.closure.status, "insufficient_evidence");
        assert_eq!(diagnostic.changed_surfaces, vec!["user_interface"]);
        assert!(diagnostic
            .gaps
            .iter()
            .any(|gap| gap.contains("No synthetic user-flow")));
    }

    #[test]
    fn passing_recorded_qa_only_makes_evidence_ready_for_human_disposition() {
        let diagnostic = build_review_intent_diagnostic(
            "Keep the checkout flow working",
            &["src/Checkout.tsx".into()],
            &[],
            &[json!({"pass": true, "artifacts": ["artifacts/checkout.png"]})],
            true,
        );

        assert_eq!(diagnostic.closure.status, "ready_for_human_disposition");
        assert!(diagnostic.closure.requires_human_disposition);
        assert!(diagnostic
            .limitations
            .iter()
            .any(|limitation| limitation.contains("not assumed revision-exact")));
    }
}
