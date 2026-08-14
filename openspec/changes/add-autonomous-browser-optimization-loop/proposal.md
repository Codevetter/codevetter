## Why

CodeVetter can autonomously measure one candidate and protect the keep/discard
decision, but it stops as soon as it finds any eligible source hotspot. The
Anime List trial showed that this depth-first policy can miss the largest
initial-flow optimization: the winning defect lived in the production bundle
configuration, while the laboratory first selected an unrelated Vitest
allocation candidate and its config-disabled Vite runtime could not observe the
production chunk graph.

CodeVetter should gather the bounded evidence for one user flow before asking an
agent to edit source, turn that evidence into a ranked experiment queue, and
drive the existing correctness-first campaign until the budget or plateau is
exhausted.

## What Changes

- Add a flow-first planning operation that gathers all already-safe runtime,
  React, loading, memory, and static dependency evidence for one exact local
  browser flow instead of stopping at the first finding.
- Reuse CodeVetter's review-evidence selector so diff relevance, accepted local
  evidence, and repository-owned correctness bindings travel with matching
  experiments.
- Add bounded initial-route dependency attribution that explains which source
  import or bundler rule placed a dependency in the route graph, separating
  observed graph membership from inferred optimization hypotheses.
- Produce a ranked, deduplicated experiment queue with predicted metric,
  allowed source boundary, confidence, required verifier, and rejection rule.
- Extend the existing optimization campaign protocol so an external coding
  agent can request the next experiment, apply one bounded patch, and let
  CodeVetter automatically screen, reject or promote, restore the incumbent
  through host-owned recoverable checkout isolation, and continue.
- Record rejected hypotheses and evidence coverage so later iterations do not
  repeat failed work and the final report explains both wins and exhausted
  areas.
- Keep source mutation outside the CodeVetter process: CodeVetter owns planning,
  evidence, policy, and decisions; the connected coding agent owns patch
  generation within the returned file boundary.

## Capabilities

### New Capabilities

- `autonomous-browser-optimization-loop`: Defines flow-first evidence
  collection, initial-route dependency attribution, ranked experiments, and the
  bounded agent/CodeVetter iteration protocol.

### Modified Capabilities

None.

## Impact

- Extends the dependency-free runtime tooling under
  `scripts/runtime-failure-capsule/`, its CLI/MCP projections, and deterministic
  test fixtures.
- Reuses qualified Playwright capture, React attribution, loading evidence,
  campaign ledgers, paired verification, redaction, and source snapshot
  identity.
- Adds no production dependency, cloud execution, production traffic, arbitrary
  shell command, automatic package installation, desktop UI, or deployment.
- The first implementation targets local Vite React applications; other
  bundlers remain explicit coverage gaps until separately qualified.
