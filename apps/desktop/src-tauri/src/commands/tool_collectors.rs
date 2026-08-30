//! Local, bounded adapters for external verification collectors.
//!
//! Collectors remain subordinate evidence. This module owns source identity,
//! process limits, redaction, and the normalized receipt; a tool exit code does
//! not become a CodeVetter verdict.

use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

use super::trex_preview::{resolve_scope_change, TrexSourceReceipt};

const GITLEAKS_VERSION: &str = "8.30.1";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_STDOUT_BYTES: usize = 256 * 1024;
const MAX_STDERR_BYTES: usize = 256 * 1024;
const MAX_REPORT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum CollectorKind {
    Gitleaks,
    CargoAudit,
    CargoLlvmCov,
}

impl CollectorKind {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "gitleaks" => Ok(Self::Gitleaks),
            "cargo-audit" => Ok(Self::CargoAudit),
            "cargo-llvm-cov" => Ok(Self::CargoLlvmCov),
            _ => Err(format!(
                "unsupported collector `{value}`; expected gitleaks, cargo-audit, or cargo-llvm-cov"
            )),
        }
    }

    fn binary_name(self) -> &'static str {
        match self {
            Self::Gitleaks => "gitleaks",
            Self::CargoAudit => "cargo-audit",
            Self::CargoLlvmCov => "cargo-llvm-cov",
        }
    }

    fn expected_version(self) -> &'static str {
        match self {
            Self::Gitleaks => GITLEAKS_VERSION,
            Self::CargoAudit => "0.22.2",
            Self::CargoLlvmCov => "0.9.0",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CollectorStatus {
    Clean,
    Findings,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CollectorToolIdentity {
    pub name: String,
    pub version: String,
    pub source: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectorResult {
    pub collector: CollectorKind,
    pub status: CollectorStatus,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<CollectorToolIdentity>,
    pub finding_count: usize,
    pub evidence: Value,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCollectionReceipt {
    pub schema_version: String,
    pub ran_at: String,
    pub repo_path: String,
    pub source: TrexSourceReceipt,
    pub collectors: Vec<CollectorResult>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ToolCollectionInput {
    pub repo_path: PathBuf,
    pub change: String,
    pub collectors: Vec<CollectorKind>,
}

#[derive(Debug, Clone, Default)]
struct ToolPaths {
    gitleaks: Option<ProductBinary>,
    cargo_audit: Option<ProductBinary>,
    cargo_llvm_cov: Option<ProductBinary>,
}

#[derive(Debug, Clone)]
struct ProductBinary {
    path: PathBuf,
    source: &'static str,
}

impl ToolPaths {
    fn product() -> Self {
        Self {
            gitleaks: resolve_product_binary(
                "CODEVETTER_GITLEAKS_BIN",
                CollectorKind::Gitleaks.binary_name(),
            ),
            cargo_audit: resolve_product_binary(
                "CODEVETTER_CARGO_AUDIT_BIN",
                CollectorKind::CargoAudit.binary_name(),
            ),
            cargo_llvm_cov: resolve_product_binary(
                "CODEVETTER_CARGO_LLVM_COV_BIN",
                CollectorKind::CargoLlvmCov.binary_name(),
            ),
        }
    }

    fn get(&self, kind: CollectorKind) -> Option<&ProductBinary> {
        match kind {
            CollectorKind::Gitleaks => self.gitleaks.as_ref(),
            CollectorKind::CargoAudit => self.cargo_audit.as_ref(),
            CollectorKind::CargoLlvmCov => self.cargo_llvm_cov.as_ref(),
        }
    }
}

pub async fn collect_tool_evidence(
    input: ToolCollectionInput,
) -> Result<ToolCollectionReceipt, String> {
    collect_tool_evidence_with_paths(input, ToolPaths::product()).await
}

async fn collect_tool_evidence_with_paths(
    input: ToolCollectionInput,
    paths: ToolPaths,
) -> Result<ToolCollectionReceipt, String> {
    if input.collectors.is_empty() {
        return Err("At least one collector is required".into());
    }
    let repo = canonical_clean_repository(&input.repo_path)?;
    let repo_text = repo.to_string_lossy().into_owned();
    let source = resolve_scope_change(&repo_text, &input.change).await?;
    require_checked_out_head(&repo, &source.head_sha)?;
    let selected = input.collectors.into_iter().collect::<BTreeSet<_>>();
    let mut collectors = Vec::with_capacity(selected.len());
    for kind in selected {
        let started = Instant::now();
        let result = match (kind, paths.get(kind)) {
            (CollectorKind::Gitleaks, Some(binary)) => {
                run_gitleaks(binary, &repo, &source, started).await
            }
            (_, Some(binary)) => preflight_only(kind, binary, started).await,
            (_, None) => unavailable(
                kind,
                started,
                format!(
                    "The pinned {} {} product binary is not bundled or explicitly provided",
                    kind.binary_name(),
                    kind.expected_version()
                ),
            ),
        };
        collectors.push(result);
    }
    let limitations = collectors
        .iter()
        .filter(|result| {
            matches!(
                result.status,
                CollectorStatus::Unavailable | CollectorStatus::Error
            )
        })
        .flat_map(|result| result.limitations.iter().cloned())
        .collect();
    Ok(ToolCollectionReceipt {
        schema_version: "codevetter.tool-collection/v1".into(),
        ran_at: chrono::Utc::now().to_rfc3339(),
        repo_path: repo_text,
        source,
        collectors,
        limitations,
    })
}

async fn run_gitleaks(
    binary: &ProductBinary,
    repo: &Path,
    source: &TrexSourceReceipt,
    started: Instant,
) -> CollectorResult {
    let identity = match tool_identity(CollectorKind::Gitleaks, binary).await {
        Ok(identity) => identity,
        Err(error) => return error_result(CollectorKind::Gitleaks, started, error),
    };
    let range = format!("{}..{}", source.base_sha, source.head_sha);
    let mut command = Command::new(&binary.path);
    command
        .args([
            "git",
            "--no-banner",
            "--no-color",
            "--redact=100",
            "--report-format",
            "json",
            "--report-path",
            "-",
        ])
        .arg("--log-opts")
        .arg(&range)
        .arg(repo)
        .current_dir(repo)
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let execution =
        execute_bounded(command, DEFAULT_TIMEOUT, MAX_REPORT_BYTES, MAX_STDERR_BYTES).await;
    let result = match execution {
        Err(error) => error_result(CollectorKind::Gitleaks, started, error),
        Ok(output) if !matches!(output.code, 0 | 1) => error_result(
            CollectorKind::Gitleaks,
            started,
            format!(
                "gitleaks exited with {}: {}",
                output.code,
                safe_diagnostic(&output.stderr)
            ),
        ),
        Ok(output) => match read_gitleaks_report(&output.stdout)
            .and_then(|findings| validate_gitleaks_attribution(findings, source))
        {
            Ok(findings) => {
                let finding_count = findings.len();
                let status = if finding_count == 0 {
                    CollectorStatus::Clean
                } else {
                    CollectorStatus::Findings
                };
                CollectorResult {
                    collector: CollectorKind::Gitleaks,
                    status,
                    duration_ms: elapsed_ms(started),
                    tool: Some(identity),
                    finding_count,
                    evidence: json!({
                        "range": range,
                        "configuration": gitleaks_configuration_identity(repo),
                        "redaction": "secret and match values dropped before normalization",
                        "findings": findings,
                        "process_exit_code": output.code,
                    }),
                    limitations: Vec::new(),
                }
            }
            Err(error) => error_result(CollectorKind::Gitleaks, started, error),
        },
    };
    result
}

async fn preflight_only(
    kind: CollectorKind,
    binary: &ProductBinary,
    started: Instant,
) -> CollectorResult {
    match tool_identity(kind, binary).await {
        Ok(identity) => CollectorResult {
            collector: kind,
            status: CollectorStatus::Unavailable,
            duration_ms: elapsed_ms(started),
            tool: Some(identity),
            finding_count: 0,
            evidence: json!({"preflight": "binary identity verified"}),
            limitations: vec![format!(
                "{} execution remains claim-closed until its offline data/toolchain prerequisite is packaged and qualified",
                kind.binary_name()
            )],
        },
        Err(error) => error_result(kind, started, error),
    }
}

async fn tool_identity(
    kind: CollectorKind,
    binary: &ProductBinary,
) -> Result<CollectorToolIdentity, String> {
    if !binary.path.is_file() {
        return Err(format!("{} binary is missing", kind.binary_name()));
    }
    let argument = match kind {
        CollectorKind::Gitleaks => "version",
        CollectorKind::CargoAudit | CollectorKind::CargoLlvmCov => "--version",
    };
    let mut command = Command::new(&binary.path);
    command
        .arg(argument)
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = execute_bounded(
        command,
        Duration::from_secs(10),
        MAX_STDOUT_BYTES,
        MAX_STDERR_BYTES,
    )
    .await?;
    if output.code != 0 {
        return Err(format!(
            "{} version probe exited with {}",
            kind.binary_name(),
            output.code
        ));
    }
    let version = String::from_utf8(output.stdout)
        .map_err(|_| format!("{} returned a non-UTF-8 version", kind.binary_name()))?;
    if !version
        .split_ascii_whitespace()
        .any(|token| token.trim_start_matches('v') == kind.expected_version())
    {
        return Err(format!(
            "{} version mismatch: expected {}, received {}",
            kind.binary_name(),
            kind.expected_version(),
            safe_diagnostic(version.as_bytes())
        ));
    }
    Ok(CollectorToolIdentity {
        name: kind.binary_name().into(),
        version: kind.expected_version().into(),
        source: binary.source.into(),
        sha256: sha256_file(&binary.path)?,
    })
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("open {} binary for identity: {error}", path.display()))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("hash {} binary: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[derive(Debug)]
struct ProcessOutput {
    code: i32,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

async fn execute_bounded(
    mut command: Command,
    timeout: Duration,
    stdout_limit: usize,
    stderr_limit: usize,
) -> Result<ProcessOutput, String> {
    let mut child = command
        .spawn()
        .map_err(|error| format!("launch collector: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "collector stdout was unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "collector stderr was unavailable".to_string())?;
    let execution = tokio::time::timeout(timeout, async {
        let (status, stdout, stderr) = tokio::join!(
            child.wait(),
            read_capped(stdout, stdout_limit),
            read_capped(stderr, stderr_limit)
        );
        (status, stdout, stderr)
    })
    .await;
    let (status, stdout, stderr) = match execution {
        Ok(output) => output,
        Err(_) => {
            let _ = child.kill().await;
            return Err(format!(
                "collector exceeded the {} second limit",
                timeout.as_secs()
            ));
        }
    };
    let status = status.map_err(|error| format!("wait for collector: {error}"))?;
    let (stdout, stdout_exceeded) =
        stdout.map_err(|error| format!("read collector stdout: {error}"))?;
    let (stderr, stderr_exceeded) =
        stderr.map_err(|error| format!("read collector stderr: {error}"))?;
    if stdout_exceeded || stderr_exceeded {
        return Err("collector output exceeded the bounded evidence limit".into());
    }
    Ok(ProcessOutput {
        code: status.code().unwrap_or(-1),
        stdout,
        stderr,
    })
}

async fn read_capped<R: AsyncRead + Unpin>(
    mut reader: R,
    limit: usize,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut output = Vec::with_capacity(limit.min(64 * 1024));
    let mut exceeded = false;
    let mut buffer = [0_u8; 8192];
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        let remaining = limit.saturating_sub(output.len());
        output.extend_from_slice(&buffer[..read.min(remaining)]);
        exceeded |= read > remaining;
    }
    Ok((output, exceeded))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawGitleaksFinding {
    #[serde(rename = "RuleID")]
    rule_id: String,
    #[serde(default)]
    description: String,
    file: String,
    #[serde(default)]
    start_line: u64,
    #[serde(default)]
    end_line: u64,
    #[serde(default)]
    commit: String,
    #[serde(default)]
    fingerprint: String,
}

#[derive(Debug, Serialize)]
struct GitleaksFinding {
    rule_id: String,
    description: String,
    file: String,
    start_line: u64,
    end_line: u64,
    commit: String,
    fingerprint: String,
}

fn read_gitleaks_report(bytes: &[u8]) -> Result<Vec<GitleaksFinding>, String> {
    if bytes.len() > MAX_REPORT_BYTES {
        return Err("gitleaks report is oversized".into());
    }
    let raw_findings: Vec<RawGitleaksFinding> =
        serde_json::from_slice(bytes).map_err(|error| format!("parse gitleaks report: {error}"))?;
    let mut findings = raw_findings
        .into_iter()
        .map(|finding| {
            Ok(GitleaksFinding {
                rule_id: safe_text(&finding.rule_id, 120),
                description: safe_text(&finding.description, 240),
                file: normalize_relative_path(&finding.file)?,
                start_line: finding.start_line,
                end_line: finding.end_line,
                commit: safe_hex(&finding.commit, 40),
                fingerprint: safe_text(&finding.fingerprint, 240),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    findings.sort_by(|left, right| {
        (&left.file, left.start_line, &left.rule_id).cmp(&(
            &right.file,
            right.start_line,
            &right.rule_id,
        ))
    });
    Ok(findings)
}

fn validate_gitleaks_attribution(
    findings: Vec<GitleaksFinding>,
    source: &TrexSourceReceipt,
) -> Result<Vec<GitleaksFinding>, String> {
    let commits = source
        .commits
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let changed_paths = source
        .changed_paths
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if findings.iter().any(|finding| {
        !commits.contains(finding.commit.as_str()) || !changed_paths.contains(finding.file.as_str())
    }) {
        return Err("gitleaks returned a finding outside the resolved change".into());
    }
    Ok(findings)
}

fn gitleaks_configuration_identity(repo: &Path) -> Value {
    for name in [".gitleaks.toml", "gitleaks.toml"] {
        let path = repo.join(name);
        if let Ok(bytes) = std::fs::read(&path) {
            return json!({
                "source": name,
                "sha256": format!("{:x}", Sha256::digest(bytes)),
            });
        }
    }
    json!({"source": "gitleaks-8.30.1-embedded-default"})
}

fn normalize_relative_path(value: &str) -> Result<String, String> {
    let normalized = value.replace('\\', "/");
    let path = Path::new(&normalized);
    if path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("gitleaks returned a non-contained finding path".into());
    }
    Ok(normalized)
}

fn canonical_clean_repository(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("repository {} is unavailable: {error}", path.display()))?;
    if !canonical.is_dir() {
        return Err("Tool collection requires a Git repository root".into());
    }
    let reported_root = git_text(&canonical, &["rev-parse", "--show-toplevel"])?;
    let reported_root = PathBuf::from(reported_root)
        .canonicalize()
        .map_err(|error| format!("canonicalize Git repository root: {error}"))?;
    if reported_root != canonical {
        return Err("Tool collection requires the Git repository root, not a subdirectory".into());
    }
    if !git_text(
        &canonical,
        &["status", "--porcelain=v1", "--untracked-files=normal"],
    )?
    .is_empty()
    {
        return Err(
            "Tool collection requires a clean checkout so evidence maps to one immutable source"
                .into(),
        );
    }
    Ok(canonical)
}

fn require_checked_out_head(repo: &Path, expected: &str) -> Result<(), String> {
    let head = git_text(repo, &["rev-parse", "HEAD"])?;
    if head != expected {
        return Err("Resolved change head is not the checked-out repository HEAD".into());
    }
    Ok(())
}

fn git_text(repo: &Path, arguments: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(arguments)
        .current_dir(repo)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Git could not inspect the local checkout: {}",
            safe_diagnostic(&output.stderr)
        ));
    }
    String::from_utf8(output.stdout)
        .map(|value| value.trim().to_string())
        .map_err(|_| "Git returned non-UTF-8 evidence".into())
}

fn resolve_product_binary(variable: &str, name: &str) -> Option<ProductBinary> {
    #[cfg(any(test, debug_assertions))]
    {
        if let Some(path) = std::env::var_os(variable).map(PathBuf::from) {
            if path.is_file() {
                return Some(ProductBinary {
                    path,
                    source: "explicit_debug_override",
                });
            }
        }
    }
    #[cfg(not(any(test, debug_assertions)))]
    let _ = variable;
    std::env::current_exe()
        .ok()
        .and_then(|executable| executable.parent().map(|parent| parent.join(name)))
        .filter(|path| path.is_file())
        .map(|path| ProductBinary {
            path,
            source: "application_bundle_sibling",
        })
}

fn unavailable(kind: CollectorKind, started: Instant, reason: String) -> CollectorResult {
    CollectorResult {
        collector: kind,
        status: CollectorStatus::Unavailable,
        duration_ms: elapsed_ms(started),
        tool: None,
        finding_count: 0,
        evidence: json!({"preflight": "unavailable"}),
        limitations: vec![reason],
    }
}

fn error_result(kind: CollectorKind, started: Instant, reason: String) -> CollectorResult {
    CollectorResult {
        collector: kind,
        status: CollectorStatus::Error,
        duration_ms: elapsed_ms(started),
        tool: None,
        finding_count: 0,
        evidence: json!({"error_category": "collector_execution"}),
        limitations: vec![safe_text(&reason, 500)],
    }
}

fn safe_diagnostic(bytes: &[u8]) -> String {
    safe_text(&String::from_utf8_lossy(bytes), 500)
}

fn safe_text(value: &str, limit: usize) -> String {
    value
        .chars()
        .filter_map(|character| match character {
            '\n' | '\r' | '\t' => Some(' '),
            value if value.is_control() => None,
            value => Some(value),
        })
        .take(limit)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn safe_hex(value: &str, limit: usize) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_hexdigit())
        .take(limit)
        .collect()
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().try_into().unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::TempDir;

    fn executable(path: &Path, contents: &str) {
        std::fs::write(path, contents).expect("write fixture executable");
        let mut permissions = std::fs::metadata(path)
            .expect("fixture metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions).expect("fixture permissions");
    }

    fn repository() -> (TempDir, String, String) {
        let directory = tempfile::tempdir().expect("temp repository");
        let repo = directory.path();
        for args in [
            vec!["init"],
            vec!["config", "user.email", "fixture@example.com"],
            vec!["config", "user.name", "Fixture"],
        ] {
            assert!(std::process::Command::new("git")
                .args(args)
                .current_dir(repo)
                .status()
                .expect("git")
                .success());
        }
        std::fs::write(repo.join("README.md"), "base\n").expect("base file");
        assert!(std::process::Command::new("git")
            .args(["add", "README.md"])
            .current_dir(repo)
            .status()
            .expect("git add")
            .success());
        assert!(std::process::Command::new("git")
            .args(["commit", "-m", "base"])
            .current_dir(repo)
            .status()
            .expect("git commit")
            .success());
        let base = git_text(repo, &["rev-parse", "HEAD"]).expect("base sha");
        std::fs::write(repo.join("README.md"), "base\nchange\n").expect("changed file");
        assert!(std::process::Command::new("git")
            .args(["add", "README.md"])
            .current_dir(repo)
            .status()
            .expect("git add")
            .success());
        assert!(std::process::Command::new("git")
            .args(["commit", "-m", "change"])
            .current_dir(repo)
            .status()
            .expect("git commit")
            .success());
        let head = git_text(repo, &["rev-parse", "HEAD"]).expect("head sha");
        (directory, base, head)
    }

    #[tokio::test]
    async fn gitleaks_receipt_drops_raw_secret_fields() {
        let (repo, base, head) = repository();
        let tools = tempfile::tempdir().expect("tool directory");
        let binary = tools.path().join("gitleaks");
        executable(
            &binary,
            r##"#!/bin/sh
if [ "$1" = "version" ]; then printf '8.30.1\n'; exit 0; fi
printf '[{"RuleID":"fixture-token","Description":"fixture","File":"README.md","StartLine":2,"EndLine":2,"Commit":"HEAD_SHA","Fingerprint":"safe-fingerprint","Secret":"must-not-survive","Match":"token=must-not-survive"}]'
exit 1
"##,
        );
        let script = std::fs::read_to_string(&binary)
            .expect("read fixture executable")
            .replace("HEAD_SHA", &head);
        executable(&binary, &script);
        let receipt = collect_tool_evidence_with_paths(
            ToolCollectionInput {
                repo_path: repo.path().into(),
                change: format!("{base}..{head}"),
                collectors: vec![CollectorKind::Gitleaks],
            },
            ToolPaths {
                gitleaks: Some(ProductBinary {
                    path: binary,
                    source: "test_fixture",
                }),
                ..ToolPaths::default()
            },
        )
        .await
        .expect("collector receipt");
        assert_eq!(receipt.collectors[0].status, CollectorStatus::Findings);
        assert_eq!(receipt.collectors[0].finding_count, 1);
        let serialized = serde_json::to_string(&receipt).expect("serialize receipt");
        assert!(!serialized.contains("must-not-survive"));
        assert!(!serialized.contains("\"Secret\""));
        assert!(!serialized.contains("\"Match\""));
    }

    #[tokio::test]
    async fn missing_product_tools_are_explicitly_unavailable() {
        let (repo, base, head) = repository();
        let receipt = collect_tool_evidence_with_paths(
            ToolCollectionInput {
                repo_path: repo.path().into(),
                change: format!("{base}..{head}"),
                collectors: vec![CollectorKind::CargoAudit, CollectorKind::CargoLlvmCov],
            },
            ToolPaths::default(),
        )
        .await
        .expect("collector receipt");
        assert!(receipt
            .collectors
            .iter()
            .all(|collector| collector.status == CollectorStatus::Unavailable));
        assert_eq!(receipt.limitations.len(), 2);
    }

    #[test]
    fn gitleaks_findings_must_belong_to_the_resolved_change() {
        let source = TrexSourceReceipt {
            kind: super::super::trex_preview::TrexChangeKind::Range,
            input: "base..head".into(),
            base_sha: "a".repeat(40),
            head_sha: "b".repeat(40),
            commits: vec!["b".repeat(40)],
            changed_paths: vec!["src/changed.rs".into()],
        };
        let finding = GitleaksFinding {
            rule_id: "fixture".into(),
            description: "fixture".into(),
            file: "src/outside.rs".into(),
            start_line: 1,
            end_line: 1,
            commit: "c".repeat(40),
            fingerprint: "fixture".into(),
        };
        assert!(validate_gitleaks_attribution(vec![finding], &source).is_err());
    }
}
