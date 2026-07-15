//! SaaS Maker integration — auth, projects, tasks. CodeVetter is a client of
//! the saas-maker spine (Cloudflare D1 + saasmaker-api Worker + cockpit UI).
//!
//! Auth resolution: env `SAASMAKER_SESSION_TOKEN` wins over a stored token in
//! the `preferences` row (`saas_maker_token`). Calls return graceful
//! "skipped"/"not configured" rather than panicking when unset.
//!
//! v1.1.76 added the sign-in flow:
//!   - `start_saas_maker_signin` opens the cockpit's existing /cli/auth?code=
//!     page (reuses the CLI auth flow — no new infra on the cockpit side).
//!   - `poll_saas_maker_signin` polls /v1/cli/poll until the user approves,
//!     then stores the token + a cached user record.
//!   - `get_current_user`, `sign_out_of_saas_maker` round out the session.
//!   - `detect_project_for_repo` shells `git remote get-url origin`,
//!     normalizes the URL, and matches against the fleet project list so the
//!     correct project_slug auto-selects when picking a repo.

use std::time::Duration;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::DbState;

const DEFAULT_BASE_URL: &str = "https://api.sassmaker.com";
const DEFAULT_COCKPIT_URL: &str = "https://app.sassmaker.com";
const TOKEN_ENV: &str = "SAASMAKER_SESSION_TOKEN";
const URL_ENV: &str = "SAASMAKER_API_URL";
const COCKPIT_ENV: &str = "SAASMAKER_COCKPIT_URL";
const PREF_TOKEN: &str = "saas_maker_token";
const PREF_BASE_URL: &str = "saas_maker_base_url";
const PREF_COCKPIT_URL: &str = "saas_maker_cockpit_url";
const PREF_PROJECT_SLUG: &str = "saas_maker_project_slug";
const PREF_CACHED_USER: &str = "saas_maker_cached_user";

// Token cache freshness — re-fetch /v1/auth/session after this.
const USER_CACHE_FRESH_SECS: i64 = 24 * 60 * 60;
// Polling cadence + timeout for the CLI-style sign-in flow.
const POLL_INTERVAL_MS: u64 = 1500;
const POLL_TIMEOUT_SECS: u64 = 300;

