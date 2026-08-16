## Why

CodeVetter has repeatedly repaired its own token parsers, replay handling, calendar attribution, and pricing tables as agent log formats evolve. `ccusage` now provides local, read-only reports for Codex and the other supported coding-agent CLIs, so CodeVetter should consume that maintained accounting engine instead of continuing to own a competing implementation.

## What Changes

- Bundle a pinned `ccusage` native executable with CodeVetter and invoke its JSON reports internally; users will not need Node, Bun, `npx`, or a separately installed CLI.
- Make `ccusage` the authoritative source for Claude and Codex local daily, weekly, monthly, session, model, token-class, and API-equivalent cost totals.
- Normalize `ccusage` JSON into CodeVetter's existing typed IPC shapes and cache only derived report snapshots and provenance needed for responsive rendering.
- Keep the reliable provider quota/window telemetry unchanged. Preserve CodeVetter's existing Devin tracking in the local-usage chart because upstream `ccusage` cannot read Devin's cloud-side usage; exclude other providers from that chart.
- Remove the custom usage-arithmetic path after a pinned-corpus parity gate passes. A missing, incompatible, timed-out, or invalid `ccusage` sidecar will surface an unavailable/degraded state instead of silently falling back to CodeVetter's old counters.
- Replace CodeVetter-specific “verified” claims with explicit `ccusage` provenance, version, report timestamp, source coverage, and fallback-model indicators where the upstream JSON exposes them.

## Capabilities

### New Capabilities

- `ccusage-backed-local-usage`: Defines the bundled runtime, authoritative report contract, privacy boundary, provenance, and fail-closed behavior for local usage accounting.

### Modified Capabilities

- `codex-usage-accounting`: Delegates canonical Codex token and cost calculation to the pinned `ccusage` engine and retires CodeVetter's parallel parser as a production source of truth.
- `usage-evidence-coverage`: Reports the coverage and uncertainty present in `ccusage` output without overstating CodeVetter-level event verification.

## Impact

- Affected backend surfaces include usage commands in `apps/desktop/src-tauri/src/commands/history.rs`, usage queries and legacy accounting tables in `apps/desktop/src-tauri/src/db/`, command registration, and a new narrow sidecar adapter.
- Affected frontend surfaces include the Usage dashboard's report types, loading/error/provenance states, and removal or relabeling of Codex-specific reconciliation claims that `ccusage` cannot substantiate.
- Build and release work adds a pinned MIT-licensed `ccusage` production toolchain dependency and packages its platform-native executable using the repository's existing Tauri sidecar pattern. The current macOS arm64 package is approximately 3.2 MB unpacked.
- CI gains fixture-contract tests for `ccusage` JSON, sidecar presence/version checks, and parity qualification against the retained accounting corpus before the legacy production path is removed.
- No transcript content leaves the machine. Runtime report generation is local and read-only; network-dependent pricing refreshes are disabled in favor of the packaged/offline data path.
