use codevetter_desktop::application::verification_service::{
    run_verification_command, VerificationCommand, VerificationOperation, VerificationProgress,
    VerificationResult,
};
use codevetter_desktop::capabilities::{
    capability_registry, capability_registry_schema, Availability, CapabilityRegistry,
};
use codevetter_desktop::commands::agent_memories::{
    run_memory_receipt, MemoryReceipt, MemoryReceiptOperation,
};
use codevetter_desktop::commands::evidence_scope::{
    resolve_evidence_scope, EvidenceScopeConsumer, EvidenceScopeInput, EvidenceScopeKind,
    EvidenceScopePlan,
};
use codevetter_desktop::commands::fix_attempt::{
    discard_fix_attempt, execute_fix_attempt, inspect_fix_attempt, DiscardFixAttemptInput,
    FixAttemptInput, FixAttemptReceipt,
};
use codevetter_desktop::commands::fix_packet::build_agent_fix_packet;
use codevetter_desktop::commands::history_roots::{
    run_history_roots, HistoryRootsOperation, HistoryRootsReceipt,
};
use codevetter_desktop::commands::local_check::{
    LocalCheckInput, LocalCheckPreflightReceipt, LocalCheckReceipt, LocalCheckStatus,
    LocalCheckTarget, LocalCheckVerdict,
};
use codevetter_desktop::commands::local_usage::{
    get_headless_local_usage_report, LocalUsageReport,
};
use codevetter_desktop::commands::mcp_access::{
    run_mcp_settings_operation, McpSettingsOperation, McpSettingsReceipt,
};
use codevetter_desktop::commands::native_settings::{
    list_native_settings, set_native_setting, NativeSettingsReceipt,
};
use codevetter_desktop::commands::onboarding::{
    complete_onboarding, inspect_onboarding, OnboardingReceipt,
};
use codevetter_desktop::commands::ops_status::{inspect_ops_status, OpsStatusReceipt};
#[cfg(test)]
use codevetter_desktop::commands::ops_status::{OpsBillingStatus, OpsWebhookStatus};
use codevetter_desktop::commands::performance_bridge::{
    run_headless_performance, PerformanceAdapter, PerformanceOperation, PerformanceRunInput,
    PerformanceRunReceipt,
};
use codevetter_desktop::commands::provider_quota::{
    collect_provider_quotas, ProviderQuotaReceipt, ProviderQuotaSelection,
};
use codevetter_desktop::commands::qa_workspace::{
    run_qa_workspace_headless, QaTargetPreset, QaWorkspaceMutation, QaWorkspaceReceipt,
    StoredQaWorkflow,
};
use codevetter_desktop::commands::repo_query::{
    query_repository_evidence_with_input, run_repository_query_worker,
    RepositoryHistorySelectorKind, RepositoryQueryDomain, RepositoryQueryInput,
    RepositoryQueryMode, RepositoryQueryReceipt,
};
#[cfg(unix)]
use codevetter_desktop::commands::review::cancel_all_cli_reviews;
use codevetter_desktop::commands::rubric_settings::{
    active_rubric_prompt, read_rubric_settings, select_rubric_pack, upsert_rubric_pack,
    RubricPackInput, RubricSettingsReceipt,
};
use codevetter_desktop::commands::run_history::{list_run_history, RunHistoryReceipt};
use codevetter_desktop::commands::scenario_compiler_bridge::{
    run_scenario_compiler_action_headless, ContextSelection, ProviderSelection,
    ScenarioCompilerAction,
};
use codevetter_desktop::commands::session_retention::{
    run_session_retention_operation, SessionRetentionOperation, SessionRetentionPolicy,
    SessionRetentionReceipt,
};
use codevetter_desktop::commands::structural_graph::query::GraphDirection;
use codevetter_desktop::commands::tool_collectors::{
    collect_tool_evidence, CollectorKind, CollectorStatus, ToolCollectionInput,
    ToolCollectionReceipt,
};
use codevetter_desktop::commands::trex_preview::{
    execute_trex_preview, TrexChangeKind, TrexPreviewReceipt, TrexPreviewRunInput,
    TrexPreviewVerdict,
};
use codevetter_desktop::commands::trex_watcher::{
    disable_trex_watcher_headless, enable_trex_watcher_headless, list_trex_pr_runs_headless,
    list_trex_watchers_headless, poll_trex_watcher_headless, retry_trex_watcher_headless,
    StartTrexWatcherInput, TrexWatcherReceipt,
};
use codevetter_desktop::commands::unpack::{
    compare_unpack_snapshot_commits_headless, export_repo_unpack_report_from_connection,
    get_repo_unpack_report_from_connection, list_repo_unpack_reports_from_connection,
    scan_and_persist_unpack_snapshot, UnpackReportRecord, UnpackReportSummary,
};
use codevetter_desktop::commands::warm_verification_bridge::{
    cancel_differential_verification_run_headless, cancel_warm_verification_run_headless,
    cleanup_differential_verification_artifacts_headless,
    cleanup_warm_verification_artifacts_headless, get_current_warm_verification_identity_headless,
    get_warm_verification_daemon_health_headless, prepare_differential_verification_headless,
    run_differential_verification_headless, run_warm_changed_verification_headless,
    start_warm_verification_daemon_headless, stop_warm_verification_daemon_headless,
};
use codevetter_desktop::commands::xray::{
    build_agent_pr_xray_from_connection, save_agent_pr_xray_to_path, SaveXrayRequest, XrayFormat,
    XrayRequest,
};
use codevetter_desktop::{db, DbState};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const HELP: &str = "\
CodeVetter execution-backed verification

Usage:
  codevetter check (--pr <url> | --range <base..head>) --task <text> [options]
  codevetter trex (--pr <url> | --range <base..head>) --preview <url> [--repo <path>] [--json]
  codevetter warm --operation <status|start|stop|run|cancel|cleanup|current> [--repo <path>] [options] [--json]
  codevetter differential --operation <prepare|run|cancel|cleanup> [--repo <path>] [options] [--json]
  codevetter scenario --operation <inspect|generate|validate|dry-run|accept|reject|cleanup> [options] [--json]
  codevetter watcher --operation <list|enable|disable|poll|retry|runs> [options] [--json]
  codevetter performance --operation <plan|diagnose|verify-paired|inspect> [options] [--json]
  codevetter scope --consumer <testing|performance> (--flow <text> | --change <range-or-pr> | --codebase) [--repo <path>] [--json]
  codevetter usage [--timezone <iana>] [--refresh] [--json]
  codevetter quota [--provider <all|claude|codex>] [--json]
  codevetter ops [--window-days <7|30|90>] [--json]
  codevetter unpack [--operation <list|inspect|scan|compare|export|query|query-worker>] [--repo <path>] [--limit <n>] [--report-id <id>] [--json]
  codevetter qa --operation <inspect|save-workflow|delete-workflow|save-target|delete-target> --repo <path> [options] [--json]
  codevetter settings [--set <key>=<value>] [--json]
  codevetter history-roots [--add <path> | --remove <path>] [--json]
  codevetter memories [--source <opaque-id> [--diff]] [--json]
  codevetter onboarding [--complete --default-adapter <codex|claude-code>] [--json]
  codevetter mcp --repo <path> [--enable | --disable | --clear-audit] [--json]
  codevetter retention (--max-age-days <n> | --max-archive-mib <n>) [--json]
  codevetter retention (--apply <plan-id> | --checkpoint [--vacuum]) [--json]
  codevetter rubrics [--select <id> | --id <id> --name <name> --focus <text> --check <text>...] [--json]
  codevetter collect --range <base..head> --collector <name> [--collector <name> ...] [--rust-manifest <path>] [--rust-test <name>] [--advisory-db <path>] [--repo <path>] [--json]
  codevetter capabilities [--json | --schema]
  codevetter runs [--repo <path>] [--limit <n>] [--json]
  codevetter fix-packet --run-id <id> [--finding <id> ...] [--json]
  codevetter fix --operation execute --run-id <id> --finding <id> [--finding <id> ...] --agent <name> --confirm-run [--timeout-ms <n>] [--json]
  codevetter fix --operation inspect --attempt-id <id> [--json]
  codevetter fix --operation discard --attempt-id <id> --confirm-discard [--json]
  codevetter xray --review-id <id> [--public-source <ref>] [--confirm-public] [--approve-excerpt <finding-id> ...] [--format <json|markdown|html>] [--save <path>] [--json]
  codevetter --version

