//! One local, execution-backed assessment for an exact pull request or Git range.
//!
//! The runner composes the existing review and runtime engines. It does not
//! install dependencies, edit source, or mutate the selected checkout.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::process::Command;

use crate::{db, DbState};

use super::evidence_scope::{
    resolve_evidence_scope, EvidenceScopeCandidate, EvidenceScopeConsumer, EvidenceScopeInput,
    EvidenceScopeKind, EvidenceScopePlan,
};
use super::review::run_cli_review_core;
use super::spec_coverage::{
    compose_spec_coverage, load_spec_packet, validate_selected_requirements, SpecCoverageReceipt,
    SpecEvidenceReference, SpecExecutionOutcome,
};
use super::trex_preview::{resolve_scope_change, TrexSourceReceipt};

const MAX_RUNTIME_OUTPUT_BYTES: usize = 512 * 1024;
const RUNTIME_DEADLINE: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalCheckStatus {
    Passed,
    Completed,
    Ready,
    NeedsAttention,
    Failed,
    NoConfidence,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalCheckVerdict {
    PassedWithLimits,
    NeedsAttention,
    Failed,
    NoConfidence,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalCheckTarget {
    pub adapter: String,
    pub target: String,
    pub name: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCheckStage {
    pub status: LocalCheckStatus,
    pub duration_ms: u64,
    pub target: Option<LocalCheckTarget>,
    pub evidence: Value,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCheckStages {
    pub review: LocalCheckStage,
    pub correctness: LocalCheckStage,
    pub performance: LocalCheckStage,
    pub optimization: LocalCheckStage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCheckReceipt {
    pub schema_version: String,
    pub run_id: String,
    pub ran_at: String,
    pub repo_path: String,
    pub task: String,
    pub source: TrexSourceReceipt,
    pub stages: LocalCheckStages,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_coverage: Option<SpecCoverageReceipt>,
    pub verdict: LocalCheckVerdict,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCheckPreflightReceipt {
    pub schema_version: String,
    pub ran_at: String,
    pub repo_path: String,
    pub task: String,
    pub source: TrexSourceReceipt,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_coverage: Option<SpecCoverageReceipt>,
    pub correctness_target: Option<LocalCheckTarget>,
    pub performance_target: Option<LocalCheckTarget>,
    pub status: LocalCheckStatus,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalCheckProgress {
    pub stage: &'static str,
    pub state: &'static str,
}

#[derive(Debug, Clone)]
pub struct LocalCheckInput {
    pub repo_path: PathBuf,
    pub change: String,
    pub task: String,
    pub spec_paths: Vec<PathBuf>,
    pub selected_requirement_ids: Vec<String>,
    pub review_agent: String,
    pub test_target: Option<LocalCheckTarget>,
    pub performance_target: Option<LocalCheckTarget>,
    pub baseline_repo_path: Option<PathBuf>,
    pub samples: u8,
    pub warmups: u8,
    pub timeout_ms: u64,
}

pub async fn run_local_check(input: LocalCheckInput) -> Result<LocalCheckReceipt, String> {
    run_local_check_with_progress(input, |_| {}).await
}

pub async fn run_local_check_with_progress<F>(
    input: LocalCheckInput,
    mut on_progress: F,
) -> Result<LocalCheckReceipt, String>
where
    F: FnMut(LocalCheckProgress),
{
    on_progress(LocalCheckProgress {
        stage: "preflight",
        state: "running",
    });
    let prepared = prepare_local_check(&input).await?;
    on_progress(LocalCheckProgress {
        stage: "preflight",
        state: "completed",
    });
    let PreparedLocalCheck {
        repo_path,
        repo_text,
        source,
        spec_packet,
        test_plan,
        performance_plan,
        correctness_target,
        performance_target,
        performance_selection_limitation,
    } = prepared;
    let diff_range = format!("{}...{}", source.base_sha, source.head_sha);
    let review_task = compose_review_task(&input.task, spec_packet.as_ref());
    let app_data_dir = default_app_data_dir()?;
    let connection =
        db::init_db(app_data_dir).map_err(|error| format!("open CodeVetter database: {error}"))?;
    let db = DbState(std::sync::Arc::new(std::sync::Mutex::new(connection)));

    on_progress(LocalCheckProgress {
        stage: "correctness",
        state: "running",
    });
    let correctness = run_runtime_stage(
        &repo_path,
        "run",
        correctness_target.clone(),
        input.samples,
        input.warmups,
        input.timeout_ms,
        None,
        test_plan.err(),
    )
    .await;
    on_progress(progress_for_stage("correctness", &correctness));
    let baseline = input
        .baseline_repo_path
        .as_ref()
        .map(|path| canonical_clean_repository(path))
        .transpose()?;
    let performance_operation = if baseline.is_some() {
        "verify-paired-optimization"
    } else {
        "diagnose-performance"
    };
    on_progress(LocalCheckProgress {
        stage: "performance",
        state: if performance_target.is_some() {
            "running"
        } else {
            "skipped"
        },
    });
    let performance = run_runtime_stage(
        &repo_path,
        performance_operation,
        performance_target.clone(),
        input.samples,
        input.warmups,
        input.timeout_ms,
        baseline.as_deref(),
        performance_plan.err().or(performance_selection_limitation),
    )
    .await;
    on_progress(progress_for_stage("performance", &performance));
    let review_runtime_context = vec![
        runtime_stage_review_context("correctness", &correctness),
        runtime_stage_review_context("performance", &performance),
    ];
    on_progress(LocalCheckProgress {
        stage: "review",
        state: "running",
    });
    let review = run_review_stage(
        db,
        &repo_text,
        &diff_range,
        &review_task,
        &input.review_agent,
        review_runtime_context,
    )
    .await;
    on_progress(progress_for_stage("review", &review));
    let optimization = optimization_stage(
        &repo_path,
        &source.base_sha,
        &input.task,
        &input.review_agent,
        correctness_target.as_ref(),
        performance_target,
        baseline.as_deref(),
        &performance,
        input.samples,
        input.warmups,
        input.timeout_ms,
        &input.spec_paths,
        &input.selected_requirement_ids,
    );
    let stages = LocalCheckStages {
        review,
        correctness,
        performance,
        optimization,
    };
    let spec_coverage = spec_packet.map(|packet| {
        let review_completed = matches!(
            stages.review.status,
            LocalCheckStatus::Completed | LocalCheckStatus::NeedsAttention
        );
        let execution = match stages.correctness.status {
            LocalCheckStatus::Passed => SpecExecutionOutcome::Passed,
            LocalCheckStatus::Failed => SpecExecutionOutcome::Failed,
            _ => SpecExecutionOutcome::Unavailable,
        };
        compose_spec_coverage(
            packet,
            &input.selected_requirement_ids,
            &source.head_sha,
            review_completed,
            execution,
            correctness_spec_evidence(&stages.correctness),
        )
    });
    let verdict = apply_spec_confidence(aggregate_verdict(&stages), spec_coverage.as_ref());
    let limitations = collect_limitations(&stages);

    on_progress(LocalCheckProgress {
        stage: "done",
        state: verdict_name(verdict),
    });
    Ok(LocalCheckReceipt {
        schema_version: "codevetter.local-check/v1".into(),
        run_id: format!("local-check-{}", uuid::Uuid::new_v4()),
        ran_at: chrono::Utc::now().to_rfc3339(),
        repo_path: repo_text,
        task: input.task,
        source,
        stages,
        spec_coverage,
        verdict,
        limitations,
    })
}

pub async fn preflight_local_check(
    input: &LocalCheckInput,
) -> Result<LocalCheckPreflightReceipt, String> {
    let prepared = prepare_local_check(input).await?;
    let PreparedLocalCheck {
        repo_text,
        source,
        spec_packet,
        test_plan,
        performance_plan,
        correctness_target,
        performance_target,
        performance_selection_limitation,
        ..
    } = prepared;
    let spec_coverage = spec_packet.map(|packet| {
        compose_spec_coverage(
            packet,
            &input.selected_requirement_ids,
            &source.head_sha,
            false,
            SpecExecutionOutcome::Unavailable,
            None,
        )
    });
    let mut limitations = Vec::new();
    if correctness_target.is_none() {
        limitations.push(
            test_plan
                .err()
                .unwrap_or_else(|| "No defensible correctness target matched this change".into()),
        );
    }
    if performance_target.is_none() {
        limitations.push(
            performance_plan
                .err()
                .or(performance_selection_limitation)
                .unwrap_or_else(|| {
                    "No dedicated performance workload matched; use explicit --perf-adapter and --perf-target to opt in"
                        .into()
                }),
        );
    }
    if let Some(summary) = spec_coverage.as_ref().map(|coverage| &coverage.summary) {
        if summary.total_requirements == 0 {
            limitations.push(
                "Supplied specs contain no explicit `### Requirement:` sections; review was not started"
                    .into(),
            );
        } else if summary.selected_for_execution == 0 {
            limitations.push(
                "No extracted requirement is bound to correctness; select at least one --requirement before review"
                    .into(),
            );
        }
    }
    let status = if correctness_target.is_some()
        && spec_coverage.as_ref().is_none_or(|coverage| {
            coverage.summary.total_requirements > 0 && coverage.summary.selected_for_execution > 0
        }) {
        LocalCheckStatus::Ready
    } else {
        LocalCheckStatus::NoConfidence
    };

    Ok(LocalCheckPreflightReceipt {
        schema_version: "codevetter.local-check-preflight/v1".into(),
        ran_at: chrono::Utc::now().to_rfc3339(),
        repo_path: repo_text,
        task: input.task.clone(),
        source,
        spec_coverage,
        correctness_target,
        performance_target,
        status,
        limitations,
    })
}

#[derive(Debug)]
struct PreparedLocalCheck {
    repo_path: PathBuf,
    repo_text: String,
    source: TrexSourceReceipt,
    spec_packet: Option<super::spec_coverage::SpecPacket>,
    test_plan: Result<EvidenceScopePlan, String>,
    performance_plan: Result<EvidenceScopePlan, String>,
    correctness_target: Option<LocalCheckTarget>,
    performance_target: Option<LocalCheckTarget>,
    performance_selection_limitation: Option<String>,
}

async fn prepare_local_check(input: &LocalCheckInput) -> Result<PreparedLocalCheck, String> {
    validate_input(input)?;
    let repo_path = canonical_clean_repository(&input.repo_path)?;
    if let Some(baseline) = input.baseline_repo_path.as_ref() {
        canonical_clean_repository(baseline)?;
    }
    let repo_text = repo_path.to_string_lossy().into_owned();
    let source = resolve_scope_change(&repo_text, &input.change).await?;
    require_checked_out_head(&repo_path, &source.head_sha)?;
    let spec_packet = load_spec_packet(&repo_path, &input.spec_paths)?;
    validate_selected_requirements(spec_packet.as_ref(), &input.selected_requirement_ids)?;
    let test_plan = discover_plan(&repo_text, &input.change, EvidenceScopeConsumer::Testing).await;
    let performance_plan = discover_plan(
        &repo_text,
        &input.change,
        EvidenceScopeConsumer::Performance,
    )
    .await;
    let correctness_target = select_target(input.test_target.clone(), test_plan.as_ref().ok());
    let (performance_target, performance_selection_limitation) = select_performance_target(
        input.performance_target.clone(),
        performance_plan.as_ref().ok(),
    );

    Ok(PreparedLocalCheck {
        repo_path,
        repo_text,
        source,
        spec_packet,
        test_plan,
        performance_plan,
        correctness_target,
        performance_target,
        performance_selection_limitation,
    })
}

fn apply_spec_confidence(
    verdict: LocalCheckVerdict,
    coverage: Option<&SpecCoverageReceipt>,
) -> LocalCheckVerdict {
    if verdict != LocalCheckVerdict::PassedWithLimits {
        return verdict;
    }
    let Some(summary) = coverage.map(|value| &value.summary) else {
        return verdict;
    };
    if summary.total_requirements == 0
        || summary.selected_for_execution == 0
        || summary.verified + summary.contradicted < summary.selected_for_execution
    {
        LocalCheckVerdict::NoConfidence
    } else {
        verdict
    }
}

fn validate_input(input: &LocalCheckInput) -> Result<(), String> {
    if input.task.trim().is_empty() || input.task.len() > 2_000 {
        return Err("Task must contain between 1 and 2,000 characters".into());
    }
    if !matches!(input.review_agent.as_str(), "claude" | "gemini" | "codex") {
        return Err("Review agent must be `claude`, `gemini`, or `codex`".into());
    }
    if !(2..=10).contains(&input.samples) {
        return Err("Performance samples must be between 2 and 10".into());
    }
    if input.warmups > 5 {
        return Err("Performance warmups must be between 0 and 5".into());
    }
    if !(100..=120_000).contains(&input.timeout_ms) {
        return Err("Runtime timeout must be between 100 and 120,000 milliseconds".into());
    }
    if input.spec_paths.is_empty() && !input.selected_requirement_ids.is_empty() {
        return Err("Selected requirements require at least one spec path".into());
    }
    if let Some(target) = input.test_target.as_ref() {
        validate_target(target, false)?;
    }
    if let Some(target) = input.performance_target.as_ref() {
        validate_target(target, true)?;
    }
    Ok(())
}

fn correctness_spec_evidence(stage: &LocalCheckStage) -> Option<SpecEvidenceReference> {
    if !matches!(
        stage.status,
        LocalCheckStatus::Passed | LocalCheckStatus::Failed
    ) {
        return None;
    }
    let target = stage.target.as_ref();
    Some(SpecEvidenceReference {
        stage: "correctness".into(),
        status: match stage.status {
            LocalCheckStatus::Passed => "passed",
            LocalCheckStatus::Failed => "failed",
            _ => unreachable!(),
        }
        .into(),
        adapter: target.map(|value| value.adapter.clone()),
        target: target.map(|value| value.target.clone()),
        source: target.map(|value| value.source.clone()),
    })
}

fn compose_review_task(task: &str, packet: Option<&super::spec_coverage::SpecPacket>) -> String {
    packet
        .filter(|packet| !packet.review_context.is_empty())
        .map(|packet| format!("{task}\n\n{}", packet.review_context))
        .unwrap_or_else(|| task.to_string())
}

fn validate_target(target: &LocalCheckTarget, performance: bool) -> Result<(), String> {
    let path = Path::new(&target.target);
    if target.target.trim().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err("Runtime target must be a contained repository-relative path".into());
    }
    let supported: &[&str] = if performance {
        &[
            "node-test",
            "node-script",
            "vitest",
            "playwright",
            "go-bench",
        ]
    } else {
        &["node-test", "vitest", "playwright", "go-test"]
    };
    if !supported.contains(&target.adapter.as_str()) {
        return Err(format!(
            "Unsupported {} adapter `{}`",
            if performance {
                "performance"
            } else {
                "testing"
            },
            target.adapter
        ));
    }
    Ok(())
}

fn canonical_clean_repository(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("repository {} is unavailable: {error}", path.display()))?;
    if !canonical.is_dir() || !canonical.join(".git").exists() {
        return Err("Local check requires a Git repository root".into());
    }
    let dirty = git_text(
        &canonical,
        &["status", "--porcelain=v1", "--untracked-files=normal"],
    )?;
    if !dirty.is_empty() {
        return Err(
            "Local check requires a clean checkout so evidence maps to one immutable source".into(),
        );
    }
    Ok(canonical)
}

fn require_checked_out_head(repo: &Path, expected: &str) -> Result<(), String> {
    let head = git_text(repo, &["rev-parse", "HEAD"])?;
    if head != expected {
        return Err(format!(
            "Resolved change head {} is not checked out (current HEAD is {}); use a clean local checkout of the PR head",
            short_sha(expected),
            short_sha(&head)
        ));
    }
    Ok(())
}

fn git_text(repo: &Path, arguments: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(arguments)
        .current_dir(repo)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Git could not inspect the local checkout: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    String::from_utf8(output.stdout)
        .map(|value| value.trim().to_string())
        .map_err(|_| "Git returned non-UTF-8 checkout evidence".into())
}

async fn run_review_stage(
    db: DbState,
    repo_path: &str,
    diff_range: &str,
    task: &str,
    agent: &str,
    runtime_context: Vec<Value>,
) -> LocalCheckStage {
    let started = Instant::now();
    match run_cli_review_core(
        db,
        repo_path.to_string(),
        diff_range.to_string(),
        "Local repository change".into(),
        task.to_string(),
        Some(agent.to_string()),
        Some(runtime_context),
        None,
    )
    .await
    {
        Ok(evidence) => {
            let readiness_complete = evidence
                .get("review_readiness")
                .and_then(|value| value.get("status"))
                .and_then(Value::as_str)
                == Some("ready")
                && evidence.get("review_status").and_then(Value::as_str) == Some("completed");
            let actionable = evidence
                .get("findings")
                .and_then(Value::as_array)
                .is_some_and(|findings| {
                    findings.iter().any(|finding| {
                        matches!(
                            finding.get("severity").and_then(Value::as_str),
                            Some("critical" | "high")
                        )
                    })
                });
            let limitations = if readiness_complete {
                Vec::new()
            } else {
                evidence
                    .get("review_readiness")
                    .and_then(|value| value.get("limitations"))
                    .and_then(Value::as_array)
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(Value::as_str)
                            .map(ToOwned::to_owned)
                            .collect::<Vec<_>>()
                    })
                    .filter(|values| !values.is_empty())
                    .unwrap_or_else(|| {
                        vec!["Review context or execution coverage was incomplete".to_string()]
                    })
            };
            LocalCheckStage {
                status: if !readiness_complete {
                    LocalCheckStatus::NoConfidence
                } else if actionable {
                    LocalCheckStatus::NeedsAttention
                } else {
                    LocalCheckStatus::Completed
                },
                duration_ms: elapsed_ms(started),
                target: None,
                evidence,
                limitations,
            }
        }
        Err(error) => no_confidence_stage(started, None, error),
    }
}

fn runtime_stage_review_context(kind: &str, stage: &LocalCheckStage) -> Value {
    let evidence_status = match stage.status {
        LocalCheckStatus::Passed => "pass",
        LocalCheckStatus::Failed => "fail",
        LocalCheckStatus::Completed => "completed",
        LocalCheckStatus::Ready => "ready",
        LocalCheckStatus::NeedsAttention => "needs_attention",
        LocalCheckStatus::NoConfidence => "no_confidence",
    };
    let adapter = stage
        .target
        .as_ref()
        .map(|target| target.adapter.as_str())
        .unwrap_or("unavailable");
    let raw_notes = if stage.limitations.is_empty() {
        serde_json::to_string(&stage.evidence).unwrap_or_else(|_| "Evidence unavailable".into())
    } else {
        stage.limitations.join("; ")
    };
    let notes = raw_notes.chars().take(1_000).collect::<String>();
    json!({
        "loop_id": format!("local-check-{kind}"),
        "runner_type": adapter,
        "goal": format!("Local-check {kind} evidence for the exact reviewed change"),
        "pass": matches!(stage.status, LocalCheckStatus::Passed),
        "evidence_status": evidence_status,
        "duration_ms": stage.duration_ms,
        "notes": notes,
        "artifacts": [],
    })
}

async fn discover_plan(
    repo_path: &str,
    change: &str,
    consumer: EvidenceScopeConsumer,
) -> Result<EvidenceScopePlan, String> {
    resolve_evidence_scope(EvidenceScopeInput {
        repo_path: repo_path.to_string(),
        kind: EvidenceScopeKind::Change,
        value: Some(change.to_string()),
        consumer,
    })
    .await
}

fn select_target(
    explicit: Option<LocalCheckTarget>,
    plan: Option<&EvidenceScopePlan>,
) -> Option<LocalCheckTarget> {
    explicit.or_else(|| plan?.candidates.first().map(candidate_target))
}

fn select_performance_target(
    explicit: Option<LocalCheckTarget>,
    plan: Option<&EvidenceScopePlan>,
) -> (Option<LocalCheckTarget>, Option<String>) {
    if let Some(target) = explicit {
        return (Some(target), None);
    }
    let Some(plan) = plan else {
        return (None, None);
    };
    if let Some(candidate) = plan
        .candidates
        .iter()
        .find(|candidate| dedicated_performance_candidate(candidate))
    {
        return (Some(candidate_target(candidate)), None);
    }
    (
        None,
        Some(
            "Discovery found no dedicated performance workload; generic tests require explicit --perf-adapter and --perf-target selection"
                .into(),
        ),
    )
}

fn dedicated_performance_candidate(candidate: &EvidenceScopeCandidate) -> bool {
    if candidate.adapter == "go-bench" || candidate.name.is_some() {
        return true;
    }
    candidate
        .target
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|token| {
            matches!(
                token.to_ascii_lowercase().as_str(),
                "bench" | "benchmark" | "benchmarks" | "perf" | "performance" | "load"
            )
        })
}

fn candidate_target(candidate: &EvidenceScopeCandidate) -> LocalCheckTarget {
    LocalCheckTarget {
        adapter: candidate.adapter.clone(),
        target: candidate.target.clone(),
        name: candidate.name.clone(),
        source: format!("discovered:{}", candidate.id),
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_runtime_stage(
    repo_path: &Path,
    operation: &str,
    target: Option<LocalCheckTarget>,
    samples: u8,
    warmups: u8,
    timeout_ms: u64,
    baseline_repo: Option<&Path>,
    discovery_error: Option<String>,
) -> LocalCheckStage {
    let started = Instant::now();
    let Some(target) = target else {
        return no_confidence_stage(
            started,
            None,
            discovery_error
                .unwrap_or_else(|| "No defensible runnable target matched this change".into()),
        );
    };
    match run_runtime(
        repo_path,
        operation,
        &target,
        samples,
        warmups,
        timeout_ms,
        baseline_repo,
    )
    .await
    {
        Ok(evidence) => {
            let status = runtime_stage_status(operation, &evidence);
            LocalCheckStage {
                status,
                duration_ms: elapsed_ms(started),
                target: Some(target),
                limitations: if operation == "run" && status == LocalCheckStatus::Passed {
                    Vec::new()
                } else {
                    evidence_limitations(&evidence)
                },
                evidence,
            }
        }
        Err(error) => no_confidence_stage(started, Some(target), error),
    }
}

fn runtime_stage_status(operation: &str, evidence: &Value) -> LocalCheckStatus {
    if operation == "run" {
        return match evidence
            .get("terminal")
            .and_then(|value| value.get("exit_code"))
            .and_then(Value::as_i64)
        {
            Some(0) => LocalCheckStatus::Passed,
            Some(_) => LocalCheckStatus::Failed,
            None => LocalCheckStatus::NoConfidence,
        };
    }
    match evidence
        .get("verdict")
        .and_then(|value| value.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("no_confidence")
    {
        "failed" | "regressed" | "rejected" => LocalCheckStatus::Failed,
        "captured" | "confirmed" | "passed" => LocalCheckStatus::Passed,
        "no_confidence" | "inconclusive" | "blocked" => LocalCheckStatus::NoConfidence,
        _ => LocalCheckStatus::Completed,
    }
}

fn evidence_limitations(evidence: &Value) -> Vec<String> {
    evidence
        .get("limitations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .take(12)
        .collect()
}

async fn run_runtime(
    repo_path: &Path,
    operation: &str,
    target: &LocalCheckTarget,
    samples: u8,
    warmups: u8,
    timeout_ms: u64,
    baseline_repo: Option<&Path>,
) -> Result<Value, String> {
    let cli = resolve_runtime_cli()?;
    let mut arguments = vec![
        cli.to_string_lossy().into_owned(),
        operation.into(),
        "--repo".into(),
        repo_path.to_string_lossy().into_owned(),
        "--adapter".into(),
        target.adapter.clone(),
        "--target".into(),
        target.target.clone(),
    ];
    if let Some(name) = target.name.as_ref() {
        arguments.extend(["--name".into(), name.clone()]);
    }
    arguments.extend(["--timeout-ms".into(), timeout_ms.to_string()]);
    if operation != "run" {
        arguments.extend([
            "--samples".into(),
            samples.to_string(),
            "--warmups".into(),
            warmups.to_string(),
        ]);
    }
    if let Some(baseline) = baseline_repo {
        arguments.extend([
            "--baseline-repo".into(),
            baseline.to_string_lossy().into_owned(),
        ]);
    }
    arguments.push("--json".into());

    let mut command = Command::new("node");
    command
        .args(arguments)
        .current_dir(repo_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env_clear();
    for name in ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "USER"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command.env("CI", "1");
    let output = tokio::time::timeout(RUNTIME_DEADLINE, command.output())
        .await
        .map_err(|_| "Local runtime exceeded the 10 minute orchestration deadline".to_string())?
        .map_err(|error| format!("Could not start the local runtime: {error}"))?;
    if output.stdout.len() > MAX_RUNTIME_OUTPUT_BYTES
        || output.stderr.len() > MAX_RUNTIME_OUTPUT_BYTES
    {
        return Err("Local runtime output exceeded the evidence bound".into());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| {
        format!(
            "Local runtime returned invalid JSON: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
    })
}

fn resolve_runtime_cli() -> Result<PathBuf, String> {
    let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../scripts/runtime-failure-capsule/cli.mjs");
    if source.is_file() {
        return source
            .canonicalize()
            .map_err(|error| format!("Could not resolve the local runtime: {error}"));
    }
    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not resolve the CodeVetter executable: {error}"))?;
    let parent = executable
        .parent()
        .ok_or_else(|| "Could not resolve the CodeVetter executable directory".to_string())?;
    let candidates = [
        parent.join("../Resources/runtime-failure-capsule/cli.mjs"),
        parent.join("resources/runtime-failure-capsule/cli.mjs"),
        parent.join("runtime-failure-capsule/cli.mjs"),
    ];
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| "The packaged local performance runtime is unavailable".into())
}

#[allow(clippy::too_many_arguments)]
fn optimization_stage(
    repo_path: &Path,
    base_sha: &str,
    task: &str,
    review_agent: &str,
    correctness_target: Option<&LocalCheckTarget>,
    target: Option<LocalCheckTarget>,
    baseline_repo: Option<&Path>,
    performance: &LocalCheckStage,
    samples: u8,
    warmups: u8,
    timeout_ms: u64,
    spec_paths: &[PathBuf],
    selected_requirement_ids: &[String],
) -> LocalCheckStage {
    let Some(target) = target else {
        return LocalCheckStage {
            status: LocalCheckStatus::NoConfidence,
            duration_ms: 0,
            target: None,
            evidence: json!({"next_action": null}),
            limitations: vec!["Optimization requires a qualified performance target".into()],
        };
    };
    if baseline_repo.is_some() {
        let status = match performance.status {
            LocalCheckStatus::Passed => LocalCheckStatus::Passed,
            LocalCheckStatus::Failed => LocalCheckStatus::Failed,
            _ => LocalCheckStatus::NoConfidence,
        };
        let limitations = if status == LocalCheckStatus::NoConfidence {
            performance
                .evidence
                .get("verdict")
                .and_then(|value| value.get("reason"))
                .and_then(Value::as_str)
                .map(|reason| vec![format!("Paired optimization is inconclusive: {reason}")])
                .unwrap_or_else(|| {
                    vec!["Paired optimization produced no defensible conclusion".into()]
                })
        } else {
            Vec::new()
        };
        return LocalCheckStage {
            status,
            duration_ms: 0,
            target: Some(target),
            evidence: json!({
                "mode": "paired_verification",
                "performance_verdict": performance.evidence.get("verdict")
            }),
            limitations,
        };
    }
    let command = render_candidate_command(
        repo_path,
        base_sha,
        task,
        review_agent,
        correctness_target,
        &target,
        samples,
        warmups,
        timeout_ms,
        spec_paths,
        selected_requirement_ids,
    );
    LocalCheckStage {
        status: if matches!(performance.status, LocalCheckStatus::Passed | LocalCheckStatus::Completed) {
            LocalCheckStatus::Ready
        } else {
            LocalCheckStatus::NoConfidence
        },
        duration_ms: 0,
        target: Some(target),
        evidence: json!({
            "mode": "agent_handoff",
            "next_action": "Have a coding agent make one bounded performance edit in an isolated clean checkout, then run paired verification.",
            "candidate_command": command,
            "owner_checkout_mutated": false
        }),
        limitations: vec![
            "CodeVetter diagnoses and verifies optimization candidates; it does not silently edit the selected checkout.".into(),
        ],
    }
}

fn render_candidate_command(
    repo_path: &Path,
    base_sha: &str,
    task: &str,
    review_agent: &str,
    correctness_target: Option<&LocalCheckTarget>,
    target: &LocalCheckTarget,
    samples: u8,
    warmups: u8,
    timeout_ms: u64,
    spec_paths: &[PathBuf],
    selected_requirement_ids: &[String],
) -> String {
    let correctness = correctness_target
        .map(|selected| {
            let name = selected
                .name
                .as_ref()
                .map(|value| format!(" --test-name {}", shell_token(value)))
                .unwrap_or_default();
            format!(
                " --test-adapter {} --test-target {}{}",
                shell_token(&selected.adapter),
                shell_token(&selected.target),
                name
            )
        })
        .unwrap_or_default();
    let performance_name = target
        .name
        .as_ref()
        .map(|value| format!(" --perf-name {}", shell_token(value)))
        .unwrap_or_default();
    let specs = spec_paths
        .iter()
        .map(|path| format!(" --spec {}", shell_token(&path.to_string_lossy())))
        .collect::<String>();
    let requirements = selected_requirement_ids
        .iter()
        .map(|id| format!(" --requirement {}", shell_token(id)))
        .collect::<String>();
    format!(
        "codevetter check --repo <candidate-worktree> --range {} --task {} --agent {}{}{}{} --perf-adapter {} --perf-target {}{} --baseline-repo {} --samples {} --warmups {} --timeout-ms {}",
        shell_token(&format!("{base_sha}...HEAD")),
        shell_token(task),
        shell_token(review_agent),
        correctness,
        specs,
        requirements,
        shell_token(&target.adapter),
        shell_token(&target.target),
        performance_name,
        shell_token(&repo_path.to_string_lossy()),
        samples,
        warmups,
        timeout_ms
    )
}

fn shell_token(value: &str) -> String {
    if value.bytes().all(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'-' | b'_' | b':')
    }) {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn no_confidence_stage(
    started: Instant,
    target: Option<LocalCheckTarget>,
    limitation: String,
) -> LocalCheckStage {
    LocalCheckStage {
        status: LocalCheckStatus::NoConfidence,
        duration_ms: elapsed_ms(started),
        target,
        evidence: json!({"verdict": {"status": "no_confidence"}}),
        limitations: vec![limitation],
    }
}

fn progress_for_stage(stage: &'static str, result: &LocalCheckStage) -> LocalCheckProgress {
    LocalCheckProgress {
        stage,
        state: status_name(result.status),
    }
}

fn status_name(status: LocalCheckStatus) -> &'static str {
    match status {
        LocalCheckStatus::Passed => "passed",
        LocalCheckStatus::Completed => "completed",
        LocalCheckStatus::Ready => "ready",
        LocalCheckStatus::NeedsAttention => "needs_attention",
        LocalCheckStatus::Failed => "failed",
        LocalCheckStatus::NoConfidence => "no_confidence",
    }
}

fn verdict_name(verdict: LocalCheckVerdict) -> &'static str {
    match verdict {
        LocalCheckVerdict::PassedWithLimits => "passed_with_limits",
        LocalCheckVerdict::NeedsAttention => "needs_attention",
        LocalCheckVerdict::Failed => "failed",
        LocalCheckVerdict::NoConfidence => "no_confidence",
    }
}

fn aggregate_verdict(stages: &LocalCheckStages) -> LocalCheckVerdict {
    let statuses = [
        stages.review.status,
        stages.correctness.status,
        stages.performance.status,
        stages.optimization.status,
    ];
    if statuses.contains(&LocalCheckStatus::Failed) {
        LocalCheckVerdict::Failed
    } else if statuses.contains(&LocalCheckStatus::NeedsAttention) {
        LocalCheckVerdict::NeedsAttention
    } else if statuses.contains(&LocalCheckStatus::NoConfidence) {
        LocalCheckVerdict::NoConfidence
    } else {
        LocalCheckVerdict::PassedWithLimits
    }
}

fn collect_limitations(stages: &LocalCheckStages) -> Vec<String> {
    [
        &stages.review,
        &stages.correctness,
        &stages.performance,
        &stages.optimization,
    ]
    .into_iter()
    .flat_map(|stage| stage.limitations.clone())
    .take(24)
    .collect()
}

fn default_app_data_dir() -> Result<PathBuf, String> {
    if let Some(override_dir) = std::env::var_os("CODEVETTER_APP_DATA_DIR") {
        return Ok(PathBuf::from(override_dir));
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").ok_or_else(|| "HOME is unavailable".to_string())?;
        Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.codevetter.desktop"))
    }
    #[cfg(target_os = "windows")]
    {
        let app_data =
            std::env::var_os("APPDATA").ok_or_else(|| "APPDATA is unavailable".to_string())?;
        Ok(PathBuf::from(app_data).join("com.codevetter.desktop"))
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        if let Some(data_home) = std::env::var_os("XDG_DATA_HOME") {
            return Ok(PathBuf::from(data_home).join("com.codevetter.desktop"));
        }
        let home = std::env::var_os("HOME").ok_or_else(|| "HOME is unavailable".to_string())?;
        Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("com.codevetter.desktop"))
    }
}

fn short_sha(value: &str) -> &str {
    value.get(..12).unwrap_or(value)
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stage(status: LocalCheckStatus) -> LocalCheckStage {
        LocalCheckStage {
            status,
            duration_ms: 0,
            target: None,
            evidence: json!({}),
            limitations: Vec::new(),
        }
    }

    #[test]
    fn failed_execution_wins_over_review_attention() {
        let stages = LocalCheckStages {
            review: stage(LocalCheckStatus::NeedsAttention),
            correctness: stage(LocalCheckStatus::Failed),
            performance: stage(LocalCheckStatus::Passed),
            optimization: stage(LocalCheckStatus::Ready),
        };
        assert_eq!(aggregate_verdict(&stages), LocalCheckVerdict::Failed);
    }

    #[test]
    fn missing_performance_is_explicit_no_confidence() {
        let stages = LocalCheckStages {
            review: stage(LocalCheckStatus::Completed),
            correctness: stage(LocalCheckStatus::Passed),
            performance: stage(LocalCheckStatus::NoConfidence),
            optimization: stage(LocalCheckStatus::NoConfidence),
        };
        assert_eq!(aggregate_verdict(&stages), LocalCheckVerdict::NoConfidence);
    }

    #[test]
    fn review_only_spec_coverage_cannot_preserve_a_passing_verdict() {
        let coverage: SpecCoverageReceipt = serde_json::from_value(json!({
            "schema_version": "codevetter.spec-coverage/v1",
            "head_sha": "a".repeat(40),
            "sources": [],
            "requirements": [],
            "summary": {
                "total_requirements": 2,
                "review_input_requirements": 2,
                "selected_for_execution": 0,
                "verified": 0,
                "contradicted": 0,
                "review_only": 2,
                "unverified": 0,
                "review_input_coverage_percent": 100,
                "executable_evidence_coverage_percent": 0,
                "verified_coverage_percent": 0
            },
            "limitations": []
        }))
        .expect("coverage");
        assert_eq!(
            apply_spec_confidence(LocalCheckVerdict::PassedWithLimits, Some(&coverage)),
            LocalCheckVerdict::NoConfidence
        );
        assert_eq!(
            apply_spec_confidence(LocalCheckVerdict::Failed, Some(&coverage)),
            LocalCheckVerdict::Failed
        );
    }

    #[test]
    fn rejects_unsafe_relative_targets() {
        let target = LocalCheckTarget {
            adapter: "node-test".into(),
            target: "../outside.test.mjs".into(),
            name: None,
            source: "explicit".into(),
        };
        assert!(validate_target(&target, false).is_err());
    }

    #[test]
    fn passing_correctness_exit_is_passed_even_when_failure_diagnosis_is_empty() {
        let evidence = json!({
            "terminal": {"status": "exited", "exit_code": 0},
            "verdict": {"status": "no_confidence"}
        });
        assert_eq!(
            runtime_stage_status("run", &evidence),
            LocalCheckStatus::Passed
        );
    }

    #[test]
    fn runtime_evidence_is_bounded_and_keeps_no_confidence_distinct_from_failure() {
        let mut source = stage(LocalCheckStatus::NoConfidence);
        source.duration_ms = 42;
        source.limitations = vec![format!("{} unavailable", "x".repeat(2_000))];
        let context = runtime_stage_review_context("correctness", &source);

        assert_eq!(context["evidence_status"], "no_confidence");
        assert_eq!(context["pass"], false);
        assert_eq!(context["duration_ms"], 42);
        assert!(context["notes"]
            .as_str()
            .is_some_and(|notes| notes.len() <= 1_000));
    }

    #[test]
    fn candidate_handoff_preserves_task_and_exact_scopes() {
        let correctness = LocalCheckTarget {
            adapter: "node-test".into(),
            target: "test/parser.test.mjs".into(),
            name: None,
            source: "explicit".into(),
        };
        let performance = LocalCheckTarget {
            adapter: "node-test".into(),
            target: "test/parser.performance.test.mjs".into(),
            name: None,
            source: "explicit".into(),
        };
        let command = render_candidate_command(
            Path::new("/tmp/baseline"),
            &"a".repeat(40),
            "Preserve parser output",
            "codex",
            Some(&correctness),
            &performance,
            3,
            1,
            30_000,
            &[PathBuf::from("docs/parser.md")],
            &["parser-output-stable".into()],
        );
        assert!(command.contains("--task 'Preserve parser output'"));
        assert!(command.contains("--agent codex"));
        assert!(command.contains("--test-target test/parser.test.mjs"));
        assert!(command.contains("--perf-target test/parser.performance.test.mjs"));
        assert!(command.contains("--spec docs/parser.md"));
        assert!(command.contains("--requirement parser-output-stable"));
        assert!(command.contains("--baseline-repo /tmp/baseline"));
    }

    #[test]
    fn review_task_includes_cited_specs_without_calling_them_proof() {
        let repo = tempfile::tempdir().expect("repo");
        let docs = repo.path().join("docs");
        std::fs::create_dir_all(&docs).expect("docs");
        std::fs::write(
            docs.join("product.md"),
            "### Requirement: account-lockout\nLock after five failed attempts.\n",
        )
        .expect("spec");
        let packet = load_spec_packet(repo.path(), &[PathBuf::from("docs/product.md")])
            .expect("packet")
            .expect("some packet");
        let task = compose_review_task("Preserve authentication", Some(&packet));
        assert!(task.starts_with("Preserve authentication"));
        assert!(task.contains("[account-lockout] docs/product.md:1"));
        assert!(task.contains("not executable proof"));
    }

    #[test]
    fn automatic_performance_requires_a_dedicated_workload() {
        let candidate = |target: &str, adapter: &str, name: Option<&str>| EvidenceScopeCandidate {
            id: format!("scope-{target}"),
            adapter: adapter.into(),
            target: target.into(),
            name: name.map(ToOwned::to_owned),
            reason: "fixture".into(),
            source_paths: Vec::new(),
            confidence_milli: 900,
            testing_supported: true,
            performance_supported: true,
        };
        assert!(!dedicated_performance_candidate(&candidate(
            "test/parser.test.ts",
            "vitest",
            None,
        )));
        assert!(dedicated_performance_candidate(&candidate(
            "test/parser.performance.test.ts",
            "vitest",
            None,
        )));
        assert!(dedicated_performance_candidate(&candidate(
            "benchmark_test.go",
            "go-bench",
            Some("BenchmarkParse"),
        )));
    }

    #[test]
    fn explicit_performance_target_bypasses_discovery_filter() {
        let explicit = LocalCheckTarget {
            adapter: "vitest".into(),
            target: "test/parser.test.ts".into(),
            name: None,
            source: "explicit".into(),
        };
        let (selected, limitation) = select_performance_target(Some(explicit.clone()), None);
        assert_eq!(selected, Some(explicit));
        assert!(limitation.is_none());
    }

    #[test]
    fn progress_names_are_stable_and_machine_bounded() {
        assert_eq!(
            progress_for_stage("review", &stage(LocalCheckStatus::NeedsAttention)),
            LocalCheckProgress {
                stage: "review",
                state: "needs_attention",
            }
        );
        assert_eq!(
            verdict_name(LocalCheckVerdict::PassedWithLimits),
            "passed_with_limits"
        );
    }

    #[test]
    fn inconclusive_paired_performance_is_no_confidence() {
        let evidence = json!({"verdict": {"status": "inconclusive"}});
        assert_eq!(
            runtime_stage_status("verify-paired-optimization", &evidence),
            LocalCheckStatus::NoConfidence
        );
    }
}
