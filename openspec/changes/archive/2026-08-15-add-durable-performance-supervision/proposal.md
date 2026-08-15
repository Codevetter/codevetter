## Why

The PostTrainLLM portfolio trial terminated before CodeVetter emitted a capsule, proving that an in-process profiler cannot explain its own kill, crash, or host-level termination. Agents need a durable outer process that records what was attempted and how it ended even when the profiling child never returns structured output.

## What Changes

- Add a closed performance-supervision operation that launches the existing diagnosis CLI as an owned child process rather than profiling in the supervisor process.
- Persist an atomic versioned run receipt before launch, refresh a bounded heartbeat while the child is alive, and finalize terminal state for success, non-zero exit, signal, timeout, spawn failure, or invalid child output.
- Store artifacts only under `.codevetter/performance-runs/<run-id>/`, with bounded redacted failure output and an optional validated result document.
- Add read-only receipt inspection through CLI and the local runtime MCP server.
- Prevent concurrent reuse of a run ID, path escape, arbitrary commands, inherited secrets, unbounded output, and false performance conclusions from incomplete children.
- Exercise the supervisor with successful, failing, timed-out, signaled, and stale/incomplete fixtures before retrying a resource-heavy real project.

## Capabilities

### New Capabilities

- `durable-performance-supervision`: Out-of-process execution, atomic receipts, heartbeat state, bounded artifacts, cleanup, and machine-readable inspection for local performance diagnosis.

### Modified Capabilities

None.

## Impact

- Adds local runtime scripts, contracts, CLI/MCP operations, tests, and performance documentation.
- Reuses the existing profiling CLI and Node runtime; no new dependency, daemon, cloud service, database, production configuration, or arbitrary command surface is introduced.
- Target repositories receive only explicitly requested ignored/local artifacts under `.codevetter/performance-runs/`; source files are never modified.
