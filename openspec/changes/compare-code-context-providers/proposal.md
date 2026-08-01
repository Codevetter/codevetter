## Why

Code-context products make overlapping claims about helping coding agents, but
CodeVetter has no reproducible evidence that its graph—or any competing
provider—improves executable task outcomes. The qualified 30-task corpus,
provider-neutral runner, immutable receipts, and structural-context scorer now
make a bounded comparison possible without treating token savings, attractive
documentation, or model opinion as success.

## What Changes

- Add a preregistered context-provider experiment that compares one no-special-
  context baseline with eligible agent-readable provider configurations while
  keeping task, agent, model, prompt, environment, revision, and trial identity
  fixed.
- Qualify provider eligibility through an explicit capability probe covering
  machine-readable access, exact version/configuration identity, snapshot
  freshness, bounded setup, tool-call observability, privacy, and repeatability.
- Reuse the existing agent-task runner and structural-context scorer; add only
  the provider identity, isolation, scheduling, and cross-provider aggregation
  needed for a deterministic multi-arm report.
- Run a free/local feasibility stage before any full-corpus or paid/hosted
  trial. Full trials require an exact cost/attempt plan and explicit approval.
- Treat executable hidden checks and preserved regressions as the primary
  outcome. Report setup success, invalid/contaminated trials, relevant-file
  recall where ground truth exists, files inspected/modified, tool calls,
  latency, tokens, and cost only as diagnostics.
- Keep human-wiki and enterprise products out of the first cohort unless they
  expose a reproducible agent-readable CLI, API, or MCP interface. Keep generic
  storage engines out of scope because they are building blocks rather than
  comparable context providers.
- Publish no winner or product-value claim from synthetic fixtures, incomplete
  arms, stale indexes, contaminated controls, unqualified A/A noise, or a
  feasibility-only run.

## Capabilities

### New Capabilities

- `context-provider-comparison`: Defines provider eligibility, immutable
  multi-arm experiment identity, isolation, deterministic scheduling, outcome
  authority, reporting, and staged claim gates for code-context comparisons.

### Modified Capabilities

- None. Existing agent-task receipt evaluation and structural-context scoring
  remain authoritative and backward-compatible; the new capability composes
  them without weakening their contracts.

## Impact

- Extends `benchmarks/agent-tasks` experiment metadata and adapter fixtures.
- Adds bounded orchestration/reporting beside
  `scripts/agent-task-corpus/` and `benchmarks/structural-context/`.
- Reuses the 30-task corpus, v2 run receipts, evaluation bundles, hidden checks,
  and current structural-context score rather than introducing a second runner
  or grader.
- May invoke separately installed local or hosted provider interfaces only
  during explicitly approved trials; no provider becomes a production
  dependency and no credentials or provider data enter committed artifacts.
- Operationally advances GitHub issue #55. It does not publish results, run a
  paid provider, alter the desktop UI, or create an enterprise integration.
