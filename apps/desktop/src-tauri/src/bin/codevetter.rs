use codevetter_desktop::commands::local_check::{
    preflight_local_check, run_local_check_with_progress, LocalCheckInput,
    LocalCheckPreflightReceipt, LocalCheckReceipt, LocalCheckStatus, LocalCheckTarget,
    LocalCheckVerdict,
};
use codevetter_desktop::commands::tool_collectors::{
    collect_tool_evidence, CollectorKind, CollectorStatus, ToolCollectionInput,
    ToolCollectionReceipt,
};
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
  codevetter check (--pr <url> | --range <base..head>) --task <text> [options]
  codevetter trex (--pr <url> | --range <base..head>) --preview <url> [--repo <path>] [--json]
  codevetter collect --range <base..head> --collector <name> [--collector <name> ...] [--repo <path>] [--json]
  codevetter --version

Options:
  --pr <url>       Canonical GitHub pull request URL
  --range <range>  Local base..head or base...head Git range
  --preview <url>  Existing HTTP(S) preview containing the change
  --repo <path>    Repository path (defaults to the current directory)
  --task <text>    Intended behavior for the change
  --preflight      Validate source, specs, and targets without model or project execution
  --spec <path>    Repo-relative Markdown spec (repeatable)
  --requirement <id>  Requirement id explicitly bound to correctness (repeatable)
  --agent <name>   Review executor: claude, gemini, or codex (default: claude)
  --test-adapter <adapter>  Explicit correctness adapter
  --test-target <path>      Explicit correctness target
  --test-name <name>        Optional exact correctness test name
  --perf-adapter <adapter>  Explicit performance adapter
  --perf-target <path>      Explicit performance target
  --perf-name <name>        Optional exact performance workload name
  --baseline-repo <path>    Clean pre-optimization checkout for paired verification
  --samples <n>             Performance samples, 2-10 (default: 3)
  --warmups <n>             Performance warmups, 0-5 (default: 1)
  --timeout-ms <n>          Per-workload timeout, 100-120000 (default: 30000)
  --collector <name>        gitleaks, cargo-audit, or cargo-llvm-cov (repeatable)
  --json           Print only the canonical receipt JSON
";

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
struct CheckArguments {
    repo_path: PathBuf,
    change: String,
    task: String,
    spec_paths: Vec<PathBuf>,
    selected_requirement_ids: Vec<String>,
    review_agent: String,
    test_target: Option<LocalCheckTarget>,
    performance_target: Option<LocalCheckTarget>,
    baseline_repo_path: Option<PathBuf>,
    samples: u8,
    warmups: u8,
    timeout_ms: u64,
    preflight: bool,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CollectArguments {
    repo_path: PathBuf,
    change: String,
    collectors: Vec<CollectorKind>,
    output: OutputMode,
}

enum CliCommand {
    Check(Box<CheckArguments>),
    Collect(CollectArguments),
    Trex(TrexArguments),
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
        CliCommand::Check(arguments) => run_check(*arguments).await,
        CliCommand::Collect(arguments) => run_collect(arguments).await,
        CliCommand::Trex(arguments) => run_trex(arguments).await,
    }
}

async fn run_collect(arguments: CollectArguments) -> Result<i32, String> {
    let receipt = collect_tool_evidence(ToolCollectionInput {
        repo_path: arguments.repo_path,
        change: arguments.change,
        collectors: arguments.collectors,
    })
    .await?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize tool collection receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_collection(&receipt)),
    }
    Ok(collection_exit_code(&receipt))
}

