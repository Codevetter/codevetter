# Tasks: Scaled parsing challenge

## 1. Challenge Contract

- [x] 1.1 Add deterministic temperature-row generation with fixed station and signed decimal value semantics
- [x] 1.2 Add exact aggregate and stable digest assertions independent of timing
- [x] 1.3 Add at least three fixed input sizes spanning 40x and emit existing console scale metrics

## 2. Evidence-Led Optimization

- [x] 2.1 Capture the initial exact workload with CodeVetter and record its scale curve and CPU candidate before source optimization
- [x] 2.2 Inspect only the selected source boundary and implement one bounded parser optimization
- [x] 2.3 Capture the candidate in the same MCP session and run identical-scope verification
- [x] 2.4 Continue only when the verifier identifies a new supported bottleneck or the same candidate remains materially dominant

## 3. Qualification And Validation

- [x] 3.1 Record measured local results, verifier decisions, resource limits, and unverified billion-row extrapolations
- [x] 3.2 Run challenge correctness, the full runtime capsule suite, touched-file lint, strict OpenSpec validation, docs validation, diff checks, and package smoke

## 4. Official Artifact Compatibility

- [x] 4.1 Add the official sorted min/mean/max output contract and a file-to-stdout entry point
- [x] 4.2 Test UTF-8 station names, signed range limits, and round-toward-positive means
- [x] 4.3 Record upstream attribution, license, and deliberate Node and bounded-run differences

## 5. Stronger scale qualification

- [x] 5.1 Repeat the bounded 1BRC parser comparison with stronger sampling
- [x] 5.2 Measure bytes processed and peak process memory at the current bounded scales
- [x] 5.3 Record which earlier improvement claims survive and identify the next earned I/O or streaming boundary
