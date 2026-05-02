use crate::db::queries;
use crate::DbState;
use serde_json::{json, Value};
use std::io::{BufRead, Seek, SeekFrom};
use tauri::State;

// ─────────────────────────────────────────────────────────────────
// Public Tauri commands
// ─────────────────────────────────────────────────────────────────

/// Manually trigger a re-index of all Claude Code session files.
///
/// Walks `~/.claude/projects/` looking for JSONL session files, parses each
/// one with the real Claude Code JSONL format, and upserts project / session /
/// message rows into the database.
///
/// Supports **incremental indexing**: files whose mtime has not changed since
/// the last index are skipped entirely.  Files that have grown (append-only)
/// are read starting from the previously stored byte offset so that only new
/// lines are parsed.
/// Run the full index directly with a connection reference.
/// Used by the startup background thread.
pub fn run_full_index_with_conn(conn: &rusqlite::Connection) -> Result<String, String> {
    let (indexed_sessions, indexed_messages, skipped_sessions) = full_index_impl(conn)?;

    // Store the last indexed timestamp
    let now = chrono::Utc::now().to_rfc3339();
    let _ = queries::set_preference(conn, "last_indexed_at", &now);

    Ok(format!(
        "sessions={indexed_sessions}, messages={indexed_messages}, skipped={skipped_sessions}"
    ))
}

#[tauri::command]
pub async fn trigger_index(db: State<'_, DbState>) -> Result<Value, String> {
    let conn = conn_lock(&db)?;
    let (indexed_sessions, indexed_messages, skipped_sessions) =
        full_index_impl(&conn).map_err(|e| e.to_string())?;

    // Store the last indexed timestamp
    let now = chrono::Utc::now().to_rfc3339();
    let _ = queries::set_preference(&conn, "last_indexed_at", &now);

    Ok(json!({
        "indexed_sessions": indexed_sessions,
        "indexed_messages": indexed_messages,
        "skipped_sessions": skipped_sessions,
        "projects_scanned": 0,
    }))
}

