//! Canonical product-capability catalog shared by every CodeVetter surface.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

pub const CAPABILITY_SCHEMA_VERSION: &str = "codevetter.capabilities.v1";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStage {
    Current,
    Building,
    Future,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Availability {
    Available,
    Building,
    Planned,
    Unavailable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Authority {
    None,
    Read,
    Execute,
    ReadExecute,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Qualification {
    Qualified,
    Partial,
    Unqualified,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SurfaceProjection {
    pub availability: Availability,
    pub authority: Authority,
    pub entrypoints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SurfaceMatrix {
    pub ui: SurfaceProjection,
    pub cli: SurfaceProjection,
    pub agent: SurfaceProjection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UnderlyingTool {
    pub name: String,
    pub role: String,
    pub requirement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Capability {
    pub id: String,
    pub name: String,
    pub purpose: String,
    pub stage: CapabilityStage,
    pub surfaces: SurfaceMatrix,
    pub underlying_tools: Vec<UnderlyingTool>,
    pub data_boundary: String,
    pub qualification: Qualification,
    pub limitations: Vec<String>,
    pub next_step: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityRegistry {
    pub schema_version: String,
    pub authority: String,
    pub capabilities: Vec<Capability>,
}

pub fn capability_registry() -> CapabilityRegistry {
    let registry = CapabilityRegistry {
        schema_version: CAPABILITY_SCHEMA_VERSION.to_string(),
        authority: "codevetter-rust-core".to_string(),
        capabilities: vec![
            capability(
                "verification.local_check",
                "Local verification",
                "Bind one exact task and change to executable correctness, performance, review, and receipt evidence.",
                CapabilityStage::Current,
                surfaces(
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &[
                            "Tauri Review",
                            "Native Review (acceptance binding, plan, execute, findings, proof map, intent diagnostic, recorded-QA artifacts, isolated fix/recheck, source, X-Ray, export)",
                        ],
                    ),
                    projection(Availability::Available, Authority::ReadExecute, &["codevetter check", "codevetter fix-packet", "codevetter fix", "codevetter xray"]),
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &[
                            "MCP verification_get_receipt (read-only persisted receipt)",
                            "codevetter fix through an explicit local CLI consent boundary",
                        ],
                    ),
                ),
                &[
                    tool("CodeVetter Rust core", "Owns planning, execution order, verdicts, and receipts", "bundled"),
                    tool("Configured coding-agent CLI", "Produces the model review stage", "optional local tool"),
                ],
                "Selected local repository; evidence stays on the Mac unless the configured agent provider is invoked.",
                Qualification::Partial,
                &["The Tauri-independent verification-command/v1 service correlates native/CLI commands, ordered progress/v2 events, request-scoped verification-cancel/v1 termination, and terminal receipts with one bounded request id.", "Cancellation is supervised at the process boundary but is not yet a canonical engine event.", "An unavailable runtime collector yields an explicit limitation rather than a passing claim.", "Native source opening uses the recorded repository-relative path; line positioning depends on the user's default editor.", "Fix execution is deliberately limited to one retained detached worktree. It never commits, merges, pushes, or modifies the selected checkout; discard requires a separate confirmation.", "The repository-scoped MCP server can read one persisted canonical local-check receipt by bounded run id, but it cannot start or cancel verification. Agent execution remains an explicit local CLI consent boundary."],
                "Qualify a real isolated fix/recheck plus saved-flow post-fix rerun without duplicating execution authority in Review.",
            ),
            capability(
                "verification.runtime_preview",
                "Runtime preview verification",
                "Exercise changed browser behavior against an exact preview and preserve executable evidence.",
                CapabilityStage::Current,
                surfaces(
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &[
                            "Tauri Testing",
                            "Native Testing (secret-safe journey workspace + scope discovery + direct preview + warm + differential + scenarios + PR watcher)",
                        ],
                    ),
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &[
                            "codevetter scope --consumer testing",
                            "codevetter trex",
                            "codevetter qa",
                            "codevetter warm",
                            "codevetter differential",
                            "codevetter scenario",
                            "codevetter watcher",
                        ],
                    ),
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &[
                            "MCP resolve_evidence_scope",
                            "MCP qa_workspace_inspect",
                            "MCP prepare_review verification_targets",
                        ],
                    ),
                ),
                &[
                    tool("Playwright", "Runs browser journeys and captures runtime evidence", "project or bundled runtime"),
                    tool("CodeVetter Rust QA workspace", "Owns secret-safe saved workflow projection, repository spec discovery, explicit target handoff, and deterministic post-fix comparison setup", "bundled"),
                ],
                "Selected repository and explicitly supplied preview URL. Watcher polls may contact GitHub, execute project code and a configured agent, and post commit statuses only after foreground confirmation.",
                Qualification::Partial,
                &["A preview must already exist for direct preview verification; warm, differential, and scenario workflows instead require one repository-owned verify script and supported lockfile.", "Fixture execution is contract evidence, not production-change proof.", "Native and CLI consume one codevetter.qa-workspace/v1 receipt. It imports only non-secret legacy fields into a separate native preference, discovers repository Playwright specs without execution, passes the selected route and goal into the canonical T-REX receipt, and never restores preview network consent. The scoped MCP projection is read-only.", "Native and CLI scenario authoring share the incumbent Rust bridge: free/local generation creates only expiring candidates; validation and dry-run are non-persistent; acceptance is hash-bound and destination-selective. Differential evidence never creates pass evidence. Native PR watcher scheduling exists only for the current app lifetime; every foreground poll is explicitly confirmed and remains alive until new head-SHA receipts persist. The watcher fetches the immutable GitHub PR ref without changing the checkout, uses the repository-declared Node package manager, and resolves status authentication ephemerally from existing local authority. MCP target discovery remains read-only and never starts these runtimes.", "One repository-owned evidence-scope fixture now passes the authoritative Rust resolver, CLI projection, native supervised runner, and real read-only MCP protocol without semantic drift.", "A bounded live PR qualification proved exact-head materialization, pnpm frozen installation, repository-owned lint, conservative NEEDS_REVIEW classification, retained receipt identity, and a GitHub commit status without exposing a token."],
                "Qualify one real saved-flow post-fix rerun and complete owner visual acceptance while keeping MCP inspection read-only.",
            ),
            capability(
                "verification.performance",
                "Performance verification",
                "Compare bounded workloads and prevent unsupported optimization claims.",
                CapabilityStage::Current,
                surfaces(
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &[
                            "Tauri Performance",
                            "Native Performance (scope discovery + exact workload)",
                        ],
                    ),
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &[
                            "codevetter scope --consumer performance",
                            "codevetter performance",
                            "codevetter check --perf-adapter",
                        ],
                    ),
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &["MCP resolve_evidence_scope", "MCP prepare_review verification_targets"],
                    ),
                ),
                &[tool("CodeVetter performance capsule", "Supervises samples, warmups, timeouts, and paired evidence", "bundled")],
                "Explicit local workload and optional clean baseline checkout.",
                Qualification::Partial,
                &["Results are workload-specific.", "A missing clean baseline blocks paired-improvement claims.", "Native intent/change/codebase scope resolution, digest-validated recorded-run inspection, the diagnosis-to-paired campaign handoff, and periodic owned-process-tree RSS/process evidence are available. Sampling can miss peaks between 75 ms observations.", "The shared evidence-scope fixture passes Rust, CLI, native, and read-only MCP projections; only UI and CLI retain workload-execution authority.", "Native release launch, steady app RSS, bridge latency, 1,000-event progress throughput, cancellation, worker crash recovery, and five large-receipt decode/render surfaces pass explicit gates."],
                "Refresh launch, settled RSS, responsiveness, energy, and long-session evidence on the exact current package with owner-approved foreground qualification.",
            ),
            capability(
                "evidence.local_usage",
                "Local agent usage",
                "Inspect local token, cache, cost, model, and session evidence without conflating it with cloud quota telemetry.",
                CapabilityStage::Current,
                surfaces(
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &[
                            "Tauri Usage",
                            "Native Usage (ccusage plus separate indexed Devin history)",
                        ],
                    ),
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &["codevetter usage"],
                    ),
                    projection(Availability::Planned, Authority::None, &[]),
                ),
                &[
                    tool(
                        "ccusage 20.0.20",
                        "Normalizes offline Claude, Codex, and Grok local usage logs",
                        "bundled pinned sidecar",
                    ),
                    tool(
                        "CodeVetter Rust core",
                        "Owns provider boundaries, ccusage normalization, separate SQLite Devin history, caching, and stale/unavailable states",
                        "bundled",
                    ),
                ],
                "Local agent logs, optional read-only imported Codex roots, and indexed Devin sessions from the existing SQLite database; no provider credential or network access.",
                Qualification::Partial,
                &[
                    "Indexed Devin sessions, generated/cache tokens, cost, and model rows follow 1w, 30d, 90d, and all-time windows through a separate Rust projection and are never included in ccusage totals.",
                    "Live provider quotas remain separate telemetry and are never inferred from local spend.",
                    "Native 1w, 30d, 90d, and all-time selection keeps ccusage chart, totals, models, and sessions aligned while the separate Devin desk follows the same selected window.",
                ],
                "Migrate live provider telemetry as a credential-safe separate projection, then expose the bounded report through scoped MCP.",
            ),
            capability(
                "usage.history_roots",
                "Additional Codex history roots",
                "Restore Codex sessions stored outside the active CODEX_HOME without reading or deleting transcript content during configuration.",
                CapabilityStage::Current,
                surfaces(
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &["Tauri Usage settings", "Native Usage settings"],
                    ),
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &["codevetter history-roots"],
                    ),
                    projection(Availability::Unavailable, Authority::None, &[]),
                ),
                &[tool(
                    "CodeVetter Rust core",
                    "Owns path normalization, Codex-home validation, deduplication, the 16-root bound, SQLite preference persistence, and the versioned receipt",
                    "bundled",
                )],
                "Absolute local directory identities and availability metadata only; configuration never reads transcript content and removal never deletes provider files.",
                Qualification::Qualified,
                &[
                    "The active CODEX_HOME remains automatic and is not duplicated in the additional-root receipt.",
                    "A selected sessions or archived_sessions directory is normalized to its containing Codex home.",
                    "Reconciliation remains a separate explicit Usage action.",
                    "Agent and MCP surfaces receive no local history-root authority.",
                ],
                "Keep local history-root mutation out of agent authority and preserve the bounded receipt as usage importers evolve.",
            ),
            capability(
                "configuration.native_settings",
                "Native non-secret settings",
                "Read and save declared local preferences without projecting credentials or provider tokens into Swift.",
                CapabilityStage::Building,
                surfaces(
                    projection(
                        Availability::Building,
                        Authority::ReadExecute,
                        &["Native Settings", "Native first-run onboarding"],
                    ),
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &["codevetter settings", "codevetter onboarding"],
                    ),
                    projection(Availability::Unavailable, Authority::None, &[]),
                ),
                &[tool(
                    "CodeVetter Rust core",
                    "Owns the allowlist, validation, SQLite persistence, and versioned receipt",
                    "bundled",
                )],
                "Twenty-eight declared non-secret local preferences plus the shared onboarding completion flag and default adapter; github_token and all undeclared values are excluded from every receipt.",
                Qualification::Partial,
                &[
                    "Integration credentials remain in their incumbent owner until secure native storage is separately qualified.",
                    "Native onboarding reuses the incumbent completion flag, checks executable presence without inspecting authentication, and changes only the declared default adapter plus completion state.",
                    "Ops read-only aggregate status now has a bounded shared contract; credential writes, live provider refresh, and webhook operations remain with the incumbent owner.",
                    "About now reports native version and bundle identity, and Sparkle is locally packaged but remains disabled until production signing, appcast, EdDSA, and installed-upgrade gates pass.",
                ],
                "Prove secure native credential ownership and production updater behavior separately without widening the non-secret settings receipt.",
            ),
            capability(
                "operations.local_status",
                "Local operations status",
                "Inspect bounded local billing readiness, webhook readiness, and aggregate agent-run evidence without exposing credentials or contacting providers.",
                CapabilityStage::Building,
                surfaces(
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &["Native Settings / Ops"],
                    ),
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &["codevetter ops"],
                    ),
                    projection(Availability::Unavailable, Authority::None, &[]),
                ),
                &[tool(
                    "CodeVetter Rust core and SQLite",
                    "Own the fixed time windows, configuration-presence projection, aggregate observability query, secret exclusion, and versioned receipt",
                    "bundled",
                )],
                "Local aggregate counts, rates, durations, and configuration-presence booleans for 7, 30, or 90 days. Credentials, webhook URLs, absolute paths, and provider responses never enter the receipt.",
                Qualification::Partial,
                &[
                    "This surface never refreshes live provider billing or sends a webhook.",
                    "Credential and endpoint writes remain in the incumbent settings surface.",
                    "Indexed-session success remains an explicitly labelled aggregate proxy because the stored source has no failure signal.",
                    "Agent and MCP surfaces receive no operations authority.",
                ],
                "Transfer credential storage and live provider or webhook operations only after a separately reviewed secure-native contract is qualified.",
            ),
            capability(
                "presentation.agent_island",
                "Agent Island",
                "Configure the optional native agent-status presentation without exposing provider content, credentials, or action authority.",
                CapabilityStage::Building,
                surfaces(
                    projection(
                        Availability::Building,
                        Authority::ReadExecute,
                        &["Tauri Agent Island runtime", "Native Agent Island settings"],
                    ),
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &["codevetter settings"],
                    ),
                    projection(Availability::Unavailable, Authority::None, &[]),
                ),
                &[
                    tool(
                        "CodeVetter Rust core",
                        "Owns the twelve-setting allowlist, validation, SQLite persistence, and helper runtime authority",
                        "bundled",
                    ),
                    tool(
                        "AppKit and SwiftUI Agent Island helper",
                        "Owns non-activating presentation and local system speech only",
                        "bundled",
                    ),
                ],
                "Twelve non-secret presentation and speech preferences. Live session snapshots, prompts, output, commands, paths, provider responses, and credentials never enter the settings receipt.",
                Qualification::Partial,
                &[
                    "The feature remains off by default.",
                    "Native UI, CLI, and the retained helper share the exact persisted preference keys, defaults, and options.",
                    "The new Evidence Workbench stores configuration only; it does not yet launch the helper or action live agent requests.",
                    "Agent and MCP surfaces receive no Agent Island authority.",
                ],
                "Integrate and requalify the supervised helper in the new native host before claiming live runtime parity.",
            ),
            capability(
                "evidence.agent_memories",
                "Local agent memories",
                "Inspect bounded local agent instruction and memory sources without granting edit, deletion, credential, or agent authority.",
                CapabilityStage::Current,
                surfaces(
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &["Tauri Memories", "Native Memories"],
                    ),
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &["codevetter memories"],
                    ),
                    projection(Availability::Unavailable, Authority::None, &[]),
                ),
                &[tool(
                    "CodeVetter Rust core",
                    "Owns source discovery, opaque identity, canonical path admission, redaction, byte and character bounds, and Git diff supervision",
                    "bundled",
                )],
                "Explicitly selected local agent memory content. Receipts expose display paths rather than absolute paths and apply line-based secret redaction before content leaves Rust.",
                Qualification::Qualified,
                &[
                    "The source catalog is capped at 128 entries; one document is capped at 512 KiB and 120,000 output characters.",
                    "Redaction is heuristic, so displayed memory remains private operator data.",
                    "The native UI and CLI can list, read, search, copy, and inspect a redacted Git diff; neither can edit or delete a source.",
                    "MCP and agent surfaces receive no memory content or read authority.",
                ],
                "Preserve the read-only boundary while adding explicit source-format fixtures as new agent tools are supported.",
            ),
            capability(
                "maintenance.session_retention",
                "Session archive retention",
                "Preview and explicitly maintain CodeVetter indexed session rows without deleting provider transcripts or source sessions.",
                CapabilityStage::Current,
                surfaces(
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &["Tauri Usage settings", "Native Usage settings"],
                    ),
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &["codevetter retention"],
                    ),
                    projection(Availability::Unavailable, Authority::None, &[]),
                ),
                &[tool(
                    "CodeVetter Rust core",
                    "Owns policy validation, protected-reference discovery, stable plan identity, fail-closed apply, checkpoint, and VACUUM",
                    "bundled",
                )],
                "Local CodeVetter archive and FTS rows only; provider transcripts, source sessions, and protected references are retained.",
                Qualification::Qualified,
                &[
                    "Preview persists a plan receipt but deletes no archive rows.",
                    "Apply and VACUUM require explicit UI or CLI authority and are intentionally not exposed to agents.",
                ],
                "Keep destructive maintenance out of agent authority; add separate read-only recovery diagnostics when the history-root transfer is implemented.",
            ),
            capability(
                "configuration.review_rubrics",
                "Review rubric packs",
                "Keep the exact review standards, active selection, prompt context, and usage attribution consistent across product and agent surfaces.",
                CapabilityStage::Current,
                surfaces(
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &["Tauri Rubrics", "Native Rubrics"],
                    ),
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &["codevetter rubrics", "codevetter check"],
                    ),
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &["codevetter check", "codevetter rubrics"],
                    ),
                ),
                &[tool(
                    "CodeVetter Rust core",
                    "Owns built-in definitions, validation, active selection, custom packs, usage attribution, and exact prompt rendering",
                    "bundled",
                )],
                "Non-secret rubric definitions and local review-attribution counts; no provider credentials or review evidence content.",
                Qualification::Partial,
                &[
                    "The incumbent Tauri shell attempts the bounded WebView-local migration on every startup until Rust owns a canonical preference; opening Rubrics also retries and reports sync errors.",
                    "Built-in packs are immutable; custom packs can be created or replaced within declared bounds.",
                ],
                "Qualify the startup bridge against an installed upgrade with custom packs before retiring the Tauri rubric owner.",
            ),
            capability(
                "machine.repository_mcp",
                "Repository-scoped MCP",
                "Expose bounded local history, graph, archaeology, and review-preparation context to agents without granting file-write or provider authority.",
                CapabilityStage::Current,
                surfaces(
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &["Tauri Agent MCP", "Native Agent MCP"],
                    ),
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &["codevetter mcp"],
                    ),
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &["codevetter-mcp stdio server"],
                    ),
                ),
                &[
                    tool(
                        "CodeVetter MCP server",
                        "Serves repository-scoped resources and tools over local stdio",
                        "bundled companion executable",
                    ),
                    tool(
                        "CodeVetter Rust core",
                        "Owns scope enablement, redaction, limits, audit metadata, and client configuration",
                        "bundled",
                    ),
                ],
                "One explicitly selected, history-indexed local repository; operational audit rows never store arguments, prompts, queries, credentials, or evidence content.",
                Qualification::Partial,
                &[
                    "Enabling requires an existing release-history index.",
                    "The server uses local stdio only and cannot write files, refresh indexes, call providers, or listen on the network.",
                    "The native local package gate bundles and smokes codevetter-mcp beside the app; Developer ID and notarized archive proof remain release gates.",
                ],
                "Add scoped MCP projections for remaining non-local-check receipt families and repeat companion qualification in the notarized production archive.",
            ),
            capability(
                "evidence.tool_collectors",
                "External evidence collectors",
                "Attach narrowly scoped security and coverage receipts without treating tool presence as proof.",
                CapabilityStage::Current,
                surfaces(
                    projection(Availability::Planned, Authority::None, &[]),
                    projection(Availability::Available, Authority::ReadExecute, &["codevetter collect"]),
                    projection(Availability::Unavailable, Authority::None, &[]),
                ),
                &[
                    tool("Gitleaks", "Scans the selected change for secret exposure", "optional local tool"),
                    tool("cargo-audit", "Checks Rust advisories using available local data", "optional local tool"),
                    tool("cargo-llvm-cov", "Captures Rust coverage evidence", "optional local tool"),
                ],
                "Explicit change range in the selected local repository; collectors receive only their declared inputs.",
                Qualification::Partial,
                &["The native glossary reports declared collectors and limitations but does not execute them.", "Collectors are not installed or network-enabled automatically.", "Unavailable offline data keeps the claim closed."],
                "Add bounded collector receipt inspection to the native UI and scoped MCP without granting either surface collector-execution authority.",
            ),
            capability(
                "repository.snapshot_scan",
                "Deterministic repository snapshot",
                "Create and inspect one local, bounded source, history, health, and topology snapshot without invoking a model.",
                CapabilityStage::Current,
                surfaces(
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &[
                            "Tauri Repo Unpack",
                            "Native Repo Unpack (scan + bounded inspectors)",
                        ],
                    ),
                    projection(
                        Availability::Available,
                        Authority::ReadExecute,
                        &["codevetter unpack --operation scan", "codevetter unpack --operation inspect"],
                    ),
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &[
                            "MCP graph and history tools over an explicitly enabled stored index",
                        ],
                    ),
                ),
                &[
                    tool(
                        "CodeVetter Rust core",
                        "Owns the deterministic scan, bounded projection, persistence, and receipt",
                        "bundled",
                    ),
                    tool(
                        "Git",
                        "Supplies local revision and bounded history evidence when available",
                        "optional local tool",
                    ),
                    tool(
                        "rusqlite",
                        "Persists the canonical local snapshot",
                        "bundled",
                    ),
                ],
                "One explicitly selected local directory and the local SQLite evidence store; the scan does not call a provider or require network access.",
                Qualification::Partial,
                &[
                    "The client receipt omits the raw full-file list while the bounded canonical snapshot remains local.",
                    "Topology, history, and deterministic health are navigation evidence, not executable verification.",
                    "Native model synthesis execution and cleanup remain migration gaps.",
                ],
                "Migrate the remaining synthesis and cleanup workflows while keeping every Rust receipt authoritative.",
            ),
            capability(
                "repository.structural_graph",
                "Structural repository graph",
                "Navigate source-backed symbols, relationships, impact, and history without presenting topology as runtime proof.",
                CapabilityStage::Current,
                surfaces(
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &[
                            "Tauri Repo Unpack",
                            "Native Repo Unpack (bounded snapshot + canonical query desk)",
                        ],
                    ),
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &[
                            "codevetter unpack --operation query --query-domain graph --query-mode search|explain|impact|path",
                            "codevetter-graph",
                        ],
                    ),
                    projection(Availability::Available, Authority::Read, &["graph_query", "graph_impact", "graph_path"]),
                ),
                &[tool("Tree-sitter", "Extracts syntax-aware source identities across the qualified language set", "bundled")],
                "Selected local repository and its local SQLite evidence store.",
                Qualification::Qualified,
                &[
                    "Graph relationships are navigation evidence, not executable verification.",
                    "Native search, node explanation, impact, and directed path stay bounded and fail closed when the canonical structural index is unavailable.",
                    "Native retains one read-only search projection per worker, upgrades it in place with compact traversal edges only when required, hydrates bounded result evidence, rechecks live Git freshness and latest snapshot identity on every query, and falls back to the exact supervised one-shot CLI contract when the worker transport is unavailable.",
                ],
                "Add source-opening and richer graph filtering without moving ranking or traversal semantics into Swift.",
            ),
            capability(
                "repository.history",
                "Evidence-backed repository history",
                "Explain bounded historical state and lineage using stable evidence identities and explicit gaps.",
                CapabilityStage::Current,
                surfaces(
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &[
                            "Tauri Repo Unpack",
                            "Native Repo Unpack (bounded snapshot + canonical query desk)",
                        ],
                    ),
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &[
                            "codevetter unpack --operation query --query-domain history --query-mode search|trace",
                        ],
                    ),
                    projection(Availability::Available, Authority::Read, &["history_search", "history_explain", "history_trace"]),
                ),
                &[tool("Git", "Supplies exact local revision and tag identity", "required local tool")],
                "Authorized repository scope and read-only local SQLite evidence.",
                Qualification::Qualified,
                &[
                    "Explanations remain bounded by indexed evidence and disclose missing causal proof.",
                    "Native history search and causal trace share the canonical Rust index, preserve evidenced versus qualified-lead links, and fail closed when temporal coverage is unavailable.",
                    "Repeated native history queries reuse the same scoped read-only worker and preserve the exact one-shot CLI fallback.",
                ],
                "Add native source lineage without duplicating temporal semantics in Swift.",
            ),
            capability(
                "native.evidence_workbench",
                "Native Evidence Workbench",
                "Provide a fast, accessible macOS operating surface over the canonical Rust verification loop.",
                CapabilityStage::Building,
                surfaces(
                    projection(Availability::Building, Authority::ReadExecute, &["apps/macos"]),
                    projection(Availability::Unavailable, Authority::None, &[]),
                    projection(Availability::Unavailable, Authority::None, &[]),
                ),
                &[
                    tool("AppKit", "Owns windows, menus, split views, keyboard behavior, and lifecycle", "Apple platform"),
                    tool("SwiftUI", "Composes feature, inspector, and settings views", "Apple platform"),
                    tool("CodeVetter Rust core", "Owns verification execution, persistence, verdicts, and canonical receipts", "bundled CLI and MCP companions"),
                    tool("Sparkle 2.9.6", "Owns signed update discovery, installation, and relaunch after production configuration", "exact Swift package; disabled in preview"),
                    tool("XcodeBuildMCP 2.7.0", "Provides reproducible project build and test automation", "development only"),
                ],
                "User-selected local repositories; no ambient credential authority. Sparkle remains inactive unless a production HTTPS appcast and EdDSA public key are present.",
                Qualification::Partial,
                &[
                    "The native client does not replace Tauri until feature, output, performance, accessibility, visual, installed-upgrade, and owner gates pass.",
                    "The local package is hardened, non-sandboxed, and ad-hoc signed; Developer ID signing, notarization, production updater inputs, and rollback proof remain open.",
                ],
                "Close retained feature and owner-interaction gaps, refresh exact-package performance with owner-approved foreground qualification, then qualify a notarized installed upgrade before the owner retirement decision.",
            ),
            capability(
                "evidence.local_runs",
                "Verification run ledger",
                "Inspect one bounded chronology of local-check, preview, T-Rex PR, synthetic QA, warm, differential, and audience evidence without rewriting originating receipts.",
                CapabilityStage::Building,
                surfaces(
                    projection(
                        Availability::Building,
                        Authority::Read,
                        &["Native Runs (building)"],
                    ),
                    projection(
                        Availability::Available,
                        Authority::Read,
                        &["codevetter runs"],
                    ),
                    projection(Availability::Unavailable, Authority::None, &[]),
                ),
                &[
                    tool(
                        "CodeVetter Rust core",
                        "Owns receipt schemas and persistence",
                        "bundled",
                    ),
                    tool(
                        "rusqlite",
                        "Stores complete canonical receipts in the existing local database",
                        "bundled",
                    ),
                ],
                "Local SQLite database; list results are bounded to at most 100 receipts.",
                Qualification::Partial,
                &[
                    "The ledger is read-only; watcher, QA, and audience workflow controls remain on their originating surfaces until those workspaces migrate.",
                    "The Swift host-render gate excludes window-server frame pacing and interactive scrolling.",
                    "Foreground XCUITest and owner interaction acceptance remain open.",
                ],
                "Complete foreground UI automation and owner interaction acceptance, then use the ledger as shared evidence infrastructure for Testing and Performance.",
            ),
            capability(
                "runtime.hardened_isolation",
                "Hardened execution isolation",
                "Run untrusted project checks with stronger process, filesystem, resource, and network containment.",
                CapabilityStage::Future,
                surfaces(
                    projection(Availability::Planned, Authority::None, &[]),
                    projection(Availability::Planned, Authority::None, &[]),
                    projection(Availability::Planned, Authority::None, &[]),
                ),
                &[tool("Apple Containerization or measured alternative", "Candidate containment boundary", "not selected")],
                "Not yet defined; no isolation claim is made.",
                Qualification::Unqualified,
                &["No production isolation backend has passed the runtime and compatibility gates."],
                "Benchmark candidates against real CodeVetter workloads before selecting a dependency.",
            ),
        ],
    };
    debug_assert!(validate_registry(&registry).is_ok());
    registry
}

