## 1. Contracts

- [x] 1.1 Add closed versioned schemas and semantic validators for evaluation bundles and derived score artifacts.
- [x] 1.2 Extend the structural-context manifest validator only as needed to preserve runner terminal outcomes and Git revision identities.

## 2. Composition

- [x] 2.1 Load bundle, corpus, adapter, and raw receipt artifacts through safe bounded immutable paths.
- [x] 2.2 Project receipt-owned outcomes and diagnostics into the existing evaluator manifest without fabricating unavailable observations.
- [x] 2.3 Reject incomplete pairs, identity drift, invalid order, missing checks, stale graph state, and context contamination before export.
- [x] 2.4 Emit an atomic deterministic derived score stamped with scorer, bundle, corpus, ground-truth, projection, and receipt identities.

## 3. Verification And Documentation

- [x] 3.1 Add focused contract, composition, rejection, immutability, and deterministic-rescoring tests.
- [x] 3.2 Document the CLI, trust boundary, provenance fields, limitations, and synthetic-only proof.
- [x] 3.3 Update package scripts and durable project status for the shipped capability.
- [x] 3.4 Run targeted corpus/evaluator tests, lint, strict OpenSpec validation, and diff checks.
