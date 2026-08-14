## Purpose

Lets coding agents replace profiler-dominated Node runtime evidence with a
distinct exact-request observation that disables sampling profilers and retains
only bounded process, thread, trace-event, async, response, and correctness
evidence.

## ADDED Requirements

### Requirement: Derive an executable observer-effect follow-up

CodeVetter SHALL expose `repeat_with_lower_overhead_cpu_measurement` only when
an integrity-checked `inspect_main_thread_runtime` capture selects the observer
effect route.

#### Scenario: Inspector evidence crosses the fixed dominance floor

- **WHEN** a durable current runtime capture has complete pre-commit mechanism
  evidence whose `inspector` family crosses the routing floor
- **THEN** inspection accepts the lower-overhead follow-up for that same exact
  request and grants no source or edit authority

#### Scenario: Caller requests an unselected follow-up

- **WHEN** the durable capture does not select the requested lower-overhead
  route
- **THEN** CodeVetter rejects the request before starting application code

### Requirement: Disable sampling profilers for the follow-up

The lower-overhead recapture SHALL run the same exact qualified local flow in
an owned runtime with main-thread V8 and public Worker sampling profilers
disabled by CodeVetter policy.

#### Scenario: Exact flow is recaptured

- **WHEN** the caller supplies the source capture, selected probe, a new bounded
  recapture ID, and optional timeout
- **THEN** CodeVetter preserves the repository snapshot, target, test name,
  browser project, request ordinal, method, route, local-only network policy,
  sequential execution, and correctness assertion

#### Scenario: Runtime cannot attest the profiler-disabled profile

- **WHEN** CodeVetter cannot own and attest a runtime with sampling profilers
  disabled
- **THEN** the probe fails closed and retains no low-overhead route

#### Scenario: Caller supplies execution configuration

- **WHEN** the caller supplies a command, path, environment, base URL, network
  policy, concurrency, profiler flag, or mechanism label
- **THEN** CodeVetter rejects it before unrelated execution

### Requirement: Retain independent corroboration evidence

CodeVetter SHALL retain response-bounded process/thread CPU counters and closed
request-scoped Node trace mechanisms separately from async, browser
correctness, and profiler state.

#### Scenario: Complete isolated trace activity is observed

- **WHEN** profiler-disabled capture retains complete process/thread CPU,
  response boundary, and request-scoped native activity without overlapping
  dynamic requests
- **THEN** the receipt reports bounded GC, compilation, and libuv union activity
  with explicit profiler-disabled provenance

#### Scenario: Evidence is missing, overlapping, or incomplete

- **WHEN** any required boundary, profiler-state attestation, process/thread
  counter, or native inventory is unavailable, contaminated, or incomplete
- **THEN** corroboration is incomplete and cannot select a follow-up route

#### Scenario: Node buffers trace output until process termination

- **WHEN** the exact browser assertion and every configured diagnostic pass
  have completed on an owned runtime
- **THEN** CodeVetter stops only that owned server, retains its private evidence
  directory long enough to parse flushed trace events, and removes the
  directory during mandatory final cleanup

#### Scenario: Runtime is not owned by CodeVetter

- **WHEN** evidence comes from a repository-declared or otherwise unowned
  listener
- **THEN** CodeVetter never stops that process and cannot claim complete
  profiler-disabled native evidence from a missing seal

#### Scenario: Cold runtime trace exceeds the whole-file memory bound

- **WHEN** a sealed owned-runtime trace is within the fixed private file bound
  but too large to load as one in-memory string
- **THEN** CodeVetter scans it incrementally and retains only bounded closed
  events whose timestamps touch an admitted request interval

#### Scenario: Trace exceeds streaming or event bounds

- **WHEN** the private trace exceeds the fixed file, event, or per-event bound
- **THEN** CodeVetter reports a closed incomplete reason and retains no native
  mechanism route or raw trace value

### Requirement: Route only corroborated mechanisms

CodeVetter SHALL use a fixed 5 ms union-activity floor and SHALL NOT translate
wall-time intervals into exact or exclusive CPU.

#### Scenario: One closed mechanism crosses the floor

- **WHEN** complete isolated GC, compilation, or one libuv mechanism retains at
  least 5 ms of request-scoped union activity
- **THEN** CodeVetter may select only that mechanism's bounded next observation
  with low confidence, null source causality, and no edit authority

#### Scenario: No closed mechanism crosses the floor

- **WHEN** exact process/thread CPU is material but every retained trace
  mechanism is below 5 ms
- **THEN** CodeVetter reports unresolved low-overhead runtime work without
  choosing the largest sub-threshold mechanism

#### Scenario: Exact CPU pressure is immaterial

- **WHEN** complete pre-commit main-thread CPU is below 5 ms
- **THEN** CodeVetter reports insufficient runtime pressure and authorizes no
  further performance probe

### Requirement: Compare repeated corroborated routes

The bounded stability scheduler SHALL accept the lower-overhead probe and
derive each run's route from its retained corroboration evidence.

#### Scenario: Compatible passing routes agree

- **WHEN** three compatible correctness-passing profiler-disabled recaptures
  select the same non-null corroborated route
- **THEN** CodeVetter reports a stable bounded follow-up without source, edit,
  optimization, or production authority

#### Scenario: Routes disagree or correctness fails

- **WHEN** compatible routes disagree, become unresolved, or any included exact
  flow fails correctness
- **THEN** the scheduler stops without executing another unnecessary run or
  authorizing a follow-up

### Requirement: Preserve existing evidence

CodeVetter SHALL continue to validate prior runtime, inventory, stability, and
schedule receipts without inventing lower-overhead evidence.

#### Scenario: Legacy evidence is reloaded

- **WHEN** an existing durable receipt predates profiler-disabled
  corroboration
- **THEN** its original normalized result remains valid and the new evidence is
  explicitly unavailable
