## 1. Diagnostics Contract

- [x] 1.1 Add a closed versioned adapter-diagnostics schema and validator.
- [x] 1.2 Reject unknown fields, empty observations, unsafe paths, duplicates, unsorted arrays, bounds violations, and secret-bearing values.

## 2. Runner Ingestion

- [x] 2.1 Resolve declared diagnostics inside the disposable workspace after adapter termination.
- [x] 2.2 Preserve valid diagnostics in v2 receipts and keep undeclared fields absent.
- [x] 2.3 Fail closed before hidden checks when a clean adapter exit has missing or invalid declared diagnostics.
- [x] 2.4 Preserve valid diagnostics from failed adapter exits without changing their terminal authority.

## 3. Documentation And Validation

- [x] 3.1 Document the adapter output contract, authority boundary, redaction, and limitations.
- [x] 3.2 Update durable project status with the shipped diagnostics-ingestion truth.
- [x] 3.3 Run focused contracts/runner/evaluator tests, corpus readiness, lint, docs, strict OpenSpec validation, and diff checks.
