use codevetter_desktop::commands::trex_preview::{
    execute_trex_preview, TrexChangeKind, TrexPreviewReceipt, TrexPreviewRunInput,
    TrexPreviewVerdict,
};
use codevetter_desktop::{db, DbState};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const HELP: &str = "\
CodeVetter execution-backed verification

Usage:
  codevetter trex (--pr <url> | --range <base..head>) --preview <url> [--repo <path>] [--json]
  codevetter performance-lab --lab-id <id> [--continue-from <id>] [--incumbent-repo <path>] [--correctness-adapter <adapter> --correctness-target <path> --correctness-name <name>] [--repo <path>] [--max-steps <1..8>] [--warmups <0..5>] [--timeout-ms <100..120000>] [--exclude-finding-ids <ids>] [--exclude-candidate-keys <keys>] [--json]
  codevetter react-redundancy [--repo <path>] [--timeout-ms <100..120000>] [--json]
  codevetter --version

Options:
  --pr <url>       Canonical GitHub pull request URL
  --range <range>  Local base..head or base...head Git range
  --preview <url>  Existing HTTP(S) preview containing the change
  --repo <path>    Repository path (defaults to the current directory)
  --lab-id <id>    Lowercase identifier for one durable local laboratory run
  --continue-from <id>  Remeasure the exact candidate flow from a prior lab receipt
  --incumbent-repo <path>  Distinct checkout matching the predecessor snapshot
  --correctness-adapter <adapter>  Exact correctness adapter: node-test, vitest, jest, or go-test
  --correctness-target <path>  Relative file containing the exact correctness test
  --correctness-name <name>  Exact correctness test name
  --max-steps <n>  Maximum autonomous measurement steps (default: 8)
  --warmups <n>    Warmup executions per measured flow (default: 1)
  --timeout-ms <n> Per-execution timeout in milliseconds (default: 30000)
  --json           Print only the canonical receipt JSON
";

