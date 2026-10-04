# Making testing faster without weakening verification

Date: 2026-10-02. Status: research and implementation recommendations; no runner
configuration changes, dependency installs, or measured acceleration claimed.
The concurrent Fleet trial supplies real workload receipts. This study combines
those receipts, CodeVetter source inspection, and upstream documentation.

## Recommendation

Make the normal agent loop an exact, inexpensive correctness check. Escalate
to repeated performance diagnosis when a task asks for it or measured behavior
warrants it. For repeated edits, reuse validated preparation and transforms;
retain an independent cold qualification lane. First fix unnecessary startup
and duplicated evidence collection, then tune parallelism.

CodeVetter currently has no standalone `test` command. The testing skill already
uses the project's existing runner. Do not route ordinary correctness checks
through performance diagnosis to obtain a receipt. See the canonical
[testing workflow](../../skills/codevetter-testing/SKILL.md) and
[agent evidence operations](../../docs/development/agent-skills.md).

## What the current evidence establishes

The audit's hash-checked receipts show these selected Vitest workloads:

| Project / selected contract | Median wall time | Summed assertion medians / wall | Interpretation |
| --- | ---: | ---: | --- |
| PostTrainLLM / kitchen corpus export | 451 ms | 0.576% | Harness dominates; this does not measure model training. |
| On Record / recommendation groups | 435 ms | 1.939% | Too little application work for useful CPU attribution. |
| SWE Interview Prep / simulation replay | 486 ms | 1.968% | Useful correctness contract, poor performance workload. |
| App Health / 10,000 visitor digests | 991 ms | 2.674% | Scale or isolate the accumulator before source attribution. |
| Karte / inbound-contact behavior | 495 ms | 0.382% | Avoid optimizing business logic based on runner wall time. |
| AliveVille / simulation behavior | 1,990 ms | 0.728% | Large host variance; no representative sustained tick benchmark. |

These ratios are the engine's startup-dominated heuristic, not exhaustive
accounting of where every millisecond went. Assertion metrics and wall samples
come from different executions. They cannot isolate environment, transformation,
imports, hooks, scheduling, and reporter costs without additional instrumentation.
They describe one selected workload per product, not the full suite.

The per-project reports and canonical IDs live in
`artifacts/performance-public-2026-10-02/`. Every invocation retains usefulness
assessment and measured CLI/context overhead in the private ledger. Shared-host
load, dirty source, and no-confidence results remain explicit.

Source inspection of [profileRepository](../../scripts/runtime-failure-capsule/performance.mjs)
and [runClosedAdapter](../../scripts/runtime-failure-capsule/runner.mjs) establishes:

- A Node/Vitest diagnosis with three samples and one warmup executes the
  workload nine times: one warmup, three timings, three metrics, two profiles.
- Flow capture adds two more executions for supported Node-test/Vitest targets.
- Every adapter execution starts a fresh owned process. An external warmup can
  warm host/filesystem caches; its JIT and loaded modules do not survive into
  subsequent processes. A benchmark's internal warmup has different semantics.
- Repeated metrics are deliberate evidence, but deserve measurement of their
  incremental contribution. Removing them without calibration changes proof.
- Missing executables currently produce operational failures after admission;
  a prerequisite check can avoid repeated unavailable executions.

## Ranked implementation opportunities

