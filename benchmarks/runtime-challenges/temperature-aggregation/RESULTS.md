# First cross-runtime result

The durable 2026-08-10 campaign used 100,000,000 rows, 413 official station
names, deterministic Gaussian temperatures, and a 1,379,543,193-byte local
fixture. Every Node and Go lane produced the expected output digest. The full
sample record is in [results/2026-08-10-100m.json](./results/2026-08-10-100m.json).

## Observed

| Runtime | Workers | Retained mean | Throughput | Median peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Go | 12 | 347.474 ms | 287.8M rows/s | 9.9 MB |
| Go | 16 | 283.484 ms | 352.8M rows/s | 10.7 MB |
| Node.js | 12 | 857.582 ms | 116.6M rows/s | 1.23 GB |
| Node.js | 16 | 773.342 ms | 129.3M rows/s | 1.51 GB |

CodeVetter also verified two implementation iterations on identical smaller
workloads:

- Go stopped allocating a station string for every existing-map lookup:
  23.831 ms to 14.773 ms per 800,000 rows, a 38.0% reduction; allocations fell
  from 800,077 to 141 per operation.
- Node replaced its JavaScript byte-by-byte row loop with bounded UTF-8 chunk
  decoding: 145.584 ms to 44.486 ms per 800,000 rows, a 69.4% reduction.

The lab rejected two Go experiments: a custom hash table moved latency by only
2.7%, below materiality, and a manual reader regressed latency by 7.5% while
raising bytes/op by roughly 14 times.

## Inferred

- Go continues to benefit through 16 workers on this 18-logical-CPU machine.
- Node worker startup dominates small fixtures; at 100 million rows it still
  improves from 12 to 16 workers, at substantial memory cost.
- Node's next high-value target is per-worker heap and string-allocation
  pressure. Go is much closer to local storage/CPU throughput limits.

## Unverified

- Linear projection from the 100-million-row run suggests about 2.83 seconds
  for Go and 7.73 seconds for Node at one billion rows.
- Those are not measured one-billion-row results and are not directly
  comparable with public results on other hardware or the authoritative random
  fixture.
