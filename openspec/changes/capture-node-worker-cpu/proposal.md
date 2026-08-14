## Why

CodeVetter can now prove that material request CPU is not sufficiently represented by the main JavaScript thread, but its next step is only a request to capture worker or background CPU. Agents still need a bounded runtime observation that distinguishes registered Node Worker activity from child-process, native-thread, profiler, and otherwise unresolved process CPU.

## What Changes

- Observe Node `Worker` instances created through the public `worker_threads` module without modifying application source or worker payloads.
- Capture bounded Worker CPU usage and V8 samples across the exact request pre-commit interval when the installed Node runtime supports the APIs.
- Normalize Worker evidence into closed source scopes with completeness, timing, overlap, runtime-support, and observer-effect boundaries.
- Reconcile Worker CPU with process and main-thread evidence to select a more specific next probe without granting source-edit authority.
- Preserve unsupported, zero-worker, exited-worker, truncated, overlapping, and malformed cases as explicit evidence rather than guesses.

## Capabilities

### New Capabilities

- `node-worker-cpu-evidence`: Request-correlated, bounded Worker CPU and sampled-scope evidence for supported Node runtimes.
- `worker-aware-probe-routing`: Deterministic routing that distinguishes observed Worker activity from unresolved native, child-process, background, or sampling gaps.

### Modified Capabilities

None.

## Impact

- Affects the owned Node preload, browser-server normalization, deterministic performance diagnosis, compact Playwright diagnosis, autonomous-lab evidence, tests, and performance documentation.
- Uses stable public Node APIs already present in Node 24.8+; no production dependency is added.
- Older runtimes remain supported but report Worker CPU capture as unavailable.
- No application source, worker payload, response value, environment value, production system, or remote service is read or changed.