const PERFORMANCE_RUNTIME_ENTRY: &str = "runtime-failure-capsule/cli.mjs";
const MAX_RUNTIME_OUTPUT_BYTES: usize = 300 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutputMode {
    Human,
    Json,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TrexArguments {
    repo_path: PathBuf,
    change_kind: TrexChangeKind,
    change: String,
    preview_url: String,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PerformanceLabArguments {
    repo_path: PathBuf,
    lab_id: String,
    max_steps: Option<u8>,
    warmups: Option<u8>,
    timeout_ms: Option<u64>,
    excluded_finding_ids: Option<String>,
    excluded_candidate_keys: Option<String>,
    continue_from: Option<String>,
    incumbent_repo: Option<PathBuf>,
    correctness_adapter: Option<String>,
    correctness_target: Option<String>,
    correctness_name: Option<String>,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ReactRedundancyArguments {
    repo_path: PathBuf,
    timeout_ms: Option<u64>,
    output: OutputMode,
}

enum CliCommand {
    Trex(TrexArguments),
    PerformanceLab(PerformanceLabArguments),
    ReactRedundancy(ReactRedundancyArguments),
    Help,
    Version,
}

#[tokio::main]
async fn main() {
    let code = match run().await {
        Ok(code) => code,
        Err(error) => {
            eprintln!("codevetter: {error}");
            2
        }
    };
    std::process::exit(code);
}

async fn run() -> Result<i32, String> {
    let cwd = std::env::current_dir().map_err(|error| format!("current directory: {error}"))?;
    match parse_arguments(std::env::args().skip(1), &cwd)? {
        CliCommand::Help => {
            print!("{HELP}");
            Ok(0)
        }
        CliCommand::Version => {
            println!("codevetter {}", app_version());
            Ok(0)
        }
        CliCommand::Trex(arguments) => run_trex(arguments).await,
        CliCommand::PerformanceLab(arguments) => run_performance_lab(arguments),
        CliCommand::ReactRedundancy(arguments) => run_react_redundancy(arguments),
    }
}

fn app_version() -> String {
    serde_json::from_str::<serde_json::Value>(include_str!("../../tauri.conf.json"))
        .ok()
        .and_then(|config| config.get("version")?.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string())
}

async fn run_trex(arguments: TrexArguments) -> Result<i32, String> {
    let repo_path = std::fs::canonicalize(&arguments.repo_path).map_err(|error| {
        format!(
            "repository {} is unavailable: {error}",
            arguments.repo_path.display()
        )
    })?;
    let app_data_dir = default_app_data_dir()?;
    let connection = db::init_db(app_data_dir.clone())
        .map_err(|error| format!("open CodeVetter database: {error}"))?;
    let db = DbState(Arc::new(Mutex::new(connection)));
    let receipt = execute_trex_preview(
        TrexPreviewRunInput {
            repo_path: repo_path.to_string_lossy().into_owned(),
            change_kind: arguments.change_kind,
            change: arguments.change,
            preview_url: arguments.preview_url,
        },
        &db,
        app_data_dir,
        None,
    )
    .await?;

    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize T-Rex receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_receipt(&receipt)),
    }
    Ok(verdict_exit_code(receipt.verdict))
}

fn run_performance_lab(arguments: PerformanceLabArguments) -> Result<i32, String> {
    let repo_path = std::fs::canonicalize(&arguments.repo_path).map_err(|error| {
        format!(
            "repository {} is unavailable: {error}",
            arguments.repo_path.display()
        )
    })?;
    let runtime_cli = resolve_performance_runtime()?;
    let mut command = std::process::Command::new("node");
    command
        .arg(runtime_cli)
        .arg("run-performance-lab")
        .arg("--repo")
        .arg(&repo_path)
        .arg("--lab-id")
        .arg(&arguments.lab_id)
        .arg("--json")
        .current_dir(&repo_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    append_optional_argument(&mut command, "--max-steps", arguments.max_steps);
    append_optional_argument(&mut command, "--warmups", arguments.warmups);
    append_optional_argument(&mut command, "--timeout-ms", arguments.timeout_ms);
    append_optional_text(
        &mut command,
        "--exclude-finding-ids",
        arguments.excluded_finding_ids.as_deref(),
    );
    append_optional_text(
        &mut command,
        "--exclude-candidate-keys",
        arguments.excluded_candidate_keys.as_deref(),
    );
    append_optional_text(
        &mut command,
        "--continue-from",
        arguments.continue_from.as_deref(),
    );
    if let Some(value) = arguments.incumbent_repo.as_deref() {
        command.arg("--incumbent-repo").arg(value);
    }
    append_optional_text(
        &mut command,
        "--correctness-adapter",
        arguments.correctness_adapter.as_deref(),
    );
    append_optional_text(
        &mut command,
        "--correctness-target",
        arguments.correctness_target.as_deref(),
    );
    append_optional_text(
        &mut command,
        "--correctness-name",
        arguments.correctness_name.as_deref(),
    );

    let output = command.output().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "Node.js is required to run the local performance laboratory; no runtime was downloaded"
                .to_string()
        } else {
            format!("start packaged performance laboratory: {error}")
        }
    })?;
    if output.stdout.len() > MAX_RUNTIME_OUTPUT_BYTES
        || output.stderr.len() > MAX_RUNTIME_OUTPUT_BYTES
    {
        return Err(
            "packaged performance laboratory exceeded its bounded output limit".to_string(),
        );
    }
    if output.stdout.is_empty() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "packaged performance laboratory returned no receipt".to_string()
        } else {
            format!("packaged performance laboratory failed: {message}")
        });
    }
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("parse packaged performance laboratory receipt: {error}"))?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize performance laboratory receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_performance_receipt(&receipt)),
    }
    Ok(output.status.code().unwrap_or(2))
}

fn run_react_redundancy(arguments: ReactRedundancyArguments) -> Result<i32, String> {
    let repo_path = std::fs::canonicalize(&arguments.repo_path).map_err(|error| {
        format!(
            "repository {} is unavailable: {error}",
            arguments.repo_path.display()
        )
    })?;
    let runtime_cli = resolve_performance_runtime()?;
    let mut command = std::process::Command::new("node");
    command
        .arg(runtime_cli)
        .arg("inspect-react-redundancy")
        .arg("--repo")
        .arg(&repo_path)
        .arg("--json")
        .current_dir(&repo_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    append_optional_argument(&mut command, "--timeout-ms", arguments.timeout_ms);
    let output = command.output().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "Node.js is required to inspect local React redundancy; no runtime was downloaded"
                .to_string()
        } else {
            format!("start packaged React redundancy inspection: {error}")
        }
    })?;
    if output.stdout.len() > MAX_RUNTIME_OUTPUT_BYTES
        || output.stderr.len() > MAX_RUNTIME_OUTPUT_BYTES
    {
        return Err(
            "packaged React redundancy report exceeded its bounded output limit".to_string(),
        );
    }
    if output.stdout.is_empty() {
        return Err("packaged React redundancy inspection returned no report".to_string());
    }
    let report: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("parse packaged React redundancy report: {error}"))?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&report)
                .map_err(|error| format!("serialize React redundancy report: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_redundancy_report(&report)),
    }
    Ok(output.status.code().unwrap_or(2))
}

