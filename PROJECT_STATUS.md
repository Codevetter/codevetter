# Project Status

Last updated: 2026-09-02

## Why / What

CodeVetter is an execution-backed verification and evaluation system for coding
agents. It determines whether an agent completed a software task correctly
using reproducible execution evidence, not another LLM opinion.

The core loop is **task → agent change → executable verification → evidence →
measurable verdict**. The durable assets are the benchmark corpus, evaluation
harness, deterministic and calibrated graders, failure taxonomy, and historical
regression system. CLI/MCP and a machine-readable verification bundle are the
primary product surfaces; the desktop application is a local viewer.

Core scope starts with TypeScript/Node web applications and browser/API
behavior. **Core Mode** protects that roadmap. **Side Quest Mode** permits
explicitly requested non-core work, but it must stay bounded and must not
silently redefine or displace the core.

## Current investment decision

As of 2026-08-15, CodeVetter remains a maintained local product and empirical
verification/performance research asset, but broad feature expansion is paused.
The repository has strong deterministic infrastructure, caught-bug evidence,
and several measured optimization case studies; it does **not** have the planned
ten active external users, three team pilots, or complete authenticated
multi-provider trials. Those missing outcomes must not be inferred from owner
dogfood, synthetic corpora, or local qualification.

New work should be limited to core verification reliability, regressions,
security, maintenance, and evidence requested by real users. Agent Island stays
opt-in, authenticated provider comparisons remain claim-closed, and no hosted
profiling or production-load system should be added until external pull and a
separately approved safety design justify renewed investment.

## Dependencies

External:
- Bundled `ccusage` 20.0.20 sidecar — local, offline Claude/Codex/Grok usage accounting; exact updates are opened weekly and remain qualification-gated.
- Installed and authenticated Codex or Claude CLI for Work conversations; provider account policy remains external to CodeVetter.
- GitHub Releases + GitHub Actions — `auto-release.yml` cuts a `v<version>` release on `tauri.conf.json` version bumps, dispatching `release.yml` to build/sign/upload Tauri binaries; `@tauri-apps/plugin-updater` consumes the `latest.json` manifest.
- Cloudflare Pages — hosts the landing page (`codevetter` project, codevetter.com).
- Optional `ast-grep` on PATH for structural evidence matches (no required runtime dependency).
- Playwright — e2e testing, existing synthetic-QA runners, and the repository-owned warm Chromium verifier.

Internal (fleet):
- Site Health — private portfolio metadata and health evidence.
- Workflows and Skills — reusable cross-project automation and agent skills.
- CodeVetter work remains tracked in this repository's GitHub Issues. The
  retained SaaS Maker link is compatibility-only and is not a task system of
  record.
- Local SQLite via `rusqlite` in the Tauri backend — desktop only, no server.

## Timeline

- **2026-09-02 — Independent Claude and Codex review (unreleased source):**
  native Review and `codevetter check --agent cross` now request two sequential,
  independent passes against the same immutable Rust-owned target and context.
  The second reviewer receives no first-review output. Deterministic
  reconciliation uses exact source-qualified path, line, and anchor identity;
  title similarity never merges findings, a unique high-risk finding remains
  actionable, and severity disagreement remains visible. Missing executors,
  target drift, incomplete coverage, cancellation, or an unqualified candidate
  fail closed without a composite finding claim. Persisted receipts preserve
  reviewer-specific manifests, qualified candidates, readiness, duration, and
  explicit usage/raw-candidate availability limits; repository-scoped MCP can
  inspect the same receipt but cannot execute or cancel it. The 35-state native
  packet includes dark/light cross-review evidence. Provider-backed caught-bug
  27-case provider-backed corpus run found 29/29 labels with Claude, 28/29 with
  Codex, and 29/29 with the union. Cross-review recovered one low-severity
  unused-helper label over Codex, but emitted 99 findings versus 46 and took
  187.5 seconds per case versus 99.1 seconds; usage/cost remained unavailable.
  Cross-review is therefore qualified as an optional high-recall strategy and
  is not the default.

- **2026-09-02 — Native owner-quality refinement (unreleased source):** the
  Evidence Workbench preserves a true-black canvas and chrome while restoring
  restrained 1--4% near-black separation across working planes. Standalone
  Review proof-map and intent renders now own an opaque canvas, and the owner
  packet deterministically captures both search-only and rich repository-query
  states, plus light-appearance Review, Testing, Performance, Runs, history
  recovery, memory inspection, Agent Island configuration, and read-only Ops
  status. All 35
  current-tree image hashes match the manifest. The same pass
  reproduced and fixed a repository-query cancellation hang by closing stdin,
  granting a bounded 200 ms termination grace, and using a final kill only for
  the exclusively owned read-only worker; its test requires settlement within
  one second. Appearance-aware amber and semantic evidence foregrounds now
  meet a checked 4.5:1 normal-text contrast floor in dark and light modes. The
  native Usage settings and CLI now share a bounded Rust history-root receipt:
  selected Codex session folders normalize to their canonical home, unrelated
  directories fail closed, and add/remove never reads or deletes transcripts.
  Agent and MCP authority remain unavailable. Native Settings and
  `codevetter memories` now share a read-only `codevetter.memories/v1` receipt:
  Rust discovers bounded known locations, exposes only existing sources through
  opaque identities and non-absolute display paths, caps reads/output, and
  redacts secret-like content and Git-diff lines heuristically. Memory editing
  and agent/MCP projections remain unavailable. The same Rust settings receipt
  now preserves all 12 non-secret Agent Island preferences across native UI,
  CLI, and the retained helper. Native labels configuration as live and the
  supervised runtime as pending; the helper remains off by default and is not
  launched by the Evidence Workbench. Native Settings and `codevetter ops`
  now share a fixed-window `codevetter.ops-status/v1` receipt for local
  configuration presence and aggregate run evidence. It excludes credentials,
  webhook URLs, provider calls, webhook sends, writes, and agent/MCP authority.
  The retained Tauri shell now attempts the sanitized one-time custom-rubric
  transfer on every startup until Rust owns a canonical preference. Existing
  Rust state wins, invalid legacy state writes nothing, browser-only mode does
  not invoke Tauri, and the Rubrics surface remains a visible retry path.
  Isolated frontend and Rust tests pass; installed WebView-to-native
  qualification remains an explicit upgrade gate.
  The isolated hosted lane passes 81 Swift tests, all nine XCUITests, Debug and
  coverage-free Release macOS builds, and unsigned preview packaging without
  using the operator's desktop. A read-only
  current-package receipt binds the exact
  `qualification-5r7JG4` candidate and measures a 62.4% smaller app bundle and
  92.4% smaller host executable than
  the retained Tauri Release bundle; it does not refresh the historical launch
  or settled-memory comparison.
  Release-only fat LTO and one Rust codegen unit reduce the CLI and MCP
  companions by 14.6% and 27.5% versus the prior candidate. Native Release
  postprocessing removes test coverage instrumentation, strips the shipped host
  while preserving its adjacent dSYM, and is enforced by the package gate.
  The exact packaged MCP passes its fully sampled 50-start/200-round
  qualification with 8.52 ms cold-initialize p95, 30.11 MiB ending RSS, 28
  strict read-only tools, and no TCP listener.
  The complete all-feature Rust lane now passes 1,105 tests with 31 intentional
  ignores, strict Clippy, and formatting. The retained frontend passes 680 unit
  tests with one intentional skip, its separate 20-scenario live warm gate,
  package-scoped TypeScript, and a production Vite build.
  The Rust-generated capability glossary now has a deterministic native render
  proving the external-collector split: CLI execution is available, a native
  collector workflow remains planned, and agent authority remains unavailable.
  Stale matched-comparison next steps now point to exact-package foreground,
  responsiveness, energy, and long-session evidence instead of asking for an
  already-completed comparison.
  A manifest-locked local gallery exposes all 35 original-pixel dark/light
  renders without external assets or network calls; its test fails on missing
  or duplicate states. The final audit replaced the active Rubric pack's
  washed-out disabled amber action with a high-contrast green `Selected`
  receipt in both appearances; only available packs retain the amber action.
  This evidence is ready for owner review but does not infer visual acceptance.

- **2026-09-02 — Native hosted qualification (unreleased source):** GitHub
  Actions run 33609288529 passed at exact source commit `824a9e8b`. The existing
  Linux product lane remained green, while the isolated arm64 `xcode-27` lane
  passed 81 Swift tests, all nine XCUITests, Debug and coverage-free Release
  builds, the 33-state owner packet, ad-hoc ZIP/DMG packaging, and read-only
  release inspection. Hosted large-receipt render p95s were 96.536 ms Repo
  Unpack, 105.896 ms Usage, 121.065 ms Performance, 55.087 ms Testing, and
  64.132 ms Runs, all below the unchanged 150 ms gate. The exact package and
  evidence identities are recorded in
  `evidence/verification/native-hosted-qualification-2026-09-02.md`. The
  hosted images are internally manifest-bound but not byte-identical to the
  earlier local packet, so owner visual acceptance remains explicit. The
  candidate correctly remains `shipping_ready: false`: production identifier
  transfer, Developer ID signing, Library Validation, updater inputs,
  notarization/Gatekeeper, installed upgrade/rollback, exact-package runtime
  evidence, and the Tauri retirement decision remain open.

- **2026-09-02 — Native release preflight (unreleased source):** a read-only
  `codevetter.native-release-readiness/v1` inspector now binds the exact staged
  app to its local qualification, verifies package/signature/runtime/updater
  boundaries, and accepts only archive-bound notarization plus
  production-identity installed-upgrade proofs. The current preview passes 7
  of 17 checks but correctly remains `shipping_ready: false` on ten production
  gates: bundle transfer, Developer ID host/companion signing and one team,
  Library Validation, HTTPS appcast, EdDSA key, archive-bound appcast,
  Gatekeeper, notarization, and
  installed upgrade/relaunch/data/rollback evidence. The installed proof now
  binds the exact archive and build and requires a non-empty stable-record
  fingerprint across native relaunch and rollback. A dependency-free,
  read-only SQLite probe produces that content-free continuity projection and
  fails on any missing incumbent identity. Its qualification used isolated
  fixtures only. The inspection did not read credentials, sign, notarize,
  install, publish, or change the installed Tauri application.

