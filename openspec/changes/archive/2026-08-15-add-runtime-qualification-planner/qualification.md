## Qualification summary

Qualified the 27 unique maintained repository paths in Fleet's canonical project catalog on 2026-08-09. The run was sequential and read-only: no dependency install, browser launch, service start, cloud call, database connection, source edit outside CodeVetter, or production operation was performed.

The first pass exposed false readiness from names such as `performance`, `memory`, and `perfect`. Readiness now requires an explicit Go benchmark or direct timing evidence; file and test names alone remain ranked candidates. A second pass exposed standalone benchmark scripts that the test-only adapters could not execute. The added closed `node-script` adapter accepts argument-free repository-owned JavaScript entrypoints, while local-service, browser, database, and required-argument signals block automatic execution.

Final planner result:

- `ready`: 1
- `needs_selection`: 21
- `no_representative_workload`: 5
- `unsupported`: 0
- `inaccessible`: 0

`unsupported: 0` means every repository contains some bounded Node or Go lane evidence. It does not mean every product stack is supported; for example, Pace's Swift application has nested Node metadata but no representative local workload, so it remains `no_representative_workload`.

## Complete portfolio matrix

| Repository | Qualification | Selected evidence or gap |
| --- | --- | --- |
| codevetter | needs_selection | Multiple runtime-tool tests and a local-service MCP benchmark; no unique automatic choice |
| pace | no_representative_workload | Nested Node metadata, no exact local performance workload |
| posttrainllm | ready, then operationally incomplete | `node-script` `tests/bench_wasm.mjs` |
| fleet-workspace | no_representative_workload | No exact supported performance workload in the canonical Foundry operations checkout |
| drank | needs_selection | Generic Vitest scopes only |
| email-manager | needs_selection | Generic Vitest scopes only |
| chatgpt-memory-insights | needs_selection | `performance.test.ts` tests telemetry calculations, not application throughput |
| free-ai | needs_selection | Benchmark-named optimizer API tests include network/service signals |
| psi-swarm | needs_selection | Metrics semantics tests, no direct benchmark evidence |
| high-signal | needs_selection | Generic and performance-domain tests, no direct measurement evidence |
| research-papers | needs_selection | Web-health scope has remote-network evidence |
| knowledge-base | needs_selection | RAG script requires arguments and a local service |
| significanthobbies | needs_selection | Generic Vitest scopes; prior manually selected recommendation workload remains valid but is not automatically inferred |
| india-standards | needs_selection | Serving-cube benchmark requires a DuckDB fixture and caller arguments |
| anime-list | needs_selection | Generic Vitest scopes; prior manually selected recommendation workload remains valid but is not automatically inferred |
| chess | no_representative_workload | Browser lane only for current performance support |
| looptv | needs_selection | Generic Vitest scopes only |
| reader | needs_selection | Generic Vitest scopes only |
| swe-interview-prep | needs_selection | Generic Vitest scopes only |
| calorie | needs_selection | Generic Vitest scopes only |
| setline | needs_selection | Generic Node test scopes only |
| rolepatch | needs_selection | Generic Vitest scopes with database signals |
| karte | needs_selection | Generic Vitest scopes only |
| starboard | needs_selection | Explicit 1,000-repository sync guard, but no direct timing evidence |
| app-health | needs_selection | Multiple exact Go and Node benchmarks require an agent choice |
| motion | no_representative_workload | No exact supported local performance workload |
| what-it-takes-to-win | no_representative_workload | No exact supported local performance workload |

## Executed local trials

### App Health route normalization

CodeVetter selected the exact Go benchmark `BenchmarkNormalizeRouteTemplate` after an agent resolved the multiple-benchmark ambiguity.

- Median: 403 ns/op across three samples
- Allocation: 144 B/op and 2 allocs/op
- Variation: 0.769% for ns/op
- Strongest repository allocation path: `packages/go/normalize.go:25`, `strings.Split`, with 69.25% cumulative allocation share
- Verdict: `actionable`

This is an optimization candidate, not an implemented improvement. The App Health checkout was already dirty and was not edited.

### Starboard 1,000-repository sync guard

The exact Vitest scope completed with a 345 ms process median, but its assertion represented only 0.281% of wall time. No repository source samples were captured.

- Verdict: `needs_better_workload`
- Correct next action: batch the same operation until product execution is material
- No Starboard bottleneck was attributed

### CodeVetter self-profile

The existing function-coverage normalization workload completed with 87–90 ms process samples. Independent profiles selected repository source but did not cross the recorded repeatability/materiality threshold after the earlier optimization.

- Verdict: `no_confidence`
- No new CodeVetter optimization claim was made

### App Health Vitest compatibility

The Node benchmark trial exposed two failures that the prior capsule did not explain: one measurement ended with `socket hang up`, and profiling under Vitest 3.2.7 rejected `--execArgv`. CodeVetter now retains bounded redacted failure evidence, uses inherited `NODE_OPTIONS` for V8 profiling, and accepts repeated successful Vitest runs when one bounded pass confirms the exact selection.

A stable exact Vitest test then completed all six measurement, metrics, and profile passes under Vitest 3.2.7 and produced two V8 profiles. The tiny scope contained no material application source samples, so it was correctly reported as profiled with attribution limitations rather than as an optimization.

### PostTrainLLM WASM benchmark

The new `node-script` adapter correctly selected `tests/bench_wasm.mjs`. A direct local run reported:

- small: 108.6 ms/step, 9,432 tok/s
- medium: 377.0 ms/step, 4,075 tok/s

Execution ended before the declared large and XL cases completed, and repeated CodeVetter wrapper runs produced no final capsule. No performance diagnosis is claimed. This exposes the next architecture gap: resource-intensive workloads need an outer supervisor that can persist a crash or kill receipt even when the profiling process itself does not survive.

## Product improvements proven by the trial

1. Versioned repository and portfolio qualification contracts.
2. Sequential 64-repository bound with path-free aggregate output.
3. Package-scoped candidate identity, score evidence, safety flags, and conservative statuses.
4. Read-only CLI operations and `qualify_runtime_repository` MCP operation.
5. Exact standalone `node-script` profiling without shell or arbitrary arguments.
6. Vitest 3.2.7 profiling compatibility through `NODE_OPTIONS`.
7. Bounded redacted failure output and per-pass workload-selection evidence.
8. Truncated Vitest JSON no longer erases an exact selection confirmed by another successful fixed-command pass.

## Remaining gaps

- An outer supervisor must survive target or profiler resource termination and persist a final operational receipt.
- `needs_selection` still requires agent judgment; explicit operator hints can be added later without weakening default safety.
- Standalone scripts that require fixtures or arguments need a closed versioned fixture/argument contract, not arbitrary CLI passthrough.
- Five maintained repositories need representative local workloads before CodeVetter can profile them honestly.
- Correctness authority remains project-owned. Qualification and profiling do not prove that a performance candidate preserves all behavior.