/// Shared implementation for the full indexer.
fn full_index_impl(conn: &rusqlite::Connection) -> Result<(u64, u64, u64), String> {
    let all_bases = resolve_all_claude_projects_dirs();

    let mut indexed_sessions = 0u64;
    let mut indexed_messages = 0u64;
    let mut skipped_sessions = 0u64;

    // Collect project directories from all Claude profile directories.
    let project_dirs: Vec<_> = all_bases
        .iter()
        .filter(|b| b.exists())
        .flat_map(|b| std::fs::read_dir(b).ok().into_iter())
        .flatten()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .collect();

    for project_entry in &project_dirs {
        let project_path = project_entry.path();
        // Per-project IIFE so a failure in one project (bad JSONL row, locked
        // file, etc.) only skips that project instead of aborting the whole
        // re-index. Previously a single `?` here meant new project dirs added
        // late in the iteration order (e.g. after a repo move) were never
        // scanned, freezing token-usage stats.
        let project_result: Result<(), String> = (|| {
        let project_dir_name = project_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let display_name = resolve_project_display_name(&project_dir_name);
        let dir_path_str = project_path.to_string_lossy().to_string();

        // Re-use existing project ID if the dir_path already exists, otherwise
        // create a new one.  This avoids generating a fresh UUID on every
        // re-index which would orphan sessions.
        let project_id = queries::get_project_id_by_dir(&conn, &dir_path_str)
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let now = chrono::Utc::now().to_rfc3339();

        queries::upsert_project(
            &conn,
            &queries::ProjectInput {
                id: project_id.clone(),
                display_name: display_name.clone(),
                dir_path: dir_path_str,
                session_count: None,
                last_activity: Some(now.clone()),
                created_at: now.clone(),
            },
        )
        .map_err(|e| e.to_string())?;

        // Look for JSONL files inside the project directory (recursively).
        let jsonl_files: Vec<_> = walkdir(&project_path, "jsonl");

        for jsonl_path in &jsonl_files {
            let jsonl_path_str = jsonl_path.to_string_lossy().to_string();

            // ── Incremental check ────────────────────────────────
            let file_meta = std::fs::metadata(jsonl_path).ok();
            let file_size = file_meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
            let file_mtime_str = file_meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());

            let existing = queries::get_session_by_jsonl_path(&conn, &jsonl_path_str)
                .map_err(|e| e.to_string())?;

            // If the file mtime is unchanged AND the session already has
            // messages, skip it.  Sessions with 0 messages (from the quick
            // startup index) always need a full parse.
            if let Some(ref meta) = existing {
                if meta.file_mtime.as_deref() == file_mtime_str.as_deref()
                    && meta.message_count > 0
                {
                    skipped_sessions += 1;
                    continue;
                }
            }

            // Determine byte offset for incremental reading.  If the file has
            // grown (append-only) AND the session already has messages, seek
            // to the old size and only parse new lines.  Sessions with 0
            // messages need a full read from the start.
            let byte_offset: u64 = match &existing {
                Some(meta)
                    if meta.file_size_bytes > 0
                        && file_size >= meta.file_size_bytes
                        && meta.message_count > 0 =>
                {
                    meta.file_size_bytes as u64
                }
                _ => 0,
            };

            // ── Parse the JSONL ──────────────────────────────────
            let file = match std::fs::File::open(jsonl_path) {
                Ok(f) => f,
                Err(_) => continue,
            };

            let mut reader = std::io::BufReader::new(file);

            // We need session-level metadata from existing records when doing
            // incremental reads.  For a full read we extract them from the
            // first message.
            let mut session_id: Option<String> = existing.as_ref().map(|m| m.id.clone());
            let mut session_version: Option<String> = None;
            let mut session_git_branch: Option<String> = None;
            let mut session_cwd: Option<String> = None;
            let mut session_slug: Option<String> = None;
            let mut model_used: Option<String> = None;

            let mut msg_count: i64 = existing.as_ref().map(|m| m.message_count).unwrap_or(0);
            let mut total_input: i64 = existing
                .as_ref()
                .map(|m| m.total_input_tokens)
                .unwrap_or(0);
            let mut total_output: i64 = existing
                .as_ref()
                .map(|m| m.total_output_tokens)
                .unwrap_or(0);
            let mut total_cache_read: i64 = existing
                .as_ref()
                .map(|m| m.cache_read_tokens)
                .unwrap_or(0);
            let mut total_cache_creation: i64 = existing
                .as_ref()
                .map(|m| m.cache_creation_tokens)
                .unwrap_or(0);
            let mut compaction_count: i64 = existing
                .as_ref()
                .map(|m| m.compaction_count)
                .unwrap_or(0);

            let mut first_message: Option<String> = None;
            let mut last_message: Option<String> = None;

            // Per-day message counts. Flushed to cc_session_days once the
            // file is fully parsed. We only persist counts (not raw rows) —
            // see purge_messages_to_buckets_once for the rationale.
            let mut day_counts: std::collections::HashMap<String, i64> =
                std::collections::HashMap::new();

            // If doing a full re-read (offset == 0) we need the first message
            // timestamp.  For incremental we keep whatever is in the DB.
            let is_incremental = byte_offset > 0;

            if !is_incremental {
                // Full read: reset accumulators + per-day buckets so we
                // don't double-count when re-parsing from scratch.
                msg_count = 0;
                total_input = 0;
                total_output = 0;
                total_cache_read = 0;
                total_cache_creation = 0;
                compaction_count = 0;
                if let Some(ref meta) = existing {
                    let _ = queries::reset_session_days(&conn, &meta.id);
                }
            }

            // Seek to the byte offset for incremental reading.
            if byte_offset > 0 {
                if reader.seek(SeekFrom::Start(byte_offset)).is_err() {
                    continue;
                }
            }

            // Track the line number relative to the whole file.  For
            // incremental reads we estimate the starting line from the
            // existing message count.
            let mut line_number: i64 = if is_incremental { msg_count } else { 0 };
            let mut new_messages = 0u64;

            let mut line_buf = String::new();
            loop {
                line_buf.clear();
                match reader.read_line(&mut line_buf) {
                    Ok(0) => break, // EOF
                    Ok(_) => {}
                    Err(_) => break,
                }

                let line = line_buf.trim();
                if line.is_empty() {
                    continue;
                }

                let parsed: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => {
                        line_number += 1;
                        continue;
                    }
                };

                // ── Skip non-indexable types ─────────────────────
                let msg_type = parsed
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                // Skip non-message metadata rows that bloat the DB without carrying
                // tokens or displayable content. Dropping these cuts row count ~95%.
                if matches!(
                    msg_type,
                    "progress"
                        | "file-history-snapshot"
                        | "queue-operation"
                        | "last-prompt"
                        | "permission-mode"
                        | "pr-link"
                        | "agent-name"
                        | "custom-title"
                        | "attachment"
                ) {
                    line_number += 1;
                    continue;
                }

                // ── Track compaction events ─────────────────────
                if msg_type == "summary" {
                    compaction_count += 1;
                }
                if parsed.get("autoCompact").and_then(|v| v.as_bool()).unwrap_or(false)
                    || parsed.get("isCompacted").and_then(|v| v.as_bool()).unwrap_or(false)
                {
                    compaction_count += 1;
                }

                // ── Extract session-level metadata from first msg ─
                if session_id.is_none() {
                    session_id = parsed
                        .get("sessionId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                // Fall back to generating a UUID if no sessionId in file.
                if session_id.is_none() {
                    session_id = Some(uuid::Uuid::new_v4().to_string());
                }

                if session_version.is_none() {
                    session_version = parsed
                        .get("version")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                if session_git_branch.is_none() {
                    session_git_branch = parsed
                        .get("gitBranch")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                if session_cwd.is_none() {
                    session_cwd = parsed
                        .get("cwd")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                if session_slug.is_none() {
                    session_slug = parsed
                        .get("slug")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }

                // ── Message UUID ─────────────────────────────────
                let msg_id = parsed
                    .get("uuid")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                // ── Role ─────────────────────────────────────────
                let role = parsed
                    .get("message")
                    .and_then(|m| m.get("role"))
                    .and_then(|v| v.as_str())
                    .map(String::from);

                // ── Timestamp ────────────────────────────────────
                let ts = parsed
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .map(String::from);

                if first_message.is_none() {
                    first_message = ts.clone();
                }
                last_message = ts.clone();

                // ── isSidechain ──────────────────────────────────
                let is_sidechain = parsed
                    .get("isSidechain")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                // ── parentUuid ───────────────────────────────────
                let parent_uuid = parsed
                    .get("parentUuid")
                    .and_then(|v| v.as_str())
                    .map(String::from);

                // ── Token usage ──────────────────────────────────
                let usage = parsed
                    .get("message")
                    .and_then(|m| m.get("usage"));

                let input_tokens = usage
                    .and_then(|u| u.get("input_tokens"))
                    .and_then(|v| v.as_i64());
                let cache_creation = usage
                    .and_then(|u| u.get("cache_creation_input_tokens"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let cache_read = usage
                    .and_then(|u| u.get("cache_read_input_tokens"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let output_tokens = usage
                    .and_then(|u| u.get("output_tokens"))
                    .and_then(|v| v.as_i64());

                // Total input includes cache tokens for accurate billing.
                let effective_input = input_tokens
                    .map(|it| it + cache_creation + cache_read);

                if let Some(it) = effective_input {
                    total_input += it;
                }
                if let Some(ot) = output_tokens {
                    total_output += ot;
                }
                total_cache_read += cache_read;
                total_cache_creation += cache_creation;

                // ── Model ────────────────────────────────────────
                if let Some(m) = parsed
                    .get("message")
                    .and_then(|msg| msg.get("model"))
                    .and_then(|v| v.as_str())
                {
                    model_used = Some(m.to_string());
                }

                // ── Slug (can appear on any message) ─────────────
                if let Some(s) = parsed.get("slug").and_then(|v| v.as_str()) {
                    session_slug = Some(s.to_string());
                }

                // ── Increment per-day bucket ─────────────────────
                // We accumulate in-memory and flush once per file below.
                // Day = local-time date of the message timestamp.
                if let Some(ts_str) = ts.as_deref() {
                    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                        let day = dt
                            .with_timezone(&chrono::Local)
                            .format("%Y-%m-%d")
                            .to_string();
                        *day_counts.entry(day).or_insert(0) += 1;
                    }
                }
                // msg_id, parent_uuid, role, msg_type, is_sidechain — no longer
                // persisted; UI never read them. Kept locally above because
                // future log lines may reference them via parent_uuid chains.
                let _ = (msg_id, parent_uuid, role, is_sidechain, msg_type);

                msg_count += 1;
                new_messages += 1;
                line_number += 1;
            }

            // Flush per-day bucket counts to cc_session_days. Ignore errors
            // for individual buckets — partial writes are fine, we'll re-bump
            // on the next pass.
            if let Some(ref sid) = session_id {
                for (day, n) in &day_counts {
                    let _ = queries::bump_session_day(&conn, sid, day, *n);
                }
            }

            // ── Upsert session ───────────────────────────────────
            let sid = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

            let estimated_cost = estimate_cost(
                model_used.as_deref().unwrap_or(""),
                total_input,
                total_output,
                total_cache_read,
                total_cache_creation,
            );

            queries::upsert_session(
                &conn,
                &queries::SessionInput {
                    id: sid,
                    project_id: project_id.clone(),
                    agent_type: Some("claude-code".to_string()),
                    jsonl_path: Some(jsonl_path_str),
                    git_branch: session_git_branch,
                    cwd: session_cwd,
                    cli_version: session_version,
                    first_message,
                    last_message,
                    message_count: Some(msg_count),
                    total_input_tokens: Some(total_input),
                    total_output_tokens: Some(total_output),
                    model_used,
                    slug: session_slug,
                    file_size_bytes: Some(file_size),
                    indexed_at: Some(now.clone()),
                    file_mtime: file_mtime_str,
                    cache_read_tokens: Some(total_cache_read),
                    cache_creation_tokens: Some(total_cache_creation),
                    compaction_count: Some(compaction_count),
                    estimated_cost_usd: Some(estimated_cost),
                },
            )
            .map_err(|e| e.to_string())?;

            indexed_sessions += 1;
            indexed_messages += new_messages;
        }

        // Update project session count.
        let session_count = jsonl_files.len() as i64;
        conn.execute(
            "UPDATE cc_projects SET session_count = ?2 WHERE id = ?1",
            rusqlite::params![project_id, session_count],
        )
        .map_err(|e: rusqlite::Error| e.to_string())?;

        // Update display name from session cwd if available (more reliable
        // than decoding the encoded directory name).
        let cwd_name: Option<String> = conn
            .query_row(
                "SELECT cwd FROM cc_sessions WHERE project_id = ?1 AND cwd IS NOT NULL AND cwd != '' LIMIT 1",
                rusqlite::params![project_id],
                |row| row.get::<_, String>(0),
            )
            .ok();

        if let Some(ref cwd) = cwd_name {
            let better_name = std::path::Path::new(cwd)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| display_name.clone());
            let _ = conn.execute(
                "UPDATE cc_projects SET display_name = ?2 WHERE id = ?1",
                rusqlite::params![project_id, better_name],
            );
        }

        Ok(())
        })();
        if let Err(e) = project_result {
            log::error!("Skipping project {project_path:?}: {e}");
        }
    }

    // ── Phase 2: Scan Codex sessions ─────────────────────────
    let codex_base = resolve_codex_sessions_dir();
    let mut codex_indexed = 0u64;
    let mut codex_messages = 0u64;

    if codex_base.exists() {
        let codex_files: Vec<_> = walkdir(&codex_base, "jsonl");

        for jsonl_path in &codex_files {
            let jsonl_path_str = jsonl_path.to_string_lossy().to_string();

            // ── Incremental check ────────────────────────────
            let file_meta = std::fs::metadata(jsonl_path).ok();
            let file_mtime_str = file_meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());

            let existing = queries::get_session_by_jsonl_path(&conn, &jsonl_path_str)
                .map_err(|e| e.to_string())?;

            if let Some(ref meta) = existing {
                if meta.file_mtime.as_deref() == file_mtime_str.as_deref()
                    && meta.message_count > 0
                {
                    skipped_sessions += 1;
                    continue;
                }
            }

            // Read the first line to get session_meta and determine the project
            let first_line = match std::fs::File::open(jsonl_path) {
                Ok(f) => {
                    let mut rdr = std::io::BufReader::new(f);
                    let mut buf = String::new();
                    let _ = rdr.read_line(&mut buf);
                    buf
                }
                Err(_) => continue,
            };

            let meta_parsed: Value = match serde_json::from_str(first_line.trim()) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let meta_type = meta_parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if meta_type != "session_meta" {
                continue;
            }

            let payload = match meta_parsed.get("payload") {
                Some(p) => p,
                None => continue,
            };

            let codex_cwd = payload.get("cwd").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if codex_cwd.is_empty() {
                continue;
            }

            let now = chrono::Utc::now().to_rfc3339();

            // Resolve or create the project for this Codex session's cwd
            let project_id = queries::get_project_id_by_dir(&conn, &codex_cwd)
                .map_err(|e| e.to_string())?
                .unwrap_or_else(|| {
                    let pid = uuid::Uuid::new_v4().to_string();
                    let display = std::path::Path::new(&codex_cwd)
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| codex_cwd.clone());
                    let _ = queries::upsert_project(
                        &conn,
                        &queries::ProjectInput {
                            id: pid.clone(),
                            display_name: display,
                            dir_path: codex_cwd.clone(),
                            session_count: None,
                            last_activity: Some(now.clone()),
                            created_at: now.clone(),
                        },
                    );
                    pid
                });

            match parse_codex_session(jsonl_path, &conn, &project_id, &now) {
                Ok((sess, msgs)) => {
                    codex_indexed += sess;
                    codex_messages += msgs;
                }
                Err(_) => continue,
            }
        }
    }

    indexed_sessions += codex_indexed;
    indexed_messages += codex_messages;

    // ── Phase 3: Scan Cursor AI sessions ─────────────────────
    let (cursor_indexed, cursor_messages, cursor_skipped) = index_cursor_sessions(&conn)?;
    indexed_sessions += cursor_indexed;
    indexed_messages += cursor_messages;
    skipped_sessions += cursor_skipped;

    Ok((indexed_sessions, indexed_messages, skipped_sessions))
}

/// Return aggregate stats about the indexed data.
#[tauri::command]
pub async fn get_index_stats(db: State<'_, DbState>) -> Result<Value, String> {
    let conn = conn_lock(&db)?;
    let stats = queries::get_index_stats(&conn).map_err(|e| e.to_string())?;
    let last_indexed_at = queries::get_preference(&conn, "last_indexed_at")
        .map_err(|e| e.to_string())?;
    let mut result = json!(stats);
    result["last_indexed_at"] = json!(last_indexed_at);
    Ok(result)
}

/// Token usage stats: today / week / month / year totals + 30-day daily series
/// + 12-week weekly series. Windows use the user's local timezone.
#[tauri::command]
pub async fn get_token_usage_stats(
    db: State<'_, DbState>,
) -> Result<queries::TokenUsageStats, String> {
    let conn = conn_lock(&db)?;
    queries::get_token_usage_stats(&conn).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────────────────────────
// Content text extraction
// ─────────────────────────────────────────────────────────────────

#[allow(dead_code)]
fn extract_content_text(parsed: &Value) -> Option<String> {
    let message = parsed.get("message")?;
    let content = message.get("content")?;
    let role = message.get("role").and_then(|v| v.as_str()).unwrap_or("");

    // String content (common for user messages).
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }

    // Array content.
    if let Some(blocks) = content.as_array() {
        match role {
            "assistant" => {
                // Concatenate text blocks, skip thinking blocks.
                let texts: Vec<&str> = blocks
                    .iter()
                    .filter_map(|block| {
                        let block_type = block.get("type")?.as_str()?;
                        if block_type == "text" {
                            block.get("text")?.as_str()
                        } else {
                            None
                        }
                    })
                    .collect();

                if texts.is_empty() {
                    // If no text blocks, check for tool_use blocks and
                    // produce a summary so the message is not blank.
                    let tool_names: Vec<&str> = blocks
                        .iter()
                        .filter_map(|block| {
                            let bt = block.get("type")?.as_str()?;
                            if bt == "tool_use" {
                                block.get("name")?.as_str()
                            } else {
                                None
                            }
                        })
                        .collect();
                    if tool_names.is_empty() {
                        None
                    } else {
                        Some(format!("[tool_use: {}]", tool_names.join(", ")))
                    }
                } else {
                    Some(texts.join("\n\n"))
                }
            }
            "user" => {
                // User array content is typically tool_result blocks.
                let summaries: Vec<String> = blocks
                    .iter()
                    .filter_map(|block| {
                        let block_type = block.get("type")?.as_str()?;
                        if block_type == "tool_result" {
                            let tool_use_id = block
                                .get("tool_use_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown");
                            Some(format!("[tool_result for {tool_use_id}]"))
                        } else if block_type == "text" {
                            block.get("text").and_then(|v| v.as_str()).map(String::from)
                        } else {
                            None
                        }
                    })
                    .collect();

                if summaries.is_empty() {
                    None
                } else {
                    Some(summaries.join("\n"))
                }
            }
            _ => {
                // Unknown role with array content -- store raw JSON.
                Some(content.to_string())
            }
        }
    } else {
        // Content is some other JSON value (object, number, etc.).
        Some(content.to_string())
    }
}

// ─────────────────────────────────────────────────────────────────
// Project name resolution
// ─────────────────────────────────────────────────────────────────

/// Convert a Claude Code project directory name like
/// `-Users-sarthakagrawal-Desktop-code-reviewer` into a human-friendly
/// display name.
///
/// Strategy: use the known home directory to strip the encoded prefix, then
/// greedily match intermediate path segments by checking which sub-segments
/// correspond to real directories on disk.  Everything after the last matched
/// directory is the project name (preserving real hyphens).
///
/// Example: `-Users-sarthakagrawal-Desktop-code-reviewer`
///   home = `/Users/sarthakagrawal`  →  encoded = `Users-sarthakagrawal`
///   remainder = `Desktop-code-reviewer`
///   `~/Desktop` is a dir → consume  →  project name = `code-reviewer`
fn resolve_project_display_name(dir_name: &str) -> String {
    let trimmed = dir_name.trim_start_matches('-');
    if trimmed.is_empty() {
        return dir_name.to_string();
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();

    if !home.is_empty() {
        // Encode the home path the same way Claude Code encodes directory names
        let home_encoded = home.trim_start_matches('/').replace('/', "-");

        if let Some(remainder) = trimmed.strip_prefix(&home_encoded) {
            let remainder = remainder.trim_start_matches('-');
            if remainder.is_empty() {
                return dir_name.to_string();
            }

            // Greedily match intermediate path segments from the home dir.
            // e.g., remainder = "Desktop-code-reviewer"
            // Check: is ~/Desktop a dir? Yes → consume.  Is ~/Desktop/code a
            // dir? No → "code-reviewer" is the project name.
            let parts: Vec<&str> = remainder.split('-').collect();
            let mut current_dir = std::path::PathBuf::from(&home);
            let mut consumed = 0usize;

            for start in 0..parts.len() {
                let candidate = parts[start];
                let test_path = current_dir.join(candidate);
                // Only consume this segment as a directory if there are more
                // segments after it (the last segment must be part of the
                // project name).
                if test_path.is_dir() && start + 1 < parts.len() {
                    current_dir = test_path;
                    consumed = start + 1;
                } else {
                    break;
                }
            }

            let project_name = parts[consumed..].join("-");
            if !project_name.is_empty() {
                return project_name;
            }
        }
    }

    // Fallback: replace `-` with `/` and take last component
    let reconstructed = trimmed.replace('-', "/");
    std::path::Path::new(&reconstructed)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| dir_name.to_string())
}

// ─────────────────────────────────────────────────────────────────
// Cost estimation
// ─────────────────────────────────────────────────────────────────

fn estimate_cost(model: &str, total_input: i64, output_tokens: i64, cache_read: i64, cache_creation: i64) -> f64 {
    // Per-million-token pricing (approximate as of early 2026)
    let (input_price, output_price, cache_read_price, cache_write_price) = match model {
        m if m.contains("opus") => (15.0, 75.0, 1.5, 18.75),
        m if m.contains("sonnet") => (3.0, 15.0, 0.3, 3.75),
        m if m.contains("haiku") => (0.25, 1.25, 0.025, 0.3),
        m if m.contains("gpt-4o") => (2.5, 10.0, 1.25, 2.5),
        m if m.contains("gpt-4.1") => (2.0, 8.0, 0.5, 2.0),
        m if m.contains("o3") || m.contains("o4-mini") => (1.1, 4.4, 0.275, 1.1),
        _ => (3.0, 15.0, 0.3, 3.75), // default to sonnet pricing
    };

    // total_input already includes cache_read + cache_creation tokens (added
    // during indexing), so subtract them to get the base input token count
    // that is billed at the full input rate.
    let base_input = (total_input - cache_read - cache_creation).max(0);

    let cost = (base_input as f64 * input_price
        + output_tokens as f64 * output_price
        + cache_read as f64 * cache_read_price
        + cache_creation as f64 * cache_write_price) / 1_000_000.0;
    (cost * 100.0).round() / 100.0 // round to cents
}

// ─────────────────────────────────────────────────────────────────
// Codex session parsing
// ─────────────────────────────────────────────────────────────────

fn resolve_codex_sessions_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home)
        .join(".codex")
        .join("sessions")
}

/// Parse a Codex JSONL session file and upsert the session + messages.
/// Returns (sessions_indexed, messages_indexed).
fn parse_codex_session(
    jsonl_path: &std::path::Path,
    conn: &rusqlite::Connection,
    project_id: &str,
    now: &str,
) -> Result<(u64, u64), String> {
    let jsonl_path_str = jsonl_path.to_string_lossy().to_string();
    let file_meta = std::fs::metadata(jsonl_path).ok();
    let file_size = file_meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
    let file_mtime_str = file_meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());

    let file = std::fs::File::open(jsonl_path).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(file);

    let mut session_id: Option<String> = None;
    let mut session_cwd: Option<String> = None;
    let mut session_version: Option<String> = None;
    let mut session_git_branch: Option<String> = None;
    let mut model_used: Option<String> = None;

    let mut msg_count: i64 = 0;
    let mut total_input: i64 = 0;
    let mut total_output: i64 = 0;
    let mut total_cache_read: i64 = 0;
    let total_cache_creation: i64 = 0;
    let mut first_message: Option<String> = None;
    let mut last_message: Option<String> = None;
    let mut new_messages: u64 = 0;
    let mut line_number: i64 = 0;
    let mut day_counts: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();

    for line_result in reader.lines() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => break,
        };
        let line = line.trim().to_string();
        if line.is_empty() {
            line_number += 1;
            continue;
        }

        let parsed: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                line_number += 1;
                continue;
            }
        };

        let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let payload = parsed.get("payload");

        if msg_type == "session_meta" {
            if let Some(p) = payload {
                session_id = p.get("id").and_then(|v| v.as_str()).map(String::from);
                session_cwd = p.get("cwd").and_then(|v| v.as_str()).map(String::from);
                session_version = p.get("cli_version").and_then(|v| v.as_str()).map(String::from);
                session_git_branch = p.get("git")
                    .and_then(|g| g.get("branch"))
                    .and_then(|v| v.as_str())
                    .map(String::from);
                if let Some(m) = p.get("model").and_then(|v| v.as_str()) {
                    model_used = Some(m.to_string());
                } else if let Some(mp) = p.get("model_provider").and_then(|v| v.as_str()) {
                    // Codex doesn't specify a model name; use a reasonable default
                    model_used = Some(if mp == "openai" { "o3".to_string() } else { mp.to_string() });
                }
            }
            line_number += 1;
            continue;
        }

        // ── Extract token counts from event_msg.token_count ──────────
        // Codex stores cumulative token usage in event_msg with type "token_count"
        // under payload.info.total_token_usage. We take the last one seen.
        if msg_type == "event_msg" {
            if let Some(p) = payload {
                let sub_type = p.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if sub_type == "token_count" {
                    if let Some(info) = p.get("info") {
                        if let Some(total_usage) = info.get("total_token_usage") {
                            // These are cumulative — always take the latest value
                            let input_t = total_usage.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                            let output_t = total_usage.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                            let cached = total_usage.get("cached_input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                            total_input = input_t;
                            total_output = output_t;
                            total_cache_read = cached;
                        }
                    }
                }
            }
        }

        if msg_type == "response_item" {
            if let Some(p) = payload {
                let role = p.get("role").and_then(|v| v.as_str()).map(String::from);

                // Extract token usage from response_item.payload.usage (if present)
                if let Some(usage) = p.get("usage") {
                    let input_t = usage.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                    let output_t = usage.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                    // Only use additive if no token_count events are providing cumulative totals
                    if total_input == 0 && total_output == 0 {
                        total_input += input_t;
                        total_output += output_t;
                    }
                }

                // Timestamp
                let ts = parsed.get("timestamp")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                if first_message.is_none() {
                    first_message = ts.clone();
                }
                last_message = ts.clone();

                let _ = role;
                if let Some(ts_str) = ts.as_deref() {
                    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                        let day = dt
                            .with_timezone(&chrono::Local)
                            .format("%Y-%m-%d")
                            .to_string();
                        *day_counts.entry(day).or_insert(0) += 1;
                    }
                }

                msg_count += 1;
                new_messages += 1;
            }
        }

        line_number += 1;
    }

    if let Some(ref sid) = session_id {
        for (day, n) in &day_counts {
            let _ = queries::bump_session_day(conn, sid, day, *n);
        }
    }

    // If we didn't get a session_id from the file, generate one
    let sid = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let estimated_cost = estimate_cost(
        model_used.as_deref().unwrap_or(""),
        total_input,
        total_output,
        total_cache_read,
        total_cache_creation,
    );

    queries::upsert_session(
        conn,
        &queries::SessionInput {
            id: sid,
            project_id: project_id.to_string(),
            agent_type: Some("codex".to_string()),
            jsonl_path: Some(jsonl_path_str),
            git_branch: session_git_branch,
            cwd: session_cwd,
            cli_version: session_version,
            first_message,
            last_message,
            message_count: Some(msg_count),
            total_input_tokens: Some(total_input),
            total_output_tokens: Some(total_output),
            model_used,
            slug: None,
            file_size_bytes: Some(file_size),
            indexed_at: Some(now.to_string()),
            file_mtime: file_mtime_str,
            cache_read_tokens: Some(total_cache_read),
            cache_creation_tokens: Some(total_cache_creation),
            compaction_count: Some(0),
            estimated_cost_usd: Some(estimated_cost),
        },
    )
    .map_err(|e| e.to_string())?;

    Ok((1, new_messages))
}