fn render_human_redundancy_report(report: &serde_json::Value) -> String {
    let status = report
        .pointer("/verdict/status")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");
    let total = report
        .pointer("/summary/total")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let screened = report
        .pointer("/summary/screened_out")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let diff_relevant = report
        .pointer("/summary/diff_relevant")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let version = report
        .pointer("/analyzer/version")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unavailable");
    let clone_version = report
        .pointer("/clone_analysis/analyzer/version")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unavailable");
    let clone_groups = report
        .pointer("/clone_analysis/coverage/clone_groups")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let mut output = format!(
        "react redundancy: {status}\nknip: {version}\njscpd: {clone_version}\nclone groups: {clone_groups}\ncandidates: {total}\ndiff relevant: {diff_relevant}\nscreened out: {screened}\n"
    );
    if let Some(candidates) = report
        .get("candidates")
        .and_then(serde_json::Value::as_array)
    {
        for candidate in candidates {
            let kind = candidate
                .get("kind")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("candidate");
            let file = candidate
                .get("file")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown");
            let symbol = candidate
                .get("symbol")
                .and_then(serde_json::Value::as_str)
                .map(|value| format!(" ({value})"))
                .unwrap_or_default();
            output.push_str(&format!("- {kind}: {file}{symbol}\n"));
        }
    }
    output
}

fn append_optional_argument<T: ToString>(
    command: &mut std::process::Command,
    flag: &str,
    value: Option<T>,
) {
    if let Some(value) = value {
        command.arg(flag).arg(value.to_string());
    }
}

fn append_optional_text(command: &mut std::process::Command, flag: &str, value: Option<&str>) {
    if let Some(value) = value {
        command.arg(flag).arg(value);
    }
}

fn resolve_performance_runtime() -> Result<PathBuf, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("resolve CodeVetter executable: {error}"))?;
    performance_runtime_candidates(&executable)
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "CodeVetter performance runtime resource is unavailable; project execution did not start"
                .to_string()
        })
}

fn performance_runtime_candidates(executable: &Path) -> Vec<PathBuf> {
    let executable_dir = executable.parent().unwrap_or_else(|| Path::new("."));
    let mut candidates = Vec::new();
    #[cfg(target_os = "macos")]
    candidates.push(
        executable_dir
            .join("../Resources")
            .join(PERFORMANCE_RUNTIME_ENTRY),
    );
    #[cfg(target_os = "windows")]
    candidates.push(executable_dir.join(PERFORMANCE_RUNTIME_ENTRY));
    #[cfg(target_os = "linux")]
    {
        if let Some(app_dir) = std::env::var_os("APPDIR") {
            candidates.push(
                PathBuf::from(app_dir)
                    .join("usr/lib/CodeVetter")
                    .join(PERFORMANCE_RUNTIME_ENTRY),
            );
        }
        candidates.push(PathBuf::from("/usr/lib/CodeVetter").join(PERFORMANCE_RUNTIME_ENTRY));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../scripts/runtime-failure-capsule/cli.mjs"),
    );
    candidates
}

fn render_human_performance_receipt(receipt: &serde_json::Value) -> String {
    let lab_id = receipt
        .get("lab_id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");
    let state = receipt
        .get("state")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");
    let steps = receipt
        .get("steps")
        .and_then(serde_json::Value::as_array)
        .map_or(0, Vec::len);
    let stop_kind = receipt
        .pointer("/stop/kind")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("none");
    let reason = receipt
        .pointer("/stop/reason")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("No stop reason was recorded.");
    format!(
        "laboratory: {lab_id}\nstate: {state}\nsteps: {steps}\nstop: {stop_kind}\nreason: {reason}\n"
    )
}

