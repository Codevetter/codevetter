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

All PRs below are drafts. They were created from dedicated branches without a
deployment, migration, production database, hosted-product load test, or paid
model call.

| Product | Pull request | Publication status | Runtime result |
| --- | --- | --- | --- |
| Web Playables | [#3](https://github.com/sarthakagrawal927/web-playables/pull/3) | Confirmed | Reusing the already-computed net revenue improved the 50,000-tick workload from 104.190 to 57.964 ms/op, or 44.37%; the shipping recommendation stayed withheld because the retained baseline had only three samples. |
| Anime List | [#59](https://github.com/Significant-Hobbies/anime-list/pull/59) | Confirmed | Stable bounded ranking improved the 35,000-item workload from 20.575 to 10.386 ms/op, or 49.521%. |
| Significant Hobbies | [#74](https://github.com/Significant-Hobbies/significanthobbies/pull/74) | Confirmed | Indexed category lookup improved the 35,000-phase workload from 9.116 to 1.810 ms/op, or 80.145%. |
| App Health | [#34](https://github.com/sass-maker/app-health/pull/34) | Confirmed, small | Reusing the Go response-writer wrapper reduced 30 to 29 allocs/op and 7,361 to 7,334 B/op; latency moved +9.253%, below the recorded rejection threshold. |
| Email Manager | [#30](https://github.com/Significant-Hobbies/email-manager/pull/30) | Directional | Weekly digest generation measured 16.181 ms/op before the experiment and 7.266/7.534 ms/op afterward, but the original paired capsule was not retained. |
| Starboard | [#74](https://github.com/Codevetter/starboard/pull/74) | Unverified | The 50,000-row recommendation flow measured 48.167 ms/op. The PR preserves traversal cleanup; two later experiments regressed and were reverted. |
| LoopTV | [#35](https://github.com/Significant-Hobbies/looptv/pull/35) | Unverified | The 8,760-row Smart Mix flow measured 4.230 ms/op; the PR caches favorite membership and adds a permanent scale guard. |
| Reader | [#36](https://github.com/Significant-Hobbies/reader/pull/36) | Unverified | RSS parsing measured 8.767 ms/op, but independent profiles disagreed on the source candidate. The PR is a narrow sanitization experiment with markup correctness coverage. |
| RolePatch | [#47](https://github.com/Significant-Hobbies/rolepatch/pull/47) | Unverified | Two profiles repeated `calculateATSScore` as the owned CPU candidate at 9.345 ms/op; no paired percentage is claimed. |
| Free AI | [#51](https://github.com/sass-maker/free-ai/pull/51) | Guardrail | Model selection across all 79 models measured 0.016231 ms/op. CodeVetter refused source optimization and the PR adds only a regression guard. |
| Reddit Insights | [#3](https://github.com/High-Signal-App/research-subreddit/pull/3) | Stacked, unverified | The bounded topic summarizer is based on collector [PR #2](https://github.com/High-Signal-App/research-subreddit/pull/2); no paired speedup is claimed. |

The strongest product results are Significant Hobbies, Anime List, and Web
Playables. App Health is mechanically real but too small to represent the
product's end game. The remaining drafts are useful reviewable experiments and
guardrails, not eleven independent claims of proven customer impact. The full
inactive-project disposition is retained in
[`artifacts/performance/old-local-projects-results-2026-08-09.md`](../../artifacts/performance/old-local-projects-results-2026-08-09.md).

## External open-source work

### Marked

[markedjs/marked#4048](https://github.com/markedjs/marked/pull/4048) is the only
external upstream PR created by this campaign. It optimizes reference-link
membership during the normal post-block inline phase while retaining the
dynamic direct-call path and clearing temporary state in `finally`.

Five-sample paired verification measured:

| References | Baseline | Candidate | Change |
| ---: | ---: | ---: | ---: |
| 100 | 1.577 ms/op | 0.869 ms/op | -44.9% |
| 500 | 15.472 ms/op | 3.326 ms/op | -78.5% |
| 2,000 | 217.253 ms/op | 12.761 ms/op | -94.126% |

The endpoint exponent fell from 1.644 to 0.897. A representative Markdown
control moved +2.722%, below the 10% materiality threshold. Marked's complete
`npm test` passed: 190 unit tests, 1,779 specification tests, ESM/UMD/CJS and
type builds, lint, and generated-output checks. The PR is open and no longer a
draft as of this record. Snyk passed; the visible Vercel failure is an external
contributor authorization requirement, not a repository test failure.

### No upstream PR submitted

- **qs:** flat parsing improved 45.086% at 40,000 parameters in ten-pair
  interleaved verification and all 1,045 upstream tests passed. No PR was
  submitted because the owner explicitly chose not to create a duplicate
  contribution after reviewing the existing upstream situation.
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
