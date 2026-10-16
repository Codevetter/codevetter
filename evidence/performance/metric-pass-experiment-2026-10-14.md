# Node metric-pass experiment — 14 October 2026

Issue: [#348](https://github.com/Codevetter/codevetter/issues/348). The
[reproducible script](../../scripts/runtime-failure-capsule/metric-pass-experiment.mjs),
[admitted workload](../../benchmarks/runtime-challenges/temperature-aggregation/metric-pass-workload.test.mjs),
and [raw result](metric-pass-experiment-2026-10-14.json) bind this local result to
the v1.16.1 source checkout, exact source hashes, Node 26.10.0 on macOS arm64,
plan IDs, per-arm wall times, child durations, and parsed metric observations.
No provider, external request, desktop app, or installed CLI was used.

The question was whether Node `node:test` measurement output can also supply
the existing console metric observations, avoiding three repeated metric
executions. Both paths used the same test file, reporter, zero-egress runner,
three metric samples, and parser. The named test checks 200,000 temperature
rows against expected counts, sums, minima, and maxima on each execution.
The separate path made three measurement executions followed by three metric
executions; the combined path used the three measurements for both. Five pairs
alternated arm order. Before running, the script required all assertions, the
same metric inventory and sample counts, and at least 20% median paired wall
saving to justify *further qualification*.

| Evidence | Result |
| --- | ---: |
| Workload executions | 45/45 passed; each selected exactly one named test |
| Metric inventory | `aggregate`, `ms/op`, three samples in every arm |
| Separate-path wall time | 3,042–3,948 ms per arm |
| Combined-path wall time | 1,515–2,456 ms per arm |
| Paired wall saving | 34.62–52.94%; median 50.33% |

The stage-only threshold was met. The combined metric medians ranged from
7.765 to 11.288 ms/op; separate medians ranged from 7.590 to 8.323 ms/op.
In the second pair, the combined median was 11.288 versus 7.682 ms/op in the
separate arm. These are different workload executions on a shared host, so
metric-value parity is unproven. The source and JSON retain each pair and
execution duration rather than reducing the experiment to this table.

**Decision:** retain the existing default for now. This comparison did not
execute the profile and flow stages, compare full diagnosis verdicts, test
Vitest's different measurement/metric reporters, or establish memory and
cancellation parity. The runs shared a host with other work and did not reset
filesystem caches. A representative full-pipeline A/B with equal acceptance,
metric/profile completeness, and negative controls is the next adoption gate.
The result measures local runner wall time; it does not measure agent time saved
or establish incremental agent benefit. The [owner's 9 October decision](https://github.com/Codevetter/codevetter/issues/348#issuecomment-6073387497)
to drop additional matched real-agent trials still applies.

## Complete Node component check — 16 October 2026

The [follow-up campaign](metric-pass-full-pipeline-2026-10-16.json) used clean
source `8bc720b0be0e3625c50d5c3b7b46aabea8a79ade` (tree-equivalent to merged
`2df2a2a6059cabbd8515735b4b546a3756617cd8`) and Node 24.21.0 on this shared
macOS arm64 host. It compared the complete Node profiling/diagnosis component
with flow enabled. This excludes the Rust CLI supervisor/resource sampler and
native viewer; it is not whole-CLI or app latency.

A private copy of `performance.mjs` removed only Node-test's separate metric
loop and its planned metric process count. Production source was not changed.
Both paths kept one warmup, three measurements, two CPU profiles, a flow pass
and a function-coverage pass. Combined metrics explicitly retain measurement
provenance; no synthetic metric execution was added to the receipt.

Before execution the campaign required 20% median paired wall saving,
three metric samples, at most 20% paired metric-value difference, matching
diagnosis class, selected passing tests, profile/flow/coverage presence,
zero egress, cleanup and unchanged rejection of negative controls.
Five pairs alternated baseline/candidate order, one arm at a time.

| Evidence | Result |
| --- | ---: |
| Selected positive executions | 95/95 passed |
| Processes per positive arm | 11 baseline; 8 combined |
| Metric observations | Same `aggregate` / `ms/op`, three samples |
| Profiles, flow and function coverage | Retained in every arm |
| Paired component-wall saving | 24.59–28.94%; median 25.11% |
| Largest paired metric difference | 3.27% |
| Wrong-selection / failed-assertion controls | Both rejected in both arms |
| External requests / retained profiling files | Zero / none |

The four negative controls returned `no_confidence`; printed metrics did not
turn failed assertions or an unexecuted selection into a passing capture.
The bounded campaign gates passed. Its raw report SHA-256 is
`21e8536fcbc3212ef67f8dd7abc48fa9ebb7f7ee229c56b855df6f559182ac49`.

[The replayer](../../scripts/runtime-failure-capsule/full-metric-pass-experiment.mjs)
accepts repository root and output directory as positional arguments; its
measurement/control body matches the executed fixed-root script. It writes
raw capsules, diagnoses and predeclared protocol before summarizing. Use Node
24 for the same runtime. The executed entry-point SHA-256 was
`86d8b3a63bfc067934d9f6c19a349215eee970751479eb4291a5ecb29e1f2ab5`.

**Decision:** keep the default unchanged. This is one Node-test workload on a
shared host, with filesystem-accounting work and unreset OS caches. Coupled
metrics passed this tolerance check; that is not general metric equivalence.
Whole-process-tree memory/cancellation, warm reuse, Vitest reporter parity and
a separately supported timing-only lane remain unqualified. No canonical
paired-optimization verdict, product speedup, source-pattern recommendation or
independent agent-benefit result follows from this component campaign.
