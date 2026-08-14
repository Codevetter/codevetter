## 1. Snapshot Contract

- [x] 1.1 Extend the clean Git materializer with bounded path-free dependency-graft provenance and terminal cleanup reporting
- [x] 1.2 Add adversarial unit coverage for dirty identity, sensitive paths, workspace links, graft drift, source mutation, and cleanup failure

## 2. Dual-Root Browser Runtime

- [x] 2.1 Introduce a private validated browser execution context separating authority, execution, dependencies, and evidence
- [x] 2.2 Update owned Vite/Next runtime startup to qualify the authoritative root while executing only the isolated root
- [x] 2.3 Resolve Next and Playwright runtime executables only from the attested dependency root
- [x] 2.4 Preserve environment-file blocking on the execution package root and source-relative server profiling against the isolated tree
- [x] 2.5 Add focused runtime tests for root containment, environment exclusion, executable escape, and unchanged normal behavior

## 3. Dual-Root Playwright Capture

- [x] 3.1 Store durable browser evidence under the authoritative checkout while executing exact test source from the isolated tree
- [x] 3.2 Bind receipts to unchanged authoritative Git identity plus clean-snapshot and dependency-graft provenance
- [x] 3.3 Use the isolated tree for test config, process cwd, source maps, React attribution, memory passes, and trace diagnosis
- [x] 3.4 Add focused capture tests proving source drift and snapshot mutation invalidate the result

## 4. Autonomous Fallback

- [x] 4.1 Add an automatic clean-snapshot fallback only for eligible `environment_blocked` Next.js browser flows
- [x] 4.2 Ensure runtime stop, snapshot verification, and disposal complete before accepting a measurement
- [x] 4.3 Preserve current terminal behavior for dirty repositories and every non-environment runtime failure
- [x] 4.4 Add performance-lab tests for successful fallback, refusal, cleanup failure, and no application launch on unsafe inputs

## 5. Product Proof

- [x] 5.1 Run the focused materializer, runtime, capture, and performance-lab test suites
- [x] 5.2 Capture one real RolePatch browser flow without reading or copying ignored environment files and preserve a proof artifact
- [x] 5.3 Follow the emitted browser probe continuation until stable, correctness-blocked, or a truthful terminal boundary, and normalize any legacy unexecutable probe alias discovered by the proof
- [x] 5.4 Document eligibility, provenance, limitations, storage behavior, and the unchanged 19-tool agent surface
- [x] 5.5 Run strict OpenSpec validation, docs validation, full runtime tests, and lint