- **2026-09-01 — Native macOS package candidate (unreleased source):** the
  native AppKit/SwiftUI Evidence Workbench now builds as a hardened,
  intentionally non-sandboxed Release app with exact Sparkle 2.9.6 wiring that
  remains disabled for the preview identifier. A repository-owned qualifier
  reuses the existing Rust and ccusage sidecar builders, packages the canonical
  `codevetter`, `codevetter-mcp`, `ccusage`, and performance runtime capsule,
  preserves Sparkle framework symlinks, smoke-tests every companion, verifies
  deep signatures and runpaths, and produces local ZIP/DMG artifacts. The
  staged package passed five alternating, surface-confirmed launches on the
  populated Performance workspace at 117,424 KiB median process-tree RSS and
  has checked true-black visual evidence. A matched five-by-five Release
  comparison records startup parity (435.120 ms native versus 419.018 ms Tauri
  first-visible-window median), 30.5% lower native settled RSS, and a 51.5%
  smaller qualified native bundle. Native Review now enters one
  Tauri-independent Rust application service: a bounded request id correlates
  `codevetter.verification-command/v1`, ordered `codevetter.progress/v2`
  events, request-scoped `codevetter.verification-cancel/v1`, and the distinct
  preflight or final canonical receipt. Foreign progress, cancellation, and
  terminal receipts fail closed. One shared no-confidence fixture now proves
  equivalent request, stage, limitation, verdict, and exit semantics through
  Rust, CLI, and native; the repository-scoped MCP
  `verification_get_receipt` projection reads that same persisted canonical
  receipt without gaining start or cancellation authority. The final packaged
  sidecar exposes 28 strict read-only tools with no TCP listener. Native Review, the CLI, and local agent
  invocation also share a Rust-owned, explicit-consent isolated-fix contract:
  one detached worktree, bounded diff, recorded correctness rerun,
  source-qualified re-review, per-finding fixed/reproduced/unchecked status,
  retained owner inspection, and separately confirmed discard. There is no
  commit, merge, or push action. Repo Unpack can now create a model-free local
  snapshot from native UI or `codevetter unpack --operation scan` through one
  Rust-owned scan/persistence boundary, then inspect stored Overview, Brief,
  Activity, Inventory, and bounded Graph evidence in the native workspace.
  The versioned receipt removes the raw file list from the client projection,
  reports scan and persistence profiles separately, and continues to label
  topology, history, and health as non-executable evidence. The native Graph
  desk and `codevetter unpack --operation query` share the versioned
  `codevetter.repo-query/v2` projection over the canonical structural and
  temporal query services already used by MCP. Search, node explanation,
  bounded impact, directed path, and causal trace retain index freshness,
  trust, source anchors, and explicit unavailable coverage; Swift performs no
  ranking or traversal. A scoped read-only worker prepares one search-only
  canonical snapshot in the background, then upgrades it in place with compact
  traversal edges only when requested while rechecking snapshot identity and
  live-Git freshness. On the qualified 115,884-node graph, warm Release medians
  measured 36.07 ms search, 35.15 ms explain, 116.55 ms impact, 68.38 ms path,
  32.46 ms history search, and 32.21 ms causal trace. Search-only RSS measured
  242.6 MiB and rich traversal RSS 307.6 MiB after rejecting a 511.9 MiB full
  snapshot prototype. Contract/parser/render tests, 76 Swift tests, inspected
  true-black evidence, and the quiet native compile gate pass. Native repository
  selection now restores one
  security-scoped bookmark across launches, and Usage applies 1w/30d/90d/all
  windows consistently to ccusage charts, totals, models, and sessions while
  the separate indexed Devin desk follows the same window for sessions,
  generated/cache tokens, cost, and model rows. Live quota telemetry remains a
  separate credential-sensitive migration. Review receipts now add a
  Rust-owned `codevetter.review-intent-diagnostic/v1` projection across native,
  CLI JSON, and local-agent output: it preserves the stated goal, deterministic
  changed-surface classes, source-review and recorded-QA signals, gaps, and a
  human-only closure boundary. Native Review gives this diagnostic a dedicated
  true-black evidence desk and can reveal validated recorded QA artifacts in
  Finder without promoting legacy QA into revision-exact proof. Its execution
  action hands the exact repository and range or pull request to Testing,
  clears stale proof and consent, and requires a preview plus fresh explicit
  browser-run confirmation there. Native Testing, `codevetter qa`, and the
  scoped read-only `qa_workspace_inspect` MCP tool now consume one Rust-owned
  `codevetter.qa-workspace/v1` receipt for saved workflows and targets,
  repository Playwright spec discovery, and deterministic post-fix rerun
  setup. Legacy fields are projected into a separate native preference without
  storage-state paths or arbitrary external commands; a selected route and goal
  enter the canonical T-REX receipt, while preview consent is always reset.
  Review will not regain a second browser execution authority. A real-agent fix
  plus real saved-flow rerun smoke remains open. The populated
  native app now also consumes `codevetter.onboarding/v1` for first-run state:
  it honors the incumbent completion preference, checks executable presence
  without inspecting authentication or credentials, transactionally saves
  only the declared default adapter plus completion, and renders four
  true-black Purpose, Readiness, Agent, and Workbench states. The same receipt
  is available through `codevetter onboarding`, while About can reopen the tour
  without changing completion state. The populated
  native Performance receipt now lazily renders visible evidence rows and
  repeated its 100-row gate three times at 41.867, 46.009, and 35.226 ms render
  p95. Qualification conservatively uses the 46.009 ms worst run against the
  unchanged 150 ms gate. This is not a release: Developer ID signing,
  notarization, production appcast and EdDSA inputs, installed update/rollback,
  workload/energy/long-session comparison, remaining feature/accessibility
  parity, and owner retirement approval are still open.

- **2026-08-31 — External performance, testing, and MCP evidence adapters
  (unreleased source):** verification-receipt ingestion now accepts Playwright
  JSON, JUnit XML, LCOV, Cobertura XML, Lighthouse JSON, and Chrome trace JSON
  while preserving raw artifact identity, hashing failure text, rejecting XML
  entities, and keeping observation-only formats at `no_confidence`. A three-run
  Lighthouse CI trial passed the proposed landing-page gates, but the dependency
  was removed after the high-severity audit exposed an unpatched transitive
  archive traversal. Upstream Size Limit now follows rather than replaces the
  desktop's Tauri-aware bundle budgets. `pnpm verification:dogfood` now runs the
  active Playwright and c8 suites, emits Playwright JSON, JUnit, LCOV, and
  Cobertura through their built-in reporters, and successfully ingests all four
  while retaining `no_confidence` outside their proof. The run also removed the
  retired Work/Board E2E inventory and exposed then fixed a duplicate React key
  in Testing. The maintainer Codex client has pinned
  isolated Chrome DevTools and Playwright MCPs plus named CodeVetter runtime and
  receipt MCPs. GitHub's checksum-verified official v1.11.0 local server replaces
  the PAT-dependent remote registration, with read-only relevant toolsets and
  narrow in-memory browser OAuth. Live repository, pull-request, Actions, issue,
  and CodeQL reads verify the connection without exposing a write tool. The
  packaged CodeVetter graph/history MCP is also enabled for the canonical
  checkout from the app-generated opaque configuration. Its history and
  tree-sitter structural indexes are current at the checked-out HEAD, and direct
  protocol smoke tests returned bounded `history_search` and `graph_query`
  results with local access-audit rows. No product release or deployment is
  claimed; work is tracked in issue #200.

- **2026-08-31 — Bounded external collector foundation (unreleased source):**
  Added `codevetter collect` and a shared Rust `codevetter.tool-collection/v1`
  receipt for one exact clean checked-out Git range. The first adapter executes
  an exact Gitleaks 8.30.1 bundle sibling or explicit debug/test override without a
  shell, with a minimal environment, timeout, bounded output, binary/config
  identity, repository-relative normalization, and raw secret fields removed
  before serialization. cargo-audit and cargo-llvm-cov currently return
  explicit `unavailable` evidence after optional exact-version preflight; they
  do not install tools, fetch advisory data, or claim coverage. No sidecar is
  yet bundled and no release claim is made; packaging and the remaining
  collectors stay tracked in issue #198.

- **2026-08-31 — Apple Container trial qualified with a containment caveat:**
  Installed the signed/notarized 1.3.1 CLI after owner authorization and
  exercised a 1-CPU/256-MB, internal-network, no-DNS, read-only-root sandbox on
  the supported arm64 macOS 27 host. The cached no-op run took 0.61 seconds and
  teardown left zero containers. A controlled traversal fixture proved the CLI
  does not enforce CodeVetter's workspace-root boundary, so any adapter must
  canonicalize and reject out-of-root mounts itself. This is external-prerequisite
  qualification, not a bundled dependency or architecture approval; issue #197
  remains open.

- **2026-08-24 — Unified local change check (unreleased source):** the packaged
  `codevetter` CLI now accepts one clean checked-out PR head or Git range plus
  task intent and emits `codevetter.local-check/v1`. The runner resolves exact
  base/head identities, executes the existing CLI review pipeline, selects or
  accepts one closed correctness target, captures one qualified performance
  diagnosis, and returns an explicit optimization handoff. A candidate can be
  rerun with `--baseline-repo` for same-scope paired verification. It does not
  install dependencies, edit source, push, merge, deploy, or turn a missing
  test/benchmark into a pass. Review setup exposes a copyable command; release
  publication and real cross-project benchmark qualification remain separate.

