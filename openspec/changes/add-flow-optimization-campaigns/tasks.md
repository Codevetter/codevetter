## 1. Planner Contracts

- [x] 1.1 Add closed flow-priority manifest loading, validation, and contained-path checks.
- [x] 1.2 Add a versioned flow-campaign plan contract with deterministic ranking and next-action validation.

## 2. Discovery and Screening

- [x] 2.1 Reuse runtime qualification to build a bounded safe performance-flow inventory with explicit exclusions.
- [x] 2.2 Screen eligible flows sequentially through existing performance capture and diagnosis operations.
- [x] 2.3 Extract comparable supported-scale cost, apply product weights, and return one deterministic campaign handoff.

## 3. Machine Operations

- [x] 3.1 Add a closed `plan-flow-campaign` CLI operation with bounded sample, warmup, timeout, flow-count, and optional priority-manifest inputs.
- [x] 3.2 Add the equivalent repository-scoped MCP tool and reject unknown arguments before execution.

## 4. Verification and Qualification

- [x] 4.1 Add unit and integration coverage for discovery, exclusions, weights, ranking, already-fast guardrails, inadequate evidence, CLI, and MCP behavior.
- [x] 4.2 Document the local flow-campaign workflow and validate OpenSpec, docs, formatting, and the runtime suite.
- [x] 4.3 Run the planner on at least one real local Fleet product without network or cloud activity and record observed limitations.
- [x] 4.4 Keep URL fixture data eligible while actual remote network invocations remain excluded.