Options:
  --pr <url>       Canonical GitHub pull request URL
  --range <range>  Local base..head or base...head Git range
  --preview <url>  Existing HTTP(S) preview containing the change
  --repo <path>    Repository path (defaults to the current directory)
  --task <text>    Intended behavior for the change
  --preflight      Validate source, specs, and targets without model or project execution
  --progress-json  Stream versioned progress JSON lines to stderr (requires --json)
  --request-id <id>  Correlate the versioned command, progress, cancellation, and receipt
  --spec <path>    Repo-relative Markdown spec (repeatable)
  --requirement <id>  Requirement id explicitly bound to correctness (repeatable)
  --agent <name>   Review executor: claude, gemini, codex, or cross; fix executor: claude or codex
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
  --rust-manifest <path>    Repository-relative Cargo.toml for Rust collectors
  --rust-test <name>        Exact Cargo test target for cargo-llvm-cov
  --advisory-db <path>      Explicit pinned local RustSec database (bundle resource by default)
  --operation <name>        Performance operation: plan, diagnose, verify-paired, or inspect
  --consumer <name>         Scope consumer: testing or performance
  --flow <text>             Discover targets for one human-described flow
  --change <range-or-pr>    Discover targets for one exact Git change
  --codebase                 Discover a bounded whole-codebase target portfolio
  --adapter <adapter>       vitest, node-test, node-script, playwright, or go-bench
  --target <path>           Contained repository-relative performance target
  --name <name>             Optional exact performance workload name
  --request-id <id>         Optional stable performance request id
  --subject-run-id <id>     Recorded performance run id for inspect
  --timezone <iana>          Usage reporting timezone (default: UTC)
  --refresh                  Bypass the in-process usage cache
  --provider <name>          Quota provider: all, claude, or codex (default: all)
  --window-days <n>          Ops aggregate window: 7, 30, or 90 (default: 30)
  --report-id <id>           Inspect one stored Repo Unpack snapshot
  --operation <name>        Repo Unpack operation: list, inspect, scan, compare, export, query, or internal query-worker
  --query-domain <name>     Repository query domain: graph or history
  --query-mode <name>       search, explain, impact, path, or trace
  --query-target <value>    Destination node for a path query
  --query-direction <name>  Impact direction: incoming, outgoing, or both
  --query-depth <n>         Impact depth from 1 through 12
  --history-selector <name> Trace selector: event, entity, revision, release, or episode
  --query <text>            Bounded structural or temporal search text
  --set <key>=<value>        Save one declared non-secret native preference
  --source <opaque-id>       Read one bounded memory source selected from `memories`
  --diff                     Show the redacted Git diff for the selected memory source
  --complete                 Complete native onboarding using the selected default adapter
  --default-adapter <name>   Native onboarding default: codex or claude-code
  --enable                   Enable MCP for one indexed repository
  --disable                  Disable MCP for one repository
  --clear-audit              Clear bounded MCP access metadata for one repository
  --max-age-days <n>         Preview removal of archive rows older than 1-3650 days
  --max-archive-mib <n>      Preview an archive size limit of 1 MiB or greater
  --apply <plan-id>          Apply one persisted plan after rechecking its identity
  --checkpoint               Checkpoint the local archive without deleting evidence
  --vacuum                   Run VACUUM after --checkpoint
  --select <id>              Select one existing review rubric pack
  --id <id>                  Lowercase id for a custom rubric pack
  --focus <text>             Review focus for a custom rubric pack
  --check <text>             Review check for a custom pack (repeatable)
  --review-id <id>           Persisted review identity for a public-safe X-Ray
  --run-id <id>              Persisted local-check identity for an agent fix packet
  --finding <id>             Source-qualified finding to include (repeatable)
  --attempt-id <id>          Persisted isolated fix-attempt identity
  --confirm-discard          Confirm removal of one retained unmerged fix worktree
  --detailed                 Capture bounded warm-verification artifact detail
  --reference <revision>     Differential reference revision
  --candidate <kind>         Differential candidate: worktree, staged, commit, or range
  --revision <revision>      Exact commit/range candidate revision
  --dry-run                  Preview warm artifact cleanup without deleting files
  --apply-cleanup            Explicitly authorize warm artifact cleanup
  --interval-secs <n>        PR watcher interval in seconds (minimum 60)
  --base-branch <branch>     Optional PR watcher base branch override
  --pr-number <n>            Exact open PR to retry after a limited watcher attempt
  --confirm-run              Confirm a watcher poll or isolated fix may invoke external tools
  --public-source <ref>      Bounded public repository or pull-request reference
  --confirm-public           Confirm the source and finding summaries are safe to publish
  --approve-excerpt <id>     Allow one recorded suggestion excerpt (repeatable)
  --format <format>          X-Ray export format: json, markdown, or html
  --save <path>              Save an eligible X-Ray to an explicit destination
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
    target_route: Option<String>,
    target_goal: Option<String>,
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
    request_id: Option<String>,
    preflight: bool,
    progress_json: bool,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CollectArguments {
    repo_path: PathBuf,
    change: String,
    collectors: Vec<CollectorKind>,
    rust_manifest: Option<PathBuf>,
    rust_test: Option<String>,
    advisory_db: Option<PathBuf>,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RunsArguments {
    repo_path: Option<PathBuf>,
    limit: usize,
    output: OutputMode,
}

#[derive(Debug, Clone)]
struct PerformanceArguments {
    input: PerformanceRunInput,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ScopeArguments {
    input: EvidenceScopeInput,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct UsageArguments {
    timezone: Option<String>,
    refresh: bool,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct QuotaArguments {
    provider: ProviderQuotaSelection,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OpsArguments {
    window_days: u32,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum UnpackOperation {
    List,
    Inspect,
    Scan,
    Compare,
    Export,
    Query,
    QueryWorker,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct UnpackArguments {
    operation: UnpackOperation,
    repo_path: Option<String>,
    report_id: Option<String>,
    base_commit: Option<String>,
    head_commit: Option<String>,
    format: Option<String>,
    query_domain: Option<RepositoryQueryDomain>,
    query_mode: RepositoryQueryMode,
    query: Option<String>,
    query_target: Option<String>,
    query_direction: Option<GraphDirection>,
    query_depth: Option<usize>,
    history_selector: Option<RepositoryHistorySelectorKind>,
    limit: i64,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SettingsArguments {
    set: Option<(String, String)>,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct HistoryRootsArguments {
    operation: HistoryRootsOperation,
    path: Option<PathBuf>,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MemoriesArguments {
    source_id: Option<String>,
    diff: bool,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OnboardingArguments {
    complete: bool,
    default_adapter: Option<String>,
    output: OutputMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QaOperation {
    Inspect,
    SaveWorkflow,
    DeleteWorkflow,
    SaveTarget,
    DeleteTarget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct QaArguments {
    operation: QaOperation,
    repo_path: PathBuf,
    workflow_id: Option<String>,
    workflow_name: Option<String>,
    base_url: Option<String>,
    loop_id: Option<String>,
    runner_type: Option<String>,
    goal: Option<String>,
    repo_spec_path: Option<String>,
    repo_trace_mode: Option<String>,
    target_route: Option<String>,
    allow_remote_target: bool,
    target_id: Option<String>,
    target_name: Option<String>,
    fix_completed_at: Option<String>,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct McpArguments {
    repo_path: PathBuf,
    operation: McpSettingsOperation,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RetentionArguments {
    operation: SessionRetentionOperation,
    max_age_days: Option<i64>,
    max_archive_mib: Option<i64>,
    plan_id: Option<String>,
    vacuum: bool,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RubricsArguments {
    select: Option<String>,
    upsert: Option<RubricPackInput>,
    output: OutputMode,
}

#[derive(Debug, Clone)]
struct XrayArguments {
    request: XrayRequest,
    format: XrayFormat,
    save_path: Option<String>,
    output: OutputMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FixPacketArguments {
    run_id: String,
    finding_ids: Vec<String>,
    output: OutputMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FixOperation {
    Execute,
    Inspect,
    Discard,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FixArguments {
    operation: FixOperation,
    run_id: Option<String>,
    finding_ids: Vec<String>,
    attempt_id: Option<String>,
    agent: String,
    confirm_run: bool,
    confirm_discard: bool,
    timeout_ms: u64,
    output: OutputMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WarmOperation {
    Status,
    Start,
    Stop,
    Run,
    Cancel,
    Cleanup,
    Current,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WarmArguments {
    repo_path: PathBuf,
    operation: WarmOperation,
    run_id: Option<String>,
    detailed: bool,
    dry_run: bool,
    output: OutputMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DifferentialOperation {
    Prepare,
    Run,
    Cancel,
    Cleanup,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DifferentialArguments {
    repo_path: PathBuf,
    operation: DifferentialOperation,
    run_id: Option<String>,
    reference: Option<String>,
    candidate_kind: Option<String>,
    candidate_revision: Option<String>,
    dry_run: bool,
    output: OutputMode,
}

#[derive(Debug)]
struct ScenarioArguments {
    repo_path: PathBuf,
    action: ScenarioCompilerAction,
    output: OutputMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WatcherOperation {
    List,
    Enable,
    Disable,
    Poll,
    Retry,
    Runs,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WatcherArguments {
    repo_path: Option<PathBuf>,
    operation: WatcherOperation,
    interval_secs: Option<u64>,
    base_branch: Option<String>,
    pr_number: Option<i64>,
    limit: u32,
    confirm_run: bool,
    output: OutputMode,
}

enum CliCommand {
    Check(Box<CheckArguments>),
    Capabilities(OutputMode),
    CapabilitySchema,
    Collect(CollectArguments),
    Runs(RunsArguments),
    Performance(PerformanceArguments),
    Scope(ScopeArguments),
    Usage(UsageArguments),
    Quota(QuotaArguments),
    Ops(OpsArguments),
    Unpack(UnpackArguments),
    Settings(SettingsArguments),
    HistoryRoots(HistoryRootsArguments),
    Memories(MemoriesArguments),
    Onboarding(OnboardingArguments),
    Qa(QaArguments),
    Mcp(McpArguments),
    Retention(RetentionArguments),
    Rubrics(RubricsArguments),
    Xray(XrayArguments),
    FixPacket(FixPacketArguments),
    Fix(FixArguments),
    Warm(WarmArguments),
    Differential(DifferentialArguments),
    Scenario(ScenarioArguments),
    Watcher(WatcherArguments),
    Trex(TrexArguments),
    Help,
    Version,
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CliShutdownSignal {
    Interrupt,
    Terminate,
}

#[cfg(unix)]
impl CliShutdownSignal {
    const fn exit_code(self) -> i32 {
        match self {
            Self::Interrupt => 130,
            Self::Terminate => 143,
        }
    }
}

#[cfg(unix)]
async fn run_until_shutdown() -> Result<i32, String> {
    use tokio::signal::unix::{signal, SignalKind};

    let mut interrupt = signal(SignalKind::interrupt())
        .map_err(|error| format!("register SIGINT handler: {error}"))?;
    let mut terminate = signal(SignalKind::terminate())
        .map_err(|error| format!("register SIGTERM handler: {error}"))?;
    let mut command = Box::pin(run());
    let shutdown = async {
        tokio::select! {
            _ = interrupt.recv() => CliShutdownSignal::Interrupt,
            _ = terminate.recv() => CliShutdownSignal::Terminate,
        }
    };

    tokio::select! {
        result = &mut command => result,
        signal = shutdown => {
            if cancel_all_cli_reviews() > 0 {
                // The review future owns the agent process group. Wait for its
                // normal cancellation branch to kill and reap that group before
                // exiting the CLI parent, otherwise the executor is orphaned.
                let _ = command.await;
            }
            Ok(signal.exit_code())
        }
    }
}

#[tokio::main]
async fn main() {
    #[cfg(unix)]
    let result = run_until_shutdown().await;
    #[cfg(not(unix))]
    let result = run().await;
    let code = match result {
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
        CliCommand::Capabilities(output) => run_capabilities(output),
        CliCommand::CapabilitySchema => {
            println!(
                "{}",
                serde_json::to_string_pretty(&capability_registry_schema())
                    .map_err(|error| format!("serialize capability schema: {error}"))?
            );
            Ok(0)
        }
        CliCommand::Check(arguments) => run_check(*arguments).await,
        CliCommand::Collect(arguments) => run_collect(arguments).await,
        CliCommand::Runs(arguments) => run_runs(arguments),
        CliCommand::Performance(arguments) => run_performance(arguments).await,
        CliCommand::Scope(arguments) => run_scope(arguments).await,
        CliCommand::Usage(arguments) => run_usage(arguments).await,
        CliCommand::Quota(arguments) => run_quota(arguments),
        CliCommand::Ops(arguments) => run_ops(arguments),
        CliCommand::Unpack(arguments) => run_unpack(arguments),
        CliCommand::Settings(arguments) => run_settings(arguments),
        CliCommand::HistoryRoots(arguments) => execute_history_roots(arguments),
        CliCommand::Memories(arguments) => run_memories(arguments),
        CliCommand::Onboarding(arguments) => run_onboarding(arguments),
        CliCommand::Qa(arguments) => run_qa(arguments),
        CliCommand::Mcp(arguments) => run_mcp(arguments),
        CliCommand::Retention(arguments) => run_retention(arguments),
        CliCommand::Rubrics(arguments) => run_rubrics(arguments),
        CliCommand::Xray(arguments) => run_xray(arguments),
        CliCommand::FixPacket(arguments) => run_fix_packet(arguments),
        CliCommand::Fix(arguments) => run_fix(arguments).await,
        CliCommand::Warm(arguments) => run_warm(arguments).await,
        CliCommand::Differential(arguments) => run_differential(arguments).await,
        CliCommand::Scenario(arguments) => run_scenario(arguments).await,
        CliCommand::Watcher(arguments) => run_watcher(arguments).await,
        CliCommand::Trex(arguments) => run_trex(arguments).await,
    }
}

async fn run_warm(arguments: WarmArguments) -> Result<i32, String> {
    let repo_path = std::fs::canonicalize(&arguments.repo_path)
        .map_err(|error| {
            format!(
                "repository {} is unavailable: {error}",
                arguments.repo_path.display()
            )
        })?
        .to_string_lossy()
        .into_owned();
    let value = match arguments.operation {
        WarmOperation::Status => {
            serde_json::to_value(get_warm_verification_daemon_health_headless(repo_path).await?)
        }
        WarmOperation::Start => {
            serde_json::to_value(start_warm_verification_daemon_headless(repo_path).await?)
        }
        WarmOperation::Stop => {
            serde_json::to_value(stop_warm_verification_daemon_headless(repo_path).await?)
        }
        WarmOperation::Run => {
            let connection = db::init_db(default_app_data_dir()?)
                .map_err(|error| format!("open CodeVetter database: {error}"))?;
            let db = DbState(Arc::new(Mutex::new(connection)));
            serde_json::to_value(
                run_warm_changed_verification_headless(
                    &db,
                    repo_path,
                    arguments.detailed,
                    arguments
                        .run_id
                        .ok_or("--run-id is required for warm run")?,
                )
                .await?,
            )
        }
        WarmOperation::Cancel => serde_json::to_value(
            cancel_warm_verification_run_headless(
                repo_path,
                arguments
                    .run_id
                    .ok_or("--run-id is required for warm cancel")?,
            )
            .await?,
        ),
        WarmOperation::Cleanup => serde_json::to_value(
            cleanup_warm_verification_artifacts_headless(repo_path, arguments.dry_run).await?,
        ),
        WarmOperation::Current => {
            serde_json::to_value(get_current_warm_verification_identity_headless(repo_path).await?)
        }
    }
    .map_err(|error| format!("serialize warm verification receipt: {error}"))?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&value)
                .map_err(|error| format!("serialize warm verification receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_warm(arguments.operation, &value)),
    }
    let status = match arguments.operation {
        WarmOperation::Status if value.is_null() => 2,
        WarmOperation::Run => match value
            .pointer("/result/outcome")
            .and_then(serde_json::Value::as_str)
        {
            Some("passed") => 0,
            Some("regression") => 1,
            _ => 2,
        },
        WarmOperation::Cancel
            if value.get("accepted").and_then(serde_json::Value::as_bool) == Some(false) =>
        {
            2
        }
        _ => 0,
    };
    Ok(status)
}

async fn run_differential(arguments: DifferentialArguments) -> Result<i32, String> {
    let repo_path = std::fs::canonicalize(&arguments.repo_path)
        .map_err(|error| {
            format!(
                "repository {} is unavailable: {error}",
                arguments.repo_path.display()
            )
        })?
        .to_string_lossy()
        .into_owned();
    let value = match arguments.operation {
        DifferentialOperation::Prepare => serde_json::to_value(
            prepare_differential_verification_headless(
                repo_path,
                arguments.run_id.ok_or("--run-id is required")?,
                arguments.reference.ok_or("--reference is required")?,
                arguments.candidate_kind.ok_or("--candidate is required")?,
                arguments.candidate_revision,
            )
            .await?,
        ),
        DifferentialOperation::Run => {
            let connection = db::init_db(default_app_data_dir()?)
                .map_err(|error| format!("open CodeVetter database: {error}"))?;
            let db = DbState(Arc::new(Mutex::new(connection)));
            serde_json::to_value(
                run_differential_verification_headless(
                    &db,
                    repo_path,
                    arguments.run_id.ok_or("--run-id is required")?,
                    arguments.reference.ok_or("--reference is required")?,
                    arguments.candidate_kind.ok_or("--candidate is required")?,
                    arguments.candidate_revision,
                )
                .await?,
            )
        }
        DifferentialOperation::Cancel => serde_json::to_value(
            cancel_differential_verification_run_headless(
                repo_path,
                arguments.run_id.ok_or("--run-id is required")?,
            )
            .await?,
        ),
        DifferentialOperation::Cleanup => serde_json::to_value(
            cleanup_differential_verification_artifacts_headless(repo_path, arguments.dry_run)
                .await?,
        ),
    }
    .map_err(|error| format!("serialize differential receipt: {error}"))?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&value)
                .map_err(|error| format!("serialize differential receipt: {error}"))?
        ),
        OutputMode::Human => println!(
            "Differential verification · {:?}\n{}",
            arguments.operation,
            serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string())
        ),
    }
    Ok(match arguments.operation {
        DifferentialOperation::Prepare
            if value.get("status").and_then(serde_json::Value::as_str) != Some("ready") =>
        {
            2
        }
        DifferentialOperation::Run => match value
            .pointer("/summary/classification")
            .and_then(serde_json::Value::as_str)
        {
            Some("regressed") => 1,
            Some("incomparable") | None => 2,
            _ => 0,
        },
        DifferentialOperation::Cancel
            if value.get("accepted").and_then(serde_json::Value::as_bool) == Some(false) =>
        {
            2
        }
        _ => 0,
    })
}

async fn run_scenario(arguments: ScenarioArguments) -> Result<i32, String> {
    let repo_path = std::fs::canonicalize(&arguments.repo_path)
        .map_err(|error| {
            format!(
                "repository {} is unavailable: {error}",
                arguments.repo_path.display()
            )
        })?
        .to_string_lossy()
        .into_owned();
    let receipt = run_scenario_compiler_action_headless(repo_path, arguments.action).await?;
    let value = serde_json::to_value(&receipt)
        .map_err(|error| format!("serialize scenario compiler receipt: {error}"))?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&value)
                .map_err(|error| format!("serialize scenario compiler receipt: {error}"))?
        ),
        OutputMode::Human => println!(
            "Scenario compiler · {} · {}\n{}",
            value
                .get("action")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown"),
            value
                .get("status")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown"),
            value
                .get("message")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
        ),
    }
    Ok(
        match value.get("status").and_then(serde_json::Value::as_str) {
            Some("ok") => 0,
            Some("rejected") => 1,
            _ => 2,
        },
    )
}

async fn run_watcher(arguments: WatcherArguments) -> Result<i32, String> {
    let connection = db::init_db(default_app_data_dir()?)
        .map_err(|error| format!("open CodeVetter database: {error}"))?;
    let db = DbState(Arc::new(Mutex::new(connection)));
    let repo_path = arguments
        .repo_path
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned());
    let receipt = match arguments.operation {
        WatcherOperation::List => list_trex_watchers_headless(&db)?,
        WatcherOperation::Enable => enable_trex_watcher_headless(
            &db,
            StartTrexWatcherInput {
                repo_path: repo_path.ok_or("--repo is required for watcher enable")?,
                interval_secs: arguments.interval_secs,
                base_branch: arguments.base_branch,
            },
        )?,
        WatcherOperation::Disable => disable_trex_watcher_headless(
            &db,
            &repo_path.ok_or("--repo is required for watcher disable")?,
        )?,
        WatcherOperation::Poll => {
            if !arguments.confirm_run {
                return Err(
                    "watcher poll requires --confirm-run because it may use network access, invoke an agent, execute project code, and post GitHub statuses"
                        .to_string(),
                );
            }
            poll_trex_watcher_headless(
                &db,
                &repo_path.ok_or("--repo is required for watcher poll")?,
            )
            .await?
        }
        WatcherOperation::Retry => {
            if !arguments.confirm_run {
                return Err(
                    "watcher retry requires --confirm-run because it may use network access, invoke an agent, execute project code, and post GitHub statuses"
                        .to_string(),
                );
            }
            retry_trex_watcher_headless(
                &db,
                &repo_path.ok_or("--repo is required for watcher retry")?,
                arguments
                    .pr_number
                    .ok_or("--pr-number is required for watcher retry")?,
            )
            .await?
        }
        WatcherOperation::Runs => {
            list_trex_pr_runs_headless(&db, repo_path.as_deref(), arguments.limit)?
        }
    };
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize watcher receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_watcher(&receipt)),
    }
    Ok(0)
}

fn render_human_watcher(receipt: &TrexWatcherReceipt) -> String {
    let mut output = format!("PR watcher · {}\n{}\n", receipt.operation, receipt.message);
    if let Some(watcher) = &receipt.watcher {
        output.push_str(&format!(
            "{} · {} · every {}s\n",
            watcher.repo_path,
            if watcher.enabled {
                "enabled"
            } else {
                "disabled"
            },
            watcher.interval_secs,
        ));
    }
    if !receipt.watchers.is_empty() {
        for watcher in &receipt.watchers {
            output.push_str(&format!(
                "{} · {} · every {}s\n",
                watcher.repo_path,
                if watcher.enabled {
                    "enabled"
                } else {
                    "disabled"
                },
                watcher.interval_secs,
            ));
        }
    }
    for run in &receipt.runs {
        output.push_str(&format!(
            "PR #{} · {} · {} · {}ms\n",
            run.pr_number,
            run.verdict,
            run.head_sha.chars().take(7).collect::<String>(),
            run.duration_ms,
        ));
    }
    output
}

fn render_human_warm(operation: WarmOperation, value: &serde_json::Value) -> String {
    let label = match operation {
        WarmOperation::Status => "status",
        WarmOperation::Start => "start",
        WarmOperation::Stop => "stop",
        WarmOperation::Run => "run",
        WarmOperation::Cancel => "cancel",
        WarmOperation::Cleanup => "cleanup",
        WarmOperation::Current => "current identity",
    };
    format!(
        "Warm verification · {label}\n{}\n",
        serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
    )
}

fn run_fix_packet(arguments: FixPacketArguments) -> Result<i32, String> {
    let connection = db::init_db(default_app_data_dir()?)
        .map_err(|error| format!("open CodeVetter database: {error}"))?;
    let receipt = build_agent_fix_packet(&connection, &arguments.run_id, &arguments.finding_ids)?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize agent fix packet: {error}"))?
        ),
        OutputMode::Human => println!("{}", receipt.markdown),
    }
    Ok(0)
}

async fn run_fix(arguments: FixArguments) -> Result<i32, String> {
    let app_data_dir = default_app_data_dir()?;
    let receipt = match arguments.operation {
        FixOperation::Execute => {
            execute_fix_attempt(
                app_data_dir,
                FixAttemptInput {
                    run_id: arguments
                        .run_id
                        .ok_or("--run-id is required for fix execute")?,
                    finding_ids: arguments.finding_ids,
                    agent: arguments.agent,
                    confirmed: arguments.confirm_run,
                    timeout_ms: arguments.timeout_ms,
                },
            )
            .await?
        }
        FixOperation::Inspect => inspect_fix_attempt(
            &app_data_dir,
            arguments
                .attempt_id
                .as_deref()
                .ok_or("--attempt-id is required for fix inspect")?,
        )?,
        FixOperation::Discard => discard_fix_attempt(
            &app_data_dir,
            DiscardFixAttemptInput {
                attempt_id: arguments
                    .attempt_id
                    .ok_or("--attempt-id is required for fix discard")?,
                confirmed: arguments.confirm_discard,
            },
        )?,
    };
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize fix-attempt receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_fix_attempt(&receipt)),
    }
    Ok(match receipt.state.as_str() {
        "verified_fixed" | "discarded" => 0,
        "reproduced" | "failed" => 1,
        _ => 2,
    })
}

fn render_human_fix_attempt(receipt: &FixAttemptReceipt) -> String {
    let files = if receipt.change.changed_files.is_empty() {
        "none".into()
    } else {
        receipt.change.changed_files.join(", ")
    };
    let findings = receipt
        .recheck
        .findings
        .iter()
        .map(|finding| {
            format!(
                "- {} · {} · {}",
                finding.finding_id, finding.status, finding.reason
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "Isolated fix attempt · {}\nstate: {}\nagent: {} · {}\nworktree: {}\nretained: {}\nchanged files: {}\ndiff check: {}\ncorrectness: {}\nreview: {}\n{}{}\n",
        receipt.attempt_id,
        receipt.state,
        receipt.agent.id,
        receipt.agent.status,
        receipt.worktree.path,
        receipt.worktree.retained,
        files,
        receipt.recheck.diff_check.status,
        receipt.recheck.correctness.status,
        receipt.recheck.review.status,
        if findings.is_empty() { "" } else { "findings:\n" },
        findings,
    )
}

fn run_xray(arguments: XrayArguments) -> Result<i32, String> {
    let connection = db::init_db(default_app_data_dir()?)
        .map_err(|error| format!("open CodeVetter database: {error}"))?;
    let result = build_agent_pr_xray_from_connection(&connection, arguments.request.clone())?;
    let saved_path = arguments
        .save_path
        .map(|path| {
            save_agent_pr_xray_to_path(
                &connection,
                SaveXrayRequest {
                    xray: arguments.request,
                    format: arguments.format,
                    path,
                },
            )
        })
        .transpose()?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&result)
                .map_err(|error| format!("serialize X-Ray preview: {error}"))?
        ),
        OutputMode::Human => {
            println!(
                "Agent PR X-Ray · {}\noutcome: {}\neligible: {}\nfindings: {} · stages: {}\nmissing requirements: {} · sanitizer issues: {}{}",
                result.payload.xray_id,
                format!("{:?}", result.payload.outcome).to_ascii_lowercase(),
                if result.eligible { "yes" } else { "no" },
                result.payload.findings.len(),
                result.payload.stages.len(),
                result.missing_requirements.len(),
                result.sanitizer_issues.len(),
                saved_path
                    .as_deref()
                    .map(|path| format!("\nsaved: {path}"))
                    .unwrap_or_default(),
            );
        }
    }
    Ok(if result.eligible { 0 } else { 2 })
}

fn run_rubrics(arguments: RubricsArguments) -> Result<i32, String> {
    let connection = db::init_db(default_app_data_dir()?)
        .map_err(|error| format!("open CodeVetter database: {error}"))?;
    let receipt = if let Some(pack_id) = arguments.select {
        select_rubric_pack(&connection, &pack_id)?
    } else if let Some(pack) = arguments.upsert {
        upsert_rubric_pack(&connection, pack)?
    } else {
        read_rubric_settings(&connection, None)?
    };
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize rubric settings: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_rubrics(&receipt)),
    }
    Ok(0)
}

fn render_human_rubrics(receipt: &RubricSettingsReceipt) -> String {
    let mut output = format!(
        "Review rubrics · {} packs\nactive: {}\n",
        receipt.packs.len(),
        receipt
            .active_pack_id
            .as_deref()
            .unwrap_or("default (not explicitly selected)")
    );
    for pack in &receipt.packs {
        output.push_str(&format!(
            "{} {} · {} checks · {} reviews · {} findings\n",
            if pack.active { "*" } else { " " },
            pack.name,
            pack.checks.len(),
            pack.review_count,
            pack.total_findings,
        ));
    }
    output
}

fn run_retention(arguments: RetentionArguments) -> Result<i32, String> {
    let mut connection = db::init_db(default_app_data_dir()?)
        .map_err(|error| format!("open CodeVetter database: {error}"))?;
    let policy = if arguments.operation == SessionRetentionOperation::Plan {
        Some(SessionRetentionPolicy {
            max_age_days: arguments.max_age_days,
            max_archive_bytes: arguments
                .max_archive_mib
                .map(|value| value.saturating_mul(1024 * 1024)),
        })
    } else {
        None
    };
    let receipt = run_session_retention_operation(
        &mut connection,
        arguments.operation,
        policy,
        arguments.plan_id.as_deref(),
        arguments.vacuum,
    )?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize session retention: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_retention(&receipt)),
    }
    Ok(0)
}

fn render_human_retention(receipt: &SessionRetentionReceipt) -> String {
    match (&receipt.operation, &receipt.plan, &receipt.result) {
        (SessionRetentionOperation::Plan, Some(plan), _) => format!(
            "Session retention preview\nplan: {}\nremovable: {} sessions · {} rows · {} bytes\nprotected: {} sessions\nprojected archive: {} rows · {} bytes\nsource transcripts deleted: no\n",
            plan.id,
            plan.candidates.len(),
            plan.candidate_rows,
            plan.candidate_bytes,
            plan.protected.len(),
            plan.projected_rows,
            plan.projected_bytes,
        ),
        (SessionRetentionOperation::Apply, _, Some(result)) => format!(
            "Session retention applied\n{}\n",
            serde_json::to_string_pretty(result).unwrap_or_else(|_| result.to_string())
        ),
        (SessionRetentionOperation::Checkpoint, _, Some(result)) => format!(
            "Session archive checkpoint complete\n{}\n",
            serde_json::to_string_pretty(result).unwrap_or_else(|_| result.to_string())
        ),
        _ => "Session retention returned an incomplete receipt\n".to_string(),
    }
}

fn run_mcp(arguments: McpArguments) -> Result<i32, String> {
    let connection = db::init_db(default_app_data_dir()?)
        .map_err(|error| format!("open CodeVetter database: {error}"))?;
    let db = DbState(Arc::new(Mutex::new(connection)));
    let receipt = run_mcp_settings_operation(
        arguments.repo_path.to_string_lossy().into_owned(),
        arguments.operation,
        &db,
    )?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize MCP settings: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_mcp(&receipt)),
    }
    Ok(0)
}

fn render_human_mcp(receipt: &McpSettingsReceipt) -> String {
    let settings = &receipt.settings;
    format!(
        "Repository MCP · {:?}\nstate: {}\nhistory: {}{}\ntools: {} · resources: {}\naudit rows: {}{}\nserver: {}\n",
        receipt.operation,
        if settings.enabled { "enabled" } else { "disabled" },
        if settings.indexed { "indexed" } else { "not built" },
        if settings.stale { " (stale)" } else { "" },
        settings.tool_names.len(),
        settings.resource_kinds.len(),
        settings.recent_audit.len(),
        if receipt.cleared_audit_rows > 0 {
            format!(" · {} cleared", receipt.cleared_audit_rows)
        } else {
            String::new()
        },
        settings.server_path,
    )
}

fn run_settings(arguments: SettingsArguments) -> Result<i32, String> {
    let receipt = if let Some((key, value)) = arguments.set {
        let connection = db::init_db(default_app_data_dir()?)
            .map_err(|error| format!("open CodeVetter database: {error}"))?;
        set_native_setting(&connection, &key, &value)?
    } else {
        let connection = open_read_only_app_database()?;
        list_native_settings(connection.as_ref())?
    };
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize native settings: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_settings(&receipt)),
    }
    Ok(0)
}

fn run_ops(arguments: OpsArguments) -> Result<i32, String> {
    let connection = open_read_only_app_database()?;
    let receipt = inspect_ops_status(connection.as_ref(), arguments.window_days)?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize Ops status receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_ops(&receipt)),
    }
    Ok(0)
}

fn render_human_ops(receipt: &OpsStatusReceipt) -> String {
    format!(
        "Ops · {} days\ndatabase: {}\nbilling and webhook configuration: excluded\naggregate rows: {}\ncredentials and endpoint values: excluded\n",
        receipt.window_days,
        if receipt.database_available { "available" } else { "unavailable" },
        receipt.observability.len(),
    )
}

fn execute_history_roots(arguments: HistoryRootsArguments) -> Result<i32, String> {
    let receipt = match arguments.operation {
        HistoryRootsOperation::Read => {
            let connection = open_read_only_app_database()?;
            run_history_roots(connection.as_ref(), arguments.operation, None)?
        }
        HistoryRootsOperation::Add | HistoryRootsOperation::Remove => {
            let connection = db::init_db(default_app_data_dir()?)
                .map_err(|error| format!("open CodeVetter database: {error}"))?;
            run_history_roots(
                Some(&connection),
                arguments.operation,
                arguments.path.as_deref(),
            )?
        }
    };
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize history-roots receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_history_roots(&receipt)),
    }
    Ok(0)
}

