//! Persona generation — scrapes a project's GitHub stargazers + issue
//! authors, hits the LLM with a clustering prompt, and returns N persona
//! archetypes. This is the local-tool answer to Featurely's pitch.
//!
//! No new infra: uses the existing GitHub token (preferences `github_token`)
//! and the CLI brain (`claude -p` or `codex exec --json`) already shipped
//! for other features.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::Stdio;
use std::time::Duration;
use tauri::State;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::DbState;

const PREF_GITHUB_TOKEN: &str = "github_token";
const DEFAULT_SAMPLE_SIZE: usize = 50;

// ─── Public IO ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaInput {
    pub repo: String, // "owner/repo"
    #[serde(default)]
    pub sample_size: Option<usize>,
    #[serde(default = "default_provider")]
    pub provider: String,
}
fn default_provider() -> String {
    "claude".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaArchetype {
    pub name: String,
    pub one_liner: String,
    pub population_pct: f64,
    pub representative_handles: Vec<String>,
    pub signals: Vec<String>,
    pub jobs_to_be_done: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaReport {
    pub repo: String,
    pub sample_size: usize,
    pub stargazer_count: usize,
    pub issue_author_count: usize,
    pub archetypes: Vec<PersonaArchetype>,
    pub summary: String,
    pub took_ms: u64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GithubUserProfile {
    handle: String,
    bio: Option<String>,
    company: Option<String>,
    location: Option<String>,
    public_repos: i64,
    followers: i64,
    top_languages: Vec<String>,
    seen_via: String, // "stargazer" | "issue_author"
}

// ─── Tauri command ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_personas(
    db: State<'_, DbState>,
    input: PersonaInput,
) -> Result<PersonaReport, String> {
    let started = std::time::Instant::now();
    let repo = input.repo.trim().to_string();
    if !repo.contains('/') {
        return Err(format!(
            "expected owner/repo (got {repo:?}). Example: sarthak-fleet/CodeVetter"
        ));
    }
    let sample = input.sample_size.unwrap_or(DEFAULT_SAMPLE_SIZE).clamp(5, 200);

    let token = read_github_token(&db);
    let mut warnings: Vec<String> = Vec::new();

    let stargazers = match fetch_stargazers(&repo, sample, token.as_deref()).await {
        Ok(v) => v,
        Err(e) => {
            warnings.push(format!("stargazers failed: {e}"));
            vec![]
        }
    };
    let issue_authors = match fetch_issue_authors(&repo, sample.min(30), token.as_deref()).await {
        Ok(v) => v,
        Err(e) => {
            warnings.push(format!("issue authors failed: {e}"));
            vec![]
        }
    };

    // Hydrate user profiles for the union (deduped, capped).
    let mut seen: std::collections::HashMap<String, &str> = std::collections::HashMap::new();
    for h in &stargazers {
        seen.entry(h.clone()).or_insert("stargazer");
    }
    for h in &issue_authors {
        seen.entry(h.clone()).or_insert("issue_author");
    }
    let mut profiles: Vec<GithubUserProfile> = Vec::new();
    for (handle, via) in seen.iter().take(sample) {
        match fetch_user_profile(handle, token.as_deref()).await {
            Ok(mut p) => {
                p.seen_via = (*via).to_string();
                profiles.push(p);
            }
            Err(_) => {
                // soft-fail on a per-user 404 — keep going
            }
        }
    }

    if profiles.is_empty() {
        return Err(format!(
            "No profiles fetched for {repo}. Warnings: {warnings:?}"
        ));
    }

    let cluster_prompt = build_cluster_prompt(&repo, &profiles);
    let raw = match input.provider.as_str() {
        "codex" => spawn_oneshot("codex", &["exec", "--json"], &cluster_prompt).await?,
        _ => spawn_oneshot("claude", &["-p", "--output-format", "text"], &cluster_prompt).await?,
    };
    let parsed = parse_cluster_response(&raw).ok_or_else(|| {
        format!(
            "LLM returned a non-JSON response. Head: {}",
            raw.chars().take(300).collect::<String>()
        )
    })?;

    Ok(PersonaReport {
        repo,
        sample_size: profiles.len(),
        stargazer_count: stargazers.len(),
        issue_author_count: issue_authors.len(),
        archetypes: parsed.archetypes,
        summary: parsed.summary,
        took_ms: started.elapsed().as_millis() as u64,
        warnings,
    })
}

// ─── GitHub API ─────────────────────────────────────────────────────────────

async fn fetch_stargazers(
    repo: &str,
    cap: usize,
    token: Option<&str>,
) -> Result<Vec<String>, String> {
    // We sample the most recent N stargazers (default ordering is fine for
    // an MVP — we're after archetype shape, not full census).
    let url = format!("https://api.github.com/repos/{repo}/stargazers?per_page={cap}");
    let client = build_client()?;
    let mut req = client.get(&url).header("Accept", "application/vnd.github+json");
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("GET {url}: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("{status}: {}", body.chars().take(200).collect::<String>()));
    }
    let v: Value = serde_json::from_str(&body).map_err(|e| format!("parse: {e}"))?;
    let arr = v.as_array().cloned().unwrap_or_default();
    Ok(arr
        .into_iter()
        .filter_map(|item| {
            item.get("login")
                .and_then(|s| s.as_str())
                .map(String::from)
        })
        .collect())
}

async fn fetch_issue_authors(
    repo: &str,
    cap: usize,
    token: Option<&str>,
) -> Result<Vec<String>, String> {
    let url = format!(
        "https://api.github.com/repos/{repo}/issues?state=all&per_page={cap}"
    );
    let client = build_client()?;
    let mut req = client.get(&url).header("Accept", "application/vnd.github+json");
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("GET {url}: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("{status}: {}", body.chars().take(200).collect::<String>()));
    }
    let v: Value = serde_json::from_str(&body).map_err(|e| format!("parse: {e}"))?;
    let arr = v.as_array().cloned().unwrap_or_default();
    Ok(arr
        .into_iter()
        .filter_map(|item| {
            item.pointer("/user/login")
                .and_then(|s| s.as_str())
                .map(String::from)
        })
        .collect())
}

async fn fetch_user_profile(
    handle: &str,
    token: Option<&str>,
) -> Result<GithubUserProfile, String> {
    let url = format!("https://api.github.com/users/{handle}");
    let client = build_client()?;
    let mut req = client.get(&url).header("Accept", "application/vnd.github+json");
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("GET {url}: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("{status}: {}", body.chars().take(200).collect::<String>()));
    }
    let v: Value = serde_json::from_str(&body).map_err(|e| format!("parse: {e}"))?;
    let public_repos = v.get("public_repos").and_then(|n| n.as_i64()).unwrap_or(0);
    let followers = v.get("followers").and_then(|n| n.as_i64()).unwrap_or(0);
    // Sample the user's top repos to derive languages — only pull this for
    // users with non-trivial public output so we don't burn rate-limit on
    // empty accounts.
    let top_languages = if public_repos >= 3 {
        fetch_top_languages(handle, token).await.unwrap_or_default()
    } else {
        vec![]
    };
    Ok(GithubUserProfile {
        handle: handle.to_string(),
        bio: v.get("bio").and_then(|s| s.as_str()).map(String::from),
        company: v.get("company").and_then(|s| s.as_str()).map(String::from),
        location: v.get("location").and_then(|s| s.as_str()).map(String::from),
        public_repos,
        followers,
        top_languages,
        seen_via: String::new(),
    })
}

async fn fetch_top_languages(
    handle: &str,
    token: Option<&str>,
) -> Result<Vec<String>, String> {
    let url = format!(
        "https://api.github.com/users/{handle}/repos?sort=stars&per_page=5"
    );
    let client = build_client()?;
    let mut req = client.get(&url).header("Accept", "application/vnd.github+json");
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let resp = req.send().await.map_err(|e| format!("GET {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err("non-2xx".into());
    }
    let body = resp.text().await.unwrap_or_default();
    let v: Value = serde_json::from_str(&body).map_err(|e| format!("parse: {e}"))?;
    let arr = v.as_array().cloned().unwrap_or_default();
    let mut langs: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for item in arr {
        if let Some(lang) = item.get("language").and_then(|s| s.as_str()) {
            if seen.insert(lang.to_string()) {
                langs.push(lang.to_string());
            }
        }
    }
    Ok(langs)
}

// ─── LLM clustering ────────────────────────────────────────────────────────

struct ParsedClusters {
    archetypes: Vec<PersonaArchetype>,
    summary: String,
}

fn build_cluster_prompt(repo: &str, profiles: &[GithubUserProfile]) -> String {
    let mut profile_dump = String::new();
    for p in profiles {
        profile_dump.push_str(&format!(
            "- @{} ({}): bio={:?}, company={:?}, location={:?}, public_repos={}, followers={}, top_langs={:?}\n",
            p.handle,
            p.seen_via,
            p.bio.clone().unwrap_or_default(),
            p.company.clone().unwrap_or_default(),
            p.location.clone().unwrap_or_default(),
            p.public_repos,
            p.followers,
            p.top_languages,
        ));
    }
    format!(
        r#"You are a product analyst. You will be given a sample of GitHub users who have either starred a repo or interacted with its issues. Your job is to cluster them into 3 to 5 distinct user archetypes that explain the repo's actual audience.

Repo: {repo}

Sample (each line is one user):
{profile_dump}

Output EXACTLY one JSON object on its own line, no prose, no markdown fences:

{{
  "summary": "1–2 sentence read of who the audience actually is",
  "archetypes": [
    {{
      "name": "<short label, e.g. 'Infra-curious senior IC'>",
      "one_liner": "<single sentence describing this archetype>",
      "population_pct": <approximate percent of the sample, 0–100>,
      "representative_handles": ["<handle1>", "<handle2>", "<handle3>"],
      "signals": ["<observable signal from their profile that placed them here>", ...],
      "jobs_to_be_done": ["<what this archetype likely needs from the repo>", ...]
    }},
    ...
  ]
}}

Cluster on real signals from the profiles — top languages, bios, company patterns, location clustering, public_repos / followers magnitude. Population percents must sum to roughly 100.
"#
    )
}

fn parse_cluster_response(raw: &str) -> Option<ParsedClusters> {
    for chunk in scan_json_objects(raw) {
        if let Ok(v) = serde_json::from_str::<Value>(&chunk) {
            if v.get("archetypes").is_some() {
                let archetypes: Vec<PersonaArchetype> = v
                    .get("archetypes")
                    .and_then(|a| a.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|x| serde_json::from_value::<PersonaArchetype>(x.clone()).ok())
                            .collect()
                    })
                    .unwrap_or_default();
                let summary = v
                    .get("summary")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string();
                return Some(ParsedClusters { archetypes, summary });
            }
        }
    }
    None
}

fn scan_json_objects(s: &str) -> Vec<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut start = 0usize;
    let mut in_string = false;
    let mut esc = false;
    for (i, &b) in bytes.iter().enumerate() {
        if in_string {
            if esc {
                esc = false;
                continue;
            }
            match b {
                b'\\' => esc = true,
                b'"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => {
                if depth == 0 {
                    start = i;
                }
                depth += 1;
            }
            b'}' => {
                depth -= 1;
                if depth == 0 && i + 1 >= start {
                    out.push(String::from_utf8_lossy(&bytes[start..=i]).to_string());
                }
            }
            _ => {}
        }
    }
    out
}

