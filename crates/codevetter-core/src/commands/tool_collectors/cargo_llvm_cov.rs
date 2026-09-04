use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::process::Command;

use super::{
    elapsed_ms, error_result, error_result_with_tool, execute_bounded, git_text,
    resolve_rust_manifest, tool_identity, CollectorKind, CollectorResult, CollectorStatus,
    ProductBinary, TrexSourceReceipt, MAX_REPORT_BYTES, MAX_STDERR_BYTES,
};

const COVERAGE_TIMEOUT: Duration = Duration::from_secs(600);
const MAX_REGION_ROWS: usize = 20_000;
const MAX_REGION_REPORT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Serialize)]
struct FileCoverage {
    path: String,
    executable_changed_lines: usize,
    covered_changed_lines: usize,
    uncovered_lines: Vec<u64>,
    missing_from_lcov: bool,
}

#[derive(Debug, Serialize)]
struct ChangedRegion {
    path: String,
    line: u64,
    column: u64,
    execution_count: u64,
}

pub(super) async fn run(
    binary: &ProductBinary,
    repo: &Path,
    source: &TrexSourceReceipt,
    requested_manifest: Option<&Path>,
    requested_test: Option<&str>,
    started: Instant,
) -> CollectorResult {
    let identity = match tool_identity(CollectorKind::CargoLlvmCov, binary).await {
        Ok(identity) => identity,
        Err(error) => return error_result(CollectorKind::CargoLlvmCov, started, error),
    };
    let manifest = match resolve_rust_manifest(repo, requested_manifest) {
        Ok(manifest) => manifest,
        Err(reason) => return unavailable_with_tool(started, identity, reason),
    };
    let test_name = match validate_test_name(requested_test) {
        Ok(test_name) => test_name,
        Err(reason) => return unavailable_with_tool(started, identity, reason),
    };
    let changed = match changed_rust_lines(repo, source) {
        Ok(changed) if !changed.is_empty() => changed,
        Ok(_) => {
            return unavailable_with_tool(
                started,
                identity,
                "The resolved change contains no eligible changed Rust source lines".into(),
            )
        }
        Err(error) => {
            return error_result_with_tool(
                CollectorKind::CargoLlvmCov,
                started,
                identity.clone(),
                error,
            )
        }
    };
    let scratch = match CoverageScratch::create() {
        Ok(scratch) => scratch,
        Err(error) => {
            return error_result_with_tool(
                CollectorKind::CargoLlvmCov,
                started,
                identity.clone(),
                format!("create private coverage directory: {error}"),
            )
        }
    };
    let environment = match coverage_environment(repo, scratch.path()) {
        Ok(environment) => environment,
        Err(reason) => return unavailable_with_tool(started, identity, reason),
    };

    let lcov = match run_report(binary, &manifest, test_name, "--lcov", false, &environment).await {
        Ok(output) => output,
        Err(RunFailure::Unavailable(reason)) => {
            return unavailable_with_tool(started, identity, reason)
        }
        Err(RunFailure::Error(error)) => {
            return error_result_with_tool(
                CollectorKind::CargoLlvmCov,
                started,
                identity.clone(),
                error,
            )
        }
    };
    let json_report =
        match run_report(binary, &manifest, test_name, "--json", true, &environment).await {
            Ok(output) => output,
            Err(RunFailure::Unavailable(reason)) => {
                return unavailable_with_tool(started, identity, reason)
            }
            Err(RunFailure::Error(error)) => {
                return error_result_with_tool(
                    CollectorKind::CargoLlvmCov,
                    started,
                    identity.clone(),
                    error,
                )
            }
        };
    let lcov_report = match parse_lcov(repo, &lcov.stdout) {
        Ok(report) => report,
        Err(error) => {
            return error_result_with_tool(
                CollectorKind::CargoLlvmCov,
                started,
                identity.clone(),
                error,
            )
        }
    };
    let files = build_changed_line_evidence(&changed, &lcov_report.lines);
    let regions = match parse_changed_regions(repo, &json_report.stdout, &changed) {
        Ok(regions) => regions,
        Err(error) => {
            return error_result_with_tool(CollectorKind::CargoLlvmCov, started, identity, error)
        }
    };
    let executable = files
        .iter()
        .map(|file| file.executable_changed_lines)
        .sum::<usize>();
    let covered = files
        .iter()
        .map(|file| file.covered_changed_lines)
        .sum::<usize>();
    let finding_count = executable.saturating_sub(covered);
    let status = if finding_count == 0 {
        CollectorStatus::Clean
    } else {
        CollectorStatus::Findings
    };
    CollectorResult {
        collector: CollectorKind::CargoLlvmCov,
        status,
        duration_ms: elapsed_ms(started),
        tool: Some(identity),
        finding_count,
        evidence: json!({
            "manifest": manifest.strip_prefix(repo).unwrap_or(&manifest).to_string_lossy(),
            "test_target": test_name,
            "network_policy": "cargo --offline --frozen plus CARGO_NET_OFFLINE=true",
            "changed_line_coverage": {
                "executable": executable,
                "covered": covered,
                "percent": if executable == 0 { Value::Null } else { json!((covered as f64 / executable as f64) * 100.0) },
                "files": files,
            },
            "changed_regions": regions,
            "lcov_records": {
                "total": lcov_report.records_total,
                "outside_repository": lcov_report.records_outside_repo,
            },
            "region_report_sha256": format!("{:x}", Sha256::digest(&json_report.stdout)),
            "region_report_bytes": json_report.stdout.len(),
            "process_exit_codes": [lcov.code, json_report.code],
            "scratch_cleanup": "private temporary target removed on completion",
        }),
        limitations: vec![
            "LCOV has line granularity; changed LLVM region rows are retained separately".into(),
        ],
    }
}

