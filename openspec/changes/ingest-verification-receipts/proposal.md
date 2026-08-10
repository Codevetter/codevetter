## Why

Projects can already run fast, project-specific verification and emit useful
performance evidence, but CodeVetter cannot ingest that evidence, compare it
with a prior run, or explain why a changed file selected a failing test. This
leaves the strongest performance signal outside the core verification loop and
forces agents to interpret bespoke runner output themselves.

## What Changes

- Add a closed, versioned verification-receipt contract for repository,
  revision, environment, selected tests, terminal attempts, failures, resource
  measurements, network safety, and explicit correctness/performance budgets.
- Add deterministic ingestion that preserves the original receipt identity and
  emits a normalized CodeVetter verification bundle without executing tests.
- Compare compatible receipts while distinguishing same-commit evidence from
  cross-commit evidence, and classify performance, correctness, inventory, and
  operational changes independently.
- Emit a bounded blast-radius graph connecting changed files to selection
  reasons, executed tests, and stable failure signatures.
- Expose the same pure ingestion/comparison operations through a JSON CLI and a
  repository-scoped read-only MCP process.
- Qualify the contract with hermetic fixtures plus existing project-runner
  receipts; do not make uncontrolled speedup claims from cross-commit evidence.

## Capabilities

### New Capabilities

- `verification-receipt-comparison`: Defines closed receipt ingestion,
  deterministic normalized bundles, compatible comparisons, independent
  budgets, failure taxonomy, blast-radius evidence, and machine transports.

### Modified Capabilities

None.

## Impact

- Adds dependency-free modules and tests under `scripts/verification-receipts/`
  plus root package scripts for CLI and MCP qualification.
- Reuses existing redaction, stable serialization, Git identity, and bounded
  evidence patterns where compatible; it does not change project runners,
  execute arbitrary commands, modify target repositories, migrate the desktop
  database, or add a production dependency.
- Implements GitHub issue #97 as a machine-first verification layer. Desktop
  visualization remains a later projection over the same bundle.