fn run_memories(arguments: MemoriesArguments) -> Result<i32, String> {
    let operation = if arguments.diff {
        MemoryReceiptOperation::Diff
    } else if arguments.source_id.is_some() {
        MemoryReceiptOperation::Read
    } else {
        MemoryReceiptOperation::List
    };
    let receipt = run_memory_receipt(operation, arguments.source_id.as_deref())?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize memories receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_memories(&receipt)),
    }
    Ok(0)
}

fn render_human_memories(receipt: &MemoryReceipt) -> String {
    let mut output = format!(
        "Agent memories · {} of {} bounded sources\n",
        receipt.sources.len(),
        receipt.sources_total
    );
    for source in &receipt.sources {
        output.push_str(&format!(
            "  {} · {} · {} · {}\n",
            source.id,
            source.tool,
            source.label,
            if source.readable {
                "readable"
            } else {
                "unavailable"
            }
        ));
        output.push_str(&format!("    {}\n", source.display_path));
    }
    if let Some(document) = &receipt.document {
        output.push_str(&format!(
            "\nsource: {}{}\n{}\n",
            document.source_id,
            if document.truncated {
                " · truncated"
            } else {
                ""
            },
            document.content
        ));
    }
    if let Some(diff) = &receipt.diff {
        output.push_str(&format!("\ndiff: {} · {}\n", diff.source_id, diff.status));
        if !diff.diff.is_empty() {
            output.push_str(&diff.diff);
            output.push('\n');
        }
    }
    output.push_str(
        "\nRead-only local projection; absolute paths and agent authority are excluded.\n",
    );
    output
}

fn render_human_history_roots(receipt: &HistoryRootsReceipt) -> String {
    let mut output = format!(
        "Additional Codex history roots · {} configured\n",
        receipt.roots.len()
    );
    for root in &receipt.roots {
        let state = if !root.exists {
            "missing"
        } else if root.sessions_available || root.archived_sessions_available {
            "ready"
        } else {
            "no session folders"
        };
        output.push_str(&format!("  {} · {state}\n", root.display_path));
    }
    output.push_str("Saving a root does not start reconciliation or delete transcripts.\n");
    output
}

fn run_onboarding(arguments: OnboardingArguments) -> Result<i32, String> {
    let receipt = if arguments.complete {
        let connection = db::init_db(default_app_data_dir()?)
            .map_err(|error| format!("open CodeVetter database: {error}"))?;
        complete_onboarding(
            &connection,
            arguments
                .default_adapter
                .as_deref()
                .ok_or("--default-adapter is required with --complete")?,
        )?
    } else {
        let connection = open_read_only_app_database()?;
        inspect_onboarding(connection.as_ref())?
    };
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize onboarding receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_onboarding(&receipt)),
    }
    Ok(0)
}

fn render_human_onboarding(receipt: &OnboardingReceipt) -> String {
    let mut output = format!(
        "Native onboarding · {}\ndefault agent: {}\n",
        if receipt.completed {
            "complete"
        } else {
            "not complete"
        },
        receipt.default_adapter
    );
    for tool in &receipt.tools {
        output.push_str(&format!(
            "{}: {} · authentication {}\n",
            tool.label,
            if tool.available {
                "available"
            } else {
                "not found"
            },
            tool.authentication.replace('_', " ")
        ));
    }
    for limitation in &receipt.limitations {
        output.push_str(&format!("limit: {limitation}\n"));
    }
    output
}

fn render_human_settings(receipt: &NativeSettingsReceipt) -> String {
    let mut output = format!(
        "Native settings · {} declared non-secret values\n",
        receipt.settings.len()
    );
    if let Some(saved_key) = &receipt.saved_key {
        output.push_str(&format!("saved: {saved_key}\n"));
    }
    let mut current_section = "";
    for setting in &receipt.settings {
        if setting.section != current_section {
            current_section = &setting.section;
            output.push_str(&format!("\n{}\n", current_section));
        }
        output.push_str(&format!("  {} = {}\n", setting.key, setting.value));
    }
    output.push_str("\nSensitive credentials are excluded from this projection.\n");
    output
}

