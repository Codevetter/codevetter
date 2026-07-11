# audience-validation Specification

## Purpose
TBD - created by archiving change consolidate-taste-into-codevetter. Update Purpose after archive.
## Requirements
### Requirement: Explicit audience definition
An audience-validation run SHALL define the target audience, behavior or decision being tested, candidate experience, success criterion, and minimum evidence before collecting judgments.

#### Scenario: Create a validation run
- **WHEN** an operator starts audience validation for an onboarding change
- **THEN** CodeVetter requires an audience description, onboarding task, candidate route or artifact, and decision threshold

### Requirement: Validation-mode provenance
Every audience response SHALL identify whether it came from an evaluator agent, a human participant, or an imported external result, and CodeVetter MUST NOT describe agent-only evidence as human validation.

#### Scenario: Agent panel only
- **WHEN** only evaluator agents have completed the audience task
- **THEN** CodeVetter labels the result agent-simulated and keeps human-validation status unfulfilled

#### Scenario: Human responses are imported
- **WHEN** structured human responses are added to the same validation run
- **THEN** CodeVetter reports human and agent evidence separately and may provide a mixed summary without erasing provenance

### Requirement: Structured audience response
Audience responses SHALL support a candidate choice or task result, criterion ratings, confidence, optional feedback, presentation order, elapsed time when available, and an evidence reference.

#### Scenario: Record a human task result
- **WHEN** a target user completes the defined task and submits feedback
- **THEN** CodeVetter stores the response against the validation run and includes it in aggregate signal diagnostics

### Requirement: Privacy-minimizing local storage
CodeVetter SHALL store audience evidence locally by default and SHALL NOT require participant names, email addresses, or other direct identifiers.

#### Scenario: Anonymous participant
- **WHEN** the operator records a response without personal information
- **THEN** CodeVetter assigns a local opaque participant identifier and preserves the response's provenance and evidence

### Requirement: Audience outcome in verification proof
The copied verification proof SHALL state the audience definition, validation mode, response count, signal strength, disagreements, caveats, and decision impact.

#### Scenario: Insufficient audience evidence
- **WHEN** the response count is below the configured minimum
- **THEN** the proof labels the audience stage incomplete and does not elevate the aggregate verification outcome

