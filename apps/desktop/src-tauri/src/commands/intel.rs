//! Engineering-intelligence commands for the personal `/intel` tab.
//!
//! Two surfaces, both local-only:
//!   • `attribute_repo_commits` — parse `git log` for a repo, classify each
//!     commit AI vs human, plus by-author / by-tool / by-file rollups
//!     across multiple time windows in a single pass.
//!   • `get_tool_breakdown` — re-aggregate `cc_sessions` per tool with
//!     model split, cache creation, p50/p95 cost, daily cost series.

use crate::DbState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::process::Command as StdCommand;
use tauri::State;

// ─── Tool taxonomy ──────────────────────────────────────────────────────────

const TOOL_CLAUDE: &str = "claude-code";
const TOOL_CODEX: &str = "codex";
const TOOL_CURSOR: &str = "cursor";
const TOOL_DEVIN: &str = "devin";
const TOOL_AIDER: &str = "aider";
const TOOL_WINDSURF: &str = "windsurf";
const TOOL_HUMAN: &str = "human";
const TOOL_AUTOMATION: &str = "automation";

fn classify_marker(haystack: &str) -> Option<&'static str> {
    // Order matters: more specific tokens first.
    let table: &[(&str, &str)] = &[
        ("claude-code", TOOL_CLAUDE),
        ("claude code", TOOL_CLAUDE),
        ("noreply@anthropic.com", TOOL_CLAUDE),
        ("anthropic", TOOL_CLAUDE),
        ("claude", TOOL_CLAUDE),
        ("openai-codex", TOOL_CODEX),
        ("codex-cli", TOOL_CODEX),
        ("codex", TOOL_CODEX),
        ("cursor", TOOL_CURSOR),
        ("devin", TOOL_DEVIN),
        ("aider", TOOL_AIDER),
        ("windsurf", TOOL_WINDSURF),
    ];
    for (needle, id) in table {
        if haystack.contains(needle) {
            return Some(id);
        }
    }
    None
}

fn is_automation_identity(email: &str, name: &str) -> bool {
    let e = email.to_ascii_lowercase();
    let n = name.to_ascii_lowercase();
    e.contains("[bot]")
        || n.contains("[bot]")
        || e.starts_with("dependabot")
        || e.starts_with("renovate")
        || e.starts_with("github-actions")
        || n == "dependabot[bot]"
        || n == "renovate[bot]"
}

// ─── Parsed shapes ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
struct ParsedCommit {
    sha: String,
    author_name: String,
    author_email: String,
    timestamp: i64,
    body: String,
    additions: u64,
    deletions: u64,
    files: Vec<FileChange>,
}

#[derive(Debug, Clone, PartialEq)]
struct FileChange {
    path: String,
    additions: u64,
    deletions: u64,
}