struct CoverageScratch {
    path: PathBuf,
}

impl CoverageScratch {
    fn create() -> std::io::Result<Self> {
        let path = std::env::temp_dir().join(format!(
            "codevetter-cargo-llvm-cov-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&path)?;
        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for CoverageScratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn unavailable_with_tool(
    started: Instant,
    identity: super::CollectorToolIdentity,
    reason: String,
) -> CollectorResult {
    CollectorResult {
        collector: CollectorKind::CargoLlvmCov,
        status: CollectorStatus::Unavailable,
        duration_ms: elapsed_ms(started),
        tool: Some(identity),
        finding_count: 0,
        evidence: json!({"preflight": "unavailable"}),
        limitations: vec![reason],
    }
}

fn validate_test_name(value: Option<&str>) -> Result<&str, String> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "An explicit --rust-test target is required for Rust coverage".to_string()
        })?;
    if value.len() > 128
        || value.starts_with('-')
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
        })
    {
        return Err("--rust-test must be one bounded Cargo test-target name".into());
    }
    Ok(value)
}

fn coverage_environment(repo: &Path, scratch: &Path) -> Result<Vec<(String, String)>, String> {
    let inherited = std::env::var_os("PATH")
        .ok_or_else(|| "Rust coverage requires an available Rust toolchain PATH".to_string())?;
    let mut directories = Vec::new();
    for directory in std::env::split_paths(&inherited) {
        if !directory.is_absolute() {
            continue;
        }
        let canonical = match directory.canonicalize() {
            Ok(canonical) => canonical,
            Err(_) => continue,
        };
        if !canonical.starts_with(repo) && !directories.contains(&canonical) {
            directories.push(canonical);
        }
    }
    if !directories
        .iter()
        .any(|directory| directory.join("cargo").is_file())
    {
        return Err("Rust coverage requires Cargo in a non-repository toolchain path".into());
    }
    let path = std::env::join_paths(&directories)
        .map_err(|_| "Rust coverage could not construct a safe toolchain PATH".to_string())?
        .to_string_lossy()
        .into_owned();
    Ok(vec![
        ("PATH".into(), path),
        ("NO_COLOR".into(), "1".into()),
        ("CARGO_NET_OFFLINE".into(), "true".into()),
        ("CARGO_LLVM_COV_SETUP".into(), "no".into()),
        ("GIT_TERMINAL_PROMPT".into(), "0".into()),
        (
            "CARGO_TARGET_DIR".into(),
            scratch.join("target").to_string_lossy().into_owned(),
        ),
        (
            "CARGO_LLVM_COV_TARGET_DIR".into(),
            scratch
                .join("llvm-cov-target")
                .to_string_lossy()
                .into_owned(),
        ),
    ])
}

