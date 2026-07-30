## Why

CodeVetter already builds a source-backed structural graph, renders it for
humans, and exposes bounded graph queries to agents, but it has no controlled
evidence that this context improves agent decisions or software outcomes.
Before investing further in graph visualization or agent guidance, CodeVetter
needs a reproducible paired evaluation that can distinguish useful structural
context from extra latency, tokens, noise, or false confidence.

## What Changes

- Add a local, provider-neutral paired evaluation harness for comparing the
  same coding-agent configuration on the same pinned task with and without
  CodeVetter structural context.
- Require exact task, repository, agent, model, environment, prompt-policy, and
  graph-snapshot identities so comparisons fail closed when the two arms are
  not equivalent.
- Score primary executable outcomes from hidden acceptance checks and report
  secondary decision-efficiency measures such as files inspected, verification
  commands selected, tool calls, tokens, latency, and cost when captured.
- Emit deterministic JSON and Markdown reports with per-task wins, losses,
  ties, regressions, missing data, and explicit qualification boundaries.
- Emit an optional self-contained HTML report that makes the paired outcome,
  A/A noise, task-level check deltas, and captured agent decision traces
  understandable without weakening the machine-readable scorecard.
- Support A/A control receipts so measurement noise is visible before an A/B
  result is used to claim that structural context helps agents.
- Add hermetic fixtures and focused tests for validation, pairing, scoring,
  reporting, and claim gating.
- Do not add a new graph viewer, parser, production dependency, model call, or
  network path in this change. Real multi-agent trials and broader corpus
  curation remain separate evidence-producing work.

## Capabilities

### New Capabilities

- `structural-context-agent-evaluation`: Defines the paired experiment,
  executable outcome scoring, efficiency diagnostics, A/A controls, and
  evidence-qualified reporting used to determine whether structural context
  improves coding-agent decisions.

### Modified Capabilities

None. The existing structural graph, Review integration, and MCP contracts
remain unchanged; this change measures their value without widening their
authority.

## Impact

- Adds a root-level benchmark command and scorer under `scripts/`.
- Adds versioned local fixtures and documentation under `benchmarks/`.
- Adds focused Node tests and package scripts using the existing pnpm/Node
  toolchain.
- Reads only explicitly supplied benchmark manifests and run receipts; it does
  not mutate target repositories or launch agents automatically.
- The HTML report is an additive local artifact and does not add a desktop
  route or navigation item.
- No Tauri IPC, SQLite schema, MCP protocol, deployment, release, production
  configuration, or dependency changes.
