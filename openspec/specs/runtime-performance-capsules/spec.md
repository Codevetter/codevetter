# runtime-performance-capsules Specification

## Purpose
Define bounded runtime performance evidence that helps coding agents detect regressions and locate repository-owned bottleneck candidates in exact Node, React, and Go workflows.
## Requirements
### Requirement: Profiling execution is exact, bounded, and opt-in
CodeVetter SHALL profile only a closed supported adapter with one
repository-relative target and optional exact workload name. Each request MUST
declare bounded warmup and sample counts, use separated process arguments, and
apply the existing repository-containment, timeout, minimal-environment, and
owned-process cleanup guarantees.

#### Scenario: Exact Node workload is profiled
- **WHEN** a user selects a Node test or Vitest file and an exact test identity
- **THEN** CodeVetter runs only that scope for the bounded warmup, measurement, and profiling passes

#### Scenario: Exact Go benchmark is profiled
- **WHEN** a user selects a Go benchmark file and exact benchmark identity
- **THEN** CodeVetter runs that package with an exact benchmark expression and bounded count without running unrelated tests

#### Scenario: Profile target escapes the repository
- **WHEN** the target is absolute, traverses outside the repository, or resolves through an escaping symlink
- **THEN** CodeVetter rejects the request before starting a process

#### Scenario: Repository contains untracked files
- **WHEN** the profiled worktree contains an untracked non-ignored file
- **THEN** the capsule records a dirty snapshot without fabricating changed-line intersections for that file

### Requirement: Performance capsules separate measurements from findings
Each successful request SHALL emit one versioned Runtime Performance Capsule
containing subject identity, exact scope, terminal executions, wall-time
distribution, runtime-specific measurements, repository-owned hotspots,
deterministic findings, limitations, and capture coverage. Captured values MUST
remain separate from comparisons and unverified optimization hypotheses.

#### Scenario: V8 profile contains repository source samples
- **WHEN** a Node or Vitest profiling pass produces valid V8 CPU profiles
- **THEN** the capsule reports bounded repository-relative hotspot functions, source locations, self time, and sample share as observed evidence

#### Scenario: Go benchmark reports allocations
- **WHEN** a Go benchmark emits valid benchmark and allocation measurements
- **THEN** the capsule reports bounded `ns/op`, `B/op`, and `allocs/op` values with benchmark identity and provenance

#### Scenario: Go profiles contain repository symbols
- **WHEN** the diagnostic Go pass emits CPU and allocation profiles that the installed toolchain can read
- **THEN** the capsule reports bounded repository-relative functions, source lines, flat and cumulative values, profile kind, and sample share without retaining the raw profiles

#### Scenario: Runtime profile lacks application samples
- **WHEN** profiling captures only runner, dependency, or test-harness work
- **THEN** CodeVetter reports the coverage limitation and does not name an application bottleneck

#### Scenario: Vitest startup dominates the measured scope
- **WHEN** reported assertion time is less than the bounded share of exact-scope process wall time
- **THEN** CodeVetter records a startup-dominated finding and does not attribute the process latency to product code

### Requirement: Baseline comparisons are explicit and reproducible
CodeVetter SHALL compare a current capsule only with an explicitly supplied,
compatible baseline capsule. The comparison MUST record both subject identities,
metric, sample counts, absolute and percentage deltas, and threshold policy.
Incompatible or statistically insufficient evidence MUST remain
`no_confidence`.

#### Scenario: Wall time materially regresses
- **WHEN** the current median exceeds the compatible baseline by both the recorded relative and absolute thresholds
- **THEN** the capsule deterministically reports a regression with the measured deltas and exits with the regression outcome

#### Scenario: Current and baseline scopes differ
- **WHEN** adapter, target, or exact workload identity differs between current and baseline
- **THEN** CodeVetter refuses the comparison and reports `no_confidence`

#### Scenario: No baseline is supplied
- **WHEN** profiling completes without a baseline capsule
- **THEN** CodeVetter reports measurements and hotspot candidates without claiming regression or improvement

#### Scenario: Host timing is unstable
- **WHEN** current or baseline wall-time samples exceed the recorded variability threshold
- **THEN** CodeVetter reports host-load and sample-spread evidence and refuses to claim a regression

