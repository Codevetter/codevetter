use super::*;
use crate::commands::unpack_analysis::{
    analyze_health_file, parse_git_commit_line, parse_temporal_coupling_log,
};
use crate::commands::unpack_outcome::{
    calibrate_outcome_evidence, outcome_trend, outcome_trust_actions,
};
use crate::commands::unpack_snapshot::{is_safe_commit_id, parse_snapshot_commit_log};

fn package_manifest(path: &str, scripts: &[&str], deps: &[&str]) -> ManifestSummary {
    ManifestSummary {
        path: path.to_string(),
        kind: "package.json".to_string(),
        name: Some("demo".to_string()),
        version: None,
        dependencies: deps.iter().map(|dep| (*dep).to_string()).collect(),
        scripts: scripts.iter().map(|script| (*script).to_string()).collect(),
    }
}

fn minimal_inventory() -> RepoInventory {
    RepoInventory {
        repo_path: "/tmp/demo".to_string(),
        repo_name: "demo".to_string(),
        commit_sha: Some("1234567890abcdef".to_string()),
        branch: Some("main".to_string()),
        remote_url: None,
        files_scanned: 2,
        files_skipped: 0,
        bytes_scanned: 200,
        max_files_hit: false,
        estimated_total_files: None,
        languages: Vec::new(),
        manifests: Vec::new(),
        entrypoints: Vec::new(),
        top_level_dirs: Vec::new(),
        docs: Vec::new(),
        config_files: Vec::new(),
        stack_tags: vec!["React".to_string(), "Rust".to_string()],
        workspace_units: Vec::new(),
        qa_readiness: QaReadiness::default(),
        repo_graph: RepoGraph {
            schema_version: 1,
            nodes: vec![RepoGraphNode {
                id: "file:src-review-ts".to_string(),
                kind: "file".to_string(),
                label: "src/review.ts".to_string(),
                path: Some("src/review.ts".to_string()),
                detail: Some("review surface".to_string()),
                sources: vec!["src/review.ts".to_string()],
            }],
            edges: vec![RepoGraphEdge {
                from: "file:src-review-ts".to_string(),
                to: "decision:src-review-ts-l1".to_string(),
                kind: "decided_by".to_string(),
                evidence: "DECISION marker".to_string(),
                sources: vec!["src/review.ts#L1".to_string()],
            }],
            truncated: false,
        },
        history_brief: RepoHistoryBrief {
            schema_version: 1,
            summary: "History summary".to_string(),
            recent_commits: vec![RepoHistoryCommit {
                sha: "1234567890ab".to_string(),
                date: Some("2026-06-12".to_string()),
                subject: "Add history brief".to_string(),
            }],
            decisions: vec![RepoHistoryDecision {
                marker: "decision".to_string(),
                text: "review keeps proof local".to_string(),
                source: "src/review.ts#L1".to_string(),
            }],
            test_hints: vec![RepoHistoryTestHint {
                path: "package.json".to_string(),
                reason: "package script `test` is a likely verification command".to_string(),
            }],
            temporal_couplings: Vec::new(),
            sources: vec!["src/review.ts#L1".to_string()],
            truncated: false,
        },
        repo_health: RepoHealth::default(),
        all_files: vec!["src/review.ts".to_string(), "package.json".to_string()],
        ignored_dirs: Vec::new(),
        coverage: InventoryCoverageSummary::default(),
        all_files_capped: false,
        dir_tree_preview: build_dir_tree_preview(
            &["src/review.ts".to_string(), "package.json".to_string()],
            2,
        ),
    }
}

#[test]
fn trim_inventory_for_client_strips_all_files_for_ipc() {
    let mut inv = minimal_inventory();
    inv.all_files = (0..600).map(|i| format!("src/file{i}.ts")).collect();
    inv.files_scanned = inv.all_files.len();
    let trimmed = trim_inventory_for_client(inv);
    assert!(trimmed.all_files.is_empty());
    assert!(trimmed.all_files_capped);
    assert_eq!(trimmed.files_scanned, 600);
    assert!(!trimmed.dir_tree_preview.children.is_empty());
}

