//! SaaS Maker integration. Mirrors reel-pipeline's pattern:
//!   - Bearer auth via SAASMAKER_SESSION_TOKEN.
//!   - Base URL via SAASMAKER_API_URL (defaults to https://api.saasmaker.com).
//!   - Skips gracefully when token is missing.
//!
//! Two commands the UI uses today:
//!   - `list_saas_maker_tasks(project_slug?)` — pull tasks for the current
//!     project to surface in the Roadmap page.
//!   - `push_finding_to_saas_maker(review_id, finding_index, project_slug)` —
//!     create a task from a CodeVetter finding so high-severity bugs land
//!     in the fleet record without typing.
//!
//! Dedup lives in a small `saas_maker_sync` table keyed on the SaaS Maker
//! task id + the local source id (finding fingerprint). Re-pushing the same
//! finding is a no-op.

use std::time::Duration;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::db::queries;
use crate::DbState;

const DEFAULT_BASE_URL: &str = "https://api.sassmaker.com";
const TOKEN_ENV: &str = "SAASMAKER_SESSION_TOKEN";
const URL_ENV: &str = "SAASMAKER_API_URL";
const PREF_TOKEN: &str = "saas_maker_token";
const PREF_BASE_URL: &str = "saas_maker_base_url";
const PREF_PROJECT_SLUG: &str = "saas_maker_project_slug";

