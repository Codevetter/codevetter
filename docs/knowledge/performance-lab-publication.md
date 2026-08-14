---
title: Runtime performance lab publication record
description: Published product experiments, external contributions, evidence strength, and local-cost boundaries from the first CodeVetter performance campaign.
---

# Runtime performance lab publication record

This page records what left the local performance laboratory on 2026-08-10.
It is a publication ledger, not a second copy of the benchmark evidence. The
canonical runtime contracts and commands remain in
[performance.md](../development/performance.md), while the active OpenSpec
qualification records preserve the complete observations and limitations.

## Evidence labels

- **Confirmed** means CodeVetter compared the same workload and metric under a
  compatible policy and the candidate cleared the materiality threshold.
- **Directional** means repeated measurements support the candidate, but a
  retained paired baseline is missing.
- **Guardrail** means the flow was already fast or the artifact primarily
  protects against future regression.
- **Unverified** means the source change is plausible and correctness-tested,
  but CodeVetter has not measured a defensible before/after effect.
- **Rejected** means a measured candidate regressed, stayed below policy, or
  failed to explain the captured workload. Rejected changes were reverted.

These labels separate observed runtime evidence from agent inference. An open
pull request is not itself evidence that an optimization works.

## Fleet product pull requests

Nine PRs below are merged. Three remain open because merge would cross a
recorded safety or verification boundary. The campaign used dedicated branches
without a deployment, migration, production database, hosted-product load
test, or paid model call.

