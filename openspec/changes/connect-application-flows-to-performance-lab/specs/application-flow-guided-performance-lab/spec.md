## Purpose

Defines the compact local loop by which CodeVetter leads an agent from an
existing React/Node or Go flow to a verified optimization.

## ADDED Requirements

### Requirement: Distributed CodeVetter entrypoint
The system SHALL expose the autonomous local laboratory through the bundled
`codevetter` execution CLI using the same implementation and receipt contract
as the repository-local CLI.

#### Scenario: Agent invokes the installed CLI
- **WHEN** an agent supplies one repository and valid bounded laboratory options
- **THEN** the bundled CLI resolves its packaged runtime resource, executes the canonical laboratory, propagates its exit status, and returns compact human output or the canonical JSON receipt

#### Scenario: Runtime prerequisite is unavailable
- **WHEN** the packaged runtime resource or a local Node executable cannot be resolved
- **THEN** the CLI stops before project execution with an explicit error and does not fall back to a network download

#### Scenario: Read-only MCP remains isolated
- **WHEN** the laboratory is distributed with the desktop application
- **THEN** the existing graph/history MCP remains read-only and does not inherit long-running execution authority

### Requirement: Existing-flow qualification
The system SHALL discover bounded repository-declared executable flows and
retain deterministic representation for every supported adapter present.

#### Scenario: Unit tests exceed the bound
- **WHEN** generic unit tests exceed the inventory capacity and browser or Go workloads exist
- **THEN** bounded browser and Go representatives remain eligible

#### Scenario: No project workload exists
- **WHEN** no supported test or benchmark is declared
- **THEN** the system reports the gap and does not synthesize a workload

### Requirement: Tool-led measurement and diagnosis
The system SHALL execute only the selected exact workload, capture bounded
runtime evidence, and distinguish observed facts from inferred hypotheses.

#### Scenario: Direct repository hotspot is captured
- **WHEN** repeated evidence identifies a repository-contained source location
- **THEN** the lab may return one source-bounded candidate and durable baseline

#### Scenario: Vitest workload emits scale metrics
- **WHEN** the selected exact Vitest declaration emits bounded `[benchmark]` metrics while the machine-readable reporter confirms test identity and duration
- **THEN** the capsule retains per-metric values across unprofiled samples with their units and sample counts without weakening exact-test selection

#### Scenario: Exact Vitest scope imports a large fixture
- **WHEN** CodeVetter executes one exact Vitest file and declaration for timing, RSS, coverage, CPU, or heap evidence
- **THEN** every pass uses one owned fork worker with file parallelism disabled so runner defaults cannot multiply fixture memory or change execution topology between mechanisms

#### Scenario: Vitest performance test statically imports a large JSON fixture
- **WHEN** bounded source inspection resolves a contained relative static JSON import above the configured fixture-size ceiling
- **THEN** qualification keeps the flow visible but blocks autonomous execution with a harness-amplification safety flag without reading the fixture contents

#### Scenario: Static JSON fixture is small
- **WHEN** the resolved contained JSON import remains within the fixture-size ceiling
- **THEN** it does not receive the large-fixture safety flag

#### Scenario: Baseline and candidate use different runner commands
- **WHEN** the recorded executable identity, ordered public arguments, repository-relative working directory, or adapter-specific profile denominator differs between a baseline and candidate capsule
- **THEN** paired verification refuses the comparison as incompatible instead of attributing runner-topology movement to the product

#### Scenario: Baseline and candidate use the same runner command
- **WHEN** adapter kind, executable identity, ordered public arguments, working directory, exact target and name, host, runtime, and capture settings agree
- **THEN** paired verification may evaluate the recorded workload evidence under its existing performance gates

#### Scenario: Go allocation profile is dominated by cumulative callers
- **WHEN** unprofiled Go timing derives a bounded fixed iteration count and two independent exact profiles repeat repository-owned direct `alloc_objects` leaves below larger cumulative middleware or handler paths
- **THEN** diagnosis normalizes the direct leaves per benchmark operation, prioritizes them inside the bounded source window, and keeps cumulative callers as non-editable context

#### Scenario: Time-calibrated Go profile has an ambiguous denominator
- **WHEN** pprof would include allocations from Go benchmark calibration runs not represented by the final reported iteration count
- **THEN** CodeVetter uses a bounded fixed `Nx` profile workload derived from the unprofiled benchmark timing before reporting per-operation source allocation

#### Scenario: Go allocation leaf does not repeat
- **WHEN** a directly sampled Go allocation leaf is absent from either independent profile or lacks a compatible benchmark-iteration count
- **THEN** the leaf cannot seed an autonomous source experiment

#### Scenario: Evidence is indirect or unstable
- **WHEN** only cumulative callers, startup overhead, external operations, or unstable samples are available
- **THEN** no source experiment is promoted and the limitation is explicit

#### Scenario: A chosen product lacks a representative local computation
- **WHEN** bounded qualification exposes only startup-dominated or tiny assertions but the repository contains a checked-in production-shaped dataset and a pure user-facing computation
- **THEN** a test-only scale contract may exercise that exact local data and operation without remote traffic, database mutation, or fabricated production-impact claims

#### Scenario: Agent has changed source before profiling
- **WHEN** the repository is dirty but its bounded non-sensitive changed-file inventory is stable
- **THEN** qualification and every resulting receipt bind the base revision plus one content snapshot identity and the autonomous lab may measure that exact state

#### Scenario: Dirty snapshot changes during discovery or execution
- **WHEN** any tracked or untracked changed file, deletion, executable mode, or symlink identity changes after qualification
- **THEN** the current execution is invalidated, no prior-snapshot evidence counts for the new state, and the laboratory stops as `snapshot_changed`

#### Scenario: Dirty snapshot is unsafe to fingerprint
- **WHEN** a changed path is secret-like, an environment file, escaping, special, individually oversized, or the file/count/byte inventory exceeds its bound
- **THEN** qualification fails closed before executing project code and does not read the sensitive file

#### Scenario: Owned evidence directory changes
- **WHEN** CodeVetter writes bounded receipts under `.codevetter/`
- **THEN** those files remain excluded from source snapshot identity and cannot create a false snapshot change

### Requirement: Safe React browser evidence
The system SHALL run an exact existing Playwright flow only on a qualified
loopback runtime, deny remote traffic, and retain timing, network, main-thread,
process-tree memory, and verified original-source evidence when available.

#### Scenario: Browser memory attribution is incomplete
- **WHEN** the owned exact-flow process tree yields peak RSS but no renderer heap series
- **THEN** the system reports process-tree memory and explicitly withholds heap-growth or leak claims

#### Scenario: Renderer counters are present
- **WHEN** Chromium emits bounded same-renderer heap, DOM-node, document, and listener counters
- **THEN** the system retains their observed first, last, peak, and delta values but does not infer a leak from one flow

#### Scenario: Agent consumes the lab result
- **WHEN** an exact browser capture completes
- **THEN** the laboratory response includes compact process-tree and renderer-memory observations without requiring raw trace inspection

#### Scenario: Fixture-backed flow supports repeated memory sampling
- **WHEN** the exact declaration owns its request fixtures and the Playwright worker can be instrumented without source changes
- **THEN** the system may repeat that exact flow in fresh contexts and retain forced-GC before/after renderer samples separately from timing evidence

#### Scenario: Repeats use fresh contexts
- **WHEN** post-GC samples come from fresh page contexts rather than repeated interaction in one page
- **THEN** the system may compare memory distributions but MUST keep retained-object leak inference unavailable

#### Scenario: Exact flow repeats in one page
- **WHEN** the unchanged fixture-backed test callback completes repeatedly in one ephemeral page and context
- **THEN** the system retains the ordered forced-GC samples separately from timing evidence and identifies the interaction scope as the full project test callback

#### Scenario: Same-page setup cannot be isolated
- **WHEN** the repeated callback also recreates authentication, routes, listeners, or other test-harness setup
- **THEN** the system may report observed retained growth but MUST NOT attribute it to application objects or claim a memory leak

#### Scenario: Same-page repetition fails
- **WHEN** any repeated project assertion or callback execution fails
- **THEN** the original exact-flow capture remains valid while same-page memory evidence is explicitly unavailable

#### Scenario: Runtime identity cannot be proven
- **WHEN** the listener, repository, server family, or cleanup cannot be verified
- **THEN** the capture cannot increase runtime coverage or seed an experiment

#### Scenario: Eligible Next flow has no listener
- **WHEN** a clean exact Next flow declares one loopback origin, the installed Next package is repository-contained, and no loadable development environment file exists
- **THEN** the laboratory starts a config-disabled Next development server with an isolated ignored build directory, attests it, captures the flow, and terminates its process tree

#### Scenario: Next environment or runtime boundary is unsafe
- **WHEN** a loadable Next development environment file exists, the installed package escapes the repository, the port is occupied by an unattested listener, or startup attestation fails
- **THEN** the laboratory stops before browser capture without reading environment-file contents or invoking package scripts

#### Scenario: Next repository configuration is required
- **WHEN** an exact assertion depends on redirects, rewrites, headers, plugins, aliases, compiler behavior, or another value defined only by repository Next configuration
- **THEN** a config-disabled runtime failure remains evidence and cannot authorize an optimization or a production-equivalence claim

#### Scenario: Owned Next runtime evidence is interpreted
- **WHEN** a config-disabled Next capture completes
- **THEN** its receipt distinguishes development configuration from an attested reused repository-configured listener and MUST NOT claim production-build equivalence

