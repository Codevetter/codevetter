# local-flow-runtime-tools Specification

## Purpose
Give coding agents bounded machine operations that capture and interrogate local application flows using runtime evidence rather than prompt-only profiling instructions.
## Requirements
### Requirement: Exact local flow capture
CodeVetter SHALL capture one exact supported local workload as a root flow without requiring source-code modification, arbitrary shell execution, or a hosted service. The capture result MUST record the adapter, exact target and name, revision identity, capture policy, executions, limitations, and cleanup outcome.

#### Scenario: Agent captures a Node HTTP test
- **WHEN** an agent requests an exact repository-contained Node test through the local flow capture tool
- **THEN** CodeVetter runs only that bounded test scope and returns an opaque capture identifier plus a compact root-flow summary

#### Scenario: Unsupported or incomplete capture
- **WHEN** the exact workload is unsupported, fails, times out, escapes the repository, or produces incomplete required evidence
- **THEN** CodeVetter returns `no_confidence` and MUST NOT create an actionable optimization claim

### Requirement: Recursive flow evidence
CodeVetter SHALL represent a captured workload as recursively related flows with stable capture-local identifiers. Each flow MUST distinguish observed elapsed time from inferred or unaccounted time and MUST cite the runtime evidence that created it.

#### Scenario: Local HTTP client and server activity
- **WHEN** a captured Node workload performs loopback HTTP requests handled in the same diagnostic execution
- **THEN** the result includes bounded client and server child flows with method, normalized route, status, elapsed time, and causal relationships where correlation is supported

#### Scenario: Request-scoped built-in SQLite activity
- **WHEN** an observed Node HTTP handler executes built-in `node:sqlite` statements
- **THEN** each execution is nested beneath that server flow with its operation, normalized value-free statement shape, outcome, and elapsed time

#### Scenario: Same-execution child accounting
- **WHEN** a diagnostic parent and its children have comparable timestamps from the same execution
- **THEN** CodeVetter reports interval-union accounted time and remaining unaccounted time without exceeding the parent duration

#### Scenario: Flow detail is unavailable
- **WHEN** runtime instrumentation cannot account for a portion of root-flow elapsed time
- **THEN** CodeVetter reports the portion as unaccounted or unavailable rather than assigning it to a source location

### Requirement: Progressive machine queries
CodeVetter SHALL expose closed-schema machine operations to capture, inspect, explain, and verify local flows. Query operations MUST accept opaque identifiers returned by prior operations and MUST return bounded structured content without requiring an agent skill to parse raw profile formats.

#### Scenario: Untrained agent inspects a capture
- **WHEN** an MCP client lists tools and calls the inspection operation with a valid capture identifier
- **THEN** the client receives the flow hierarchy, evidence coverage, materiality, and limitations without reading a V8 or pprof artifact

#### Scenario: Unknown identifier or argument
- **WHEN** a client supplies an unknown tool argument, flow identifier, or capture identifier
- **THEN** the tool fails closed with a sanitized bounded error

### Requirement: Evidence, inference, and actionability remain separate
CodeVetter MUST keep direct observations, deterministic interpretations, unverified hypotheses, and verified comparisons separate. A sampled source location SHALL be actionable only when it satisfies the recorded materiality policy and repeats across independent diagnostic profiles or is supported by a compatible deterministic domain metric.

#### Scenario: Low-sample unstable hotspot
- **WHEN** independent diagnostic profiles disagree on the leading source candidate or the candidate is immaterial to the root flow
- **THEN** CodeVetter returns `no_confidence` with the missing evidence and MUST NOT recommend editing that source location

#### Scenario: Stable material candidate
- **WHEN** independent profiles agree on a repository-owned candidate and the candidate passes the recorded sample, duration, and share thresholds
- **THEN** CodeVetter may return an unverified actionable hypothesis with an explicit falsification experiment

#### Scenario: Repeated application function intersects CPU evidence
- **WHEN** bounded V8 coverage records a named repository application function repeatedly and CPU evidence selects the same file/function family
- **THEN** CodeVetter reports a repeated-work hypothesis with both evidence references and an explicit identical-scope verification experiment

#### Scenario: Function frequency lacks timing support
- **WHEN** a repository function executes frequently but does not intersect material CPU evidence
- **THEN** CodeVetter reports observed frequency only and MUST NOT call the function slow or actionable

### Requirement: Identical-scope optimization verification
CodeVetter SHALL compare compatible baseline and candidate captures using identical workload identity and unprofiled measurements. Verification MUST distinguish mechanical improvement from material product impact.

#### Scenario: Agent verifies a candidate change
- **WHEN** an agent captures the same flow before and after one candidate change and requests verification
- **THEN** CodeVetter reports capture identifiers, compatibility, measured movement, statistical limitations, mechanical confirmation, material usefulness, and whether shipping is recommended without embedding either complete source capsule

#### Scenario: Incompatible flows
- **WHEN** the adapter, target, exact name, or required measurement identity differs
- **THEN** verification returns `no_confidence` and MUST NOT confirm the optimization

### Requirement: Local privacy, containment, and cost bounds
CodeVetter MUST redact captured output before normalization, retain no raw profile by default, remove owned temporary artifacts, bound executions and stored captures, and avoid hosted-service or production configuration access.

#### Scenario: Capture completes successfully
- **WHEN** a local capture finishes
- **THEN** raw owned diagnostic artifacts are removed and the result records redaction, truncation, and temporary-artifact retention state

#### Scenario: Runtime flow contains request data
- **WHEN** HTTP instrumentation observes a URL containing query values or variable-looking path segments
- **THEN** CodeVetter omits query values and normalizes sensitive-looking segments before returning or storing the flow

#### Scenario: SQL execution contains application values
- **WHEN** request-scoped SQLite execution uses literals or bound arguments
- **THEN** CodeVetter captures neither arguments nor rows and replaces SQL literals with placeholders before returning or storing the statement shape

#### Scenario: Function coverage capture completes
- **WHEN** the application-frequency diagnostic pass completes
- **THEN** CodeVetter retains only bounded repository-relative function names, source anchors, and counts and removes the raw V8 coverage documents

#### Scenario: Nested Vitest assertion is selected by leaf name
- **WHEN** an agent supplies a leaf test name inside one or more Vitest `describe` blocks
- **THEN** CodeVetter executes exactly one matching assertion, or returns no confidence when the leaf name is absent or ambiguous

#### Scenario: Vitest records transformed TypeScript execution
- **WHEN** the repository-local Vitest V8 coverage provider is available
- **THEN** CodeVetter writes its JSON report only to an owned temporary directory and normalizes positive named functions against original TypeScript locations
