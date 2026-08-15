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
| Usage | `/` | `apps/desktop/src/pages/Home.tsx` | Verified Codex token evidence, explicit coverage/pricing diagnostics, separately labelled legacy estimates, recovery/import controls, session history, and acceptance-rate strip. |
| Repo Unpack | `/unpack` | `apps/desktop/src/pages/RepoPage.tsx` | Whole-repo evidence-backed system brief. Tab `match`es `/unpack` and `/intel`. Scanner in `src-tauri/src/commands/unpack*.rs`; persisted to `repo_unpacked_reports`. See [architecture/repo-unpacked.md](../architecture/repo-unpacked.md). |
| Review | `/review` | `apps/desktop/src/pages/QuickReview.tsx` | First change-checking stage: select an exact change, inspect source-qualified findings and coverage gaps, attach evidence, and export a local Agent PR X-Ray. Findings remain leads until executable evidence supports the decision. |
| Testing | `/trex` | `apps/desktop/src/pages/TRex.tsx` | Runtime-evidence stage: resolve a human-described flow, exact PR/change, or bounded codebase portfolio into runnable tests; confirm the plan; then capture receipts. Direct preview, changed-capability verification, scenarios, and PR watchers remain available. See [trex-change-preview.md](./trex-change-preview.md). |
| Performance | `/performance` | `apps/desktop/src/pages/Performance.tsx` | Uses the same intent resolver, then admits one exact Node test/script, Vitest, Playwright, or Go benchmark workload. Shows zero-egress admission, observed versus inferred evidence, limitations, one next action, cleanup state, and machine-readable receipts. |

Settings (`/settings`) is a labelled utility separated at the bottom of the
same fixed rail, not a seventh product surface. It hosts preferences, Ops,
Memories, Rubrics, Agent MCP, usage, and About through `?section=`.

The Repo surface (`apps/desktop/src/pages/RepoPage.tsx`) consolidates Unpack,
Activity, Graph, Inventory, Analysis, Handoff, and past snapshots.
`RepoUnpacked.tsx` is a child view within it, not the `/unpack` page itself.

The fixed rail and command search intentionally omit per-destination mnemonic
codes. The former custom `g` navigation chords were removed; destinations use
ordinary accessible links and command search instead.

Testing and Performance share `evidence-scope/v1`. Human phrases are bounded
local path/content searches and are never executed. PR/change plans are pinned
to exact Git identities. Codebase plans are capped portfolios with explicit
uncovered paths; they do not claim complete behavioral coverage. A resolved
plan must be confirmed before any test or profile starts.

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
