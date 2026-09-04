---
title: Repo Unpack
description: Evidence-backed repository snapshots, briefs, graph, history, and exports.
---

# Repo Unpack

Repo Unpack turns one selected local repository into a bounded, persisted
snapshot and evidence-backed brief. Rust owns scanning, synthesis contracts,
storage, graph/history queries, and exports; SwiftUI/AppKit provides the native
outline and inspectors.

## Flow

1. The operator selects a local Git repository.
2. `codevetter.unpack-scan/v1` records exact repository and revision identity,
   inventory, stack signals, entrypoints, configuration, bounded history,
   deterministic health, and graph readiness.
3. The Rust core persists the canonical snapshot to local SQLite.
4. Native and CLI inspect the same Overview, Brief, Activity, Inventory,
   Analysis, Rules, Graph, History, Handoff, and Delta projections.
5. Optional model synthesis uses a configured local agent CLI. Model output is
   labelled and cannot replace deterministic inventory evidence.
6. Rust renders Markdown, offline HTML, graph JSON, agent context, and
   repository-memory exports without Swift reinterpreting content.

## Query contract

`codevetter.repo-query/v2` covers:

- structural search;
- node explanation;
- impact;
- directed path;
- bounded history search;
- causal trace.

The native query desk, CLI, and repository-scoped MCP use the same structural
graph and history services. Every response preserves repository identity,
revision freshness, source anchors, trust, result bounds, and unavailable-index
states.

Graph and history are navigation evidence. They do not prove runtime behavior,
and Swift performs no independent ranking or traversal.

## Commands

```bash
codevetter unpack --operation scan --help
codevetter unpack --operation list --help
codevetter unpack --operation inspect --help
codevetter unpack --operation compare --help
codevetter unpack --operation export --help
codevetter unpack --operation query --help
```

MCP can query only an explicitly enabled, stored, fresh repository index. It
cannot scan, synthesize, export, mutate files, or refresh the index.

## Boundaries

- The scan is local and model-free.
- Raw full-file inventory remains local and is omitted from the bounded client
  receipt.
- Selected export destinations are explicit.
- Handoff falls back to deterministic entrypoints and test leads when no
  model-labelled brief exists.
- Delta parsing is bounded and tied to an exact Git range.
- Missing or stale graph/history evidence fails closed.

## Key implementation

- `crates/codevetter-core/src/commands/unpack.rs` — scan and persistence.
- `crates/codevetter-core/src/commands/repo_query.rs` — shared query receipt.
- `crates/codevetter-core/src/commands/structural_graph/` — syntax-aware graph.
- `crates/codevetter-core/src/commands/history_graph.rs` and
  `history_query.rs` — temporal evidence.
- `apps/macos/CodeVetterPackage/Sources/CodeVetterFeature/` — native workspace
  and inspectors.

The previous React/Tauri implementation notes are preserved in
`docs/archive/stale-repo-unpacked-2026-09.md`.
