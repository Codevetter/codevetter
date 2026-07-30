## 1. Corpus Contracts and Validation

- [ ] 1.1 Add closed versioned task, corpus-index, check-result, qualification-receipt, agent-adapter, and run-receipt contracts with shared bounds and canonical SHA-256 identity helpers
- [ ] 1.2 Implement fail-closed manifest and artifact validation for unknown fields, unsafe paths, duplicate IDs, mutable references, license/provenance gaps, size limits, and hash drift
- [ ] 1.3 Add non-strict corpus validation and strict publishable-readiness CLIs with deterministic terminal and JSON output
- [ ] 1.4 Add root pnpm commands for corpus validation, readiness, qualification, dry-run planning, execution, and receipt export
- [ ] 1.5 Add focused contract and validation tests covering malformed input, drift, bounds, deterministic ordering, partial-corpus status, and strict breadth failures

## 2. Task Qualification

- [ ] 2.1 Implement owned temporary workspace preparation that copies only baseline fixture and public task-packet inputs
- [ ] 2.2 Implement the closed check-driver protocol and exact required/regression inventory validation
- [ ] 2.3 Implement repeatable baseline qualification that requires at least one declared task-defining failure and preserves setup/check errors
- [ ] 2.4 Implement known-good patch application and repeated qualification requiring every acceptance and regression check to pass
- [ ] 2.5 Emit deterministic qualification receipts tied to all task artifact identities and exclude unqualified tasks from strict corpus counts
- [ ] 2.6 Add qualification tests for intended baseline failure, wrong failure, flaky setup, incomplete checks, known-good regression, process timeout, and cleanup failure

## 3. Provider-Neutral Agent Runner

- [ ] 3.1 Implement strict agent-adapter loading with shell-free argument arrays, bounded placeholders, exact identities, declared environment names, timeout, cost posture, and optional diagnostics path
- [ ] 3.2 Implement dry-run planning that resolves task, adapter, approvals, run count, budgets, identities, and workspace policy without launching an agent or executing checks
- [ ] 3.3 Require one-shot model-call approval for every real agent launch and a separate one-shot paid approval for paid adapters
- [ ] 3.4 Launch the adapter in the disposable workspace with bounded redacted output, lifecycle timestamps, cancellation, timeout, and owned process-group termination
- [ ] 3.5 Stage withheld checks only after agent termination, execute the closed check driver, derive the exact terminal outcome, and verify deterministic cleanup
- [ ] 3.6 Add runner tests using fixture adapters for success, agent failure, cancellation, timeout, output truncation, missing approval, missing diagnostics, descendant termination, and cleanup failure

## 4. Receipts and Existing Evaluator Composition

- [ ] 4.1 Emit bounded native run receipts containing immutable task/agent/environment identities, workspace policy, lifecycle, checks, regressions, diagnostics, limitations, and cleanup state
- [ ] 4.2 Implement deterministic projection from native receipts into the existing structural-context task/run manifest shapes
- [ ] 4.3 Reject scorer export for incomplete pairs, identity drift, stale graph snapshots, control contamination, invalid execution order, or missing required checks
- [ ] 4.4 Prove optional tokens, cost, tool calls, inspected files, and decision traces remain absent rather than becoming zero or fabricated values
- [ ] 4.5 Add integration tests that export fixture A/B and A/A receipts and pass them through `bench:graph-context` without changing scorer behavior

## 5. Seed Fixture Framework

- [ ] 5.1 Add the owned TypeScript/Node fixture framework, task-package layout, check-driver helper, known-good patch workflow, and corpus contribution template
- [ ] 5.2 Add and qualify a browser-state task for optimistic UI rollback after an API failure
- [ ] 5.3 Add and qualify an authorization task for preserving a protected route while rejecting unauthenticated access
- [ ] 5.4 Add and qualify an API-contract task for maintaining status and response-shape compatibility
- [ ] 5.5 Add and qualify a validation task for preserving meaningful zero and false values
- [ ] 5.6 Add and qualify an asynchronous task for preventing duplicate mutation during concurrent submission
- [ ] 5.7 Add and qualify an integration-regression task for retaining a fallback path after a primary dependency failure
- [ ] 5.8 Run the seed corpus through non-strict validation and document why it remains unpublishable below 30 qualified tasks

## 6. Browser and Authorization Corpus Expansion

- [ ] 6.1 Add and qualify a browser task for restoring persisted form state after navigation
- [ ] 6.2 Add and qualify a browser task for clearing stale cached UI after a successful mutation
- [ ] 6.3 Add and qualify a browser task for preserving deep-link route state across reload
- [ ] 6.4 Add and qualify a browser task for exposing server validation without losing user input
- [ ] 6.5 Add and qualify an authorization task for preventing cross-tenant record access
- [ ] 6.6 Add and qualify an authorization task for enforcing role changes on an existing session
- [ ] 6.7 Add and qualify an authorization task for rejecting an expired session while preserving public routes
- [ ] 6.8 Add and qualify an authorization task for keeping API and browser permission behavior consistent

## 7. API, Validation, and Persistence Corpus Expansion

- [ ] 7.1 Add and qualify an API task for propagating an awaited dependency failure with the intended status
- [ ] 7.2 Add and qualify an API task for preserving pagination cursor semantics at a boundary
- [ ] 7.3 Add and qualify an API task for making a retried mutation idempotent
- [ ] 7.4 Add and qualify an API task for rejecting an unsupported content type without invoking mutation logic
- [ ] 7.5 Add and qualify a validation task for distinguishing missing fields from explicit null values
- [ ] 7.6 Add and qualify a validation task for rejecting an unknown enum while preserving known legacy values
- [ ] 7.7 Add and qualify a persistence task for rolling back a partial transaction after a downstream error
- [ ] 7.8 Add and qualify a persistence task for maintaining serialization round-trip compatibility

## 8. Asynchronous, Integration, and Regression Corpus Expansion

- [ ] 8.1 Add and qualify an asynchronous task for suppressing stale out-of-order search responses
- [ ] 8.2 Add and qualify an asynchronous task for releasing resources after a timeout
- [ ] 8.3 Add and qualify an asynchronous task for preserving event order across queued work
- [ ] 8.4 Add and qualify an asynchronous task for handling concurrent version conflicts without silent overwrite
- [ ] 8.5 Add and qualify an integration task for tolerating an additive downstream payload field
- [ ] 8.6 Add and qualify an integration task for preserving webhook verification before parsing
- [ ] 8.7 Add and qualify an integration task for handling a feature-flag combination absent from the primary path
- [ ] 8.8 Add and qualify a regression task for preserving a legacy fallback while changing the preferred implementation

## 9. Strict Corpus Readiness and Documentation

- [ ] 9.1 Add enough additional qualified tasks in underrepresented lanes to reach 30–50 total while retaining both browser/API coverage and at least six failure categories
- [ ] 9.2 Run strict readiness and record the exact corpus identity, task/category counts, qualification receipts, and explicit limitations
- [ ] 9.3 Document task authoring, contribution review, qualification, dry-run, real-agent approval, receipt export, reproducibility, and the non-adversarial withheld-check threat model
- [ ] 9.4 Document that Sentry, logs, observability, feedback ingestion, and automatic regression creation remain deferred to the future application integration
- [ ] 9.5 Run focused Node tests, corpus validation, strict readiness, structural-context scorer integration, docs validation, Biome on touched code, and `git diff --check`
- [ ] 9.6 Run `openspec validate build-agent-task-corpus-runner --strict` and perform an independent diff review before archive