// ─── Public IO ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaasMakerStatus {
    pub configured: bool,
    pub base_url: String,
    pub project_slug: Option<String>,
    /// Source of the token: "env", "preferences", or "none".
    pub token_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaasMakerSetConfig {
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub project_slug: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaasMakerProject {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    /// Optional git URL of the canonical repo for this project. Used by
    /// `detect_project_for_repo` to auto-match a local repo to its fleet
    /// project. Field is added on the saas-maker side as a Drizzle migration;
    /// if absent (old worker), this stays None and detection falls back to
    /// the local `repo_project_mapping` table.
    #[serde(default)]
    pub git_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaasMakerUser {
    pub id: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignInStart {
    /// One-time auth code; pass to `poll_saas_maker_signin`.
    pub code: String,
    /// Fully-built cockpit URL we just opened in the user's browser.
    pub approval_url: String,
    /// Seconds until the code expires.
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SignInResult {
    /// User approved in their browser. Token is already persisted; user is
    /// the freshly-cached identity.
    Approved { user: SaasMakerUser },
    /// Auth code expired before approval (10-minute window) or polling timed
    /// out after our 5-minute cap. Either way, ask the user to try again.
    Expired,
    /// Polling was cancelled from the frontend.
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoDetectResult {
    pub project: Option<SaasMakerProject>,
    /// "git_url" (matched via fleet `git_url` field), "manual_mapping"
    /// (matched via local `repo_project_mapping` row), or "none".
    pub source: String,
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_saas_maker_status(db: State<'_, DbState>) -> Result<SaasMakerStatus, String> {
    let (token, source) = resolve_token(&db);
    let base_url = resolve_base_url(&db);
    let project_slug = read_pref(&db, PREF_PROJECT_SLUG);
    Ok(SaasMakerStatus {
        configured: token.is_some(),
        base_url,
        project_slug,
        token_source: source.to_string(),
    })
}

#[tauri::command]
pub async fn set_saas_maker_config(
    db: State<'_, DbState>,
    config: SaasMakerSetConfig,
) -> Result<SaasMakerStatus, String> {
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        if let Some(token) = config.token.as_deref() {
            // Empty string = clear.
            if token.is_empty() {
                let _ = conn.execute(
                    "DELETE FROM preferences WHERE key = ?1",
                    params![PREF_TOKEN],
                );
            } else {
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO preferences (key, value) VALUES (?1, ?2)",
                    params![PREF_TOKEN, token],
                );
            }
        }
        if let Some(base) = config.base_url.as_deref() {
            let _ = conn.execute(
                "INSERT OR REPLACE INTO preferences (key, value) VALUES (?1, ?2)",
                params![PREF_BASE_URL, base.trim_end_matches('/')],
            );
        }
        if let Some(slug) = config.project_slug.as_deref() {
            let _ = conn.execute(
                "INSERT OR REPLACE INTO preferences (key, value) VALUES (?1, ?2)",
                params![PREF_PROJECT_SLUG, slug],
            );
        }
    }
    get_saas_maker_status(db).await
}

#[tauri::command]
pub async fn list_saas_maker_projects(
    db: State<'_, DbState>,
) -> Result<Vec<SaasMakerProject>, String> {
    let (token, _) = resolve_token(&db);
    let token = token
        .ok_or_else(|| format!("SaaS Maker not configured. Set {TOKEN_ENV} or use Settings."))?;
    let base = resolve_base_url(&db);
    let url = format!("{base}/v1/projects");
    let resp = client()?
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("SaaS Maker GET {url} failed: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "SaaS Maker GET {url} returned {status}: {}",
            body.chars().take(400).collect::<String>()
        ));
    }
    parse_project_list(&body)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("build reqwest client: {e}"))
}

fn resolve_token(db: &State<'_, DbState>) -> (Option<String>, &'static str) {
    // Env wins over preferences so a shell-set token always overrides a
    // stale stored one.
    if let Ok(v) = std::env::var(TOKEN_ENV) {
        if !v.trim().is_empty() {
            return (Some(v), "env");
        }
    }
    if let Some(v) = read_pref(db, PREF_TOKEN) {
        return (Some(v), "preferences");
    }
    (None, "none")
}

fn resolve_base_url(db: &State<'_, DbState>) -> String {
    if let Ok(v) = std::env::var(URL_ENV) {
        if !v.trim().is_empty() {
            return v.trim_end_matches('/').to_string();
        }
    }
    if let Some(v) = read_pref(db, PREF_BASE_URL) {
        if !v.trim().is_empty() {
            return v.trim_end_matches('/').to_string();
        }
    }
    DEFAULT_BASE_URL.to_string()
}

fn read_pref(db: &State<'_, DbState>, key: &str) -> Option<String> {
    let conn = db.0.lock().ok()?;
    conn.query_row(
        "SELECT value FROM preferences WHERE key = ?1",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

fn parse_project_list(body: &str) -> Result<Vec<SaasMakerProject>, String> {
    let v: Value = serde_json::from_str(body)
        .map_err(|e| format!("SaaS Maker projects response not JSON: {e}"))?;
    let arr = v
        .get("data")
        .and_then(|x| x.as_array())
        .cloned()
        .or_else(|| v.as_array().cloned())
        .ok_or_else(|| "expected `data` array in SaaS Maker projects response".to_string())?;
    let mut out: Vec<SaasMakerProject> = Vec::with_capacity(arr.len());
    for item in arr {
        if let Ok(p) = serde_json::from_value::<SaasMakerProject>(item) {
            out.push(p);
        }
    }
    Ok(out)
}

fn urlencode(s: &str) -> String {
    // Minimal encoder for the few characters that matter in a slug. Avoids
    // pulling in a full crate just for this.
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => out.push(c),
            ' ' => out.push_str("%20"),
            other => {
                for byte in other.to_string().bytes() {
                    out.push_str(&format!("%{byte:02X}"));
                }
            }
        }
    }
    out
}

// ─── v1.1.76: sign-in + identity + repo detect ──────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PollOutcome {
    Pending,
    Approved(String),
    Expired,
}

