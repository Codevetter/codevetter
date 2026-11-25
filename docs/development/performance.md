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

Static admission blocks a non-loopback URL only when it is passed directly to a
request or navigation API; fixture URLs (`new Request(...)`, records, parser
input) and object-method handler calls such as `worker.fetch(request, env)`
are disclosed by target line as limitations. Every blocker cites target lines.
Runtime zero-egress enforcement still turns any actual remote attempt into a
`policy_violation` receipt.

For repository-specific Rust benchmarks:

```bash
cargo test --manifest-path crates/codevetter-core/Cargo.toml --release perf_bench -- --ignored --nocapture --test-threads=1
```

Timing assertions apply only to named calibrated hardware. Shared runners
preserve correctness and resource reporting without pretending their absolute
timings are comparable.

## Chromium interactions

Use `measureBrowserInteraction` from
`scripts/runtime-failure-capsule/browser-interaction.mjs` in a headless
Chromium Playwright workload. Load and settle the test page first. Wrap one
interaction and assert that the intended result occurred inside the callback.
The probe needs at least two animation-frame callbacks during the measurement.
It fails the workload if it cannot observe an interval.

```js
const result = await measureBrowserInteraction(page, 'chart-scrub', async () => {
  await scrubChart(page);
  await expect(selectedReading).toHaveText(expectedReading);
}, { cpuRate: 4 });
console.log(result.benchmark);
```

Pass the exact spec and test title to `codevetter performance --operation diagnose`
with the Playwright adapter. The receipt retains the reported interaction
metrics separately from test duration. Each metric name must appear once per
sample. Repeated metric names, clipped output and redacted benchmark lines
exclude that sample's metrics and leave an incompleteness warning in the
receipt. Paired verification uses Playwright test duration and process wall
time. To compare the interaction metrics across revisions, review the recorded
receipts with the same viewport, CPU throttle, fixture, input sequence and
asserted outcome.
A CPU-profile run (`cpuProfile: true`) returns a Chromium profile for local
inspection. Record it in a separate run so the profiler does not affect the
timing baseline.

The probe observes renderer task, script, layout and style time, plus gaps
between animation-frame callbacks. The timing counters can overlap. Animation
callbacks do not count displayed or dropped frames, and CPU throttling does not
model a phone's GPU, temperature, battery or native app runtime.

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
