## Why

Two compatible High Signal recaptures completed the same requested evidence but
selected different next probes because their process-CPU ratios landed on
opposite sides of one fixed threshold. CodeVetter must detect that instability
before an agent spends time following whichever single run looks actionable.

## What Changes

- Add a read-only stability assessment over two to five durable browser-probe
  recaptures.
- Verify each probe receipt, linked Playwright receipt/result digest, source
  snapshot, exact flow, request identity, runtime policy, and evidence outcome.
- Require three compatible repetitions before calling a next probe stable; any
  disagreement is immediately unstable rather than majority-voted away.
- Return bounded next-probe counts and request CPU-ratio observations while
  withholding source-edit and follow-up execution authority for unstable,
  incomplete, failed-correctness, stale, incompatible, or tampered evidence.
- Expose equivalent read-only CLI and MCP operations.

## Capabilities

### New Capabilities

- `browser-probe-stability-assessment`: Validates compatible recapture evidence
  and decides whether a next-probe route is stable enough to follow.

### Modified Capabilities


## Impact

This affects local durable browser-probe loading, runtime CLI/MCP definitions,
tests, proof artifacts, and performance documentation. It executes no
application code, adds no dependency, and performs no production or cloud work.