#[tauri::command]
pub async fn start_saas_maker_signin(db: State<'_, DbState>) -> Result<SignInStart, String> {
    let base = resolve_base_url(&db);
    let cockpit = resolve_cockpit_url(&db);

    let resp = client()?
        .post(format!("{base}/v1/cli/code"))
        .send()
        .await
        .map_err(|e| format!("POST /v1/cli/code failed: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "POST /v1/cli/code returned {status}: {}",
            body.chars().take(300).collect::<String>()
        ));
    }
    let v: Value =
        serde_json::from_str(&body).map_err(|e| format!("/v1/cli/code response not JSON: {e}"))?;
    let code = v
        .get("code")
        .and_then(|s| s.as_str())
        .ok_or_else(|| "missing `code` in /v1/cli/code response".to_string())?
        .to_string();
    let expires_in = v.get("expires_in").and_then(|n| n.as_u64()).unwrap_or(600);

    let approval_url = build_approval_url(&cockpit, &code);

    if let Err(e) = open_url_in_browser(&approval_url) {
        // Don't fail the whole call — the user can still copy the URL from the
        // returned struct. The frontend can fall back to "open this link" UI.
        log::warn!("failed to open browser to {approval_url}: {e}");
    }

    Ok(SignInStart {
        code,
        approval_url,
        expires_in,
    })
}

#[tauri::command]
pub async fn poll_saas_maker_signin(
    db: State<'_, DbState>,
    code: String,
) -> Result<SignInResult, String> {
    let base = resolve_base_url(&db);
    let deadline = std::time::Instant::now() + Duration::from_secs(POLL_TIMEOUT_SECS);
    let url = format!("{base}/v1/cli/poll?code={}", urlencode(&code));

    loop {
        if std::time::Instant::now() >= deadline {
            return Ok(SignInResult::Expired);
        }

        let resp = client()?
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("GET {url} failed: {e}"))?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::NOT_FOUND {
            // Server lost the code (deleted after retrieval, or never existed).
            return Ok(SignInResult::Expired);
        }
        if !status.is_success() {
            return Err(format!(
                "/v1/cli/poll returned {status}: {}",
                body.chars().take(300).collect::<String>()
            ));
        }
        let v: Value = serde_json::from_str(&body)
            .map_err(|e| format!("/v1/cli/poll response not JSON: {e}"))?;

        match parse_poll_response(&v) {
            PollOutcome::Pending => {
                tokio::time::sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
                continue;
            }
            PollOutcome::Expired => return Ok(SignInResult::Expired),
            PollOutcome::Approved(token) => {
                // Persist token through the same path that the manual paste
                // flow uses, so every downstream call (list/push/patch) Just
                // Works once we return.
                {
                    let conn = db.0.lock().map_err(|e| e.to_string())?;
                    let _ = conn.execute(
                        "INSERT OR REPLACE INTO preferences (key, value) VALUES (?1, ?2)",
                        params![PREF_TOKEN, token],
                    );
                }
                // Fetch the user record so the badge can render immediately
                // and survive app restarts without an extra round-trip.
                let user = fetch_session_user(&base, &token).await?;
                cache_user(&db, &user);
                return Ok(SignInResult::Approved { user });
            }
        }
    }
}

#[tauri::command]
pub async fn sign_out_of_saas_maker(db: State<'_, DbState>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let _ = conn.execute(
        "DELETE FROM preferences WHERE key IN (?1, ?2)",
        params![PREF_TOKEN, PREF_CACHED_USER],
    );
    Ok(())
}

