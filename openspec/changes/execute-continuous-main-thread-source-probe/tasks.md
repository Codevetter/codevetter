## 1. Evidence Contracts

- [x] 1.1 Add a closed continuous-source raw profile contract with startup,
  exact-request, response-commit, stop-tail, overlap, and bounded profile fields
- [x] 1.2 Add a normalized continuous-source summary contract with closed scopes,
  contained candidates, completeness reasons, confidence, and authority fields
- [x] 1.3 Add legacy-compatible browser recapture and stability receipt readers
  before emitting the new probe evidence

## 2. Owned Runtime Capture

- [x] 2.1 Add the private continuous-source owned-runtime diagnostic profile and
  derive its target selector from the inspected durable request
- [x] 2.2 Start the fixed 1 ms main-thread profiler before application warm-up,
  attest startup, and rotate it through a private pre-flow arm after warm-up
- [x] 2.3 Match ordinal, method, and normalized route; stop once at exact response
  commitment; and measure the asynchronous stop tail
- [x] 2.4 Record boundary-aware dynamic-request overlap and fail closed for zero,
  multiple, mismatched, or pre-commit-overlapped targets
- [x] 2.5 Bound private profile bytes, samples, nodes, timing deltas, and cleanup
  without exposing raw identities

## 3. Normalization and Diagnosis

- [x] 3.1 Reconstruct the pre-commit interval from relative profile deltas,
  request duration, and stop tail without comparing absolute clock origins
- [x] 3.2 Classify admitted samples into closed scopes and source-map only
  repository-contained, non-excluded files
- [x] 3.3 Apply the fixed count, sampled-time, and non-idle share candidate floors
  and deterministic ordering
- [x] 3.4 Report explicit invalid, contaminated, incomplete, unresolved, and
  observed states with boundary uncertainty and no edit authority
- [x] 3.5 Cover malformed deltas, excessive stop tails, insufficient duration,
  redirects, excluded paths, arbitrary identity, and bounded candidates in unit
  tests

## 4. Probe Operations

- [x] 4.1 Derive `inspect_continuous_main_thread_source` only from a current,
  integrity-bound, passing, material, unresolved lower-overhead capture
- [x] 4.2 Execute the derived exact flow through the existing browser recapture
  operation without accepting caller-controlled execution values
- [x] 4.3 Project normalized continuous-source evidence through inspection and
  assessment while preserving correctness and authority separation
- [x] 4.4 Extend the bounded scheduler to require three compatible passing
  file-and-line routes and stop immediately on disagreement or unresolved runs
- [x] 4.5 Add CLI/MCP contract tests proving the existing operations accept the
  closed probe and reject mismatched or arbitrary requests

## 5. Product Proof and Verification

- [x] 5.1 Reload immediate legacy runtime and lower-overhead receipts without
  fabricating continuous-source evidence
- [x] 5.2 Run focused preload, normalizer, inspection, recapture, assessment, and
  stability tests after each implementation group
- [x] 5.3 Execute the unchanged exact RolePatch flow locally and retain a redacted
  observation-versus-inference proof without claiming an optimization
- [x] 5.4 Document the probe, its measured overhead and authority limits, and the
  resulting RolePatch route in the canonical performance documentation
- [x] 5.5 Run strict OpenSpec validation, the full runtime-capsule suite, lint,
  docs validation, and repository cleanliness checks
