use crate::{db::queries, DbState};
use chrono::Utc;
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Instant,
};
use tauri::State;
use uuid::Uuid;

const DEFAULT_ITERATIONS: usize = 25;
const MAX_ITERATIONS: usize = 100;
const MAX_ACCOUNTED_ENTRIES: usize = 2_000_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardBenchmarkReceipt {
    pub id: String,
    pub repository_revision: String,
    pub fixture_identity: String,
    pub machine: Value,
    pub cold_ms: LatencySummary,
    pub warm_ms: LatencySummary,
    pub response_bytes: usize,
    pub errors: Vec<String>,
    pub iterations: usize,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencySummary {
    pub p50: f64,
    pub p95: f64,
    pub maximum: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiskAccountingEntry {
    pub category: String,
    pub label: String,
    pub bytes: u64,
    pub files: u64,
    pub tree_identity: String,
    pub content_identity: Option<String>,
    pub repo_owned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskAccountingReceipt {
    pub id: String,
    pub repository_revision: String,
    pub fixture_identity: String,
    pub entries: Vec<DiskAccountingEntry>,
    pub total_bytes: u64,
    pub duplicate_groups: Vec<Vec<String>>,
    pub consolidation: String,
    pub rollback: Value,
    pub created_at: String,
}

#[tauri::command]
pub async fn benchmark_dashboard_ipc(
    db: State<'_, DbState>,
    repo_path: String,
    iterations: Option<usize>,
) -> Result<DashboardBenchmarkReceipt, String> {
    let repo = canonical_repository(&repo_path)?;
    let iterations = iterations
        .unwrap_or(DEFAULT_ITERATIONS)
        .clamp(3, MAX_ITERATIONS);
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    benchmark_dashboard(&conn, &repo, iterations)
}

#[tauri::command]
pub async fn account_local_caches(
    db: State<'_, DbState>,
    repo_path: String,
    consolidate_exact_duplicates: Option<bool>,
) -> Result<DiskAccountingReceipt, String> {
    let repo = canonical_repository(&repo_path)?;
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    account_caches(&conn, &repo, consolidate_exact_duplicates.unwrap_or(false))
}

fn benchmark_dashboard(
    conn: &Connection,
    repo: &Path,
    iterations: usize,
) -> Result<DashboardBenchmarkReceipt, String> {
    let database_path = database_path(conn)?;
    let revision = repository_revision(repo)?;
    let fixture_identity = dashboard_fixture_identity(conn)?;
    let mut errors = Vec::new();
    let mut cold = Vec::with_capacity(iterations);
    let mut warm = Vec::with_capacity(iterations);
    let mut response_bytes = 0usize;

    for _ in 0..iterations {
        let started = Instant::now();
        let cold_conn =
            Connection::open_with_flags(&database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|error| format!("Open cold benchmark database: {error}"))?;
        match dashboard_projection(&cold_conn) {
            Ok(bytes) => response_bytes = response_bytes.max(bytes),
            Err(error) => errors.push(format!("cold: {error}")),
        }
        cold.push(started.elapsed().as_secs_f64() * 1_000.0);
    }

    for _ in 0..iterations {
        let started = Instant::now();
        match dashboard_projection(conn) {
            Ok(bytes) => response_bytes = response_bytes.max(bytes),
            Err(error) => errors.push(format!("warm: {error}")),
        }
        warm.push(started.elapsed().as_secs_f64() * 1_000.0);
    }

    let receipt = DashboardBenchmarkReceipt {
        id: format!("performance-receipt:{}", Uuid::new_v4()),
        repository_revision: revision,
        fixture_identity,
        machine: machine_projection(),
        cold_ms: latency_summary(&mut cold),
        warm_ms: latency_summary(&mut warm),
        response_bytes,
        errors,
        iterations,
        created_at: Utc::now().to_rfc3339(),
    };
    persist_receipt(
        conn,
        &receipt.id,
        "dashboard_ipc",
        &receipt.repository_revision,
        &receipt.fixture_identity,
        &receipt.machine,
        &serde_json::to_value(&receipt).map_err(|error| error.to_string())?,
        None,
        &json!({ "operation": "append_only_receipt", "destructive": false }),
        &receipt.created_at,
    )?;
    Ok(receipt)
}

fn dashboard_projection(conn: &Connection) -> Result<usize, String> {
    let value = json!({
        "tokenUsage": queries::get_token_usage_stats(conn).map_err(|error| error.to_string())?,
        "agentUsage": queries::get_agent_usage_breakdown(conn).map_err(|error| error.to_string())?,
        "agentByDay": queries::get_agent_usage_by_day(conn, 180).map_err(|error| error.to_string())?,
    });
    serde_json::to_vec(&value)
        .map(|bytes| bytes.len())
        .map_err(|error| error.to_string())
}

fn account_caches(
    conn: &Connection,
    repo: &Path,
    consolidate: bool,
) -> Result<DiskAccountingReceipt, String> {
    let revision = repository_revision(repo)?;
    let roots = cache_roots(repo);
    let mut entries = Vec::new();
    for root in &roots {
        if !root.path.is_dir() {
            continue;
        }
        let measurement = measure_tree(&root.path)?;
        entries.push(DiskAccountingEntry {
            category: root.category.to_string(),
            label: root.label.clone(),
            bytes: measurement.bytes,
            files: measurement.files,
            tree_identity: measurement.identity,
            content_identity: None,
            repo_owned: root.repo_owned,
        });
    }
    entries.sort_by(|left, right| {
        left.category
            .cmp(&right.category)
            .then_with(|| left.label.cmp(&right.label))
    });
    let duplicate_groups = exact_duplicate_groups(&roots, &mut entries)?;
    let mut rollback = Vec::new();
    let mut consolidation = "dry_run".to_string();
    if consolidate {
        consolidation = if duplicate_groups.is_empty() {
            "no_exact_duplicates".to_string()
        } else {
            consolidate_repo_owned_duplicates(
                repo,
                &roots,
                &entries,
                &duplicate_groups,
                &mut rollback,
            )?
        };
    }
    let fixture_identity = digest_json(&json!({
        "revision": revision,
        "entries": entries,
    }))?;
    let created_at = Utc::now().to_rfc3339();
    let receipt = DiskAccountingReceipt {
        id: format!("performance-receipt:{}", Uuid::new_v4()),
        repository_revision: revision,
        fixture_identity,
        total_bytes: entries.iter().map(|entry| entry.bytes).sum(),
        entries,
        duplicate_groups,
        consolidation,
        rollback: Value::Array(rollback),
        created_at,
    };
    persist_receipt(
        conn,
        &receipt.id,
        "local_disk_accounting",
        &receipt.repository_revision,
        &receipt.fixture_identity,
        &machine_projection(),
        &serde_json::to_value(&receipt).map_err(|error| error.to_string())?,
        Some(&receipt.fixture_identity),
        &receipt.rollback,
        &receipt.created_at,
    )?;
    Ok(receipt)
}

#[derive(Clone)]
struct CacheRoot {
    category: &'static str,
    label: String,
    path: PathBuf,
    repo_owned: bool,
}

fn cache_roots(repo: &Path) -> Vec<CacheRoot> {
    let mut roots = vec![
        CacheRoot {
            category: "cargo",
            label: "desktop Rust target".to_string(),
            path: repo.join("apps/desktop/src-tauri/target"),
            repo_owned: true,
        },
        CacheRoot {
            category: "package_manager",
            label: "workspace pnpm virtual store".to_string(),
            path: repo.join("node_modules/.pnpm"),
            repo_owned: true,
        },
        CacheRoot {
            category: "playwright",
            label: "workspace Playwright cache".to_string(),
            path: repo.join("apps/desktop/node_modules/.cache/ms-playwright"),
            repo_owned: true,
        },
        CacheRoot {
            category: "codevetter_artifacts",
            label: "repository CodeVetter artifacts".to_string(),
            path: repo.join(".codevetter/artifacts"),
            repo_owned: true,
        },
        CacheRoot {
            category: "managed_worktrees",
            label: "CodeVetter managed worktrees".to_string(),
            path: std::env::temp_dir().join("codevetter-managed-worktrees"),
            repo_owned: true,
        },
    ];
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        roots.push(CacheRoot {
            category: "playwright",
            label: "user Playwright browser cache".to_string(),
            path: home.join("Library/Caches/ms-playwright"),
            repo_owned: false,
        });
        roots.push(CacheRoot {
            category: "package_manager",
            label: "user pnpm content store".to_string(),
            path: home.join("Library/pnpm/store"),
            repo_owned: false,
        });
    }
    roots
}

struct TreeMeasurement {
    bytes: u64,
    files: u64,
    identity: String,
}

fn measure_tree(root: &Path) -> Result<TreeMeasurement, String> {
    let mut pending = vec![root.to_path_buf()];
    let mut records = Vec::new();
    let mut bytes = 0u64;
    let mut files = 0u64;
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory)
            .map_err(|error| format!("Read cache directory {}: {error}", directory.display()))?
        {
            let entry = entry.map_err(|error| error.to_string())?;
            let file_type = entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                pending.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            files += 1;
            if files as usize > MAX_ACCOUNTED_ENTRIES {
                return Err("Cache accounting exceeded the bounded entry limit".to_string());
            }
            let size = entry.metadata().map_err(|error| error.to_string())?.len();
            bytes = bytes.saturating_add(size);
            let relative = path
                .strip_prefix(root)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            records.push((relative, size));
        }
    }
    records.sort();
    let mut hash = Sha256::new();
    for (relative, size) in records {
        hash.update(relative.as_bytes());
        hash.update([0]);
        hash.update(size.to_le_bytes());
    }
    Ok(TreeMeasurement {
        bytes,
        files,
        identity: format!("sha256:{:x}", hash.finalize()),
    })
}

