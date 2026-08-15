## Why

CodeVetter can profile one exact workload and govern one optimization campaign,
but an agent still has to inspect a repository, choose a flow, and decide whether
its absolute cost is worth optimizing. The latest Fleet trials showed that this
selection step is now the bottleneck: a visible CPU hotspot may represent an
86% opportunity or an already-cheap 0.013 ms operation.

## What Changes

- Add a repository-scoped flow-campaign planner that discovers safe exact
  performance workloads through the existing qualification engine.
- Screen a bounded number of discovered workloads with existing performance
  capsules and deterministic diagnoses.
- Rank actionable flows using measured supported-scale cost multiplied by
  explicit frequency and user-impact weights, while keeping missing weights
  visible instead of inventing production knowledge.
- Return one machine-readable next action that either starts an existing
  optimization campaign for the highest-value flow, improves an inadequate
  workload, or moves to another repository when every measured flow is already
  cheap.
- Expose the planner through closed CLI and MCP operations and retain no raw
  profiles, production traffic, credentials, or cloud state.

## Capabilities

### New Capabilities

- `flow-optimization-campaigns`: Discovers, screens, prioritizes, and hands one
  local repository flow to the existing evidence-governed optimization loop.

### Modified Capabilities

None.

## Impact

- Extends the dependency-free runtime tooling under
  `scripts/runtime-failure-capsule/` and the root runtime CLI/MCP scripts.
- Reuses runtime qualification, performance supervision, diagnosis, redaction,
  source identity, and autonomous optimization campaign contracts.
- Adds a versioned optional repository-contained priority manifest for
  frequency and user-impact knowledge; absent values default to neutral and
  are reported as limitations.
- Adds no production dependency, desktop route, database migration, network
  capture, deployment, model call, or source-editing authority.