#### Scenario: Exact Next route can be warmed safely
- **WHEN** the selected declaration contains one literal query-free local `page.goto`, `page.request.get`, or request-fixture GET path
- **THEN** CodeVetter performs one bounded loopback GET after attestation and before measured capture, does not follow redirects, and retains no response body

#### Scenario: Exact Next route cannot be warmed safely
- **WHEN** its first operation is dynamic, query-bearing, non-GET, absent, redirected, or fails its deadline
- **THEN** CodeVetter does not invent or follow another route and cannot treat first-route compilation time as steady-state application performance

### Requirement: Source-bounded verification
The system SHALL reject edits outside the sealed boundary and accept an
optimization only after identical-scope repeated measurement and relevant
project-owned correctness evidence pass.

#### Scenario: Performance improves and correctness passes
- **WHEN** the paired result clears the configured noise threshold and correctness covers the changed source
- **THEN** the experiment is accepted with an auditable receipt

#### Scenario: Either gate fails
- **WHEN** performance is inconclusive/regressed or correctness is missing/failing
- **THEN** the experiment is rejected or remains no-confidence

### Requirement: Node allocation attribution
For Node, Vitest, and Jest workloads, the system SHALL collect bounded V8 heap-allocation profiles in executions separate from latency, CPU, and process-tree RSS measurement.

#### Scenario: Allocation source repeats
- **WHEN** two independent heap profiles select the same repository-owned application function with material sampled bytes in each run
- **THEN** the result reports that function as an allocation candidate with per-run and combined sampled-byte evidence

#### Scenario: Allocation evidence is sparse or disagrees
- **WHEN** either heap profile lacks a material application source or the leading sources disagree
- **THEN** allocation attribution remains no-confidence and cannot seed an optimization experiment

#### Scenario: Heap profile is interpreted
- **WHEN** a V8 heap profile is normalized
- **THEN** the result labels its values as sampled allocations including objects collected by minor and major GC and MUST NOT describe them as exact retained bytes, peak memory, or leak evidence

#### Scenario: Allocation profiling fails
- **WHEN** the optional heap-profile execution or artifact is missing, malformed, oversized, or truncated
- **THEN** ordinary timing, CPU, correctness, and process-tree memory evidence remain valid while the allocation lane reports its limitation

### Requirement: Paired Node allocation acceptance
When a baseline Node, Vitest, or Jest capsule contains a qualified repeated allocation candidate, paired verification SHALL compare that exact repository source across two dedicated baseline profiles and two dedicated current profiles, separately from timing and RSS executions.

#### Scenario: Baseline allocation source materially decreases
- **WHEN** the exact baseline source is present or absent in both complete current profiles and its median sampled bytes decrease by at least 20% and 64 KiB
- **THEN** the allocation gate reports a material improvement and may mechanically confirm the change only when the exact workload passes and neither latency nor peak RSS materially regresses

#### Scenario: Optimized CPU source falls below attribution materiality
- **WHEN** complete explicit workload metrics improve, the activated allocation
  source decreases in two complete profiles, and the current CPU source no
  longer crosses the diagnostic attribution floor
- **THEN** that post-change attribution limitation remains visible but does not
  block a shipping recommendation at the required sample floor

#### Scenario: Baseline allocation source materially increases
- **WHEN** its median sampled bytes increase by at least 20% and 64 KiB
- **THEN** paired verification rejects the change even when another performance metric improves

#### Scenario: Activated allocation gate is incomplete
- **WHEN** the baseline qualified an allocation source but either side lacks two complete bounded profiles
- **THEN** paired verification returns no-confidence instead of treating absent samples as an improvement

#### Scenario: No baseline allocation candidate exists
- **WHEN** the baseline did not repeat a material repository-owned allocation source
- **THEN** allocation attribution remains diagnostic and does not block an otherwise valid latency comparison

### Requirement: Memory regression gate applies to every Node metric
Paired verification SHALL apply compatible peak process-tree RSS evidence as an independent regression gate whether the primary improvement is wall time, an explicit benchmark metric, or sampled allocations.

#### Scenario: Explicit benchmark improves but RSS regresses
- **WHEN** an explicit Node benchmark metric improves while median peak RSS increases by at least 10% and 16 MiB
- **THEN** paired verification rejects the change

### Requirement: Go peak-memory regression gate
Go benchmark profiling SHALL compile an owned benchmark binary outside the measured interval, collect three binary-only peak RSS passes separately from timing and pprof executions, and paired verification SHALL alternate those passes across compatible baseline and current repositories.

#### Scenario: Go memory pass excludes compilation
- **WHEN** CodeVetter prepares a Go benchmark for peak-RSS measurement
- **THEN** it compiles the test binary before the sampled interval and directly executes that owned binary for every memory pass

#### Scenario: Non-interleaved campaign screening moves RSS
- **WHEN** an exploratory screening comparison observes a material RSS change without alternating baseline and current collection
- **THEN** the campaign retains the observation but defers memory rejection to paired promotion

#### Scenario: Go benchmark improves but peak RSS regresses
- **WHEN** a compatible Go benchmark improves while median sampled process-tree peak RSS increases by at least 10% and 16 MiB
- **THEN** paired verification rejects the change

#### Scenario: Go peak RSS is interpreted
- **WHEN** Go benchmark-binary peak RSS is reported
- **THEN** the result identifies it as compilation-excluded process evidence that can guard regressions but cannot attribute an allocation source or independently establish a source-level optimization

### Requirement: Paired Go allocation-source verification
Paired Go verification SHALL collect two alternating pprof executions per side separately from benchmark timing and process-tree RSS, normalize direct repository allocation values by the benchmark iterations in each profile, and compare the exact repeated baseline source.

#### Scenario: Direct allocation source repeats
- **WHEN** the same repository file and function has direct `alloc_objects` evidence in both complete baseline profiles
- **THEN** the result reports per-run objects per operation for that exact source and its compatible current values

#### Scenario: Exact source materially regresses
- **WHEN** the repeated baseline source increases by at least 20% and 0.5 objects per operation in the compatible current profiles
- **THEN** paired verification rejects the candidate even if aggregate latency or allocation metrics improve

#### Scenario: Activated source evidence is incomplete
- **WHEN** the baseline source repeats but either side lacks two complete profiles with benchmark iteration counts
- **THEN** paired verification returns no-confidence instead of treating a missing profile or row as an improvement

#### Scenario: Complete current profile omits the source
- **WHEN** both current profiles are complete but the exact baseline source is absent
- **THEN** the source value is zero for those runs while aggregate `B/op`, `allocs/op`, latency, and RSS remain the authoritative acceptance gates

#### Scenario: pprof source value is interpreted
- **WHEN** a source comparison is reported
- **THEN** it is labeled local direct allocation-object evidence normalized per benchmark operation and MUST NOT be described as retained heap, peak memory, or production impact

### Requirement: Browser sampled-live retention attribution
For an exact same-page Playwright callback, the system SHALL optionally sample V8 allocations that remain alive after forced GC across three cycles without retaining heap snapshots, object contents, raw URLs, or response data.

#### Scenario: Repository allocation grows across cycles
- **WHEN** the same repository-owned application source is present in at least two complete profiles, has monotonically non-decreasing sampled-live bytes across all three, and grows by at least 20% and 64 KiB from the first to last cycle
- **THEN** the result reports a material sampled-live retention candidate with source, per-cycle bytes, and claim limitations

#### Scenario: Threshold-edge source appears only once
- **WHEN** an application source appears in only one of the three complete sampled-live profiles
- **THEN** the system does not promote it even when that one sample crosses the byte threshold

#### Scenario: Harness allocations grow
- **WHEN** sampled-live growth belongs to a Playwright test, fixture, benchmark, or other harness source
- **THEN** the system may retain it as bounded diagnostic context but MUST NOT promote it as an application retention candidate

#### Scenario: No material source repeats
- **WHEN** all three bounded profiles complete but no application source crosses the growth policy
- **THEN** the result reports that no material sampled-live application retention candidate was observed

#### Scenario: Retention profile is incomplete
- **WHEN** profiling is unsupported, malformed, truncated, or fewer than three post-GC profiles complete
- **THEN** same-page heap and DOM counter evidence remains valid while source attribution is explicitly unavailable

#### Scenario: Candidate is interpreted
- **WHEN** a sampled-live retention candidate is reported
- **THEN** the system MUST state that it is sampled steady-state allocation evidence, not exact retained bytes, a dominator path, proof of unbounded growth, or a confirmed memory leak

### Requirement: Local claim boundary
Every result SHALL identify its repository revision, workload, samples,
limitations, and local/fixture scope, and MUST NOT claim production impact from
local measurements.

#### Scenario: Unit declarations crowd a consumer-flow inventory
- **WHEN** a bounded repository contains a small Playwright journey suite and more unit declarations than the global flow limit
- **THEN** qualification preserves up to sixteen exact browser journeys within the adapter-floor pass before filling the remaining inventory by global rank

#### Scenario: One browser assertion fails during a bounded portfolio run
- **WHEN** one exact browser flow fails after producing a closed capture receipt and later safe flows remain
- **THEN** the laboratory retains the failed flow as evidence and continues to the later safe flows without reclassifying the assertion as an infrastructure crash

#### Scenario: Local evidence includes external operations
- **WHEN** a local flow observes database or network time
- **THEN** the result reports the observation and withholds any production-impact claim

### Requirement: Concrete direct-allocation candidate selection
The system SHALL bound source inspection, deduplicate line-level profile rows by
repository file and function, and prefer a directly sampled source with a
supported static mechanical pattern when selecting the one experiment candidate.