pub fn capability_registry_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://codevetter.com/schemas/capabilities.v1.json",
        "title": "CodeVetter capability registry",
        "type": "object",
        "additionalProperties": false,
        "required": ["schema_version", "authority", "capabilities"],
        "properties": {
            "schema_version": {"const": CAPABILITY_SCHEMA_VERSION},
            "authority": {"const": "codevetter-rust-core"},
            "capabilities": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["id", "name", "purpose", "stage", "surfaces", "underlying_tools", "data_boundary", "qualification", "limitations", "next_step"]
                }
            }
        }
    })
}

pub fn validate_registry(registry: &CapabilityRegistry) -> Result<(), String> {
    if registry.schema_version != CAPABILITY_SCHEMA_VERSION {
        return Err("Capability registry schema version is invalid".to_string());
    }
    let mut ids = HashSet::new();
    for capability in &registry.capabilities {
        if capability.id.trim().is_empty() || !ids.insert(capability.id.as_str()) {
            return Err(format!(
                "Capability id '{}' is empty or duplicated",
                capability.id
            ));
        }
        if capability.name.trim().is_empty()
            || capability.purpose.trim().is_empty()
            || capability.data_boundary.trim().is_empty()
            || capability.next_step.trim().is_empty()
        {
            return Err(format!("Capability '{}' is incomplete", capability.id));
        }
        for projection in [
            &capability.surfaces.ui,
            &capability.surfaces.cli,
            &capability.surfaces.agent,
        ] {
            let visible = matches!(
                projection.availability,
                Availability::Available | Availability::Building
            );
            if visible && projection.entrypoints.is_empty() {
                return Err(format!(
                    "Capability '{}' has a visible surface without an entrypoint",
                    capability.id
                ));
            }
            if !visible && projection.authority != Authority::None {
                return Err(format!(
                    "Capability '{}' grants authority on an unavailable surface",
                    capability.id
                ));
            }
        }
    }
    Ok(())
}