fn render_human_qa(receipt: &QaWorkspaceReceipt) -> String {
    let mut output = format!(
        "QA workspace · {} workflows · {} Playwright specs\n{}\n",
        receipt.workflows.len(),
        receipt.specs.len(),
        receipt.repo_path
    );
    for workflow in &receipt.workflows {
        output.push_str(&format!(
            "{} · {} · {} targets{}\n",
            workflow.name,
            workflow.runner_type,
            workflow.targets.len(),
            if workflow.editable {
                ""
            } else {
                " · read-only"
            }
        ));
    }
    if let Some(post_fix) = &receipt.post_fix {
        output.push_str(&format!(
            "post-fix {} · {}\n",
            post_fix.status, post_fix.summary
        ));
    }
    output
}

fn run_qa(arguments: QaArguments) -> Result<i32, String> {
    let connection = db::init_db(default_app_data_dir()?)
        .map_err(|error| format!("open CodeVetter database: {error}"))?;
    let mutation = match arguments.operation {
        QaOperation::Inspect => QaWorkspaceMutation::Inspect,
        QaOperation::SaveWorkflow => QaWorkspaceMutation::SaveWorkflow(StoredQaWorkflow {
            id: arguments.workflow_id.ok_or("--workflow-id is required")?,
            name: arguments
                .workflow_name
                .ok_or("--workflow-name is required")?,
            base_url: arguments.base_url.unwrap_or_default(),
            loop_id: arguments.loop_id.ok_or("--loop-id is required")?,
            runner_type: arguments.runner_type.ok_or("--runner is required")?,
            goal: arguments.goal.ok_or("--goal is required")?,
            repo_spec_path: arguments.repo_spec_path.unwrap_or_default(),
            repo_trace_mode: arguments
                .repo_trace_mode
                .unwrap_or_else(|| "retain-on-failure".into()),
            target_route: arguments.target_route.ok_or("--target-route is required")?,
            allow_remote_target: arguments.allow_remote_target,
            targets: Vec::new(),
            updated_at: String::new(),
        }),
        QaOperation::DeleteWorkflow => QaWorkspaceMutation::DeleteWorkflow {
            workflow_id: arguments.workflow_id.ok_or("--workflow-id is required")?,
        },
        QaOperation::SaveTarget => QaWorkspaceMutation::SaveTarget {
            workflow_id: arguments.workflow_id.ok_or("--workflow-id is required")?,
            target: QaTargetPreset {
                id: arguments.target_id.ok_or("--target-id is required")?,
                name: arguments.target_name.ok_or("--target-name is required")?,
                route: arguments.target_route.ok_or("--target-route is required")?,
                goal: arguments.goal.ok_or("--goal is required")?,
            },
        },
        QaOperation::DeleteTarget => QaWorkspaceMutation::DeleteTarget {
            workflow_id: arguments.workflow_id.ok_or("--workflow-id is required")?,
            target_id: arguments.target_id.ok_or("--target-id is required")?,
        },
    };
    let receipt = run_qa_workspace_headless(
        &connection,
        arguments.repo_path,
        mutation,
        arguments.fix_completed_at.as_deref(),
    )?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize QA workspace receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_qa(&receipt)),
    }
    Ok(0)
}

async fn run_usage(arguments: UsageArguments) -> Result<i32, String> {
    let connection = open_read_only_app_database()?;
    let report = get_headless_local_usage_report(
        connection.as_ref(),
        arguments.refresh,
        arguments.timezone.as_deref(),
    )
    .await?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&report)
                .map_err(|error| format!("serialize local usage report: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_usage(&report)),
    }
    Ok(match report.status.as_str() {
        "ready" => 0,
        "stale" => 1,
        _ => 2,
    })
}

fn run_quota(arguments: QuotaArguments) -> Result<i32, String> {
    let receipt = collect_provider_quotas(arguments.provider);
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize provider quota receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_quota(&receipt)),
    }
    let ready = receipt
        .providers
        .iter()
        .filter(|provider| provider.status == "ready")
        .count();
    Ok(if ready == receipt.providers.len() {
        0
    } else if ready > 0 {
        1
    } else {
        2
    })
}

#[derive(serde::Serialize)]
struct UnpackHistoryReceipt {
    schema_version: &'static str,
    generated_at: String,
    database_available: bool,
    repo_path: Option<String>,
    limit: i64,
    returned: usize,
    reports: Vec<UnpackReportSummary>,
}

fn run_unpack(arguments: UnpackArguments) -> Result<i32, String> {
    if arguments.operation == UnpackOperation::QueryWorker {
        let connection = open_read_only_app_database()?.ok_or_else(|| {
            "the CodeVetter database is unavailable; repository query worker cannot start"
                .to_string()
        })?;
        let stdin = std::io::stdin();
        let stdout = std::io::stdout();
        run_repository_query_worker(&connection, stdin.lock(), stdout.lock())?;
        return Ok(0);
    }

    if arguments.operation == UnpackOperation::Query {
        let repo_path = arguments
            .repo_path
            .as_deref()
            .ok_or_else(|| "--repo is required for unpack query".to_string())?;
        let connection = open_read_only_app_database()?.ok_or_else(|| {
            "the CodeVetter database is unavailable; repository evidence cannot be queried"
                .to_string()
        })?;
        let receipt = query_repository_evidence_with_input(
            &connection,
            Path::new(repo_path),
            RepositoryQueryInput {
                domain: arguments
                    .query_domain
                    .ok_or("--query-domain is required for unpack query")?,
                mode: arguments.query_mode,
                query: arguments
                    .query
                    .ok_or("--query is required for unpack query")?,
                target: arguments.query_target,
                direction: arguments.query_direction,
                depth: arguments.query_depth,
                history_selector: arguments.history_selector,
                limit: arguments.limit as usize,
            },
        )?;
        match arguments.output {
            OutputMode::Json => println!(
                "{}",
                serde_json::to_string(&receipt)
                    .map_err(|error| format!("serialize repository query: {error}"))?
            ),
            OutputMode::Human => print!("{}", render_human_repo_query(&receipt)),
        }
        return Ok(0);
    }

    if arguments.operation == UnpackOperation::Scan {
        let repo_path = arguments
            .repo_path
            .as_deref()
            .ok_or_else(|| "--repo is required for unpack scan".to_string())?;
        let repo_path = std::fs::canonicalize(repo_path)
            .map_err(|error| format!("repository {repo_path} is unavailable: {error}"))?;
        let repo_path = repo_path.to_string_lossy().into_owned();
        let connection = db::init_db(default_app_data_dir()?)
            .map_err(|error| format!("open CodeVetter database: {error}"))?;
        let receipt = scan_and_persist_unpack_snapshot(&connection, &repo_path, None, None)?;
        match arguments.output {
            OutputMode::Json => println!(
                "{}",
                serde_json::to_string(&receipt)
                    .map_err(|error| format!("serialize unpack scan receipt: {error}"))?
            ),
            OutputMode::Human => println!(
                "Saved Repo Unpack snapshot {} · {} files · {}",
                receipt.report_id, receipt.inventory.files_scanned, receipt.inventory.repo_path
            ),
        }
        return Ok(0);
    }

    if arguments.operation == UnpackOperation::Compare {
        let repo_path = arguments
            .repo_path
            .as_deref()
            .ok_or_else(|| "--repo is required for unpack compare".to_string())?;
        let repo_path = std::fs::canonicalize(repo_path)
            .map_err(|error| format!("repository {repo_path} is unavailable: {error}"))?;
        let range = compare_unpack_snapshot_commits_headless(
            &repo_path.to_string_lossy(),
            arguments
                .base_commit
                .as_deref()
                .ok_or("--base-commit is required for unpack compare")?,
            arguments
                .head_commit
                .as_deref()
                .ok_or("--head-commit is required for unpack compare")?,
        )?;
        match arguments.output {
            OutputMode::Json => println!(
                "{}",
                serde_json::to_string(&range)
                    .map_err(|error| format!("serialize unpack comparison: {error}"))?
            ),
            OutputMode::Human => println!(
                "Repo Unpack delta · {} commits · {} → {}{}",
                range.commit_count,
                &range.base_commit[..7],
                &range.head_commit[..7],
                if range.truncated { " · bounded" } else { "" }
            ),
        }
        return Ok(0);
    }

    if arguments.operation == UnpackOperation::Export {
        let connection = open_read_only_app_database()?.ok_or_else(|| {
            "the CodeVetter database is unavailable; no stored snapshot can be exported".to_string()
        })?;
        let receipt = export_repo_unpack_report_from_connection(
            &connection,
            arguments
                .report_id
                .as_deref()
                .ok_or("--report-id is required for unpack export")?,
            arguments
                .format
                .as_deref()
                .ok_or("--format is required for unpack export")?,
        )?;
        match arguments.output {
            OutputMode::Json => println!(
                "{}",
                serde_json::to_string(&receipt)
                    .map_err(|error| format!("serialize unpack export: {error}"))?
            ),
            OutputMode::Human => print!("{}", receipt.content),
        }
        return Ok(0);
    }

    let connection = open_read_only_app_database()?;
    if arguments.operation == UnpackOperation::Inspect {
        let report_id = arguments
            .report_id
            .ok_or_else(|| "--report-id is required for unpack inspect".to_string())?;
        let connection = connection.as_ref().ok_or_else(|| {
            "the CodeVetter database is unavailable; no stored snapshot can be inspected"
                .to_string()
        })?;
        let record = get_repo_unpack_report_from_connection(connection, &report_id)?;
        match arguments.output {
            OutputMode::Json => println!(
                "{}",
                serde_json::to_string(&record)
                    .map_err(|error| format!("serialize unpack snapshot: {error}"))?
            ),
            OutputMode::Human => print!("{}", render_human_unpack_record(&record)),
        }
        return Ok(0);
    }

    let reports = connection
        .as_ref()
        .map(|connection| {
            list_repo_unpack_reports_from_connection(
                connection,
                arguments.repo_path.as_deref(),
                Some(arguments.limit),
            )
        })
        .transpose()?
        .unwrap_or_default();
    let receipt = UnpackHistoryReceipt {
        schema_version: "codevetter.unpack-history/v1",
        generated_at: chrono::Utc::now().to_rfc3339(),
        database_available: connection.is_some(),
        repo_path: arguments.repo_path,
        limit: arguments.limit,
        returned: reports.len(),
        reports,
    };
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize unpack history: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_unpack_history(&receipt)),
    }
    Ok(0)
}

fn render_human_repo_query(receipt: &RepositoryQueryReceipt) -> String {
    let mut output = format!(
        "Repository {} {:?} query · {} · {}\n",
        match receipt.domain {
            RepositoryQueryDomain::Graph => "graph",
            RepositoryQueryDomain::History => "history",
        },
        receipt.mode,
        receipt.status,
        receipt.repo_path
    );
    if let Some(issue) = &receipt.issue {
        output.push_str(&format!("Coverage: {issue}\n"));
    }
    if let Some(result) = &receipt.graph_result {
        for hit in &result.hits {
            output.push_str(&format!(
                "- {} · {} · score {} · {}\n",
                hit.node.label, hit.node.kind, hit.score, hit.matched_by
            ));
        }
    }
    if let Some(result) = &receipt.graph_explanation {
        output.push_str(&format!(
            "- {} · {} incoming · {} outgoing\n",
            result.node.label, result.incoming_count, result.outgoing_count
        ));
    }
    if let Some(result) = &receipt.graph_impact {
        output.push_str(&format!(
            "- {} · {} affected · depth {}{}\n",
            result.root.label,
            result.affected.len(),
            result.depth_reached,
            if result.truncated { " · bounded" } else { "" }
        ));
    }
    if let Some(result) = &receipt.graph_path {
        output.push_str(&format!(
            "- {} nodes · {} edges · cost {:.3}{}\n",
            result.nodes.len(),
            result.edges.len(),
            result.total_cost,
            if result.truncated { " · bounded" } else { "" }
        ));
    }
    if let Some(result) = &receipt.history_result {
        for item in &result.items {
            output.push_str(&format!(
                "- {:?} · {} · {}\n",
                item.kind, item.label, item.summary
            ));
        }
    }
    if let Some(result) = &receipt.history_trace {
        output.push_str(&format!(
            "- {} causal episode(s) · {} scanned events{}\n",
            result.episodes.len(),
            result.scanned_events,
            if result.truncated { " · bounded" } else { "" }
        ));
    }
    output
}

async fn run_performance(arguments: PerformanceArguments) -> Result<i32, String> {
    let receipt = run_headless_performance(arguments.input).await?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize performance receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_performance(&receipt)),
    }
    Ok(match receipt.state.as_str() {
        "succeeded" => 0,
        "completed_with_rejection" => 1,
        _ => 2,
    })
}

