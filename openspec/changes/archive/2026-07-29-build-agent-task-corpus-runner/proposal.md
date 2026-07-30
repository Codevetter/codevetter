> Archived 2026-07-29. Active work moved to
> [GitHub issue #53](https://github.com/Codevetter/codevetter/issues/53).

## Why

CodeVetter can score provider-neutral execution receipts, compile reviewed
verification scenarios, and verify changed browser behavior, but it still lacks
the realistic coding-agent task corpus and runner needed to produce credible
outcome evidence. This change is the qualification layer for automatic change
verification; it MUST follow a usable end-to-end `automate-change-verification`
loop rather than displace the owner's immediate goal of eliminating routine
manual test planning and execution.

## What Changes

- Add a versioned corpus of 30–50 reproducible TypeScript/Node web tasks covering
  browser and API behavior, with immutable task packets, hidden acceptance
  checks, known-good solutions, regression checks, and classified failure modes.
- Add a local, provider-neutral runner that prepares isolated task workspaces,
  launches an explicitly configured coding-agent command, withholds hidden
  checks until the agent exits, executes the checks, and emits normalized run
  receipts.
- Add fail-closed corpus qualification so a task is publishable only when its
  baseline fails for the intended reason, its known-good solution passes every
  required check, and repeated setup/check runs are reproducible.
- Emit receipts compatible with the existing structural-context outcome
  evaluator while preserving setup failures, agent failures, timeouts,
  incomplete checks, regressions, and successes as distinct outcomes.
- Make CLI and machine-readable artifacts the primary surface; do not add a
  desktop route, hosted service, CI enforcement, or model-provider dependency.
- Reserve feedback-derived regression creation for a future integration with
  the owner's separate application. Sentry, logs, telemetry, support tickets,
  and observability ingestion are explicitly out of scope.

## Capabilities

### New Capabilities

- `agent-task-corpus-runner`: Defines the immutable task corpus, hidden-check
  isolation, task qualification, provider-neutral execution, normalized
  receipts, and reproducibility gates.

### Modified Capabilities

None. The runner produces inputs for the existing
`structural-context-agent-evaluation` scorer without changing that scorer's
authority or its no-agent-launch contract.

## Impact

- Adds versioned task manifests, fixtures, hidden checks, known-good patches,
  and corpus documentation under `benchmarks/agent-tasks/`.
- Adds bounded local runner and qualification scripts under `scripts/`, plus
  root `pnpm` commands and focused Node tests.
- Reuses the existing structural-context receipt vocabulary and report pipeline.
- Depends on the `automate-change-verification` change for the user-facing
  plan/execute/verdict loop that the corpus will measure.
- Uses the existing pnpm/Node toolchain and operating-system temporary
  directories; no production dependency, Tauri IPC, SQLite schema, MCP
  protocol, network service, deployment, or production configuration changes.
