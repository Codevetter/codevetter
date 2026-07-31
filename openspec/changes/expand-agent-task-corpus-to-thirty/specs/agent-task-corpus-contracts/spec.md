## MODIFIED Requirements

### Requirement: Structural validation is distinct from publishable readiness

The non-strict command SHALL accept a structurally valid in-progress corpus and
report its exact task, lane, category, and qualification counts. The strict
readiness command MUST fail unless 30–50 structurally valid qualified
TypeScript/Node tasks cover both browser and API lanes and at least six failure
categories. The owned corpus SHALL contain at least 30 independently qualified
tasks before strict readiness reports `publishable: true`.

#### Scenario: A small sample corpus is structurally valid

- **WHEN** all documents and identities are valid but fewer than 30 qualified tasks exist
- **THEN** non-strict validation exits successfully and reports `publishable: false` with the missing readiness gates

#### Scenario: Strict breadth reaches the minimum

- **WHEN** 30 structurally valid tasks have matching qualification evidence and satisfy lane, runtime, and category gates
- **THEN** strict readiness exits successfully with exact deterministic coverage evidence

### Requirement: Seed tasks prove task-defining behavior without regressions

Every owned task SHALL expose only a public task packet and baseline fixture to
the agent workspace, SHALL declare at least one task-defining acceptance check
and one separate regression check, and SHALL bind a minimal known-good change.
Qualification MUST repeat the intended baseline failure and complete
regression-free known-good pass before the task counts as qualified. Distinct
acceptable implementation locations for one observable outcome MUST remain one
task-defining check rather than being counted as multiple outcomes.

#### Scenario: An owned task qualifies

- **WHEN** its baseline repeatedly fails only the task-defining behavior and its exact known-good change repeatedly passes all checks
- **THEN** the corpus records an immutable qualified receipt for that task

#### Scenario: One outcome has multiple valid implementation locations

- **WHEN** the same observable defect can be corrected at either of two declared implementation boundaries
- **THEN** acceptance uses one task-defining outcome and does not inflate corpus breadth by counting each location separately

## ADDED Requirements

### Requirement: Intentional decoys measure unnecessary changes

The owned corpus SHALL include an intentional lookalike decoy when it
materially measures false-positive or unnecessary-change behavior. The decoy
MUST remain agent-visible, MUST NOT be required for the task-defining fix, and
MUST have a regression check that detects byte drift. The known-good change
MUST leave the decoy untouched.

#### Scenario: The real implementation changes without decoy drift

- **WHEN** the task-defining behavior is fixed in the intended implementation and the decoy remains byte-identical
- **THEN** task-defining and decoy regression checks pass

#### Scenario: A lookalike decoy is edited unnecessarily

- **WHEN** an agent changes the decoy while correcting the real behavior
- **THEN** the decoy regression check fails and the run cannot count as regression-free
