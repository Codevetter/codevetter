## Purpose

Keeps validated runtime diagnosis from a failed exact browser flow available to
autonomous agents while preserving its failed correctness boundary.

## ADDED Requirements

### Requirement: Valid failed-flow diagnosis counts as diagnostic coverage

CodeVetter MUST distinguish diagnostic coverage from correctness and
optimization success for exact Playwright executions.

#### Scenario: Exact assertion fails with a validated result

- **WHEN** an exact Playwright execution fails but CodeVetter persists a
  validated result and compact diagnosis on an unchanged source snapshot
- **THEN** coverage marks the flow `failure_diagnosed`
- **AND** the same snapshot is not automatically recaptured merely because the
  assertion failed

#### Scenario: Failed capture has no validated result

- **WHEN** execution fails before a validated result is persisted or source
  identity changes
- **THEN** coverage marks the attempt as failed or unavailable
- **AND** it does not count as completed diagnostic coverage

### Requirement: Failed-flow evidence never gains optimization authority

CodeVetter MUST preserve the failed assertion as the authoritative correctness
boundary regardless of performance findings.

#### Scenario: Failed flow contains a source-bounded performance finding

- **WHEN** a failed exact browser flow contains any performance source candidate
- **THEN** CodeVetter keeps that candidate edit-ineligible for autonomous
  optimization
- **AND** it reports the assertion failure as a prerequisite for any later
  correctness-passing experiment

### Requirement: Laboratory returns the failed-flow diagnosis

The autonomous laboratory MUST make one completed diagnostic decision from a
validated failed flow rather than silently treating it as absent evidence.

#### Scenario: Failed flow has a selected next probe

- **WHEN** coverage contains `failure_diagnosed` evidence with a selected
  pre-commit next probe
- **THEN** the laboratory records an inspection step and returns that structured
  route
- **AND** it does not rerun, edit, or claim the failed flow is optimized