#### Scenario: One profiled function produces several line rows
- **WHEN** a Go allocation profile contains several source lines for the same repository function
- **THEN** source-context collection spends one bounded slot on that function rather than allowing its line rows to crowd out other directly sampled functions

#### Scenario: Smaller direct leaf has a supported format pattern
- **WHEN** one direct `alloc_objects` source has at least 5% share and a one-line `fmt.Sprintf` string template containing only literal text, `%%`, and `%s` verbs, while a larger direct source has no supported pattern
- **THEN** the system selects the patterned leaf as the single experiment candidate and records that the proposed rewrite remains unverified

#### Scenario: Formatting source uses unsupported semantics
- **WHEN** the format contains numeric, width, precision, dynamic, or otherwise unsupported verbs
- **THEN** the source receives no mechanical-pattern preference and remains subject to the ordinary direct-allocation floor

#### Scenario: Pattern-backed experiment is accepted
- **WHEN** an agent changes the selected source and complete identical-scope benchmark metrics cross policy while correctness passes and RSS does not materially regress
- **THEN** bounded supplemental attribution truncation remains a visible limitation but does not override the complete benchmark verdict

### Requirement: Candidate rejection advances the local flywheel
The laboratory SHALL retain a bounded deterministic set of eligible findings
from one immutable diagnosis while returning only one source candidate per run,
and SHALL accept only canonical finding IDs as caller-supplied exclusions.

#### Scenario: Leading candidate was rejected
- **WHEN** a later laboratory run receives the leading finding ID in a bounded exclusion list
- **THEN** it returns the next ranked eligible finding from the same snapshot and diagnosis without rerunning or inventing a workload

#### Scenario: Every candidate was rejected
- **WHEN** every eligible finding ID in the diagnosis is excluded
- **THEN** the laboratory completes with `candidate_exclusions_exhausted` and no source candidate

#### Scenario: Exclusion input is unsafe or unbounded
- **WHEN** exclusions contain more than eight entries, duplicates, a noncanonical ID, source path, command, or arbitrary string
- **THEN** validation fails before candidate selection or workload execution

#### Scenario: Rejection authority is interpreted
- **WHEN** a candidate ID is excluded
- **THEN** the receipt records only that the caller skipped the finding and MUST NOT claim the optimization was disproven without a separate verification receipt

### Requirement: Candidate exhaustion advances across flows
The laboratory SHALL apply its bounded finding exclusions to flow coverage so
one exhausted diagnosis does not block remaining safe declared flows.

#### Scenario: Another safe flow remains
- **WHEN** every eligible finding in one measured flow is excluded and another safe declared flow is unmeasured
- **THEN** coverage marks the first flow `candidate_exhausted` for the current policy and the laboratory advances to the next flow

#### Scenario: No safe flow remains
- **WHEN** candidate exclusions exhaust a measured flow and no safe automatic action remains
- **THEN** coverage and the laboratory complete with `candidate_exclusions_exhausted`

#### Scenario: Stored evidence remains immutable
- **WHEN** exclusions change the current coverage projection
- **THEN** the stored diagnosis, finding eligibility, run identity, and source snapshot remain unchanged

### Requirement: Same candidate is deduplicated across flows
Eligible source-bounded profile findings SHALL expose an opaque candidate key
that is stable for the same source, mechanism, and immutable snapshot but does
not replace the evidence-specific finding ID.

#### Scenario: Two flows select the same candidate
- **WHEN** two exact flows on one source snapshot select the same detector, source anchor, finding kind, inference mechanism, and operation kind
- **THEN** their finding IDs may differ but their candidate keys match, and one bounded candidate-key exclusion suppresses both

#### Scenario: Source snapshot changes
- **WHEN** any bounded source content changes and the candidate is diagnosed again
- **THEN** its candidate key changes and an exclusion from the old snapshot does not suppress it

#### Scenario: Candidate-key input is unsafe or unbounded
- **WHEN** candidate-key exclusions contain more than eight entries, duplicates, paths, commands, or noncanonical values
- **THEN** validation fails before workload execution

#### Scenario: Candidate key is interpreted
- **WHEN** a candidate key is excluded
- **THEN** the receipt records a caller skip only and MUST NOT claim a verified rejection or suppress a distinct inference mechanism

### Requirement: V8 sampled-allocation verdicts are range conservative
The paired Node verifier SHALL retain median sampled-byte movement as
diagnostic evidence but SHALL require the complete paired run ranges to clear
materiality policy before confirming or rejecting a source-allocation change.

#### Scenario: Sample ranges overlap or nearly overlap
- **WHEN** the median sampled bytes move materially but the smallest current run is not materially above the largest baseline run and the largest current run is not materially below the smallest baseline run
- **THEN** source allocation remains stable and cannot override another confirmed timing or explicit-workload result

#### Scenario: Every current run is materially larger
- **WHEN** the smallest current source sample materially exceeds the largest baseline source sample by both policy thresholds
- **THEN** the source-allocation gate rejects the candidate

#### Scenario: Every current run is materially smaller
- **WHEN** the largest current source sample is materially below the smallest baseline source sample by both policy thresholds
- **THEN** the source-allocation gate may confirm the candidate when other gates do not regress

### Requirement: Candidate identity follows selected source context
New source-bounded candidate keys SHALL be derived from a bounded selected
function-body digest rather than the whole repository snapshot, while legacy
snapshot-bound findings remain readable.

#### Scenario: Unrelated source changes
- **WHEN** repository snapshot identity changes but the selected function body, file, function, detector, kind, mechanism, and operation kind remain unchanged
- **THEN** the candidate key remains unchanged and an existing caller skip continues to apply

#### Scenario: Selected function changes
- **WHEN** any content inside the bounded selected function body changes
- **THEN** the function-body digest and candidate key change, so the old skip cannot hide the new implementation

#### Scenario: Lines move above the selected function
- **WHEN** unrelated lines are inserted above a named function without changing its body
- **THEN** line-number movement alone does not change the candidate key

#### Scenario: Legacy candidate receipt is loaded
- **WHEN** a durable finding has a snapshot-bound candidate key and no function-body digest
- **THEN** validation uses its recorded snapshot identity and the receipt remains readable

### Requirement: Compact browser execution breakdown
Completed owned browser captures SHALL expose enough bounded main-thread evidence
in the compact diagnosis for an agent to interpret a no-finding result without
opening the full normalized artifact.

#### Scenario: Browser flow has no source candidate
- **WHEN** an exact browser flow succeeds with normalized main-thread evidence but no eligible source finding
- **THEN** the compact diagnosis retains JavaScript, style, layout, and paint totals, long-task count and duration, repository CPU sample count and self time, and a source-attribution state

#### Scenario: Main-thread evidence is unavailable
- **WHEN** trace normalization does not produce a complete renderer-main-thread summary
- **THEN** the compact execution breakdown is null rather than fabricating zero work

#### Scenario: Compact diagnosis remains bounded
- **WHEN** the main-thread summary is projected into a capture or lab receipt
- **THEN** it contains no raw trace events, source text, URL, request value, environment value, or profile payload

### Requirement: Direct measurement survives inventory truncation
The autonomous lab SHALL be allowed to measure one already-qualified exact
direct benchmark when broad flow discovery is truncated, without treating the
bounded inventory as complete.

#### Scenario: Explicit benchmark exists beyond a crowded inventory
- **WHEN** qualification reaches its flow bound and coverage selects a safe `measure_unmeasured_flow` action for an exact declared benchmark
- **THEN** the lab runs that exact adapter, target, and name instead of stopping before execution

#### Scenario: Truncated direct measurement completes
- **WHEN** the exact benchmark produces a durable measurement or source candidate
- **THEN** every receipt keeps `discovery_truncated: true` and no complete repository-coverage claim is made

#### Scenario: Truncated action is unsafe
- **WHEN** the selected exact flow has a safety flag or no closed direct-measurement scope
- **THEN** existing qualification and execution boundaries still stop the action

### Requirement: Direct timing intent is executable and declaration-local
The qualification layer SHALL promote a Node test to directly measurable only
when the exact declaration contains executable timing instrumentation, rather
than metric terminology used as fixture data, expected output, or assertions.

#### Scenario: Synthetic diagnosis test mentions benchmark metrics
- **WHEN** a test file or declaration mentions `ns/op`, `B/op`, `allocs/op`,
  allocation pressure, or other performance labels without invoking timing
  instrumentation
- **THEN** those labels do not count as direct measurement evidence and cannot
  make the declaration benchmark-ready

#### Scenario: Exact declaration invokes supported timing instrumentation
- **WHEN** the exact selected declaration invokes a supported local timing API
  such as `performance.now()`, `console.time()`, or `process.hrtime()`
- **THEN** qualification records direct timing evidence for that declaration

#### Scenario: Another test contains timing instrumentation
- **WHEN** a file contains multiple tests and only another declaration invokes
  timing instrumentation
- **THEN** the selected declaration does not inherit that evidence

### Requirement: Node allocation candidates prefer the measured CPU path
When an exact Node workload produces both repeatable CPU and V8 sampled
allocation evidence, the diagnostic layer SHALL prefer a material repeated
allocation source intersecting the repeated CPU candidate over a larger
allocation source outside that candidate.

#### Scenario: Setup allocation is larger than measured parser allocation
- **WHEN** two heap profiles repeat a setup allocator as the largest source but
  also repeat a material allocator matching the leading repeated CPU function
- **THEN** the matching allocator becomes the source experiment candidate and
  the larger setup allocator remains bounded observed evidence

#### Scenario: Heap source has no CPU evidence
- **WHEN** no repeatable repository CPU candidate exists but two heap profiles
  repeat a material repository allocation source
