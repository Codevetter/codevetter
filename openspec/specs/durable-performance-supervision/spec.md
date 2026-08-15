# durable-performance-supervision Specification

## Purpose
Define a durable outer execution boundary that preserves local performance-run identity and terminal evidence when the profiling child crashes, times out, is signaled, or cannot emit a valid capsule.
## Requirements
### Requirement: Supervision accepts only a closed profiling request
CodeVetter SHALL supervise only the existing `diagnose-performance` operation with one supported adapter, repository-contained target, optional workload name, bounded samples, warmups, timeout, and safe caller-supplied run ID. The supervisor MUST construct process arguments directly and MUST NOT accept a shell command, arbitrary arguments, inherited application environment, or an artifact path outside `.codevetter/performance-runs/<run-id>/`.

#### Scenario: Exact workload is supervised
- **WHEN** an agent supplies a valid run ID and exact supported performance scope
- **THEN** CodeVetter starts one owned diagnosis child with the same closed scope and records that scope before launch

#### Scenario: Run ID is unsafe or already exists
- **WHEN** the run ID escapes its artifact root, has an unsupported form, or names an existing run directory
- **THEN** CodeVetter rejects the request without launching a child or overwriting evidence

### Requirement: Receipt exists before the child can fail
Before launching the diagnosis child, CodeVetter MUST atomically persist a versioned receipt containing run identity, repository revision, dirty state, exact scope, bounded policy, supervisor identity, `initialized` state, and no inferred performance result. After launch it SHALL atomically refresh a `running` heartbeat without rewriting source files.

#### Scenario: Child is killed immediately after launch
- **WHEN** the child terminates before producing output
- **THEN** the pre-existing receipt still identifies the attempted scope and records its terminal signal or failure

#### Scenario: Receipt is inspected while running
- **WHEN** an agent reads an active run
- **THEN** it receives the latest atomic heartbeat and last recorded state without observing partial JSON

### Requirement: Every child outcome is classified without fabrication
The supervisor SHALL finalize exactly one terminal state from `succeeded`, `failed`, `timed_out`, `signaled`, `spawn_failed`, or `invalid_result`. A run is `succeeded` only when the child exits zero and emits exactly one valid performance diagnosis document. Non-zero exits, timeouts, signals, missing output, malformed JSON, or an incompatible schema MUST retain operational evidence and MUST NOT become performance findings.

#### Scenario: Valid diagnosis completes
- **WHEN** the child exits zero with one valid diagnosis document
- **THEN** the receipt records `succeeded`, the result digest, and a bounded result reference

#### Scenario: Child exits from a signal
- **WHEN** the operating system reports a child signal before valid completion
- **THEN** the receipt records `signaled`, the signal, last heartbeat, and no performance conclusion

#### Scenario: Child prints malformed JSON
- **WHEN** the child exits but stdout is not exactly one valid diagnosis document
- **THEN** the receipt records `invalid_result` with bounded redacted output evidence

### Requirement: Artifacts are bounded, redacted, and inspectable
CodeVetter SHALL retain only the atomic receipt, an optional validated result document, and bounded redacted failure output under the owned run directory. It MUST record byte bounds, truncation, redaction count, and result digest, and MUST expose read-only inspection by run ID through CLI and MCP without accepting a repository path after MCP startup.

#### Scenario: Failure output contains secrets
- **WHEN** child output includes credential-shaped values or absolute repository paths
- **THEN** the stored and returned evidence contains redaction markers and bounded text only

#### Scenario: Agent inspects a completed run
- **WHEN** an agent requests an existing run ID
- **THEN** CodeVetter returns the validated receipt and result summary or operational failure evidence without rerunning the workload

### Requirement: Supervisor cleanup is owned and bounded
On timeout, cancellation, or supervisor shutdown, CodeVetter SHALL terminate only the owned child process tree, wait a bounded grace interval, finalize the receipt when the supervisor remains alive, and stop heartbeat activity. It MUST NOT kill unrelated processes, delete target artifacts, or claim cleanup succeeded without observing child termination.

#### Scenario: Workload exceeds its supervisor deadline
- **WHEN** the child remains alive beyond the derived bounded run deadline
- **THEN** CodeVetter terminates the owned process tree, records `timed_out`, and returns the operational outcome