fn parse_arguments(
    arguments: impl IntoIterator<Item = String>,
    cwd: &Path,
) -> Result<CliCommand, String> {
    let mut arguments = arguments.into_iter();
    let Some(command) = arguments.next() else {
        return Ok(CliCommand::Help);
    };
    match command.as_str() {
        "--help" | "-h" | "help" => return Ok(CliCommand::Help),
        "--version" | "-V" => return Ok(CliCommand::Version),
        "performance-lab" => return parse_performance_lab_arguments(arguments, cwd),
        "react-redundancy" => return parse_react_redundancy_arguments(arguments, cwd),
        "trex" => {}
        _ => return Err(format!("unknown command `{command}`\n\n{HELP}")),
    }

    let mut repo_path = None;
    let mut pull_request = None;
    let mut range = None;
    let mut preview_url = None;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--repo" => {
                repo_path = Some(PathBuf::from(required_value(&mut arguments, "--repo")?));
            }
            "--pr" => {
                pull_request = Some(required_value(&mut arguments, "--pr")?);
            }
            "--range" => {
                range = Some(required_value(&mut arguments, "--range")?);
            }
            "--preview" => {
                preview_url = Some(required_value(&mut arguments, "--preview")?);
            }
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown trex argument `{argument}`")),
        }
    }

    let (change_kind, change) = match (pull_request, range) {
        (Some(value), None) => (TrexChangeKind::PullRequest, value),
        (None, Some(value)) => (TrexChangeKind::Range, value),
        (Some(_), Some(_)) => return Err("choose exactly one of --pr or --range".into()),
        (None, None) => return Err("one of --pr or --range is required".into()),
    };
    let preview_url = preview_url.ok_or_else(|| "--preview is required".to_string())?;
    Ok(CliCommand::Trex(TrexArguments {
        repo_path: repo_path.unwrap_or_else(|| cwd.to_path_buf()),
        change_kind,
        change,
        preview_url,
        output,
    }))
}

fn parse_react_redundancy_arguments(
    mut arguments: impl Iterator<Item = String>,
    cwd: &Path,
) -> Result<CliCommand, String> {
    let mut repo_path = None;
    let mut timeout_ms = None;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--repo" => repo_path = Some(PathBuf::from(required_value(&mut arguments, "--repo")?)),
            "--timeout-ms" => {
                timeout_ms = Some(parse_bounded_number(
                    &mut arguments,
                    "--timeout-ms",
                    100,
                    120_000,
                )?)
            }
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown react-redundancy argument `{argument}`")),
        }
    }
    Ok(CliCommand::ReactRedundancy(ReactRedundancyArguments {
        repo_path: repo_path.unwrap_or_else(|| cwd.to_path_buf()),
        timeout_ms,
        output,
    }))
}

fn parse_performance_lab_arguments(
    mut arguments: impl Iterator<Item = String>,
    cwd: &Path,
) -> Result<CliCommand, String> {
    let mut repo_path = None;
    let mut lab_id = None;
    let mut max_steps = None;
    let mut warmups = None;
    let mut timeout_ms = None;
    let mut excluded_finding_ids = None;
    let mut excluded_candidate_keys = None;
    let mut continue_from = None;
    let mut incumbent_repo = None;
    let mut correctness_adapter = None;
    let mut correctness_target = None;
    let mut correctness_name = None;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--repo" => repo_path = Some(PathBuf::from(required_value(&mut arguments, "--repo")?)),
            "--lab-id" => lab_id = Some(required_value(&mut arguments, "--lab-id")?),
            "--max-steps" => {
                max_steps = Some(parse_bounded_number(&mut arguments, "--max-steps", 1, 8)?)
            }
            "--warmups" => warmups = Some(parse_bounded_number(&mut arguments, "--warmups", 0, 5)?),
            "--timeout-ms" => {
                timeout_ms = Some(parse_bounded_number(
                    &mut arguments,
                    "--timeout-ms",
                    100,
                    120_000,
                )?)
            }
            "--exclude-finding-ids" => {
                excluded_finding_ids = Some(required_value(&mut arguments, &argument)?)
            }
            "--exclude-candidate-keys" => {
                excluded_candidate_keys = Some(required_value(&mut arguments, &argument)?)
            }
            "--continue-from" => continue_from = Some(required_value(&mut arguments, &argument)?),
            "--incumbent-repo" => {
                incumbent_repo = Some(PathBuf::from(required_value(&mut arguments, &argument)?))
            }
            "--correctness-adapter" => {
                correctness_adapter = Some(required_value(&mut arguments, &argument)?)
            }
            "--correctness-target" => {
                correctness_target = Some(required_value(&mut arguments, &argument)?)
            }
            "--correctness-name" => {
                correctness_name = Some(required_value(&mut arguments, &argument)?)
            }
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown performance-lab argument `{argument}`")),
        }
    }
    let lab_id = lab_id.ok_or_else(|| "--lab-id is required".to_string())?;
    validate_lab_id("--lab-id", &lab_id)?;
    if let Some(value) = continue_from.as_deref() {
        validate_lab_id("--continue-from", value)?;
    }
    let correctness_count = [
        correctness_adapter.is_some(),
        correctness_target.is_some(),
        correctness_name.is_some(),
    ]
    .into_iter()
    .filter(|present| *present)
    .count();
    if correctness_count != 0 && correctness_count != 3 {
        return Err("explicit correctness requires adapter, target, and name".into());
    }
    if correctness_count == 3 && incumbent_repo.is_none() {
        return Err("explicit correctness requires --incumbent-repo".into());
    }
    if incumbent_repo.is_some() && continue_from.is_none() {
        return Err("acceptance requires --continue-from".into());
    }
    if let Some(value) = correctness_adapter.as_deref() {
        if !["node-test", "vitest", "jest", "go-test"].contains(&value) {
            return Err("--correctness-adapter is unsupported".into());
        }
    }
    Ok(CliCommand::PerformanceLab(PerformanceLabArguments {
        repo_path: repo_path.unwrap_or_else(|| cwd.to_path_buf()),
        lab_id,
        max_steps,
        warmups,
        timeout_ms,
        excluded_finding_ids,
        excluded_candidate_keys,
        continue_from,
        incumbent_repo,
        correctness_adapter,
        correctness_target,
        correctness_name,
        output,
    }))
}

