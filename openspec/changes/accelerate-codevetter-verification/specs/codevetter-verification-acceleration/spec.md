## Purpose

Define a CodeVetter-owned, resource-bounded changed-verification workflow that shortens local feedback while continuously proving its selected checks agree with exhaustive verification.

## ADDED Requirements

### Requirement: Exact changed-verification plan
CodeVetter SHALL provide one repository-owned command that resolves an exact worktree, staged, commit, or range change; emits the selected verification lanes and reasons; and preserves an explicit exhaustive mode.

#### Scenario: Frontend-only worktree change
- **WHEN** the exact worktree change is completely covered by current checked-in capability and test-impact evidence
- **THEN** the command selects the required frontend and browser lanes without compiling unrelated Rust targets
- **AND** records every omitted lane with its qualifying evidence

#### Scenario: Operator requests exhaustive verification
- **WHEN** the operator selects exhaustive mode
- **THEN** the command runs every required CodeVetter verification lane regardless of focused-selection evidence

### Requirement: Safe lane selection
The changed-verification plan MUST include mandatory smoke checks and SHALL widen to the checked broad fallback when a changed path, shared contract, test mapping, or supporting evidence is unmatched, stale, incomplete, truncated, or untrusted.

#### Scenario: Shared configuration changes
- **WHEN** a lockfile, package script, test configuration, shared route, IPC contract, or verification runtime changes
- **THEN** the plan widens to the configured fallback lanes and explains the invalidated boundaries

#### Scenario: Selected lane cannot start
- **WHEN** any required selected lane is unavailable or exits without a complete receipt
- **THEN** the overall result is `no_confidence` and cannot be reused as passing verification

### Requirement: Resource-bounded execution profiles
CodeVetter SHALL define checked-in execution profiles that bound concurrent processes, CPU-intensive work, browser contexts, target-origin requests, memory reservations, and shared mutable state while preserving the same required checks.

#### Scenario: Interactive profile runs on a developer machine
- **WHEN** the operator uses the default interactive profile
- **THEN** the scheduler does not start work whose declared resources exceed the remaining profile budget
- **AND** reports queue time separately from execution time

#### Scenario: Two lanes require exclusive shared state
- **WHEN** two otherwise parallel lanes declare the same exclusive state identity
- **THEN** the scheduler serializes those lanes without serializing independent work

### Requirement: Selection is qualified against exhaustive truth
CodeVetter MUST maintain a versioned representative change corpus that executes both selected and exhaustive verification and gates focused selection on verdict agreement and complete required coverage.

#### Scenario: Focused selection misses a failing check
- **WHEN** exhaustive verification detects a regression that the selected plan omitted
- **THEN** qualification fails, identifies the missing impact edge, and prevents that selector revision from becoming authoritative

#### Scenario: Focused and exhaustive verification agree
- **WHEN** both plans produce equivalent complete verdicts for every corpus case
- **THEN** the receipt reports saved wall time, CPU time, peak memory, and executed-check count without claiming broader correctness than the corpus proves

### Requirement: Representative warm UI feedback is tenfold faster
The qualified CodeVetter warm changed path SHALL complete representative UI leaf-change verification at least 10x faster than the checked 16.3-second focused Playwright baseline, with a p95 wall-time target of 1.5 seconds or less, while preserving the required visible-state, runtime-error, and accessibility assertions and exhaustive verdict agreement.

#### Scenario: Parallel workers improve the unchanged suite by less than tenfold
- **WHEN** increasing Playwright workers reduces the focused suite from 16.3 seconds to 9.8 seconds
- **THEN** CodeVetter records the result as a component measurement rather than a successful acceleration result
- **AND** does not promote the profile as the changed-verification default

#### Scenario: Warm selected verification reaches the target
- **WHEN** representative UI leaf changes complete at or below the 1.5-second p95 target and qualification finds no selected-versus-exhaustive mismatch
- **THEN** the receipt reports the exact baseline ratio, assertions executed, corpus scope, and resource profile

#### Scenario: Fast execution weakens evidence
- **WHEN** an experimental optimization reaches the timing target by omitting a required assertion, reusing unsafe mutable state, bypassing actionability, or masking a failure observed by exhaustive verification
- **THEN** qualification fails regardless of wall time
