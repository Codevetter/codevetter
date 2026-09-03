# Calorie exercise-guidance performance trial — 2026-08-10

This records a local proof run, not a customer-impact case study. The benchmark
used no production database, hosted endpoint, deployment, or paid model. The
publication ledger should label any later review URL as a synthetic stress
result unless representative product-scale evidence is added.

## Scope

- Project: `/Users/sarthak/Desktop/fleet/calorie`
- Starting revision: `4db2075170a27c5147ad88fe3622dd69760d90ec`
- Runtime: Node `v24.19.0` on Darwin arm64
- Exact flow: `exercise guidance performance scales across representative food histories`
- Benchmark: `src/lib/recommendations.performance.test.ts`
- Candidate: `calculateGymGuidance` in `src/lib/recommendations.ts`
- Inputs: 1,000, 10,000, and 35,000 food-history entries; 100 in-process
  iterations per input
- Correctness oracle: the selected exercise window must belong to the most
  recent eligible meal, independent of input order; future and expired meals do
  not qualify

The benchmark is intentionally a scale/stress workload. A 35,000-entry local
history is useful for distinguishing algorithmic behavior, but this artifact
does not establish that typical users have that history size or that the
operation is currently a visible UX bottleneck.

## Why CodeVetter selected it

`runtime:plan-flow-campaign` discovered the timed Vitest flow without a manual
target hint. The independent source-profile passes inside a five-sample run
repeated `calculateGymGuidance` as the repository-owned CPU candidate. The
captured supported-scale cost after the change was approximately `0.17 ms/op`
at 35,000 entries.

The planner classified the candidate as actionable but used neutral frequency
and user-impact weights because Calorie has no project-owned priority manifest.
Therefore production frequency and customer impact remain unverified.

## Change

The baseline implementation cloned the history, filtered it, fully sorted the
eligible entries, mapped every entry into a window object, and then selected the
first still-open window. The candidate performs one pass and retains only the
most recent eligible open window.

The change preserves the baseline's stable-tie behavior: when two entries have
the same timestamp, the first input entry remains selected.

## Paired result

CodeVetter alternated baseline and candidate executions for ten measurement
pairs after one warmup per side. Both checkouts used the same exact workload
digest:

`ebf9f02b4b14632ea6f245be39693a196b5276ea42bc6cedd46000819e80c0ec`

| History entries | Baseline median | Candidate median | Change |
| ---: | ---: | ---: | ---: |
| 1,000 | 0.034 ms/op | 0.016 ms/op | -52.941% |
| 10,000 | 0.253 ms/op | 0.046 ms/op | -81.818% |
| 35,000 | 1.203 ms/op | 0.162 ms/op | -86.534% |

The endpoint scale exponent moved from `1.003` to `0.651`. CodeVetter returned:

- verdict: `confirmed`
- mechanically confirmed: `true`
- materially useful under the recorded benchmark policy: `true`
- shipping recommended at the ten-sample floor: `true`
- verifier limitations: none

Interpretation: the algorithmic improvement is strongly supported. The absolute
benefit is only about `1.041 ms/op` at the largest stress input, so this is not
yet evidence of customer-visible latency. A future UI must show absolute and
relative movement together.

## Correctness and repository checks

- Focused Vitest run: 2 files, 17 tests passed
- Full Calorie test run before the final iteration-count increase: 28 files,
  120 tests passed
- TypeScript: `pnpm typecheck` passed
- Biome on the three touched files passed
- `git diff --check` passed

## CodeVetter improvements caused by this trial

The first paired Vitest attempt compared runner startup time and ignored the
benchmark's console `ms/op` series. That produced an inconclusive result even
though both sides emitted comparable domain metrics. CodeVetter now retains the
median console metrics from repeated paired Vitest measurements, matching the
existing Node-test and Node-script behavior. A regression test covers the
failure mode.

The later campaign run also exposed a source-coordinate mismatch: the raw V8
profile reported generated line 178 while bounded source inspection uniquely
anchored `calculateGymGuidance` to original TypeScript line 254. The campaign
planner now emits the source-anchored line and preserves the raw profiler line
as `reported_line`. This prevents an agent or UI from silently presenting the
generated coordinate as the original source location.

Relevant CodeVetter validation after both fixes: 34 focused runtime-performance
tests passed, including paired execution, Vitest metric retention, source-line
alignment, Node profiling, and Go benchmark coverage.

## Other candidate screening in this pass

| Project | Evidence found | Decision |
| --- | --- | --- |
| India Standards | Existing benchmark depends on a local DuckDB/data path and requires explicit arguments. | Not executed in the default local campaign; the workload needs a declared fixture boundary first. |
| Karte | Generic tests but no direct timing evidence; important paths are database/network-shaped. | No synthetic optimization forced. |
| SWE Interview Prep | Generic deterministic tests over small fixed catalogs, with no representative timed flow. | Kept as a correctness surface; no scale claim manufactured. |
| ChatGPT Memory Insights | Local export normalization and semantic-analysis code were inspected. The dominant semantic flow depends on model inference, while the only current performance test checks timer bookkeeping. | No candidate changed. A representative staged analysis fixture is needed before optimizing source. |

These negative decisions are part of the proof: discovery breadth is not the
same as evidence quality, and a campaign should be allowed to return “needs a
better workload.”

## UI implications earned by this evidence

Per application, the eventual surface should show:

1. flow inventory: tested, excluded, and missing-workload flows;
2. exact revision, workload identity, samples, and correctness gate;
3. observed absolute and relative measurements;
4. source-anchored candidate plus raw profiler coordinate when they differ;
5. confirmed, rejected, guardrail, or needs-better-workload status;
6. inferred product impact separately from measured runtime impact;
7. the concrete tool improvement or product patch produced by the trial.

This trial argues against building a generic profiler dashboard first. The
useful UI object is an evidence-backed application-flow review with explicit
coverage and missing-evidence states.
