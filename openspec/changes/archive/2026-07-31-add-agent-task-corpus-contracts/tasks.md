## 1. Contract Surface

- [x] 1.1 Add closed versioned JSON Schemas for corpus indexes, task
  manifests, check results, qualification receipts, agent adapters, and run
  receipts.
- [x] 1.2 Add shared bounds, canonical JSON/SHA-256 identity helpers, and
  dependency-free closed-object validation.

## 2. Corpus Validation

- [x] 2.1 Implement safe artifact resolution and fail-closed index/task
  validation for paths, regular files, hashes, provenance, licenses, duplicate
  IDs, and deterministic ordering.
- [x] 2.2 Implement qualification-evidence validation and deterministic
  publishable-readiness gates for task count, qualified count, lanes, runtimes,
  and failure categories.
- [x] 2.3 Add one owned, structurally valid, explicitly unqualified sample task
  and corpus index with an exact two-level identity chain.

## 3. CLI and Evidence

- [x] 3.1 Add deterministic human/JSON CLI output and separate root commands
  for non-strict validation and strict readiness.
- [x] 3.2 Add focused tests for valid partial corpora, deterministic output,
  unknown fields, unsafe paths/symlinks, hash drift, duplicate IDs, bounds,
  malformed JSON, invalid receipt contracts, and strict breadth failure.
- [x] 3.3 Document authoring, contract identities, command behavior,
  non-execution authority, and the later qualification/runner boundary.

## 4. Delivery

- [x] 4.1 Run focused tests, lint, docs, strict OpenSpec validation, and
  `git diff --check`.
- [x] 4.2 Archive the completed change and deliver the bounded progress through
  a pull request linked to issue #53 without claiming corpus readiness.