fn validate_lab_id(flag: &str, value: &str) -> Result<(), String> {
    if value.len() > 64
        || !value
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
        || !value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
    {
        return Err(format!(
            "{flag} must use at most 64 lowercase letters, digits, and hyphens"
        ));
    }
    Ok(())
}

fn parse_bounded_number<T>(
    arguments: &mut impl Iterator<Item = String>,
    flag: &str,
    minimum: T,
    maximum: T,
) -> Result<T, String>
where
    T: std::str::FromStr + PartialOrd + Copy + std::fmt::Display,
{
    let raw = required_value(arguments, flag)?;
    let value = raw
        .parse::<T>()
        .map_err(|_| format!("{flag} must be an integer between {minimum} and {maximum}"))?;
    if value < minimum || value > maximum {
        return Err(format!(
            "{flag} must be an integer between {minimum} and {maximum}"
        ));
    }
    Ok(value)
}

fn required_value(
    arguments: &mut impl Iterator<Item = String>,
    flag: &str,
) -> Result<String, String> {
    let value = arguments
        .next()
        .ok_or_else(|| format!("{flag} requires a value"))?;
    if value.trim().is_empty() || value.starts_with("--") {
        return Err(format!("{flag} requires a value"));
    }
    Ok(value)
}

fn default_app_data_dir() -> Result<PathBuf, String> {
    if let Some(override_dir) = std::env::var_os("CODEVETTER_APP_DATA_DIR") {
        return Ok(PathBuf::from(override_dir));
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").ok_or_else(|| "HOME is unavailable".to_string())?;
        return Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.codevetter.desktop"));
    }
    #[cfg(target_os = "windows")]
    {
        let app_data =
            std::env::var_os("APPDATA").ok_or_else(|| "APPDATA is unavailable".to_string())?;
        return Ok(PathBuf::from(app_data).join("com.codevetter.desktop"));
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        if let Some(data_home) = std::env::var_os("XDG_DATA_HOME") {
            return Ok(PathBuf::from(data_home).join("com.codevetter.desktop"));
        }
        let home = std::env::var_os("HOME").ok_or_else(|| "HOME is unavailable".to_string())?;
        Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("com.codevetter.desktop"))
    }
}

fn verdict_exit_code(verdict: TrexPreviewVerdict) -> i32 {
    match verdict {
        TrexPreviewVerdict::PassedWithLimits => 0,
        TrexPreviewVerdict::Failed => 1,
        TrexPreviewVerdict::NoConfidence => 2,
    }
}

