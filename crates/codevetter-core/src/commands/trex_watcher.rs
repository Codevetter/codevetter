//! T-Rex v2 — background watcher that polls open PRs on a watched repo and
//! runs the T-Rex sandbox (commands::sandbox::run_branch_sandbox_inner)
//! whenever a PR's head SHA changes. Each run also posts a GitHub commit
//! status check under context `codevetter/t-rex`, so the PR page shows the
//! verdict alongside CI.
//!
//! State lives in two SQLite tables:
//!   - `trex_watchers`  — per-repo config + last_polled_at + last_error
//!   - `trex_pr_runs`   — append-only history of runs (used to detect SHA churn)
//!
//! The Tokio task per watcher holds an in-memory in-flight set so two ticks
//! can't kick off the same PR sandbox concurrently. State persists across
//! app restarts; enabled watchers auto-resume in `resume_enabled_watchers`.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::async_runtime::{spawn as runtime_spawn, JoinHandle};
use tauri::{AppHandle, Manager, State};
use tokio::process::Command;
use tokio::sync::oneshot;

use crate::commands::sandbox::{
    run_branch_sandbox_headless, run_branch_sandbox_inner, SandboxOptions, SandboxRunInput,
};
use crate::DbState;

const PREF_GITHUB_TOKEN: &str = "github_token";
const STATUS_CONTEXT: &str = "codevetter/t-rex";
const MIN_INTERVAL_SECS: u64 = 60;
const DEFAULT_INTERVAL_SECS: u64 = 300;
const MAX_PRS_PER_TICK: usize = 10;

// ─── State container ────────────────────────────────────────────────────────

pub struct WatcherHandles(Mutex<HashMap<String, WatcherSlot>>);

struct WatcherSlot {
    handle: JoinHandle<()>,
    cancel: oneshot::Sender<()>,
}

impl Default for WatcherHandles {
    fn default() -> Self {
        Self::new()
    }
}

