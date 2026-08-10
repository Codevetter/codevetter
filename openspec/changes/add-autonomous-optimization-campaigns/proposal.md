## Why

CodeVetter can capture, diagnose, and compare one optimization attempt, but an
agent still has to manage baselines, candidate history, correctness gates, and
keep/discard decisions by hand. The cross-project trials showed that the next
high-leverage capability is a continuous evidence-governed experiment loop,
not another source-pattern detector.

## What Changes

- Add a versioned optimization-campaign manifest that fixes the mutable source
  boundary, exact correctness and performance scopes, sample policy, resource
  limits, experiment budget, and stop conditions before the loop begins.
- Add a durable append-only experiment ledger that binds every baseline and
  candidate to repository and diff identity, evidence capsules, hypothesis,
  outcome, complexity movement, and keep/discard reason.
- Compose existing correctness execution with paired performance verification
  so a faster but incorrect candidate can never be promoted.
- Separate cheap screening from promotion-quality verification; only stable,
  sufficiently sampled, correctness-preserving improvements can advance the
  incumbent.
- Expose closed CLI and MCP operations for starting, inspecting, evaluating,
  and resuming a campaign. The agent remains responsible for hypotheses and
  source edits.
- Add a small agent program that continuously proposes one bounded change,
  asks CodeVetter to evaluate it, retains or abandons it, and continues until a
  recorded budget or stop condition is reached.
- Qualify the loop first on a hermetic fixture, then on one local external
  project without production traffic or cloud spend.

## Capabilities

### New Capabilities

- `autonomous-optimization-campaigns`: Defines immutable campaign scope,
  candidate evaluation, durable experiment history, promotion policy, bounded
  autonomy, machine operations, and resumability.

### Modified Capabilities

None.

## Impact

- Extends the dependency-free runtime tooling under
  `scripts/runtime-failure-capsule/` and root package scripts.
- Reuses Runtime Failure Capsules, Runtime Performance Capsules, paired
  verification, redaction, Git identity, and verification-receipt contracts.
- Writes only explicit repository-contained campaign artifacts under a bounded
  caller-selected path; it does not mutate application source, invoke an LLM,
  install dependencies, run arbitrary shell commands, or reset Git state.
- Adds no production dependency, database migration, desktop route, hosted
  service, deployment, production capture, or cloud execution.
