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

Vitest and jsdom are neither declared dependencies nor installed in this checkout.
The experiment retains an unavailable Vitest preflight and **zero executed tests**;
Node tests are not presented as a Vitest or jsdom substitute. Representative
Vitest/environment equivalence, supported warm-verifier reuse, and memory bounds
remain unqualified. No new dependency or alternate runner default was added.

No timing improvement is claimed, so there is no baseline/candidate timing
comparison. Raw correctness-run TAP durations are retained, not interpreted as
acceleration. The prior 208-line experiment remains a bounded synthetic study.
The default diagnosis pipeline, metric/profile passes, instrumentation completeness,
acceptance contracts and disabled pattern-specific recommendations are unchanged.
No native, production, installed-app, provider or agent benefit is established.

## Reproduction and checks

```sh
node scripts/runtime-failure-capsule/source-execution-experiment.mjs
node scripts/runtime-failure-capsule/portable-reset-experiment.mjs
node --test scripts/runtime-failure-capsule/source-execution.test.mjs scripts/runtime-failure-capsule/portable-reset.test.mjs
```

Focused regressions execute the real studies, not only fabricated JSON. The CI
workflow includes these two test files. On this Linux host, the portable runtime
suite passes with the two Go cases explicitly excluded. Both Go failures also
reproduce on the untouched published prerequisite: Go is absent and portable
Go zero-egress enforcement is unavailable. The existing platform-specific skip
remains a skip. No enforcement was relaxed to obtain a green result.

The repository testing skill's discovery was recorded as unavailable because
there is no installed CodeVetter CLI; its closing assessment is agent-reported
`blocked/setup_blocked`. Direct Node reports are not relabeled as CLI invocations.
