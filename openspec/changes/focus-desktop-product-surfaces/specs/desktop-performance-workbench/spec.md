## Purpose

Provide a first-class desktop surface where people can operate CodeVetter's bounded local performance engine and inspect the same evidence that external coding agents consume through CLI and MCP.

## ADDED Requirements

### Requirement: Performance is a primary desktop surface

CodeVetter SHALL expose Performance at `/performance` as one of five primary product destinations alongside Usage, Repo Unpack, Review, and Testing. Settings SHALL remain a separated utility rather than a product surface.

#### Scenario: User opens Performance

- **WHEN** the user activates Performance from primary navigation or command search
- **THEN** the persistent Performance route opens with visible focus and `aria-current` identifies Performance

### Requirement: User selects intent and confirms an exact local scope before execution

The Performance surface SHALL accept a function or flow described in human language, an exact pull request/change, or the entire selected codebase as discovery input. Before execution, CodeVetter SHALL resolve that input into a contained local repository, supported adapter, repository-relative target, optional exact workload identity, bounded sample policy, and explicit coverage limitations. It MUST NOT execute the unresolved phrase, accept arbitrary shell commands, or contact production endpoints.

#### Scenario: Function or flow is described in human language

- **WHEN** the user describes a function or flow such as “checkout coupon calculation”
- **THEN** CodeVetter proposes the concrete runnable target and workload it resolved, preserves the original phrase in the plan, and waits for confirmation before execution

#### Scenario: Pull request is selected

- **WHEN** the user selects a pull request or exact local change identity
- **THEN** CodeVetter derives affected candidate flows, shows uncovered changed areas, and binds every selected execution to that exact change

#### Scenario: Entire codebase is selected

- **WHEN** the user requests whole-codebase testing or performance review
- **THEN** CodeVetter performs bounded flow discovery, proposes an explicit portfolio of runnable scopes, and reports what remains unexercised rather than claiming complete coverage

#### Scenario: Exact supported flow is selected

- **WHEN** the user selects a qualified Node, Vitest, Vite, browser, or Go scope
- **THEN** Performance displays the exact target, workload identity, samples, warmups, timeout, expected process count, and qualification limitations before a process starts

#### Scenario: Scope is unsafe or unsupported

- **WHEN** qualification reports escaping paths, external state, missing runtime support, stale identity, or an unsupported adapter
- **THEN** execution remains blocked and the UI explains the evidence needed to proceed

### Requirement: Testing and Performance share scope resolution

Testing and Performance SHALL consume the same resolved scope-plan contract so that a human phrase, pull request, or codebase selection identifies the same repository revision, affected flows, runnable targets, and uncovered areas across correctness and performance work.

#### Scenario: Resolved flow moves from testing to performance

- **WHEN** a flow is executable and passes its correctness checks
- **THEN** Performance can reuse its resolved identity and workload without asking the user to reconstruct adapter-specific fields

### Requirement: Performance evidence separates observation from judgment

The workbench SHALL render measured latency, throughput, memory, allocations, bundle data, runtime hotspots, and execution coverage as observed evidence. Deterministic findings SHALL remain distinct from inferred bottleneck candidates and unverified optimization hypotheses.

#### Scenario: Profile captures repository hotspots

- **WHEN** a bounded profile completes with repository-owned samples
- **THEN** the UI shows measurements, source locations, sample coverage, limitations, and one bounded next action without presenting a hypothesis as a confirmed cause

#### Scenario: Profile is startup dominated

- **WHEN** the runtime reports that runner startup dominates the exact scope
- **THEN** the UI reports insufficient application coverage and recommends a better workload instead of naming product code as the bottleneck

### Requirement: Optimization campaigns are correctness-gated and auditable

The workbench SHALL expose campaign baseline, candidate screening, promotion, challenge, plateau, and stop states from the existing local campaign contract. A candidate MUST NOT be presented as kept unless correctness passes and compatible paired evidence confirms its declared metric without a disallowed control regression.

#### Scenario: Candidate is rejected

- **WHEN** correctness fails, evidence is incompatible, a control metric regresses, or improvement is below policy
- **THEN** the campaign timeline records the rejection reason and does not label the candidate as an optimization

#### Scenario: Candidate is confirmed

- **WHEN** compatible paired verification returns `keep`
- **THEN** the UI shows exact before/after metrics, revision identities, sample policy, limitations, and patch-cost evidence

### Requirement: Desktop and agent surfaces share portable receipts

Desktop performance operations SHALL produce the same versioned machine-readable plans, capsules, diagnoses, campaign states, and verification receipts used by CLI and MCP. The desktop MUST NOT create a second scoring or verdict implementation.

#### Scenario: Agent continues a desktop-started investigation

- **WHEN** a user exports or references a desktop-created performance receipt
- **THEN** an external coding agent can inspect the same identity-bound evidence through CodeVetter's existing automation contract
