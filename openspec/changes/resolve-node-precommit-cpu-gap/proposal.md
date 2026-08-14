## Why

CodeVetter can now prove that a slow Node request spends most of its wall time
before response commitment and can classify process CPU pressure, but a mixed
result still leaves an agent to reconcile request CPU samples, async delay, and
framework phases manually. Failed browser assertions also retain a validated
diagnosis yet are treated as unmeasured by the autonomous laboratory, which
discards the exact evidence the product exists to explain.

## What Changes

- Slice the existing owned V8 request profile at the observed response-commit
  boundary and retain closed main-thread pre-commit sample/time categories.
- Reconcile process CPU, main-thread profile time, response-linked async delay,
  and framework phases into a deterministic next-probe route.
- Distinguish main-thread-heavy, off-main-thread-or-background, async-wait,
  framework-phase, mixed, and insufficient evidence without claiming exclusive
  causation or a source edit.
- Count failed exact Playwright executions with a validated result as completed
  diagnostic coverage while preserving their correctness failure and denying
  optimization authority.
- Surface the selected next probe in browser diagnosis and autonomous lab
  receipts so agents do not need to infer the next measurement manually.

## Capabilities

### New Capabilities

- `node-precommit-probe-routing`: Closed pre-commit evidence reconciliation and
  deterministic next-probe routing for exact local Node browser flows.
- `failed-browser-diagnostic-coverage`: Durable failed-flow diagnosis remains
  available to the autonomous laboratory without becoming performance or
  correctness success.

### Modified Capabilities

None.

## Impact

- Affected code: request CPU normalization, browser-server projection,
  tool-led diagnosis, Playwright diagnosis summaries, performance-flow
  coverage, autonomous laboratory contracts, tests, and performance docs.
- Browser-server, Playwright diagnosis/capture, coverage, and laboratory schemas
  will rev for additive persisted evidence.
- No new dependency, database, production runtime, network, secret, deployment,
  or source-edit capability.
