# Native Repo Unpack scan parity receipt

Date: 2026-09-01
Scope: deterministic local scan, persistence, and bounded native inspection
Schema: `codevetter.unpack-scan/v1`

## Result

The incumbent Tauri command, `codevetter unpack --operation scan`, and the
native Repo Unpack workspace now reuse the same Rust scan and persistence
boundary. The operation invokes no model, writes the canonical snapshot only
to the local SQLite evidence store, and returns a bounded client projection
without the raw full-file list.

The native workspace can start and cancel the supervised CLI process, refresh
the snapshot ledger, inspect the persisted record, and render Overview, stored
Brief, Activity, Inventory, bounded Graph, and commit-range Delta desks. It can
render deterministic Analysis, observed Rules, and source-qualified Handoff;
the Handoff desk falls back to inventory entrypoints and test leads when no
model-labelled report is attached. It can
also save the Rust-rendered Markdown, offline HTML, graph JSON, agent-context
Markdown, or repository-memory Markdown after the user chooses a destination.
History, topology, and
deterministic health remain labelled as navigation evidence rather than
executable proof.

## Cross-surface authority

| Surface | Authority | Qualified behavior |
| --- | --- | --- |
| Rust core | Authoritative execute/persist | Scans, profiles, persists, and emits the canonical receipt |
| Tauri | Supervised projection | Uses the shared core and preserves detailed progress events |
| CLI | Supervised projection | Validates the directory, invokes the shared core, and emits JSON or a human summary |
| Native | Supervised projection | Sends exact scan arguments, validates receipt identity, supports cancellation, and reloads the persisted snapshot |
| MCP | Read-only | May query an explicitly enabled stored graph/history index; it cannot start a scan |

Comparison is read-only and bounded to 24 commits. Export returns
`codevetter.unpack-export/v1`; Rust renders the content and the native client
writes that exact content to the user-selected local destination.

## Executable proof

- Rust shared persistence test: 1/1 passed; the stored inventory remains
  complete while the client projection caps the file list.
- CLI parser contract: passed for explicit scan/list/inspect operations and
  invalid argument combinations.
- Isolated CLI smoke: passed against a temporary app-data directory and emitted
  both `full_scan` and `local_scan_persist` profiles.
- Isolated CLI comparison/export smoke: passed for one exact Git commit range
  and a 4,523-byte repository-memory export from a temporary app-data database.
- Swift supervised-runner contract: passed exact arguments, schema, status,
  canonical path, and profile validation.
- Swift package gate: 56/56 passed.
- Native Debug compile: passed through XcodeBuildMCP 2.7.0.
- Foreground native UI suite: 9/9 passed. Repo Unpack navigation, explicit
  repository selection, disabled-without-input scan authority, export control,
  and Rust-owned SQLite boundary are reachable through accessibility IDs.
- Large native projection: passed for 100 snapshots, 700 graph nodes, and 1,000
  source-tree rows; the offscreen dark render is
  `artifacts/design/native-unpack-scan-dark.png`.

The only known Rust warning remains the pre-existing unused
`RawPeriod.totals` and `RawPeriod.model_breakdowns` fields in
`local_usage.rs`.

## Remaining boundary

This scan receipt did not qualify interactive graph/history queries. That
later slice is recorded separately in
[Native repository query parity](native-repository-query-2026-09-01.md). Model
synthesis execution, cleanup, richer graph traversal and causal history,
foreground owner acceptance, signing/notarization, release, and Tauri
retirement remain outside this receipt.