enum RunFailure {
    Unavailable(String),
    Error(String),
}

async fn run_report(
    binary: &ProductBinary,
    manifest: &Path,
    test_name: &str,
    format: &str,
    report_only: bool,
    environment: &[(String, String)],
) -> Result<super::ProcessOutput, RunFailure> {
    let mut command = Command::new(&binary.path);
    command.arg("llvm-cov");
    if report_only {
        command.arg("report");
    }
    command.args([format, "--manifest-path"]).arg(manifest);
    if !report_only {
        command.args(["--test", test_name]);
    }
    command
        .args(["--offline", "--frozen", "--color", "never"])
        .current_dir(manifest.parent().expect("manifest parent"))
        .env_clear()
        .envs(environment.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let stdout_limit = if format == "--json" {
        MAX_REGION_REPORT_BYTES
    } else {
        MAX_REPORT_BYTES
    };
    let output = execute_bounded(command, COVERAGE_TIMEOUT, stdout_limit, MAX_STDERR_BYTES)
        .await
        .map_err(RunFailure::Error)?;
    if output.code == 0 {
        return Ok(output);
    }
    Err(classify_run_failure(output.code, &output.stderr))
}

fn classify_run_failure(code: i32, stderr: &[u8]) -> RunFailure {
    let diagnostic = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if diagnostic.contains("llvm-tools-preview") {
        RunFailure::Unavailable(
            "Rust coverage requires the preinstalled llvm-tools-preview component".into(),
        )
    } else {
        // Compiler diagnostics can contain repository source lines. Keep them
        // out of the persisted receipt while retaining an actionable class.
        RunFailure::Error(format!(
            "cargo-llvm-cov execution failed with exit code {code}"
        ))
    }
}

fn changed_rust_lines(
    repo: &Path,
    source: &TrexSourceReceipt,
) -> Result<BTreeMap<String, BTreeSet<u64>>, String> {
    let range = format!("{}..{}", source.base_sha, source.head_sha);
    let diff = git_text(
        repo,
        &[
            "diff",
            "--unified=0",
            "--no-ext-diff",
            "--no-color",
            &range,
            "--",
            "*.rs",
        ],
    )?;
    parse_added_rust_lines(&diff)
}

fn parse_added_rust_lines(diff: &str) -> Result<BTreeMap<String, BTreeSet<u64>>, String> {
    let mut result = BTreeMap::<String, BTreeSet<u64>>::new();
    let mut current_file = None::<String>;
    let mut new_line = None::<u64>;
    let mut old_remaining = 0_u64;
    let mut new_remaining = 0_u64;
    for line in diff.lines() {
        if old_remaining > 0 || new_remaining > 0 {
            if line == "\\ No newline at end of file" {
                continue;
            }
            if line.starts_with('+') && new_remaining > 0 {
                let line_number = new_line
                    .ok_or_else(|| "Git diff hunk omitted the current new line".to_string())?;
                if let Some(path) = &current_file {
                    if looks_executable(&line[1..]) {
                        result.entry(path.clone()).or_default().insert(line_number);
                    }
                }
                new_line = Some(line_number.saturating_add(1));
                new_remaining -= 1;
            } else if line.starts_with('-') && old_remaining > 0 {
                old_remaining -= 1;
            } else {
                old_remaining = old_remaining.saturating_sub(1);
                let had_new_line = new_remaining > 0;
                new_remaining = new_remaining.saturating_sub(1);
                if had_new_line {
                    new_line = new_line.map(|value| value.saturating_add(1));
                }
            }
            continue;
        }
        if let Some(path) = line.strip_prefix("+++ b/") {
            current_file = Some(super::normalize_relative_path(path)?);
            new_line = None;
        } else if line.starts_with("+++ ") {
            current_file = None;
            new_line = None;
        } else if line.starts_with("@@ ") {
            let (old_count, start, count) = parse_hunk_counts(line)?;
            old_remaining = old_count;
            new_remaining = count;
            new_line = Some(start);
        }
    }
    Ok(result)
}

fn parse_hunk_counts(line: &str) -> Result<(u64, u64, u64), String> {
    let mut ranges = line
        .split_ascii_whitespace()
        .filter(|part| part.starts_with('-') || part.starts_with('+'));
    let old = ranges
        .next()
        .ok_or_else(|| "Git diff hunk omitted the old range".to_string())?;
    let new = ranges
        .next()
        .ok_or_else(|| "Git diff hunk omitted the new range".to_string())?;
    let parse = |range: &str, marker: char| -> Result<(u64, u64), String> {
        let mut values = range.trim_start_matches(marker).split(',');
        let start = values
            .next()
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or_else(|| "Git diff returned an invalid hunk range".to_string())?;
        let count = values
            .next()
            .map(|value| value.parse::<u64>())
            .transpose()
            .map_err(|_| "Git diff returned an invalid hunk count".to_string())?
            .unwrap_or(1);
        Ok((start, count))
    };
    let (_, old_count) = parse(old, '-')?;
    let (new_start, new_count) = parse(new, '+')?;
    Ok((old_count, new_start, new_count))
}

fn looks_executable(line: &str) -> bool {
    let trimmed = line.trim();
    !trimmed.is_empty()
        && !trimmed.starts_with("//")
        && !trimmed.starts_with("/*")
        && !trimmed.starts_with('*')
        && !matches!(trimmed, "{" | "}" | "};" | ");" | "]" | "],")
        && !trimmed.starts_with("use ")
        && !trimmed.starts_with("mod ")
        && !trimmed.starts_with("#[")
}

struct LcovReport {
    lines: BTreeMap<String, BTreeMap<u64, u64>>,
    records_total: usize,
    records_outside_repo: usize,
}

fn parse_lcov(repo: &Path, bytes: &[u8]) -> Result<LcovReport, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "LCOV report was not UTF-8")?;
    let mut result = BTreeMap::<String, BTreeMap<u64, u64>>::new();
    let mut current = None::<String>;
    let mut records_total = 0_usize;
    let mut records_outside_repo = 0_usize;
    for line in text.lines() {
        if let Some(filename) = line.strip_prefix("SF:") {
            records_total += 1;
            current = normalize_report_path(repo, filename);
            if current.is_none() {
                records_outside_repo += 1;
            }
        } else if let (Some(path), Some(data)) = (&current, line.strip_prefix("DA:")) {
            let mut parts = data.split(',');
            let line_number = parts.next().and_then(|value| value.parse::<u64>().ok());
            let count = parts.next().and_then(|value| value.parse::<u64>().ok());
            let (Some(line_number), Some(count)) = (line_number, count) else {
                return Err("LCOV report contained an invalid DA record".into());
            };
            result
                .entry(path.clone())
                .or_default()
                .entry(line_number)
                .and_modify(|value| *value = (*value).max(count))
                .or_insert(count);
        } else if line == "end_of_record" {
            current = None;
        }
    }
    Ok(LcovReport {
        lines: result,
        records_total,
        records_outside_repo,
    })
}

