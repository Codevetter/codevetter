# staged-change-verification Specification

## Purpose
TBD - created by archiving change consolidate-taste-into-codevetter. Update Purpose after archive.
## Requirements
### Requirement: One staged verification outcome
CodeVetter SHALL represent verification of a code change as an ordered sequence of code review, executable testing, and audience validation, and SHALL expose one aggregate outcome with evidence from every completed stage.

#### Scenario: Full user-facing verification
- **WHEN** a user-facing change completes review, executable testing, and audience validation
- **THEN** CodeVetter shows the result of each stage and an aggregate outcome linked to the underlying findings, test artifacts, and audience evidence

#### Scenario: Backend-only change does not need audience validation
- **WHEN** the operator marks audience validation not applicable and records a reason
- **THEN** CodeVetter preserves the waiver and can complete the aggregate outcome from review and executable-test evidence without claiming audience validation occurred

### Requirement: Stage provenance and status
Each stage SHALL have an explicit status, timestamp, provenance, and evidence references. A stage MUST NOT be shown as passed solely because an earlier stage passed.

#### Scenario: Review passes but browser QA fails
- **WHEN** review completes without blocking findings and executable browser QA fails
- **THEN** the aggregate outcome remains unverified or blocked and identifies the failed QA evidence

### Requirement: Backward compatibility
Existing CodeVetter reviews and synthetic-QA records SHALL remain readable when they have no staged-verification metadata.

#### Scenario: Open an older review
- **WHEN** CodeVetter loads a review created before staged verification exists
- **THEN** it renders the existing review normally and labels unavailable later stages as not run rather than failed