fn projection(
    availability: Availability,
    authority: Authority,
    entrypoints: &[&str],
) -> SurfaceProjection {
    SurfaceProjection {
        availability,
        authority,
        entrypoints: entrypoints
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
    }
}

fn surfaces(
    ui: SurfaceProjection,
    cli: SurfaceProjection,
    agent: SurfaceProjection,
) -> SurfaceMatrix {
    SurfaceMatrix { ui, cli, agent }
}

fn tool(name: &str, role: &str, requirement: &str) -> UnderlyingTool {
    UnderlyingTool {
        name: name.to_string(),
        role: role.to_string(),
        requirement: requirement.to_string(),
    }
}

#[allow(clippy::too_many_arguments)]
fn capability(
    id: &str,
    name: &str,
    purpose: &str,
    stage: CapabilityStage,
    surfaces: SurfaceMatrix,
    underlying_tools: &[UnderlyingTool],
    data_boundary: &str,
    qualification: Qualification,
    limitations: &[&str],
    next_step: &str,
) -> Capability {
    Capability {
        id: id.to_string(),
        name: name.to_string(),
        purpose: purpose.to_string(),
        stage,
        surfaces,
        underlying_tools: underlying_tools.to_vec(),
        data_boundary: data_boundary.to_string(),
        qualification,
        limitations: limitations
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        next_step: next_step.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_registry_is_complete_and_duplicate_safe() {
        let registry = capability_registry();
        validate_registry(&registry).expect("valid registry");
        assert!(registry
            .capabilities
            .iter()
            .any(|capability| capability.stage == CapabilityStage::Future));
        assert!(registry
            .capabilities
            .iter()
            .all(|capability| !capability.underlying_tools.is_empty()));
    }

    #[test]
    fn schema_and_payload_share_the_exact_version() {
        let schema = capability_registry_schema();
        assert_eq!(
            schema["properties"]["schema_version"]["const"],
            CAPABILITY_SCHEMA_VERSION
        );
        assert_eq!(
            capability_registry().schema_version,
            CAPABILITY_SCHEMA_VERSION
        );
    }

    #[test]
    fn external_collectors_keep_surface_authority_explicit() {
        let registry = capability_registry();
        let collectors = registry
            .capabilities
            .iter()
            .find(|capability| capability.id == "evidence.tool_collectors")
            .expect("external collector capability");

        assert_eq!(collectors.surfaces.ui.availability, Availability::Planned);
        assert_eq!(collectors.surfaces.ui.authority, Authority::None);
        assert!(collectors.surfaces.ui.entrypoints.is_empty());
        assert_eq!(collectors.surfaces.cli.authority, Authority::ReadExecute);
        assert_eq!(collectors.surfaces.agent.authority, Authority::None);
    }
}
