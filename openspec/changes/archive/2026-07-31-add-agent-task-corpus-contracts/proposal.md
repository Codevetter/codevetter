## Why

CodeVetter cannot build or compare a realistic coding-agent corpus until every
task and future run has a stable, fail-closed identity. Issue #53 needs a small
foundation that can reject unsafe or drifting task packages before any
qualification checks or model-backed execution exist.

## What Changes

- Add closed, versioned contracts for task manifests, corpus indexes, check
  results, qualification receipts, agent adapters, and run receipts.
- Add canonical SHA-256 helpers and a deterministic validator for task packets,
  corpus ordering, artifact paths, immutable references, provenance, license
  metadata, bounds, duplicate IDs, and hash drift.
- Add non-strict validation and strict readiness commands with matching human
  and JSON evidence. Strict readiness remains closed until 30–50 qualified
  TypeScript/Node tasks cover browser and API lanes and six failure categories.
- Add a minimal owned sample package that proves the contract without claiming
  task qualification, agent execution, or publishable corpus readiness.
- Keep task qualification, disposable workspaces, agent launching, withheld
  checks, scorer projection, and corpus expansion as later issue #53 slices.

## Capabilities

### New Capabilities

- `agent-task-corpus-contracts`: Defines immutable task/corpus identities,
  closed machine contracts, fail-closed validation, and the distinction between
  structurally valid in-progress corpora and publishable readiness.

### Modified Capabilities

None.

## Impact

- Adds contract and validation code under `scripts/agent-task-corpus/`.
- Adds an intentionally incomplete sample corpus under
  `benchmarks/agent-tasks/`.
- Adds root `pnpm` commands, focused Node tests, and operator documentation.
- Adds no runtime dependency, model/provider integration, desktop route,
  network access, production configuration, or deployment behavior.