| Priority | Change to evaluate | Why it matters here | Evidence required before adoption |
| --- | --- | --- | --- |
| 1 | Exact file and acceptance-test selection | Avoid unrelated tests and discovery's capped candidate list. | Nonzero selected tests, acceptance coverage, comparison with full-suite failures. |
| 1 | Early prerequisite check | Motion reached diagnosis without a local Vitest executable. | Same blocked receipt semantics, no repeated unavailable adapter attempts. |
| 1 | Node environment for pure logic | Live and Anime List default to jsdom for calculation workloads. | Equal results and test inventory; no DOM dependency hidden by mocks/setup. |
| 1 | Separate correctness from diagnosis | A 400–1,000 ms check can trigger nine launches in diagnosis. | Retain ordinary runner reports; no performance verdict fabricated by the fast lane. |
| 2 | Reuse transforms/prepared dependencies | Repeated edits otherwise repay discovery, install/build, and transform costs. | Source/config/lockfile identity and stale-result rejection; cold fallback. |
| 2 | Collect timing and metrics together | Potentially remove three of nine executions. | Reporter A/A calibration; equal selection, metric completeness, and verdict behavior. |
| 2 | Profile only after a representative timing workload | Tiny tests often cannot yield repeatable source attribution. | Explicit timing-only result kind; full diagnostic escalation when needed. |
| 3 | Tune correctness worker count and shard placement | More workers can increase startup and contention. | Wall time and resource budgets on the actual CI runner, merged complete reports. |
| 3 | Build once, run filtered Rust/native tests | Avoid repeated orchestration and qualification builds. | Exact artifacts, configuration/architecture identity, same required checks. |

These are proposals, not installed flags, implemented modes, or promised gains.
Three avoided executions would reduce launch count by 33%; it would not establish
a 33% wall-time saving because phases have different costs.

## Selection and test organization

