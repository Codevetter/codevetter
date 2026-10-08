//! Deterministic local scope discovery shared by Testing and Performance.
//!
//! Human phrases, exact changes, and whole-repository requests are discovery
//! inputs only. This module resolves them to closed adapter/target candidates;
//! it never executes the phrase or accepts an arbitrary command.

use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use super::structural_graph::language::SupportedLanguage;
use super::trex_preview::resolve_scope_change;

const MAX_GIT_OUTPUT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_FILES: usize = 5_000;
const MAX_CANDIDATES: usize = 12;
const MAX_UNCOVERED: usize = 24;
const MAX_INTENT_BYTES: usize = 512;
const MAX_FILE_BYTES: u64 = 128 * 1024;
const MAX_CONTENT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceScopeKind {
    Flow,
    Change,
    Codebase,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceScopeConsumer {
    Testing,
    Performance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceScopeInput {
    pub repo_path: String,
    pub kind: EvidenceScopeKind,
    pub value: Option<String>,
    pub consumer: EvidenceScopeConsumer,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceScopeCandidate {
    pub id: String,
    pub adapter: String,
    pub target: String,
    pub name: Option<String>,
    pub reason: String,
    pub source_paths: Vec<String>,
    pub confidence_milli: u16,
    pub testing_supported: bool,
    pub performance_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceScopePlan {
    pub schema_version: u32,
    pub plan_id: String,
    pub repository_revision: String,
    pub dirty: bool,
    pub kind: EvidenceScopeKind,
    pub original_input: Option<String>,
    pub consumer: EvidenceScopeConsumer,
    pub status: String,
    pub candidates: Vec<EvidenceScopeCandidate>,
    pub uncovered_paths: Vec<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone)]
struct DiscoveredTarget {
    adapter: String,
    target: String,
    name: Option<String>,
    testing_supported: bool,
    performance_supported: bool,
    content: String,
}

#[tauri::command]
pub async fn resolve_evidence_scope(
    input: EvidenceScopeInput,
) -> Result<EvidenceScopePlan, String> {
    resolve(input).await
}

pub(crate) async fn resolve(mut input: EvidenceScopeInput) -> Result<EvidenceScopePlan, String> {
    let root = canonical_repository(&input.repo_path)?;
    input.repo_path = root.to_string_lossy().into_owned();
    let original_input = normalize_intent(input.kind, input.value)?;
    if input.kind == EvidenceScopeKind::Flow
        && intent_tokens(original_input.as_deref().unwrap_or_default()).is_empty()
    {
        return Err("Describe the flow with at least one specific term".into());
    }
    let repository_revision = git_text(&root, &["rev-parse", "HEAD"]).await?;
    let dirty = !git_text(
        &root,
        &["status", "--porcelain=v1", "--untracked-files=normal"],
    )
    .await?
    .is_empty();
    let files = repository_files(&root).await?;
    let (scope_paths, mut limitations) = match input.kind {
        EvidenceScopeKind::Flow => (
            matching_paths(&root, &files, original_input.as_deref().unwrap_or_default()),
            vec![
                "Human-language scope is a deterministic local search, not model interpretation."
                    .to_string(),
            ],
        ),
        EvidenceScopeKind::Change => {
            let source = resolve_scope_change(
                &input.repo_path,
                original_input.as_deref().unwrap_or_default(),
            )
            .await?;
            (
                source.changed_paths,
                vec![format!(
                    "Change scope is pinned to {}..{}.",
                    short_revision(&source.base_sha),
                    short_revision(&source.head_sha)
                )],
            )
        }
        EvidenceScopeKind::Codebase => (
            files
                .iter()
                .filter(|path| is_source_path(path))
                .cloned()
                .collect(),
            vec![
                "Whole-codebase discovery is bounded and does not claim every behavior was exercised."
                    .to_string(),
            ],
        ),
    };
    let discovery_files = target_discovery_files(&root, input.kind, &files, &scope_paths);
    let targets = discover_targets(&root, &discovery_files);
    let mut scored = score_targets(input.kind, original_input.as_deref(), &scope_paths, targets);
    match input.consumer {
        EvidenceScopeConsumer::Testing => scored.retain(|candidate| candidate.testing_supported),
        EvidenceScopeConsumer::Performance => {
            scored.retain(|candidate| candidate.performance_supported);
            prioritize_dedicated_benchmarks(&mut scored);
        }
    }
    let candidate_count = scored.len();
    scored.truncate(MAX_CANDIDATES);
    if candidate_count > scored.len() {
        limitations.push(format!(
            "Candidate portfolio was capped at {MAX_CANDIDATES} of {candidate_count} runnable targets."
        ));
        if input.consumer == EvidenceScopeConsumer::Performance
            && scored.iter().any(is_dedicated_benchmark)
        {
            limitations.push(
                "Dedicated benchmark targets were ranked ahead of other targets with equal confidence before the cap."
                    .to_string(),
            );
        }
    }
    if files.len() == MAX_FILES {
        limitations.push(format!(
            "Repository discovery reached the {MAX_FILES}-file evidence bound."
        ));
    }
    let uncovered_paths = uncovered_paths(&scope_paths, &scored);
    let status = if scored.is_empty() {
        "no_runnable_scope"
    } else {
        "ready"
    }
    .to_string();
    let plan_id = plan_identity(
        &repository_revision,
        dirty,
        input.kind,
        original_input.as_deref(),
        input.consumer,
        &scored,
    );
    Ok(EvidenceScopePlan {
        schema_version: 1,
        plan_id,
        repository_revision,
        dirty,
        kind: input.kind,
        original_input,
        consumer: input.consumer,
        status,
        candidates: scored,
        uncovered_paths,
        limitations,
    })
}

/// Stable reorder: confidence still dominates; at equal confidence a dedicated benchmark ranks
/// first so the capped performance portfolio does not drop it for alphabetically earlier tests.
fn prioritize_dedicated_benchmarks(candidates: &mut [EvidenceScopeCandidate]) {
    candidates.sort_by_key(|candidate| {
        (
            std::cmp::Reverse(candidate.confidence_milli),
            !is_dedicated_benchmark(candidate),
        )
    });
}

fn is_dedicated_benchmark(candidate: &EvidenceScopeCandidate) -> bool {
    candidate.adapter == "go-bench"
        || candidate.target.split(['/', '.', '-', '_']).any(|token| {
            matches!(
                token.to_ascii_lowercase().as_str(),
                "bench" | "benches" | "benchmark" | "benchmarks" | "perf" | "performance"
            )
        })
}

fn canonical_repository(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if !path.is_absolute() {
        return Err("Evidence scope repository must be an absolute local path".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "Evidence scope repository is inaccessible".to_string())?;
    if !canonical.is_dir() || !canonical.join(".git").exists() {
        return Err("Evidence scope requires a local Git repository".into());
    }
    Ok(canonical)
}

fn normalize_intent(
    kind: EvidenceScopeKind,
    value: Option<String>,
) -> Result<Option<String>, String> {
    if kind == EvidenceScopeKind::Codebase {
        return Ok(None);
    }
    let value = value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .ok_or_else(|| "Evidence scope requires a flow description or exact change".to_string())?;
    if value.len() > MAX_INTENT_BYTES || value.contains(['\n', '\r', '\0']) {
        return Err("Evidence scope input is invalid or too large".into());
    }
    Ok(Some(value))
}

async fn repository_files(root: &Path) -> Result<Vec<String>, String> {
    let output = git_bytes(
        root,
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
    )
    .await?;
    let mut files = output
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .filter_map(|part| String::from_utf8(part.to_vec()).ok())
        .filter(|path| safe_relative(path) && !excluded_path(path))
        .take(MAX_FILES)
        .collect::<Vec<_>>();
    files.sort();
    files.dedup();
    Ok(files)
}

fn target_discovery_files(
    root: &Path,
    kind: EvidenceScopeKind,
    repository_files: &[String],
    scope_paths: &[String],
) -> Vec<String> {
    let mut files = repository_files.to_vec();
    if kind == EvidenceScopeKind::Change {
        files.extend(
            scope_paths
                .iter()
                .filter(|path| safe_relative(path) && !excluded_path(path))
                .filter(|path| root.join(path).is_file())
                .cloned(),
        );
    }
    files.sort();
    files.dedup();
    files
}

async fn git_text(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_bytes(root, args).await?;
    String::from_utf8(output)
        .map(|value| value.trim().to_string())
        .map_err(|_| "Git returned non-UTF-8 evidence".to_string())
}

async fn git_bytes(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Could not start Git scope discovery: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Git scope discovery stdout was unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Git scope discovery stderr was unavailable".to_string())?;
    let stdout_task = tokio::spawn(read_bounded(stdout));
    let stderr_task = tokio::spawn(read_bounded(stderr));
    let status = child
        .wait()
        .await
        .map_err(|error| format!("Could not wait for Git scope discovery: {error}"))?;
    let output = stdout_task
        .await
        .map_err(|error| format!("Git scope output reader failed: {error}"))??;
    let error = stderr_task
        .await
        .map_err(|error| format!("Git scope error reader failed: {error}"))??;
    if !status.success() {
        return Err(format!(
            "Git could not resolve the requested scope: {}",
            String::from_utf8_lossy(&error).trim()
        ));
    }
    Ok(output)
}

async fn read_bounded<R>(reader: R) -> Result<Vec<u8>, String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut bytes = Vec::new();
    reader
        .take(MAX_GIT_OUTPUT_BYTES + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| format!("Could not read Git scope evidence: {error}"))?;
    if bytes.len() as u64 > MAX_GIT_OUTPUT_BYTES {
        return Err("Git scope evidence exceeded the local bound".into());
    }
    Ok(bytes)
}

fn discover_targets(root: &Path, files: &[String]) -> Vec<DiscoveredTarget> {
    let has_vitest = files.iter().any(|path| path.starts_with("vitest.config."));
    let has_playwright = files
        .iter()
        .any(|path| path.starts_with("playwright.config."));
    let mut remaining_bytes = MAX_CONTENT_BYTES;
    let mut targets = Vec::new();
    for path in files {
        let Some(mut classification) = classify_target(path, has_vitest, has_playwright) else {
            continue;
        };
        let content = bounded_file_text(root, path, &mut remaining_bytes);
        let lower = path.to_ascii_lowercase();
        if classification.0 != "go-test" {
            // TypeScript and Playwright-path targets keep their established heuristic unless an
            // explicit Playwright or Vitest import decides the runner.
            let import_decides = classification.0 != "playwright"
                && !lower.ends_with(".ts")
                && !lower.ends_with(".tsx");
            match javascript_runner(path, &content) {
                Ok(Some(adapter))
                    if import_decides || matches!(adapter, "playwright" | "vitest") =>
                {
                    classification.0 = adapter
                }
                Ok(_) => {}
                // Conflicting runners or invalid syntax cannot support a closed choice.
                Err(()) if import_decides => continue,
                Err(()) => {}
            }
        }
        targets.push(DiscoveredTarget {
            adapter: classification.0.to_string(),
            target: path.clone(),
            name: None,
            testing_supported: classification.1,
            performance_supported: classification.2,
            content: content.clone(),
        });
        if classification.0 == "go-test" {
            if let Some(name) = first_go_benchmark(&content) {
                targets.push(DiscoveredTarget {
                    adapter: "go-bench".into(),
                    target: path.clone(),
                    name: Some(name),
                    testing_supported: false,
                    performance_supported: true,
                    content,
                });
            }
        }
    }
    targets
}

fn javascript_runner(path: &str, content: &str) -> Result<Option<&'static str>, ()> {
    let language = SupportedLanguage::from_path(Path::new(path)).ok_or(())?;
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&language.tree_sitter_language())
        .map_err(|_| ())?;
    let tree = parser.parse(content, None).ok_or(())?;
    if tree.root_node().has_error() {
        return Err(());
    }
    let mut runner = None;
    let mut cursor = tree.walk();
    loop {
        let node = cursor.node();
        if let Some(source) = runner_module_source(node, content) {
            let adapter = match source {
                "'node:test'" | "\"node:test\"" => Some("node-test"),
                "'vitest'" | "\"vitest\"" => Some("vitest"),
                "'@playwright/test'" | "\"@playwright/test\"" => Some("playwright"),
                _ => None,
            };
            if let Some(adapter) = adapter {
                if runner.is_some_and(|previous| previous != adapter) {
                    return Err(());
                }
                runner = Some(adapter);
            }
        }
        if cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                return Ok(runner);
            }
        }
    }
}

