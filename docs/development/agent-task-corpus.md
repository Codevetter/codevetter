---
title: Agent-task corpus contracts
description: Immutable task-package contracts and fail-closed readiness checks for the coding-agent corpus.
sidebar:
  order: 6
---

# Agent-task corpus contracts

This is the contract and qualification foundation for
[GitHub issue #53](https://github.com/Codevetter/codevetter/issues/53). It makes
task packages inspectable and immutable, then proves their baseline failure and
known-good success without launching an agent.

The current owned sample is qualified through the real local path. It proves
the machinery, not product value: one synthetic task remains far below corpus
readiness.

## Commands

Run from the repository root:

```bash
pnpm corpus:validate
pnpm corpus:validate --json
pnpm corpus:validate --root benchmarks/agent-tasks/sample --json
pnpm corpus:qualify --task preserve-explicit-false
pnpm corpus:qualify --task preserve-explicit-false --json
pnpm corpus:qualify --task preserve-explicit-false --out /tmp/qualification.json
pnpm corpus:readiness
pnpm corpus:readiness --json
pnpm test:corpus-contracts
```

`corpus:validate` succeeds when an in-progress corpus is structurally valid.
Its result still reports every unmet publishability gate.

`corpus:readiness` uses the same canonical result but exits non-zero unless all
strict gates pass:

- 30–50 valid and qualified tasks;
- both `browser` and `api` lanes;
- both `typescript` and `node` runtimes;
- at least six failure categories;
- valid qualification evidence for every counted task.

Both commands support deterministic human and JSON output. Invalid input always
exits non-zero.

`corpus:qualify` creates two fresh baseline workspaces and two fresh known-good
workspaces by default, runs the immutable task check driver without a shell,
and emits a deterministic v2 receipt. It exits `0` only when the task-defining
failure repeats at baseline, every check repeats successfully after the
known-good replacement, and every workspace is removed. `--out` writes the
receipt atomically.

## Layout

```text
benchmarks/agent-tasks/
├── contracts/
│   ├── common.schema.json
│   ├── corpus-index.schema.json
│   ├── task-manifest.schema.json
│   ├── fixture-bundle.schema.json
│   ├── acceptance-contract.schema.json
│   ├── known-good-change.schema.json
│   ├── check-result.schema.json
│   ├── qualification-receipt.schema.json
│   ├── qualification-receipt-v2.schema.json
│   ├── agent-adapter.schema.json
│   └── run-receipt.schema.json
└── sample/
    ├── corpus.json
    ├── qualification.json
    └── tasks/<task-id>/
        ├── task.json
        ├── fixture.json
        ├── task.md
        ├── acceptance-contract.json
        ├── checks.mjs
        └── known-good.json
```

The fixture is a closed, bounded bundle of sorted base64 files. The known-good
change is a sorted list of exact file replacements with before/after SHA-256
identities. Qualification does not invoke `tar`, `patch`, a package manager, or
the network.

## Identity chain

The corpus has two hash levels:

1. `corpus.json` records the ordered task ID, manifest path, and exact manifest
   SHA-256.
2. Each task manifest records the exact SHA-256 of its fixture, public task
   packet, acceptance contract, and known-good patch.

Hashes are lowercase SHA-256 values over the exact committed bytes. Editing or
formatting a semantic artifact therefore requires updating its owning hash and,
when the manifest changes, the corpus-index hash.

Qualification evidence is separate. A corpus-index entry may later reference a
qualification receipt by path and SHA-256, but that receipt does not change the
task definition. Strict readiness counts a task only when the receipt:

- conforms to the closed qualification contract;
- names the same task and manifest identity;
- records repeated intended baseline failure;
- records repeated known-good success; and
- derives `qualified: true` from those exact states.

V1 receipts remain readable. V2 additionally binds the fixture, acceptance
contract, known-good change, public-input workspace policy, ordered attempt
outcomes/result identities, and cleanup result.

## Qualification boundary

Every attempt starts from a new temporary directory containing only decoded
fixture files and `TASK.md`. The acceptance contract, known-good data, and
check driver stay outside that workspace. Known-good qualification performs
only declared exact replacements after checking the before hash.

The driver runs under Node with `shell: false`, a declared timeout, bounded
stdout/stderr, and a minimal environment. Its stdout must be one closed
check-result document with the exact required and regression inventory.
Qualification distinguishes wrong baseline failure, incomplete checks,
timeouts, check errors, flakiness, patch drift, regression, and cleanup failure.
Receipts omit temporary paths, timing, environment values, and raw output.

## Authoring rules

- Keep task IDs, category IDs, failure modes, and check IDs lowercase
  kebab-case.
- Sort corpus entries and check-ID arrays.
- Use POSIX relative paths under the owning corpus or task directory.
- Do not use absolute paths, `..`, backslashes, symbolic links, directories, or
  empty artifacts.
- Keep every machine document closed: unknown fields fail validation.
- Record owned provenance or an immutable external repository revision.
- Include SPDX and human-readable license/notice metadata.
- Keep externally observable acceptance behavior in the task packet; do not
  use style-only findings as task outcomes.

The validator enforces document and artifact size bounds before parsing or
hashing. It rejects duplicate identities, unsafe paths, non-regular files,
malformed JSON, hash drift, invalid qualification state, and readiness
shortfalls with sorted path-specific errors.

## Current authority boundary

Validation and readiness only read local files and compute hashes.
Qualification may create bounded temporary workspaces and execute the trusted
repository-owned check driver. These paths do not:

- launch an agent or subprocess adapter;
- read credentials or environment values;
- make network requests;
- project receipts into the structural-context evaluator; or
- mutate corpus content.

Agent execution and evaluator projection remain later, separately reviewed
slices on issue #53. The sample reports `1 qualified` and
`publishable: false`; task count, browser-lane, TypeScript-runtime, and category
breadth gates remain closed.
