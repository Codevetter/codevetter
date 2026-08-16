## Context

See [proposal.md](./proposal.md) for motivation. CodeVetter currently computes Usage from `cc_sessions`, message-day proration, `session_model_usage`, and a separate lineage-aware Codex ledger. That makes the app responsible for every upstream log-format, replay, model, calendar, and pricing change.

`ccusage` 20.0.20 now exposes a unified, machine-readable report across supported coding agents. Its `daily --json --offline --sections daily,weekly,monthly,session --by-agent` command loads the corpus once and returns the period, per-agent, model, and session shapes needed by the existing Usage surface. The published `ccusage` package is a launcher for platform-native optional packages rather than an importable library; the macOS arm64 binary is approximately 3.2 MB unpacked. Codex support remains labeled beta upstream, so pinning and qualification are part of the architecture rather than release hygiene alone.

CodeVetter already packages target-triple Tauri sidecars for its CLI and MCP server. The desktop release currently targets macOS arm64, while the upstream package also publishes macOS x64, Linux arm64/x64, and Windows arm64/x64 binaries.

## Goals / Non-Goals

**Goals:**

- Remove custom token arithmetic from the production read path for Claude and Codex.
- Preserve the current Usage dashboard's period, agent, model, cache, session, and cost views through one coherent normalized snapshot.
- Keep startup and idle behavior lightweight by scanning on demand, coalescing concurrent requests, and caching bounded report snapshots.
- Make engine provenance, stale data, fallback pricing, and failures explicit.
- Use the existing sidecar packaging and release-verification conventions.

**Non-Goals:**

- Replacing provider quota/window APIs with transcript estimates.
- Replacing CodeVetter's Devin tracker while upstream cannot access Devin's cloud-side usage.
- Changing the reliable provider quota/window telemetry cards.
- Forking or vendoring `ccusage` parsing logic into Rust.
- Keeping the legacy parser as a silent production fallback.
- Dropping legacy SQLite tables or deleting historical user data in this change.
- Expanding the Usage UI beyond the changes required for accurate provenance and failure states.

## Decisions

### 1. Package the native executable as a Tauri sidecar

Add a pinned `ccusage` package to the desktop build toolchain and a `prepare-ccusage-sidecar.mjs` script that resolves the target-specific native package, verifies the expected version, copies it to `src-tauri/binaries/ccusage-<target-triple>`, and preserves executable permissions. Add `binaries/ccusage` to `bundle.externalBin` and verify the packaged executable in CI and release bundles.

Dependabot checks the package weekly and opens grouped update pull requests. Updates remain pinned and must pass the sidecar, JSON-contract, retained-corpus, and dependency-security gates before merge; production builds never fetch `latest` dynamically.

This is a justified new production dependency because it replaces the production accounting engine, is MIT licensed, runs locally, and avoids requiring a user-managed Node/Bun installation. Importing a JavaScript library is not viable because v20 publishes only the CLI launcher and native executables. Calling `pnpm dlx` or a PATH-installed binary was rejected because it adds network, version, runtime, and user-environment drift.

### 2. Use one unified multi-section JSON invocation per refresh

The Rust adapter will invoke the sidecar directly, without a shell, using an app-controlled config and arguments equivalent to:

```text
ccusage daily --json --offline --sections daily,weekly,monthly,session --by-agent --timezone <iana-zone>
```

The adapter will pass CodeVetter's configured source roots through the supported source environment variables, set a bounded execution timeout and output limit, capture stderr for diagnostics, and validate every numeric field as finite and non-negative. A controlled config path prevents a project or user `ccusage` config from silently changing CodeVetter semantics.

One command is preferable to separate daily, weekly, monthly, session, and per-agent calls because upstream performs one corpus load and returns internally reconcilable sections.

### 3. Introduce one normalized report IPC contract

Create a backend module that deserializes the pinned upstream schema into private raw structs, validates cross-section totals, and maps it to a stable CodeVetter `LocalUsageReport`. The public shape contains:

