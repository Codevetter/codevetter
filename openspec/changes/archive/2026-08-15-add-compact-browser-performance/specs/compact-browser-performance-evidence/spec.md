## Purpose

Defines compact, correctness-first local performance evidence for one explicitly
selected Playwright flow in a React/Vite repository without restoring a general
browser observability runtime.

## ADDED Requirements

### Requirement: Browser performance scopes are explicit
CodeVetter SHALL accept one repository-contained Playwright test file and exact
test name as a browser performance scope. Discovery MUST NOT claim that a
browser test is representative without caller selection.

#### Scenario: Caller selects an exact browser flow
- **WHEN** the caller supplies a contained Playwright test and exact test name
- **THEN** CodeVetter records that identity and executes only the matching test

#### Scenario: Browser test is only discovered
- **WHEN** qualification finds Playwright tests but the caller has not selected one
- **THEN** CodeVetter reports that selection is required and performs no browser execution

### Requirement: Playwright duration remains separate from orchestration time
CodeVetter SHALL record the Playwright-reported duration of the exact passing
test separately from process wall time across bounded repeated samples. Missing,
ambiguous, failed, retried, or truncated test evidence MUST produce no confidence.

#### Scenario: Every exact test sample passes once
- **WHEN** every measurement contains one passing result for the exact test
- **THEN** the receipt reports its bounded duration distribution and the separate process-wall distribution

#### Scenario: Test evidence is incomplete
- **WHEN** any required sample fails, retries, is absent, is ambiguous, or cannot be parsed completely
- **THEN** CodeVetter reports no confidence and does not infer a performance movement

### Requirement: Paired browser verification is correctness first
CodeVetter SHALL compare distinct incumbent and candidate checkouts using the
identical Playwright test bytes and an alternating sample schedule. A candidate
MUST NOT be kept unless every exact test passes and the test-duration movement
crosses the declared materiality floor without a protected orchestration-time regression.

#### Scenario: Exact flow materially improves
- **WHEN** ten alternating samples per side all pass, median test duration improves by at least 10 percent and 10 milliseconds, and process wall time does not regress by more than 20 percent
- **THEN** CodeVetter may confirm the local exact-flow improvement

#### Scenario: Correctness or comparability fails
- **WHEN** either checkout fails the exact test or the target test bytes differ
- **THEN** CodeVetter returns no confidence regardless of observed timing

### Requirement: Existing Vite artifacts are bounded and unverified
CodeVetter MAY inspect an explicitly supplied, repository-contained existing
Vite build directory. It SHALL follow only bounded relative initial JavaScript
imports from one contained HTML entry and report file count, raw bytes, and gzip
bytes as unverified artifact evidence.

#### Scenario: Existing initial JavaScript closure is readable
- **WHEN** the caller supplies a contained build directory and HTML entry whose bounded module closure is complete
- **THEN** CodeVetter reports the observed closure and labels it unverified

#### Scenario: Artifact is stale or incomplete
- **WHEN** artifact freshness cannot be proven or a closure edge escapes, is dynamic, missing, or exceeds a bound
- **THEN** CodeVetter records the limitation and the artifact cannot independently confirm an optimization

### Requirement: Existing optimization campaigns govern browser evidence
The optimization campaign SHALL accept the same exact Playwright scope and
retain baseline, screen, paired promotion, correctness, complexity, budget, and
receipt authority. CodeVetter MUST NOT accept or apply source patches.

#### Scenario: Candidate enters campaign screening
- **WHEN** a campaign candidate changes only allowed source and preserves the evaluator
- **THEN** CodeVetter runs the exact Playwright flow and applies the existing bounded screen and promotion policy

#### Scenario: Candidate changes the evaluator
- **WHEN** the candidate changes the selected Playwright test or another protected campaign file
- **THEN** CodeVetter rejects comparison before using timing evidence

### Requirement: Coverage gaps remain explicit
Receipts SHALL state that exact local Playwright duration and optional build
bytes do not measure production traffic, representative-device rendering,
browser memory, React component attribution, network-scale behavior, or global application optimality.

#### Scenario: Local browser improvement is confirmed
- **WHEN** paired verification confirms the selected flow
- **THEN** every unsupported coverage area remains visible beside the verdict
