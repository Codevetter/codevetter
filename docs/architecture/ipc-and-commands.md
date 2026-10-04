---
title: Native boundary and command map
description: How the SwiftUI app, CLI, and MCP server share the Rust verification core.
sidebar:
  order: 2
---

# Native boundary and command map

## The boundary

CodeVetter has three synchronized product surfaces:

- the SwiftUI/AppKit desktop app in [`apps/macos`](https://github.com/Codevetter/codevetter/blob/main/apps/macos/README.md);
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
[`crates/codevetter-core/src/commands`](https://github.com/Codevetter/codevetter/tree/main/crates/codevetter-core/src/commands).

## Command map

| Subsystem | Rust module(s) | Native consumer |
|---|---|---|
| Review and fixes | `review.rs`, `local_qualification.rs` | Review workbench |
| Testing and performance | `trex_preview.rs`, `warm_verification*.rs`, `performance_bridge.rs` | Testing and Performance |
| Repo Unpack | `unpack*.rs`, `structural_graph/`, `graph_trust.rs` | Repo Unpack |
| Accounts | `accounts.rs`, `sessions.rs` | Settings |
| Settings and rubrics | `preferences.rs`, `rubric_settings.rs`, `setup.rs` | Settings |
| MCP access | `mcp_access.rs`, `mcp/` | Settings and `codevetter-mcp` |
| History and memories | `history*.rs`, `agent_memories.rs` | Repo Unpack and Settings |
| Agents | `agent.rs`, `agent_terminal.rs`, `session_adapters.rs` | Review execution |

## Skill invocation projection

[`invocation_events.rs`](../../crates/codevetter-core/src/commands/invocation_events.rs)
provides the pure `project_invocation_events` service and
`codevetter.invocation-events/v1` receipt. It accepts supplied skill-recorder
sessions (invocation metadata, assessment revisions and optional receipt bytes),
not provider transcripts. It performs no filesystem discovery or execution.
[`invocation_ledger.rs`](../../crates/codevetter-core/src/commands/invocation_ledger.rs)
loads an explicitly supplied recorder directory through anchored, no-follow Unix
reads, including every root path component. Symlink ancestors are rejected;
callers must supply a trusted canonical path (for example `/private/tmp` rather
than the macOS `/tmp` alias). It bounds sessions (1,000), assessment files per session (100), metadata
(16 KiB), receipts (2 MiB) and aggregate bytes (32 MiB). Entry/aggregate scan
limits fail the request rather than imply complete history; malformed records
are counted exclusions, while missing/unsafe captures do not remove invocations.
Only fixed `invocation.json`, `receipt.json` and assessment filenames are read;
recorded receipt paths are informational. Concurrent reads are snapshots, not
transactions. Unknown source schemas are not interpreted as outcomes.

`codevetter runs --ledger <path> --json` bypasses the application database and
personal-ledger discovery. It accepts `--repo` (exact recorded path), `--task-id`,
`--skill`, `--state`, `--assessment`, `--offset` and `--limit`. `--fixture` labels
synthetic evidence; omitted origin is `unqualified_local_ledger`.

MCP exposes read-only `invocation_list` through the existing scoped envelope.
The owner binds its ledger at server startup with `--invocation-ledger <path>`
and optionally `--invocation-ledger-fixture`. Tool arguments cannot select a
path or change repository scope. Without startup binding it fails explicitly.
The same filters and totals apply; requests/reads do not execute verification.
Validated invocation commands survive MCP sanitization only at the invocation
receipt path; raw or nested command fields retain the ordinary removal policy.
Repository-scoped counts and ingestion issues exclude metadata with a known
foreign repository. Missing/unreadable repository identity is reported separately
as `unattributed_records` and `unattributed_ingestion_issues`, with no invocation
identity exposed. Unfiltered reads retain aggregate unreadable counts.
Native Runs composition remains held for owner visual selection and dedicated
acceptance. No independently verified benefit is assigned by these transports.

The service preserves command/operation and originating agent independently
of an explicitly recorded provider. Both command and provider provenance are
metadata observations; the current recorder omits provider identity, which
stays null. Missing timing, exit status and cost do not become zero or success.
Filters apply before totals and pagination. Ordering uses timestamp instants,
then invocation IDs; conflicting identities and malformed records are counted.
No observations is `unassessed`; rejected/unverifiable observations are
`unavailable`, with per-invocation error counts, rather than invented missing feedback.

Receipt hashes and schema identities qualify supplied bytes, not verdicts.
"Helped" requires nonempty hash-bound receipt evidence and remains agent-reported.
The projection does not establish independently verified benefit or productivity.
It excludes raw arguments, environments, transcripts, stderr and provider output.
Synthetic tests cover these boundaries in
[`invocation_events_tests.rs`](../../crates/codevetter-core/src/commands/invocation_events_tests.rs).

## Conventions

- Add product behavior to the Rust application/core layer first and expose one
  versioned receipt across CLI, native UI, and MCP where applicable.
- Keep subprocess invocation, cancellation, output bounds, and schema checks in
  the native process adapter rather than individual views.
- Keep hot presentation state in SwiftUI. Use the Rust boundary for repository
  reads, execution, persistence, and policy—not for trivial formatting.
- Treat a schema mismatch as unavailable evidence, never as a zero or success.
