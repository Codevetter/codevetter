//! Parallel repo walk + compact directory-tree previews (no dependency on unpack.rs).

use jwalk::WalkDir;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::process::Command as StdCommand;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const MAX_FILES: usize = 4000;
pub const MAX_FILE_BYTES: u64 = 1_000_000;
pub const CLIENT_ALL_FILES_LIMIT: usize = 512;
const PROGRESS_EVERY_N_FILES: usize = 100;
const PROGRESS_MIN_INTERVAL_MS: u128 = 120;

const ALWAYS_SKIP: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "__pycache__",
    ".next",
    ".turbo",
    ".vercel",
    ".cache",
    "dist",
    "build",
    "out",
    "coverage",
    ".pnpm-store",
    "vendor",
    ".venv",
    "venv",
    ".gradle",
    ".idea",
    ".vscode",
    ".DS_Store",
];

const BINARY_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "icns", "bmp", "tiff", "mp4", "mov", "webm", "mp3",
    "wav", "ogg", "flac", "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "pdf", "psd", "ai",
    "sketch", "fig", "exe", "dll", "so", "dylib", "bin", "wasm", "o", "a", "lib", "ttf", "otf",
    "woff", "woff2", "eot", "lock", "min.js", "min.css",
];

const DIR_TREE_MAX_NODES: usize = 400;

#[derive(Debug, Clone)]
pub struct ScanProgress {
    pub phase: &'static str,
    pub detail: String,
    pub files_seen: usize,
    pub files_skipped: usize,
}

pub type ScanProgressCallback = Arc<dyn Fn(ScanProgress) + Send + Sync>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryDirNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub file_count: u32,
    pub children: Vec<InventoryDirNode>,
}

pub struct ParallelWalkResult {
    pub files: Vec<(String, u64)>,
    pub files_skipped: usize,
    pub bytes_scanned: u64,
    pub max_files_hit: bool,
    pub estimated_total_files: Option<usize>,
    pub tracked_files: Option<Vec<String>>,
    pub ignored_dirs: Vec<String>,
}

#[derive(Clone)]
struct GlobPattern {
    pattern: String,
    negated: bool,
    dir_only: bool,
}

pub fn emit_unpack_scan_progress(
    app: &AppHandle,
    scan_id: &str,
    repo_path: &str,
    detail: &str,
    files_seen: usize,
) {
    let _ = app.emit(
        "unpack-progress",
        json!({
            "report_id": scan_id,
            "repo_path": repo_path,
            "phase": "scanning",
            "detail": detail,
            "files_seen": files_seen,
        }),
    );
}

fn parse_gitignore(root: &Path) -> Vec<GlobPattern> {
    let path = root.join(".gitignore");
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    content
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let mut pattern = line.to_string();
            let negated = pattern.starts_with('!');
            if negated {
                pattern = pattern[1..].to_string();
            }
            let dir_only = pattern.ends_with('/');
            if dir_only {
                pattern = pattern.trim_end_matches('/').to_string();
            }
            Some(GlobPattern {
                pattern,
                negated,
                dir_only,
            })
        })
        .collect()
}

fn is_ignored(rel: &str, is_dir: bool, patterns: &[GlobPattern]) -> bool {
    if rel.is_empty() {
        return false;
    }
    let mut ignored = false;
    let name = Path::new(rel)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    for pat in patterns {
        if pat.dir_only && !is_dir {
            if pat.negated && is_within_unignored_dir(&pat.pattern, rel) {
                ignored = false;
            }
            continue;
        }
        if simple_glob_match(&pat.pattern, rel, &name) {
            ignored = !pat.negated;
            continue;
        }
        if pat.negated && pat.dir_only && is_within_unignored_dir(&pat.pattern, rel) {
            ignored = false;
        }
    }
    ignored
}

fn is_within_unignored_dir(pattern: &str, rel: &str) -> bool {
    let pattern = pattern.trim_start_matches('/').trim_end_matches('/');
    !pattern.is_empty() && rel.starts_with(pattern) && rel[pattern.len()..].starts_with('/')
}

fn should_skip_dir_name(name: &str) -> bool {
    ALWAYS_SKIP.contains(&name)
}