fn normalize_report_path(repo: &Path, value: &str) -> Option<String> {
    let canonical_repo = repo.canonicalize().ok()?;
    let candidate = PathBuf::from(value);
    let canonical = if candidate.is_absolute() {
        candidate.canonicalize().ok()?
    } else {
        canonical_repo.join(candidate).canonicalize().ok()?
    };
    let relative = canonical.strip_prefix(&canonical_repo).ok()?.to_path_buf();
    super::normalize_relative_path(&relative.to_string_lossy()).ok()
}

fn build_changed_line_evidence(
    changed: &BTreeMap<String, BTreeSet<u64>>,
    lcov: &BTreeMap<String, BTreeMap<u64, u64>>,
) -> Vec<FileCoverage> {
    changed
        .iter()
        .map(|(path, candidates)| {
            let covered_file = lcov.get(path);
            let executable = match covered_file {
                Some(lines) => candidates
                    .iter()
                    .copied()
                    .filter(|line| lines.contains_key(line))
                    .collect::<Vec<_>>(),
                None => candidates.iter().copied().collect::<Vec<_>>(),
            };
            let uncovered_lines = executable
                .iter()
                .copied()
                .filter(|line| {
                    covered_file
                        .and_then(|lines| lines.get(line))
                        .copied()
                        .unwrap_or(0)
                        == 0
                })
                .collect::<Vec<_>>();
            FileCoverage {
                path: path.clone(),
                executable_changed_lines: executable.len(),
                covered_changed_lines: executable.len().saturating_sub(uncovered_lines.len()),
                uncovered_lines,
                missing_from_lcov: covered_file.is_none(),
            }
        })
        .collect()
}

