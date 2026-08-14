## Why

The real RolePatch flow retained about 60 ms of isolated pre-commit main-thread
CPU after sampling profilers were disabled, while every closed native mechanism
remained below the routing floor. CodeVetter needs a bounded source observation
that avoids starting the inspector inside the measured request and does not
guess across incompatible clocks.

## What Changes

- Add a derived continuous main-thread source probe for a passing exact request
  whose lower-overhead evidence is complete, material, and unresolved.
- Start low-frequency V8 sampling before application warm-up, select the exact
  qualified request, stop at response commitment, and measure the stop tail
  independently before slicing the sampled interval.
- Normalize only bounded repository, dependency, generated, runtime, and idle
  scopes; expose repository source candidates only when source-map containment,
  materiality, and completeness checks pass.
- Require compatible repeated captures before a source route is considered
  stable, while retaining low confidence and no edit or optimization authority.
- Exercise the probe on the existing RolePatch flow and preserve an
  observation-versus-inference proof receipt.

## Capabilities

### New Capabilities

- `continuous-main-thread-source-probing`: Derivation, execution,
  normalization, repetition, and authority boundaries for one exact local
  request profiled continuously from owned-runtime startup.

### Modified Capabilities

None.

## Impact

- Extends the existing browser-probe inspection, recapture, assessment, and
  bounded stability contracts without adding a new public MCP operation.
- Affects the owned Node preload, private flow artifacts, CPU-profile
  normalization, durable performance receipts, tests, and performance
  documentation.
- Adds no production dependency, production telemetry, arbitrary execution
  configuration, cloud work, or automatic source edit.