async fn run_scope(arguments: ScopeArguments) -> Result<i32, String> {
    let receipt = resolve_evidence_scope(arguments.input).await?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string(&receipt)
                .map_err(|error| format!("serialize evidence scope receipt: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_scope(&receipt)),
    }
    Ok(if receipt.status == "ready" { 0 } else { 2 })
}

fn run_capabilities(output: OutputMode) -> Result<i32, String> {
    let registry = capability_registry();
    match output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string_pretty(&registry)
                .map_err(|error| format!("serialize capability registry: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_capabilities(&registry)),
    }
    Ok(0)
}

fn run_runs(arguments: RunsArguments) -> Result<i32, String> {
    let repo_path = arguments
        .repo_path
        .map(|path| {
            std::fs::canonicalize(&path)
                .map(|value| value.to_string_lossy().into_owned())
                .map_err(|error| format!("repository {} is unavailable: {error}", path.display()))
        })
        .transpose()?;
    let connection = db::init_db(default_app_data_dir()?)
        .map_err(|error| format!("open CodeVetter database: {error}"))?;
    let history = list_run_history(&connection, repo_path.as_deref(), arguments.limit)?;
    match arguments.output {
        OutputMode::Json => println!(
            "{}",
            serde_json::to_string_pretty(&history)
                .map_err(|error| format!("serialize run history: {error}"))?
        ),
        OutputMode::Human => print!("{}", render_human_runs(&history)),
    }
    Ok(0)
}

fn render_human_runs(history: &RunHistoryReceipt) -> String {
    if history.runs.is_empty() {
        return "No verification runs recorded.\n".into();
    }
    let mut output = String::new();
    for record in &history.runs {
        let source = record.source_label.as_deref().unwrap_or("—");
        output.push_str(&format!(
            "{}  {:?}  {}  {}\n  {}\n  {}\n",
            record.recorded_at,
            record.kind,
            record.outcome,
            source,
            record.title,
            record
                .repo_path
                .as_deref()
                .unwrap_or("No repository recorded"),
        ));
    }
    output
}

fn render_human_usage(report: &LocalUsageReport) -> String {
    let mut output = format!(
        "Local usage · {} {} · {}\nstatus: {}{}\nagents: {}\ntokens: {} total · {} generated · {} cache read\ncost: ${:.2}\nperiods: {} daily · {} weekly · {} monthly · {} sessions\nsource: {}\n",
        report.provenance.engine,
        report.provenance.version,
        report.provenance.timezone,
        report.status,
        if report.stale { " (stale)" } else { "" },
        if report.provenance.detected_agents.is_empty() {
            "none".into()
        } else {
            report.provenance.detected_agents.join(", ")
        },
        report.totals.total_tokens,
        report.totals.generated_tokens(),
        report.totals.cache_read_tokens,
        report.totals.cost_usd,
        report.daily.len(),
        report.weekly.len(),
        report.monthly.len(),
        report.sessions.len(),
        if report.provenance.source_fingerprint.is_empty() {
            "unavailable"
        } else {
            &report.provenance.source_fingerprint
        },
    );
    output.push_str("boundary: Claude, Codex, and Grok are accounted by ccusage; Devin and live provider quotas are separate.\n");
    if let Some(devin) = &report.devin {
        output.push_str(&format!(
            "devin: {} · {} sessions · {} generated · {} cache read · ${:.2} · all-time separate source\n",
            devin.status,
            devin.sessions,
            devin.generated_tokens,
            devin.cache_read_tokens,
            devin.cost_usd,
        ));
        if !devin.windows.is_empty() {
            output.push_str("devin windows:");
            for window in &devin.windows {
                output.push_str(&format!(
                    " {} {} sessions / {} generated / ${:.2};",
                    window.window, window.sessions, window.generated_tokens, window.cost_usd
                ));
            }
            output.push('\n');
        }
    }
    if let Some(error) = &report.error {
        output.push_str(&format!("error [{}]: {}\n", error.category, error.message));
    }
    if !report.provenance.excluded_agents.is_empty() {
        output.push_str(&format!(
            "excluded: {}\n",
            report.provenance.excluded_agents.join(", ")
        ));
    }
    output
}

fn render_human_quota(receipt: &ProviderQuotaReceipt) -> String {
    let mut output = format!(
        "Provider quota · {}\nsource boundary: provider-reported limits; never inferred from local spend\n",
        receipt.generated_at
    );
    for provider in &receipt.providers {
        output.push_str(&format!(
            "{}: {}{} · {}\n",
            provider.provider,
            provider.status,
            provider
                .plan
                .as_deref()
                .map(|plan| format!(" ({plan})"))
                .unwrap_or_default(),
            provider.source
        ));
        for window in &provider.windows {
            let reset = window
                .reset_description
                .as_deref()
                .map(|value| format!(" · resets {value}"))
                .or_else(|| {
                    window
                        .resets_at_unix
                        .map(|value| format!(" · resets at {value}"))
                })
                .unwrap_or_default();
            output.push_str(&format!(
                "  {}: {:.0}% remaining · {:.0}% used{}\n",
                window.label, window.remaining_percent, window.used_percent, reset
            ));
        }
        if let Some(credits) = &provider.credits {
            let amount = match (credits.used_amount, credits.limit_amount) {
                (Some(used), Some(limit)) => format!(" · ${used:.2} / ${limit:.2} spent"),
                _ => String::new(),
            };
            output.push_str(&format!(
                "  credits: {}% remaining{}\n",
                credits
                    .remaining_percent
                    .map(|value| format!("{value:.0}"))
                    .unwrap_or_else(|| "unknown".to_string()),
                amount
            ));
        }
        if let Some(count) = provider.reset_credits {
            output.push_str(&format!("  full reset credits: {count}\n"));
        }
        if let Some(message) = &provider.message {
            output.push_str(&format!("  {message}\n"));
        }
    }
    output
}

fn render_human_unpack_history(receipt: &UnpackHistoryReceipt) -> String {
    if !receipt.database_available {
        return "No CodeVetter database is available. No stored Repo Unpack snapshots were changed.\n"
            .into();
    }
    if receipt.reports.is_empty() {
        return "No stored Repo Unpack snapshots match this scope.\n".into();
    }
    let mut output = format!("Stored Repo Unpack snapshots ({})\n", receipt.returned);
    for report in &receipt.reports {
        output.push_str(&format!(
            "{}  {}  {} files  {}\n  {}\n",
            report.created_at,
            report.status,
            report.files_scanned,
            report.commit_sha.as_deref().unwrap_or("no commit"),
            report.id,
        ));
    }
    output
}

fn render_human_unpack_record(record: &UnpackReportRecord) -> String {
    format!(
        "{} · {}\nstatus: {}\ncommit: {}\nfiles: {} scanned · {} skipped\nbytes: {}\nanalysis: {}\nsnapshot: {}\n",
        record.summary.repo_name,
        record.summary.repo_path,
        record.summary.status,
        record.summary.commit_sha.as_deref().unwrap_or("unrecorded"),
        record.summary.files_scanned,
        record.summary.files_skipped,
        record.bytes_scanned,
        if record.summary.analysis_ready {
            "available"
        } else {
            "not generated"
        },
        record.summary.id,
    )
}

fn render_human_capabilities(registry: &CapabilityRegistry) -> String {
    let mut output = format!("CodeVetter capabilities ({})\n\n", registry.schema_version);
    for capability in &registry.capabilities {
        output.push_str(&format!(
            "{} [{} / {:?}]\n  {}\n  UI: {} | CLI: {} | agent: {}\n",
            capability.name,
            capability.id,
            capability.stage,
            capability.purpose,
            availability_label(capability.surfaces.ui.availability),
            availability_label(capability.surfaces.cli.availability),
            availability_label(capability.surfaces.agent.availability),
        ));
        if !capability.underlying_tools.is_empty() {
            output.push_str("  Uses: ");
            output.push_str(
                &capability
                    .underlying_tools
                    .iter()
                    .map(|tool| tool.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", "),
            );
            output.push('\n');
        }
        output.push_str(&format!("  Next: {}\n\n", capability.next_step));
    }
    output
}

fn availability_label(availability: Availability) -> &'static str {
    match availability {
        Availability::Available => "available",
        Availability::Building => "building",
        Availability::Planned => "planned",
        Availability::Unavailable => "unavailable",
    }
}

async fn run_collect(arguments: CollectArguments) -> Result<i32, String> {
    let receipt = collect_tool_evidence(ToolCollectionInput {
        repo_path: arguments.repo_path,
        change: arguments.change,
        collectors: arguments.collectors,
        rust_manifest: arguments.rust_manifest,
        rust_test: arguments.rust_test,
        advisory_db: arguments.advisory_db,
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
    let progress_json = arguments.progress_json;
    let request_id = arguments.request_id;
    let (standards_pack, standards_context) = if preflight {
        (None, None)
    } else {
        active_rubric_context()?
    };
    let input = LocalCheckInput {
        repo_path: arguments.repo_path,
        change: arguments.change,
        task: arguments.task,
        standards_pack,
        standards_context,
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
    let operation = if preflight {
        VerificationOperation::Preflight
    } else {
        VerificationOperation::Execute
    };
    let command = VerificationCommand::new(request_id, operation, input)?;
    let human_progress = output == OutputMode::Human;
    let result = run_verification_command(command, |progress| {
        if human_progress {
            eprintln!("[codevetter] {}: {}", progress.stage, progress.state);
        } else if progress_json {
            eprintln!("{}", render_progress_json(&progress));
        }
    })
    .await?;

    match result {
        VerificationResult::Preflight(receipt) => {
            match output {
                OutputMode::Json => println!(
                    "{}",
                    serde_json::to_string(&receipt)
                        .map_err(|error| format!("serialize local check preflight: {error}"))?
                ),
                OutputMode::Human => print!("{}", render_human_preflight(&receipt)),
            }
            Ok(preflight_exit_code(receipt.status))
        }
        VerificationResult::Complete(receipt) => {
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
    }
}

fn active_rubric_context() -> Result<(Option<String>, Option<String>), String> {
    let connection = db::init_db(default_app_data_dir()?)
        .map_err(|error| format!("open CodeVetter database: {error}"))?;
    let (active_pack_id, prompt) = active_rubric_prompt(&connection)?;
    Ok((active_pack_id, Some(prompt)))
}

fn render_progress_json(progress: &VerificationProgress) -> String {
    serde_json::to_string(progress).expect("verification progress is serializable")
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
            target_route: arguments.target_route,
            target_goal: arguments.target_goal,
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
        "capabilities" => {
            let arguments = arguments.collect::<Vec<_>>();
            return match arguments.as_slice() {
                [] => Ok(CliCommand::Capabilities(OutputMode::Human)),
                [argument] if argument == "--json" => {
                    Ok(CliCommand::Capabilities(OutputMode::Json))
                }
                [argument] if argument == "--schema" => Ok(CliCommand::CapabilitySchema),
                _ => Err("capabilities accepts only --json or --schema".to_string()),
            };
        }
        "check" => return parse_check(arguments, cwd),
        "collect" => return parse_collect(arguments, cwd),
        "runs" => return parse_runs(arguments),
        "performance" => return parse_performance(arguments, cwd),
        "scope" => return parse_scope(arguments, cwd),
        "usage" => return parse_usage(arguments),
        "quota" => return parse_quota(arguments),
        "ops" => return parse_ops(arguments),
        "unpack" => return parse_unpack(arguments),
        "settings" => return parse_settings(arguments),
        "history-roots" => return parse_history_roots(arguments),
        "memories" => return parse_memories(arguments),
        "onboarding" => return parse_onboarding(arguments),
        "qa" => return parse_qa(arguments, cwd),
        "mcp" => return parse_mcp(arguments),
        "retention" => return parse_retention(arguments),
        "rubrics" => return parse_rubrics(arguments),
        "fix" => return parse_fix(arguments),
        "fix-packet" => return parse_fix_packet(arguments),
        "xray" => return parse_xray(arguments),
        "warm" => return parse_warm(arguments, cwd),
        "differential" => return parse_differential(arguments, cwd),
        "scenario" => return parse_scenario(arguments, cwd),
        "watcher" => return parse_watcher(arguments, cwd),
        "trex" => {}
        _ => return Err(format!("unknown command `{command}`\n\n{HELP}")),
    }

    let mut repo_path = None;
    let mut pull_request = None;
    let mut range = None;
    let mut preview_url = None;
    let mut target_route = None;
    let mut target_goal = None;
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
            "--route" => {
                target_route = Some(required_value(&mut arguments, "--route")?);
            }
            "--journey-goal" => {
                target_goal = Some(required_value(&mut arguments, "--journey-goal")?);
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
        target_route,
        target_goal,
        output,
    }))
}

fn parse_watcher(
    mut arguments: impl Iterator<Item = String>,
    cwd: &Path,
) -> Result<CliCommand, String> {
    let mut repo_path = None;
    let mut operation = None;
    let mut interval_secs = None;
    let mut base_branch = None;
    let mut pr_number = None;
    let mut limit = 50_u32;
    let mut limit_supplied = false;
    let mut confirm_run = false;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--repo" => repo_path = Some(PathBuf::from(required_value(&mut arguments, "--repo")?)),
            "--operation" => operation = Some(required_value(&mut arguments, "--operation")?),
            "--interval-secs" => {
                interval_secs = Some(
                    required_value(&mut arguments, "--interval-secs")?
                        .parse::<u64>()
                        .map_err(|_| "--interval-secs must be a positive integer".to_string())?,
                )
            }
            "--base-branch" => base_branch = Some(required_value(&mut arguments, "--base-branch")?),
            "--pr-number" => {
                let value = required_value(&mut arguments, "--pr-number")?;
                let parsed = value
                    .parse::<i64>()
                    .map_err(|_| "--pr-number must be a positive integer".to_string())?;
                if parsed <= 0 {
                    return Err("--pr-number must be a positive integer".to_string());
                }
                pr_number = Some(parsed);
            }
            "--limit" => {
                limit_supplied = true;
                limit = required_value(&mut arguments, "--limit")?
                    .parse::<u32>()
                    .map_err(|_| "--limit must be an integer from 1 to 100".to_string())?;
                if !(1..=100).contains(&limit) {
                    return Err("--limit must be an integer from 1 to 100".to_string());
                }
            }
            "--confirm-run" => confirm_run = true,
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown watcher argument `{argument}`")),
        }
    }
    let operation = match operation
        .ok_or_else(|| "--operation is required for watcher".to_string())?
        .as_str()
    {
        "list" => WatcherOperation::List,
        "enable" => WatcherOperation::Enable,
        "disable" => WatcherOperation::Disable,
        "poll" => WatcherOperation::Poll,
        "retry" => WatcherOperation::Retry,
        "runs" => WatcherOperation::Runs,
        value => return Err(format!("unsupported watcher operation `{value}`")),
    };
    if operation != WatcherOperation::Enable && (interval_secs.is_some() || base_branch.is_some()) {
        return Err(
            "--interval-secs and --base-branch are only valid for watcher enable".to_string(),
        );
    }
    if operation != WatcherOperation::Runs && limit_supplied {
        return Err("--limit is only valid for watcher runs".to_string());
    }
    if operation != WatcherOperation::Retry && pr_number.is_some() {
        return Err("--pr-number is only valid for watcher retry".to_string());
    }
    if operation == WatcherOperation::Retry && pr_number.is_none() {
        return Err("--pr-number is required for watcher retry".to_string());
    }
    if !matches!(operation, WatcherOperation::Poll | WatcherOperation::Retry) && confirm_run {
        return Err("--confirm-run is only valid for watcher poll or retry".to_string());
    }
    if operation == WatcherOperation::List && repo_path.is_some() {
        return Err("watcher list does not accept --repo".to_string());
    }
    if operation == WatcherOperation::Poll && !confirm_run {
        return Err(
            "watcher poll requires --confirm-run because it may use network access, invoke an agent, execute project code, and post GitHub statuses"
                .to_string(),
        );
    }
    if operation == WatcherOperation::Retry && !confirm_run {
        return Err(
            "watcher retry requires --confirm-run because it may use network access, invoke an agent, execute project code, and post GitHub statuses"
                .to_string(),
        );
    }
    if matches!(
        operation,
        WatcherOperation::Enable
            | WatcherOperation::Disable
            | WatcherOperation::Poll
            | WatcherOperation::Retry
            | WatcherOperation::Runs
    ) && repo_path.is_none()
    {
        repo_path = Some(cwd.to_path_buf());
    }
    Ok(CliCommand::Watcher(WatcherArguments {
        repo_path,
        operation,
        interval_secs,
        base_branch,
        pr_number,
        limit,
        confirm_run,
        output,
    }))
}

