## Context

See [proposal.md](./proposal.md) for motivation. The owned preload already records
request admission, response commitment, process CPU deltas, a main-isolate V8
profile, and bounded Worker CPU. Node 22.19 and newer also expose
`process.threadCpuUsage()` for the current JavaScript thread. `process.cpuUsage()`
measures the current process across threads and does not include child processes.

## Goals / Non-Goals

**Goals:**

- Derive an exact bounded CPU partition for the request-handling thread versus
  every other thread in the owned Node process.
- Reconcile Worker CPU against that other-thread residual.
- Correct the existing invalid child-process residual label.
- Preserve compatibility on older Node runtimes and all existing evidence.

**Non-Goals:**

- Attribute native or libuv CPU to a source in this slice.
- Measure child-process CPU or include it in parent-process reconciliation.
- Change application source, production behavior, or optimization authority.

## Decisions

### Enclose thread intervals within process intervals

At admission, snapshot process CPU before current-thread CPU. At commitment and
finish, snapshot current-thread CPU before process CPU. This makes the process
interval enclose the thread interval and minimizes negative residuals caused by
the snapshot calls themselves. The public partition still applies a fixed small
rounding tolerance and fails closed when it cannot reconcile.

Alternative: reuse independently timed process and V8 sampled intervals. Rejected
because sampled time is neither exact CPU nor guaranteed to share counter bounds.

### Add a nested public thread partition to process CPU evidence

Raw request events retain only thread CPU deltas and support state. Flow
normalization derives a nested `thread_partition` with rounded main-thread and
other-thread totals and ratios. Absolute counters never leave the preload.

Alternative: create another sidecar profile file. Rejected because the counters
are tiny, already share the exact response boundary, and belong atomically with
process CPU evidence.

### Use exact CPU for ownership and V8 samples for scope

Exact current-thread share decides whether work is on the request-handling thread.
The bounded V8 pre-commit profile only names repository, dependency, generated,
or runtime scope when at least 5 ms of non-idle samples are retained. Material
exact CPU without enough samples becomes `main_thread_unattributed`.

### Compare Worker CPU with other-thread CPU

Worker CPU is part of the same Node process and therefore belongs inside the
other-thread residual. Materiality remains 5 ms and 20%, but the denominator is
the compatible other-thread CPU total. A Worker total exceeding that residual
beyond tolerance is incompatible rather than silently clamped.

### Replace the invalid child-process probe

The terminal residual becomes `native_background_thread_or_sampling_gap` with
next probe `capture_native_v8_libuv_thread_activity`. Trace-event categories for
V8, libuv threadpool, DNS, networking, and filesystem are a possible later
implementation. Child-process flow cost will require its own wall/CPU contract.

## Risks / Trade-offs

- **[Sequential counter snapshots add a small envelope]** → Publish the
  observer effect and require compatible fixed thresholds rather than claiming
  exclusive instruction-level CPU.
- **[Older Node versions lack current-thread CPU]** → Preserve process CPU and
  fall back to sampled routing with explicit unsupported state.
- **[Worker and process counters can have slightly different stop times]** →
  Apply the existing 25 ms interval check plus a 1 ms CPU reconciliation
  tolerance and fail closed on excess Worker CPU.
- **[Native residual remains broad]** → Emit a more accurate next probe without
  claiming native cause or source authority.

## Migration Plan

Increment the browser-server and Playwright diagnosis schemas, retain old
process CPU behavior as unsupported thread partition when absent, run a new
unchanged High Signal capture, and keep the OpenSpec change active until the
work is committed and shipped. Rollback removes the nested partition and restores
the prior schema; no application data migration is involved.
