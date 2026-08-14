## Purpose

Lets an agent execute a supported durable browser next probe through CodeVetter
while preserving exact-flow identity, local-runtime safety, and correctness
boundaries.

## ADDED Requirements

### Requirement: Recapture one exact durable browser probe

CodeVetter SHALL accept a prior capture identity, its exact diagnosed probe, and
a new capture identity and SHALL execute the same statically qualified local
Playwright flow.

#### Scenario: Supported current recapture

- **WHEN** the prior receipt, result, diagnosis, source snapshot, and exact flow remain valid and the probe is supported
- **THEN** CodeVetter runs one bounded recapture and returns the new capture identity with the requested-evidence outcome

#### Scenario: Probe mismatch

- **WHEN** the supplied probe does not exactly match the durable diagnosis
- **THEN** CodeVetter rejects the operation before starting an application runtime

### Requirement: Bind recapture authority to unchanged source and flow identity

CodeVetter SHALL require the prior repository revision and source snapshot to
remain current and SHALL resolve exactly one qualified flow matching the prior
target, test name, and browser project.

#### Scenario: Source changed after diagnosis

- **WHEN** the current source snapshot differs from the prior capture
- **THEN** CodeVetter returns a stale outcome and starts no application runtime

#### Scenario: Flow identity became ambiguous

- **WHEN** qualification finds zero or multiple compatible exact flows
- **THEN** CodeVetter rejects the recapture instead of selecting a replacement flow

### Requirement: Own and clean up local execution

CodeVetter SHALL reuse its bounded local Vite/Next runtime policy, remote HTTP
denial, exact Playwright selection, timeout, and cleanup guarantees.

#### Scenario: Owned runtime cleanup

- **WHEN** recapture succeeds, fails, times out, or throws
- **THEN** CodeVetter attempts bounded runtime cleanup and reports cleanup failure as an operational failure

### Requirement: Persist recapture provenance

CodeVetter SHALL persist a closed receipt binding the prior capture, requested
probe, exact prior request ordinal, new capture, source snapshot, execution
outcome, evidence-completeness outcome, and integrity digests.

#### Scenario: Durable successful recapture

- **WHEN** the recapture produces a valid new Playwright receipt and result
- **THEN** the probe receipt retains their identities and digests without raw trace or application values

### Requirement: Expose equivalent CLI and MCP operations

CodeVetter SHALL expose the same recapture behavior through repository CLI and
runtime MCP operations with closed bounded arguments.

#### Scenario: Extra execution argument

- **WHEN** a caller supplies an unknown command, environment, path, or network argument
- **THEN** CodeVetter rejects it before execution

### Requirement: Preserve correctness and edit authority

A recapture SHALL report requested evidence independently from Playwright
correctness and SHALL never authorize a source edit or optimization when the
flow failed.

#### Scenario: Evidence complete but assertion failed

- **WHEN** the requested evidence becomes complete but the Playwright flow fails
- **THEN** the result reports observed evidence completeness while keeping edit eligibility false and correctness required
