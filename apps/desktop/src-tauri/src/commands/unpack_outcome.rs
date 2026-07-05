use crate::commands::unpack_types::{
    UnpackOutcomeEvidence, UnpackOutcomeFindingEvidence, UnpackOutcomeProcedureEvidence,
    UnpackOutcomeQaEvidence, UnpackOutcomeReviewEvidence, UnpackOutcomeTrend,
    UnpackOutcomeTrendWindow, UnpackOutcomeTrustAction,
};
use crate::db::queries;

pub(crate) fn build_unpack_outcome_evidence(
    conn: &rusqlite::Connection,
    repo_path: &str,
) -> Result<UnpackOutcomeEvidence, rusqlite::Error> {
    let review_rows = queries::list_local_reviews_filtered(conn, 16, 0, Some(repo_path))?;
    let qa_rows = queries::list_synthetic_qa_runs_for_repo(conn, repo_path, 16)?;
    let finding_rows = queries::get_recent_findings_for_repo(conn, repo_path, 16)?;

    let mut procedure_rows = Vec::new();
    for review in review_rows.iter().take(10) {
        let mut events = queries::list_review_procedure_events(conn, &review.id)?;
        procedure_rows.append(&mut events);
    }
    procedure_rows.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    procedure_rows.truncate(24);

    let failed_review_count = review_rows
        .iter()
        .filter(|review| outcome_status_is_failure(&review.status))
        .count();
    let qa_pass_count = qa_rows.iter().filter(|run| run.pass).count();
    let qa_fail_count = qa_rows.len().saturating_sub(qa_pass_count);
    let procedure_pass_count = procedure_rows
        .iter()
        .filter(|event| outcome_status_is_success(&event.status))
        .count();
    let procedure_fail_count = procedure_rows
        .iter()
        .filter(|event| outcome_status_is_failure(&event.status))
        .count();
    let (calibration, summary) = calibrate_outcome_evidence(
        qa_pass_count + procedure_pass_count,
        qa_fail_count + procedure_fail_count + failed_review_count,
        review_rows.len(),
        qa_rows.len(),
        procedure_rows.len(),
    );

    let reviews: Vec<UnpackOutcomeReviewEvidence> = review_rows
        .iter()
        .map(|review| UnpackOutcomeReviewEvidence {
            id: review.id.clone(),
            review_type: review.review_type.clone(),
            status: review.status.clone(),
            review_action: review.review_action.clone(),
            findings_count: review.findings_count,
            score_composite: review.score_composite,
            created_at: review.created_at.clone(),
        })
        .collect();
    let qa_runs: Vec<UnpackOutcomeQaEvidence> = qa_rows
        .iter()
        .map(|run| UnpackOutcomeQaEvidence {
            id: run.id.clone(),
            review_id: run.review_id.clone(),
            loop_id: run.loop_id.clone(),
            runner_type: run.runner_type.clone(),
            route: run.route.clone(),
            goal: run.goal.clone(),
            pass: run.pass,
            duration_ms: run.duration_ms,
            console_errors: run.console_errors,
            error: run.error.clone(),
            created_at: run.created_at.clone(),
        })
        .collect();
    let procedure_events: Vec<UnpackOutcomeProcedureEvidence> = procedure_rows
        .iter()
        .map(|event| UnpackOutcomeProcedureEvidence {
            id: event.id.clone(),
            review_id: event.review_id.clone(),
            step_id: event.step_id.clone(),
            status: event.status.clone(),
            source: event.source.clone(),
            summary: event.summary.clone(),
            artifact: event.artifact.clone(),
            created_at: event.created_at.clone(),
        })
        .collect();
    let recurring_findings: Vec<UnpackOutcomeFindingEvidence> = finding_rows
        .iter()
        .map(|finding| UnpackOutcomeFindingEvidence {
            file_path: finding.file_path.clone(),
            title: Some(finding.title.clone()),
            severity: finding.severity.clone(),
            created_at: finding.created_at.clone(),
        })
        .collect();
    let trend = outcome_trend(&reviews, &qa_runs, &procedure_events, &recurring_findings);
    let trust_actions = outcome_trust_actions(
        &reviews,
        &qa_runs,
        &procedure_events,
        &recurring_findings,
        &calibration,
        &trend,
    );

    Ok(UnpackOutcomeEvidence {
        repo_path: repo_path.to_string(),
        reviews,
        qa_runs,
        procedure_events,
        recurring_findings,
        review_count: review_rows.len(),
        failed_review_count,
        qa_pass_count,
        qa_fail_count,
        procedure_pass_count,
        procedure_fail_count,
        calibration,
        summary,
        trend,
        trust_actions,
    })
}

