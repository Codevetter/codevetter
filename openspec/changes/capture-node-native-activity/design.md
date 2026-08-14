## Context

See [proposal.md](./proposal.md). Experiments on Node 24.19 established two
important implementation facts: disabling a programmatic trace flushes complete
event objects while the owned server remains alive, but the enclosing trace JSON
document remains unfinished until process exit; and
`node.threadpoolwork.sync` emits paired worker-thread execution intervals for
async crypto and zlib work. V8 emits complete or paired GC and compilation
intervals. Trace timestamps share Node's monotonic high-resolution clock.

## Goals / Non-Goals

**Goals:**

- Observe request-correlated libuv worker execution and V8 activity without
  stopping the local server before browser evidence is normalized.
- Publish a small closed summary that an agent can query directly.
- Refine an exact other-thread residual into a useful next observation.

**Non-Goals:**

- Treat activity duration as exclusive CPU or reconcile it arithmetically with
  process CPU.
- Retain raw trace events in durable evidence.
- Trace production, child processes, arbitrary categories, or application data.
- Attribute native activity to an application source in this slice.

## Decisions

### Programmatic request-scoped tracing

The owned launcher supplies only a contained trace-file pattern. The preload
creates one tracing handle for a fixed category set and enables it immediately
before the selected handler dispatch. First commitment disables it and writes a
private marker containing the request evidence ID, monotonic start and stop,
response offset, overlap count, and support state.

Alternative: enable tracing for the whole server lifetime. Rejected because
Next startup and warmup would enlarge evidence and weaken request relevance.

### Parse complete objects from a live partial container

The trace collector reads at most 16 MiB and scans the `traceEvents` array with a
bounded string-aware JSON-object state machine. It admits at most 50,000 complete
objects, ignores a final incomplete object, and never requires or synthesizes
the container closing tokens. Marker completeness, byte/object bounds, balanced
event pairs, and exact interval containment determine public completeness.

Alternative: stop the server before collection. Rejected because the current
Playwright import needs server-flow evidence before runtime cleanup and because
changing that lifecycle would create a much broader failure surface.

### Normalize interval unions, not sums or CPU

Complete `X` events and paired `B/E` events become clipped intervals. Pairing is
private and may use raw thread/event identity; those values are discarded.
Overlapping intervals within each closed mechanism are unioned. Public totals
therefore describe elapsed activity coverage and cannot exceed the request
interval. Lowercase async begin/end latency is not counted as worker execution.

### Closed mechanism mapping

`node.threadpoolwork.sync` maps crypto, zlib, filesystem, DNS, network,
Node-API, blob, and unknown allowlisted runtime work into stable public classes.
V8 event names map only to GC or compilation; all other V8 names are excluded in
the first release. Metadata and all event arguments are discarded.

### Native-aware residual routing

The native summary participates only after exact main-thread CPU is below the
main-thread threshold and Worker evidence is complete. At least 5 ms of complete
libuv execution activity selects `libuv_threadpool_<class>` and
`inspect_libuv_threadpool_<class>`. A complete zero summary requests deeper
native/V8-background CPU sampling. Unsupported or unsafe states request a
specific recapture. No route gains source or edit authority.

## Risks / Trade-offs

- **[Trace Events is experimental]** → Version the evidence, expose support,
  use only stable closed mappings, and preserve the existing router fallback.
- **[Live trace JSON is structurally unfinished]** → Parse only individually
  complete bounded objects and prove truncation/malformed cases fail closed.
- **[Trace overhead changes the diagnostic request]** → Mark observer effect,
  trace one request once, and never treat it as authoritative benchmark evidence.
- **[Activity overlaps but does not explain CPU]** → Never subtract, ratio, or
  call it attribution; route only to a narrower follow-up.
- **[Some native CPU emits no selected trace event]** → Complete zero activity
  advances to deeper native sampling rather than declaring no native work.

## Migration Plan

Add the temporary trace pattern to the owned Node launch, join the new summary,
increment browser-server and Playwright diagnosis schemas, and replay unchanged
High Signal. Rollback removes the trace flag, collector, and nested request
evidence; no durable application-data migration is required.
