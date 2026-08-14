## Why

CodeVetter now emits specific browser-server next probes such as
`inspect_main_thread_repository` and `inspect_libuv_threadpool_crypto`, but an
agent cannot execute those probes through CodeVetter after the capture. It must
manually reopen the full result and reconstruct which request, mechanism, and
source evidence produced the recommendation, weakening product ownership of the
diagnosis loop.

## What Changes

- Add a durable read-only browser-probe inspector that integrity-checks one
  Playwright capture and resolves its exact recommended probe and request.
- Return a compact closed projection of timing, CPU, Worker, native activity,
  and correlated source candidates relevant to that probe.
- Reject stale or mismatched probe names, missing request identity, tampered
  receipts/results, unsupported probe families, and unsafe capture IDs.
- Expose the same operation through the repository CLI and runtime MCP.
- Carry exact server-request ordinal in compact next-probe evidence so later
  inspection does not infer request identity from display text.

## Capabilities

### New Capabilities

- `durable-browser-probe-inspection`: Integrity-checked, agent-callable
  inspection of a diagnosed browser-server next probe and its bounded evidence.
- `agent-probe-source-correlation`: Closed, non-causal source candidates derived
  from the already captured main-thread, Worker, async, and request evidence.

### Modified Capabilities

None.

## Impact

The change affects compact Playwright diagnosis schema, durable capture loading,
a new inspection module, CLI/MCP definitions and dispatch, focused contracts,
tests, and performance documentation. It adds no dependency, application edit,
network access, production tracing, or autonomous source mutation.
