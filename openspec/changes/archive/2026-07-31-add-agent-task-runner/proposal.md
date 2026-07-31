## Why

CodeVetter can now prove that a task fixture fails and its known-good change
passes, but it cannot yet plan or execute a provider-neutral agent attempt
without bypassing the corpus contracts. Issue #53 needs one fail-closed runner
boundary before realistic agent receipts can be collected.

## What Changes

- Add v2 agent-adapter contracts that bind executable artifacts, closed command
  placeholders, declared environment names, timeout, cost posture, and
  conservative token/cost planning inputs.
- Add a closed deterministic dry-run plan that reads no environment values and
  launches neither an agent nor checks.
- Require exact one-attempt launch approval and a second paid-cost approval
  before any adapter process starts.
- Run approved adapters without a shell in a fresh public-input-only workspace,
  capture bounded redacted output, terminate owned process groups on
  timeout/cancellation, and remove the workspace.
- Withhold acceptance checks until the adapter process has terminated, then
  classify exact required/regression evidence into a v2 immutable run receipt.
- Prove the lifecycle with a repository-owned synthetic adapter; do not launch
  a real provider or claim corpus breadth.

## Capabilities

### New Capabilities

- `agent-task-runner`: deterministic planning, approval, disposable execution,
  withheld checks, cancellation, and receipts for one agent-task attempt.

### Modified Capabilities

- `agent-task-corpus-contracts`: add closed v2 adapter, run-plan, and v2
  run-receipt contracts while preserving v1 readers.

## Impact

This adds dependency-free Node scripts, JSON schemas, a synthetic sample
adapter, focused tests, root CLI commands, documentation, and OpenSpec
contracts. It does not add a production dependency, desktop route, provider
integration, model call, network request, deploy, migration, or release.
