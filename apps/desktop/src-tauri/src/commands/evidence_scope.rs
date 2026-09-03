//! Deterministic local scope discovery shared by Testing and Performance.
//!
//! Human phrases, exact changes, and whole-repository requests are discovery
//! inputs only. This module resolves them to closed adapter/target candidates;
//! it never executes the phrase or accepts an arbitrary command.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

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
            scored.retain(|candidate| candidate.performance_supported)
        }
    }
    let candidate_count = scored.len();
    scored.truncate(MAX_CANDIDATES);
    if candidate_count > scored.len() {
        limitations.push(format!(
            "Candidate portfolio was capped at {MAX_CANDIDATES} of {candidate_count} runnable targets."
        ));
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
        let Some(classification) = classify_target(path, has_vitest, has_playwright) else {
            continue;
        };
        let content = bounded_file_text(root, path, &mut remaining_bytes);
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
    let path = root.join(relative);
    let Ok(metadata) = path.metadata() else {
        return String::new();
    };
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES || metadata.len() > *remaining {
        return String::new();
    }
    let Ok(bytes) = std::fs::read(path) else {
        return String::new();
    };
    *remaining = remaining.saturating_sub(bytes.len() as u64);
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
        let repo = tempfile::tempdir().unwrap();
        for (relative_path, content) in fixture["repository"]["files"]
            .as_object()
            .expect("fixture files")
        {
            let path = repo.path().join(relative_path);
            std::fs::create_dir_all(path.parent().expect("fixture file parent")).unwrap();
            std::fs::write(path, content.as_str().expect("fixture file content")).unwrap();
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
