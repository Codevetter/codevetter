## Why

CodeVetter can prove that exact request CPU belongs to the Node main thread, but
its current public summary collapses V8 and Node runtime frames into one
`runtime` bucket. The emitted `inspect_main_thread_runtime` route therefore
cannot yet tell an agent whether the observed work is module loading,
compilation, garbage collection, scheduling, HTTP/streams, buffers, native
builtins, or still unresolved.

## What Changes

- Normalize sampled Node/V8 runtime frames into a fixed, value-free mechanism
  inventory for the exact pre-commit request interval.
- Preserve legacy CPU and Playwright artifacts while emitting versioned new
  evidence for fresh captures.
- Make `inspect_main_thread_runtime` executable through the existing browser
  recapture operation and record runtime-mechanism completeness separately from
  correctness.
- Project a dominant mechanism and a bounded next observation without claiming
  exclusive CPU, source causality, or an optimization.
- Preserve an isolated pre-commit profile when another dynamic request begins
  only after the profiled response has committed, while continuing to reject
  whole-request and genuinely overlapping pre-commit evidence.
- Allow the repeated stability scheduler to compare runtime-mechanism routes,
  so multiple runs must agree before an agent follows the branch.
- Prove the classification on controlled profiles and exercise it on an
  unchanged real product flow without cloud or production work.

## Capabilities

### New Capabilities

- `main-thread-runtime-probing`: Closed Node/V8 runtime-mechanism capture,
  inspection, execution, repetition, and authority behavior for one exact local
  browser/server request.

### Modified Capabilities

None.

## Impact

- Evolves request CPU, browser server-flow, Playwright diagnosis, and browser
  probe recapture contracts with backward-compatible readers.
- Evolves the private raw profile and normalized CPU schemas additively; older
  profiles without a pre-commit overlap boundary retain their fail-closed
  behavior.
- Extends the existing CLI/MCP recapture and stability scheduler schemas; no new
  production dependency or external service is introduced.
- Adds focused normalization, compatibility, execution, scheduler, and real
  product proof coverage.
