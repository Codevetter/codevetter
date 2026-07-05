//! Repo workspace — project registry and Intel snapshot history.

use crate::commands::dora;
use crate::commands::intel;
use crate::commands::unpack;
use crate::commands::unpack_scan::{emit_unpack_scan_progress, ScanProgress, ScanProgressCallback};
use crate::commands::unpack_scan_profile::{emit_unpack_scan_profile, UnpackScanProfiler};
use crate::DbState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, State};

const BACKGROUND_ENRICH_DELAY_MS: u64 = 1_500;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoProjectRow {
    pub id: String,
    pub repo_path: String,
    pub display_name: String,
    pub first_opened_at: String,
    pub last_opened_at: String,
    pub last_unpack_at: Option<String>,
    pub last_intel_at: Option<String>,
    pub unpack_snapshot_count: i64,
    pub intel_snapshot_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoIntelReportSummary {
    pub id: String,
    pub repo_path: String,
    pub repo_name: String,
    pub commit_sha: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub window_days: i64,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoIntelReportRecord {
    pub id: String,
    pub repo_path: String,
    pub repo_name: String,
    pub commit_sha: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub window_days: i64,
    pub report_json: String,
    pub dora_json: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
}

fn conn_lock(db: &DbState) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, String> {
    db.0.lock().map_err(|e| e.to_string())
}

fn display_name_from_path(repo_path: &str) -> String {
    std::path::Path::new(repo_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("repo")
        .to_string()
}

fn touch_unpack_at(conn: &rusqlite::Connection, repo_path: &str, at: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE repo_projects SET last_unpack_at = ?2 WHERE repo_path = ?1",
        rusqlite::params![repo_path, at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn touch_intel_at(conn: &rusqlite::Connection, repo_path: &str, at: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE repo_projects SET last_intel_at = ?2 WHERE repo_path = ?1",
        rusqlite::params![repo_path, at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_repo_projects(db: State<'_, DbState>) -> Result<Vec<RepoProjectRow>, String> {
    let conn = conn_lock(&db)?;
    crate::db::with_busy_retry(|| list_repo_project_rows(&conn), 5).map_err(|e| e.to_string())
}

fn list_repo_project_rows(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<RepoProjectRow>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.repo_path, p.display_name, p.first_opened_at, p.last_opened_at,
                p.last_unpack_at, p.last_intel_at,
                (SELECT COUNT(*) FROM repo_unpacked_reports u WHERE u.repo_path = p.repo_path),
                (SELECT COUNT(*) FROM repo_intel_reports i WHERE i.repo_path = p.repo_path)
         FROM repo_projects p
         WHERE p.user_added = 1
         ORDER BY p.last_opened_at DESC",
    )?;

    let rows = stmt
        .query_map([], map_project_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub async fn register_repo_project(
    db: State<'_, DbState>,
    repo_path: String,
    display_name: Option<String>,
) -> Result<RepoProjectRow, String> {
    let trimmed = repo_path.trim().to_string();
    if trimmed.is_empty() {
        return Err("repo_path is empty".to_string());
    }
    let name = display_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| display_name_from_path(&trimmed));
    let now = chrono::Utc::now().to_rfc3339();

    let conn = conn_lock(&db)?;
    crate::db::with_busy_retry(
        || register_repo_project_inner(&conn, &trimmed, &name, &now),
        5,
    )
    .map_err(|e| e.to_string())?;

    let row = crate::db::with_busy_retry(|| query_project_row(&conn, &trimmed), 5)
        .map_err(|e| e.to_string())?;

    Ok(row)
}

#[tauri::command]
pub async fn remove_repo_project(
    db: State<'_, DbState>,
    repo_path: String,
) -> Result<serde_json::Value, String> {
    let trimmed = repo_path.trim().to_string();
    if trimmed.is_empty() {
        return Err("repo_path is empty".to_string());
    }

    let conn = conn_lock(&db)?;
    let deleted = crate::db::with_busy_retry(
        || {
            conn.execute(
                "DELETE FROM repo_projects WHERE repo_path = ?1",
                rusqlite::params![trimmed],
            )
        },
        5,
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "deleted": deleted > 0 }))
}

fn map_project_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<RepoProjectRow> {
    Ok(RepoProjectRow {
        id: r.get(0)?,
        repo_path: r.get(1)?,
        display_name: r.get(2)?,
        first_opened_at: r.get(3)?,
        last_opened_at: r.get(4)?,
        last_unpack_at: r.get(5)?,
        last_intel_at: r.get(6)?,
        unpack_snapshot_count: r.get(7)?,
        intel_snapshot_count: r.get(8)?,
    })
}

fn query_project_row(
    conn: &rusqlite::Connection,
    repo_path: &str,
) -> rusqlite::Result<RepoProjectRow> {
    conn.query_row(
        "SELECT p.id, p.repo_path, p.display_name, p.first_opened_at, p.last_opened_at,
                p.last_unpack_at, p.last_intel_at,
                (SELECT COUNT(*) FROM repo_unpacked_reports u WHERE u.repo_path = p.repo_path),
                (SELECT COUNT(*) FROM repo_intel_reports i WHERE i.repo_path = p.repo_path)
         FROM repo_projects p
         WHERE p.repo_path = ?1 AND p.user_added = 1",
        rusqlite::params![repo_path],
        map_project_row,
    )
}

/// Scan a repo and persist an inventory-only unpack snapshot (no LLM).
#[tauri::command]
pub async fn save_unpack_scan_snapshot(
    app: AppHandle,
    db: State<'_, DbState>,
    repo_path: String,
    scan_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let trimmed = repo_path.trim().to_string();
    if trimmed.is_empty() {
        return Err("repo_path is empty".to_string());
    }

    let report_id = scan_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let app_for_progress = app.clone();
    let repo_for_progress = trimmed.clone();
    let scan_for_progress = report_id.clone();
    let progress_cb: ScanProgressCallback = Arc::new(move |p: ScanProgress| {
        let detail = match p.phase {
            "walking" => {
                if p.detail.starts_with("Walk complete") {
                    p.detail
                } else {
                    let skipped = if p.files_skipped > 0 {
                        format!(" · {} skipped", p.files_skipped)
                    } else {
                        String::new()
                    };
                    format!(
                        "{} files{} · {}",
                        p.files_seen,
                        skipped,
                        truncate_scan_path(&p.detail)
                    )
                }
            }
            "skipping" => format!("Skipping {}", truncate_scan_path(&p.detail)),
            "analyze" => p.detail,
            _ => p.detail,
        };
        emit_unpack_scan_progress(
            &app_for_progress,
            &scan_for_progress,
            &repo_for_progress,
            &detail,
            p.files_seen,
        );
    });

    let build = tokio::task::spawn_blocking(move || {
        unpack::build_inventory_with_progress(
            &trimmed,
            Some(progress_cb),
            unpack::InventoryBuildProfile::Full,
        )
    })
    .await
    .map_err(|e| format!("inventory scan task join error: {e}"))??;

    let inventory = build.inventory;
    emit_unpack_scan_profile(&app, &report_id, &inventory.repo_path, &build.profile);

    let mut persist_profiler = UnpackScanProfiler::new("local_scan_persist");

    emit_unpack_scan_progress(
        &app,
        &report_id,
        &inventory.repo_path,
        &format!("Saved snapshot · {} files scanned", inventory.files_scanned),
        inventory.files_scanned,
    );

    let inventory_json = serde_json::to_string(&inventory).map_err(|e| e.to_string())?;
    persist_profiler.step("serialize", "JSON serialize (inventory → SQLite)");
    let now = chrono::Utc::now().to_rfc3339();

    let conn = conn_lock(&db)?;

    crate::db::with_busy_retry(
        || {
            conn.execute(
                "INSERT INTO repo_unpacked_reports
                 (id, repo_path, repo_name, commit_sha, status, inventory_json,
                  files_scanned, files_skipped, bytes_scanned, started_at, completed_at, created_at)
                 VALUES (?1, ?2, ?3, ?4, 'scan_only', ?5, ?6, ?7, ?8, ?9, ?9, ?9)",
                rusqlite::params![
                    report_id,
                    inventory.repo_path,
                    inventory.repo_name,
                    inventory.commit_sha,
                    inventory_json,
                    inventory.files_scanned as i64,
                    inventory.files_skipped as i64,
                    inventory.bytes_scanned as i64,
                    now,
                ],
            )
        },
        15,
    )
    .map_err(|e| e.to_string())?;
    persist_profiler.step("db_insert", "SQLite insert");

    touch_unpack_at(&conn, &inventory.repo_path, &now)?;
    persist_profiler.step("touch_project", "Update repo project metadata");

    let persist_profile = persist_profiler.finish();
    emit_unpack_scan_profile(&app, &report_id, &inventory.repo_path, &persist_profile);

    if unpack::inventory_needs_enrichment(&inventory) {
        let db_arc = db.0.clone();
        let app_bg = app.clone();
        let report_id_bg = report_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(BACKGROUND_ENRICH_DELAY_MS)).await;
            let _ = tokio::task::spawn_blocking(move || {
                unpack::try_enrich_stored_unpack_inventory(&app_bg, &db_arc, &report_id_bg, None)
            })
            .await;
        });
    }

    Ok(serde_json::json!({
        "report_id": report_id,
        "status": "scan_only",
        "inventory": unpack::trim_inventory_for_client(inventory),
        "created_at": now,
        "profiles": [build.profile, persist_profile],
    }))
}

fn truncate_scan_path(path: &str) -> String {
    let trimmed = path.trim();
    let char_count = trimmed.chars().count();
    if char_count <= 72 {
        trimmed.to_string()
    } else {
        format!(
            "…{}",
            trimmed
                .chars()
                .skip(char_count.saturating_sub(68))
                .collect::<String>()
        )
    }
}

fn register_repo_project_inner(
    conn: &rusqlite::Connection,
    repo_path: &str,
    display_name: &str,
    now: &str,
) -> rusqlite::Result<()> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO repo_projects
            (id, repo_path, display_name, first_opened_at, last_opened_at, user_added)
         VALUES (?1, ?2, ?3, ?4, ?4, 1)
         ON CONFLICT(repo_path) DO UPDATE SET
            display_name = excluded.display_name,
            last_opened_at = excluded.last_opened_at,
            user_added = 1",
        rusqlite::params![id, repo_path, display_name, now],
    )?;
    Ok(())
}

