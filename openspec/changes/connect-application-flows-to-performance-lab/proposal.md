## Why

Agents can run profilers themselves, but CodeVetter only becomes a product if it
selects an existing application flow, captures bounded evidence, identifies a
source-bounded experiment, and verifies both performance and correctness. The
current implementation grew through many narrow changes and exposes more
contracts than the demonstrated workflow needs.

## What Changes

- Consolidate local React/Node and Go profiling behind one autonomous lab loop.
- Ship that loop through the existing bundled `codevetter` CLI instead of
  requiring agents to run a private source-checkout package script.
- Let a new laboratory run continue from a snapshot-bound candidate receipt,
  remeasure the same exact flow after an agent edit, and return a conservative
  screening decision before requiring independent paired verification.
- When the caller supplies a separate exact incumbent checkout and one bounded
  correctness scope, let that continuation finish the paired acceptance
  decision and retain its evidence without editing either checkout.
- Let a snapshot-bound repository-root performance-flow contract bind an exact discovered
  flow to its exact correctness test so an incumbent-only continuation can
  finish acceptance without reconstructing test flags.
- Project a completed accepted laboratory run into automatic code review only
  after revalidating its receipt, paired-artifact digest, current source
  snapshot, correctness binding, and changed-file relevance.
- When that accepted source has changed but its repository-owned binding and
  evidence remain intact, rerun the one exact correctness test before review
  while keeping the historical performance claim excluded as stale.
- After that exact current correctness test passes, characterize the same
  repository-owned performance flow within a fixed review budget and give the
  reviewer current observations and bounded bottleneck inference without
  inventing an improvement or regression claim.
- When a material review screen has a clean same-revision predecessor, let
  CodeVetter synthesize that incumbent from local Git objects, run correctness
  on both roots, and finish interleaved paired acceptance without asking the
  agent to prepare another checkout.
- When automatic pairing is unavailable, return bounded blocker categories and
  one safe next action so the agent can establish evaluator authority instead
  of reverse-engineering a terse no-confidence code.
- For React and other JavaScript/TypeScript products, reuse an already-installed
  project-owned Knip analyzer to expose bounded dead-code candidates, while
  keeping static reachability separate from a verified safe-removal claim.
- Reuse an already-installed project-owned jscpd analyzer to expose bounded
  duplicate implementation fragments without retaining source text or treating
  token similarity as semantic equivalence.
- Rank static redundancy candidates by exact active-diff intersection so agents
  can inspect newly introduced redundancy before unchanged repository debt.
- Reuse exact Playwright journeys in a separate diagnostic pass to capture
  bounded React commit and component-activity evidence without modifying source
  or contaminating the authoritative timing run.
- Deliver React evidence to the owned Playwright worker during the document
  lifetime so Next.js navigation or teardown cannot erase already-observed
  commits, while retaining a closed lifecycle diagnostic when delivery fails.
- Normalize bounded Playwright HAR size evidence into an exact-flow loading
  summary so agents can see costly local resources and repository-owned Vite
  modules without confusing development-server bytes with production bundles.
- Preserve a bounded Playwright action timeline so agents can inspect which
  navigation, interaction, input, or wait window coincided with loading and
  long-task evidence without treating temporal overlap as causality.
- Correlate an exact Playwright capture with requests handled by a CodeVetter-owned
  local Next runtime and bounded child SQLite or loopback HTTP operations, while
  leaving non-owned, Vite-only, secret-dependent, and Go runtimes explicitly
  unavailable instead of inferring server work from browser timing.
- Resolve a uniquely matching static Next App Router or Pages Router file for a
  normalized server route so an agent has a review starting point, while
  keeping static ownership distinct from the executed handler or residual-time
  cause.
- Sample bounded V8 CPU work inside isolated captured Next requests and retain
  only repository-contained source candidates, while rejecting overlapping,
  generated, dependency, malformed, or weak profiles as optimization evidence.
- Observe bounded callback delay for supported async resources created inside a
  captured Next request, without equating context propagation or temporal
  overlap with an awaited dependency or critical-path cause.
