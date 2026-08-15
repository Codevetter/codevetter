//! Closed desktop bridge to CodeVetter's existing local performance runtime.
//!
//! This module deliberately accepts structured fields instead of commands or
//! argument arrays. The Node runtime remains the single source of truth for
//! planning, profiling, diagnosis, and paired verification contracts.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use super::secret_policy::redact_secret_text;

const MAX_OUTPUT_BYTES: u64 = 512 * 1024;
const MAX_TEXT_BYTES: usize = 8 * 1024;
const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_NAME_BYTES: usize = 256;
const MIN_TIMEOUT_MS: u64 = 100;
const MAX_TIMEOUT_MS: u64 = 120_000;
const MAX_SAMPLES: u8 = 10;
const MAX_WARMUPS: u8 = 5;

#[derive(Default)]
pub struct PerformanceRunRegistry {
    cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PerformanceOperation {
    Test,
    Plan,
    Diagnose,
    Inspect,
    VerifyPaired,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PerformanceAdapter {
    GoTest,
    NodeTest,
    NodeScript,
    Vitest,
    Playwright,
    GoBench,
}

impl PerformanceAdapter {
    fn as_cli_value(self) -> &'static str {
        match self {
            Self::GoTest => "go-test",
            Self::NodeTest => "node-test",
            Self::NodeScript => "node-script",
            Self::Vitest => "vitest",
            Self::Playwright => "playwright",
            Self::GoBench => "go-bench",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceRunInput {
    pub request_id: String,
    pub operation: PerformanceOperation,
    pub repo_path: String,
    pub adapter: Option<PerformanceAdapter>,
    pub target: Option<String>,
    pub name: Option<String>,
    pub samples: Option<u8>,
    pub warmups: Option<u8>,
    pub timeout_ms: Option<u64>,
    pub subject_run_id: Option<String>,
    pub baseline_repo_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceCleanupReceipt {
    pub owned_process_reaped: bool,
    pub temporary_profiles_retained: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceRunReceipt {
    pub schema_version: u32,
    pub request_id: String,
    pub operation: PerformanceOperation,
    pub state: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub result: Value,
    pub stderr_summary: Option<String>,
    pub cleanup: PerformanceCleanupReceipt,
}

#[derive(Debug, Clone, Serialize)]
struct PerformanceProgress {
    request_id: String,
    operation: PerformanceOperation,
    stage: &'static str,
}

#[tauri::command]
pub async fn run_local_performance(
    app: AppHandle,
    registry: State<'_, PerformanceRunRegistry>,
    input: PerformanceRunInput,
) -> Result<PerformanceRunReceipt, String> {
    let validated = validate_input(input)?;
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut runs = registry
            .cancellations
            .lock()
            .map_err(|_| "Performance run registry is unavailable".to_string())?;
        if runs.contains_key(&validated.request_id) {
            return Err("A performance run already uses this request id".to_string());
        }
        runs.insert(validated.request_id.clone(), Arc::clone(&cancellation));
    }

    let _guard = RegistryGuard {
        registry: registry.inner(),
        request_id: validated.request_id.clone(),
    };
    emit_progress(&app, &validated, "started");
    let receipt = execute(&app, &validated, cancellation).await;
    emit_progress(
        &app,
        &validated,
        if receipt
            .as_ref()
            .is_ok_and(|value| value.state == "cancelled")
        {
            "cancelled"
        } else {
            "completed"
        },
    );
    receipt
}

#[tauri::command]
pub fn cancel_local_performance(
    registry: State<'_, PerformanceRunRegistry>,
    request_id: String,
) -> Result<bool, String> {
    validate_request_id(&request_id)?;
    let runs = registry
        .cancellations
        .lock()
        .map_err(|_| "Performance run registry is unavailable".to_string())?;
    let Some(flag) = runs.get(&request_id) else {
        return Ok(false);
    };
    flag.store(true, Ordering::SeqCst);
    Ok(true)
}

struct RegistryGuard<'a> {
    registry: &'a PerformanceRunRegistry,
    request_id: String,
}

impl Drop for RegistryGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut runs) = self.registry.cancellations.lock() {
            runs.remove(&self.request_id);
        }
    }
}

fn emit_progress(app: &AppHandle, input: &PerformanceRunInput, stage: &'static str) {
    let _ = app.emit(
        "performance-run-progress",
        PerformanceProgress {
            request_id: input.request_id.clone(),
            operation: input.operation,
            stage,
        },
    );
}

async fn execute(
    app: &AppHandle,
    input: &PerformanceRunInput,
    cancellation: Arc<AtomicBool>,
) -> Result<PerformanceRunReceipt, String> {
    let started = Instant::now();
    let cli_path = resolve_cli_path(app)?;
    let args = build_arguments(input)?;
    ensure_node_available().await?;

    let mut command = Command::new("node");
    command
        .arg(&cli_path)
        .args(&args)
        .current_dir(&input.repo_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    inherit_safe_environment(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start the local performance runtime: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Performance runtime stdout was unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Performance runtime stderr was unavailable".to_string())?;
    let stdout_task = tokio::spawn(read_bounded(stdout));
    let stderr_task = tokio::spawn(read_bounded(stderr));
    let overall_timeout = overall_timeout(input);
    let deadline = tokio::time::Instant::now() + overall_timeout;
    let mut cancelled = false;
    let status = loop {
        if cancellation.load(Ordering::SeqCst) {
            cancelled = true;
            child
                .kill()
                .await
                .map_err(|error| format!("Could not stop the performance runtime: {error}"))?;
            break child
                .wait()
                .await
                .map_err(|error| format!("Could not reap the performance runtime: {error}"))?;
        }
        if tokio::time::Instant::now() >= deadline {
            child.kill().await.map_err(|error| {
                format!("Could not stop the timed-out performance runtime: {error}")
            })?;
            let status = child.wait().await.map_err(|error| {
                format!("Could not reap the timed-out performance runtime: {error}")
            })?;
            let stdout_bytes = stdout_task.await.map_err(join_error)??;
            let stderr_bytes = stderr_task.await.map_err(join_error)??;
            return Ok(no_confidence_receipt(
                input,
                started,
                status.code(),
                "The bounded desktop performance operation timed out.",
                &stderr_bytes,
                Some(&stdout_bytes),
            ));
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Could not inspect the performance runtime: {error}"))?
        {
            break status;
        }
        tokio::time::sleep(Duration::from_millis(75)).await;
    };

    let stdout_bytes = stdout_task.await.map_err(join_error)??;
    let stderr_bytes = stderr_task.await.map_err(join_error)??;
    if cancelled {
        return Ok(PerformanceRunReceipt {
            schema_version: 1,
            request_id: input.request_id.clone(),
            operation: input.operation,
            state: "cancelled".into(),
            exit_code: status.code(),
            duration_ms: elapsed_ms(started),
            result: json!({
                "schema_version": "desktop-performance-cancelled/v1",
                "verdict": { "status": "no_confidence" },
                "limitations": ["The user cancelled the local performance operation."]
            }),
            stderr_summary: sanitize_summary(&stderr_bytes, &input.repo_path),
            cleanup: cleanup_receipt(),
        });
    }

    receipt_from_output(
        input,
        status.code(),
        elapsed_ms(started),
        &stdout_bytes,
        &stderr_bytes,
    )
}

fn receipt_from_output(
    input: &PerformanceRunInput,
    exit_code: Option<i32>,
    duration_ms: u64,
    stdout: &[u8],
    stderr: &[u8],
) -> Result<PerformanceRunReceipt, String> {
    let mut result: Value = serde_json::from_slice(stdout).map_err(|_| {
        "The local performance runtime returned malformed or excessive output".to_string()
    })?;
    sanitize_result(&mut result, &input.repo_path);
    let state = match exit_code {
        Some(0) => "succeeded",
        Some(1) => "completed_with_rejection",
        _ => "no_confidence",
    };
    Ok(PerformanceRunReceipt {
        schema_version: 1,
        request_id: input.request_id.clone(),
        operation: input.operation,
        state: state.into(),
        exit_code,
        duration_ms,
        result,
        stderr_summary: sanitize_summary(stderr, &input.repo_path),
        cleanup: cleanup_receipt(),
    })
}

async fn read_bounded<R>(reader: R) -> Result<Vec<u8>, String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut bytes = Vec::new();
    reader
        .take(MAX_OUTPUT_BYTES + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| format!("Could not read performance runtime output: {error}"))?;
    if bytes.len() as u64 > MAX_OUTPUT_BYTES {
        return Err("Performance runtime output exceeded the desktop bound".to_string());
    }
    Ok(bytes)
}

fn join_error(error: tokio::task::JoinError) -> String {
    format!("Performance output reader failed: {error}")
}

fn validate_input(mut input: PerformanceRunInput) -> Result<PerformanceRunInput, String> {
    validate_request_id(&input.request_id)?;
    input.repo_path = canonical_directory(&input.repo_path, "repository")?;
    if let Some(baseline) = input.baseline_repo_path.as_ref() {
        input.baseline_repo_path = Some(canonical_directory(baseline, "baseline repository")?);
    }
    if let Some(target) = input.target.as_ref() {
        validate_relative_target(target)?;
    }
    if let Some(name) = input.name.as_ref() {
        if name.trim().is_empty()
            || name.len() > MAX_NAME_BYTES
            || name.contains('\n')
            || name.contains('\r')
        {
            return Err("Performance workload name is invalid".to_string());
        }
    }
    if let Some(samples) = input.samples {
        if !(2..=MAX_SAMPLES).contains(&samples) {
            return Err(format!("Samples must be between 2 and {MAX_SAMPLES}"));
        }
    }
    if input.warmups.is_some_and(|warmups| warmups > MAX_WARMUPS) {
        return Err(format!("Warmups must be between 0 and {MAX_WARMUPS}"));
    }
    if input
        .timeout_ms
        .is_some_and(|value| !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&value))
    {
        return Err(format!(
            "Timeout must be between {MIN_TIMEOUT_MS} and {MAX_TIMEOUT_MS} milliseconds"
        ));
    }
    match input.operation {
        PerformanceOperation::Test => {
            require_scope(&input)?;
            if input.adapter == Some(PerformanceAdapter::NodeScript)
                || input.adapter == Some(PerformanceAdapter::GoBench)
            {
                return Err("Testing requires a correctness adapter".to_string());
            }
        }
        PerformanceOperation::Plan | PerformanceOperation::Diagnose => {
            require_scope(&input)?;
            require_performance_adapter(&input)?;
        }
        PerformanceOperation::VerifyPaired => {
            require_scope(&input)?;
            require_performance_adapter(&input)?;
            if input.baseline_repo_path.is_none() {
                return Err("Paired verification requires a baseline repository".to_string());
            }
        }
        PerformanceOperation::Inspect => {
            validate_subject_run_id(input.subject_run_id.as_deref())?;
        }
    }
    Ok(input)
}

fn require_performance_adapter(input: &PerformanceRunInput) -> Result<(), String> {
    if input.adapter == Some(PerformanceAdapter::GoTest) {
        return Err("Performance operations require a profiling adapter".to_string());
    }
    Ok(())
}

fn require_scope(input: &PerformanceRunInput) -> Result<(), String> {
    if input.adapter.is_none() || input.target.is_none() {
        return Err("Performance operation requires an adapter and relative target".to_string());
    }
    Ok(())
}

fn validate_request_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_REQUEST_ID_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Performance request id is invalid".to_string());
    }
    Ok(())
}