fn outcome_status_is_success(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "satisfied" | "passed" | "pass" | "completed" | "success" | "verified"
    )
}

fn outcome_status_is_failure(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "blocked" | "failed" | "fail" | "error" | "errored" | "timeout" | "cancelled"
    )
}

pub(crate) fn calibrate_outcome_evidence(
    pass_count: usize,
    fail_count: usize,
    review_count: usize,
    qa_count: usize,
    procedure_count: usize,
) -> (String, String) {
    if review_count == 0 && qa_count == 0 && procedure_count == 0 {
        return (
            "unknown".to_string(),
            "No stored review, QA, or procedure outcomes for this repo yet.".to_string(),
        );
    }

    if pass_count > 0 && fail_count > 0 {
        return (
            "mixed".to_string(),
            format!(
                "{pass_count} recent proof signal{} and {fail_count} recent failure signal{}.",
                plural_s(pass_count),
                plural_s(fail_count)
            ),
        );
    }

    if fail_count > 0 {
        return (
            "lowers".to_string(),
            format!(
                "{fail_count} recent failure signal{} should lower confidence until rechecked.",
                plural_s(fail_count)
            ),
        );
    }

    if pass_count > 0 {
        return (
            "raises".to_string(),
            format!(
                "{pass_count} recent proof signal{} supports higher confidence for this repo.",
                plural_s(pass_count)
            ),
        );
    }

    (
        "neutral".to_string(),
        "Stored reviews exist, but no pass/fail QA or procedure proof is attached yet.".to_string(),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutcomeTrendSignalKind {
    Proof,
    Failure,
    Finding,
    ReviewFailure,
}

#[derive(Debug, Clone)]
struct OutcomeTrendSignal {
    created_at: String,
    kind: OutcomeTrendSignalKind,
}

pub(crate) fn outcome_trend(
    reviews: &[UnpackOutcomeReviewEvidence],
    qa_runs: &[UnpackOutcomeQaEvidence],
    procedure_events: &[UnpackOutcomeProcedureEvidence],
    recurring_findings: &[UnpackOutcomeFindingEvidence],
) -> UnpackOutcomeTrend {
    let mut signals = Vec::new();

    for run in qa_runs {
        signals.push(OutcomeTrendSignal {
            created_at: run.created_at.clone(),
            kind: if run.pass {
                OutcomeTrendSignalKind::Proof
            } else {
                OutcomeTrendSignalKind::Failure
            },
        });
    }

    for event in procedure_events {
        if outcome_status_is_success(&event.status) {
            signals.push(OutcomeTrendSignal {
                created_at: event.created_at.clone(),
                kind: OutcomeTrendSignalKind::Proof,
            });
        } else if outcome_status_is_failure(&event.status) {
            signals.push(OutcomeTrendSignal {
                created_at: event.created_at.clone(),
                kind: OutcomeTrendSignalKind::Failure,
            });
        }
    }

    for review in reviews {
        if outcome_status_is_failure(&review.status) {
            signals.push(OutcomeTrendSignal {
                created_at: review.created_at.clone(),
                kind: OutcomeTrendSignalKind::ReviewFailure,
            });
        }
    }

    for finding in recurring_findings {
        signals.push(OutcomeTrendSignal {
            created_at: finding.created_at.clone(),
            kind: OutcomeTrendSignalKind::Finding,
        });
    }

    signals.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let split_at = signals.len().div_ceil(2);
    let recent = outcome_trend_window("recent", &signals[..split_at]);
    let prior = outcome_trend_window("prior", &signals[split_at..]);
    let total_signals = signals.len();
    let confidence = if total_signals >= 10 {
        "high"
    } else if total_signals >= 5 {
        "medium"
    } else {
        "low"
    };
    let direction = outcome_trend_direction(&recent, &prior, total_signals);
    let summary = outcome_trend_summary(&direction, confidence, &recent, &prior, total_signals);

    UnpackOutcomeTrend {
        direction,
        confidence: confidence.to_string(),
        total_signals,
        recent,
        prior,
        summary,
    }
}

fn outcome_trend_window(label: &str, signals: &[OutcomeTrendSignal]) -> UnpackOutcomeTrendWindow {
    let proof_count = signals
        .iter()
        .filter(|signal| signal.kind == OutcomeTrendSignalKind::Proof)
        .count();
    let failure_count = signals
        .iter()
        .filter(|signal| signal.kind == OutcomeTrendSignalKind::Failure)
        .count();
    let finding_count = signals
        .iter()
        .filter(|signal| signal.kind == OutcomeTrendSignalKind::Finding)
        .count();
    let review_failure_count = signals
        .iter()
        .filter(|signal| signal.kind == OutcomeTrendSignalKind::ReviewFailure)
        .count();
    UnpackOutcomeTrendWindow {
        label: label.to_string(),
        proof_count,
        failure_count,
        finding_count,
        review_failure_count,
        oldest_at: signals.last().map(|signal| signal.created_at.clone()),
        newest_at: signals.first().map(|signal| signal.created_at.clone()),
    }
}

fn outcome_trend_risk_count(window: &UnpackOutcomeTrendWindow) -> usize {
    window.failure_count + window.finding_count + window.review_failure_count
}

fn outcome_trend_signal_count(window: &UnpackOutcomeTrendWindow) -> usize {
    window.proof_count + outcome_trend_risk_count(window)
}

fn outcome_trend_risk_rate(window: &UnpackOutcomeTrendWindow) -> f64 {
    let total = outcome_trend_signal_count(window);
    if total == 0 {
        0.0
    } else {
        outcome_trend_risk_count(window) as f64 / total as f64
    }
}

fn outcome_trend_direction(
    recent: &UnpackOutcomeTrendWindow,
    prior: &UnpackOutcomeTrendWindow,
    total_signals: usize,
) -> String {
    if total_signals < 3 {
        return "sparse".to_string();
    }

    let recent_risk = outcome_trend_risk_count(recent);
    let prior_risk = outcome_trend_risk_count(prior);
    let recent_rate = outcome_trend_risk_rate(recent);
    let prior_rate = outcome_trend_risk_rate(prior);

    if recent_risk > 0 && prior_risk == 0 && recent_rate >= 0.5 {
        return "regressing".to_string();
    }
    if recent_risk == 0 && prior_risk > 0 && recent.proof_count > 0 {
        return "improving".to_string();
    }
    if recent_rate > prior_rate + 0.25 {
        return "regressing".to_string();
    }
    if prior_rate > recent_rate + 0.25 {
        return "improving".to_string();
    }
    if recent_risk == 0 && prior_risk == 0 && recent.proof_count + prior.proof_count > 0 {
        return "stable_green".to_string();
    }
    if recent_risk > 0 && prior_risk > 0 {
        return "persistent_risk".to_string();
    }

    "flat".to_string()
}

fn outcome_trend_summary(
    direction: &str,
    confidence: &str,
    recent: &UnpackOutcomeTrendWindow,
    prior: &UnpackOutcomeTrendWindow,
    total_signals: usize,
) -> String {
    if direction == "sparse" {
        return format!(
            "{total_signals} stored outcome signal{} is too sparse for a trend.",
            plural_s(total_signals)
        );
    }

    let recent_risk = outcome_trend_risk_count(recent);
    let prior_risk = outcome_trend_risk_count(prior);
    format!(
        "{confidence} confidence {direction} trend: recent window has {} proof / {} risk signal{}, prior window had {} proof / {} risk signal{}.",
        recent.proof_count,
        recent_risk,
        plural_s(recent_risk),
        prior.proof_count,
        prior_risk,
        plural_s(prior_risk)
    )
}

pub(crate) fn outcome_trust_actions(
    reviews: &[UnpackOutcomeReviewEvidence],
    qa_runs: &[UnpackOutcomeQaEvidence],
    procedure_events: &[UnpackOutcomeProcedureEvidence],
    recurring_findings: &[UnpackOutcomeFindingEvidence],
    calibration: &str,
    trend: &UnpackOutcomeTrend,
) -> Vec<UnpackOutcomeTrustAction> {
    let mut actions = Vec::new();

    if reviews.is_empty() && qa_runs.is_empty() && procedure_events.is_empty() {
        actions.push(UnpackOutcomeTrustAction {
            priority: "high".to_string(),
            label: "Establish a proof baseline".to_string(),
            detail: "No local review, QA, or proof-gate outcomes are attached to this repo yet."
                .to_string(),
            source_kind: "baseline".to_string(),
            source_id: None,
            source_path: None,
            command: Some("Run a review and attach a synthetic QA flow for this repo".to_string()),
        });
    }

    for run in qa_runs.iter().filter(|run| !run.pass).take(2) {
        let target = run
            .goal
            .as_deref()
            .or(run.route.as_deref())
            .unwrap_or(&run.loop_id);
        let mut detail = format!(
            "{target} failed via {} on {}; rerun after the changed area is fixed.",
            run.runner_type, run.created_at
        );
        if run.console_errors > 0 {
            detail.push_str(&format!(
                " {} console error(s) were recorded.",
                run.console_errors
            ));
        }
        if let Some(error) = run
            .error
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            detail.push_str(&format!(" Error: {error}"));
        }
        actions.push(UnpackOutcomeTrustAction {
            priority: "high".to_string(),
            label: "Rerun failing QA flow".to_string(),
            detail,
            source_kind: "qa_run".to_string(),
            source_id: Some(run.id.clone()),
            source_path: None,
            command: Some(format!("Rerun Synthetic QA: {target}")),
        });
    }

    for event in procedure_events
        .iter()
        .filter(|event| outcome_status_is_failure(&event.status))
        .take(2)
    {
        actions.push(UnpackOutcomeTrustAction {
            priority: "high".to_string(),
            label: "Resolve failed proof gate".to_string(),
            detail: format!(
                "{} is {} from {}: {}",
                event.step_id, event.status, event.source, event.summary
            ),
            source_kind: "procedure_event".to_string(),
            source_id: Some(event.id.clone()),
            source_path: event.artifact.clone(),
            command: Some(format!("Re-run proof gate: {}", event.step_id)),
        });
    }

    for review in reviews
        .iter()
        .filter(|review| outcome_status_is_failure(&review.status))
        .take(1)
    {
        actions.push(UnpackOutcomeTrustAction {
            priority: "high".to_string(),
            label: "Re-check blocked review".to_string(),
            detail: format!(
                "{} review is {}; findings: {}.",
                review.review_type.as_deref().unwrap_or("Local"),
                review.status,
                review
                    .findings_count
                    .map(|count| count.to_string())
                    .unwrap_or_else(|| "unknown".to_string())
            ),
            source_kind: "review".to_string(),
            source_id: Some(review.id.clone()),
            source_path: None,
            command: review
                .review_action
                .as_ref()
                .map(|action| format!("Follow review action: {action}")),
        });
    }

    for finding in recurring_findings.iter().take(2) {
        let title = finding.title.as_deref().unwrap_or("review finding");
        actions.push(UnpackOutcomeTrustAction {
            priority: "medium".to_string(),
            label: "Inspect recurring finding".to_string(),
            detail: format!(
                "{}{} was seen on {}; compare it against the current delta.",
                finding
                    .severity
                    .as_deref()
                    .map(|severity| format!("{severity} severity "))
                    .unwrap_or_default(),
                title,
                finding.created_at
            ),
            source_kind: "finding".to_string(),
            source_id: None,
            source_path: finding.file_path.clone(),
            command: None,
        });
    }

    if calibration == "mixed" {
        actions.push(UnpackOutcomeTrustAction {
            priority: "medium".to_string(),
            label: "Require fresh proof for this delta".to_string(),
            detail: "Recent local outcomes are mixed, so old green evidence should not override new failures."
                .to_string(),
            source_kind: "calibration".to_string(),
            source_id: None,
            source_path: None,
            command: Some("Run the highest-confidence verification lead before release".to_string()),
        });
    } else if calibration == "raises" && actions.is_empty() {
        actions.push(UnpackOutcomeTrustAction {
            priority: "low".to_string(),
            label: "Keep proof attached".to_string(),
            detail:
                "Recent proof signals are green; attach the latest QA/procedure rows to the handoff."
                    .to_string(),
            source_kind: "calibration".to_string(),
            source_id: None,
            source_path: None,
            command: None,
        });
    }

    if trend.direction == "regressing" {
        actions.push(UnpackOutcomeTrustAction {
            priority: "high".to_string(),
            label: "Investigate worsening outcome trend".to_string(),
            detail: trend.summary.clone(),
            source_kind: "trend".to_string(),
            source_id: None,
            source_path: None,
            command: Some("Compare recent failures against the current unpack delta".to_string()),
        });
    } else if trend.direction == "persistent_risk" {
        actions.push(UnpackOutcomeTrustAction {
            priority: "medium".to_string(),
            label: "Break persistent failure loop".to_string(),
            detail: trend.summary.clone(),
            source_kind: "trend".to_string(),
            source_id: None,
            source_path: None,
            command: Some("Require a fresh green QA/proof gate before release".to_string()),
        });
    } else if trend.direction == "improving" && actions.is_empty() {
        actions.push(UnpackOutcomeTrustAction {
            priority: "low".to_string(),
            label: "Preserve improving proof trail".to_string(),
            detail: trend.summary.clone(),
            source_kind: "trend".to_string(),
            source_id: None,
            source_path: None,
            command: None,
        });
    }

    actions.truncate(6);
    actions
}

fn plural_s(count: usize) -> &'static str {
    if count == 1 {
        ""
    } else {
        "s"
    }
}
