## 1. Baseline and durable contracts

- [x] 1.1 Reconcile `PROJECT_STATUS.md`, `STATUS.md`, `README.md`, and current docs so release state and retired SaaS Maker task authority agree with `agents.md`.
- [x] 1.2 Map each new record to existing repository, session, work item, review, QA, graph, and evidence identifiers and document stale-identity behavior.
- [x] 1.3 Add additive SQLite migrations for calibration observations/models, retention plans/runs, managed runs/checkpoints, intent closure, and performance receipts.
- [x] 1.4 Add focused migration and legacy-database tests proving existing records remain readable and no destructive rewrite occurs.

## 2. Local session retention

- [x] 2.1 Implement archive and FTS size/age measurement plus protected-reference discovery for pinned, Work/Board, review, QA, X-Ray, intent, and history evidence.
- [x] 2.2 Implement deterministic dry-run retention plans with stable identity, removable/protected sets, reasons, rows, and projected bytes.
- [x] 2.3 Implement stale-plan rejection and transactional archive/FTS cleanup without touching provider-owned source transcripts.
- [x] 2.4 Implement explicit checkpoint/compaction controls and append-only cleanup receipts.
- [x] 2.5 Add backend tests for protection, plan drift, FTS parity, rollback on failure, and bounded large-history cleanup.

## 3. Outcome-risk calibration

- [x] 3.1 Define versioned Repo Unpacked and Activity feature deltas plus exact downstream review, QA, procedure, and bug outcome joins.
- [x] 3.2 Implement deterministic sample/support/confidence calculation, compatibility exclusions, and `insufficient`/`descriptive`/`qualified` states.
- [x] 3.3 Persist calibration observations and versioned summaries with contributing evidence identities and rerun commands.
- [x] 3.4 Add Repo Unpacked projections that separate canonical metrics, observed outcomes, calibration guidance, uncertainty, and bounded next actions.
- [x] 3.5 Add fixtures and tests proving sparse, incompatible, mixed, improving, and failure-correlated cases cannot fabricate findings or verification.

## 4. Managed work harness and intent closure

- [x] 4.1 Implement provider-profile discovery projection for Work without reading or exposing credential values.
- [x] 4.2 Implement managed-run creation with repository/base revision, owner token, isolated worktree/environment, and collision-safe port reservations.
- [x] 4.3 Implement bounded exact-argument setup/run/check/archive hooks with process-group ownership, output/time limits, and no implicit publish actions.
- [x] 4.4 Implement durable process/worktree checkpoints, restart reconciliation, reattachment, stale identity handling, and disconnected recovery.
- [x] 4.5 Integrate exact diff, Review, Testing, PR preparation, and explicit archive/cleanup handoffs.
- [x] 4.6 Implement versioned intent-closure receipts with goal, criteria, producing provider/session/run, current change evidence, disposition, reason, and stale detection.
- [x] 4.7 Add Rust and frontend tests for duplicate launch prevention, port collisions, crash recovery, hook bounds, stale worktrees, explicit publish boundaries, and intent closure.

## 5. Real-product QA and secure artifact previews

- [x] 5.1 Define the checked app-support matrix and qualify the existing React/Vite/Chromium lane for start, health, state, auth, network, scenario, cancellation, resource, retention, and cleanup contracts.
- [x] 5.2 Expose fixture-backed, real-product-supported, and unsupported/manual status honestly in Testing.
- [x] 5.3 Implement evidence-owned artifact projection with canonical-path, content-type, byte, dimension, redaction, and ownership checks.
- [x] 5.4 Add inert bounded image and text/report previews; block executable HTML, traversal, external references, and oversized artifacts.
- [x] 5.5 Add security and UI tests for valid previews, redaction, path escapes, unsupported types, oversized files, and no-network rendering.

## 6. Benchmark and public export evidence

- [x] 6.1 Extend real-PR case manifests with pinned PR provenance, public/license status, hand labels, adjudication, exclusions, and immutable diff identity.
- [x] 6.2 Extend reviewer artifacts and scorecards with named tool/version/tier, capture method, elapsed time, available token/cost data, and unverified-fix count.
- [x] 6.3 Add fail-closed readiness checks for 20-30 adjudicated real agent-generated PRs, required comparator slots, and compatible impact fields.
- [x] 6.4 Curate and validate 20-30 eligible public agent-generated PR cases without copying secrets or unlicensed private content.
- [x] 6.5 Capture and validate real CodeRabbit free-tier and Claude Code `/review` comparator artifacts where authenticated access is available; otherwise record the exact external blocker and leave claims closed.
- [ ] 6.6 Add larger public fixtures and run the production CodeVetter pipeline plus adjudication workflow over the completed corpus.
  - Externally blocked: the 20 schema-ready cases retain exact missing
    authenticated CodeVetter, CodeRabbit free-tier, and Claude Code `/review`
    capture evidence. No comparator or production-pipeline claim is authorized.
- [x] 6.7 Implement deterministic sanitized graph snapshot packages containing versioned JSON, static SVG/PNG, and Markdown link metadata without automatic upload.
- [x] 6.8 Add deterministic/security tests for graph package identity, sanitization, omission reporting, and zero publication side effects.

## 7. Performance, native, and scale qualification

- [x] 7.1 Implement a redacted dashboard IPC benchmark recording cold/warm p50, p95, maximum, response bytes, errors, machine, revision, and fixture identity.
- [x] 7.2 Implement cache/worktree disk accounting for Cargo, Playwright, package-manager, CodeVetter artifacts, and local worktrees.
- [x] 7.3 Consolidate only tool-supported measured duplicate caches and record reversible before/after receipts; add no service runtime.
- [x] 7.4 Add an Agent Island repeated-use qualification covering all action identities, duplicate/stale events, helper crash/fallback, latency, idle CPU, RSS, session continuity, and false-action count.
- [x] 7.5 Run the Agent Island qualification and keep the feature off by default unless every gate and a separate promotion decision pass.
- [x] 7.6 Run business-rule archaeology against the largest available checked eligible corpus, persist the exact qualification report, and state any unsupported 18M-line/100,000-rule claim.

## 8. Product integration and accessibility

- [x] 8.1 Add conservative retention plan/apply/compaction controls to Settings with dry-run-first copy and protected-reference explanations.
- [x] 8.2 Add managed-run profile, plan, checkpoint, recovery, and explicit handoff controls to Work while preserving conversation-first hierarchy.
- [x] 8.3 Add concise managed-run and intent-closure state/actions to Board without embedding a terminal cockpit or fabricating proof.
- [x] 8.4 Add calibration, public graph export, QA support status, and bounded preview controls to their existing specialist surfaces.
- [x] 8.5 Verify keyboard, accessible-name, reduced-motion, compact-window, and no-horizontal-overflow behavior for every changed surface.

## 9. Qualification, archive, and release

- [x] 9.1 Run focused Rust, frontend unit, TypeScript, Biome, Playwright, benchmark, security, docs, and strict OpenSpec checks after each slice.
- [x] 9.2 Run the complete desktop release qualification, including production build, Rust suite, all Playwright flows, warm verification, graph/MCP gates, native helper tests, and bundle/signature checks.
- [x] 9.3 Update canonical specs and product status with measured results, explicit non-claims, remaining external blockers, and the resolved intent/QA product decisions.
- [x] 9.4 Archive `complete-verification-workbench` only when every locally controllable task and required check is complete.
- [x] 9.5 Bump the desktop version, commit and push the intentional release scope, verify CI/Docs/auto-release/release workflows, and confirm updater manifest and signed assets.