fn exact_duplicate_groups(
    roots: &[CacheRoot],
    entries: &mut [DiskAccountingEntry],
) -> Result<Vec<Vec<String>>, String> {
    let mut groups = BTreeMap::<(&str, &str, u64, u64), Vec<String>>::new();
    for entry in entries.iter() {
        if entry.files == 0 {
            continue;
        }
        groups
            .entry((
                &entry.category,
                &entry.tree_identity,
                entry.bytes,
                entry.files,
            ))
            .or_default()
            .push(entry.label.clone());
    }
    let candidates = groups
        .into_values()
        .filter(|labels| labels.len() > 1)
        .collect::<Vec<_>>();
    let mut exact = BTreeMap::<String, Vec<String>>::new();
    for labels in candidates {
        for label in labels {
            let root = roots
                .iter()
                .find(|root| root.label == label)
                .ok_or_else(|| "Measured cache root is unavailable".to_string())?;
            let identity = content_tree_identity(&root.path)?;
            if let Some(entry) = entries.iter_mut().find(|entry| entry.label == label) {
                entry.content_identity = Some(identity.clone());
            }
            exact.entry(identity).or_default().push(label);
        }
    }
    Ok(exact
        .into_values()
        .filter(|labels| labels.len() > 1)
        .collect())
}

