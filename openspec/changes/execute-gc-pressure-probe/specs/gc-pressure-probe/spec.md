## Purpose

Lets coding agents follow a corroborated local GC-pressure route into bounded,
repeatable allocation evidence without leaving CodeVetter or treating sampled
memory activity as causal proof.

## ADDED Requirements

### Requirement: Chain only integrity-checked probe evidence

CodeVetter SHALL accept a browser-probe recapture as the source of a follow-up
only when its receipt, linked Playwright receipt, result, subject, scope, exact
request, correctness, and normalized route all agree.

#### Scenario: Passing lower-overhead evidence selects GC pressure
- **WHEN** a completed current profiler-disabled recapture has passing correctness and its normalized exact-request route selects `inspect_gc_pressure`
- **THEN** CodeVetter exposes that one chained probe with the upstream receipt and linked capture identities retained

#### Scenario: Route or artifact does not agree
- **WHEN** the caller requests an unselected probe or any upstream hash, subject, scope, request, result, or route is stale, missing, or inconsistent
- **THEN** CodeVetter rejects the chained probe before starting application code

#### Scenario: Upstream correctness failed
- **WHEN** the selected route came from a browser flow whose correctness assertion failed
- **THEN** CodeVetter keeps the evidence inspectable but does not execute or schedule the GC follow-up

### Requirement: Execute an owned GC-pressure profile

The GC-pressure probe SHALL rerun the same exact qualified local Playwright
flow in an owned runtime under a closed CodeVetter diagnostic profile.

#### Scenario: Exact flow is rerun
- **WHEN** the caller supplies the source capture, upstream recapture, selected probe, a fresh bounded recapture ID, and optional timeout
- **THEN** CodeVetter preserves repository snapshot, test target, test name, browser project, request ordinal, method, route, local-only network policy, sequential execution, and browser correctness

#### Scenario: Caller attempts to configure instrumentation
- **WHEN** the caller supplies a command, path, environment, base URL, profiler setting, sampling interval, GC kind, source, concurrency, or network policy
- **THEN** CodeVetter rejects the input before unrelated execution

#### Scenario: Runtime ownership is unavailable
- **WHEN** CodeVetter cannot own and attest the GC-pressure runtime profile or cannot clean it up
- **THEN** the probe fails closed and grants no allocation or edit authority

### Requirement: Separate GC observations from allocation sampling

CodeVetter SHALL normalize request-scoped GC trace intervals, bounded heap
snapshots, and V8 sampled allocation callsites as separate evidence with their
observer and causality limits explicit.

#### Scenario: Complete isolated evidence is observed
- **WHEN** one exact request has a complete response boundary, no overlapping dynamic request, a bounded GC trace, a complete heap-sampling profile, and compatible request markers
- **THEN** the receipt reports allowlisted GC kinds, interval count, union duration, longest interval, before/commit heap observations, sampled bytes, and bounded repository allocation candidates

#### Scenario: Evidence is incomplete or contaminated
- **WHEN** the trace, profile, marker, boundary, inventory, source containment, or overlap check is incomplete, malformed, oversized, unsupported, or inconsistent
- **THEN** GC-pressure evidence is incomplete and cannot rank an allocation candidate

#### Scenario: Allocation source is sampled
- **WHEN** a repository allocation callsite appears in the request-scoped heap sample
- **THEN** CodeVetter labels it sampled allocation evidence and does not claim retained bytes, exclusive allocation, GC causality, exact CPU, or optimization impact

### Requirement: Route only material complete evidence

CodeVetter SHALL use fixed materiality and bounded-source policies rather than
caller-configurable thresholds or relative best-of-run selection.

#### Scenario: Material GC and repository allocation are both observed
- **WHEN** complete isolated GC union activity crosses 5 ms and a contained repository allocation candidate crosses the fixed sampled-byte and share floors
- **THEN** CodeVetter reports a low-confidence candidate diagnosis with source inspection eligibility but no edit eligibility

#### Scenario: GC activity is below the floor
- **WHEN** complete isolated GC union activity is below 5 ms
- **THEN** CodeVetter reports insufficient GC pressure and does not select the largest allocation source

#### Scenario: GC is material but source evidence is absent
- **WHEN** complete isolated GC union activity crosses 5 ms but no contained repository allocation candidate crosses the fixed source floors
- **THEN** CodeVetter reports unresolved GC pressure without blaming dependency, generated, runtime, or unknown work on repository code

### Requirement: Establish repeatability before candidate escalation

The bounded stability operation SHALL compare exact compatible GC-pressure
runs and distinguish stable diagnosis from another executable probe.

#### Scenario: Three passing observations agree
- **WHEN** three compatible correctness-passing GC-pressure runs agree on the same material classification and leading contained allocation source
- **THEN** CodeVetter reports a stable candidate diagnosis eligible for agent source inspection but still ineligible for an automatic edit or optimization claim

#### Scenario: Candidates disagree or correctness fails
- **WHEN** compatible runs disagree, evidence becomes incomplete, or any included flow fails correctness
- **THEN** CodeVetter stops without escalating a candidate or running another unnecessary observation

### Requirement: Preserve historical evidence and bounded operation

CodeVetter SHALL retain legacy browser capture, recapture, stability, and
schedule readability while keeping the new work local, bounded, and durable.

#### Scenario: Historical receipt is loaded
- **WHEN** an existing receipt predates chained GC-pressure evidence
- **THEN** CodeVetter validates its original fields without fabricating an upstream recapture, GC profile, or allocation candidate

#### Scenario: Local budget is exhausted
- **WHEN** the sequential repetition budget reaches three observations without a stable diagnosis
- **THEN** CodeVetter stops and records the terminal evidence state without cloud or production execution
