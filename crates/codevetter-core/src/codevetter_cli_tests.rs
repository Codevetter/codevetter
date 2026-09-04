use super::*;
use codevetter_core::commands::local_check::{LocalCheckStage, LocalCheckStages};
use codevetter_core::commands::synthetic_qa::{SyntheticQaRunResult, SyntheticQaTrace};
use codevetter_core::commands::trex_preview::{
    TrexPreviewIdentity, TrexPreviewIdentityStatus, TrexPreviewRoute, TrexSourceReceipt,
};

const SURFACE_PARITY_FIXTURE: &str =
    include_str!("../tests/fixtures/surface-parity/evidence-scope-v1.json");
const LOCAL_CHECK_PARITY_FIXTURE: &str =
    include_str!("../tests/fixtures/surface-parity/local-check-v1.json");

#[cfg(unix)]
#[test]
fn cli_shutdown_uses_conventional_signal_exit_codes() {
    assert_eq!(CliShutdownSignal::Interrupt.exit_code(), 130);
    assert_eq!(CliShutdownSignal::Terminate.exit_code(), 143);
}

fn surface_parity_fixture() -> serde_json::Value {
    serde_json::from_str(SURFACE_PARITY_FIXTURE).expect("surface parity fixture")
}

fn local_check_parity_fixture() -> serde_json::Value {
    serde_json::from_str(LOCAL_CHECK_PARITY_FIXTURE).expect("local-check parity fixture")
}

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
            goal: None,
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
        request_id: None,
        run_id: "local-check-fixture".into(),
        ran_at: "2026-08-24T00:00:00Z".into(),
        repo_path: "/tmp/widget".into(),
        task: "Preserve behavior".into(),
        standards_pack: Some("product-safety".into()),
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
            "--route".into(),
            "/checkout".into(),
            "--journey-goal".into(),
            "Complete checkout".into(),
        ],
        cwd,
    )
    .expect("arguments") else {
        panic!("expected trex");
    };
    assert_eq!(arguments.repo_path, cwd);
    assert_eq!(arguments.change_kind, TrexChangeKind::Range);
    assert_eq!(arguments.target_route.as_deref(), Some("/checkout"));
    assert_eq!(arguments.target_goal.as_deref(), Some("Complete checkout"));
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

    let CliCommand::Unpack(compare) = parse_arguments(
        [
            "unpack".into(),
            "--operation".into(),
            "compare".into(),
            "--repo".into(),
            "/tmp/widget".into(),
            "--base-commit".into(),
            "1".repeat(40),
            "--head-commit".into(),
            "2".repeat(40),
            "--json".into(),
        ],
        cwd,
    )
    .expect("compare arguments") else {
        panic!("expected unpack compare");
    };
    assert_eq!(compare.operation, UnpackOperation::Compare);
    assert_eq!(
        compare.base_commit.as_deref(),
        Some("1111111111111111111111111111111111111111")
    );
    assert_eq!(
        compare.head_commit.as_deref(),
        Some("2222222222222222222222222222222222222222")
    );

    let CliCommand::Unpack(export) = parse_arguments(
        [
            "unpack".into(),
            "--operation".into(),
            "export".into(),
            "--report-id".into(),
            "snapshot-1".into(),
            "--format".into(),
            "repo_memory_markdown".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("export arguments") else {
        panic!("expected unpack export");
    };
    assert_eq!(export.operation, UnpackOperation::Export);
    assert_eq!(export.report_id.as_deref(), Some("snapshot-1"));
    assert_eq!(export.format.as_deref(), Some("repo_memory_markdown"));
    assert!(parse_arguments(
        [
            "unpack".into(),
            "--operation".into(),
            "export".into(),
            "--report-id".into(),
            "snapshot-1".into(),
            "--format".into(),
            "pdf".into(),
        ],
        cwd,
    )
    .is_err());

    assert!(parse_arguments(
        [
            "watcher".into(),
            "--operation".into(),
            "retry".into(),
            "--pr-number".into(),
            "42".into(),
        ],
        cwd,
    )
    .is_err());
    let CliCommand::Watcher(retry) = parse_arguments(
        [
            "watcher".into(),
            "--operation".into(),
            "retry".into(),
            "--pr-number".into(),
            "42".into(),
            "--confirm-run".into(),
        ],
        cwd,
    )
    .expect("confirmed watcher retry") else {
        panic!("expected watcher");
    };
    assert_eq!(retry.pr_number, Some(42));
    assert!(retry.confirm_run);
}

#[test]
fn qa_parser_preserves_inspect_and_safe_workflow_fields() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Qa(inspect) =
        parse_arguments(["qa".into(), "--json".into()], cwd).expect("qa inspect")
    else {
        panic!("expected qa");
    };
    assert_eq!(inspect.operation, QaOperation::Inspect);
    assert_eq!(inspect.repo_path, cwd);

    let CliCommand::Qa(save) = parse_arguments(
        [
            "qa".into(),
            "--operation".into(),
            "save-workflow".into(),
            "--workflow-id".into(),
            "checkout".into(),
            "--workflow-name".into(),
            "Checkout".into(),
            "--loop-id".into(),
            "checkout".into(),
            "--runner".into(),
            "repo_playwright".into(),
            "--goal".into(),
            "Complete checkout".into(),
            "--target-route".into(),
            "/checkout".into(),
        ],
        cwd,
    )
    .expect("qa save") else {
        panic!("expected qa");
    };
    assert_eq!(save.operation, QaOperation::SaveWorkflow);
    assert_eq!(save.workflow_id.as_deref(), Some("checkout"));
    assert!(parse_arguments(
        [
            "qa".into(),
            "--operation".into(),
            "save-workflow".into(),
            "--workflow-id".into(),
            "incomplete".into(),
        ],
        cwd,
    )
    .is_err());

    let CliCommand::Unpack(query) = parse_arguments(
        [
            "unpack".into(),
            "--operation".into(),
            "query".into(),
            "--repo".into(),
            "/tmp/widget".into(),
            "--query-domain".into(),
            "graph".into(),
            "--query".into(),
            "verification service".into(),
            "--limit".into(),
            "24".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("query arguments") else {
        panic!("expected unpack query");
    };
    assert_eq!(query.operation, UnpackOperation::Query);
    assert_eq!(query.query_domain, Some(RepositoryQueryDomain::Graph));
    assert_eq!(query.query_mode, RepositoryQueryMode::Search);
    assert_eq!(query.query.as_deref(), Some("verification service"));
    assert_eq!(query.limit, 24);
    let CliCommand::Unpack(path_query) = parse_arguments(
        [
            "unpack".into(),
            "--operation".into(),
            "query".into(),
            "--repo".into(),
            "/tmp/widget".into(),
            "--query-domain".into(),
            "graph".into(),
            "--query-mode".into(),
            "path".into(),
            "--query".into(),
            "node:start".into(),
            "--query-target".into(),
            "node:end".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("path query arguments") else {
        panic!("expected unpack path query");
    };
    assert_eq!(path_query.query_mode, RepositoryQueryMode::Path);
    assert_eq!(path_query.query_target.as_deref(), Some("node:end"));
    let CliCommand::Unpack(trace_query) = parse_arguments(
        [
            "unpack".into(),
            "--operation".into(),
            "query".into(),
            "--repo".into(),
            "/tmp/widget".into(),
            "--query-domain".into(),
            "history".into(),
            "--query-mode".into(),
            "trace".into(),
            "--history-selector".into(),
            "event".into(),
            "--query".into(),
            "event:verification".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("trace query arguments") else {
        panic!("expected unpack trace query");
    };
    assert_eq!(trace_query.query_mode, RepositoryQueryMode::Trace);
    assert_eq!(
        trace_query.history_selector,
        Some(RepositoryHistorySelectorKind::Event)
    );
    assert!(parse_arguments(
        [
            "unpack".into(),
            "--operation".into(),
            "query".into(),
            "--repo".into(),
            "/tmp/widget".into(),
            "--query".into(),
            "missing domain".into(),
        ],
        cwd,
    )
    .is_err());

    let CliCommand::Unpack(worker) = parse_arguments(
        [
            "unpack".into(),
            "--operation".into(),
            "query-worker".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("query worker arguments") else {
        panic!("expected unpack query worker");
    };
    assert_eq!(worker.operation, UnpackOperation::QueryWorker);
    assert!(parse_arguments(
        ["unpack".into(), "--operation".into(), "query-worker".into(),],
        cwd,
    )
    .is_err());
}

#[test]
fn warm_parser_preserves_lifecycle_run_and_cleanup_authority() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Warm(run) = parse_arguments(
        [
            "warm".into(),
            "--operation".into(),
            "run".into(),
            "--run-id".into(),
            "warm-native-1".into(),
            "--detailed".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("warm run") else {
        panic!("expected warm command");
    };
    assert_eq!(run.repo_path, cwd);
    assert_eq!(run.operation, WarmOperation::Run);
    assert_eq!(run.run_id.as_deref(), Some("warm-native-1"));
    assert!(run.detailed);
    assert_eq!(run.output, OutputMode::Json);

    let CliCommand::Warm(cleanup) = parse_arguments(
        [
            "warm".into(),
            "--operation".into(),
            "cleanup".into(),
            "--dry-run".into(),
        ],
        cwd,
    )
    .expect("warm cleanup preview") else {
        panic!("expected warm cleanup");
    };
    assert!(cleanup.dry_run);
    assert!(
        parse_arguments(["warm".into(), "--operation".into(), "cleanup".into()], cwd,).is_err()
    );
    assert!(parse_arguments(
        [
            "warm".into(),
            "--operation".into(),
            "cleanup".into(),
            "--dry-run".into(),
            "--apply-cleanup".into(),
        ],
        cwd,
    )
    .is_err());
}

#[test]
fn differential_parser_preserves_exact_pair_and_cleanup_authority() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Differential(arguments) = parse_arguments(
        [
            "differential".into(),
            "--operation".into(),
            "run".into(),
            "--run-id".into(),
            "diff-native-1".into(),
            "--reference".into(),
            "main".into(),
            "--candidate".into(),
            "range".into(),
            "--revision".into(),
            "main...HEAD".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("differential run") else {
        panic!("expected differential command");
    };
    assert_eq!(arguments.operation, DifferentialOperation::Run);
    assert_eq!(arguments.reference.as_deref(), Some("main"));
    assert_eq!(arguments.candidate_kind.as_deref(), Some("range"));
    assert_eq!(arguments.candidate_revision.as_deref(), Some("main...HEAD"));
    assert!(parse_arguments(
        [
            "differential".into(),
            "--operation".into(),
            "run".into(),
            "--run-id".into(),
            "diff-1".into(),
            "--reference".into(),
            "main".into(),
            "--candidate".into(),
            "range".into(),
        ],
        cwd,
    )
    .is_err());
    assert!(parse_arguments(
        [
            "differential".into(),
            "--operation".into(),
            "cleanup".into(),
            "--dry-run".into(),
        ],
        cwd,
    )
    .is_ok());
}

#[test]
fn scenario_parser_separates_generation_dry_run_and_file_acceptance() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Scenario(generate) = parse_arguments(
        [
            "scenario".into(),
            "--operation".into(),
            "generate".into(),
            "--spec".into(),
            "docs/checkout.md".into(),
            "--model".into(),
            "qwen2.5-coder:7b".into(),
            "--route".into(),
            "/checkout".into(),
            "--request-policy".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("scenario generate") else {
        panic!("expected scenario");
    };
    let ScenarioCompilerAction::Generate {
        provider, context, ..
    } = generate.action
    else {
        panic!("expected generate");
    };
    assert_eq!(provider.provider, "local");
    assert_eq!(context.routes, ["/checkout"]);
    assert!(context.include_request_policy);

    let CliCommand::Scenario(accept) = parse_arguments(
        [
            "scenario".into(),
            "--operation".into(),
            "accept".into(),
            "--candidate-id".into(),
            "candidate-1".into(),
            "--candidate-hash".into(),
            "a".repeat(64),
            "--destination".into(),
            ".codevetter/scenarios/checkout.yaml".into(),
            "--approve-replacements".into(),
        ],
        cwd,
    )
    .expect("scenario accept") else {
        panic!("expected scenario");
    };
    let ScenarioCompilerAction::Accept {
        selected_destinations,
        approve_replacements,
        ..
    } = accept.action
    else {
        panic!("expected accept");
    };
    assert_eq!(
        selected_destinations,
        [".codevetter/scenarios/checkout.yaml"]
    );
    assert!(approve_replacements);
    assert!(parse_arguments(
        ["scenario".into(), "--operation".into(), "cleanup".into()],
        cwd,
    )
    .is_err());
}

#[test]
fn watcher_parser_separates_configuration_from_confirmed_execution() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Watcher(enable) = parse_arguments(
        [
            "watcher".into(),
            "--operation".into(),
            "enable".into(),
            "--interval-secs".into(),
            "120".into(),
            "--base-branch".into(),
            "main".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("watcher enable") else {
        panic!("expected watcher");
    };
    assert_eq!(enable.repo_path.as_deref(), Some(cwd));
    assert_eq!(enable.interval_secs, Some(120));
    assert_eq!(enable.base_branch.as_deref(), Some("main"));
    assert!(!enable.confirm_run);
    assert_eq!(enable.output, OutputMode::Json);

    assert!(
        parse_arguments(["watcher".into(), "--operation".into(), "poll".into()], cwd,).is_err()
    );
    let CliCommand::Watcher(poll) = parse_arguments(
        [
            "watcher".into(),
            "--operation".into(),
            "poll".into(),
            "--confirm-run".into(),
        ],
        cwd,
    )
    .expect("confirmed watcher poll") else {
        panic!("expected watcher");
    };
    assert!(poll.confirm_run);
    assert!(parse_arguments(
        [
            "watcher".into(),
            "--operation".into(),
            "disable".into(),
            "--confirm-run".into(),
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
fn capabilities_parser_and_human_output_share_the_registry() {
    let cwd = Path::new("/tmp/widget");
    assert!(matches!(
        parse_arguments(["capabilities".into(), "--json".into()], cwd).expect("capabilities"),
        CliCommand::Capabilities(OutputMode::Json)
    ));
    assert!(matches!(
        parse_arguments(["capabilities".into(), "--schema".into()], cwd)
            .expect("capability schema"),
        CliCommand::CapabilitySchema
    ));
    assert!(parse_arguments(["capabilities".into(), "--unknown".into()], cwd).is_err());

    let output = render_human_capabilities(&capability_registry());
    assert!(output.contains("verification.local_check"));
    assert!(output.contains("native.evidence_workbench"));
    assert!(output.contains("UI: available | CLI: unavailable | agent: unavailable"));
}

#[test]
fn runs_parser_and_human_output_are_bounded() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Runs(arguments) = parse_arguments(
        [
            "runs".into(),
            "--repo".into(),
            "/tmp/widget".into(),
            "--limit".into(),
            "7".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("runs arguments") else {
        panic!("expected runs");
    };
    assert_eq!(arguments.repo_path, Some(PathBuf::from("/tmp/widget")));
    assert_eq!(arguments.limit, 7);
    assert_eq!(arguments.output, OutputMode::Json);
    assert!(parse_arguments(["runs".into(), "--limit".into(), "101".into()], cwd).is_err());

    let receipt = fixture_local_check(LocalCheckVerdict::PassedWithLimits);
    let history = RunHistoryReceipt {
        schema_version: "codevetter.run-history/v1".into(),
        generated_at: "2026-08-31T00:00:00Z".into(),
        repo_path: None,
        limit: 7,
        returned: 1,
        runs: vec![codevetter_core::commands::run_history::RunHistoryRecord {
            schema_version: "codevetter.run-record/v1".into(),
            id: receipt.run_id.clone(),
            kind: codevetter_core::commands::run_history::RunKind::LocalCheck,
            repo_path: Some(receipt.repo_path.clone()),
            recorded_at: receipt.ran_at.clone(),
            title: receipt.task.clone(),
            outcome: "passed_with_limits".into(),
            receipt_schema: receipt.schema_version.clone(),
            source_label: Some("bbbbbbbbbbbb".into()),
            limitations: receipt.limitations.clone(),
            receipt: serde_json::to_value(receipt).expect("receipt JSON"),
        }],
    };
    let output = render_human_runs(&history);
    assert!(output.contains("passed_with_limits"));
    assert!(output.contains("bbbbbbbbbbbb"));
    assert!(output.contains("LocalCheck"));
}

#[test]
fn usage_parser_and_human_output_preserve_provider_boundaries() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Usage(arguments) = parse_arguments(
        [
            "usage".into(),
            "--timezone".into(),
            "Asia/Kolkata".into(),
            "--refresh".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("usage arguments") else {
        panic!("expected usage");
    };
    assert_eq!(arguments.timezone.as_deref(), Some("Asia/Kolkata"));
    assert!(arguments.refresh);
    assert_eq!(arguments.output, OutputMode::Json);
    assert!(parse_arguments(["usage".into(), "--unknown".into()], cwd).is_err());

    let report: LocalUsageReport = serde_json::from_value(serde_json::json!({
        "status": "ready",
        "stale": false,
        "error": null,
        "provenance": {
            "engine": "ccusage",
            "version": "20.0.20",
            "generated_at": "2026-08-31T00:00:00Z",
            "timezone": "Asia/Kolkata",
            "window": "all",
            "detected_agents": ["claude", "codex", "grok"],
            "excluded_agents": ["devin"],
            "codex_roots": ["/tmp/codex"],
            "source_fingerprint": "sha256:fixture",
            "pricing_complete": true,
            "fallback_models": [],
            "unpriced_models": []
        },
        "daily": [],
        "weekly": [],
        "monthly": [],
        "sessions": [],
        "totals": {
            "input_tokens": 100,
            "cache_creation_tokens": 20,
            "cache_read_tokens": 300,
            "output_tokens": 40,
            "total_tokens": 460,
            "cost_usd": 1.25
        },
        "devin": {
            "status": "ready",
            "source": "CodeVetter SQLite",
            "sessions": 3,
            "generated_tokens": 1200,
            "cache_read_tokens": 400,
            "output_tokens": 100,
            "cost_usd": 0.52,
            "models": [],
            "windows": [{
                "window": "1w",
                "since": "2026-08-26",
                "sessions": 2,
                "generated_tokens": 800,
                "cache_read_tokens": 250,
                "cost_usd": 0.31,
                "models": []
            }],
            "limitations": ["Devin remains separate from ccusage totals."]
        }
    }))
    .expect("usage fixture");
    let output = render_human_usage(&report);
    assert!(output.contains("Local usage · ccusage 20.0.20 · Asia/Kolkata"));
    assert!(output.contains("tokens: 460 total · 160 generated · 300 cache read"));
    assert!(output.contains("Devin and live provider quotas are separate"));
    assert!(output.contains("devin windows: 1w 2 sessions / 800 generated / $0.31"));
    assert!(output.contains("excluded: devin"));
}

#[test]
fn quota_parser_and_human_output_preserve_remaining_and_unavailable_states() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Quota(arguments) = parse_arguments(
        [
            "quota".into(),
            "--provider".into(),
            "codex".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("quota arguments") else {
        panic!("expected quota");
    };
    assert_eq!(arguments.provider, ProviderQuotaSelection::Codex);
    assert_eq!(arguments.output, OutputMode::Json);
    assert!(parse_arguments(["quota".into(), "--provider".into(), "unknown".into()], cwd).is_err());

    let receipt = ProviderQuotaReceipt {
        schema_version: "codevetter.provider-quota/v1".into(),
        generated_at: "2026-09-03T00:00:00Z".into(),
        providers: vec![
            codevetter_core::commands::provider_quota::ProviderQuotaStatus {
                provider: "codex".into(),
                status: "ready".into(),
                source: "codex app-server account/rateLimits/read".into(),
                checked_at: "2026-09-03T00:00:00Z".into(),
                plan: Some("pro".into()),
                windows: vec![
                    codevetter_core::commands::provider_quota::ProviderQuotaWindow {
                        id: "codex.primary".into(),
                        label: "Weekly window".into(),
                        used_percent: 92.0,
                        remaining_percent: 8.0,
                        window_duration_minutes: Some(10_080),
                        resets_at_unix: Some(1_788_750_854),
                        reset_description: None,
                    },
                ],
                credits: None,
                reset_credits: Some(1),
                message: None,
            },
            codevetter_core::commands::provider_quota::ProviderQuotaStatus {
                provider: "claude".into(),
                status: "unavailable".into(),
                source: "Claude Code /usage".into(),
                checked_at: "2026-09-03T00:00:00Z".into(),
                plan: None,
                windows: vec![],
                credits: None,
                reset_credits: None,
                message: Some("Open Claude Code and run /usage.".into()),
            },
        ],
        limitations: vec![],
    };
    let output = render_human_quota(&receipt);
    assert!(output.contains("Weekly window: 8% remaining"));
    assert!(output.contains("full reset credits: 1"));
    assert!(output.contains("claude: unavailable"));
    assert!(!output.contains("0% remaining\n  Open Claude"));
}

#[test]
fn ops_parser_and_human_output_preserve_read_only_secret_boundary() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Ops(arguments) = parse_arguments(
        [
            "ops".into(),
            "--window-days".into(),
            "90".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("Ops arguments") else {
        panic!("expected Ops");
    };
    assert_eq!(arguments.window_days, 90);
    assert_eq!(arguments.output, OutputMode::Json);
    assert!(parse_arguments(["ops".into(), "--window-days".into(), "365".into()], cwd).is_err());

    let receipt = OpsStatusReceipt {
        schema_version: "codevetter.ops-status/v1".into(),
        generated_at: "2026-09-02T00:00:00Z".into(),
        database_available: true,
        window_days: 90,
        billing: OpsBillingStatus {
            anthropic_configured: true,
            openai_configured: false,
        },
        webhook: OpsWebhookStatus {
            configured: true,
            flavor: "slack".into(),
        },
        observability: Vec::new(),
        excluded_sensitive_keys: vec!["anthropic_admin_key".into()],
        limitations: vec!["read only".into()],
    };
    let output = render_human_ops(&receipt);
    assert!(output.contains("Ops · 90 days"));
    assert!(output.contains("billing and webhook configuration: excluded"));
    assert!(!output.contains("Anthropic"));
    assert!(!output.contains("slack"));
    assert!(output.contains("credentials and endpoint values: excluded"));
}

#[test]
fn unpack_parser_bounds_history_inspection_and_explicit_scan_authority() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Unpack(arguments) = parse_arguments(
        [
            "unpack".into(),
            "--repo".into(),
            "/tmp/widget".into(),
            "--limit".into(),
            "25".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("unpack arguments") else {
        panic!("expected unpack");
    };
    assert_eq!(arguments.operation, UnpackOperation::List);
    assert_eq!(arguments.repo_path.as_deref(), Some("/tmp/widget"));
    assert_eq!(arguments.limit, 25);
    assert_eq!(arguments.output, OutputMode::Json);
    assert!(parse_arguments(["unpack".into(), "--limit".into(), "101".into()], cwd).is_err());
    assert!(parse_arguments(
        [
            "unpack".into(),
            "--repo".into(),
            "/tmp/widget".into(),
            "--report-id".into(),
            "snapshot-1".into(),
        ],
        cwd,
    )
    .is_err());

    let CliCommand::Unpack(scan) = parse_arguments(
        [
            "unpack".into(),
            "--operation".into(),
            "scan".into(),
            "--repo".into(),
            "/tmp/widget".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("scan arguments") else {
        panic!("expected unpack scan");
    };
    assert_eq!(scan.operation, UnpackOperation::Scan);
    assert_eq!(scan.repo_path.as_deref(), Some("/tmp/widget"));
    assert!(scan.report_id.is_none());
    assert!(parse_arguments(
        [
            "unpack".into(),
            "--operation".into(),
            "scan".into(),
            "--repo".into(),
            "/tmp/widget".into(),
            "--limit".into(),
            "1".into(),
        ],
        cwd,
    )
    .is_err());
}

#[test]
fn settings_parser_preserves_one_explicit_non_secret_assignment() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Settings(arguments) = parse_arguments(
        [
            "settings".into(),
            "--set".into(),
            "review_tone=strict".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("settings arguments") else {
        panic!("expected settings");
    };
    assert_eq!(arguments.set, Some(("review_tone".into(), "strict".into())));
    assert_eq!(arguments.output, OutputMode::Json);
    assert!(parse_arguments(["settings".into(), "--set".into(), "missing".into()], cwd,).is_err());
    assert!(parse_arguments(
        [
            "settings".into(),
            "--set".into(),
            "review_tone=strict".into(),
            "--set".into(),
            "compact_mode=true".into(),
        ],
        cwd,
    )
    .is_err());
}

#[test]
fn history_roots_parser_separates_read_add_and_remove() {
    let cwd = Path::new("/tmp/widget");
    assert!(matches!(
        parse_arguments(["history-roots".into(), "--json".into()], cwd).expect("read roots"),
        CliCommand::HistoryRoots(HistoryRootsArguments {
            operation: HistoryRootsOperation::Read,
            path: None,
            output: OutputMode::Json,
        })
    ));

    let CliCommand::HistoryRoots(add) = parse_arguments(
        [
            "history-roots".into(),
            "--add".into(),
            "/tmp/codex".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("add root") else {
        panic!("expected history-roots add");
    };
    assert_eq!(add.operation, HistoryRootsOperation::Add);
    assert_eq!(add.path, Some(PathBuf::from("/tmp/codex")));

    assert!(parse_arguments(
        [
            "history-roots".into(),
            "--add".into(),
            "/tmp/one".into(),
            "--remove".into(),
            "/tmp/two".into(),
        ],
        cwd,
    )
    .is_err());
}

#[test]
fn memories_parser_separates_list_read_and_redacted_diff() {
    let cwd = Path::new("/tmp/widget");
    assert!(matches!(
        parse_arguments(["memories".into(), "--json".into()], cwd).expect("list memories"),
        CliCommand::Memories(MemoriesArguments {
            source_id: None,
            diff: false,
            output: OutputMode::Json,
        })
    ));

    let CliCommand::Memories(read) = parse_arguments(
        [
            "memories".into(),
            "--source".into(),
            "memory:sha256:fixture".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("read memory") else {
        panic!("expected memories read");
    };
    assert_eq!(read.source_id.as_deref(), Some("memory:sha256:fixture"));
    assert!(!read.diff);

    let CliCommand::Memories(diff) = parse_arguments(
        [
            "memories".into(),
            "--source".into(),
            "memory:sha256:fixture".into(),
            "--diff".into(),
        ],
        cwd,
    )
    .expect("memory diff") else {
        panic!("expected memories diff");
    };
    assert!(diff.diff);
    assert!(parse_arguments(["memories".into(), "--diff".into()], cwd).is_err());
}

#[test]
fn onboarding_parser_separates_inspection_from_explicit_completion() {
    let cwd = Path::new("/tmp/widget");
    assert!(matches!(
        parse_arguments(["onboarding".into(), "--json".into()], cwd).expect("inspect onboarding"),
        CliCommand::Onboarding(OnboardingArguments {
            complete: false,
            default_adapter: None,
            output: OutputMode::Json,
        })
    ));

    let CliCommand::Onboarding(arguments) = parse_arguments(
        [
            "onboarding".into(),
            "--complete".into(),
            "--default-adapter".into(),
            "codex".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("complete onboarding") else {
        panic!("expected onboarding");
    };
    assert!(arguments.complete);
    assert_eq!(arguments.default_adapter.as_deref(), Some("codex"));
    assert!(parse_arguments(["onboarding".into(), "--complete".into()], cwd).is_err());
    assert!(parse_arguments(
        [
            "onboarding".into(),
            "--complete".into(),
            "--default-adapter".into(),
            "unknown".into(),
        ],
        cwd,
    )
    .is_err());
}

#[test]
fn mcp_parser_requires_one_repository_and_at_most_one_authority_change() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Mcp(arguments) = parse_arguments(
        [
            "mcp".into(),
            "--repo".into(),
            "/tmp/widget".into(),
            "--enable".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("mcp arguments") else {
        panic!("expected mcp");
    };
    assert_eq!(arguments.repo_path, Path::new("/tmp/widget"));
    assert_eq!(arguments.operation, McpSettingsOperation::Enable);
    assert_eq!(arguments.output, OutputMode::Json);
    assert!(parse_arguments(["mcp".into()], cwd).is_err());
    assert!(parse_arguments(
        [
            "mcp".into(),
            "--repo".into(),
            "/tmp/widget".into(),
            "--enable".into(),
            "--disable".into(),
        ],
        cwd,
    )
    .is_err());
}

#[test]
fn retention_parser_separates_preview_apply_and_checkpoint_authority() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Retention(preview) = parse_arguments(
        [
            "retention".into(),
            "--max-age-days".into(),
            "90".into(),
            "--max-archive-mib".into(),
            "2048".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("retention preview") else {
        panic!("expected retention");
    };
    assert_eq!(preview.operation, SessionRetentionOperation::Plan);
    assert_eq!(preview.max_age_days, Some(90));
    assert_eq!(preview.max_archive_mib, Some(2048));
    assert_eq!(preview.output, OutputMode::Json);

    let CliCommand::Retention(apply) = parse_arguments(
        [
            "retention".into(),
            "--apply".into(),
            "retention-plan:abc".into(),
        ],
        cwd,
    )
    .expect("retention apply") else {
        panic!("expected retention");
    };
    assert_eq!(apply.operation, SessionRetentionOperation::Apply);
    assert_eq!(apply.plan_id.as_deref(), Some("retention-plan:abc"));

    assert!(parse_arguments(["retention".into()], cwd).is_err());
    assert!(parse_arguments(
        [
            "retention".into(),
            "--checkpoint".into(),
            "--apply".into(),
            "retention-plan:abc".into(),
        ],
        cwd,
    )
    .is_err());
    assert!(parse_arguments(["retention".into(), "--vacuum".into()], cwd).is_err());
}

#[test]
fn rubrics_parser_separates_read_select_and_validated_custom_pack_input() {
    let cwd = Path::new("/tmp/widget");
    assert!(matches!(
        parse_arguments(["rubrics".into(), "--json".into()], cwd).expect("read rubrics"),
        CliCommand::Rubrics(RubricsArguments {
            select: None,
            upsert: None,
            output: OutputMode::Json,
        })
    ));

    let CliCommand::Rubrics(arguments) = parse_arguments(
        [
            "rubrics".into(),
            "--id".into(),
            "performance-proof".into(),
            "--name".into(),
            "Performance Proof".into(),
            "--focus".into(),
            "Measured regressions".into(),
            "--check".into(),
            "Require a baseline".into(),
            "--check".into(),
            "Reject unsupported claims".into(),
        ],
        cwd,
    )
    .expect("custom rubric") else {
        panic!("expected rubrics");
    };
    let pack = arguments.upsert.expect("upsert");
    assert_eq!(pack.id, "performance-proof");
    assert_eq!(pack.checks.len(), 2);

    assert!(parse_arguments(
        [
            "rubrics".into(),
            "--select".into(),
            "product-safety".into(),
            "--id".into(),
            "invalid".into(),
        ],
        cwd,
    )
    .is_err());
    assert!(
        parse_arguments(["rubrics".into(), "--id".into(), "incomplete".into(),], cwd,).is_err()
    );
}

#[test]
fn xray_parser_preserves_public_confirmation_excerpt_and_save_identity() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Xray(arguments) = parse_arguments(
        [
            "xray".into(),
            "--review-id".into(),
            "review-7".into(),
            "--public-source".into(),
            "owner/repo#7".into(),
            "--confirm-public".into(),
            "--approve-excerpt".into(),
            "finding-1".into(),
            "--format".into(),
            "markdown".into(),
            "--save".into(),
            "/tmp/xray.md".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("xray arguments") else {
        panic!("expected xray");
    };
    assert_eq!(arguments.request.review_id, "review-7");
    assert_eq!(
        arguments.request.public_source.as_deref(),
        Some("owner/repo#7")
    );
    assert!(arguments.request.public_source_confirmed);
    assert_eq!(
        arguments.request.approved_excerpt_finding_ids,
        vec!["finding-1"]
    );
    assert!(matches!(arguments.format, XrayFormat::Markdown));
    assert_eq!(arguments.save_path.as_deref(), Some("/tmp/xray.md"));
    assert_eq!(arguments.output, OutputMode::Json);

    assert!(parse_arguments(["xray".into()], cwd).is_err());
    assert!(parse_arguments(
        [
            "xray".into(),
            "--review-id".into(),
            "review-7".into(),
            "--format".into(),
            "pdf".into(),
        ],
        cwd,
    )
    .is_err());
}

#[test]
fn fix_packet_parser_preserves_bounded_finding_selection() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::FixPacket(arguments) = parse_arguments(
        [
            "fix-packet".into(),
            "--run-id".into(),
            "local-check-7".into(),
            "--finding".into(),
            "finding-2".into(),
            "--finding".into(),
            "finding-1".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("fix packet arguments") else {
        panic!("expected fix packet");
    };
    assert_eq!(arguments.run_id, "local-check-7");
    assert_eq!(arguments.finding_ids, vec!["finding-2", "finding-1"]);
    assert_eq!(arguments.output, OutputMode::Json);
    assert!(parse_arguments(["fix-packet".into()], cwd).is_err());
}

#[test]
fn fix_parser_separates_execute_inspect_and_confirmed_discard() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Fix(execute) = parse_arguments(
        [
            "fix".into(),
            "--operation".into(),
            "execute".into(),
            "--run-id".into(),
            "local-check-7".into(),
            "--finding".into(),
            "finding-2".into(),
            "--agent".into(),
            "claude".into(),
            "--confirm-run".into(),
            "--timeout-ms".into(),
            "45000".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("fix execute arguments") else {
        panic!("expected fix command");
    };
    assert_eq!(execute.operation, FixOperation::Execute);
    assert_eq!(execute.run_id.as_deref(), Some("local-check-7"));
    assert_eq!(execute.finding_ids, vec!["finding-2"]);
    assert_eq!(execute.agent, "claude");
    assert!(execute.confirm_run);
    assert_eq!(execute.timeout_ms, 45_000);
    assert_eq!(execute.output, OutputMode::Json);

    let CliCommand::Fix(inspect) = parse_arguments(
        [
            "fix".into(),
            "--operation".into(),
            "inspect".into(),
            "--attempt-id".into(),
            "fix-attempt-abc123".into(),
        ],
        cwd,
    )
    .expect("fix inspect arguments") else {
        panic!("expected fix command");
    };
    assert_eq!(inspect.operation, FixOperation::Inspect);
    assert_eq!(inspect.attempt_id.as_deref(), Some("fix-attempt-abc123"));

    let CliCommand::Fix(discard) = parse_arguments(
        [
            "fix".into(),
            "--operation".into(),
            "discard".into(),
            "--attempt-id".into(),
            "fix-attempt-abc123".into(),
            "--confirm-discard".into(),
        ],
        cwd,
    )
    .expect("fix discard arguments") else {
        panic!("expected fix command");
    };
    assert_eq!(discard.operation, FixOperation::Discard);
    assert!(discard.confirm_discard);

    assert!(parse_arguments(
        [
            "fix".into(),
            "--operation".into(),
            "execute".into(),
            "--run-id".into(),
            "local-check-7".into(),
            "--finding".into(),
            "finding-2".into(),
        ],
        cwd,
    )
    .is_err());
    assert!(parse_arguments(
        [
            "fix".into(),
            "--operation".into(),
            "discard".into(),
            "--attempt-id".into(),
            "fix-attempt-abc123".into(),
        ],
        cwd,
    )
    .is_err());
}

#[test]
fn scope_parser_preserves_one_closed_consumer_and_scope_contract() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Scope(arguments) = parse_arguments(
        [
            "scope".into(),
            "--consumer".into(),
            "performance".into(),
            "--change".into(),
            "main...HEAD".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("scope arguments") else {
        panic!("expected scope");
    };
    assert_eq!(arguments.input.repo_path, "/tmp/widget");
    assert_eq!(arguments.input.consumer, EvidenceScopeConsumer::Performance);
    assert_eq!(arguments.input.kind, EvidenceScopeKind::Change);
    assert_eq!(arguments.input.value.as_deref(), Some("main...HEAD"));
    assert_eq!(arguments.output, OutputMode::Json);

    assert!(parse_arguments(
        [
            "scope".into(),
            "--consumer".into(),
            "testing".into(),
            "--flow".into(),
            "checkout".into(),
            "--codebase".into(),
        ],
        cwd,
    )
    .is_err());
    assert!(parse_arguments(["scope".into(), "--codebase".into()], cwd,).is_err());
}

#[test]
fn scope_cli_projects_the_shared_surface_parity_fixture_without_schema_drift() {
    let fixture = surface_parity_fixture();
    let request = &fixture["request"];
    let cwd = Path::new("/fixture/repo");
    let CliCommand::Scope(arguments) = parse_arguments(
        [
            "scope".into(),
            "--consumer".into(),
            request["consumer"]
                .as_str()
                .expect("fixture consumer")
                .into(),
            "--repo".into(),
            cwd.to_string_lossy().into_owned(),
            "--flow".into(),
            request["value"].as_str().expect("fixture value").into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("fixture CLI arguments") else {
        panic!("expected fixture scope command");
    };
    assert_eq!(arguments.input.repo_path, "/fixture/repo");
    assert_eq!(arguments.input.consumer, EvidenceScopeConsumer::Performance);
    assert_eq!(arguments.input.kind, EvidenceScopeKind::Flow);
    assert_eq!(arguments.input.value.as_deref(), Some("coupon total"));
    assert_eq!(arguments.output, OutputMode::Json);
    assert_eq!(fixture["authority"]["cli"], "supervised_projection");

    let receipt: EvidenceScopePlan = serde_json::from_value(fixture["canonical_receipt"].clone())
        .expect("fixture canonical receipt");
    let encoded = serde_json::to_string(&receipt).expect("serialize fixture receipt");
    let decoded: EvidenceScopePlan =
        serde_json::from_str(&encoded).expect("decode CLI fixture receipt");
    assert_eq!(
        decoded.schema_version,
        fixture["expected"]["schema_version"]
    );
    assert_eq!(decoded.status, fixture["expected"]["status"]);
    assert_eq!(
        decoded.candidates[0].target,
        fixture["expected"]["first_candidate"]["target"]
    );
    let human = render_human_scope(&decoded);
    assert!(human.contains("Evidence scope · performance\nstatus: ready"));
    assert!(human.contains("src/cart/coupon.test.ts"));
}

#[test]
fn check_cli_preserves_the_shared_local_check_receipt_and_exit_semantics() {
    let fixture = local_check_parity_fixture();
    let request = &fixture["request"];
    let CliCommand::Check(arguments) = parse_arguments(
        [
            "check".into(),
            "--request-id".into(),
            request["request_id"].as_str().expect("request id").into(),
            "--repo".into(),
            request["repo_path"].as_str().expect("repository").into(),
            "--range".into(),
            request["change"].as_str().expect("change").into(),
            "--task".into(),
            request["task"].as_str().expect("task").into(),
            "--json".into(),
        ],
        Path::new("/ignored"),
    )
    .expect("local-check parity CLI arguments") else {
        panic!("expected local-check fixture command");
    };
    assert_eq!(fixture["authority"]["cli"], "supervised_execution");
    assert_eq!(arguments.repo_path, Path::new("/fixture/repo"));
    assert_eq!(arguments.change, "main...HEAD");
    assert_eq!(arguments.task, "Preserve checkout totals");
    assert_eq!(
        arguments.request_id.as_deref(),
        request["request_id"].as_str()
    );

    let receipt: LocalCheckReceipt = serde_json::from_value(fixture["canonical_receipt"].clone())
        .expect("fixture canonical local-check receipt");
    assert_eq!(
        receipt.schema_version,
        fixture["expected"]["receipt_schema"]
    );
    assert_eq!(
        receipt.request_id.as_deref(),
        request["request_id"].as_str()
    );
    assert_eq!(receipt.verdict, LocalCheckVerdict::NoConfidence);
    assert_eq!(
        local_check_exit_code(receipt.verdict),
        fixture["expected"]["exit_code"]
            .as_i64()
            .expect("fixture exit code") as i32
    );
    let human = render_human_check(&receipt);
    assert!(human.contains("verdict: no_confidence"));
    assert!(human.contains(
        fixture["expected"]["limitation"]
            .as_str()
            .expect("fixture limitation")
    ));
}

#[test]
fn performance_parser_and_human_output_preserve_the_closed_contract() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Performance(arguments) = parse_arguments(
        [
            "performance".into(),
            "--operation".into(),
            "verify-paired".into(),
            "--repo".into(),
            "/tmp/candidate".into(),
            "--baseline-repo".into(),
            "/tmp/baseline".into(),
            "--adapter".into(),
            "go-bench".into(),
            "--target".into(),
            "bench/parser_test.go".into(),
            "--name".into(),
            "BenchmarkParser".into(),
            "--samples".into(),
            "5".into(),
            "--warmups".into(),
            "2".into(),
            "--timeout-ms".into(),
            "45000".into(),
            "--request-id".into(),
            "performance-fixture".into(),
            "--json".into(),
        ],
        cwd,
    )
    .expect("performance arguments") else {
        panic!("expected performance");
    };
    assert_eq!(
        arguments.input.operation,
        PerformanceOperation::VerifyPaired
    );
    assert_eq!(arguments.input.adapter, Some(PerformanceAdapter::GoBench));
    assert_eq!(
        arguments.input.target.as_deref(),
        Some("bench/parser_test.go")
    );
    assert_eq!(arguments.input.samples, Some(5));
    assert_eq!(arguments.input.warmups, Some(2));
    assert_eq!(arguments.input.timeout_ms, Some(45_000));
    assert_eq!(arguments.input.request_id, "performance-fixture");
    assert_eq!(arguments.output, OutputMode::Json);

    assert!(parse_arguments(
        ["performance".into(), "--operation".into(), "guess".into(),],
        cwd,
    )
    .is_err());
    assert!(parse_arguments(
        [
            "performance".into(),
            "--operation".into(),
            "plan".into(),
            "--adapter".into(),
            "shell".into(),
        ],
        cwd,
    )
    .is_err());

    let receipt = PerformanceRunReceipt {
        schema_version: 1,
        request_id: "performance-fixture".into(),
        operation: PerformanceOperation::Plan,
        state: "succeeded".into(),
        exit_code: Some(0),
        duration_ms: 17,
        result: serde_json::json!({
            "decision": { "status": "admitted" },
            "limitations": ["Exact fixture scope only."]
        }),
        stderr_summary: None,
        cleanup: codevetter_core::commands::performance_bridge::PerformanceCleanupReceipt {
            owned_process_reaped: true,
            temporary_profiles_retained: false,
        },
        resources: Default::default(),
    };
    let output = render_human_performance(&receipt);
    assert!(output.contains("operation: plan"));
    assert!(output.contains("verdict: admitted"));
    assert!(output.contains("Exact fixture scope only."));
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
            "--request-id".into(),
            "native-review-fixture".into(),
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
    assert_eq!(
        arguments.request_id.as_deref(),
        Some("native-review-fixture")
    );
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
    assert!(!arguments.progress_json);
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
fn check_parser_preserves_the_independent_cross_review_strategy() {
    let CliCommand::Check(arguments) = parse_arguments(
        [
            "check".into(),
            "--range".into(),
            "main...HEAD".into(),
            "--task".into(),
            "Reject incomplete composite reviews".into(),
            "--agent".into(),
            "cross".into(),
            "--json".into(),
        ],
        Path::new("/tmp/widget"),
    )
    .expect("arguments") else {
        panic!("expected check");
    };
    assert_eq!(arguments.review_agent, "cross");
    assert_eq!(arguments.output, OutputMode::Json);
}

#[test]
fn check_parser_bounds_machine_readable_progress_to_executable_json_checks() {
    let cwd = Path::new("/tmp/widget");
    let CliCommand::Check(arguments) = parse_arguments(
        [
            "check".into(),
            "--range".into(),
            "main...HEAD".into(),
            "--task".into(),
            "Prove the change".into(),
            "--json".into(),
            "--progress-json".into(),
        ],
        cwd,
    )
    .expect("progress arguments") else {
        panic!("expected check");
    };
    assert!(arguments.progress_json);
    assert_eq!(arguments.output, OutputMode::Json);

    for invalid in [
        vec![
            "check".into(),
            "--range".into(),
            "main...HEAD".into(),
            "--task".into(),
            "Prove the change".into(),
            "--progress-json".into(),
        ],
        vec![
            "check".into(),
            "--range".into(),
            "main...HEAD".into(),
            "--task".into(),
            "Prove the change".into(),
            "--preflight".into(),
            "--json".into(),
            "--progress-json".into(),
        ],
    ] {
        assert!(parse_arguments(invalid, cwd).is_err());
    }
}

#[test]
fn machine_readable_progress_preserves_the_versioned_stderr_contract() {
    let event = VerificationProgress {
        schema_version: "codevetter.progress/v2".into(),
        request_id: "native-review-fixture".into(),
        sequence: 4,
        stage: "correctness".into(),
        state: "running".into(),
    };
    let progress: serde_json::Value =
        serde_json::from_str(&render_progress_json(&event)).expect("progress JSON");
    assert_eq!(progress["schema_version"], "codevetter.progress/v2");
    assert_eq!(progress["request_id"], "native-review-fixture");
    assert_eq!(progress["sequence"], 4);
    assert_eq!(progress["stage"], "correctness");
    assert_eq!(progress["state"], "running");
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
            "--rust-manifest".into(),
            "crates/widget/Cargo.toml".into(),
            "--rust-test".into(),
            "integration".into(),
            "--advisory-db".into(),
            "/tmp/rustsec-db".into(),
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
    assert_eq!(
        arguments.rust_manifest,
        Some(PathBuf::from("crates/widget/Cargo.toml"))
    );
    assert_eq!(arguments.rust_test.as_deref(), Some("integration"));
    assert_eq!(
        arguments.advisory_db,
        Some(PathBuf::from("/tmp/rustsec-db"))
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
    assert_eq!(app_version(), env!("CARGO_PKG_VERSION"));
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
        request_id: None,
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
