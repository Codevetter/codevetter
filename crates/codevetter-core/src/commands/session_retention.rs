use crate::DbState;
use chrono::{Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use tauri::State;
use uuid::Uuid;

const MIN_ARCHIVE_BYTES: i64 = 1024 * 1024;
const MAX_ARCHIVE_BYTES: i64 = 500 * 1024 * 1024 * 1024;
const MAX_AGE_DAYS: i64 = 3650;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRetentionPolicy {
    pub max_age_days: Option<i64>,
    pub max_archive_bytes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionRetentionEntry {
    pub session_id: String,
    pub rows: i64,
    pub estimated_bytes: i64,
    pub last_activity: String,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRetentionPlan {
    pub id: String,
    pub plan_identity: String,
    pub archive_fingerprint: String,
    pub policy: SessionRetentionPolicy,
    pub archive_rows: i64,
    pub archive_bytes: i64,
    pub candidate_rows: i64,
    pub candidate_bytes: i64,
    pub candidates: Vec<SessionRetentionEntry>,
    pub protected: Vec<SessionRetentionEntry>,
    pub projected_rows: i64,
    pub projected_bytes: i64,
    pub created_at: String,
}

pub const SESSION_RETENTION_SCHEMA_VERSION: &str = "codevetter.session-retention/v1";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionRetentionOperation {
    Plan,
    Apply,
    Checkpoint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRetentionReceipt {
    pub schema_version: String,
    pub generated_at: String,
    pub operation: SessionRetentionOperation,
    pub plan: Option<SessionRetentionPlan>,
    pub result: Option<Value>,
}

#[derive(Debug, Clone)]
struct SessionArchiveStat {
    session_id: String,
    rows: i64,
    estimated_bytes: i64,
    last_activity: String,
}

#[tauri::command]
pub async fn plan_session_retention(
    db: State<'_, DbState>,
    policy: SessionRetentionPolicy,
) -> Result<SessionRetentionPlan, String> {
    validate_policy(&policy)?;
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    plan_session_retention_with_connection(&conn, policy)
}

#[tauri::command]
pub async fn apply_session_retention(
    db: State<'_, DbState>,
    plan_id: String,
) -> Result<Value, String> {
    let plan_id = bounded_id(&plan_id, "plan id")?;
    let mut conn = db.0.lock().map_err(|error| error.to_string())?;
    apply_session_retention_with_connection(&mut conn, &plan_id)
}

#[tauri::command]
pub async fn set_session_retention_pin(
    db: State<'_, DbState>,
    session_id: String,
    pinned: bool,
    reason: Option<String>,
) -> Result<Value, String> {
    let session_id = bounded_id(&session_id, "session id")?;
    let reason = reason
        .map(|value| value.trim().chars().take(240).collect::<String>())
        .filter(|value| !value.is_empty());
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM cc_sessions WHERE id = ?1)",
            [&session_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !exists {
        return Err("Session not found".to_string());
    }

    if pinned {
        conn.execute(
            "INSERT INTO session_retention_pins(session_id, reason, pinned_at)
             VALUES(?1, ?2, ?3)
             ON CONFLICT(session_id) DO UPDATE SET
                 reason = excluded.reason,
                 pinned_at = excluded.pinned_at",
            params![session_id, reason, Utc::now().to_rfc3339()],
        )
        .map_err(|error| error.to_string())?;
    } else {
        conn.execute(
            "DELETE FROM session_retention_pins WHERE session_id = ?1",
            [&session_id],
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(json!({ "sessionId": session_id, "pinned": pinned }))
}

#[tauri::command]
pub async fn compact_session_archive(
    db: State<'_, DbState>,
    vacuum: Option<bool>,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    compact_session_archive_with_connection(&conn, vacuum.unwrap_or(false))
}

pub fn plan_session_retention_with_connection(
    connection: &Connection,
    policy: SessionRetentionPolicy,
) -> Result<SessionRetentionPlan, String> {
    validate_policy(&policy)?;
    let plan = build_plan(connection, policy)?;
    persist_plan(connection, &plan)?;
    Ok(plan)
}

pub fn apply_session_retention_with_connection(
    connection: &mut Connection,
    plan_id: &str,
) -> Result<Value, String> {
    let plan_id = bounded_id(plan_id, "plan id")?;
    apply_plan(connection, &plan_id)
}

pub fn compact_session_archive_with_connection(
    connection: &Connection,
    vacuum: bool,
) -> Result<Value, String> {
    let conn = connection;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|error| error.to_string())?;
    if vacuum {
        conn.execute_batch("VACUUM;")
            .map_err(|error| error.to_string())?;
    }
    let created_at = Utc::now().to_rfc3339();
    let event_id = format!("retention-event:{}", Uuid::new_v4());
    let latest_run_id: Option<String> = conn
        .query_row(
            "SELECT id FROM session_retention_runs
             ORDER BY created_at DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some(run_id) = latest_run_id {
        conn.execute(
            "INSERT INTO session_retention_events(
                id, run_id, event_type, detail_json, created_at
             ) VALUES(?1, ?2, 'compacted', ?3, ?4)",
            params![
                event_id,
                run_id,
                json!({ "vacuum": vacuum }).to_string(),
                created_at
            ],
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(json!({
        "checkpointed": true,
        "vacuumed": vacuum,
        "createdAt": created_at,
    }))
}

pub fn run_session_retention_operation(
    connection: &mut Connection,
    operation: SessionRetentionOperation,
    policy: Option<SessionRetentionPolicy>,
    plan_id: Option<&str>,
    vacuum: bool,
) -> Result<SessionRetentionReceipt, String> {
    let (plan, result) = match operation {
        SessionRetentionOperation::Plan => {
            let policy =
                policy.ok_or_else(|| "Retention planning requires a policy".to_string())?;
            (
                Some(plan_session_retention_with_connection(connection, policy)?),
                None,
            )
        }
        SessionRetentionOperation::Apply => {
            let plan_id =
                plan_id.ok_or_else(|| "Retention apply requires a plan id".to_string())?;
            (
                None,
                Some(apply_session_retention_with_connection(
                    connection, plan_id,
                )?),
            )
        }
        SessionRetentionOperation::Checkpoint => (
            None,
            Some(compact_session_archive_with_connection(connection, vacuum)?),
        ),
    };
    Ok(SessionRetentionReceipt {
        schema_version: SESSION_RETENTION_SCHEMA_VERSION.to_string(),
        generated_at: Utc::now().to_rfc3339(),
        operation,
        plan,
        result,
    })
}

fn validate_policy(policy: &SessionRetentionPolicy) -> Result<(), String> {
    if policy.max_age_days.is_none() && policy.max_archive_bytes.is_none() {
        return Err("Set an age or archive-size limit".to_string());
    }
    if let Some(days) = policy.max_age_days {
        if !(1..=MAX_AGE_DAYS).contains(&days) {
            return Err(format!("maxAgeDays must be between 1 and {MAX_AGE_DAYS}"));
        }
    }
    if let Some(bytes) = policy.max_archive_bytes {
        if !(MIN_ARCHIVE_BYTES..=MAX_ARCHIVE_BYTES).contains(&bytes) {
            return Err("maxArchiveBytes is outside the supported range".to_string());
        }
    }
    Ok(())
}

fn build_plan(
    conn: &Connection,
    policy: SessionRetentionPolicy,
) -> Result<SessionRetentionPlan, String> {
    validate_policy(&policy)?;
    let stats = session_archive_stats(conn)?;
    let protected_reasons = protected_session_reasons(conn)?;
    let archive_rows = stats.iter().map(|stat| stat.rows).sum::<i64>();
    let archive_bytes = stats.iter().map(|stat| stat.estimated_bytes).sum::<i64>();
    let cutoff = policy
        .max_age_days
        .map(|days| (Utc::now() - Duration::days(days)).to_rfc3339());

    let mut candidate_ids = BTreeSet::new();
    let mut candidate_reasons = BTreeMap::<String, BTreeSet<String>>::new();
    for stat in &stats {
        if protected_reasons.contains_key(&stat.session_id) {
            continue;
        }
        if cutoff
            .as_ref()
            .is_some_and(|value| stat.last_activity < *value)
        {
            candidate_ids.insert(stat.session_id.clone());
            candidate_reasons
                .entry(stat.session_id.clone())
                .or_default()
                .insert("older than configured age".to_string());
        }
    }

    if let Some(max_bytes) = policy.max_archive_bytes {
        let mut projected = archive_bytes
            - stats
                .iter()
                .filter(|stat| candidate_ids.contains(&stat.session_id))
                .map(|stat| stat.estimated_bytes)
                .sum::<i64>();
        if projected > max_bytes {
            for stat in &stats {
                if projected <= max_bytes {
                    break;
                }
                if protected_reasons.contains_key(&stat.session_id)
                    || candidate_ids.contains(&stat.session_id)
                {
                    continue;
                }
                candidate_ids.insert(stat.session_id.clone());
                candidate_reasons
                    .entry(stat.session_id.clone())
                    .or_default()
                    .insert("needed to meet configured archive size".to_string());
                projected = projected.saturating_sub(stat.estimated_bytes);
            }
        }
    }

    let candidates = stats
        .iter()
        .filter(|stat| candidate_ids.contains(&stat.session_id))
        .map(|stat| SessionRetentionEntry {
            session_id: stat.session_id.clone(),
            rows: stat.rows,
            estimated_bytes: stat.estimated_bytes,
            last_activity: stat.last_activity.clone(),
            reasons: candidate_reasons
                .get(&stat.session_id)
                .map(|values| values.iter().cloned().collect())
                .unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    let protected = stats
        .iter()
        .filter_map(|stat| {
            protected_reasons
                .get(&stat.session_id)
                .map(|reasons| SessionRetentionEntry {
                    session_id: stat.session_id.clone(),
                    rows: stat.rows,
                    estimated_bytes: stat.estimated_bytes,
                    last_activity: stat.last_activity.clone(),
                    reasons: reasons.iter().cloned().collect(),
                })
        })
        .collect::<Vec<_>>();
    let candidate_rows = candidates.iter().map(|entry| entry.rows).sum::<i64>();
    let candidate_bytes = candidates
        .iter()
        .map(|entry| entry.estimated_bytes)
        .sum::<i64>();
    let archive_fingerprint = archive_fingerprint(conn, &protected_reasons)?;
    let identity_payload = json!({
        "schemaVersion": 1,
        "archiveFingerprint": archive_fingerprint,
        "policy": policy,
        "candidates": candidates,
        "protected": protected,
    });
    let plan_identity = format!(
        "sha256:{:x}",
        Sha256::digest(identity_payload.to_string().as_bytes())
    );

    Ok(SessionRetentionPlan {
        id: format!("retention-plan:{}", &plan_identity[7..23]),
        plan_identity,
        archive_fingerprint,
        policy,
        archive_rows,
        archive_bytes,
        candidate_rows,
        candidate_bytes,
        candidates,
        protected,
        projected_rows: archive_rows.saturating_sub(candidate_rows),
        projected_bytes: archive_bytes.saturating_sub(candidate_bytes),
        created_at: Utc::now().to_rfc3339(),
    })
}

fn persist_plan(conn: &Connection, plan: &SessionRetentionPlan) -> Result<(), String> {
    conn.execute(
        "INSERT INTO session_retention_runs(
            id, plan_identity, archive_fingerprint, policy_json, status, plan_json,
            candidate_sessions, protected_sessions, candidate_rows, estimated_bytes,
            created_at
         ) VALUES(?1, ?2, ?3, ?4, 'planned', ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(plan_identity) DO NOTHING",
        params![
            plan.id,
            plan.plan_identity,
            plan.archive_fingerprint,
            serde_json::to_string(&plan.policy).map_err(|error| error.to_string())?,
            serde_json::to_string(plan).map_err(|error| error.to_string())?,
            plan.candidates.len() as i64,
            plan.protected.len() as i64,
            plan.candidate_rows,
            plan.candidate_bytes,
            plan.created_at
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn apply_plan(conn: &mut Connection, plan_id: &str) -> Result<Value, String> {
    let stored: Option<(String, String, String)> = conn
        .query_row(
            "SELECT status, policy_json, plan_json
             FROM session_retention_runs WHERE id = ?1",
            [plan_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((status, policy_json, plan_json)) = stored else {
        return Err("Retention plan not found".to_string());
    };
    if status != "planned" {
        return Err(format!("Retention plan is already {status}"));
    }
    let policy: SessionRetentionPolicy =
        serde_json::from_str(&policy_json).map_err(|error| error.to_string())?;
    let stored_plan: SessionRetentionPlan =
        serde_json::from_str(&plan_json).map_err(|error| error.to_string())?;
    let current_plan = build_plan(conn, policy)?;
    if current_plan.plan_identity != stored_plan.plan_identity {
        let now = Utc::now().to_rfc3339();
        let event_id = format!("retention-event:{}", Uuid::new_v4());
        let detail = json!({
            "reason": "archive or protected-reference set changed",
            "expectedPlanIdentity": stored_plan.plan_identity,
            "currentPlanIdentity": current_plan.plan_identity,
        });
        let transaction = conn.transaction().map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE session_retention_runs
                 SET status = 'rejected', rejection_reason = ?2 WHERE id = ?1",
                params![plan_id, "archive or protected-reference set changed"],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO session_retention_events(
                    id, run_id, event_type, detail_json, created_at
                 ) VALUES(?1, ?2, 'rejected', ?3, ?4)",
                params![event_id, plan_id, detail.to_string(), now],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        return Err("Retention plan is stale; preview cleanup again".to_string());
    }

    let now = Utc::now().to_rfc3339();
    let transaction = conn.transaction().map_err(|error| error.to_string())?;
    let mut removed_rows = 0i64;
    for candidate in &stored_plan.candidates {
        transaction
            .execute(
                "DELETE FROM session_message_archive_fts WHERE session_id = ?1",
                [&candidate.session_id],
            )
            .map_err(|error| error.to_string())?;
        removed_rows += transaction
            .execute(
                "DELETE FROM session_message_archive WHERE session_id = ?1",
                [&candidate.session_id],
            )
            .map_err(|error| error.to_string())? as i64;
    }
    let detail = json!({
        "planIdentity": stored_plan.plan_identity,
        "removedRows": removed_rows,
        "removedSessions": stored_plan.candidates.len(),
        "estimatedBytes": stored_plan.candidate_bytes,
        "sourceTranscriptsDeleted": false,
    });
    transaction
        .execute(
            "UPDATE session_retention_runs
             SET status = 'applied', applied_rows = ?2, applied_sessions = ?3,
                 applied_at = ?4
             WHERE id = ?1",
            params![
                plan_id,
                removed_rows,
                stored_plan.candidates.len() as i64,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO session_retention_events(
                id, run_id, event_type, detail_json, created_at
             ) VALUES(?1, ?2, 'applied', ?3, ?4)",
            params![
                format!("retention-event:{}", Uuid::new_v4()),
                plan_id,
                detail.to_string(),
                now
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(detail)
}

fn session_archive_stats(conn: &Connection) -> Result<Vec<SessionArchiveStat>, String> {
    let mut statement = conn
        .prepare(
            "SELECT session_id,
                    COUNT(*),
                    COALESCE(SUM(
                        length(COALESCE(content_text, '')) +
                        length(COALESCE(tool_name, '')) +
                        length(COALESCE(source_ref, '')) + 96
                    ), 0),
                    COALESCE(MAX(COALESCE(timestamp, created_at)), '')
             FROM session_message_archive
             GROUP BY session_id
             ORDER BY COALESCE(MAX(COALESCE(timestamp, created_at)), '') ASC,
                      session_id ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(SessionArchiveStat {
                session_id: row.get(0)?,
                rows: row.get(1)?,
                estimated_bytes: row.get(2)?,
                last_activity: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}

fn protected_session_reasons(
    conn: &Connection,
) -> Result<BTreeMap<String, BTreeSet<String>>, String> {
    let mut reasons = BTreeMap::<String, BTreeSet<String>>::new();
    for (sql, reason) in [
        (
            "SELECT session_id FROM session_retention_pins",
            "pinned by user",
        ),
        (
            "SELECT agent_session_id FROM agent_tasks
             WHERE agent_session_id IS NOT NULL
               AND status NOT IN ('done', 'completed')",
            "attached to active work item",
        ),
        (
            "SELECT session_id FROM agent_processes
             WHERE session_id IS NOT NULL
               AND status NOT IN ('stopped', 'completed', 'failed')",
            "owned by active agent process",
        ),
        (
            "SELECT session_id FROM workspaces
             WHERE session_id IS NOT NULL AND archived_at IS NULL",
            "attached to active workspace",
        ),
        (
            "SELECT session_id FROM chat_tabs WHERE session_id IS NOT NULL",
            "open in conversation tab",
        ),
        (
            "SELECT session_id FROM intent_closure_receipts
             WHERE session_id IS NOT NULL",
            "referenced by intent closure",
        ),
    ] {
        let mut statement = conn.prepare(sql).map_err(|error| error.to_string())?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        for id in ids {
            reasons
                .entry(id.map_err(|error| error.to_string())?)
                .or_default()
                .insert(reason.to_string());
        }
    }
    Ok(reasons)
}

fn archive_fingerprint(
    conn: &Connection,
    protections: &BTreeMap<String, BTreeSet<String>>,
) -> Result<String, String> {
    let (rows, bytes, newest, fts_rows): (i64, i64, String, i64) = conn
        .query_row(
            "SELECT
                (SELECT COUNT(*) FROM session_message_archive),
                (SELECT COALESCE(SUM(
                    length(COALESCE(content_text, '')) +
                    length(COALESCE(tool_name, '')) +
                    length(COALESCE(source_ref, '')) + 96
                 ), 0) FROM session_message_archive),
                (SELECT COALESCE(MAX(created_at), '') FROM session_message_archive),
                (SELECT COUNT(*) FROM session_message_archive_fts)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|error| error.to_string())?;
    let payload = json!({
        "rows": rows,
        "bytes": bytes,
        "newest": newest,
        "ftsRows": fts_rows,
        "protections": protections,
    });
    Ok(format!(
        "sha256:{:x}",
        Sha256::digest(payload.to_string().as_bytes())
    ))
}

fn bounded_id(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 512 {
        return Err(format!("A valid {label} is required"));
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().expect("database");
        schema::run_migrations(&conn).expect("schema");
        conn.execute(
            "INSERT INTO cc_projects(id, display_name, dir_path, created_at)
             VALUES('project', 'Project', '/tmp/project', '2020-01-01T00:00:00Z')",
            [],
        )
        .expect("project");
        for session in ["old", "pinned", "active", "recent"] {
            conn.execute(
                "INSERT INTO cc_sessions(id, project_id, agent_type)
                 VALUES(?1, 'project', 'codex')",
                [session],
            )
            .expect("session");
        }
        for (session, timestamp) in [
            ("old", "2020-01-01T00:00:00Z"),
            ("pinned", "2020-01-01T00:00:00Z"),
            ("active", "2020-01-01T00:00:00Z"),
            ("recent", "2099-01-01T00:00:00Z"),
        ] {
            for index in 0..3 {
                let id = format!("{session}:{index}");
                conn.execute(
                    "INSERT INTO session_message_archive(
                        id, session_id, adapter_id, agent_type, source_ref,
                        message_index, kind, timestamp, content_text, created_at
                     ) VALUES(?1, ?2, 'codex', 'codex', ?3, ?4, 'message',
                              ?5, 'bounded content', ?5)",
                    params![id, session, format!("{session}.jsonl"), index, timestamp],
                )
                .expect("archive");
                conn.execute(
                    "INSERT INTO session_message_archive_fts(
                        archive_id, session_id, adapter_id, agent_type, role,
                        kind, content_text, tool_name, source_ref
                     ) VALUES(?1, ?2, 'codex', 'codex', 'user', 'message',
                              'bounded content', NULL, ?3)",
                    params![id, session, format!("{session}.jsonl")],
                )
                .expect("fts");
            }
        }
        conn.execute(
            "INSERT INTO session_retention_pins(session_id, reason, pinned_at)
             VALUES('pinned', 'keep', '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("pin");
        conn.execute(
            "INSERT INTO agent_tasks(
                id, title, status, agent_session_id, created_at, updated_at
             ) VALUES('task', 'Active', 'build', 'active',
                      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("task");
        conn
    }

    #[test]
    fn plan_preserves_pinned_and_referenced_sessions() {
        let conn = fixture();
        let plan = build_plan(
            &conn,
            SessionRetentionPolicy {
                max_age_days: Some(30),
                max_archive_bytes: None,
            },
        )
        .expect("plan");
        assert_eq!(
            plan.candidates
                .iter()
                .map(|entry| entry.session_id.as_str())
                .collect::<Vec<_>>(),
            vec!["old"]
        );
        assert_eq!(plan.protected.len(), 2);
        assert_eq!(plan.candidate_rows, 3);
    }

    #[test]
    fn stale_plan_is_rejected_without_deleting_rows() {
        let mut conn = fixture();
        let plan = build_plan(
            &conn,
            SessionRetentionPolicy {
                max_age_days: Some(30),
                max_archive_bytes: None,
            },
        )
        .expect("plan");
        persist_plan(&conn, &plan).expect("persist");
        conn.execute(
            "INSERT INTO session_retention_pins(session_id, pinned_at)
             VALUES('old', '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("new protection");
        let error = apply_plan(&mut conn, &plan.id).expect_err("stale");
        assert!(error.contains("stale"));
        let rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_message_archive WHERE session_id = 'old'",
                [],
                |row| row.get(0),
            )
            .expect("rows");
        assert_eq!(rows, 3);
    }

    #[test]
    fn apply_removes_base_and_fts_rows_but_not_session() {
        let mut conn = fixture();
        let plan = build_plan(
            &conn,
            SessionRetentionPolicy {
                max_age_days: Some(30),
                max_archive_bytes: None,
            },
        )
        .expect("plan");
        persist_plan(&conn, &plan).expect("persist");
        apply_plan(&mut conn, &plan.id).expect("apply");
        let counts: (i64, i64, i64) = conn
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM session_message_archive WHERE session_id = 'old'),
                    (SELECT COUNT(*) FROM session_message_archive_fts WHERE session_id = 'old'),
                    (SELECT COUNT(*) FROM cc_sessions WHERE id = 'old')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("counts");
        assert_eq!(counts, (0, 0, 1));
    }

    #[test]
    fn large_archive_plan_is_bounded_by_session() {
        let conn = fixture();
        for index in 0..1_000 {
            conn.execute(
                "INSERT INTO session_message_archive(
                    id, session_id, adapter_id, agent_type, source_ref,
                    message_index, kind, timestamp, content_text, created_at
                 ) VALUES(?1, 'old', 'codex', 'codex', 'old.jsonl',
                          ?2, 'message', '2020-01-01T00:00:00Z',
                          'bounded content', '2020-01-01T00:00:00Z')",
                params![format!("old:large:{index}"), index + 10],
            )
            .expect("archive");
        }
        let plan = build_plan(
            &conn,
            SessionRetentionPolicy {
                max_age_days: Some(30),
                max_archive_bytes: None,
            },
        )
        .expect("plan");
        assert_eq!(plan.candidates.len(), 1);
        assert_eq!(plan.candidate_rows, 1_003);
    }

    #[test]
    fn shared_operation_receipt_preserves_preview_without_touching_source_sessions() {
        let mut conn = fixture();
        let receipt = run_session_retention_operation(
            &mut conn,
            SessionRetentionOperation::Plan,
            Some(SessionRetentionPolicy {
                max_age_days: Some(30),
                max_archive_bytes: None,
            }),
            None,
            false,
        )
        .expect("receipt");
        assert_eq!(receipt.schema_version, SESSION_RETENTION_SCHEMA_VERSION);
        assert_eq!(receipt.operation, SessionRetentionOperation::Plan);
        assert_eq!(receipt.plan.as_ref().expect("plan").candidate_rows, 3);
        let source_sessions: i64 = conn
            .query_row("SELECT COUNT(*) FROM cc_sessions", [], |row| row.get(0))
            .expect("session count");
        assert_eq!(source_sessions, 4);
    }
}
