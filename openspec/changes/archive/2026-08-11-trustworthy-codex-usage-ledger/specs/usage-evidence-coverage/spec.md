## Purpose

Make every usage total communicate which evidence supports it, how much history is covered, and which portions remain estimated or unavailable.

## ADDED Requirements

### Requirement: Usage totals are partitioned by evidence tier
The system SHALL report verified transcript-derived usage, legacy estimated usage, and unavailable history as separate non-overlapping tiers and SHALL NOT merge estimated rows into a verified total.

#### Scenario: Historical sources are missing
- **WHEN** indexed sessions no longer have readable source evidence
- **THEN** the usage surface shows their preserved token and cost estimates separately from the verified total and reports the affected session count

#### Scenario: All discovered sources are verified
- **WHEN** every token-bearing session in scope reconciles from durable accepted observations
- **THEN** the coverage state is complete and the verified total may be presented without a partial-data warning

### Requirement: Coverage is a first-class result
Every token or cost aggregation SHALL include discovered, token-bearing, verified, estimated, ambiguous, missing, and stale session counts plus the observation watermark used to compute it.

#### Scenario: New transcript bytes have not been ingested
- **WHEN** a retained Codex source contains complete bytes beyond its durable observation cursor
- **THEN** the result is marked stale and identifies pending source and byte counts without claiming complete coverage

### Requirement: Evidence tiers reconcile
The system SHALL enforce that every discovered session belongs to exactly one terminal coverage state for the requested snapshot and SHALL reject a complete state when coverage counts or tier totals do not reconcile.

#### Scenario: Session appears in two tiers
- **WHEN** a session is classified as both verified and estimated in one snapshot
- **THEN** the snapshot fails qualification and is not presented as complete