#[test]
fn qa_readiness_scores_playwright_repo_with_flows() {
    let files = vec![
        ("package.json".to_string(), 200),
        ("playwright.config.ts".to_string(), 300),
        ("src/pages/Home.tsx".to_string(), 200),
        ("src/pages/Checkout.tsx".to_string(), 200),
        ("tests/e2e/checkout.spec.ts".to_string(), 500),
        ("docs/qa.md".to_string(), 100),
    ];
    let manifests = vec![package_manifest(
        "package.json",
        &["dev", "test:synthetic-qa", "test:e2e"],
        &["@playwright/test", "react"],
    )];
    let entrypoints = infer_entrypoints(&files, &manifests, &["React".to_string()]);

    let readiness = build_qa_readiness(&files, &manifests, &entrypoints);

    assert_eq!(readiness.status, "ready");
    assert!(readiness.score >= 90);
    assert!(readiness
        .signals
        .iter()
        .any(|signal| signal.id == "browser_runner" && signal.status == "ready"));
    assert!(readiness
        .suggested_flows
        .iter()
        .any(|flow| flow.route == "/checkout"));
}

#[test]
fn qa_readiness_marks_missing_repo_without_browser_runner() {
    let files = vec![("src/main.rs".to_string(), 200)];
    let manifests = vec![ManifestSummary {
        path: "Cargo.toml".to_string(),
        kind: "cargo.toml".to_string(),
        name: Some("demo".to_string()),
        version: None,
        dependencies: Vec::new(),
        scripts: Vec::new(),
    }];
    let entrypoints = infer_entrypoints(&files, &manifests, &["Rust".to_string()]);

    let readiness = build_qa_readiness(&files, &manifests, &entrypoints);

    assert_eq!(readiness.status, "missing");
    assert!(readiness.score < 45);
    assert!(readiness.suggested_flows.is_empty());
}

#[test]
fn repo_health_flags_churny_untested_io_loop() {
    let content = r#"
export async function loadEverything(ids: string[]) {
  for (const id of ids) {
const raw = await fetch(`/api/items/${id}`);
console.log(await raw.text());
  }
}
"#;
    let file = analyze_health_file("src/loadEverything.ts", 900, content, 90, false);

    assert_eq!(file.bucket, "watch");
    assert!(file
        .findings
        .iter()
        .any(|finding| finding.id == "churn_hotspot"));
    assert!(file
        .findings
        .iter()
        .any(|finding| finding.id == "untested_hotspot"));
    assert!(file
        .findings
        .iter()
        .any(|finding| finding.id == "io_in_loop"));
    assert!(file
        .refactoring_targets
        .iter()
        .any(|target| target.contains("Hoist repeated I/O")));
}

#[test]
fn snapshot_commit_log_parses_commit_and_numstat_evidence() {
    let raw = "\u{1e}abc1234\u{1f}2026-07-03\u{1f}Sarthak\u{1f}Improve unpack diffs\n12\t3\tsrc/unpack.ts\n-\t-\timage.png\n";
    let commits = parse_snapshot_commit_log(raw);

    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0].sha, "abc1234");
    assert_eq!(commits[0].date, "2026-07-03");
    assert_eq!(commits[0].author, "Sarthak");
    assert_eq!(commits[0].subject, "Improve unpack diffs");
    assert_eq!(commits[0].additions, 12);
    assert_eq!(commits[0].deletions, 3);
    assert_eq!(commits[0].files.len(), 2);
    assert_eq!(commits[0].files[0].path, "src/unpack.ts");
    assert_eq!(commits[0].files[1].path, "image.png");
    assert!(is_safe_commit_id("abc1234"));
    assert!(!is_safe_commit_id("HEAD~1"));
}