// ─────────────────────────────────────────────────────────────────
// Cursor AI session detection & indexing
// ─────────────────────────────────────────────────────────────────

/// Detect whether Cursor IDE is installed on this machine.
#[tauri::command]
pub async fn detect_cursor() -> Result<Value, String> {
    let cursor_dir = resolve_cursor_data_dir();
    let installed = cursor_dir.exists();
    let workspace_storage = cursor_dir.join("User").join("workspaceStorage");
    let has_workspaces = workspace_storage.exists();
    Ok(json!({
        "installed": installed,
        "path": cursor_dir.to_string_lossy().to_string(),
        "has_workspaces": has_workspaces,
    }))
}

/// Resolve the Cursor data directory (platform-specific).
fn resolve_cursor_data_dir() -> std::path::PathBuf {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        std::path::PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("Cursor")
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        std::path::PathBuf::from(home).join(".config").join("Cursor")
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
        std::path::PathBuf::from(appdata).join("Cursor")
    }
}

/// Resolve the workspace storage directory that contains .vscdb files.
pub fn resolve_cursor_workspace_storage_dir() -> std::path::PathBuf {
    resolve_cursor_data_dir()
        .join("User")
        .join("workspaceStorage")
}

/// Index Cursor AI sessions from workspace storage .vscdb files.
///
/// Cursor stores AI conversation data in SQLite databases within:
///   ~/Library/Application Support/Cursor/User/workspaceStorage/<hash>/state.vscdb
///
/// The conversations are stored as JSON blobs keyed by specific storage keys.
/// We extract the conversation data and map it into our existing cc_sessions schema.
fn index_cursor_sessions(
    conn: &rusqlite::Connection,
) -> Result<(u64, u64, u64), String> {
    let workspace_storage = resolve_cursor_workspace_storage_dir();
    if !workspace_storage.exists() {
        return Ok((0, 0, 0));
    }

    let mut indexed_sessions = 0u64;
    let mut indexed_messages = 0u64;
    let mut skipped_sessions = 0u64;

    // Each workspace subdirectory may contain a state.vscdb
    let entries = match std::fs::read_dir(&workspace_storage) {
        Ok(e) => e,
        Err(_) => return Ok((0, 0, 0)),
    };

    for entry in entries.flatten() {
        let workspace_dir = entry.path();
        if !workspace_dir.is_dir() {
            continue;
        }

        let vscdb_path = workspace_dir.join("state.vscdb");
        if !vscdb_path.exists() {
            continue;
        }

        let vscdb_path_str = vscdb_path.to_string_lossy().to_string();

        // ── Incremental check: use file mtime ────────────────
        let file_meta = std::fs::metadata(&vscdb_path).ok();
        let file_size = file_meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
        let file_mtime_str = file_meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());

        let existing = queries::get_session_by_jsonl_path(conn, &vscdb_path_str)
            .map_err(|e| e.to_string())?;

        if let Some(ref meta) = existing {
            if meta.file_mtime.as_deref() == file_mtime_str.as_deref()
                && meta.message_count > 0
            {
                skipped_sessions += 1;
                continue;
            }
        }

        // ── Try to read the workspace folder metadata ─────────
        let workspace_json_path = workspace_dir.join("workspace.json");
        let workspace_folder = read_cursor_workspace_folder(&workspace_json_path);

        // ── Open the .vscdb and extract conversations ─────────
        match parse_cursor_vscdb(
            &vscdb_path,
            conn,
            &workspace_folder,
            &vscdb_path_str,
            file_size,
            &file_mtime_str,
        ) {
            Ok((sessions, messages)) => {
                indexed_sessions += sessions;
                indexed_messages += messages;
            }
            Err(e) => {
                log::warn!("Failed to parse Cursor vscdb {}: {}", vscdb_path_str, e);
                continue;
            }
        }
    }

    Ok((indexed_sessions, indexed_messages, skipped_sessions))
}

