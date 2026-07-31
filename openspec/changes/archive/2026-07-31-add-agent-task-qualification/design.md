## Context

The contract foundation on `main` validates task/index identities and can count
qualification receipts, but it deliberately has no authority to create them.
The current sample artifacts are descriptive placeholders rather than an
executable owned fixture. This slice must establish qualification without
crossing into agent execution or adding a package dependency.

## Goals / Non-Goals

**Goals:**

- Prove one real owned task through the same repeated qualification path later
  corpus tasks will use.
- Keep public task inputs, withheld checks, and known-good material physically
  distinct during every attempt.
- Preserve exact failure taxonomy in a deterministic machine receipt.
- Make cleanup and timeout behavior testable without leaking temporary paths
  into the receipt.

**Non-Goals:**

- Provide adversarial host isolation from a malicious check driver.
- Launch an agent adapter or dry-run an agent plan.
- Support arbitrary archive formats, package installation, or network setup.
- Count the one-task sample as a publishable corpus.

## Decisions

### Represent the fixture and known-good change as closed data bundles

The fixture bundle contains a sorted list of bounded POSIX-relative files with
base64 content and exact decoded SHA-256. The known-good change contains sorted
exact file replacements with before/after identities and bounded base64
content.

This avoids shelling out to `tar`, `patch`, or package managers and makes path,
content, and mutation bounds inspectable. It is intentionally narrower than a
general patch engine; later realistic tasks can store a bounded owned archive
only after an explicit format proposal.

### Keep the acceptance contract and driver outside the workspace

The acceptance contract declares the task-defining failure IDs, exact required
and regression inventories, repetition count, and one immutable driver path,
hash, and timeout. Qualification executes the driver with Node, `shell: false`,
and passes only workspace, task, acceptance identity, and attempt metadata.

The driver is procedural withheld evidence, not an agent-visible file. This is
not a sandbox claim: the receipt calls the policy
`public_fixture_and_task_packet_v1`, and the driver is trusted corpus code.

### Use a version-2 qualification receipt

The already-published v1 contract remains readable. Qualification emits v2,
which adds immutable fixture/acceptance/known-good identities, the workspace
policy, ordered per-attempt outcome/result identities, and cleanup status.
Corpus validation accepts both versions but the new sample uses v2.

This preserves compatibility instead of silently changing v1 while giving
failure taxonomy enough structure for later runner composition.

### Run fresh baseline and known-good attempts

Each attempt creates a new temporary directory, materializes only public input,
optionally applies the known-good replacements, executes the driver once, and
removes the directory in a `finally` boundary. The default repetition count is
two and the contract bounds it to two through five.

Phase status is derived after all attempts. Any cleanup failure is retained as
`cleanup_failure`; check-status disagreement becomes `flaky`; no later success
can overwrite those states.

### Hash results, do not retain workspace-local details

Each attempt retains its ordinal, derived outcome, and canonical check-result
SHA-256. The aggregate receipt contains no temporary path, stdout/stderr,
environment value, timestamp, or duration. Diagnostic command output can name
the stable task/check IDs only.

This makes deterministic requalification possible and keeps the receipt
bounded. Future runner receipts can preserve bounded runtime diagnostics under
their separate contract.

## Risks / Trade-offs

- **A trusted driver reads outside the workspace** → State the procedural
  boundary honestly; stronger sandboxing belongs to the agent-runner slice.
- **Base64 fixture bundles are verbose** → Bound them to small owned seed
  fixtures; introduce archives only with explicit traversal-safe extraction.
- **Cleanup failure is difficult to reproduce naturally** → Inject the owned
  workspace remover in focused tests while the CLI uses the real remover.
- **Check output includes noisy text** → Capture bounded stdout/stderr and parse
  only the closed JSON stdout document; never place raw output in receipts.

## Migration Plan

Convert the one-task sample to the executable v1 fixture/acceptance/change
contracts, generate its deterministic v2 qualification receipt, and reference
that receipt from the corpus index. Strict readiness remains closed because the
corpus is below 30 tasks and lacks lane/category breadth. Rollback removes the
qualification command/receipt and restores the unqualified sample reference;
no production state changes.