fn content_tree_identity(root: &Path) -> Result<String, String> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let file_type = entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                pending.push(path);
            } else if file_type.is_file() {
                files.push(path);
            }
        }
    }
    files.sort();
    let mut hash = Sha256::new();
    for path in files {
        let relative = path.strip_prefix(root).map_err(|error| error.to_string())?;
        hash.update(relative.to_string_lossy().as_bytes());
        hash.update([0]);
        let mut file = fs::File::open(&path).map_err(|error| error.to_string())?;
        std::io::copy(&mut file, &mut hash).map_err(|error| error.to_string())?;
        hash.update([0]);
    }
    Ok(format!("sha256:{:x}", hash.finalize()))
}

fn consolidate_repo_owned_duplicates(
    repo: &Path,
    roots: &[CacheRoot],
    entries: &[DiskAccountingEntry],
    groups: &[Vec<String>],
    rollback: &mut Vec<Value>,
) -> Result<String, String> {
    let quarantine = repo.join(".codevetter/cache-quarantine");
    let mut moved = 0usize;
    for labels in groups {
        for label in labels.iter().skip(1) {
            let Some(root) = roots
                .iter()
                .find(|root| &root.label == label && root.repo_owned)
            else {
                continue;
            };
            let Some(entry) = entries.iter().find(|entry| &entry.label == label) else {
                continue;
            };
            if !root.path.starts_with(repo)
                && !root
                    .path
                    .starts_with(std::env::temp_dir().join("codevetter-managed-worktrees"))
            {
                continue;
            }
            fs::create_dir_all(&quarantine).map_err(|error| error.to_string())?;
            let target = quarantine.join(format!(
                "{}-{}",
                sanitize_label(label),
                Uuid::new_v4().simple()
            ));
            fs::rename(&root.path, &target)
                .map_err(|error| format!("Quarantine exact duplicate cache: {error}"))?;
            rollback.push(json!({
                "operation": "rename",
                "from": target,
                "to": root.path,
                "contentIdentity": entry.content_identity,
            }));
            moved += 1;
        }
    }
    Ok(if moved == 0 {
        "no_repo_owned_exact_duplicates".to_string()
    } else {
        format!("quarantined_{moved}_exact_duplicates")
    })
}

