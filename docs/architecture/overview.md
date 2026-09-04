---
title: Architecture overview
description: How the native macOS app and Rust verification core are layered.
sidebar:
  order: 1
---

# Architecture overview

CodeVetter is a local-first native macOS application for evidence-backed
verification of agent-generated code. There is no CodeVetter server. The app,
CLI, MCP server, session indexer, structural graph, and SQLite database operate
on the user's machine.

## Top-level shape

```text
SwiftUI and AppKit app (apps/macos)
  -> typed process adapter and versioned JSON receipts
Rust verification core (crates/codevetter-core)
  -> CLI, read-only MCP server, repository tools, agent runners
  -> local SQLite and bounded artifacts
```

## Layers

| Layer | Location | Responsibility |
|---|---|---|
| App shell | `apps/macos/CodeVetter/` | Lifecycle, assets, production identity, Sparkle host. |
| Native features | `apps/macos/CodeVetterPackage/Sources/CodeVetterFeature/` | Shared navigation, pages, state, receipt rendering, process supervision. |
| Native tests | `apps/macos/CodeVetterPackage/Tests/`, `apps/macos/CodeVetterUITests/` | Unit, contract, rendering, accessibility, and interactive qualification. |
| Rust core | `crates/codevetter-core/src/` | Verification, review, graph/history, usage, settings, persistence, agents. |
| CLI | `crates/codevetter-core/src/bin/codevetter.rs` | Primary executable contract used by humans and the native app. |
| MCP | `crates/codevetter-core/src/bin/codevetter-mcp.rs`, `crates/codevetter-core/src/mcp/` | Opt-in read-only machine access. |
| Automation | `scripts/` | Benchmarks, package qualification, release evidence, docs validation. |

## Critical invariants

- **Native UI only.** The retired React/Tauri WebView is not built or shipped.
- **One product truth.** Rust-owned versioned receipts synchronize the native
  UI, CLI, and MCP surfaces. Presentation cannot manufacture evidence.
- **No hosted review backend.** Network access is limited to explicitly
  configured providers, GitHub reads, and the signed Sparkle update feed.
- **Local persistence.** Rust uses bundled `rusqlite`; do not add a second
  database layer.
- **Fail closed.** Missing executables, schema mismatches, unavailable provider
  quotas, or incomplete runtime evidence are shown as unavailable—not success.
- **No background disruption.** Interactive UI automation runs only with fresh
  authorization on an idle graphical runner. Background-safe tests are the
  default local lane.

## Deeper docs

- [ipc-and-commands.md](./ipc-and-commands.md) — native/CLI/MCP boundary.
- [data-model.md](./data-model.md) — SQLite and persistence boundaries.
- [review-pipeline.md](./review-pipeline.md) — review and verification flow.
- [graph-and-history.md](./graph-and-history.md) — structural graph and history.
- [mcp-sidecar.md](./mcp-sidecar.md) — read-only local MCP server.
- [native-macos.md](../development/native-macos.md) — native development and qualification.
- [release-pipeline.md](../operations/release-pipeline.md) — signed native releases.

Historical Tauri architecture is retained under `docs/archive/` and in dated
project-history entries. It is context, not current implementation guidance.