fn simple_glob_match(pattern: &str, rel: &str, name: &str) -> bool {
    if pattern.contains('/') {
        let pattern = pattern.trim_start_matches('/');
        return path_match(pattern, rel);
    }
    path_match(pattern, name)
}

fn path_match(pattern: &str, text: &str) -> bool {
    if pattern == "**" {
        return true;
    }
    if let Some(ext) = pattern.strip_prefix("*.") {
        return text.ends_with(&format!(".{ext}"));
    }
    if pattern.starts_with('*') && !pattern.contains('/') {
        return text.ends_with(&pattern[1..]);
    }
    if pattern == text {
        return true;
    }
    if text.starts_with(pattern) && text[pattern.len()..].starts_with('/') {
        return true;
    }
    false
}

pub(crate) fn is_binary_path(rel: &str) -> bool {
    let lower = rel.to_lowercase();
    if lower.ends_with(".lock")
        || lower.ends_with("-lock.json")
        || lower.ends_with("pnpm-lock.yaml")
        || lower.ends_with("yarn.lock")
        || lower.ends_with("cargo.lock")
        || lower.ends_with("poetry.lock")
        || lower.ends_with(".min.js")
        || lower.ends_with(".min.css")
    {
        return true;
    }
    let ext = Path::new(&lower)
        .extension()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    BINARY_EXTS.contains(&ext.as_str())
}

fn emit_progress(
    progress: &Option<ScanProgressCallback>,
    phase: &'static str,
    detail: impl Into<String>,
    files_seen: usize,
    files_skipped: usize,
) {
    if let Some(cb) = progress {
        cb(ScanProgress {
            phase,
            detail: detail.into(),
            files_seen,
            files_skipped,
        });
    }
}

fn should_emit_progress(last_emit: &mut Instant, file_count: usize) -> bool {
    if file_count == 1 {
        return true;
    }
    if !file_count.is_multiple_of(PROGRESS_EVERY_N_FILES) {
        return false;
    }
    let now = Instant::now();
    if now.duration_since(*last_emit).as_millis() < PROGRESS_MIN_INTERVAL_MS {
        return false;
    }
    *last_emit = now;
    true
}

