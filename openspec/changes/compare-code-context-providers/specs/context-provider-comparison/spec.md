## Purpose

Define a reproducible experiment that determines whether an agent-readable
code-context provider changes executable coding-task outcomes under fixed,
inspectable conditions without confusing retrieval activity with correctness.

## ADDED Requirements

### Requirement: Provider eligibility is explicit and evidence-backed
The experiment system SHALL include a context provider only after a bounded
capability probe records its provider identity, exact version, context kind,
machine-readable interface, configuration identity, repository-indexing mode,
freshness evidence, allowed tools, data-egress posture, setup result, and known
limitations. It MUST classify storage engines without a complete agent-facing
retrieval path as infrastructure and exclude them from provider outcome arms.

#### Scenario: Local MCP provider passes the probe
- **WHEN** a provider exposes a bounded MCP interface, indexes the exact task revision, reports an exact version and configuration identity, and permits tool-call observation
- **THEN** the system records it as eligible for the declared local provider cohort

#### Scenario: Human-only wiki has no reproducible agent interface
- **WHEN** a product produces human-readable pages but exposes no stable CLI, API, or MCP interface for the tested agent
- **THEN** the system excludes it from the agent-context cohort and records the missing capability rather than inventing an adapter

#### Scenario: Generic graph storage is proposed as a provider
- **WHEN** a system stores or queries graphs but does not construct and deliver task-relevant code context to the agent
- **THEN** the system classifies it as infrastructure and does not score it against complete context providers

### Requirement: Multi-arm experiments bind immutable common and provider identities
The system SHALL bind every experiment to one corpus identity, task and ground-
truth identities, agent/model/prompt configuration, environment, schedule,
qualification policy, and declared provider cohort. Every provider arm SHALL
also bind its provider version, configuration, context snapshot or index,
indexed repository revision, context policy, and allowed tool set. Missing,
duplicated, stale, or mismatched identities MUST invalidate the affected arm.

#### Scenario: Provider arms differ only in context policy
- **WHEN** baseline and provider runs share every common identity and each provider arm carries a current provider-specific context identity
- **THEN** the system admits the runs to the declared comparison

#### Scenario: Provider index is stale
- **WHEN** a provider snapshot or index names a repository revision different from the task revision
- **THEN** the system excludes the arm from outcome comparison and reports stale context

### Requirement: Context isolation fails closed
Each arm SHALL run in a fresh workspace and agent session with only its declared
context interface available. The baseline MUST have all special context
providers disabled. A provider arm MUST NOT access another provider's tools,
cache, generated instructions, or retained conversation state. Any undeclared
context tool call or cross-arm state MUST mark the run contaminated.

#### Scenario: Baseline invokes a provider tool
- **WHEN** baseline diagnostics record a context-provider tool call or injected provider artifact
- **THEN** the system marks the baseline contaminated and refuses to use its paired outcomes

#### Scenario: One provider remains configured in another arm
- **WHEN** an arm can access a context interface not declared by its provider policy
- **THEN** the system invalidates the arm even if all executable checks pass

### Requirement: Scheduling is deterministic, balanced, and staged
The system SHALL create a deterministic schedule that balances arm order across
tasks and repeated trials. It SHALL complete a preregistered free/local
feasibility stage before permitting a full-corpus or paid/hosted stage. Any
stage that can incur non-zero or unknown cost MUST expose exact run counts,
conservative cost bounds, credential-name availability, and an approval
identity before execution.

#### Scenario: Feasibility stage is planned
- **WHEN** eligible free/local arms and a bounded task subset are selected
- **THEN** repeated planning produces the same ordered schedule and plan identity without launching an agent or provider

#### Scenario: Full trial has unknown cost
- **WHEN** any selected arm has paid or unknown pricing and no matching approval is supplied
- **THEN** the system produces a blocked plan and starts no experiment run

### Requirement: Executable behavior remains the outcome authority
The system SHALL count task success only from complete hidden acceptance checks
and preserved regression checks. It SHALL report provider setup success,
invalid and contaminated arms, treatment-only wins, baseline-only wins,
cross-provider outcome deltas, and per-task results. Retrieval recall, files
inspected or modified, tool calls, latency, tokens, and cost SHALL remain
secondary diagnostics and MUST NOT be substituted for executable success.

#### Scenario: Provider uses fewer tokens but fails a hidden check
- **WHEN** a provider arm records lower token use than baseline but misses any required acceptance check
- **THEN** the system reports the failed task outcome and treats token use only as a diagnostic

#### Scenario: Relevant-file ground truth is absent
- **WHEN** a task has no preregistered relevant-file set
- **THEN** the system reports retrieval recall as unavailable instead of deriving it from the agent's edits or known-good patch after the run

### Requirement: Qualification controls claims and multiple comparisons
The experiment SHALL preregister minimum task breadth, complete repetitions,
A/A noise limits, success-rate and regression gates, provider eligibility, and
the method used to control multi-provider comparisons. Synthetic, feasibility,
underpowered, invalid, or excessively noisy evidence MUST remain descriptive.
The report MUST preserve negative and null results and MUST NOT rank providers
whose evidence failed qualification.

#### Scenario: One provider has a favorable but underpowered result
- **WHEN** its descriptive success delta is positive but the declared sample or noise gate is not met
- **THEN** the system labels the result unqualified and publishes no winner claim

#### Scenario: Several providers are compared
- **WHEN** the experiment evaluates more than one provider against the same baseline
- **THEN** the report applies the preregistered multiple-comparison policy and exposes both raw and adjusted qualification results

### Requirement: Scoring and reporting are deterministic and non-executing
The comparison system SHALL consume only explicitly supplied local plans,
capability probes, immutable receipts, and existing evaluation scores. It SHALL
perform no agent launch, provider call, repository mutation, hidden-check
execution, or network request while scoring. JSON, Markdown, and optional
self-contained HTML outputs MUST share one normalized scorecard and expose
provider identities, evidence gaps, invalid arms, scheduling, outcome deltas,
diagnostics, qualification, and limitations.

#### Scenario: The same evidence is rescored
- **WHEN** identical plans, probes, receipts, ground truth, and scorer bytes are supplied twice
- **THEN** the normalized comparison and evidence identities are byte-stable

#### Scenario: Provider receipt is missing
- **WHEN** a scheduled arm has no declared terminal receipt
- **THEN** the report records the missing arm and refuses a complete-provider comparison rather than silently shrinking the denominator

### Requirement: Trial artifacts preserve privacy and dependency boundaries
Committed experiment artifacts MUST NOT contain credentials, repository secrets,
raw private source, absolute paths, provider account identifiers, or unbounded
model output. Provider integrations SHALL remain experiment adapters rather
than production dependencies, and hosted data egress MUST require an explicit
declared policy and approval.

#### Scenario: Provider requires a credential
- **WHEN** a plan references a required credential name
- **THEN** it records only bounded availability and hashed environment identity, never the credential value

#### Scenario: Hosted provider would ingest task source
- **WHEN** the provider's declared data-egress policy is absent or unapproved
- **THEN** the experiment blocks that arm before indexing or agent execution
