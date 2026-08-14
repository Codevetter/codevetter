## 1. Provenance-safe chaining

- [x] 1.1 Load and integrity-check a completed upstream browser-probe receipt, its linked Playwright receipt, result, exact request, subject, and scope
- [x] 1.2 Derive `inspect_gc_pressure` only from compatible passing lower-overhead evidence and fail closed on route, hash, identity, correctness, or snapshot mismatch
- [x] 1.3 Extend closed CLI and MCP inputs with an optional bounded upstream recapture identity without exposing commands, paths, environment, or instrumentation controls
- [x] 1.4 Persist upstream receipt provenance in fresh inspection, recapture, stability, and schedule artifacts while preserving legacy readers

## 2. Exact-request GC and allocation capture

- [x] 2.1 Add the private `gc_pressure_runtime` owned profile with CPU sampling disabled and request-scoped heap sampling enabled
- [x] 2.2 Start heap sampling before exact dynamic-request dispatch and stop at the earliest response commitment with bounded immutable markers and profiles
- [x] 2.3 Record compatible before/commit heap observations, overlap, response boundary, completion, and observer state without application source changes
- [x] 2.4 Collect private artifacts with fixed size/count/time bounds and reject missing, malformed, oversized, escaping, overlapping, or incomplete evidence

## 3. GC-pressure normalization

- [x] 3.1 Normalize allowlisted GC trace kinds, interval count, union duration, and longest interval without retaining private trace identity
- [x] 3.2 Reuse contained V8 heap-profile parsing to retain bounded sampled allocation candidates and explicit collection scope
- [x] 3.3 Create a closed GC-pressure contract separating trace intervals, heap observations, allocation samples, materiality, source inspection, and edit authority
- [x] 3.4 Route only complete isolated GC activity at the fixed 5 ms floor and existing heap byte/share floors; leave other pressure unresolved

## 4. Browser operations and repetition

- [x] 4.1 Add GC-pressure presentation, inspection, recapture, and exact-request evidence with new schemas and immediate legacy compatibility
- [x] 4.2 Extend stability to compare GC classification plus leading contained allocation identity and emit terminal stable diagnosis rather than a fabricated probe
- [x] 4.3 Extend the bounded sequential scheduler to stop on stable diagnosis, disagreement, incomplete evidence, failed correctness, stale source, or three observations
- [x] 4.4 Keep source inspection low-confidence and edit-ineligible until a separate candidate change passes correctness and paired performance verification

## 5. Verification and proof

- [x] 5.1 Prove GC kind aggregation, interval union, heap boundaries, source containment, fixed floors, and every incomplete/contaminated state with controlled tests
- [x] 5.2 Prove chained inspection/recapture/stability/scheduling, caller-input rejection, legacy receipt loading, tamper detection, local network denial, and cleanup
- [x] 5.3 Run one unchanged current qualified local flow and record usefulness, correctness, observer cost, memory, wall time, retained evidence, and limitations without production claims
- [x] 5.4 Document the agent workflow and run focused tests, full runtime tests, lint, docs, proof JSON, diff, and strict OpenSpec validation
