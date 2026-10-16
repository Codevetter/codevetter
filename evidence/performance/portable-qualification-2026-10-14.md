# Portable source and execution qualification

Published prerequisite: `0e8be1686ed11ad5bfc0e97b41f4fe4f49842144` (PR #388).
Issue: [#348](https://github.com/Codevetter/codevetter/issues/348).
This is a bounded synthetic source/evidence increment. It does not close #348.
The owner-dropped matched real-agent trials remain dropped.

## Executed scope

The [source experiment](source-execution-experiment-2026-10-14.json) records
Node's built-in TypeScript transformer, runtime/binary identity, compiler input,
generated-code and map hashes, selection identity, per-run identity, and actual
V8 detailed coverage. The inspected V8 script bytes must hash to the generated
bytes. The fixture includes an enum transformation, so generated and original
line numbers differ. Both mode selections execute through the existing admitted
zero-egress Node runner; each asserts its result before emitting execution proof.

| Selection | Original sort anchor | Original slice anchor |
| --- | --- | --- |
| Bounded input mode | Not executed | Executed |
| Full input mode | Executed | Not executed |

The new `source-execution.mjs` qualifier is experimental and is used by this
study, not wired into production diagnosis. It qualifies an explicitly selected
**generated span and its exact original start anchor**, not every character of
an original expression, CPU attribution, arbitrary bundlers, or a source-pattern
recommendation. One-source maps with embedded input are supported; ambiguous
anchors, stale identities and missing evidence stay unknown. The original span
coordinates in the JSON are zero-based; the displayed mapped anchor is one-based.
Node's experimental transformer omits `sourcesContent`; the study explicitly
adds its known compiler input and hashes that completed map separately.

Nested zero-count ranges override enclosing execution. Uncalled functions with
`isBlockCoverage=false` must retain their zero count. Positive function-only
coverage is insufficient. Collection-only, cancellation, partial selection,
failed assertions, changed source/compiler/runtime/selection/run identity, and
mismatched executed bytes cannot qualify. These local consistency checks are
not signatures authenticating externally supplied receipts.

The [reset experiment](portable-reset-experiment-2026-10-14.json) executes:

- Exact Node name selection, with explicit passing and failing assertions. The
  full suite fails its seeded oracle; selecting a passing test omits that failure.
  A nonexistent name can exit zero but is rejected as execution evidence.
- Two fresh-child module checks, real Node environment and timer-reset checks,
  plus same-process imports that demonstrate retained singleton state.
- Dependency, configuration and lockfile edits rejected by existing plan
  invalidation. A changed dependency fails the same acceptance assertion; restoring
  it passes. This is not an implemented warm cache or a generalized reset proof.
- Real SIGTERM sent to the owned supervisor only after the workload itself writes
  a start marker. The supervisor is signaled, its result is null and its direct
  child is gone, **but the detached workload survives** on this Linux host. The
  study sends SIGKILL to that owned workload for cleanup. Cancellation is explicitly
  unqualified; a direct-child-only check would have missed this negative result.
  Repairing process-tree cancellation remains open; no runner policy is changed.

## Negative and unknown results

The earlier unavailable CodeVetter-local Vitest preflight remains recorded with
zero executed tests. It is not the final prerequisite outcome: the owner-authorized
public consumer experiment below uses Reader's existing frozen dependencies.
No CodeVetter dependency or default runner was changed. jsdom is not declared by
either checkout; the representative DOM environment is Reader's actual happy-dom.
Supported production warm reuse and memory bounds remain unqualified.

No timing improvement is claimed, so there is no baseline/candidate timing
comparison. Raw correctness-run TAP durations are retained, not interpreted as
acceleration. The prior 208-line experiment remains a bounded synthetic study.
The default diagnosis pipeline, metric/profile passes, instrumentation completeness,
acceptance contracts and disabled pattern-specific recommendations are unchanged.
No native, production, installed-app, provider or agent benefit is established.

## Published Vitest consumer experiment

The [consumer report](vitest-consumer-experiment-2026-10-14.json) executes Reader's
published pure-logic `src/lib/spa-route.test.ts` (18 route assertions), pinned to
[`4c45b25f2c0320d7d25901940973dcb9cbe40dde`](https://github.com/Significant-Hobbies/reader/tree/4c45b25f2c0320d7d25901940973dcb9cbe40dde).
The original checkout stays detached and clean. Experiments archive that exact
public commit into a disposable repository and hard-link its installed package
inputs; source mutations and synthetic controls exist only in the disposable copy.
No Reader branch, product source, lockfile or dependency declaration is changed.

`corepack pnpm install --frozen-lockfile` succeeded using pnpm 10.33.2 and the
persistent store `/root/.local/share/pnpm/store/v10`. Resolution was skipped;
639 packages were reused and three downloaded. The normal policy ran `prepare`
(Husky) and retained pnpm's ignored dependency build scripts. A repeat frozen
install reported the lock up to date and all packages already installed. The
installed virtual-store lock exactly matches the published lock SHA-256:
`ce041879ea878b0514385888bc85f11246bd38c5b3f477310432b0bc7b51416e`.
This installation step accesses public package sources; **test workloads** run
under the existing zero-egress Node preload with minimal inherited environment.

Tool identities are Node 24.19.0, Vitest/@vitest/coverage-v8 4.1.10, Vite 8.1.5,
Rolldown 1.1.5, happy-dom 20.11.1 and declared TypeScript 6.0.3. TypeScript's
package version is recorded, not misidentified as Vite's transform compiler.
The report binds published source/test/config/lock hashes, installed package
manifests, Node binary, study implementation, selection, and each assertion's
fresh run ID. Vite transform-code/map/input hashes are retained for traceability;
these are not an inspector proof of exact executed Vite script bytes. Exact-span
execution qualification remains the separate Node transformer experiment above.

| Experiment | Observed result |
| --- | --- |
| Existing default Vitest adapter/config | All 18 named route assertions pass |
| Fresh context and same-context rerun, each environment | 18 passing assertions in happy-dom and in Node |
| Exact `/app` selection, each environment | One assertion executes; 17 tests skipped |
| Absent selection / collection, each environment | Zero assertions; execution unqualified |
| Explicit module, fake-timer, global and spy reset, twice per environment | Four tests / nine assertions pass each time |
| Unreset singleton control, each environment | Second assertion fails as expected |
| Imported source edit + explicit transform invalidation | One route assertion fails; restoration passes all 18 |
| Passing body followed by seeded afterAll failure | Body assertion passes, module failure retained; execution unqualified |
| Seeded test assertion oracle | Five assertions fail; restoration passes all 18 |
| Config edit with a new context, then restore | Node then happy-dom each pass all 18 |
| Cancel after real test-body start | Both tests skipped, zero assertions; queued body never starts; owned worker gone after close |
| Source/config/lock plan invalidation from clean tree | Stale plan rejected in all three controls |
| Same edits with already-dirty tree | Existing plan check misses all three; exact hashes detect edits; reuse unqualified |

“Cold” means a fresh Vitest context, not cleared machine/filesystem caches.
“Warm” means a repeated run in the same context with isolation retained. This is
correctness/reset evidence only: there is no elapsed-time comparison or speedup
claim. The results apply to this pure-logic module, not DOM-dependent tests or
all Reader behavior. Instrumentation passes and production acceptance remain intact.

Vitest's run result can retain modules from previous runs. The study selects the
exact requested module and requires positive assertion counts with the current
run ID and exact expected names. Collection, exit zero, duplicate names, partial
selection, failed tests, stale run IDs and changed identities cannot qualify.
The cancellation API observation does not erase the independent supervisor's
surviving-detached-workload counterexample. Likewise, a clean-to-dirty transition
is insufficient as a reusable source/config/lock cache identity; the dirty-tree
negative is retained rather than promoted to a warm-verifier recommendation.

Reproduce on Linux with a separate public checkout (do not use an active product
worktree). Install the already-declared dependencies through the frozen flow:

```sh
git clone https://github.com/Significant-Hobbies/reader.git /tmp/reader-348
git -C /tmp/reader-348 checkout --detach 4c45b25f2c0320d7d25901940973dcb9cbe40dde
(cd /tmp/reader-348 && corepack pnpm install --frozen-lockfile)
node scripts/runtime-failure-capsule/vitest-consumer-experiment.mjs /tmp/reader-348 --disposable-checkout
CODEVETTER_READER_STUDY_ROOT=/tmp/reader-348 node --test scripts/runtime-failure-capsule/vitest-consumer.test.mjs
```

The live consumer integration and source/reset focused suite passed all ten tests.

The current replayer requires an explicitly disposable, clean checkout with its
own frozen install. It restores the known public source/configuration inputs and
removes only its own study fixtures, including after failure. It does not copy
dependency/build directories or mutate Git refs/index state. Fleet agents use
`fleet-workspace` for this checkout and its install; the command above shows the
standalone reproduction. Historical reports remain tied to their recorded source
hashes; a fresh report is required when the covered runtime implementation changes.
CI runs the deterministic consumer-evidence rejection regressions alongside the
live synthetic source/reset studies. The consumer integration is explicitly
skipped without its pinned, frozen checkout; a replay is not a live Vitest run.
CodeVetter CI does not acquire a mandatory sibling-product dependency.

The [16 October replay](vitest-consumer-node-selection-2026-10-16.json) binds the
current Node completion reporter and runtime implementation instead of replacing
the historical report's hashes. It ran on macOS arm64 with Node 24.21.0 and a
separately installed frozen Reader checkout: all 18 default route assertions
passed, with 29 retained experiment rows and 12 qualified selections. All six
clean/already-dirty source, configuration and lockfile edits rejected stale plans.
Cancellation retained zero completed assertions and the owned worker was gone
after close. The checkout returned to its exact clean pinned commit. This is a
fresh consumer replay, not production transformed-source or warm-reuse acceptance.

## Reproduction and checks

```sh
node scripts/runtime-failure-capsule/source-execution-experiment.mjs
node scripts/runtime-failure-capsule/portable-reset-experiment.mjs
node --test scripts/runtime-failure-capsule/source-execution.test.mjs scripts/runtime-failure-capsule/portable-reset.test.mjs
```

Focused regressions execute the real studies, not only fabricated JSON. The CI
workflow includes these source/reset test files and the consumer evidence regressions. On this Linux host, the portable runtime
suite passes with the two Go cases explicitly excluded. Both Go failures also
reproduce on the untouched published prerequisite: Go is absent and portable
Go zero-egress enforcement is unavailable. The existing platform-specific skip
remains a skip. No enforcement was relaxed to obtain a green result.

The repository testing skill's discovery was recorded as unavailable because
there is no installed CodeVetter CLI; its closing assessment is agent-reported
`blocked/setup_blocked`. Direct Node reports are not relabeled as CLI invocations.