fn render_human_receipt(receipt: &TrexPreviewReceipt) -> String {
    let verdict = match receipt.verdict {
        TrexPreviewVerdict::PassedWithLimits => "passed_with_limits",
        TrexPreviewVerdict::Failed => "failed",
        TrexPreviewVerdict::NoConfidence => "no_confidence",
    };
    let preview = serde_json::to_value(receipt.preview.status)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "unknown".into());
    let passed = receipt
        .journeys
        .iter()
        .filter(|journey| journey.pass)
        .count();
    let mut output = format!(
        "verdict: {verdict}\nhead: {}\npreview: {preview}\njourneys: {passed}/{} passed\nsummary: {}\n",
        receipt.source.head_sha,
        receipt.routes.len(),
        receipt.summary
    );
    if !receipt.limitations.is_empty() {
        output.push_str("limitations:\n");
        for limitation in &receipt.limitations {
            output.push_str(&format!("- {limitation}\n"));
        }
    }
    for journey in receipt.journeys.iter().filter(|journey| !journey.pass) {
        output.push_str(&format!("failure {}: {}\n", journey.route, journey.notes));
        if let Some(path) = &journey.screenshot_path {
            output.push_str(&format!("artifact: {path}\n"));
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use codevetter_desktop::commands::synthetic_qa::{SyntheticQaRunResult, SyntheticQaTrace};
    use codevetter_desktop::commands::trex_preview::{
        TrexPreviewIdentity, TrexPreviewIdentityStatus, TrexPreviewRoute, TrexSourceReceipt,
    };

    fn fixture_receipt(verdict: TrexPreviewVerdict) -> TrexPreviewReceipt {
        TrexPreviewReceipt {
            schema_version: 1,
            run_id: "trex-preview-cli-fixture".into(),
            repo_path: "/tmp/widget".into(),
            source: TrexSourceReceipt {
                kind: TrexChangeKind::Range,
                input: "main..HEAD".into(),
                base_sha: "a".repeat(40),
                head_sha: "b".repeat(40),
                commits: vec!["b".repeat(40)],
                changed_paths: vec!["src/pages/index.tsx".into()],
            },
            preview: TrexPreviewIdentity {
                status: TrexPreviewIdentityStatus::Claimed,
                requested_url: "https://preview.example.com".into(),
                final_url: "https://preview.example.com".into(),
                revision: None,
                evidence: "No supported revision header was returned.".into(),
            },
            routes: vec![TrexPreviewRoute {
                route: "/".into(),
                reason: "Required root smoke".into(),
            }],
            journeys: vec![SyntheticQaRunResult {
                loop_id: "generic-page-smoke".into(),
                route: "/".into(),
                goal: "smoke".into(),
                pass: verdict != TrexPreviewVerdict::Failed,
                notes: "fixture journey".into(),
                screenshot_path: None,
                artifacts: Vec::new(),
                duration_ms: 12,
                trace: SyntheticQaTrace {
                    final_url: "https://preview.example.com/".into(),
                    page_title: "Preview".into(),
                    console_errors: Vec::new(),
                    stage_timings_ms: Default::default(),
                    runner_rss_bytes: None,
                },
                error: None,
                runner_type: Some("chromiumoxide_builtin".into()),
            }],
            verdict,
            summary: "Fixture summary.".into(),
            limitations: vec!["Preview identity is claimed.".into()],
            duration_ms: 42,
            ran_at: "2026-07-29T00:00:00Z".into(),
        }
    }

    #[test]
    fn parser_defaults_to_current_repo_and_requires_one_source() {
        let cwd = Path::new("/tmp/widget");
        let CliCommand::Trex(arguments) = parse_arguments(
            [
                "trex".into(),
                "--range".into(),
                "main..HEAD".into(),
                "--preview".into(),
                "https://preview.example.com".into(),
            ],
            cwd,
        )
        .expect("arguments") else {
            panic!("expected trex");
        };
        assert_eq!(arguments.repo_path, cwd);
        assert_eq!(arguments.change_kind, TrexChangeKind::Range);
        assert_eq!(arguments.output, OutputMode::Human);

        assert!(parse_arguments(
            [
                "trex".into(),
                "--pr".into(),
                "https://github.com/acme/widget/pull/1".into(),
                "--range".into(),
                "main..HEAD".into(),
                "--preview".into(),
                "https://preview.example.com".into(),
            ],
            cwd,
        )
        .is_err());
        assert!(parse_arguments(
            [
                "trex".into(),
                "--preview".into(),
                "https://preview.example.com".into(),
            ],
            cwd,
        )
        .is_err());
    }

    #[test]
    fn parser_preserves_explicit_repo_pr_and_json_mode() {
        let CliCommand::Trex(arguments) = parse_arguments(
            [
                "trex".into(),
                "--repo".into(),
                "/tmp/other".into(),
                "--pr".into(),
                "https://github.com/acme/widget/pull/42".into(),
                "--preview".into(),
                "https://preview.example.com".into(),
                "--json".into(),
            ],
            Path::new("/tmp/widget"),
        )
        .expect("arguments") else {
            panic!("expected trex");
        };
        assert_eq!(arguments.repo_path, Path::new("/tmp/other"));
        assert_eq!(arguments.change_kind, TrexChangeKind::PullRequest);
        assert_eq!(arguments.output, OutputMode::Json);
    }

    #[test]
    fn performance_lab_parser_keeps_a_closed_bounded_surface() {
        let cwd = Path::new("/tmp/widget");
        let CliCommand::PerformanceLab(arguments) = parse_arguments(
            [
                "performance-lab".into(),
                "--lab-id".into(),
                "agent-pass-1".into(),
                "--max-steps".into(),
                "4".into(),
                "--warmups".into(),
                "2".into(),
                "--timeout-ms".into(),
                "45000".into(),
                "--exclude-finding-ids".into(),
                "0123456789abcdef01234567".into(),
                "--continue-from".into(),
                "agent-pass-0".into(),
                "--incumbent-repo".into(),
                "/tmp/incumbent".into(),
                "--correctness-adapter".into(),
                "vitest".into(),
                "--correctness-target".into(),
                "src/work.test.ts".into(),
                "--correctness-name".into(),
                "does work".into(),
                "--json".into(),
            ],
            cwd,
        )
        .expect("performance arguments") else {
            panic!("expected performance laboratory");
        };
        assert_eq!(arguments.repo_path, cwd);
        assert_eq!(arguments.lab_id, "agent-pass-1");
        assert_eq!(arguments.max_steps, Some(4));
        assert_eq!(arguments.warmups, Some(2));
        assert_eq!(arguments.timeout_ms, Some(45_000));
        assert_eq!(arguments.continue_from.as_deref(), Some("agent-pass-0"));
        assert_eq!(
            arguments.incumbent_repo.as_deref(),
            Some(Path::new("/tmp/incumbent"))
        );
        assert_eq!(arguments.correctness_adapter.as_deref(), Some("vitest"));
        assert_eq!(
            arguments.correctness_target.as_deref(),
            Some("src/work.test.ts")
        );
        assert_eq!(arguments.correctness_name.as_deref(), Some("does work"));
        assert_eq!(arguments.output, OutputMode::Json);

        let CliCommand::PerformanceLab(automatic) = parse_arguments(
            [
                "performance-lab".into(),
                "--lab-id".into(),
                "agent-pass-2".into(),
                "--continue-from".into(),
                "agent-pass-1".into(),
                "--incumbent-repo".into(),
                "/tmp/incumbent".into(),
            ],
            cwd,
        )
        .expect("flow-bound correctness arguments") else {
            panic!("expected performance laboratory");
        };
        assert_eq!(
            automatic.incumbent_repo.as_deref(),
            Some(Path::new("/tmp/incumbent"))
        );
        assert_eq!(automatic.correctness_adapter, None);

        for invalid in [
            vec!["performance-lab", "--lab-id", "Uppercase"],
            vec!["performance-lab", "--lab-id", "ok", "--max-steps", "9"],
            vec!["performance-lab", "--lab-id", "ok", "--warmups", "6"],
            vec!["performance-lab", "--lab-id", "ok", "--timeout-ms", "99"],
            vec![
                "performance-lab",
                "--lab-id",
                "ok",
                "--continue-from",
                "Uppercase",
            ],
            vec!["performance-lab", "--lab-id", "ok", "--unknown"],
            vec![
                "performance-lab",
                "--lab-id",
                "ok",
                "--correctness-adapter",
                "vitest",
            ],
            vec![
                "performance-lab",
                "--lab-id",
                "ok",
                "--continue-from",
                "origin",
                "--incumbent-repo",
                "/tmp/incumbent",
                "--correctness-adapter",
                "shell",
                "--correctness-target",
                "src/work.test.ts",
                "--correctness-name",
                "does work",
            ],
        ] {
            assert!(parse_arguments(invalid.into_iter().map(str::to_string), cwd).is_err());
        }
    }

    #[test]
    fn react_redundancy_parser_keeps_a_closed_read_only_surface() {
        let cwd = Path::new("/tmp/widget");
        let CliCommand::ReactRedundancy(arguments) = parse_arguments(
            [
                "react-redundancy".into(),
                "--repo".into(),
                "/tmp/react-app".into(),
                "--timeout-ms".into(),
                "45000".into(),
                "--json".into(),
            ],
            cwd,
        )
        .expect("react redundancy arguments") else {
            panic!("expected React redundancy inspection");
        };
        assert_eq!(arguments.repo_path, Path::new("/tmp/react-app"));
        assert_eq!(arguments.timeout_ms, Some(45_000));
        assert_eq!(arguments.output, OutputMode::Json);
        assert!(parse_arguments(
            [
                "react-redundancy".into(),
                "--timeout-ms".into(),
                "99".into(),
            ],
            cwd,
        )
        .is_err());
        assert!(parse_arguments(["react-redundancy".into(), "--fix".into()], cwd,).is_err());
    }

    #[test]
    fn performance_runtime_candidates_include_the_packaged_and_source_entries() {
        let candidates = performance_runtime_candidates(Path::new(
            "/Applications/CodeVetter.app/Contents/MacOS/codevetter",
        ));
        assert!(candidates
            .iter()
            .any(|candidate| candidate.ends_with(PERFORMANCE_RUNTIME_ENTRY)));
        assert!(candidates
            .iter()
            .any(|candidate| { candidate.ends_with("scripts/runtime-failure-capsule/cli.mjs") }));
    }

    #[test]
    fn performance_human_output_preserves_state_and_stop_reason() {
        let output = render_human_performance_receipt(&serde_json::json!({
            "lab_id": "agent-pass-1",
            "state": "stopped",
            "steps": [{"index": 1}],
            "stop": {
                "kind": "agent_change_required",
                "reason": "A source-bounded experiment is ready."
            }
        }));
        assert!(output.contains("laboratory: agent-pass-1"));
        assert!(output.contains("state: stopped"));
        assert!(output.contains("steps: 1"));
        assert!(output.contains("stop: agent_change_required"));
        assert!(output.contains("A source-bounded experiment is ready."));
    }

    #[test]
    fn redundancy_human_output_preserves_candidate_and_screening_meaning() {
        let output = render_human_redundancy_report(&serde_json::json!({
            "analyzer": { "version": "6.29.0" },
            "clone_analysis": {
                "analyzer": { "version": "5.0.14" },
                "coverage": { "clone_groups": 2 }
            },
            "summary": { "total": 1, "diff_relevant": 1, "screened_out": 1 },
            "verdict": { "status": "candidates" },
            "candidates": [{
                "kind": "unused_export_surface",
                "file": "src/Card.tsx",
                "symbol": "LegacyCard"
            }]
        }));
        assert!(output.contains("react redundancy: candidates"));
        assert!(output.contains("knip: 6.29.0"));
        assert!(output.contains("jscpd: 5.0.14"));
        assert!(output.contains("clone groups: 2"));
        assert!(output.contains("candidates: 1"));
        assert!(output.contains("diff relevant: 1"));
        assert!(output.contains("screened out: 1"));
        assert!(output.contains("src/Card.tsx (LegacyCard)"));
    }

    #[test]
    fn output_and_exit_codes_preserve_receipt_meaning() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).expect("Tauri config");
        assert_eq!(
            app_version(),
            config["version"].as_str().expect("app version")
        );
        let passed = fixture_receipt(TrexPreviewVerdict::PassedWithLimits);
        let failed = fixture_receipt(TrexPreviewVerdict::Failed);
        let uncertain = fixture_receipt(TrexPreviewVerdict::NoConfidence);
        assert_eq!(verdict_exit_code(passed.verdict), 0);
        assert_eq!(verdict_exit_code(failed.verdict), 1);
        assert_eq!(verdict_exit_code(uncertain.verdict), 2);

        let output = render_human_receipt(&failed);
        assert!(output.contains("verdict: failed"));
        assert!(output.contains("head: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));
        assert!(output.contains("preview: claimed"));
        assert!(output.contains("failure /: fixture journey"));

        let payload = serde_json::to_string(&passed).expect("receipt JSON");
        let round_trip: TrexPreviewReceipt = serde_json::from_str(&payload).expect("receipt");
        assert_eq!(round_trip.run_id, passed.run_id);
        assert_eq!(round_trip.verdict, TrexPreviewVerdict::PassedWithLimits);
    }
}
