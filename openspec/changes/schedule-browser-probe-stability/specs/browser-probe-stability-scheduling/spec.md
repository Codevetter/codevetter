## Purpose

Lets coding agents obtain repeated local browser-probe evidence without choosing
rerun counts manually or spending beyond a fixed, inspectable execution budget.

## ADDED Requirements

### Requirement: Reuse compatible durable evidence first

CodeVetter SHALL integrity-check zero to three unique existing recapture IDs and
SHALL reuse only evidence matching the requested source capture, probe, source
snapshot, request, flow, project, presentation policy, and runtime identity.

#### Scenario: Existing runs already disagree

- **WHEN** two compatible existing recaptures retain different routes
- **THEN** CodeVetter reports instability without starting an application,
  browser, or local runtime

#### Scenario: Existing evidence is tampered or incompatible

- **WHEN** any supplied recapture fails integrity or exact compatibility
- **THEN** CodeVetter rejects the schedule before executing new work

### Requirement: Enforce a hard local execution budget

CodeVetter SHALL admit at most three total observations and at most three newly
executed recaptures, SHALL run them sequentially, and SHALL expose the requested,
consumed, and remaining local budget.

#### Scenario: No prior evidence

- **WHEN** a valid schedule starts without reusable recaptures and has a
  three-run budget
- **THEN** CodeVetter executes no more than three derived same-flow recapture IDs
  one at a time

#### Scenario: Budget is exhausted before stability

- **WHEN** compatible passing evidence remains insufficient and no admitted run
  remains
- **THEN** CodeVetter reports `budget_exhausted` without treating the route as
  stable

### Requirement: Stop at the first terminal boundary

CodeVetter SHALL stop before another recapture when it observes route
disagreement, stable unanimous evidence, failed correctness, incomplete
evidence, stale source, unsupported evidence, or operational failure.

#### Scenario: Two passing routes disagree

- **WHEN** the second compatible completed recapture selects a different route
- **THEN** CodeVetter reports `unstable` and consumes no third recapture

#### Scenario: Correctness fails before stability

- **WHEN** available compatible evidence has not already established
  disagreement and any included exact flow failed correctness
- **THEN** CodeVetter reports `correctness_failed` and executes no more runs

#### Scenario: Three passing routes agree

- **WHEN** three compatible completed recaptures unanimously select the same
  non-null route
- **THEN** CodeVetter reports `stable` and permits only the bounded follow-up
  already authorized by the stability assessment

### Requirement: Persist an integrity-bound terminal receipt

CodeVetter SHALL atomically persist one bounded schedule receipt containing the
source identity, input policy, reused and newly executed recapture references,
budget accounting, terminal state, final assessment when available, authority,
and limitations.

#### Scenario: Schedule completes without new execution

- **WHEN** reusable evidence is already terminal
- **THEN** the durable receipt records zero newly executed runs and the exact
  reused recapture IDs

#### Scenario: Source changes during scheduling

- **WHEN** the repository revision or source snapshot changes before a later
  recapture or before persistence
- **THEN** CodeVetter reports stale evidence and grants no follow-up or edit
  authority

### Requirement: Expose closed agent-facing operations

CodeVetter SHALL expose equivalent CLI and MCP scheduling operations and SHALL
reject caller-supplied commands, paths, environment, base URLs, concurrency, or
network policy.

#### Scenario: CLI and MCP reuse the same evidence

- **WHEN** both operations receive the same current source identity and existing
  recapture IDs with zero new-run budget
- **THEN** they return the same normalized schedule result

#### Scenario: Caller attempts arbitrary execution

- **WHEN** a caller adds an execution or environment argument
- **THEN** CodeVetter rejects the request before unrelated reads or execution
