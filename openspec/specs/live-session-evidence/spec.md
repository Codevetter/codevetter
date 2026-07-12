# Live Session Evidence

## Purpose

Define prompt, recoverable, and locally inspectable ingestion of active agent transcript evidence.

## Requirements

### Requirement: Active local transcripts become available promptly
The system SHALL incrementally ingest complete appended messages from supported active local transcripts on a bounded best-effort cadence and SHALL emit a local archive-update event when new evidence is stored.

#### Scenario: Active transcript receives complete messages
- **WHEN** a supported Claude or Codex transcript appends one or more complete messages after its saved byte offset
- **THEN** the incremental pass appends normalized archive rows without rereading or replacing the already indexed prefix and emits an update summary

#### Scenario: Transcript ends with a partial message
- **WHEN** the active transcript tail does not end at a complete line
- **THEN** the system leaves the partial suffix unconsumed so a later pass can ingest it after completion

### Requirement: Missed live events recover without data loss
The system SHALL treat live ingestion as best-effort and SHALL recover skipped, coalesced, rotated, or lock-contended updates through the next incremental or full index pass.

#### Scenario: Full index is already running
- **WHEN** the live tail pass cannot acquire the index lock
- **THEN** it returns without blocking foreground work and the later scheduled pass remains able to ingest the same unconsumed bytes

#### Scenario: Session file grows between full index passes
- **WHEN** a supported transcript grows after a live pass is missed
- **THEN** the next incremental or full index uses the persisted byte/line cursor to archive every complete unseen message exactly once

### Requirement: Live ingestion policy is locally inspectable
The system SHALL expose a versioned local policy/status contract identifying the incremental mode, supported adapters, cadence, recovery path, and last indexed timestamp without requiring a network listener.

#### Scenario: UI requests live-session status
- **WHEN** the desktop UI requests the live-session evidence policy
- **THEN** it receives the current cadence, adapter coverage, recovery mode, and local-only status from the same backend that owns indexing
