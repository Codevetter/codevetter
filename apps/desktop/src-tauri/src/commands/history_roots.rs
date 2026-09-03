use crate::db::queries;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const HISTORY_ROOTS_SCHEMA_VERSION: &str = "codevetter.history-roots/v1";
const PREFERENCE_KEY: &str = "codex_usage_import_roots";
const MAX_ROOTS: usize = 16;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HistoryRootsOperation {
    Read,
    Add,
    Remove,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryRoot {
    pub path: String,
    pub display_path: String,
    pub exists: bool,
    pub sessions_available: bool,
    pub archived_sessions_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryRootsReceipt {
    pub schema_version: String,
    pub generated_at: String,
    pub operation: HistoryRootsOperation,
    pub database_available: bool,
    pub changed_root: Option<String>,
    pub roots: Vec<HistoryRoot>,
    pub limitations: Vec<String>,
}

pub fn run_history_roots(
    connection: Option<&Connection>,
    operation: HistoryRootsOperation,
    requested_path: Option<&Path>,
) -> Result<HistoryRootsReceipt, String> {
    let mut roots = read_stored_roots(connection)?;
    let changed_root = match operation {
        HistoryRootsOperation::Read => {
            if requested_path.is_some() {
                return Err("read does not accept a history-root path".to_string());
            }
            None
        }
        HistoryRootsOperation::Add => {
            let connection = connection.ok_or("history-root add requires the local database")?;
            let path = normalize_new_root(
                requested_path.ok_or("history-root add requires an explicit directory")?,
            )?;
            let path_string = path.to_string_lossy().to_string();
            if !roots.contains(&path_string) {
                if roots.len() >= MAX_ROOTS {
                    return Err(format!(
                        "at most {MAX_ROOTS} additional Codex roots are allowed"
                    ));
                }
                roots.push(path_string.clone());
                roots.sort();
                persist_roots(connection, &roots)?;
            }
            Some(path_string)
        }
        HistoryRootsOperation::Remove => {
            let connection = connection.ok_or("history-root remove requires the local database")?;
            let requested = requested_path
                .ok_or("history-root remove requires an explicit stored path")?
                .to_string_lossy()
                .to_string();
            let previous_len = roots.len();
            roots.retain(|root| root != &requested);
            if roots.len() == previous_len {
                return Err("the requested history root is not configured".to_string());
            }
            persist_roots(connection, &roots)?;
            Some(requested)
        }
    };

    Ok(HistoryRootsReceipt {
        schema_version: HISTORY_ROOTS_SCHEMA_VERSION.to_string(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        operation,
        database_available: connection.is_some(),
        changed_root,
        roots: roots.iter().map(|root| describe_root(root)).collect(),
        limitations: vec![
            "The active CODEX_HOME remains automatic and is not duplicated here.".to_string(),
            "Saving a root does not start reconciliation or read transcript content.".to_string(),
            "Removing a root changes future discovery only; it does not delete provider transcripts."
                .to_string(),
        ],
    })
}

fn read_stored_roots(connection: Option<&Connection>) -> Result<Vec<String>, String> {
    let Some(connection) = connection else {
        return Ok(Vec::new());
    };
    let Some(raw) = queries::get_preference(connection, PREFERENCE_KEY)
        .map_err(|error| format!("read additional Codex roots: {error}"))?
    else {
        return Ok(Vec::new());
    };
    let roots: Vec<String> = serde_json::from_str(&raw)
        .map_err(|error| format!("stored additional Codex roots are invalid: {error}"))?;
    validate_stored_roots(roots)
}

fn validate_stored_roots(roots: Vec<String>) -> Result<Vec<String>, String> {
    if roots.len() > MAX_ROOTS {
        return Err(format!(
            "stored additional Codex roots exceed the {MAX_ROOTS}-root limit"
        ));
    }
    let mut valid = Vec::with_capacity(roots.len());
    for root in roots {
        if root.is_empty() || root.len() > 4_096 || root.contains(['\0', '\n', '\r']) {
            return Err("stored additional Codex roots contain an invalid path".to_string());
        }
        if !Path::new(&root).is_absolute() {
            return Err("stored additional Codex roots must be absolute paths".to_string());
        }
        if !valid.contains(&root) {
            valid.push(root);
        }
    }
    valid.sort();
    Ok(valid)
}

fn normalize_new_root(path: &Path) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("open selected Codex history root: {error}"))?;
    if !canonical.is_dir() {
        return Err("the selected Codex history root is not a directory".to_string());
    }
    let base = match canonical.file_name().and_then(|name| name.to_str()) {
        Some("sessions" | "archived_sessions") => canonical
            .parent()
            .map(Path::to_path_buf)
            .ok_or("the selected sessions directory has no parent")?,
        _ => canonical,
    };
    if !base.join("sessions").is_dir() && !base.join("archived_sessions").is_dir() {
        return Err(
            "select a Codex home, sessions directory, or archived_sessions directory".to_string(),
        );
    }
    Ok(base)
}

fn persist_roots(connection: &Connection, roots: &[String]) -> Result<(), String> {
    let serialized = serde_json::to_string(roots)
        .map_err(|error| format!("serialize additional Codex roots: {error}"))?;
    queries::set_preference(connection, PREFERENCE_KEY, &serialized)
        .map_err(|error| format!("save additional Codex roots: {error}"))
}

fn describe_root(path: &str) -> HistoryRoot {
    let root = Path::new(path);
    HistoryRoot {
        path: path.to_string(),
        display_path: display_path(root),
        exists: root.is_dir(),
        sessions_available: root.join("sessions").is_dir(),
        archived_sessions_available: root.join("archived_sessions").is_dir(),
    }
}

fn display_path(path: &Path) -> String {
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        if let Ok(relative) = path.strip_prefix(home) {
            return format!("~/{}", relative.to_string_lossy());
        }
    }
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn history_roots_normalize_dedupe_and_remove_without_reading_transcripts() {
        let fixture = tempfile::tempdir().expect("fixture");
        let codex_home = fixture.path().join("codex-home");
        std::fs::create_dir_all(codex_home.join("sessions")).expect("sessions");
        std::fs::write(
            codex_home.join("sessions").join("secret.jsonl"),
            "secret transcript",
        )
        .expect("transcript");

        let connection = Connection::open_in_memory().expect("database");
        db::schema::run_migrations(&connection).expect("schema");
        let added = run_history_roots(
            Some(&connection),
            HistoryRootsOperation::Add,
            Some(&codex_home.join("sessions")),
        )
        .expect("add root");
        assert_eq!(added.roots.len(), 1);
        let canonical_home = std::fs::canonicalize(&codex_home).expect("canonical Codex home");
        assert_eq!(added.roots[0].path, canonical_home.to_string_lossy());
        assert!(added.roots[0].sessions_available);
        assert!(!serde_json::to_string(&added)
            .expect("receipt")
            .contains("secret transcript"));

        let duplicate = run_history_roots(
            Some(&connection),
            HistoryRootsOperation::Add,
            Some(&codex_home),
        )
        .expect("dedupe root");
        assert_eq!(duplicate.roots.len(), 1);

        let removed = run_history_roots(
            Some(&connection),
            HistoryRootsOperation::Remove,
            Some(Path::new(&added.roots[0].path)),
        )
        .expect("remove root");
        assert!(removed.roots.is_empty());
        assert!(codex_home.join("sessions").join("secret.jsonl").is_file());
    }

    #[test]
    fn history_roots_reject_unrelated_or_relative_directories() {
        let fixture = tempfile::tempdir().expect("fixture");
        let connection = Connection::open_in_memory().expect("database");
        db::schema::run_migrations(&connection).expect("schema");
        assert!(run_history_roots(
            Some(&connection),
            HistoryRootsOperation::Add,
            Some(fixture.path()),
        )
        .is_err());
        queries::set_preference(&connection, PREFERENCE_KEY, "[\"relative/path\"]")
            .expect("invalid stored root");
        assert!(run_history_roots(Some(&connection), HistoryRootsOperation::Read, None).is_err());
    }
}
