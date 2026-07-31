# agent-task-runner Specification

## Purpose

Defines fail-closed provider-neutral planning and one approved disposable
agent-task attempt whose hidden checks remain authoritative.
## Requirements
### Requirement: Dry-run planning is deterministic and non-executing

The runner SHALL resolve a qualified task and immutable v2 adapter into one
closed deterministic plan. Planning MUST report public input size,
conservative input/output token bounds, maximum estimated cost, cost posture,
declared environment availability, exact identities, and approval
requirements without reading environment values, materializing a workspace,
launching an adapter, or executing checks.

#### Scenario: An unchanged plan is repeated

- **WHEN** unchanged task, adapter, and environment-name availability are
  planned twice
- **THEN** the semantic plan and plan identity are identical

#### Scenario: A required environment name is unavailable

- **WHEN** the adapter declares an environment name absent from the planning
  availability set
- **THEN** the plan remains inspectable but records that execution is blocked

### Requirement: Every launch consumes exact explicit approval

The runner MUST require an approval naming the exact current plan before
starting an adapter. A paid adapter MUST additionally receive explicit paid
approval, and no approval may authorize more than one execution attempt.
Identity drift or a failed cost gate MUST invalidate approval before launch.

#### Scenario: Launch approval is missing or stale

- **WHEN** execution is requested without the current plan identity
- **THEN** the runner rejects the request before creating a workspace or
  launching an adapter

#### Scenario: A paid adapter lacks paid approval

- **WHEN** launch approval is exact but the paid-cost approval is absent
- **THEN** the runner rejects the request before launching the adapter

### Requirement: Approved agent execution is disposable and bounded

An approved attempt SHALL materialize a fresh workspace containing only public
fixture files and the task packet, resolve only closed command placeholders,
launch the immutable adapter without a shell, pass only declared environment
values plus a minimal runner environment, and bound runtime and captured
output. Timeout or cancellation MUST terminate the owned process group before
cleanup. Output returned to an operator MUST be bounded and redact credential
markers and exact declared environment values.

#### Scenario: A synthetic adapter exits successfully

- **WHEN** one approved adapter changes the public fixture and exits zero
- **THEN** the runner records agent termination before starting withheld checks

#### Scenario: An adapter exceeds its timeout

- **WHEN** the adapter runs past its declared timeout
- **THEN** the runner terminates its owned process group, skips checks, records
  `timeout`, and attempts cleanup

#### Scenario: An operator cancels the attempt

- **WHEN** cancellation is requested after agent start
- **THEN** the runner terminates its owned process group, skips checks, records
  `cancelled`, and attempts cleanup

### Requirement: Hidden checks run only after agent termination

The acceptance contract, check driver, known-good change, and qualification
receipt MUST remain outside the agent workspace. The runner SHALL start the
immutable check driver only after the adapter process has terminated
successfully, require the exact declared inventory, and classify incomplete
checks, check failures, and regressions distinctly.

#### Scenario: The agent change passes hidden checks

- **WHEN** the terminated adapter leaves every required and regression check
  passing
- **THEN** the run records `success`

#### Scenario: A hidden regression fails

- **WHEN** required checks pass but any regression check fails
- **THEN** the run records `regression` and cannot be successful

### Requirement: Run receipts preserve exact bounded evidence

Every attempted execution SHALL return a closed v2 receipt tied to the plan,
task, manifest, fixture, acceptance contract, adapter, environment, public
workspace policy, ordered lifecycle, agent termination, redacted output
identities, checks, cleanup, and limitations. An adapter MAY declare one
workspace-relative closed diagnostics document. Valid token, cost, tool-name,
inspected-file, and modified-file observations from that document SHALL be
copied into the receipt after adapter termination. Undeclared or unavailable
fields MUST remain absent rather than being fabricated as zero. Diagnostics
remain activity metadata and MUST NOT replace executable checks.

#### Scenario: Cleanup succeeds

- **WHEN** the attempt reaches its terminal state and the workspace is removed
- **THEN** the receipt records complete cleanup and contains no temporary path or credential value

#### Scenario: Cleanup fails

- **WHEN** workspace removal fails
- **THEN** the receipt preserves `cleanup_failure` and cannot record success

#### Scenario: Declared diagnostics are valid

- **WHEN** a terminated adapter writes a bounded valid document at its declared workspace-relative path
- **THEN** the receipt preserves exactly the available redacted observations and hidden checks remain authoritative

#### Scenario: Declared diagnostics are invalid after a clean exit

- **WHEN** a zero-exit adapter declares diagnostics that are missing, unsafe, malformed, unknown, empty, secret-bearing, or out of bounds
- **THEN** hidden checks do not start and the receipt cannot record success
