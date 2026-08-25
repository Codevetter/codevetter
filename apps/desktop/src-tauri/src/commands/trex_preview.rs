//! T-Rex direct verification for an exact repository change and deployed preview.
//!
//! The first slice is intentionally narrow: one already-selected repository,
//! one GitHub PR URL or local Git range, and one read-only HTTP(S) preview.

#[cfg(feature = "browser-agent")]
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use reqwest::header::HeaderMap;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tokio::process::Command;

#[cfg(feature = "browser-agent")]
use crate::agent::browser::{Browser, SnapshotOpts};
#[cfg(not(feature = "browser-agent"))]
use crate::commands::synthetic_qa::run_synthetic_qa;
use crate::commands::synthetic_qa::SyntheticQaRunResult;
#[cfg(feature = "browser-agent")]
use crate::commands::synthetic_qa::SyntheticQaTrace;
use crate::DbState;

const MAX_COMMAND_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_CHANGED_PATHS: usize = 500;
const MAX_COMMITS: usize = 500;
const MAX_ROUTES: usize = 6;
const MAX_LIMITATIONS: usize = 24;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const PREVIEW_TIMEOUT: Duration = Duration::from_secs(20);
const REVISION_HEADERS: [&str; 5] = [
    "x-commit-sha",
    "x-git-commit",
    "x-git-sha",
    "x-vercel-git-commit-sha",
    "x-codevetter-revision",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrexChangeKind {
    PullRequest,
    Range,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrexPreviewRunInput {
    pub repo_path: String,
    pub change_kind: TrexChangeKind,
    pub change: String,
    pub preview_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TrexSourceReceipt {
    pub kind: TrexChangeKind,
    pub input: String,
    pub base_sha: String,
    pub head_sha: String,
    pub commits: Vec<String>,
    pub changed_paths: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrexPreviewIdentityStatus {
    Verified,
    Claimed,
    Mismatch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TrexPreviewIdentity {
    pub status: TrexPreviewIdentityStatus,
    pub requested_url: String,
    pub final_url: String,
    pub revision: Option<String>,
    pub evidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TrexPreviewRoute {
    pub route: String,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrexPreviewVerdict {
    PassedWithLimits,
    Failed,
    NoConfidence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrexPreviewReceipt {
    pub schema_version: u32,
    pub run_id: String,
    pub repo_path: String,
    pub source: TrexSourceReceipt,
    pub preview: TrexPreviewIdentity,
    pub routes: Vec<TrexPreviewRoute>,
    pub journeys: Vec<SyntheticQaRunResult>,
    pub verdict: TrexPreviewVerdict,
    pub summary: String,
    pub limitations: Vec<String>,
    pub duration_ms: u64,
    pub ran_at: String,
}

#[derive(Debug, Clone)]
struct ParsedPullRequest {
    owner: String,
    repo: String,
    number: u64,
    canonical_url: String,
}

#[derive(Debug, Clone)]
struct ParsedRange {
    base: String,
    head: String,
    expression: String,
}

#[derive(Debug, Deserialize)]
struct GithubPullRequest {
    base: GithubPullRequestSide,
    head: GithubPullRequestSide,
    commits: usize,
    changed_files: usize,
}

#[derive(Debug, Deserialize)]
struct GithubPullRequestSide {
    sha: String,
}

#[derive(Debug, Deserialize)]
struct GithubCommit {
    sha: String,
}

#[tauri::command]
pub async fn run_trex_preview_verification(
    app: AppHandle,
    db: State<'_, DbState>,
    input: TrexPreviewRunInput,
) -> Result<TrexPreviewReceipt, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("T-Rex could not resolve app data: {error}"))?;
    execute_trex_preview(input, &db, app_data_dir, Some(app)).await
}

pub async fn execute_trex_preview(
    input: TrexPreviewRunInput,
    db: &DbState,
    app_data_dir: PathBuf,
    app: Option<AppHandle>,
) -> Result<TrexPreviewReceipt, String> {
    let started = Instant::now();
    validate_repo_path(&input.repo_path).await?;
    let preview_url = parse_preview_url(&input.preview_url)?;
    let source = match input.change_kind {
        TrexChangeKind::PullRequest => {
            resolve_pull_request(&input.repo_path, input.change.trim()).await?
        }
        TrexChangeKind::Range => resolve_range(&input.repo_path, input.change.trim()).await?,
    };
    let (routes, mut limitations) = derive_routes(&source.changed_paths);
    let preview = probe_preview_identity(&preview_url, &source.head_sha).await?;
    let run_id = format!("trex-preview-{}", uuid::Uuid::new_v4());
    let artifact_dir = app_data_dir.join("synthetic-qa").join(&run_id);

    let mut journeys = Vec::new();
    if preview.status != TrexPreviewIdentityStatus::Mismatch {
        let execution = run_preview_journeys(
            app,
            &preview.final_url,
            &routes,
            &input.repo_path,
            &artifact_dir,
        )
        .await;
        journeys = execution.journeys;
        if let Some(error) = execution.error {
            limitations.push(error);
        }
    }

    if preview.status == TrexPreviewIdentityStatus::Claimed {
        limitations.push(
            "The preview exposed no supported revision header, so its link to the change head is unproven."
                .into(),
        );
    } else if preview.status == TrexPreviewIdentityStatus::Mismatch {
        limitations.push(
            "The preview revision does not match the resolved change head; browser journeys were not run."
                .into(),
        );
    }
    limitations.truncate(MAX_LIMITATIONS);

    let verdict = aggregate_verdict(&preview, &routes, &journeys, &limitations);
    let summary = verdict_summary(verdict, &preview, routes.len(), &journeys);
    let receipt = TrexPreviewReceipt {
        schema_version: 1,
        run_id,
        repo_path: input.repo_path,
        source,
        preview,
        routes,
        journeys,
        verdict,
        summary,
        limitations,
        duration_ms: started.elapsed().as_millis() as u64,
        ran_at: chrono::Utc::now().to_rfc3339(),
    };
    insert_preview_run(db, &receipt)?;
    Ok(receipt)
}

#[tauri::command]
pub async fn list_trex_preview_runs(
    db: State<'_, DbState>,
    repo_path: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<TrexPreviewReceipt>, String> {
    read_preview_runs(&db, repo_path.as_deref(), limit.unwrap_or(20).clamp(1, 50))
}

struct JourneyExecution {
    journeys: Vec<SyntheticQaRunResult>,
    error: Option<String>,
}

#[cfg(not(feature = "browser-agent"))]
async fn run_preview_journeys(
    app: Option<AppHandle>,
    preview_url: &str,
    routes: &[TrexPreviewRoute],
    repo_path: &str,
    _artifact_dir: &Path,
) -> JourneyExecution {
    let Some(app) = app else {
        return JourneyExecution {
            journeys: Vec::new(),
            error: Some(
                "Preview journeys could not execute: this build has no browser adapter.".into(),
            ),
        };
    };
    let mut journeys = Vec::new();
    for selected in routes {
        let result = run_synthetic_qa(
            app.clone(),
            preview_url.to_string(),
            Some("generic-page-smoke".into()),
            Some("playwright_builtin".into()),
            Some(format!(
                "T-Rex change-preview smoke selected from {}",
                selected.reason
            )),
            None,
            Some("none".into()),
            None,
            Some(selected.route.clone()),
            Some(repo_path.to_string()),
            None,
            Some(true),
            Some("retain-on-failure".into()),
        )
        .await;
        match result {
            Ok(run) => journeys.push(run),
            Err(error) => {
                return JourneyExecution {
                    journeys,
                    error: Some(format!(
                        "Preview journey {} could not execute: {error}",
                        selected.route
                    )),
                };
            }
        }
    }
    JourneyExecution {
        journeys,
        error: None,
    }
}

#[cfg(feature = "browser-agent")]
async fn run_preview_journeys(
    _app: Option<AppHandle>,
    preview_url: &str,
    routes: &[TrexPreviewRoute],
    _repo_path: &str,
    artifact_dir: &Path,
) -> JourneyExecution {
    let browser = match Browser::launch().await {
        Ok(browser) => browser,
        Err(error) => {
            return JourneyExecution {
                journeys: Vec::new(),
                error: Some(format!("Preview journeys could not execute: {error}")),
            };
        }
    };
    let mut journeys = Vec::new();
    let mut execution_error = None;

    for selected in routes {
        let started = Instant::now();
        let target_url = preview_route_url(preview_url, &selected.route);
        match browser.generic_page_smoke(&target_url).await {
            Ok(smoke) => {
                let response_failed = smoke
                    .response_status
                    .is_some_and(|status| !(200..400).contains(&status));
                let pass = smoke.body_visible
                    && smoke.body_text_present
                    && !response_failed
                    && smoke.console_errors.is_empty();
                let mut failures = Vec::new();
                if !smoke.body_visible {
                    failures.push("page body was not visible".to_string());
                }
                if !smoke.body_text_present {
                    failures.push("page body contained no visible text".to_string());
                }
                if response_failed {
                    failures.push(format!(
                        "navigation returned HTTP {}",
                        smoke.response_status.unwrap_or_default()
                    ));
                }
                if !smoke.console_errors.is_empty() {
                    failures.push(format!(
                        "{} unexpected console error(s)",
                        smoke.console_errors.len()
                    ));
                }
                let mut screenshot_path = None;
                let mut artifacts = Vec::new();
                if !pass {
                    let screenshot = artifact_dir
                        .join(route_artifact_name(&selected.route))
                        .join("failure.jpg");
                    if std::fs::create_dir_all(screenshot.parent().unwrap_or(artifact_dir)).is_ok()
                    {
                        if browser
                            .snapshot(SnapshotOpts {
                                screenshot_path: Some(&screenshot),
                                max_elements: 0,
                            })
                            .await
                            .is_ok()
                        {
                            screenshot_path = Some(screenshot.to_string_lossy().into_owned());
                            artifacts.push(screenshot.to_string_lossy().into_owned());
                        }
                    }
                }
                let duration_ms = started.elapsed().as_millis() as u64;
                let mut stage_timings_ms = BTreeMap::new();
                stage_timings_ms.insert("native_navigation_and_probe".into(), duration_ms as f64);
                journeys.push(SyntheticQaRunResult {
                    loop_id: "generic-page-smoke".into(),
                    route: selected.route.clone(),
                    goal: format!(
                        "T-Rex change-preview smoke selected from {}",
                        selected.reason
                    ),
                    pass,
                    notes: if pass {
                        format!(
                            "Loaded {} with visible content and no unexpected console errors.",
                            smoke.final_url
                        )
                    } else {
                        format!("Loaded {} but {}.", smoke.final_url, failures.join("; "))
                    },
                    screenshot_path,
                    artifacts,
                    duration_ms,
                    trace: SyntheticQaTrace {
                        final_url: smoke.final_url,
                        page_title: smoke.title,
                        console_errors: smoke.console_errors,
                        stage_timings_ms,
                        runner_rss_bytes: None,
                    },
                    error: if pass {
                        None
                    } else {
                        Some(failures.join("; "))
                    },
                    runner_type: Some("chromiumoxide_builtin".into()),
                });
            }
            Err(error) => {
                execution_error = Some(format!(
                    "Preview journey {} could not execute: {error}",
                    selected.route
                ));
                break;
            }
        }
    }

    if let Err(error) = browser.close().await {
        execution_error.get_or_insert_with(|| {
            format!("Preview browser cleanup could not execute completely: {error}")
        });
    }
    JourneyExecution {
        journeys,
        error: execution_error,
    }
}

#[cfg(feature = "browser-agent")]
fn preview_route_url(preview_url: &str, route: &str) -> String {
    if route == "/" {
        return format!("{}/", preview_url.trim_end_matches('/'));
    }
    format!(
        "{}/{}",
        preview_url.trim_end_matches('/'),
        route.trim_start_matches('/')
    )
}

#[cfg(feature = "browser-agent")]
fn route_artifact_name(route: &str) -> String {
    let normalized = route
        .trim_matches('/')
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    if normalized.is_empty() {
        "root".into()
    } else {
        normalized
    }
}

async fn validate_repo_path(repo_path: &str) -> Result<(), String> {
    if repo_path.trim().is_empty() {
        return Err("A selected repository is required.".into());
    }
    let metadata = tokio::fs::metadata(repo_path)
        .await
        .map_err(|_| "The selected repository is unavailable.".to_string())?;
    if !metadata.is_dir() {
        return Err("The selected repository is not a directory.".into());
    }
    let result = run_bounded_command("git", &["rev-parse", "--show-toplevel"], repo_path).await?;
    if !result.status_success {
        return Err("The selected project is not a readable Git repository.".into());
    }
    Ok(())
}

fn parse_pull_request_url(value: &str) -> Result<ParsedPullRequest, String> {
    let url = reqwest::Url::parse(value.trim())
        .map_err(|_| "Enter a canonical GitHub pull request URL.".to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Enter a canonical https://github.com/<owner>/<repo>/pull/<number> URL.".into(),
        );
    }
    let segments = url
        .path_segments()
        .map(|parts| parts.filter(|part| !part.is_empty()).collect::<Vec<_>>())
        .unwrap_or_default();
    if segments.len() != 4 || segments[2] != "pull" {
        return Err(
            "Enter a canonical https://github.com/<owner>/<repo>/pull/<number> URL.".into(),
        );
    }
    let number = segments[3]
        .parse::<u64>()
        .ok()
        .filter(|number| *number > 0)
        .ok_or_else(|| "The pull request number is invalid.".to_string())?;
    let owner = segments[0].to_string();
    let repo = segments[1].trim_end_matches(".git").to_string();
    if !safe_github_component(&owner) || !safe_github_component(&repo) {
        return Err("The pull request owner or repository is invalid.".into());
    }
    Ok(ParsedPullRequest {
        canonical_url: format!("https://github.com/{owner}/{repo}/pull/{number}"),
        owner,
        repo,
        number,
    })
}

fn parse_range(value: &str) -> Result<ParsedRange, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 512 || trimmed.chars().any(char::is_whitespace) {
        return Err("Enter one bounded Git range such as main..HEAD.".into());
    }
    let separator = if trimmed.matches("...").count() == 1 {
        "..."
    } else if trimmed.matches("..").count() == 1 {
        ".."
    } else {
        return Err("Enter exactly one Git range such as main..HEAD or main...HEAD.".into());
    };
    let mut parts = trimmed.split(separator);
    let base = parts.next().unwrap_or_default();
    let head = parts.next().unwrap_or_default();
    if parts.next().is_some() || !safe_revision(base) || !safe_revision(head) {
        return Err("The Git range contains an unsafe or unsupported revision.".into());
    }
    Ok(ParsedRange {
        base: base.into(),
        head: head.into(),
        expression: trimmed.into(),
    })
}

fn parse_preview_url(value: &str) -> Result<String, String> {
    let mut url = reqwest::Url::parse(value.trim())
        .map_err(|_| "Enter a valid HTTP(S) preview URL.".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Preview URLs must use HTTP(S) and cannot contain credentials.".into());
    }
    url.set_fragment(None);
    Ok(url.to_string().trim_end_matches('/').to_string())
}

async fn resolve_pull_request(repo_path: &str, value: &str) -> Result<TrexSourceReceipt, String> {
    let parsed = parse_pull_request_url(value)?;
    let remote = run_bounded_command("git", &["remote", "get-url", "origin"], repo_path).await?;
    if !remote.status_success {
        return Err("The selected repository has no readable origin remote.".into());
    }
    let (remote_owner, remote_repo) = parse_owner_repo(remote.stdout.trim()).ok_or_else(|| {
        "The selected repository origin is not a supported GitHub remote.".to_string()
    })?;
    if !remote_owner.eq_ignore_ascii_case(&parsed.owner)
        || !remote_repo.eq_ignore_ascii_case(&parsed.repo)
    {
        return Err(format!(
            "The pull request belongs to {}/{}, not the selected repository {}/{}.",
            parsed.owner, parsed.repo, remote_owner, remote_repo
        ));
    }

    let endpoint = format!(
        "repos/{}/{}/pulls/{}",
        parsed.owner, parsed.repo, parsed.number
    );
    let response = run_bounded_command("gh", &["api", &endpoint], repo_path).await?;
    if !response.status_success {
        return Err(format!(
            "GitHub could not resolve {}. Confirm gh authentication and PR access.",
            parsed.canonical_url
        ));
    }
    let pull: GithubPullRequest = serde_json::from_str(&response.stdout)
        .map_err(|_| "GitHub returned an invalid pull request response.".to_string())?;
    let base_sha = require_sha(&pull.base.sha)?;
    let head_sha = require_sha(&pull.head.sha)?;
    if pull.commits > MAX_COMMITS {
        return Err(format!(
            "The pull request exceeds the {MAX_COMMITS}-commit verification bound."
        ));
    }
    if pull.changed_files > MAX_CHANGED_PATHS {
        return Err(format!(
            "The pull request exceeds the {MAX_CHANGED_PATHS}-file verification bound."
        ));
    }

    let mut changed_paths = Vec::new();
    let file_pages = pull.changed_files.div_ceil(100);
    for page in 1..=file_pages {
        let files_endpoint = format!("{endpoint}/files?per_page=100&page={page}");
        let files_response =
            run_bounded_command("gh", &["api", &files_endpoint], repo_path).await?;
        if !files_response.status_success {
            return Err("GitHub could not resolve the pull request changed files.".into());
        }
        let files: Vec<Value> = serde_json::from_str(&files_response.stdout)
            .map_err(|_| "GitHub returned invalid pull request file data.".to_string())?;
        for file in files {
            let path = file
                .get("filename")
                .and_then(Value::as_str)
                .ok_or_else(|| "GitHub returned a changed file without a path.".to_string())?;
            changed_paths.push(normalize_repo_path(path)?);
        }
    }
    if changed_paths.len() != pull.changed_files {
        return Err("GitHub returned an incomplete pull request file list.".into());
    }

    let mut commits = Vec::new();
    let commit_pages = pull.commits.div_ceil(100);
    for page in 1..=commit_pages {
        let commits_endpoint = format!("{endpoint}/commits?per_page=100&page={page}");
        let commits_response =
            run_bounded_command("gh", &["api", &commits_endpoint], repo_path).await?;
        if !commits_response.status_success {
            return Err("GitHub could not resolve the pull request commits.".into());
        }
        let page_commits: Vec<GithubCommit> = serde_json::from_str(&commits_response.stdout)
            .map_err(|_| "GitHub returned invalid pull request commit data.".to_string())?;
        commits.extend(
            page_commits
                .into_iter()
                .map(|commit| require_sha(&commit.sha))
                .collect::<Result<Vec<_>, _>>()?,
        );
    }
    if commits.len() != pull.commits || commits.last() != Some(&head_sha) {
        return Err(
            "GitHub returned an incomplete or inconsistent pull request commit list.".into(),
        );
    }

    Ok(TrexSourceReceipt {
        kind: TrexChangeKind::PullRequest,
        input: parsed.canonical_url,
        base_sha,
        head_sha,
        commits,
        changed_paths: canonical_paths(changed_paths),
    })
}

pub async fn resolve_scope_change(
    repo_path: &str,
    value: &str,
) -> Result<TrexSourceReceipt, String> {
    if value.starts_with("https://") {
        resolve_pull_request(repo_path, value).await
    } else {
        resolve_range(repo_path, value).await
    }
}

async fn resolve_range(repo_path: &str, value: &str) -> Result<TrexSourceReceipt, String> {
    let parsed = parse_range(value)?;
    let base_sha = resolve_revision(repo_path, &parsed.base).await?;
    let head_sha = resolve_revision(repo_path, &parsed.head).await?;
    let commit_expression = format!("{base_sha}..{head_sha}");
    let commits_result = run_bounded_command(
        "git",
        &["rev-list", "--reverse", &commit_expression],
        repo_path,
    )
    .await?;
    if !commits_result.status_success {
        return Err("Git could not enumerate the selected commit range.".into());
    }
    let commits = commits_result
        .stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(require_sha)
        .collect::<Result<Vec<_>, _>>()?;
    if commits.len() > MAX_COMMITS {
        return Err(format!(
            "The selected range exceeds the {MAX_COMMITS}-commit verification bound."
        ));
    }

    let diff_expression = if parsed.expression.contains("...") {
        format!("{base_sha}...{head_sha}")
    } else {
        format!("{base_sha}..{head_sha}")
    };
    let paths_result = run_bounded_command(
        "git",
        &["diff", "--name-only", "-z", &diff_expression],
        repo_path,
    )
    .await?;
    if !paths_result.status_success {
        return Err("Git could not enumerate changed paths for the selected range.".into());
    }
    let changed_paths = paths_result
        .stdout
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(normalize_repo_path)
        .collect::<Result<Vec<_>, _>>()?;
    if changed_paths.len() > MAX_CHANGED_PATHS {
        return Err(format!(
            "The selected range exceeds the {MAX_CHANGED_PATHS}-file verification bound."
        ));
    }

    Ok(TrexSourceReceipt {
        kind: TrexChangeKind::Range,
        input: parsed.expression,
        base_sha,
        head_sha,
        commits,
        changed_paths: canonical_paths(changed_paths),
    })
}

async fn resolve_revision(repo_path: &str, revision: &str) -> Result<String, String> {
    let expression = format!("{revision}^{{commit}}");
    let result =
        run_bounded_command("git", &["rev-parse", "--verify", &expression], repo_path).await?;
    if !result.status_success {
        return Err(format!("Git revision `{revision}` could not be resolved."));
    }
    require_sha(result.stdout.trim())
}

fn derive_routes(changed_paths: &[String]) -> (Vec<TrexPreviewRoute>, Vec<String>) {
    let mut routes = vec![TrexPreviewRoute {
        route: "/".into(),
        reason: "Required root smoke".into(),
    }];
    let mut seen = BTreeSet::from(["/".to_string()]);
    let mut limitations = Vec::new();
    for changed_path in changed_paths {
        match route_for_path(changed_path) {
            RouteDerivation::Route(route) => {
                if seen.insert(route.clone()) && routes.len() < MAX_ROUTES {
                    routes.push(TrexPreviewRoute {
                        route,
                        reason: format!("Derived from {changed_path}"),
                    });
                }
            }
            RouteDerivation::Dynamic => {
                limitations.push(format!(
                    "Dynamic route values were not guessed for {changed_path}."
                ));
            }
            RouteDerivation::NotRoute => {}
        }
    }
    if seen.len() > routes.len() {
        limitations.push(format!(
            "Route selection exceeded the {MAX_ROUTES}-route execution bound."
        ));
    }
    limitations.truncate(MAX_LIMITATIONS);
    (routes, limitations)
}

enum RouteDerivation {
    Route(String),
    Dynamic,
    NotRoute,
}

fn route_for_path(path: &str) -> RouteDerivation {
    let normalized = path.trim_start_matches("./");
    let without_src = normalized.strip_prefix("src/").unwrap_or(normalized);
    let (prefix, mut relative) = if let Some(rest) = without_src.strip_prefix("pages/") {
        ("pages", rest)
    } else if let Some(rest) = without_src.strip_prefix("app/") {
        ("app", rest)
    } else if let Some(rest) = without_src.strip_prefix("routes/") {
        ("routes", rest)
    } else {
        return RouteDerivation::NotRoute;
    };
    if prefix == "pages" && relative.starts_with("api/") {
        return RouteDerivation::NotRoute;
    }
    if prefix == "app" {
        let Some(page_index) = relative.rfind("/page.") else {
            if relative.starts_with("page.") {
                relative = "";
            } else {
                return RouteDerivation::NotRoute;
            }
            return route_from_segments(relative);
        };
        relative = &relative[..page_index];
        return route_from_segments(relative);
    }
    relative = strip_extension(relative);
    if relative == "index" {
        relative = "";
    } else if let Some(stripped) = relative.strip_suffix("/index") {
        relative = stripped;
    }
    route_from_segments(relative)
}

fn route_from_segments(value: &str) -> RouteDerivation {
    let mut segments = Vec::new();
    for segment in value.split('/').filter(|segment| !segment.is_empty()) {
        if segment.starts_with('[') || segment.contains(']') {
            return RouteDerivation::Dynamic;
        }
        if segment.starts_with('(') && segment.ends_with(')') {
            continue;
        }
        if !segment
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        {
            return RouteDerivation::NotRoute;
        }
        segments.push(segment);
    }
    if segments.is_empty() {
        RouteDerivation::Route("/".into())
    } else {
        RouteDerivation::Route(format!("/{}", segments.join("/")))
    }
}

async fn probe_preview_identity(
    preview_url: &str,
    head_sha: &str,
) -> Result<TrexPreviewIdentity, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(PREVIEW_TIMEOUT)
        .user_agent("CodeVetter/T-Rex-preview")
        .build()
        .map_err(|_| "T-Rex could not initialize the preview identity probe.".to_string())?;
    let response = client
        .get(preview_url)
        .send()
        .await
        .map_err(|error| format!("The preview could not be reached: {error}"))?;
    if !response.status().is_success() && !response.status().is_redirection() {
        return Err(format!(
            "The preview returned HTTP {} before browser verification.",
            response.status()
        ));
    }
    let final_url = response.url().to_string().trim_end_matches('/').to_string();
    Ok(classify_preview_headers(
        preview_url,
        &final_url,
        response.headers(),
        head_sha,
    ))
}

fn classify_preview_headers(
    requested_url: &str,
    final_url: &str,
    headers: &HeaderMap,
    head_sha: &str,
) -> TrexPreviewIdentity {
    for name in REVISION_HEADERS {
        let Some(value) = headers.get(name).and_then(|value| value.to_str().ok()) else {
            continue;
        };
        let revision = value.trim().trim_matches('"').to_ascii_lowercase();
        if !is_sha(&revision) {
            continue;
        }
        let status = if revision.eq_ignore_ascii_case(head_sha) {
            TrexPreviewIdentityStatus::Verified
        } else {
            TrexPreviewIdentityStatus::Mismatch
        };
        return TrexPreviewIdentity {
            status,
            requested_url: requested_url.into(),
            final_url: final_url.into(),
            revision: Some(revision.clone()),
            evidence: format!("{name}: {revision}"),
        };
    }
    TrexPreviewIdentity {
        status: TrexPreviewIdentityStatus::Claimed,
        requested_url: requested_url.into(),
        final_url: final_url.into(),
        revision: None,
        evidence: "No supported revision header was returned.".into(),
    }
}

fn aggregate_verdict(
    preview: &TrexPreviewIdentity,
    routes: &[TrexPreviewRoute],
    journeys: &[SyntheticQaRunResult],
    limitations: &[String],
) -> TrexPreviewVerdict {
    if preview.status == TrexPreviewIdentityStatus::Mismatch
        || journeys.len() != routes.len()
        || limitations
            .iter()
            .any(|limitation| limitation.contains("could not execute"))
    {
        return TrexPreviewVerdict::NoConfidence;
    }
    if journeys.iter().any(|journey| !journey.pass) {
        return TrexPreviewVerdict::Failed;
    }
    TrexPreviewVerdict::PassedWithLimits
}

fn verdict_summary(
    verdict: TrexPreviewVerdict,
    preview: &TrexPreviewIdentity,
    route_count: usize,
    journeys: &[SyntheticQaRunResult],
) -> String {
    match verdict {
        TrexPreviewVerdict::PassedWithLimits => format!(
            "{route_count} preview route(s) passed; preview identity is {} and coverage remains bounded.",
            preview_status_label(preview.status)
        ),
        TrexPreviewVerdict::Failed => {
            let failed = journeys.iter().filter(|journey| !journey.pass).count();
            format!("{failed} of {route_count} preview route(s) failed executable smoke checks.")
        }
        TrexPreviewVerdict::NoConfidence => format!(
            "T-Rex could not produce complete change-preview evidence; preview identity is {}.",
            preview_status_label(preview.status)
        ),
    }
}

fn preview_status_label(status: TrexPreviewIdentityStatus) -> &'static str {
    match status {
        TrexPreviewIdentityStatus::Verified => "verified",
        TrexPreviewIdentityStatus::Claimed => "claimed",
        TrexPreviewIdentityStatus::Mismatch => "mismatched",
    }
}

fn insert_preview_run(db: &DbState, receipt: &TrexPreviewReceipt) -> Result<(), String> {
    let payload = serde_json::to_string(receipt)
        .map_err(|_| "T-Rex could not serialize the preview receipt.".to_string())?;
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO trex_preview_runs (
            id, repo_path, source_kind, source_input, base_sha, head_sha,
            preview_url, preview_identity, verdict, summary, receipt_json,
            duration_ms, ran_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            receipt.run_id,
            receipt.repo_path,
            source_kind_label(receipt.source.kind),
            receipt.source.input,
            receipt.source.base_sha,
            receipt.source.head_sha,
            receipt.preview.final_url,
            preview_status_label(receipt.preview.status),
            verdict_label(receipt.verdict),
            receipt.summary,
            payload,
            receipt.duration_ms as i64,
            receipt.ran_at,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn read_preview_runs(
    db: &DbState,
    repo_path: Option<&str>,
    limit: u32,
) -> Result<Vec<TrexPreviewReceipt>, String> {
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    let sql = if repo_path.is_some() {
        "SELECT receipt_json FROM trex_preview_runs
         WHERE repo_path = ?1 ORDER BY ran_at DESC LIMIT ?2"
    } else {
        "SELECT receipt_json FROM trex_preview_runs
         ORDER BY ran_at DESC LIMIT ?1"
    };
    let mut statement = conn.prepare(sql).map_err(|error| error.to_string())?;
    let mapper = |row: &rusqlite::Row<'_>| row.get::<_, String>(0);
    let payloads = if let Some(repo_path) = repo_path {
        statement
            .query_map(params![repo_path, limit as i64], mapper)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    } else {
        statement
            .query_map(params![limit as i64], mapper)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    payloads
        .into_iter()
        .map(|payload| {
            serde_json::from_str(&payload)
                .map_err(|_| "A persisted T-Rex preview receipt is invalid.".to_string())
        })
        .collect()
}

fn source_kind_label(kind: TrexChangeKind) -> &'static str {
    match kind {
        TrexChangeKind::PullRequest => "pull_request",
        TrexChangeKind::Range => "range",
    }
}

fn verdict_label(verdict: TrexPreviewVerdict) -> &'static str {
    match verdict {
        TrexPreviewVerdict::PassedWithLimits => "passed_with_limits",
        TrexPreviewVerdict::Failed => "failed",
        TrexPreviewVerdict::NoConfidence => "no_confidence",
    }
}

struct BoundedCommandOutput {
    status_success: bool,
    stdout: String,
}

async fn run_bounded_command(
    program: &str,
    args: &[&str],
    cwd: &str,
) -> Result<BoundedCommandOutput, String> {
    let child = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| format!("T-Rex could not start `{program}`."))?;
    let output = tokio::time::timeout(COMMAND_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| {
            format!(
                "`{program}` exceeded the {} second bound.",
                COMMAND_TIMEOUT.as_secs()
            )
        })?
        .map_err(|_| format!("T-Rex could not read `{program}` output."))?;
    validate_command_output_sizes(program, output.stdout.len(), output.stderr.len())?;
    Ok(BoundedCommandOutput {
        status_success: output.status.success(),
        stdout: String::from_utf8(output.stdout)
            .map_err(|_| format!("`{program}` returned non-UTF-8 output."))?,
    })
}

fn validate_command_output_sizes(
    program: &str,
    stdout_bytes: usize,
    stderr_bytes: usize,
) -> Result<(), String> {
    if stdout_bytes > MAX_COMMAND_OUTPUT_BYTES || stderr_bytes > MAX_COMMAND_OUTPUT_BYTES {
        return Err(format!(
            "`{program}` output exceeded the verifier byte limit."
        ));
    }
    Ok(())
}

fn safe_github_component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

fn safe_revision(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && !value.starts_with('-')
        && !value.contains("..")
        && value.chars().all(|ch| {
            ch.is_ascii_alphanumeric()
                || matches!(
                    ch,
                    '-' | '_' | '.' | '/' | '@' | '{' | '}' | '^' | '~' | ':'
                )
        })
}

fn require_sha(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    if is_sha(&normalized) {
        Ok(normalized)
    } else {
        Err("A resolved revision was not a full Git SHA.".into())
    }
}

fn is_sha(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn normalize_repo_path(value: &str) -> Result<String, String> {
    let normalized = value
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_string();
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.split('/').any(|segment| segment == "..")
        || normalized.chars().any(char::is_control)
        || normalized.len() > 4_096
    {
        return Err("A changed path was unsafe or invalid.".into());
    }
    Ok(normalized)
}

fn canonical_paths(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn strip_extension(value: &str) -> &str {
    value
        .rsplit_once('.')
        .map(|(without_extension, _)| without_extension)
        .unwrap_or(value)
}

fn parse_owner_repo(value: &str) -> Option<(String, String)> {
    let stripped = value.trim().trim_end_matches('/').trim_end_matches(".git");
    let tail = if let Some(rest) = stripped.strip_prefix("git@github.com:") {
        rest
    } else {
        let index = stripped.find("github.com/")?;
        &stripped[index + "github.com/".len()..]
    };
    let mut parts = tail.split('/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();
    if parts.next().is_some() || !safe_github_component(&owner) || !safe_github_component(&repo) {
        return None;
    }
    Some((owner, repo))
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue};
    use std::sync::{Arc, Mutex};

    fn sha(character: char) -> String {
        std::iter::repeat_n(character, 40).collect()
    }

    fn preview(status: TrexPreviewIdentityStatus) -> TrexPreviewIdentity {
        TrexPreviewIdentity {
            status,
            requested_url: "https://preview.example.com".into(),
            final_url: "https://preview.example.com".into(),
            revision: None,
            evidence: "fixture".into(),
        }
    }

    fn passing_journey(route: &str) -> SyntheticQaRunResult {
        SyntheticQaRunResult {
            loop_id: "generic-page-smoke".into(),
            route: route.into(),
            goal: "smoke".into(),
            pass: true,
            notes: "passed".into(),
            screenshot_path: None,
            artifacts: Vec::new(),
            duration_ms: 12,
            trace: crate::commands::synthetic_qa::SyntheticQaTrace {
                final_url: format!("https://preview.example.com{route}"),
                page_title: "Preview".into(),
                console_errors: Vec::new(),
                stage_timings_ms: Default::default(),
                runner_rss_bytes: None,
            },
            error: None,
            runner_type: Some("playwright_builtin".into()),
        }
    }

    #[test]
    fn parses_only_canonical_pull_request_urls() {
        let parsed =
            parse_pull_request_url("https://github.com/acme/widget/pull/42").expect("valid PR");
        assert_eq!(parsed.owner, "acme");
        assert_eq!(parsed.repo, "widget");
        assert_eq!(parsed.number, 42);
        assert!(parse_pull_request_url("http://github.com/acme/widget/pull/42").is_err());
        assert!(parse_pull_request_url("https://gitlab.com/acme/widget/pull/42").is_err());
        assert!(parse_pull_request_url("https://github.com/acme/widget/pull/42/files").is_err());
    }

    #[test]
    fn parses_bounded_ranges_and_rejects_options() {
        let parsed = parse_range("main...feature/test").expect("valid range");
        assert_eq!(parsed.base, "main");
        assert_eq!(parsed.head, "feature/test");
        assert!(parse_range("--all..HEAD").is_err());
        assert!(parse_range("main HEAD").is_err());
        assert!(parse_range("main..one..two").is_err());
    }

    #[test]
    fn preview_urls_reject_credentials_and_unsafe_schemes() {
        assert_eq!(
            parse_preview_url("https://preview.example.com/#section").expect("preview"),
            "https://preview.example.com"
        );
        assert!(parse_preview_url("https://user:pass@example.com").is_err());
        assert!(parse_preview_url("file:///tmp/index.html").is_err());
    }

    #[test]
    fn conventional_paths_derive_static_routes() {
        let paths = vec![
            "src/pages/index.tsx".into(),
            "src/pages/settings/profile.tsx".into(),
            "src/app/(account)/billing/page.tsx".into(),
            "src/app/projects/[id]/page.tsx".into(),
        ];
        let (routes, limitations) = derive_routes(&paths);
        assert_eq!(
            routes
                .iter()
                .map(|route| route.route.as_str())
                .collect::<Vec<_>>(),
            vec!["/", "/settings/profile", "/billing"]
        );
        assert!(limitations.iter().any(|item| item.contains("[id]")));
    }

    #[test]
    fn execution_plans_and_command_output_are_bounded() {
        let paths = (0..12)
            .map(|index| format!("src/pages/route-{index}.tsx"))
            .collect::<Vec<_>>();
        let (routes, limitations) = derive_routes(&paths);
        assert_eq!(routes.len(), MAX_ROUTES);
        assert!(limitations
            .iter()
            .any(|item| item.contains("route execution bound")));

        assert!(validate_command_output_sizes(
            "git",
            MAX_COMMAND_OUTPUT_BYTES,
            MAX_COMMAND_OUTPUT_BYTES
        )
        .is_ok());
        assert!(validate_command_output_sizes("gh", MAX_COMMAND_OUTPUT_BYTES + 1, 0).is_err());
        assert!(validate_command_output_sizes("git", 0, MAX_COMMAND_OUTPUT_BYTES + 1).is_err());
    }

    #[cfg(feature = "browser-agent")]
    #[test]
    fn native_route_urls_and_artifact_names_are_stable() {
        assert_eq!(
            preview_route_url("https://preview.example.com/", "/settings/profile"),
            "https://preview.example.com/settings/profile"
        );
        assert_eq!(
            preview_route_url("https://preview.example.com", "/"),
            "https://preview.example.com/"
        );
        assert_eq!(route_artifact_name("/"), "root");
        assert_eq!(route_artifact_name("/projects/[id]"), "projects--id-");
    }

    #[test]
    fn explicit_preview_revision_is_verified_or_mismatched() {
        let head = sha('a');
        let mut matching = HeaderMap::new();
        matching.insert(
            "x-commit-sha",
            HeaderValue::from_str(&head).expect("header"),
        );
        assert_eq!(
            classify_preview_headers("https://a", "https://a", &matching, &head).status,
            TrexPreviewIdentityStatus::Verified
        );
        let mut mismatched = HeaderMap::new();
        mismatched.insert(
            "x-git-sha",
            HeaderValue::from_str(&sha('b')).expect("header"),
        );
        assert_eq!(
            classify_preview_headers("https://a", "https://a", &mismatched, &head).status,
            TrexPreviewIdentityStatus::Mismatch
        );
        assert_eq!(
            classify_preview_headers("https://a", "https://a", &HeaderMap::new(), &head).status,
            TrexPreviewIdentityStatus::Claimed
        );
    }

    #[test]
    fn aggregation_preserves_failure_and_no_confidence() {
        let routes = vec![TrexPreviewRoute {
            route: "/".into(),
            reason: "root".into(),
        }];
        let passing = vec![passing_journey("/")];
        assert_eq!(
            aggregate_verdict(
                &preview(TrexPreviewIdentityStatus::Claimed),
                &routes,
                &passing,
                &[]
            ),
            TrexPreviewVerdict::PassedWithLimits
        );
        let mut failing = passing_journey("/");
        failing.pass = false;
        assert_eq!(
            aggregate_verdict(
                &preview(TrexPreviewIdentityStatus::Verified),
                &routes,
                &[failing],
                &[]
            ),
            TrexPreviewVerdict::Failed
        );
        assert_eq!(
            aggregate_verdict(
                &preview(TrexPreviewIdentityStatus::Mismatch),
                &routes,
                &[],
                &[]
            ),
            TrexPreviewVerdict::NoConfidence
        );
    }

    #[test]
    fn persisted_receipt_round_trips_without_losing_evidence() {
        let connection = rusqlite::Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("schema");
        let db = DbState(Arc::new(Mutex::new(connection)));
        let receipt = TrexPreviewReceipt {
            schema_version: 1,
            run_id: "trex-preview-fixture".into(),
            repo_path: "/tmp/fixture".into(),
            source: TrexSourceReceipt {
                kind: TrexChangeKind::Range,
                input: "main..HEAD".into(),
                base_sha: sha('a'),
                head_sha: sha('b'),
                commits: vec![sha('b')],
                changed_paths: vec!["src/pages/settings.tsx".into()],
            },
            preview: preview(TrexPreviewIdentityStatus::Claimed),
            routes: vec![TrexPreviewRoute {
                route: "/settings".into(),
                reason: "Derived from src/pages/settings.tsx".into(),
            }],
            journeys: vec![passing_journey("/settings")],
            verdict: TrexPreviewVerdict::PassedWithLimits,
            summary: "Passed with bounded coverage.".into(),
            limitations: vec!["Preview identity is claimed.".into()],
            duration_ms: 42,
            ran_at: "2026-07-29T00:00:00Z".into(),
        };
        insert_preview_run(&db, &receipt).expect("insert");
        let stored = read_preview_runs(&db, Some("/tmp/fixture"), 1).expect("read");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].run_id, receipt.run_id);
        assert_eq!(stored[0].source.changed_paths, receipt.source.changed_paths);
        assert_eq!(stored[0].journeys[0].route, "/settings");
        assert_eq!(stored[0].verdict, TrexPreviewVerdict::PassedWithLimits);
    }
}