### Requirement: Profiling artifacts are private, bounded, and disposable
CodeVetter MUST create runtime profiles only in an owned temporary directory,
redact repository prefixes and credential-shaped values before output, bound all
measurements and hotspots, disclose truncation, and remove the temporary profile
directory after parsing. It MUST NOT modify tracked target files or retain raw
profiles by default.

#### Scenario: Profile output contains sensitive material
- **WHEN** runner output or a source label contains credential-shaped data
- **THEN** the capsule contains a redaction marker and records the redaction count

#### Scenario: Profile contains excessive nodes
- **WHEN** runtime evidence exceeds collection bounds
- **THEN** the capsule retains only the ranked bounded subset and discloses omitted evidence

### Requirement: Machine outcomes distinguish regression from uncertainty
The profiling CLI SHALL emit exactly one JSON document. It SHALL exit `0` for a
completed measurement with no demonstrated regression, `1` for a demonstrated
compatible-baseline regression, and `2` for invalid input, failed workloads,
timeouts, incompatible baselines, incomplete measurements, or cleanup failure.

#### Scenario: Workload fails during profiling
- **WHEN** any required measured or profiling execution exits unsuccessfully
- **THEN** CodeVetter emits `no_confidence`, records the failed execution, and exits `2`

### Requirement: Agents receive an evidence-linked performance diagnosis
CodeVetter SHALL expose one `diagnose-performance` operation that profiles an
exact supported workload and emits a versioned diagnosis containing the
originating capsule, ranked observations, explicit inferences, unverified
hypotheses, one next bounded action, and a same-scope verification recipe. The
diagnosis MUST be deterministic and MUST NOT invoke a model or modify source.

#### Scenario: Go benchmark exposes allocation pressure
- **WHEN** a successful Go capsule contains allocation measurements and repository-owned allocation paths
- **THEN** the diagnosis ranks the measured `B/op` and `allocs/op`, identifies the strongest path as an inferred candidate, and requires the same benchmark to verify an optimization

#### Scenario: Deterministic catalogue benchmark scales superlinearly
- **WHEN** a successful capsule contains at least two same-unit metrics whose names encode increasing input sizes
- **THEN** the diagnosis reports the endpoint ratios and scaling exponent as observed evidence and identifies the leading repository hotspot only as an optimization candidate

#### Scenario: Runner startup dominates
- **WHEN** the capsule contains a startup-dominated finding
- **THEN** the diagnosis does not name application code as the primary issue and asks for a longer or batched representative workload

#### Scenario: Profiling evidence is incomplete
- **WHEN** the originating capsule has `no_confidence` or lacks the observations required for a diagnosis
- **THEN** the diagnosis preserves the limitations and recommends a bounded evidence-improvement experiment rather than an optimization

#### Scenario: Agent applies an optimization
- **WHEN** the diagnosis identifies an actionable candidate
- **THEN** its unverified hypothesis states what metric should move and its verification recipe selects the identical adapter, target, workload name, and sample policy

### Requirement: Runtime candidates receive bounded source context
CodeVetter SHALL inspect source only for bounded repository-owned locations
already selected by runtime evidence. Each source observation MUST record its
file and line window, redacted excerpt, matched pattern and exact pattern lines,
and containment limitations. Source patterns MUST remain distinct from inferred
optimization claims.

#### Scenario: Scaling hotspot intersects sort then slice
- **WHEN** a growing deterministic scale curve points to a JavaScript or TypeScript source window that fully sorts mapped candidates before taking a bounded slice and per-input cost materially increases
- **THEN** CodeVetter records the source pattern as observed evidence and proposes bounded top-k selection or deferred result materialization only as a falsifiable hypothesis

#### Scenario: Runtime-selected source escapes containment
- **WHEN** a source location is absolute, traverses outside the repository, resolves through an escaping symlink, exceeds the file bound, or uses an unsupported source type
- **THEN** CodeVetter omits the excerpt, records the limitation, and does not weaken the runtime diagnosis

#### Scenario: Hot TypeScript method retains only the first split segment
- **WHEN** a measured growing CPU path reaches a TypeScript method that splits a string with limit one and reads only element zero
- **THEN** CodeVetter confines inspection to that method and proposes direct delimiter search and slicing only as a falsifiable hypothesis