- **2026-08-24 — Review-agent preparation flow (unreleased source):** the
  packaged read-only MCP now includes `prepare_review`, which binds a bounded
  task to one exact Git change and composes a versioned review packet from the
  existing target resolver, structural graph, history, prior deterministic
  review manifests, and testing/performance scope candidates. It does not call
  a model, execute project code, write a receipt, or modify the repository.
  Agent MCP settings and Review setup expose the readiness state and minimal
  invocation without adding a route or product surface. Release publication
  remains separate.

- **2026-08-23 — Agent-context utility evidence foundation:** Added a closed,
  backward-compatible telemetry contract to new agent-task receipts. The runner
  now records append-only monotonic phase spans and samples adapter process-tree
  RSS/CPU independently of adapter self-report; unsupported I/O, network,
  thermal, and external-daemon measurements remain explicit nulls. Optional
  adapter diagnostics gained token-class, total-call, and aggregate tool/model
  timing fields. Receipt evaluation now publishes provenance-labelled paired
  control/treatment means and within-pair deltas for outcome, context, latency,
  and available resource metrics without collapsing them into a composite
  winner. Hermetic synthetic tests prove contracts, ordering, sampling,
  projection, and deterministic reports. A subsequently approved 16-attempt
  local Qwen3 4B telemetry rerun repeated the immutable Stage 1 outcome:
  control 2/8, CodeVetter graph treatment 0/8, descriptive delta -25 percentage
  points (`p = 0.5`). Treatment added roughly 891 ms, 1,347 input tokens, 21 ms
  sampled adapter CPU, and 30.7 MB sampled adapter-process-tree peak RSS on
  paired means. The result remains unqualified and does not test context
  replacement: both arms received the complete fixture source, treatment added
  graph evidence, A/A noise was absent, and the external model server plus
  whole-machine thermal/energy/I/O were not measured.

- **2026-08-19 — Claude/Grok local-accounting correction (v1.9.1):** Expanded
  the pinned `ccusage` report to Claude, Codex, and Grok while keeping Devin as
  an independently queried local source. Devin query failures no longer hide
  healthy ccusage data, and fresh/generated totals now include cache-creation
  input. Claude live-quota checks now consider configured profile files and
  Keychain candidates, selecting the freshest expiry instead of
  unconditionally preferring a stale default file.

- **2026-08-16 — ccusage local-accounting cutover (shipped in v1.9.0):** Replaced
  the Usage chart's custom Claude/Codex accounting with one cached report from
  the pinned bundled `ccusage` sidecar. The chart contained ccusage-backed
  Claude/Codex data plus the existing Devin tracker; Cursor and Grok were
  excluded. Reliable provider remaining-usage and quota cards remained a
  separate surface.
  Retired the Codex reconciliation UI, startup repairs, observation writes, and
  bespoke ledger pricing/qualification code while leaving historical SQLite
  tables intact. Devin remains separate because upstream ccusage does not
  support its cloud-side usage.

- **2026-08-16 — Focused desktop performance workbench (release candidate):**
  Retired Work and Board from the visible product shell and redirected their
  routes to Usage without deleting local historical records or backend lifecycle
  code. Added a persistent Performance surface backed by the existing local
  runtime engine for closed Node test/script, Vitest, Playwright, and Go benchmark
  scopes. The desktop bridge validates contained inputs, clears inherited secret
  environment variables, supervises one owned process with cancellation and
  timeout, bounds and sanitizes output, and packages the existing engine as a
  Tauri resource. The UI separates observed evidence, inference, unverified
  hypotheses, and limitations; its illustrative browser fixture is explicitly
  labelled and is not product-impact evidence. Focused Rust, runtime, TypeScript,
  and rendered-state checks pass; Playwright execution remains locally blocked by
  its missing pinned browser binary and is not represented as passing.

- **2026-08-15 — Local performance execution became zero-egress by default
  (release candidate):** Added immutable dry-run plans and cost/egress receipts
  for exact performance scopes. Admitted runs bind repository revision, dirty
  state, and target identity; execute one process at a time with no retries,
  external requests, services, or monetary cost, and fail closed when evidence is remote, paid,
  production-like, unknown-cost, or stale. Node-family work gets a runtime
  network guard; macOS also applies a child-process network sandbox with
  loopback support. Go is admitted only where CodeVetter can establish an OS
  zero-egress boundary. CLI/MCP dry-run, durable supervision, direct profiling,
  and optimization campaigns share the policy. The focused runtime suite passes
  150 tests, including hermetic loopback, blocked-remote, stale-identity, and
  zero-process blocked-receipt cases. No hosted endpoint, paid service,
  production configuration, or new dependency was used.
- **2026-08-15 — Continuation gate resolved conservatively:** Preserved the
  released local product, corpus, deterministic graders, runtime lab, and
  documentation while pausing broad surface expansion. Ten-user validation,
  team pilots, authenticated provider comparisons, and real Codex/Claude Agent
  Island qualification were not completed and remain unsupported product-value
  claims rather than silently passing by proxy.

- **2026-08-11 — Code-health coverage became executable:** Added CI-blocking
  unused-code, duplication-regression, runtime dependency-cycle, and production
  vulnerability gates. Removed six unused public type exports, confirmed zero
  runtime import cycles repository-wide, capped changed-file cognitive
  complexity at 20, ratcheted duplication at the measured 0.75% baseline, and
  reduced dependency-audit exposure from 17 high advisories to zero. Historical
  complexity and the remaining Astro 6 low/moderate advisories are explicitly
  tracked as dated follow-up instead of being suppressed.
- **2026-08-11 (shipped in v1.7.4) — Trustworthy Codex evidence ledger:** release
  qualification found that v1.7.3 still undercounted compact subagent rollouts
  and presented incomplete historical coverage too confidently. The candidate
  now separates verified, legacy-estimated, ambiguous, missing, and stale
  evidence; persists append-only lineage-aware observations; reports
  API-equivalent pricing as exact, bounded, or unpriced; and imports additional
  Codex homes without double counting stable session identities. A retained
  cursor-aligned comparison matches pinned CodexBar 0.46.0 exactly across all
  12 comparable sessions (1,257,163,311 input, 1,230,980,352 cached, 3,863,267
  output). A separately frozen 96-source backfill is exactly idempotent across
  two runs and records 3,147,488,441 verified input tokens while preserving
  1,260 unrecoverable historical rows as non-verified. CodexBar itself retained
  two incomplete large-file scans and two stale completed sizes after
  `--refresh`, so parity is cursor-aligned and CodeVetter exposes its own byte
  coverage. The candidate now snapshots the prior session/model/v1-observation
  projections exactly once; `CODEVETTER_CODEX_ACCOUNTING=legacy` restored all
  three retained-corpus aggregates exactly while preserving v2 evidence.
  Released after all local qualification and GitHub CI checks passed.

- **2026-08-10 (shipped in v1.7.3) — Deterministic Codex usage accounting:**
  replaced message-prorated and replay-prone Codex totals with timestamped,
  content-free usage observations; persisted cumulative counter state handles
  duplicate snapshots, fork inheritance, copied prefixes, resets, and
  interleaved lineages across incremental reads. Live usage ingestion is
  independently serialized from archive/FTS maintenance, and Usage exposes
  freshness and exclusion diagnostics. The revisioned historical repair is
  fail-closed: readable transcripts reconcile session/model totals from
  persisted accepted observations inside each transaction, while missing
  sources retain their prior totals with explicit unrepaired audits. Frozen
  qualification at release time reconciled 91 readable sessions twice to an
  identical 2,742,608,446 accepted tokens and preserved 1,260 missing sources;
  the 2026-08-11 audit above supersedes that confidence claim. Verified
  with 913 Rust tests, 665 frontend tests plus the 20-scenario live
  qualification, lint, typecheck, production build, docs, and strict OpenSpec.

- **2026-08-10 — Revision-bound optimization contribution closeout:** extended
  the local performance campaign with a mandatory post-promotion candidate
  challenge and three closed CLI/MCP operations. The new local receipt binds
  the kept campaign record, baseline, candidate commit, diff, optional T-Rex
  preview evidence, and one canonical GitHub PR while preserving correctness,
  performance, patch quality, head freshness, checks, review threads,
  approvals, and merge authority as independent fail-closed gates. Candidate
  source must be committed before promotion/challenge; stale heads, missing
  required T-Rex evidence, unobserved checks, actionable feedback, and
  symlink/path escapes cannot become ready. GitHub access is one fixed read-only
  GraphQL query with explicit refresh—no polling, app install, comment, review
  request, thread resolution, required check, merge, or deploy. Live read-only
  dogfood against Marked PR #4048 caught and fixed a classifier error: Vercel
  fork authorization is now `approval_required`, not a code failure; two older
  inline threads remain visible as outdated. Raw evidence stays local and
  upstream maintainers receive no additional workflow. Qualified candidate
  comparisons retain target plus available smaller-input/allocation controls,
  and the full Marked-shaped fixture proves reviewed-head invalidation,
  simpler-candidate selection, bounded feedback learning, and regeneration of
  a current receipt-backed publication projection.
- **2026-08-09 — Shared lint baseline:** Adopted the Fleet Ultracite baseline
  for core TypeScript, React, and test code. Explicit compatibility exceptions
  preserve current behavior while 662 files pass with zero diagnostics;
  generated, public, HTML, SVG, Astro, and benchmark artifact surfaces remain
  outside the checked surface.

