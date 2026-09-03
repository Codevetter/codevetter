---
title: Surfaces and navigation
description: The desktop app's nav tabs, URL-only routes, and where each lives in code.
sidebar:
  order: 2
---

# Surfaces and navigation

The desktop app is a focused evidence workbench with **five product surfaces**
(defined in `apps/desktop/src/components/sidebar.tsx`) plus an integrated
Settings utility and a set of **URL-only surfaces** that are reachable but
intentionally absent from the fixed navigation rail.

## Verification-centered path

The surfaces remain independently useful, but they are not equal steps in the
primary workflow. The persistent **Check a change** action starts one coherent
path:

1. Use Repo Unpack when repository structure, history, or ownership is needed.
2. Use Review to select the exact branch or pull request, capture task intent,
   and identify findings and evidence gaps. Model findings are leads, not proof.
3. Use Testing for executable runtime and browser evidence, receipts, failures,
   and explicit limitations.
4. Use Performance to admit one exact local workload, capture runtime evidence,
   and require same-scope proof before accepting an optimization.
5. Make a shipping decision from the combined evidence: ship candidate, hold,
   or no confidence.

Usage remains independently useful. It does not replace executable verification
and must not imply that an unrun check passed.

## Product pillars

Source: `navItems` in `apps/desktop/src/components/sidebar.tsx`.

| Tab | Route | Page (via `persistent-routes.tsx`) | What it does |
|---|---|---|---|
| Usage | `/` | `apps/desktop/src/pages/Home.tsx` | Local spend and token trends from bundled `ccusage` for Claude/Codex/Grok plus CodeVetter's separately queried Devin tracker; provider remaining-usage and quota telemetry stays separate and unchanged. |
| Repo Unpack | `/unpack` | `apps/desktop/src/pages/RepoPage.tsx` | Whole-repo evidence-backed system brief. Tab `match`es `/unpack` and `/intel`. Scanner in `src-tauri/src/commands/unpack*.rs`; persisted to `repo_unpacked_reports`. See [architecture/repo-unpacked.md](../architecture/repo-unpacked.md). |
| Review | `/review` | `apps/desktop/src/pages/QuickReview.tsx` | First change-checking stage: select an exact change, inspect source-qualified findings and coverage gaps, attach evidence, and export a local Agent PR X-Ray. The setup panel reports Agent MCP readiness and exposes the exact local `codevetter check` command for the selected range. Findings remain leads until executable evidence supports the decision. |
| Testing | `/trex` | `apps/desktop/src/pages/TRex.tsx` | Runtime-evidence stage: resolve a human-described flow, exact PR/change, or bounded codebase portfolio into runnable tests; confirm the plan; then capture receipts. Direct preview, changed-capability verification, scenarios, and PR watchers share Rust-owned CLI/native contracts. Native watcher timing is app-lifetime only and every execution session requires explicit consent. See [trex-change-preview.md](./trex-change-preview.md). |
| Performance | `/performance` | `apps/desktop/src/pages/Performance.tsx` | Uses the same intent resolver, then admits one exact Node test/script, Vitest, Playwright, or Go benchmark workload. Shows zero-egress admission, observed versus inferred evidence, limitations, one next action, cleanup state, and machine-readable receipts. |

Settings (`/settings`) is a labelled utility separated at the bottom of the
same fixed rail, not a seventh product surface. It hosts preferences, Ops,
Memories, Rubrics, Agent MCP, usage, and About through `?section=`.
Agent MCP reports repository readiness and provides a copyable
`prepare_review` invocation; it remains read-only and never runs the reviewer
or suggested verification.

The packaged CLI provides the orchestration entry point:

```bash
codevetter check --range main...HEAD \
  --task "Describe the expected behavior" \
  --json
```

