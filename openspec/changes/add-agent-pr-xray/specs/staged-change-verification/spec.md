## MODIFIED Requirements

### Requirement: Stage provenance and status
Each stage SHALL have an explicit status, timestamp, provenance, and evidence references. Persisted stage evidence MUST be structured enough to support a sanitized X-Ray export, and a stage MUST NOT be shown as passed solely because an earlier stage passed.

#### Scenario: Review passes but browser QA fails
- **WHEN** review completes without blocking findings and executable browser QA fails
- **THEN** the aggregate outcome remains unverified or blocked and identifies the failed QA evidence

#### Scenario: Stage is included in an X-Ray
- **WHEN** a completed verification is selected for public X-Ray export
- **THEN** each exported stage retains its status, timestamp, provenance kind, and approved evidence references
- **AND** missing or non-public evidence is represented as unavailable rather than silently dropped
