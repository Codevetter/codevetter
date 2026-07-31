## 1. Runner Contracts

- [x] 1.1 Add closed v2 agent-adapter, deterministic run-plan, and v2
  run-receipt schemas plus semantic validators.
- [x] 1.2 Bind command placeholders to immutable adapter artifacts and preserve
  v1 adapter/receipt validation.

## 2. Planning and Approval

- [x] 2.1 Export safe task-package loading for runner composition without
  exposing withheld artifacts to the workspace.
- [x] 2.2 Implement deterministic non-executing plans with environment-name
  availability, input/token/cost bounds, and exact identities.
- [x] 2.3 Require exact one-attempt launch approval, separate paid approval,
  environment availability, and a passing cost gate before setup.

## 3. Disposable Execution and Evidence

- [x] 3.1 Implement fresh public-input-only workspace setup and closed command
  placeholder resolution.
- [x] 3.2 Implement shell-free process-group execution, bounded redacted
  output, timeout/cancellation, and terminal-before-check ordering.
- [x] 3.3 Run exact withheld checks after successful termination and classify
  incomplete checks, failures, and regressions.
- [x] 3.4 Emit closed v2 receipts with lifecycle, termination, output
  identities, optional diagnostics, cleanup, and limitations.
- [x] 3.5 Add human/JSON CLI planning plus explicitly approved execution and
  optional atomic receipt output.

## 4. Synthetic Proof and Tests

- [x] 4.1 Add one immutable synthetic adapter that repairs the owned sample
  without reading hidden checks or known-good data.
- [x] 4.2 Test deterministic no-execution planning, stale/missing/paid approval,
  environment and cost gates, success ordering, failure, timeout,
  cancellation, output redaction/truncation, withheld-check gating, and cleanup.
- [x] 4.3 Update corpus, CI, authoring, and project-status documentation.

## 5. Delivery

- [x] 5.1 Run focused tests, synthetic execution, corpus
  validation/readiness, lint, docs, workflow YAML, strict OpenSpec validation,
  and diff checks.
- [x] 5.2 Sync/archive the change and deliver it through a pull request linked
  to issue #53 without claiming a real provider run or corpus readiness.