- daily, weekly, and monthly buckets;
- per-agent and per-model token classes and API-equivalent cost;
- session rows with stable source identity and last activity;
- provenance: engine name/version, generated time, timezone, requested window, detected agents, freshness, and pricing/fallback state;
- an explicit unavailable/degraded error category.

The existing `get_token_usage_stats`, `get_agent_usage_by_day`, and `get_usage_by_model` consumers will be migrated to selectors over this one report. They must not each execute `ccusage`. `inputTokens` is treated as non-cached input, `cacheReadTokens` and `cacheCreationTokens` remain separate, generated tokens equal non-cached input plus output, and total tokens use the upstream total.

### 4. Coalesce and cache report generation outside SQLite

Store the last successful normalized report and its source-freshness fingerprint in application state, not as a second canonical ledger. Concurrent requests share one in-flight process. A short freshness window prevents repeated scans during one render, while an explicit refresh or detected source change invalidates the cache.

SQLite remains authoritative for session search, transcript history, verification evidence, and legacy estimates. It no longer supplies supported transcript-backed Usage totals. Persisting copied `ccusage` rows as a new ledger was rejected because it would create another repair and reconciliation system.

### 5. Fail closed and keep metric families separate

If the sidecar is missing, times out, returns a non-zero exit, exceeds output limits, or violates the pinned JSON contract, Usage shows the last successful snapshot as stale when available and otherwise shows unavailable. The app does not query the old arithmetic path to fill the gap.

Provider quota/window telemetry remains unchanged because it describes account limits, not transcript-derived spend. The local-usage visualization combines one coherent Claude/Codex `ccusage` snapshot with the existing Devin-only rows and labels that boundary explicitly. Cursor, Grok, and other unsupported providers are excluded from this chart.

### 6. Qualify before switching, then retire writes without deleting data

During implementation, a qualification-only dual run will compare pinned `ccusage` output with retained fixtures and the current ledger to explain expected differences. Acceptance is based on upstream fixture correctness and stable reruns, not forced equality with known-buggy legacy totals. The production IPC switches atomically only after the contract and retained-corpus gates pass.

After the switch, stop maintaining custom usage observations, repair migrations, and pricing calculations that exist only for the Usage dashboard. Leave legacy tables intact for rollback and historical inspection; destructive schema removal requires a later explicit change.

## Risks / Trade-offs

- **Upstream Codex support is beta and JSON can change** → Pin the exact version, deserialize strictly, retain fixture snapshots, and make upgrades explicit qualification events.
- **A third-party binary expands the release supply chain** → Lock package integrity with pnpm, verify package version/license and bundled binary execution in CI, and fail release preparation on target mismatch.
- **Large transcript corpora can make on-demand scans noticeable** → Use the unified multi-section command, one in-flight run, short-lived caching, source-change invalidation, and a measured latency budget.
- **Offline pricing can be incomplete for newly released models** → Preserve zero/unpriced or fallback indicators and distinguish token completeness from pricing completeness.
- **`ccusage` does not support every provider CodeVetter knows about** → Keep unsupported-provider quota and ledger data separate and never blend it into transcript-backed totals.
- **Removing CodeVetter's event ledger reduces bespoke diagnostics** → Retain legacy data non-destructively and show only provenance and uncertainty that the upstream contract can actually support.
- **A sidecar failure can temporarily remove totals** → Show the last successful snapshot as stale, expose a retry, and avoid a silent fallback whose disagreement would reintroduce the original problem.

## Migration Plan

1. Add and verify the pinned sidecar packaging path without changing production reads.
2. Implement raw JSON fixtures, normalized report mapping, reconciliation checks, timeout/output bounds, caching, and provenance.
3. Run a qualification-only comparison on synthetic edge cases and a retained real corpus; document expected legacy differences.
4. Switch Usage IPC consumers and the minimal provenance/error UI to the normalized report.
5. Stop production writes and startup repair work used only by Claude/Codex legacy arithmetic while retaining legacy tables and Devin accounting.
6. Handle any destructive schema cleanup in a separate approved change.

Rollback uses the prior application release. No rollback rewrites transcript files or deletes legacy tables.