// ─── helpers ───────────────────────────────────────────────────────────────

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("CodeVetter/persona (https://github.com/sarthak-fleet/CodeVetter)")
        .build()
        .map_err(|e| format!("reqwest build: {e}"))
}

fn read_github_token(db: &State<'_, DbState>) -> Option<String> {
    let conn = db.0.lock().ok()?;
    conn.query_row(
        "SELECT value FROM preferences WHERE key = ?1",
        params![PREF_GITHUB_TOKEN],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

async fn spawn_oneshot(cmd: &str, args: &[&str], prompt: &str) -> Result<String, String> {
    let mut child = Command::new(cmd)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn {cmd}: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| format!("stdin write: {e}"))?;
        let _ = stdin.shutdown().await;
    }
    let out = child
        .wait_with_output()
        .await
        .map_err(|e| format!("wait {cmd}: {e}"))?;
    if !out.status.success() {
        return Err(format!("{cmd} exit {:?}", out.status.code()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cluster_basic() {
        let raw = r#"
Sure:

{"summary":"Backend infra ICs at series-A startups.","archetypes":[
  {"name":"Senior infra IC","one_liner":"experienced backend engineer at growth-stage startups","population_pct":60,"representative_handles":["a","b","c"],"signals":["Go + Rust top langs","Bay Area / NYC","2k+ followers"],"jobs_to_be_done":["adopt without YAML","run on a laptop"]}
]}

Hope that helps!
        "#;
        let p = parse_cluster_response(raw).unwrap();
        assert_eq!(p.archetypes.len(), 1);
        assert_eq!(p.archetypes[0].population_pct, 60.0);
        assert_eq!(p.summary, "Backend infra ICs at series-A startups.");
    }

    #[test]
    fn parse_cluster_rejects_random_object() {
        let raw = r#"{"foo":"bar"}"#;
        assert!(parse_cluster_response(raw).is_none());
    }

    #[test]
    fn scan_finds_balanced_objects_only() {
        let raw = r#"prefix {"a":1} middle {"b":{"c":2}} suffix"#;
        let chunks = scan_json_objects(raw);
        assert_eq!(chunks.len(), 2);
    }
}
