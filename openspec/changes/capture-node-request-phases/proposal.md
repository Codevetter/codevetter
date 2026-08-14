## Why

CodeVetter can link browser actions to a local Node request and observe CPU,
child operations, and async waits, but a long framework request can still appear
as one large unaccounted interval. Agents need a bounded step breakdown before
they can decide whether the bottleneck is route resolution, component-tree
construction, client-component loading, application work, or missing evidence.

The unchanged High Signal flow demonstrates the gap: `GET /` took roughly two
seconds while repository CPU was zero and the selected response-linked timer
accounted for less than one percent. Next already emits closed performance
measures for several internal request phases, so an owned local runtime can
capture stronger evidence without application source changes or an OpenTelemetry
backend.

## What Changes

- Enable a fixed private Next performance-measure prefix only in CodeVetter's
  owned config-disabled diagnostic runtime.
- Capture only a closed allowlist of framework phase names under the exact
  request context and preserve their start offset and duration.
- Expose a bounded ordered phase inventory and overlap union beside existing
  server request, async, CPU, and child-operation evidence.
- Add a deterministic phase detector that reports a materially dominant
  framework phase without inventing source attribution or authorizing an edit.
- Prove direct fixture behavior, malformed/private-value rejection, framework
  version absence, and one unchanged real Next product replay.

## Capabilities

### New Capabilities

- `node-request-phase-evidence`: Bounded framework-emitted phase evidence for
  exact CodeVetter-owned local Node requests, including agent-facing diagnosis
  and claim boundaries.

### Modified Capabilities

None.

## Impact

The dependency-free runtime under `scripts/runtime-failure-capsule/`, its
browser-server evidence schema, deterministic performance findings, tests,
OpenSpec artifacts, and local proof documentation change. No application source,
production dependency, environment file, remote collector, production runtime,
database, cloud resource, deployment, or release changes.
