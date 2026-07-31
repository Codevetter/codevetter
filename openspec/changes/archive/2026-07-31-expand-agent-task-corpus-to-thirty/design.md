## Context

The contract, qualification, runner, and evaluator paths are already complete.
Eight owned seeds qualify through the real local path, and every breadth gate
except the existing 30-task minimum passes. This change scales the same
artifact and receipt boundaries without changing schemas or execution
authority.

## Goals / Non-Goals

**Goals:**

- Reach exactly 30 qualified tasks with behaviorally distinct browser/API
  defects.
- Keep each task small, hermetic, dependency-free, and auditable.
- Preserve two repeated baseline failures and two repeated known-good passes.
- Model alternate acceptable implementation locations as one outcome.
- Measure unnecessary-change behavior with an intentional decoy/control.

**Non-Goals:**

- Claiming statistical confidence, model quality, or product value.
- Launching a real agent/provider or collecting paid diagnostics.
- Adding browsers, package installation, networks, databases, or framework
  setup to qualification.
- Changing readiness thresholds or qualification contracts.

## Decisions

### Expand with 22 independently qualified owned fixtures

Each new task owns its public packet, fixture, withheld acceptance contract,
check driver, minimal exact known-good replacement, and generated receipt.
Tasks cover distinct boundary, state, ordering, cancellation, persistence, and
regression behaviors rather than repeating one syntactic edit.

Alternative: lower the readiness threshold. Rejected because it would turn a
known evidence gap into a green status without adding evidence.

### Keep fixtures compact while increasing integration shape

Most tasks remain one focused module, but the alternate-location and decoy
tasks use two files. This exercises multi-file workspaces and unnecessary
change controls while keeping execution deterministic and fast.

Alternative: import full external repositories. Rejected for this tranche
because license, setup, and dependency noise would make qualification slower
and less inspectable without measuring a real agent yet.

### Count behavior, not implementation location

One integration task has a caller and adapter boundary where either can
legitimately normalize the same request. Its acceptance contract declares one
task-defining outcome. The checked-in known-good chooses one minimal solution,
but the hidden behavior check accepts the outcome regardless of which boundary
an agent changes.

Alternative: create one task per possible edit location. Rejected because that
would inflate outcome count without adding a distinct defect.

### Use a byte-stable intentional decoy

One regression task includes a similarly named but unrelated module. The
task-defining behavior lives in the real parser; a regression check requires
the decoy bytes to remain unchanged. The known-good change touches only the
real implementation.

Alternative: mention the decoy in the public task. Rejected because the
control is intended to measure whether an agent makes unnecessary lookalike
changes.

## Risks / Trade-offs

- [Compact fixtures remain synthetic] → Keep documentation explicit that
  readiness means contract breadth, not agent-value proof.
- [Many generated artifacts can drift] → Generate semantic files
  deterministically, then produce every receipt through the real qualifier and
  revalidate exact identities.
- [Node TypeScript execution can drift] → Stay within Node 22 erasable syntax
  and reproduce the full suite in hosted CI.
- [A 30-task minimum can look stronger than it is] → Preserve limitations and
  avoid claims about difficulty, representativeness, or model performance.

## Migration Plan

Additive corpus update only. Existing task, receipt, runner, and evaluator
contracts remain compatible. Reverting the new entries and artifacts restores
the prior eight-task corpus.
