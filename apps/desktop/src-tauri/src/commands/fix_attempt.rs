//! Explicit, isolated agent-fix execution followed by executable and review rechecks.
//!
//! A fix attempt never edits, commits, or merges into the selected checkout. It
//! materializes the exact source receipt head as a detached Git worktree under
//! CodeVetter's app-data directory, lets one explicitly confirmed coding agent
//! edit there, reruns the recorded correctness target, and reviews only the
//! resulting worktree diff. The retained worktree remains owner-inspectable
//! until a separately confirmed discard operation removes it.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command as TokioCommand;

use crate::{db, DbState};

use super::fix_packet::{
    build_agent_fix_packet, load_local_check_receipt, AgentFixPacketReceipt, FixPacketFinding,
};
use super::local_check::{
    rerun_fix_correctness_target, LocalCheckReceipt, LocalCheckStage, LocalCheckStatus,
};
use super::review::{resolve_cli_path, run_cli_review_core};

const SCHEMA_VERSION: &str = "codevetter.fix-attempt/v1";
const MAX_AGENT_OUTPUT_BYTES: usize = 512 * 1024;
const MAX_DIFF_BYTES: usize = 1024 * 1024;
const MAX_DIFF_PREVIEW_BYTES: usize = 128 * 1024;
const MAX_CHANGED_FILES: usize = 100;
const MAX_FINDINGS: usize = 100;
const AGENT_DEADLINE: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FixAttemptInput {
    pub run_id: String,
    pub finding_ids: Vec<String>,
    pub agent: String,
    pub confirmed: bool,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiscardFixAttemptInput {
    pub attempt_id: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FixAttemptReceipt {
    pub schema_version: String,
    pub attempt_id: String,
    pub operation: String,
    pub state: String,
    pub source_run_id: String,
    pub repository_path: String,
    pub source: FixAttemptSource,
    pub worktree: FixAttemptWorktree,
    pub agent: FixAttemptAgent,
    pub change: FixAttemptChange,
    pub recheck: FixAttemptRecheck,
    pub limitations: Vec<String>,
    pub started_at: String,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FixAttemptSource {
    pub input: String,
    pub base_sha: String,
    pub head_sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FixAttemptWorktree {
    pub path: String,
    pub detached: bool,
    pub retained: bool,
    pub source_head_sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FixAttemptAgent {
    pub id: String,
    pub status: String,
    pub duration_ms: u64,
    pub diagnostic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FixAttemptChange {
    pub changed_files: Vec<String>,
    pub diff_sha256: Option<String>,
    pub diff_bytes: usize,
    pub diff_preview: String,
    pub preview_truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FixAttemptRecheck {
    pub diff_check: FixAttemptGate,
    pub correctness: FixAttemptCorrectness,
    pub review: FixAttemptReview,
    pub findings: Vec<FixFindingRecheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FixAttemptGate {
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FixAttemptCorrectness {
    pub status: String,
    pub target: Option<String>,
    pub duration_ms: u64,
    pub evidence: Value,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FixAttemptReview {
    pub status: String,
    pub review_id: Option<String>,
    pub summary: Option<String>,
    pub findings: Vec<Value>,
    pub limitation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FixFindingRecheck {
    pub finding_id: String,
    pub status: String,
    pub reason: String,
}

struct AgentExecution {
    success: bool,
    duration_ms: u64,
    diagnostic: Option<String>,
}

pub async fn execute_fix_attempt(
    app_data_dir: PathBuf,
    input: FixAttemptInput,
) -> Result<FixAttemptReceipt, String> {
    validate_execute_input(&input)?;
    let connection = db::init_db(app_data_dir.clone())
        .map_err(|error| format!("Open CodeVetter database: {error}"))?;
    let packet = build_agent_fix_packet(&connection, &input.run_id, &input.finding_ids)?;
    let source_receipt = load_local_check_receipt(&connection, &input.run_id)?;
    drop(connection);
    validate_packet_source(&packet, &source_receipt)?;

    let repository = canonical_git_repository(Path::new(&packet.repo_path))?;
    require_commit(&repository, &packet.source.head_sha)?;
    let attempt_id = format!("fix-attempt-{}", uuid::Uuid::new_v4().simple());
    let attempt_root = attempt_root(&app_data_dir, &attempt_id)?;
    let worktree_path = attempt_root.join("worktree");
    create_detached_worktree(&repository, &worktree_path, &packet.source.head_sha)?;

    let started_at = chrono::Utc::now().to_rfc3339();
    let mut execution =
        run_fix_agent(&input.agent, &worktree_path, &render_agent_prompt(&packet)).await;
    if !execution.success {
        let receipt = terminal_receipt(
            &attempt_id,
            "failed",
            &input,
            &packet,
            &repository,
            &worktree_path,
            execution,
            empty_change(),
            unchecked_recheck(&packet, "The coding agent did not complete successfully."),
            vec![
                "The isolated worktree is retained for inspection; CodeVetter did not merge or commit any change."
                    .into(),
            ],
            started_at,
        );
        persist_receipt(&attempt_root, &receipt)?;
        return Ok(receipt);
    }

    match exact_worktree_head(&worktree_path) {
        Ok(head) if head == packet.source.head_sha => {}
        Ok(head) => {
            execution.success = false;
            execution.diagnostic = Some(format!(
                "The coding agent changed Git HEAD from {} to {head}; commits and branch movement are outside the fix-attempt contract",
                packet.source.head_sha
            ));
            let receipt = terminal_receipt(
                &attempt_id,
                "failed",
                &input,
                &packet,
                &repository,
                &worktree_path,
                execution,
                empty_change(),
                unchecked_recheck(
                    &packet,
                    "Rechecks were blocked because the coding agent changed Git history.",
                ),
                vec![
                    "The isolated worktree is retained for inspection; CodeVetter did not merge or push the unsupported commit."
                        .into(),
                ],
                started_at,
            );
            persist_receipt(&attempt_root, &receipt)?;
            return Ok(receipt);
        }
        Err(error) => {
            execution.success = false;
            execution.diagnostic = Some(error.clone());
            let receipt = terminal_receipt(
                &attempt_id,
                "failed",
                &input,
                &packet,
                &repository,
                &worktree_path,
                execution,
                empty_change(),
                unchecked_recheck(
                    &packet,
                    "Rechecks were blocked because Git HEAD was unreadable.",
                ),
                vec![error],
                started_at,
            );
            persist_receipt(&attempt_root, &receipt)?;
            return Ok(receipt);
        }
    }

    expose_untracked_diff(&worktree_path)?;
    let change = collect_change(&worktree_path)?;
    if change.changed_files.is_empty() || change.diff_bytes == 0 {
        let receipt = terminal_receipt(
            &attempt_id,
            "no_changes",
            &input,
            &packet,
            &repository,
            &worktree_path,
            execution,
            change,
            unchecked_recheck(&packet, "The coding agent produced no inspectable worktree diff."),
            vec![
                "No source change was produced, so CodeVetter issued no fixed finding or correctness claim."
                    .into(),
                "The isolated worktree is retained for inspection; CodeVetter did not merge or commit any change."
                    .into(),
            ],
            started_at,
        );
        persist_receipt(&attempt_root, &receipt)?;
        return Ok(receipt);
    }

    let diff_check = run_diff_check(&worktree_path);
    let correctness = rerun_fix_correctness_target(
        &worktree_path,
        source_receipt.stages.correctness.target.clone(),
        input.timeout_ms,
    )
    .await;
    let correctness_projection = project_correctness(&correctness);
    let review = if diff_check.status == "passed" {
        run_fix_review(
            &app_data_dir,
            &worktree_path,
            &input.agent,
            &packet,
            &source_receipt,
            &correctness,
        )
        .await
    } else {
        FixAttemptReview {
            status: "unchecked".into(),
            review_id: None,
            summary: None,
            findings: Vec::new(),
            limitation: Some("Review was skipped because git diff --check failed.".into()),
        }
    };
    let finding_rechecks = classify_findings(&packet.findings, &review, &correctness_projection);
    let state = classify_attempt_state(
        &diff_check,
        &correctness_projection,
        &review,
        &finding_rechecks,
    );
    let mut limitations = vec![
        "The isolated worktree is retained for owner inspection; CodeVetter did not commit, merge, push, or modify the selected checkout."
            .into(),
        "A fixed status is bounded to the recorded correctness target and source-qualified re-review; it is not a general proof of the repository."
            .into(),
    ];
    if correctness_projection.status == "no_confidence" {
        limitations.push(
            "The source verification receipt had no runnable correctness target, or its recheck produced no executable confidence."
                .into(),
        );
    }
    if let Some(limitation) = review.limitation.clone() {
        limitations.push(limitation);
    }
    let receipt = terminal_receipt(
        &attempt_id,
        &state,
        &input,
        &packet,
        &repository,
        &worktree_path,
        execution,
        change,
        FixAttemptRecheck {
            diff_check,
            correctness: correctness_projection,
            review,
            findings: finding_rechecks,
        },
        limitations,
        started_at,
    );
    persist_receipt(&attempt_root, &receipt)?;
    Ok(receipt)
}

pub fn inspect_fix_attempt(
    app_data_dir: &Path,
    attempt_id: &str,
) -> Result<FixAttemptReceipt, String> {
    let root = attempt_root(app_data_dir, attempt_id)?;
    let bytes = fs::read(root.join("receipt.json"))
        .map_err(|error| format!("Read fix-attempt receipt: {error}"))?;
    let receipt: FixAttemptReceipt = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Decode fix-attempt receipt: {error}"))?;
    if receipt.schema_version != SCHEMA_VERSION || receipt.attempt_id != attempt_id {
        return Err("The fix-attempt receipt identity is invalid".into());
    }
    let expected_worktree = root.join("worktree");
    if Path::new(&receipt.worktree.path) != expected_worktree {
        return Err("The fix-attempt worktree escaped its app-data scope".into());
    }
    Ok(receipt)
}

pub fn discard_fix_attempt(
    app_data_dir: &Path,
    input: DiscardFixAttemptInput,
) -> Result<FixAttemptReceipt, String> {
    if !input.confirmed {
        return Err("Discard requires explicit confirmation because unmerged worktree changes will be removed".into());
    }
    let mut receipt = inspect_fix_attempt(app_data_dir, &input.attempt_id)?;
    if !receipt.worktree.retained {
        return Ok(receipt);
    }
    let repository = canonical_git_repository(Path::new(&receipt.repository_path))?;
    let worktree = PathBuf::from(&receipt.worktree.path);
    let output = StdCommand::new("git")
        .args(["worktree", "remove", "--force"])
        .arg(&worktree)
        .current_dir(&repository)
        .output()
        .map_err(|error| format!("Start git worktree remove: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Discard isolated worktree: {}",
            bounded_diagnostic(&output.stderr, 4_096)
        ));
    }
    let _ = StdCommand::new("git")
        .args(["worktree", "prune"])
        .current_dir(&repository)
        .output();
    receipt.operation = "discard".into();
    receipt.state = "discarded".into();
    receipt.worktree.retained = false;
    receipt.completed_at = chrono::Utc::now().to_rfc3339();
    receipt.limitations.push(
        "The separately confirmed discard removed the isolated unmerged worktree; the source checkout was not modified."
            .into(),
    );
    persist_receipt(&attempt_root(app_data_dir, &input.attempt_id)?, &receipt)?;
    Ok(receipt)
}

fn validate_execute_input(input: &FixAttemptInput) -> Result<(), String> {
    validate_identity(&input.run_id, "run id")?;
    if input.finding_ids.is_empty() || input.finding_ids.len() > MAX_FINDINGS {
        return Err(format!("Select between 1 and {MAX_FINDINGS} findings"));
    }
    let unique = input.finding_ids.iter().collect::<BTreeSet<_>>();
    if unique.len() != input.finding_ids.len() {
        return Err("Finding selection contains duplicate identities".into());
    }
    for finding_id in &input.finding_ids {
        validate_identity(finding_id, "finding id")?;
    }
    if !matches!(input.agent.as_str(), "claude" | "gemini" | "codex") {
        return Err("Fix agent must be `claude`, `gemini`, or `codex`".into());
    }
    if !(100..=120_000).contains(&input.timeout_ms) {
        return Err("Correctness timeout must be between 100 and 120,000 milliseconds".into());
    }
    if !input.confirmed {
        return Err(
            "Fix execution requires explicit confirmation because it invokes an agent and edits an isolated worktree"
                .into(),
        );
    }
    Ok(())
}

fn validate_packet_source(
    packet: &AgentFixPacketReceipt,
    receipt: &LocalCheckReceipt,
) -> Result<(), String> {
    if packet.run_id != receipt.run_id
        || packet.repo_path != receipt.repo_path
        || packet.source.input != receipt.source.input
        || packet.source.base_sha != receipt.source.base_sha
        || packet.source.head_sha != receipt.source.head_sha
    {
        return Err("The fix packet drifted from its persisted local-check source identity".into());
    }
    Ok(())
}

fn canonical_git_repository(path: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("Repository {} is unavailable: {error}", path.display()))?;
    let output = StdCommand::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(&canonical)
        .output()
        .map_err(|error| format!("Inspect repository: {error}"))?;
    if !output.status.success() {
        return Err("Fix execution requires a readable Git repository".into());
    }
    let top = fs::canonicalize(String::from_utf8_lossy(&output.stdout).trim())
        .map_err(|_| "The Git repository root is unavailable".to_string())?;
    if top != canonical {
        return Err("Fix execution requires the exact Git repository root".into());
    }
    Ok(canonical)
}

fn require_commit(repository: &Path, sha: &str) -> Result<(), String> {
    if !valid_sha(sha) {
        return Err("The source receipt head is not an exact Git SHA".into());
    }
    let output = StdCommand::new("git")
        .args(["cat-file", "-e", &format!("{sha}^{{commit}}")])
        .current_dir(repository)
        .output()
        .map_err(|error| format!("Inspect source commit: {error}"))?;
    if !output.status.success() {
        return Err("The exact source receipt head is no longer available locally".into());
    }
    Ok(())
}

fn create_detached_worktree(repository: &Path, worktree: &Path, sha: &str) -> Result<(), String> {
    if worktree.exists() {
        return Err("The generated fix-attempt worktree already exists".into());
    }
    let parent = worktree
        .parent()
        .ok_or_else(|| "The fix-attempt directory is invalid".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Create fix-attempt directory: {error}"))?;
    let output = StdCommand::new("git")
        .args(["worktree", "add", "--detach"])
        .arg(worktree)
        .arg(sha)
        .current_dir(repository)
        .output()
        .map_err(|error| format!("Create isolated worktree: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Create isolated worktree: {}",
            bounded_diagnostic(&output.stderr, 4_096)
        ));
    }
    Ok(())
}

async fn run_fix_agent(agent: &str, worktree: &Path, prompt: &str) -> AgentExecution {
    let cli_path = resolve_cli_path(agent);
    if cli_path == agent {
        return AgentExecution {
            success: false,
            duration_ms: 0,
            diagnostic: Some(format!("Coding agent `{agent}` is unavailable")),
        };
    }
    run_fix_agent_at(agent, Path::new(&cli_path), worktree, prompt).await
}

async fn run_fix_agent_at(
    agent: &str,
    cli_path: &Path,
    worktree: &Path,
    prompt: &str,
) -> AgentExecution {
    let started = Instant::now();
    let mut command = TokioCommand::new(cli_path);
    command
        .args(fix_agent_arguments(agent, prompt))
        .current_dir(worktree)
        .env("CODEVETTER_FIX_ATTEMPT", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_COUNT", "1")
        .env("GIT_CONFIG_KEY_0", "push.default")
        .env("GIT_CONFIG_VALUE_0", "nothing")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return AgentExecution {
                success: false,
                duration_ms: elapsed_ms(started),
                diagnostic: Some(format!("Start coding agent `{agent}`: {error}")),
            };
        }
    };
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_task = stdout.map(|stream| tokio::spawn(read_bounded(stream)));
    let stderr_task = stderr.map(|stream| tokio::spawn(read_bounded(stream)));
    let status = match tokio::time::timeout(AGENT_DEADLINE, child.wait()).await {
        Ok(Ok(status)) => Some(status),
        Ok(Err(error)) => {
            return AgentExecution {
                success: false,
                duration_ms: elapsed_ms(started),
                diagnostic: Some(format!("Wait for coding agent `{agent}`: {error}")),
            };
        }
        Err(_) => {
            #[cfg(unix)]
            if let Some(pid) = pid {
                unsafe {
                    libc::kill(-(pid as i32), libc::SIGKILL);
                }
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
            if let Some(task) = stdout_task {
                task.abort();
            }
            if let Some(task) = stderr_task {
                task.abort();
            }
            return AgentExecution {
                success: false,
                duration_ms: elapsed_ms(started),
                diagnostic: Some("Coding agent exceeded the 30 minute deadline".into()),
            };
        }
    };
    let stdout = join_output(stdout_task).await;
    let stderr = join_output(stderr_task).await;
    let status = status.expect("completed process has a status");
    AgentExecution {
        success: status.success(),
        duration_ms: elapsed_ms(started),
        diagnostic: if status.success() {
            None
        } else {
            Some(agent_failure_detail(&stdout, &stderr, status.code()))
        },
    }
}

fn fix_agent_arguments(agent: &str, prompt: &str) -> Vec<String> {
    match agent {
        "claude" => [
            "--setting-sources",
            "user",
            "--permission-mode",
            "acceptEdits",
            "--no-session-persistence",
            "--no-chrome",
            "--strict-mcp-config",
            "--mcp-config",
            "{\"mcpServers\":{}}",
            "-p",
            prompt,
        ]
        .into_iter()
        .map(ToOwned::to_owned)
        .collect(),
        "codex" => [
            "exec",
            "--ephemeral",
            "--ignore-user-config",
            "-c",
            "model_reasoning_effort=\"medium\"",
            "--sandbox",
            "workspace-write",
            "--color",
            "never",
            prompt,
        ]
        .into_iter()
        .map(ToOwned::to_owned)
        .collect(),
        _ => [
            "--sandbox",
            "--approval-mode",
            "auto_edit",
            "--extensions",
            "none",
            "-p",
            prompt,
        ]
        .into_iter()
        .map(ToOwned::to_owned)
        .collect(),
    }
}

fn render_agent_prompt(packet: &AgentFixPacketReceipt) -> String {
    format!(
        "You are executing a bounded CodeVetter fix attempt in an isolated detached Git worktree. Edit the actual source files in this worktree; do not commit, create branches, merge, push, or modify another checkout. Keep the patch minimal, obey repository instructions, and preserve the recorded evidence contract. Do not claim completion merely by describing a fix.\n\n{}",
        packet.markdown
    )
}

async fn read_bounded<R: AsyncRead + Unpin>(mut stream: R) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    stream
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| format!("Read coding-agent output: {error}"))?;
    if bytes.len() > MAX_AGENT_OUTPUT_BYTES {
        return Err(format!(
            "Coding-agent output exceeded {MAX_AGENT_OUTPUT_BYTES} bytes"
        ));
    }
    Ok(bytes)
}

async fn join_output(task: Option<tokio::task::JoinHandle<Result<Vec<u8>, String>>>) -> Vec<u8> {
    match task {
        Some(task) => task.await.ok().and_then(Result::ok).unwrap_or_default(),
        None => Vec::new(),
    }
}

fn agent_failure_detail(stdout: &[u8], stderr: &[u8], code: Option<i32>) -> String {
    let stderr = bounded_diagnostic(stderr, 2_048);
    let stdout = bounded_diagnostic(stdout, 2_048);
    let detail = match (stderr.is_empty(), stdout.is_empty()) {
        (false, false) => format!("stderr: {stderr}; stdout: {stdout}"),
        (false, true) => stderr,
        (true, false) => stdout,
        (true, true) => "Coding agent returned no diagnostic output".into(),
    };
    format!("Coding agent failed with exit {code:?}: {detail}")
}

fn expose_untracked_diff(worktree: &Path) -> Result<(), String> {
    let output = StdCommand::new("git")
        .args(["add", "--intent-to-add", "--all"])
        .current_dir(worktree)
        .output()
        .map_err(|error| format!("Prepare isolated diff: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Prepare isolated diff: {}",
            bounded_diagnostic(&output.stderr, 4_096)
        ));
    }
    Ok(())
}

fn exact_worktree_head(worktree: &Path) -> Result<String, String> {
    let output = git_output(worktree, &["rev-parse", "HEAD"], 1_024)?;
    let head = String::from_utf8(output)
        .map_err(|_| "The isolated worktree HEAD is not UTF-8".to_string())?
        .trim()
        .to_string();
    if !valid_sha(&head) {
        return Err("The isolated worktree no longer has an exact Git HEAD".into());
    }
    Ok(head)
}

fn collect_change(worktree: &Path) -> Result<FixAttemptChange, String> {
    let names = git_output(
        worktree,
        &["diff", "--name-only", "-z", "HEAD"],
        MAX_DIFF_BYTES,
    )?;
    let changed_files = names
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| String::from_utf8(path.to_vec()).map_err(|_| "Changed path is not UTF-8"))
        .collect::<Result<Vec<_>, _>>()?;
    if changed_files.len() > MAX_CHANGED_FILES {
        return Err(format!(
            "The fix attempt changed more than {MAX_CHANGED_FILES} files"
        ));
    }
    for path in &changed_files {
        validate_relative_path(path)?;
    }
    let diff = git_output(worktree, &["diff", "--binary", "HEAD"], MAX_DIFF_BYTES)?;
    let diff_sha256 = (!diff.is_empty()).then(|| format!("sha256:{:x}", Sha256::digest(&diff)));
    let preview_bytes = diff.len().min(MAX_DIFF_PREVIEW_BYTES);
    let mut preview_end = preview_bytes;
    while preview_end > 0 && std::str::from_utf8(&diff[..preview_end]).is_err() {
        preview_end -= 1;
    }
    Ok(FixAttemptChange {
        changed_files,
        diff_sha256,
        diff_bytes: diff.len(),
        diff_preview: String::from_utf8_lossy(&diff[..preview_end]).into_owned(),
        preview_truncated: diff.len() > preview_end,
    })
}

fn run_diff_check(worktree: &Path) -> FixAttemptGate {
    match StdCommand::new("git")
        .args(["diff", "--check", "HEAD"])
        .current_dir(worktree)
        .output()
    {
        Ok(output) if output.status.success() => FixAttemptGate {
            status: "passed".into(),
            detail: "git diff --check passed for the isolated worktree".into(),
        },
        Ok(output) => FixAttemptGate {
            status: "failed".into(),
            detail: bounded_diagnostic(&[output.stdout, output.stderr].concat(), 4_096),
        },
        Err(error) => FixAttemptGate {
            status: "no_confidence".into(),
            detail: format!("Could not run git diff --check: {error}"),
        },
    }
}

async fn run_fix_review(
    app_data_dir: &Path,
    worktree: &Path,
    agent: &str,
    packet: &AgentFixPacketReceipt,
    source_receipt: &LocalCheckReceipt,
    correctness: &LocalCheckStage,
) -> FixAttemptReview {
    let connection = match db::init_db(app_data_dir.to_path_buf()) {
        Ok(connection) => connection,
        Err(error) => {
            return FixAttemptReview {
                status: "no_confidence".into(),
                review_id: None,
                summary: None,
                findings: Vec::new(),
                limitation: Some(format!("Open recheck database: {error}")),
            };
        }
    };
    let db = DbState(std::sync::Arc::new(std::sync::Mutex::new(connection)));
    let acceptance = if packet.task.acceptance_criteria.is_empty() {
        String::new()
    } else {
        format!(
            "\n\nAcceptance criteria:\n{}",
            packet
                .task
                .acceptance_criteria
                .iter()
                .map(|item| format!("- {item}"))
                .collect::<Vec<_>>()
                .join("\n")
        )
    };
    let qa = json!({
        "kind": "fix_correctness_recheck",
        "status": status_name(correctness.status),
        "target": correctness.target,
        "limitations": correctness.limitations,
    });
    match run_cli_review_core(
        db,
        worktree.to_string_lossy().into_owned(),
        "WORKTREE".into(),
        format!("Isolated fix attempt for local-check run {}", packet.run_id),
        format!(
            "Recheck whether the worktree diff resolves only the selected findings while preserving the original task: {}{}",
            packet.task.goal, acceptance
        ),
        Some(agent.into()),
        Some(vec![qa]),
        source_receipt.standards_pack.clone(),
    )
    .await
    {
        Ok(value) => {
            let complete = value.get("review_status").and_then(Value::as_str)
                == Some("completed")
                && value
                    .pointer("/review_manifest/complete_coverage")
                    .and_then(Value::as_bool)
                    == Some(true);
            FixAttemptReview {
                status: if complete {
                    "completed"
                } else {
                    "no_confidence"
                }
                .into(),
                review_id: value
                    .get("review_id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                summary: value
                    .get("summary")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                findings: value
                    .get("findings")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .take(MAX_FINDINGS)
                    .collect(),
                limitation: (!complete).then(|| {
                    "Source-qualified re-review completed with incomplete coverage or readiness limitations."
                        .into()
                }),
            }
        }
        Err(error) => FixAttemptReview {
            status: "no_confidence".into(),
            review_id: None,
            summary: None,
            findings: Vec::new(),
            limitation: Some(format!("Source-qualified re-review did not complete: {error}")),
        },
    }
}

fn project_correctness(stage: &LocalCheckStage) -> FixAttemptCorrectness {
    FixAttemptCorrectness {
        status: status_name(stage.status).into(),
        target: stage
            .target
            .as_ref()
            .map(|target| format!("{} · {}", target.adapter, target.target)),
        duration_ms: stage.duration_ms,
        evidence: stage.evidence.clone(),
        limitations: stage.limitations.clone(),
    }
}

fn classify_findings(
    originals: &[FixPacketFinding],
    review: &FixAttemptReview,
    correctness: &FixAttemptCorrectness,
) -> Vec<FixFindingRecheck> {
    originals
        .iter()
        .map(|finding| {
            if review.status != "completed" || correctness.status == "no_confidence" {
                return FixFindingRecheck {
                    finding_id: finding.id.clone(),
                    status: "unchecked".into(),
                    reason: "Executable or source-qualified recheck confidence is incomplete".into(),
                };
            }
            if review
                .findings
                .iter()
                .any(|candidate| finding_matches(finding, candidate))
                || correctness.status == "failed"
            {
                FixFindingRecheck {
                    finding_id: finding.id.clone(),
                    status: "reproduced".into(),
                    reason: if correctness.status == "failed" {
                        "The recorded correctness target still fails".into()
                    } else {
                        "Source-qualified re-review reproduced the finding".into()
                    },
                }
            } else if correctness.status == "passed" {
                FixFindingRecheck {
                    finding_id: finding.id.clone(),
                    status: "fixed".into(),
                    reason: "The recorded correctness target passed and re-review did not reproduce the finding"
                        .into(),
                }
            } else {
                FixFindingRecheck {
                    finding_id: finding.id.clone(),
                    status: "unchecked".into(),
                    reason: "The correctness recheck did not produce a passing executable result".into(),
                }
            }
        })
        .collect()
}

fn finding_matches(original: &FixPacketFinding, candidate: &Value) -> bool {
    let candidate_path = candidate
        .get("filePath")
        .or_else(|| candidate.get("file_path"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if candidate_path != original.file_path {
        return false;
    }
    let candidate_line = candidate.get("line").and_then(Value::as_i64);
    if original
        .line
        .zip(candidate_line)
        .is_some_and(|(left, right)| left.abs_diff(right) <= 5)
    {
        return true;
    }
    let candidate_title = candidate
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or_default();
    token_similarity(&original.title, candidate_title) >= 0.5
}

fn token_similarity(left: &str, right: &str) -> f64 {
    let left = title_tokens(left);
    let right = title_tokens(right);
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let intersection = left.intersection(&right).count() as f64;
    let union = left.union(&right).count() as f64;
    intersection / union
}

fn title_tokens(value: &str) -> BTreeSet<String> {
    value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .map(str::to_ascii_lowercase)
        .filter(|token| token.len() >= 3)
        .collect()
}

fn classify_attempt_state(
    diff_check: &FixAttemptGate,
    correctness: &FixAttemptCorrectness,
    review: &FixAttemptReview,
    findings: &[FixFindingRecheck],
) -> String {
    if diff_check.status == "failed" || correctness.status == "failed" {
        return "reproduced".into();
    }
    if diff_check.status != "passed"
        || correctness.status != "passed"
        || review.status != "completed"
        || findings.iter().any(|finding| finding.status == "unchecked")
    {
        return "no_confidence".into();
    }
    if findings
        .iter()
        .any(|finding| finding.status == "reproduced")
    {
        "reproduced".into()
    } else if !review.findings.is_empty() {
        "needs_attention".into()
    } else {
        "verified_fixed".into()
    }
}

#[allow(clippy::too_many_arguments)]
fn terminal_receipt(
    attempt_id: &str,
    state: &str,
    input: &FixAttemptInput,
    packet: &AgentFixPacketReceipt,
    repository: &Path,
    worktree: &Path,
    execution: AgentExecution,
    change: FixAttemptChange,
    recheck: FixAttemptRecheck,
    limitations: Vec<String>,
    started_at: String,
) -> FixAttemptReceipt {
    FixAttemptReceipt {
        schema_version: SCHEMA_VERSION.into(),
        attempt_id: attempt_id.into(),
        operation: "execute".into(),
        state: state.into(),
        source_run_id: input.run_id.clone(),
        repository_path: repository.to_string_lossy().into_owned(),
        source: FixAttemptSource {
            input: packet.source.input.clone(),
            base_sha: packet.source.base_sha.clone(),
            head_sha: packet.source.head_sha.clone(),
        },
        worktree: FixAttemptWorktree {
            path: worktree.to_string_lossy().into_owned(),
            detached: true,
            retained: true,
            source_head_sha: packet.source.head_sha.clone(),
        },
        agent: FixAttemptAgent {
            id: input.agent.clone(),
            status: if execution.success {
                "completed"
            } else {
                "failed"
            }
            .into(),
            duration_ms: execution.duration_ms,
            diagnostic: execution.diagnostic,
        },
        change,
        recheck,
        limitations,
        started_at,
        completed_at: chrono::Utc::now().to_rfc3339(),
    }
}

fn unchecked_recheck(packet: &AgentFixPacketReceipt, reason: &str) -> FixAttemptRecheck {
    FixAttemptRecheck {
        diff_check: FixAttemptGate {
            status: "unchecked".into(),
            detail: reason.into(),
        },
        correctness: FixAttemptCorrectness {
            status: "unchecked".into(),
            target: None,
            duration_ms: 0,
            evidence: Value::Null,
            limitations: vec![reason.into()],
        },
        review: FixAttemptReview {
            status: "unchecked".into(),
            review_id: None,
            summary: None,
            findings: Vec::new(),
            limitation: Some(reason.into()),
        },
        findings: packet
            .findings
            .iter()
            .map(|finding| FixFindingRecheck {
                finding_id: finding.id.clone(),
                status: "unchecked".into(),
                reason: reason.into(),
            })
            .collect(),
    }
}

fn empty_change() -> FixAttemptChange {
    FixAttemptChange {
        changed_files: Vec::new(),
        diff_sha256: None,
        diff_bytes: 0,
        diff_preview: String::new(),
        preview_truncated: false,
    }
}

fn persist_receipt(root: &Path, receipt: &FixAttemptReceipt) -> Result<(), String> {
    fs::create_dir_all(root)
        .map_err(|error| format!("Create fix-attempt receipt directory: {error}"))?;
    let bytes = serde_json::to_vec_pretty(receipt)
        .map_err(|error| format!("Encode fix-attempt receipt: {error}"))?;
    let temporary = root.join("receipt.json.tmp");
    let destination = root.join("receipt.json");
    fs::write(&temporary, bytes).map_err(|error| format!("Write fix-attempt receipt: {error}"))?;
    fs::rename(&temporary, &destination)
        .map_err(|error| format!("Publish fix-attempt receipt: {error}"))?;
    Ok(())
}

fn attempt_root(app_data_dir: &Path, attempt_id: &str) -> Result<PathBuf, String> {
    validate_identity(attempt_id, "attempt id")?;
    if !attempt_id.starts_with("fix-attempt-") {
        return Err("Fix-attempt identity has an unsupported prefix".into());
    }
    Ok(app_data_dir.join("fix-attempts").join(attempt_id))
}

fn git_output(worktree: &Path, arguments: &[&str], max_bytes: usize) -> Result<Vec<u8>, String> {
    let output = StdCommand::new("git")
        .args(arguments)
        .current_dir(worktree)
        .output()
        .map_err(|error| format!("Run git {}: {error}", arguments.join(" ")))?;
    if !output.status.success() {
        return Err(format!(
            "git {} failed: {}",
            arguments.join(" "),
            bounded_diagnostic(&output.stderr, 4_096)
        ));
    }
    if output.stdout.len() > max_bytes || output.stderr.len() > max_bytes {
        return Err(format!(
            "git {} output exceeded its bound",
            arguments.join(" ")
        ));
    }
    Ok(output.stdout)
}

fn validate_identity(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 160
        || value.trim() != value
        || value.contains('\0')
        || value.contains(['\r', '\n'])
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err(format!("{label} must be a bounded lowercase-safe identity"));
    }
    Ok(())
}

fn validate_relative_path(value: &str) -> Result<(), String> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err("The fix attempt produced an unsafe changed path".into());
    }
    Ok(())
}

fn valid_sha(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
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

fn bounded_diagnostic(bytes: &[u8], limit: usize) -> String {
    String::from_utf8_lossy(bytes)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(limit)
        .collect()
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().try_into().unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn finding(id: &str, title: &str, path: &str, line: i64) -> FixPacketFinding {
        FixPacketFinding {
            id: id.into(),
            severity: "high".into(),
            title: title.into(),
            summary: "Fixture problem".into(),
            suggestion: None,
            file_path: path.into(),
            line: Some(line),
            confidence: Some(0.9),
        }
    }

    fn correctness(status: &str) -> FixAttemptCorrectness {
        FixAttemptCorrectness {
            status: status.into(),
            target: Some("vitest · src/cart.test.ts".into()),
            duration_ms: 10,
            evidence: json!({}),
            limitations: Vec::new(),
        }
    }

    #[test]
    fn execution_requires_explicit_consent_and_bounded_inputs() {
        let mut input = FixAttemptInput {
            run_id: "local-check-7".into(),
            finding_ids: vec!["finding-1".into()],
            agent: "codex".into(),
            confirmed: false,
            timeout_ms: 30_000,
        };
        assert!(validate_execute_input(&input)
            .unwrap_err()
            .contains("explicit confirmation"));
        input.confirmed = true;
        assert!(validate_execute_input(&input).is_ok());
        input.finding_ids.push("finding-1".into());
        assert!(validate_execute_input(&input)
            .unwrap_err()
            .contains("duplicate"));
    }

    #[test]
    fn finding_recheck_matches_nearby_lines_or_same_file_title_tokens() {
        let original = finding(
            "finding-1",
            "Checkout total uses stale subtotal",
            "src/cart.ts",
            42,
        );
        assert!(finding_matches(
            &original,
            &json!({"filePath":"src/cart.ts","line":45,"title":"Different wording"})
        ));
        assert!(finding_matches(
            &original,
            &json!({"file_path":"src/cart.ts","line":90,"title":"Checkout total uses stale value"})
        ));
        assert!(!finding_matches(
            &original,
            &json!({"filePath":"src/other.ts","line":42,"title":"Checkout total uses stale subtotal"})
        ));
    }

    #[test]
    fn fixed_status_requires_both_executable_pass_and_completed_rereview() {
        let originals = vec![finding("finding-1", "Stale subtotal", "src/cart.ts", 42)];
        let completed = FixAttemptReview {
            status: "completed".into(),
            review_id: Some("review-8".into()),
            summary: None,
            findings: Vec::new(),
            limitation: None,
        };
        let rechecks = classify_findings(&originals, &completed, &correctness("passed"));
        assert_eq!(rechecks[0].status, "fixed");
        assert_eq!(
            classify_attempt_state(
                &FixAttemptGate {
                    status: "passed".into(),
                    detail: String::new()
                },
                &correctness("passed"),
                &completed,
                &rechecks,
            ),
            "verified_fixed"
        );

        let unchecked = classify_findings(&originals, &completed, &correctness("no_confidence"));
        assert_eq!(unchecked[0].status, "unchecked");
        assert_eq!(
            classify_attempt_state(
                &FixAttemptGate {
                    status: "passed".into(),
                    detail: String::new()
                },
                &correctness("no_confidence"),
                &completed,
                &unchecked,
            ),
            "no_confidence"
        );

        let new_regression = FixAttemptReview {
            findings: vec![json!({
                "filePath": "src/new-regression.ts",
                "line": 8,
                "title": "Fix introduced a new regression"
            })],
            ..completed.clone()
        };
        let original_fixed = classify_findings(&originals, &new_regression, &correctness("passed"));
        assert_eq!(original_fixed[0].status, "fixed");
        assert_eq!(
            classify_attempt_state(
                &FixAttemptGate {
                    status: "passed".into(),
                    detail: String::new()
                },
                &correctness("passed"),
                &new_regression,
                &original_fixed,
            ),
            "needs_attention"
        );
    }

    #[test]
    fn coding_agents_use_noninteractive_edit_only_safety_modes() {
        let claude = fix_agent_arguments("claude", "prompt");
        assert!(claude
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "acceptEdits"]));
        assert!(claude.contains(&"--strict-mcp-config".to_string()));
        assert!(claude.contains(&"--no-session-persistence".to_string()));

        let gemini = fix_agent_arguments("gemini", "prompt");
        assert!(gemini.contains(&"--sandbox".to_string()));
        assert!(gemini
            .windows(2)
            .any(|pair| pair == ["--approval-mode", "auto_edit"]));
        assert!(gemini
            .windows(2)
            .any(|pair| pair == ["--extensions", "none"]));

        let codex = fix_agent_arguments("codex", "prompt");
        assert!(codex
            .windows(2)
            .any(|pair| pair == ["--sandbox", "workspace-write"]));
        assert!(codex.contains(&"--ephemeral".to_string()));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn fixture_agent_edits_only_the_detached_worktree_and_yields_a_bounded_diff() {
        let root = tempfile::tempdir().expect("temporary fix fixture");
        let repository = root.path().join("repository");
        fs::create_dir(&repository).expect("repository directory");
        for arguments in [
            vec!["init"],
            vec!["config", "user.email", "fixture@codevetter.test"],
            vec!["config", "user.name", "CodeVetter Fixture"],
        ] {
            assert!(StdCommand::new("git")
                .args(arguments)
                .current_dir(&repository)
                .status()
                .expect("git setup")
                .success());
        }
        fs::write(repository.join("source.txt"), "original\n").expect("fixture source");
        assert!(StdCommand::new("git")
            .args(["add", "source.txt"])
            .current_dir(&repository)
            .status()
            .expect("git add")
            .success());
        assert!(StdCommand::new("git")
            .args(["commit", "-m", "fixture"])
            .current_dir(&repository)
            .status()
            .expect("git commit")
            .success());
        let head = git_output(&repository, &["rev-parse", "HEAD"], 1_024)
            .map(String::from_utf8)
            .expect("head bytes")
            .expect("head UTF-8");
        let worktree = root.path().join("attempt/worktree");
        create_detached_worktree(&repository, &worktree, head.trim()).expect("detached worktree");

        let fixture_agent = root.path().join("fixture-codex");
        fs::write(
            &fixture_agent,
            "#!/bin/sh\nprintf 'fixed by fixture agent\\n' > fixed.txt\n",
        )
        .expect("fixture agent");
        fs::set_permissions(&fixture_agent, fs::Permissions::from_mode(0o755))
            .expect("fixture agent permissions");
        let execution =
            run_fix_agent_at("codex", &fixture_agent, &worktree, "bounded fixture prompt").await;
        assert!(execution.success, "{:?}", execution.diagnostic);
        assert!(!repository.join("fixed.txt").exists());
        assert!(worktree.join("fixed.txt").is_file());

        expose_untracked_diff(&worktree).expect("expose fixture diff");
        let change = collect_change(&worktree).expect("bounded fixture change");
        assert_eq!(change.changed_files, vec!["fixed.txt"]);
        assert!(change.diff_bytes > 0);
        assert_eq!(run_diff_check(&worktree).status, "passed");

        assert!(StdCommand::new("git")
            .args(["worktree", "remove", "--force"])
            .arg(&worktree)
            .current_dir(&repository)
            .status()
            .expect("remove fixture worktree")
            .success());
    }

    #[test]
    fn attempt_identity_cannot_escape_the_app_data_root() {
        let root = Path::new("/tmp/codevetter-fixture");
        assert_eq!(
            attempt_root(root, "fix-attempt-abc123").unwrap(),
            root.join("fix-attempts/fix-attempt-abc123")
        );
        assert!(attempt_root(root, "../outside").is_err());
        assert!(attempt_root(root, "other-abc123").is_err());
    }
}