- **THEN** the heap-only candidate remains eligible with its existing memory
  claim boundary

#### Scenario: CPU-aligned allocation is not material
- **WHEN** the matching heap source does not satisfy the existing per-run byte
  and share thresholds
- **THEN** it cannot displace the independently qualified heap-only candidate

### Requirement: Paired React optimization acceptance
The existing paired optimization operation SHALL compare one byte-identical exact Playwright declaration across two clean repository roots using alternating owned local captures and SHALL keep browser process startup outside the primary flow-time metric.

#### Scenario: Exact React flow materially improves
- **WHEN** at least three successful captures per side show a median root-flow, renderer-JavaScript, or outer-main-frame LCP improvement of at least 10% and 10 ms while correctness passes and no browser memory or secondary phase materially regresses
- **THEN** the paired verifier confirms the local optimization with the complete alternating schedule and retained capture references

#### Scenario: Browser memory regresses
- **WHEN** flow time improves but median process-tree RSS rises by at least 10% and 16 MiB or final post-GC renderer heap rises by at least 10% and 1 MiB
- **THEN** the paired verifier rejects the change

#### Scenario: Browser memory materially improves
- **WHEN** median process-tree RSS or final post-GC heap materially decreases, or a baseline retention source repeated across captures disappears, while correctness passes and timing does not materially regress
- **THEN** the paired verifier may confirm a local memory optimization without requiring a latency improvement

#### Scenario: New retention source repeats across captures
- **WHEN** the same current-only sampled-live application file and function qualifies in at least two measurement captures
- **THEN** the paired verifier rejects the change while a source seen in only one capture remains non-verdict diagnostic evidence

#### Scenario: Paired browser identity is incompatible
- **WHEN** either repository is dirty, the test source differs, qualification resolves different exact flow identity, runtime attestation fails, or any selected assertion fails
- **THEN** the result is no-confidence and cannot confirm an optimization

#### Scenario: Changed files escape the experiment
- **WHEN** revisions differ and no sealed sources are supplied or any changed file is outside the bounded sealed-source set
- **THEN** paired browser verification stops before starting either application runtime

#### Scenario: Browser improvement is locally scoped
- **WHEN** paired React verification completes
- **THEN** the receipt labels timing and memory as local exact-flow evidence, identifies the generic owned Chromium profile, and makes no production, traffic, remote-network, repository-device, or representative-device claim

### Requirement: Repeated Node allocation candidates are traversable
The diagnostic layer SHALL retain a bounded set of material repository
allocation sources repeated across both Node heap profiles so an agent can
advance after rejecting or accepting the leading source.

#### Scenario: Several application sources repeat
- **WHEN** two independent V8 heap profiles contain the same material repository file and function for several allocation sources
- **THEN** at most eight sources become distinct internal candidates with their own per-run sampled bytes and candidate identities while the autonomous response still returns only one selected source

#### Scenario: CPU-aligned source exists
- **WHEN** one repeated material allocation source matches the repeated CPU candidate
- **THEN** it remains the first experiment candidate even when another source has more sampled bytes

#### Scenario: Leading source is excluded
- **WHEN** the caller excludes the first candidate key and another repeated material source remains
- **THEN** the laboratory selects the next source without removing the excluded source from bounded observed evidence

#### Scenario: Setup source is outside the measured CPU file
- **WHEN** a larger repeated allocation belongs to a fixture or setup file while a repeatable CPU candidate identifies another repository file
- **THEN** the setup allocation remains observed but cannot become a secondary autonomous experiment

#### Scenario: Source is material in only one run
- **WHEN** an allocation source is absent or below the existing byte and share thresholds in either heap profile
- **THEN** it does not become an autonomous experiment candidate

#### Scenario: Alternate source is verified
- **WHEN** verification names an exact alternate repository file and function retained by the baseline
- **THEN** the verifier compares that source across both heap runs instead of silently checking only the leading source

#### Scenario: Allocation moves to another frame
- **WHEN** the selected source materially falls but total repository-application sampled bytes do not show a separated improvement
- **THEN** the result remains inconclusive and cannot recommend shipping from source attribution movement alone

#### Scenario: Fourth source follows three exclusions
- **WHEN** the first three repeated Node candidate keys are excluded and a fourth material source remains within the eight-candidate internal window
- **THEN** the laboratory returns that fourth source as its only candidate rather than reporting exhaustion

#### Scenario: Node heap sampling remains bounded and comparable
- **WHEN** CodeVetter captures diagnostic Node heap-allocation profiles
- **THEN** it records the fixed 8 KiB sampling interval, enforces the existing sample and profile-byte ceilings, and compares profiles only when their sampling intervals match

#### Scenario: Node heap sampling intervals differ
- **WHEN** a baseline and current capsule were captured with different heap sampling intervals
- **THEN** optimization verification returns no confidence instead of treating the sampled byte totals as comparable

#### Scenario: Profiler observer frames are repository-contained
- **WHEN** CodeVetter profiles itself and the owned heap-profiler preload appears in both allocation profiles
- **THEN** its allocations remain visible as test-or-harness evidence but are excluded from application totals and cannot become an optimization candidate

#### Scenario: Nested TypeScript Node test declares TSX
- **WHEN** an exact `node:test` target is TypeScript and its nearest package declares a contained installed `tsx` loader
- **THEN** CodeVetter runs it from that package root with the package-relative target, preserves the repository-relative scope, and redacts the loader path from the public command

#### Scenario: TypeScript Node test has no declared loader
- **WHEN** an exact TypeScript `node:test` target's nearest package does not declare `tsx`
- **THEN** the flow remains visible with an unresolved-loader safety flag and cannot enter autonomous execution

#### Scenario: Benchmark-named script is a generator
- **WHEN** a standalone Node script has a generator, build, publish, release, deploy, migration, seed, or update-style filename even if another filename token says benchmark
- **THEN** qualification does not classify it as a standalone performance workload and autonomous execution never starts it

#### Scenario: Standalone script directly writes files
- **WHEN** static source for an otherwise benchmark-shaped standalone script contains a direct filesystem write, append, stream, rename, removal, or directory-creation call
- **THEN** qualification excludes it while preserving eligibility for read-only standalone benchmarks

#### Scenario: Fully parsed heap profile has many low-ranked sources
- **WHEN** a bounded heap profile is fully parsed and contains more normalized sources than the compact hotspot projection retains
- **THEN** the highest-ranked application and harness rows remain bounded, evidence is not marked truncated, and repeated material retained sources stay eligible

#### Scenario: Complete heap runs have a larger combined union
- **WHEN** every bounded heap run is complete but their merged source union exceeds the compact combined hotspot projection
- **THEN** the combined evidence remains complete, repeated retained sources stay eligible, and omitted low-ranked union rows do not suppress diagnosis

#### Scenario: Heap collection bound is crossed
- **WHEN** heap evidence exceeds a file, byte, sample, or node traversal bound or contains malformed profile structure
- **THEN** the evidence remains truncated and cannot activate optimization verification

### Requirement: Resumable source experiment
The system SHALL let an agent continue a source-bounded laboratory result without granting the laboratory authority to edit source or recommend shipping from a sequential screen.

#### Scenario: Agent continues after changing the candidate
- **WHEN** a new laboratory run names a prior receipt that stopped at `source_edit_required` and the repository source snapshot changed
- **THEN** CodeVetter binds the new receipt to the prior receipt digest and remeasures the same exact qualified flow

#### Scenario: Sequential screen finds a material improvement
- **WHEN** the post-edit capsule is compatible and materially improves the originating capsule without a measured regression
- **THEN** the receipt records the comparison and stops at `paired_verification_required` rather than recommending shipping

#### Scenario: Sequential screen rejects or cannot confirm the change
- **WHEN** the comparison regresses, is immaterial, or lacks confidence
- **THEN** the receipt distinguishes those outcomes and preserves the observed comparison for the agent

#### Scenario: Source snapshot did not change
- **WHEN** the current source snapshot equals the predecessor snapshot
- **THEN** continuation stops before execution because no source experiment was observed

#### Scenario: Prior flow is no longer eligible
- **WHEN** the exact originating flow is absent, unsafe, browser-only, or no longer profile-capable
- **THEN** continuation stops without substituting another workload

#### Scenario: Existing Node evidence used another runtime
- **WHEN** a same-snapshot supervised measurement records a different Node version from the current laboratory runtime
- **THEN** the evidence remains durable but does not count as measured coverage and the exact flow is measured again

### Requirement: In-laboratory paired acceptance
The system SHALL finish a material continuation through paired performance and exact correctness only when the caller explicitly supplies a matching independent incumbent checkout and closed correctness scope.

#### Scenario: Material continuation has acceptance inputs
- **WHEN** a continuation screen confirms material movement and the caller supplies a distinct incumbent matching the predecessor snapshot plus one exact correctness test
- **THEN** CodeVetter runs correctness in both checkouts and then interleaves the predecessor performance scope across them

#### Scenario: Correctness and paired evidence pass
- **WHEN** both checkouts execute exactly one passing correctness test and the paired verifier recommends shipping
- **THEN** the laboratory completes with `candidate_accepted` and a digest-bound full paired report

#### Scenario: Candidate correctness fails
- **WHEN** the current checkout's declared correctness test fails
- **THEN** the laboratory rejects the candidate without calling it a performance improvement

#### Scenario: Incumbent does not match the predecessor
- **WHEN** the incumbent revision or bounded source snapshot differs from the predecessor receipt
- **THEN** acceptance stops before correctness or paired execution

