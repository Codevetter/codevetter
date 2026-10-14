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
