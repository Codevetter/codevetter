## 1. Runtime Trace Capture

- [x] 1.1 Configure the owned Node launch with a contained trace-file pattern and fixed request-scoped trace support without enabling process-lifetime tracing
- [x] 1.2 Enable tracing immediately before selected request dispatch, disable it at first response commitment, and write a bounded private monotonic interval marker
- [x] 1.3 Cover isolated, overlapping, unsupported, and failed trace-capture behavior with focused runtime tests

## 2. Native Activity Evidence

- [x] 2.1 Add a bounded live-partial trace parser that admits only complete event objects and fails closed on malformed, oversized, escaping, or truncated evidence
- [x] 2.2 Pair, clip, classify, and union allowlisted libuv worker and V8 activity intervals while discarding private trace fields
- [x] 2.3 Join the normalized native-activity summary to the exact browser-server request and increment the evidence schema
- [x] 2.4 Cover positive, zero, unpaired, contaminated, incompatible, and privacy-boundary normalization cases with controlled tests

## 3. Deterministic Diagnosis

- [x] 3.1 Route material exact other-thread CPU with compatible libuv activity to a mechanism-specific next probe
- [x] 3.2 Distinguish complete zero activity from unsupported, incomplete, contaminated, invalid, and interval-incompatible evidence
- [x] 3.3 Preserve activity-versus-CPU language, source-null low-confidence edit ineligibility, and failed-correctness precedence
- [x] 3.4 Cover every native-aware route and authority boundary with deterministic diagnosis tests

## 4. Product Proof

- [x] 4.1 Replay an unchanged real browser flow and save a compact proof artifact showing joined native activity and the durable diagnosis
- [x] 4.2 Document the native-activity contract, observer effect, limitations, and agent-facing interpretation
- [x] 4.3 Run focused checks, full unit tests, lint, documentation validation, and strict OpenSpec validation
