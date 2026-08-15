## ADDED Requirements

### Requirement: Campaign execution requires current local admission
The system SHALL derive and validate a current performance-execution plan before
running campaign correctness or performance scopes. A blocked, stale, or
identity-mismatched plan MUST leave the campaign in `no_confidence` and MUST NOT
execute project code or consume an experiment attempt.

#### Scenario: Baseline is admitted locally
- **WHEN** every declared campaign scope has a current admitted zero-egress plan
- **THEN** the campaign may execute the bounded baseline and attach the admission receipts to its evidence

#### Scenario: Candidate contains a remote workload
- **WHEN** any correctness or performance scope has remote, paid, or unknown-cost evidence
- **THEN** the campaign records `no_confidence` with the blocked admission receipt before executing any declared scope