- Preserve the contained application callsite for common promise-based Node
  async creators whose internal resource initialization would otherwise erase
  the public API caller, while keeping framework-owned work unattributed.
- Trace a bounded internal async/promise lineage from supported callbacks to
  the execution context that calls `response.end`, so agents can distinguish a
  response-completion dependency from unrelated request-context work without
  exposing raw async identities or claiming exclusive critical-path time.
- Discover existing tests, benchmarks, and Playwright journeys without inventing workloads.
- Measure exact workloads, separate observations from hypotheses, and return one
  source-bounded candidate with its durable baseline before an agent reads source.
- Verify candidate changes with paired measurements and project-owned
  correctness evidence; retain T-Rex as supplemental browser authority.
- Extend the existing paired verifier to exact Playwright flows so React
  changes are accepted or rejected using application-flow time, renderer work,
  process memory, post-GC heap, and repeatable sampled-live retention evidence.
- Preserve statically declared Playwright project/device identity through
  qualification, owned capture, paired verification, and campaign acceptance.
- Resolve the common bounded Playwright pattern where a loopback `baseURL`
  template references one environment-backed numeric port fallback, without
  evaluating configuration or trusting the caller environment.
- Preserve an unrelated declared-port listener by leasing a same-host ephemeral
  port only for a config-disabled owned browser runtime, while retaining
  attestation and cleanup as hard evidence gates.
- Resolve bounded named literal project arrays, static per-project ignore
  filters, and explicit device overrides so real-world Playwright matrices do
  not collapse into an unresolved generic profile.
- Own a bounded config-disabled Next development runtime for eligible clean
  repositories instead of requiring an agent-prepared local listener.
- Profile an agent's stable dirty working tree by binding every run to a
  revision-plus-content snapshot instead of requiring artificial clean worktrees.
- Prefer a bounded directly sampled allocation source with a concrete static
  source pattern over a broader higher-share caller when that makes the first
  experiment mechanically testable.
- Let an agent carry bounded rejected finding IDs into a later lab run so the
  flywheel advances to the next already-captured candidate instead of repeating
  a disproven experiment.
- Treat a flow whose eligible findings are all excluded as measured for the
  current lab policy so the same run can continue through other safe flows.
- Give source-bounded findings an opaque snapshot-bound candidate key so one
  explicit skip can suppress the same source and mechanism across exact flows.
- Make V8 sampled-allocation verdicts conservative across the complete paired
  run ranges so short-process sampling noise cannot override clear timing data.
- Bind cross-flow candidate identity to the bounded selected function body, not
  the whole repository snapshot, so unrelated accepted edits do not resurrect it.
- Return a compact main-thread phase breakdown even when a browser flow has no
  source candidate, so an agent can distinguish cheap rendering from missing attribution.
- Permit one already-qualified exact direct benchmark to run when broad inventory
  discovery is truncated, while preserving the incomplete-coverage boundary.
- Keep local-only claims, execution budgets, redaction, and explicit unsupported boundaries.
- Remove overlapping commands, reports, contracts, and planning artifacts that
  do not directly support the loop.

## Scope

In scope: chosen React/Node and Go repositories, Vitest/Jest/Node/Playwright/Go
workloads, loopback browser capture, CPU/allocation/network/process-memory and React
commit evidence, source maps, project-owned read-only static redundancy evidence, experiment provenance,
and deterministic verification.

Out of scope: production traffic, cloud execution, synthetic workload claims,
arbitrary commands, source mutation by CodeVetter, Python/Rust adapters, and UI.
Repository Next configuration, environment files, production builds, and
configuration-dependent production equivalence remain out of scope.
Snapshotting secret-like paths, unbounded changes, or repositories changing
during qualification/execution remains out of scope and fails closed.

## Impact

The dependency-free runtime tooling under `scripts/runtime-failure-capsule/`,
its CLI/MCP projection, the shipped Rust CLI bridge, the desktop review prompt,
and Tauri resources change.
The shipped read-only history MCP remains read-only. The bridge requires a local
Node executable and fails closed when the runtime resource is unavailable. No
production dependency, migration, deployment, credential access, or cloud cost
is introduced.