// ─── Public report shapes ───────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCount {
    pub tool: String,
    pub commits: u64,
    pub additions: u64,
    pub deletions: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DailyAttribution {
    pub date: String,
    pub ai_commits: u64,
    pub human_commits: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowReport {
    pub label: String, // "all" / "90d" / "30d" / "7d"
    pub total_commits: u64,
    pub ai_commits: u64,
    pub human_commits: u64,
    pub automation_commits: u64,
    pub ai_additions: u64,
    pub ai_deletions: u64,
    pub human_additions: u64,
    pub human_deletions: u64,
    pub active_days: u64,
    pub by_tool: Vec<ToolCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorRow {
    pub name: String,
    pub email: String,
    pub commits: u64,
    pub ai_commits: u64,
    pub human_commits: u64,
    pub additions: u64,
    pub deletions: u64,
    pub active_days: u64,
    pub last_commit: String,
    pub tool_mix: Vec<ToolCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChurn {
    pub path: String,
    pub commits: u64,
    pub additions: u64,
    pub deletions: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoAttributionReport {
    pub repo_path: String,
    pub windows: Vec<WindowReport>,
    pub by_author: Vec<AuthorRow>,
    pub top_files: Vec<FileChurn>,
    pub day_of_week: [u64; 7], // Mon..Sun
    pub daily_series: Vec<DailyAttribution>, // last 90d, zero-filled
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCostRow {
    pub model: String,
    pub sessions: i64,
    pub estimated_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyCost {
    pub date: String,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolBreakdownRow {
    pub tool: String,
    pub sessions: i64,
    pub real_input_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_creation_tokens: i64,
    pub output_tokens: i64,
    pub estimated_cost_usd: f64,
    pub cost_p50_usd: f64,
    pub cost_p95_usd: f64,
    pub avg_session_seconds: Option<f64>,
    pub models: Vec<ModelCostRow>,
    pub daily_cost: Vec<DailyCost>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PricingRow {
    pub model: &'static str,
    pub input_per_mtok: f64,
    pub output_per_mtok: f64,
    pub cache_read_per_mtok: f64,
    pub cache_write_per_mtok: f64,
}

pub const PRICING_TABLE: &[PricingRow] = &[
    PricingRow {
        model: "opus",
        input_per_mtok: 15.0,
        output_per_mtok: 75.0,
        cache_read_per_mtok: 1.5,
        cache_write_per_mtok: 18.75,
    },
    PricingRow {
        model: "sonnet",
        input_per_mtok: 3.0,
        output_per_mtok: 15.0,
        cache_read_per_mtok: 0.3,
        cache_write_per_mtok: 3.75,
    },
    PricingRow {
        model: "haiku",
        input_per_mtok: 0.25,
        output_per_mtok: 1.25,
        cache_read_per_mtok: 0.025,
        cache_write_per_mtok: 0.3,
    },
    PricingRow {
        model: "gpt-4o",
        input_per_mtok: 2.5,
        output_per_mtok: 10.0,
        cache_read_per_mtok: 1.25,
        cache_write_per_mtok: 2.5,
    },
    PricingRow {
        model: "gpt-4.1",
        input_per_mtok: 2.0,
        output_per_mtok: 8.0,
        cache_read_per_mtok: 0.5,
        cache_write_per_mtok: 2.0,
    },
];

// ─── git log parser ─────────────────────────────────────────────────────────

const UNIT_SEP: char = '\u{1f}';
const REC_SEP: char = '\u{1e}';

/// IMPORTANT: REC_SEP must come BEFORE %H, not after %B. `git log --numstat`
/// places numstat lines AFTER the pretty-format output of each commit. If
/// the separator follows %B, split() ends up putting commit N's numstat at
/// the start of chunk N+1 (junked into the next sha field). With the
/// separator leading each record, each chunk = one commit's header + body
/// + its own numstat. The first chunk before the first separator is empty.
const PRETTY_FORMAT: &str = "%x1e%H%x1f%an%x1f%ae%x1f%at%x1f%B";

fn parse_git_log(raw: &str) -> Vec<ParsedCommit> {
    let mut out = Vec::new();
    for raw_rec in raw.split(REC_SEP) {
        let rec = raw_rec.trim_matches(|c: char| c == '\n' || c == '\r');
        if rec.is_empty() {
            continue;
        }
        let mut header_and_rest = rec.splitn(5, UNIT_SEP);
        let sha = header_and_rest.next().unwrap_or("").trim().to_string();
        let name = header_and_rest.next().unwrap_or("").to_string();
        let email = header_and_rest.next().unwrap_or("").to_string();
        let ts_str = header_and_rest.next().unwrap_or("0");
        let body_plus = header_and_rest.next().unwrap_or("");
        if sha.is_empty() || sha.len() > 64 {
            continue;
        }

        let (body, numstat) = split_body_and_numstat(body_plus);

        let mut files: Vec<FileChange> = Vec::new();
        let mut total_add = 0u64;
        let mut total_del = 0u64;
        for line in numstat.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let mut cols = line.splitn(3, '\t');
            let add = cols.next().unwrap_or("-");
            let del = cols.next().unwrap_or("-");
            let path = cols.next().unwrap_or("").to_string();
            if path.is_empty() {
                continue;
            }
            let (a, d) = match (add.parse::<u64>(), del.parse::<u64>()) {
                (Ok(a), Ok(d)) => (a, d),
                _ => (0, 0), // binary file or unknown
            };
            total_add += a;
            total_del += d;
            files.push(FileChange {
                path,
                additions: a,
                deletions: d,
            });
        }

        out.push(ParsedCommit {
            sha,
            author_name: name,
            author_email: email,
            timestamp: ts_str.trim().parse::<i64>().unwrap_or(0),
            body,
            additions: total_add,
            deletions: total_del,
            files,
        });
    }
    out
}

fn split_body_and_numstat(blob: &str) -> (String, String) {
    let mut body = String::new();
    let mut numstat = String::new();
    let mut in_numstat = false;
    for line in blob.lines() {
        if !in_numstat && line_is_numstat(line) {
            in_numstat = true;
        }
        if in_numstat {
            numstat.push_str(line);
            numstat.push('\n');
        } else {
            body.push_str(line);
            body.push('\n');
        }
    }
    (body.trim_end().to_string(), numstat)
}

fn line_is_numstat(line: &str) -> bool {
    let mut parts = line.splitn(3, '\t');
    let a = parts.next().unwrap_or("");
    let b = parts.next().unwrap_or("");
    let c = parts.next().unwrap_or("");
    if c.is_empty() {
        return false;
    }
    let valid = |s: &str| s == "-" || s.chars().all(|ch| ch.is_ascii_digit());
    valid(a) && valid(b)
}

// ─── Classifier ─────────────────────────────────────────────────────────────

fn classify_commit(c: &ParsedCommit) -> (&'static str, bool) {
    if is_automation_identity(&c.author_email, &c.author_name) {
        return (TOOL_AUTOMATION, false);
    }
    let mut hits: Vec<&'static str> = Vec::new();
    for line in c.body.lines() {
        let lower = line.to_ascii_lowercase();
        if let Some(tool) = classify_marker(&lower) {
            if !hits.contains(&tool) {
                hits.push(tool);
            }
        }
    }
    let author_blob = format!(
        "{} {}",
        c.author_email.to_ascii_lowercase(),
        c.author_name.to_ascii_lowercase()
    );
    if let Some(tool) = classify_marker(&author_blob) {
        if !hits.contains(&tool) {
            hits.push(tool);
        }
    }
    if let Some(first) = hits.first() {
        return (*first, true);
    }
    (TOOL_HUMAN, false)
}

// ─── Public commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn attribute_repo_commits(
    repo_path: String,
) -> Result<RepoAttributionReport, String> {
    let trimmed = repo_path.trim().to_string();
    if trimmed.is_empty() {
        return Err("repo_path is empty".to_string());
    }
    let raw = run_git_log(&trimmed)?;
    let commits = parse_git_log(&raw);
    Ok(summarize(trimmed, &commits))
}

#[tauri::command]
pub async fn get_tool_breakdown(
    db: State<'_, DbState>,
    since_days: Option<u32>,
) -> Result<Vec<ToolBreakdownRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    query_tool_breakdown(&conn, since_days).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pricing_table() -> Result<Vec<PricingRow>, String> {
    Ok(PRICING_TABLE.to_vec())
}

// ─── Internals ──────────────────────────────────────────────────────────────

fn run_git_log(repo_path: &str) -> Result<String, String> {
    // Always fetch all-time. Windowing happens in code so we can emit
    // four windows + by-author + by-file from a single git call.
    let out = StdCommand::new("git")
        .args([
            "log",
            "--no-merges",
            &format!("--pretty=format:{PRETTY_FORMAT}"),
            "--numstat",
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run git log: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git log failed: {stderr}"));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn summarize(repo_path: String, commits: &[ParsedCommit]) -> RepoAttributionReport {
    // Anchor windows on the newest commit so a stale repo still shows useful "30d" etc.
    let now_ts = max_ts(commits);
    let mut classified: Vec<Classified> = Vec::with_capacity(commits.len());
    for c in commits {
        let (tool, is_ai) = classify_commit(c);
        let (day, weekday) = unix_to_day_and_weekday(c.timestamp);
        classified.push(Classified {
            commit: c,
            tool,
            is_ai,
            day,
            weekday,
        });
    }

    let window_specs: &[(&str, Option<i64>)] = &[
        ("all", None),
        ("90d", Some(90)),
        ("30d", Some(30)),
        ("7d", Some(7)),
    ];

    let windows: Vec<WindowReport> = window_specs
        .iter()
        .map(|(label, days)| {
            let cutoff = days.map(|d| now_ts - d * 86_400);
            window_for(label, cutoff, &classified)
        })
        .collect();

    let by_author = author_rollup(&classified);
    let top_files = file_churn(commits, 15);
    let day_of_week = dayofweek_histogram(&classified);
    let daily_series = daily_series_90d(&classified, now_ts);

    RepoAttributionReport {
        repo_path,
        windows,
        by_author,
        top_files,
        day_of_week,
        daily_series,
    }
}

fn window_for<'a>(
    label: &str,
    cutoff_ts: Option<i64>,
    classified: &[ClassifiedRef<'a>],
) -> WindowReport {
    let mut total = 0u64;
    let mut ai = 0u64;
    let mut human = 0u64;
    let mut automation = 0u64;
    let mut ai_add = 0u64;
    let mut ai_del = 0u64;
    let mut human_add = 0u64;
    let mut human_del = 0u64;
    let mut by_tool: HashMap<&'static str, ToolCount> = HashMap::new();
    let mut day_set: std::collections::HashSet<String> = std::collections::HashSet::new();

    for c in classified {
        if let Some(cut) = cutoff_ts {
            if c.commit.timestamp < cut {
                continue;
            }
        }
        total += 1;
        day_set.insert(c.day.clone());
        let entry = by_tool.entry(c.tool).or_insert_with(|| ToolCount {
            tool: c.tool.to_string(),
            commits: 0,
            additions: 0,
            deletions: 0,
        });
        entry.commits += 1;
        entry.additions += c.commit.additions;
        entry.deletions += c.commit.deletions;

        if c.tool == TOOL_AUTOMATION {
            automation += 1;
        } else if c.is_ai {
            ai += 1;
            ai_add += c.commit.additions;
            ai_del += c.commit.deletions;
        } else {
            human += 1;
            human_add += c.commit.additions;
            human_del += c.commit.deletions;
        }
    }

    let mut tool_counts: Vec<ToolCount> = by_tool.into_values().collect();
    tool_counts.sort_by(|a, b| b.commits.cmp(&a.commits));

    WindowReport {
        label: label.to_string(),
        total_commits: total,
        ai_commits: ai,
        human_commits: human,
        automation_commits: automation,
        ai_additions: ai_add,
        ai_deletions: ai_del,
        human_additions: human_add,
        human_deletions: human_del,
        active_days: day_set.len() as u64,
        by_tool: tool_counts,
    }
}

// Helper alias because closures and lifetimes get verbose.
type ClassifiedRef<'a> = Classified<'a>;
struct Classified<'a> {
    commit: &'a ParsedCommit,
    tool: &'static str,
    is_ai: bool,
    day: String,
    weekday: usize,
}

fn author_rollup<'a>(classified: &[ClassifiedRef<'a>]) -> Vec<AuthorRow> {
    let mut by_email: HashMap<String, AuthorRow> = HashMap::new();
    let mut tool_mix_by_email: HashMap<String, HashMap<&'static str, ToolCount>> = HashMap::new();
    let mut days_by_email: HashMap<String, std::collections::HashSet<String>> = HashMap::new();

    for c in classified {
        let email_key = if c.commit.author_email.is_empty() {
            c.commit.author_name.clone()
        } else {
            c.commit.author_email.to_lowercase()
        };

        let entry = by_email.entry(email_key.clone()).or_insert_with(|| AuthorRow {
            name: c.commit.author_name.clone(),
            email: c.commit.author_email.clone(),
            commits: 0,
            ai_commits: 0,
            human_commits: 0,
            additions: 0,
            deletions: 0,
            active_days: 0,
            last_commit: c.day.clone(),
            tool_mix: Vec::new(),
        });

        entry.commits += 1;
        entry.additions += c.commit.additions;
        entry.deletions += c.commit.deletions;
        if c.tool == TOOL_AUTOMATION {
            // automation commits don't count to AI nor human
        } else if c.is_ai {
            entry.ai_commits += 1;
        } else {
            entry.human_commits += 1;
        }
        if c.day.as_str() > entry.last_commit.as_str() {
            entry.last_commit = c.day.clone();
        }

        let mix = tool_mix_by_email
            .entry(email_key.clone())
            .or_insert_with(HashMap::new);
        let tc = mix.entry(c.tool).or_insert_with(|| ToolCount {
            tool: c.tool.to_string(),
            commits: 0,
            additions: 0,
            deletions: 0,
        });
        tc.commits += 1;
        tc.additions += c.commit.additions;
        tc.deletions += c.commit.deletions;

        days_by_email
            .entry(email_key)
            .or_insert_with(std::collections::HashSet::new)
            .insert(c.day.clone());
    }

    let mut rows: Vec<AuthorRow> = by_email
        .into_iter()
        .map(|(key, mut row)| {
            let mut mix: Vec<ToolCount> = tool_mix_by_email
                .remove(&key)
                .unwrap_or_default()
                .into_values()
                .collect();
            mix.sort_by(|a, b| b.commits.cmp(&a.commits));
            row.tool_mix = mix;
            row.active_days = days_by_email
                .remove(&key)
                .map(|s| s.len() as u64)
                .unwrap_or(0);
            row
        })
        .collect();
    rows.sort_by(|a, b| b.commits.cmp(&a.commits));
    rows.truncate(20);
    rows
}

fn file_churn(commits: &[ParsedCommit], top_n: usize) -> Vec<FileChurn> {
    let mut by_path: HashMap<String, FileChurn> = HashMap::new();
    for c in commits {
        for f in &c.files {
            let entry = by_path.entry(f.path.clone()).or_insert_with(|| FileChurn {
                path: f.path.clone(),
                commits: 0,
                additions: 0,
                deletions: 0,
            });
            entry.commits += 1;
            entry.additions += f.additions;
            entry.deletions += f.deletions;
        }
    }
    let mut rows: Vec<FileChurn> = by_path.into_values().collect();
    rows.sort_by(|a, b| {
        (b.additions + b.deletions)
            .cmp(&(a.additions + a.deletions))
            .then(b.commits.cmp(&a.commits))
    });
    rows.truncate(top_n);
    rows
}

fn dayofweek_histogram<'a>(classified: &[ClassifiedRef<'a>]) -> [u64; 7] {
    let mut h = [0u64; 7];
    for c in classified {
        if c.weekday < 7 {
            h[c.weekday] += 1;
        }
    }
    h
}

fn daily_series_90d<'a>(classified: &[ClassifiedRef<'a>], now_ts: i64) -> Vec<DailyAttribution> {
    let mut by_day: BTreeMap<String, (u64, u64)> = BTreeMap::new();
    let cutoff = now_ts - 89 * 86_400; // last 90 days inclusive
    for c in classified {
        if c.commit.timestamp < cutoff {
            continue;
        }
        let entry = by_day.entry(c.day.clone()).or_insert((0, 0));
        if c.is_ai {
            entry.0 += 1;
        } else if c.tool != TOOL_AUTOMATION {
            entry.1 += 1;
        }
    }
    // Zero-fill the 90-day window.
    use chrono::{Duration, TimeZone, Utc};
    let now_day = match Utc.timestamp_opt(now_ts, 0).single() {
        Some(dt) => dt.date_naive(),
        None => return Vec::new(),
    };
    let mut out: Vec<DailyAttribution> = Vec::with_capacity(90);
    for i in 0..90 {
        let day = (now_day - Duration::days(89 - i)).format("%Y-%m-%d").to_string();
        let (ai, human) = by_day.get(&day).copied().unwrap_or((0, 0));
        out.push(DailyAttribution {
            date: day,
            ai_commits: ai,
            human_commits: human,
        });
    }
    out
}

fn unix_to_day_and_weekday(ts: i64) -> (String, usize) {
    use chrono::{Datelike, TimeZone, Utc};
    match Utc.timestamp_opt(ts, 0).single() {
        Some(dt) => {
            let day = dt.format("%Y-%m-%d").to_string();
            // Mon=0 .. Sun=6 to match how we display the histogram.
            let wd = dt.weekday().num_days_from_monday() as usize;
            (day, wd)
        }
        None => ("unknown".to_string(), 0),
    }
}

fn max_ts(commits: &[ParsedCommit]) -> i64 {
    commits.iter().map(|c| c.timestamp).max().unwrap_or_else(|| {
        // Empty repo: fall back to now so the empty windows return cleanly.
        chrono::Utc::now().timestamp()
    })
}

// ─── Tool breakdown query ───────────────────────────────────────────────────

fn query_tool_breakdown(
    conn: &rusqlite::Connection,
    since_days: Option<u32>,
) -> Result<Vec<ToolBreakdownRow>, rusqlite::Error> {
    let cutoff = since_days.map(|d| {
        use chrono::{Duration, Local};
        let cut = Local::now().date_naive() - Duration::days(d as i64);
        format!("{}T00:00:00Z", cut.format("%Y-%m-%d"))
    });

    // 1. Per-(tool, session) cost rows — used for tool totals, percentiles
    //    and the daily cost sparkline.
    let mut session_stmt = conn.prepare(
        "SELECT
            agent_type,
            COALESCE(model_used, ''),
            COALESCE(estimated_cost_usd, 0.0),
            COALESCE(total_input_tokens, 0),
            COALESCE(cache_read_tokens, 0),
            COALESCE(cache_creation_tokens, 0),
            COALESCE(total_output_tokens, 0),
            first_message,
            last_message,
            COALESCE(SUBSTR(last_message, 1, 10), '')
         FROM cc_sessions
         WHERE (?1 IS NULL OR last_message >= ?1)",
    )?;

    struct SessionStats {
        tool: String,
        model: String,
        cost: f64,
        input: i64,
        cache_read: i64,
        cache_creation: i64,
        output: i64,
        seconds: Option<f64>,
        day: String,
    }

    let session_rows: Vec<SessionStats> = session_stmt
        .query_map(params![cutoff.clone()], |r| {
            let first: Option<String> = r.get(7)?;
            let last: Option<String> = r.get(8)?;
            let seconds = match (first, last) {
                (Some(a), Some(b)) => parse_session_seconds(&a, &b),
                _ => None,
            };
            Ok(SessionStats {
                tool: r.get(0)?,
                model: r.get(1)?,
                cost: r.get(2)?,
                input: r.get(3)?,
                cache_read: r.get(4)?,
                cache_creation: r.get(5)?,
                output: r.get(6)?,
                seconds,
                day: r.get(9)?,
            })
        })?
        .collect::<Result<_, _>>()?;

    // 2. Aggregate per-tool.
    let mut by_tool: HashMap<String, Vec<SessionStats>> = HashMap::new();
    for s in session_rows {
        by_tool.entry(s.tool.clone()).or_default().push(s);
    }

    let mut out: Vec<ToolBreakdownRow> = Vec::new();
    for (tool, rows) in by_tool {
        let sessions = rows.len() as i64;

        let mut input = 0i64;
        let mut cache_read = 0i64;
        let mut cache_creation = 0i64;
        let mut output = 0i64;
        let mut cost = 0.0f64;
        let mut sec_acc = 0.0f64;
        let mut sec_count = 0u64;
        let mut costs: Vec<f64> = Vec::with_capacity(rows.len());

        let mut model_acc: HashMap<String, (i64, f64)> = HashMap::new(); // model → (sessions, cost)
        let mut day_acc: HashMap<String, f64> = HashMap::new();

        for s in &rows {
            // Base input = input - cache_read - cache_creation to avoid
            // double-counting (Claude Code's JSONL reports total_input that
            // includes cache reads and writes).
            let base_input = (s.input - s.cache_read - s.cache_creation).max(0);
            input += base_input;
            cache_read += s.cache_read;
            cache_creation += s.cache_creation;
            output += s.output;
            cost += s.cost;
            costs.push(s.cost);
            if let Some(sec) = s.seconds {
                sec_acc += sec;
                sec_count += 1;
            }
            let model_label = canonicalize_model(&s.model);
            let m = model_acc.entry(model_label).or_insert((0, 0.0));
            m.0 += 1;
            m.1 += s.cost;
            if !s.day.is_empty() {
                *day_acc.entry(s.day.clone()).or_insert(0.0) += s.cost;
            }
        }

        let avg_seconds = if sec_count > 0 {
            Some(sec_acc / sec_count as f64)
        } else {
            None
        };

        let (p50, p95) = percentiles(&mut costs);

        let mut models: Vec<ModelCostRow> = model_acc
            .into_iter()
            .map(|(model, (sessions, cost))| ModelCostRow {
                model,
                sessions,
                estimated_cost_usd: round2(cost),
            })
            .collect();
        models.sort_by(|a, b| {
            b.estimated_cost_usd
                .partial_cmp(&a.estimated_cost_usd)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // Daily cost sparkline over the same window the user asked for
        // (capped at 30 buckets for display).
        let bucket_count = since_days.map(|d| d.min(30)).unwrap_or(30) as usize;
        let daily_cost = build_daily_cost(&day_acc, bucket_count);

        out.push(ToolBreakdownRow {
            tool,
            sessions,
            real_input_tokens: input,
            cache_read_tokens: cache_read,
            cache_creation_tokens: cache_creation,
            output_tokens: output,
            estimated_cost_usd: round2(cost),
            cost_p50_usd: round2(p50),
            cost_p95_usd: round2(p95),
            avg_session_seconds: avg_seconds,
            models,
            daily_cost,
        });
    }

    out.sort_by(|a, b| {
        b.estimated_cost_usd
            .partial_cmp(&a.estimated_cost_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
}

fn parse_session_seconds(first: &str, last: &str) -> Option<f64> {
    use chrono::DateTime;
    let a = DateTime::parse_from_rfc3339(first).ok()?;
    let b = DateTime::parse_from_rfc3339(last).ok()?;
    let secs = (b - a).num_seconds() as f64;
    if secs < 0.0 {
        None
    } else {
        Some(secs)
    }
}

fn canonicalize_model(raw: &str) -> String {
    let r = raw.to_ascii_lowercase();
    if r.is_empty() {
        return "unknown".into();
    }
    if r.contains("opus") {
        return "opus".into();
    }
    if r.contains("sonnet") {
        return "sonnet".into();
    }
    if r.contains("haiku") {
        return "haiku".into();
    }
    if r.contains("gpt-4o") {
        return "gpt-4o".into();
    }
    if r.contains("gpt-4.1") {
        return "gpt-4.1".into();
    }
    if r.contains("o3") || r.contains("o4-mini") {
        return "o-series".into();
    }
    r
}

fn percentiles(values: &mut [f64]) -> (f64, f64) {
    if values.is_empty() {
        return (0.0, 0.0);
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let pick = |q: f64| {
        let idx = ((values.len() as f64 - 1.0) * q).round() as usize;
        values[idx.min(values.len() - 1)]
    };
    (pick(0.5), pick(0.95))
}

fn build_daily_cost(day_acc: &HashMap<String, f64>, bucket_count: usize) -> Vec<DailyCost> {
    use chrono::{Duration, Local};
    let today = Local::now().date_naive();
    let mut out: Vec<DailyCost> = Vec::with_capacity(bucket_count);
    for i in 0..bucket_count {
        let d = (today - Duration::days((bucket_count - 1 - i) as i64))
            .format("%Y-%m-%d")
            .to_string();
        let cost = day_acc.get(&d).copied().unwrap_or(0.0);
        out.push(DailyCost {
            date: d,
            cost_usd: round2(cost),
        });
    }
    out
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_record(
        sha: &str,
        name: &str,
        email: &str,
        ts: i64,
        body: &str,
        numstat: &[(u64, u64, &str)],
    ) -> String {
        // Records are framed as: REC_SEP + header + body + \n + numstat lines.
        // This mirrors the actual git output where the separator leads each commit.
        let mut rec = format!("\u{1e}{sha}\u{1f}{name}\u{1f}{email}\u{1f}{ts}\u{1f}{body}");
        if !rec.ends_with('\n') {
            rec.push('\n');
        }
        for (a, d, p) in numstat {
            rec.push_str(&format!("{a}\t{d}\t{p}\n"));
        }
        rec
    }

    #[test]
    fn parses_loc_per_commit() {
        let raw = mk_record(
            "abc123",
            "Alice",
            "alice@example.com",
            1_700_000_000,
            "Fix off-by-one\n",
            &[(3, 1, "src/lib.rs"), (10, 2, "src/main.rs")],
        );
        let commits = parse_git_log(&raw);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].additions, 13);
        assert_eq!(commits[0].deletions, 3);
        assert_eq!(commits[0].files.len(), 2);
    }

    #[test]
    fn parses_two_commits_with_numstat_each() {
        let mut raw = String::new();
        raw.push_str(&mk_record(
            "a1",
            "Alice",
            "a@x",
            1_700_000_000,
            "human one\n",
            &[(5, 0, "f1")],
        ));
        raw.push_str(&mk_record(
            "b2",
            "Bob",
            "b@x",
            1_700_086_400,
            "human two\n",
            &[(7, 2, "f2"), (1, 1, "f3")],
        ));
        let commits = parse_git_log(&raw);
        assert_eq!(commits.len(), 2);
        // Critical: each commit holds its own numstat. v1 had this swapped.
        assert_eq!(commits[0].additions, 5);
        assert_eq!(commits[0].deletions, 0);
        assert_eq!(commits[1].additions, 8);
        assert_eq!(commits[1].deletions, 3);
    }

    #[test]
    fn classifier_detects_claude_codex_cursor_human_bot() {
        let claude = mk_record(
            "1",
            "Sarthak",
            "x@y",
            1,
            "feat\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n",
            &[],
        );
        let codex = mk_record(
            "2",
            "Sarthak",
            "x@y",
            2,
            "feat\n\nCo-Authored-By: openai-codex <c@o>\n",
            &[],
        );
        let cursor = mk_record(
            "3",
            "Cursor Agent",
            "agent@cursor.com",
            3,
            "feat\n",
            &[],
        );
        let human = mk_record("4", "Alice", "alice@x", 4, "feat\n", &[]);
        let bot = mk_record(
            "5",
            "dependabot[bot]",
            "x@users.noreply.github.com",
            5,
            "bump\n",
            &[],
        );
        let raw = [claude, codex, cursor, human, bot].concat();
        let commits = parse_git_log(&raw);
        let tools: Vec<&'static str> =
            commits.iter().map(|c| classify_commit(c).0).collect();
        assert_eq!(tools, vec![TOOL_CLAUDE, TOOL_CODEX, TOOL_CURSOR, TOOL_HUMAN, TOOL_AUTOMATION]);
    }

    #[test]
    fn summarize_produces_four_windows_and_authors() {
        // Three commits all on the same recent timestamp.
        let ts = chrono::Utc::now().timestamp() - 86_400; // yesterday
        let raw = [
            mk_record("a", "Alice", "alice@x", ts, "human\n", &[(10, 0, "f1")]),
            mk_record(
                "b",
                "Sarthak",
                "sarthak@x",
                ts,
                "feat\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n",
                &[(40, 5, "f2")],
            ),
            mk_record(
                "c",
                "dependabot[bot]",
                "x@users.noreply.github.com",
                ts,
                "bump\n",
                &[(2, 2, "package.json")],
            ),
        ]
        .concat();
        let commits = parse_git_log(&raw);
        let report = summarize("/tmp/r".into(), &commits);

        assert_eq!(report.windows.len(), 4);
        let all = &report.windows[0];
        assert_eq!(all.label, "all");
        assert_eq!(all.total_commits, 3);
        assert_eq!(all.ai_commits, 1);
        assert_eq!(all.human_commits, 1);
        assert_eq!(all.automation_commits, 1);
        assert_eq!(all.ai_additions, 40);
        assert_eq!(all.human_additions, 10);
        assert_eq!(all.active_days, 1);

        // by_author should split Alice / Sarthak / dependabot.
        assert_eq!(report.by_author.len(), 3);
        let sar = report
            .by_author
            .iter()
            .find(|a| a.email.contains("sarthak"))
            .unwrap();
        assert_eq!(sar.ai_commits, 1);
        assert_eq!(sar.human_commits, 0);

        // top_files captures the largest churn.
        assert_eq!(report.top_files[0].path, "f2");
        assert_eq!(report.top_files[0].additions, 40);

        // day_of_week has at least one bucket > 0 (we don't pin the weekday
        // because timestamps are relative to "now").
        assert!(report.day_of_week.iter().any(|&n| n > 0));

        // daily_series has 90 buckets, all zero-filled except one.
        assert_eq!(report.daily_series.len(), 90);
        assert!(report.daily_series.iter().any(|d| d.ai_commits + d.human_commits > 0));
    }

    #[test]
    fn binary_files_are_recorded_with_zero_loc() {
        // Mix one binary file (-\t-) and one text file.
        let mut raw = String::new();
        raw.push_str("\u{1e}abc\u{1f}Alice\u{1f}a@x\u{1f}1700000000\u{1f}commit body\n-\t-\timage.png\n5\t1\tsrc/lib.rs\n");
        let commits = parse_git_log(&raw);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].additions, 5);
        assert_eq!(commits[0].deletions, 1);
        assert_eq!(commits[0].files.len(), 2);
    }

    #[test]
    fn picks_first_tool_when_multiple_markers() {
        let body = "\
big feat

Co-Authored-By: Cursor <agent@cursor.com>
Co-Authored-By: Claude <noreply@anthropic.com>
";
        let raw = mk_record("d6", "Sarthak", "sarthak@x", 1, body, &[(100, 50, "f")]);
        let c = &parse_git_log(&raw)[0];
        let (tool, is_ai) = classify_commit(c);
        assert_eq!(tool, TOOL_CURSOR);
        assert!(is_ai);
    }

    #[test]
    fn percentiles_basic() {
        let mut v = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        let (p50, p95) = percentiles(&mut v);
        assert!(p50 >= 5.0 && p50 <= 6.0);
        assert!(p95 >= 9.0 && p95 <= 10.0);
    }

    #[test]
    fn canonicalize_model_buckets_correctly() {
        assert_eq!(canonicalize_model("claude-opus-4-7"), "opus");
        assert_eq!(canonicalize_model("claude-sonnet-4-6"), "sonnet");
        assert_eq!(canonicalize_model("haiku-4-5"), "haiku");
        assert_eq!(canonicalize_model("gpt-4o-2024-08-06"), "gpt-4o");
        assert_eq!(canonicalize_model(""), "unknown");
    }

    /// Real-git integration smoke test, gated `#[ignore]`.
    #[test]
    #[ignore]
    fn e2e_attribute_real_temp_repo() {
        use std::process::Command;
        let tmp = std::env::temp_dir().join(format!(
            "cv-intel-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        let run = |args: &[&str]| {
            let s = Command::new("git").args(args).current_dir(&tmp).status().unwrap();
            assert!(s.success(), "git {args:?} failed");
        };
        run(&["init", "-q"]);
        run(&["config", "user.email", "alice@example.com"]);
        run(&["config", "user.name", "Alice"]);
        std::fs::write(tmp.join("a.txt"), "line1\nline2\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-q", "-m", "human work"]);
        std::fs::write(tmp.join("b.txt"), "x\ny\nz\n").unwrap();
        run(&["add", "."]);
        run(&[
            "commit",
            "-q",
            "-m",
            "feat: agent work\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
        ]);

        let raw = run_git_log(tmp.to_str().unwrap()).unwrap();
        let commits = parse_git_log(&raw);
        let report = summarize(tmp.to_str().unwrap().into(), &commits);
        let all = &report.windows[0];
        assert_eq!(all.total_commits, 2);
        assert_eq!(all.ai_commits, 1);
        assert_eq!(all.human_commits, 1);
        assert!(all.ai_additions > 0, "AI commit should have non-zero additions");
        assert!(all.human_additions > 0, "human commit should have non-zero additions");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