fn runner_module_source<'a>(node: tree_sitter::Node<'_>, content: &'a str) -> Option<&'a str> {
    let source = match node.kind() {
        "import_statement" => node.child_by_field_name("source")?,
        "call_expression" => {
            let function = node.child_by_field_name("function")?;
            if function.kind() != "identifier"
                || function.utf8_text(content.as_bytes()).ok()? != "require"
            {
                return None;
            }
            let arguments = node.child_by_field_name("arguments")?;
            let mut cursor = arguments.walk();
            let mut arguments = arguments
                .named_children(&mut cursor)
                .filter(|child| child.kind() != "comment");
            let source = arguments.next()?;
            if arguments.next().is_some() {
                return None;
            }
            source
        }
        _ => return None,
    };
    (source.kind() == "string")
        .then(|| source.utf8_text(content.as_bytes()).ok())
        .flatten()
}

fn classify_target(
    path: &str,
    has_vitest: bool,
    has_playwright: bool,
) -> Option<(&'static str, bool, bool)> {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with("_test.go") {
        return Some(("go-test", true, false));
    }
    let js_test = [
        ".test.js",
        ".test.mjs",
        ".test.cjs",
        ".test.ts",
        ".test.tsx",
    ]
    .iter()
    .any(|suffix| lower.ends_with(suffix));
    let js_spec = [
        ".spec.js",
        ".spec.mjs",
        ".spec.cjs",
        ".spec.ts",
        ".spec.tsx",
    ]
    .iter()
    .any(|suffix| lower.ends_with(suffix));
    if !js_test && !js_spec {
        return None;
    }
    if has_playwright
        && (lower.contains("/e2e/") || lower.starts_with("e2e/") || lower.contains("/playwright/"))
    {
        return Some(("playwright", true, true));
    }
    if has_vitest || lower.ends_with(".tsx") || lower.ends_with(".ts") {
        return Some(("vitest", true, true));
    }
    Some(("node-test", true, true))
}

