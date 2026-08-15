# Scaled Parsing Challenge Qualification

Date: 2026-08-09

## Artifact identity

This is CodeVetter's original Node.js adaptation of Gunnar Morling's official
One Billion Row Challenge task, not an upstream Java submission. The artifact
now includes a compatible file-to-stdout entry point and verifies sorted
min/mean/max output, UTF-8 station names, full signed temperature bounds, and
round-toward-positive mean behavior. Attribution and deliberate differences are
recorded in the benchmark's `ARTIFACT.md`.

## Method

The qualification used CodeVetter's persistent local MCP against the exact Node
test `temperature aggregation scales across deterministic row counts`. The
workload generated the same 20,000, 200,000, and 800,000 synthetic
`station;temperature` rows on every execution, checked exact count/min/max/sum
digests, and emitted parsing time separately from input generation.

The baseline was captured before parser-source optimization. Each candidate was
captured in the same MCP session and compared by
`verify_local_optimization`. A later stronger qualification alternated
independent reference and optimized processes. No model, network, database,
cloud resource, production configuration, or retained raw profile was used.

## Baseline

CodeVetter observed:

- 20,000 rows: 2.953 ms/op;
- 200,000 rows: 30.498 ms/op;
- 800,000 rows: 118.928 ms/op;
- 40x input produced 40.274x time, a 1.002 endpoint exponent classified as
  approximately linear; and
- `aggregateTemperatures` at `parser.mjs:1` carried 799.750 ms combined self
  time and 77.64% of repository-owned CPU samples.

The two independent profiles selected the same function with 325 and 319
samples and 77.23% and 78.04% shares. CodeVetter returned
`application_cpu_hotspot`, medium confidence, and the bounded action to optimize
one candidate and compare the identical workload.

## Verified iteration

Source inspection after the diagnosis showed two per-row string splits and
generic decimal conversion. One parser change replaced them with a single
cursor over the input while preserving the same aggregate contract.

The stored baseline comparison observed:

| Rows | Baseline ms/op | Candidate ms/op | Change |
| ---: | ---: | ---: | ---: |
| 20,000 | 2.953 | 0.956 | -67.626% |
| 200,000 | 30.498 | 8.877 | -70.893% |
| 800,000 | 118.928 | 35.744 | -69.945% |

The endpoint exponent improved from 1.002 to 0.982. CodeVetter returned
`confirmed`, `mechanically_confirmed: true`, and `materially_useful: true`
because the largest input improved by 69.945% without a smaller-input
regression. It correctly returned `shipping_recommended: false`: both captures
used three samples, below the ten-sample shipping floor.

The candidate profile still placed the parser first, but absolute combined self
time fell from 799.750 ms to 253.750 ms. Its 73.07% share remained high because
parsing is intentionally the challenge's dominant application operation.

## Rejected iteration

A second candidate unrolled the fixed one-decimal temperature loop. Against the
first verified candidate, CodeVetter observed +4.079% at 20,000 rows, -4.540%
at 200,000, and -8.863% at 800,000. The largest improvement missed the recorded
10% policy, so the verifier returned `inconclusive`, mechanically unconfirmed,
and not materially useful. That candidate was reverted.

The final correctness smoke measured 0.970, 9.063, and 34.674 ms/op at the same
three sizes. Those smoke values are not substituted for the stored MCP
comparison.

## Stronger requalification

A reproducible reference parser using line splitting and `Number` conversion
was added behind `CODEVETTER_1BRC_VARIANT=reference`. Reference and optimized
variants share the exact aggregate and output digest assertions. Six fresh
processes alternated `reference, optimized, optimized, reference, reference,
optimized`; every process measured ten iterations at every size.

| Rows | Reference ms/op | Optimized ms/op | Change |
| ---: | ---: | ---: | ---: |
| 20,000 | 2.719 | 0.994 | -63.442% |
| 200,000 | 28.028 | 8.732 | -68.845% |
| 800,000 | 114.947 | 35.937 | -68.736% |

The 800,000-row deterministic input was 13,120,640 bytes. Median peak process
RSS was 496,608 KiB for the reference variant and 109,856 KiB for the optimized
variant, a 77.879% reduction. Peak RSS covers the full test process, including
dataset generation and assertions, and is therefore a process envelope rather
than parser-owned memory.

The earlier approximately 70% latency result survives stronger sampling: the
requalified high-end improvement is 68.736%. The new evidence also establishes
that avoiding split-created intermediate strings materially lowers current
process memory. It still does not establish billion-row behavior.

## Limit And Next Boundary

The largest executed input was 800,000 rows held as one generated string. This
qualification does not claim throughput, completion time, or memory behavior at
nine billion rows. A simple linear projection would ignore string size,
garbage collection, I/O, cache behavior, and parallelism and is therefore not
product evidence.

The next earned challenge boundary is chunked file or stream processing against
an on-disk input. The whole input, expected aggregates, and observed result are
still resident in the test process, which makes a billion-row attempt
non-credible despite the improved bounded RSS. CodeVetter can compare emitted
bytes and peak-RSS metrics, but direct process-resource normalization remains a
future product integration rather than a general Node adapter capability.
