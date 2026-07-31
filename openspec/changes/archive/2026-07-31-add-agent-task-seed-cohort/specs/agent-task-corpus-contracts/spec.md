## ADDED Requirements

### Requirement: The owned seed cohort spans realistic web-agent failure modes
Before full publication breadth, the in-progress corpus SHALL contain qualified
owned seed tasks for browser state, authorization, API contracts, validation,
async/concurrency, persistence, integration, and regression behavior. The
cohort MUST include both browser and API lanes and both Node and TypeScript
runtimes, with exact category and coverage counts reported by normal corpus
validation.

#### Scenario: Every seed category is present
- **WHEN** the owned seed corpus is validated
- **THEN** one or more structurally valid tasks cover each declared seed category and both required lanes and runtimes

#### Scenario: Seed breadth remains below publication count
- **WHEN** all eight seed categories qualify but fewer than 30 tasks exist
- **THEN** normal validation reports the exact coverage while strict readiness remains non-zero and `publishable: false`

### Requirement: Seed tasks prove task-defining behavior without regressions
Every seed task SHALL expose only a public task packet and baseline fixture to
the agent workspace, SHALL declare at least one task-defining acceptance check
and one separate regression check, and SHALL bind a minimal known-good change.
Qualification MUST repeat the intended baseline failure and complete
regression-free known-good pass before the task counts as qualified.

#### Scenario: An owned seed qualifies
- **WHEN** its baseline repeatedly fails only the task-defining behavior and its exact known-good change repeatedly passes all checks
- **THEN** the corpus records an immutable qualified receipt for that task

#### Scenario: A seed passes by weakening another behavior
- **WHEN** the task-defining check passes but any declared regression check fails
- **THEN** qualification classifies a regression and the seed does not count as qualified