#[test]
fn outcome_calibration_distinguishes_pass_fail_and_empty_evidence() {
    let empty = calibrate_outcome_evidence(0, 0, 0, 0, 0);
    assert_eq!(empty.0, "unknown");

    let proof = calibrate_outcome_evidence(2, 0, 1, 1, 1);
    assert_eq!(proof.0, "raises");
    assert!(proof.1.contains("2 recent proof signals"));

    let regression = calibrate_outcome_evidence(0, 1, 1, 1, 0);
    assert_eq!(regression.0, "lowers");

    let mixed = calibrate_outcome_evidence(1, 1, 1, 1, 1);
    assert_eq!(mixed.0, "mixed");
}

#[test]
fn outcome_trust_actions_prioritize_failed_rows_and_missing_baselines() {
    let baseline_trend = outcome_trend(&[], &[], &[], &[]);
    let baseline = outcome_trust_actions(&[], &[], &[], &[], "unknown", &baseline_trend);
    assert_eq!(baseline.len(), 1);
    assert_eq!(baseline[0].label, "Establish a proof baseline");
    assert_eq!(baseline[0].priority, "high");

    let failing_qa = UnpackOutcomeQaEvidence {
        id: "qa-1".to_string(),
        review_id: Some("review-1".to_string()),
        loop_id: "loop-1".to_string(),
        runner_type: "playwright".to_string(),
        route: Some("/unpack".to_string()),
        goal: Some("Open metric zoom".to_string()),
        pass: false,
        duration_ms: 1200,
        console_errors: 2,
        error: Some("button not found".to_string()),
        created_at: "2026-07-03T00:00:00Z".to_string(),
    };
    let failed_gate = UnpackOutcomeProcedureEvidence {
        id: "gate-1".to_string(),
        review_id: "review-1".to_string(),
        step_id: "build".to_string(),
        status: "failed".to_string(),
        source: "local".to_string(),
        summary: "Typecheck failed".to_string(),
        artifact: Some("artifacts/typecheck.log".to_string()),
        created_at: "2026-07-03T00:05:00Z".to_string(),
    };
    let finding = UnpackOutcomeFindingEvidence {
        file_path: Some("apps/desktop/src/pages/RepoUnpacked.tsx".to_string()),
        title: Some("Large evidence surface".to_string()),
        severity: Some("medium".to_string()),
        created_at: "2026-07-03T00:10:00Z".to_string(),
    };

    let trend = outcome_trend(
        &[],
        &[failing_qa.clone()],
        &[failed_gate.clone()],
        &[finding.clone()],
    );
    let actions = outcome_trust_actions(
        &[],
        &[failing_qa],
        &[failed_gate],
        &[finding],
        "mixed",
        &trend,
    );
    assert!(actions
        .iter()
        .any(|action| action.label == "Rerun failing QA flow"
            && action.command.as_deref() == Some("Rerun Synthetic QA: Open metric zoom")));
    assert!(actions
        .iter()
        .any(|action| action.label == "Resolve failed proof gate"
            && action.source_path.as_deref() == Some("artifacts/typecheck.log")));
    assert!(actions
        .iter()
        .any(|action| action.label == "Inspect recurring finding"
            && action.source_path.as_deref() == Some("apps/desktop/src/pages/RepoUnpacked.tsx")));
    assert!(actions
        .iter()
        .any(|action| action.label == "Require fresh proof for this delta"));
}

