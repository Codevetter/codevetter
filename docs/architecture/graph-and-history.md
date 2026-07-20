---
title: Structural graph and history workbench
description: The canonical syntax-aware graph, release-history reconstruction, and their analytics boundary.
sidebar:
  order: 5
---

# Structural graph and history workbench

CodeVetter ships a **canonical syntax-aware structural graph** and an
**immutable release-history workbench**. Both are local, persisted to SQLite,
and feed Review/proof as **navigation context only** — they cannot
independently create findings, severities, or verified-runtime claims.

## Canonical structural graph

- **Coverage**: 15 language variants via tree-sitter; stable source
  identities; exact / inferred / ambiguous trust; cross-file resolution;
  communities; hubs/bridges; incremental repair; indexed
  query / explain / path / impact operations.
- **Import**: bounded `nodes` + `links`/`edges` JSON can be imported into a
  transient preview with confidence/source/community metadata preserved. See
  the [structural graph contract](./decisions/structural-graph-contract.md).
- **Trust-weighted paths**: Review derives at most four native paths from
  changed files to routes, Tauri commands, tables, scripts, or tests.
  Uncertain / imported / legacy hops are **navigation leads**, not evidence.
- **Measured envelope** (445-file repo, release build, 2026-07-14):
  35,775 nodes / 58,344 edges; 369.54 ms cold full build; 235.79 ms one-file
  refresh; 0.02/0.05 ms delete/rename repair; 82.97 MiB SQLite; 436.5 MiB
  sampled peak RSS. UI data-path: 1.174 ms transition p95, 0.203 ms search p95.
  See [development/performance.md](../development/performance.md) for how to
  re-measure.

## Release-history workbench

- **Immutable checkpoints**: release/HEAD checkpoints with compressed commit
  deltas; exact release/commit/date reconstruction; conservative lineage.
- **No checkout**: Git history is read through immutable objects without
  touching the working tree. Refresh is incremental and resumable; imported
  evidence survives rewrites.
- **Causal queries**: `what / why / when / how / verification / outcome` over
  bounded history; annotations; Review/proof context; Repo history slider
  with stable morphing topology.
- **Local evidence adapters**: provider-side outcomes can be attached without
  calling a hosted API — see [history-evidence-import.md](./history-evidence-import.md).

## The analytics-event boundary (important)

**Code emission does not imply provider ingestion without imported provider
evidence.** The graph can prove local facts (a definition exists, a path
connects two symbols, a release touched a file). It cannot prove an
analytics event happened in an external system unless you import that
evidence. Surface this gap explicitly in any UI that mixes local graph facts
with provider claims.

## MCP sidecar

The same canonical graph and release/commit/date history service is exposed
to local coding agents through an opt-in, read-only, stdio-only MCP server
with thirteen bounded tools. See [mcp-sidecar.md](./mcp-sidecar.md).

## Key files

- `apps/desktop/src-tauri/src/commands/structural_graph/` — graph build, query, path, impact, communities.
- `apps/desktop/src-tauri/src/commands/history_graph.rs` — release checkpoints, deltas, lineage.
- `apps/desktop/src-tauri/src/commands/history_query.rs` — causal queries.
- `apps/desktop/src-tauri/src/commands/graph_trust.rs` — trust-weighted paths for Review.
- `apps/desktop/src/lib/history-workbench.ts` — webview-side slider + projection.
- `apps/desktop/src/lib/deep-graph-parse.ts` — bounded node-link import parsing.
- `apps/desktop/src/components/deep-graph-viewer.tsx` — graph surface.