async fn run_check(arguments: CheckArguments) -> Result<i32, String> {
    let output = arguments.output;
    let preflight = arguments.preflight;
    let input = LocalCheckInput {
        repo_path: arguments.repo_path,
        change: arguments.change,
        task: arguments.task,
        spec_paths: arguments.spec_paths,
        selected_requirement_ids: arguments.selected_requirement_ids,
        review_agent: arguments.review_agent,
        test_target: arguments.test_target,
        performance_target: arguments.performance_target,
        baseline_repo_path: arguments.baseline_repo_path,
        samples: arguments.samples,
        warmups: arguments.warmups,
        timeout_ms: arguments.timeout_ms,
    };
    if preflight {
        let receipt = preflight_local_check(&input).await?;
        match output {
            OutputMode::Json => println!(
                "{}",
                serde_json::to_string(&receipt)
                    .map_err(|error| format!("serialize local check preflight: {error}"))?
            ),
            OutputMode::Human => print!("{}", render_human_preflight(&receipt)),
        }
        return Ok(preflight_exit_code(receipt.status));
    }

    let human_progress = output == OutputMode::Human;
    let receipt = run_local_check_with_progress(input, |progress| {
        if human_progress {
            eprintln!("[codevetter] {}: {}", progress.stage, progress.state);
        }
    })
    .await?;
    match output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize local check receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_check(&receipt)),
    }
    Ok(local_check_exit_code(receipt.verdict))
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
        "check" => return parse_check(arguments, cwd),
        "collect" => return parse_collect(arguments, cwd),
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

fn parse_collect(
    mut arguments: impl Iterator<Item = String>,
    cwd: &Path,
) -> Result<CliCommand, String> {
    let mut repo_path = None;
    let mut range = None;
    let mut collectors = Vec::new();
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--repo" => repo_path = Some(PathBuf::from(required_value(&mut arguments, "--repo")?)),
            "--range" => range = Some(required_value(&mut arguments, "--range")?),
            "--collector" => collectors.push(CollectorKind::parse(&required_value(
                &mut arguments,
                "--collector",
            )?)?),
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown collect argument `{argument}`")),
        }
    }
    if collectors.is_empty() {
        return Err("at least one --collector is required".into());
    }
    Ok(CliCommand::Collect(CollectArguments {
        repo_path: repo_path.unwrap_or_else(|| cwd.to_path_buf()),
        change: range.ok_or_else(|| "--range is required".to_string())?,
        collectors,
        output,
    }))
}

fn parse_check(
    mut arguments: impl Iterator<Item = String>,
    cwd: &Path,
) -> Result<CliCommand, String> {
    let mut repo_path = None;
    let mut pull_request = None;
    let mut range = None;
    let mut task = None;
    let mut spec_paths = Vec::new();
    let mut selected_requirement_ids = Vec::new();
    let mut review_agent = "claude".to_string();
    let mut test_adapter = None;
    let mut test_target = None;
    let mut test_name = None;
    let mut performance_adapter = None;
    let mut performance_target = None;
    let mut performance_name = None;
    let mut baseline_repo_path = None;
    let mut samples = 3;
    let mut warmups = 1;
    let mut timeout_ms = 30_000;
    let mut preflight = false;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--repo" => repo_path = Some(PathBuf::from(required_value(&mut arguments, "--repo")?)),
            "--pr" => pull_request = Some(required_value(&mut arguments, "--pr")?),
            "--range" => range = Some(required_value(&mut arguments, "--range")?),
            "--task" => task = Some(required_value(&mut arguments, "--task")?),
            "--preflight" => preflight = true,
            "--spec" => spec_paths.push(PathBuf::from(required_value(&mut arguments, "--spec")?)),
            "--requirement" => {
                selected_requirement_ids.push(required_value(&mut arguments, "--requirement")?)
            }
            "--agent" => review_agent = required_value(&mut arguments, "--agent")?,
            "--test-adapter" => {
                test_adapter = Some(required_value(&mut arguments, "--test-adapter")?)
            }
            "--test-target" => test_target = Some(required_value(&mut arguments, "--test-target")?),
            "--test-name" => test_name = Some(required_value(&mut arguments, "--test-name")?),
            "--perf-adapter" => {
                performance_adapter = Some(required_value(&mut arguments, "--perf-adapter")?)
            }
            "--perf-target" => {
                performance_target = Some(required_value(&mut arguments, "--perf-target")?)
            }
            "--perf-name" => {
                performance_name = Some(required_value(&mut arguments, "--perf-name")?)
            }
            "--baseline-repo" => {
                baseline_repo_path = Some(PathBuf::from(required_value(
                    &mut arguments,
                    "--baseline-repo",
                )?))
            }
            "--samples" => samples = parse_number(&mut arguments, "--samples")?,
            "--warmups" => warmups = parse_number(&mut arguments, "--warmups")?,
            "--timeout-ms" => timeout_ms = parse_number(&mut arguments, "--timeout-ms")?,
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown check argument `{argument}`")),
        }
    }
    let change = match (pull_request, range) {
        (Some(value), None) | (None, Some(value)) => value,
        (Some(_), Some(_)) => return Err("choose exactly one of --pr or --range".into()),
        (None, None) => return Err("one of --pr or --range is required".into()),
    };
    let test_target = paired_target("test", test_adapter, test_target, test_name)?;
    let performance_target = paired_target(
        "performance",
        performance_adapter,
        performance_target,
        performance_name,
    )?;
    if spec_paths.is_empty() && !selected_requirement_ids.is_empty() {
        return Err("--requirement requires at least one --spec".into());
    }
    Ok(CliCommand::Check(Box::new(CheckArguments {
        repo_path: repo_path.unwrap_or_else(|| cwd.to_path_buf()),
        change,
        task: task.ok_or_else(|| "--task is required".to_string())?,
        spec_paths,
        selected_requirement_ids,
        review_agent,
        test_target,
        performance_target,
        baseline_repo_path,
        samples,
        warmups,
        timeout_ms,
        preflight,
        output,
    })))
}