pub fn parallel_walk_repo_with_progress(
    root: &Path,
    progress: Option<ScanProgressCallback>,
) -> ParallelWalkResult {
    let ignore_patterns = parse_gitignore(root);

    if let Some(result) = git_stratified_large_repo_sample(root, &ignore_patterns, progress.clone())
    {
        return result;
    }

    let mut files: Vec<(String, u64)> = Vec::with_capacity(2048);
    let skipped_acc = AtomicUsize::new(0);
    let bytes_acc = AtomicUsize::new(0);
    let limit_hit = AtomicBool::new(false);
    let ignored_dirs: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let reported_skips: Arc<Mutex<std::collections::HashSet<String>>> =
        Arc::new(Mutex::new(std::collections::HashSet::new()));
    let root_buf = root.to_path_buf();

    emit_progress(
        &progress,
        "start",
        "Walking repository (skipping node_modules, target, .git…)…",
        0,
        0,
    );

    let root_for_cb = root_buf.clone();
    let patterns_for_cb = ignore_patterns.clone();
    let ignored_dirs_for_cb = ignored_dirs.clone();
    let reported_skips_for_cb = reported_skips.clone();
    let progress_for_cb = progress.clone();
    let mut last_progress_emit = Instant::now();

    for entry in WalkDir::new(&root_buf)
        .skip_hidden(false)
        .max_depth(12)
        .parallelism(jwalk::Parallelism::RayonDefaultPool {
            busy_timeout: Duration::from_secs(30),
        })
        .process_read_dir(move |_depth, _path, _state, children| {
            for entry in children.iter_mut() {
                let Ok(dir_entry) = entry else {
                    continue;
                };
                if !dir_entry.file_type().is_dir() {
                    continue;
                }
                let name = dir_entry.file_name().to_string_lossy().to_string();
                let rel = dir_entry
                    .path()
                    .strip_prefix(&root_for_cb)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| name.clone());

                let skip_name = should_skip_dir_name(&name);
                let skip_gitignore = is_ignored(&rel, true, &patterns_for_cb);
                if !skip_name && !skip_gitignore {
                    continue;
                }

                dir_entry.read_children_path = None;
                if let Ok(mut dirs) = ignored_dirs_for_cb.lock() {
                    if !dirs.contains(&rel) {
                        dirs.push(rel.clone());
                    }
                }
                if let Ok(mut reported) = reported_skips_for_cb.lock() {
                    if reported.insert(rel.clone()) {
                        if let Some(cb) = progress_for_cb.as_ref() {
                            cb(ScanProgress {
                                phase: "skipping",
                                detail: rel,
                                files_seen: 0,
                                files_skipped: 0,
                            });
                        }
                    }
                }
            }
        })
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if limit_hit.load(Ordering::Relaxed) {
            break;
        }

        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip_dir_name(&name) {
            if path.is_dir() {
                if let Ok(rel) = path.strip_prefix(&root_buf) {
                    let rel_s = rel.to_string_lossy().to_string();
                    if let Ok(mut dirs) = ignored_dirs.lock() {
                        if !dirs.contains(&rel_s) {
                            dirs.push(rel_s);
                        }
                    }
                }
            }
            continue;
        }

        let rel = match path.strip_prefix(&root_buf) {
            Ok(r) => r.to_string_lossy().to_string(),
            Err(_) => continue,
        };

        if entry.file_type().is_dir() {
            if is_ignored(&rel, true, &ignore_patterns) {
                continue;
            }
            continue;
        }

        if is_ignored(&rel, false, &ignore_patterns) {
            skipped_acc.fetch_add(1, Ordering::Relaxed);
            continue;
        }

        if is_binary_path(&rel) {
            skipped_acc.fetch_add(1, Ordering::Relaxed);
            continue;
        }

        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size > MAX_FILE_BYTES {
            skipped_acc.fetch_add(1, Ordering::Relaxed);
            continue;
        }

        if files.len() >= MAX_FILES {
            limit_hit.store(true, Ordering::Relaxed);
            continue;
        }
        files.push((rel.clone(), size));
        bytes_acc.fetch_add(size as usize, Ordering::Relaxed);
        let file_count = files.len();

        if should_emit_progress(&mut last_progress_emit, file_count) {
            emit_progress(
                &progress,
                "walking",
                rel,
                file_count,
                skipped_acc.load(Ordering::Relaxed),
            );
        }
    }
    let max_files_hit = files.len() >= MAX_FILES || limit_hit.load(Ordering::Relaxed);
    if files.len() > MAX_FILES {
        files.truncate(MAX_FILES);
    }

    emit_progress(
        &progress,
        "walking",
        format!("Walk complete · {} files indexed", files.len()),
        files.len(),
        skipped_acc.load(Ordering::Relaxed),
    );

    ParallelWalkResult {
        files,
        files_skipped: skipped_acc.load(Ordering::Relaxed),
        bytes_scanned: bytes_acc.load(Ordering::Relaxed) as u64,
        max_files_hit,
        estimated_total_files: None,
        tracked_files: None,
        ignored_dirs: ignored_dirs
            .lock()
            .ok()
            .map(|dirs| dirs.clone())
            .unwrap_or_default(),
    }
}