#### Scenario: Acceptance authority is incomplete
- **WHEN** only an incumbent or only a correctness scope is supplied, the repositories are the same, the test scope is not exact and contained, or execution is indeterminate
- **THEN** the laboratory cannot accept the candidate

#### Scenario: Evaluator checkout changes during acceptance
- **WHEN** either checkout's bounded source snapshot changes during correctness or paired execution
- **THEN** the acceptance result is invalid and cannot recommend shipping

### Requirement: Flow-owned correctness binding
The system SHALL let one bounded snapshot-bound repository-root data contract bind an exact discovered performance flow to one exact correctness test without accepting executable configuration or guessing a test.

#### Scenario: Bound flow enters acceptance
- **WHEN** an incumbent-only continuation reaches a material exact flow whose adapter, target, and name match one manifest entry
- **THEN** CodeVetter runs the entry's exact correctness scope in both checkouts before paired verification and records the manifest digest

#### Scenario: Repository has no flow contract
- **WHEN** an unconfigured repository supplies an explicit exact correctness scope
- **THEN** the existing explicit acceptance path remains available

#### Scenario: Explicit scope conflicts with the flow binding
- **WHEN** correctness flags and a discovered flow binding are both present but differ
- **THEN** acceptance stops before correctness execution instead of overriding repository intent

#### Scenario: Binding is stale or ambiguous
- **WHEN** a manifest entry matches no discovered flow, duplicates another performance identity, or the selected flow has no exact binding
- **THEN** coverage exposes the gap and incumbent-only acceptance cannot run a substitute correctness test

#### Scenario: Flow contract is unsafe or malformed
- **WHEN** the fixed root contract is a symlink, exceeds 64 KiB, contains unknown fields, unsupported adapters, escaping paths, or non-exact names
- **THEN** CodeVetter rejects it before project execution

#### Scenario: Binding changes after measurement
- **WHEN** the tracked flow contract changes after the source candidate was captured
- **THEN** its new source snapshot identity requires fresh performance evidence before acceptance

### Requirement: Accepted evidence informs review
The system SHALL automatically project a compact accepted local performance and correctness receipt into code review only when its evidence remains current, intact, and relevant to the exact review target.

#### Scenario: Accepted evidence matches the review target
- **WHEN** a completed `candidate_accepted` receipt matches the current source snapshot, its full paired artifact matches the recorded byte count and SHA-256, its correctness authority remains current, and its candidate source is changed by the review target
- **THEN** specialist and coordinator review receive a compact observed/inferred/unverified evidence block with exact flow, metric, correctness, and artifact identities

#### Scenario: Accepted evidence is stale or unrelated
- **WHEN** the current source snapshot or correctness binding changed, or the accepted candidate source is outside the review target
- **THEN** the evidence is excluded from model prompts and review records a bounded exclusion reason

#### Scenario: Accepted evidence was tampered with
- **WHEN** a receipt or paired artifact is malformed, escaping, oversized, digest-mismatched, or inconsistent with its compact summary
- **THEN** it cannot influence review

#### Scenario: Performance evidence is unavailable
- **WHEN** no accepted receipt exists or the optional local runtime cannot be invoked
- **THEN** code review still runs without performance evidence and does not invent a verification result

#### Scenario: Local improvement reaches review
- **WHEN** qualified accepted evidence reports a local exact-flow improvement
- **THEN** review may use it to validate assumptions and focus on uncovered risks but MUST NOT generalize it to production impact, untested flows, or project-wide correctness

### Requirement: Review reruns accepted-flow correctness
The system SHALL rerun one exact current correctness test before review when a formerly accepted candidate source changed and its repository-owned test-selection authority remains intact, without reviving stale performance evidence.

#### Scenario: Accepted source changed and remains in the review target
- **WHEN** a digest-intact accepted receipt has the same Git revision, a different current source snapshot, an unchanged repository-owned correctness binding, and its candidate source is changed by the exact review target
- **THEN** CodeVetter executes that one exact correctness test and gives the reviewer a fresh observed result

#### Scenario: Fresh correctness passes
- **WHEN** the closed adapter proves exactly one selected test passed and the source snapshot remains unchanged during execution
- **THEN** review receives the passing scope, selection count, duration, and current snapshot identity while historical performance metrics remain absent

#### Scenario: Fresh correctness fails
- **WHEN** the exact selected current test exits as failed
- **THEN** review receives a fresh failed correctness observation and MUST NOT describe the stale accepted performance result as current

#### Scenario: Reverification authority is unsafe
- **WHEN** the old receipt used explicit CLI correctness, its binding changed, the paired artifact is invalid, the Git revision changed, or the candidate source is outside the review target
- **THEN** CodeVetter does not execute the nominated test

#### Scenario: Repository changes during reverification
- **WHEN** the current source snapshot differs before execution or changes while the exact test runs
- **THEN** the result is indeterminate and cannot become passing or failing review evidence

#### Scenario: Exact selection cannot be proven
- **WHEN** the runner is unavailable, times out, truncates output, or selects other than one exact test
- **THEN** review records no-confidence testing evidence and continues without inventing a correctness result

### Requirement: Review owns cold-start test selection
The system SHALL use a bounded repository-owned source-to-flow binding to select one exact current correctness test before review when no accepted laboratory receipt can supply test authority.

#### Scenario: Changed source has one exact owner
- **WHEN** an exact review file matches a source declared by one valid performance-flow binding and no current accepted receipt applies
- **THEN** CodeVetter selects the binding's exact correctness scope, records the manifest digest and current snapshot, and executes only that test

#### Scenario: Cold-start correctness passes or fails
- **WHEN** the selected exact test produces a proved pass or failure without repository mutation
- **THEN** review receives that fresh observed result with `performance_claim_status: not_measured` and no timing or allocation comparison

#### Scenario: Source ownership is absent
- **WHEN** none of the exact changed files appears in the repository-owned flow contract
- **THEN** review continues without guessing a test from filenames, imports, coverage, or arbitrary commands

#### Scenario: Source ownership conflicts
- **WHEN** a changed source maps to more than one distinct exact correctness scope
- **THEN** CodeVetter fails closed with an ambiguity reason and executes neither scope

#### Scenario: Source ownership is unsafe
- **WHEN** a source entry is duplicated, escaping, absolute, empty, non-exact, or exceeds the manifest bounds
- **THEN** CodeVetter rejects the contract before project execution

#### Scenario: Binding changes before execution
- **WHEN** the manifest digest, current snapshot, or selected correctness scope no longer matches the cold-start plan
- **THEN** the result is no-confidence and cannot influence review as passing or failing evidence

#### Scenario: Desktop review consumes cold-start authority
- **WHEN** the desktop review boundary receives a changed source owned by one valid manifest entry
- **THEN** the packaged runtime selects and runs its exact correctness test, returns the bounded observation to the Rust review pipeline, and renders it for specialist and coordinator review without a performance claim

### Requirement: Review owns current performance characterization
The system SHALL characterize one exact repository-owned current performance flow after its exact current correctness test passes, while reserving improvement and regression verdicts for compatible paired evidence.

#### Scenario: Exact current correctness passes
- **WHEN** one changed source, performance flow, and passing correctness scope belong to the same unchanged manifest entry and source snapshot
- **THEN** CodeVetter profiles that exact performance flow within the fixed review budget and gives review compact current measurements and deterministic diagnosis

#### Scenario: Current flow has an actionable bottleneck
- **WHEN** complete bounded evidence makes the top-level diagnosis actionable and a repository source candidate satisfies its existing materiality rules
- **THEN** review receives at most one inferred source candidate plus its observed evidence and required comparison gate

#### Scenario: Workload is startup dominated or otherwise non-actionable
- **WHEN** a lower-level profiler source exists but the top-level diagnosis asks for a more representative or stable workload
- **THEN** review retains the diagnosis and measurements but withholds the source as an optimization candidate

#### Scenario: Current characterization completes without a baseline
- **WHEN** the exact current flow produces complete measurements but no compatible baseline is executed
- **THEN** the result is labeled `current_characterization_only` and MUST NOT be called an improvement, regression, shipping recommendation, or production result

#### Scenario: Exact correctness fails
- **WHEN** the repository-owned exact correctness test fails or is indeterminate
- **THEN** CodeVetter does not spend the review performance budget and preserves the failed or no-confidence correctness evidence

#### Scenario: Performance authority changes or execution is incomplete
- **WHEN** source ownership, either scope, manifest digest, revision, or snapshot changes, or execution times out or truncates
- **THEN** correctness evidence remains available while performance is no-confidence or not measured and cannot seed a review claim

### Requirement: Review retains bounded performance screening history
The system SHALL retain a successful current review characterization as immutable local evidence and use a compatible prior record only for automatic sequential screening, never as paired acceptance.

#### Scenario: First compatible characterization completes
- **WHEN** a stable exact-flow capsule has no compatible predecessor and its binding and target identities remain valid
- **THEN** CodeVetter stores one bounded ignored local record and reports that a future distinct snapshot can be screened against it

#### Scenario: A later compatible snapshot completes
- **WHEN** a distinct source snapshot has the same manifest, source owner, exact scopes, target contents, runtime, and host identity
- **THEN** CodeVetter records compact metric movement and an explicit next step while keeping the result sequential and unaccepted

#### Scenario: Sequential movement appears material
- **WHEN** the historical screen crosses a recorded materiality threshold
- **THEN** CodeVetter may request independently runnable interleaved paired verification but MUST NOT call the change faster, slower, causal, safe to ship, or production-representative

#### Scenario: History is incompatible or unavailable
- **WHEN** binding, target content, runtime, host, capture identity, storage safety, evidence integrity, or bounds differ
- **THEN** the current characterization remains usable on its own, no historical metric claim is emitted, and the limitation is explicit

