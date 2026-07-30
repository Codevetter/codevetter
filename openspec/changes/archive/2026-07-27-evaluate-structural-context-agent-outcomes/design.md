## Context

CodeVetter's canonical Tree-sitter graph already supports source-backed search,
explain, neighbors, path, and impact operations through both the desktop
workbench and an opt-in MCP sidecar. Review also receives bounded changed-file
neighborhoods, while correctly treating topology as navigation rather than
proof. What is missing is an outcome evaluation: the current graph benchmarks
measure extraction/query correctness and latency, and the current catch-rate
benchmark measures review findings, but neither tests whether a coding agent
with structural context completes tasks more successfully than the same agent
without it.

The first evaluation surface must be useful before the planned 30–50 task
corpus is complete, must not couple CodeVetter to one agent provider, and must
not silently spend model credits. It therefore consumes explicit run receipts
instead of launching agents. A separate runner or manual protocol can produce
those receipts later.

## Goals / Non-Goals

**Goals:**

- Define a versioned, fail-closed manifest for paired A/B and A/A agent runs.
- Prove arm equivalence across task, source, agent/model configuration,
  environment, acceptance contract, and execution policy identities.
- Make executable hidden-check success the primary outcome.
- Report paired wins, losses, ties, regressions, setup failures, and optional
  decision-efficiency diagnostics without inventing missing measurements.
- Gate positive claims behind a predeclared qualification policy and acceptable
  A/A noise.
- Keep reports deterministic, local, provider-neutral, and inexpensive to test.

**Non-Goals:**

- Launching Codex, Claude, or another agent from the benchmark command.
- Adding or redesigning the structural graph UI.
- Changing graph extraction, MCP tools, Review authority, or graph trust.
- Curating the full public task corpus or producing a real improvement claim
  from synthetic/sample receipts.
- Treating files opened, tool calls, tokens, or latency as substitutes for
  executable task success.

## Decisions

### Use a dedicated receipt scorer instead of extending the review benchmark

The existing catch-rate harness compares reviewer findings against labeled
issues. Coding-agent evaluation needs different identities, outcomes, failure
states, and paired analysis. A separate root script keeps the two claims honest
while following the existing dependency-free Node CLI/reporting style.

Alternative considered: add another comparison mode to
`run-catch-rate-benchmark.mjs`. Rejected because a review finding and a completed
software task do not share a valid scoring contract.

### Keep execution outside the scorer

The command reads one explicit JSON experiment manifest containing task
metadata and run receipts. It never invokes an agent, checks out a repository,
or runs hidden tests. This makes scoring reproducible, avoids implicit paid-AI
use, and allows Codex, Claude, local models, or future runners to emit the same
receipt shape.

Alternative considered: embed agent CLI orchestration in the first change.
Rejected because provider/session supervision and credit use would obscure the
measurement contract and materially widen scope.

### Pair on immutable common identities and isolate the context policy

Every pair shares a task identity, repository revision, task packet hash,
hidden-acceptance contract hash, agent/model/configuration identity,
environment identity, and trial index. The treatment records a current
structural snapshot and allowed graph tools/context policy. The control records
that structural context is disabled. A mismatch, missing arm, duplicated arm,
stale treatment snapshot, or graph-tool use in the control makes the pair
invalid rather than approximately comparable.

Execution order is recorded and reported. The harness reports order imbalance
so a later trial protocol can counterbalance treatment-first and control-first
runs without the scorer pretending order was randomized.

### Make hidden executable outcomes primary

A run succeeds only when its execution completed and every required hidden
acceptance check passed. The report also includes acceptance-check pass rate,
regression count, setup/agent/timeout failures, and per-task paired
treatment-only/control-only success.

Optional decision diagnostics include expected-verification selection, files
inspected/modified, graph and non-graph tool calls, tokens, elapsed time, and
cost. Missing optional measurements remain `null`/unreported and cannot improve
qualification.

### Separate descriptive results from qualified claims

Every report contains the raw paired deltas. A positive claim requires a
manifest policy declared before scoring, including minimum complete pairs,
minimum distinct tasks, minimum success-rate improvement, maximum regression
increase, and maximum A/A discordance. When A/A receipts are absent, noisy, or
identity-invalid, A/B output remains descriptive and explicitly unqualified.

The sample fixture exists only to prove the contract and tests. Its report must
state that it is synthetic and cannot establish product value.

### Emit deterministic JSON, Markdown, and self-contained HTML

JSON is the machine-readable authority. Markdown and HTML are rendered from the
same normalized scorecard. Stable task/pair ordering and bounded string/array
sizes make diffs reproducible and prevent an oversized receipt from becoming
an unbounded reporting surface.

The HTML artifact is a read-only comprehension layer, not a new application
surface. It uses semantic HTML, inline CSS, no external assets, no network
requests, and no required JavaScript. Its reading order is:

1. qualification state and exact claim boundary;
2. treatment/control paired outcome corridor;
3. task-level check matrix with wins, losses, and captured graph decision
   traces;
4. A/A noise and optional efficiency diagnostics;
5. experiment identities and limitations.

The view preserves CodeVetter's restrained dark evidence language and remains
legible without color, by keyboard, in print, and at narrow widths.

## Risks / Trade-offs

- **Receipts can be fabricated or misreported** → Bind them to hashes and keep
  real-trial provenance external but explicit; do not call a receipt
  independently verified execution evidence.
- **Agent nondeterminism can swamp the graph effect** → Require repeated paired
  trials, report A/A discordance, preserve execution order, and block positive
  qualification when the noise floor is too high.
- **Hidden-check coverage can encode the wrong task** → Hash and version the
  acceptance contract, report check-level outcomes, and keep human corpus
  adjudication separate from scoring.
- **Efficiency metrics can reward shallow behavior** → Keep executable success
  primary and all efficiency measures secondary.
- **Control runs could obtain graph context through another path** → Record the
  allowed-tool policy and fail closed when control receipts report graph tool
  calls or structural-context injection.
- **A scorer without an executor does not itself prove value** → Label the
  boundary prominently; the next evidence step is to collect real paired runs
  on the curated TypeScript/Node corpus.
- **A visual report could make weak evidence look authoritative** → Lead with
  qualification and non-claim language, keep exact counts beside every visual,
  and derive HTML from the same scorecard as JSON.

## Migration Plan

Add the new command, fixtures, tests, and documentation without changing
existing benchmark formats. Rollback is deletion of those additive files and
package scripts; no database, runtime, or user data migration is involved.

## Open Questions

- Which agent configurations and minimum trial count will be preregistered for
  the first real qualification run?
- Should the first real corpus expose graph tools on demand only, inject a
  compact graph packet automatically, or evaluate those as separate treatment
  policies?
- Which task-level annotations are reliable enough to score file-selection
  precision without overfitting agents to a single expected implementation?
