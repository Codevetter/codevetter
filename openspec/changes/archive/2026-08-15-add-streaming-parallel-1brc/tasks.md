## 1. Qualified File Fixture

- [x] 1.1 Add a deterministic chunked file generator with row, byte, and SHA-256 metadata
- [x] 1.2 Enforce default row, byte, duration, retention, and available-disk guards before generation
- [x] 1.3 Add exact contract fixtures for UTF-8 names, signed limits, rounding, chunk boundaries, and final rows without a newline

## 2. Bounded-Memory Node Lanes

- [x] 2.1 Implement the sequential byte-stream parser with incomplete-row carry and integer-tenths aggregation
- [x] 2.2 Implement newline-aligned file partitioning and worker-local Node aggregation
- [x] 2.3 Merge worker results deterministically and verify sequential, parallel, and existing parser digest parity
- [x] 2.4 Profile one and bounded multiple worker counts to identify the local scaling ceiling

## 3. Comparable Go Lanes

- [x] 3.1 Implement a dependency-free sequential Go parser over the identical file and output contract
- [x] 3.2 Implement bounded parallel Go partitions with worker-local aggregation and deterministic merge
- [x] 3.3 Verify Node and Go result parity for every qualified scale and edge-case fixture

## 4. Campaign Evidence

- [x] 4.1 Add a local campaign command that reuses one fixture and records variant, worker count, input identity, wall time, throughput, and peak memory
- [x] 4.2 Run five compatible samples per qualified variant, discard extrema, and retain the mean of the remaining three
- [x] 4.3 Separate observed paired results from runtime hypotheses and non-comparable official-frontier context
- [x] 4.4 Add an explicit opt-in extended lane for 100 million and one billion rows without enabling it in normal tests or CI

## 5. Validation And Handoff

- [x] 5.1 Run parser correctness, campaign contract tests, full runtime-capsule tests, touched-file lint, and diff checks
- [x] 5.2 Run strict OpenSpec and documentation validation
- [x] 5.3 Record the first same-machine Node/Go results, remaining bottleneck, resource use, and the next evidence-earned iteration