fn paired_target(
    label: &str,
    adapter: Option<String>,
    target: Option<String>,
    name: Option<String>,
) -> Result<Option<LocalCheckTarget>, String> {
    match (adapter, target) {
        (Some(adapter), Some(target)) => Ok(Some(LocalCheckTarget {
            adapter,
            target,
            name,
            source: "explicit".into(),
        })),
        (None, None) if name.is_none() => Ok(None),
        _ => Err(format!(
            "--{label}-adapter and --{label}-target must be provided together"
        )),
    }
}

fn parse_number<T: std::str::FromStr>(
    arguments: &mut impl Iterator<Item = String>,
    flag: &str,
) -> Result<T, String> {
    required_value(arguments, flag)?
        .parse()
        .map_err(|_| format!("{flag} requires a number"))
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
        Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.codevetter.desktop"))
    }
    #[cfg(target_os = "windows")]
    {
        let app_data =
            std::env::var_os("APPDATA").ok_or_else(|| "APPDATA is unavailable".to_string())?;
        Ok(PathBuf::from(app_data).join("com.codevetter.desktop"))
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

fn local_check_exit_code(verdict: LocalCheckVerdict) -> i32 {
    match verdict {
        LocalCheckVerdict::PassedWithLimits => 0,
        LocalCheckVerdict::NeedsAttention | LocalCheckVerdict::Failed => 1,
        LocalCheckVerdict::NoConfidence => 2,
    }
}

fn preflight_exit_code(status: LocalCheckStatus) -> i32 {
    if status == LocalCheckStatus::Ready {
        0
    } else {
        2
    }
}

fn collection_exit_code(receipt: &ToolCollectionReceipt) -> i32 {
    if receipt.collectors.iter().any(|collector| {
        matches!(
            collector.status,
            CollectorStatus::Unavailable | CollectorStatus::Error
        )
    }) {
        2
    } else if receipt
        .collectors
        .iter()
        .any(|collector| collector.status == CollectorStatus::Findings)
    {
        1
    } else {
        0
    }
}

fn render_human_collection(receipt: &ToolCollectionReceipt) -> String {
    let mut output = format!("head: {}\n", receipt.source.head_sha);
    for collector in &receipt.collectors {
        let name = serde_json::to_value(collector.collector)
            .ok()
            .and_then(|value| value.as_str().map(ToOwned::to_owned))
            .unwrap_or_else(|| "unknown".into());
        let status = serde_json::to_value(collector.status)
            .ok()
            .and_then(|value| value.as_str().map(ToOwned::to_owned))
            .unwrap_or_else(|| "unknown".into());
        output.push_str(&format!(
            "{name}: {status} ({} finding(s), {} ms)\n",
            collector.finding_count, collector.duration_ms
        ));
    }
    if !receipt.limitations.is_empty() {
        output.push_str("limitations:\n");
        for limitation in &receipt.limitations {
            output.push_str(&format!("- {limitation}\n"));
        }
    }
    output
}

fn render_human_preflight(receipt: &LocalCheckPreflightReceipt) -> String {
    let target = |value: Option<&LocalCheckTarget>| {
        value
            .map(|target| format!("{} {}", target.adapter, target.target))
            .unwrap_or_else(|| "unavailable".into())
    };
    let mut output = format!(
        "preflight: {}\nhead: {}\ncorrectness target: {}\nperformance target: {}\n",
        local_status_text(receipt.status),
        receipt.source.head_sha,
        target(receipt.correctness_target.as_ref()),
        target(receipt.performance_target.as_ref()),
    );
    if let Some(spec) = receipt.spec_coverage.as_ref() {
        output.push_str(&format!(
            "specs: {} source(s), {} requirement(s), {} selected\n",
            spec.sources.len(),
            spec.summary.total_requirements,
            spec.summary.selected_for_execution,
        ));
    }
    if !receipt.limitations.is_empty() {
        output.push_str("limitations:\n");
        for limitation in &receipt.limitations {
            output.push_str(&format!("- {limitation}\n"));
        }
    }
    if receipt.status == LocalCheckStatus::Ready {
        output.push_str("next: rerun this command without --preflight to execute verification\n");
    }
    output
}

fn render_human_check(receipt: &LocalCheckReceipt) -> String {
    let verdict = serde_json::to_value(receipt.verdict)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "unknown".into());
    let mut output = format!(
        "verdict: {verdict}\nhead: {}\nreview: {}\ncorrectness: {}\nperformance: {}\noptimization: {}\n",
        receipt.source.head_sha,
        local_status_text(receipt.stages.review.status),
        local_status_text(receipt.stages.correctness.status),
        local_status_text(receipt.stages.performance.status),
        local_status_text(receipt.stages.optimization.status),
    );
    render_review_findings(&mut output, &receipt.stages.review.evidence);
    if let Some(spec) = receipt.spec_coverage.as_ref() {
        let percent = |value: Option<u8>| {
            value
                .map(|number| format!("{number}%"))
                .unwrap_or_else(|| "n/a".into())
        };
        output.push_str(&format!(
            "specs: {} source(s), {} requirement(s)\nspec review input: {}/{} ({})\nspec executable evidence: {}/{} ({})\nspec verified: {}/{} ({})\n",
            spec.sources.len(),
            spec.summary.total_requirements,
            spec.summary.review_input_requirements,
            spec.summary.total_requirements,
            percent(spec.summary.review_input_coverage_percent),
            spec.summary.verified + spec.summary.contradicted,
            spec.summary.total_requirements,
            percent(spec.summary.executable_evidence_coverage_percent),
            spec.summary.verified,
            spec.summary.total_requirements,
            percent(spec.summary.verified_coverage_percent),
        ));
        if !spec.limitations.is_empty() {
            output.push_str("spec limitations:\n");
            for limitation in spec.limitations.iter().take(8) {
                output.push_str(&format!("- {limitation}\n"));
            }
        }
    }
    if let Some(command) = receipt
        .stages
        .optimization
        .evidence
        .get("candidate_command")
        .and_then(serde_json::Value::as_str)
    {
        output.push_str(&format!("next: {command}\n"));
    }
    if !receipt.limitations.is_empty() {
        output.push_str("limitations:\n");
        for limitation in &receipt.limitations {
            output.push_str(&format!("- {limitation}\n"));
        }
    }
    output
}