/// Read the workspace.json file to determine the project folder.
fn read_cursor_workspace_folder(workspace_json_path: &std::path::Path) -> Option<String> {
    let content = std::fs::read_to_string(workspace_json_path).ok()?;
    let parsed: Value = serde_json::from_str(&content).ok()?;

    // workspace.json typically has { "folder": "file:///path/to/project" }
    let folder = parsed.get("folder").and_then(|v| v.as_str())?;

    // Strip the file:// URI prefix
    let path = if let Some(stripped) = folder.strip_prefix("file://") {
        // URL-decode common sequences
        stripped
            .replace("%20", " ")
            .replace("%23", "#")
            .replace("%25", "%")
    } else {
        folder.to_string()
    };

    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

/// Parse a Cursor state.vscdb SQLite file and extract AI conversation data.
///
/// The .vscdb file is a SQLite database with a `ItemTable` containing key-value
/// pairs. AI-related data is stored under various keys prefixed with
/// `workbench.panel.aichat` or `cursor.composerData` or similar.
///
/// We look for stored conversation data and map it into sessions + messages.
fn parse_cursor_vscdb(
    vscdb_path: &std::path::Path,
    app_conn: &rusqlite::Connection,
    workspace_folder: &Option<String>,
    vscdb_path_str: &str,
    file_size: i64,
    file_mtime_str: &Option<String>,
) -> Result<(u64, u64), String> {
    // Open the .vscdb file in read-only mode
    let cursor_db = rusqlite::Connection::open_with_flags(
        vscdb_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open vscdb: {e}"))?;

    let now = chrono::Utc::now().to_rfc3339();

    // Resolve or create the project for this workspace
    let cwd = workspace_folder.clone().unwrap_or_default();
    if cwd.is_empty() {
        return Ok((0, 0));
    }

    let project_id = queries::get_project_id_by_dir(app_conn, &cwd)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| {
            let pid = uuid::Uuid::new_v4().to_string();
            let display = std::path::Path::new(&cwd)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| cwd.clone());
            let _ = queries::upsert_project(
                app_conn,
                &queries::ProjectInput {
                    id: pid.clone(),
                    display_name: display,
                    dir_path: cwd.clone(),
                    session_count: None,
                    last_activity: Some(now.clone()),
                    created_at: now.clone(),
                },
            );
            pid
        });

    let mut total_sessions = 0u64;
    let mut total_messages = 0u64;

    // ── Strategy 1: Look for composer/chat data in ItemTable ──────
    // Cursor stores AI conversations in the ItemTable with keys like:
    //   "composerData", "cursor.composerData", "aichat.sessions", etc.
    let conversation_keys = [
        "composerData",
        "cursor.composerData",
        "workbench.panel.aichat.sessions",
        "workbench.panel.aichat",
        "aiConversations",
    ];

    for key_prefix in &conversation_keys {
        // Try exact match first, then LIKE prefix match
        let values: Vec<String> = {
            let mut results = Vec::new();

            // Try exact key match
            if let Ok(val) = cursor_db.query_row(
                "SELECT value FROM ItemTable WHERE key = ?1",
                rusqlite::params![key_prefix],
                |row| row.get::<_, String>(0),
            ) {
                results.push(val);
            }

            // Also try prefix match for keys like "composerData.xxx"
            if let Ok(mut stmt) = cursor_db.prepare(
                "SELECT value FROM ItemTable WHERE key LIKE ?1 LIMIT 50",
            ) {
                let pattern = format!("{}%", key_prefix);
                if let Ok(rows) = stmt.query_map(rusqlite::params![pattern], |row| {
                    row.get::<_, String>(0)
                }) {
                    for row in rows.flatten() {
                        if !results.contains(&row) {
                            results.push(row);
                        }
                    }
                }
            }

            results
        };

        for json_str in &values {
            let parsed: Value = match serde_json::from_str(json_str) {
                Ok(v) => v,
                Err(_) => continue,
            };

            // The data might be an array of conversations or an object
            let conversations = if let Some(arr) = parsed.as_array() {
                arr.clone()
            } else if let Some(obj) = parsed.as_object() {
                // Could be a map of conversation IDs to conversation objects
                if let Some(convos) = obj.get("conversations").and_then(|v| v.as_array()) {
                    convos.clone()
                } else if let Some(tabs) = obj.get("allTabs").and_then(|v| v.as_array()) {
                    // Composer data often stored under "allTabs"
                    tabs.clone()
                } else {
                    // Try treating each value as a conversation
                    obj.values().filter(|v| v.is_object()).cloned().collect()
                }
            } else {
                continue;
            };

            for convo in &conversations {
                let (sessions, messages) = parse_cursor_conversation(
                    convo,
                    app_conn,
                    &project_id,
                    &cwd,
                    vscdb_path_str,
                    file_size,
                    file_mtime_str,
                    &now,
                )?;
                total_sessions += sessions;
                total_messages += messages;
            }
        }
    }

    // ── Strategy 2: If no structured data found, scan for JSON blobs ──
    // Some Cursor versions store conversations differently. Scan all
    // large JSON values in ItemTable for conversation-like structures.
    if total_sessions == 0 {
        if let Ok(mut stmt) = cursor_db.prepare(
            "SELECT key, value FROM ItemTable WHERE length(value) > 500 LIMIT 200",
        ) {
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                ))
            }) {
                for row in rows.flatten() {
                    let (_key, json_str) = row;
                    let parsed: Value = match serde_json::from_str(&json_str) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    // Look for objects that look like conversations
                    // (have messages/bubbles array, or role fields)
                    if has_conversation_shape(&parsed) {
                        let (sessions, messages) = parse_cursor_conversation(
                            &parsed,
                            app_conn,
                            &project_id,
                            &cwd,
                            vscdb_path_str,
                            file_size,
                            file_mtime_str,
                            &now,
                        )?;
                        total_sessions += sessions;
                        total_messages += messages;
                    }
                }
            }
        }
    }

    Ok((total_sessions, total_messages))
}

