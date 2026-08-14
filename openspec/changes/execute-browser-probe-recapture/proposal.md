## Why

CodeVetter now emits and inspects durable browser next probes, but an agent must
still reconstruct the exact Playwright flow, owned runtime, and evidence options
to gather the requested follow-up. That manual gap keeps the product from
leading the debugging loop and makes probe names weaker than executable tools.

## What Changes

- Add one bounded, durable browser-probe recapture operation that starts from a
  validated prior capture and executes the same exact qualified flow.
- Initially execute only the common
  `complete_async_and_framework_inventories` probe with a closed expanded
  request-evidence presentation bound.
- Bind the recapture to the prior repository revision, source snapshot, target,
  test name, browser project, request ordinal, and probe name.
- Own and clean up the same local Vite/Next runtime used by the autonomous lab;
  preserve remote-network denial and existing browser correctness behavior.
- Return and persist a compact recapture receipt that distinguishes whether the
  requested evidence became complete, remained incomplete, or failed.
- Expose equivalent CLI and MCP operations. Do not authorize source edits or
  optimization from a failed browser flow.

## Capabilities

### New Capabilities

- `durable-browser-probe-recapture`: Executes one supported durable next probe
  against the same exact local browser flow and records bounded provenance.
- `expanded-browser-request-evidence`: Allows a probe-scoped capture to retain a
  larger but fixed async/framework inventory without changing timing accounting.

### Modified Capabilities


## Impact

This affects the local runtime CLI/MCP, Playwright capture and browser-server
normalization, owned local runtime orchestration, evidence contracts, tests, and
performance documentation. It adds no production dependency, cloud call,
source mutation, database migration, or deployment behavior.
