## Why

CodeVetter's experimental profiler can name sampled source locations, but an agent still needs CLI-specific knowledge and manual source reading to turn those samples into a trustworthy diagnosis. The local HTTP qualification also showed that a low-sample, unstable candidate can be labeled actionable without explaining the request's child operations, so the product needs a machine-native flow boundary before more heuristic patterns are added.

## What Changes

- Add a dependency-free local runtime MCP service whose tools capture, inspect, explain, and compare bounded local flows without relying on an agent skill to parse runtime artifacts.
- Normalize exact Node test and Vitest executions into a recursive flow contract, initially covering the root workload plus local HTTP client and server flows and their causal relationships.
- Correlate request-scoped built-in Node SQLite executions beneath the HTTP server flow, returning normalized statement shapes and same-execution timing breakdowns without SQL values.
- Capture deterministic repository-owned application function counts in a separate V8 coverage pass and join them with CPU evidence to expose repeated work without pretending call frequency is latency.
- Resolve nested Vitest leaf names to exactly one executed assertion and use Vitest's owned V8 report for original TypeScript function counts when the local provider is available.
- Keep timing, flow capture, and CPU profiling in separate executions so instrumentation overhead is disclosed and never used as the performance comparison measurement.
- Require material root-flow impact and repeatable profile attribution before CodeVetter labels a source candidate actionable; otherwise return `no_confidence` with the missing evidence.
- Fix and test the documented package-script invocation contract.
- Qualify the tools against a local HTTP-and-SQLite test in another repository without using hosted services or changing the target repository.

## Capabilities

### New Capabilities

- `local-flow-runtime-tools`: Bounded machine tools and evidence contracts for capturing, querying, explaining, and comparing recursive local application flows.

### Modified Capabilities

- None. The existing runtime performance capsule change remains an experimental dependency rather than an archived main capability.

## Impact

- Extends `scripts/runtime-failure-capsule/` with a transport-independent flow service, Node diagnostic preload, MCP transport, and focused tests.
- Adjusts performance diagnosis actionability rules and the root package invocation scripts/docs.
- Adds no production dependency, hosted service, database migration, desktop surface, production capture, or deploy change.
- The deeper slice remains repository-owned and local-only; generic database libraries, filesystem operations, source rewriting, blanket function tracing, and packaging into the Rust sidecar are intentionally deferred until the request-scoped contract survives cross-project qualification.
