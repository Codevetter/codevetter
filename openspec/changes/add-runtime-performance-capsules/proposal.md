## Why

CodeVetter currently explains reproduced verification failures, but a real
application can pass while remaining slow, wasteful, or unstable. Coding agents
need bounded runtime evidence that identifies performance regressions and
dominant source operations, then proves whether a change improved them.

## What Changes

- Add a versioned Runtime Performance Capsule for successful or failing exact
  Node/Vitest and Go benchmark scopes.
- Run a closed adapter repeatedly, report robust wall-time distributions, and
  retain bounded CPU or benchmark evidence where the runtime exposes it.
- Compare the current run with an explicitly supplied baseline capsule and
  classify material regressions, improvements, and inconclusive comparisons
  using recorded thresholds.
- Rank repository-owned hotspots and benchmark measurements without treating
  orchestration, dependency, or incomplete profiles as application bottlenecks.
- Add hermetic qualification fixtures plus a read-only App Health trial covering
  Node middleware and Go benchmark workloads.
- Add a bounded local browser-performance evidence lane for a consumer journey,
  a deterministic catalogue-scale lane, and repository-owned Go CPU/allocation
  symbol attribution.
- Add a deterministic self-hosted scale lane so CodeVetter can profile and
  verify improvements to its own runtime-evidence normalization.
- Add one deterministic `diagnose-performance` operation that turns a completed
  capsule into ranked evidence, explicit inferences, falsifiable hypotheses,
  and the next bounded experiment for a coding agent.
- Intersect top runtime locations with bounded repository source windows so
  agents receive evidence-backed expensive patterns instead of hotspot line
  numbers alone.
- Add `verify-optimization` to compare identical before/after workloads using
  domain metrics such as scale curves and Go allocations, while preserving
  correctness and uncertainty gates.
- Keep profiling local and opt-in; do not add production monitoring, arbitrary
  command execution, production browser load, desktop UI, or automatic optimization.

## Capabilities

### New Capabilities

- `runtime-performance-capsules`: Defines bounded exact-scope profiling,
  measurements and hotspots, baseline comparisons, evidence/inference
  separation, redaction, limits, and machine-readable outcomes.

### Modified Capabilities

None.

## Impact

- Extends the dependency-free repository CLI under
  `scripts/runtime-failure-capsule/` with `profile` and
  `diagnose-performance` and `verify-optimization` operations and performance
  schemas while reusing its closed adapters, containment, redaction, and Git
  identity.
- Adds focused tests and root package scripts only; no production dependency,
  database migration, desktop route, deployment, or target-repository source
  change.
- App Health is used only as an external qualification target. Its production
  settings, credentials, deployments, and tracked files remain untouched.
- Significant Hobbies and Anime List remain external qualification targets;
  experiments use loopback or isolated worktrees and do not contact production.