#### Scenario: The same snapshot is reviewed again
- **WHEN** an immutable record already exists for the current source snapshot and binding
- **THEN** CodeVetter does not treat it as a predecessor, overwrite it, or manufacture a comparison

### Requirement: Review can finish paired acceptance from a clean Git incumbent
The system SHALL automatically materialize and pair the clean current Git revision after a material same-revision review screen only when local Git and repository-owned flow authority make both roots exact and independently runnable.

#### Scenario: Material screen has a reconstructible clean incumbent
- **WHEN** compatible history is from the current Git revision, only manifest-owned source files changed, and manifest plus evaluator targets remain tracked and unchanged
- **THEN** CodeVetter materializes the revision in owned temporary storage, runs exact correctness in both roots, and executes the existing ten-sample interleaved paired verifier

#### Scenario: Historical routing record was dirty
- **WHEN** the compatible history record describes a stable dirty snapshot on the same Git revision
- **THEN** it may trigger automatic pairing, but the paired baseline is the clean Git revision rather than the historical dirty source

#### Scenario: Historical routing record is from another revision
- **WHEN** the compatible history record cannot be bound to the current Git revision
- **THEN** automatic pairing remains unavailable instead of synthesizing or persisting a source patch

#### Scenario: Evaluator or unrelated source changed
- **WHEN** current changes include the manifest, either exact target, package or runner authority, or a file outside the selected binding's source set
- **THEN** automatic pairing stops before baseline execution because the performance movement cannot be attributed to the sealed review change

#### Scenario: Materialized Git tree is unsafe
- **WHEN** the revision contains a sensitive path, symlink, gitlink, unsupported object, too many files, too many bytes, an escaping archive entry, or extraction failure
- **THEN** CodeVetter removes only its owned temporary directory and returns no-confidence without changing Git metadata or the developer checkout

#### Scenario: Baseline Node package needs existing local dependencies
- **WHEN** the clean materialized evaluator imports dependencies from an existing root or package-local `node_modules` directory
- **THEN** CodeVetter grafts only that repository-contained dependency directory into owned temporary storage, retains baseline source and working-directory identity, and revalidates the graft around execution

#### Scenario: Dependency graft exposes current workspace source
- **WHEN** a direct installed dependency link resolves to mutable repository source outside `node_modules`
- **THEN** automatic pairing stops before baseline execution instead of allowing current source to satisfy a clean-incumbent import

#### Scenario: Exact paired review passes
- **WHEN** both roots run exactly one passing correctness test, snapshots remain stable, and the interleaved verifier recommends shipping at its existing sample and regression gates
- **THEN** review receives `paired_local_accepted` with compact metrics and a digest-bound full local artifact

#### Scenario: Correctness, performance, or identity fails
- **WHEN** correctness fails, paired evidence rejects or is inconclusive, either root mutates, dependency or command identity differs, or the artifact cannot be persisted and revalidated
- **THEN** review distinguishes rejected from no-confidence and MUST NOT emit an accepted optimization claim

#### Scenario: The same pair was already verified
- **WHEN** an intact bounded paired artifact exists for the exact binding, baseline snapshot, current snapshot, and evaluator schema
- **THEN** CodeVetter revalidates and reuses it rather than spending the paired execution budget again

### Requirement: Automatic-pair blockers are actionable
The system SHALL explain a pairing eligibility failure using only bounded
snapshot-approved file identities and a closed non-mutating next action.

#### Scenario: Evaluator authority is part of the current change
- **WHEN** changed files include the root manifest, exact performance target, or exact correctness target
- **THEN** no-confidence evidence identifies those files as evaluator changes and requests an established tracked evaluator baseline before a later source-only pair

#### Scenario: Unrelated changes are present
- **WHEN** changed files include a path outside the binding-owned source set and evaluator set
- **THEN** no-confidence evidence identifies the bounded unrelated paths and requests isolation of the owned source change without deleting, resetting, staging, or committing anything

#### Scenario: Only owned sources changed
- **WHEN** every changed file belongs to the binding-owned source set and protected evaluator files are unchanged
- **THEN** blocker classification does not stop automatic pairing

#### Scenario: Blocker evidence reaches review
- **WHEN** automatic pairing returns an eligibility blocker
- **THEN** the compact review projection preserves its observed categories and next action without emitting a performance verdict or production claim

### Requirement: Project-owned static redundancy evidence is bounded
The system SHALL reuse an already-installed project-owned Knip analyzer for
JavaScript and TypeScript redundancy discovery without installing packages,
mutating source, or treating static reachability as proof of safe removal.

#### Scenario: A React repository owns Knip authority
- **WHEN** the repository contains an installed Knip binary and optional repository configuration
- **THEN** CodeVetter invokes it without a shell using a closed read-only argument vector and normalizes unused files, exports, types, dependencies, and duplicate export groups

#### Scenario: Knip is unavailable
- **WHEN** no repository-contained installed Knip binary exists
- **THEN** CodeVetter returns an unavailable detector state and does not download, install, or execute a package-manager fallback

#### Scenario: Static candidates are reported
- **WHEN** Knip reports a bounded repository-relative issue
- **THEN** CodeVetter labels it as a static candidate, records analyzer and snapshot authority, and requires behavioral verification before removal

#### Scenario: Analyzer evidence is unsafe or unstable
- **WHEN** analyzer output is malformed, oversized, escaping, timed out, or the repository changes during execution
- **THEN** CodeVetter returns no-confidence without emitting a safe-removal or performance claim

#### Scenario: An agent requests the capability
- **WHEN** an agent invokes the CLI or MCP redundancy operation
- **THEN** it receives the same canonical structured report and no source mutation is performed

### Requirement: Duplicate implementation evidence is bounded
The system SHALL reuse an already-installed directly declared project-owned
jscpd analyzer to add clone locations to the canonical JavaScript and TypeScript
redundancy report without retaining source fragments or claiming semantic
equivalence.

#### Scenario: A repository owns jscpd authority
- **WHEN** the repository declares and contains an installed jscpd binary
- **THEN** CodeVetter invokes it directly with a closed read-only policy and normalizes bounded duplicate implementation locations

#### Scenario: jscpd is unavailable independently of Knip
- **WHEN** jscpd is missing but Knip remains available, or Knip is missing but jscpd remains available
- **THEN** CodeVetter preserves the available analyzer's evidence and records the other analyzer as unavailable without installing anything

#### Scenario: A clone group is reported
- **WHEN** jscpd reports two bounded repository-relative source ranges
- **THEN** CodeVetter retains their format, token and line counts while dropping source fragments and marking the candidate unsafe to remove without behavioral verification

#### Scenario: Clone evidence is unsafe or unstable
- **WHEN** the report is oversized, malformed, escaping, over the candidate bound, timed out, or the repository changes during capture
- **THEN** CodeVetter returns no-confidence for clone analysis and emits no consolidation or performance claim

#### Scenario: Clone percentage is available
- **WHEN** jscpd reports a duplication percentage
- **THEN** CodeVetter labels it analyzer coverage evidence rather than application latency, memory, throughput, or production performance

### Requirement: Static redundancy is ranked against the active diff
The system SHALL annotate and order bounded static candidates using the same
snapshot's zero-context changed-line evidence without claiming when the
redundancy was introduced.

#### Scenario: A candidate range intersects changed lines
- **WHEN** one candidate source range contains a line from the active Git diff
- **THEN** CodeVetter records the bounded exact intersection and ranks that candidate before unchanged repository debt

#### Scenario: An untracked candidate has no Git hunk
- **WHEN** a candidate belongs to an admitted untracked changed file
- **THEN** CodeVetter records file-level relevance without inventing exact changed lines

#### Scenario: A clone has one changed location
- **WHEN** exactly one clone location intersects the active diff
- **THEN** CodeVetter reports one changed location but does not claim the clone was introduced by the current change

#### Scenario: No candidate intersects the diff
- **WHEN** all static candidates are outside changed files
- **THEN** CodeVetter retains them as unchanged repository debt and reports a zero diff-relevant count

### Requirement: Exact Playwright flows expose bounded React commit evidence
The system SHALL optionally rerun an exact qualified Playwright declaration in
a separate diagnostic pass to observe bounded React commits without modifying
project source or contaminating the authoritative timing capture.

#### Scenario: Exact browser flow declares React
- **WHEN** the selected declaration's nearest package declares React and the unchanged test callback passes under owned instrumentation
- **THEN** CodeVetter records bounded renderer identity, commit counts, framework-reported actual duration, and named component activity when available

#### Scenario: React instrumentation observes private values
- **WHEN** the React hook receives Fiber roots during a commit
- **THEN** CodeVetter retains no props, state, DOM text, URLs, object values, source text, or raw Fiber graph

#### Scenario: Profiling duration is unavailable
- **WHEN** React commits are observed but the installed build exposes no positive actual duration
- **THEN** commit counts remain observed while component duration attribution is explicitly unavailable rather than reported as zero cost

#### Scenario: React diagnostic pass perturbs rendering
- **WHEN** commit traversal adds observer overhead
- **THEN** its wall time cannot become the primary flow metric or establish an optimization without the separate authoritative browser capture

#### Scenario: React is absent or instrumentation fails
- **WHEN** no declared React authority exists, the hook collides or is not injected, the test fails, output is malformed or oversized, execution times out, or source changes
- **THEN** ordinary Playwright timing, network, memory, and correctness evidence remains usable while React evidence is unavailable or not detected