fn parse_scenario(
    mut arguments: impl Iterator<Item = String>,
    cwd: &Path,
) -> Result<CliCommand, String> {
    let mut repo_path = None;
    let mut operation = None;
    let mut candidate_id = None;
    let mut candidate_hash = None;
    let mut spec_path = None;
    let mut spec_section = None;
    let mut model = None;
    let mut capabilities = Vec::new();
    let mut auth_profiles = Vec::new();
    let mut states = Vec::new();
    let mut routes = Vec::new();
    let mut examples = Vec::new();
    let mut include_request_policy = false;
    let mut destinations = Vec::new();
    let mut approve_replacements = false;
    let mut apply_cleanup = false;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--repo" => repo_path = Some(PathBuf::from(required_value(&mut arguments, "--repo")?)),
            "--operation" => operation = Some(required_value(&mut arguments, "--operation")?),
            "--candidate-id" => {
                candidate_id = Some(required_value(&mut arguments, "--candidate-id")?)
            }
            "--candidate-hash" => {
                candidate_hash = Some(required_value(&mut arguments, "--candidate-hash")?)
            }
            "--spec" => spec_path = Some(required_value(&mut arguments, "--spec")?),
            "--section" => spec_section = Some(required_value(&mut arguments, "--section")?),
            "--model" => model = Some(required_value(&mut arguments, "--model")?),
            "--capability" => capabilities.push(required_value(&mut arguments, "--capability")?),
            "--auth-profile" => {
                auth_profiles.push(required_value(&mut arguments, "--auth-profile")?)
            }
            "--state" => states.push(required_value(&mut arguments, "--state")?),
            "--route" => routes.push(required_value(&mut arguments, "--route")?),
            "--example" => examples.push(required_value(&mut arguments, "--example")?),
            "--request-policy" => include_request_policy = true,
            "--destination" => destinations.push(required_value(&mut arguments, "--destination")?),
            "--approve-replacements" => approve_replacements = true,
            "--apply-cleanup" => apply_cleanup = true,
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown scenario argument `{argument}`")),
        }
    }
    let operation = operation.ok_or_else(|| "--operation is required for scenario".to_string())?;
    let generation_fields = spec_path.is_some()
        || spec_section.is_some()
        || model.is_some()
        || include_request_policy
        || !capabilities.is_empty()
        || !auth_profiles.is_empty()
        || !states.is_empty()
        || !routes.is_empty()
        || !examples.is_empty();
    let acceptance_fields =
        candidate_hash.is_some() || !destinations.is_empty() || approve_replacements;
    let action = match operation.as_str() {
        "generate" => {
            if candidate_id.is_some() || acceptance_fields || apply_cleanup {
                return Err("scenario generate does not accept candidate mutation fields".into());
            }
            ScenarioCompilerAction::Generate {
                spec_source_path: spec_path.ok_or("--spec is required for scenario generate")?,
                spec_section,
                provider: Box::new(ProviderSelection {
                    kind: "local_command".into(),
                    provider: "local".into(),
                    model: model.ok_or("--model is required for scenario generate")?,
                    cost_class: "free".into(),
                    paid_approved: false,
                }),
                context: Box::new(ContextSelection {
                    capabilities,
                    auth_profiles,
                    states,
                    routes,
                    include_request_policy,
                    examples,
                }),
            }
        }
        "inspect" => {
            if generation_fields || acceptance_fields || apply_cleanup {
                return Err("scenario inspect accepts only an optional --candidate-id".into());
            }
            ScenarioCompilerAction::Inspect { candidate_id }
        }
        "validate" | "dry-run" => {
            if generation_fields || acceptance_fields || apply_cleanup {
                return Err("scenario validate and dry-run accept only --candidate-id".into());
            }
            let candidate_id = candidate_id.ok_or("--candidate-id is required")?;
            if operation == "validate" {
                ScenarioCompilerAction::Validate { candidate_id }
            } else {
                ScenarioCompilerAction::DryRun { candidate_id }
            }
        }
        "accept" => {
            if generation_fields || apply_cleanup {
                return Err("scenario accept does not accept generation or cleanup fields".into());
            }
            ScenarioCompilerAction::Accept {
                candidate_id: candidate_id.ok_or("--candidate-id is required")?,
                expected_candidate_hash: candidate_hash.ok_or("--candidate-hash is required")?,
                selected_destinations: destinations,
                approve_replacements,
            }
        }
        "reject" => {
            if generation_fields
                || !destinations.is_empty()
                || approve_replacements
                || apply_cleanup
            {
                return Err("scenario reject accepts only candidate identity and hash".into());
            }
            ScenarioCompilerAction::Reject {
                candidate_id: candidate_id.ok_or("--candidate-id is required")?,
                expected_candidate_hash: candidate_hash.ok_or("--candidate-hash is required")?,
            }
        }
        "cleanup" => {
            if generation_fields || candidate_id.is_some() || acceptance_fields || !apply_cleanup {
                return Err("scenario cleanup requires only explicit --apply-cleanup".into());
            }
            ScenarioCompilerAction::Cleanup {}
        }
        value => return Err(format!("unsupported scenario operation `{value}`")),
    };
    Ok(CliCommand::Scenario(ScenarioArguments {
        repo_path: repo_path.unwrap_or_else(|| cwd.to_path_buf()),
        action,
        output,
    }))
}

fn parse_differential(
    mut arguments: impl Iterator<Item = String>,
    cwd: &Path,
) -> Result<CliCommand, String> {
    let mut repo_path = None;
    let mut operation = None;
    let mut run_id = None;
    let mut reference = None;
    let mut candidate_kind = None;
    let mut candidate_revision = None;
    let mut dry_run = false;
    let mut apply_cleanup = false;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--repo" => repo_path = Some(PathBuf::from(required_value(&mut arguments, "--repo")?)),
            "--operation" => {
                operation = Some(
                    match required_value(&mut arguments, "--operation")?.as_str() {
                        "prepare" => DifferentialOperation::Prepare,
                        "run" => DifferentialOperation::Run,
                        "cancel" => DifferentialOperation::Cancel,
                        "cleanup" => DifferentialOperation::Cleanup,
                        value => {
                            return Err(format!("unsupported differential operation `{value}`"))
                        }
                    },
                )
            }
            "--run-id" => run_id = Some(required_value(&mut arguments, "--run-id")?),
            "--reference" => reference = Some(required_value(&mut arguments, "--reference")?),
            "--candidate" => {
                let value = required_value(&mut arguments, "--candidate")?;
                if !matches!(value.as_str(), "worktree" | "staged" | "commit" | "range") {
                    return Err("--candidate must be worktree, staged, commit, or range".into());
                }
                candidate_kind = Some(value);
            }
            "--revision" => {
                candidate_revision = Some(required_value(&mut arguments, "--revision")?)
            }
            "--dry-run" => dry_run = true,
            "--apply-cleanup" => apply_cleanup = true,
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown differential argument `{argument}`")),
        }
    }
    let operation =
        operation.ok_or_else(|| "--operation is required for differential".to_string())?;
    if matches!(
        operation,
        DifferentialOperation::Prepare | DifferentialOperation::Run
    ) {
        if run_id.is_none() || reference.is_none() || candidate_kind.is_none() {
            return Err(
                "differential prepare and run require --run-id, --reference, and --candidate"
                    .into(),
            );
        }
        let kind = candidate_kind.as_deref().unwrap_or_default();
        if matches!(kind, "commit" | "range") != candidate_revision.is_some() {
            return Err("--revision is required only for commit and range candidates".into());
        }
    } else if operation == DifferentialOperation::Cancel {
        if run_id.is_none()
            || reference.is_some()
            || candidate_kind.is_some()
            || candidate_revision.is_some()
        {
            return Err("differential cancel accepts only --run-id".into());
        }
    } else {
        if run_id.is_some()
            || reference.is_some()
            || candidate_kind.is_some()
            || candidate_revision.is_some()
        {
            return Err("differential cleanup does not accept run or source selection".into());
        }
        if dry_run == apply_cleanup {
            return Err(
                "differential cleanup requires exactly one of --dry-run or --apply-cleanup".into(),
            );
        }
    }
    if operation != DifferentialOperation::Cleanup && (dry_run || apply_cleanup) {
        return Err("cleanup authority is only valid for differential cleanup".into());
    }
    Ok(CliCommand::Differential(DifferentialArguments {
        repo_path: repo_path.unwrap_or_else(|| cwd.to_path_buf()),
        operation,
        run_id,
        reference,
        candidate_kind,
        candidate_revision,
        dry_run,
        output,
    }))
}

fn parse_warm(
    mut arguments: impl Iterator<Item = String>,
    cwd: &Path,
) -> Result<CliCommand, String> {
    let mut repo_path = None;
    let mut operation = None;
    let mut run_id = None;
    let mut detailed = false;
    let mut dry_run = false;
    let mut apply_cleanup = false;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--repo" => repo_path = Some(PathBuf::from(required_value(&mut arguments, "--repo")?)),
            "--operation" => {
                operation = Some(
                    match required_value(&mut arguments, "--operation")?.as_str() {
                        "status" => WarmOperation::Status,
                        "start" => WarmOperation::Start,
                        "stop" => WarmOperation::Stop,
                        "run" => WarmOperation::Run,
                        "cancel" => WarmOperation::Cancel,
                        "cleanup" => WarmOperation::Cleanup,
                        "current" => WarmOperation::Current,
                        value => return Err(format!("unsupported warm operation `{value}`")),
                    },
                );
            }
            "--run-id" => run_id = Some(required_value(&mut arguments, "--run-id")?),
            "--detailed" => detailed = true,
            "--dry-run" => dry_run = true,
            "--apply-cleanup" => apply_cleanup = true,
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown warm argument `{argument}`")),
        }
    }
    let operation = operation.ok_or_else(|| "--operation is required for warm".to_string())?;
    if matches!(operation, WarmOperation::Run | WarmOperation::Cancel) && run_id.is_none() {
        return Err("--run-id is required for warm run and cancel".into());
    }
    if !matches!(operation, WarmOperation::Run | WarmOperation::Cancel) && run_id.is_some() {
        return Err("--run-id is only valid for warm run and cancel".into());
    }
    if detailed && operation != WarmOperation::Run {
        return Err("--detailed is only valid for warm run".into());
    }
    if (dry_run || apply_cleanup) && operation != WarmOperation::Cleanup {
        return Err("--dry-run and --apply-cleanup are only valid for warm cleanup".into());
    }
    if operation == WarmOperation::Cleanup && dry_run == apply_cleanup {
        return Err("warm cleanup requires exactly one of --dry-run or --apply-cleanup".into());
    }
    Ok(CliCommand::Warm(WarmArguments {
        repo_path: repo_path.unwrap_or_else(|| cwd.to_path_buf()),
        operation,
        run_id,
        detailed,
        dry_run,
        output,
    }))
}

fn parse_fix_packet(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut run_id = None;
    let mut finding_ids = Vec::new();
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--run-id" => run_id = Some(required_value(&mut arguments, "--run-id")?),
            "--finding" => finding_ids.push(required_value(&mut arguments, "--finding")?),
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown fix-packet argument `{argument}`")),
        }
    }
    if finding_ids.len() > 100 {
        return Err("at most 100 --finding values are allowed".into());
    }
    Ok(CliCommand::FixPacket(FixPacketArguments {
        run_id: run_id.ok_or_else(|| "--run-id is required".to_string())?,
        finding_ids,
        output,
    }))
}

fn parse_fix(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut operation = None;
    let mut run_id = None;
    let mut finding_ids = Vec::new();
    let mut attempt_id = None;
    let mut agent = "codex".to_string();
    let mut confirm_run = false;
    let mut confirm_discard = false;
    let mut timeout_ms = 30_000;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--operation" => {
                operation = Some(
                    match required_value(&mut arguments, "--operation")?.as_str() {
                        "execute" => FixOperation::Execute,
                        "inspect" => FixOperation::Inspect,
                        "discard" => FixOperation::Discard,
                        value => return Err(format!("unsupported fix operation `{value}`")),
                    },
                );
            }
            "--run-id" => run_id = Some(required_value(&mut arguments, "--run-id")?),
            "--finding" => finding_ids.push(required_value(&mut arguments, "--finding")?),
            "--attempt-id" => attempt_id = Some(required_value(&mut arguments, "--attempt-id")?),
            "--agent" => agent = required_value(&mut arguments, "--agent")?,
            "--confirm-run" => confirm_run = true,
            "--confirm-discard" => confirm_discard = true,
            "--timeout-ms" => timeout_ms = parse_number(&mut arguments, "--timeout-ms")?,
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown fix argument `{argument}`")),
        }
    }
    let operation = operation.ok_or_else(|| "--operation is required for fix".to_string())?;
    match operation {
        FixOperation::Execute => {
            if run_id.is_none() || finding_ids.is_empty() {
                return Err("fix execute requires --run-id and at least one --finding".into());
            }
            if attempt_id.is_some() || confirm_discard {
                return Err(
                    "--attempt-id and --confirm-discard are not valid for fix execute".into(),
                );
            }
            if !confirm_run {
                return Err("fix execute requires --confirm-run".into());
            }
        }
        FixOperation::Inspect => {
            if attempt_id.is_none() {
                return Err("fix inspect requires --attempt-id".into());
            }
            if run_id.is_some()
                || !finding_ids.is_empty()
                || confirm_run
                || confirm_discard
                || agent != "codex"
                || timeout_ms != 30_000
            {
                return Err("fix inspect accepts only --attempt-id and output options".into());
            }
        }
        FixOperation::Discard => {
            if attempt_id.is_none() || !confirm_discard {
                return Err("fix discard requires --attempt-id and --confirm-discard".into());
            }
            if run_id.is_some()
                || !finding_ids.is_empty()
                || confirm_run
                || agent != "codex"
                || timeout_ms != 30_000
            {
                return Err(
                    "fix discard accepts only --attempt-id, --confirm-discard, and output options"
                        .into(),
                );
            }
        }
    }
    if finding_ids.len() > 100 {
        return Err("at most 100 --finding values are allowed".into());
    }
    Ok(CliCommand::Fix(FixArguments {
        operation,
        run_id,
        finding_ids,
        attempt_id,
        agent,
        confirm_run,
        confirm_discard,
        timeout_ms,
        output,
    }))
}

fn parse_xray(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut review_id = None;
    let mut public_source = None;
    let mut public_source_confirmed = false;
    let mut approved_excerpt_finding_ids = Vec::new();
    let mut corpus_state = None;
    let mut format = XrayFormat::Html;
    let mut save_path = None;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--review-id" => review_id = Some(required_value(&mut arguments, "--review-id")?),
            "--public-source" => {
                public_source = Some(required_value(&mut arguments, "--public-source")?)
            }
            "--confirm-public" => public_source_confirmed = true,
            "--approve-excerpt" => approved_excerpt_finding_ids
                .push(required_value(&mut arguments, "--approve-excerpt")?),
            "--corpus-state" => {
                corpus_state = Some(required_value(&mut arguments, "--corpus-state")?)
            }
            "--format" => {
                format = match required_value(&mut arguments, "--format")?.as_str() {
                    "json" => XrayFormat::Json,
                    "markdown" => XrayFormat::Markdown,
                    "html" => XrayFormat::Html,
                    _ => return Err("--format must be json, markdown, or html".into()),
                }
            }
            "--save" => save_path = Some(required_value(&mut arguments, "--save")?),
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown xray argument `{argument}`")),
        }
    }
    let review_id = review_id.ok_or_else(|| "--review-id is required".to_string())?;
    if review_id.len() > 128 || review_id.trim() != review_id || review_id.contains('\0') {
        return Err("--review-id must be a bounded non-empty identity".into());
    }
    if approved_excerpt_finding_ids.len() > 100 {
        return Err("at most 100 --approve-excerpt values are allowed".into());
    }
    Ok(CliCommand::Xray(XrayArguments {
        request: XrayRequest {
            review_id,
            public_source_confirmed,
            public_source,
            approved_excerpt_finding_ids,
            corpus_state,
        },
        format,
        save_path,
        output,
    }))
}