/// Check if a JSON value looks like a conversation object.
fn has_conversation_shape(v: &Value) -> bool {
    if let Some(obj) = v.as_object() {
        // Must have some kind of messages array
        let has_messages = obj.contains_key("messages")
            || obj.contains_key("bubbles")
            || obj.contains_key("conversation")
            || obj.contains_key("turns");

        // Optionally should have conversation metadata
        let has_meta = obj.contains_key("id")
            || obj.contains_key("createdAt")
            || obj.contains_key("name")
            || obj.contains_key("title");

        has_messages && has_meta
    } else {
        false
    }
}

/// Parse a single Cursor conversation object and upsert it as a session + messages.
fn parse_cursor_conversation(
    convo: &Value,
    app_conn: &rusqlite::Connection,
    project_id: &str,
    cwd: &str,
    vscdb_path_str: &str,
    file_size: i64,
    file_mtime_str: &Option<String>,
    now: &str,
) -> Result<(u64, u64), String> {
    // Extract conversation ID (for dedup)
    let convo_id = convo
        .get("id")
        .or_else(|| convo.get("conversationId"))
        .or_else(|| convo.get("tabId"))
        .and_then(|v| v.as_str())
        .map(String::from);

    // Use a stable session ID derived from the vscdb path + conversation ID
    // to enable deduplication across re-indexes.
    let session_id = if let Some(ref cid) = convo_id {
        format!("cursor-{}", cid)
    } else {
        // No conversation ID — generate from path hash
        let hash = simple_hash(vscdb_path_str);
        format!("cursor-{:x}", hash)
    };

    // Check if already indexed with same file_mtime
    if let Ok(Some(existing)) = queries::get_session_by_jsonl_path(
        app_conn,
        &format!("{}#{}", vscdb_path_str, session_id),
    ) {
        if existing.file_mtime.as_deref() == file_mtime_str.as_deref()
            && existing.message_count > 0
        {
            return Ok((0, 0));
        }
    }

    // Extract messages from the conversation
    let messages_arr = convo
        .get("messages")
        .or_else(|| convo.get("bubbles"))
        .or_else(|| convo.get("turns"))
        .or_else(|| convo.get("conversation"))
        .and_then(|v| v.as_array());

    let messages = match messages_arr {
        Some(msgs) if !msgs.is_empty() => msgs,
        _ => return Ok((0, 0)), // No messages, skip
    };

    // Extract conversation metadata
    let title = convo
        .get("name")
        .or_else(|| convo.get("title"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let created_at = convo
        .get("createdAt")
        .or_else(|| convo.get("created_at"))
        .or_else(|| convo.get("timestamp"))
        .and_then(|v| {
            // Could be a number (unix ms) or a string (ISO)
            if let Some(s) = v.as_str() {
                Some(s.to_string())
            } else if let Some(n) = v.as_i64() {
                // Unix milliseconds → RFC3339
                chrono::DateTime::from_timestamp_millis(n)
                    .map(|dt| dt.to_rfc3339())
            } else if let Some(n) = v.as_f64() {
                chrono::DateTime::from_timestamp_millis(n as i64)
                    .map(|dt| dt.to_rfc3339())
            } else {
                None
            }
        });

    let mut msg_count: i64 = 0;
    let mut total_input: i64 = 0;
    let mut total_output: i64 = 0;
    let mut first_message: Option<String> = None;
    let mut last_message: Option<String> = None;
    let mut model_used: Option<String> = None;
    let mut new_messages: u64 = 0;
    let mut day_counts: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();

    // Reset existing per-day buckets for this session — Cursor sessions
    // are always re-read in full (no incremental byte-offset tracking).
    let _ = queries::reset_session_days(app_conn, &session_id);

    for (i, msg) in messages.iter().enumerate() {
        let role = msg
            .get("role")
            .or_else(|| msg.get("type"))
            .or_else(|| msg.get("sender"))
            .and_then(|v| v.as_str())
            .map(|r| {
                // Normalize Cursor roles to standard role names
                match r {
                    "human" | "user" | "1" => "user",
                    "ai" | "assistant" | "bot" | "2" => "assistant",
                    "system" => "system",
                    other => other,
                }
                .to_string()
            });

        // Extract content text
        let content_text = msg
            .get("text")
            .or_else(|| msg.get("content"))
            .or_else(|| msg.get("message"))
            .and_then(|v| {
                if let Some(s) = v.as_str() {
                    Some(s.to_string())
                } else if let Some(arr) = v.as_array() {
                    // Array of content blocks
                    let texts: Vec<&str> = arr
                        .iter()
                        .filter_map(|block| {
                            if let Some(s) = block.as_str() {
                                Some(s)
                            } else {
                                block.get("text").and_then(|t| t.as_str())
                            }
                        })
                        .collect();
                    if texts.is_empty() { None } else { Some(texts.join("\n\n")) }
                } else {
                    None
                }
            });

        // Skip empty messages
        if content_text.as_ref().map(|t| t.trim().is_empty()).unwrap_or(true) {
            continue;
        }

        // Timestamp
        let ts = msg
            .get("timestamp")
            .or_else(|| msg.get("createdAt"))
            .or_else(|| msg.get("created_at"))
            .and_then(|v| {
                if let Some(s) = v.as_str() {
                    Some(s.to_string())
                } else if let Some(n) = v.as_i64() {
                    chrono::DateTime::from_timestamp_millis(n)
                        .map(|dt| dt.to_rfc3339())
                } else if let Some(n) = v.as_f64() {
                    chrono::DateTime::from_timestamp_millis(n as i64)
                        .map(|dt| dt.to_rfc3339())
                } else {
                    None
                }
            })
            .or_else(|| created_at.clone());

        if first_message.is_none() {
            first_message = ts.clone();
        }
        last_message = ts.clone();

        // Model
        if let Some(m) = msg
            .get("model")
            .or_else(|| msg.get("modelType"))
            .and_then(|v| v.as_str())
        {
            model_used = Some(m.to_string());
        }

        // Token usage (if available)
        if let Some(usage) = msg.get("usage").or_else(|| msg.get("tokenCount")) {
            let input_t = usage
                .get("input_tokens")
                .or_else(|| usage.get("promptTokens"))
                .or_else(|| usage.get("input"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let output_t = usage
                .get("output_tokens")
                .or_else(|| usage.get("completionTokens"))
                .or_else(|| usage.get("output"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            total_input += input_t;
            total_output += output_t;
        }

        let _ = (role, i);
        if let Some(ts_str) = ts.as_deref() {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                let day = dt
                    .with_timezone(&chrono::Local)
                    .format("%Y-%m-%d")
                    .to_string();
                *day_counts.entry(day).or_insert(0) += 1;
            }
        }

        msg_count += 1;
        new_messages += 1;
    }

    if msg_count == 0 {
        return Ok((0, 0));
    }

    for (day, n) in &day_counts {
        let _ = queries::bump_session_day(app_conn, &session_id, day, *n);
    }

    let estimated_cost = estimate_cost(
        model_used.as_deref().unwrap_or(""),
        total_input,
        total_output,
        0,
        0,
    );

    // Use a composite path for dedup: vscdb_path#session_id
    let composite_path = format!("{}#{}", vscdb_path_str, session_id);

    queries::upsert_session(
        app_conn,
        &queries::SessionInput {
            id: session_id,
            project_id: project_id.to_string(),
            agent_type: Some("cursor".to_string()),
            jsonl_path: Some(composite_path),
            git_branch: None,
            cwd: Some(cwd.to_string()),
            cli_version: None,
            first_message,
            last_message,
            message_count: Some(msg_count),
            total_input_tokens: Some(total_input),
            total_output_tokens: Some(total_output),
            model_used,
            slug: title,
            file_size_bytes: Some(file_size),
            indexed_at: Some(now.to_string()),
            file_mtime: file_mtime_str.clone(),
            cache_read_tokens: Some(0),
            cache_creation_tokens: Some(0),
            compaction_count: Some(0),
            estimated_cost_usd: Some(estimated_cost),
        },
    )
    .map_err(|e| e.to_string())?;

    Ok((1, new_messages))
}

/// Simple hash for generating stable IDs from strings.
fn simple_hash(s: &str) -> u64 {
    let mut hash: u64 = 5381;
    for byte in s.bytes() {
        hash = hash.wrapping_mul(33).wrapping_add(byte as u64);
    }
    hash
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

fn conn_lock<'a>(
    db: &'a State<'a, DbState>,
) -> Result<std::sync::MutexGuard<'a, rusqlite::Connection>, String> {
    db.0.lock().map_err(|e| e.to_string())
}

/// Collect Claude profile project directories.
/// Scans ccusage defaults plus any ~/.claude-*/projects/ profiles.
fn resolve_all_claude_projects_dirs() -> Vec<std::path::PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let home_path = std::path::PathBuf::from(&home);
    let mut dirs = Vec::new();

    if let Ok(config_dirs) = std::env::var("CLAUDE_CONFIG_DIR") {
        for raw in config_dirs.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            let projects_dir = std::path::PathBuf::from(raw).join("projects");
            if projects_dir.exists() && !dirs.contains(&projects_dir) {
                dirs.push(projects_dir);
            }
        }
        return dirs;
    }

    let default_dirs = [
        home_path.join(".config").join("claude").join("projects"),
        home_path.join(".claude").join("projects"),
    ];

    for projects_dir in default_dirs {
        if projects_dir.exists() && !dirs.contains(&projects_dir) {
            dirs.push(projects_dir);
        }
    }

    if let Ok(entries) = std::fs::read_dir(&home_path) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with(".claude-") && entry.path().is_dir() {
                let projects_dir = entry.path().join("projects");
                if projects_dir.exists() && !dirs.contains(&projects_dir) {
                    dirs.push(projects_dir);
                }
            }
        }
    }

    dirs
}

/// Recursively collect files with the given extension.
fn walkdir(dir: &std::path::Path, ext: &str) -> Vec<std::path::PathBuf> {
    let mut results = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                results.extend(walkdir(&path, ext));
            } else if path.extension().map(|e| e == ext).unwrap_or(false) {
                results.push(path);
            }
        }
    }
    results
}