fn local_status_text(status: LocalCheckStatus) -> String {
    serde_json::to_value(status)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "unknown".into())
}

fn render_review_findings(output: &mut String, evidence: &serde_json::Value) {
    let Some(findings) = evidence
        .get("findings")
        .and_then(serde_json::Value::as_array)
    else {
        return;
    };
    let mut findings = findings.iter().collect::<Vec<_>>();
    findings.sort_by_key(|finding| {
        match finding.get("severity").and_then(serde_json::Value::as_str) {
            Some("critical") => 0,
            Some("high") => 1,
            Some("medium") => 2,
            Some("low") => 3,
            _ => 4,
        }
    });
    if findings.is_empty() {
        return;
    }
    output.push_str("review findings:\n");
    for finding in findings.into_iter().take(3) {
        let severity = finding
            .get("severity")
            .and_then(serde_json::Value::as_str)
            .map(|value| terminal_text(value, 16))
            .unwrap_or_else(|| "unknown".into());
        let title = finding
            .get("title")
            .and_then(serde_json::Value::as_str)
            .map(|value| terminal_text(value, 180))
            .unwrap_or_else(|| "Untitled finding".into());
        let location = finding
            .get("filePath")
            .and_then(serde_json::Value::as_str)
            .map(|path| {
                let path = terminal_text(path, 180);
                finding
                    .get("line")
                    .and_then(serde_json::Value::as_u64)
                    .map(|line| format!(" ({path}:{line})"))
                    .unwrap_or_else(|| format!(" ({path})"))
            })
            .unwrap_or_default();
        output.push_str(&format!("- {severity}: {title}{location}\n"));
    }
}

