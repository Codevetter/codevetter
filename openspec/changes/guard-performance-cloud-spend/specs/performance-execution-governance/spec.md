## Purpose

Defines the fail-closed execution policy that keeps autonomous performance
profiling local, bounded, zero-egress, and independently auditable before any
project-owned workload is allowed to run.

## ADDED Requirements

### Requirement: Every performance run has an immutable admission plan
The system SHALL derive a versioned plan before project code executes. The plan
MUST bind repository and target identity, adapter, execution mode, maximum wall
time, process concurrency, retries, external requests, monetary cost, declared
external services, and approval identity. Unknown fields or unbounded values
MUST fail closed.

#### Scenario: Local dry-run is admitted
- **WHEN** a caller dry-runs an exact supported local workload with no remote or unknown-cost evidence
- **THEN** the system returns an admitted zero-egress plan with one process, zero retries, zero external requests, zero external services, zero monetary cost, and a finite duration

#### Scenario: Plan identity changes
- **WHEN** repository, target, adapter, budget, or execution-policy input differs from an earlier plan
- **THEN** the system returns a different immutable plan identity and does not reuse the prior admission

### Requirement: Autonomous execution is local and zero-egress
The autonomous profiler SHALL execute only adapters for which it can enforce a
local zero-egress policy. It MUST block remote network access at runtime, allow
browser access only to loopback targets, run at most one owned workload process,
and perform no automatic retry.

#### Scenario: Node workload attempts remote access
- **WHEN** an admitted Node-family workload attempts DNS, socket, HTTP, HTTPS, fetch, or WebSocket access to a non-loopback destination
- **THEN** the system blocks the operation, terminates or fails the workload, and reports a zero-egress policy violation without retrying

#### Scenario: Runtime cannot enforce zero egress
- **WHEN** the selected adapter lacks an enforceable zero-egress boundary
- **THEN** the system blocks before project code executes and names the unsupported enforcement boundary

### Requirement: Hosted and unknown-cost profiling remains closed
The autonomous profiler MUST NOT run hosted, paid, unknown-cost, load, soak,
stress, or production profiling. An approval identity MUST NOT silently widen
this product boundary; the plan SHALL report the unsupported execution mode and
maximum possible spend as unknown rather than zero.

#### Scenario: Hosted target is requested without approval
- **WHEN** a workload includes a remote endpoint, paid service, production marker, or unknown pricing and no exact approval identity
- **THEN** the system blocks before the first request and records every detected service and missing approval input

#### Scenario: Hosted target is requested with approval
- **WHEN** a caller supplies an approval identity for a hosted or paid workload
- **THEN** the autonomous profiler still reports hosted execution as unsupported and does not contact the service

### Requirement: Every admission outcome emits a cost and egress receipt
The system SHALL emit a machine-readable receipt for admitted, blocked, failed,
and completed plans. The receipt MUST preserve planned and observed duration,
process concurrency, retry count, external request count, external services,
cost posture, enforcement method, terminal reason, and limitations without
including credentials or absolute private paths.

#### Scenario: Workload is blocked before execution
- **WHEN** the plan is rejected because cost, service, approval, or enforcement evidence is missing
- **THEN** the receipt records zero executed requests and processes plus the projected bounds and exact blockers

#### Scenario: Local workload completes
- **WHEN** an admitted zero-egress workload exits within its bounds
- **THEN** the receipt records the observed local process and duration totals and confirms zero external requests, retries, services, and monetary cost
