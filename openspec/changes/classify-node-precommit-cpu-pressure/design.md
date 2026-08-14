## Context

The response-boundary slice identifies a large pre-commit interval but cannot
explain its execution shape. `process.cpuUsage()` is an existing Node primitive
that provides monotonic user and system CPU deltas without a dependency or
application instrumentation. It is process-wide, so overlap must invalidate
per-request interpretation.

## Goals / Non-Goals

**Goals:**

- Distinguish high, low, and mixed observed process CPU during one complete
  pre-commit interval.
- Preserve response behavior and private-data boundaries.
- Give the agent a safe next-probe direction without source-edit authority.

**Non-Goals:**

- Exclusive request CPU, worker attribution, event-loop utilization, async wait
  causation, framework phases, production equivalence, or source attribution.

## Decisions

### Retain deltas, never absolute process counters

The preload snapshots `process.cpuUsage()` at request admission, the earliest
response commitment call, and finish. It emits only non-negative user/system
deltas for preparation and the full request. Absolute counters are discarded.

### Contaminate every overlapping admitted request

The preload maintains only an in-memory set of active admitted request IDs. A
new request increments a whole-request overlap count for itself and every active
request. It increments the existing request's pre-commit count only if that
request has not committed, while the new request's pre-commit interval overlaps
every request already active at admission. IDs are never projected. A non-zero
pre-commit count prevents pre-commit classification; later static-resource
overlap does not erase earlier isolated evidence. This does not rule out
unrelated process background work, which remains an explicit limitation.

### Compare CPU duration with wall duration using a closed classification

For a complete non-overlapping response partition of at least 5 ms, preparation
CPU divided by preparation wall time is classified as:

- `high_process_cpu`: at least 0.5
- `low_observed_process_cpu`: at most 0.2
- `mixed_process_cpu`: between those thresholds
- `insufficient_evidence`: incomplete, overlapping, or immaterial

Ratios may exceed one because process CPU can include multiple threads. The
classification is descriptive and always source-null, low-confidence, and
edit-ineligible.

## Risks / Trade-offs

- **Process-wide CPU is not exclusive request CPU** → Reject overlap and retain
  the remaining background-work limitation.
- **CPU can exceed wall time** → Preserve the ratio without calling it
  utilization.
- **Low CPU does not prove I/O waiting** → Name it low observed process CPU and
  require a narrower async or external-operation probe.
- **Snapshot calls add overhead** → Take three constant-time snapshots per
  admitted request and prove behavior in the existing Node fixtures.

## Migration Plan

Keep the private same-run event additive and rev persisted browser-server and
Playwright schemas. Old stored evidence remains unchanged and normalizes to an
explicit incomplete CPU observation. No external migration is required.
