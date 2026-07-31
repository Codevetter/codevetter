## Context

The corpus currently has one qualified owned task and a reusable contract,
qualification, runner, and evaluator pipeline. The seed cohort must reuse those
boundaries unchanged: public fixture plus `TASK.md` inside the workspace,
withheld repository-owned check code outside it, and exact known-good
replacements used only during qualification.

## Goals / Non-Goals

**Goals:**

- Exercise eight failure categories with behaviorally distinct fixtures.
- Make each baseline fail for one narrow intended reason while regressions pass.
- Prove both Node and TypeScript execution and both API and browser lanes.
- Keep every artifact small enough to audit manually and qualify quickly.

**Non-Goals:**

- Reaching the final 30–50 task publication gate in this slice.
- Launching an agent or measuring model performance.
- Using external repositories, licenses, browsers, databases, or networks.
- Modeling every framework or accepting style-only outcomes.

## Decisions

### Use one focused source file per seed

Each new seed has one implementation file with two or three observable
behaviors. The task asks for one narrow fix; hidden checks separate the
task-defining outcome from preserved behavior. This keeps known-good changes
exact and makes wrong-failure detection useful.

Alternative: copy realistic multi-package repositories. Rejected for the first
cohort because provenance, setup, and dependency noise would obscure whether
the corpus mechanics work across categories.

### Use executable TypeScript fixtures without a compiler dependency

TypeScript seeds use `.ts` modules that stay within Node's supported
erasable-type syntax. The repository-owned driver imports them under the
declared Node 22+ runtime. This proves TypeScript lane mechanics without adding
a production or benchmark dependency.

Alternative: transpile with the desktop toolchain. Rejected because it would
couple corpus qualification to unrelated workspace dependencies.

### Keep browser tasks DOM-independent

The browser-state seed models navigation and state restoration through plain
data/functions so it is deterministic and hermetic. Its behavior is still
browser-specific, but qualification does not need Chromium.

Alternative: Playwright qualification. Rejected because the first seed cohort
should prove semantic coverage before adding a heavier environment.

### Generate receipts through the real qualification CLI

Task artifacts and corpus entries are checked in first without qualification
references. Each task then runs through the normal two-baseline/two-known-good
path, and the resulting receipt identity is added to the index. No receipt is
hand-authored.

Alternative: synthesize qualifying JSON. Rejected because it would not prove
the fixtures and checks actually behave as declared.

## Risks / Trade-offs

- [Small fixtures are less realistic than full repositories] → Treat them as
  owned seeds, not final publication evidence; the later expansion must add
  broader and more integrated tasks.
- [Node TypeScript support can drift] → Stay inside erasable syntax and run the
  exact qualification suite in hosted Node 22 CI.
- [Shared check-driver patterns could hide systematic mistakes] → Give each
  category distinct behavior and assertions, then retain exact per-task
  qualification receipts.
- [Eight tasks satisfy categories but not statistical breadth] → Keep the
  30-task gate closed and say so in every readiness surface.

## Migration Plan

Additive corpus update only. Existing task and v1/v2 contracts remain
unchanged. Removing the new index entries and task directories reverts the
cohort without affecting runner or evaluator compatibility.
