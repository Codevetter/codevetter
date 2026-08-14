## Why

The first real `inspect_main_thread_runtime` recapture found that one
inspector-attributed sample represented 85.875 percent of retained runtime
sampled time. CodeVetter correctly refused to blame application code, but its
emitted `repeat_with_lower_overhead_cpu_measurement` route is not executable,
so an agent cannot yet replace observer-affected V8 sampling with independent
evidence.

## What Changes

- Make the derived `repeat_with_lower_overhead_cpu_measurement` route
  inspectable and executable from an integrity-checked runtime capture.
- Start the same exact qualified local browser/server flow with V8 and Worker
  CPU profilers disabled by a closed CodeVetter policy.
- Retain exact process/thread CPU counters, bounded request-scoped Node trace
  intervals, async lineage, response phases, and correctness as separate
  evidence.
- Seal the owned server process after all browser diagnostics but before trace
  parsing, so Node flushes request-scoped trace events while evidence remains
  available for bounded collection and cleanup.
- Route only complete isolated GC, compilation, or libuv trace activity above
  a fixed floor; otherwise remain unresolved.
- Allow bounded repetition to compare the corroborated route without granting
  source, edit, optimization, production, or impact authority.
- Prove the profile switch and routing on controlled fixtures and one unchanged
  High Signal flow without cloud or production work.

## Capabilities

### New Capabilities

- `low-overhead-runtime-corroboration`: Profiler-disabled exact-request
  runtime corroboration, execution, routing, repetition, and authority rules.

### Modified Capabilities

None.

## Impact

- Evolves owned Next runtime startup, browser probe inspection/recapture,
  stability comparison, scheduler schemas, and CLI/MCP probe enums.
- Reuses existing process CPU, thread CPU, native trace-event, async, response,
  Playwright, and durable receipt primitives.
- Changes only the owned local-runtime lifecycle; repository-declared servers
  and unowned listeners are never terminated.
- Adds no production dependency, external service, arbitrary command surface,
  cloud workload, or production instrumentation.
