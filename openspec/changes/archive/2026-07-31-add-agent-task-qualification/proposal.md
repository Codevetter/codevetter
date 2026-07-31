## Why

CodeVetter can now prove that task packages are structurally valid, but it
cannot prove that a baseline fails for the intended reason or that the
known-good change passes without regressions. Issue #53 needs that qualification
authority before any task can count toward corpus readiness or any agent is
launched.

## What Changes

- Add closed fixture-bundle, acceptance-contract, and known-good change
  contracts that extend the existing immutable task identity chain.
- Prepare fresh owned temporary workspaces containing only bounded public
  fixture files and the public task packet.
- Run an exact shell-free check driver outside the workspace under timeout and
  require one closed result for every declared required and regression check.
- Repeat clean baseline checks and require at least one declared task-defining
  failure while preserving wrong failure, check error, incomplete inventory,
  timeout, and flaky outcomes distinctly.
- Apply the exact known-good change in fresh workspaces and require repeated
  complete acceptance and regression success.
- Emit a deterministic qualification receipt, qualify the owned sample through
  the real path, and keep strict corpus readiness closed below its breadth gate.
- Add no agent/model launch, provider adapter execution, scorer projection,
  network access, desktop route, or production behavior.

## Capabilities

### New Capabilities

- `agent-task-qualification`: Defines safe public-input workspace preparation,
  closed check execution, repeated baseline/known-good proof, exact outcome
  classification, cleanup, and deterministic qualification receipts.

### Modified Capabilities

- `agent-task-corpus-contracts`: Extends the closed contract surface and task
  artifact validation to the fixture, acceptance, and known-good change
  documents consumed by qualification.

## Impact

- Extends `benchmarks/agent-tasks/contracts/` and the owned sample task.
- Adds qualification implementation and tests under
  `scripts/agent-task-corpus/`, plus one root `pnpm` command.
- Updates corpus authoring/CI documentation and durable project status.
- Adds no package dependency, Tauri/SQLite/API change, credential access,
  deployment, release, or production configuration.