impl WatcherHandles {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

// ─── Public types (mirrored in TS) ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrexWatcher {
    pub repo_path: String,
    pub interval_secs: u64,
    pub enabled: bool,
    pub base_branch: Option<String>,
    pub last_polled_at: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrexPrRun {
    pub id: String,
    pub repo_path: String,
    pub pr_number: i64,
    pub head_sha: String,
    pub verdict: String,
    pub confidence: f64,
    pub summary: String,
    pub status_state: Option<String>,
    pub status_error: Option<String>,
    pub duration_ms: i64,
    pub ran_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartTrexWatcherInput {
    pub repo_path: String,
    pub interval_secs: Option<u64>,
    pub base_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrexWatcherReceipt {
    pub schema_version: u8,
    pub operation: String,
    pub watcher: Option<TrexWatcher>,
    pub watchers: Vec<TrexWatcher>,
    pub runs: Vec<TrexPrRun>,
    pub inspected_prs: u32,
    pub skipped_unchanged: u32,
    pub message: String,
}

impl TrexWatcherReceipt {
    fn empty(operation: &str, message: impl Into<String>) -> Self {
        Self {
            schema_version: 1,
            operation: operation.to_string(),
            watcher: None,
            watchers: vec![],
            runs: vec![],
            inspected_prs: 0,
            skipped_unchanged: 0,
            message: message.into(),
        }
    }
}

// ─── Headless CLI/native bridge ─────────────────────────────────────────────

pub fn enable_trex_watcher_headless(
    db: &DbState,
    input: StartTrexWatcherInput,
) -> Result<TrexWatcherReceipt, String> {
    let repo_path = canonical_repo_path(&input.repo_path)?;
    let interval = input
        .interval_secs
        .unwrap_or(DEFAULT_INTERVAL_SECS)
        .max(MIN_INTERVAL_SECS);
    upsert_watcher_row(db, &repo_path, interval, true, input.base_branch.as_deref())?;
    let watcher = read_watcher_row(db, &repo_path)?
        .ok_or_else(|| "watcher row missing after upsert".to_string())?;
    let mut receipt = TrexWatcherReceipt::empty(
        "enable",
        "Watcher configuration saved. The host app owns scheduling while it is open.",
    );
    receipt.watcher = Some(watcher);
    Ok(receipt)
}

pub fn disable_trex_watcher_headless(
    db: &DbState,
    repo_path: &str,
) -> Result<TrexWatcherReceipt, String> {
    let repo_path = canonical_repo_path(repo_path)?;
    let existing = read_watcher_row(db, &repo_path)?
        .ok_or_else(|| format!("no watcher registered for {repo_path}"))?;
    set_watcher_enabled(db, &repo_path, false)?;
    let mut receipt = TrexWatcherReceipt::empty("disable", "Watcher scheduling disabled.");
    receipt.watcher = Some(TrexWatcher {
        enabled: false,
        ..existing
    });
    Ok(receipt)
}

pub fn list_trex_watchers_headless(db: &DbState) -> Result<TrexWatcherReceipt, String> {
    let watchers = list_watchers(db)?;
    let mut receipt = TrexWatcherReceipt::empty(
        "list",
        format!("{} watcher configuration(s)", watchers.len()),
    );
    receipt.watchers = watchers;
    Ok(receipt)
}

pub fn list_trex_pr_runs_headless(
    db: &DbState,
    repo_path: Option<&str>,
    limit: u32,
) -> Result<TrexWatcherReceipt, String> {
    let canonical = repo_path.map(canonical_repo_path).transpose()?;
    let runs = list_pr_runs(db, canonical.as_deref(), limit.clamp(1, 100))?;
    let mut receipt = TrexWatcherReceipt::empty("runs", format!("{} watcher run(s)", runs.len()));
    receipt.runs = runs;
    Ok(receipt)
}

/// Run one complete watcher poll in the foreground. This is intentionally not
/// a daemon: native macOS owns its app-lifetime schedule and each CLI process
/// remains alive until every newly discovered PR run has persisted a receipt.
pub async fn poll_trex_watcher_headless(
    db: &DbState,
    repo_path: &str,
) -> Result<TrexWatcherReceipt, String> {
    let repo_path = canonical_repo_path(repo_path)?;
    let watcher = read_watcher_row(db, &repo_path)?
        .ok_or_else(|| format!("no watcher registered for {repo_path}"))?;
    set_last_polled(db, &repo_path)?;
    let prs = match list_open_prs(&repo_path).await {
        Ok(prs) => prs,
        Err(error) => {
            set_last_error(db, &repo_path, &error)?;
            return Err(error);
        }
    };

    let inspected_prs = prs.len().min(MAX_PRS_PER_TICK) as u32;
    let mut skipped_unchanged = 0;
    let mut runs = Vec::new();
    for pr in prs.into_iter().take(MAX_PRS_PER_TICK) {
        if !pr_head_requires_run(
            latest_pr_run_sha(db, &repo_path, pr.number)?.as_deref(),
            &pr.head_sha,
        ) {
            skipped_unchanged += 1;
            continue;
        }
        let run = execute_pr_headless(db, &watcher, pr).await;
        insert_pr_run(db, &run)?;
        runs.push(run);
    }

    let mut receipt = TrexWatcherReceipt::empty(
        "poll",
        format!(
            "Inspected {inspected_prs} open PR(s); completed {} new run(s); skipped {skipped_unchanged} unchanged.",
            runs.len()
        ),
    );
    receipt.watcher = read_watcher_row(db, &repo_path)?;
    receipt.runs = runs;
    receipt.inspected_prs = inspected_prs;
    receipt.skipped_unchanged = skipped_unchanged;
    Ok(receipt)
}

/// Explicitly rerun one currently open PR even when its head SHA already has a
/// retained receipt. Automatic polls remain deduplicated; this separate command
/// is the recovery boundary for infrastructure-limited attempts.
pub async fn retry_trex_watcher_headless(
    db: &DbState,
    repo_path: &str,
    pr_number: i64,
) -> Result<TrexWatcherReceipt, String> {
    if pr_number <= 0 {
        return Err("watcher retry requires a positive PR number".to_string());
    }
    let repo_path = canonical_repo_path(repo_path)?;
    let watcher = read_watcher_row(db, &repo_path)?
        .ok_or_else(|| format!("no watcher registered for {repo_path}"))?;
    set_last_polled(db, &repo_path)?;
    let pr = list_open_prs(&repo_path)
        .await?
        .into_iter()
        .find(|pr| pr.number == pr_number)
        .ok_or_else(|| format!("PR #{pr_number} is not currently open for {repo_path}"))?;
    let run = execute_pr_headless(db, &watcher, pr).await;
    insert_pr_run(db, &run)?;

    let mut receipt = TrexWatcherReceipt::empty(
        "retry",
        format!(
            "Retried PR #{} at exact head {} and persisted one replacement attempt.",
            run.pr_number, run.head_sha
        ),
    );
    receipt.watcher = read_watcher_row(db, &repo_path)?;
    receipt.runs = vec![run];
    receipt.inspected_prs = 1;
    Ok(receipt)
}

fn pr_head_requires_run(latest_persisted_sha: Option<&str>, incoming_sha: &str) -> bool {
    latest_persisted_sha != Some(incoming_sha)
}

fn canonical_repo_path(repo_path: &str) -> Result<String, String> {
    let path = std::fs::canonicalize(repo_path)
        .map_err(|error| format!("repository {repo_path} is unavailable: {error}"))?;
    if !path.join(".git").exists() {
        return Err(format!("repository {repo_path} has no .git directory"));
    }
    Ok(path.to_string_lossy().into_owned())
}

async fn execute_pr_headless(db: &DbState, watcher: &TrexWatcher, pr: OpenPr) -> TrexPrRun {
    let token = resolve_github_token(db).await;
    let remote = remote_owner_repo(&watcher.repo_path).await.ok();
    if let (Some(token), Some((owner, repo))) = (token.as_deref(), remote.as_ref()) {
        let _ = post_status(
            token,
            owner,
            repo,
            &pr.head_sha,
            "pending",
            "T-Rex sandbox running…",
            None,
        )
        .await;
    }

    let started = std::time::Instant::now();
    let result = match materialize_pr_head(&watcher.repo_path, pr.number, &pr.head_sha).await {
        Ok(()) => {
            run_branch_sandbox_headless(
                db,
                SandboxRunInput {
                    repo_path: watcher.repo_path.clone(),
                    branch: pr.head_sha.clone(),
                    base_branch: watcher.base_branch.clone(),
                    review_id: None,
                    options: SandboxOptions::default(),
                },
            )
            .await
        }
        Err(error) => Err(format!(
            "PR #{} head {} could not be materialized: {error}",
            pr.number, pr.head_sha
        )),
    };
    let duration_ms = started.elapsed().as_millis() as i64;
    let (verdict, confidence, summary) = match result {
        Ok(result) => (result.verdict, result.confidence, result.summary),
        Err(error) => (
            "BLOCK".to_string(),
            0.0,
            format!("T-Rex sandbox failed to run: {error}"),
        ),
    };
    let (status_state, status_error) = match (token.as_deref(), remote.as_ref()) {
        (Some(token), Some((owner, repo))) => {
            let state = verdict_to_gh_state(&verdict);
            match post_status(
                token,
                owner,
                repo,
                &pr.head_sha,
                state,
                &truncate_for_status(&summary),
                None,
            )
            .await
            {
                Ok(()) => (Some(state.to_string()), None),
                Err(error) => (None, Some(error)),
            }
        }
        _ => (
            None,
            Some("missing github_token or remote — status not posted".to_string()),
        ),
    };
    TrexPrRun {
        id: uuid::Uuid::new_v4().to_string(),
        repo_path: watcher.repo_path.clone(),
        pr_number: pr.number,
        head_sha: pr.head_sha,
        verdict,
        confidence,
        summary,
        status_state,
        status_error,
        duration_ms,
        ran_at: chrono::Utc::now().to_rfc3339(),
    }
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_trex_watcher(
    app: AppHandle,
    db: State<'_, DbState>,
    handles: State<'_, WatcherHandles>,
    input: StartTrexWatcherInput,
) -> Result<TrexWatcher, String> {
    let interval = input
        .interval_secs
        .unwrap_or(DEFAULT_INTERVAL_SECS)
        .max(MIN_INTERVAL_SECS);

    upsert_watcher_row(
        &db,
        &input.repo_path,
        interval,
        true,
        input.base_branch.as_deref(),
    )?;
    spawn_watcher_task(
        &app,
        &handles,
        &input.repo_path,
        interval,
        input.base_branch.clone(),
    );
    read_watcher_row(&db, &input.repo_path)?
        .ok_or_else(|| "watcher row missing after upsert".to_string())
}

#[tauri::command]
pub async fn stop_trex_watcher(
    db: State<'_, DbState>,
    handles: State<'_, WatcherHandles>,
    repo_path: String,
) -> Result<(), String> {
    set_watcher_enabled(&db, &repo_path, false)?;
    if let Ok(mut map) = handles.0.lock() {
        if let Some(slot) = map.remove(&repo_path) {
            let _ = slot.cancel.send(());
            slot.handle.abort();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn list_trex_watchers(db: State<'_, DbState>) -> Result<Vec<TrexWatcher>, String> {
    list_watchers(&db)
}

#[tauri::command]
pub async fn list_trex_pr_runs(
    db: State<'_, DbState>,
    repo_path: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<TrexPrRun>, String> {
    list_pr_runs(&db, repo_path.as_deref(), limit.unwrap_or(50))
}

#[tauri::command]
pub async fn force_poll_trex_watcher(
    app: AppHandle,
    db: State<'_, DbState>,
    repo_path: String,
) -> Result<u32, String> {
    let row = read_watcher_row(&db, &repo_path)?
        .ok_or_else(|| format!("no watcher registered for {repo_path}"))?;
    let in_flight = Arc::new(Mutex::new(HashSet::<i64>::new()));
    let kicked = tick_once(&app, &db_state_from_app(&app), &row, &in_flight).await?;
    Ok(kicked)
}

// ─── Startup resume ─────────────────────────────────────────────────────────

/// Called from `main.rs::setup` after the DB is initialized. Re-spawns a
/// watcher task for every row in `trex_watchers` where `enabled = 1`.
pub fn resume_enabled_watchers(app: &AppHandle) {
    let db = app.state::<DbState>();
    let handles = app.state::<WatcherHandles>();
    let rows = match list_watchers(&db) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("[trex-watcher] resume: list_watchers failed: {e}");
            return;
        }
    };
    for w in rows.into_iter().filter(|w| w.enabled) {
        spawn_watcher_task(
            app,
            &handles,
            &w.repo_path,
            w.interval_secs,
            w.base_branch.clone(),
        );
    }
}

// ─── Watcher task ───────────────────────────────────────────────────────────

fn spawn_watcher_task(
    app: &AppHandle,
    handles: &State<'_, WatcherHandles>,
    repo_path: &str,
    interval_secs: u64,
    base_branch: Option<String>,
) {
    if let Ok(map) = handles.0.lock() {
        if map.contains_key(repo_path) {
            log::info!("[trex-watcher] {repo_path} already running");
            return;
        }
    }
    let (tx, rx) = oneshot::channel::<()>();
    let app_clone = app.clone();
    let repo_owned = repo_path.to_string();
    let base_owned = base_branch.clone();
    let interval = interval_secs.max(MIN_INTERVAL_SECS);

    let task = runtime_spawn(async move {
        let in_flight = Arc::new(Mutex::new(HashSet::<i64>::new()));
        let mut rx = rx;
        let mut ticker = tokio::time::interval(Duration::from_secs(interval));
        // Skip the immediate first tick from interval; we want a brief delay
        // so a freshly-started watcher doesn't slam the GitHub API at boot.
        ticker.tick().await;

        loop {
            tokio::select! {
                _ = &mut rx => {
                    log::info!("[trex-watcher] {repo_owned}: shutdown signal");
                    return;
                }
                _ = ticker.tick() => {
                    let db = db_state_from_app(&app_clone);
                    let row = match read_watcher_row(&db, &repo_owned) {
                        Ok(Some(r)) if r.enabled => r,
                        Ok(_) => {
                            log::info!("[trex-watcher] {repo_owned}: disabled, exiting");
                            return;
                        }
                        Err(e) => {
                            log::warn!("[trex-watcher] {repo_owned}: read_watcher: {e}");
                            continue;
                        }
                    };
                    let row = TrexWatcher { base_branch: row.base_branch.or(base_owned.clone()), ..row };
                    match tick_once(&app_clone, &db, &row, &in_flight).await {
                        Ok(n) => log::debug!("[trex-watcher] {repo_owned}: tick kicked {n} runs"),
                        Err(e) => log::warn!("[trex-watcher] {repo_owned}: tick error: {e}"),
                    }
                }
            }
        }
    });

    if let Ok(mut map) = handles.0.lock() {
        map.insert(
            repo_path.to_string(),
            WatcherSlot {
                handle: task,
                cancel: tx,
            },
        );
    }
}

async fn tick_once(
    app: &AppHandle,
    db: &DbState,
    watcher: &TrexWatcher,
    in_flight: &Arc<Mutex<HashSet<i64>>>,
) -> Result<u32, String> {
    set_last_polled(db, &watcher.repo_path)?;
    let prs = list_open_prs(&watcher.repo_path).await?;
    let mut kicked = 0;

    for pr in prs.into_iter().take(MAX_PRS_PER_TICK) {
        let pr_number = pr.number;
        let head_sha = pr.head_sha;
        // Skip if a previous tick already kicked this PR and it's still running.
        if let Ok(mut s) = in_flight.lock() {
            if s.contains(&pr_number) {
                continue;
            }
            s.insert(pr_number);
        }

        let last = latest_pr_run_sha(db, &watcher.repo_path, pr_number)?;
        if last.as_deref() == Some(head_sha.as_str()) {
            if let Ok(mut s) = in_flight.lock() {
                s.remove(&pr_number);
            }
            continue;
        }

        kicked += 1;

        let app_c = app.clone();
        let db_c = clone_db_state(db);
        let repo_path_c = watcher.repo_path.clone();
        let base_c = watcher.base_branch.clone();
        let in_flight_c = in_flight.clone();

        runtime_spawn(async move {
            let token = resolve_github_token(&db_c).await;
            let remote = remote_owner_repo(&repo_path_c).await.ok();
            if let (Some(tok), Some((owner, repo))) = (token.as_deref(), remote.as_ref()) {
                let _ = post_status(
                    tok,
                    owner,
                    repo,
                    &head_sha,
                    "pending",
                    "T-Rex sandbox running…",
                    None,
                )
                .await;
            }

            let started = std::time::Instant::now();
            let run = match materialize_pr_head(&repo_path_c, pr_number, &head_sha).await {
                Ok(()) => {
                    let input = SandboxRunInput {
                        repo_path: repo_path_c.clone(),
                        branch: head_sha.clone(),
                        base_branch: base_c,
                        review_id: None,
                        options: SandboxOptions::default(),
                    };
                    run_branch_sandbox_inner(app_c.clone(), &db_c, input).await
                }
                Err(error) => Err(format!(
                    "PR #{pr_number} head {head_sha} could not be materialized: {error}"
                )),
            };
            let duration_ms = started.elapsed().as_millis() as i64;

            let (verdict, confidence, summary, error) = match &run {
                Ok(r) => (r.verdict.clone(), r.confidence, r.summary.clone(), None),
                Err(e) => (
                    "BLOCK".to_string(),
                    0.0,
                    "T-Rex sandbox failed to run".to_string(),
                    Some(e.clone()),
                ),
            };

            let (state, status_err) = match (token.as_deref(), remote.as_ref()) {
                (Some(tok), Some((owner, repo))) => {
                    let gh_state = verdict_to_gh_state(&verdict);
                    let desc = truncate_for_status(&summary);
                    let res = post_status(tok, owner, repo, &head_sha, gh_state, &desc, None).await;
                    match res {
                        Ok(_) => (Some(gh_state.to_string()), None),
                        Err(e) => (None, Some(e)),
                    }
                }
                _ => (
                    None,
                    Some("missing github_token or remote — status not posted".into()),
                ),
            };

            let _ = insert_pr_run(
                &db_c,
                &TrexPrRun {
                    id: uuid::Uuid::new_v4().to_string(),
                    repo_path: repo_path_c,
                    pr_number,
                    head_sha,
                    verdict,
                    confidence,
                    summary: error.clone().unwrap_or(summary),
                    status_state: state,
                    status_error: status_err,
                    duration_ms,
                    ran_at: chrono::Utc::now().to_rfc3339(),
                },
            );

            if let Ok(mut s) = in_flight_c.lock() {
                s.remove(&pr_number);
            }
        });
    }
    Ok(kicked)
}

// ─── PR enumeration (gh CLI) ────────────────────────────────────────────────

struct OpenPr {
    number: i64,
    head_sha: String,
}

async fn list_open_prs(repo_path: &str) -> Result<Vec<OpenPr>, String> {
    let output = Command::new("gh")
        .args([
            "pr",
            "list",
            "--state",
            "open",
            "--json",
            "number,headRefOid",
            "--limit",
            "30",
        ])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| format!("gh pr list: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "gh pr list failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let v: Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("parse gh pr list: {e}"))?;
    let arr = v.as_array().cloned().unwrap_or_default();
    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let number = item.get("number").and_then(|x| x.as_i64()).unwrap_or(0);
        let head_sha = item
            .get("headRefOid")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        if number > 0 && is_full_git_sha(&head_sha) {
            out.push(OpenPr { number, head_sha });
        }
    }
    Ok(out)
}

fn is_full_git_sha(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Make GitHub's immutable PR head commit available to the local object database
/// without changing the user's branch, index, working tree, or durable refs.
async fn materialize_pr_head(
    repo_path: &str,
    pr_number: i64,
    head_sha: &str,
) -> Result<(), String> {
    if pr_number <= 0 || !is_full_git_sha(head_sha) {
        return Err("GitHub returned an invalid pull-request identity".to_string());
    }
    if git_commit_exists(repo_path, head_sha).await? {
        return Ok(());
    }

    let pull_ref = format!("+refs/pull/{pr_number}/head");
    let output = Command::new("git")
        .args([
            "fetch",
            "--no-tags",
            "--no-write-fetch-head",
            "origin",
            &pull_ref,
        ])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|error| format!("git fetch {pull_ref}: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "git fetch {pull_ref} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    if git_commit_exists(repo_path, head_sha).await? {
        Ok(())
    } else {
        Err(format!(
            "fetched PR #{pr_number}, but GitHub's declared head {head_sha} is unavailable"
        ))
    }
}

async fn git_commit_exists(repo_path: &str, head_sha: &str) -> Result<bool, String> {
    let commit = format!("{head_sha}^{{commit}}");
    let output = Command::new("git")
        .args(["cat-file", "-e", &commit])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|error| format!("git cat-file {head_sha}: {error}"))?;
    Ok(output.status.success())
}

async fn remote_owner_repo(repo_path: &str) -> Result<(String, String), String> {
    let output = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| format!("git remote: {e}"))?;
    if !output.status.success() {
        return Err("no origin remote".into());
    }
    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse_owner_repo(&url).ok_or_else(|| format!("could not parse owner/repo from {url}"))
}

fn parse_owner_repo(url: &str) -> Option<(String, String)> {
    // Accept both git@github.com:owner/repo(.git) and https://github.com/owner/repo(.git)
    let stripped = url.trim_end_matches('/').trim_end_matches(".git");
    let tail = if let Some(rest) = stripped.strip_prefix("git@github.com:") {
        rest.to_string()
    } else {
        let idx = stripped.find("github.com/")?;
        stripped[idx + "github.com/".len()..].to_string()
    };
    let mut parts = tail.splitn(2, '/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();
    if owner.is_empty() || repo.is_empty() {
        None
    } else {
        Some((owner, repo))
    }
}

// ─── GitHub status check ────────────────────────────────────────────────────

async fn post_status(
    token: &str,
    owner: &str,
    repo: &str,
    sha: &str,
    state: &str,
    description: &str,
    target_url: Option<&str>,
) -> Result<(), String> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/statuses/{sha}");
    let mut body = serde_json::Map::new();
    body.insert("state".into(), Value::String(state.into()));
    body.insert("context".into(), Value::String(STATUS_CONTEXT.into()));
    body.insert("description".into(), Value::String(description.into()));
    if let Some(t) = target_url {
        body.insert("target_url".into(), Value::String(t.into()));
    }
    let client = reqwest::Client::builder()
        .user_agent("CodeVetter/trex-watcher")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("reqwest build: {e}"))?;
    let resp = client
        .post(&url)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&Value::Object(body))
        .send()
        .await
        .map_err(|e| format!("status post: {e}"))?;
    if !resp.status().is_success() {
        let code = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("status {code}: {txt}"));
    }
    Ok(())
}

fn verdict_to_gh_state(verdict: &str) -> &'static str {
    match verdict {
        "APPROVE" => "success",
        "NEEDS_REVIEW" => "pending",
        _ => "failure",
    }
}

fn truncate_for_status(s: &str) -> String {
    // GitHub limits description to 140 chars.
    if s.chars().count() <= 140 {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(137).collect();
        out.push('…');
        out
    }
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

fn db_state_from_app(app: &AppHandle) -> DbState {
    let st = app.state::<DbState>();
    DbState(st.0.clone())
}

fn clone_db_state(db: &DbState) -> DbState {
    DbState(db.0.clone())
}

fn upsert_watcher_row(
    db: &DbState,
    repo_path: &str,
    interval_secs: u64,
    enabled: bool,
    base_branch: Option<&str>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO trex_watchers (repo_path, interval_secs, enabled, base_branch)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(repo_path) DO UPDATE SET
            interval_secs = excluded.interval_secs,
            enabled       = excluded.enabled,
            base_branch   = COALESCE(excluded.base_branch, trex_watchers.base_branch),
            last_error    = NULL",
        params![
            repo_path,
            interval_secs as i64,
            if enabled { 1 } else { 0 },
            base_branch
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn set_watcher_enabled(db: &DbState, repo_path: &str, enabled: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE trex_watchers SET enabled = ?1 WHERE repo_path = ?2",
        params![if enabled { 1 } else { 0 }, repo_path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn set_last_polled(db: &DbState, repo_path: &str) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE trex_watchers SET last_polled_at = datetime('now'), last_error = NULL WHERE repo_path = ?1",
        params![repo_path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn set_last_error(db: &DbState, repo_path: &str, error: &str) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE trex_watchers SET last_error = ?1 WHERE repo_path = ?2",
        params![error, repo_path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn read_watcher_row(db: &DbState, repo_path: &str) -> Result<Option<TrexWatcher>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT repo_path, interval_secs, enabled, base_branch, last_polled_at, last_error, created_at
         FROM trex_watchers WHERE repo_path = ?1",
        params![repo_path],
        row_to_watcher,
    );
    match result {
        Ok(w) => Ok(Some(w)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn list_watchers(db: &DbState) -> Result<Vec<TrexWatcher>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT repo_path, interval_secs, enabled, base_branch, last_polled_at, last_error, created_at
             FROM trex_watchers ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_watcher)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn row_to_watcher(row: &rusqlite::Row<'_>) -> rusqlite::Result<TrexWatcher> {
    Ok(TrexWatcher {
        repo_path: row.get(0)?,
        interval_secs: row.get::<_, i64>(1)? as u64,
        enabled: row.get::<_, i64>(2)? != 0,
        base_branch: row.get(3)?,
        last_polled_at: row.get(4)?,
        last_error: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn latest_pr_run_sha(
    db: &DbState,
    repo_path: &str,
    pr_number: i64,
) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT head_sha FROM trex_pr_runs
         WHERE repo_path = ?1 AND pr_number = ?2
         ORDER BY ran_at DESC LIMIT 1",
        params![repo_path, pr_number],
        |r| r.get::<_, String>(0),
    );
    match result {
        Ok(s) => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn insert_pr_run(db: &DbState, run: &TrexPrRun) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO trex_pr_runs (
            id, repo_path, pr_number, head_sha, verdict, confidence,
            summary, status_state, status_error, duration_ms, ran_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            run.id,
            run.repo_path,
            run.pr_number,
            run.head_sha,
            run.verdict,
            run.confidence,
            run.summary,
            run.status_state,
            run.status_error,
            run.duration_ms,
            run.ran_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn list_pr_runs(
    db: &DbState,
    repo_path: Option<&str>,
    limit: u32,
) -> Result<Vec<TrexPrRun>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = if repo_path.is_some() {
        "SELECT id, repo_path, pr_number, head_sha, verdict, confidence, summary,
                status_state, status_error, duration_ms, ran_at
         FROM trex_pr_runs WHERE repo_path = ?1
         ORDER BY ran_at DESC LIMIT ?2"
    } else {
        "SELECT id, repo_path, pr_number, head_sha, verdict, confidence, summary,
                status_state, status_error, duration_ms, ran_at
         FROM trex_pr_runs ORDER BY ran_at DESC LIMIT ?1"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let mapper = |row: &rusqlite::Row<'_>| -> rusqlite::Result<TrexPrRun> {
        Ok(TrexPrRun {
            id: row.get(0)?,
            repo_path: row.get(1)?,
            pr_number: row.get(2)?,
            head_sha: row.get(3)?,
            verdict: row.get(4)?,
            confidence: row.get(5)?,
            summary: row.get(6)?,
            status_state: row.get(7)?,
            status_error: row.get(8)?,
            duration_ms: row.get(9)?,
            ran_at: row.get(10)?,
        })
    };
    let rows: Vec<TrexPrRun> = if let Some(rp) = repo_path {
        stmt.query_map(params![rp, limit as i64], mapper)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect()
    } else {
        stmt.query_map(params![limit as i64], mapper)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect()
    };
    Ok(rows)
}

async fn resolve_github_token(db: &DbState) -> Option<String> {
    let saved = read_github_token(db);
    let gh_env = std::env::var("GH_TOKEN").ok();
    let github_env = std::env::var("GITHUB_TOKEN").ok();
    if let Some(token) = first_non_empty_token([saved, gh_env, github_env]) {
        return Some(token);
    }

    let output = Command::new("gh")
        .args(["auth", "token"])
        .output()
        .await
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|token| !token.is_empty())
}

fn first_non_empty_token(candidates: impl IntoIterator<Item = Option<String>>) -> Option<String> {
    candidates
        .into_iter()
        .flatten()
        .find(|candidate| !candidate.trim().is_empty())
}

fn read_github_token(db: &DbState) -> Option<String> {
    let conn = db.0.lock().ok()?;
    read_pref(&conn, PREF_GITHUB_TOKEN)
}

fn read_pref(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM preferences WHERE key = ?1",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn test_db() -> DbState {
        let connection = Connection::open_in_memory().expect("open test database");
        connection
            .execute_batch(
                "CREATE TABLE trex_watchers (
                    repo_path TEXT PRIMARY KEY,
                    interval_secs INTEGER NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    base_branch TEXT,
                    last_polled_at TEXT,
                    last_error TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                 );
                 CREATE TABLE trex_pr_runs (
                    id TEXT PRIMARY KEY,
                    repo_path TEXT NOT NULL,
                    pr_number INTEGER NOT NULL,
                    head_sha TEXT NOT NULL,
                    verdict TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    summary TEXT NOT NULL,
                    status_state TEXT,
                    status_error TEXT,
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    ran_at TEXT NOT NULL DEFAULT (datetime('now'))
                 );",
            )
            .expect("create watcher schema");
        DbState(Arc::new(Mutex::new(connection)))
    }

    #[test]
    fn owner_repo_from_https() {
        assert_eq!(
            parse_owner_repo("https://github.com/Acme/Widget.git"),
            Some(("Acme".into(), "Widget".into()))
        );
        assert_eq!(
            parse_owner_repo("https://github.com/Acme/Widget"),
            Some(("Acme".into(), "Widget".into()))
        );
    }

    #[test]
    fn owner_repo_from_ssh() {
        assert_eq!(
            parse_owner_repo("git@github.com:Acme/Widget.git"),
            Some(("Acme".into(), "Widget".into()))
        );
    }

    #[test]
    fn owner_repo_rejects_other_hosts() {
        assert_eq!(parse_owner_repo("https://gitlab.com/x/y.git"), None);
        assert_eq!(parse_owner_repo("bogus"), None);
    }

    #[test]
    fn verdict_state_mapping() {
        assert_eq!(verdict_to_gh_state("APPROVE"), "success");
        assert_eq!(verdict_to_gh_state("NEEDS_REVIEW"), "pending");
        assert_eq!(verdict_to_gh_state("BLOCK"), "failure");
        assert_eq!(verdict_to_gh_state("OTHER"), "failure");
    }

    #[test]
    fn truncate_short() {
        assert_eq!(truncate_for_status("hi"), "hi");
    }

    #[test]
    fn truncate_long() {
        let s = "x".repeat(200);
        let out = truncate_for_status(&s);
        assert_eq!(out.chars().count(), 138); // 137 + '…'
        assert!(out.ends_with('…'));
    }

    #[test]
    fn headless_configuration_is_persisted_and_disable_is_explicit() {
        let repository = tempfile::tempdir().expect("temporary repository");
        std::fs::create_dir(repository.path().join(".git")).expect("fake git directory");
        let db = test_db();

        let enabled = enable_trex_watcher_headless(
            &db,
            StartTrexWatcherInput {
                repo_path: repository.path().to_string_lossy().into_owned(),
                interval_secs: Some(10),
                base_branch: Some("main".to_string()),
            },
        )
        .expect("enable watcher");
        let watcher = enabled.watcher.expect("watcher receipt");
        assert!(watcher.enabled);
        assert_eq!(watcher.interval_secs, MIN_INTERVAL_SECS);
        assert_eq!(watcher.base_branch.as_deref(), Some("main"));

        let listed = list_trex_watchers_headless(&db).expect("list watchers");
        assert_eq!(listed.watchers.len(), 1);
        assert_eq!(listed.schema_version, 1);

        let disabled =
            disable_trex_watcher_headless(&db, &watcher.repo_path).expect("disable watcher");
        assert_eq!(disabled.operation, "disable");
        assert!(!disabled.watcher.expect("disabled watcher").enabled);
    }

    #[test]
    fn watcher_runs_new_and_updated_pr_heads_but_skips_unchanged_heads() {
        assert!(pr_head_requires_run(None, "new-head"));
        assert!(pr_head_requires_run(Some("previous-head"), "updated-head"));
        assert!(!pr_head_requires_run(Some("same-head"), "same-head"));
    }

    #[test]
    fn watcher_accepts_only_exact_git_commit_identities() {
        assert!(is_full_git_sha("0123456789abcdef0123456789abcdef01234567"));
        assert!(is_full_git_sha("ABCDEF0123456789ABCDEF0123456789ABCDEF01"));
        assert!(!is_full_git_sha("main"));
        assert!(!is_full_git_sha("0123456789abcdef0123456789abcdef0123456"));
        assert!(!is_full_git_sha(
            "../../0123456789abcdef0123456789abcdef0123"
        ));
    }

    #[test]
    fn watcher_token_resolution_ignores_empty_candidates() {
        assert_eq!(
            first_non_empty_token([
                None,
                Some("  ".to_string()),
                Some("gho_fixture".to_string()),
            ]),
            Some("gho_fixture".to_string())
        );
        assert_eq!(first_non_empty_token([None, Some(String::new())]), None);
    }

    #[tokio::test]
    async fn watcher_materializes_an_exact_pr_head_without_changing_the_checkout() {
        let remote = tempfile::tempdir().expect("bare remote");
        run_git(remote.path(), &["init", "--bare"]);

        let seed = tempfile::tempdir().expect("seed repository");
        run_git(seed.path(), &["init"]);
        run_git(seed.path(), &["config", "user.name", "CodeVetter Test"]);
        run_git(
            seed.path(),
            &["config", "user.email", "codevetter@example.test"],
        );
        std::fs::write(seed.path().join("fixture.txt"), "main\n").expect("main fixture");
        run_git(seed.path(), &["add", "fixture.txt"]);
        run_git(seed.path(), &["commit", "-m", "main"]);
        run_git(seed.path(), &["branch", "-M", "main"]);
        run_git(
            seed.path(),
            &["remote", "add", "origin", &remote.path().to_string_lossy()],
        );
        run_git(seed.path(), &["push", "origin", "main"]);
        run_git(remote.path(), &["symbolic-ref", "HEAD", "refs/heads/main"]);

        std::fs::write(seed.path().join("fixture.txt"), "pull request\n").expect("PR fixture");
        run_git(seed.path(), &["commit", "-am", "pull request"]);
        let head_sha = git_stdout(seed.path(), &["rev-parse", "HEAD"]);
        run_git(seed.path(), &["push", "origin", "HEAD:refs/pull/7/head"]);

        let checkout_parent = tempfile::tempdir().expect("checkout parent");
        let checkout = checkout_parent.path().join("checkout");
        let remote_url = format!("file://{}", remote.path().display());
        run_git(
            checkout_parent.path(),
            &[
                "clone",
                "--branch",
                "main",
                "--single-branch",
                &remote_url,
                &checkout.to_string_lossy(),
            ],
        );
        let before_head = git_stdout(&checkout, &["rev-parse", "HEAD"]);
        assert!(!git_commit_exists(&checkout.to_string_lossy(), &head_sha)
            .await
            .expect("inspect missing PR head"));

        materialize_pr_head(&checkout.to_string_lossy(), 7, &head_sha)
            .await
            .expect("materialize exact PR head");

        assert!(git_commit_exists(&checkout.to_string_lossy(), &head_sha)
            .await
            .expect("inspect fetched PR head"));
        assert_eq!(git_stdout(&checkout, &["rev-parse", "HEAD"]), before_head);
        assert!(git_stdout(&checkout, &["status", "--porcelain"]).is_empty());
        assert!(!checkout.join(".git").join("FETCH_HEAD").exists());
    }

    fn run_git(cwd: &Path, args: &[&str]) {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("run git command");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_stdout(cwd: &Path, args: &[&str]) -> String {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("run git command");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    #[test]
    fn headless_run_listing_is_bounded_and_repo_scoped() {
        let repository = tempfile::tempdir().expect("temporary repository");
        std::fs::create_dir(repository.path().join(".git")).expect("fake git directory");
        let repo_path = canonical_repo_path(&repository.path().to_string_lossy())
            .expect("canonical repository");
        let db = test_db();
        for index in 0..3 {
            insert_pr_run(
                &db,
                &TrexPrRun {
                    id: format!("run-{index}"),
                    repo_path: repo_path.clone(),
                    pr_number: 42,
                    head_sha: format!("sha-{index}"),
                    verdict: "APPROVE".to_string(),
                    confidence: 1.0,
                    summary: "qualified".to_string(),
                    status_state: Some("success".to_string()),
                    status_error: None,
                    duration_ms: 10,
                    ran_at: format!("2026-09-01T00:00:0{index}Z"),
                },
            )
            .expect("insert run");
        }
        let receipt =
            list_trex_pr_runs_headless(&db, Some(&repo_path), 2).expect("list bounded runs");
        assert_eq!(receipt.runs.len(), 2);
        assert!(receipt.runs.iter().all(|run| run.repo_path == repo_path));
    }
}
