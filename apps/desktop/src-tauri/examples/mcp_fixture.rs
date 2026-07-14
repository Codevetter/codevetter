//! Creates an isolated read-only MCP fixture database for client compatibility
//! and benchmarks. It never writes to the target repository or user database.

use codevetter_desktop::{
    commands::structural_graph::{
        storage::persist_snapshot,
        types::{
            StructuralGraphCoverage, StructuralGraphEngineInfo, StructuralGraphSnapshot,
            STRUCTURAL_GRAPH_SCHEMA_VERSION,
        },
    },
    db::init_db,
};
use rusqlite::params;
use serde_json::json;
use std::{path::PathBuf, process::Command};

fn main() {
    if let Err(error) = run() {
        eprintln!("mcp-fixture: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut arguments = std::env::args().skip(1);
    let repo = PathBuf::from(
        arguments
            .next()
            .ok_or_else(|| "usage: mcp_fixture <repository> <database>".to_string())?,
    )
    .canonicalize()
    .map_err(|error| format!("Resolve repository: {error}"))?;
    let database = PathBuf::from(
        arguments
            .next()
            .ok_or_else(|| "usage: mcp_fixture <repository> <database>".to_string())?,
    );
    if arguments.next().is_some() {
        return Err("usage: mcp_fixture <repository> <database>".to_string());
    }
    let head = git(&repo, &["rev-parse", "HEAD"])?;
    let committed_at = git(&repo, &["show", "-s", "--format=%cI", &head])?;
    let subject = git(&repo, &["show", "-s", "--format=%s", &head])?;
    let repo_path = repo.to_string_lossy().to_string();
    let repo_id = "repo_fixture0123456789abcdef";
    let database_dir = database
        .parent()
        .ok_or_else(|| "Fixture database requires a parent directory".to_string())?;
    let connection = init_db(database_dir.to_path_buf()).map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO history_graph_repositories (
                repo_path, repository_fingerprint, indexed_head, status,
                coverage_json, created_at, updated_at
             ) VALUES (?1, 'isolated-fixture', ?2, 'ready',
                       '{\"coverage_complete\":false}', ?3, ?3)",
            params![repo_path, head, committed_at],
        )
        .map_err(|error| error.to_string())?;
    let event_count = std::env::var("CV_MCP_FIXTURE_EVENTS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1)
        .clamp(1, 100_000);
    if event_count > 1 {
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        {
            let mut statement = transaction
                .prepare_cached(
                    "INSERT INTO history_graph_events (
                        id, repo_path, revision_sha, event_kind, entity_id, trust,
                        origin, source_id, payload_json, evidence_json, recorded_at
                     ) VALUES (?1, ?2, ?3, 'verification', ?4, 'extracted',
                               'fixture', ?5, '{\"summary\":\"Fixture verification passed\"}',
                               '[]', ?6)",
                )
                .map_err(|error| error.to_string())?;
            for index in 1..event_count {
                statement
                    .execute(params![
                        format!("fixture-evidence-{index:06}"),
                        repo_path,
                        head,
                        format!("fixture-entity-{index:06}"),
                        format!("fixture-source-{index:06}"),
                        committed_at,
                    ])
                    .map_err(|error| error.to_string())?;
            }
        }
        transaction.commit().map_err(|error| error.to_string())?;
    }
    connection
        .execute(
            "INSERT INTO history_graph_events (
                id, repo_path, revision_sha, event_kind, entity_id, trust,
                origin, source_id, payload_json, evidence_json, recorded_at
             ) VALUES ('fixture-evidence', ?1, ?2, 'verification', 'fixture-entity',
                       'extracted', 'fixture', 'fixture-source',
                       '{\"summary\":\"Fixture verification passed\"}', '[]', ?3)",
            params![repo_path, head, committed_at],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO history_graph_revisions (
                repo_path, sha, ordinal, committed_at, author_name, subject,
                parents_json, tags_json, is_release, is_head, coverage_json
             ) VALUES (?1, ?2, 0, ?3, 'Fixture', ?4, '[]', '[]', 0, 1, '{}')",
            params![repo_path, head, committed_at, subject],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO mcp_repository_scopes (
                repo_path, repo_id, enabled, created_at, updated_at
             ) VALUES (?1, ?2, 1, ?3, ?3)",
            params![repo_path, repo_id, committed_at],
        )
        .map_err(|error| error.to_string())?;
    persist_snapshot(
        &connection,
        &StructuralGraphSnapshot {
            id: "fixture-current".to_string(),
            schema_version: STRUCTURAL_GRAPH_SCHEMA_VERSION,
            repo_path,
            repo_head: Some(head),
            engine: StructuralGraphEngineInfo {
                id: "fixture".to_string(),
                version: "1".to_string(),
                bundled: true,
                syntax_aware: true,
                supported_languages: Vec::new(),
            },
            created_at: committed_at,
            cursor: None,
            ignore_fingerprint: None,
            coverage: StructuralGraphCoverage::default(),
            files: Vec::new(),
            nodes: Vec::new(),
            edges: Vec::new(),
            communities: Vec::new(),
            diagnostics: Vec::new(),
            truncated: false,
        },
    )
    .map_err(|error| error.to_string())?;
    println!("{}", json!({"database": database, "repoId": repo_id}));
    Ok(())
}

fn git(repo: &std::path::Path, arguments: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(arguments)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
