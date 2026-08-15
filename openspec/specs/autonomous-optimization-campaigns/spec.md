# autonomous-optimization-campaigns Specification

## Purpose
Defines a bounded, resumable optimization campaign in which an agent may
iterate on source code while CodeVetter remains the deterministic authority for
correctness, performance evidence, resource limits, and promotion decisions.
## Requirements
### Requirement: Campaign scope is immutable and reviewable
The system SHALL require a versioned campaign manifest that identifies the
repository revision, allowed mutable files, exact correctness scopes, exact
performance scope, sample policies, resource limits, experiment budget, and
stop conditions. The system MUST reject unknown fields, escaping paths,
unsupported adapters, incomplete scopes, and manifest identity drift after a
baseline exists.

#### Scenario: Valid campaign is initialized
- **WHEN** an agent supplies a contained manifest with supported exact scopes and finite budgets
- **THEN** the system records a stable campaign identity before any candidate is evaluated

#### Scenario: Manifest changes after baseline
- **WHEN** an agent changes an evaluation target, policy, protected path, or budget after the baseline was recorded
- **THEN** the system refuses to compare the candidate with the prior baseline

### Requirement: Baseline precedes experimentation
The system SHALL execute every declared correctness scope and the declared
performance scope before accepting a candidate. A failed, incomplete, or
unstable baseline MUST leave the campaign in `no_confidence` and MUST NOT
authorize experimentation.

#### Scenario: Complete baseline
- **WHEN** all exact correctness scopes pass and bounded performance evidence completes
- **THEN** the system records the baseline as the first immutable experiment and exposes one next candidate action

#### Scenario: Baseline correctness failure
- **WHEN** any declared correctness scope fails or does not execute exactly
- **THEN** the system records the failure and does not establish an incumbent

### Requirement: Correctness gates every performance decision
The system SHALL execute all declared correctness scopes against every
candidate before promotion. A correctness failure MUST produce `discard` or
`crash` regardless of measured performance, and a performance result MUST NOT
override an authoritative correctness result.

#### Scenario: Faster incorrect candidate
- **WHEN** a candidate materially improves the performance metric but fails one correctness scope
- **THEN** the system records the performance observation but returns `discard` with correctness as the controlling reason

#### Scenario: Correctness-preserving improvement
- **WHEN** every correctness scope passes and compatible performance evidence materially improves without a protected regression
- **THEN** the system may classify the candidate as `promising` or `keep` according to evidence strength

### Requirement: Screening and promotion have separate authority
The system SHALL distinguish bounded screening evidence from promotion-quality
evidence. Screening MAY return `promising`, `discard`, `crash`, or
`no_confidence`; only promotion evidence meeting the configured sample floor,
paired-workload identity, stability, correctness, and secondary-resource policy
MAY return `keep`.

#### Scenario: Three-sample material improvement
- **WHEN** a correct candidate materially improves under a three-sample screening policy
- **THEN** the system returns `promising` and requests promotion-quality verification instead of advancing the incumbent

#### Scenario: Stable paired promotion
- **WHEN** independently runnable incumbent and candidate checkouts pass exact correctness and ten-sample paired verification without limitations
- **THEN** the system returns `keep` and records the candidate as the new incumbent

### Requirement: Every experiment is durably attributable
The system SHALL append an experiment record containing campaign identity,
sequence, timestamp, repository revision, diff identity, hypothesis, evidence
identity, measurements, correctness outcomes, decision, reason, and limitations.
Existing experiment records MUST NOT be rewritten when later candidates run.

#### Scenario: Candidate is discarded
- **WHEN** a candidate is slower, incorrect, unstable, or immaterial
- **THEN** the system appends the complete result and preserves the incumbent and all earlier records

#### Scenario: Campaign resumes
- **WHEN** an agent reopens a valid campaign after the prior process exits
- **THEN** the system reconstructs the incumbent, remaining budget, experiment count, and next permitted action from validated durable records

### Requirement: Autonomy is bounded by explicit stop conditions
The system SHALL stop requesting experiments when the manifest's experiment,
elapsed-time, consecutive-no-improvement, or consecutive-crash budget is
exhausted. `no_confidence` MUST NOT silently consume or extend an unspecified
budget, and the system MUST explain the controlling stop condition.

#### Scenario: Plateau reached
- **WHEN** the configured number of consecutive non-improving candidates is recorded
- **THEN** the campaign status becomes `stopped` with `plateau` as the reason

#### Scenario: Budget remains
- **WHEN** the latest experiment is terminal and at least one declared budget remains
- **THEN** the campaign exposes a bounded next action without generating or applying a source patch

### Requirement: Agent strategy remains outside evidence authority
The system SHALL NOT generate hypotheses with a model, edit application source,
install dependencies, invoke arbitrary shell commands, reset Git state, or
weaken declared checks. It SHALL expose evidence and deterministic decisions so
an external agent program can choose and apply the next bounded experiment.

#### Scenario: Agent requests a campaign decision
- **WHEN** an agent submits a candidate hypothesis after editing within the declared boundary
- **THEN** CodeVetter evaluates the candidate without claiming authorship of the patch or inference beyond captured evidence

### Requirement: Machine operations are closed and repository scoped
The system SHALL expose start, baseline, evaluate, inspect, and status behavior
through machine-readable CLI and repository-scoped MCP operations with closed
schemas. Campaign artifacts MUST remain under an explicit repository-contained
directory and MUST redact environment values, credentials, query values, and
machine paths from portable evidence.

#### Scenario: Unknown campaign argument
- **WHEN** an MCP or CLI caller supplies an unknown field, escaping artifact path, or unsupported operation
- **THEN** the system fails closed without running a workload or mutating campaign state
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
