## 1. Durable receipt contracts

- [x] 1.1 Define closed versioned request and receipt contracts, terminal states, byte bounds, and safe run IDs.
- [x] 1.2 Implement atomic receipt/result writes and read-only validation under the owned run directory.

## 2. Supervisor execution

- [x] 2.1 Launch the existing diagnosis CLI as a direct owned child with closed arguments and minimal environment.
- [x] 2.2 Persist initialized/running heartbeats and finalize success, exit, signal, timeout, spawn, and invalid-result outcomes.
- [x] 2.3 Bound and redact child output, validate successful diagnosis JSON, and record its digest without retaining untrusted raw data.

## 3. Agent surfaces

- [x] 3.1 Add closed CLI operations to start a supervised run and inspect a receipt by safe run ID.
- [x] 3.2 Add read-only MCP receipt inspection scoped to the repository fixed when the server starts.
- [x] 3.3 Document artifact ownership, exit semantics, recovery limits, and local resource boundaries.

## 4. Qualification

- [x] 4.1 Test successful, failing, signaled, timed-out, spawn-failed, malformed-output, duplicate-ID, redaction, and atomic-inspection paths.
- [x] 4.2 Verify existing direct profiling, flow, campaign, CLI, and MCP behavior remains compatible.
- [x] 4.3 Run focused tests, lint, documentation checks, strict OpenSpec validation, and diff checks.
- [x] 4.4 Retry one bounded real workload through the supervisor and record whether a terminal receipt survives.