fn validate_subject_run_id(value: Option<&str>) -> Result<(), String> {
    let value = value.ok_or_else(|| "Inspect requires a performance run id".to_string())?;
    validate_request_id(value)
}

fn validate_relative_target(value: &str) -> Result<(), String> {
    let path = Path::new(value);
    if value.trim().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Performance target must be a contained repository-relative path".to_string());
    }
    Ok(())
}

fn canonical_directory(value: &str, label: &str) -> Result<String, String> {
    let path = Path::new(value);
    if !path.is_absolute() {
        return Err(format!(
            "Performance {label} must be an absolute local path"
        ));
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| format!("Performance {label} does not exist or is inaccessible"))?;
    if !canonical.is_dir() {
        return Err(format!("Performance {label} must be a directory"));
    }
    Ok(canonical.to_string_lossy().into_owned())
}

fn build_arguments(input: &PerformanceRunInput) -> Result<Vec<String>, String> {
    let operation = match input.operation {
        PerformanceOperation::Test => "run",
        PerformanceOperation::Plan => "plan-performance",
        PerformanceOperation::Diagnose => "diagnose-performance",
        PerformanceOperation::Inspect => "inspect-performance-run",
        PerformanceOperation::VerifyPaired => "verify-paired-optimization",
    };
    let mut args = vec![operation.into(), "--repo".into(), input.repo_path.clone()];
    if input.operation == PerformanceOperation::Inspect {
        args.extend([
            "--run-id".into(),
            input
                .subject_run_id
                .clone()
                .ok_or_else(|| "Inspect requires a performance run id".to_string())?,
        ]);
        args.push("--json".into());
        return Ok(args);
    }
    let adapter = input
        .adapter
        .ok_or_else(|| "Performance adapter is required".to_string())?;
    args.extend(["--adapter".into(), adapter.as_cli_value().into()]);
    args.extend([
        "--target".into(),
        input
            .target
            .clone()
            .ok_or_else(|| "Performance target is required".to_string())?,
    ]);
    if input.operation == PerformanceOperation::Test {
        if let Some(name) = input.name.as_ref() {
            args.extend(["--name".into(), name.clone()]);
        }
        if let Some(timeout) = input.timeout_ms {
            args.extend(["--timeout-ms".into(), timeout.to_string()]);
        }
        args.push("--json".into());
        return Ok(args);
    }
    if let Some(name) = input.name.as_ref() {
        args.extend(["--name".into(), name.clone()]);
    }
    if let Some(samples) = input.samples {
        args.extend(["--samples".into(), samples.to_string()]);
    }
    if let Some(warmups) = input.warmups {
        args.extend(["--warmups".into(), warmups.to_string()]);
    }
    if let Some(timeout) = input.timeout_ms {
        args.extend(["--timeout-ms".into(), timeout.to_string()]);
    }
    if let Some(baseline) = input.baseline_repo_path.as_ref() {
        args.extend(["--baseline-repo".into(), baseline.clone()]);
    }
    args.push("--json".into());
    Ok(args)
}