#[test]
fn outcome_trend_detects_regression_and_improvement() {
    let recent_fail = UnpackOutcomeQaEvidence {
        id: "qa-fail".to_string(),
        review_id: None,
        loop_id: "loop-fail".to_string(),
        runner_type: "playwright".to_string(),
        route: Some("/unpack".to_string()),
        goal: Some("Recent failing flow".to_string()),
        pass: false,
        duration_ms: 1100,
        console_errors: 1,
        error: Some("regression".to_string()),
        created_at: "2026-07-03T00:00:00Z".to_string(),
    };
    let prior_pass_a = UnpackOutcomeQaEvidence {
        id: "qa-pass-a".to_string(),
        review_id: None,
        loop_id: "loop-pass-a".to_string(),
        runner_type: "playwright".to_string(),
        route: Some("/unpack".to_string()),
        goal: Some("Prior green flow".to_string()),
        pass: true,
        duration_ms: 900,
        console_errors: 0,
        error: None,
        created_at: "2026-06-30T00:00:00Z".to_string(),
    };
    let prior_pass_b = UnpackOutcomeQaEvidence {
        id: "qa-pass-b".to_string(),
        review_id: None,
        loop_id: "loop-pass-b".to_string(),
        runner_type: "playwright".to_string(),
        route: Some("/unpack?section=attribution".to_string()),
        goal: Some("Prior Intel green flow".to_string()),
        pass: true,
        duration_ms: 950,
        console_errors: 0,
        error: None,
        created_at: "2026-06-29T00:00:00Z".to_string(),
    };

    let regressing = outcome_trend(
        &[],
        &[
            recent_fail.clone(),
            prior_pass_a.clone(),
            prior_pass_b.clone(),
        ],
        &[],
        &[],
    );
    assert_eq!(regressing.direction, "regressing");
    assert_eq!(regressing.recent.failure_count, 1);
    assert!(regressing.summary.contains("regressing trend"));

    let recent_pass = UnpackOutcomeQaEvidence {
        id: "qa-pass-now".to_string(),
        pass: true,
        created_at: "2026-07-04T00:00:00Z".to_string(),
        ..recent_fail
    };
    let prior_fail = UnpackOutcomeQaEvidence {
        id: "qa-fail-before".to_string(),
        pass: false,
        created_at: "2026-06-28T00:00:00Z".to_string(),
        ..prior_pass_a
    };
    let improving = outcome_trend(&[], &[recent_pass, prior_pass_b, prior_fail], &[], &[]);
    assert_eq!(improving.direction, "improving");
}

