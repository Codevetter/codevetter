## Why

The first profiler-disabled High Signal recapture retained 286 request-scoped
GC intervals totaling 16.923 ms and selected `inspect_gc_pressure`, but that
recommendation is trapped inside a recapture receipt and is not executable.
An agent therefore still has to leave CodeVetter to determine whether the
pressure repeats and which application allocation sites deserve inspection.

## What Changes

- Allow an integrity-checked browser-probe recapture to become the provenance
  source for exactly the next probe selected by its normalized evidence.
- Make `inspect_gc_pressure` inspectable, executable, and repeatable for the
  same exact qualified local Playwright request.
- Run the follow-up in an owned profile with CPU profilers disabled, bounded
  request-scoped GC observation enabled, and a request-scoped V8 sampling heap
  profile used only for allocation-source candidates.
- Normalize GC kind, count, union duration, longest observed interval, bounded
  heap snapshots, and sampled repository allocation callsites without
  converting any of them into causal CPU or retained-memory claims.
- Preserve correctness, source snapshot, request identity, local-network
  denial, artifact integrity, legacy receipt readability, and bounded
  sequential execution.
- Prove fail-closed behavior on controlled fixtures and usefulness on one
  unchanged local qualified flow without production or cloud work.

## Capabilities

### New Capabilities

- `gc-pressure-probe`: Provenance-safe chained execution and bounded
  request-scoped GC/allocation evidence for an agent-selected local flow.

### Modified Capabilities

None.

## Impact

- Evolves the owned Next preload/runtime profile, browser-server evidence,
  browser probe inspection/recapture/stability/scheduler receipts, and CLI/MCP
  closed inputs.
- Reuses Node Inspector, `perf_hooks`, V8 heap statistics, source containment,
  Playwright correctness, and existing durable evidence roots.
- Adds no dependency, application source modification, arbitrary command or
  environment surface, production instrumentation, cloud workload, or UI.