fn resolve_cli_path(app: &AppHandle) -> Result<PathBuf, String> {
    let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../scripts/runtime-failure-capsule/cli.mjs");
    if source.is_file() {
        return source
            .canonicalize()
            .map_err(|error| format!("Could not resolve the performance runtime: {error}"));
    }
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not resolve CodeVetter resources: {error}"))?
        .join("runtime-failure-capsule/cli.mjs");
    if !bundled.is_file() {
        return Err("The packaged local performance runtime is unavailable".to_string());
    }
    Ok(bundled)
}

async fn ensure_node_available() -> Result<(), String> {
    let status = Command::new("node")
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|_| "Node.js is required to operate the local performance engine".to_string())?;
    if !status.success() {
        return Err("Node.js is required to operate the local performance engine".to_string());
    }
    Ok(())
}

fn overall_timeout(input: &PerformanceRunInput) -> Duration {
    if input.operation == PerformanceOperation::Plan
        || input.operation == PerformanceOperation::Inspect
    {
        return Duration::from_secs(20);
    }
    let workload = input.timeout_ms.unwrap_or(30_000);
    Duration::from_millis((workload.saturating_mul(20) + 10_000).min(600_000))
}

fn no_confidence_receipt(
    input: &PerformanceRunInput,
    started: Instant,
    exit_code: Option<i32>,
    message: &str,
    stderr: &[u8],
    stdout: Option<&[u8]>,
) -> PerformanceRunReceipt {
    PerformanceRunReceipt {
        schema_version: 1,
        request_id: input.request_id.clone(),
        operation: input.operation,
        state: "no_confidence".into(),
        exit_code,
        duration_ms: elapsed_ms(started),
        result: json!({
            "schema_version": "desktop-performance-error/v1",
            "verdict": { "status": "no_confidence" },
            "limitations": [message],
            "runtime_output_present": stdout.is_some_and(|value| !value.is_empty())
        }),
        stderr_summary: sanitize_summary(stderr, &input.repo_path),
        cleanup: cleanup_receipt(),
    }
}