#[tauri::command]
pub async fn get_current_user(db: State<'_, DbState>) -> Result<Option<SaasMakerUser>, String> {
    let (token, _) = resolve_token(&db);
    let Some(token) = token else {
        return Ok(None);
    };

    // 1. Try cached user if fresh.
    if let Some((user, ts)) = read_cached_user(&db) {
        if is_cached_user_fresh(&ts) {
            return Ok(Some(user));
        }
    }

    // 2. Refresh from /v1/auth/session.
    let base = resolve_base_url(&db);
    match fetch_session_user(&base, &token).await {
        Ok(user) => {
            cache_user(&db, &user);
            Ok(Some(user))
        }
        Err(e) => {
            // Fall back to a stale cache if we have one — better than a
            // sudden sign-out on a transient network blip.
            if let Some((stale, _)) = read_cached_user(&db) {
                log::warn!("failed to refresh session, returning stale cache: {e}");
                return Ok(Some(stale));
            }
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn detect_project_for_repo(
    db: State<'_, DbState>,
    repo_path: String,
) -> Result<RepoDetectResult, String> {
    let trimmed = repo_path.trim().to_string();
    if trimmed.is_empty() {
        return Err("repo_path is empty".to_string());
    }

    // 1. Try the local manual-mapping table first — once the user has linked
    //    a repo, we never want to "guess" again.
    if let Some(slug) = lookup_local_repo_mapping(&db, &trimmed) {
        // Hydrate the project from the live list (best-effort — if offline,
        // we still report the slug).
        let projects = list_saas_maker_projects(db.clone())
            .await
            .unwrap_or_default();
        let proj = projects
            .into_iter()
            .find(|p| p.slug.as_deref() == Some(slug.as_str()))
            .or(Some(SaasMakerProject {
                id: format!("local:{slug}"),
                name: slug.clone(),
                slug: Some(slug),
                source: None,
                git_url: None,
            }));
        return Ok(RepoDetectResult {
            project: proj,
            source: "manual_mapping".to_string(),
        });
    }

    // 2. Read `git remote get-url origin` and try to match against fleet
    //    project git_urls.
    let origin = match read_origin_url(&trimmed) {
        Ok(u) => u,
        Err(_) => {
            return Ok(RepoDetectResult {
                project: None,
                source: "none".to_string(),
            });
        }
    };
    let projects = list_saas_maker_projects(db).await.unwrap_or_default();
    match match_project_by_url(&origin, &projects) {
        Some(p) => Ok(RepoDetectResult {
            project: Some(p.clone()),
            source: "git_url".to_string(),
        }),
        None => Ok(RepoDetectResult {
            project: None,
            source: "none".to_string(),
        }),
    }
}

/// Normalize an arbitrary name to an alphanumeric, lowercase key for fuzzy
/// matching a local repo directory to a fleet project name.
/// "CodeVetter" / "code-vetter" / "code_vetter" all → "codevetter".
#[cfg(test)]
fn name_key(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Best-effort repo name out of an origin URL: last path segment, `.git` dropped.
#[cfg(test)]
fn repo_name_from_origin(origin: &str) -> Option<String> {
    let norm = normalize_git_url(origin); // host/owner/repo, lowercased, no .git
    norm.rsplit('/')
        .next()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

// ─── Internal helpers (v1.1.76) ─────────────────────────────────────────────

fn resolve_cockpit_url(db: &State<'_, DbState>) -> String {
    if let Ok(v) = std::env::var(COCKPIT_ENV) {
        if !v.trim().is_empty() {
            return v.trim_end_matches('/').to_string();
        }
    }
    if let Some(v) = read_pref(db, PREF_COCKPIT_URL) {
        if !v.trim().is_empty() {
            return v.trim_end_matches('/').to_string();
        }
    }
    DEFAULT_COCKPIT_URL.to_string()
}

fn build_approval_url(cockpit_base: &str, code: &str) -> String {
    format!(
        "{}/cli/auth?code={}&source=codevetter",
        cockpit_base.trim_end_matches('/'),
        urlencode(code)
    )
}

fn open_url_in_browser(url: &str) -> Result<(), String> {
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    } else if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("cmd");
        c.args(["/c", "start", "", url]);
        c
    } else {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    cmd.spawn()
        .map_err(|e| format!("open URL via OS opener: {e}"))?;
    Ok(())
}

pub(crate) fn parse_poll_response(v: &Value) -> PollOutcome {
    let status = v.get("status").and_then(|s| s.as_str()).unwrap_or("");
    match status {
        "approved" => v
            .get("token")
            .and_then(|t| t.as_str())
            .map(|t| PollOutcome::Approved(t.to_string()))
            .unwrap_or(PollOutcome::Pending),
        "expired" => PollOutcome::Expired,
        // Anything else (pending / unknown / missing) → keep polling. Server
        // is the source of truth on whether the code is still alive.
        _ => PollOutcome::Pending,
    }
}

async fn fetch_session_user(base: &str, token: &str) -> Result<SaasMakerUser, String> {
    let url = format!("{base}/v1/auth/session");
    let resp = client()?
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("GET {url} failed: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "GET {url} returned {status}: {}",
            body.chars().take(300).collect::<String>()
        ));
    }
    parse_session_user(&body)
}

pub(crate) fn parse_session_user(body: &str) -> Result<SaasMakerUser, String> {
    let v: Value = serde_json::from_str(body)
        .map_err(|e| format!("/v1/auth/session response not JSON: {e}"))?;
    if !v
        .get("authenticated")
        .and_then(|b| b.as_bool())
        .unwrap_or(false)
    {
        return Err("session not authenticated".to_string());
    }
    let user_v = v
        .get("user")
        .ok_or_else(|| "missing `user` in session response".to_string())?;
    serde_json::from_value::<SaasMakerUser>(user_v.clone())
        .map_err(|e| format!("user record shape: {e}"))
}

fn cache_user(db: &State<'_, DbState>, user: &SaasMakerUser) {
    let Ok(conn) = db.0.lock() else {
        return;
    };
    let payload = match serde_json::to_string(&json!({
        "user": user,
        "ts": chrono::Utc::now().to_rfc3339(),
    })) {
        Ok(s) => s,
        Err(_) => return,
    };
    let _ = conn.execute(
        "INSERT OR REPLACE INTO preferences (key, value) VALUES (?1, ?2)",
        params![PREF_CACHED_USER, payload],
    );
}

fn read_cached_user(db: &State<'_, DbState>) -> Option<(SaasMakerUser, String)> {
    let raw = read_pref(db, PREF_CACHED_USER)?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    let user = serde_json::from_value::<SaasMakerUser>(v.get("user")?.clone()).ok()?;
    let ts = v.get("ts")?.as_str()?.to_string();
    Some((user, ts))
}

pub(crate) fn is_cached_user_fresh(ts: &str) -> bool {
    use chrono::DateTime;
    match DateTime::parse_from_rfc3339(ts) {
        Ok(parsed) => {
            let age = chrono::Utc::now().signed_duration_since(parsed.with_timezone(&chrono::Utc));
            age.num_seconds() < USER_CACHE_FRESH_SECS && age.num_seconds() >= 0
        }
        Err(_) => false,
    }
}

pub(crate) fn normalize_git_url(raw: &str) -> String {
    let s = raw.trim();
    if s.is_empty() {
        return String::new();
    }
    // Strip protocol prefixes.
    let stripped = s
        .strip_prefix("git+https://")
        .or_else(|| s.strip_prefix("https://"))
        .or_else(|| s.strip_prefix("http://"))
        .or_else(|| s.strip_prefix("ssh://"))
        .unwrap_or(s);

    // Normalize SCP-style `git@host:path` → `host/path` only if no protocol
    // was stripped (so `ssh://git@host/path` doesn't get double-treated).
    let after_user = stripped
        .strip_prefix("git@")
        .map(|rest| rest.replacen(':', "/", 1))
        .unwrap_or_else(|| stripped.to_string());

    // Drop user@ if any survived after a protocol prefix strip.
    let no_user = match after_user.find('@') {
        Some(idx) if idx < after_user.find('/').unwrap_or(usize::MAX) => {
            after_user[idx + 1..].to_string()
        }
        _ => after_user,
    };

    // Strip `.git` suffix + trailing slashes + lowercase for case-insensitive
    // GitHub URLs (the server is case-insensitive on owner/repo).
    let trimmed_tail = no_user
        .trim_end_matches('/')
        .strip_suffix(".git")
        .unwrap_or(no_user.trim_end_matches('/'))
        .to_string();

    trimmed_tail.to_lowercase()
}

pub(crate) fn match_project_by_url<'a>(
    local: &str,
    projects: &'a [SaasMakerProject],
) -> Option<&'a SaasMakerProject> {
    let norm_local = normalize_git_url(local);
    if norm_local.is_empty() {
        return None;
    }
    projects.iter().find(|p| {
        p.git_url
            .as_deref()
            .map(normalize_git_url)
            .map(|gp| !gp.is_empty() && gp == norm_local)
            .unwrap_or(false)
    })
}