After a completed persisted review, `codevetter xray --review-id <id>` and the
native Review sheet share the existing Rust public-export contract. Preview is
allowed to return explicit publication blockers; saving additionally requires
an exact destination and an eligible freshly rebuilt packet. JSON, Markdown,
and self-contained HTML remain deterministic and provider-free.

`codevetter fix-packet --run-id <id>` and the native Review handoff sheet also
share one Rust projection. A user selects persisted, source-qualified findings;
the packet binds the exact task, explicit acceptance requirements, evidence to
preserve, route advice, and limitations into copyable Markdown. It remains a
fix instruction packet, never evidence that the fix succeeded.

After that handoff, `codevetter fix --operation execute` and the native Review
sheet share one explicit-consent `codevetter.fix-attempt/v1` contract. One
configured agent may edit only a detached worktree materialized from the
recorded head. Rust bounds the diff, reruns the recorded correctness target,
and source-qualifies a re-review before any selected finding can be labelled
fixed. The worktree is retained for inspection; CodeVetter has no commit,
merge, or push action, and discard requires separate confirmation. Agents can
invoke the same local CLI contract, while MCP remains read-only.

`codevetter warm --operation status|start|stop|run|cancel|cleanup|current` and
the native Testing warm-proof workspace share the incumbent Rust bridge to the
repository-owned verifier. Native changed proof keeps daemon ownership,
worktree identity, deterministic scenario selection, observations, redacted
artifacts, limitations, persistence, and outcome semantics in Rust. Cleanup is
fail-closed in the CLI: it requires exactly one of `--dry-run` or
`--apply-cleanup`. The agent/MCP target-discovery surface stays read-only and
cannot start the verifier.

`codevetter differential --operation prepare|run|cancel|cleanup` and the native
paired-evidence workspace share the same exact reference/candidate selection,
materialization, parity policies, bounded delta previews, cleanup, persistence,
classification, and zero-model-call contract. Preparation is a separate gate;
commit/range candidates require an exact revision, and differential output is
explicitly additive evidence that can never manufacture a passing verdict.

`codevetter scenario --operation inspect|generate|validate|dry-run|accept|reject|cleanup`
and the native Scenario Foundry preserve the incumbent compiler pipeline.
Generation is restricted to the declared free/local provider and produces an
expiring candidate only. Validation and dry-run remain separate and cannot
persist evidence or update baselines. Acceptance rechecks the exact candidate
hash, writes only selected repository-contained destinations, and requires a
separate replacement approval when a selected file already exists.
Candidate cleanup is CLI-only and requires explicit `--apply-cleanup`.

`check` requires a clean local checkout at the resolved change head. It
composes the existing review, correctness, and performance engines into one
versioned receipt. It may discover the highest-confidence closed target or
accept explicit adapter/target pairs for reproducible benchmark runs. The
optimization stage is a bounded handoff: a coding agent edits an isolated
checkout, then `--baseline-repo` activates paired verification. CodeVetter does
not edit the selected checkout or perform GitHub, release, or deployment work.

The Repo surface (`apps/desktop/src/pages/RepoPage.tsx`) consolidates Unpack,
Activity, Graph, Inventory, Analysis, Handoff, and past snapshots.
`RepoUnpacked.tsx` is a child view within it, not the `/unpack` page itself.

The unreleased native migration reuses the same Rust scanner and SQLite
persistence boundary through `codevetter unpack --operation scan`. Its current
Repo Unpack workspace can create model-free snapshots and inspect stored
Overview, Brief, Activity, Inventory, bounded Graph, and commit-range Delta
evidence. Deterministic Analysis, observed Rules, and source-qualified Handoff
desks keep health and historical leads distinct from executable proof. It also
saves the incumbent Rust-rendered Markdown, offline HTML,
graph JSON, agent-context, and repository-memory exports. Model synthesis
execution and cleanup remain with the shipped Tauri authority until their
replacement gates pass. The native Graph desk and
`codevetter unpack --operation query` now share one read-only Rust receipt for
bounded structural search, node explanation, impact, directed path, temporal
search, and causal trace. It exposes index freshness, trust, sources, evidenced
versus qualified-lead history links, and unavailable coverage without
duplicating ranking or traversal in Swift. Native repeated queries use one
supervised read-only worker with a single search projection that upgrades in
place with compact traversal edges only when required. Bounded result edges
then regain their full evidence and source anchors from SQLite. Every request
rechecks live freshness and snapshot identity; framing, cancellation by process
termination, and the exact one-shot CLI compatibility fallback remain intact.

