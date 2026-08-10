## Purpose

Let an AI coding agent discover and prioritize bounded local performance flows
before entering CodeVetter's existing correctness-gated optimization loop.

## ADDED Requirements

### Requirement: Repository flows are discovered without execution first
CodeVetter SHALL use bounded repository qualification to discover exact local
performance workloads before running application code. Only supported adapters,
contained targets, direct timing evidence, and candidates without unsafe safety
flags MUST be eligible for automatic screening. A loopback-only local service
signal MAY remain eligible for the supported Node flow adapters.

#### Scenario: Safe measured workloads exist
- **WHEN** a repository contains exact Node, Vitest, or Go benchmark workloads with direct timing evidence
- **THEN** CodeVetter returns a bounded deterministic inventory ordered by qualification evidence

#### Scenario: Candidate may access external state
- **WHEN** qualification detects network, integration, secret, production, or escaping-path evidence
- **THEN** the candidate remains visible as excluded and MUST NOT execute automatically

#### Scenario: URL text is only local fixture data
- **WHEN** a measured workload contains URL strings but does not invoke a network client
- **THEN** CodeVetter does not classify those strings alone as external execution evidence

### Requirement: Screening uses existing runtime evidence
CodeVetter SHALL screen at most the caller's bounded flow limit using existing
performance capsules and deterministic diagnosis. Every screened flow MUST
retain exact scope identity, measurement provenance, diagnosis, limitations,
and cleanup state.

#### Scenario: Exact workload completes
- **WHEN** an eligible discovered workload executes successfully
- **THEN** its flow-campaign entry references its measured supported-scale cost and deterministic diagnosis

#### Scenario: Workload is incomplete or startup dominated
- **WHEN** a workload fails, times out, lacks a comparable domain metric, or is dominated by runner startup
- **THEN** CodeVetter does not assign an optimization priority and returns the missing evidence as its next action

### Requirement: Priority combines measured cost with explicit product context
CodeVetter SHALL rank actionable flows by measured supported-scale milliseconds
multiplied by bounded frequency and user-impact weights. Optional project-owned
weights MUST bind to exact candidate identity; absent weights MUST default to
neutral values and remain disclosed as unverified product context.

#### Scenario: Product weights are supplied
- **WHEN** a valid priority manifest supplies frequency and user-impact weights for a discovered candidate
- **THEN** the result records both weights, their provenance, and the resulting deterministic priority score

#### Scenario: Product weights are absent
- **WHEN** no matching priority entry exists
- **THEN** CodeVetter uses neutral weights, reports that production frequency and user impact are unknown, and MUST NOT claim production impact

#### Scenario: Flow is already cheap
- **WHEN** deterministic diagnosis classifies a flow as already fast at its supported scale
- **THEN** the flow is retained as a regression guardrail but MUST rank below actionable optimization flows

### Requirement: One next action controls the campaign handoff
CodeVetter SHALL return one deterministic next action for the complete plan. It
MUST select the highest-priority actionable flow, request a better workload when
evidence is inadequate, or recommend another repository when no material local
flow remains.

#### Scenario: Actionable flow leads the plan
- **WHEN** at least one screened flow has actionable diagnosis and comparable supported-scale cost
- **THEN** the next action identifies its exact adapter, target, name, and the manifest inputs required by the existing optimization campaign

#### Scenario: No actionable flow remains
- **WHEN** every screened flow is already cheap or non-actionable
- **THEN** the next action preserves useful guardrails and recommends profiling a different product flow

### Requirement: Planner operations remain closed, local, and bounded
The planner SHALL be exposed through machine-readable CLI and MCP operations
with closed arguments. It MUST NOT edit product source, install dependencies,
invoke a model, contact production, infer credentials, or retain raw profiler
artifacts.

#### Scenario: Agent starts local planning
- **WHEN** an agent calls the planner with a repository, bounded flow count, sample policy, and optional contained priority manifest
- **THEN** CodeVetter performs only the declared local screening work and returns one validated portable result

#### Scenario: Unknown or unsafe input
- **WHEN** a caller supplies unknown fields, an escaping manifest path, unsupported weights, or an excessive flow count
- **THEN** the operation fails closed before executing a workload
