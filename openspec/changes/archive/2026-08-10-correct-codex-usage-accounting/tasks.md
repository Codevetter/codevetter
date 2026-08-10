## 1. Accounting Contract and Fixtures

- [x] 1.1 Add sanitized Codex fixtures for ordinary progression, rate-limit-only duplicate snapshots, incremental boundaries, fork inheritance, cumulative resets, and interleaved lineages.
- [x] 1.2 Add an independent fixture oracle that declares accepted deltas, dispositions, session totals, model totals, and local-day totals.
- [x] 1.3 Add failing adapter tests proving one-shot and arbitrarily chunked parsing must match the oracle exactly.

## 2. Persistent Usage Evidence

- [x] 2.1 Add migration-backed Codex usage observation, accounting state, repair audit, and diagnostic storage with appropriate uniqueness and period-query indexes.
- [x] 2.2 Add query helpers that transactionally replace or append observations and reconcile session/model totals from accepted rows.
- [x] 2.3 Add schema and query tests for idempotency, uniqueness, replacement, pending-state reporting, and preservation of unrelated providers.

## 3. Codex Accounting State Machine

- [x] 3.1 Implement structural token-count normalization including event timestamp, turn/model evidence, all token classes, cumulative snapshot, and source position.
- [x] 3.2 Implement unchanged-total suppression and persisted incremental accounting state.
- [x] 3.3 Implement fork-baseline ownership, monotonic component watermarks, and conservative interleaved-lineage containment.
- [x] 3.4 Persist accepted/excluded observations and derive canonical session/model/local-day totals from accepted deltas.
- [x] 3.5 Run focused Rust tests for all accounting fixtures and exact one-shot-versus-incremental equivalence.

## 4. Live Ingestion and Usage Queries

- [x] 4.1 Separate bounded Codex usage ingestion from archive/FTS serialization so maintenance cannot suppress eligible usage work.
- [x] 4.2 Prioritize recently modified Codex sources and expose last observation, incomplete source count, and pending byte count.
- [x] 4.3 Change period usage and cost queries to use accepted timestamped Codex observations while preserving existing paths for other agents.
- [x] 4.4 Refresh headline/account telemetry on accepted usage events and surface compact freshness/exclusion diagnostics in the existing Usage view.
- [x] 4.5 Run focused backend and frontend tests for live freshness, calendar boundaries, and provider isolation.

## 5. Repair and Validation

- [x] 5.1 Implement a revisioned, idempotent streaming repair for readable Codex transcripts with unrepaired diagnostics for missing sources.
- [x] 5.2 Run the repair against a copy of the user's database and reconcile session/day/model totals against an independent scanner without printing transcript content.
- [x] 5.3 Compare repaired aggregate output with current CodexBar/ccusage invariants and investigate every material discrepancy before enabling the migration.
- [x] 5.4 Run the smallest relevant Rust tests first, then desktop unit/lint/type checks and documentation validation.
- [x] 5.5 Record the validated accounting behavior and any unrecoverable historical limits in the canonical telemetry documentation.
- [x] 5.6 Add a fail-closed completion gate that derives repaired totals from persisted observations, verifies exact session/model aggregates, and refuses revision completion after any write or audit mismatch.
- [x] 5.7 Add regression tests proving reconciliation failures cannot mark a repair revision complete, then rerun frozen-copy and full validation.
