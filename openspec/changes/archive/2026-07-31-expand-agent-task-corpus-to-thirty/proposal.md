## Why

The owned corpus now proves eight behavior categories and both required lanes
and runtimes, but strict readiness remains closed at 8/30 tasks. The next
bounded step is to reach the existing minimum with independently qualified,
hermetic TypeScript/Node tasks rather than weakening the publication gate.

## What Changes

- Add 22 owned tasks across browser and API behavior, preserving the existing
  eight-category coverage and both Node and TypeScript runtimes.
- Qualify every task through two intended baseline failures and two
  regression-free known-good passes.
- Represent one outcome that can be fixed at either of two legitimate
  implementation boundaries without counting those locations as separate
  outcomes.
- Add an intentional decoy/control task whose unrelated lookalike file must
  remain unchanged.
- Update exact corpus identity, counts, reproduction guidance, limitations,
  focused tests, and project status so strict readiness passes at 30 tasks.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-task-corpus-contracts`: Expand the owned corpus to the existing strict
  readiness minimum and define alternate-location and decoy/control coverage.

## Impact

This affects checked-in benchmark task artifacts, qualification receipts,
corpus metadata, focused corpus tests, documentation, and project status. It
adds no dependency, provider call, model launch, UI, hosted service, deploy,
release, production configuration, or external repository content.