/// Run git attribution + DORA and persist a snapshot.
#[tauri::command]
pub async fn save_intel_snapshot(
    db: State<'_, DbState>,
    repo_path: String,
    window_days: Option<i64>,
) -> Result<serde_json::Value, String> {
    let trimmed = repo_path.trim().to_string();
    if trimmed.is_empty() {
        return Err("repo_path is empty".to_string());
    }
    let window = window_days.unwrap_or(90).max(7);
    let started = chrono::Utc::now().to_rfc3339();
    let report_id = uuid::Uuid::new_v4().to_string();

    let report = intel::attribute_repo_path(&trimmed)?;
    let dora = dora::get_dora_metrics(trimmed.clone(), Some(window as u32))
        .await
        .ok();
    let report_json = serde_json::to_string(&report).map_err(|e| e.to_string())?;
    let dora_json = dora
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| e.to_string())?;
    let completed = chrono::Utc::now().to_rfc3339();
    let repo_name = display_name_from_path(&trimmed);
    let commit_sha = current_head_sha(&trimmed).ok();

    let conn = conn_lock(&db)?;

    conn.execute(
        "INSERT INTO repo_intel_reports
         (id, repo_path, repo_name, commit_sha, status, window_days,
          report_json, dora_json, started_at, completed_at, created_at)
         VALUES (?1, ?2, ?3, ?4, 'completed', ?5, ?6, ?7, ?8, ?9, ?9)",
        rusqlite::params![
            report_id,
            trimmed,
            repo_name,
            commit_sha,
            window,
            report_json,
            dora_json,
            started,
            completed,
        ],
    )
    .map_err(|e| e.to_string())?;

    touch_intel_at(&conn, &trimmed, &completed)?;

    Ok(serde_json::json!({
        "report_id": report_id,
        "status": "completed",
        "report": report,
        "dora": dora,
        "created_at": completed,
        "window_days": window,
    }))
}

