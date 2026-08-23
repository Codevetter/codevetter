//! Headless driver for CodeVetter's shipped structural-graph implementation.
//!
//! External benchmarks must measure the product, not a reimplementation. The
//! Tauri command layer (`commands::structural_graph::api`) needs an `AppHandle`
//! and a SQLite `DbState`, so this binary goes one level down and calls the same
//! extraction engine, interchange serializer, and query planner the desktop app
//! calls. Nothing here parses source, ranks nodes, or bounds a response on its
//! own: every decision — including every refusal — comes from product code.
//!
//! usage:
//!   codevetter-graph build <repo_path> <revision> <out_snapshot_path>
//!   codevetter-graph query <snapshot_path> <query_string> <node_limit>

use codevetter_desktop::commands::structural_graph::extract::BundledTreeSitterEngine;
use codevetter_desktop::commands::structural_graph::interchange::{
    export_json, import_codevetter_json,
};
use codevetter_desktop::commands::structural_graph::query::{search_page, GraphQueryFilter};
use codevetter_desktop::commands::structural_graph::types::{
    StructuralGraphBuildInput, StructuralGraphCancellation, StructuralGraphEngine,
    StructuralGraphProgress,
};
use std::path::{Path, PathBuf};
use std::process::Command;

const USAGE: &str = concat!(
    "usage:\n",
    "  codevetter-graph build <repo_path> <revision> <out_snapshot_path>\n",
    "  codevetter-graph query <snapshot_path> <query_string> <node_limit>"
);

fn main() {
    if let Err(error) = run(std::env::args().skip(1).collect()) {
        eprintln!("codevetter-graph: {error}");
        std::process::exit(1);
    }
}

fn run(arguments: Vec<String>) -> Result<(), String> {
    match arguments.split_first() {
        Some((command, rest)) if command == "build" => match rest {
            [repo_path, revision, out_path] => build(repo_path, revision, out_path),
            _ => Err(format!("build takes 3 arguments\n{USAGE}")),
        },
        Some((command, rest)) if command == "query" => match rest {
            [snapshot_path, query_text, node_limit] => query(snapshot_path, query_text, node_limit),
            _ => Err(format!("query takes 3 arguments\n{USAGE}")),
        },
        Some((command, _)) if command == "--help" || command == "-h" => {
            println!("{USAGE}");
            Ok(())
        }
        _ => Err(USAGE.to_string()),
    }
}

/// Builds a full structural graph for the checkout at `repo_path` and writes the
/// product's own JSON interchange document to `out_path`.
///
/// `revision` is the identity stamped into `snapshot.repo_head`. Extraction
/// itself always reads the working tree at `repo_path` (that is what
/// `BundledTreeSitterEngine` does), so a caller that passes a revision the
/// checkout is not actually at would mislabel the snapshot. That mismatch is
/// reported on stderr rather than silently accepted.
fn build(repo_path: &str, revision: &str, out_path: &str) -> Result<(), String> {
    let root = canonical_repo_path(repo_path)?;
    if let Some(head) = git_head(&root) {
        if head != revision && !head.starts_with(revision) {
            eprintln!(
                "codevetter-graph: warning: indexing working tree at {head} but stamping revision {revision}"
            );
        }
    } else {
        eprintln!("codevetter-graph: warning: {} has no readable git HEAD; stamping revision {revision} unverified", root.display());
    }

    let input = StructuralGraphBuildInput::full(root, Some(revision.to_string()));
    let cancellation = StructuralGraphCancellation::default();
    let progress = |_: StructuralGraphProgress| {};
    let snapshot = BundledTreeSitterEngine
        .build(&input, &cancellation, &progress)
        .map_err(|error| format!("build failed: {error}"))?;

    let document = export_json(&snapshot)?;
    let bytes = document.len();
    std::fs::write(out_path, &document)
        .map_err(|error| format!("cannot write {out_path}: {error}"))?;

    // Reported so a caller can attribute a later import refusal to scale rather
    // than corruption. The limits themselves stay in the product's interchange
    // module; this only measures.
    eprintln!(
        "codevetter-graph: snapshot={} files={} indexed={} nodes={} edges={} bytes={} truncated={}",
        snapshot.id,
        snapshot.files.len(),
        snapshot.coverage.indexed_files,
        snapshot.nodes.len(),
        snapshot.edges.len(),
        bytes,
        snapshot.truncated,
    );
    Ok(())
}

/// Loads a snapshot through the product's own importer (which enforces the
/// shipped size and node bounds) and prints `query::search_page` verbatim.
fn query(snapshot_path: &str, query_text: &str, node_limit: &str) -> Result<(), String> {
    let limit = node_limit
        .parse::<usize>()
        .map_err(|error| format!("node_limit must be a positive integer: {error}"))?;
    let document = std::fs::read_to_string(snapshot_path)
        .map_err(|error| format!("cannot read {snapshot_path}: {error}"))?;
    let snapshot = import_codevetter_json(&document)?;
    let result = search_page(
        &snapshot,
        query_text,
        &GraphQueryFilter::default(),
        Some(limit),
        None,
    )?;
    let encoded = serde_json::to_string(&result)
        .map_err(|error| format!("cannot encode search result: {error}"))?;
    println!("{encoded}");
    Ok(())
}

fn canonical_repo_path(repo_path: &str) -> Result<PathBuf, String> {
    let trimmed = repo_path.trim();
    if trimmed.is_empty() {
        return Err("repository path is required".to_string());
    }
    let path = PathBuf::from(trimmed)
        .canonicalize()
        .map_err(|error| format!("cannot resolve repository path: {error}"))?;
    if !path.is_dir() {
        return Err("repository path is not a directory".to_string());
    }
    Ok(path)
}

fn git_head(repo_path: &Path) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let head = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!head.is_empty()).then_some(head)
}
