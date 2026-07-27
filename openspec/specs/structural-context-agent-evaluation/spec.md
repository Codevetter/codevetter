# structural-context-agent-evaluation Specification

## Purpose
Evaluate whether repository structural context improves coding-agent outcomes through local, deterministic paired evidence and an inspectable report.

## Requirements

### Requirement: Experiments use immutable paired identities
The system SHALL compare structural-context treatment and control runs only
when both arms share the same task identity, repository revision, task packet
identity, hidden-acceptance contract identity, agent/model/configuration
identity, environment identity, and trial index. It MUST reject missing,
duplicated, mismatched, or cross-experiment arms instead of scoring them as
equivalent.

#### Scenario: Equivalent treatment and control receipts are supplied
- **WHEN** both arms contain the same required common identities and differ only in their declared structural-context policy
- **THEN** the system includes them as one complete pair

#### Scenario: Source or agent identity differs between arms
- **WHEN** treatment and control use different repository revisions, task packets, models, configurations, environments, or acceptance contracts
- **THEN** the system marks the pair invalid and excludes it from outcome deltas

### Requirement: Structural-context isolation is explicit and fail-closed
The treatment arm SHALL identify the structural-context policy, graph engine,
snapshot, indexed repository revision, and allowed graph tools used for the
run. The control arm SHALL declare structural context disabled and MUST NOT
report graph-context injection or graph-tool use. Stale treatment context or
control contamination MUST invalidate the pair.

#### Scenario: Treatment uses a current graph snapshot
- **WHEN** the treatment snapshot revision matches the paired repository revision and the control reports no structural context
- **THEN** the pair satisfies the context-isolation contract

#### Scenario: Control invokes a graph tool
- **WHEN** a control receipt records `graph_query`, `graph_get_node`, `graph_get_neighbors`, `graph_path`, `graph_impact`, or another declared structural-context tool
- **THEN** the system marks the pair contaminated and does not use it to claim a treatment effect

### Requirement: Executable hidden checks determine task success
The system SHALL treat a run as successful only when agent execution completed
and every required hidden acceptance check passed. Setup failures, agent
failures, timeouts, missing required checks, and regressions MUST remain
distinct outcomes and MUST NOT be converted into passes.

#### Scenario: All required checks pass
- **WHEN** the agent run completes and every required hidden acceptance check reports pass
- **THEN** the run counts as a successful task outcome

#### Scenario: One required check is absent
- **WHEN** a completed receipt omits a required hidden acceptance check
- **THEN** the run does not count as successful and the report identifies the missing check

### Requirement: Reports preserve paired outcomes and decision diagnostics
The system SHALL report complete and invalid pair counts, treatment and control
success rates, acceptance-check pass rates, treatment-only wins, control-only
wins, ties, regressions, and per-task deltas. It SHALL report captured
verification selection, files inspected/modified, tool calls, tokens, elapsed
time, and cost as secondary diagnostics without substituting them for task
success or inventing missing values.

#### Scenario: Treatment succeeds where control fails
- **WHEN** a valid treatment run passes every required check and its paired control does not
- **THEN** the report records a treatment-only win with the differing check outcomes

#### Scenario: Token data was not captured
- **WHEN** one or both receipts omit token measurements
- **THEN** the report marks token comparison unavailable rather than treating the missing value as zero

### Requirement: A/A controls and preregistered policy qualify claims
The system SHALL distinguish descriptive A/B deltas from qualified evidence. A
positive structural-context result MUST require a predeclared policy with
minimum complete pairs, minimum distinct tasks, minimum task-success
improvement, maximum regression increase, and maximum A/A discordance. Missing,
invalid, or overly noisy A/A evidence MUST leave the A/B result unqualified.

#### Scenario: A/B improvement passes every declared gate
- **WHEN** the experiment meets its sample, task breadth, improvement,
regression, identity, and A/A noise requirements
- **THEN** the report may label the result qualified under the exact policy and evidence identities

#### Scenario: A/A outcomes are too discordant
- **WHEN** equivalent A/A arms exceed the declared maximum discordance
- **THEN** the report presents A/B measurements as descriptive and refuses a positive qualification

### Requirement: Evaluation is local, deterministic, and provider-neutral
The system SHALL read only explicitly supplied local manifests and receipts,
produce deterministically ordered machine-readable JSON and Markdown from the
same scorecard, and perform no model calls, network requests, repository
mutation, checkout, hidden-test execution, or agent launch.

#### Scenario: Synthetic fixture is scored
- **WHEN** the checked-in hermetic fixture is passed to the evaluator
- **THEN** repeated runs produce equivalent normalized results and state that the fixture cannot establish real product value

#### Scenario: User has not supplied agent receipts
- **WHEN** no real paired run receipts are present
- **THEN** the evaluator performs no agent work and makes no claim that structural context improves outcomes

### Requirement: Users can inspect a bounded visual evaluation report
The system SHALL optionally render a self-contained local HTML report from the
same normalized scorecard as JSON and Markdown. The report MUST expose
qualification state, exact counts, treatment/control outcomes, task-level check
deltas, A/A noise, captured decision traces, missing measurements, experiment
identities, and limitations without relying on color, external assets, network
requests, or a desktop application route.

#### Scenario: User requests an HTML report
- **WHEN** a valid experiment is scored with HTML output selected
- **THEN** the evaluator writes one portable report whose values and qualification match the JSON scorecard

#### Scenario: Synthetic evidence is visually favorable
- **WHEN** the sample fixture shows more treatment wins than control wins
- **THEN** the report still leads with the synthetic and unqualified claim boundary rather than presenting product improvement as established
