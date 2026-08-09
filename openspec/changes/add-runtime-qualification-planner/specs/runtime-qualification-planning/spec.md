## Purpose

Define how CodeVetter identifies trustworthy, bounded local performance workloads before an agent spends resources profiling or claims that an application bottleneck was measured.

## ADDED Requirements

### Requirement: Qualification is read-only and bounded
CodeVetter SHALL inspect only bounded repository metadata and source text when qualifying a repository. Qualification MUST NOT execute project code, install dependencies, start services, contact a network, modify the target repository, or treat a discovered runtime as proof that a representative workload exists.

#### Scenario: Repository has a test dependency
- **WHEN** a package manifest declares Vitest but no suitable exact performance workload is found
- **THEN** qualification reports the supported runtime lane separately from workload readiness
- **AND** does not run Vitest or describe the repository as profile-ready

#### Scenario: Repository contains nested tooling
- **WHEN** the only supported manifest or configuration belongs to a nested documentation, fixture, or tooling package
- **THEN** qualification records that evidence with its package scope
- **AND** does not attribute that runtime to the whole product without a representative candidate

### Requirement: Candidates have exact identity and explainable rank
Each discovered candidate SHALL identify a supported adapter, repository-relative target, exact workload name when required by the adapter, package scope, bounded evidence, safety flags, and an explainable score. CodeVetter MUST rank explicit benchmarks and performance-named workloads ahead of generic tests and MUST NOT invent exact names that were not found in source evidence.

#### Scenario: Go benchmark is discovered
- **WHEN** a bounded Go test file declares `BenchmarkParseRows`
- **THEN** the candidate uses the Go benchmark adapter, the containing package target, and the exact benchmark name
- **AND** cites the declaration as direct evidence

#### Scenario: Generic unit tests are the only candidates
- **WHEN** supported unit tests exist but none carries benchmark, performance, scale, load, or timing evidence
- **THEN** CodeVetter may list a bounded low-ranked candidate set
- **AND** requires agent selection rather than choosing one as representative

### Requirement: Readiness remains conservative
Qualification SHALL return exactly one repository status from `ready`, `needs_selection`, `no_representative_workload`, `unsupported`, or `inaccessible`. A repository is `ready` only when one supported exact candidate crosses the recorded qualification threshold without unsafe external-operation signals. Ambiguity, absent exact identity, browser-only work, and likely network or production dependencies MUST lower readiness rather than be silently accepted.

#### Scenario: Explicit local performance test is unambiguous
- **WHEN** one supported exact workload has strong benchmark evidence and no external-operation warning
- **THEN** qualification returns `ready` with that candidate as the recommended next profiling scope

#### Scenario: Performance test appears network-dependent
- **WHEN** candidate source includes bounded evidence of remote URLs, database clients, browser automation, or environment-gated services
- **THEN** qualification includes safety flags and does not return `ready`

#### Scenario: No supported runtime exists
- **WHEN** bounded evidence establishes no Node, Vitest, or Go performance adapter
- **THEN** qualification returns `unsupported` with limitations

### Requirement: Portfolio qualification is explicit and sequential
CodeVetter SHALL accept a versioned manifest containing bounded repository identifiers and paths, qualify entries sequentially, and emit one versioned aggregate report with one result per declared repository. The report MUST preserve input order, bound repository and candidate counts, omit absolute repository paths, and continue after an inaccessible or unsupported entry.

#### Scenario: Mixed portfolio is qualified
- **WHEN** a manifest contains ready, unsupported, and missing repositories
- **THEN** the aggregate report includes all declared identifiers in order with their individual statuses
- **AND** summarizes status counts without failing the whole portfolio

#### Scenario: Portfolio exceeds its bound
- **WHEN** a manifest declares more repositories than the contract permits
- **THEN** CodeVetter rejects it before inspecting any repository

### Requirement: Agents receive the next safe operation
For a ready repository, qualification SHALL return a closed profiling recipe compatible with the existing performance operation. For every other status it SHALL return a deterministic next action explaining what evidence or operator choice is missing. CLI and MCP surfaces MUST preserve the same versioned result and uncertainty.

#### Scenario: Ready candidate is returned through MCP
- **WHEN** an agent calls the local qualification tool for a repository with an unambiguous exact workload
- **THEN** the result includes the adapter, target, exact name, bounded sample policy, evidence, and limitations needed for a subsequent explicit profile call

#### Scenario: Workload is not representative
- **WHEN** the planner finds only startup-dominated or generic test scopes
- **THEN** the next action asks for a batched or representative workload
- **AND** no optimization target is inferred

