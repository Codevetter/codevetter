//! Local experiment adapter for task-bound structural-context snapshots.
//!
//! This deliberately stays outside the shipped binaries. It exposes the same
//! graph engine and query implementation used by CodeVetter so experiments can
//! index isolated corpus fixtures without registering them in the desktop DB.

use codevetter_desktop::commands::structural_graph::{
    extract::BundledTreeSitterEngine,
    interchange::{export_json, import_codevetter_json},
    query::{self, GraphQueryFilter},
    types::{StructuralGraphBuildInput, StructuralGraphCancellation, StructuralGraphEngine},
};
use serde_json::json;
use std::{env, fs, path::PathBuf};

fn main() {
    if let Err(error) = run(env::args().skip(1).collect()) {
        eprintln!("context-provider-fixture: {error}");
        std::process::exit(2);
    }
}

fn run(arguments: Vec<String>) -> Result<(), String> {
    match arguments.as_slice() {
        [command, repo, revision, output] if command == "build" => {
            build_snapshot(repo, revision, output)
        }
        [command, snapshot, text] if command == "query" => query_snapshot(snapshot, text, 20),
        [command, snapshot, text, limit] if command == "query" => {
            let limit = limit
                .parse::<usize>()
                .map_err(|_| "query limit must be a positive integer".to_string())?;
            if limit == 0 {
                return Err("query limit must be a positive integer".to_string());
            }
            query_snapshot(snapshot, text, limit)
        }
        _ => Err(
            "usage: context_provider_fixture build <repo> <revision> <output> | query <snapshot> <text> [limit]"
                .to_string(),
        ),
    }
}

fn build_snapshot(repo: &str, revision: &str, output: &str) -> Result<(), String> {
    let input = StructuralGraphBuildInput::full(
        PathBuf::from(repo),
        Some(validate_revision(revision)?.to_string()),
    );
    let snapshot = BundledTreeSitterEngine
        .build(&input, &StructuralGraphCancellation::default(), &|_| {})
        .map_err(|error| error.to_string())?;
    let document = export_json(&snapshot)?;
    fs::write(output, document).map_err(|error| format!("write snapshot: {error}"))?;
    println!(
        "{}",
        json!({
            "snapshot_id": snapshot.id,
            "indexed_revision": snapshot.repo_head,
            "indexed_files": snapshot.coverage.indexed_files,
            "node_count": snapshot.nodes.len(),
            "edge_count": snapshot.edges.len(),
            "truncated": snapshot.truncated,
        })
    );
    Ok(())
}

fn query_snapshot(snapshot: &str, text: &str, limit: usize) -> Result<(), String> {
    let document =
        fs::read_to_string(snapshot).map_err(|error| format!("read snapshot: {error}"))?;
    let snapshot = import_codevetter_json(&document)?;
    let result = query::search(&snapshot, text, &GraphQueryFilter::default(), Some(limit));
    println!(
        "{}",
        serde_json::to_string(&result).map_err(|error| format!("serialize query: {error}"))?
    );
    Ok(())
}

fn validate_revision(value: &str) -> Result<&str, String> {
    let valid_length = matches!(value.len(), 40 | 64);
    if valid_length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(value)
    } else {
        Err("revision must be a lowercase 40- or 64-character digest".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::validate_revision;

    #[test]
    fn revision_identity_is_strict() {
        assert!(validate_revision(&"a".repeat(40)).is_ok());
        assert!(validate_revision(&"b".repeat(64)).is_ok());
        assert!(validate_revision("HEAD").is_err());
        assert!(validate_revision(&"A".repeat(40)).is_err());
    }
}