fn sanitize_summary(bytes: &[u8], repository: &str) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    let text = String::from_utf8_lossy(bytes);
    let bounded = text.chars().take(MAX_TEXT_BYTES).collect::<String>();
    let path_sanitized = bounded.replace(repository, "<repository>");
    let (sanitized, _) = redact_secret_text(&path_sanitized);
    (!sanitized.trim().is_empty()).then(|| sanitized.trim().to_string())
}

fn inherit_safe_environment(command: &mut Command) {
    command.env_clear();
    for name in ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "USER"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command.env("CI", "1");
}

fn sanitize_result(value: &mut Value, repository: &str) {
    match value {
        Value::String(text) => {
            let path_sanitized = text.replace(repository, "<repository>");
            *text = redact_secret_text(&path_sanitized).0;
        }
        Value::Array(items) => {
            for item in items {
                sanitize_result(item, repository);
            }
        }
        Value::Object(fields) => {
            for (key, field) in fields {
                let lower = key.to_ascii_lowercase();
                if [
                    "password",
                    "secret",
                    "token",
                    "authorization",
                    "api_key",
                    "credential",
                ]
                .iter()
                .any(|marker| lower.contains(marker))
                {
                    *field = Value::String("[redacted]".into());
                } else {
                    sanitize_result(field, repository);
                }
            }
        }
        _ => {}
    }
}