// ─── Public IO ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaasMakerTask {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub project_slug: Option<String>,
    #[serde(default)]
    pub task_type: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub pr_url: Option<String>,
}

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
pub struct PushFindingInput {
    pub review_id: String,
    pub finding_id: String,
    #[serde(default)]
    pub project_slug: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushFindingResult {
    pub task: Option<SaasMakerTask>,
    pub skipped: bool,
    pub skipped_reason: Option<String>,
    /// True when the finding was already linked to a task before this call.
    pub already_synced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaasMakerProject {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTaskPatch {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
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
pub async fn list_saas_maker_tasks(
    db: State<'_, DbState>,
    project_slug: Option<String>,
) -> Result<Vec<SaasMakerTask>, String> {
    let (token, _) = resolve_token(&db);
    let token = match token {
        Some(t) => t,
        None => {
            return Err(format!(
                "SaaS Maker not configured. Set {TOKEN_ENV} or configure via Settings."
            ))
        }
    };
    let base = resolve_base_url(&db);
    let slug = project_slug
        .or_else(|| read_pref(&db, PREF_PROJECT_SLUG))
        .filter(|s| !s.trim().is_empty());

    let mut url = format!("{base}/v1/tasks");
    if let Some(s) = &slug {
        url.push_str(&format!("?project_slug={}", urlencode(s)));
    }

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
    parse_task_list(&body)
}

#[tauri::command]
pub async fn list_saas_maker_projects(
    db: State<'_, DbState>,
) -> Result<Vec<SaasMakerProject>, String> {
    let (token, _) = resolve_token(&db);
    let token = token.ok_or_else(|| {
        format!("SaaS Maker not configured. Set {TOKEN_ENV} or use Settings.")
    })?;
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

#[tauri::command]
pub async fn update_saas_maker_task(
    db: State<'_, DbState>,
    task_id: String,
    patch: UpdateTaskPatch,
) -> Result<SaasMakerTask, String> {
    let (token, _) = resolve_token(&db);
    let token = token.ok_or_else(|| {
        format!("SaaS Maker not configured. Set {TOKEN_ENV} or use Settings.")
    })?;
    let base = resolve_base_url(&db);
    let url = format!("{base}/v1/tasks/{}", urlencode(&task_id));
    let payload = serde_json::to_value(&patch)
        .map_err(|e| format!("serialize patch: {e}"))?;
    let resp = client()?
        .patch(&url)
        .bearer_auth(&token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("SaaS Maker PATCH {url} failed: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "SaaS Maker PATCH {url} returned {status}: {}",
            body.chars().take(400).collect::<String>()
        ));
    }
    let task = parse_single_task(&body)?;
    // Keep the cached payload current so re-pushes see the new status.
    let _ = refresh_sync_payload(&db, &task);
    Ok(task)
}

#[tauri::command]
pub async fn push_finding_to_saas_maker(
    db: State<'_, DbState>,
    input: PushFindingInput,
) -> Result<PushFindingResult, String> {
    // 1. Hydrate the finding from the local DB.
    let (review, finding) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let (review, findings) = queries::get_local_review_with_findings(&conn, &input.review_id)
            .map_err(|e| e.to_string())?;
        let finding = findings
            .into_iter()
            .find(|f| f.id == input.finding_id)
            .ok_or_else(|| format!("finding {} not found on review", input.finding_id))?;
        (review, finding)
    };

    // 2. Already synced?
    if let Some(prior) = lookup_existing_sync(&db, &input.finding_id)? {
        return Ok(PushFindingResult {
            task: Some(prior),
            skipped: true,
            skipped_reason: Some("already pushed".into()),
            already_synced: true,
        });
    }

    let (token, _) = resolve_token(&db);
    let token = match token {
        Some(t) => t,
        None => {
            return Ok(PushFindingResult {
                task: None,
                skipped: true,
                skipped_reason: Some(format!(
                    "SaaS Maker not configured. Set {TOKEN_ENV} or use Settings."
                )),
                already_synced: false,
            })
        }
    };
    let base = resolve_base_url(&db);
    let slug = input
        .project_slug
        .or_else(|| read_pref(&db, PREF_PROJECT_SLUG))
        .or(review.repo_full_name.clone())
        .or(review.repo_path.clone());

    let payload = build_task_payload(&review, &finding, slug.as_deref());
    let url = format!("{base}/v1/tasks");
    let resp = client()?
        .post(&url)
        .bearer_auth(&token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("SaaS Maker POST {url} failed: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "SaaS Maker POST {url} returned {status}: {}",
            body.chars().take(400).collect::<String>()
        ));
    }
    let task = parse_single_task(&body)?;

    // 3. Persist the link so re-push is a no-op.
    record_sync(&db, &input.finding_id, &task)?;

    Ok(PushFindingResult {
        task: Some(task),
        skipped: false,
        skipped_reason: None,
        already_synced: false,
    })
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

fn lookup_existing_sync(
    db: &State<'_, DbState>,
    finding_id: &str,
) -> Result<Option<SaasMakerTask>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT saas_maker_task_id, last_payload FROM saas_maker_sync
             WHERE local_source_kind = 'finding' AND local_source_id = ?1",
            params![finding_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .ok();
    match row {
        Some((_id, payload)) => {
            let task = serde_json::from_str::<SaasMakerTask>(&payload)
                .map_err(|e| format!("parse stored sync payload: {e}"))?;
            Ok(Some(task))
        }
        None => Ok(None),
    }
}

fn record_sync(
    db: &State<'_, DbState>,
    finding_id: &str,
    task: &SaasMakerTask,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let payload = serde_json::to_string(task).map_err(|e| format!("serialize task: {e}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO saas_maker_sync
            (saas_maker_task_id, local_source_kind, local_source_id, last_payload, synced_at)
         VALUES (?1, 'finding', ?2, ?3, ?4)",
        params![task.id, finding_id, payload, now],
    )
    .map_err(|e| format!("insert sync row: {e}"))?;
    Ok(())
}

fn build_task_payload(
    review: &queries::LocalReviewRow,
    finding: &queries::LocalReviewFindingRow,
    project_slug: Option<&str>,
) -> Value {
    let discovery = finding
        .discovery_method
        .clone()
        .unwrap_or_else(|| "inspection".into());
    let severity = finding.severity.clone().unwrap_or_else(|| "medium".into());
    let priority = match severity.to_ascii_lowercase().as_str() {
        "critical" | "high" => "high",
        "low" | "info" => "low",
        _ => "medium",
    };
    let description = build_description(review, finding, &discovery);
    let title = finding.title.clone().unwrap_or_else(|| "CodeVetter finding".into());

    json!({
        "title": title,
        "description": description,
        "status": "todo",
        "priority": priority,
        "project_slug": project_slug.unwrap_or(""),
        "task_type": "bug",
    })
}

fn build_description(
    review: &queries::LocalReviewRow,
    finding: &queries::LocalReviewFindingRow,
    discovery: &str,
) -> String {
    let summary = finding.summary.clone().unwrap_or_default();
    let suggestion = finding.suggestion.clone().unwrap_or_default();
    let mut buf = String::new();
    if !summary.is_empty() {
        buf.push_str(&summary);
        buf.push_str("\n\n");
    }
    if !suggestion.is_empty() {
        buf.push_str("**Suggestion:** ");
        buf.push_str(&suggestion);
        buf.push_str("\n\n");
    }
    if let Some(p) = finding.file_path.as_deref() {
        let suffix = finding.line.map(|l| format!(":{l}")).unwrap_or_default();
        buf.push_str(&format!("**Location:** `{p}{suffix}`\n"));
    }
    buf.push_str(&format!("**Discovered via:** {discovery}\n"));
    if let Some(repo) = review.repo_full_name.as_deref().or(review.repo_path.as_deref()) {
        buf.push_str(&format!("**Repo:** {repo}\n"));
    }
    buf.push_str(&format!("\n_Pushed from CodeVetter review {}_\n", review.id));
    buf
}

fn parse_task_list(body: &str) -> Result<Vec<SaasMakerTask>, String> {
    let v: Value = serde_json::from_str(body)
        .map_err(|e| format!("SaaS Maker tasks response not JSON: {e}"))?;
    // Match reel-pipeline: payload.data is the array; fall back to the root if
    // an older shape ever appears.
    let arr = v
        .get("data")
        .and_then(|x| x.as_array())
        .cloned()
        .or_else(|| v.as_array().cloned())
        .ok_or_else(|| "expected `data` array in SaaS Maker tasks response".to_string())?;
    let mut out: Vec<SaasMakerTask> = Vec::with_capacity(arr.len());
    for item in arr {
        if let Ok(t) = serde_json::from_value::<SaasMakerTask>(item) {
            out.push(t);
        }
    }
    Ok(out)
}

fn parse_single_task(body: &str) -> Result<SaasMakerTask, String> {
    let v: Value = serde_json::from_str(body)
        .map_err(|e| format!("SaaS Maker create-task response not JSON: {e}"))?;
    let inner = v.get("data").cloned().unwrap_or(v);
    serde_json::from_value::<SaasMakerTask>(inner)
        .map_err(|e| format!("SaaS Maker create-task shape: {e}"))
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

/// Refresh the cached payload for a task whose status we just PATCHed, so the
/// next dedup lookup sees the new state and the UI can decide whether to
/// re-push or mark complete locally.
fn refresh_sync_payload(db: &State<'_, DbState>, task: &SaasMakerTask) -> Result<(), String> {
    let Ok(conn) = db.0.lock() else { return Ok(()); };
    let now = chrono::Utc::now().to_rfc3339();
    let Ok(payload) = serde_json::to_string(task) else { return Ok(()); };
    let _ = conn.execute(
        "UPDATE saas_maker_sync
            SET last_payload = ?1, synced_at = ?2
            WHERE saas_maker_task_id = ?3",
        params![payload, now, task.id],
    );
    Ok(())
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

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_review() -> queries::LocalReviewRow {
        queries::LocalReviewRow {
            id: "rev-1".into(),
            review_type: Some("pr".into()),
            source_label: None,
            repo_path: Some("/repo/path".into()),
            repo_full_name: Some("acme/widget".into()),
            pr_number: Some(42),
            agent_used: "claude-code".into(),
            score_composite: Some(0.7),
            findings_count: Some(1),
            review_action: None,
            summary_markdown: None,
            status: "completed".into(),
            error_message: None,
            started_at: None,
            completed_at: None,
            created_at: "2026-06-16T00:00:00Z".into(),
        }
    }

    fn mk_finding(method: Option<&str>) -> queries::LocalReviewFindingRow {
        queries::LocalReviewFindingRow {
            id: "f-1".into(),
            review_id: "rev-1".into(),
            severity: Some("high".into()),
            title: Some("Null pointer in checkout".into()),
            summary: Some("the cart total crashes when count == 0".into()),
            suggestion: Some("guard with `if cart.items.is_empty()`".into()),
            file_path: Some("src/checkout.rs".into()),
            line: Some(89),
            confidence: Some(0.9),
            fingerprint: None,
            discovery_method: method.map(String::from),
        }
    }

    #[test]
    fn payload_has_priority_from_severity_and_renders_description() {
        let review = mk_review();
        let finding = mk_finding(Some("execution"));
        let v = build_task_payload(&review, &finding, Some("widget"));
        assert_eq!(v["priority"], "high");
        assert_eq!(v["status"], "todo");
        assert_eq!(v["task_type"], "bug");
        assert_eq!(v["project_slug"], "widget");
        let desc = v["description"].as_str().unwrap();
        assert!(desc.contains("the cart total crashes"));
        assert!(desc.contains("`if cart.items.is_empty()`"));
        assert!(desc.contains("src/checkout.rs:89"));
        assert!(desc.contains("execution"));
        assert!(desc.contains("acme/widget"));
        assert!(desc.contains("rev-1"));
    }

    #[test]
    fn severity_low_maps_to_low_priority() {
        let review = mk_review();
        let mut finding = mk_finding(None);
        finding.severity = Some("low".into());
        let v = build_task_payload(&review, &finding, None);
        assert_eq!(v["priority"], "low");
    }

    #[test]
    fn parses_task_list_with_data_envelope() {
        let body = r#"{"data":[{"id":"t1","title":"Bug X","status":"todo"},{"id":"t2","title":"Bug Y"}]}"#;
        let tasks = parse_task_list(body).unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].id, "t1");
        assert_eq!(tasks[1].title, "Bug Y");
    }

    #[test]
    fn parses_task_list_root_array_fallback() {
        let body = r#"[{"id":"t1","title":"Bug X"}]"#;
        let tasks = parse_task_list(body).unwrap();
        assert_eq!(tasks.len(), 1);
    }

    #[test]
    fn parses_single_task_with_data_envelope() {
        let body = r#"{"data":{"id":"t99","title":"Created"}}"#;
        let t = parse_single_task(body).unwrap();
        assert_eq!(t.id, "t99");
    }

    #[test]
    fn parses_single_task_with_bare_object() {
        let body = r#"{"id":"t99","title":"Created"}"#;
        let t = parse_single_task(body).unwrap();
        assert_eq!(t.id, "t99");
    }

    #[test]
    fn url_encoder_handles_safe_chars() {
        assert_eq!(urlencode("hello-world"), "hello-world");
        assert_eq!(urlencode("hello world"), "hello%20world");
        assert_eq!(urlencode("a/b"), "a%2Fb");
    }
}