fn parse_rubrics(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut select = None;
    let mut id = None;
    let mut name = None;
    let mut focus = None;
    let mut checks = Vec::new();
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--select" => select = Some(required_value(&mut arguments, "--select")?),
            "--id" => id = Some(required_value(&mut arguments, "--id")?),
            "--name" => name = Some(required_value(&mut arguments, "--name")?),
            "--focus" => focus = Some(required_value(&mut arguments, "--focus")?),
            "--check" => checks.push(required_value(&mut arguments, "--check")?),
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown rubrics argument `{argument}`")),
        }
    }
    let has_upsert_input = id.is_some() || name.is_some() || focus.is_some() || !checks.is_empty();
    if select.is_some() && has_upsert_input {
        return Err("--select cannot be combined with custom-pack fields".into());
    }
    let upsert = if has_upsert_input {
        Some(RubricPackInput {
            id: id.ok_or_else(|| "custom rubric packs require --id".to_string())?,
            name: name.ok_or_else(|| "custom rubric packs require --name".to_string())?,
            focus: focus.ok_or_else(|| "custom rubric packs require --focus".to_string())?,
            checks,
        })
    } else {
        None
    };
    Ok(CliCommand::Rubrics(RubricsArguments {
        select,
        upsert,
        output,
    }))
}

fn parse_retention(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut max_age_days = None;
    let mut max_archive_mib = None;
    let mut plan_id = None;
    let mut checkpoint = false;
    let mut vacuum = false;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--max-age-days" => {
                max_age_days = Some(parse_number(&mut arguments, "--max-age-days")?)
            }
            "--max-archive-mib" => {
                max_archive_mib = Some(parse_number(&mut arguments, "--max-archive-mib")?)
            }
            "--apply" => plan_id = Some(required_value(&mut arguments, "--apply")?),
            "--checkpoint" => checkpoint = true,
            "--vacuum" => vacuum = true,
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown retention argument `{argument}`")),
        }
    }
    if plan_id.is_some() && checkpoint {
        return Err("choose exactly one of --apply or --checkpoint".into());
    }
    if vacuum && !checkpoint {
        return Err("--vacuum requires --checkpoint".into());
    }
    let operation = if plan_id.is_some() {
        SessionRetentionOperation::Apply
    } else if checkpoint {
        SessionRetentionOperation::Checkpoint
    } else {
        SessionRetentionOperation::Plan
    };
    if operation == SessionRetentionOperation::Plan {
        if max_age_days.is_none() && max_archive_mib.is_none() {
            return Err("retention preview requires --max-age-days or --max-archive-mib".into());
        }
        if max_age_days.is_some_and(|value| !(1..=3650).contains(&value)) {
            return Err("--max-age-days must be between 1 and 3650".into());
        }
        if max_archive_mib.is_some_and(|value| !(1..=524_288).contains(&value)) {
            return Err("--max-archive-mib must be between 1 and 524288".into());
        }
    } else if max_age_days.is_some() || max_archive_mib.is_some() {
        return Err("policy flags are only valid for a retention preview".into());
    }
    Ok(CliCommand::Retention(RetentionArguments {
        operation,
        max_age_days,
        max_archive_mib,
        plan_id,
        vacuum,
        output,
    }))
}

fn parse_usage(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut timezone = None;
    let mut refresh = false;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--timezone" => timezone = Some(required_value(&mut arguments, "--timezone")?),
            "--refresh" => refresh = true,
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown usage argument `{argument}`")),
        }
    }
    Ok(CliCommand::Usage(UsageArguments {
        timezone,
        refresh,
        output,
    }))
}

fn parse_quota(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut provider = ProviderQuotaSelection::All;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--provider" => {
                provider =
                    ProviderQuotaSelection::parse(&required_value(&mut arguments, "--provider")?)?;
            }
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown quota argument `{argument}`")),
        }
    }
    Ok(CliCommand::Quota(QuotaArguments { provider, output }))
}

fn parse_ops(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut window_days = 30_u32;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--window-days" => {
                window_days = parse_number(&mut arguments, "--window-days")?;
                if ![7, 30, 90].contains(&window_days) {
                    return Err("--window-days must be 7, 30, or 90".into());
                }
            }
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown ops argument `{argument}`")),
        }
    }
    Ok(CliCommand::Ops(OpsArguments {
        window_days,
        output,
    }))
}

fn parse_unpack(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut operation = None;
    let mut repo_path = None;
    let mut report_id = None;
    let mut base_commit = None;
    let mut head_commit = None;
    let mut format = None;
    let mut query_domain = None;
    let mut query_mode = RepositoryQueryMode::Search;
    let mut query_mode_set = false;
    let mut query = None;
    let mut query_target = None;
    let mut query_direction = None;
    let mut query_depth = None;
    let mut history_selector = None;
    let mut limit = 50_i64;
    let mut limit_set = false;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--operation" => {
                operation = Some(
                    match required_value(&mut arguments, "--operation")?.as_str() {
                        "list" => UnpackOperation::List,
                        "inspect" => UnpackOperation::Inspect,
                        "scan" => UnpackOperation::Scan,
                        "compare" => UnpackOperation::Compare,
                        "export" => UnpackOperation::Export,
                        "query" => UnpackOperation::Query,
                        "query-worker" => UnpackOperation::QueryWorker,
                        other => return Err(format!("unsupported unpack operation `{other}`")),
                    },
                )
            }
            "--repo" => repo_path = Some(required_value(&mut arguments, "--repo")?),
            "--report-id" => report_id = Some(required_value(&mut arguments, "--report-id")?),
            "--base-commit" => base_commit = Some(required_value(&mut arguments, "--base-commit")?),
            "--head-commit" => head_commit = Some(required_value(&mut arguments, "--head-commit")?),
            "--format" => format = Some(required_value(&mut arguments, "--format")?),
            "--query-domain" => {
                query_domain = Some(
                    match required_value(&mut arguments, "--query-domain")?.as_str() {
                        "graph" => RepositoryQueryDomain::Graph,
                        "history" => RepositoryQueryDomain::History,
                        other => return Err(format!("unsupported query domain '{other}'")),
                    },
                )
            }
            "--query-mode" => {
                query_mode = match required_value(&mut arguments, "--query-mode")?.as_str() {
                    "search" => RepositoryQueryMode::Search,
                    "explain" => RepositoryQueryMode::Explain,
                    "impact" => RepositoryQueryMode::Impact,
                    "path" => RepositoryQueryMode::Path,
                    "trace" => RepositoryQueryMode::Trace,
                    other => return Err(format!("unsupported query mode '{other}'")),
                };
                query_mode_set = true;
            }
            "--query" => query = Some(required_value(&mut arguments, "--query")?),
            "--query-target" => {
                query_target = Some(required_value(&mut arguments, "--query-target")?)
            }
            "--query-direction" => {
                query_direction = Some(
                    match required_value(&mut arguments, "--query-direction")?.as_str() {
                        "incoming" => GraphDirection::Incoming,
                        "outgoing" => GraphDirection::Outgoing,
                        "both" => GraphDirection::Both,
                        other => return Err(format!("unsupported query direction '{other}'")),
                    },
                )
            }
            "--query-depth" => query_depth = Some(parse_number(&mut arguments, "--query-depth")?),
            "--history-selector" => {
                history_selector = Some(
                    match required_value(&mut arguments, "--history-selector")?.as_str() {
                        "event" => RepositoryHistorySelectorKind::Event,
                        "entity" => RepositoryHistorySelectorKind::Entity,
                        "revision" => RepositoryHistorySelectorKind::Revision,
                        "release" => RepositoryHistorySelectorKind::Release,
                        "episode" => RepositoryHistorySelectorKind::Episode,
                        other => return Err(format!("unsupported history selector '{other}'")),
                    },
                )
            }
            "--limit" => {
                limit = parse_number(&mut arguments, "--limit")?;
                limit_set = true;
            }
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown unpack argument `{argument}`")),
        }
    }
    if !(1..=100).contains(&limit) {
        return Err("--limit must be between 1 and 100".into());
    }
    let operation = operation.unwrap_or_else(|| {
        if report_id.is_some() {
            UnpackOperation::Inspect
        } else {
            UnpackOperation::List
        }
    });
    match operation {
        UnpackOperation::List => {
            if report_id.is_some()
                || base_commit.is_some()
                || head_commit.is_some()
                || format.is_some()
                || query_domain.is_some()
                || query_mode_set
                || query.is_some()
                || query_target.is_some()
                || query_direction.is_some()
                || query_depth.is_some()
                || history_selector.is_some()
            {
                return Err("unpack list accepts only --repo and --limit".into());
            }
        }
        UnpackOperation::Inspect => {
            if report_id.is_none() {
                return Err("--report-id is required for unpack inspect".into());
            }
            if repo_path.is_some()
                || limit_set
                || base_commit.is_some()
                || head_commit.is_some()
                || format.is_some()
                || query_domain.is_some()
                || query_mode_set
                || query.is_some()
                || query_target.is_some()
                || query_direction.is_some()
                || query_depth.is_some()
                || history_selector.is_some()
            {
                return Err("unpack inspect accepts --report-id but not --repo or --limit".into());
            }
        }
        UnpackOperation::Scan => {
            if repo_path.is_none() {
                return Err("--repo is required for unpack scan".into());
            }
            if report_id.is_some()
                || limit_set
                || base_commit.is_some()
                || head_commit.is_some()
                || format.is_some()
                || query_domain.is_some()
                || query_mode_set
                || query.is_some()
                || query_target.is_some()
                || query_direction.is_some()
                || query_depth.is_some()
                || history_selector.is_some()
            {
                return Err("unpack scan accepts --repo but not --report-id or --limit".into());
            }
        }
        UnpackOperation::Compare => {
            if repo_path.is_none() || base_commit.is_none() || head_commit.is_none() {
                return Err(
                    "unpack compare requires --repo, --base-commit, and --head-commit".into(),
                );
            }
            if report_id.is_some()
                || limit_set
                || format.is_some()
                || query_domain.is_some()
                || query_mode_set
                || query.is_some()
                || query_target.is_some()
                || query_direction.is_some()
                || query_depth.is_some()
                || history_selector.is_some()
            {
                return Err(
                    "unpack compare does not accept --report-id, --limit, or --format".into(),
                );
            }
        }
        UnpackOperation::Export => {
            if report_id.is_none() || format.is_none() {
                return Err("unpack export requires --report-id and --format".into());
            }
            if repo_path.is_some()
                || limit_set
                || base_commit.is_some()
                || head_commit.is_some()
                || query_domain.is_some()
                || query_mode_set
                || query.is_some()
                || query_target.is_some()
                || query_direction.is_some()
                || query_depth.is_some()
                || history_selector.is_some()
            {
                return Err(
                    "unpack export does not accept --repo, --limit, or commit arguments".into(),
                );
            }
            if !matches!(
                format.as_deref(),
                Some(
                    "markdown"
                        | "html"
                        | "repo_graph_json"
                        | "agent_context_markdown"
                        | "repo_memory_markdown"
                )
            ) {
                return Err("unsupported unpack export format".into());
            }
        }
        UnpackOperation::Query => {
            if repo_path.is_none() || query_domain.is_none() || query.is_none() {
                return Err("unpack query requires --repo, --query-domain, and --query".into());
            }
            if report_id.is_some()
                || base_commit.is_some()
                || head_commit.is_some()
                || format.is_some()
            {
                return Err(
                    "unpack query does not accept snapshot, commit, or export arguments".into(),
                );
            }
            let domain = query_domain.expect("query domain checked");
            let valid_mode = match (domain, query_mode) {
                (RepositoryQueryDomain::Graph, RepositoryQueryMode::Search)
                | (RepositoryQueryDomain::Graph, RepositoryQueryMode::Explain) => {
                    query_target.is_none()
                        && query_direction.is_none()
                        && query_depth.is_none()
                        && history_selector.is_none()
                }
                (RepositoryQueryDomain::Graph, RepositoryQueryMode::Impact) => {
                    query_target.is_none() && history_selector.is_none()
                }
                (RepositoryQueryDomain::Graph, RepositoryQueryMode::Path) => {
                    query_target.is_some()
                        && query_direction.is_none()
                        && query_depth.is_none()
                        && history_selector.is_none()
                }
                (RepositoryQueryDomain::History, RepositoryQueryMode::Search) => {
                    query_target.is_none()
                        && query_direction.is_none()
                        && query_depth.is_none()
                        && history_selector.is_none()
                }
                (RepositoryQueryDomain::History, RepositoryQueryMode::Trace) => {
                    query_target.is_none()
                        && query_direction.is_none()
                        && query_depth.is_none()
                        && history_selector.is_some()
                }
                _ => false,
            };
            if !valid_mode {
                return Err("unpack query fields do not match the selected domain and mode".into());
            }
            if query_depth.is_some_and(|depth| !(1..=12).contains(&depth)) {
                return Err("--query-depth must be between 1 and 12".into());
            }
        }
        UnpackOperation::QueryWorker => {
            if repo_path.is_some()
                || report_id.is_some()
                || limit_set
                || base_commit.is_some()
                || head_commit.is_some()
                || format.is_some()
                || query_domain.is_some()
                || query_mode_set
                || query.is_some()
                || query_target.is_some()
                || query_direction.is_some()
                || query_depth.is_some()
                || history_selector.is_some()
                || output != OutputMode::Json
            {
                return Err(
                    "unpack query-worker accepts only --operation query-worker --json".into(),
                );
            }
        }
    }
    Ok(CliCommand::Unpack(UnpackArguments {
        operation,
        repo_path,
        report_id,
        base_commit,
        head_commit,
        format,
        query_domain,
        query_mode,
        query,
        query_target,
        query_direction,
        query_depth,
        history_selector,
        limit,
        output,
    }))
}

fn parse_qa(mut arguments: impl Iterator<Item = String>, cwd: &Path) -> Result<CliCommand, String> {
    let mut operation = QaOperation::Inspect;
    let mut repo_path = cwd.to_path_buf();
    let mut workflow_id = None;
    let mut workflow_name = None;
    let mut base_url = None;
    let mut loop_id = None;
    let mut runner_type = None;
    let mut goal = None;
    let mut repo_spec_path = None;
    let mut repo_trace_mode = None;
    let mut target_route = None;
    let mut allow_remote_target = false;
    let mut target_id = None;
    let mut target_name = None;
    let mut fix_completed_at = None;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--operation" => {
                operation = match required_value(&mut arguments, "--operation")?.as_str() {
                    "inspect" => QaOperation::Inspect,
                    "save-workflow" => QaOperation::SaveWorkflow,
                    "delete-workflow" => QaOperation::DeleteWorkflow,
                    "save-target" => QaOperation::SaveTarget,
                    "delete-target" => QaOperation::DeleteTarget,
                    other => return Err(format!("unsupported qa operation `{other}`")),
                }
            }
            "--repo" => repo_path = PathBuf::from(required_value(&mut arguments, "--repo")?),
            "--workflow-id" => workflow_id = Some(required_value(&mut arguments, "--workflow-id")?),
            "--workflow-name" => {
                workflow_name = Some(required_value(&mut arguments, "--workflow-name")?)
            }
            "--base-url" => base_url = Some(required_value(&mut arguments, "--base-url")?),
            "--loop-id" => loop_id = Some(required_value(&mut arguments, "--loop-id")?),
            "--runner" => runner_type = Some(required_value(&mut arguments, "--runner")?),
            "--goal" => goal = Some(required_value(&mut arguments, "--goal")?),
            "--repo-spec" => repo_spec_path = Some(required_value(&mut arguments, "--repo-spec")?),
            "--trace" => repo_trace_mode = Some(required_value(&mut arguments, "--trace")?),
            "--target-route" => {
                target_route = Some(required_value(&mut arguments, "--target-route")?)
            }
            "--allow-remote-target" => allow_remote_target = true,
            "--target-id" => target_id = Some(required_value(&mut arguments, "--target-id")?),
            "--target-name" => target_name = Some(required_value(&mut arguments, "--target-name")?),
            "--fix-completed-at" => {
                fix_completed_at = Some(required_value(&mut arguments, "--fix-completed-at")?)
            }
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown qa argument `{argument}`")),
        }
    }
    match operation {
        QaOperation::Inspect => {}
        QaOperation::SaveWorkflow => {
            if workflow_id.is_none()
                || workflow_name.is_none()
                || loop_id.is_none()
                || runner_type.is_none()
                || goal.is_none()
                || target_route.is_none()
            {
                return Err("qa save-workflow requires --workflow-id, --workflow-name, --loop-id, --runner, --goal, and --target-route".into());
            }
        }
        QaOperation::DeleteWorkflow => {
            if workflow_id.is_none() {
                return Err("qa delete-workflow requires --workflow-id".into());
            }
        }
        QaOperation::SaveTarget => {
            if workflow_id.is_none()
                || target_id.is_none()
                || target_name.is_none()
                || target_route.is_none()
                || goal.is_none()
            {
                return Err("qa save-target requires --workflow-id, --target-id, --target-name, --target-route, and --goal".into());
            }
        }
        QaOperation::DeleteTarget => {
            if workflow_id.is_none() || target_id.is_none() {
                return Err("qa delete-target requires --workflow-id and --target-id".into());
            }
        }
    }
    Ok(CliCommand::Qa(QaArguments {
        operation,
        repo_path,
        workflow_id,
        workflow_name,
        base_url,
        loop_id,
        runner_type,
        goal,
        repo_spec_path,
        repo_trace_mode,
        target_route,
        allow_remote_target,
        target_id,
        target_name,
        fix_completed_at,
        output,
    }))
}