- **2026-08-07 — Grok billing staleness fix + cache-tier pricing audit (largest
  cost-accuracy fix to date):** `check_live_usage_grok` re-served whatever
  billing snapshot Grok CLI last logged to `~/.grok/logs/unified.jsonl`
  (Grok only writes that line on-demand, e.g. `/usage`) with no staleness or
  expired-billing-period check, so a machine that hadn't opened Grok CLI in
  two weeks showed a permanently frozen "100% used / rate_limited" from an
  already-rolled-over cycle. Now detects an expired billing period or a
  log entry older than 2 days and downgrades status to `unknown` with a
  `stale`/`stale_reason` surfaced in the UI instead of asserting rate-limited
  off dead data. Separately, a provider-pricing audit against docs.x.ai and
  developers.openai.com found GPT-5.6 Terra/Luna had been derived by linearly
  scaling Sol's price instead of using OpenAI's real per-tier rates (Luna 5×
  overpriced, Terra 1.25×) and grok-4.5 cached input was $0.50 vs xAI's
  published $0.30 (pricing rev 11). The much larger finding: Claude Code's
  `usage.cache_creation` splits cache-write tokens by TTL
  (`ephemeral_1h_input_tokens` vs `ephemeral_5m_input_tokens`) — Anthropic
  bills 1-hour cache writes at 2x input price vs ~1.25x for the default
  5-minute tier, but every cache-write token was priced at the 5m rate
  regardless of tier. A live-corpus sample found ~78% of cache-creation
  tokens across Claude sessions are actually 1h-tier. Fix threads the split
  through `session_model_usage` (new `cache_creation_1h_tokens` column,
  model-usage backfill rev 2) and prices it separately (pricing rev 12); a
  dry run against a live-DB copy recomputed all-time Claude spend
  $46,986→$67,548 (+$20,561, +44%) from 551M recovered 1h-tokens. Sessions
  without a per-model breakdown keep the conservative all-5m fallback.
  Verified: 880 Rust tests (2 new), tsc, biome clean on touched files, and
  the migration applied cleanly against a copy of the live 5,820-row
  `session_model_usage` table.
- **2026-08-07 — Evidence-backed comparison coverage:** added source-complete
  CodeVetter comparisons for CodeRabbit and Greptile using the existing public
  editorial, sitemap, canonical, structured-data, and agent-readable Markdown
  surfaces. Each page cites primary sources and explicitly avoids unsupported
  head-to-head performance claims. Production remains unchanged pending the
  normal manual deployment path.
- **2026-08-05 — Coding-agent verification field guide:** added four public
  education routes that explain the task-to-evidence verification loop,
  practical AI-code verification, review versus verification, and portable
  evidence bundles. The existing benchmark now separates published results,
  implemented qualification infrastructure, and work that is not yet proven.
  Every route has canonical metadata, structured data, sitemap inclusion,
  contextual internal links, and a matching Markdown surface.
- **2026-07-31 — Thirty-task qualified agent corpus:** expanded the owned
  corpus to the strict 30-task minimum across browser state, authorization,
  API contracts, validation, concurrency, persistence, integration, and
  regression behavior in browser/API and Node/TypeScript lanes. Every task has
  two intended baseline failures, two regression-free known-good passes,
  immutable receipt linkage, and cleanup proof. One task accepts the same
  observable outcome at either of two implementation boundaries; another
  protects an agent-visible lookalike decoy from unnecessary edits. All five
  contract-readiness gates pass. The compact synthetic corpus still does not
  prove agent quality, product value, or statistical confidence.
- **2026-07-31 — Immutable receipt-to-evaluator composition:** added a closed
  local evaluation bundle that binds corpus, task revision, adapter, raw v2
  receipt, pair/order, and structural-context identities. A dependency-free
  composer now derives evaluator manifests from those artifacts, rejects
  incomplete or contaminated evidence before export, preserves the existing
  structural-context scorer as sole outcome/qualification authority, and emits
  a separate deterministic score stamped with scorer, bundle, corpus,
  ground-truth, projection, and receipt hashes. Synthetic tests prove
  byte-stable rescoring and raw-receipt immutability; no real provider, model,
  paid run, network, publish, deploy, or production path ran.
- **2026-07-31 — Provider-neutral agent-task runner foundation:** added
  deterministic non-executing plans with public-input size, conservative token
  and cost bounds, environment-name availability, exact task/adapter identity,
  and one-attempt approval. Approved adapters run without a shell in fresh
  public-input-only workspaces with immutable executable artifacts, minimal
  declared environment, bounded redacted output, process-group
  timeout/cancellation, terminal-before-check ordering, and v2 lifecycle
  receipts. Declared adapter diagnostics now load from a bounded closed
  workspace document after termination, preserve only available token, cost,
  tool-name, and file observations, and fail closed before hidden checks when
  a clean exit breaks that evidence contract. A repository-owned synthetic
  adapter passes the qualified sample; no real provider, model, paid run,
  network, deploy, or production path ran in this implementation slice.
- **2026-07-31 — Agent-task corpus qualification foundation:** added closed,
  versioned fixture, acceptance, exact known-good, check-result, qualification,
  adapter, and runner contracts plus deterministic dependency-free validation.
  Qualification now creates fresh public-input-only workspaces, applies exact
  known-good replacements without a shell, executes immutable timeout-bounded
  checks, preserves explicit failure/cleanup taxonomy, and emits v2 receipts.
  The owned one-task sample repeats its intended baseline failure and
  known-good success, so it reports one qualified task while strict readiness
  remains closed on count and breadth. No agent, model, network, scorer, or
  production path runs in this slice.
- **2026-07-31 — T-Rex MCP and CLI artifact qualification:** fixed the future
  agent-triggered verification boundary as a separate, explicitly enabled MCP
  process so the existing history MCP remains read-only. Pull-request CI now
  executes the prepared CLI's version/help/bundle contract, and the release
  workflow repeats that check against the final binary inside the macOS app.
  No verification MCP binary, live preview smoke, version bump, or release was
  performed.
- **2026-07-31 — Search-intent benchmark interpretation:** clarified the
  public benchmark title, summary, benchmark-design tradeoffs, score-reading
  guidance, and machine-readable page while preserving the published dataset,
  results, methodology, limitations, downloads, and reproduction commands.

- **2026-07-29 — Owned product changelog:** added a same-origin
  `/changelog` that turns verified shipped milestones into concise,
  user-visible outcomes. Public navigation now exposes the page, routes
  Roadmap to GitHub Issues, and keeps Source on the canonical repository; no
  desktop runtime, verification, data, or deployment behavior changed.
- **2026-07-27 — Structural-context outcome evaluator:** added a local,
  provider-neutral paired-receipt scorer to test whether CodeVetter's existing
  structural graph improves executable coding-agent outcomes. Exact A/B and
  A/A identity and graph-tool isolation fail closed; hidden acceptance checks
  and regressions remain authoritative; optional activity diagnostics never
  substitute for success. One normalized scorecard emits terminal, JSON,
  Markdown, and self-contained responsive HTML with qualification-first claims,
  task check deltas, graph decision traces, A/A noise, and limitations. The
  committed synthetic fixture proves the contract only and remains explicitly
  unqualified for real product value. Focused benchmark tests, touched-file
  Biome, docs, strict OpenSpec validation, responsive visual QA, and independent
  finish review pass. Real value still requires repeated receipts from the
  planned realistic TypeScript/Node task corpus.
- **2026-07-26 — Product direction lock:** pivoted active development from a
  broad AI code-review workbench to empirical verification infrastructure for
  coding agents. New work must strengthen executable outcome verification,
  evaluation quality, reproducibility, or measured reliability; shipped
  workbench features remain available but are not active investment areas.
- **2026-07-26 (shipped in v1.7.0) — Event-driven Agent Island presentation:** adapted the strongest public Vibe Island/Open Island notification lifecycle into CodeVetter's existing supervised helper without importing their independent discovery stack or moving provider authority out of Rust. New confirmed attention, failure, and completion event identities can present the island automatically without activating CodeVetter or stealing keyboard focus; user-opened expansion remains authoritative; actionable attention stays visible until resolution; informational presentation auto-collapses after a pointer-safe ten-second delay. The collapsed pill now shows up to three priority-ordered role/provider markers plus a bounded overflow count with complete non-colour accessibility context. Swift self-tests cover novelty, priority, preview suppression, manual ownership, resolution, focus policy, pointer-safe collapse, and rail ordering. The release preflight's 120-snapshot qualification passes 10 Rust tests and Swift self-tests at 79 ms p95, 0.04% measured idle CPU, 54.47 MiB RSS, zero rescans, zero false actions, crash fallback, and session continuity. The harness discards one post-burst `ps` warm-up observation after both the old and new helpers showed the first sample included render-tail activity. Agent Island remains off by default in v1.7.0.
- **2026-07-26 (shipped in v1.7.0) — Work agent-team recommendations and Agent Island augmentation:** Work now turns a bounded outcome into an explainable deterministic team of at most three Codex/Claude roles without a model, network call, or repository scan. One implementation agent may write; investigation and Product UX specialists are read-only; post-implementation Assurance remains visibly queued until a separate explicit launch. Multi-agent launch requires a known concrete repository, ignores duplicate confirmation, gives only the primary session Board attachment authority, preserves queued roles through local workspace restore, and uses a collapsible Needs attention / Active / Recent run navigator instead of permanent project nesting. Optional bounded role/team metadata survives both Codex transports and the Claude/PTy path into Agent Island. The native helper remains presentation-only but now uses a clean-room Vibe Island-informed compact black pill and dense team/session rows with dominant confirmed actions, calm completion, stable same-project team grouping, and exact jump-back. Local qualification passes four recommendation tests, TypeScript, Biome, all 18 Work Playwright journeys, 13 focused Rust tests, the Swift self-test, strict OpenSpec validation, and diff checks. No production dependency, database migration, or provider authority changed.
- **2026-07-25 (shipped in v1.6.0) — Verification workbench completion:** added
  dry-run-first local session retention, versioned outcome-risk calibration,
  crash-recoverable managed Work runs, explicit intent-closure receipts, an
  honest real-product QA support matrix, evidence-owned inert artifact
  previews, deterministic three-file public graph packages, a 20-case
  provenance-pinned public agent-PR corpus, and redacted local performance and
  cache receipts. These records link existing repository, session, work-item,
  review, QA, graph, and change identities without turning orchestration or
  correlations into proof. The dashboard gate measured 24.073 ms warm p95;
  cache accounting found no exact duplicate roots to move; the 120-snapshot
  Native Agent Island gate passed at 82 ms p95, 0.12% idle CPU, 53.75 MiB RSS,
  and zero false actions while remaining off by default. Full-repository
  archaeology preserved source identity but failed closed at the existing
  persisted-linker input bound, so the 18M-line/100,000-rule claim remains
  unsupported. Authenticated CodeVetter, CodeRabbit, and Claude `/review`
  captures are still externally blocked for the new corpus, so all new public
  comparator claims remain closed. Local qualification passed 881 Rust tests
  with 24 ignored, 654 frontend tests with one intentional skip, the
  20-scenario zero-model live gate, all 71 Playwright flows, TypeScript, Biome,
  production build and bundle budgets, docs, and all 35 strict OpenSpec
  validations. CI, Docs, auto-release, the release-only graph/MCP gate,
  universal Agent Island preparation and qualification, nested helper checks,
  updater signing, and manifest linkage all passed. The published release
  contains the arm64 DMG, signed updater archive, detached signature, and
  `latest.json`; the live updater endpoint passed all six linkage checks.
  Detailed evidence and boundaries are in
  `docs/architecture/verification-workbench.md`.

