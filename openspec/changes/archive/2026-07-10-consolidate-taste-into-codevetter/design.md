## Context

ShipRank is a Vite/Hono/D1/Cloudflare product whose durable value is an evaluation architecture: criterion-level judgments, order-checked pairwise comparisons, agreement diagnostics, majority strength, cycle detection, and confidence calibration. Its standalone product path still depends on mock agents, an unpromoted model, and undeployed or operator-configured capture infrastructure.

CodeVetter is a local-first Tauri application with an existing risk-tiered specialist review pipeline, synthetic QA and browser evidence, local SQLite persistence, review proof export, per-finding usefulness outcomes, and benchmark tooling. Today those specialist outputs are deduplicated and optionally passed through a single coordinator, but the product does not provide a first-class staged outcome from code review through audience validation.

Both worktrees currently contain unrelated uncommitted changes. Implementation must avoid overwriting them and should begin with isolated files or an explicitly prepared worktree after the existing changes are preserved.

## Goals / Non-Goals

**Goals:**

- Make CodeVetter the single owner of review, executable test, and audience-validation capability.
- Retain ShipRank's evaluation principles while fitting CodeVetter's local-first architecture.
- Distinguish agent-simulated audience evidence from real human evidence.
- Produce a compact, evidence-linked verification outcome that can be copied into a handoff.
- Retire ShipRank safely without deleting source history or touching production data implicitly.

**Non-Goals:**

- Move the ShipRank SPA, Hono API, D1 schema, Product Arena, evaluator marketplace, payments, auth, capture Worker, R2 storage, or deployment stack into CodeVetter.
- Build audience recruitment, participant identity, incentives, or a hosted multi-tenant research platform.
- Promote the current ShipRank linear ranker as a production model.
- Replace CodeVetter's existing review, QA, browser, SQLite, or benchmark systems.
- Deploy or release CodeVetter, or delete cloud resources, as part of local implementation.

## Decisions

### 1. Use one staged-verification contract over existing artifacts

Code review remains represented by `local_reviews`; executable evidence remains represented by synthetic-QA, sandbox, procedure, screenshot, trace, and test artifacts. A new deterministic verification-summary contract links these artifacts and adds audience-validation state instead of duplicating all evidence into a new workflow engine.

Alternative considered: copy ShipRank's study/run/report data model into CodeVetter. Rejected because it duplicates CodeVetter's existing review records and imports SaaS-oriented concepts that do not fit a local verification workbench.

### 2. Add local audience-validation persistence

Add local SQLite tables for audience-validation runs and responses. A run links to a review and repository, defines audience/task/candidates/criteria/thresholds, and stores aggregate diagnostics. Responses carry explicit provenance (`agent`, `human`, or `imported`), opaque participant IDs, judgment data, order, timing, and evidence references.

The first implementation supports local agent-panel execution plus structured manual/imported human evidence. It does not operate a hosted participant service.

Alternative considered: keep ShipRank's D1 API as a CodeVetter backend. Rejected because it would break CodeVetter's offline/local-first boundary and keep the retired product's infrastructure alive.

### 3. Port the small diagnostic kernel into the Rust review domain

The algorithms behind comparable pairwise judgments, Kendall-style agreement, majority strength, order inconsistency, and Condorcet-cycle detection are small and deterministic. Reimplement them in a focused Rust module beside review orchestration with fixture parity tests derived from ShipRank, while retaining provenance comments and archived source references.

This lets diagnostics participate in persistence and aggregate outcomes before the Tauri result reaches the frontend. TypeScript receives a typed IPC representation and renders it.

Alternative considered: copy `taste/src/lib/scoring.ts` into the webview. Rejected because `run_cli_review` and persistence are owned by Rust, and duplicating decisions across backend and frontend would invite drift.

### 4. Do not manufacture consensus from incomparable specialists

CodeVetter's current specialists evaluate different scopes. Their outputs can contribute evidence, but agreement metrics are computed only when the same candidates and criteria were judged. The first comparable candidates are reviewer findings, patch/build alternatives, or audience experiences deliberately submitted to the same evaluation contract.

### 5. Make provenance visible and confidence conservative

Audience mode, response count, criteria, order checks, cycles, failed executable tests, and waivers are included in the verification summary and proof export. Agent-only audience runs are labeled simulated. Failed required executable evidence caps aggregate confidence regardless of audience preference.

### 6. Retire ShipRank after acceptance, not before

The ShipRank repo is frozen first. Capability inventory and parity fixtures are created, the CodeVetter slice is implemented and verified, then ShipRank and fleet documentation are marked retired. The repo remains recoverable. Cloud/D1/capture-resource changes are a separate explicit operator step.

## Risks / Trade-offs

- **Audience validation without hosted recruitment is less convenient** → Keep the MVP local and evidence-oriented; allow structured imports and leave hosted share links for a separately justified feature.
- **Porting TypeScript diagnostics to Rust can change edge behavior** → Build fixture-parity tests from ShipRank before integration and preserve inputs/expected outputs.
- **Specialist reviews are not automatically comparable** → Require common candidates and criteria before computing agreement; otherwise show scope-level disagreement only.
- **A single aggregate verdict could hide stage failures** → Always render stage status and evidence beside the aggregate outcome, and cap confidence on failed required stages.
- **Retiring too early could lose useful artifacts** → Use an explicit transfer/archive/discard inventory and keep repository history recoverable.
- **Dirty worktrees create collision risk** → Do not reset or overwrite them; isolate implementation or wait for current changes to be preserved before editing overlapping files.

## Migration Plan

1. Freeze standalone ShipRank feature development and inventory its reusable algorithms, tests, datasets, and current label-pair work.
2. Add fixture-parity tests and the diagnostic kernel in CodeVetter.
3. Add audience-validation persistence, Tauri commands/types, and staged-verification summary generation.
4. Add the smallest Review UI and proof-export surface for defining an audience run, recording/importing responses, and reading the combined outcome.
5. Verify Rust unit tests, targeted frontend tests, typecheck/lint, and one local end-to-end review → QA → audience-evidence flow.
6. Update CodeVetter product status and recommendation context.
7. Mark ShipRank retired, preserve its final active revision and artifact inventory, and remove it from active fleet inventories.
8. Separately present external Pages/Worker/D1/repository-archive actions for resource-specific approval; do not perform them implicitly.

Rollback is additive: older CodeVetter reviews remain valid, new tables can remain unused, and the UI entry can be disabled without deleting local evidence. ShipRank source remains recoverable throughout.

## Open Questions

- Should the first human-audience workflow stop at structured manual/imported responses, or also export a portable static response form? The design defaults to manual/imported responses to preserve local-first scope.
- Which CodeVetter surface should host the audience setup: the Review sidebar after QA, or a dialog reached from the verification summary? The design favors the existing Review flow and no new top-level navigation item.
- Which specific external ShipRank resources still exist and require later decommission approval? This must be discovered without reading secrets or mutating production.
