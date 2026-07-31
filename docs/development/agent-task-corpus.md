---
title: Agent-task corpus contracts
description: Immutable task-package contracts and fail-closed readiness checks for the coding-agent corpus.
sidebar:
  order: 6
---

# Agent-task corpus contracts

This is the contract, qualification, and provider-neutral runner foundation for
[GitHub issue #53](https://github.com/Codevetter/codevetter/issues/53). It makes
task packages inspectable and immutable, proves their baseline failure and
known-good success, and gates one disposable adapter attempt behind a
deterministic plan and explicit approval.

The current owned seed cohort is qualified through the real local path. It
proves the machinery across eight failure categories, both lanes, and both
runtimes, not product value: eight compact synthetic tasks remain below the
30-task publication gate.

## Commands

Run from the repository root:

```bash
pnpm corpus:validate
pnpm corpus:validate --json
pnpm corpus:validate --root benchmarks/agent-tasks/sample --json
pnpm corpus:qualify --task preserve-explicit-false
pnpm corpus:qualify --task preserve-explicit-false --json
pnpm corpus:qualify --task preserve-explicit-false --out /tmp/qualification.json
FIXTURE_TOKEN=synthetic pnpm corpus:plan --task preserve-explicit-false \
  --adapter benchmarks/agent-tasks/sample/adapters/synthetic-false-fix.json
FIXTURE_TOKEN=synthetic pnpm corpus:run --task preserve-explicit-false \
  --adapter benchmarks/agent-tasks/sample/adapters/synthetic-false-fix.json \
  --approve-plan <exact-plan-id>
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

`corpus:plan` is the mandatory dry run. It binds the qualified task and
immutable v2 adapter, reports public input bytes, conservative token/cost
bounds, environment-name availability, cost posture, blockers, and approval
requirements, but reads no environment values and creates no process or
workspace.

`corpus:run` performs one attempt only when `--approve-plan` names the exact
current plan. Paid or unknown-cost adapters also require `--approve-paid`.
Execution reads only declared environment values, launches without a shell in
a fresh public-input-only workspace, bounds and redacts output, terminates the
owned process group on timeout/cancellation, and starts hidden checks only
after clean agent termination. `--out` atomically writes the v2 run receipt.

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
│   ├── agent-adapter-v2.schema.json
│   ├── run-plan.schema.json
│   ├── run-receipt.schema.json
│   └── run-receipt-v2.schema.json
└── sample/
    ├── adapters/
    │   ├── synthetic-false-fix.json
    │   └── synthetic-false-fix.mjs
    ├── corpus.json
    ├── qualification.json
    ├── qualifications/<task-id>.json
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

## Current owned seed snapshot

Corpus version `0.2.0` has index identity
`0b8466bfd8b2fce67e1e824dabaf5f89c9cf631f4a4eeaf4be131d2294e9bc95`.
It contains eight structurally valid and qualified tasks:

| Task | Category | Lane | Runtime |
|---|---|---|---|
| `enforce-tenant-resource-access` | authorization | API | TypeScript |
| `forward-integration-abort-signal` | integration | API | TypeScript |
| `preserve-explicit-false` | validation | API | Node |
| `preserve-upstream-http-status` | API contract | API | Node |
| `restore-zero-scroll-position` | browser state | browser | TypeScript |
| `save-settings-after-durable-write` | persistence | API | Node |
| `share-inflight-profile-load` | async/concurrency | API | TypeScript |
| `sort-suggestions-without-mutation` | regression behavior | browser | Node |

Every checked-in receipt can be reproduced from the exact task bytes:

```bash
for task in \
  enforce-tenant-resource-access \
  forward-integration-abort-signal \
  preserve-explicit-false \
  preserve-upstream-http-status \
  restore-zero-scroll-position \
  save-settings-after-durable-write \
  share-inflight-profile-load \
  sort-suggestions-without-mutation
do
  pnpm corpus:qualify --task "$task" --json
done
```

The qualification, lane, runtime, and category gates pass. The task-count gate
reports `8/30`, so `corpus:readiness` remains non-zero and
`publishable: false`.

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

## Runner boundary

V2 adapter descriptors bind every adapter-root file by SHA-256 and permit only
the closed `{node}`, `{adapter_root}`, `{workspace}`, and `{task_packet}`
placeholders. The deterministic plan is the approval object; task, adapter,
environment availability, input sizing, pricing, or limit drift produces a new
plan ID and invalidates the old approval. Free adapters declare zero pricing.

The run receipt binds the plan, task, fixture, acceptance contract, adapter,
hashed environment identity, lifecycle ordering, agent termination, redacted
output identities, exact checks, regression count, and cleanup. Optional
provider diagnostics remain absent unless the adapter actually supplies them;
the runner does not fabricate token, cost, tool, or file counts.

## Receipt evaluation boundary

`corpus:evaluate` composes already-produced v2 receipts into the existing
structural-context scorer:

```bash
pnpm corpus:evaluate -- \
  --bundle benchmarks/agent-tasks/evaluations/<experiment>/bundle.json \
  --out artifacts/agent-task-score.json
```

The closed bundle identifies the corpus index, task revisions, adapter
descriptors, raw receipts, pair arms/order, and graph-context policy with safe
paths and exact SHA-256 values. The composer derives task titles, task-packet
identity, acceptance inventory, agent/model labels, run outcomes, and available
diagnostics from those immutable artifacts. It rejects hash drift, duplicate or
incomplete pairs, common-identity drift, invalid order, missing checks after
check execution, stale treatment graphs, control contamination, and mismatched
A/A context before writing output.

Raw receipts are never rewritten. The separate derived score names the scorer
version and source hash, bundle hash, corpus hash, combined ground-truth hash,
projected-manifest hash, and sorted raw receipt identities. Re-running the
command with the same inputs produces the same score without launching an
agent, executing hidden checks, calling a provider, or making a network
request. Diagnostics absent from raw receipts remain absent. Pre-check
setup/agent/timeout/cancellation failures project the immutable acceptance
inventory as `skipped`, never as fabricated passes or failures.

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
- Give each seed at least one task-defining required check and one separate
  preserved-behavior regression check.
- Run qualification after any task-owned byte changes, then update the receipt
  path/hash in `corpus.json`; never hand-author `qualified: true`.
- Keep owned seeds small and hermetic. Broader repository-derived tasks need
  immutable provenance, license review, and the same exact qualification proof.

The validator enforces document and artifact size bounds before parsing or
hashing. It rejects duplicate identities, unsafe paths, non-regular files,
malformed JSON, hash drift, invalid qualification state, and readiness
shortfalls with sorted path-specific errors.

## Current authority boundary

Validation and readiness only read local files and compute hashes.
Qualification may create bounded temporary workspaces and execute the trusted
repository-owned check driver. An explicitly approved runner invocation may
also execute one immutable adapter before those withheld checks. These paths do
not:

- automatically launch an adapter from planning or validation;
- read undeclared credentials or retain declared values in output/receipts;
- make network requests;
- mutate corpus content.

Receipt evaluation is a separate read-only command and preserves the existing
structural-context scorer as the only outcome and qualification authority. The
repository-owned synthetic adapter and composition tests prove lifecycle and
projection mechanics only; no real provider/model or paid adapter was run.
Real provider evidence remains a later slice on issue #53.

The owned seeds are intentionally compact single-file behavior fixtures. The
browser lane is DOM-independent and does not prove Chromium integration; the
cohort does not measure task difficulty, agent success, framework setup, or
statistical confidence. It reports `8 qualified` and `publishable: false`; only
the 30–50 task-count gate remains closed.