fn read_origin_url(repo_path: &str) -> Result<String, String> {
    let out = std::process::Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("spawn git remote: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git remote get-url origin failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn lookup_local_repo_mapping(db: &State<'_, DbState>, repo_path: &str) -> Option<String> {
    let conn = db.0.lock().ok()?;
    conn.query_row(
        "SELECT project_slug FROM repo_project_mapping WHERE repo_path = ?1",
        params![repo_path],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_key_normalizes_casing_and_separators() {
        assert_eq!(name_key("CodeVetter"), "codevetter");
        assert_eq!(name_key("code-vetter"), "codevetter");
        assert_eq!(name_key("code_vetter"), "codevetter");
        assert_eq!(name_key("reel-pipeline"), "reelpipeline");
        assert_eq!(name_key("   "), "");
    }

    #[test]
    fn repo_name_from_origin_extracts_last_segment() {
        assert_eq!(
            repo_name_from_origin("https://github.com/sarthak/CodeVetter.git").as_deref(),
            Some("codevetter")
        );
        assert_eq!(
            repo_name_from_origin("git@github.com:sarthak/reel-pipeline.git").as_deref(),
            Some("reel-pipeline")
        );
        assert_eq!(repo_name_from_origin("").as_deref(), None);
    }

    #[test]
    fn link_match_pairs_repo_basename_to_project_name() {
        let projects = vec![
            SaasMakerProject {
                id: "p1".into(),
                name: "CodeVetter".into(),
                slug: Some("codevetter-modh33a1".into()),
                source: None,
                git_url: None,
            },
            SaasMakerProject {
                id: "p2".into(),
                name: "reel-pipeline".into(),
                slug: Some("reel-pipeline-x".into()),
                source: None,
                git_url: None,
            },
        ];
        // A repo whose dir basename is "CodeVetter" matches by name_key even
        // though the project slug carries a random suffix.
        let candidate_keys = vec![name_key("CodeVetter")];
        let matched = projects
            .iter()
            .find(|p| candidate_keys.iter().any(|k| k == &name_key(&p.name)));
        assert_eq!(matched.map(|p| p.id.as_str()), Some("p1"));
    }

    #[test]
    fn url_encoder_handles_safe_chars() {
        assert_eq!(urlencode("hello-world"), "hello-world");
        assert_eq!(urlencode("hello world"), "hello%20world");
        assert_eq!(urlencode("a/b"), "a%2Fb");
    }

    // ─── v1.1.76: URL normalization + repo detect ──────────────────────────

    #[test]
    fn normalizes_https_with_dot_git() {
        assert_eq!(
            normalize_git_url("https://github.com/sarthak-fleet/CodeVetter.git"),
            "github.com/sarthak-fleet/codevetter"
        );
    }

    #[test]
    fn normalizes_https_without_dot_git() {
        assert_eq!(
            normalize_git_url("https://github.com/sarthak-fleet/CodeVetter"),
            "github.com/sarthak-fleet/codevetter"
        );
    }

    #[test]
    fn normalizes_ssh_form() {
        assert_eq!(
            normalize_git_url("git@github.com:sarthak-fleet/CodeVetter.git"),
            "github.com/sarthak-fleet/codevetter"
        );
    }

    #[test]
    fn normalizes_ssh_form_with_user_and_port() {
        assert_eq!(
            normalize_git_url("ssh://git@github.com/sarthak-fleet/CodeVetter.git"),
            "github.com/sarthak-fleet/codevetter"
        );
    }

    #[test]
    fn normalizes_trailing_slash_and_casing() {
        assert_eq!(
            normalize_git_url("https://GitHub.com/Sarthak-FLEET/CodeVetter/"),
            "github.com/sarthak-fleet/codevetter"
        );
    }

    #[test]
    fn normalizes_empty_safely() {
        assert_eq!(normalize_git_url(""), "");
        assert_eq!(normalize_git_url("   "), "");
    }

    #[test]
    fn detects_project_by_git_url() {
        let projects = vec![
            SaasMakerProject {
                id: "1".into(),
                name: "Other".into(),
                slug: Some("other".into()),
                source: None,
                git_url: Some("https://github.com/x/other.git".into()),
            },
            SaasMakerProject {
                id: "2".into(),
                name: "CodeVetter".into(),
                slug: Some("codevetter".into()),
                source: None,
                git_url: Some("git@github.com:sarthak-fleet/CodeVetter.git".into()),
            },
        ];
        let local = "https://github.com/sarthak-fleet/CodeVetter";
        let m = match_project_by_url(local, &projects);
        assert!(m.is_some());
        assert_eq!(m.unwrap().slug.as_deref(), Some("codevetter"));
    }

    #[test]
    fn no_match_returns_none() {
        let projects = vec![SaasMakerProject {
            id: "1".into(),
            name: "Other".into(),
            slug: Some("other".into()),
            source: None,
            git_url: Some("https://github.com/x/other.git".into()),
        }];
        assert!(match_project_by_url("https://github.com/sarthak/CodeVetter", &projects).is_none());
    }

    #[test]
    fn projects_without_git_url_are_skipped_gracefully() {
        let projects = vec![SaasMakerProject {
            id: "1".into(),
            name: "Untagged".into(),
            slug: Some("untagged".into()),
            source: None,
            git_url: None,
        }];
        assert!(match_project_by_url("https://github.com/x/y", &projects).is_none());
    }

    // ─── v1.1.76: cached user freshness ────────────────────────────────────

    #[test]
    fn cached_user_within_window_is_fresh() {
        let now = chrono::Utc::now();
        let recent = now - chrono::Duration::hours(1);
        assert!(is_cached_user_fresh(&recent.to_rfc3339()));
    }

    #[test]
    fn cached_user_past_window_is_stale() {
        let now = chrono::Utc::now();
        let old = now - chrono::Duration::hours(25);
        assert!(!is_cached_user_fresh(&old.to_rfc3339()));
    }

    #[test]
    fn cached_user_invalid_timestamp_is_stale() {
        assert!(!is_cached_user_fresh("not-a-date"));
        assert!(!is_cached_user_fresh(""));
    }

    // ─── v1.1.76: sign-in URL build ────────────────────────────────────────

    #[test]
    fn build_approval_url_includes_code_and_source() {
        let url = build_approval_url("https://app.sassmaker.com", "abc123");
        assert!(url.contains("abc123"));
        assert!(url.contains("source=codevetter"));
        assert!(url.starts_with("https://app.sassmaker.com/cli/auth?"));
    }

    #[test]
    fn build_approval_url_strips_trailing_slash() {
        let url = build_approval_url("https://app.sassmaker.com/", "abc");
        assert!(url.starts_with("https://app.sassmaker.com/cli/auth"));
        assert!(!url.starts_with("https://app.sassmaker.com//"));
    }

    // ─── v1.1.76: poll-response parsing ────────────────────────────────────

    #[test]
    fn poll_response_approved_extracts_token() {
        let v: Value =
            serde_json::from_str(r#"{"status":"approved","token":"sm_abc123"}"#).unwrap();
        assert_eq!(
            parse_poll_response(&v),
            PollOutcome::Approved("sm_abc123".into())
        );
    }

    #[test]
    fn poll_response_pending() {
        let v: Value = serde_json::from_str(r#"{"status":"pending"}"#).unwrap();
        assert_eq!(parse_poll_response(&v), PollOutcome::Pending);
    }

    #[test]
    fn poll_response_expired() {
        let v: Value = serde_json::from_str(r#"{"status":"expired"}"#).unwrap();
        assert_eq!(parse_poll_response(&v), PollOutcome::Expired);
    }

    #[test]
    fn poll_response_unknown_status_treated_as_pending() {
        let v: Value = serde_json::from_str(r#"{"status":"unrecognized"}"#).unwrap();
        assert_eq!(parse_poll_response(&v), PollOutcome::Pending);
    }

    // ─── v1.1.76: session response parsing ─────────────────────────────────

    #[test]
    fn parses_session_user() {
        let body = r#"{"authenticated":true,"user":{"id":"u1","email":"a@b.co","name":"Alice","avatar_url":"https://x/a.png"}}"#;
        let u = parse_session_user(body).unwrap();
        assert_eq!(u.id, "u1");
        assert_eq!(u.email.as_deref(), Some("a@b.co"));
        assert_eq!(u.name.as_deref(), Some("Alice"));
    }

    #[test]
    fn parses_session_user_minimal_fields() {
        let body = r#"{"authenticated":true,"user":{"id":"u2"}}"#;
        let u = parse_session_user(body).unwrap();
        assert_eq!(u.id, "u2");
        assert!(u.email.is_none());
    }

    #[test]
    fn session_unauthenticated_returns_error() {
        let body = r#"{"authenticated":false}"#;
        assert!(parse_session_user(body).is_err());
    }
}
