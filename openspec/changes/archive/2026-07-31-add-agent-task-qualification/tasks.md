## 1. Qualification Contracts

- [x] 1.1 Add closed fixture-bundle, acceptance-contract, known-good change,
  and v2 qualification-receipt schemas plus semantic validators.
- [x] 1.2 Extend corpus validation to inspect the three nested task contracts,
  immutable check-driver identity, and v1/v2 qualification evidence.

## 2. Workspace and Check Execution

- [x] 2.1 Implement bounded fresh workspace materialization containing only
  declared fixture files and the public task packet.
- [x] 2.2 Implement exact known-good file replacement with before/after
  identities and no shell.
- [x] 2.3 Implement timeout-bounded shell-free check-driver execution, closed
  result parsing, exact inventory enforcement, and bounded diagnostics.
- [x] 2.4 Guarantee workspace cleanup in every attempt and preserve cleanup
  failure as an explicit outcome.

## 3. Qualification and Receipt

- [x] 3.1 Implement repeated baseline classification for intended failure,
  wrong failure, timeout, incomplete checks, check error, flakiness, and
  cleanup failure.
- [x] 3.2 Implement repeated known-good classification for pass, patch failure,
  check failure, regression, timeout, incomplete checks, check error,
  flakiness, and cleanup failure.
- [x] 3.3 Emit deterministic v2 qualification receipts and a root CLI command
  with human/JSON output plus optional atomic receipt output.

## 4. Owned Proof and Tests

- [x] 4.1 Convert the owned sample into an executable fixture, acceptance
  driver, and known-good change; generate and index its real qualification
  receipt while strict corpus readiness remains closed.
- [x] 4.2 Add focused tests for public-input isolation, deterministic success,
  wrong failure, incomplete inventory, timeout, flakiness, known-good
  regression, patch drift, and cleanup failure.
- [x] 4.3 Update corpus authoring, CI, and project-status documentation.

## 5. Delivery

- [x] 5.1 Run focused tests, sample qualification, corpus validation/readiness,
  lint, docs, workflow YAML, strict OpenSpec validation, and diff checks.
- [x] 5.2 Archive the change and deliver it through a pull request linked to
  issue #53 without claiming agent execution or corpus readiness.
