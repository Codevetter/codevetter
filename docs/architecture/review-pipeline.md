---
title: Review pipeline
description: The review → fix → re-review → proof flow and how findings are produced.
sidebar:
  order: 4
---

# Review pipeline

The Review surface is a typed React/Tauri workflow. Rust owns Git target
resolution, deterministic planning, bounded provider execution, source
qualification, checkpointing, persistence, and cancellation. The webview owns
configuration and presentation. A provider response is a candidate source, not
evidence, until the Rust qualifier proves its locator against the selected Git
target.

## Flow

```
repo path / PR branch
        │
        ▼
resolve target + plan units  (Rust: deterministic_review.rs)
        │
        ▼
load exact checkpoints; build bounded prompts
        │
        ▼
explicit CLI executor  (Claude or Gemini; no silent fallback)
   ├─ risk-tiered passes:
   │     trivial single-pass → lite product/agent → full sensitive-path
   │     (security + product + agent specialists + coordinator + dedup)
   │
        ▼
strict parse + source qualification
        │
        ▼
qualified-only coordinator + dedup
        │
        ▼
atomic attempts/checkpoints + review manifest + findings
        │
        ▼
UI: outcome, coverage, limitations, evidence, X-Ray export
```

## Target and unit contract

The target resolver accepts worktree, staged, commit, or range input and keeps
Git arguments separated from path arguments. It records verified HEAD/base
identities plus a source fingerprint and refuses option-like input. Every
changed path receives one stable unit, including rename and delete entries.
Generated and binary files remain visible as explicitly skipped; they are not
silently removed from coverage.

Unit fingerprints include schema and policy versions, executor identity,
repository rules, selected review context, file status, and the individual file
diff. An unchanged unit can therefore reuse a normalized checkpoint while one
changed file reruns independently. Failed, cancelled, or invalidated units do
not reuse a checkpoint.

The current local execution bounds are recorded in every manifest: three
concurrent jobs, 80 KiB prompt context per unit, 4 MiB output per attempt, one
attempt, and eight minutes per attempt. Output is drained incrementally.
Timeout, cancellation, or future drop terminates the owned process group so
provider child tools cannot remain orphaned.

## Risk tiers

- **Trivial** — single pass, no specialists.
- **Lite** — product + agent passes.
- **Full / sensitive path** — security, product, and agent specialist passes
  plus a coordinator pass and dedup metadata.

Tier selection is driven by the changed-file set (sensitive paths trigger the
full tier).

## Coordinator dedup

Replaced exact `file:line:title` dedup with **same-file near-line
token-similarity clustering**, calibrated on real duplicate pairs from the
first benchmark run. This is what flipped the head-to-head vs raw Claude on
precision and F1 (see [development/benchmark.md](../development/benchmark.md)).
Three regression tests guard the clustering.

## Finding qualification

Specialist candidates are qualified before coordination and coordinator output
is qualified again before persistence. The qualifier enforces repository
containment, changed-file membership, protected-path policy, symlink safety,
current line bounds, bounded fields, valid severity/confidence, and an exact
source anchor. A moved anchor may relocate only when the match is unique.
Mismatch is stale; ambiguity is unresolved; unsafe input is rejected.

Suggestions are validated independently. A bad or cross-file suggestion is
removed without discarding otherwise valid evidence. Qualification diagnostics
and rejected/stale/unresolved counts stay in the manifest so the UI cannot turn
partial evidence into full confidence.

## External collector boundary