fn git_stratified_large_repo_sample(
    root: &Path,
    ignore_patterns: &[GlobPattern],
    progress: Option<ScanProgressCallback>,
) -> Option<ParallelWalkResult> {
    let tracked = git_tracked_files(root)?;
    if tracked.len() <= MAX_FILES {
        return None;
    }

    emit_progress(
        &progress,
        "walking",
        format!(
            "Large Git repo detected · sampling {} of {} tracked files",
            MAX_FILES,
            tracked.len()
        ),
        0,
        0,
    );

    let mut skipped = 0usize;
    let mut buckets: BTreeMap<String, Vec<Vec<String>>> = BTreeMap::new();
    for path in tracked.iter() {
        if !is_text_candidate(path, ignore_patterns) {
            skipped += 1;
            continue;
        }
        let rank = sample_rank(path);
        let lanes = buckets
            .entry(top_level_bucket(path))
            .or_insert_with(|| vec![Vec::new(); 6]);
        lanes[rank].push(path.clone());
    }
    for lanes in buckets.values_mut() {
        for lane in lanes {
            lane.reverse();
        }
    }

    let mut selected = Vec::with_capacity(MAX_FILES);
    let bucket_count = buckets.len().max(1);
    let base_quota = (MAX_FILES / bucket_count).clamp(8, 160);
    for lanes in buckets.values_mut() {
        for _ in 0..base_quota {
            let Some(path) = pop_best_sample(lanes) else {
                break;
            };
            selected.push(path);
            if selected.len() >= MAX_FILES {
                break;
            }
        }
        if selected.len() >= MAX_FILES {
            break;
        }
    }

    while selected.len() < MAX_FILES {
        let mut added = false;
        for lanes in buckets.values_mut() {
            if let Some(path) = pop_best_sample(lanes) {
                selected.push(path);
                added = true;
                if selected.len() >= MAX_FILES {
                    break;
                }
            }
        }
        if !added {
            break;
        }
    }

    selected.sort();

    let mut files = Vec::with_capacity(selected.len());
    let mut bytes_scanned = 0u64;
    for path in selected {
        let Ok(meta) = fs::metadata(root.join(&path)) else {
            skipped += 1;
            continue;
        };
        let size = meta.len();
        if size > MAX_FILE_BYTES {
            skipped += 1;
            continue;
        }
        bytes_scanned += size;
        files.push((path, size));
    }

    emit_progress(
        &progress,
        "walking",
        format!(
            "Representative sample complete · {} of {} tracked files indexed",
            files.len(),
            tracked.len()
        ),
        files.len(),
        skipped,
    );

    Some(ParallelWalkResult {
        files,
        files_skipped: skipped,
        bytes_scanned,
        max_files_hit: true,
        estimated_total_files: Some(tracked.len()),
        tracked_files: Some(tracked),
        ignored_dirs: Vec::new(),
    })
}

fn pop_best_sample(lanes: &mut [Vec<String>]) -> Option<String> {
    for lane in lanes.iter_mut() {
        if let Some(entry) = lane.pop() {
            return Some(entry);
        }
    }
    None
}

fn git_tracked_files(root: &Path) -> Option<Vec<String>> {
    let output = StdCommand::new("git")
        .args(["ls-files", "-z"])
        .current_dir(root)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let mut files: Vec<String> = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| String::from_utf8_lossy(path).to_string())
        .collect();
    files.sort();
    Some(files)
}

fn is_text_candidate(path: &str, ignore_patterns: &[GlobPattern]) -> bool {
    if is_binary_path(path) || is_ignored(path, false, ignore_patterns) {
        return false;
    }
    !path.split('/').any(should_skip_dir_name)
}

fn top_level_bucket(path: &str) -> String {
    path.split('/').next().unwrap_or(path).to_string()
}

fn sample_rank(path: &str) -> usize {
    let lower = path.to_ascii_lowercase();
    let name = Path::new(&lower)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    if matches!(
        name.as_str(),
        "readme.md"
            | "readme"
            | "agents.md"
            | "package.json"
            | "cargo.toml"
            | "go.mod"
            | "pyproject.toml"
            | "makefile"
            | "kconfig"
    ) {
        0
    } else if lower.ends_with("/kconfig")
        || lower.ends_with("/makefile")
        || lower.ends_with(".mk")
        || lower.ends_with(".kconfig")
    {
        1
    } else if lower.contains("/test") || lower.contains("tests/") || lower.contains("/selftests/") {
        2
    } else if lower.ends_with(".c")
        || lower.ends_with(".h")
        || lower.ends_with(".rs")
        || lower.ends_with(".ts")
        || lower.ends_with(".tsx")
        || lower.ends_with(".go")
        || lower.ends_with(".py")
    {
        3
    } else if lower.ends_with(".md") || lower.ends_with(".rst") || lower.ends_with(".txt") {
        4
    } else {
        5
    }
}

#[derive(Default)]
struct DirBuildNode {
    name: String,
    path: String,
    is_dir: bool,
    children: BTreeMap<String, DirBuildNode>,
}