| Product | Pull request | Publication status | Runtime result |
| --- | --- | --- | --- |
| Web Playables | [#3](https://github.com/sarthakagrawal927/web-playables/pull/3) | Open · Confirmed | Reusing the already-computed net revenue improved the 50,000-tick workload from 104.190 to 57.964 ms/op, or 44.37%; the shipping recommendation stayed withheld because the retained baseline had only three samples. Merge remains separate because the connected Cloudflare Pages check may publish `main`. |
| Anime List | [#59](https://github.com/Significant-Hobbies/anime-list/pull/59) | Merged · Confirmed | Stable bounded ranking improved the 35,000-item workload from 20.575 to 10.386 ms/op, or 49.521%. |
| Significant Hobbies | [#74](https://github.com/Significant-Hobbies/significanthobbies/pull/74) | Merged · Confirmed | Indexed category lookup improved the 35,000-phase workload from 9.116 to 1.810 ms/op, or 80.145%. |
| App Health | [#34](https://github.com/sass-maker/app-health/pull/34) | Merged · Confirmed, small | Reusing the Go response-writer wrapper reduced 30 to 29 allocs/op and 7,361 to 7,334 B/op; latency moved +9.253%, below the recorded rejection threshold. |
| Email Manager | [#30](https://github.com/Significant-Hobbies/email-manager/pull/30) | Merged · Directional | Weekly digest generation measured 16.181 ms/op before the experiment and 7.266/7.534 ms/op afterward, but the original paired capsule was not retained. |
| Starboard | [#74](https://github.com/Codevetter/starboard/pull/74) | Open · Unverified | The 50,000-row recommendation flow measured 48.167 ms/op. All 201 CI tests pass, but the changed branches lowered branch coverage below the required 100%; merge is blocked pending focused tests. |
| LoopTV | [#35](https://github.com/Significant-Hobbies/looptv/pull/35) | Merged · Unverified | The 8,760-row Smart Mix flow measured 4.230 ms/op; the PR caches favorite membership and adds a permanent scale guard. |
| Reader | [#36](https://github.com/Significant-Hobbies/reader/pull/36) | Merged · Unverified | RSS parsing measured 8.767 ms/op, but independent profiles disagreed on the source candidate. The PR is a narrow sanitization experiment with markup correctness coverage. |
| RolePatch | [#47](https://github.com/Significant-Hobbies/rolepatch/pull/47) | Merged · Unverified | Two profiles repeated `calculateATSScore` as the owned CPU candidate at 9.345 ms/op; no paired percentage is claimed. |
| Free AI | [#51](https://github.com/sass-maker/free-ai/pull/51) | Merged · Guardrail | Model selection across all 79 models measured 0.016231 ms/op. CodeVetter refused source optimization and the PR adds only a regression guard. |
| Calorie | [#12](https://github.com/Significant-Hobbies/calorie/pull/12) | Merged · Confirmed synthetic stress | A one-pass exercise-history scan improved the 35,000-entry synthetic workload from 1.203 to 0.162 ms/op. The absolute saving was 1.041 ms at that stress input; no typical-user or customer-visible latency claim is made. |
| Reddit Insights | [#3](https://github.com/High-Signal-App/research-subreddit/pull/3) | Open · Stacked, unverified | The bounded topic summarizer is based on collector [PR #2](https://github.com/High-Signal-App/research-subreddit/pull/2); no paired speedup is claimed and no PR checks are configured. |

The strongest product results are Significant Hobbies, Anime List, and Web
Playables. App Health is mechanically real but too small to represent the
product's end game. Merge status does not upgrade evidence strength: the
directional, unverified, guardrail, and synthetic-stress entries are not
independent claims of proven customer impact. The full inactive-project
disposition is retained in
[`artifacts/performance/old-local-projects-results-2026-08-09.md`](../../artifacts/performance/old-local-projects-results-2026-08-09.md).

### Later source-bound local qualification

A separate 2026-08-12 blind qualification re-ran six selected local product
flows with ten-sample baselines, exact correctness checks, matching runtime
identities, sealed source-file boundaries, and append-only verification
receipts. Five flows use TypeScript/Vitest and one uses a Go benchmark:

| Product | Largest encoded input | Baseline | Candidate | Change |
| --- | ---: | ---: | ---: | ---: |
| RolePatch | 20,000 | 9.384 ms/op | 1.938 ms/op | -79.348% |
| LoopTV | 8,760 | 4.768 ms/op | 2.335 ms/op | -51.028% |
| Email Manager | 50,000 | 7.605 ms/op | 4.147 ms/op | -45.470% |
| Starboard | 50,000 | 46.900 ms/op | 32.464 ms/op | -30.780% |
| Reader | 200 | 10.528 ms/op | 7.822 ms/op | -25.703% |
| App Health Go | UUID + two numeric segments | 428 ns/op | 97.05 ns/op | -77.325% |

CodeVetter's historical qualification portfolio counts six accepted,
tool-originated experiments out of six accepted experiments, so it meets the
declared 80% policy for that historical manifest. This is a local
product-qualification result, not a
claim that the linked PRs already contain every later change. The accepted
Go result also reduced the measured benchmark from 144 to 64 B/op and from two
to one allocation per operation. One accepted Go benchmark does not establish
broad Go coverage, and the separate unseen GJSON experiment remained an honest
rejection.
Canonical evidence and the reproducible command live under
[`benchmarks/performance-lab/`](../../benchmarks/performance-lab/).

The same manifest now has a separate flow-coverage audit. It discovered 555
bounded executable declarations, but only ten contained direct benchmark or
timing evidence. All ten now have qualified runtime measurements; eight have
experiment records and six have accepted optimizations. The remaining App
Health outcomes include one materially inconclusive experiment and three
measured flows where CodeVetter declined to open another qualifying experiment.
Two early Echo calibration candidates remain immutable history but were
superseded when alloc_objects evidence showed the direct line was below the 10%
experiment floor. Six of seven Playwright declarations are now statically eligible
for owned local browser capture. A separate selected-product trial produced
normalized traces for all six exact flows, but established zero evaluation-
valid browser coverage: Email Manager exposed a shared remote-font load
boundary, while Reader exposed that port reachability does not establish the
intended Worker runtime.
The resulting local-server attestation now statically identifies Wrangler for
both exact 8787 origins and verifies one bounded listener's repository and
process-family ancestry before a passing trace can count. The first read-only
selected-product follow-up found no listener and intentionally produced no new
runtime-coverage claim; it did not start servers or read secret-bearing files.
Meanwhile, 538 ordinary correctness tests need a representative
measurement before they can become performance flows. RolePatch, LoopTV, and
Starboard reached the 128-declaration bound, so even the static inventory is
incomplete there. The retained product outcomes are in the
[performance-lab evidence](../../benchmarks/performance-lab/README.md).

## External open-source work

### Marked

[markedjs/marked#4048](https://github.com/markedjs/marked/pull/4048) was the
first external upstream PR created by this campaign. It optimizes reference-link
membership by checking the existing link table directly instead of rebuilding
and linearly searching its keys for every queued inline source. The revised
patch contains no duplicate lexer state.

Thirty alternating fresh-process pairs with per-process warmup measured:

| References | Baseline | Candidate | Paired median change (95% interval) |
| ---: | ---: | ---: | ---: |
| 100 | 0.805 ms/op | 0.489 ms/op | -39.2% (-40.3, -38.8) |
| 500 | 11.512 ms/op | 2.265 ms/op | -80.4% (-80.5, -80.2) |
| 2,000 | 164.115 ms/op | 10.095 ms/op | -93.8% (-93.9, -93.8) |

A 2,000-paragraph no-definition control moved +1.3% with a +0.3% to +2.3%
interval. Reintroducing `Object.keys` or using `for...in` restored that fast path
but re-enumerated the full link table and erased most of the target improvement,
so neither experiment was retained. Marked's complete `npm test` passed: 190
unit tests, 1,779 specification tests, ESM/UMD/CJS and type builds, lint, and
generated-output checks. The PR is open and no longer a draft. Two maintainer
threads on the earlier implementation are outdated. Snyk passes; Vercel's fork
preview requires upstream authorization and is not a code-test failure.

### qs

[ljharb/qs#592](https://github.com/ljharb/qs/pull/592) adds a guarded fast path
for entirely flat query strings. A fresh ten-pair interleaved publication run
measured 41.706 to 23.183 ms/op at 40,000 parameters, or 44.413%, and returned
`shipping_recommended: true` with no limitations. The 1,000- and
10,000-parameter inputs improved 32.902% and 47.334%.

All 1,045 upstream tests passed with 100% statement and line coverage. The PR
also documents the two unsafe broader candidates that the correctness suite
rejected before the final fallback boundary was retained. It is ready for
review; upstream maintainers still own the merge decision.

### No upstream PR submitted

- **go-chi/chi:** the profiler found allocation pressure in the router path,
  but inspection tied it to required `http.Request.WithContext` and context
  semantics. No unsafe patch was attempted.
- **Picomatch:** the candidate stayed below the materiality policy.
- **Pixelmatch:** the candidate regressed and was reverted.
- **GJSON:** the selected benchmark already reported zero allocations and no
  material bottleneck.

Negative results matter: they show that CodeVetter can withhold a patch when
the evidence does not justify one.

## What CodeVetter gained

The implementation and all qualification artifacts merged through
[CodeVetter PR #108](https://github.com/Codevetter/codevetter/pull/108).
[Follow-up PR #109](https://github.com/Codevetter/codevetter/pull/109) retains
paired Vitest domain metrics, source-anchors campaign hotspot lines while
preserving raw coordinates, and records the Calorie evidence boundary. Both
post-merge CI runs passed the complete desktop, CLI, MCP, and browser pipeline.

The campaign expanded CodeVetter from a one-shot profiler into a bounded local
optimization laboratory:

1. **Runtime failure capsules** capture failing Node/Vitest executions with
   redaction, source maps, Git-diff relevance, and deterministic evidence versus
   inference.
2. **Performance capsules** support Node tests, Node scripts, Vitest, and Go
   benchmarks with repeated metrics, dual-profile source attribution, scale
   curves, allocation evidence, and absolute-cost refusal.
3. **Local flow tools** expose closed capture, inspect, explain, and verify
   operations over MCP without accepting arbitrary commands after startup.
4. **Optimization verification** returns confirmed, rejected, inconclusive, or
   no-confidence and supports alternating paired checkouts.
5. **Qualification planning** discovers safe repository-owned workloads,
   excludes cloud and remote operations, and emits one bounded next action.
6. **Durable supervision** records resumable runs, budgets, exact revisions,
   evidence digests, cleanup state, and terminal reasons.
7. **Autonomous campaigns** keep correctness gates and the evaluator immutable
   while an agent proposes one source experiment at a time.
8. **Verification receipts** ingest project-runner evidence, compare regression
   state, and explain affected-test blast radius.
9. **Scaled challenge artifacts** provide Node and Go temperature aggregation
   workloads inspired by the One Billion Row Challenge without claiming an
   official submission.
10. **Self-profiling** found and fixed repeated source-offset scans in V8
    function coverage. The representative 91-document replay improved 18.11%;
    the 98.808% number belongs only to the adversarial regression fixture.
11. **Source-bound experiment receipts** now reject unrelated changed files,
    refuse cross-runtime Node comparisons, persist compact measurements and
    decisions, and aggregate a manifest-bound multi-repository involvement
    denominator.
12. **Flow-coverage accounting** now inventories supported declarations, joins
    durable positive and negative measurements, separates measured from
    experimented and accepted rates, and chooses the next uncovered flow.
13. **Go allocation precision** now inspects alloc_objects as well as
    alloc_space, rejects setup-dominated byte profiles, and refuses direct
    candidates that cannot meet the verifier's 10% materiality policy.
14. **Autonomous laboratory orchestration** now turns the coverage report's
    safe next action into sequential supervised measurements, high-signal
    existing-test screens, and experiment sealing, with an eight-step ceiling,
    immutable lifecycle history, and an explicit stop before source edits,
    generic tests, browser traces, or safety-flagged execution.
15. **Browser finding diagnosis** now turns exact attested Playwright evidence
    into failed-request, collapsed repeated-request, dominant-local-request,
    and unexplained-navigation findings. Capture and laboratory receipts retain
    compact finding references while withholding production, critical-path,
    caching, and semantic claims.
16. **Browser main-thread evidence** now captures bounded Chromium renderer
    tasks, independent JavaScript/style/layout/paint intervals, and
    repository-contained V8 sample candidates during the owned exact flow.
    Deterministic long-task and JavaScript CPU findings retain transformed-source
    and production-impact limits; raw Chromium traces are deleted after
    normalization. The installed-browser proof is hermetic, while the earlier
    selected-product receipts remain network-only and cannot be upgraded by
    replay.
17. **Browser original-source attribution** now maps leading local V8 candidates
    through a bounded same-origin module response and Node's built-in Source Map
    v3 parser. Original TypeScript/JavaScript file and line provenance requires
    repository containment plus byte-identical embedded source content. Missing,
    stale, escaping, redirected, oversized, or slow evidence remains transformed;
    raw modules, maps, source text, URL queries, and machine paths are not
    durable.
18. **Owned local Vite lifecycle** now closes the manual-server gap for exact
    React flows. The autonomous laboratory resolves only a contained installed
    Vite module, binds the exact qualified loopback origin, reuses only an
    attested existing listener, and always records owned process-tree cleanup.
    It disables repository Vite config and automatic environment-file loading;
    other server families and ambiguous listeners remain explicit stops. A real
    installed-Vite plus Chromium proof returns with no listener left behind.
19. **Application-flow inventory** now establishes a package-scoped denominator
    for supported React/Next routes, Node/Go endpoints, and OpenAPI operations
    before workload selection. It keeps declaration, static test reference, and
    validated same-snapshot runtime observation as separate evidence levels and
    returns one closed evidence-gap action without executing project code or an
    application request. Qualification across Anime List, Significant Hobbies,
    App Health, and Polaris found 188 flows and corrected three scanner accuracy
    faults before publication; zero runtime observations are claimed in that
    static run.
20. **Change-cost acceptance** now records files, additions, removals, gross
    line movement, and JavaScript/Go production dependency additions. The local
    lab and autonomous campaign reject source-bound candidates above the default
    three-file, 160-added-line, or 200-gross-line budget before expensive
    verification. Public proofs pair dated runtime results with this patch cost.
21. **Contribution closeout** now challenges retained patch complexity, binds
    local and optional T-Rex evidence to the pull-request head, reads current
    and outdated review threads, distinguishes failed checks from fork approval,
    and stops at upstream ownership without posting or assigning maintainer work.

The most important tooling improvements came from false or incomplete early
results: startup-dominated tests now fail closed, Vitest names must identify one
exact assertion, console metrics use repeated unprofiled medians, TypeScript
locations anchor to original source, unsupported scale semantics stay
unverified, and an inference must explain the captured workload before it is
allowed to guide a patch.

## One Billion Row Challenge boundary

The checked-in artifact is a local learning workload, not an official 1BRC
result. The Node parser improved from 118.928 to 35.744 ms/op at 800,000 rows,
or 69.945%, after CodeVetter selected the parser before source inspection. A
later 8.863% micro-optimization was rejected and reverted.

The Go lane adds streaming and parallel parsing experiments plus a recorded
100-million-row result. It does not claim parity with the best public 1BRC
implementations, one-billion-row completion, or hardware-independent speed.
That distinction is preserved in the artifact README and result record.

## Resource and safety boundary

- Product profiling was local and bounded; it did not hit production databases
  or hosted product endpoints.
- No Fleet product was deployed, migrated, released, or load-tested in the
  cloud.
- The Email Manager golden-fixture check fetched three small public npm package
  artifacts through its existing `pnpm dlx` command.
- Existing package stores and locally generated build/profile artifacts are not
  evidence of equivalent network transfer or cloud spend.
- Raw owned profiles were deleted after normalization. Durable campaign data is
  bounded under `.codevetter/performance-runs/` or the campaign's declared
  artifact directory.

## Publication rule

Future campaign output should enter this ledger only when it has a durable
branch, issue, or PR URL and an explicit evidence label. Merge status belongs
to GitHub; benchmark truth belongs to the reproducible CodeVetter artifact.
