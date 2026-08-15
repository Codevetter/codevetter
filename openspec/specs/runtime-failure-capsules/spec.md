# runtime-failure-capsules Specification

## Purpose
Define a bounded machine-readable diagnosis for common Node, browser, Cloudflare Worker, and Go verification failures without requiring a universal debugger or turning incomplete evidence into proof.
## Requirements
### Requirement: Supported runtime lanes are detected from repository evidence
CodeVetter SHALL detect Node test, browser test, Cloudflare Worker test, and Go
test lanes only from bounded repository manifests and configuration. Detection
MUST report the evidence, supported adapters, and limitations and MUST NOT claim
that a detected lane has executed successfully.

#### Scenario: Worker Vitest repository is detected
- **WHEN** a repository contains a package manifest, Vitest configuration, and a Wrangler configuration
- **THEN** CodeVetter reports Node test and Cloudflare Worker test lanes with the evidence paths that established them

#### Scenario: Unsupported repository is inspected
- **WHEN** no supported manifest or test configuration is found
- **THEN** CodeVetter returns an empty support set and explicit limitations without running a guessed command

### Requirement: Diagnostic execution is exact, bounded, and shell-free
CodeVetter SHALL execute only a closed adapter with one repository-relative test
target and optional exact test-name selector. Supported executable adapters in
the first slice SHALL be Node test, Vitest, Playwright, and Go test. Each run
MUST use separated program arguments, a declared timeout, bounded output,
minimal inherited environment, and owned process termination.

#### Scenario: Exact failing test is rerun
- **WHEN** the selected adapter, test target, and optional test name are valid and available
- **THEN** CodeVetter runs only that declared diagnostic scope and records the exact executable identity and arguments without invoking a shell

#### Scenario: Target escapes the repository
- **WHEN** a test target is absolute, traverses outside the repository, resolves through an escaping symlink, or is not a regular file
- **THEN** CodeVetter rejects the run before starting a process

#### Scenario: Diagnostic execution times out
- **WHEN** the owned diagnostic process exceeds its declared timeout
- **THEN** CodeVetter terminates it, records the timeout as an operational limitation, and returns `no_confidence`

### Requirement: Failure capsules separate evidence from interpretation
Each diagnostic run SHALL return one versioned Runtime Failure Capsule with
subject identity, adapter identity, exact scope, terminal state, observations,
source frames, relevant changes, limitations, capture coverage, and a verdict.
Directly captured observations MUST remain separate from deterministic
relationships and unverified hypotheses. The first slice MUST NOT ask a model
to create evidence or a verdict.

#### Scenario: Test fails with a changed source frame
- **WHEN** a diagnostic test reproduces a failure and its stack contains a source frame intersecting the selected Git diff
- **THEN** the capsule records the exception or panic as observed evidence and the frame-to-change match as a deterministic relationship

#### Scenario: Diagnostic rerun does not reproduce
- **WHEN** the selected diagnostic scope exits successfully or contains no qualifying failure
- **THEN** the capsule returns `no_confidence`, states that the failure did not reproduce, and does not invent a likely cause

### Requirement: Source and diff correlation is deterministic and bounded
CodeVetter SHALL normalize repository-contained source frames, inspect one
explicit Git diff range or the local diff, and rank relevant changed files and
lines using deterministic rules. Changed-frame intersection SHALL outrank
same-file proximity, and absent matches SHALL remain an explicit evidence gap.

#### Scenario: Stack line is changed
- **WHEN** an observed frame points to a line added or modified by the selected diff
- **THEN** that file and line rank first with reason `changed_frame_intersection`

#### Scenario: Failure has only dependency frames
- **WHEN** every observed frame is outside the repository or under excluded dependency/generated roots
- **THEN** CodeVetter records no relevant source match and preserves the source-attribution limitation

### Requirement: Captured data is redacted and bounded before output
CodeVetter MUST redact credential-shaped keys and values, authorization and
cookie material, configured sensitive fields, environment values, URL query
values, and repository-absolute path prefixes before evidence enters a capsule.
Collections, strings, stack frames, output bytes, and artifacts MUST have hard
bounds, and truncation MUST be disclosed.

#### Scenario: Failure output contains a token
- **WHEN** stdout, stderr, or an imported receipt contains credential-shaped material
- **THEN** the capsule contains a redaction marker instead of the material and records that redaction occurred

#### Scenario: Runner emits oversized output
- **WHEN** captured output exceeds its byte bound
- **THEN** CodeVetter retains only the bounded prefix or suffix required by policy and records truncation without treating capture as complete

### Requirement: Existing browser and Worker evidence is normalized, not rerun by a new engine
CodeVetter SHALL accept bounded existing T-Rex, warm-verification, Playwright,
and Worker-test result documents as imported observations. The original receipt
identity, verdict, limitations, and provenance MUST remain authoritative; the
capsule MUST NOT upgrade `failed` or `no_confidence` evidence to a pass.

#### Scenario: Failed Playwright receipt is imported
- **WHEN** a bounded receipt contains a failed browser test, page exception, console failure, or network failure
- **THEN** CodeVetter maps those facts into normalized observations while retaining the source receipt identity and limitations

#### Scenario: Worker receipt is incomplete
- **WHEN** a Worker test result lacks terminal or source identity
- **THEN** the capsule reports incomplete imported evidence and returns `no_confidence`

### Requirement: Machine interface has stable outcomes
The repository CLI SHALL expose lane detection and diagnostic execution with
JSON output. It SHALL exit `1` for a reproduced executable failure, `2` for
`no_confidence`, invalid input, or operational failure, and `0` only for a
successful detection request. A diagnostic failure capsule MUST NOT be treated
as proof that the overall change fails beyond its exact scope.

#### Scenario: JSON diagnostic reproduces a failure
- **WHEN** the CLI runs a selected diagnostic scope with `--json` and captures a qualifying failure
- **THEN** stdout contains exactly one capsule document and the process exits `1`

#### Scenario: Detection succeeds
- **WHEN** the CLI inspects a valid repository without executing tests
- **THEN** stdout contains one support report and the process exits `0`

### Requirement: Power-law coverage is measured against owned fixtures
CodeVetter SHALL maintain a small owned corpus spanning Node exceptions,
asynchronous failures, browser or Worker receipt failures, Go panics, redaction,
non-reproduction, timeout, and changed-line attribution. Published coverage
claims MUST derive from executed corpus results rather than stack inventory.

#### Scenario: Corpus qualification runs
- **WHEN** the focused qualification command executes the owned fixtures
- **THEN** it reports per-lane reproduction, relevant-file attribution, redaction, and no-confidence outcomes with no provider, network, browser download, or production dependency
