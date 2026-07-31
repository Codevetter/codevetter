## Why

The corpus machinery is complete but currently proves only one synthetic
validation task, so it cannot yet exercise the failure modes or runtime/lane
coverage required by issue #53. A small owned seed cohort is the next
reproducible step before scaling to the 30–50 task publication gate.

## What Changes

- Expand the owned corpus from one to eight qualified tasks covering browser
  state, authorization, API contracts, validation, async/concurrency,
  persistence, integration, and regression behavior.
- Cover both browser and API lanes and both Node and TypeScript runtimes with
  small realistic multi-behavior fixtures.
- Give every task an immutable public packet, baseline fixture, withheld exact
  checks, repeated known-good change, and deterministic qualification receipt.
- Update corpus identity/counts, contribution and reproduction guidance,
  limitations, and project status while keeping publication closed below 30
  qualified tasks.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-task-corpus-contracts`: Establish explicit owned seed-category,
  lane, runtime, qualification, and unpublishable-readiness behavior for the
  in-progress corpus.

## Impact

This affects only checked-in benchmark task artifacts, qualification receipts,
corpus metadata, focused corpus tests, documentation, and project status. It
adds no dependency, provider call, agent launch, UI, hosted service, CI
enforcement, deployment, or production behavior.
