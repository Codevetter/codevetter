# Live Session Evidence

## Purpose

Define prompt, recoverable, and locally inspectable ingestion of active agent transcript evidence.

## Requirements

### Requirement: Active local transcripts become available promptly
The system SHALL incrementally ingest complete appended messages and timestamped usage evidence from supported active local transcripts on a bounded best-effort cadence, SHALL emit a local archive-update event when new evidence is stored, and SHALL not require archive-search maintenance to complete before advancing usage evidence.

#### Scenario: Active transcript receives complete messages
- **WHEN** a supported Claude or Codex transcript appends one or more complete messages after its saved byte offset
- **THEN** the incremental pass appends normalized archive rows without rereading or replacing the already indexed prefix and emits an update summary

#### Scenario: Active Codex transcript receives usage evidence
- **WHEN** a Codex transcript appends complete token-count events after its saved byte offset while archive-search maintenance is running
- **THEN** the live pass persists accepted usage deltas and advances its usage cursor without waiting for archive-search synchronization

#### Scenario: Transcript ends with a partial message
- **WHEN** the active transcript tail does not end at a complete line
- **THEN** the system leaves the partial suffix unconsumed so a later pass can ingest it after completion

### Requirement: Missed live events recover without data loss
The system SHALL treat live ingestion as best-effort and SHALL recover skipped, coalesced, rotated, or database-contended updates through the next incremental or full index pass without making usage freshness depend on the full archive index lock.

#### Scenario: Archive maintenance is already running
- **WHEN** archive indexing or archive-search synchronization is active
- **THEN** live usage ingestion remains eligible to process unconsumed Codex token evidence through its independently serialized path

#### Scenario: Database write is temporarily contended
- **WHEN** the live usage pass cannot acquire a database write transaction within its bounded timeout
- **THEN** it returns without blocking foreground work and reports pending evidence for a later retry

#### Scenario: Session file grows between full index passes
- **WHEN** a supported transcript grows after a live pass is missed
- **THEN** the next incremental or full index uses the persisted byte/line cursor and accounting state to archive every complete unseen message and accept every canonical usage delta exactly once

### Requirement: Live ingestion policy is locally inspectable
The system SHALL expose a versioned local policy/status contract identifying the incremental mode, supported adapters, cadence, recovery path, last indexed timestamp, last usage observation, and pending source/byte counts without requiring a network listener.

#### Scenario: UI requests live-session status
- **WHEN** the desktop UI requests the live-session evidence policy
- **THEN** it receives the current cadence, adapter coverage, recovery mode, local-only status, usage freshness, and pending evidence counts from the same backend that owns indexing

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