#### Scenario: Growing path repeatedly scans materialized object keys
- **WHEN** a superlinear measured path materializes object keys and repeatedly performs linear membership checks over that array
- **THEN** CodeVetter records the exact key-materialization and membership lines and proposes indexed membership only as a falsifiable hypothesis

### Requirement: Optimization verification uses identical domain evidence
CodeVetter SHALL expose `verify-optimization` for a repository-contained
baseline performance capsule or diagnosis and a newly captured identical scope.
It MUST verify workload success and compatibility before comparing bounded
domain metrics, and MUST return `confirmed`, `rejected`, `inconclusive`, or
`no_confidence` with exact deltas and policy.

#### Scenario: Catalogue optimization improves high-end scaling
- **WHEN** baseline and current capsules contain the same encoded input sizes and units, the largest-input time improves materially, no smaller input materially regresses, and both workloads pass
- **THEN** verification reports `confirmed` with per-input deltas and exponent movement

#### Scenario: Go allocation optimization reduces allocations
- **WHEN** identical Go benchmarks pass and B/op or allocs/op improves materially without an unacceptable ns/op regression
- **THEN** verification reports `confirmed` with all three metric deltas

#### Scenario: Workload identities differ
- **WHEN** schema, adapter, target, exact workload name, scale inputs, units, or Go benchmark identity differ
- **THEN** verification reports `no_confidence` and makes no optimization claim

#### Scenario: Candidate does not improve its target metric
- **WHEN** compatible before/after evidence is stable within the recorded policy
- **THEN** verification reports `inconclusive`; when the target metric materially regresses it reports `rejected`

### Requirement: Paired verification controls temporal host drift
CodeVetter SHALL support an opt-in paired verification operation when baseline
and candidate are available as independently runnable contained repositories.
It MUST alternate execution order, require exact workload and metric identity,
record the bounded schedule, and refuse confirmation if either side fails or
does not provide repeated comparable measurements.

#### Scenario: Two runnable revisions expose the same benchmark
- **WHEN** baseline and candidate repositories contain the same exact benchmark and emit matching domain metrics
- **THEN** CodeVetter alternates their run order, compares their repeated median measurements, and labels the result as paired evidence

#### Scenario: One paired workload fails
- **WHEN** any required baseline or candidate execution fails, times out, or does not execute the exact selected workload
- **THEN** paired verification reports `no_confidence` and cannot confirm the optimization

### Requirement: Performance coverage is qualified on owned and real targets
CodeVetter SHALL maintain hermetic fixtures for wall-time distributions, V8
hotspots, Go benchmark parsing, redaction, comparison outcomes, and incomplete
profiles. Real-project performance claims MUST identify the target revision,
machine context, workload, sample policy, and observed limitations.

#### Scenario: App Health qualification runs
- **WHEN** the profiler is exercised against selected App Health Node and Go benchmark scopes
- **THEN** results report measured coverage and gaps without changing App Health tracked files or contacting production services

#### Scenario: Consumer browser qualification runs
- **WHEN** a supported local browser connector traces an exact Significant Hobbies loopback journey
- **THEN** the qualification records vitals, network and main-thread observations, connector identity, run bounds, and limitations without contacting hosted services

#### Scenario: Consumer algorithm scale qualification runs
- **WHEN** Anime List recommendation logic is exercised at fixed deterministic catalogue sizes
- **THEN** the qualification records per-size timing, result identity, scaling behavior, and whether application work is material relative to runner overhead

#### Scenario: Open-source qualification runs
- **WHEN** CodeVetter profiles a bounded public Node or Go project with an existing local test or benchmark surface
- **THEN** the qualification records the immutable upstream revision, local-only workload, diagnosis, verification outcome, retained changes, and cleanup status

### Requirement: Self-improvement qualification

CodeVetter SHALL be able to profile a deterministic workload around one of its
own runtime-evidence operations without replacing runtime evidence with source
review alone.

#### Scenario: CodeVetter profiles itself
- **WHEN** an agent captures an exact scale workload around a repository-owned product operation
- **THEN** CodeVetter reports observed scale and source attribution before any optimization claim is accepted

#### Scenario: A self-improvement candidate is applied
- **WHEN** an agent changes the runtime-selected product path
- **THEN** the identical correctness and scale workload is rerun and the verifier distinguishes measured improvement from inference and unverified follow-up
