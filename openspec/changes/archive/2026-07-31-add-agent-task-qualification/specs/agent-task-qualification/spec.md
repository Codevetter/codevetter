## Purpose

Defines deterministic proof that an immutable agent task has the intended
baseline failure and a complete regression-free known-good solution.

## ADDED Requirements

### Requirement: Qualification workspaces expose only public task inputs

Each qualification attempt SHALL use a fresh owned temporary workspace
containing only bounded regular files declared by the fixture bundle and one
copy of the public task packet. The workspace MUST NOT contain the acceptance
contract, check driver, known-good change, qualification receipt, corpus index,
or paths that identify those withheld artifacts.

#### Scenario: A baseline workspace is prepared

- **WHEN** qualification begins one clean baseline attempt
- **THEN** the workspace contains exactly the public fixture files and task
  packet declared by the immutable task package

#### Scenario: A fixture path is unsafe

- **WHEN** a fixture file is absolute, traverses a parent, is duplicated, has a
  mismatched identity, or exceeds a bound
- **THEN** setup fails before any check driver runs

### Requirement: Check execution is closed, exact, and bounded

Qualification SHALL launch the immutable declared check driver without a shell,
outside the task workspace, with an explicit timeout. The driver MUST emit one
schema-valid result for every declared required and regression check, with no
unknown or duplicate result. Process status and result contents MUST agree.

#### Scenario: The driver returns the exact inventory

- **WHEN** the driver exits successfully with one valid result for every
  declared check
- **THEN** qualification classifies the attempt from those exact results

#### Scenario: The driver times out or omits a result

- **WHEN** the driver exceeds its timeout or returns an incomplete inventory
- **THEN** the attempt records `timeout` or `incomplete_checks` distinctly and
  cannot qualify the task

### Requirement: Baseline failure is repeated and task-defining

Qualification SHALL run at least two fresh baseline attempts. Every attempt
MUST fail at least one declared task-defining required check, MUST preserve the
same exact check statuses across repetitions, and MUST keep regression checks
passing. Wrong failure, check error, timeout, incomplete inventory, flakiness,
and cleanup failure SHALL remain distinct outcomes.

#### Scenario: The baseline fails as intended twice

- **WHEN** every clean baseline attempt has the same declared task-defining
  failure and every regression check passes
- **THEN** the baseline phase records `intended_failure`

#### Scenario: Baseline repetitions disagree

- **WHEN** otherwise valid baseline attempts produce different check statuses
- **THEN** the baseline phase records `flaky` and the task remains unqualified

### Requirement: Known-good success is repeated and regression-free

Qualification SHALL apply only the immutable declared known-good file changes
after verifying every before identity. It SHALL run at least two fresh
known-good attempts and require every required and regression check to pass
with identical inventories. Patch failure, check failure, regression, timeout,
incomplete inventory, check error, flakiness, and cleanup failure SHALL remain
distinct outcomes.

#### Scenario: The known-good change passes twice

- **WHEN** every before identity matches, every declared change is applied, and
  all repeated required and regression checks pass
- **THEN** the known-good phase records `pass`

#### Scenario: The known-good change regresses existing behavior

- **WHEN** required checks pass but any regression check fails
- **THEN** the known-good phase records `regression` and the task remains
  unqualified

### Requirement: Qualification receipts are deterministic and fail closed

Qualification SHALL emit a bounded versioned receipt tied to the exact task,
manifest, acceptance contract, fixture, known-good change, per-attempt result
identities, workspace policy, phase outcomes, cleanup state, and limitations.
`qualified` MUST be true only when all baseline attempts record
`intended_failure`, all known-good attempts record `pass`, and cleanup succeeds.

#### Scenario: Unchanged qualification is repeated

- **WHEN** unchanged task bytes and deterministic checks are qualified again
- **THEN** the semantic receipt and its SHA-256 identity are identical

#### Scenario: Any phase is not authoritative

- **WHEN** setup, patching, checks, repetition, or cleanup does not meet its
  exact contract
- **THEN** a diagnostic receipt is still returned, `qualified` is false, and
  the command exits non-zero

### Requirement: Qualification does not launch an agent

Task qualification MAY execute the declared fixture check driver but MUST NOT
launch an agent adapter, call a model/provider, read credential values, make a
network request, or project a run into the structural-context evaluator.

#### Scenario: An operator qualifies a task

- **WHEN** the qualification command completes or fails
- **THEN** its receipt records check evidence only and contains no fabricated
  agent, model, token, cost, tool, or scorer data
