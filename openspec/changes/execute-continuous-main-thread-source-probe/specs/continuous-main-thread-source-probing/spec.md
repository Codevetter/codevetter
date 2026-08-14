## Purpose

Lets coding agents obtain bounded repository-source evidence for one exact
local Node request after lower-overhead measurement proves material but
otherwise unexplained main-thread CPU.

## ADDED Requirements

### Requirement: Derive the continuous source probe from unresolved evidence

CodeVetter SHALL expose `inspect_continuous_main_thread_source` only from an
integrity-checked, correctness-passing lower-overhead capture whose isolated
pre-commit main-thread CPU is at least 5 ms and whose closed native mechanism
route is unresolved.

#### Scenario: Material main-thread CPU remains unexplained

- **WHEN** the current durable lower-overhead capture is complete, isolated,
  correctness-passing, and reports at least 5 ms of pre-commit main-thread CPU
  without a closed native mechanism crossing its route floor
- **THEN** inspection accepts the continuous source probe for that exact
  request with low confidence and no source, edit, or optimization authority

#### Scenario: Upstream evidence selects another route

- **WHEN** the lower-overhead capture is incomplete, contaminated,
  correctness-failing, immaterial, stale, or selects a closed mechanism route
- **THEN** CodeVetter rejects the continuous source probe before starting
  application code

### Requirement: Profile continuously from owned-runtime startup

The continuous source recapture SHALL use a CodeVetter-owned local Node runtime
that starts a fixed low-frequency main-thread sampling profiler before
application warm-up, privately rotates it after owned warm-up and before the
exact browser flow, and stops the retained profile at the response commitment
of the exact qualified request.

#### Scenario: Exact qualified request is recaptured

- **WHEN** the caller supplies the source capture, selected probe, a new
  bounded recapture ID, and optional timeout
- **THEN** CodeVetter preserves the repository snapshot, target, test name,
  browser project, request ordinal, method, route, local-only network policy,
  sequential execution, and correctness assertion

#### Scenario: Caller supplies execution or profiler configuration

- **WHEN** the caller supplies a command, path, environment, base URL, network
  policy, concurrency, request selector, sampling interval, or profiler flag
- **THEN** CodeVetter rejects it before unrelated execution

#### Scenario: Startup profiling is not attested

- **WHEN** the owned runtime cannot prove that sampling began before warm-up or
  cannot match exactly one committed request to the derived selector
- **THEN** source evidence is incomplete and no source route is retained

#### Scenario: Cold startup profiling makes stop latency excessive

- **WHEN** the owned runtime completes warm-up and preflight before the exact
  browser flow
- **THEN** CodeVetter intercepts one private loopback arm request before
  application dispatch, discards the cold profile, and immediately restarts
  fixed sampling without allowing caller-controlled profiler settings

### Requirement: Slice the request without guessing across clock origins

CodeVetter SHALL derive the pre-commit sample interval from one profile's
ordered time deltas and independently measured request duration and profiler
stop tail, and SHALL report a bounded boundary uncertainty.

#### Scenario: Request and stop boundaries are complete

- **WHEN** the profile has complete ordered nodes, samples, and non-negative
  time deltas; the exact request commits once; and the profiler stop tail is
  finite and within its fixed bound
- **THEN** CodeVetter selects only samples whose cumulative profile positions
  fall inside the reconstructed pre-commit interval and reports the sampling
  and stop-tail boundary uncertainty

#### Scenario: Profile clocks have different absolute origins

- **WHEN** the profiler timestamps and request clock do not share an absolute
  origin
- **THEN** CodeVetter uses only relative durations within the captured profile
  and never aligns their absolute timestamps

#### Scenario: Boundary reconstruction is unsafe

- **WHEN** timing deltas are missing, negative, truncated, shorter than the
  request-plus-tail interval, or the stop tail exceeds its fixed bound
- **THEN** source evidence is invalid or incomplete and contains no candidates

### Requirement: Retain bounded source and scope evidence

CodeVetter SHALL classify admitted samples into the closed scopes
`repository`, `dependency`, `generated`, `runtime`, `idle`, and `unresolved`,
and SHALL expose only contained source-mapped repository candidates.

#### Scenario: Repository source crosses the fixed floor

- **WHEN** complete isolated pre-commit evidence assigns one contained
  repository frame at least 5 samples, 5 ms sampled self time, and 10 percent
  of admitted non-idle sampled time
- **THEN** CodeVetter reports that frame's repository-relative file, line,
  redacted function label, samples, sampled self time, and sample share as a
  low-confidence candidate

#### Scenario: Non-repository or arbitrary identity is sampled

- **WHEN** an admitted frame belongs to a dependency, generated output, Node or
  V8 runtime, idle work, an excluded path, or an unknown URL
- **THEN** CodeVetter retains only its closed aggregate scope and exposes no raw
  path, URL, function, ID, argument, or value

#### Scenario: Dynamic request overlaps before commitment

- **WHEN** another correlated dynamic request overlaps the selected request
  before its response commits
- **THEN** source evidence is contaminated and contains no candidates

### Requirement: Separate sampled evidence from causal authority

Continuous source output SHALL describe sampled self time rather than exact or
exclusive CPU and SHALL NOT by itself identify a bottleneck, causal change, or
permitted edit.

#### Scenario: One source candidate dominates

- **WHEN** one repository frame crosses every candidate floor
- **THEN** CodeVetter labels it an observed candidate, retains low confidence,
  and keeps causal, edit, optimization, production, and performance-improvement
  authority false

#### Scenario: No repository candidate crosses the floor

- **WHEN** complete material pre-commit evidence is diffuse or contains only
  non-repository scopes
- **THEN** CodeVetter reports unresolved source work without choosing the
  largest sub-threshold frame

#### Scenario: Browser correctness fails

- **WHEN** source profiling completes but the exact Playwright assertion fails
- **THEN** evidence remains inspectable while correctness blocks every source
  route and further scheduled repetition

### Requirement: Require repeated compatible source routes

The bounded stability scheduler SHALL accept the continuous source probe and
derive each run's route from its normalized repository candidates.

#### Scenario: Three compatible passing routes agree

- **WHEN** three integrity-compatible, correctness-passing recaptures select
  the same repository file and line and each crosses every fixed candidate
  floor
- **THEN** CodeVetter reports a stable source observation while retaining low
  confidence and no causal, edit, optimization, or production authority

#### Scenario: Routes disagree or become unresolved

- **WHEN** compatible recaptures select different source locations, one has no
  eligible candidate, or one fails correctness or completeness
- **THEN** the scheduler stops without another unnecessary run or source route

### Requirement: Preserve existing durable evidence

CodeVetter SHALL continue to validate existing browser, runtime,
lower-overhead, inventory, and stability receipts without inventing continuous
source evidence.

#### Scenario: Legacy receipt is reloaded

- **WHEN** a durable receipt predates continuous startup profiling
- **THEN** its original normalized result remains valid and continuous source
  evidence is explicitly unavailable
