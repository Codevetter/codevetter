---
title: Performance harness and baselines
description: How CodeVetter measures native responsiveness, Rust workloads, and regression claims.
---

# Performance harness and baselines

Performance evidence is split by layer so one fast number cannot hide a slow
interaction, expensive workload, or memory regression.

## Native application

`pnpm test:native:background` runs the non-activating performance contracts
alongside Swift tests and a Debug build. The current release qualification
checks:

- application launch;
- settled resident memory;
- Swift-to-Rust bridge latency;
- 1,000-event progress throughput;
- cancellation and worker crash recovery;
- bounded decode and render behavior for large receipts.

Foreground interaction and frame pacing require the hosted XCUITest lane or an
idle owner-approved desktop. Background host-render tests do not claim
window-server responsiveness.

## Rust workloads

The `codevetter performance` command owns exact workload admission, warmups,
sample counts, timeouts, cancellation, process-tree RSS sampling, cleanup, and
paired baseline/candidate evidence.

```bash
codevetter performance --help
codevetter scope --consumer performance --help
```

Native Performance calls the same receipt contracts. MCP can resolve scope and
inspect preparation evidence but cannot execute workloads.

For repository-specific Rust benchmarks:

```bash
cargo test --manifest-path crates/codevetter-core/Cargo.toml --release perf_bench -- --ignored --nocapture --test-threads=1
```

Timing assertions apply only to named calibrated hardware. Shared runners
preserve correctness and resource reporting without pretending their absolute
timings are comparable.

## MCP

```bash
pnpm core:prepare-mcp
pnpm core:bench-mcp
```

The MCP benchmark uses a temporary repository and SQLite database. It verifies
read-only schemas, pagination, redaction, response bounds, no TCP listeners,
and unchanged protected-repository state before reporting startup, query,
concurrency, RSS, and growth measurements.

## Native package comparison

Committed evidence lives in `evidence/performance/`. The current native
comparison records exact build identities, alternating launches, settled RSS,
and bundle size against the retired application. Historical comparison is
useful context, not a standing claim for a new package.

Refresh exact-package results before release:

```bash
pnpm native:runtime:compare --help
pnpm native:release:inspect --help
```

The protected production workflow binds these results to the signed and
notarized archive.

## Claim rules

- Measure the exact revision and package being discussed.
- Record warmups, samples, hardware, workload, and bounds.
- Distinguish launch, settled memory, bridge latency, render cost, interaction
  latency, energy, and long-session behavior.
- Averages never replace p95 or worst-case evidence.
- Sampling can miss peaks between observations; preserve that limitation.
- Missing baseline evidence blocks improvement claims.
- A smaller native bundle does not by itself prove a faster product.

The previous React/Tauri harness and its historical numbers are preserved in
`docs/archive/stale-performance-harness-2026-09.md`.