- **2026-07-24 (shipped in v1.5.4) — Deterministic Review, Agent PR X-Ray, and native Agent Island:** new broad reviews resolve a verified Git target, cover every changed file through bounded fingerprinted units, resume exact checkpoints, terminate owned executor process groups, and qualify repository-contained line and anchor evidence before any candidate reaches coordination, scoring, persistence, proof, or actionable UI. Review renders complete, partial, and legacy coverage; repository-scoped MCP exposes the same redacted paginated manifest; `CODEVETTER_REVIEW_PIPELINE=legacy` retains the aggregate executor as a one-release rollback path. Completed reviews can generate fail-closed JSON, Markdown, and self-contained offline HTML X-Rays with explicit staged omissions and opt-in suggestion excerpts. Codex now prefers its structured app-server for new sessions with PTY compatibility fallback; Claude hooks expose bounded lifecycle and session-scoped permission identities. The opt-in Swift Agent Island stays below the macOS notch, groups live sessions by project, announces bounded status through configured system voices, and permits only capability- and identity-checked replies or decisions; it is off by default and the existing Work/notification path remains the rollback. Local qualification passes strict Clippy, 845 Rust tests with 23 ignored, Biome, TypeScript, 648 frontend unit tests with one skipped, the 20-scenario warm gate, all 69 Playwright flows, desktop and landing production builds, docs, MCP integration, 29 strict OpenSpec validations, Swift self-tests, and native qualification at 97 ms p95, 0.18% idle CPU, 54.5 MiB RSS, and zero repository rescans. Release preflights fixed sidecar ordering, the helper deployment target, the MCP benchmark's 23-tool contract, architecture verification, and nested helper signing. The published v1.5.4 updater was downloaded and passed both universal-architecture checks, strict nested signature verification, extracted-helper self-tests, bundle presence, rollback checks, and all six live manifest-linkage checks. Public X-Ray dogfooding, gallery deployment, and external claims remain evidence-gated.
- **2026-07-22 (shipped in v1.5.4) — Calm Work start state and history preview:** Work now opens with no conversation selected even when saved or reattached live runs exist, leaving every thread visible while the main canvas clearly starts a new conversation. The sidebar labels its project-grouped collection accurately as Projects, exposes a stronger Start new conversation action, and uses distinct dependency-free local marks for Codex and Claude. Selecting a directory-verified Previous thread now opens its real normalized local conversation as a calm read-only preview without launching either CLI; only explicit Resume or Fork actions continue it. The bounded Rust read contract caps rows and message size and redacts secret-like content before it reaches React. Explicit live selection, attention routing, Board drafts, archive behavior, and process ownership remain unchanged. Qualification passed all 14 Work Playwright flows, TypeScript, Biome, production frontend build, 803 Rust tests with 23 ignored, docs, and strict OpenSpec validation. No schema, parser, network, release, or production dependency changed.
- **2026-07-22 — Orchestration cockpit plan retired:** archived the unimplemented `agent-orchestration-trace` change without syncing its graph, completion-inbox, multi-pane, or additive orchestration-schema requirements. Those 35 tasks conflicted with the shipped conversation-first Work direction and would have duplicated lifecycle, attention, transcript, and Board evidence behind a heavier cockpit. Future lineage or overlap work must start from a bounded user-facing evidence gap rather than revive the archived platform wholesale.
- **2026-07-21 (shipped in v1.4.0) — Conversation-first Work workspace and primary Board:** Work now provides provider-aware Codex/Claude model selection, lifecycle-derived thinking and attention without exposing hidden reasoning, Enter-to-send with multiline/IME safety, searchable and safely archivable conversations, and plain-language operational states. Confirmed questions focus the composer; permission requests open provider evidence and never submit approval implicitly. The left-anchored sidebar groups open and indexed conversations by normalized project identity, exposes expandable status summaries, and includes indexed history only after a bounded local check confirms its directory still exists; missing checkouts fail closed and live sessions supersede duplicates. The persistent Plan/Build/Review/Verify/Done board now has its own `/board` route while sharing one mounted runtime with Work, so live sessions survive navigation and handoffs retain repository context. Qualification passed TypeScript, Biome, 648 frontend unit tests with one skipped, the 20-scenario warm gate, 801 Rust tests with 23 ignored, all 63 Playwright flows, production frontend/bundle budgets, docs and 29 strict OpenSpec validations, two independent release reviews, a production macOS Tauri build opened against real local data, the release-only graph/MCP performance gate, signed bundle/sidecar checks, and live updater-manifest verification. The public v1.4.0 assets are a notarized arm64 DMG, signed updater archive, signature, and `latest.json`.
- **2026-07-20 (shipped in v1.3.0) — Five-pillar desktop and Work runtime:** consolidated the shell around Usage, Repo Unpack, Work, Review, and Testing with Settings as a labelled utility, one semantic ink/amber system, native macOS typography, accessible focus, and bounded motion. Work now provides a focused Codex/Claude conversation and evidence-aware Plan/Build/Review/Verify/Done board while keeping raw PTY execution behind the interface. Work items can attach authoritative live or indexed sessions without restarting a provider, persist across full app restarts, and connect to Review, Testing, and Repo evidence. Direct output is bounded, ANSI-sanitized, honestly separated from structured lifecycle evidence, and not persisted. Transcript indexing now hard-bounds oversized live rows; MCP scope reads use bounded SQLite busy retry. Native Codex response, intentional stop, and resume passed. Native Claude launch, input, and intentional stop passed; completion and resume were externally blocked by the installed default profile's organization policy. A linked Work item restored after a complete process restart and was deleted cleanly. Final release checks pass TypeScript, Biome, production build and bundle budget, 645 frontend tests (644 passed, one skipped), the 20-scenario zero-model warm gate, 827 Rust tests with 23 ignored, all 55 Playwright flows, docs validation, strict OpenSpec validation, and native accessibility/overflow qualification. No production dependency was added.
- **2026-07-18 (shipped in v1.2.21) — Local differential verification:** added exact immutable-reference vs worktree/staged/commit/range comparison through the repository-owned verifier, with source/dependency caches, two owned loopback servers, one pinned Chromium, fresh paired contexts, normalized visual/text/route/network/runtime/mutation/accessibility/performance evidence, four-way classification, additive SQLite summaries, explicit T-Rex preparation/parity/cache/cleanup state, and comparison-only Review history that cannot create pass evidence. The Apple M5 Pro production pair completed in **1.197 s** and the recorded pair profile measured **1.119 s p95**. A separate **100-pair** gate (80 pass, 10 intentional regression, 10 cancellation) preserved source fingerprints, left zero contexts/orphans, measured 165.51 CPU-seconds, peaked at 1.86 GB owned process-tree RSS under the 2 GiB cap, retained zero RSS growth after cleanup under the 128 MiB stability cap, returned from 14 peak processes to 4, retained 94,208 allocated cache bytes, and retained zero artifact bytes.
- **2026-07-18 (shipped in v1.2.21) — Evidence-traced business-rule archaeology:** implemented resumable local COBOL/Assembly-oriented inventory, exact source spans and clause evidence, deterministic zero-model rule materialization, contradiction/deduplication/retrieval/temporal/review lifecycle, bounded graph/MCP exposure, and cleanup. The largest available checked fixture passed at **256 files, 2,560 lines, 2,048 facts, and 512 rules**; 20-sample changed-unit performance measured **1,875.762 ms p95**, storage delta was **8,208,384 bytes** under the 8 MiB gate, peak RSS was 397,639,680 bytes, and there were no model calls, cache dependence, child leaks, or policy failures. This does **not** qualify an 18M-line/100,000-rule claim; that remains gated on running that exact corpus.
- **2026-07-18 (shipped in v1.2.21) — Local scenario compilation:** T-Rex and the repository CLI can compile bounded spec/context packets into private deterministic scenario/config/provenance candidates, validate and dry-run without creating evidence or baselines, and atomically accept only reviewed destinations. The checked fixture benchmark compiled 10 candidates with one provider response and nine cache hits in milliseconds. Human authoring-time/quality, live-model, browser dry-run, and paid-provider comparisons remain explicitly unclaimed until separately recorded.
- **2026-07-18 (shipped in v1.2.21) — Local history MCP:** packaged a dedicated read-only Rust stdio sidecar with thirteen strict graph/history tools, versioned resources, opaque repository scopes, live revocation, protected-path and secret filtering, bounded responses/pagination/traversal, redacted errors, and metadata-only audit history. The deterministic fixture contains 65 commits, 64 releases, 10,000 history events, 512 nodes, and 1,024 edges. On the Apple M5 Pro, initialization measured **7.17 ms p95**, graph query **5.82 ms p95**, broad history search **6.45 ms p95**, and four-request mixed concurrency **12.87 ms p95**; the 7.39 MiB sidecar opened no network listener, stayed within the 32 MiB RSS gate, and left the protected repository unchanged. The v1.2.21 release workflow re-qualified the sidecar inside the macOS app and updater artifacts.
- **2026-07-18 (shipped in v1.2.21) — Warm local verification:** implemented a repository-owned Node/Playwright daemon with exact Git change modes, authoritative capability selection plus safe smoke/fallback, fresh isolated contexts over one warm server/browser, target-owned React/MSW state, zero-model deterministic execution, strict automatic observation, cancellation/source invalidation, exact visual baselines, immutable additive `warm_verification_runs` persistence, and owner-aware redacted retention. The Tauri bridge now finds one repository-owned verifier, selects its package manager from the repository lockfile, starts/stops the daemon, runs/cancels changed verification, reports health, persists results, and performs bounded cleanup. T-Rex owns those controls and shows current evidence; Review is a read-only consumer that qualifies only the newest exact-current run. On the Apple M5 Pro, the mandatory 20-scenario gate measured **3605.560 ms p50, 4792.196 ms p95, and 5320.379 ms max**; the small changed-capability path measured **506.426 ms p50, 512.035 ms p95, and 515.900 ms max**. A separate 100-batch gate completed 80 passes, 10 intentional regressions, and 10 cancellations with no leaked contexts, stable browser/server reuse, RSS growth of 13.6 MB against a 128 MB cap, retention at 20 runs / 4470 bytes, and zero production builds. Scope remains one developer, one configured React app, one Mac, and one Chromium—not CI, cloud, teams, mobile, cross-browser, or arbitrary repositories.
- **2026-07-13 — Trusted graph paths shipped:** Repo Unpacked graph snapshots now emit schema v2 with categorical trust, origin, evidence, and source anchors while schema-v1 snapshots load conservatively as legacy without disk rewrites. The Repo graph surface explicitly imports bounded local `nodes` plus `links`/`edges` JSON into a transient preview, preserves supported confidence/source/community metadata, resolves endpoint ambiguity, and traces trust-weighted bounded paths with stored direction and hop evidence. Review derives at most four native paths from changed files to routes, Tauri commands, tables, scripts, or tests and carries the same qualified summaries into prompts, UI, and reviewer-proof Markdown; uncertain/imported/legacy hops are navigation leads and cannot independently create findings or verified claims. Verification: 286 Rust tests (273 passed, 13 ignored), 140 desktop unit tests, TypeScript typecheck, Biome lint, Vite production build, and command-boundary fixture smoke for explicit generic graph import plus native/imported path tracing.
- **2026-07-16 — Agent PR X-Ray OpenSpec drafted:** planned a local export from completed reviews into sanitized, deterministic JSON/Markdown/static HTML verification packets. The first public surface is a reviewed static gallery backed by fleet dogfood and 20–30 adjudicated public cases; hosted PR analysis, repository uploads, implementation, and release remain out of scope for the draft.
- **2026-07-11 — Desloppification sweep:** one package manager (pnpm) across all CI workflows — root package-lock.json and the nested desktop pnpm-lock deleted (the dual-lockfile drift is what broke CF Pages in May); dead surfaces removed (design.html scratch, LiveAgentRunner/SaasMakerTasksPanel orphaned by earlier page removals, the tauri-driver native-e2e path that never actually supported macOS); six unused npm deps dropped incl. @tauri-apps/plugin-sql (docs claimed it was the DB layer — Rust has used rusqlite all along); 34 caller-less Tauri commands reaped along with three fully dead Rust modules (session_intelligence, talks, github_ops), ~45 unused TS ipc wrappers, and 98 unused exported types. Net ≈−3,600 lines. Kept deliberately: shadcn/ui boilerplate exports, the feature-gated browser-agent module, weekly.yml's lockfile-agnostic fallback, and get_dora_metrics (Rust-internal caller). All suites green (264 Rust, 136 unit, tsc, biome, vite build).
- **2026-07-11 — Coordinator dedup fix flips the head-to-head:** replaced exact `file:line:title` dedup with same-file near-line token-similarity clustering (calibrated on real duplicate pairs from the first benchmark run, 3 regression tests). Full 27-case re-run: findings 95→65, catch stays 1.000 (29/29), precision 0.299→0.433, F1 0.460→0.604 — CodeVetter now beats raw Claude on all three axes (0.931/0.397/0.557). The two-gate "measurably better than raw Claude" question now has a first affirmative, internal-only answer; real agent-PR case curation still pending before external claims.
- **2026-07-11 — CodeVetter comparator slot filled; first head-to-head vs raw Claude:** all 27 public benchmark cases ran through the real production review pipeline headlessly (new `run_cli_review_core` + ignored generation harness). Result: catch rate 1.000 (29/29, including both defects raw Claude missed) vs 0.931; precision 0.299 vs 0.397 (F1 0.460 vs 0.557). Precision loss decomposed: 41/95 findings are redundant restatements of already-caught defects — the coordinator dedup does not collapse same-defect findings on small diffs (actionable product gap; collapsing them alone would put precision at 0.537 / F1 ≈ 0.70, ahead of the baseline) — plus ~20 process/verification findings that are intentional for agent-PR review but score as false positives against defect-only ground truth. Protocol + full table in docs/BENCHMARK.md.
- **2026-07-11 — Deferred branches landed + spec debt cleared + learning roadmap:** the Jul-3 Rubrics completion (pack linkage, prompt preview, per-pack usage stats, cloning) and AgentMemories finishes (copy-as-markdown, regex line filter, git-diff-vs-HEAD viewer) had been recorded as shipped but their branches never merged — both are now actually on main, with the review's findings fixed in-merge (kept the Rubrics `embedded` prop, usage attribution keyed by unique pack id with NULL instead of a fabricated default, landing keychain claim corrected). `add-agent-panel` OpenSpec change archived. `docs/learning/` now has a roadmap (README) + three pages covering every subsystem (platform/stack, telemetry+indexing, verification+judgment) with a coverage map. Shipped in v1.2.19 (explicit user approval; the review pipeline was runtime-verified by 27 end-to-end benchmark executions, UI merges by compile/lint/test).
- **2026-07-11 (shipped in v1.2.17) — Telemetry accuracy audit + Claude usage dedup fix:** released on explicit user approval with dry-run-on-DB-copy verification (the installed app was in use, so the usual sole-instance dev-app run was waived for this release). Audit found the indexer summed the usage object of EVERY Claude JSONL line, but Claude Code writes one line per content block, each repeating the same final usage — 50%+ of usage lines are byte-identical repeats, inflating ALL Claude token/cost numbers ~2.2× (measured 103–134% per month). Fix: adapter dedups usage by (message.id, requestId) with the last key persisted per session (`cc_sessions.last_usage_key`) so duplicate groups split across incremental tail reads (blocks flush up to ~40s apart) stay deduped; one-time backfill re-scans on-disk transcripts and rewrites totals/model-usage/cost/cursor. Dry-run on a DB copy: Claude all-time $62,652→$37,763, output tokens 304M→163M, single sessions verified byte-exact vs an independent recompute; ~1,000 sessions with rotated-away files keep old (inflated) values — unfixable without source data. Also pricing rev 10: GPT-5.6 tiers (Sol $5/$30, Terra $2.50/$15, Luna $1/$6, cached 90% off) — 5.6-sol had fallen to the GPT-5 family fallback at ~1/4 its real price. Codex cumulative handling, day-bucket local-timezone bucketing, and cross-file (sidechain) duplication were audited clean.
- **2026-07-11 (shipped in v1.2.16) — Project taste verdict:** per-project judgment card on the Repo surface answering "is this project's quality good, on what evidence" — deterministic synthesis of scored reviews (avg + trend), open high/critical findings, synthetic QA pass rate, human-validated audience runs, and Unpack recency, with confidence keyed to evidence coverage and explicit gaps. Runtime-verified in the dev app (codevetter showed decent · 63/100 · low confidence with correct arithmetic and gap lines). Day-0 thresholds are marked as guesses in `commands/taste.rs`.
- **2026-07-10 (shipped in v1.2.15) — ShipRank capability consolidation:** released after runtime verification in the dev app (real review opened, audience run created, agent/human/imported responses recorded to 3/3 with human-validation fulfilled, staged-verification block confirmed in copied reviewer proof). Added a staged verification loop inside Review that connects code review, executable/synthetic QA, and audience validation. Local SQLite now stores privacy-minimizing audience runs and agent/human/imported responses; deterministic diagnostics surface majority strength, agreement, order sensitivity, cycles, provenance, and conservative confidence. ShipRank's reusable evaluation architecture is now owned here without importing its SaaS, D1, Pages, R2, or capture-worker stack.
- **2026-07-07 (v1.2.12) — Repo workspace cleanup + Unpack usefulness pass:** merged the old Intel surface into Repo/Unpack as Activity, removed standalone Roadmap/resources from top-level navigation, cleaned the project sidebar, and made Unpack emphasize deterministic recommended next actions, graph-first repo memory, collapsible supporting evidence, past snapshots, and optional AI analysis on the same local snapshot. Supersedes v1.2.11 with CI type-check fixes.
- **2026-07-04 (v1.2.9) — Released:** v1.2.9 cut after runtime verification in the dev app against the live DB (all migrations observed in logs: day-bucket repair ×14 sessions, codex relabel 480/500, pricing rev 7 recompute; DB spot-checks + panel screenshots). Assets: aarch64 DMG + signed updater archive + latest.json.
- **2026-07-13 — Local intelligence spine complete:** formalized the existing 10-second session tail as a versioned local evidence contract, reconstructed bounded non-command conversation around command anchors, and upgraded Repo Unpacked history briefs to a schema-v2 queryable local graph with cited one-hop relationships.
- **2026-07-04 (shipped in v1.2.9) — Codex model attribution fix + by-agent windows:** every OpenAI Codex session was labelled "o3" — newer Codex CLIs dropped `model` from session_meta (only `model_provider` remains) and the adapter's fallback hardcoded o3, while the real model (gpt-5.5) is recorded on per-turn `turn_context` rows. Adapter now reads turn_context (last turn wins, legacy o3 fallback kept); a one-time preference-gated backfill re-derives the model for already-indexed codex sessions from their transcripts (486/500 files still on disk). Pricing rev 6/7 adds GPT-5.5 $5/$30 (cached $0.50/M, verified across OpenRouter/devtk/morph Jun-2026 tables), GPT-5 mini class $0.25/$2, and GPT-5 family fallback $1.25/$10 — codex spend was underpriced at o3 rates ($4,667→$5,572 after relabel+reprice; final split: 376× gpt-5.5, 92× gpt-5.4-mini, 17× gpt-5.4, 14× o3 fallback for rotated files). The backfill reprices each session in place so it doesn't depend on the recompute gate. Also: the by-agent spend bar gains the same 1w/30d/90d/all-time toggle (windowed client-side from the per-day drill-down; cursor ledger override applies only to all-time since the ledger is a whole billing cycle), via a shared RangeToggle.
- **2026-07-04 (shipped in v1.2.9) — Spend-by-model time windows + pricing audit fixes:** By-model panel on Home gains a 1w/30d/90d/all-time toggle (`get_usage_by_model(days)`, session activity prorated per day via `cc_session_days` — same attribution as the daily chart). Audit fixes (pricing rev 5): `<synthetic>` now prices to $0 (was sonnet default, ~$10 overstated) and keeps its own bucket instead of folding into "unknown"; Opus 4.1/4.0/Claude-3-Opus restored to $15/$75 (the all-opus match priced everything at $5/$25 — latent, no such sessions in current DB); Grok CLI fast models (grok-code/build/composer) priced at grok-code-fast $0.20/$1.50 instead of grok-4 (~15× overstated on ~$128); by-agent week window now converts local Monday midnight to UTC (was starting 5.5h early in IST). Follow-up same day: the May-2026 `cc_session_days.msg_count` inflation (pre-v1.1.98 re-parse bug, 14 sessions with day sums up to 41,000× their message count, 120.8M phantom messages; source JSONL rotated away so true per-day counts unrecoverable) is repaired by an idempotent startup migration that rescales each corrupt session's day rows to sum to its `message_count` preserving day proportions — dry-run on a DB copy: May 121.0M→234k msgs, zero sessions still tripping the 2× guard. The 5 boundary-spanning sessions turned out clean (day sums match message counts), so window math near the boundary was never affected. Also fixed the remaining local-date-with-`Z`-suffix window comparisons (`accounts.rs` week/today/4-week, `intel.rs` tool-breakdown cutoff, `observability.rs` window) via a shared `timeutil::local_day_start_utc` helper — all dashboard windows now use local-calendar boundaries converted to UTC instants.
- **2026-07-04 (v1.2.8) — Released:** v1.2.8 cut after local runtime verification (backfill 2,817/3,815 sessions, corrected By-model panel confirmed in the running app, idempotent second boot).
- **2026-07-04 (shipped in v1.2.8) — Per-finding usefulness tracking:** accept/dismiss disposition on review findings (`local_review_findings.disposition`), per-review counts in the findings panel, dismissed findings excluded from bulk fix selection, and an all-time/30-day acceptance-rate strip on Home — the direct signal for whether review findings are worth acting on.
- **2026-07-03 — Surface consolidation + finishes (multi-agent pass):** removed redundant standalone pages QaReplay (`/qa-replay`) and IntentDebugger (`/intent-debugger`) — their functionality lives in Review. Finished Rubrics (review↔pack linkage via `local_reviews.standards_pack`, exact prompt preview, per-pack usage stats, pack cloning), T-Rex (per-watcher error recovery + retry, run drill-down dialog with persisted findings/log excerpt, pre-flight gh/token validation, per-PR base-branch inference), and AgentMemories (copy-as-markdown export, substring//regex/ line filter, git-diff-vs-HEAD view with secret redaction). Refactored QuickReview.tsx 6,264→3,050 lines into 12 components + 4 lib modules (behavior-preserving, 15 commits). Raw-Claude baseline scored on the 27 public benchmark cases (catch 0.931 / precision 0.397 / F1 0.557); CodeVetter's own comparator slot still needs generation before head-to-head claims.
- **2026-07-03 (shipped in v1.2.8) — By-model cost attribution fix:** session-level `model_used` is last-model-wins, so multi-model Claude sessions booked ALL tokens/cost to the final model (a 211MB session with 17k opus-4-7 messages + 1.6k fable-5 messages billed $3.6k entirely to fable). Fix: per-message `session_model_usage` table populated by the indexer + one-time streaming backfill over existing Claude JSONL; by-model panel and per-session costs now sum per-model parts. Also added Fable/Mythos 5 pricing ($10/$50; was falling to sonnet default), folded `<synthetic>` into "unknown", and removed the Top-projects cost panel from Home (with its query/command/IPC). Verified by replaying the fix over the live DB: opus-4-7 $21,986→$29,473 (was under-credited), fable-5 correctly repriced. Guarded by `multi_model_claude_session_splits_usage_per_model`.
- **2026-07-03:** Removed legacy Next.js landing page (`apps/landing-page`) — fully superseded by Astro site; `next-env.d.ts` git-removed, stale doc references cleaned up.
- **2026-07-03:** Published 27 hand-labeled public benchmark cases (`benchmarks/public-catch-rate/cases/`) covering 7 languages (TypeScript, Python, Go, Rust, JavaScript, Java) and 15+ vulnerability types (SQL injection, XSS, hardcoded secrets, race conditions, path traversal, SSRF, prototype pollution, regex DoS, zip bombs, etc.). Scorer script (`scripts/run-public-benchmark.mjs`) validates labels and computes catch-rate/precision/F1 per reviewer. `pnpm bench:public`. Enterprise claims now backed by external, repeatable proof.
- **2026-07-02/03:** Streamlined telemetry + fleet navigation, guarded manual deploy command in CI, polished repo intelligence evidence surfaces.
- **2026-06-28:** Devin agent indexing, agent hide/show filter, Grok parser improvements; PROJECT_STATUS audited as source of truth.
- **2026-06-21 (v1.1.99) — Codex cost over-count fix:** Codex reports session-CUMULATIVE token totals; the incremental indexer was ADDING that running total every pass, inflating one session to 61.5B tokens / $35k (true: 391M / ~$220) and making "today" read ~$12.9k. Fix: `tokens_absolute` flag so cumulative tokens are SET not added, plus a one-time `fix_codex_token_totals` repair re-reading each Codex file. Verified on a live-DB copy: today $12,896→$377, year $82k→$38k (Claude cache-read costs, which are real, dominate the remainder). Guarded by `eval_append_delta_sets_cumulative_tokens_but_adds_per_message`.
- **2026-06-21 (v1.1.98) — Indexer CPU fix:** killed the sustained ~95%-of-a-core background indexer burn. Root cause (found by profiling + replaying the indexer over a live-DB copy): subagent sidechain transcripts shared the parent's `sessionId`, collapsing onto one DB row so each was re-parsed + archive-replaced every pass; the skip also compared drift-prone nanosecond mtime strings. Fix: skip on exact byte-offset==file-size, key sidechains by unique per-file id, migrate the offset backlog, and repair the FTS sync's UUID handling. Verified: steady-state index pass 87s→1.9s. Guarded by new evals in `history.rs`/`queries.rs`.
- **2026-06-20 — Rust/Tauri backend cleanup:** feature-gated `chromiumoxide` for optional live-browser agent work; pruned dead crates/deps; parallelized review paths for slimmer default builds when browser automation is off.
- **2026-06-13:** AI Session Intelligence archive push — normalized session message archive, FTS archive search, archive backfill, timeline claim checks, scope-drift flags, transcript replay packets, usage-first Home launch.

## Products

- **CodeVetter desktop app** (`apps/desktop`) — Tauri 2 + React 19 + Vite, macOS build distributed via GitHub Releases with auto-updater. The core product; runs offline with local SQLite, no server.
- **Landing page** (`apps/landing-page-astro`) — Astro static export deployed to Cloudflare Pages at codevetter.com via `deploy-landing.yml`.
- **Benchmark harness** (`benchmarks/agent-prs`) — local catch-rate benchmark tooling (`pnpm bench:catch-rate` etc.), not a deploy surface.

## Features (shipped)

### Foundation

- Shared Ultracite lint baseline with a clean 662-file check.
- CI-blocking code-health gates for unused exports/dependencies, changed-file
  cognitive complexity, runtime import cycles, clone regression, and
  high/critical production advisories, with generated and fixture boundaries
  explicit and historical debt tracked in GitHub Issues.
- Local-first desktop binary: Tauri 2 + React 19, macOS, offline, SQLite, no server.
- Five-surface nav: Usage, Repo Unpack, Review, Testing, Performance. Repo contains Unpack, Activity, Graph, Inventory, Analysis, Handoff, and past snapshots; Settings is an integrated utility hosting Ops, Memories, Rubrics, Agent MCP, and preferences. Retired Work/Board routes redirect to Usage while their local records and backend lifecycle code remain available for separately reviewed cleanup.
- Testing and Performance now share a local deterministic scope planner for a human-described function/flow, an exact PR or Git change, or a bounded whole-codebase portfolio. Every plan exposes its revision, dirty state, concrete adapters/targets, uncovered paths, and limitations and requires confirmation before execution; human text is discovery input and is never run as a command.
- Risk-tiered CLI review: trivial single-pass → lite product/agent passes → full sensitive path with security, product, agent specialist passes, coordinator, and dedup metadata.

### Retained local work history
- The former Work and Board UI is no longer mounted or navigable. Existing local session/work-item records and backend lifecycle code are retained to avoid destructive migration and to support separately reviewed cleanup.

### Code review and bug finding
- AI code review from diff or PR branch with multi-LLM provider support (Anthropic, OpenAI, OpenRouter).
- File-level and hunk-level fix diffs with revert; fix attempts run in isolated git worktrees.
- Structured agent fix packets (goal, acceptance criteria, non-goals, browser/QA evidence refs, usage-routing advice) generated from selected findings.
- Staged review → executable test → audience-validation summary with one evidence-linked aggregate outcome and explicit stage waivers.
- Audience validation embedded in Review: define target audience/task/candidates/criteria/threshold, record agent-simulated, human, or imported evidence, and preserve provenance in copied verification proof.
- ShipRank-derived deterministic diagnostics for comparable judgments: majority strength, agreement, low-confidence counts, order inconsistency, preference cycles, and conservative confidence capping when executable evidence fails.
- Project taste verdict on the Repo surface: deterministic per-project judgment (strong/decent/shaky/unknown grade, 0–100 score, evidence-coverage confidence) synthesized from review history, finding dispositions, synthetic QA, audience validation, and Unpack recency — with explicit gap lines for missing evidence kinds. Spec: `openspec/specs/taste-verdict/`.

### Synthetic user QA
- Three runner modes: built-in Playwright, repo-local Playwright specs, or external skill command returning the evidence JSON contract.
- QA runs persisted as first-class SQLite records; run history fed as compact `qa_evidence` into review prompts.
- Successful fix runs auto-rerun the pre-fix QA flow; post-fix comparison classifies as fixed / still-broken / regressed / still-passing with artifact anchors.
- Repo Unpacked computes deterministic Synthetic QA readiness from runner config, browser specs, app/QA scripts, and artifact signals.

### Intent debugging and history context
- Commit-intent reporting and synthetic-QA fixture replay live inside Review (the standalone `/intent-debugger` and `/qa-replay` pages were removed 2026-07-03 as redundant).
- Prior-intent mining from recent commits, agent talks, Claude/Codex session replay, `WHY:` / `DECISION:` / `TRADEOFF:` markers, and decision-shaped git subjects.
- Command/test snippets from agent transcripts carry `passed` / `failed` / `stale` / `unknown` status with source/event anchors, injected into review prompts.
- Codebase History Explainer: file-level "why this code exists" explanations built from commits, decision markers, recurring findings, and command anchors; shown in Review sidebar and proof export.

### Repo Unpacked and Intel
- Repo Unpacked: deterministic `repo_health` (hotspots, defect/maintainability/performance findings, refactor leads), `repo_graph` (routes, Tauri commands, DB tables, tests, decision markers), `history_brief` (commit subjects, decision markers, verification hints), and `qa_readiness` artifacts; all persisted to SQLite and exported as Markdown/agent-context sidecars.
- Unpack overview starts with deterministic recommended next actions: first file to open, best local verification command, risky file, graph lead, co-change lead, and optional focused AI question.
- Run-to-run diff panel: score/graph/file/stack deltas, commit-range evidence, inferred verification commands, QA posture, and outcome calibration from actual review/QA/procedure records.
- Activity: repo-local AI share, weekly throughput, batch size, churn hotspot, DORA strip (deploy frequency, lead time, MTTR, change failure rate); top-level numbers are clickable → zoom dialog with formula, evidence rows, confidence grade, and copyable metric packet.
- Activity blind-spot warnings for bulk changes, generated/vendor churn, release/dependency noise, and weak AI markers threaded into metric caveats.
- Playwright tests for zoom/copy interactions (metric drilldown, DORA/health, comparison evidence, outcome trends, trust actions, copy state).

### Benchmarks
- Public verification field guide: four canonical evidence-first education
  pages connect the product method to the published benchmark, with matching
  Markdown alternates and explicit claim limits.
- Catch-rate benchmark harness (`benchmarks/agent-prs`): per-case or combined fixtures, `bench:new-case` starter, `bench:curation` readiness report, strict fixture validation, named CodeVetter / CodeRabbit free-tier / Claude Code comparator slots, false-positive and redundant-match counts, precision/F1, baseline deltas, severity-specific gates, JSON/Markdown report output.
- Agent-task corpus (`benchmarks/agent-tasks`): 30 compact synthetic tasks
  qualified across eight failure categories, both browser/API lanes, and both
  Node/TypeScript runtimes. Closed versioned contracts, two-level SHA-256 task
  identity, repeated baseline/known-good qualification, deterministic dry-run
  planning, explicitly approved disposable adapter execution, immutable v2
  receipts, and deterministic receipt-to-score composition all fail closed.
  The corpus passes its contract-readiness publication gates; it does not by
  itself establish agent quality, provider superiority, or product value.
- `--evidence-comparison=with:without` mode compares stored outputs with and without deterministic evidence search.
- 27 hand-labeled public benchmark cases (`benchmarks/public-catch-rate/cases/`) covering 7 languages and 15+ vulnerability types; `pnpm bench:public` scores catch-rate/precision/F1.

### Evidence Pattern Search
- Deterministic risk candidate packets from changed files, sensitive paths, optional `ast-grep` structural matches, blast/history context, and verification signals; top candidates and procedure gates injected into review prompts.
- Verification commands suggested by prior pass/fail recency, repo scripts, file affinity, and artifacts; run locally with cancelable timeout-bounded stdout/stderr artifacts.
- Candidate outcomes, procedure events, and blocked-on reasons included in copied reviewer proof.

### Review Memory Graph
- Schema-v2 `repo_graph` artifact with package scripts, routes, Tauri commands, DB tables, tests, decision markers, categorical edge trust/origin, evidence, and source anchors — exported as graph JSON + agent-context Markdown sidecars; schema-v1 snapshots remain readable as legacy without rewrite.
- Generic node-link JSON is importable through an explicit bounded local file action; supported confidence/source/community metadata is preserved in a non-mutating preview, with actionable malformed/oversized/dangling-endpoint errors.
- Deterministic endpoint resolution and trust-weighted bounded connectivity paths expose ambiguity, stored direction, hop evidence, anchors, trust summaries, and traversal caps. Native changed-file paths feed Review prompts, graph UI, and proof export only as qualified context; uncertain paths remain navigation leads and never create findings or verified claims.
- Findings copyable as Hunk-style agent-context notes with file/line, evidence status, local history, focused graph, and next verification actions.

### Agent Verification Timeline
- Shared task/review/QA/evidence/claim-check/fix/worktree timeline contract; rendered in Review sidebar with jump targets to findings, files, QA artifacts, fix worktrees, command sources, and edited files.
- Claim-check rows for failed/stale command claims, agent claims contradicted by evidence, scope drift, repeated edits without evidence progress, and clean loops with proof counts.
- Same-flow post-fix QA deltas with before/after artifact anchors; segment-scoped fix packets copyable from any timeline row.
- Archive-backed non-command conversation windows retain chronological source anchors and appear as explicitly qualified intent context in timeline expansion, fix packets, and reviewer proof.

### AI Session Intelligence
- Indexed sessions produce a six-dimension schema-versioned scorecard with cited evidence refs, anti-gaming notes, and per-adapter coverage summaries (Claude / Codex / Cursor).
- `session_message_archive`: normalized adapter messages and tool calls, FTS-backed local search, backfill for older sessions, startup/periodic/manual update events.
- Home and Settings expose session scorecards, source health, per-adapter run trends, and recent-run drilldowns.
- Home exposes the versioned live-tail cadence/adapters/recovery policy; complete, partial, and lock-skipped appends have exact-once recovery coverage.

### Queryable codebase history
- Repo Unpacked persists a backward-compatible schema-v2 history graph connecting bounded commit files, decisions, verification hints, and co-change leads with citations and trust labels.
- Local queries prefer exact file/ID/label matches, rank broader terms, expand one hop, and state confidence, no-match, and truncation explicitly without mutating snapshots or creating findings.
- Settings can expose one explicitly enabled indexed repository through the packaged read-only `codevetter-mcp` stdio sidecar. Twenty-six strict tools cover capability and evidence-scope discovery, task-level review preparation, graph queries, releases, search, as-of state, lineage, explanations, causal traces, comparisons, review manifests, business-rule archaeology, and evidence hydration; opaque versioned resources provide paginated discovery without absolute paths or credentials.

### App shell and UX
- Home opens to usage dashboard (Today / Week / Month / Year counters); Repo holds repository context and Activity; Settings holds operational tools and preferences.
- Optional `ast-grep` evidence behind PATH detection — no required runtime dependency.

### OSS integration posture
- OSS repo-analysis engines evaluated in `docs/oss-integration-evaluation.md`; `ast-grep` structural evidence implemented behind PATH detection with no required runtime dependency.

### Automation readiness
- Privacy-safe product, release, reliability, and Foundry evidence contracts documented in `docs/operations/automation-contract.md` (surface inventory, funnel, N/A decisions, release + canary + Foundry contracts, baseline evidence).
- The prepared and final bundled T-Rex CLI artifacts are executable
  qualification targets for exact version/help and Tauri bundle contracts; a
  future verification MCP has a separate fixed-scope authorization design and
  is not exposed by the read-only history sidecar.
- `scripts/verify-release-manifest.mjs` validates the live `latest.json` updater manifest references a resolvable asset with a present signature, without publishing a release; wired as a post-upload step in `release.yml`.
- `scripts/emit-foundry-receipt.mjs` emits a closed-schema sanitized aggregate Foundry receipt (project slug, git revision, desktop version, CI/canary/release/landing/manifest status); `scripts/emit-foundry-receipt.test.mjs` proves sensitive payloads (code, repo, prompt, finding, path, key, email) cannot enter the receipt.
- `weekly.yml` now records source revision and emits a `canary-evidence.json` artifact (90-day retention) with bounds, timeout, declared cron, freshness window, and conclusion; job summary table exposes the same.
- CI runs `pnpm run test:automation` (hermetic receipt sanitize tests) on every push and PR.

## Work queue

Open work is tracked only in [GitHub Issues](https://github.com/Codevetter/codevetter/issues).
An open issue is a to-do, a linked pull request is in progress, and merge plus
issue closure makes the work done.