fn bounded_file_text(root: &Path, relative: &str, remaining: &mut u64) -> String {
    if *remaining == 0 || !safe_relative(relative) {
        return String::new();
    }
    let Some(file) = open_regular_file_beneath(root, relative) else {
        return String::new();
    };
    let Ok(metadata) = file.metadata() else {
        return String::new();
    };
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES || metadata.len() > *remaining {
        return String::new();
    }
    bounded_reader_text(file, remaining)
}

#[cfg(unix)]
fn open_regular_file_beneath(root: &Path, relative: &str) -> Option<std::fs::File> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;

    fn open_component(
        directory: &std::fs::File,
        component: &std::ffi::OsStr,
        directory_only: bool,
    ) -> Option<std::fs::File> {
        let name = CString::new(component.as_bytes()).ok()?;
        let mut flags = libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK;
        if directory_only {
            flags |= libc::O_DIRECTORY;
        }
        // SAFETY: `directory` owns a live directory descriptor and `name` is
        // NUL-terminated. The returned descriptor is owned below on success.
        let descriptor = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
        if descriptor < 0 {
            return None;
        }
        // SAFETY: openat returned a new descriptor, transferred to this File.
        Some(unsafe { std::fs::File::from_raw_fd(descriptor) })
    }

    // `root` was canonicalized and validated as the caller-selected Git
    // repository before resolution. Anchor there, then refuse symlinks in all
    // repository-relative components so repository content cannot redirect
    // evidence reads outside the checkout.
    let mut directory = std::fs::File::open(root).ok()?;

    let mut components = Path::new(relative).components().peekable();
    while let Some(component) = components.next() {
        let Component::Normal(name) = component else {
            return None;
        };
        directory = open_component(&directory, name, components.peek().is_some())?;
    }
    directory
        .metadata()
        .ok()
        .filter(|metadata| metadata.is_file())?;
    Some(directory)
}

// Non-Unix targets currently have no descriptor-relative no-follow reader in
// this module. Fail closed rather than fall back to a canonicalize-then-open
// sequence that would reintroduce a symlink race.
#[cfg(not(unix))]
fn open_regular_file_beneath(_root: &Path, _relative: &str) -> Option<std::fs::File> {
    None
}

// Accepted aggregate payload is bounded by the initial remaining budget. Every
// consumed byte (including rejected content and probes) debits that budget;
// at most one exhausted-budget sentinel byte can exceed it. This is not a
// strict cumulative-I/O or allocator-overhead bound.
fn bounded_reader_text(reader: impl Read, remaining: &mut u64) -> String {
    if *remaining == 0 {
        return String::new();
    }
    let cap = MAX_FILE_BYTES.min(*remaining);
    let mut reader = reader.take(cap + 1);
    let mut bytes = vec![0; (cap + 1) as usize];
    let mut consumed = 0;
    while consumed < bytes.len() {
        match reader.read(&mut bytes[consumed..]) {
            Ok(0) => break,
            Ok(count) => {
                consumed += count;
                *remaining = remaining.saturating_sub(count as u64);
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return String::new(),
        }
    }
    if consumed as u64 > cap {
        return String::new();
    }
    bytes.truncate(consumed);
    bytes.shrink_to_fit();
    String::from_utf8(bytes).unwrap_or_default()
}

fn first_go_benchmark(content: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let rest = line.trim().strip_prefix("func Benchmark")?;
        let suffix = rest.split('(').next()?.trim();
        (!suffix.is_empty()).then(|| format!("Benchmark{suffix}"))
    })
}