Pass a concrete file alongside the test-name filter. Name filtering alone can
still load unrelated files. Track which acceptance criteria the selected tests
exercise, including uncovered criteria. Imports, shared setup, fixtures,
configuration, lockfile, and runtime changes should widen selection. Dynamic
imports, reflection, and generated inputs require a conservative fallback.
[Vitest filtering](https://vitest.dev/guide/filtering) documents file/name behavior.

Maintain small logic/API projects separately from DOM/component/browser suites.
Import the relevant implementation directly where appropriate; a broad barrel
can drag unrelated initialization into a small check. Do not rewrite production
architecture solely to improve a test number. Measure import/setup phases first.

Use deterministic fixtures and injected transports for algorithm/handler tests.
Keep distinct integration checks for real network, database, and browser behavior.
The Fleet trial found inert URL fixtures rejected by admission: improve source
classification while retaining zero-egress enforcement. Removing endpoint guards
would change execution authority rather than improve the testing system.

## Warm reuse and cache design

A persistent runner can retain transformed modules between edits. A new process
with a disk cache is a different mechanism. A reused pass is not a newly executed
pass: expose cache hits and execution counts separately. Keep cold-start and
steady-state latency as separately named measurements.

Prefer existing repository-owned warm verification over a second daemon. Rust
already has [warm receipt validation](../../crates/codevetter-core/src/commands/warm_verification.rs)
and a [repository verify bridge](../../crates/codevetter-core/src/commands/warm_verification_bridge.rs).
These require a compatible verify entry point; they do not prove generic Vitest
warm reuse works for every Fleet repository. Inspect availability before use.
The Rust receipt validator requires `no_confidence` for stale source, source
changes during execution, cancellation, or incomplete selection; it rejects a
pass containing failing scenarios or confidence-affecting limitations. Preserve
these checks when evaluating a faster path.

Invalidate on source/fixture bytes, test selection, runner version, relevant
configuration, lockfile, runtime, platform/architecture, and environment contract.
Do not use Git HEAD alone for dirty worktrees. A hidden acceptance oracle must
remain outside agent-editable cached verdicts. Cancellation, process ownership,
memory bounds, stale results, and clean reset must retain their current semantics.

Installed samples are Vitest 3.2.7 (App Health) and 4.1.10 (Live/Anime List).
Current online documentation also describes newer releases. Version-gate options;
do not assume `doctor`, `fsModuleCache`, or experimental pre-parsing exist locally.
[Vitest v3 performance](https://v3.vitest.dev/guide/improving-performance) and
[v4 performance](https://v4.vitest.dev/guide/improving-performance) describe
isolation, worker pools, and file-level sharding.

Bytecode/transform caches are candidates for startup-heavy checks. Benchmark an
empty cache, populated cache, edited input, and invalidated config independently.
Precise coverage can conflict with caching; retain a coverage-qualified lane.
[Current Vitest performance guidance](https://vitest.dev/guide/improving-performance)
describes these mechanisms; support and semantics must be checked against the
installed runner before experiments.

## Parallelism and instrumentation

Parallelize independent correctness files only within a measured CPU/memory
budget. Serialize performance comparisons; our audit lock removes our own
profiling overlap but cannot isolate an operator's other workloads.
Do not globally disable isolation to get a smaller number. Test shared globals,
module mocks, singleton stores, timers, temporary paths, and ordering before
considering reuse or non-isolated execution for a specific pure suite.

Node's runner uses separate child processes by default; disabling isolation
shares a context and allows cross-file interference. File concurrency differs
from concurrency within a test. [Node 24 test execution model](https://nodejs.org/docs/latest-v24.x/api/test.html#test-runner-execution-model)
explains that boundary. Preserve it unless a qualified suite can safely change it.

Collect selection, preparation/build, worker startup, environment/setup/import,
test body, reporting, profiling, cleanup, queue wait, and recorder time separately.
Record unavailable phase data as unknown. Worker phase sums are not wall-time
partitions when execution overlaps. Report end-to-end p50/p95, not just a fast
test body or the sum of parallel worker durations.

## Rust, Swift, and browser lanes

CodeVetter CI already caches Rust builds. Prefer targeted package/binary/test
filters and reuse a matching feature configuration before adding infrastructure.
`cargo test --no-run` builds without executing tests; compilation is not a pass.
[Cargo test](https://doc.rust-lang.org/cargo/commands/cargo-test.html) documents
selection and build-only behavior. Nextest can archive built tests for multiple
execution shards; it is a candidate tool, not a dependency installed by this study.
Source revision and compatible execution targets must match.
[Nextest build reuse](https://nexte.st/docs/ci-features/archiving/).

The native background lane runs navigator preparation/tests, Swift behavior,
four separately filtered Release gates, and a Debug compile. Inspect phase costs
before combining gates: process isolation is part of their measurement policy.
Reuse build artifacts by exact configuration rather than weakening those gates.
Swift Testing's serialized trait constrains its suite/cases, not every unrelated
test; shared fixtures still need isolation.
[Swift parallelization](https://docs.swift.org/latest/documentation/testing/parallelizationtrait/).

Xcode supports build-for-testing followed by test-without-building and test
filters. Verify modern runner support and artifact identity before adoption;
the official command reference is archival.
[Apple TN2339](https://developer.apple.com/library/archive/technotes/tn2339/_index.html).
Local app activation and XCUITest retain the fresh idle-screen authorization
rule; use the dedicated hosted desktop for unattended interaction checks.

Use direct handler/API tests for server contracts that do not need a browser;
retain browser tests for navigation, rendering, interaction, and integrated state.
Playwright provides an HTTP request context and independent worker processes.
Unique accounts/data prevent parallel contamination. Browser launch reuse does
not make application state reuse safe.
[API testing](https://playwright.dev/docs/api-testing),
[parallelism](https://playwright.dev/docs/test-parallel).

## Pinned runner implementation checks

The Repo Unpack expansion adds source-level checks of runner internals. These
repositories were inspected without executing their code or tests. The following
mechanisms explain candidate experiments; none establishes a measured saving.

At Playwright `b630e71fcda7885885c459bcbb88e5bfa7c0a1ac`, location and positive
test-list filters feed file filtering before suite loading. Grep filters tests,
and changed-test selection is added after loading. File collection still runs,
and dependency projects can reintroduce files. Prefer a concrete file boundary
when module loading dominates; keep required setup dependencies in the check.
[Task ordering](https://github.com/microsoft/playwright/blob/b630e71fcda7885885c459bcbb88e5bfa7c0a1ac/packages/playwright/src/runner/tasks.ts#L290-L338),
[file selection and dependency closure](https://github.com/microsoft/playwright/blob/b630e71fcda7885885c459bcbb88e5bfa7c0a1ac/packages/playwright/src/runner/loadUtils.ts#L42-L87).

Playwright prefers an available worker with a matching hash and restarts workers
with incompatible hashes or failed runs. Fixture reuse rejects dirty test scope
and differing fixture-pool digests. Reuse is conditional; sharing a process does
not justify carrying arbitrary application state between checks.
[Worker scheduling](https://github.com/microsoft/playwright/blob/b630e71fcda7885885c459bcbb88e5bfa7c0a1ac/packages/playwright/src/runner/dispatcher.ts#L98-L176),
[fixture guard](https://github.com/microsoft/playwright/blob/b630e71fcda7885885c459bcbb88e5bfa7c0a1ac/packages/playwright/src/worker/fixtureRunner.ts#L189-L201).

At Vitest `4ee66c021e0592c886dbab727f0f8da9366f99ab`, changed files become related
sources; force-rerun triggers select all specifications. An empty related set can
select zero tests outside watch mode. Require a disclosed expected test inventory
when a verification task must exercise a check, rather than equating exit zero
with a passed acceptance test.
[Selection](https://github.com/vitest-dev/vitest/blob/4ee66c021e0592c886dbab727f0f8da9366f99ab/packages/vitest/src/node/specifications.ts#L122-L153).

Vitest uses the execution environment's transforms while constructing an affected
graph and caches module promises within that graph. Transform failures become
affected nodes. Dependency changes inside `node_modules` are excluded from local
source tracking; transform concurrency is bounded to control peak memory.
Graph-derived selection still needs a full-suite comparison for missed failures,
especially after dependency or configuration changes.
[Transform reuse](https://github.com/vitest-dev/vitest/blob/4ee66c021e0592c886dbab727f0f8da9366f99ab/packages/vitest/src/node/affected-modules.ts#L86-L108),
[source and concurrency limits](https://github.com/vitest-dev/vitest/blob/4ee66c021e0592c886dbab727f0f8da9366f99ab/packages/vitest/src/node/affected-modules.ts#L240-L264),
[graph cache and failure handling](https://github.com/vitest-dev/vitest/blob/4ee66c021e0592c886dbab727f0f8da9366f99ab/packages/vitest/src/node/affected-modules.ts#L284-L321).

Vitest resets evaluated modules and its mocker between files only when isolation
is enabled. It still restores mocks after a file, but that does not establish
that retained modules, singletons, or application state are clean. A reuse
experiment must include order changes and intentionally contaminating fixtures;
restoring mocks alone is an insufficient acceptance condition.
[Per-file reset boundary](https://github.com/vitest-dev/vitest/blob/4ee66c021e0592c886dbab727f0f8da9366f99ab/packages/vitest/src/runtime/runBaseTests.ts#L52-L88).

At DOM Testing Library `6049cc0bc7cf2201625c476c95fa6299d0e2fa8b`, `waitFor`
finishes on a nonthrowing synchronous callback or a fulfilled promise. Returning
`null` or `false` does not ask it to retry. Use a throwing presence getter or an
assertion for a required state; a quickly fulfilled wait is not evidence that
the state existed. Pending promises also suppress repeated callback invocation.
[Retry predicate](https://github.com/testing-library/dom-testing-library/blob/6049cc0bc7cf2201625c476c95fa6299d0e2fa8b/src/wait-for.js#L136-L159).

The same implementation advances fake timers by a fixed interval to avoid
starving user callbacks behind recursively scheduled timers. Its own test
asserts a 1,000 ms fake timeout with a real-clock threshold of 20 ms, explicitly
described as a CPU approximation. This fixture was inspected, not executed here.
It provides a useful experiment: verify the clock, timeout verdict, and recursive
timer behavior before replacing real waits. Fake-clock elapsed time cannot be
reported as an observed application response time or as our measured saving.
[Timer advancement](https://github.com/testing-library/dom-testing-library/blob/6049cc0bc7cf2201625c476c95fa6299d0e2fa8b/src/wait-for.js#L70-L82),
[Clock and starvation assertions](https://github.com/testing-library/dom-testing-library/blob/6049cc0bc7cf2201625c476c95fa6299d0e2fa8b/src/__tests__/fake-timers.js#L46-L81).

At Jest `61050e9323e742539dc2360236671110e37329e6`, collection loads setup and
test modules before bypassing test execution. Selected entries have status
`passed` with `wouldRun: true`, zero invocations, and zero passing assertions.
An upstream fixture even expects exit zero when collecting failing tests.
Collection can cheaply identify an inventory, but its result must remain a
collection receipt. Version-gate this behavior; it does not establish support
for this mode in Fleet's installed Jest versions.
[Collection entry point](https://github.com/jestjs/jest/blob/61050e9323e742539dc2360236671110e37329e6/packages/jest-circus/src/legacy-code-todo-rewrite/jestAdapter.ts#L80-L107),
[Result semantics](https://github.com/jestjs/jest/blob/61050e9323e742539dc2360236671110e37329e6/packages/jest-circus/src/legacy-code-todo-rewrite/jestAdapterInit.ts#L199-L237),
[Failing-body collection fixture](https://github.com/jestjs/jest/blob/61050e9323e742539dc2360236671110e37329e6/e2e/__tests__/collectTests.test.ts#L91-L99).

At StrykerJS `f2a49ff02437e3b7fe2682dba808ac93039895bf`, coverage can select
tests for nonstatic mutants; static mutants normally use the global test
selection, with different handling when `ignoreStatic` is enabled. Fresh plans
without coverage use the global selection. Incremental reuse takes a different
path: without reported coverage, it explicitly assumes old mutant results can
be reused and points to forced retesting. With coverage, killed-result reuse
requires an unchanged killing test; added covering tests invalidate non-killed
results. Evaluate these prerequisites before treating a cached mutation result
as evidence about changed tests. Neither branch was executed in this study.
[Coverage selection](https://github.com/stryker-mutator/stryker-js/blob/f2a49ff02437e3b7fe2682dba808ac93039895bf/packages/core/src/mutants/mutant-test-planner.ts#L100-L136),
[Reuse assumptions](https://github.com/stryker-mutator/stryker-js/blob/f2a49ff02437e3b7fe2682dba808ac93039895bf/packages/core/src/mutants/incremental-differ.ts#L394-L435).

## Experiments and decision criteria

Start with three representative existing workloads: a startup-heavy pure logic
test, a material computation benchmark, and a stateful integration suite.
Use isolated compatible runners and fixed source, fixtures, lockfiles, runtime,
test inventory, and resource budgets. Record cold and warm cases separately.

Compare one change at a time: default vs Node environment; cold vs transform
reuse; default vs combined metric collection; worker counts; cached build reuse.
Alternate baseline/candidate order with recorded seeds and repeat on an idle
runner. Pilot variance first, then predeclare repetition count and minimum
meaningful saving; three noisy samples from this audit are not calibration.

Require identical expected results, exercised acceptance checks, nonzero test
counts, and no new order-dependent failures. Include known failing fixtures to
verify failure detection. For selection changes, independently run the full
suite and disclose missed failures. For cache changes, edit source/config and
verify invalidation, cancellation, restart, and memory bounds.

For CodeVetter's value, compare the same tasks with and without its assistance
under equal total budgets. Count accepted correct outcomes, missed defects,
false findings, stale evidence, blocked attempts, end-to-end time and measured
cost. Agent-reported usefulness remains a separate signal. Adopt an optimization
only after a measured saving with unchanged required evidence; reject changes
that merely hide checks or shift elapsed time outside the reported window.
