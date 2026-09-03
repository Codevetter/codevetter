---
title: Native Rust boundary
description: Evidence-backed ownership split between the macOS process and supervised Rust workers.
---

# Native Rust boundary

The native macOS app uses a hybrid Rust boundary. Bounded, read-only projections
may move in-process after their schema, memory, crash, and packaging gates pass.
Verification and other risky or long-running work remains in supervised Rust
workers. Swift never owns verification policy, receipt meaning, SQLite handles,
or Rust object lifetimes.

This is an ownership decision, not permission to expose the entire Rust crate
through FFI.

## Evidence

The release benchmark moved the exact 40,047-byte generated capability registry
through two paths:

| Path | Median | p95 | Samples |
| --- | ---: | ---: | ---: |
| Rust FFI byte copy | 1.083 µs | 1.208 µs | 10,000 |
| Rust FFI copy plus Swift JSON decode | 106.708 µs | 171.791 µs | 1,000 |
| Release `codevetter capabilities --json` worker round trip | 82.255 ms | 84.644 ms | 20 |

Both paths produced semantically identical `codevetter.capabilities.v1` JSON.
The complete machine-readable receipt is in
`evidence/performance/native-bridge-benchmark.json`; the reproducible probe is
under `benchmarks/native-bridge`.

The approximately 82 ms worker startup cost is material for frequent lightweight
reads but negligible beside repository checks, model review, browser journeys,
or performance sampling. Those operations benefit more from cancellation,
process supervision, bounded authority, and crash isolation than from removing
startup latency.

## Selected split

| Operation | Boundary | Reason |
| --- | --- | --- |
| Capability registry and other immutable generated projections | Candidate in-process read | Frequent, bounded, deterministic, no ambient authority |
| Small read-only SQLite projections | Benchmark before admission | Latency may matter, but SQLite handles remain Rust-owned |
| Verification planning | Supervised worker initially | Shares source validation and execution identity with the run |
| Correctness, review, and performance execution | Supervised worker | Long-running, cancellable, provider and project-tool authority |
| Browser journeys and collectors | Supervised child workers | Highest crash, timeout, resource, and authority risk |
| PR watcher timing | Native app-lifetime task; each poll is a supervised Rust worker | Swift may wait and request a confirmed poll, but Rust owns PR discovery, sandbox execution, agent use, GitHub status writes, and persistence |
| Receipt persistence and verdict construction | Rust worker/service | One semantic authority across UI, CLI, and MCP |

## In-process admission gate

An in-process projection must satisfy all of these before production use:

1. The payload has a versioned Rust-owned schema and a deterministic fixture.
2. Swift receives owned bytes or values, never Rust pointers with shared lifetime.
3. Invalid, future, and oversized payload fixtures fail closed.
4. The call is read-only, bounded, non-blocking, and cannot invoke a provider,
   project command, browser, or network operation.
5. Crash containment and release packaging are qualified for the real library,
   not inferred from the 16 KB probe.
6. CLI and MCP projections remain semantically equivalent.

If any gate fails, the operation stays on the worker boundary.

## Worker contract

The native Review slice now enters one Tauri-independent Rust application
service through `codevetter.verification-command/v1`. The caller supplies or
receives one bounded request id; `codevetter.progress/v2` JSON lines on stderr
carry that identity plus a monotonic sequence, and the distinct preflight or
final canonical receipt on stdout carries the same identity. Native rejects
foreign progress and a terminal receipt whose identity does not match the
supervised command.

`codevetter.verification-cancel/v1` identifies the same request for supervised
cancellation. Native refuses a cancellation aimed at another active request;
an accepted cancellation terminates the request's supervised process group and
records no success receipt. It remains a transport-level terminal action rather
than a persisted canonical engine event, so concurrent daemon-style
cancellation is not implied by this service contract.

`codevetter watcher --operation poll` additionally requires `--confirm-run`.
The CLI is deliberately not a daemon: it remains alive until all newly observed
head-SHA runs have persisted receipts. Native macOS owns only a cancellable timer
for the open app session, and does not persist execution consent.

## Claim boundary

This decision completes the boundary prototype and selection. It does not prove
production FFI packaging, active-run memory, high-volume progress throughput,
large-receipt rendering, or crash recovery. Those remain qualification gates;
Tauri stays operational until the full migration matrix closes.