fn matching_paths(root: &Path, files: &[String], query: &str) -> Vec<String> {
    let tokens = intent_tokens(query);
    let mut remaining = MAX_CONTENT_BYTES;
    files
        .iter()
        .filter(|path| is_source_path(path))
        .filter(|path| {
            let lower = path.to_ascii_lowercase();
            if tokens.iter().any(|token| lower.contains(token)) {
                return true;
            }
            let content = bounded_file_text(root, path, &mut remaining).to_ascii_lowercase();
            !content.is_empty() && tokens.iter().all(|token| content.contains(token))
        })
        .take(MAX_UNCOVERED * 4)
        .cloned()
        .collect()
}

fn score_targets(
    kind: EvidenceScopeKind,
    original_input: Option<&str>,
    scope_paths: &[String],
    targets: Vec<DiscoveredTarget>,
) -> Vec<EvidenceScopeCandidate> {
    let tokens = intent_tokens(original_input.unwrap_or_default());
    let mut candidates = targets
        .into_iter()
        .filter_map(|target| {
            let (score, source_paths) = target_score(kind, &tokens, scope_paths, &target);
            if kind != EvidenceScopeKind::Codebase && score == 0 {
                return None;
            }
            let confidence_milli = if kind == EvidenceScopeKind::Codebase {
                600
            } else {
                (500_u16)
                    .saturating_add((score as u16).saturating_mul(50))
                    .min(950)
            };
            let reason = candidate_reason(kind, &source_paths, score);
            let id = format!(
                "scope-{:x}",
                Sha256::digest(format!("{}:{}", target.adapter, target.target))
            );
            Some(EvidenceScopeCandidate {
                id: id[..22].to_string(),
                adapter: target.adapter,
                target: target.target,
                name: target.name,
                reason,
                source_paths,
                confidence_milli,
                testing_supported: target.testing_supported,
                performance_supported: target.performance_supported,
            })
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .confidence_milli
            .cmp(&left.confidence_milli)
            .then_with(|| left.target.cmp(&right.target))
    });
    candidates
}

fn target_score(
    kind: EvidenceScopeKind,
    tokens: &[String],
    scope_paths: &[String],
    target: &DiscoveredTarget,
) -> (usize, Vec<String>) {
    if kind == EvidenceScopeKind::Codebase {
        return (1, Vec::new());
    }
    let lower_target = target.target.to_ascii_lowercase();
    let lower_content = target.content.to_ascii_lowercase();
    let mut score = tokens
        .iter()
        .map(|token| {
            usize::from(lower_target.contains(token)) * 4
                + usize::from(lower_content.contains(token)) * 2
        })
        .sum::<usize>();
    let mut sources = Vec::new();
    for path in scope_paths {
        let relation = path_relation(path, &target.target, &lower_content);
        if relation > 0 {
            score += relation;
            if sources.len() < 6 {
                sources.push(path.clone());
            }
        }
    }
    (score, sources)
}

fn path_relation(source: &str, target: &str, target_content: &str) -> usize {
    if source == target {
        return 12;
    }
    let source_stem = normalized_stem(source);
    let target_stem = normalized_stem(target);
    let same_stem = !source_stem.is_empty()
        && (source_stem.contains(&target_stem) || target_stem.contains(&source_stem));
    let content_reference = !source_stem.is_empty() && target_content.contains(&source_stem);
    let same_parent = Path::new(source).parent() == Path::new(target).parent();
    usize::from(same_stem) * 8 + usize::from(content_reference) * 5 + usize::from(same_parent) * 2
}

fn normalized_stem(path: &str) -> String {
    let stem = Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    stem.replace(".test", "")
        .replace(".spec", "")
        .replace("_test", "")
        .replace(['-', '_'], "")
}

fn candidate_reason(kind: EvidenceScopeKind, sources: &[String], score: usize) -> String {
    match kind {
        EvidenceScopeKind::Codebase => {
            "Repository-owned executable target discovered locally".into()
        }
        EvidenceScopeKind::Flow => format!(
            "Matched the described flow through local path/content evidence (score {score})"
        ),
        EvidenceScopeKind::Change => {
            if sources.is_empty() {
                "Executable target matched the exact change".into()
            } else {
                format!("Covers changed path {}", sources[0])
            }
        }
    }
}

fn uncovered_paths(scope_paths: &[String], candidates: &[EvidenceScopeCandidate]) -> Vec<String> {
    let covered = candidates
        .iter()
        .flat_map(|candidate| candidate.source_paths.iter())
        .collect::<BTreeSet<_>>();
    scope_paths
        .iter()
        .filter(|path| !covered.contains(path))
        .take(MAX_UNCOVERED)
        .cloned()
        .collect()
}

fn plan_identity(
    revision: &str,
    dirty: bool,
    kind: EvidenceScopeKind,
    original: Option<&str>,
    consumer: EvidenceScopeConsumer,
    candidates: &[EvidenceScopeCandidate],
) -> String {
    let bytes = serde_json::to_vec(&(revision, dirty, kind, original, consumer, candidates))
        .unwrap_or_default();
    format!("scope-plan-v1:{:x}", Sha256::digest(bytes))
}

fn intent_tokens(value: &str) -> Vec<String> {
    let ignored = [
        "the", "this", "that", "flow", "function", "screen", "page", "api", "and", "for", "with",
    ];
    let mut tokens = value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .map(str::to_ascii_lowercase)
        .filter(|token| token.len() >= 3 && !ignored.contains(&token.as_str()))
        .collect::<Vec<_>>();
    tokens.sort();
    tokens.dedup();
    tokens.truncate(12);
    tokens
}

