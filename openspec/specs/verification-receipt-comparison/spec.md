# verification-receipt-comparison Specification

## Purpose
Define deterministic ingestion and comparison of project-owned verification
receipts so agents can evaluate correctness, performance, and changed-test
blast radius without replacing the project's own test runner.
## Requirements
### Requirement: Receipt ingestion is closed, bounded, and immutable
CodeVetter SHALL accept only a versioned closed receipt containing repository
and revision identity, runner profile, environment identity, selection,
attempts, terminal outcomes, resource measurements, safety observations, and
explicit budgets. It MUST reject unknown fields, unsupported versions,
credential-shaped content, unsafe paths, inconsistent totals, duplicate
identities, and evidence beyond recorded bounds. Ingestion MUST leave the
source receipt unchanged and bind the normalized bundle to its exact SHA-256
identity.

#### Scenario: Valid receipt is ingested twice
- **WHEN** the same valid receipt bytes are ingested with the same repository scope
- **THEN** CodeVetter emits byte-equivalent normalized bundles with the same source receipt identity and verdict

#### Scenario: Receipt contains undeclared data
- **WHEN** a receipt contains an unknown field, credential-shaped value, absolute path, or repository escape
- **THEN** CodeVetter rejects it before emitting a qualified bundle

### Requirement: Correctness and performance verdicts remain independent
Every normalized bundle SHALL report correctness, performance, safety, and
overall qualification separately. A passing test outcome MUST NOT hide a
performance-budget failure, and a performance improvement MUST NOT hide a test
failure, incomplete inventory, live-network escape, fixed wait, or missing
required evidence.

#### Scenario: Tests pass but resource budget fails
- **WHEN** all terminal tests pass and peak RSS exceeds the declared maximum
- **THEN** correctness is `passed`, performance is `failed`, and the overall bundle is `failed`

#### Scenario: Required evidence is unavailable
- **WHEN** a declared budget cannot be evaluated because its measurement is missing
- **THEN** the corresponding verdict and overall qualification are `no_confidence`

#### Scenario: No performance or safety budget is configured
- **WHEN** every metric in a verdict component is unconfigured
- **THEN** that component is `no_confidence` rather than a vacuous pass

### Requirement: Receipt comparison qualifies evidence compatibility
CodeVetter SHALL compare only receipts with compatible schema, repository,
runner profile, environment, and inventory identities. It MUST label evidence
as `same_commit`, `cross_commit`, or `incompatible`; cross-commit evidence MAY
report observed deltas but MUST NOT be presented as a controlled same-commit
speedup. Comparisons SHALL preserve raw values, absolute deltas, percentage
deltas, sample counts, and declared budget policies.

#### Scenario: Same-commit receipts are compared
- **WHEN** baseline and current receipts share the exact commit and all compatibility identities
- **THEN** CodeVetter emits qualified performance and failure-set deltas labeled `same_commit`

#### Scenario: Compatible commits differ
- **WHEN** compatible baseline and current receipts differ only by revision
- **THEN** CodeVetter labels the comparison `cross_commit`, reports directional deltas, and records the limitation

#### Scenario: Runner profiles differ
- **WHEN** baseline and current receipts use different runner, environment, or inventory identities
- **THEN** CodeVetter emits `incompatible` and makes no regression or improvement claim

### Requirement: Failure and inventory changes use a deterministic taxonomy
Comparison SHALL classify new, recovered, stable, and transiently recovered
failures by stable signature. It SHALL separately classify incomplete
inventory, inventory drift, selector widening, selector narrowing, fixed waits,
live-network escapes, retries, timeouts, and operational failures. Operational
failures MUST remain outside the successful-test denominator.

#### Scenario: Failed attempt passes on bounded recheck
- **WHEN** an executed test fails and a later declared recheck passes with the same test identity
- **THEN** CodeVetter classifies it as `transient_recovery` rather than a stable pass or stable failure

#### Scenario: Selected inventory silently narrows
- **WHEN** the current receipt omits tests present in a compatible baseline without declaring an allowed selector change
- **THEN** CodeVetter reports `unsafe_selector_narrowing` independently of executed-test outcomes

### Requirement: Blast-radius evidence is explicit and bounded
Every qualified bundle SHALL emit a machine-readable graph derived only from
declared changed files, selection reasons, executed tests, and failure
signatures. Edges SHALL identify their evidence kind and MUST NOT infer source
dependencies that the receipt did not declare. Unknown or truncated selection
relationships SHALL remain limitations.

#### Scenario: Changed file selects a failing test
- **WHEN** a receipt declares that a changed file selected a test which emitted a failure signature
- **THEN** the graph connects changed file to selected test to failure signature with observed evidence labels

#### Scenario: Selection reason is absent
- **WHEN** an executed test has no declared changed-file selection relationship
- **THEN** the test remains in the graph without a fabricated changed-file edge and the bundle records the missing explanation

### Requirement: CLI and MCP expose the same pure operations
The machine CLI and repository-scoped read-only MCP process SHALL call the same
ingestion and comparison implementation and return the same normalized bundle.
Inputs MUST be repository-relative bounded receipt paths. MCP calls MUST NOT
execute tests, accept shell commands, modify the target repository, switch
repository scope, or write bundles implicitly.

#### Scenario: CLI and MCP ingest the same receipt
- **WHEN** both transports ingest the same repository-relative receipt
- **THEN** their normalized bundle documents are semantically identical

#### Scenario: MCP input escapes its repository
- **WHEN** an MCP call supplies an absolute path, traversal, or escaping symlink
- **THEN** the process rejects the call before reading the receipt

### Requirement: Real-project claims preserve provenance and limitations
Qualification SHALL include hermetic receipts and at least one real
project-runner receipt with exact revision, environment, inventory, and
measurement provenance. Any cross-commit, single-sample, incomplete resource,
or partial process-tree evidence MUST remain explicit and MUST bound published
claims.

#### Scenario: Existing runner receipt has partial RSS evidence
- **WHEN** qualification ingests a receipt whose RSS metric excludes part of the process tree
- **THEN** the bundle retains the measurement and limitation without claiming total process-tree memory

### Requirement: Bounded producer-native receipts preserve authority
CodeVetter MAY adapt an explicitly recognized producer-native receipt into the
canonical contract. The adapter MUST bind the canonical bundle to the raw
source SHA-256, reject unsupported formats, omit producer-only sensitive or
machine-local fields, and preserve missing inventory, measurements, budgets,
or execution evidence as `no_confidence`.

#### Scenario: Producer fails before test execution
- **WHEN** a recognized producer-native receipt records a setup failure but no test inventory or attempts
- **THEN** CodeVetter emits an operational failure with missing evidence and makes no correctness, performance, safety, or inventory pass claim
