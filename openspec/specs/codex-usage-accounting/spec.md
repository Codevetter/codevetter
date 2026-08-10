# Codex Usage Accounting

## Purpose

Provide deterministic local Codex token and cost accounting whose session and calendar-period totals are reproducible from timestamped transcript evidence.

## Requirements

### Requirement: Usage events are counted exactly once
The system SHALL derive Codex usage from token-count evidence and SHALL count an unchanged cumulative usage snapshot no more than once, even when Codex re-emits the preceding per-event usage during a rate-limit-only update.

#### Scenario: Ordinary cumulative progression
- **WHEN** consecutive token-count events contain increasing cumulative totals and matching per-event usage
- **THEN** the system accepts one delta per cumulative increase and the accepted deltas sum to the final cumulative total

#### Scenario: Rate-limit-only re-emission
- **WHEN** a token-count event repeats a previously observed cumulative total and repeats its `last_token_usage`
- **THEN** the system records no additional tokens or cost for that event

#### Scenario: Incremental read boundary
- **WHEN** a duplicate cumulative snapshot appears after a persisted incremental byte boundary
- **THEN** persisted accounting state suppresses the duplicate exactly as a single full-file scan would

### Requirement: Forked and interleaved usage is attributed without replay
The system SHALL exclude inherited parent usage from child sessions and SHALL prevent cumulative-counter resets or lineage interleaving from recounting previously accepted usage.

#### Scenario: Fork begins with inherited cumulative totals
- **WHEN** a child transcript begins with cumulative usage inherited from its parent
- **THEN** the inherited baseline contributes zero child usage and only subsequent child-owned growth is counted

#### Scenario: Cumulative components fall below their watermark
- **WHEN** an observed cumulative snapshot decreases in any token component because another lineage or reset is interleaved
- **THEN** the system retains a monotonic watermark and accepts only usage contained by new cumulative growth

#### Scenario: Fork baseline cannot be resolved
- **WHEN** the system cannot establish ownership from a consistent child-local baseline or copied-history boundary
- **THEN** it excludes ambiguous usage from canonical totals and reports the exclusion diagnostically

### Requirement: Calendar totals follow usage-event timestamps
The system SHALL attribute each accepted Codex usage delta and its API-equivalent cost to the local calendar day containing that token-count event.

#### Scenario: Long-running session crosses midnight
- **WHEN** one Codex session emits accepted token deltas on multiple local calendar days
- **THEN** each day contains exactly the deltas observed on that day without prorating the final session total by message count

#### Scenario: Session and period reconciliation
- **WHEN** all accepted events for a session fall inside a requested period
- **THEN** the period token classes and cost equal that session's canonical totals

### Requirement: Existing data is repaired reproducibly
The system SHALL provide an idempotent Codex-only rebuild that replaces derived session totals and daily usage with values reconstructed from transcripts that remain available. It SHALL mark an accounting revision complete only after every readable session has been reconciled from persisted accepted observations and every unreadable session has a durable unrepaired audit record.

#### Scenario: Repair runs twice
- **WHEN** the same unchanged transcript corpus is repaired twice
- **THEN** session totals, daily totals, costs, and diagnostics are identical after both runs

#### Scenario: Historical source is unavailable
- **WHEN** an indexed Codex session no longer has a readable source transcript
- **THEN** the system preserves its existing totals, marks them unrepaired, and does not fabricate daily evidence

#### Scenario: Persisted totals fail reconciliation
- **WHEN** any session, model, or accepted-observation aggregate differs during repair, or any repair/audit transaction fails
- **THEN** the system leaves the revision incomplete so the migration retries and never presents the corpus as verified

### Requirement: Accounting exclusions are inspectable
The system SHALL expose local diagnostics sufficient to distinguish accepted usage, duplicate snapshots, inherited replay, unsupported rows, incomplete cursors, and stale observations without exposing transcript content.

#### Scenario: User inspects stale usage
- **WHEN** one or more Codex sources contain complete bytes beyond their saved cursor
- **THEN** diagnostics report the affected source count, pending byte count, and last successful usage observation

### Requirement: Monetary values state their pricing semantics
Codex monetary values SHALL be labeled API-equivalent estimates rather than actual subscription spend and SHALL expose pricing completeness separately from token completeness.

#### Scenario: Service tier is absent
- **WHEN** retained evidence identifies token counts and model but not the request service tier needed for exact list pricing
- **THEN** the system reports an explicitly bounded estimate or marks pricing incomplete instead of claiming an exact dollar value

#### Scenario: Model is unpriced
- **WHEN** accepted usage references a model without a pinned rate
- **THEN** tokens remain verified while cost is reported as unpriced and excluded from any complete-cost claim

### Requirement: Historical recovery preserves provenance
The historical backfill SHALL attempt configured Codex homes and explicit user imports, SHALL fingerprint recovered sources, and SHALL retain legacy stored totals as estimated when source evidence cannot be recovered.

#### Scenario: Missing source is recovered from an imported home
- **WHEN** a source with matching stable session identity is found under an additional configured root
- **THEN** the session is replayed into verified observations and its prior legacy estimate is superseded without double counting

#### Scenario: Source remains unavailable
- **WHEN** no matching readable evidence can be recovered
- **THEN** the preserved historical row remains visible only in the legacy estimated tier

### Requirement: Quota and compute remain distinct
Provider rate-limit windows and transcript-derived token or cost totals SHALL be labeled and stored as different metric families.

#### Scenario: Subscription window resets
- **WHEN** a provider quota percentage drops because its rolling window resets
- **THEN** historical compute totals remain unchanged and the UI does not describe quota consumption as token spend