fn safe_relative(value: &str) -> bool {
    let path = Path::new(value);
    !path.is_absolute()
        && !value.is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn excluded_path(value: &str) -> bool {
    value.split('/').any(|part| {
        [
            "node_modules",
            "vendor",
            "dist",
            "build",
            "coverage",
            ".next",
            ".git",
        ]
        .contains(&part)
    })
}

fn is_source_path(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".go", ".json"]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
}

fn short_revision(value: &str) -> &str {
    value.get(..12).unwrap_or(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;

    const SURFACE_PARITY_FIXTURE: &str =
        include_str!("../../tests/fixtures/surface-parity/evidence-scope-v1.json");

    fn surface_parity_fixture() -> serde_json::Value {
        serde_json::from_str(SURFACE_PARITY_FIXTURE).expect("surface parity fixture")
    }

    fn fixture_repository() -> tempfile::TempDir {
        let fixture = surface_parity_fixture();
        let files = fixture["repository"]["files"]
            .as_object()
            .expect("fixture files")
            .iter()
            .map(|(path, content)| {
                (
                    path.clone(),
                    content.as_str().expect("fixture file content").to_string(),
                )
            })
            .collect::<Vec<_>>();
        committed_repository(&files)
    }

    fn committed_repository(files: &[(String, String)]) -> tempfile::TempDir {
        let repo = tempfile::tempdir().unwrap();
        for (relative_path, content) in files {
            let path = repo.path().join(relative_path);
            std::fs::create_dir_all(path.parent().expect("fixture file parent")).unwrap();
            std::fs::write(path, content).unwrap();
        }
        for args in [
            vec!["init", "-q"],
            vec!["add", "."],
            vec![
                "-c",
                "user.name=CodeVetter Test",
                "-c",
                "user.email=codevetter@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-qm",
                "fixture baseline",
            ],
        ] {
            assert!(StdCommand::new("git")
                .args(args)
                .current_dir(repo.path())
                .status()
                .unwrap()
                .success());
        }
        repo
    }

    #[test]
    fn mixed_runner_discovery_prefers_explicit_node_import_over_root_vitest_config() {
        let repo = tempfile::tempdir().unwrap();
        let fixtures = [
            ("vitest.config.mjs", "export default {};"),
            (
                "node.test.mjs",
                "import test from 'node:test'; test('owned smoke', () => {});",
            ),
            (
                "vitest.test.mjs",
                "import { test } from 'vitest'; test('owned smoke', () => {});",
            ),
        ];
        for (path, content) in fixtures {
            std::fs::write(repo.path().join(path), content).unwrap();
        }
        let files = fixtures
            .iter()
            .map(|(path, _)| path.to_string())
            .collect::<Vec<_>>();
        let candidates = score_targets(
            EvidenceScopeKind::Codebase,
            None,
            &[],
            discover_targets(repo.path(), &files),
        );
        assert_eq!(
            candidates
                .iter()
                .map(|candidate| (candidate.adapter.as_str(), candidate.target.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("node-test", "node.test.mjs"),
                ("vitest", "vitest.test.mjs")
            ],
        );
    }

    #[test]
    fn discovers_runner_syntax_without_literal_decoys_and_preserves_fallbacks() {
        let repo = tempfile::tempdir().unwrap();
        let fixtures = [
            (
                "node-import.test.mjs",
                "import { test as ownedTest } from \"node:test\";",
                Some("node-test"),
            ),
            (
                "node-require.test.mjs",
                "const test = require(/* owned */ 'node:test');",
                Some("node-test"),
            ),
            (
                "vitest-import.test.mjs",
                "import { test } from 'vitest';",
                Some("vitest"),
            ),
            (
                "vitest-require.test.mjs",
                "const { test } = require(\"vitest\");",
                Some("vitest"),
            ),
            (
                "node-decoys.test.mjs",
                r#"import test from 'node:test';
// import { test } from 'vitest';
/* require('vitest'); */
const text = "import { test } from 'vitest'";
const template = `require('vitest')`;
"#,
                Some("node-test"),
            ),
            (
                "vitest-decoys.test.mjs",
                r#"import { test } from 'vitest';
// import test from 'node:test';
/* require('node:test'); */
const text = "import test from 'node:test'";
const template = `require('node:test')`;
"#,
                Some("vitest"),
            ),
            (
                "fallback.test.mjs",
                r#"// import test from 'node:test';
/* require('vitest'); */
const text = "import test from 'node:test'";
const template = `import { test } from 'vitest'`;
const object = { require() {} }; object.require('node:test');
require(runnerName); require(`node:test`);
"#,
                None,
            ),
            (
                "ordinary.test.ts",
                "const count: number = 1;",
                Some("vitest"),
            ),
            ("ordinary.test.tsx", "const view = <div />;", Some("vitest")),
            (
                "typed-node.test.ts",
                "import test from 'node:test'; const count: number = 1;",
                Some("vitest"),
            ),
            (
                "assert-vitest.test.mjs",
                "import assert from 'node:assert/strict'; import {test} from 'vitest';",
                Some("vitest"),
            ),
            (
                "node-cjs.test.cjs",
                "const test = require('node:test');",
                Some("node-test"),
            ),
            (
                "node-js.test.js",
                "import test from 'node:test';",
                Some("node-test"),
            ),
            (
                "assert-only.test.mjs",
                "import assert from 'node:assert/strict';",
                None,
            ),
            (
                "e2e/node.spec.mjs",
                "import test from 'node:test';",
                Some("playwright"),
            ),
            (
                "typed-node.test.tsx",
                "import test from 'node:test'; const view = <div />;",
                Some("vitest"),
            ),
            (
                "e2e/ordinary.spec.ts",
                "test('owned', () => {});",
                Some("playwright"),
            ),
            (
                "explicit-playwright.spec.mjs",
                "import { test } from '@playwright/test';",
                Some("playwright"),
            ),
        ];
        for (path, content, _) in fixtures {
            let target = repo.path().join(path);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, content).unwrap();
        }
        for has_vitest in [false, true] {
            let mut files = fixtures
                .iter()
                .map(|(path, _, _)| path.to_string())
                .collect::<Vec<_>>();
            files.push("playwright.config.ts".into());
            if has_vitest {
                files.push("vitest.config.mjs".into());
            }
            let candidates = score_targets(
                EvidenceScopeKind::Codebase,
                None,
                &[],
                discover_targets(repo.path(), &files),
            );
            assert_eq!(candidates.len(), fixtures.len());
            for (path, _, expected) in fixtures {
                let candidate = candidates
                    .iter()
                    .find(|candidate| candidate.target == path)
                    .unwrap();
                assert_eq!(
                    candidate.adapter,
                    expected.unwrap_or(if has_vitest { "vitest" } else { "node-test" }),
                    "{path}, root Vitest config: {has_vitest}"
                );
            }
        }
    }

    #[test]
    fn explicit_playwright_and_vitest_imports_decide_typescript_and_e2e_runners() {
        let repo = tempfile::tempdir().unwrap();
        let fixtures = [
            (
                "tests/example.spec.ts",
                "import { test, expect } from '@playwright/test';\ntest('home', async ({ page }) => { await page.goto('/'); });",
                "playwright",
            ),
            (
                "tests/view.spec.tsx",
                "import { test } from '@playwright/test'; const view = <div />;",
                "playwright",
            ),
            (
                "e2e/unit.spec.ts",
                "import { test } from 'vitest'; test('pure', () => {});",
                "vitest",
            ),
            (
                "e2e/helper.spec.mjs",
                "import { test } from 'vitest'; test('pure', () => {});",
                "vitest",
            ),
            // Established TypeScript selection is preserved without an explicit runner choice.
            (
                "tests/typed.test.ts",
                "import test from 'node:test'; const count: number = 1;",
                "vitest",
            ),
            (
                "tests/broken.spec.ts",
                "import { test } from '@playwright/test'; const unfinished = (",
                "vitest",
            ),
        ];
        for (path, content, _) in fixtures {
            let target = repo.path().join(path);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, content).unwrap();
        }
        for has_playwright_config in [false, true] {
            let mut files = fixtures
                .iter()
                .map(|(path, _, _)| path.to_string())
                .collect::<Vec<_>>();
            if has_playwright_config {
                files.push("playwright.config.ts".into());
            }
            let targets = discover_targets(repo.path(), &files);
            for (path, _, expected) in fixtures {
                let target = targets
                    .iter()
                    .find(|target| target.target == path)
                    .unwrap_or_else(|| panic!("{path} was not discovered"));
                assert_eq!(
                    target.adapter, expected,
                    "{path}, Playwright config: {has_playwright_config}"
                );
            }
        }
    }

    #[test]
    fn dedicated_benchmarks_rank_first_at_equal_confidence() {
        let repo = tempfile::tempdir().unwrap();
        let mut files = (0..13)
            .map(|index| format!("a{index:02}.test.mjs"))
            .collect::<Vec<_>>();
        files.extend([
            "perfect.test.mjs".to_string(),
            "zz-render-performance.test.mjs".to_string(),
            "zz/benchmarks/parse.test.mjs".to_string(),
        ]);
        for path in &files {
            let target = repo.path().join(path);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, "import test from 'node:test';").unwrap();
        }
        let mut candidates = score_targets(
            EvidenceScopeKind::Codebase,
            None,
            &[],
            discover_targets(repo.path(), &files),
        );
        prioritize_dedicated_benchmarks(&mut candidates);
        candidates.truncate(MAX_CANDIDATES);
        let targets = candidates
            .iter()
            .map(|candidate| candidate.target.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            &targets[..3],
            [
                "zz-render-performance.test.mjs",
                "zz/benchmarks/parse.test.mjs",
                "a00.test.mjs"
            ]
        );
        assert!(!targets.contains(&"perfect.test.mjs"));

        let mut ranked = vec![
            EvidenceScopeCandidate {
                confidence_milli: 900,
                ..candidates[2].clone()
            },
            EvidenceScopeCandidate {
                confidence_milli: 600,
                ..candidates[0].clone()
            },
        ];
        prioritize_dedicated_benchmarks(&mut ranked);
        assert_eq!(
            ranked[0].target, "a00.test.mjs",
            "confidence still dominates"
        );
    }

    #[tokio::test]
    async fn capped_performance_portfolio_keeps_dedicated_benchmarks() {
        let mut files = (0..13)
            .map(|index| {
                (
                    format!("a{index:02}.test.mjs"),
                    "import test from 'node:test';".to_string(),
                )
            })
            .collect::<Vec<_>>();
        files.push((
            "zz-render-performance.test.mjs".into(),
            "import test from 'node:test';".into(),
        ));
        let repo = committed_repository(&files);
        let input = |consumer| EvidenceScopeInput {
            repo_path: repo.path().to_string_lossy().into_owned(),
            kind: EvidenceScopeKind::Codebase,
            value: None,
            consumer,
        };
        let performance = resolve(input(EvidenceScopeConsumer::Performance))
            .await
            .unwrap();
        assert_eq!(performance.candidates.len(), MAX_CANDIDATES);
        assert_eq!(
            performance.candidates[0].target,
            "zz-render-performance.test.mjs"
        );
        assert!(performance
            .limitations
            .iter()
            .any(|entry| entry.starts_with("Dedicated benchmark targets were ranked")));

        let testing = resolve(input(EvidenceScopeConsumer::Testing))
            .await
            .unwrap();
        assert_eq!(testing.candidates[0].target, "a00.test.mjs");
        assert!(!testing
            .limitations
            .iter()
            .any(|entry| entry.starts_with("Dedicated benchmark")));
    }

    #[test]
    fn uncertain_runner_evidence_is_not_discovered_as_a_confident_candidate() {
        let repo = tempfile::tempdir().unwrap();
        for content in [
            "import test from 'node:test'; import { it } from 'vitest';",
            "const test = require('node:test'); const { it } = require('vitest');",
            "import test from 'node:test",
            "import test from 'node:test'; const unfinished = (",
            "require('vitest'",
        ] {
            std::fs::write(repo.path().join("uncertain.test.mjs"), content).unwrap();
            let candidates = score_targets(
                EvidenceScopeKind::Codebase,
                None,
                &[],
                discover_targets(
                    repo.path(),
                    &["vitest.config.mjs".into(), "uncertain.test.mjs".into()],
                ),
            );
            assert!(candidates.is_empty(), "{content}");
        }
    }

    #[test]
    fn bounded_reader_accepts_valid_content_and_debits_bytes() {
        let mut remaining = 20;
        assert_eq!(
            bounded_reader_text(
                std::io::Cursor::new("coupon total".as_bytes().to_vec()),
                &mut remaining
            ),
            "coupon total"
        );
        assert_eq!(remaining, 8);
    }

    #[test]
    fn bounded_reader_accepts_exact_file_cap_and_rejects_oversize() {
        for length in [MAX_FILE_BYTES, MAX_FILE_BYTES + 1, MAX_FILE_BYTES + 100] {
            let mut reader = std::io::Cursor::new(vec![b'a'; length as usize]);
            let mut remaining = MAX_CONTENT_BYTES;
            let content = bounded_reader_text(&mut reader, &mut remaining);
            let consumed = length.min(MAX_FILE_BYTES + 1);
            assert_eq!(reader.position(), consumed);
            assert_eq!(remaining, MAX_CONTENT_BYTES - consumed);
            if length == MAX_FILE_BYTES {
                assert_eq!(content, "a".repeat(MAX_FILE_BYTES as usize));
            } else {
                assert!(content.is_empty());
            }
        }
    }

    #[test]
    fn bounded_reader_does_not_read_with_exhausted_budget() {
        let mut reader = std::io::Cursor::new(b"unread".to_vec());
        let mut remaining = 0;
        assert!(bounded_reader_text(&mut reader, &mut remaining).is_empty());
        assert_eq!(reader.position(), 0);
        assert_eq!(remaining, 0);
    }

    #[test]
    fn bounded_reader_enforces_remaining_budget_with_one_sentinel() {
        let mut remaining = 3;
        assert_eq!(
            bounded_reader_text(std::io::Cursor::new(b"abc".to_vec()), &mut remaining),
            "abc"
        );
        assert_eq!(remaining, 0);

        let mut reader = std::io::Cursor::new(b"abcdef".to_vec());
        let mut remaining = 3;
        assert!(bounded_reader_text(&mut reader, &mut remaining).is_empty());
        assert_eq!(reader.position(), 4);
        assert_eq!(remaining, 0);
        assert!(bounded_reader_text(&mut reader, &mut remaining).is_empty());
        assert_eq!(reader.position(), 4);
    }

    #[test]
    fn bounded_reader_debits_invalid_utf8() {
        let mut remaining = 10;
        assert!(
            bounded_reader_text(std::io::Cursor::new(vec![b'a', 0xff]), &mut remaining).is_empty()
        );
        assert_eq!(remaining, 8);
    }

    #[test]
    fn bounded_reader_debits_partial_reads_before_failure() {
        struct FailingReader(std::io::Cursor<Vec<u8>>);

        impl Read for FailingReader {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                if self.0.position() == 3 {
                    return Err(std::io::Error::other("synthetic read failure"));
                }
                let length = buffer.len().min(3);
                Read::read(&mut self.0, &mut buffer[..length])
            }
        }

        let reader = FailingReader(std::io::Cursor::new(b"abcdef".to_vec()));
        let mut remaining = 10;
        assert!(bounded_reader_text(reader, &mut remaining).is_empty());
        assert_eq!(remaining, 7);
    }

    #[cfg(unix)]
    #[test]
    fn bounded_file_text_rejects_final_and_parent_symlinks() {
        use std::os::unix::fs::symlink;

        let fixture = tempfile::tempdir().unwrap();
        let repo = fixture.path().join("repo");
        let outside = fixture.path().join("outside");
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let sentinel = "fabricated-outside-scope-sentinel";
        std::fs::write(outside.join("source.test.mjs"), sentinel).unwrap();
        std::fs::write(repo.join("regular.test.mjs"), "owned regular source").unwrap();
        symlink(
            outside.join("source.test.mjs"),
            repo.join("linked.test.mjs"),
        )
        .unwrap();
        symlink(&outside, repo.join("linked-parent")).unwrap();

        let mut remaining = MAX_CONTENT_BYTES;
        assert_eq!(
            bounded_file_text(&repo, "regular.test.mjs", &mut remaining),
            "owned regular source"
        );
        let after_regular = remaining;
        assert!(bounded_file_text(&repo, "linked.test.mjs", &mut remaining).is_empty());
        assert!(
            bounded_file_text(&repo, "linked-parent/source.test.mjs", &mut remaining).is_empty()
        );
        assert_eq!(remaining, after_regular);
    }

    #[test]
    fn classifies_supported_javascript_and_go_targets() {
        assert_eq!(
            classify_target("src/cart.test.ts", true, false),
            Some(("vitest", true, true))
        );
        assert_eq!(
            classify_target("tests/e2e/checkout.spec.ts", false, true),
            Some(("playwright", true, true))
        );
        assert_eq!(
            classify_target("checkout_test.go", false, false),
            Some(("go-test", true, false))
        );
    }

    #[test]
    fn human_intent_is_tokenized_without_generic_flow_words() {
        assert_eq!(
            intent_tokens("The checkout coupon calculation flow"),
            vec!["calculation", "checkout", "coupon"]
        );
    }

    #[test]
    fn related_source_and_test_paths_receive_a_strong_score() {
        assert!(
            path_relation(
                "src/checkout/coupon.ts",
                "src/checkout/coupon.test.ts",
                "import './coupon'"
            ) >= 8
        );
    }

    #[test]
    fn changed_tests_survive_the_repository_file_cap() {
        let repo = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(repo.path().join("scripts/context-retrieval")).unwrap();
        std::fs::create_dir_all(repo.path().join("apps/desktop/scripts")).unwrap();
        std::fs::write(
            repo.path()
                .join("scripts/context-retrieval/abandon.test.mjs"),
            "test('abandon retrieval arm', () => {});\n",
        )
        .unwrap();
        std::fs::write(
            repo.path()
                .join("apps/desktop/scripts/archaeology-reviewer-effort.test.mjs"),
            "test('codevetter review', () => {});\n",
        )
        .unwrap();
        let changed = vec!["scripts/context-retrieval/abandon.test.mjs".to_string()];
        let files = target_discovery_files(
            repo.path(),
            EvidenceScopeKind::Change,
            &["apps/desktop/scripts/archaeology-reviewer-effort.test.mjs".to_string()],
            &changed,
        );
        let candidates = score_targets(
            EvidenceScopeKind::Change,
            Some("https://github.com/Codevetter/codevetter/pull/173"),
            &changed,
            discover_targets(repo.path(), &files),
        );
        assert_eq!(
            candidates
                .first()
                .map(|candidate| candidate.target.as_str()),
            Some("scripts/context-retrieval/abandon.test.mjs")
        );
    }

    #[test]
    fn rejects_multiline_or_missing_human_scope() {
        assert!(normalize_intent(EvidenceScopeKind::Flow, Some("bad\ncommand".into())).is_err());
        assert!(normalize_intent(EvidenceScopeKind::Change, None).is_err());
        assert_eq!(
            normalize_intent(EvidenceScopeKind::Codebase, Some("ignored".into())).unwrap(),
            None
        );
        assert!(intent_tokens("the function flow").is_empty());
    }

    #[tokio::test]
    async fn testing_and_performance_resolve_the_same_local_flow_identity() {
        let repo = fixture_repository();
        let input = |consumer| EvidenceScopeInput {
            repo_path: repo.path().to_string_lossy().into_owned(),
            kind: EvidenceScopeKind::Flow,
            value: Some("coupon total".into()),
            consumer,
        };
        let testing = resolve(input(EvidenceScopeConsumer::Testing))
            .await
            .unwrap();
        let performance = resolve(input(EvidenceScopeConsumer::Performance))
            .await
            .unwrap();
        assert_eq!(testing.status, "ready");
        assert_eq!(testing.candidates[0].id, performance.candidates[0].id);
        assert_eq!(testing.candidates[0].target, "src/cart/coupon.test.ts");
        assert_eq!(testing.repository_revision, performance.repository_revision);

        let portfolio = resolve(EvidenceScopeInput {
            repo_path: repo.path().to_string_lossy().into_owned(),
            kind: EvidenceScopeKind::Codebase,
            value: None,
            consumer: EvidenceScopeConsumer::Testing,
        })
        .await
        .unwrap();
        assert_eq!(portfolio.candidates.len(), 1);
        assert!(portfolio.limitations[0].contains("bounded"));
    }

    #[tokio::test]
    async fn authoritative_resolver_matches_the_shared_surface_parity_fixture() {
        let fixture = surface_parity_fixture();
        let request = &fixture["request"];
        let expected = &fixture["expected"];
        let repo = fixture_repository();
        let plan = resolve(EvidenceScopeInput {
            repo_path: repo.path().to_string_lossy().into_owned(),
            kind: serde_json::from_value(request["kind"].clone()).expect("fixture kind"),
            value: request["value"].as_str().map(str::to_string),
            consumer: serde_json::from_value(request["consumer"].clone())
                .expect("fixture consumer"),
        })
        .await
        .expect("surface parity plan");

        assert_eq!(plan.schema_version, expected["schema_version"]);
        assert_eq!(plan.status, expected["status"]);
        assert_eq!(plan.candidates.len(), expected["candidate_count"]);
        let candidate = plan.candidates.first().expect("fixture candidate");
        let expected_candidate = &expected["first_candidate"];
        assert_eq!(candidate.id, expected_candidate["id"]);
        assert_eq!(candidate.adapter, expected_candidate["adapter"]);
        assert_eq!(candidate.target, expected_candidate["target"]);
        assert_eq!(
            candidate.confidence_milli,
            expected_candidate["confidence_milli"]
        );
        assert_eq!(
            candidate.testing_supported,
            expected_candidate["testing_supported"]
        );
        assert_eq!(
            candidate.performance_supported,
            expected_candidate["performance_supported"]
        );
        assert!(plan
            .limitations
            .iter()
            .any(|limitation| limitation.contains(
                expected["limitation_contains"]
                    .as_str()
                    .expect("fixture limitation")
            )));

        let canonical: EvidenceScopePlan =
            serde_json::from_value(fixture["canonical_receipt"].clone())
                .expect("canonical fixture receipt");
        assert_eq!(canonical.schema_version, plan.schema_version);
        assert_eq!(canonical.kind, plan.kind);
        assert_eq!(canonical.consumer, plan.consumer);
        assert_eq!(canonical.status, plan.status);
        assert_eq!(canonical.candidates[0].id, candidate.id);
        assert_eq!(canonical.candidates[0].target, candidate.target);
    }

    #[tokio::test]
    async fn generic_flow_words_fail_closed() {
        let repo = fixture_repository();
        let error = resolve(EvidenceScopeInput {
            repo_path: repo.path().to_string_lossy().into_owned(),
            kind: EvidenceScopeKind::Flow,
            value: Some("the function flow".into()),
            consumer: EvidenceScopeConsumer::Testing,
        })
        .await
        .unwrap_err();
        assert!(error.contains("specific term"));
    }
}
