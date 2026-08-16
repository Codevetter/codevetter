## 1. Pin and package the accounting engine

- [x] 1.1 Add the exact approved `ccusage` version to the desktop build toolchain, record its MIT license and package-integrity expectations, and configure weekly automated update pull requests gated by qualification.
- [x] 1.2 Add a target-aware preparation script that resolves the matching native package, verifies its version, copies it to the Tauri target-triple sidecar path, and preserves executable permissions.
- [x] 1.3 Register the `ccusage` external binary in Tauri configuration and wire sidecar preparation into development, CI, and release build commands.
- [x] 1.4 Add preparation-script tests for supported target mapping, version mismatch, missing optional package, and executable output.
- [x] 1.5 Extend CI and release bundle verification to execute the packaged sidecar's version command.

## 2. Build the normalized local usage adapter

- [x] 2.1 Add retained JSON fixtures for the pinned unified multi-section output, including multiple agents, cache creation/read tokens, model fallback, unpriced cost, and empty data.
- [x] 2.2 Define private raw `ccusage` response types and a stable normalized `LocalUsageReport` contract with period, agent, model, session, provenance, freshness, and error fields.
- [x] 2.3 Implement direct no-shell sidecar execution with an app-controlled config, explicit offline/timezone/window arguments, supported source-root environment variables, timeout, and output-size bounds.
- [ ] 2.4 Validate non-negative finite numeric fields and reconcile aggregate, agent, model, and session sections before accepting a snapshot.
- [x] 2.5 Map upstream token semantics into CodeVetter generated, cache-read, cache-creation, output, total, cost, fallback, and pricing-completeness fields.
- [ ] 2.6 Add focused Rust tests for valid reports and missing binary, non-zero exit, timeout, oversized output, invalid JSON, invalid numbers, and reconciliation failures.

## 3. Coalesce, cache, and expose reports

- [x] 3.1 Add application state that coalesces concurrent usage requests onto one in-flight accounting run.
- [x] 3.2 Cache the last successful normalized snapshot with a short freshness window and a bounded source-freshness fingerprint; support explicit invalidation and refresh.
- [x] 3.3 Return stale last-known-good data with diagnostics after a refresh failure, and return an unavailable result when no valid snapshot exists.
- [x] 3.4 Add one typed Tauri IPC command for the normalized report and register it in the desktop backend and frontend wrapper.
- [ ] 3.5 Add concurrency, cache-hit, invalidation, stale-snapshot, and unavailable-state tests without scanning the operator's live transcript corpus.

## 4. Qualify the accounting cutover

- [ ] 4.1 Add deterministic synthetic transcripts covering duplicate cumulative events, fork replay, interleaved resets, midnight boundaries, multiple models, archived sessions, and duplicate roots.
- [ ] 4.2 Run the pinned engine twice over the synthetic and retained corpora and require identical normalized snapshots.
- [ ] 4.3 Compare the pinned engine with current CodeVetter totals in qualification-only mode, classify every material difference, and update fixtures only for explained upstream-correct behavior.
- [ ] 4.4 Establish and enforce latency, peak-memory, and output-size budgets for a representative large local corpus.
- [ ] 4.5 Verify normal report generation performs no network request and does not modify source transcripts.

## 5. Switch the Usage surface

- [x] 5.1 Migrate aggregate period cards and charts to selectors over the normalized report plus Devin-only local rows.
- [x] 5.2 Migrate Claude/Codex agent filters, model breakdowns, and session counts to the same report snapshot and retain only Devin from legacy local accounting.
- [ ] 5.3 Add compact provenance, stale, retry, unavailable, fallback-model, and incomplete-pricing states while preserving the existing Usage layout.
- [x] 5.4 Keep the reliable quota/window telemetry unchanged; exclude Cursor/Grok from the local chart and label Devin's separate local source.
- [ ] 5.5 Add frontend unit and Playwright coverage for coherent snapshot rendering, filters, stale retry, sidecar failure, and pricing uncertainty.

## 6. Retire duplicate production accounting

- [x] 6.1 Switch production Claude/Codex Usage reads atomically to `ccusage` with no silent fallback; use application rollback rather than retaining a duplicate runtime path.
- [x] 6.2 Stop startup repair and ledger-write paths used only to maintain custom Claude/Codex usage totals while preserving session indexing and Devin accounting.
- [x] 6.3 Remove dead pricing and reconciliation code made obsolete by the cutover, while leaving legacy SQLite tables, user data, and Devin aggregation intact.
- [ ] 6.4 Run targeted Rust and frontend tests first, then desktop lint, typecheck, unit tests, production build, strict dependency/security checks, docs validation, and `git diff --check`.
- [x] 6.5 Update canonical usage/architecture docs and `PROJECT_STATUS.md` after the focused implementation checks pass.
- [x] 6.6 Keep rollback at the application-release boundary; track any destructive legacy-schema cleanup as a separate explicitly approved change.