fn terminal_text(value: &str, max_chars: usize) -> String {
    value
        .chars()
        .filter_map(|character| match character {
            '\n' | '\r' | '\t' => Some(' '),
            value if value.is_control() => None,
            value => Some(value),
        })
        .take(max_chars)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
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
    use codevetter_desktop::commands::local_check::{LocalCheckStage, LocalCheckStages};
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

    fn fixture_local_check(verdict: LocalCheckVerdict) -> LocalCheckReceipt {
        let stage = |status| LocalCheckStage {
            status,
            duration_ms: 12,
            target: None,
            evidence: serde_json::json!({}),
            limitations: Vec::new(),
        };
        LocalCheckReceipt {
            schema_version: "codevetter.local-check/v1".into(),
            run_id: "local-check-fixture".into(),
            ran_at: "2026-08-24T00:00:00Z".into(),
            repo_path: "/tmp/widget".into(),
            task: "Preserve behavior".into(),
            source: TrexSourceReceipt {
                kind: TrexChangeKind::Range,
                input: "main...HEAD".into(),
                base_sha: "a".repeat(40),
                head_sha: "b".repeat(40),
                commits: vec!["b".repeat(40)],
                changed_paths: vec!["src/parser.ts".into()],
            },
            stages: LocalCheckStages {
                review: stage(LocalCheckStatus::Completed),
                correctness: stage(LocalCheckStatus::Passed),
                performance: stage(LocalCheckStatus::Completed),
                optimization: LocalCheckStage {
                    status: LocalCheckStatus::Ready,
                    duration_ms: 0,
                    target: None,
                    evidence: serde_json::json!({"candidate_command": "codevetter check --repo <candidate-worktree>"}),
                    limitations: vec!["Candidate edits remain external.".into()],
                },
            },
            spec_coverage: None,
            verdict,
            limitations: vec!["Candidate edits remain external.".into()],
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
    fn check_parser_supports_discovery_and_explicit_benchmark_targets() {
        let CliCommand::Check(arguments) = parse_arguments(
            [
                "check".into(),
                "--range".into(),
                "main...HEAD".into(),
                "--task".into(),
                "Reduce parser latency without changing output".into(),
                "--preflight".into(),
                "--spec".into(),
                "docs/parser.md".into(),
                "--spec".into(),
                "docs/architecture.md".into(),
                "--requirement".into(),
                "parser-output-stable".into(),
                "--test-adapter".into(),
                "node-test".into(),
                "--test-target".into(),
                "test/parser.test.mjs".into(),
                "--perf-adapter".into(),
                "node-test".into(),
                "--perf-target".into(),
                "test/parser.performance.test.mjs".into(),
                "--samples".into(),
                "5".into(),
                "--json".into(),
            ],
            Path::new("/tmp/widget"),
        )
        .expect("arguments") else {
            panic!("expected check");
        };
        assert_eq!(arguments.repo_path, Path::new("/tmp/widget"));
        assert_eq!(arguments.change, "main...HEAD");
        assert_eq!(arguments.review_agent, "claude");
        assert_eq!(
            arguments.spec_paths,
            vec![
                PathBuf::from("docs/parser.md"),
                PathBuf::from("docs/architecture.md")
            ]
        );
        assert_eq!(
            arguments.selected_requirement_ids,
            vec!["parser-output-stable"]
        );
        assert_eq!(arguments.samples, 5);
        assert!(arguments.preflight);
        assert_eq!(arguments.output, OutputMode::Json);
        assert_eq!(
            arguments
                .performance_target
                .expect("performance target")
                .target,
            "test/parser.performance.test.mjs"
        );
    }

    #[test]
    fn check_parser_rejects_partial_targets_and_ambiguous_sources() {
        let cwd = Path::new("/tmp/widget");
        assert!(parse_arguments(
            [
                "check".into(),
                "--range".into(),
                "main...HEAD".into(),
                "--task".into(),
                "Review this".into(),
                "--perf-target".into(),
                "test/performance.test.mjs".into(),
            ],
            cwd,
        )
        .is_err());
        assert!(parse_arguments(
            [
                "check".into(),
                "--range".into(),
                "main...HEAD".into(),
                "--pr".into(),
                "https://github.com/acme/widget/pull/1".into(),
                "--task".into(),
                "Review this".into(),
            ],
            cwd,
        )
        .is_err());
        assert!(parse_arguments(
            [
                "check".into(),
                "--range".into(),
                "main...HEAD".into(),
                "--task".into(),
                "Review this".into(),
                "--requirement".into(),
                "missing-spec".into(),
            ],
            cwd,
        )
        .is_err());
    }

    #[test]
    fn collect_parser_requires_a_range_and_explicit_supported_collectors() {
        let cwd = Path::new("/tmp/widget");
        let CliCommand::Collect(arguments) = parse_arguments(
            [
                "collect".into(),
                "--range".into(),
                "main..HEAD".into(),
                "--collector".into(),
                "gitleaks".into(),
                "--collector".into(),
                "cargo-audit".into(),
                "--json".into(),
            ],
            cwd,
        )
        .expect("collect arguments") else {
            panic!("expected collect command")
        };
        assert_eq!(arguments.repo_path, cwd);
        assert_eq!(arguments.change, "main..HEAD");
        assert_eq!(
            arguments.collectors,
            vec![CollectorKind::Gitleaks, CollectorKind::CargoAudit]
        );
        assert_eq!(arguments.output, OutputMode::Json);

        assert!(parse_arguments(
            ["collect".into(), "--range".into(), "main..HEAD".into()],
            cwd,
        )
        .is_err());
        assert!(parse_arguments(
            [
                "collect".into(),
                "--range".into(),
                "main..HEAD".into(),
                "--collector".into(),
                "unknown".into(),
            ],
            cwd,
        )
        .is_err());
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

    #[test]
    fn local_check_output_and_exit_codes_preserve_stage_meaning() {
        let passed = fixture_local_check(LocalCheckVerdict::PassedWithLimits);
        let failed = fixture_local_check(LocalCheckVerdict::Failed);
        let uncertain = fixture_local_check(LocalCheckVerdict::NoConfidence);
        assert_eq!(local_check_exit_code(passed.verdict), 0);
        assert_eq!(local_check_exit_code(failed.verdict), 1);
        assert_eq!(local_check_exit_code(uncertain.verdict), 2);

        let output = render_human_check(&passed);
        assert!(output.contains("verdict: passed_with_limits"));
        assert!(output.contains("correctness: passed"));
        assert!(output.contains("optimization: ready"));
        assert!(output.contains("next: codevetter check --repo <candidate-worktree>"));

        let payload = serde_json::to_value(&passed).expect("receipt JSON");
        assert_eq!(payload["schema_version"], "codevetter.local-check/v1");
        assert_eq!(payload["stages"]["correctness"]["status"], "passed");
        assert!(payload.get("spec_coverage").is_none());

        let mut spec_passed = passed.clone();
        spec_passed.spec_coverage = Some(
            serde_json::from_value(serde_json::json!({
                "schema_version": "codevetter.spec-coverage/v1",
                "head_sha": "b".repeat(40),
                "sources": [{"path": "docs/product.md", "sha256": format!("sha256:{}", "c".repeat(64)), "bytes": 42}],
                "requirements": [],
                "summary": {
                    "total_requirements": 5,
                    "review_input_requirements": 5,
                    "selected_for_execution": 2,
                    "verified": 2,
                    "contradicted": 0,
                    "review_only": 3,
                    "unverified": 0,
                    "review_input_coverage_percent": 100,
                    "executable_evidence_coverage_percent": 40,
                    "verified_coverage_percent": 40
                },
                "limitations": []
            }))
            .expect("spec coverage"),
        );
        let spec_output = render_human_check(&spec_passed);
        assert!(spec_output.contains("spec review input: 5/5 (100%)"));
        assert!(spec_output.contains("spec executable evidence: 2/5 (40%)"));
        assert!(spec_output.contains("spec verified: 2/5 (40%)"));

        let mut findings = passed.clone();
        findings.stages.review.evidence = serde_json::json!({
            "findings": [
                {"severity": "low", "title": "Fourth finding", "filePath": "src/four.ts", "line": 4},
                {"severity": "high", "title": "Unsafe\nterminal\u{1b}[31m title", "filePath": "src/high.ts", "line": 9},
                {"severity": "critical", "title": "Critical finding", "filePath": "src/critical.ts", "line": 2},
                {"severity": "medium", "title": "Medium finding", "filePath": "src/medium.ts"}
            ]
        });
        let findings_output = render_human_check(&findings);
        assert!(findings_output.contains("review findings:"));
        assert!(findings_output.contains("- critical: Critical finding (src/critical.ts:2)"));
        assert!(findings_output.contains("- high: Unsafe terminal[31m title (src/high.ts:9)"));
        assert!(findings_output.contains("- medium: Medium finding (src/medium.ts)"));
        assert!(!findings_output.contains("Fourth finding"));

        let preflight = LocalCheckPreflightReceipt {
            schema_version: "codevetter.local-check-preflight/v1".into(),
            ran_at: "2026-08-29T00:00:00Z".into(),
            repo_path: passed.repo_path.clone(),
            task: passed.task.clone(),
            source: passed.source.clone(),
            spec_coverage: None,
            correctness_target: Some(LocalCheckTarget {
                adapter: "vitest".into(),
                target: "test/parser.test.ts".into(),
                name: None,
                source: "discovered:fixture".into(),
            }),
            performance_target: None,
            status: LocalCheckStatus::Ready,
            limitations: vec!["No dedicated performance workload matched".into()],
        };
        let preflight_output = render_human_preflight(&preflight);
        assert_eq!(preflight_exit_code(preflight.status), 0);
        assert!(preflight_output.contains("preflight: ready"));
        assert!(preflight_output.contains("correctness target: vitest test/parser.test.ts"));
        assert!(preflight_output.contains("performance target: unavailable"));
        assert!(preflight_output.contains("rerun this command without --preflight"));
    }
}
