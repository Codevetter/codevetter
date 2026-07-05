//! Unpack deep graph — call-graph indexing as part of Repo Unpacked.
//!
//! Builds a local knowledge graph (Tree-sitter → graph DB) and exposes symbol
//! context, blast-radius impact, hybrid search, and diff-to-flow mapping.
//! Index metadata is read from the repo-local deep-index cache when present.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::AppHandle;

use super::cli_stream::{cancel_cli_stream, run_streaming_child, CliStreamContext};

// Third-party deep-index tools may store metadata under these paths.
const DEEP_INDEX_META_FILE: &str = "gitnexus.json";
const DEEP_INDEX_LEGACY_META: &str = "meta.json";
const DEEP_INDEX_DIR: &str = ".gitnexus";

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct UnpackDeepGraphStats {
    pub files: Option<u64>,
    pub nodes: Option<u64>,
    pub edges: Option<u64>,
    pub communities: Option<u64>,
    pub processes: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct UnpackDeepGraphStatus {
    pub indexed: bool,
    pub indexed_at: Option<String>,
    pub indexed_commit: Option<String>,
    pub current_commit: Option<String>,
    pub stale: bool,
    pub stats: Option<UnpackDeepGraphStats>,
    pub engine_available: bool,
    pub engine_version: Option<String>,
    pub index_path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct UnpackDeepGraphDetectChanges {
    pub formatted: String,
    pub raw: Option<Value>,
    pub risk_level: Option<String>,
    pub changed_symbols: usize,
    pub affected_processes: usize,
}

#[derive(Debug, Clone)]
struct DeepIndexCli {
    program: String,
    prefix_args: Vec<String>,
}

fn git_root(repo_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(repo_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {repo_path}"));
    }
    let output = StdCommand::new("git")
        .args(["-C", repo_path, "rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| format!("git not available: {e}"))?;
    if !output.status.success() {
        return Ok(root);
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        Ok(root)
    } else {
        Ok(PathBuf::from(text))
    }
}

fn current_git_commit(repo_path: &str) -> Option<String> {
    let output = StdCommand::new("git")
        .args(["-C", repo_path, "rev-parse", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if sha.is_empty() {
        None
    } else {
        Some(sha)
    }
}

#[derive(Debug, Deserialize)]
struct DeepIndexMeta {
    #[serde(rename = "indexedAt")]
    indexed_at: Option<String>,
    #[serde(rename = "lastCommit")]
    last_commit: Option<String>,
    stats: Option<UnpackDeepGraphStats>,
}

fn read_deep_index_meta(repo_path: &str) -> Option<DeepIndexMeta> {
    let storage = Path::new(repo_path).join(DEEP_INDEX_DIR);
    for name in [DEEP_INDEX_META_FILE, DEEP_INDEX_LEGACY_META] {
        let path = storage.join(name);
        let raw = std::fs::read_to_string(&path).ok()?;
        if let Ok(meta) = serde_json::from_str::<DeepIndexMeta>(&raw) {
            return Some(meta);
        }
    }
    None
}

fn has_deep_index(repo_path: &str) -> bool {
    let storage = Path::new(repo_path).join(DEEP_INDEX_DIR);
    storage.join(DEEP_INDEX_META_FILE).is_file()
        || storage.join(DEEP_INDEX_LEGACY_META).is_file()
        || storage.join("lbug").exists()
}

fn resolve_deep_index_cli() -> DeepIndexCli {
    if StdCommand::new("gitnexus")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        return DeepIndexCli {
            program: "gitnexus".to_string(),
            prefix_args: Vec::new(),
        };
    }
    DeepIndexCli {
        program: "npx".to_string(),
        prefix_args: vec!["-y".to_string(), "gitnexus@latest".to_string()],
    }
}

fn deep_index_engine_version(cli: &DeepIndexCli) -> Option<String> {
    let output = StdCommand::new(&cli.program)
        .args(&cli.prefix_args)
        .arg("--version")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout)
        .trim()
        .lines()
        .next()
        .unwrap_or("")
        .to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn run_deep_index_json(repo_path: &str, extra_args: &[&str]) -> Result<Value, String> {
    let cli = resolve_deep_index_cli();
    let output = StdCommand::new(&cli.program)
        .args(&cli.prefix_args)
        .args(extra_args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to start deep graph engine ({e}). Requires Node 22+."))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let body = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "Deep graph command failed".to_string()
        };
        return Err(body);
    }

    if stdout.is_empty() {
        return Ok(json!({ "ok": true }));
    }

    serde_json::from_str(&stdout).map_err(|e| {
        if stderr.is_empty() {
            format!("Deep graph engine returned non-JSON output: {e}")
        } else {
            format!("Deep graph engine returned non-JSON output: {e}\n{stderr}")
        }
    })
}

fn run_deep_index_text(repo_path: &str, extra_args: &[&str]) -> Result<String, String> {
    let cli = resolve_deep_index_cli();
    let output = StdCommand::new(&cli.program)
        .args(&cli.prefix_args)
        .args(extra_args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run deep graph engine: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let body = if !stderr.trim().is_empty() {
            stderr
        } else {
            stdout
        };
        return Err(body.trim().to_string());
    }
    Ok(stdout.trim().to_string())
}

pub fn build_unpack_deep_graph_status(repo_path: &str) -> UnpackDeepGraphStatus {
    let root = git_root(repo_path).unwrap_or_else(|_| PathBuf::from(repo_path));
    let root_str = root.to_string_lossy().to_string();
    let cli = resolve_deep_index_cli();
    let engine_available = deep_index_engine_version(&cli).is_some();
    let engine_version = if engine_available {
        deep_index_engine_version(&cli)
    } else {
        None
    };

    let indexed = has_deep_index(&root_str);
    let meta = read_deep_index_meta(&root_str);
    let current_commit = current_git_commit(&root_str);
    let indexed_commit = meta.as_ref().and_then(|m| m.last_commit.clone());
    let stale = indexed
        && current_commit
            .as_ref()
            .zip(indexed_commit.as_ref())
            .map(|(cur, idx)| cur != idx)
            .unwrap_or(false);

    UnpackDeepGraphStatus {
        indexed,
        indexed_at: meta.as_ref().and_then(|m| m.indexed_at.clone()),
        indexed_commit,
        current_commit,
        stale,
        stats: meta.and_then(|m| m.stats),
        engine_available,
        engine_version,
        index_path: if indexed {
            Some(root.join(DEEP_INDEX_DIR).to_string_lossy().to_string())
        } else {
            None
        },
    }
}

#[tauri::command]
pub async fn unpack_deep_graph_status(repo_path: String) -> Result<UnpackDeepGraphStatus, String> {
    Ok(build_unpack_deep_graph_status(&repo_path))
}

#[tauri::command]
pub async fn unpack_deep_graph_symbol_context(
    repo_path: String,
    symbol: String,
    file_path: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let root = git_root(&repo_path)?;
    let root_str = root.to_string_lossy().to_string();
    if !has_deep_index(&root_str) {
        return Err(
            "Repo has no deep graph index. Run Build deep index in the Intelligence tab first."
                .to_string(),
        );
    }
    let mut args = vec!["context", symbol.as_str()];
    let file_arg;
    if let Some(file) = file_path.as_deref().filter(|s| !s.trim().is_empty()) {
        file_arg = file.to_string();
        args.push("--file");
        args.push(&file_arg);
    }
    let limit_arg;
    if let Some(lim) = limit.filter(|n| *n > 0) {
        limit_arg = lim.to_string();
        args.push("--limit");
        args.push(&limit_arg);
    }
    run_deep_index_json(&root_str, &args)
}

#[tauri::command]
pub async fn unpack_deep_graph_symbol_impact(
    repo_path: String,
    symbol: String,
    file_path: Option<String>,
    direction: Option<String>,
    depth: Option<u32>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let root = git_root(&repo_path)?;
    let root_str = root.to_string_lossy().to_string();
    if !has_deep_index(&root_str) {
        return Err(
            "Repo has no deep graph index. Run Build deep index in the Intelligence tab first."
                .to_string(),
        );
    }
    let mut args = vec!["impact", symbol.as_str()];
    let dir = direction.unwrap_or_else(|| "upstream".to_string());
    let dir_arg = dir.as_str();
    args.push("--direction");
    args.push(dir_arg);
    let file_arg;
    if let Some(file) = file_path.as_deref().filter(|s| !s.trim().is_empty()) {
        file_arg = file.to_string();
        args.push("--file");
        args.push(&file_arg);
    }
    let depth_arg;
    if let Some(d) = depth.filter(|n| *n > 0) {
        depth_arg = d.to_string();
        args.push("--depth");
        args.push(&depth_arg);
    }
    let limit_arg;
    if let Some(lim) = limit.filter(|n| *n > 0) {
        limit_arg = lim.to_string();
        args.push("--limit");
        args.push(&limit_arg);
    }
    run_deep_index_json(&root_str, &args)
}

#[tauri::command]
pub async fn unpack_deep_graph_query(
    repo_path: String,
    query: String,
    limit: Option<u32>,
) -> Result<Value, String> {
    let root = git_root(&repo_path)?;
    let root_str = root.to_string_lossy().to_string();
    if !has_deep_index(&root_str) {
        return Err(
            "Repo has no deep graph index. Run Build deep index in the Intelligence tab first."
                .to_string(),
        );
    }
    let mut args = vec!["query", query.as_str()];
    let limit_arg;
    if let Some(lim) = limit.filter(|n| *n > 0) {
        limit_arg = lim.to_string();
        args.push("--limit");
        args.push(&limit_arg);
    }
    run_deep_index_json(&root_str, &args)
}

#[tauri::command]
pub async fn unpack_deep_graph_detect_changes(
    repo_path: String,
    scope: Option<String>,
    base_ref: Option<String>,
) -> Result<UnpackDeepGraphDetectChanges, String> {
    let root = git_root(&repo_path)?;
    let root_str = root.to_string_lossy().to_string();
    if !has_deep_index(&root_str) {
        return Err(
            "Repo has no deep graph index. Run Build deep index in the Intelligence tab first."
                .to_string(),
        );
    }
    let scope_value = scope.unwrap_or_else(|| "compare".to_string());
    let mut args = vec!["detect-changes", "--scope", scope_value.as_str()];
    let base_arg;
    if let Some(base) = base_ref.as_deref().filter(|s| !s.trim().is_empty()) {
        base_arg = base.to_string();
        args.push("--base-ref");
        args.push(&base_arg);
    }
    let formatted = run_deep_index_text(&root_str, &args)?;

    let raw = serde_json::from_str::<Value>(&formatted).ok();
    let summary = raw
        .as_ref()
        .and_then(|v| v.get("summary"))
        .cloned()
        .unwrap_or(Value::Null);
    let risk_level = summary
        .get("risk_level")
        .and_then(Value::as_str)
        .map(str::to_string);
    let changed_symbols = summary
        .get("changed_count")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let affected_processes = summary
        .get("affected_count")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;

    Ok(UnpackDeepGraphDetectChanges {
        formatted,
        raw,
        risk_level,
        changed_symbols,
        affected_processes,
    })
}

fn spawn_deep_index_analyze(
    repo_path: &str,
    index_only: bool,
) -> Result<std::process::Child, String> {
    let cli = resolve_deep_index_cli();
    let mut cmd = StdCommand::new(&cli.program);
    cmd.args(&cli.prefix_args);
    cmd.arg("analyze");
    if index_only {
        cmd.arg("--index-only");
    }
    cmd.arg("--skip-agents-md");
    cmd.arg("--skip-skills");
    cmd.current_dir(repo_path);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.spawn()
        .map_err(|e| format!("Failed to start deep graph index: {e}"))
}

#[tauri::command]
pub async fn unpack_deep_graph_analyze(
    app: AppHandle,
    repo_path: String,
    stream_id: String,
    index_only: Option<bool>,
) -> Result<UnpackDeepGraphStatus, String> {
    let root = git_root(&repo_path)?;
    let root_str = root.to_string_lossy().to_string();
    let ctx = CliStreamContext {
        app: app.clone(),
        stream_id: stream_id.clone(),
        repo_path: root_str.clone(),
        agent: "unpack_deep_graph".to_string(),
    };

    let cancel = Arc::new(AtomicBool::new(false));
    let child = spawn_deep_index_analyze(&root_str, index_only.unwrap_or(true))?;
    let status = run_streaming_child(&ctx, child, cancel.clone())?;

    if cancel.load(Ordering::Relaxed) {
        return Err("Deep graph index cancelled".to_string());
    }
    if !status.success() {
        return Err(format!(
            "Deep graph index failed (exit {:?})",
            status.code()
        ));
    }

    Ok(build_unpack_deep_graph_status(&root_str))
}

#[tauri::command]
pub async fn unpack_deep_graph_cancel_analyze(stream_id: String) -> Result<bool, String> {
    Ok(cancel_cli_stream(&stream_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_for_unindexed_repo_is_not_indexed() {
        let dir = std::env::temp_dir().join(format!("cv-udg-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let status = build_unpack_deep_graph_status(dir.to_str().unwrap());
        assert!(!status.indexed);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_deep_index_meta_json() {
        let dir = std::env::temp_dir().join(format!("cv-udg-meta-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let storage = dir.join(DEEP_INDEX_DIR);
        std::fs::create_dir_all(&storage).expect("mkdir");
        std::fs::write(
            storage.join(DEEP_INDEX_META_FILE),
            r#"{"indexedAt":"2026-01-01T00:00:00.000Z","lastCommit":"abc123","stats":{"nodes":10,"edges":20}}"#,
        )
        .expect("write meta");
        let status = build_unpack_deep_graph_status(dir.to_str().unwrap());
        assert!(status.indexed);
        assert_eq!(status.stats.as_ref().and_then(|s| s.nodes), Some(10));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