/// Build a compact directory tree preview in Rust (webview never walks thousands of paths).
pub fn build_dir_tree_preview(paths: &[String], total_files: usize) -> InventoryDirNode {
    let mut root = DirBuildNode {
        name: String::new(),
        path: String::new(),
        is_dir: true,
        ..Default::default()
    };

    let mut nodes_used = 0usize;
    'paths: for raw in paths.iter().take(CLIENT_ALL_FILES_LIMIT.saturating_mul(2)) {
        let parts: Vec<&str> = raw.split('/').filter(|p| !p.is_empty()).collect();
        if parts.is_empty() {
            continue;
        }
        let mut cur = &mut root;
        for (i, part) in parts.iter().enumerate() {
            let is_last = i + 1 == parts.len();
            let full_path = parts[..=i].join("/");
            let child = cur.children.entry((*part).to_string()).or_insert_with(|| {
                nodes_used += 1;
                DirBuildNode {
                    name: (*part).to_string(),
                    path: full_path.clone(),
                    is_dir: !is_last,
                    ..Default::default()
                }
            });
            if !is_last && !child.is_dir {
                child.is_dir = true;
            }
            if nodes_used > DIR_TREE_MAX_NODES {
                break 'paths;
            }
            cur = child;
        }
    }

    fn finalize(node: &mut DirBuildNode, total_files: usize) -> InventoryDirNode {
        let mut children: Vec<InventoryDirNode> = node
            .children
            .values_mut()
            .map(|child| finalize(child, total_files))
            .collect();
        children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        });
        let file_count = if node.is_dir {
            children
                .iter()
                .map(|c| c.file_count)
                .sum::<u32>()
                .max(children.len() as u32)
        } else {
            1
        };
        InventoryDirNode {
            name: node.name.clone(),
            path: node.path.clone(),
            is_dir: node.is_dir,
            file_count: if node.path.is_empty() {
                total_files.min(u32::MAX as usize) as u32
            } else {
                file_count
            },
            children,
        }
    }

    finalize(&mut root, total_files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn dir_tree_preview_counts_files() {
        let paths = vec![
            "src/main.rs".to_string(),
            "src/lib.rs".to_string(),
            "package.json".to_string(),
        ];
        let tree = build_dir_tree_preview(&paths, 3);
        assert!(tree.is_dir);
        assert_eq!(tree.file_count, 3);
        assert!(!tree.children.is_empty());
    }

    #[test]
    fn walk_skips_node_modules_descendants() {
        let dir = std::env::temp_dir().join(format!("cv-unpack-walk-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src")).expect("mkdir src");
        fs::write(dir.join("src/main.rs"), "fn main() {}").expect("write main");
        fs::create_dir_all(dir.join("node_modules/pkg")).expect("mkdir nm");
        for i in 0..50 {
            fs::write(
                dir.join(format!("node_modules/pkg/file{i}.js")),
                "module.exports = {}",
            )
            .expect("write nm file");
        }

        let result = parallel_walk_repo_with_progress(&dir, None);
        assert!(
            result
                .files
                .iter()
                .all(|(p, _)| !p.contains("node_modules")),
            "node_modules must not be walked: {:?}",
            result.files
        );
        assert!(result
            .ignored_dirs
            .iter()
            .any(|d| d.contains("node_modules")));
        assert!(result.files.iter().any(|(p, _)| p == "src/main.rs"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn walk_keeps_descendants_of_unignored_workspace_dirs() {
        let dir =
            std::env::temp_dir().join(format!("cv-unpack-workspace-walk-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir workspace");
        fs::write(dir.join(".gitignore"), "/*\n!/README.md\n!/fleet-ops/\n")
            .expect("write gitignore");
        fs::create_dir_all(dir.join("fleet-ops/skills")).expect("mkdir fleet-ops");
        fs::create_dir_all(dir.join("ignored-app/src")).expect("mkdir ignored app");
        fs::write(dir.join("README.md"), "# Fleet").expect("write readme");
        fs::write(dir.join("fleet-ops/skills/SKILL.md"), "# Skill").expect("write skill");
        fs::write(dir.join("ignored-app/src/main.ts"), "console.log(1)").expect("write ignored");

        let result = parallel_walk_repo_with_progress(&dir, None);

        assert!(result.files.iter().any(|(p, _)| p == "README.md"));
        assert!(result
            .files
            .iter()
            .any(|(p, _)| p == "fleet-ops/skills/SKILL.md"));
        assert!(result
            .files
            .iter()
            .all(|(p, _)| !p.starts_with("ignored-app/")));

        let _ = fs::remove_dir_all(&dir);
    }
}
