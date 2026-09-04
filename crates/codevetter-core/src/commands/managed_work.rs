use crate::DbState;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use std::time::{Duration, Instant};
use tauri::State;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use uuid::Uuid;

const MAX_HOOK_ARGS: usize = 64;
const MAX_HOOK_ARG_CHARS: usize = 4_096;
const MAX_HOOK_OUTPUT_BYTES: usize = 128 * 1024;
const MIN_HOOK_TIMEOUT_MS: u64 = 1_000;
const MAX_HOOK_TIMEOUT_MS: u64 = 15 * 60 * 1_000;
const MAX_PORT_REQUESTS: usize = 16;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProfile {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub config_path: String,
    pub is_default: bool,
    pub executable_available: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedPortRequest {
    pub purpose: String,
    pub preferred_port: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateManagedRunInput {
    pub work_item_id: String,
    pub provider: String,
    pub profile_id: String,
    pub repo_path: String,
    #[serde(default)]
    pub ports: Vec<ManagedPortRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedPort {
    pub purpose: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedWorkRun {
    pub id: String,
    pub work_item_id: String,
    pub provider: String,
    pub profile_id: String,
    pub profile_path: String,
    pub repo_path: String,
    pub base_revision: String,
    pub worktree_path: Option<String>,
    pub worktree_branch: Option<String>,
    pub owner_token: String,
    pub ports: Vec<ManagedPort>,
    pub terminal_id: Option<String>,
    pub provider_session_id: Option<String>,
    pub process_id: Option<u32>,
    pub process_started_at: Option<String>,
    pub state: String,
    pub current_checkpoint_id: Option<String>,
    pub change_identity: Option<String>,
    pub disconnected_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachManagedProcessInput {
    pub run_id: String,
    pub terminal_id: String,
    pub provider_session_id: Option<String>,
    pub process_id: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedHookInput {
    pub run_id: String,
    pub kind: String,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedHookResult {
    pub checkpoint_id: String,
    pub kind: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub duration_ms: u64,
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub change_identity: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIntentClosureInput {
    pub work_item_id: String,
    pub managed_run_id: Option<String>,
    pub disposition: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentClosureReceipt {
    pub id: String,
    pub work_item_id: String,
    pub goal_version: i64,
    pub goal_text: String,
    pub acceptance_criteria: Vec<String>,
    pub provider: Option<String>,
    pub session_id: Option<String>,
    pub managed_run_id: Option<String>,
    pub change_identity: String,
    pub review_id: Option<String>,
    pub verification_run_id: Option<String>,
    pub disposition: String,
    pub reason: String,
    pub stale: bool,
    pub stale_reason: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn list_managed_provider_profiles() -> Result<Vec<ProviderProfile>, String> {
    discover_provider_profiles()
}

#[tauri::command]
pub fn create_managed_work_run(
    db: State<'_, DbState>,
    input: CreateManagedRunInput,
) -> Result<ManagedWorkRun, String> {
    let mut conn = db.0.lock().map_err(|error| error.to_string())?;
    create_managed_run(&mut conn, input)
}

#[tauri::command]
pub fn list_managed_work_runs(
    db: State<'_, DbState>,
    work_item_id: Option<String>,
) -> Result<Vec<ManagedWorkRun>, String> {
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    list_runs(&conn, work_item_id.as_deref())
}

#[tauri::command]
pub fn attach_managed_work_process(
    db: State<'_, DbState>,
    input: AttachManagedProcessInput,
) -> Result<ManagedWorkRun, String> {
    let run_id = bounded_text(&input.run_id, "run id", 512)?;
    let terminal_id = bounded_text(&input.terminal_id, "terminal id", 512)?;
    let start_identity = process_start_identity(input.process_id)
        .ok_or_else(|| "Managed provider process is not running".to_string())?;
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    let changed = conn
        .execute(
            "UPDATE managed_work_runs SET
                terminal_id = ?2,
                provider_session_id = ?3,
                process_id = ?4,
                process_started_at = ?5,
                state = 'running',
                disconnected_reason = NULL,
                updated_at = ?6
             WHERE id = ?1 AND state IN ('planned', 'starting', 'disconnected')",
            params![
                run_id,
                terminal_id,
                clean_optional(input.provider_session_id),
                input.process_id,
                start_identity,
                Utc::now().to_rfc3339(),
            ],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("Managed run is unavailable or already attached".to_string());
    }
    get_run(&conn, &run_id)?.ok_or_else(|| "Managed run not found".to_string())
}

#[tauri::command]
pub fn reconcile_managed_work_run(
    db: State<'_, DbState>,
    run_id: String,
) -> Result<ManagedWorkRun, String> {
    let run_id = bounded_text(&run_id, "run id", 512)?;
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    reconcile_run(&conn, &run_id)
}

#[tauri::command]
pub async fn run_managed_work_hook(
    db: State<'_, DbState>,
    input: ManagedHookInput,
) -> Result<ManagedHookResult, String> {
    let run_id = bounded_text(&input.run_id, "run id", 512)?;
    let (run, sequence) = {
        let conn = db.0.lock().map_err(|error| error.to_string())?;
        let run = get_run(&conn, &run_id)?.ok_or_else(|| "Managed run not found".to_string())?;
        let sequence: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sequence), 0) + 1
                 FROM managed_work_checkpoints WHERE run_id = ?1",
                [&run_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        (run, sequence)
    };
    let worktree = run
        .worktree_path
        .as_deref()
        .ok_or_else(|| "Managed run has no isolated worktree".to_string())?;
    validate_hook(&input.kind, &input.program, &input.args)?;
    let timeout_ms = input
        .timeout_ms
        .unwrap_or(5 * 60 * 1_000)
        .clamp(MIN_HOOK_TIMEOUT_MS, MAX_HOOK_TIMEOUT_MS);
    let checkpoint_id = format!("managed-checkpoint:{}", Uuid::new_v4());
    let started_at = Utc::now().to_rfc3339();
    {
        let conn = db.0.lock().map_err(|error| error.to_string())?;
        conn.execute(
            "INSERT INTO managed_work_checkpoints(
                id, run_id, sequence, kind, state, command_json, summary,
                evidence_json, created_at
             ) VALUES(?1, ?2, ?3, ?4, 'running', ?5, 'Hook is running', '{}', ?6)",
            params![
                checkpoint_id,
                run_id,
                sequence,
                input.kind,
                json!({ "program": input.program, "args": input.args }).to_string(),
                started_at,
            ],
        )
        .map_err(|error| error.to_string())?;
        conn.execute(
            "UPDATE managed_work_runs SET
                current_checkpoint_id = ?2,
                state = 'checking',
                updated_at = ?3
             WHERE id = ?1",
            params![run_id, checkpoint_id, Utc::now().to_rfc3339()],
        )
        .map_err(|error| error.to_string())?;
    }

    let environment = managed_environment(&run);
    let execution = execute_hook_program(
        Path::new(worktree),
        &input.program,
        &input.args,
        timeout_ms,
        &environment,
    )
    .await?;
    let change_identity = managed_change_identity(Path::new(worktree))?;
    let result = ManagedHookResult {
        checkpoint_id: checkpoint_id.clone(),
        kind: input.kind.clone(),
        success: execution.success,
        exit_code: execution.exit_code,
        timed_out: execution.timed_out,
        duration_ms: execution.duration_ms,
        stdout: execution.stdout,
        stderr: execution.stderr,
        stdout_truncated: execution.stdout_truncated,
        stderr_truncated: execution.stderr_truncated,
        change_identity: change_identity.clone(),
    };
    let evidence = serde_json::to_string(&result).map_err(|error| error.to_string())?;
    let summary = if result.success {
        format!("{} hook passed in {} ms", result.kind, result.duration_ms)
    } else if result.timed_out {
        format!(
            "{} hook timed out after {} ms",
            result.kind, result.duration_ms
        )
    } else {
        format!("{} hook failed with {:?}", result.kind, result.exit_code)
    };
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    conn.execute(
        "UPDATE managed_work_checkpoints SET
            state = ?2, change_identity = ?3, summary = ?4, evidence_json = ?5
         WHERE id = ?1",
        params![
            checkpoint_id,
            if result.success { "passed" } else { "failed" },
            change_identity,
            summary,
            evidence,
        ],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "UPDATE managed_work_runs SET
            state = ?2, change_identity = ?3, updated_at = ?4
         WHERE id = ?1",
        params![
            run_id,
            if result.success {
                "running"
            } else {
                "attention"
            },
            change_identity,
            Utc::now().to_rfc3339(),
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn get_managed_work_handoff(db: State<'_, DbState>, run_id: String) -> Result<Value, String> {
    let run_id = bounded_text(&run_id, "run id", 512)?;
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    managed_handoff(&conn, &run_id)
}

#[tauri::command]
pub fn archive_managed_work_run(
    db: State<'_, DbState>,
    run_id: String,
) -> Result<ManagedWorkRun, String> {
    let run_id = bounded_text(&run_id, "run id", 512)?;
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    archive_run(&conn, &run_id)
}

#[tauri::command]
pub fn create_intent_closure(
    db: State<'_, DbState>,
    input: CreateIntentClosureInput,
) -> Result<IntentClosureReceipt, String> {
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    create_closure(&conn, input)
}

#[tauri::command]
pub fn list_intent_closures(
    db: State<'_, DbState>,
    work_item_id: String,
) -> Result<Vec<IntentClosureReceipt>, String> {
    let work_item_id = bounded_text(&work_item_id, "work item id", 512)?;
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    list_closures(&conn, &work_item_id)
}

fn discover_provider_profiles() -> Result<Vec<ProviderProfile>, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Home directory is unavailable".to_string())?;
    let mut profiles = Vec::new();
    for (provider, prefix, executable) in [
        ("codex", ".codex", "codex"),
        ("claude", ".claude", "claude"),
    ] {
        let executable_available = executable_on_path(executable);
        let mut paths = BTreeSet::new();
        let default = home.join(prefix);
        if default.is_dir() {
            paths.insert(default);
        }
        if let Ok(entries) = std::fs::read_dir(&home) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with(&format!("{prefix}-")) && entry.path().is_dir() {
                    paths.insert(entry.path());
                }
            }
        }
        for path in paths {
            let canonical = path.canonicalize().unwrap_or(path);
            let is_default = canonical.file_name().is_some_and(|name| name == prefix);
            let label = if is_default {
                format!("{provider} default")
            } else {
                canonical
                    .file_name()
                    .map(|name| name.to_string_lossy().trim_start_matches('.').to_string())
                    .unwrap_or_else(|| format!("{provider} profile"))
            };
            let config_path = canonical.to_string_lossy().to_string();
            let id = format!(
                "{provider}:sha256:{:x}",
                Sha256::digest(config_path.as_bytes())
            );
            profiles.push(ProviderProfile {
                id,
                provider: provider.to_string(),
                label,
                config_path,
                is_default,
                executable_available,
            });
        }
    }
    profiles.sort_by(|left, right| {
        left.provider
            .cmp(&right.provider)
            .then_with(|| right.is_default.cmp(&left.is_default))
            .then_with(|| left.label.cmp(&right.label))
    });
    Ok(profiles)
}

fn create_managed_run(
    conn: &mut Connection,
    input: CreateManagedRunInput,
) -> Result<ManagedWorkRun, String> {
    let work_item_id = bounded_text(&input.work_item_id, "work item id", 512)?;
    let provider = normalize_provider(&input.provider)?;
    let repo_path = canonical_repo(&input.repo_path)?;
    let profiles = discover_provider_profiles()?;
    let profile = profiles
        .into_iter()
        .find(|profile| profile.id == input.profile_id && profile.provider == provider)
        .ok_or_else(|| "Selected provider profile is unavailable".to_string())?;
    if !profile.executable_available {
        return Err(format!("{provider} executable is unavailable"));
    }
    let item_path: Option<String> = conn
        .query_row(
            "SELECT project_path FROM agent_tasks WHERE id = ?1",
            [&work_item_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .flatten();
    let Some(item_path) = item_path else {
        return Err("Work item must have a repository before managed execution".to_string());
    };
    if canonical_repo(&item_path)? != repo_path {
        return Err("Managed repository does not match the work item".to_string());
    }
    let base_revision = git_output(&repo_path, &["rev-parse", "HEAD"])?;
    let run_id = format!("managed-run:{}", Uuid::new_v4());
    let owner_token = format!("managed-owner:{}", Uuid::new_v4());
    let branch = format!(
        "codevetter/managed-{}",
        run_id
            .rsplit(':')
            .next()
            .unwrap_or("run")
            .chars()
            .take(8)
            .collect::<String>()
    );
    let root = std::env::temp_dir().join("codevetter-managed-worktrees");
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("Create managed worktree root: {error}"))?;
    let worktree = root.join(
        run_id
            .rsplit(':')
            .next()
            .ok_or_else(|| "Managed run identity is invalid".to_string())?,
    );
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO managed_work_runs(
            id, work_item_id, provider, profile_id, profile_path, repo_path,
            base_revision, worktree_path, worktree_branch, owner_token,
            state, created_at, updated_at
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                  'starting', ?11, ?11)",
        params![
            run_id,
            work_item_id,
            provider,
            profile.id,
            profile.config_path,
            repo_path.to_string_lossy(),
            base_revision,
            worktree.to_string_lossy(),
            branch,
            owner_token,
            now,
        ],
    )
    .map_err(map_live_run_error)?;

    let worktree_result = create_worktree(&repo_path, &worktree, &branch, &base_revision);
    if let Err(error) = worktree_result {
        let _ = conn.execute(
            "UPDATE managed_work_runs SET
                state = 'failed', disconnected_reason = ?2, updated_at = ?3
             WHERE id = ?1",
            params![run_id, error, Utc::now().to_rfc3339()],
        );
        return Err(error);
    }
    let ports = reserve_ports(conn, &run_id, &input.ports)?;
    let ports_json = serde_json::to_string(&ports).map_err(|error| error.to_string())?;
    let environment_json = json!({
        "managed": true,
        "profileEnv": if provider == "codex" { "CODEX_HOME" } else { "CLAUDE_CONFIG_DIR" },
        "profilePath": profile.config_path,
        "ports": ports,
    })
    .to_string();
    let change_identity = managed_change_identity(&worktree)?;
    conn.execute(
        "UPDATE managed_work_runs SET
            environment_json = ?2,
            ports_json = ?3,
            state = 'planned',
            change_identity = ?4,
            updated_at = ?5
         WHERE id = ?1",
        params![
            run_id,
            environment_json,
            ports_json,
            change_identity,
            Utc::now().to_rfc3339()
        ],
    )
    .map_err(|error| error.to_string())?;
    get_run(conn, &run_id)?.ok_or_else(|| "Managed run not found after creation".to_string())
}

fn reserve_ports(
    conn: &mut Connection,
    run_id: &str,
    requests: &[ManagedPortRequest],
) -> Result<Vec<ManagedPort>, String> {
    if requests.len() > MAX_PORT_REQUESTS {
        return Err(format!("At most {MAX_PORT_REQUESTS} ports may be reserved"));
    }
    let transaction = conn.transaction().map_err(|error| error.to_string())?;
    let mut ports = Vec::new();
    let mut purposes = BTreeSet::new();
    for request in requests {
        let purpose = bounded_text(&request.purpose, "port purpose", 80)?;
        if !purposes.insert(purpose.clone()) {
            return Err(format!("Duplicate port purpose: {purpose}"));
        }
        let mut candidates = Vec::new();
        if let Some(preferred) = request.preferred_port.filter(|port| *port >= 1024) {
            candidates.push(preferred);
        }
        for _ in 0..8 {
            let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
                .map_err(|error| format!("Reserve loopback port: {error}"))?;
            candidates.push(
                listener
                    .local_addr()
                    .map_err(|error| error.to_string())?
                    .port(),
            );
        }
        let mut selected = None;
        for port in candidates {
            if std::net::TcpListener::bind(("127.0.0.1", port)).is_err() {
                continue;
            }
            match transaction.execute(
                "INSERT INTO managed_work_port_reservations(
                    run_id, port, purpose, reserved_at
                 ) VALUES(?1, ?2, ?3, ?4)",
                params![run_id, i64::from(port), purpose, Utc::now().to_rfc3339()],
            ) {
                Ok(_) => {
                    selected = Some(port);
                    break;
                }
                Err(error) if is_unique_constraint(&error) => continue,
                Err(error) => return Err(error.to_string()),
            }
        }
        let port = selected.ok_or_else(|| format!("No available port for {purpose}"))?;
        ports.push(ManagedPort { purpose, port });
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(ports)
}

fn list_runs(conn: &Connection, work_item_id: Option<&str>) -> Result<Vec<ManagedWorkRun>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id FROM managed_work_runs
             WHERE (?1 IS NULL OR work_item_id = ?1)
             ORDER BY updated_at DESC, id ASC
             LIMIT 250",
        )
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map([work_item_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    ids.iter()
        .filter_map(|id| get_run(conn, id).transpose())
        .collect()
}

fn get_run(conn: &Connection, id: &str) -> Result<Option<ManagedWorkRun>, String> {
    conn.query_row(
        "SELECT id, work_item_id, provider, profile_id, profile_path,
                repo_path, base_revision, worktree_path, worktree_branch,
                owner_token, ports_json, terminal_id, provider_session_id,
                process_id, process_started_at, state, current_checkpoint_id,
                change_identity, disconnected_reason, created_at, updated_at
         FROM managed_work_runs WHERE id = ?1",
        [id],
        |row| {
            let ports_json: String = row.get(10)?;
            Ok(ManagedWorkRun {
                id: row.get(0)?,
                work_item_id: row.get(1)?,
                provider: row.get(2)?,
                profile_id: row.get(3)?,
                profile_path: row.get(4)?,
                repo_path: row.get(5)?,
                base_revision: row.get(6)?,
                worktree_path: row.get(7)?,
                worktree_branch: row.get(8)?,
                owner_token: row.get(9)?,
                ports: serde_json::from_str(&ports_json).unwrap_or_default(),
                terminal_id: row.get(11)?,
                provider_session_id: row.get(12)?,
                process_id: row.get::<_, Option<i64>>(13)?.map(|value| value as u32),
                process_started_at: row.get(14)?,
                state: row.get(15)?,
                current_checkpoint_id: row.get(16)?,
                change_identity: row.get(17)?,
                disconnected_reason: row.get(18)?,
                created_at: row.get(19)?,
                updated_at: row.get(20)?,
            })
        },
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn reconcile_run(conn: &Connection, run_id: &str) -> Result<ManagedWorkRun, String> {
    let run = get_run(conn, run_id)?.ok_or_else(|| "Managed run not found".to_string())?;
    if matches!(run.state.as_str(), "archived" | "completed" | "failed") {
        return Ok(run);
    }
    let Some(worktree_path) = run.worktree_path.as_deref() else {
        return disconnect_run(conn, &run, "Managed worktree identity is missing");
    };
    let worktree = Path::new(worktree_path);
    if !worktree.is_dir() || managed_change_identity(worktree).is_err() {
        return disconnect_run(conn, &run, "Managed worktree is unavailable or invalid");
    }
    if let Some(pid) = run.process_id {
        let current_start = process_start_identity(pid);
        if current_start.as_deref() != run.process_started_at.as_deref() {
            return disconnect_run(conn, &run, "Managed provider process identity changed");
        }
    }
    let change_identity = managed_change_identity(worktree)?;
    conn.execute(
        "UPDATE managed_work_runs SET
            change_identity = ?2,
            disconnected_reason = NULL,
            updated_at = ?3
         WHERE id = ?1",
        params![run.id, change_identity, Utc::now().to_rfc3339()],
    )
    .map_err(|error| error.to_string())?;
    get_run(conn, run_id)?.ok_or_else(|| "Managed run not found".to_string())
}

fn disconnect_run(
    conn: &Connection,
    run: &ManagedWorkRun,
    reason: &str,
) -> Result<ManagedWorkRun, String> {
    conn.execute(
        "UPDATE managed_work_runs SET
            state = 'disconnected',
            disconnected_reason = ?2,
            updated_at = ?3
         WHERE id = ?1",
        params![run.id, reason, Utc::now().to_rfc3339()],
    )
    .map_err(|error| error.to_string())?;
    get_run(conn, &run.id)?.ok_or_else(|| "Managed run not found".to_string())
}

fn managed_handoff(conn: &Connection, run_id: &str) -> Result<Value, String> {
    let run = reconcile_run(conn, run_id)?;
    let worktree_path = run
        .worktree_path
        .as_deref()
        .ok_or_else(|| "Managed worktree is unavailable".to_string())?;
    let worktree = Path::new(worktree_path);
    let status = git_output(worktree, &["status", "--short"])?;
    let diff_stat = git_output(worktree, &["diff", "--stat"])?;
    let diff_check = git_status_output(worktree, &["diff", "--check"])?;
    let change_identity = managed_change_identity(worktree)?;
    let checkpoint: Option<(String, String, String)> = conn
        .query_row(
            "SELECT kind, state, summary
             FROM managed_work_checkpoints
             WHERE run_id = ?1 ORDER BY sequence DESC LIMIT 1",
            [run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "run": run,
        "changeIdentity": change_identity,
        "clean": status.trim().is_empty(),
        "status": bounded_output(status),
        "diffStat": bounded_output(diff_stat),
        "diffCheck": {
            "success": diff_check.0,
            "output": bounded_output(diff_check.1),
        },
        "latestCheckpoint": checkpoint.map(|(kind, state, summary)| json!({
            "kind": kind,
            "state": state,
            "summary": summary,
        })),
        "actions": [
            {"id": "review", "label": "Open Review", "automatic": false},
            {"id": "verify", "label": "Open Testing", "automatic": false},
            {"id": "prepare-pr", "label": "Prepare PR handoff", "automatic": false},
            {"id": "archive", "label": "Archive clean worktree", "automatic": false}
        ],
        "publishBoundary": "Commit, push, and PR creation require separate explicit actions."
    }))
}

fn archive_run(conn: &Connection, run_id: &str) -> Result<ManagedWorkRun, String> {
    let run = get_run(conn, run_id)?.ok_or_else(|| "Managed run not found".to_string())?;
    if let Some(pid) = run.process_id {
        if process_start_identity(pid).as_deref() == run.process_started_at.as_deref() {
            return Err("Stop the owned provider process before archiving".to_string());
        }
    }
    let worktree_path = run
        .worktree_path
        .as_deref()
        .ok_or_else(|| "Managed worktree is unavailable".to_string())?;
    let worktree = Path::new(worktree_path);
    let status = git_output(worktree, &["status", "--porcelain"])?;
    if !status.trim().is_empty() {
        return Err(
            "Managed worktree has uncommitted changes; review the handoff before cleanup"
                .to_string(),
        );
    }
    let output = StdCommand::new("git")
        .args(["worktree", "remove"])
        .arg(worktree)
        .current_dir(&run.repo_path)
        .output()
        .map_err(|error| format!("Remove managed worktree: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Remove managed worktree: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    conn.execute(
        "UPDATE managed_work_runs SET
            state = 'archived',
            process_id = NULL,
            terminal_id = NULL,
            updated_at = ?2
         WHERE id = ?1",
        params![run_id, Utc::now().to_rfc3339()],
    )
    .map_err(|error| error.to_string())?;
    get_run(conn, run_id)?.ok_or_else(|| "Managed run not found".to_string())
}

fn create_closure(
    conn: &Connection,
    input: CreateIntentClosureInput,
) -> Result<IntentClosureReceipt, String> {
    type WorkItemClosureRow = (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    );

    let work_item_id = bounded_text(&input.work_item_id, "work item id", 512)?;
    let disposition = normalize_disposition(&input.disposition)?;
    let reason = bounded_text(&input.reason, "closure reason", 2_000)?;
    let item: Option<WorkItemClosureRow> = conn
        .query_row(
            "SELECT title, description, acceptance_criteria, change_identity,
                    review_id, verification_run_id
             FROM agent_tasks WHERE id = ?1",
            [&work_item_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((title, description, criteria, item_change, review_id, verification_run_id)) = item
    else {
        return Err("Work item not found".to_string());
    };
    let managed_run = input
        .managed_run_id
        .as_deref()
        .map(|run_id| get_run(conn, run_id))
        .transpose()?
        .flatten();
    let change_identity = managed_run
        .as_ref()
        .and_then(|run| run.change_identity.clone())
        .or(item_change)
        .ok_or_else(|| "Intent closure requires an exact change identity".to_string())?;
    let goal_text = description
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(title);
    let acceptance_criteria = split_acceptance_criteria(criteria.as_deref());
    let goal_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(goal_version), 0) + 1
             FROM intent_closure_receipts WHERE work_item_id = ?1",
            [&work_item_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let id = format!("intent-closure:{}", Uuid::new_v4());
    let created_at = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO intent_closure_receipts(
            id, work_item_id, goal_version, goal_text, acceptance_criteria_json,
            provider, session_id, managed_run_id, change_identity, review_id,
            verification_run_id, disposition, reason, created_at
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            id,
            work_item_id,
            goal_version,
            goal_text,
            serde_json::to_string(&acceptance_criteria).map_err(|error| error.to_string())?,
            managed_run.as_ref().map(|run| run.provider.as_str()),
            managed_run
                .as_ref()
                .and_then(|run| run.provider_session_id.as_deref()),
            managed_run.as_ref().map(|run| run.id.as_str()),
            change_identity,
            review_id,
            verification_run_id,
            disposition,
            reason,
            created_at,
        ],
    )
    .map_err(|error| error.to_string())?;
    list_closures(conn, &work_item_id)?
        .into_iter()
        .find(|receipt| receipt.id == id)
        .ok_or_else(|| "Intent closure was not persisted".to_string())
}

fn list_closures(
    conn: &Connection,
    work_item_id: &str,
) -> Result<Vec<IntentClosureReceipt>, String> {
    let current_change: Option<String> = conn
        .query_row(
            "SELECT change_identity FROM agent_tasks WHERE id = ?1",
            [work_item_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .flatten();
    let mut statement = conn
        .prepare(
            "SELECT id, work_item_id, goal_version, goal_text,
                    acceptance_criteria_json, provider, session_id,
                    managed_run_id, change_identity, review_id,
                    verification_run_id, disposition, reason,
                    stale_reason, created_at
             FROM intent_closure_receipts
             WHERE work_item_id = ?1
             ORDER BY created_at DESC, id ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([work_item_id], |row| {
            let criteria_json: String = row.get(4)?;
            let change_identity: String = row.get(8)?;
            let stored_reason: Option<String> = row.get(13)?;
            let computed_stale = current_change
                .as_deref()
                .is_some_and(|current| current != change_identity);
            Ok(IntentClosureReceipt {
                id: row.get(0)?,
                work_item_id: row.get(1)?,
                goal_version: row.get(2)?,
                goal_text: row.get(3)?,
                acceptance_criteria: serde_json::from_str(&criteria_json).unwrap_or_default(),
                provider: row.get(5)?,
                session_id: row.get(6)?,
                managed_run_id: row.get(7)?,
                change_identity,
                review_id: row.get(9)?,
                verification_run_id: row.get(10)?,
                disposition: row.get(11)?,
                reason: row.get(12)?,
                stale: computed_stale || stored_reason.is_some(),
                stale_reason: stored_reason.or_else(|| {
                    computed_stale.then(|| "Work item change identity advanced".to_string())
                }),
                created_at: row.get(14)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}

fn create_worktree(
    repo_path: &Path,
    worktree: &Path,
    branch: &str,
    base_revision: &str,
) -> Result<(), String> {
    let output = StdCommand::new("git")
        .args(["worktree", "add", "-b", branch])
        .arg(worktree)
        .arg(base_revision)
        .current_dir(repo_path)
        .output()
        .map_err(|error| format!("Create managed worktree: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Create managed worktree: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

fn validate_hook(kind: &str, program: &str, args: &[String]) -> Result<(), String> {
    if !matches!(kind, "setup" | "run" | "check" | "archive") {
        return Err("Hook kind must be setup, run, check, or archive".to_string());
    }
    let program = bounded_text(program, "hook program", 512)?;
    if args.len() > MAX_HOOK_ARGS
        || args
            .iter()
            .any(|arg| arg.chars().count() > MAX_HOOK_ARG_CHARS)
    {
        return Err("Managed hook arguments exceed the supported bounds".to_string());
    }
    let executable = Path::new(&program)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&program)
        .to_ascii_lowercase();
    if matches!(
        executable.as_str(),
        "rm" | "sudo" | "bash" | "sh" | "zsh" | "fish" | "powershell" | "cmd"
    ) {
        return Err("Shells and destructive executables are not allowed managed hooks".to_string());
    }
    let first = args.first().map(|arg| arg.to_ascii_lowercase());
    if executable == "git"
        && first.as_deref().is_some_and(|arg| {
            matches!(
                arg,
                "push" | "commit" | "clean" | "reset" | "worktree" | "branch"
            )
        })
    {
        return Err("Commit, push, reset, branch, and cleanup are explicit actions".to_string());
    }
    if executable == "gh"
        && args
            .windows(2)
            .any(|pair| pair[0].eq_ignore_ascii_case("pr") && pair[1] == "create")
    {
        return Err("PR creation is an explicit action outside managed hooks".to_string());
    }
    Ok(())
}

struct HookExecution {
    success: bool,
    exit_code: Option<i32>,
    timed_out: bool,
    duration_ms: u64,
    stdout: String,
    stderr: String,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

async fn execute_hook_program(
    cwd: &Path,
    program: &str,
    args: &[String],
    timeout_ms: u64,
    environment: &BTreeMap<String, String>,
) -> Result<HookExecution, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .envs(allowed_environment())
        .envs(environment)
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
    let started = Instant::now();
    let mut child = command
        .spawn()
        .map_err(|error| format!("Start managed hook `{program}`: {error}"))?;
    let pid = child.id();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Managed hook stdout is unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Managed hook stderr is unavailable".to_string())?;
    let stdout_task = tokio::spawn(read_bounded_output(stdout));
    let stderr_task = tokio::spawn(read_bounded_output(stderr));
    let (status, timed_out) =
        match tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait()).await {
            Ok(status) => (
                status.map_err(|error| format!("Wait for managed hook: {error}"))?,
                false,
            ),
            Err(_) => {
                #[cfg(unix)]
                if let Some(pid) = pid {
                    unsafe {
                        libc::kill(-(pid as i32), libc::SIGKILL);
                    }
                }
                let _ = child.kill().await;
                let status = child
                    .wait()
                    .await
                    .map_err(|error| format!("Stop timed-out managed hook: {error}"))?;
                (status, true)
            }
        };
    let (stdout, stdout_truncated) = stdout_task.await.map_err(|error| error.to_string())??;
    let (stderr, stderr_truncated) = stderr_task.await.map_err(|error| error.to_string())??;
    Ok(HookExecution {
        success: status.success() && !timed_out,
        exit_code: status.code(),
        timed_out,
        duration_ms: started.elapsed().as_millis() as u64,
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
    })
}

async fn read_bounded_output<R>(reader: R) -> Result<(String, bool), String>
where
    R: AsyncRead + Unpin,
{
    let mut bytes = Vec::new();
    reader
        .take((MAX_HOOK_OUTPUT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| error.to_string())?;
    let truncated = bytes.len() > MAX_HOOK_OUTPUT_BYTES;
    if truncated {
        bytes.truncate(MAX_HOOK_OUTPUT_BYTES);
    }
    Ok((String::from_utf8_lossy(&bytes).to_string(), truncated))
}

fn managed_environment(run: &ManagedWorkRun) -> BTreeMap<String, String> {
    let mut environment = BTreeMap::new();
    environment.insert("CODEVETTER_MANAGED_RUN_ID".to_string(), run.id.clone());
    environment.insert(
        if run.provider == "codex" {
            "CODEX_HOME".to_string()
        } else {
            "CLAUDE_CONFIG_DIR".to_string()
        },
        run.profile_path.clone(),
    );
    for port in &run.ports {
        let key = format!(
            "CODEVETTER_PORT_{}",
            port.purpose
                .chars()
                .map(|character| {
                    if character.is_ascii_alphanumeric() {
                        character.to_ascii_uppercase()
                    } else {
                        '_'
                    }
                })
                .collect::<String>()
        );
        environment.insert(key, port.port.to_string());
    }
    environment
}

fn allowed_environment() -> BTreeMap<String, String> {
    ["PATH", "TMPDIR", "LANG", "LC_ALL", "TERM"]
        .into_iter()
        .filter_map(|key| {
            std::env::var(key)
                .ok()
                .map(|value| (key.to_string(), value))
        })
        .collect()
}

fn managed_change_identity(worktree: &Path) -> Result<String, String> {
    let head = git_output(worktree, &["rev-parse", "HEAD"])?;
    let status = git_output(worktree, &["status", "--porcelain=v1", "-uall"])?;
    let diff = git_output(worktree, &["diff", "--binary", "HEAD"])?;
    let payload = format!("{head}\0{status}\0{diff}");
    Ok(format!("sha256:{:x}", Sha256::digest(payload.as_bytes())))
}

fn process_start_identity(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    let output = StdCommand::new("ps")
        .args(["-o", "lstart=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn canonical_repo(value: &str) -> Result<PathBuf, String> {
    let value = bounded_text(value, "repository path", 4_096)?;
    let path = PathBuf::from(value)
        .canonicalize()
        .map_err(|error| format!("Resolve repository: {error}"))?;
    if !path.is_dir()
        || !path.join(".git").exists() && git_output(&path, &["rev-parse", "--git-dir"]).is_err()
    {
        return Err("Managed repository must be a Git worktree".to_string());
    }
    Ok(path)
}

fn git_output(repo: &Path, args: &[&str]) -> Result<String, String> {
    let output = StdCommand::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|error| format!("Run git {}: {error}", args.join(" ")))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_status_output(repo: &Path, args: &[&str]) -> Result<(bool, String), String> {
    let output = StdCommand::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|error| format!("Run git {}: {error}", args.join(" ")))?;
    Ok((
        output.status.success(),
        if output.stdout.is_empty() {
            String::from_utf8_lossy(&output.stderr).trim().to_string()
        } else {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        },
    ))
}

fn bounded_output(value: String) -> String {
    let mut chars = value.chars();
    let bounded = chars.by_ref().take(32_000).collect::<String>();
    if chars.next().is_some() {
        format!("{bounded}\n… output truncated")
    } else {
        bounded
    }
}

fn executable_on_path(program: &str) -> bool {
    StdCommand::new(program)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn bounded_text(value: &str, field: &str, max_chars: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max_chars {
        return Err(format!("A valid {field} is required"));
    }
    Ok(value.to_string())
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_provider(value: &str) -> Result<String, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "codex" => Ok("codex".to_string()),
        "claude" | "claude-code" => Ok("claude".to_string()),
        _ => Err("Provider must be codex or claude".to_string()),
    }
}

fn normalize_disposition(value: &str) -> Result<String, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "satisfied" | "partially_satisfied" | "not_satisfied" | "waived" => {
            Ok(value.trim().to_ascii_lowercase())
        }
        _ => Err(
            "Disposition must be satisfied, partially_satisfied, not_satisfied, or waived"
                .to_string(),
        ),
    }
}

fn split_acceptance_criteria(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or_default()
        .lines()
        .map(|line| {
            line.trim()
                .trim_start_matches(['-', '*'])
                .trim()
                .to_string()
        })
        .filter(|line| !line.is_empty())
        .take(50)
        .collect()
}

fn map_live_run_error(error: rusqlite::Error) -> String {
    if is_unique_constraint(&error) {
        "This work item already has a live managed run".to_string()
    } else {
        error.to_string()
    }
}

fn is_unique_constraint(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use tempfile::TempDir;

    fn git_repo() -> TempDir {
        let repo = tempfile::tempdir().expect("repo");
        for args in [
            vec!["init"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test"],
        ] {
            let status = StdCommand::new("git")
                .args(args)
                .current_dir(repo.path())
                .status()
                .expect("git");
            assert!(status.success());
        }
        std::fs::write(repo.path().join("README.md"), "fixture\n").expect("write");
        for args in [vec!["add", "README.md"], vec!["commit", "-m", "fixture"]] {
            let status = StdCommand::new("git")
                .args(args)
                .current_dir(repo.path())
                .status()
                .expect("git");
            assert!(status.success());
        }
        repo
    }

    fn database(repo: &Path) -> Connection {
        let conn = Connection::open_in_memory().expect("database");
        schema::run_migrations(&conn).expect("schema");
        conn.execute(
            "INSERT INTO agent_tasks(
                id, title, project_path, status, preferred_provider,
                created_at, updated_at
             ) VALUES('task', 'Task', ?1, 'build', 'codex',
                      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [repo.to_string_lossy().to_string()],
        )
        .expect("task");
        conn
    }

    fn insert_run(conn: &Connection, repo: &Path, id: &str, state: &str) {
        conn.execute(
            "INSERT INTO managed_work_runs(
                id, work_item_id, provider, profile_id, profile_path, repo_path,
                base_revision, worktree_path, owner_token, state, created_at, updated_at
             ) VALUES(?1, 'task', 'codex', 'profile', '/tmp/profile', ?2,
                      ?3, ?2, ?4, ?5,
                      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![
                id,
                repo.to_string_lossy(),
                "a".repeat(40),
                format!("owner:{id}"),
                state,
            ],
        )
        .expect("run");
    }

    #[test]
    fn duplicate_live_run_is_rejected_by_schema() {
        let repo = git_repo();
        let conn = database(repo.path());
        insert_run(&conn, repo.path(), "run:one", "running");
        let error = conn
            .execute(
                "INSERT INTO managed_work_runs(
                    id, work_item_id, provider, profile_id, profile_path,
                    repo_path, base_revision, owner_token, state,
                    created_at, updated_at
                 ) VALUES('run:two', 'task', 'codex', 'profile', '/tmp/profile',
                          ?1, ?2, 'owner:two', 'planned',
                          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
                params![repo.path().to_string_lossy(), "a".repeat(40)],
            )
            .expect_err("duplicate");
        assert!(is_unique_constraint(&error));
    }

    #[test]
    fn port_collision_selects_a_distinct_port() {
        let repo = git_repo();
        let mut conn = database(repo.path());
        insert_run(&conn, repo.path(), "run:one", "running");
        insert_run(&conn, repo.path(), "run:two", "disconnected");
        let first = reserve_ports(
            &mut conn,
            "run:one",
            &[ManagedPortRequest {
                purpose: "web".to_string(),
                preferred_port: Some(45_123),
            }],
        )
        .expect("first");
        let second = reserve_ports(
            &mut conn,
            "run:two",
            &[ManagedPortRequest {
                purpose: "web".to_string(),
                preferred_port: Some(45_123),
            }],
        )
        .expect("second");
        assert_ne!(first[0].port, second[0].port);
    }

    #[test]
    fn publish_commands_are_not_valid_hooks() {
        assert!(validate_hook("check", "git", &["push".to_string()]).is_err());
        assert!(validate_hook("check", "gh", &["pr".to_string(), "create".to_string()]).is_err());
        assert!(validate_hook("check", "pnpm", &["test".to_string()]).is_ok());
    }

    #[tokio::test]
    async fn hooks_are_bounded_and_time_out() {
        let repo = git_repo();
        let success = execute_hook_program(
            repo.path(),
            "/usr/bin/printf",
            &["ok".to_string()],
            1_000,
            &BTreeMap::new(),
        )
        .await
        .expect("hook");
        assert!(success.success);
        assert_eq!(success.stdout, "ok");

        let timed_out = execute_hook_program(
            repo.path(),
            "/bin/sleep",
            &["2".to_string()],
            1_000,
            &BTreeMap::new(),
        )
        .await
        .expect("timeout");
        assert!(timed_out.timed_out);
        assert!(!timed_out.success);
    }

    #[test]
    fn dirty_worktree_handoff_is_not_clean() {
        let repo = git_repo();
        let conn = database(repo.path());
        insert_run(&conn, repo.path(), "run:one", "disconnected");
        std::fs::write(repo.path().join("README.md"), "changed\n").expect("change");
        let handoff = managed_handoff(&conn, "run:one").expect("handoff");
        assert_eq!(handoff["clean"], false);
        assert!(handoff["publishBoundary"]
            .as_str()
            .is_some_and(|value| value.contains("explicit")));
    }

    #[test]
    fn intent_closure_is_human_recorded_and_becomes_stale() {
        let repo = git_repo();
        let conn = database(repo.path());
        conn.execute(
            "UPDATE agent_tasks SET
                description = 'Ship bounded work',
                acceptance_criteria = '- Tests pass\n- Evidence current',
                change_identity = 'change:one'
             WHERE id = 'task'",
            [],
        )
        .expect("task update");
        let receipt = create_closure(
            &conn,
            CreateIntentClosureInput {
                work_item_id: "task".to_string(),
                managed_run_id: None,
                disposition: "satisfied".to_string(),
                reason: "Reviewed against current evidence".to_string(),
            },
        )
        .expect("closure");
        assert!(!receipt.stale);
        assert_eq!(receipt.acceptance_criteria.len(), 2);
        conn.execute(
            "UPDATE agent_tasks SET change_identity = 'change:two' WHERE id = 'task'",
            [],
        )
        .expect("advance");
        let receipts = list_closures(&conn, "task").expect("closures");
        assert!(receipts[0].stale);
    }
}