#### Scenario: Paired React evidence is compatible
- **WHEN** baseline and current captures contain complete repeated evidence from the same React instrumentation schema and exact flow
- **THEN** paired verification may use framework-reported duration as a secondary metric and regression guard while preserving its observer-overhead limitation

#### Scenario: React document is replaced or closed
- **WHEN** the hook observes renderer injection or commits before the final live page can be evaluated
- **THEN** it delivers only bounded closed telemetry through an owned Playwright binding and the worker preserves the latest report for that document

#### Scenario: Application invokes the diagnostic binding
- **WHEN** application code calls the page-exposed binding with arbitrary fields or values
- **THEN** the worker admits only the closed React telemetry schema and cannot retain props, state, DOM text, URLs, source, or unknown fields

#### Scenario: No React document report is delivered
- **WHEN** the fixture and binding run but no installed-hook or collision report reaches the worker or final-page fallback
- **THEN** React evidence is unavailable with a bounded lifecycle reason rather than being reported as zero commits or absent React work

#### Scenario: Installed hook delivers no commit
- **WHEN** at least one valid installed-hook document report completes but its exact flow contains no observed commit
- **THEN** React evidence is `not_detected` and remains distinct from instrumentation unavailability

### Requirement: Static Playwright project identity
The system SHALL preserve a bounded statically declared Playwright project and device profile without evaluating repository configuration.

#### Scenario: A test runs in multiple static projects
- **WHEN** a Playwright config contains literal named projects backed by static `devices[...]` descriptors or literal viewports
- **THEN** qualification emits one distinct exact flow per applicable project and includes the project in candidate identity

#### Scenario: Owned capture uses a qualified device
- **WHEN** an exact flow selects a statically qualified installed Playwright device profile
- **THEN** the owned configuration applies that profile while retaining CodeVetter's Chromium, loopback, tracing, denial-proxy, worker, retry, and cleanup policy

#### Scenario: Browser profile evidence is compact
- **WHEN** browser capture completes
- **THEN** the receipt records project, device, viewport, scale, mobile, touch, and provenance without retaining the device user agent

#### Scenario: Paired project identity differs
- **WHEN** the baseline and candidate cannot resolve the same requested project and browser profile
- **THEN** paired verification stops before runtime startup with no-confidence

#### Scenario: Campaign pins a browser project
- **WHEN** a Playwright campaign manifest declares a project
- **THEN** baseline qualification, screening, and promotion use only that exact project-qualified flow

#### Scenario: Projects use a named typed literal array
- **WHEN** the exported Playwright configuration references one local typed `const projects = [...]` shorthand whose entries remain static
- **THEN** qualification resolves the same bounded project profiles without evaluating the configuration module

#### Scenario: A static project ignores the selected test
- **WHEN** a project has a literal or statically named regular-expression `testIgnore` matching the exact test file
- **THEN** qualification does not emit that project and test combination

#### Scenario: A device project overrides viewport or device fields
- **WHEN** a static project spreads an installed device descriptor and then declares bounded literal viewport, scale, mobile, or touch overrides
- **THEN** owned capture applies the overrides after the descriptor and records the resolved values

#### Scenario: Device variants crowd the browser floor
- **WHEN** more distinct test declarations exist than the bounded browser floor and each declaration applies to multiple static projects
- **THEN** qualification preserves one project variant from as many distinct declarations as possible before retaining additional variants

### Requirement: Exact browser flows expose bounded loading evidence
The system SHALL normalize bounded Playwright HAR size observations for the
selected exact flow without treating local development resources as production
bundle or network evidence.

#### Scenario: Complete resource inventory exposes sizes
- **WHEN** every retained exact-flow resource has a valid transfer size and no resource sampling was required
- **THEN** CodeVetter reports complete observed transfer totals, closed category totals, and at most eight largest resource entries

#### Scenario: Resource inventory is sampled or size is missing
- **WHEN** trace bounds omit resources or any counted resource lacks a valid transfer size
- **THEN** CodeVetter labels the loading inventory partial and cannot report the observed sum as a complete flow total

#### Scenario: Failed requests lack transfer sizes
- **WHEN** the full resource inventory is retained, every completed response has a transfer size, and failed or aborted requests do not
- **THEN** CodeVetter keeps the all-resource total partial but reports a complete completed-response total alongside the failed/aborted count and hashed request-identity set

#### Scenario: Local Vite module maps to repository source
- **WHEN** a loopback resource route decodes to exactly one contained regular source file outside excluded/generated directories
- **THEN** its largest-resource entry may retain that repository-relative file with static exact-route provenance

#### Scenario: Next or dependency chunk is unresolved
- **WHEN** a local resource is a generated Next chunk, dependency optimizer output, ambiguous route, or has no exact contained file
- **THEN** it remains external or unresolved and cannot seed a source edit from its route name

#### Scenario: Paired complete transfer decreases
- **WHEN** three compatible captures per side show complete completed-response transfer totals decreasing by at least 10% and 64 KiB, the failed/aborted count and identity digest remain unchanged, and correctness passes while timing, memory, and React guards do not regress
- **THEN** paired verification may confirm a local exact-flow loading improvement with development-server limitations

#### Scenario: Transfer materially increases
- **WHEN** compatible complete current completed-response transfer totals increase by at least 10% and 64 KiB with unchanged failed/aborted evidence
- **THEN** paired verification rejects the candidate as a local loading regression

#### Scenario: A request fails after the candidate change
- **WHEN** the failed/aborted request count or identity digest differs across paired captures
- **THEN** CodeVetter excludes completed-response transfer bytes from the optimization verdict rather than rewarding missing responses

#### Scenario: Opaque route segment resembles a credential
- **WHEN** a resource path contains a bounded credential-shaped opaque segment
- **THEN** CodeVetter redacts that segment from route evidence while retaining only a request-identity digest for compatibility

#### Scenario: Initiator chain is unavailable
- **WHEN** HAR snapshots expose resource intervals without a trustworthy JavaScript initiator graph
- **THEN** CodeVetter reports no dependency or critical chain rather than inferring one from timing overlap

### Requirement: Exact browser flows expose bounded Playwright action windows
The system SHALL preserve a bounded completed-action timeline for the selected
Playwright declaration without retaining selectors, input values, arbitrary
test titles, or treating overlapping work as causal attribution.

#### Scenario: Modern action event completes
- **WHEN** the trace contains a bounded combined Playwright action with safe framework object and method identity plus finite start and end times
- **THEN** CodeVetter records its category, duration, state, and position in the exact-flow action timeline

#### Scenario: Legacy before and after events complete
- **WHEN** bounded legacy events share one call identity and expose safe action identity plus finite start and end times
- **THEN** CodeVetter normalizes them to the same action contract without exposing the call identity

#### Scenario: Action parameters contain application values
- **WHEN** an action carries selectors, text, URLs, form values, attachments, or error details
- **THEN** CodeVetter discards those fields and retains only the closed framework action identity and completion state

#### Scenario: Journey exceeds the action bound
- **WHEN** more completed actions exist than the public action inventory permits
- **THEN** CodeVetter retains a bounded mix of earliest and slowest actions and labels the timeline sampled

#### Scenario: Action has associated browser observations
- **WHEN** a retained resource starts or a retained renderer long task overlaps a completed action window
- **THEN** CodeVetter reports the bounded temporal association and explicitly withholds initiator, causality, and exclusive-cost claims

#### Scenario: Action never completes
- **WHEN** a safe action start has no matching bounded completion
- **THEN** CodeVetter counts the started action but does not fabricate a duration or completed action entry

#### Scenario: Action identity is unsupported or dynamic
- **WHEN** a trace record lacks one closed Playwright object and method identity
- **THEN** CodeVetter ignores the record rather than retaining arbitrary labels

### Requirement: Owned browser flows expose bounded server correlation
The system SHALL correlate an exact primary Playwright capture with bounded
server and child-operation evidence only for a CodeVetter-owned eligible local
Node runtime and SHALL expose every unsupported boundary explicitly.

#### Scenario: Owned Next request carries the capture identity
- **WHEN** the primary exact-flow browser pass sends the validated capture header to a CodeVetter-owned config-disabled Next runtime
- **THEN** the diagnostic preload admits only requests carrying that exact identity and retains bounded completed request evidence

#### Scenario: Separate diagnostic pass reaches the same server
- **WHEN** React or memory diagnostics execute after the primary pass
- **THEN** they omit the capture header and cannot contaminate the primary server request inventory

#### Scenario: Browser and server request identity is unique
- **WHEN** one method and normalized query-free route occurs exactly once in both the browser resource inventory and scoped server inventory
- **THEN** CodeVetter records a deterministic identity join without comparing the two clock domains

#### Scenario: Request identity is repeated or concurrent
- **WHEN** a method and route occurs more than once on either side
- **THEN** CodeVetter reports the join as ambiguous and does not infer ordering or causality

#### Scenario: Scoped server request contains child work
- **WHEN** a captured server request performs a supported built-in SQLite operation or loopback fetch under its AsyncLocalStorage context
- **THEN** CodeVetter retains the bounded parent relationship, safe operation shape, observed duration, and contained diagnostic call site when available

#### Scenario: Server work overlaps or exceeds its parent
- **WHEN** child-operation intervals overlap or cannot be completely accounted within the request
- **THEN** CodeVetter reports bounded observed and unaccounted timing without summing overlap or claiming exclusive handler CPU

#### Scenario: Runtime is unowned, frontend-only, secret-dependent, or Go
- **WHEN** the flow uses an existing listener, Vite development server, a Next repository with loadable development env files, or a Go service without explicit repository instrumentation
- **THEN** server correlation is unavailable with a closed reason and no fabricated server or database evidence

