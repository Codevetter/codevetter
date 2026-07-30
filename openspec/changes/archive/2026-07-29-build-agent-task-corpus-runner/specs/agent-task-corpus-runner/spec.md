## ADDED Requirements

### Requirement: Corpus tasks have immutable, bounded identities
The system SHALL represent each task with a versioned manifest containing a
stable task ID, title, task category, owned or license-qualified fixture
identity, baseline revision, task packet, acceptance-contract identity,
required checks, regression checks, known-good solution identity, and failure
taxonomy. It MUST reject unknown fields, unsafe paths, duplicate identities,
unbounded content, mutable external references, and hash mismatches.

#### Scenario: A task manifest and its files match
- **WHEN** every declared file exists under its allowed corpus root and every recorded SHA-256 identity matches the current bytes
- **THEN** the validator accepts the task as structurally valid

#### Scenario: A task fixture or contract drifts
- **WHEN** a fixture, task packet, hidden check, known-good solution, or manifest changes without the corresponding identity changing
- **THEN** the validator rejects the task and identifies the mismatched artifact

### Requirement: Acceptance checks are withheld from the agent workspace
The runner SHALL prepare an isolated disposable workspace containing the task
fixture and task packet but not the acceptance checks, regression checks, or
known-good solution. It SHALL run checks only after the agent process has
terminated and MUST NOT include withheld paths or contents in the agent
command, prompt, environment metadata, or captured diagnostics.

#### Scenario: An agent run begins
- **WHEN** the runner launches the configured agent command for a task
- **THEN** the agent workspace contains the baseline fixture and public task packet but none of the withheld evaluation artifacts

#### Scenario: The agent exits
- **WHEN** the agent process completes, fails, is cancelled, or times out
- **THEN** the runner records the terminal agent state before preparing and executing any acceptance checks

### Requirement: Tasks fail closed through baseline and known-good qualification
The system SHALL qualify every publishable task by proving that the untouched
baseline fails at least one task-defining required check, the known-good
solution passes every required and regression check, setup is repeatable, and
the check inventory exactly matches the acceptance contract. A task that fails
qualification MUST remain available for diagnosis but MUST NOT count toward a
publishable corpus.

#### Scenario: A valid task is qualified
- **WHEN** repeated clean baseline runs fail for the declared reason and repeated known-good runs pass every declared check
- **THEN** the task receives a deterministic qualification receipt tied to its exact artifact identities

#### Scenario: The known-good solution regresses existing behavior
- **WHEN** the task-specific checks pass but any declared regression check fails
- **THEN** qualification fails and the task is excluded from publishable corpus counts

### Requirement: The publishable corpus has realistic TypeScript and Node breadth
The strict corpus readiness gate SHALL require 30–50 qualified tasks spanning
both browser and API behavior and at least six declared failure categories.
Every task SHALL contain a user-visible or externally observable acceptance
outcome rather than a style-only or static-analysis-only finding. A non-strict
validation command MAY validate a smaller in-progress corpus but MUST report
that it is not publishable.

#### Scenario: Corpus breadth meets the declared gate
- **WHEN** 30–50 qualified tasks cover both browser and API lanes, at least six failure categories, and all corpus-level identity checks
- **THEN** strict readiness reports the corpus as publishable under the exact version and task set

#### Scenario: Only seed tasks exist
- **WHEN** the corpus is structurally valid but contains fewer than 30 qualified tasks
- **THEN** non-strict validation succeeds while strict readiness fails with the missing breadth counts

### Requirement: Agent execution is explicit, provider-neutral, and bounded
The runner SHALL launch only an operator-supplied command expressed as an
argument array without a shell. Launching an agent MUST require an explicit
one-shot model-call approval, and paid configurations MUST require a separate
one-shot paid approval. The runner SHALL enforce task and process timeouts,
bounded output capture, cancellation, owned process-group termination, a
declared environment-name policy, and deterministic cleanup.

#### Scenario: A configured local or remote-backed agent is launched
- **WHEN** the operator supplies a valid command adapter, exact agent/model/configuration identities, and the required launch approvals
- **THEN** the runner executes that adapter in the disposable task workspace and records the declared identities without recording environment values or credentials

#### Scenario: Approval is absent
- **WHEN** a command could invoke a model but the one-shot model-call approval is missing
- **THEN** the runner performs no agent launch and returns an explicit approval-required outcome

#### Scenario: An agent exceeds its timeout
- **WHEN** the configured agent process does not finish within the task budget
- **THEN** the runner terminates its owned process group, records a timeout, skips success classification, and cleans the disposable workspace

### Requirement: Executable checks determine a normalized run receipt
The runner SHALL emit a versioned provider-neutral receipt containing immutable
task, repository, task-packet, acceptance-contract, agent, model,
configuration, and environment identities; agent terminal state; every
required check result; regression count; elapsed time; and explicitly captured
optional diagnostics. Setup failures, agent failures, cancellations, timeouts,
incomplete checks, check failures, regressions, and successes MUST remain
distinct and MUST NOT be converted into one another.

#### Scenario: All checks pass after successful agent execution
- **WHEN** the agent exits successfully and every required and regression check passes
- **THEN** the receipt records a completed successful outcome with zero regressions

#### Scenario: One required result is missing
- **WHEN** check execution completes without a result for a required check
- **THEN** the receipt records `incomplete_checks`, names the missing check, and does not count the run as successful

### Requirement: Runner receipts compose with structural-context evaluation
The runner SHALL be able to project normalized receipts into the task and run
shapes consumed by `structural-context-agent-evaluation` without launching the
scorer or weakening its identity, context-isolation, A/A, or claim gates. The
projection MUST preserve comparison arm, trial index, execution order, graph
policy, allowed graph tools, check results, regressions, and missing optional
diagnostics exactly.

#### Scenario: Paired trial receipts are exported
- **WHEN** equivalent control and treatment runs have been produced for one task and trial
- **THEN** the export contains scorer-compatible paired identities and differs only in the declared structural-context policy and resulting measurements

#### Scenario: A run lacks optional cost data
- **WHEN** the agent adapter did not report tokens or cost
- **THEN** the exported receipt omits those diagnostics instead of inventing zero values

### Requirement: Validation and execution are CLI-first and inspectable
The system SHALL provide root-level pnpm commands for corpus validation,
publishable readiness, task qualification, dry-run planning, bounded execution,
and receipt export. Every command SHALL support deterministic JSON output and
non-zero exit codes for invalid input, unqualified tasks, failed runs, or
missing approvals. This capability MUST NOT add a desktop route or require
Tauri.

#### Scenario: An operator validates the corpus without launching an agent
- **WHEN** the operator runs corpus validation or dry-run planning
- **THEN** the command performs no model calls, network requests, task mutation, or hidden-check execution and emits a machine-readable plan

#### Scenario: A run fails
- **WHEN** setup, agent execution, or acceptance checks fail
- **THEN** the command exits non-zero while still writing the bounded diagnostic receipt requested by the operator

### Requirement: Feedback and observability integration remain external
This change SHALL NOT ingest Sentry events, logs, traces, metrics, support
tickets, customer sessions, or production telemetry. It SHALL NOT
automatically create corpus tasks from feedback. Future integrations MAY
produce reviewed task candidates through a separate versioned import contract,
but imported feedback MUST NOT gain verification authority merely by being
connected.

#### Scenario: No feedback application is configured
- **WHEN** the corpus and runner are used without any production-signal source
- **THEN** every validation, qualification, execution, and receipt-export capability remains fully functional

