## Why

The agent-task runner now emits immutable provider-neutral receipts, but the
existing structural-context evaluator still accepts a separate hand-authored
manifest. A deterministic composition boundary is needed so real runner
receipts can become evaluator evidence without copying outcomes, weakening the
scorer, or mixing raw evidence with derived scores.

## What Changes

- Add a closed, versioned evaluation-bundle contract that references raw v2 run
  receipts by safe path and exact SHA-256 identity.
- Project complete paired receipts into the existing structural-context
  evaluator manifest and reject incomplete, mismatched, stale, contaminated,
  misordered, or missing-check evidence before export.
- Emit a separate derived score artifact stamped with scorer version and
  identity, bundle identity, ground-truth identity, projected-manifest identity,
  and raw receipt identities.
- Support deterministic local rescoring from the same immutable receipts
  without launching an agent, executing checks, calling a provider, or mutating
  the raw evidence.
- Document the CLI workflow, trust boundary, limitations, and intentionally
  synthetic test proof.

## Capabilities

### New Capabilities

- `agent-task-receipt-evaluation`: Closed receipt composition, fail-closed
  export, derived-score identity, and deterministic rescoring.

### Modified Capabilities

- `structural-context-agent-evaluation`: Accept projected provider-neutral
  runner evidence while preserving the existing scorer as the sole outcome and
  qualification authority.

## Impact

This affects the local agent-task corpus contracts and CLI, the
structural-context evaluator module boundary, focused tests, benchmark
documentation, package scripts, and `PROJECT_STATUS.md`. It adds no provider or
production dependency, desktop route, hosted service, CI enforcement, agent
launch, or network request.
