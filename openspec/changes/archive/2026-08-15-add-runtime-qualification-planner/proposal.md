## Why

CodeVetter can profile an exact workload once an agent already knows which file and test name to choose, but a portfolio trial showed that runtime detection alone is too permissive: nested manifests and test dependencies can make an application look profile-ready even when the only available work is startup-dominated, network-dependent, or unrelated to the product. Agents need a deterministic, read-only qualification step before they spend time running profilers or make optimization claims.

## What Changes

- Add a bounded repository qualification planner that discovers exact local Node, Vitest, and Go benchmark candidates without executing or installing anything.
- Rank candidates using explicit evidence such as benchmark naming, performance-test naming, package ownership, and supported adapter availability.
- Classify every repository with a machine-readable outcome such as `ready`, `needs_selection`, `no_representative_workload`, or `unsupported`, with limitations instead of fabricated confidence.
- Add a portfolio operation that accepts an explicit manifest of repository roots, qualifies each sequentially, and emits one bounded aggregate report. It does not run cloud, browser, network, database, or production workloads.
- Expose the planner through the runtime CLI and local MCP server so an agent can discover the next safe profiling action before calling the existing performance tools.
- Add a closed `node-script` profiling adapter for standalone local JavaScript benchmarks that do not use a test runner.
- Preserve bounded redacted stdout, stderr, operational errors, and workload-selection evidence when a performance pass fails or bounded runner output cannot be fully parsed.
- Record a real Fleet portfolio qualification artifact and use the gaps it reveals to improve the planner.

## Capabilities

### New Capabilities

- `runtime-qualification-planning`: Deterministic discovery, ranking, safety classification, and bounded portfolio reporting for exact local performance workloads.
- `local-node-script-profiling`: Exact, argument-free profiling for repository-owned standalone JavaScript benchmark files.
- `performance-run-diagnostics`: Bounded failure and selection evidence that lets an agent explain incomplete performance runs.

### Modified Capabilities

None.

## Impact

- Affects the local runtime scripts, CLI, MCP tool definitions, unit tests, and documentation under `scripts/runtime-failure-capsule/`.
- Adds versioned JSON contracts but no production dependency, cloud integration, background process, or source mutation.
- Reads only bounded repository metadata and candidate test files; profiling remains an explicit follow-up operation under the existing runtime performance capsule contract.