fn cleanup_receipt() -> PerformanceCleanupReceipt {
    PerformanceCleanupReceipt {
        owned_process_reaped: true,
        temporary_profiles_retained: false,
    }
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().try_into().unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(repo: &Path) -> PerformanceRunInput {
        PerformanceRunInput {
            request_id: "request-1".into(),
            operation: PerformanceOperation::Plan,
            repo_path: repo.to_string_lossy().into_owned(),
            adapter: Some(PerformanceAdapter::Vitest),
            target: Some("src/example.test.ts".into()),
            name: Some("exact case".into()),
            samples: Some(3),
            warmups: Some(1),
            timeout_ms: Some(30_000),
            subject_run_id: None,
            baseline_repo_path: None,
        }
    }

    #[test]
    fn builds_only_closed_performance_arguments() {
        let repo = tempfile::tempdir().unwrap();
        let validated = validate_input(input(repo.path())).unwrap();
        let repo_path = repo
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert_eq!(
            build_arguments(&validated).unwrap(),
            vec![
                "plan-performance".to_string(),
                "--repo".to_string(),
                repo_path,
                "--adapter".to_string(),
                "vitest".to_string(),
                "--target".to_string(),
                "src/example.test.ts".to_string(),
                "--name".to_string(),
                "exact case".to_string(),
                "--samples".to_string(),
                "3".to_string(),
                "--warmups".to_string(),
                "1".to_string(),
                "--timeout-ms".to_string(),
                "30000".to_string(),
                "--json".to_string(),
            ]
        );
    }

    #[test]
    fn rejects_escaping_targets_and_invalid_bounds() {
        let repo = tempfile::tempdir().unwrap();
        let mut escaping = input(repo.path());
        escaping.target = Some("../outside.test.ts".into());
        assert!(validate_input(escaping).unwrap_err().contains("contained"));

        let mut excessive = input(repo.path());
        excessive.samples = Some(11);
        assert!(validate_input(excessive).unwrap_err().contains("Samples"));
    }

    #[test]
    fn paired_verification_requires_a_contained_baseline_repository() {
        let repo = tempfile::tempdir().unwrap();
        let mut paired = input(repo.path());
        paired.operation = PerformanceOperation::VerifyPaired;
        assert!(validate_input(paired)
            .unwrap_err()
            .contains("baseline repository"));
    }

    #[test]
    fn inspect_uses_only_the_recorded_run_identity() {
        let repo = tempfile::tempdir().unwrap();
        let mut inspect = input(repo.path());
        inspect.operation = PerformanceOperation::Inspect;
        inspect.adapter = None;
        inspect.target = None;
        inspect.subject_run_id = Some("performance-run-7".into());
        let validated = validate_input(inspect).unwrap();
        let repo_path = repo
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert_eq!(
            build_arguments(&validated).unwrap(),
            vec![
                "inspect-performance-run".to_string(),
                "--repo".to_string(),
                repo_path,
                "--run-id".to_string(),
                "performance-run-7".to_string(),
                "--json".to_string(),
            ]
        );
    }

    #[test]
    fn testing_uses_the_closed_runtime_run_operation() {
        let repo = tempfile::tempdir().unwrap();
        let mut test = input(repo.path());
        test.operation = PerformanceOperation::Test;
        test.adapter = Some(PerformanceAdapter::GoTest);
        test.target = Some("checkout_test.go".into());
        test.name = None;
        let validated = validate_input(test).unwrap();
        assert_eq!(
            build_arguments(&validated).unwrap(),
            vec![
                "run".to_string(),
                "--repo".to_string(),
                validated.repo_path,
                "--adapter".to_string(),
                "go-test".to_string(),
                "--target".to_string(),
                "checkout_test.go".to_string(),
                "--timeout-ms".to_string(),
                "30000".to_string(),
                "--json".to_string(),
            ]
        );
    }

    #[test]
    fn sanitizes_paths_and_secrets_from_runtime_results() {
        let mut result = json!({
            "source": "/repo/src/work.ts:4",
            "access_token": "secret-value",
            "message": "Authorization: Bearer abcdefghijk"
        });
        sanitize_result(&mut result, "/repo");
        assert_eq!(result["source"], "<repository>/src/work.ts:4");
        assert_eq!(result["access_token"], "[redacted]");
        assert_eq!(result["message"], "[redacted]");
    }

    #[test]
    fn desktop_receipt_preserves_the_runtime_contract_payload() {
        let repo = tempfile::tempdir().unwrap();
        let validated = validate_input(input(repo.path())).unwrap();
        let runtime_result = json!({
            "schema_version": "performance-execution-plan/v1",
            "plan_id": "a".repeat(64),
            "decision": { "status": "admitted" },
            "limitations": ["Exact fixture scope only."]
        });
        let stdout = serde_json::to_vec(&runtime_result).unwrap();
        let receipt = receipt_from_output(&validated, Some(0), 17, &stdout, b"").unwrap();
        assert_eq!(receipt.result, runtime_result);
        assert_eq!(receipt.operation, PerformanceOperation::Plan);
        assert_eq!(receipt.state, "succeeded");
        assert!(receipt.cleanup.owned_process_reaped);
        assert!(
            receipt_from_output(&validated, Some(0), 0, b"not-json", b"")
                .unwrap_err()
                .contains("malformed")
        );
    }
}
