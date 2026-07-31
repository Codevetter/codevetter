## MODIFIED Requirements

### Requirement: Evaluation is local, deterministic, and provider-neutral
The system SHALL read only explicitly supplied local manifests and receipts,
produce deterministically ordered machine-readable JSON and Markdown from the
same scorecard, and perform no model calls, network requests, repository
mutation, checkout, hidden-test execution, or agent launch. When supplied
projected provider-neutral runner evidence, it MUST derive outcomes only from
validated receipts and MUST preserve the existing structural-context scorer as
the sole outcome and qualification authority.

#### Scenario: Synthetic fixture is scored
- **WHEN** the checked-in hermetic fixture is passed to the evaluator
- **THEN** repeated runs produce equivalent normalized results and state that the fixture cannot establish real product value

#### Scenario: User has not supplied agent receipts
- **WHEN** no real paired run receipts are present
- **THEN** the evaluator performs no agent work and makes no claim that structural context improves outcomes

#### Scenario: Runner receipts are projected
- **WHEN** a validated receipt bundle is composed into an evaluator manifest
- **THEN** the existing scorer applies the same pairing, outcome, isolation, and qualification rules used for a directly supplied manifest