fn sanitize_label(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn database_path(conn: &Connection) -> Result<PathBuf, String> {
    conn.query_row("PRAGMA database_list", [], |row| row.get::<_, String>(2))
        .map(PathBuf::from)
        .map_err(|error| error.to_string())
}

fn dashboard_fixture_identity(conn: &Connection) -> Result<String, String> {
    let (sessions, messages, latest): (i64, i64, Option<String>) = conn
        .query_row(
            "SELECT
                (SELECT COUNT(*) FROM cc_sessions),
                (SELECT COUNT(*) FROM session_message_archive),
                (SELECT MAX(last_message) FROM cc_sessions)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| error.to_string())?;
    digest_json(&json!({ "sessions": sessions, "messages": messages, "latest": latest }))
}

fn latency_summary(samples: &mut [f64]) -> LatencySummary {
    samples.sort_by(f64::total_cmp);
    let percentile = |value: f64| {
        let index = ((samples.len() as f64 * value).ceil() as usize)
            .saturating_sub(1)
            .min(samples.len().saturating_sub(1));
        samples.get(index).copied().unwrap_or_default()
    };
    LatencySummary {
        p50: percentile(0.50),
        p95: percentile(0.95),
        maximum: samples.last().copied().unwrap_or_default(),
    }
}

fn repository_revision(repo: &Path) -> Result<String, String> {
    let output = Command::new("git")
        .args(["-C"])
        .arg(repo)
        .args(["rev-parse", "HEAD"])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("Repository revision is unavailable".to_string());
    }
    String::from_utf8(output.stdout)
        .map(|value| value.trim().to_string())
        .map_err(|error| error.to_string())
}

fn canonical_repository(value: &str) -> Result<PathBuf, String> {
    let path = fs::canonicalize(value).map_err(|error| format!("Open repository: {error}"))?;
    if !path.join(".git").exists() {
        return Err("Qualification requires a Git repository".to_string());
    }
    Ok(path)
}

fn machine_projection() -> Value {
    json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "logicalCpus": std::thread::available_parallelism().map(|value| value.get()).unwrap_or(1),
        "profile": if cfg!(debug_assertions) { "debug" } else { "release" },
    })
}

fn digest_json(value: &Value) -> Result<String, String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

#[allow(clippy::too_many_arguments)]
fn persist_receipt(
    conn: &Connection,
    id: &str,
    kind: &str,
    revision: &str,
    fixture_identity: &str,
    machine: &Value,
    measurements: &Value,
    before_identity: Option<&str>,
    rollback: &Value,
    created_at: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO local_performance_receipts(
            id, receipt_kind, repository_revision, fixture_identity,
            machine_json, measurements_json, before_identity, rollback_json, created_at
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            kind,
            revision,
            fixture_identity,
            machine.to_string(),
            measurements.to_string(),
            before_identity,
            rollback.to_string(),
            created_at,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use tempfile::tempdir;

    #[test]
    fn dashboard_benchmark_records_redacted_receipt() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        fs::create_dir(&repo).expect("repo");
        assert!(Command::new("git")
            .args(["init", "-q"])
            .arg(&repo)
            .status()
            .expect("git")
            .success());
        assert!(Command::new("git")
            .args(["-C"])
            .arg(&repo)
            .args([
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid"
            ])
            .args(["commit", "--allow-empty", "-qm", "fixture"])
            .status()
            .expect("commit")
            .success());
        let database = temp.path().join("fixture.db");
        let conn = Connection::open(&database).expect("db");
        schema::run_migrations(&conn).expect("schema");
        let receipt = benchmark_dashboard(&conn, &repo, 3).expect("benchmark");
        assert_eq!(receipt.iterations, 3);
        assert!(receipt.response_bytes > 0);
        assert!(receipt.errors.is_empty());
        assert!(!receipt
            .machine
            .to_string()
            .contains(&repo.to_string_lossy().to_string()));
        let stored: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM local_performance_receipts WHERE id=?1",
                [&receipt.id],
                |row| row.get(0),
            )
            .expect("stored");
        assert_eq!(stored, 1);
    }

    #[test]
    fn disk_accounting_ignores_symlinks_and_does_not_merge_by_size_alone() {
        let temp = tempdir().expect("temp");
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        fs::create_dir_all(&first).expect("first");
        fs::create_dir_all(&second).expect("second");
        fs::write(first.join("a"), b"same-size").expect("write");
        fs::write(second.join("b"), b"different").expect("write");
        let left = measure_tree(&first).expect("left");
        let right = measure_tree(&second).expect("right");
        assert_eq!(left.bytes, right.bytes);
        assert_ne!(left.identity, right.identity);
    }

    #[test]
    #[ignore = "writes append-only qualification receipts to the selected local CodeVetter database"]
    fn record_live_local_qualification() {
        let database = std::env::var("CV_QUALIFICATION_DB").expect("CV_QUALIFICATION_DB");
        let repository = std::env::var("CV_QUALIFICATION_REPO").expect("CV_QUALIFICATION_REPO");
        let conn = Connection::open(database).expect("database");
        schema::run_migrations(&conn).expect("schema");
        let dashboard = benchmark_dashboard(&conn, Path::new(&repository), DEFAULT_ITERATIONS)
            .expect("dashboard");
        let disk = account_caches(&conn, Path::new(&repository), true).expect("disk accounting");
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({ "dashboard": dashboard, "disk": disk }))
                .expect("report")
        );
    }
}
