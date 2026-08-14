## Purpose

Lets coding agents replace a broad Node main-thread `runtime` CPU label with
bounded, repeatable mechanism evidence for one exact local server request.

## ADDED Requirements

### Requirement: Retain closed runtime-mechanism evidence

CodeVetter SHALL classify runtime-scoped V8 samples into the closed families
`module_loading`, `compilation`, `garbage_collection`, `promise_microtasks`,
`timers_scheduling`, `http_streams`, `buffer_encoding`, `filesystem`,
`crypto_compression`, `inspector`, `v8_builtins`, and `other_runtime`.

#### Scenario: Runtime frames are sampled before response commitment

- **WHEN** a complete isolated request profile contains runtime-scoped samples
  before the exact response-commit boundary
- **THEN** CodeVetter reports bounded per-family sample counts, sampled time,
  and runtime-sample share for that pre-commit interval

#### Scenario: Raw identity is arbitrary

- **WHEN** a runtime frame contains an unknown URL, function name, ID, or engine
  label
- **THEN** CodeVetter retains only `other_runtime` and exposes none of the raw
  identity

#### Scenario: Profile evidence is incomplete or contaminated

- **WHEN** nodes, samples, timing deltas, request isolation, or the response
  boundary are incomplete or inconsistent
- **THEN** runtime-mechanism evidence is explicitly incomplete and cannot select
  a follow-up route

### Requirement: Separate mechanism observation from causal inference

CodeVetter SHALL treat runtime-mechanism timing as sampled self time rather than
exact or exclusive CPU and SHALL NOT assign it to an application source line.

#### Scenario: One mechanism dominates retained samples

- **WHEN** one non-observer mechanism contributes at least 5 ms and 20 percent
  of complete pre-commit runtime sampled time
- **THEN** CodeVetter may select a mechanism-specific next observation while
  retaining low confidence, null source causality, and no edit authority

#### Scenario: Inspector work dominates

- **WHEN** profiler or inspector frames cross the same fixed floor
- **THEN** CodeVetter reports observer-effect evidence and requests a
  lower-overhead measurement instead of treating inspector work as an
  application bottleneck

#### Scenario: No mechanism crosses the floor

- **WHEN** complete runtime evidence is diffuse or below threshold
- **THEN** CodeVetter reports unresolved runtime work and requests narrower
  evidence without choosing the largest sub-threshold family

### Requirement: Preserve only isolated pre-commit evidence

CodeVetter SHALL distinguish dynamic-request overlap before response commitment
from overlap that begins only after the exact response-commit boundary.

#### Scenario: Redirect target begins after response commitment

- **WHEN** a second correlated dynamic request begins after the profiled
  response commits but before that response fully finishes
- **THEN** CodeVetter keeps the whole-request profile contaminated, emits no
  whole-request source candidates, and may retain only complete samples at or
  before the commitment boundary

#### Scenario: Another request begins before response commitment

- **WHEN** any correlated dynamic request overlaps the profiled request before
  its response commits
- **THEN** CodeVetter rejects both whole-request and pre-commit sampled evidence
  as contaminated

#### Scenario: Legacy overlap has no pre-commit count

- **WHEN** an older raw profile reports overlap without the new boundary-aware
  count
- **THEN** CodeVetter conservatively treats the overlap as pre-commit and does
  not reconstruct isolated evidence

#### Scenario: Post-commit evidence is retained

- **WHEN** normalization admits an isolated pre-commit slice from a profile
  with later overlap
- **THEN** every whole-request completeness, source-candidate, causal, and edit
  authority remains false or empty

### Requirement: Execute the emitted main-thread runtime probe

The browser probe recapture operation SHALL accept
`inspect_main_thread_runtime`, replay the same exact qualified local flow, and
persist runtime-mechanism completeness independently from Playwright
correctness.

#### Scenario: Current exact flow is recaptured

- **WHEN** the durable source diagnosis emits `inspect_main_thread_runtime` and
  the caller provides only a new bounded recapture ID and timeout
- **THEN** CodeVetter captures the runtime-mechanism profile on the same target,
  test name, browser project, request ordinal, method, route, and source snapshot

#### Scenario: Browser assertion fails with complete mechanism evidence

- **WHEN** runtime-mechanism capture completes but the exact Playwright
  assertion fails
- **THEN** evidence is retained while correctness remains failed and no
  follow-up, edit, or optimization is authorized

#### Scenario: Executed runtime evidence selects a lower-overhead follow-up

- **WHEN** a completed runtime recapture reports an inspector observer effect
  and selects `repeat_with_lower_overhead_cpu_measurement`
- **THEN** CodeVetter can integrity-bind that exact recapture as the upstream
  authority for the profiler-disabled follow-up without reusing stale evidence

#### Scenario: Caller supplies an arbitrary execution value

- **WHEN** a CLI or MCP caller supplies a command, path, environment, base URL,
  network policy, or mechanism label
- **THEN** CodeVetter rejects it before unrelated execution

### Requirement: Compare repeated runtime routes

CodeVetter SHALL derive each runtime recapture's stability route from its
retained dominant mechanism rather than from the unchanged broad source probe.

#### Scenario: Three mechanism routes agree

- **WHEN** three compatible passing runtime recaptures unanimously cross the
  same mechanism and next-observation floor
- **THEN** the bounded scheduler may report a stable mechanism route while
  retaining no edit authority

#### Scenario: Runtime mechanisms disagree

- **WHEN** compatible runtime recaptures select different mechanisms or one
  becomes unresolved
- **THEN** CodeVetter reports instability immediately and executes no further
  repetition

### Requirement: Preserve durable legacy evidence

CodeVetter SHALL continue to load and validate existing request CPU, browser
server-flow, Playwright, and inventory-probe receipts produced before runtime
mechanism evidence existed.

#### Scenario: Existing High Signal evidence is reloaded

- **WHEN** a legacy durable capture or inventory recapture is inspected,
  assessed, or reused by the scheduler
- **THEN** its original normalized diagnosis remains valid and no runtime
  mechanism values are fabricated