fn parse_changed_regions(
    repo: &Path,
    bytes: &[u8],
    changed: &BTreeMap<String, BTreeSet<u64>>,
) -> Result<Vec<ChangedRegion>, String> {
    let report: Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("parse cargo-llvm-cov region report: {error}"))?;
    let files = report
        .pointer("/data/0/files")
        .and_then(Value::as_array)
        .ok_or_else(|| "cargo-llvm-cov region report omitted files".to_string())?;
    let mut regions = Vec::new();
    for file in files {
        let Some(path) = file
            .get("filename")
            .and_then(Value::as_str)
            .and_then(|value| normalize_report_path(repo, value))
        else {
            continue;
        };
        let Some(changed_lines) = changed.get(&path) else {
            continue;
        };
        for segment in file
            .get("segments")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(values) = segment.as_array() else {
                continue;
            };
            let line = values.first().and_then(Value::as_u64).unwrap_or(0);
            let column = values.get(1).and_then(Value::as_u64).unwrap_or(0);
            let count = values.get(2).and_then(Value::as_u64).unwrap_or(0);
            let has_count = values.get(3).and_then(Value::as_bool).unwrap_or(false);
            let is_region_entry = values.get(4).and_then(Value::as_bool).unwrap_or(false);
            if has_count && is_region_entry && changed_lines.contains(&line) {
                if regions.len() >= MAX_REGION_ROWS {
                    return Err("Changed LLVM region evidence exceeded its bound".into());
                }
                regions.push(ChangedRegion {
                    path: path.clone(),
                    line,
                    column,
                    execution_count: count,
                });
            }
        }
    }
    regions.sort_by(|left, right| {
        (&left.path, left.line, left.column).cmp(&(&right.path, right.line, right.column))
    });
    Ok(regions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_added_rust_lines_without_counting_comments_or_imports() {
        let diff = r#"diff --git a/src/lib.rs b/src/lib.rs
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,0 +2,6 @@
+// explanation
+use std::path::Path;
+pub fn answer() -> u64 {
+    42
+}
+
"#;
        let lines = parse_added_rust_lines(diff).expect("diff");
        assert_eq!(lines["src/lib.rs"], BTreeSet::from([4_u64, 5_u64]));
    }

    #[test]
    fn diff_hunk_counts_preserve_plus_prefixed_source_and_ignore_eof_markers() {
        let diff = r#"diff --git a/src/lib.rs b/src/lib.rs
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1 +1,3 @@
-old()
+++plus_prefixed()
+next()
+last()
\ No newline at end of file
"#;
        let lines = parse_added_rust_lines(diff).expect("diff");
        assert_eq!(lines["src/lib.rs"], BTreeSet::from([1_u64, 2_u64, 3_u64]));
    }

    #[test]
    fn absent_lcov_file_is_conservatively_uncovered() {
        let changed = BTreeMap::from([
            ("src/covered.rs".into(), BTreeSet::from([2_u64, 3_u64])),
            ("src/absent.rs".into(), BTreeSet::from([1_u64])),
        ]);
        let lcov = BTreeMap::from([(
            "src/covered.rs".into(),
            BTreeMap::from([(2_u64, 1_u64), (3_u64, 0_u64)]),
        )]);
        let files = build_changed_line_evidence(&changed, &lcov);
        assert_eq!(files[0].uncovered_lines, vec![1]);
        assert!(files[0].missing_from_lcov);
        assert_eq!(files[1].covered_changed_lines, 1);
        assert_eq!(files[1].uncovered_lines, vec![3]);
    }

    #[test]
    fn lcov_and_regions_are_bounded_to_repository_changed_paths() {
        let repo = tempfile::tempdir().expect("repo");
        let source = repo.path().join("src/lib.rs");
        std::fs::create_dir_all(source.parent().unwrap()).expect("src");
        std::fs::write(&source, "pub fn answer() -> u64 { 42 }\n").expect("source");
        let lcov = format!(
            "SF:{}\nDA:1,2\nend_of_record\nSF:/outside/private.rs\nDA:1,1\nend_of_record\n",
            source.display()
        );
        let parsed = parse_lcov(repo.path(), lcov.as_bytes()).expect("lcov");
        assert_eq!(parsed.lines.len(), 1);
        assert_eq!(parsed.records_total, 2);
        assert_eq!(parsed.records_outside_repo, 1);
        let changed = BTreeMap::from([("src/lib.rs".into(), BTreeSet::from([1_u64]))]);
        let regions = format!(
            r#"{{"data":[{{"files":[{{"filename":"{}","segments":[[1,8,2,true,true,false]]}},{{"filename":"/outside/private.rs","segments":[[1,1,1,true,true,false]]}}]}}]}}"#,
            source.display()
        );
        let parsed =
            parse_changed_regions(repo.path(), regions.as_bytes(), &changed).expect("regions");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].execution_count, 2);
    }

    #[test]
    fn report_paths_reject_symlink_escape() {
        let repo = tempfile::tempdir().expect("repo");
        let outside = tempfile::tempdir().expect("outside");
        let outside_source = outside.path().join("private.rs");
        std::fs::write(&outside_source, "pub fn private() {}\n").expect("outside source");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside_source, repo.path().join("escaped.rs"))
                .expect("escape symlink");
            assert_eq!(normalize_report_path(repo.path(), "escaped.rs"), None);
        }
    }

    #[test]
    fn run_failure_classification_is_bounded_and_drops_source_diagnostics() {
        match classify_run_failure(
            1,
            b"error: component llvm-tools-preview is missing at /private/repo/src/lib.rs",
        ) {
            RunFailure::Unavailable(reason) => {
                assert_eq!(
                    reason,
                    "Rust coverage requires the preinstalled llvm-tools-preview component"
                );
                assert!(!reason.contains("/private/repo"));
            }
            RunFailure::Error(_) => panic!("expected unavailable"),
        }
        match classify_run_failure(
            101,
            b"error[E0000]: private_source_line(); at /private/repo/src/lib.rs",
        ) {
            RunFailure::Error(reason) => {
                assert_eq!(reason, "cargo-llvm-cov execution failed with exit code 101");
                assert!(!reason.contains("private_source_line"));
            }
            RunFailure::Unavailable(_) => panic!("expected error"),
        }
    }
}
