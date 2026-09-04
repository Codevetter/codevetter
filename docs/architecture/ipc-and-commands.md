---
title: Native boundary and command map
description: How the SwiftUI app, CLI, and MCP server share the Rust verification core.
sidebar:
  order: 2
---

# Native boundary and command map

## The boundary

CodeVetter has three synchronized product surfaces:

- the SwiftUI/AppKit desktop app in [`apps/macos`](../../apps/macos/README.md);
- the `codevetter` CLI in [`crates/codevetter-core/src/bin/codevetter.rs`](../../crates/codevetter-core/src/bin/codevetter.rs);
- the read-only MCP server in [`crates/codevetter-core/src/bin/codevetter-mcp.rs`](../../crates/codevetter-core/src/bin/codevetter-mcp.rs).

The Rust core owns repository access, SQLite, verification orchestration, and
machine-readable receipt schemas. The native app launches the bundled CLI with
explicit arguments and decodes versioned JSON receipts. UI code may format a
receipt but must not independently redefine verdicts, evidence, or safety
policy. MCP exposes a bounded read-only projection of the same evidence.

The native process adapter is
[`VerificationRunner.swift`](../../apps/macos/CodeVetterPackage/Sources/CodeVetterFeature/VerificationRunner.swift).
Rust command implementations live under
[`crates/codevetter-core/src/commands`](../../crates/codevetter-core/src/commands).

## Command map

| Subsystem | Rust module(s) | Native consumer |
|---|---|---|
| Review and fixes | `review.rs`, `local_qualification.rs` | Review workbench |
| Testing and performance | `trex_preview.rs`, `warm_verification*.rs`, `performance_bridge.rs` | Testing and Performance |
| Repo Unpack | `unpack*.rs`, `structural_graph/`, `graph_trust.rs` | Repo Unpack |
| Usage and accounts | `local_usage.rs`, `accounts.rs`, `sessions.rs` | Usage and Settings |
| Settings and rubrics | `preferences.rs`, `rubric_settings.rs`, `setup.rs` | Settings |
| MCP access | `mcp_access.rs`, `mcp/` | Settings and `codevetter-mcp` |
| History and memories | `history*.rs`, `agent_memories.rs` | Repo Unpack and Settings |
| Agents | `agent.rs`, `agent_terminal.rs`, `session_adapters.rs` | Review execution |

## Conventions

- Add product behavior to the Rust application/core layer first and expose one
  versioned receipt across CLI, native UI, and MCP where applicable.
- Keep subprocess invocation, cancellation, output bounds, and schema checks in
  the native process adapter rather than individual views.
- Keep hot presentation state in SwiftUI. Use the Rust boundary for repository
  reads, execution, persistence, and policy—not for trivial formatting.
- Treat a schema mismatch as unavailable evidence, never as a zero or success.
