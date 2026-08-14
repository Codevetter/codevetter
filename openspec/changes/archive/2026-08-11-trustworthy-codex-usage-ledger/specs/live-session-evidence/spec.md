## ADDED Requirements

### Requirement: Codex usage evidence survives transcript pruning
The live indexer SHALL durably append content-free token observations, lineage metadata, pricing inputs, source identity, and the completed-byte cursor before reporting that source as ingested.

#### Scenario: Codex deletes an ingested transcript
- **WHEN** a transcript disappears after its completed usage events were committed
- **THEN** its accepted observations remain verified and queryable with a source-missing retention status

#### Scenario: Observation transaction fails
- **WHEN** session metadata is readable but the durable usage observation transaction fails
- **THEN** the source cursor does not advance past the uncommitted events and the next pass retries them idempotently

### Requirement: Observation identity is stable across restarts
Each accepted or excluded event SHALL have a deterministic identity derived from immutable source identity and event position so repeated scans cannot duplicate usage.

#### Scenario: App restarts after committing observations
- **WHEN** the same unchanged source is scanned again after restart
- **THEN** no additional usage is accepted and the persisted totals remain byte-for-byte stable