The unreleased `codevetter collect` path resolves the same exact clean Git
change before invoking an optional local sidecar. `tool_collectors.rs` owns
binary/config identity, no-shell supervision, output limits, normalization, and
limitations; the external tool does not own the CodeVetter verdict. The first
implemented adapter is Gitleaks 8.30.1 and drops raw match/secret fields before
serialization. cargo-audit and cargo-llvm-cov remain claim-closed preflights
until their offline database and LLVM prerequisites are packaged. The
[qualification receipt](https://github.com/Codevetter/codevetter/blob/main/evidence/verification/tool-collector-foundation-2026-08-31.md)
records the proven slice; issue #198 owns packaging and remaining execution.

## Manifest and interruption behavior

SQLite stores additive run, unit, attempt, qualification, and checkpoint state.
Failed or cancelled attempts update the terminal unit state in the same
transaction. Successful normalized unit output and its reviewed state are also
stored together. Exact active runs are mutually exclusive; abandoned claims
expire after 30 minutes. Old terminal manifests without a linked review are
removed after 30 days, while review-linked history is retained.

The Review screen shows complete or partial unit coverage, explicit candidate
diagnostics, stale/cancelled state, and `legacy_aggregate` for older reviews
whose per-file coverage cannot be reconstructed. A repository-authorized MCP
read tool returns the same state with stable pagination and without repository
roots, prompts, or raw provider output.

## Fix loop

1. User selects findings (dismissed findings are excluded from bulk selection).
2. `agent-fix-packet` is built from selected findings: goal, acceptance
   criteria, non-goals, browser/QA evidence refs, usage-routing advice.
3. After a separate explicit confirmation, `codevetter fix --operation execute`
   materializes the recorded head as a detached worktree under CodeVetter app
   data and runs exactly one selected coding-agent CLI there.
4. Rust bounds the changed-file list and diff, runs `git diff --check`, reruns
   the correctness target from the source receipt, and source-qualifies a
   `WORKTREE` re-review.
5. Per-finding re-check status is `fixed`, `reproduced`, or `unchecked`.
   `verified_fixed` requires a clean diff, a passing executable target, a
   completed re-review, and no reproduced or unchecked selected finding.
6. The worktree remains uncommitted and owner-inspectable. CodeVetter never
   merges or pushes it. `codevetter fix --operation discard` requires a second
   explicit confirmation before removing it.

Codex uses its ephemeral workspace-write sandbox. Claude uses non-persistent
`acceptEdits` mode with an empty strict MCP configuration, and Gemini uses its
sandbox with `auto_edit` plus extensions disabled. Git credential prompting and
plain implicit pushes are disabled for the child process. Rust also verifies
that detached `HEAD` still equals the recorded source SHA; any agent-created
commit or branch movement fails closed and blocks all recheck claims. These
controls bound CodeVetter's invocation, but an externally configured CLI or
provider remains a separate local trust dependency.

Completed local-check receipts additionally support a narrower deterministic
handoff through native Review and `codevetter fix-packet`. Rust reloads the
persisted receipt, rejects unknown or unqualified selected finding identities,
and binds the exact task, attached acceptance requirements, source locations,
runtime/procedure evidence, route advice, and limitations into
`codevetter.agent-fix-packet/v1`. The native Review sheet, CLI, and local agent
invocation then share `codevetter.fix-attempt/v1`; read-only MCP tools do not
gain execution authority.

## Verification proof

The Review screen emits a copyable reviewer handoff (`review-proof` +
`agent-fix-packet`) containing:

- Per-finding evidence (file/line, artifact, level, notes) with status icons.
- Fixed / reproduced / unchecked tallies.
- A `### Next actions` checkbox list derived from unchecked + reproduced +
  unticked revalidation items.

Staged review → executable test → audience-validation produces one
evidence-linked aggregate outcome with explicit stage waivers. See
[product/synthetic-user-qa.md](../product/synthetic-user-qa.md) for the
runtime evidence layer.

## Agent PR X-Ray

A completed review can be normalized locally into one versioned public payload
and rendered deterministically as JSON, Markdown, or self-contained static
HTML. The export never calls a provider. It carries the review outcome,
per-stage status/provenance/omissions, coverage, findings and relative source
locators, changed behavior, checks, verified claims, missing proof, and risks.

Export is fail-closed until the user confirms a public source. Absolute paths,
credentials, prompt/raw-output fields, unsafe HTML, and invalid locators block
the export. Suggestion text is omitted unless its individual finding is
explicitly approved. The HTML has no script or network dependency and is
previewed in a sandboxed iframe. The checked-in landing gallery is a local
build artifact until its examples are manually adjudicated and deployment is
separately authorized.

The Tauri panel, native Review sheet, and `codevetter xray` use the same Rust
builder, sanitizer, and atomic-save implementation. Native preview summarizes
eligibility, omissions, stages, and public findings without introducing a
WebView; the selected JSON, Markdown, or HTML artifact is still rendered and
written by Rust.

## Standards packs

`RubricPackInput` (`commands/rubric_settings.rs`) groups checks by focus
(`product-safety`, `security-boundary`, …). The Rust core owns built-ins,
validation, the active selection, custom packs, exact prompt rendering, and
the `codevetter.rubric-settings/v1` receipt. Completed reviews link the selected
id through `local_reviews.standards_pack`. The incumbent Rubrics page imports
the previous allowlisted `codevetter_review_config` localStorage record once,
then mirrors the canonical Rust receipt back for compatibility with older
frontend code. Native Settings and `codevetter rubrics` use the same receipt;
`codevetter check` consumes its active prompt context directly.

## Key files

- `apps/desktop/src-tauri/src/commands/rubric_settings.rs` — canonical rubric config and receipts.
- `apps/desktop/src/lib/review-service.ts` — incumbent compatibility mirror and prompt fallback.
- `apps/desktop/src/lib/agent-fix-packet.ts` — fix packet construction.
- `apps/desktop/src-tauri/src/commands/fix_packet.rs` — receipt-bound native/CLI fix handoff.
- `apps/desktop/src-tauri/src/commands/fix_attempt.rs` — confirmed detached-worktree execution, bounded diff, executable recheck, re-review, and discard receipt.
- `apps/desktop/src/lib/review-proof.ts` — verification handoff.
- `apps/desktop/src/lib/quick-review-*.ts{x}` — QuickReview state, code, format, procedure.
- `apps/desktop/src/components/quick-review/` — 13 panels (setup, editor, findings, fix diff, verification summary, audience, synthetic QA, history context, review memory graph, evidence insights, create preview, agent status timeline).
- `apps/desktop/src-tauri/src/commands/review.rs` — execution, coordination, save, fix worktrees.
- `apps/desktop/src-tauri/src/commands/deterministic_review.rs` — target,
  units, qualification, manifest, checkpoints, and retention.
- `apps/desktop/src-tauri/src/commands/xray.rs` — public-safe X-Ray contract,
  renderers, sanitizer, and atomic save.
- `apps/desktop/src-tauri/src/agent/` — CLI agent subprocess spawning.