fn parse_settings(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut set = None;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--set" => {
                if set.is_some() {
                    return Err("settings accepts at most one --set operation".into());
                }
                let assignment = required_value(&mut arguments, "--set")?;
                let (key, value) = assignment
                    .split_once('=')
                    .ok_or_else(|| "--set requires <key>=<value>".to_string())?;
                if key.is_empty() {
                    return Err("--set requires a non-empty key".into());
                }
                set = Some((key.to_string(), value.to_string()));
            }
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown settings argument `{argument}`")),
        }
    }
    Ok(CliCommand::Settings(SettingsArguments { set, output }))
}

fn parse_history_roots(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut operation = HistoryRootsOperation::Read;
    let mut path = None;
    let mut mutation_supplied = false;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--add" | "--remove" => {
                if mutation_supplied {
                    return Err("history-roots accepts only one add or remove operation".into());
                }
                mutation_supplied = true;
                operation = if argument == "--add" {
                    HistoryRootsOperation::Add
                } else {
                    HistoryRootsOperation::Remove
                };
                path = Some(PathBuf::from(required_value(&mut arguments, &argument)?));
            }
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown history-roots argument `{argument}`")),
        }
    }
    Ok(CliCommand::HistoryRoots(HistoryRootsArguments {
        operation,
        path,
        output,
    }))
}

fn parse_memories(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut source_id = None;
    let mut diff = false;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--source" => {
                if source_id.is_some() {
                    return Err("memories accepts at most one --source".into());
                }
                source_id = Some(required_value(&mut arguments, "--source")?);
            }
            "--diff" => {
                if diff {
                    return Err("memories accepts --diff only once".into());
                }
                diff = true;
            }
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown memories argument `{argument}`")),
        }
    }
    if diff && source_id.is_none() {
        return Err("memories --diff requires --source <opaque-id>".into());
    }
    Ok(CliCommand::Memories(MemoriesArguments {
        source_id,
        diff,
        output,
    }))
}

fn parse_onboarding(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut complete = false;
    let mut default_adapter = None;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--complete" => {
                if complete {
                    return Err("onboarding accepts --complete only once".into());
                }
                complete = true;
            }
            "--default-adapter" => {
                if default_adapter.is_some() {
                    return Err("onboarding accepts at most one --default-adapter".into());
                }
                default_adapter = Some(required_value(&mut arguments, "--default-adapter")?);
            }
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown onboarding argument `{argument}`")),
        }
    }
    if complete != default_adapter.is_some() {
        return Err("--complete and --default-adapter must be provided together".into());
    }
    if let Some(adapter) = default_adapter.as_deref() {
        if !matches!(adapter, "codex" | "claude-code") {
            return Err("--default-adapter must be codex or claude-code".into());
        }
    }
    Ok(CliCommand::Onboarding(OnboardingArguments {
        complete,
        default_adapter,
        output,
    }))
}

fn parse_mcp(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut repo_path = None;
    let mut operation = McpSettingsOperation::Read;
    let mut operation_set = false;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--repo" => repo_path = Some(PathBuf::from(required_value(&mut arguments, "--repo")?)),
            "--enable" | "--disable" | "--clear-audit" => {
                if operation_set {
                    return Err(
                        "choose at most one of --enable, --disable, or --clear-audit".into(),
                    );
                }
                operation_set = true;
                operation = match argument.as_str() {
                    "--enable" => McpSettingsOperation::Enable,
                    "--disable" => McpSettingsOperation::Disable,
                    _ => McpSettingsOperation::ClearAudit,
                };
            }
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown mcp argument `{argument}`")),
        }
    }
    Ok(CliCommand::Mcp(McpArguments {
        repo_path: repo_path.ok_or_else(|| "--repo is required".to_string())?,
        operation,
        output,
    }))
}

fn parse_performance(
    mut arguments: impl Iterator<Item = String>,
    cwd: &Path,
) -> Result<CliCommand, String> {
    let mut operation = None;
    let mut repo_path = None;
    let mut adapter = None;
    let mut target = None;
    let mut name = None;
    let mut request_id = None;
    let mut subject_run_id = None;
    let mut baseline_repo_path = None;
    let mut samples = None;
    let mut warmups = None;
    let mut timeout_ms = None;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--operation" => {
                operation = Some(parse_performance_operation(&required_value(
                    &mut arguments,
                    "--operation",
                )?)?)
            }
            "--repo" => repo_path = Some(required_value(&mut arguments, "--repo")?),
            "--adapter" => {
                adapter = Some(parse_performance_adapter(&required_value(
                    &mut arguments,
                    "--adapter",
                )?)?)
            }
            "--target" => target = Some(required_value(&mut arguments, "--target")?),
            "--name" => name = Some(required_value(&mut arguments, "--name")?),
            "--request-id" => request_id = Some(required_value(&mut arguments, "--request-id")?),
            "--subject-run-id" => {
                subject_run_id = Some(required_value(&mut arguments, "--subject-run-id")?)
            }
            "--baseline-repo" => {
                baseline_repo_path = Some(required_value(&mut arguments, "--baseline-repo")?)
            }
            "--samples" => samples = Some(parse_number(&mut arguments, "--samples")?),
            "--warmups" => warmups = Some(parse_number(&mut arguments, "--warmups")?),
            "--timeout-ms" => timeout_ms = Some(parse_number(&mut arguments, "--timeout-ms")?),
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown performance argument `{argument}`")),
        }
    }
    Ok(CliCommand::Performance(PerformanceArguments {
        input: PerformanceRunInput {
            request_id: request_id
                .unwrap_or_else(|| format!("performance-{}", uuid::Uuid::new_v4())),
            operation: operation.ok_or_else(|| "--operation is required".to_string())?,
            repo_path: repo_path.unwrap_or_else(|| cwd.to_string_lossy().into_owned()),
            adapter,
            target,
            name,
            samples,
            warmups,
            timeout_ms,
            subject_run_id,
            baseline_repo_path,
        },
        output,
    }))
}

fn parse_scope(
    mut arguments: impl Iterator<Item = String>,
    cwd: &Path,
) -> Result<CliCommand, String> {
    let mut repo_path = None;
    let mut consumer = None;
    let mut scope = None;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--repo" => repo_path = Some(required_value(&mut arguments, "--repo")?),
            "--consumer" => {
                let value = required_value(&mut arguments, "--consumer")?;
                consumer = Some(match value.as_str() {
                    "testing" => EvidenceScopeConsumer::Testing,
                    "performance" => EvidenceScopeConsumer::Performance,
                    _ => return Err("--consumer must be testing or performance".into()),
                });
            }
            "--flow" | "--change" | "--codebase" => {
                if scope.is_some() {
                    return Err("choose exactly one of --flow, --change, or --codebase".into());
                }
                scope = Some(match argument.as_str() {
                    "--flow" => (
                        EvidenceScopeKind::Flow,
                        Some(required_value(&mut arguments, "--flow")?),
                    ),
                    "--change" => (
                        EvidenceScopeKind::Change,
                        Some(required_value(&mut arguments, "--change")?),
                    ),
                    _ => (EvidenceScopeKind::Codebase, None),
                });
            }
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown scope argument `{argument}`")),
        }
    }
    let (kind, value) =
        scope.ok_or_else(|| "choose exactly one of --flow, --change, or --codebase".to_string())?;
    Ok(CliCommand::Scope(ScopeArguments {
        input: EvidenceScopeInput {
            repo_path: repo_path.unwrap_or_else(|| cwd.to_string_lossy().into_owned()),
            kind,
            value,
            consumer: consumer.ok_or_else(|| "--consumer is required".to_string())?,
        },
        output,
    }))
}

fn parse_performance_operation(value: &str) -> Result<PerformanceOperation, String> {
    match value {
        "plan" => Ok(PerformanceOperation::Plan),
        "diagnose" => Ok(PerformanceOperation::Diagnose),
        "verify-paired" => Ok(PerformanceOperation::VerifyPaired),
        "inspect" => Ok(PerformanceOperation::Inspect),
        _ => Err("--operation must be plan, diagnose, verify-paired, or inspect".into()),
    }
}

fn parse_performance_adapter(value: &str) -> Result<PerformanceAdapter, String> {
    match value {
        "vitest" => Ok(PerformanceAdapter::Vitest),
        "node-test" => Ok(PerformanceAdapter::NodeTest),
        "node-script" => Ok(PerformanceAdapter::NodeScript),
        "playwright" => Ok(PerformanceAdapter::Playwright),
        "go-bench" => Ok(PerformanceAdapter::GoBench),
        _ => {
            Err("--adapter must be vitest, node-test, node-script, playwright, or go-bench".into())
        }
    }
}

fn parse_runs(mut arguments: impl Iterator<Item = String>) -> Result<CliCommand, String> {
    let mut repo_path = None;
    let mut limit = 20usize;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--repo" => repo_path = Some(PathBuf::from(required_value(&mut arguments, "--repo")?)),
            "--limit" => limit = parse_number(&mut arguments, "--limit")?,
            "--json" => output = OutputMode::Json,
            "--help" | "-h" => return Ok(CliCommand::Help),
            _ => return Err(format!("unknown runs argument `{argument}`")),
        }
    }
    if !(1..=100).contains(&limit) {
        return Err("--limit must be between 1 and 100".into());
    }
    Ok(CliCommand::Runs(RunsArguments {
        repo_path,
        limit,
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
    let mut rust_manifest = None;
    let mut rust_test = None;
    let mut advisory_db = None;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--repo" => repo_path = Some(PathBuf::from(required_value(&mut arguments, "--repo")?)),
            "--range" => range = Some(required_value(&mut arguments, "--range")?),
            "--collector" => collectors.push(CollectorKind::parse(&required_value(
                &mut arguments,
                "--collector",
            )?)?),
            "--rust-manifest" => {
                rust_manifest = Some(PathBuf::from(required_value(
                    &mut arguments,
                    "--rust-manifest",
                )?))
            }
            "--rust-test" => rust_test = Some(required_value(&mut arguments, "--rust-test")?),
            "--advisory-db" => {
                advisory_db = Some(PathBuf::from(required_value(
                    &mut arguments,
                    "--advisory-db",
                )?))
            }
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
        rust_manifest,
        rust_test,
        advisory_db,
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
    let mut request_id = None;
    let mut preflight = false;
    let mut progress_json = false;
    let mut output = OutputMode::Human;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--repo" => repo_path = Some(PathBuf::from(required_value(&mut arguments, "--repo")?)),
            "--pr" => pull_request = Some(required_value(&mut arguments, "--pr")?),
            "--range" => range = Some(required_value(&mut arguments, "--range")?),
            "--task" => task = Some(required_value(&mut arguments, "--task")?),
            "--preflight" => preflight = true,
            "--progress-json" => progress_json = true,
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
            "--request-id" => request_id = Some(required_value(&mut arguments, "--request-id")?),
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
    if progress_json && output != OutputMode::Json {
        return Err("--progress-json requires --json".into());
    }
    if progress_json && preflight {
        return Err("--progress-json is only available for executable checks".into());
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
        request_id,
        preflight,
        progress_json,
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

fn open_read_only_app_database() -> Result<Option<rusqlite::Connection>, String> {
    let database_path = default_app_data_dir()?.join("codevetter.db");
    if !database_path.is_file() {
        return Ok(None);
    }
    rusqlite::Connection::open_with_flags(
        &database_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map(Some)
    .map_err(|error| {
        format!(
            "open CodeVetter database {} read-only: {error}",
            database_path.display()
        )
    })
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

fn render_human_scope(receipt: &EvidenceScopePlan) -> String {
    let consumer = match receipt.consumer {
        EvidenceScopeConsumer::Testing => "testing",
        EvidenceScopeConsumer::Performance => "performance",
    };
    let mut output = format!(
        "Evidence scope · {consumer}\nstatus: {}\nrevision: {}{}\nplan: {}\ncandidates: {} · uncovered paths: {}\n",
        receipt.status,
        receipt.repository_revision,
        if receipt.dirty { " · dirty" } else { " · clean" },
        receipt.plan_id,
        receipt.candidates.len(),
        receipt.uncovered_paths.len(),
    );
    for candidate in &receipt.candidates {
        let name = candidate
            .name
            .as_deref()
            .map(|value| format!(" · {value}"))
            .unwrap_or_default();
        output.push_str(&format!(
            "- {} · {}{} · {:.1}% · {}\n",
            candidate.adapter,
            candidate.target,
            name,
            f64::from(candidate.confidence_milli) / 10.0,
            candidate.reason,
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

fn render_human_performance(receipt: &PerformanceRunReceipt) -> String {
    let operation = match receipt.operation {
        PerformanceOperation::Test => "test",
        PerformanceOperation::Plan => "plan",
        PerformanceOperation::Diagnose => "diagnose",
        PerformanceOperation::Inspect => "inspect",
        PerformanceOperation::VerifyPaired => "verify-paired",
    };
    let verdict = receipt
        .result
        .pointer("/verdict/status")
        .or_else(|| receipt.result.pointer("/decision/status"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or(&receipt.state);
    let mut output = format!(
        "operation: {operation}\nstate: {}\nverdict: {verdict}\nduration: {} ms\nrequest: {}\n",
        receipt.state, receipt.duration_ms, receipt.request_id
    );
    if let Some(limitations) = receipt
        .result
        .get("limitations")
        .and_then(|value| value.as_array())
    {
        let limitations = limitations
            .iter()
            .filter_map(serde_json::Value::as_str)
            .collect::<Vec<_>>();
        if !limitations.is_empty() {
            output.push_str("limitations:\n");
            for limitation in limitations {
                output.push_str(&format!("- {limitation}\n"));
            }
        }
    }
    output
}

#[cfg(test)]
#[path = "../codevetter_cli_tests.rs"]
mod tests;
