---
title: Verification receipts
description: Machine-first ingestion and comparison of project-owned test and performance evidence.
sidebar:
  order: 5
---

# Verification receipts

CodeVetter lets a project keep its own test runner and submit one closed receipt
after execution. CodeVetter validates the evidence, evaluates correctness and
performance budgets independently, and explains the declared path from changed
files to selected tests and failure signatures.

This repository-owned slice is experimental. It does not run tests, discover
commands, modify the target repository, or persist into the desktop database.

## Producer contract

The canonical producer schema is
`codevetter.project-verification-receipt/v1`. A receipt records:

- repository revision, runner profile, and environment identity;
- selection mode, inventory identity, changed files, and selected tests;
- primary and bounded recheck attempts with stable failure signatures;
- terminal outcome counts kept separate from operational failures;
- wall time, CPU, peak RSS, process count, samples, and coverage quality;
- fixed waits, live-network escapes, mock cost, and retries;
- explicit absolute budgets and comparison materiality thresholds;
- optional repository-relative evidence references, including a
  `runtime-performance-capsule` SHA-256 identity;
- limitations that bound the producer's claims.

The complete executable example is
[`codevetter-local-fast-2026-08-07.json`](https://github.com/Codevetter/codevetter/blob/main/scripts/verification-receipts/fixtures/codevetter-local-fast-2026-08-07.json).
That projection intentionally remains `no_confidence` for inventory because its
source receipt contains aggregate outcomes instead of individual test and
selection identities. Its command-level RSS is retained as partial evidence,
not upgraded to total process-tree memory.

### Producer-native adapters

The loader also recognizes the bounded `vault-e2e-profile/v1` receipt emitted
by Vault's standalone Playwright profiler. It derives a canonical receipt while
keeping the exact raw-file SHA-256 as the source identity. Missing inventory,
attempts, resource measurements, budgets, or network evidence stay missing;
pre-test runner failures become operational `no_confidence` evidence.

The adapter takes the repository identity from the scoped project's
`package.json`. Unsupported producer formats and producer-native receipts
without a stable repository identity fail before analysis. Raw executable
paths, authentication markers, and other producer-only fields are not copied
into the normalized bundle.

Receipts are closed and bounded. Unknown fields, unsupported versions,
credential-shaped values, duplicate identities, absolute paths, traversal,
escaping symlinks, inconsistent totals, and oversized inputs fail before a
qualified bundle is emitted.

## CLI

Ingest one repository-relative receipt:

```bash
pnpm verification:ingest -- \
  --repo /path/to/project \
  --receipt artifacts/verification.json
```

Compare two receipts:

```bash
pnpm verification:compare -- \
  --repo /path/to/project \
  --baseline artifacts/baseline.json \
  --current artifacts/current.json
```

Add `--output artifacts/bundle.json` to explicitly write the same canonical
JSON printed to stdout. Re-ingesting identical bytes at the same relative path
produces the same bundle identity and content.

Exit codes are `0` for a qualified non-regression, `1` for a failed bundle or
same-commit regression, and `2` for invalid, incompatible, or no-confidence
evidence. Cross-commit comparisons return observed deltas with an explicit
limitation and never claim a controlled speedup.

## MCP

Start the separate repository-scoped, read-only stdio process:

```bash
pnpm verification:mcp -- --repo /path/to/project
```

It exposes two tools:

- `ingest_verification_receipt` with `{ "receipt": "relative/path.json" }`
- `compare_verification_receipts` with repository-relative `baseline` and
  `current` paths

The MCP transport calls the same pure analyzer as the CLI. It cannot switch
repository scope, execute a command, or write an output bundle. This process is
separate from the packaged `codevetter-mcp` history/graph sidecar.

## Reading the result

The normalized bundle separates:

- `observed`: producer measurements and terminal outcomes;
- `verdict`: correctness, performance, safety, inventory, and overall status;
- `budget_results`: one result per declared metric;
- `taxonomy`: stable failures, transient recoveries, retries, waits, escapes,
  timeouts, and operational failures;
- `blast_radius`: producer-declared changed-file → test → failure edges;
- `evidence`: references to deeper artifacts without copying or upgrading them;
- `limitations`: missing or partial coverage and qualification boundaries.

A comparison additionally reports compatibility, exact metric/sample deltas,
new/recovered/stable failures, and selector widening or narrowing. Static or
source-level dependencies absent from the producer receipt are never invented.

## Qualification

Run the focused contract and transport suite:

```bash
pnpm test:verification-receipts
```

The suite covers deterministic ingestion, independent budgets, transient
rechecks, same- and cross-commit comparison, incompatible identities, unsafe
selector narrowing, privacy rejection, filesystem containment, CLI/MCP parity,
the real CodeVetter local-runner projection, and complete plus pre-test-failure
Vault E2E receipt adaptation.
