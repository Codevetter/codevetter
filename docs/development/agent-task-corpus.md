---
title: Agent-task corpus contracts
description: Immutable task-package contracts and fail-closed readiness checks for the coding-agent corpus.
sidebar:
  order: 6
---

# Agent-task corpus contracts

This is the contract foundation for
[GitHub issue #53](https://github.com/Codevetter/codevetter/issues/53). It makes
task packages inspectable and immutable before CodeVetter gains authority to
qualify tasks or launch an agent.

The current sample is deliberately small and unqualified. It proves structural
validation only; it is not benchmark evidence.

## Commands

Run from the repository root:

```bash
pnpm corpus:validate
pnpm corpus:validate --json
pnpm corpus:validate --root benchmarks/agent-tasks/sample --json
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

## Layout

```text
benchmarks/agent-tasks/
├── contracts/
│   ├── common.schema.json
│   ├── corpus-index.schema.json
│   ├── task-manifest.schema.json
│   ├── check-result.schema.json
│   ├── qualification-receipt.schema.json
│   ├── agent-adapter.schema.json
│   └── run-receipt.schema.json
└── sample/
    ├── corpus.json
    └── tasks/<task-id>/
        ├── task.json
        ├── fixture.json
        ├── task.md
        ├── acceptance-contract.json
        └── known-good.patch
```

The sample uses small regular files for contract proof. Later realistic tasks
may use bounded owned fixture archives, but the manifest still treats each
archive as one immutable artifact.

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

Validation and readiness only read local files and compute hashes. They do not:

- execute fixture setup or task checks;
- apply the known-good patch;
- create a qualification receipt;
- launch an agent or subprocess adapter;
- read credentials or environment values;
- make network requests;
- project receipts into the structural-context evaluator; or
- mutate corpus content.

Those capabilities remain later, separately reviewed slices on issue #53.
Until qualification exists, the sample must continue to report `0 qualified`
and `publishable: false`.