fn current_head_sha(repo_path: &str) -> Result<String, String> {
    let out = std::process::Command::new("git")
        .args(["-C", repo_path, "rev-parse", "HEAD"])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("git rev-parse failed".to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
pub async fn list_repo_intel_reports(
    db: State<'_, DbState>,
    repo_path: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<RepoIntelReportSummary>, String> {
    let conn = conn_lock(&db)?;
    let limit = limit.unwrap_or(50);

    let rows = if let Some(path) = repo_path {
        let mut stmt = conn
            .prepare(
                "SELECT id, repo_path, repo_name, commit_sha, status, error_message,
                        window_days, started_at, completed_at, created_at
                 FROM repo_intel_reports
                 WHERE repo_path = ?1
                 ORDER BY datetime(created_at) DESC
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map(rusqlite::params![path, limit], map_intel_summary)
            .map_err(|e| e.to_string())?;
        mapped
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, repo_path, repo_name, commit_sha, status, error_message,
                        window_days, started_at, completed_at, created_at
                 FROM repo_intel_reports
                 ORDER BY datetime(created_at) DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map(rusqlite::params![limit], map_intel_summary)
            .map_err(|e| e.to_string())?;
        mapped
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    Ok(rows)
}

fn map_intel_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<RepoIntelReportSummary> {
    Ok(RepoIntelReportSummary {
        id: r.get(0)?,
        repo_path: r.get(1)?,
        repo_name: r.get(2)?,
        commit_sha: r.get(3)?,
        status: r.get(4)?,
        error_message: r.get(5)?,
        window_days: r.get(6)?,
        started_at: r.get(7)?,
        completed_at: r.get(8)?,
        created_at: r.get(9)?,
    })
}

#[tauri::command]
pub async fn get_repo_intel_report(
    db: State<'_, DbState>,
    id: String,
) -> Result<RepoIntelReportRecord, String> {
    let conn = conn_lock(&db)?;
    conn.query_row(
        "SELECT id, repo_path, repo_name, commit_sha, status, error_message,
                window_days, report_json, dora_json, started_at, completed_at, created_at
         FROM repo_intel_reports WHERE id = ?1",
        rusqlite::params![id],
        |r| {
            Ok(RepoIntelReportRecord {
                id: r.get(0)?,
                repo_path: r.get(1)?,
                repo_name: r.get(2)?,
                commit_sha: r.get(3)?,
                status: r.get(4)?,
                error_message: r.get(5)?,
                window_days: r.get(6)?,
                report_json: r.get(7)?,
                dora_json: r.get(8)?,
                started_at: r.get(9)?,
                completed_at: r.get(10)?,
                created_at: r.get(11)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_repo_intel_report(
    db: State<'_, DbState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let conn = conn_lock(&db)?;
    let deleted = crate::db::with_busy_retry(
        || {
            conn.execute(
                "DELETE FROM repo_intel_reports WHERE id = ?1",
                rusqlite::params![id],
            )
        },
        5,
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "deleted": deleted > 0 }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_project_registry_round_trip_is_lightweight() {
        let conn = rusqlite::Connection::open_in_memory().expect("open db");
        crate::db::schema::run_migrations(&conn).expect("schema");

        let now = "2026-07-05T00:00:00Z";
        register_repo_project_inner(&conn, "/tmp/codevetter", "CodeVetter", now)
            .expect("register project");

        let row = query_project_row(&conn, "/tmp/codevetter").expect("query project");
        assert_eq!(row.display_name, "CodeVetter");
        assert_eq!(row.unpack_snapshot_count, 0);
        assert_eq!(row.intel_snapshot_count, 0);

        let rows = list_repo_project_rows(&conn).expect("list projects");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].repo_path, "/tmp/codevetter");
    }
}
