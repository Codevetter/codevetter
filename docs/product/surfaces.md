---
title: Surfaces and navigation
description: The desktop app's nav tabs, URL-only routes, and where each lives in code.
sidebar:
  order: 2
---

# Surfaces and navigation

The desktop app has **8 top-nav tabs** plus a set of **URL-only surfaces**
that are reachable but intentionally off the top nav.

## Top nav (8 tabs)

| Tab | Route | Page file | What it does |
|---|---|---|---|
| Home | `/` | `apps/desktop/src/pages/Home.tsx` | Usage/token analytics + session history + acceptance-rate strip. |
| Review | `/review` | `apps/desktop/src/pages/QuickReview.tsx` | AI code review with diff + fix + verification proof. Editor-primary layout with verdict sidebar. |
| Roadmap | `/roadmap` | (within Home/Repo) | Shipped/verification telemetry dashboard. |
| Unpack | `/unpack` | `apps/desktop/src/pages/RepoUnpacked.tsx` | Whole-repo evidence-backed system brief. Scanner in `src-tauri/src/commands/unpack.rs`; persisted to `repo_unpacked_reports`. See [architecture/repo-unpacked.md](../architecture/repo-unpacked.md). |
| Intel | `/intel` | (within Repo) | Tool breakdown + intel. |
| Fleet | `/fleet` | (within Repo) | SaaS Maker fleet projects + repo↔project linking. |
| T-Rex | `/trex` | `apps/desktop/src/pages/TRex.tsx` | PR watchers with retry + per-PR base-branch inference. |
| Settings | `/settings` | `apps/desktop/src/pages/Settings.tsx` | Also hosts Ops, Memories, Rubrics, usage, about. |

The Repo surface (`apps/desktop/src/pages/RepoPage.tsx`) consolidates Unpack,
Activity, Graph, Inventory, Analysis, Handoff, and past snapshots.

## URL-only surfaces

| Route | Page file | Notes |
|---|---|---|
| `/rubrics` | `apps/desktop/src/pages/Rubrics.tsx` | Linked from Review. Standards pack authoring, prompt preview, per-pack usage stats, cloning. |
| `/ops` | `apps/desktop/src/pages/Ops.tsx` | Operations panel. |
| `/memories` | `apps/desktop/src/pages/AgentMemories.tsx` | Agent memories: copy-as-markdown, regex line filter, git-diff-vs-HEAD with secret redaction. |
| `/agents` | `apps/desktop/src/pages/AgentPanel.tsx` | PTY-backed agent terminals. |

## Removed surfaces (do not resurrect)

- `/intent-debugger` and `/qa-replay` — their functionality (commit-intent
  reporting, synthetic-QA loops) lives in the Review screen (`/review`).
- The old Ask / Personas tabs and their Rust backend — removed in v1.1.87.
- Standalone Roadmap/resources top-level nav — consolidated into Repo.
- `LiveAgentRunner` / `SaasMakerTasksPanel` — orphaned by earlier page
  removals, reaped in the 2026-07-11 desloppification sweep.

## Routing

`react-router-dom` v7. Entry: `apps/desktop/src/main.tsx` → `App.tsx`.
Persistent routes are handled by `apps/desktop/src/components/persistent-routes.tsx`
so state survives navigation.