#[test]
fn repo_graph_contains_core_repo_relationships_deterministically() {
    let root = std::env::temp_dir().join(format!("codevetter-graph-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("src-tauri/src/commands")).expect("commands dir");
    std::fs::create_dir_all(root.join("src-tauri/src/db")).expect("db dir");
    std::fs::create_dir_all(root.join("src/pages")).expect("pages dir");
    std::fs::create_dir_all(root.join("tests/e2e")).expect("tests dir");
    std::fs::write(
        root.join("src-tauri/src/commands/review.rs"),
        r#"
#[tauri::command]
pub async fn run_review() -> Result<(), String> {
Ok(())
}
"#,
    )
    .expect("command file");
    std::fs::write(
        root.join("src-tauri/src/db/schema.rs"),
        r##"
const MIGRATION_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS local_reviews (
id TEXT PRIMARY KEY
);
"#;
"##,
    )
    .expect("schema file");
    std::fs::write(
        root.join("src/pages/Review.tsx"),
        "// DECISION: review page owns the primary user flow\nexport default function Review() { return null; }\n",
    )
    .expect("page file");
    std::fs::write(
        root.join("tests/e2e/review.spec.ts"),
        "test('review', () => {});\n",
    )
    .expect("test file");

    let files = vec![
        ("package.json".to_string(), 200),
        ("src-tauri/src/commands/review.rs".to_string(), 200),
        ("src-tauri/src/db/schema.rs".to_string(), 200),
        ("src/pages/Review.tsx".to_string(), 200),
        ("tests/e2e/review.spec.ts".to_string(), 200),
    ];
    let manifests = vec![package_manifest(
        "package.json",
        &["dev", "test:e2e"],
        &["@playwright/test", "react"],
    )];
    let entrypoints = infer_entrypoints(&files, &manifests, &["React".to_string()]);
    let workspace_units = build_workspace_units(&files, None, &manifests, &entrypoints);

    let graph = build_repo_graph_with_previews(
        &root,
        &files,
        &manifests,
        &entrypoints,
        &workspace_units,
        None,
    );
    let graph_again = build_repo_graph_with_previews(
        &root,
        &files,
        &manifests,
        &entrypoints,
        &workspace_units,
        None,
    );

    assert_eq!(
        serde_json::to_string(&graph).expect("graph json"),
        serde_json::to_string(&graph_again).expect("graph json")
    );
    assert!(graph
        .nodes
        .iter()
        .any(|node| node.kind == "workspace_unit" && node.label == "demo"));
    assert!(graph
        .nodes
        .iter()
        .any(|node| node.kind == "script" && node.label == "test:e2e"));
    assert!(graph
        .nodes
        .iter()
        .any(|node| node.kind == "route" && node.label == "/review"));
    assert!(graph
        .nodes
        .iter()
        .any(|node| node.kind == "tauri_command" && node.label == "run_review"));
    assert!(graph
        .nodes
        .iter()
        .any(|node| node.kind == "db_table" && node.label == "local_reviews"));
    assert!(graph.nodes.iter().any(|node| node.kind == "test"));
    assert!(graph.nodes.iter().any(|node| node.kind == "decision"));
    assert!(graph.edges.iter().any(|edge| edge.kind == "defines"));
    assert!(graph.edges.iter().any(|edge| edge.kind == "routes_to"));
    assert!(graph.edges.iter().any(|edge| edge.kind == "persists_to"));
    assert!(graph.edges.iter().any(|edge| edge.kind == "decided_by"));
    assert!(!graph.truncated);

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn history_brief_collects_decisions_and_verification_hints_deterministically() {
    let root =
        std::env::temp_dir().join(format!("codevetter-history-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("src")).expect("src dir");
    std::fs::create_dir_all(root.join("tests")).expect("tests dir");
    std::fs::write(
        root.join("src/review.ts"),
        "// DECISION: review keeps proof local\nexport const proof = true;\n",
    )
    .expect("source file");
    std::fs::write(
        root.join("tests/review.test.ts"),
        "test('proof', () => {});\n",
    )
    .expect("test file");

    let files = vec![
        ("package.json".to_string(), 200),
        ("src/review.ts".to_string(), 200),
        ("tests/review.test.ts".to_string(), 200),
    ];
    let manifests = vec![package_manifest(
        "package.json",
        &["lint", "test:review-proof"],
        &["react"],
    )];

    let brief = build_history_brief(&root, &files, &manifests);
    let brief_again = build_history_brief(&root, &files, &manifests);

    assert_eq!(
        serde_json::to_string(&brief).expect("history brief json"),
        serde_json::to_string(&brief_again).expect("history brief json")
    );
    assert_eq!(brief.schema_version, 1);
    assert!(brief.summary.contains("decision marker"));
    assert!(brief
        .decisions
        .iter()
        .any(|decision| decision.source == "src/review.ts#L1"));
    assert!(brief
        .test_hints
        .iter()
        .any(|hint| hint.path == "package.json" && hint.reason.contains("lint")));
    assert!(brief
        .test_hints
        .iter()
        .any(|hint| hint.path == "tests/review.test.ts"));

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn parses_recent_git_commit_line() {
    let commit =
        parse_git_commit_line("1234567890abcdef\x1f2026-06-12\x1fAdd Repo Unpacked history brief")
            .expect("commit line");

    assert_eq!(commit.sha, "1234567890ab");
    assert_eq!(commit.date.as_deref(), Some("2026-06-12"));
    assert_eq!(commit.subject, "Add Repo Unpacked history brief");
    assert!(parse_git_commit_line("bad").is_none());
}

#[test]
fn temporal_coupling_log_finds_repeated_cochange_pairs() {
    let raw = "\u{1e}aaaaaaaaaaaa\nsrc/a.ts\nsrc/b.ts\npnpm-lock.yaml\n\n\u{1e}bbbbbbbbbbbb\nsrc/b.ts\nsrc/a.ts\nsrc/c.ts\n\n\u{1e}cccccccccccc\nsrc/a.ts\nsrc/b.ts\n";

    let couplings = parse_temporal_coupling_log(raw, 4);

    assert_eq!(couplings[0].files, vec!["src/a.ts", "src/b.ts"]);
    assert_eq!(couplings[0].commit_count, 3);
    assert_eq!(couplings[0].last_commit.as_deref(), Some("aaaaaaaaaaaa"));
    assert!(couplings[0].reason.contains("changed together"));
    assert!(couplings
        .iter()
        .all(|coupling| !coupling.files.iter().any(|file| file.ends_with(".lock"))));
}

#[test]
fn full_inventory_profile_includes_local_non_ai_analysis() {
    let root = std::env::temp_dir().join(format!(
        "codevetter-full-inventory-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(root.join("src")).expect("src dir");
    std::fs::create_dir_all(root.join("tests")).expect("tests dir");
    std::fs::write(
        root.join("package.json"),
        r#"{"scripts":{"test":"vitest"},"dependencies":{"react":"latest"}}"#,
    )
    .expect("package");
    std::fs::write(
        root.join("src/App.tsx"),
        "// DECISION: App owns the local route surface\nexport default function App() { return null; }\n",
    )
    .expect("app");
    std::fs::write(root.join("tests/app.test.ts"), "test('app', () => {});\n").expect("test");

    let result = build_inventory_with_progress(
        root.to_str().expect("temp path"),
        None,
        InventoryBuildProfile::Full,
    )
    .expect("full inventory");
    let inventory = result.inventory;

    assert!(!inventory.repo_graph.nodes.is_empty());
    assert!(!inventory.history_brief.decisions.is_empty());
    assert!(inventory.repo_health.files_analyzed > 0);
    assert!(!inventory_needs_enrichment(&inventory));

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn inventory_coverage_summarizes_whole_repo_metadata_for_samples() {
    let sampled = vec![
        ("apps/web/src/App.tsx".to_string(), 120),
        ("packages/api/src/main.rs".to_string(), 200),
    ];
    let tracked = vec![
        "apps/web/src/App.tsx".to_string(),
        "apps/web/src/routes/Home.tsx".to_string(),
        "packages/api/src/main.rs".to_string(),
        "packages/api/src/lib.rs".to_string(),
        "docs/README.md".to_string(),
    ];

    let coverage = build_inventory_coverage(&sampled, Some(&tracked), Some(tracked.len()), true);

    assert_eq!(coverage.strategy, "stratified_git_sample");
    assert_eq!(coverage.sampled_files, 2);
    assert_eq!(coverage.total_files, Some(5));
    assert_eq!(coverage.sample_percent, Some(40.0));
    assert!(coverage
        .languages
        .iter()
        .any(|lang| lang.language == "TypeScript" && lang.files == 2));
    assert!(coverage
        .top_level_dirs
        .iter()
        .any(|dir| dir.path == "apps" && dir.file_count == 2));
    assert!(coverage.notes[0].contains("Whole-repo metadata"));
}

#[test]
fn workspace_units_summarize_monorepo_package_boundaries_from_tracked_files() {
    let sampled = vec![
        ("apps/web/src/App.tsx".to_string(), 120),
        ("packages/api/src/main.rs".to_string(), 200),
    ];
    let tracked = vec![
        "apps/web/package.json".to_string(),
        "apps/web/src/App.tsx".to_string(),
        "apps/web/src/main.tsx".to_string(),
        "apps/web/tests/app.test.ts".to_string(),
        "packages/api/Cargo.toml".to_string(),
        "packages/api/src/main.rs".to_string(),
        "packages/api/src/lib.rs".to_string(),
        "packages/api/tests/api_test.rs".to_string(),
        "docs/README.md".to_string(),
    ];
    let manifests = vec![
        ManifestSummary {
            path: "apps/web/package.json".to_string(),
            kind: "package.json".to_string(),
            name: Some("@demo/web".to_string()),
            version: None,
            dependencies: vec!["react".to_string(), "vite".to_string()],
            scripts: vec!["build".to_string(), "test".to_string()],
        },
        ManifestSummary {
            path: "packages/api/Cargo.toml".to_string(),
            kind: "cargo.toml".to_string(),
            name: Some("demo-api".to_string()),
            version: None,
            dependencies: Vec::new(),
            scripts: Vec::new(),
        },
    ];
    let entrypoints = vec![
        EntrypointHint {
            path: "apps/web/src/main.tsx".to_string(),
            kind: "web".to_string(),
            reason: "Vite React entrypoint".to_string(),
        },
        EntrypointHint {
            path: "packages/api/src/main.rs".to_string(),
            kind: "bin".to_string(),
            reason: "Rust binary entrypoint".to_string(),
        },
    ];

    let units = build_workspace_units(&sampled, Some(&tracked), &manifests, &entrypoints);

    let web = units
        .iter()
        .find(|unit| unit.path == "apps/web")
        .expect("web unit");
    assert_eq!(web.name, "@demo/web");
    assert_eq!(web.kind, "web_app");
    assert_eq!(web.file_count, 4);
    assert!(web.scripts.contains(&"test".to_string()));
    assert!(web
        .entrypoints
        .contains(&"apps/web/src/main.tsx".to_string()));
    assert!(web
        .test_files
        .contains(&"apps/web/tests/app.test.ts".to_string()));

    let api = units
        .iter()
        .find(|unit| unit.path == "packages/api")
        .expect("api unit");
    assert_eq!(api.name, "demo-api");
    assert_eq!(api.kind, "service");
    assert!(api
        .languages
        .iter()
        .any(|language| language.language == "Rust" && language.files >= 2));
}

#[test]
fn workspace_units_fallback_to_subsystems_for_manifest_light_repos() {
    let mut tracked = Vec::new();
    for i in 0..800 {
        tracked.push(format!("arch/x86/kernel/file{i}.c"));
        tracked.push(format!("drivers/net/driver{i}.c"));
        tracked.push(format!("fs/ext4/fs{i}.c"));
    }
    tracked.push("rust/Cargo.toml".to_string());
    tracked.push("README".to_string());
    let sampled = vec![
        ("arch/x86/kernel/file0.c".to_string(), 120),
        ("drivers/net/driver0.c".to_string(), 200),
        ("fs/ext4/fs0.c".to_string(), 180),
    ];
    let manifests = vec![ManifestSummary {
        path: "rust/Cargo.toml".to_string(),
        kind: "cargo.toml".to_string(),
        name: Some("kernel-rust".to_string()),
        version: None,
        dependencies: Vec::new(),
        scripts: Vec::new(),
    }];

    let units = build_workspace_units(&sampled, Some(&tracked), &manifests, &[]);

    assert!(units
        .iter()
        .any(|unit| unit.path == "arch" && unit.kind == "subsystem" && unit.file_count == 800));
    assert!(units
        .iter()
        .any(|unit| unit.path == "drivers" && unit.kind == "subsystem" && unit.file_count == 800));
    assert!(units.iter().any(|unit| unit.path == "fs"
        && unit.kind == "subsystem"
        && unit
            .languages
            .iter()
            .any(|language| language.language == "C" && language.files == 800)));
    assert!(units
        .iter()
        .any(|unit| unit.path == "rust" && unit.name == "kernel-rust"));
    assert!(!units.iter().any(|unit| unit.path == "."));
}

#[test]
fn agent_context_sidecar_exports_graph_and_history() {
    let inventory = minimal_inventory();
    let sidecar = render_agent_context_sidecar("demo", "2026-06-12T00:00:00Z", &inventory);

    assert!(sidecar.contains("# Agent Context Sidecar"));
    assert!(sidecar.contains("repo_graph.v1 / history_brief.v1"));
    assert!(sidecar.contains("review keeps proof local"));
    assert!(sidecar.contains("src/review.ts#L1"));
    assert!(sidecar.contains("file:src-review-ts"));
    assert!(sidecar.contains("decided_by"));
}

#[test]
fn repo_inventory_deserializes_old_reports_without_qa_readiness_or_repo_graph() {
    let raw = serde_json::json!({
        "repo_path": "/tmp/demo",
        "repo_name": "demo",
        "commit_sha": null,
        "branch": null,
        "remote_url": null,
        "files_scanned": 0,
        "files_skipped": 0,
        "bytes_scanned": 0,
        "max_files_hit": false,
        "languages": [],
        "manifests": [],
        "entrypoints": [],
        "top_level_dirs": [],
        "docs": [],
        "config_files": [],
        "stack_tags": [],
        "all_files": [],
        "ignored_dirs": []
    });

    let inventory: RepoInventory = serde_json::from_value(raw).expect("legacy inventory");

    assert_eq!(inventory.qa_readiness.status, "missing");
    assert_eq!(inventory.qa_readiness.score, 0);
    assert_eq!(inventory.repo_graph.schema_version, 1);
    assert!(inventory.repo_graph.nodes.is_empty());
    assert_eq!(inventory.history_brief.schema_version, 1);
    assert!(inventory.history_brief.recent_commits.is_empty());
    assert!(inventory.history_brief.temporal_couplings.is_empty());
}

#[test]
fn reads_git_metadata_from_files_without_spawning_git() {
    let dir = std::env::temp_dir().join(format!("cv_git_meta_{}", std::process::id()));
    let git_dir = dir.join(".git");
    let refs_dir = git_dir.join("refs").join("heads");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&refs_dir).expect("refs dir");
    std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").expect("head");
    std::fs::write(
        refs_dir.join("main"),
        "1234567890abcdef1234567890abcdef12345678\n",
    )
    .expect("ref");
    std::fs::write(
        git_dir.join("config"),
        "[remote \"origin\"]\n\turl = git@github.com:example/demo.git\n",
    )
    .expect("config");

    let (sha, branch, remote) = read_git_metadata_from_files(&dir).expect("metadata");

    assert_eq!(
        sha.as_deref(),
        Some("1234567890abcdef1234567890abcdef12345678")
    );
    assert_eq!(branch.as_deref(), Some("main"));
    assert_eq!(remote.as_deref(), Some("git@github.com:example/demo.git"));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn reads_parent_git_metadata_for_product_subdirectories() {
    let dir = std::env::temp_dir().join(format!("cv_parent_git_meta_{}", std::process::id()));
    let child = dir.join("packages").join("tool");
    let git_dir = dir.join(".git");
    let refs_dir = git_dir.join("refs").join("heads");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&child).expect("child dir");
    std::fs::create_dir_all(&refs_dir).expect("refs dir");
    std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").expect("head");
    std::fs::write(
        refs_dir.join("main"),
        "abcdef1234567890abcdef1234567890abcdef12\n",
    )
    .expect("ref");
    std::fs::write(
        git_dir.join("config"),
        "[remote \"origin\"]\n\turl = https://github.com/example/fleet.git\n",
    )
    .expect("config");

    let (sha, branch, remote) = read_git_metadata_from_files(&child).expect("metadata");

    assert_eq!(
        sha.as_deref(),
        Some("abcdef1234567890abcdef1234567890abcdef12")
    );
    assert_eq!(branch.as_deref(), Some("main"));
    assert_eq!(
        remote.as_deref(),
        Some("https://github.com/example/fleet.git")
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn opportunistic_unpack_db_lock_does_not_wait() {
    let conn = rusqlite::Connection::open_in_memory().expect("memory db");
    let db = std::sync::Arc::new(std::sync::Mutex::new(conn));
    let guard = db.lock().expect("hold db lock");

    let result = lock_unpack_db(&db, true);

    assert!(result.is_err());
    drop(guard);
    assert!(lock_unpack_db(&db, true).is_ok());
}