#### Scenario: Server evidence exceeds its bound or is malformed
- **WHEN** stream files, events, requests, children, routes, sources, or correlation values exceed the closed contract
- **THEN** CodeVetter truncates or rejects that evidence, marks completeness accordingly, and never exposes raw headers, query values, SQL values, or arbitrary application data

### Requirement: Owned Next requests expose unique static route ownership
The system SHALL resolve at most one bounded contained Next route source for an
observed normalized request without presenting static routing as runtime or
performance causation.

#### Scenario: App Router page uniquely matches a GET request
- **WHEN** one contained `app` or `src/app` page file uniquely matches the normalized GET or HEAD route
- **THEN** CodeVetter retains its repository-relative file with `static_unique_next_route` provenance

#### Scenario: App Router route exports the observed method
- **WHEN** one matching route file statically exports the observed closed HTTP method
- **THEN** CodeVetter retains the file and declaration line as static route ownership

#### Scenario: Dynamic segment matches a normalized route value
- **WHEN** a `[parameter]`, catch-all, or optional catch-all pattern matches the normalized request route
- **THEN** the match may participate in unique ownership without retaining the original parameter value

#### Scenario: More than one route source matches
- **WHEN** routing conventions, groups, or static and dynamic candidates yield multiple method-compatible files
- **THEN** route ownership remains ambiguous and no arbitrary source is selected

#### Scenario: Static ownership is attached to residual request time
- **WHEN** one request has material unaccounted time and a unique static route source
- **THEN** the source may guide inspection but remains ineligible for an optimization experiment until runtime mechanism evidence and paired correctness exist

### Requirement: Isolated owned Node requests expose bounded sampled CPU evidence
The system SHALL retain bounded repository-contained V8 CPU samples for an
isolated captured dynamic request without presenting observer-affected samples
as an optimization verdict.

#### Scenario: Isolated dynamic request contains repository CPU work
- **WHEN** one capture-scoped dynamic request runs without another captured dynamic request overlapping its V8 profile
- **THEN** CodeVetter may retain bounded repository self-time and source candidates above fixed sample and share floors

#### Scenario: Captured dynamic requests overlap
- **WHEN** another captured dynamic request begins while one request owns the process-wide V8 profiler
- **THEN** the active profile is marked contaminated and exposes no source candidate

#### Scenario: Static development resource is requested
- **WHEN** a capture-scoped request targets a Next internal asset or an extension-shaped resource route
- **THEN** CodeVetter does not start a request CPU profile for that resource

#### Scenario: Closed Next server source URL resolves inside the repository
- **WHEN** a V8 frame uses a supported Next server `webpack-internal` source URL that maps to one regular contained source file
- **THEN** CodeVetter may retain the repository-relative source and line with sampled-runtime provenance

#### Scenario: Profile contains unsafe or unsupported frames
- **WHEN** a frame is generated, dependency-owned, absolute but uncontained, malformed, oversized, or contains secret-shaped evidence
- **THEN** CodeVetter discards it without exposing the raw URL, function, or profile

#### Scenario: One material source candidate is observed
- **WHEN** an isolated profile contains a repository candidate above the fixed materiality floor
- **THEN** CodeVetter may narrow the performance hypothesis but keeps the finding ineligible until paired measurement and project-owned correctness pass

### Requirement: Owned Node requests expose bounded async callback delay
The system SHALL retain bounded first-callback delay for supported async
resources created inside one active captured request context without presenting
context propagation or interval overlap as an awaited critical-path dependency.

#### Scenario: Request creates a supported timer or filesystem operation
- **WHEN** a supported resource is initialized under the matching request context and its first callback begins before the response completes
- **THEN** CodeVetter may retain its closed category, first-callback delay, callback-active duration, parent request, and contained creation call site

#### Scenario: Async resource contains application values
- **WHEN** the resource internally contains a delay value, filename, host, address, callback argument, query, or object state
- **THEN** CodeVetter discards those values and retains no raw resource or async identifier

#### Scenario: Resource callback begins after the response
- **WHEN** a background or long-lived resource has not begun its first callback before response completion
- **THEN** CodeVetter discards it instead of attributing post-response work to request completion

#### Scenario: Async resource types are noisy or unsupported
- **WHEN** the request creates generic promises, ticks, sockets, handles, or another category outside the closed allowlist
- **THEN** CodeVetter does not retain them and does not infer missing waiting time

#### Scenario: Async delay intervals overlap
- **WHEN** several retained resource-delay intervals overlap inside one request
- **THEN** CodeVetter reports their bounded union separately and does not sum or subtract it from residual request accounting

#### Scenario: Material async delay has a contained source
- **WHEN** one retained delay crosses fixed duration and request-share thresholds and resolves to a repository call site
- **THEN** CodeVetter may narrow the investigation to that source but keeps the finding ineligible until paired end-to-end measurement and project-owned correctness pass

#### Scenario: Promise-based built-in hides its public caller
- **WHEN** application code inside the captured request invokes an allowlisted `node:timers/promises` or `node:fs` promise method whose supported async resource is initialized below the public API boundary
- **THEN** CodeVetter preserves the contained synchronous caller with `node_async_creator_callsite` provenance without retaining arguments, paths, delay values, resource objects, or callback data

#### Scenario: Supported work has no direct application caller
- **WHEN** a framework or dependency creates a response-linked supported resource without a contained frame at either the async initialization or allowlisted public creator boundary
- **THEN** the resource source remains null and CodeVetter does not inherit static route ownership, response source, or an arbitrary request ancestor onto it

### Requirement: Owned Node requests distinguish response-completion async dependencies
The system SHALL use a bounded private async and promise-resolution graph to
distinguish a supported callback in the response-finalization scheduling
lineage from unrelated work that merely inherited the request context, without
exposing raw graph identities or claiming exclusive critical-path ownership.

#### Scenario: Response ends after an awaited timer
- **WHEN** a supported timer resolves a promise whose bounded scheduling lineage reaches the execution context that calls `response.end`
- **THEN** CodeVetter labels the timer `response_completion_descendant` and retains only the closed relationship plus bounded timing evidence

#### Scenario: Background timer inherits request context
- **WHEN** a supported timer is created under the request context but response finalization does not descend from its callback
- **THEN** CodeVetter labels it `context_only` only when the bounded scheduling graph is complete and does not call it awaited work

#### Scenario: Promise resolution bridges the dependency
- **WHEN** a promise continuation is triggered by a promise that was resolved inside a supported resource callback
- **THEN** the private traversal may follow that resolution edge to the resource without retaining the promise, async identity, callback value, or graph

#### Scenario: Async lineage exceeds its bound
- **WHEN** one request exceeds 4,096 concurrently retained private lineage nodes or the process exceeds 16,384 retained nodes
- **THEN** CodeVetter marks otherwise-negative relationships unknown, preserves any directly proved descendant relationship, and emits no absence claim

#### Scenario: Generated Next asset is captured
- **WHEN** the primary browser pass requests a normalized `/_next/` resource
- **THEN** its server request remains visible but CodeVetter does not spend the async-lineage budget on its framework compiler or file-serving graph

#### Scenario: Response completion does not call the wrapped end method
- **WHEN** no bounded `response.end` execution context is observed before finish or failure
- **THEN** relationship evidence is unknown and context propagation or timing overlap cannot substitute for it

#### Scenario: Response-completion descendant is interpreted
- **WHEN** a supported callback is dynamically linked to response finalization
- **THEN** CodeVetter states that the finalization scheduling lineage descended from the callback but MUST NOT claim JavaScript `await` syntax, exclusive blocking time, a complete critical path, or production impact

### Requirement: Playwright qualification resolves bounded loopback port fallbacks
The system SHALL statically resolve a closed environment-backed numeric port
fallback used by a loopback Playwright `baseURL` template without evaluating
the configuration or reading the caller environment.

#### Scenario: Base URL uses one declared port fallback
- **WHEN** one constant uses an uppercase environment key with a quoted valid numeric fallback and one loopback URL template interpolates only that constant
- **THEN** CodeVetter qualifies the fallback origin and preserves any statically resolved Playwright project profile

#### Scenario: Caller environment overrides the port
- **WHEN** the current process contains a different value for the declared environment key
- **THEN** qualification ignores it and remains bound to the source-declared fallback

#### Scenario: Port or template is dynamic or ambiguous
- **WHEN** the fallback is invalid, unquoted, nonnumeric, duplicated inconsistently, or the template contains another expression or a non-loopback host
- **THEN** CodeVetter leaves the browser origin unresolved and does not execute the configuration to recover it

### Requirement: Owned browser runtimes preserve unrelated declared-port listeners
The system SHALL permit a config-disabled owned Vite or Next capture to use a
bounded ephemeral port on the same loopback host when the declared port belongs
to an unrelated listener, without stopping or reusing that listener.

#### Scenario: Declared port has an unrelated healthy listener
- **WHEN** process attestation rejects the declared listener and an ephemeral same-host loopback port can be reserved
- **THEN** CodeVetter releases the reservation immediately before its owned spawn, passes the effective origin to its generated Playwright config, and leaves the original listener untouched

#### Scenario: Effective origin changes more than the port
- **WHEN** the alternate origin changes protocol, host, path, query, or fragment, or the runtime is not config-disabled and owned
- **THEN** CodeVetter rejects the override before browser execution

#### Scenario: Alternate runtime cannot be attested or cleaned up
- **WHEN** the lease races, startup fails, repository/family attestation fails, or bounded cleanup fails
- **THEN** CodeVetter returns no browser conclusion and never terminates the unrelated declared-port listener