The fixed rail and command search intentionally omit per-destination mnemonic
codes. The former custom `g` navigation chords were removed; destinations use
ordinary accessible links and command search instead.

Testing and Performance share `evidence-scope/v1` across native UI,
`codevetter scope`, MCP `resolve_evidence_scope`, and the target suggestions in
`prepare_review`. Human phrases are bounded local path/content searches and are
never executed. PR/change plans are pinned to exact Git identities. Codebase
plans are capped portfolios with explicit uncovered paths; they do not claim
complete behavioral coverage. MCP remains read-only; a resolved UI/CLI plan
must be confirmed before any test or profile starts.

## URL-only surfaces

| Route | Behavior | Notes |
|---|---|---|
| `/rubrics` | Redirects to `/settings?section=rubrics` (`App.tsx`). | Standards pack authoring, prompt preview, per-pack usage stats, cloning. |
| `/ops` | Redirects to `/settings?section=ops` (`App.tsx`). | Operations panel. |
| `/agent-memories` | Redirects to `/settings?section=memories` (`App.tsx`). | Agent memories: copy-as-markdown, regex line filter, git-diff-vs-HEAD with secret redaction. |
| `/intel` | Redirects to `/unpack` (`RedirectIntelToRepo` in `App.tsx`). | Tool breakdown + intel now lives inside the Repo surface. |
| `/agents`, `/board` | Redirect to `/` (`App.tsx`). | Embedded building and task-board UI is retired; local historical records and backend lifecycle code are retained pending a separate cleanup. |

## Redirected / removed surfaces (do not resurrect)

- `/intel` → `/unpack`, `/fleet` → `/`, `/workbench` → `/`, and `/agents` or
  `/board` → `/` (redirects in
  `App.tsx`). SaaS Maker fleet linking is backed by `commands/saas_maker.rs`
  but no longer has its own top-level tab.
- `/rubrics`, `/ops`, `/agent-memories` → `/settings?section=…` (redirects
  in `App.tsx`).
- `/intent-debugger` and `/qa-replay` — their functionality (commit-intent
  reporting, synthetic-QA loops) lives in the Review screen (`/review`).
- The old Ask / Personas tabs and their Rust backend — removed in v1.1.87.
- Standalone Roadmap/resources top-level nav — consolidated into Repo.
- `LiveAgentRunner` / `SaasMakerTasksPanel` — orphaned by earlier page
  removals, reaped in the 2026-07-11 desloppification sweep.

### Work/Board retirement audit (2026-08-16)

The mounted `AgentPanel`, `WorkBoard`, `AgentLiveOutput`, and
`AgentProviderMark` presentation modules were proven unreachable from the
retained route graph and removed. Knip is the dependency-graph gate for this
contraction. SQLite work-item/session records, typed IPC calls, and Rust agent
lifecycle commands remain deliberately intact: deleting them could strand
historical local data and requires a separate export-and-migration decision.

## Routing

`react-router-dom` v7. Entry: `apps/desktop/src/main.tsx` → `App.tsx`.
Top-level redirects (`/intel`, `/fleet`, `/rubrics`, `/ops`,
`/agent-memories`, `/workbench`, `/agents`, `/board`) are declared as explicit `<Route>`s in
`App.tsx`; everything else falls through to
`apps/desktop/src/components/persistent-routes.tsx` so state survives
navigation.
