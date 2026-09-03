# Native Codex history-root qualification

Date: 2026-09-02
Surface: native macOS Usage settings, CLI, and generated capability registry

## Result

Additional Codex history recovery now uses one Rust-owned
`codevetter.history-roots/v1` contract. Native Settings and
`codevetter history-roots` can list, add, and remove the same bounded roots.
Selecting a `sessions` or `archived_sessions` directory normalizes to its
canonical Codex home before persistence.

Rust rejects unrelated directories, relative or malformed stored paths, more
than 16 roots, and combined add/remove requests. Duplicate canonical roots are
idempotent. Each receipt reports directory availability without reading
transcript content. Removing a root changes future discovery only and never
deletes provider files.

The generated capability registry marks native UI and CLI read/execute
authority as available. MCP and agent authority remain unavailable because
local history-path mutation is not required for evidence inspection.

## Executable proof

- two focused Rust service tests pass normalization, deduplication, removal,
  transcript non-disclosure, unrelated-directory rejection, and malformed
  stored-path rejection;
- the focused CLI parser test passes read/add/remove exclusivity;
- two focused Swift tests pass exact CLI argument/schema validation and
  offscreen native rendering;
- the complete headless native lane passes 80 Swift tests with zero failures
  and the Debug macOS application build through XcodeBuildMCP;
- a temporary end-to-end CLI smoke normalized a selected `sessions` directory,
  reported active and archived availability, and returned zero configured
  roots after removal.

## Boundaries

- The active `CODEX_HOME` remains automatic and is not duplicated in this
  additional-root receipt.
- Adding or removing a root does not start Usage reconciliation.
- No transcript body, credential, provider token, or secret enters the receipt.
- This qualification does not cover live provider telemetry, production
  signing, installation, updater cutover, or Tauri retirement.
