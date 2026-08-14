## 1. Scheduler Contract

- [x] 1.1 Add bounded closed schedule input, result, budget, run-reference, and authority contracts
- [x] 1.2 Validate current source-probe identity and every reusable recapture before execution
- [x] 1.3 Implement sequential derived recaptures with a three-observation and three-new-run ceiling
- [x] 1.4 Implement stable, unstable, correctness, incomplete, stale, failure, and budget stop states
- [x] 1.5 Atomically persist one contained terminal receipt after a final source-snapshot check

## 2. Verification

- [x] 2.1 Cover zero-, one-, two-, and three-run budget accounting and deterministic IDs
- [x] 2.2 Cover early stability, disagreement, correctness failure, incomplete evidence, stale source, and operational failure
- [x] 2.3 Cover incompatible, duplicate, tampered, symlinked, oversized, and extra-field inputs and receipts
- [x] 2.4 Prove existing terminal evidence executes no app/browser/runtime and new runs remain sequential

## 3. Agent-Facing Surfaces

- [x] 3.1 Add `stabilize-browser-probe` CLI operation and package script
- [x] 3.2 Add equivalent `stabilize_browser_probe` MCP tool with an execution and cost description
- [x] 3.3 Prove CLI/MCP normalized parity for a zero-new-run schedule and arbitrary execution-argument rejection

## 4. Product Proof

- [x] 4.1 Reuse the two real High Signal recaptures and prove the scheduler stops unstable without new execution
- [x] 4.2 Document local cost bounds, reuse policy, stop reasons, authority, and remaining gaps
- [x] 4.3 Run focused tests, full runtime tests, lint, docs validation, diff checks, and strict OpenSpec validation
