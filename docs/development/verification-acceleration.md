---
title: Verification acceleration
description: CodeVetter's opt-in changed-test planner, resource profiles, receipts, and safety boundaries.
---

# Verification acceleration

CodeVetter dogfoods an opt-in changed-verification planner before generalizing
the approach to other repositories. It composes existing Node, Playwright,
Cargo, OpenSpec, and warm-verification commands; it does not replace their test
logic or implement another browser driver.

## Commands

Run from the repository root:

```bash
pnpm verify daemon start            # keep Vite and Chromium warm
pnpm verify changed --json          # run warm capability verification
pnpm verify:changed                 # print the focused plan; executes nothing
pnpm verify:changed -- --execute    # execute the focused plan
pnpm verify:exhaustive              # print the exhaustive plan
pnpm verify:baseline                # print a baseline receipt without execution
pnpm verify:acceleration:qualify    # cheap selector/corpus qualification
```

Execution is explicit because a dirty or shared-infrastructure change can widen
to the full fallback. Inspect `plan.focused`, `plan.reasons`, and `plan.lanes`
before adding `--execute`. Use `--staged`, `--commit <rev>`, or `--range
<base..head>` to select another exact Git change.

## Selection and blast radius

Checked rules in `scripts/codevetter-verification/config.json` are
authoritative. Current exact graph, import, coverage, or blast-radius evidence
may add work. It cannot remove explicitly mapped lanes. Unmatched paths, shared
contracts, stale hints, or truncated evidence widen to the exhaustive fallback.

The checked corpus deliberately includes frontend leaves, browser tests, Rust
leaves, IPC and lockfile invalidation, unmatched paths, and stale impact
evidence. Its current qualification proves selector recall only. Focused mode
must remain opt-in until selected and exhaustive application verdicts also agree
on a versioned runtime corpus.

## Resource profiles

The interactive profile admits at most two independent lanes, one CPU-intensive
lane, two browser contexts, two target-origin tokens, and the checked memory
budget. Lanes with the same exclusive state identity serialize. Cargo uses two
build jobs and cannot overlap another CPU-intensive lane. Browser lanes may use
two workers but cannot start separate Vite owners concurrently.

Receipts separate queue and execution time and bound retained output. Common
credential-shaped values are redacted. The exhaustive profile preserves all
underlying commands and is the escape hatch whenever focused evidence is
insufficient.

## Troubleshooting and rollback

- `planned` means no command ran; add `--execute` only after reviewing the plan.
- `no_confidence` means required execution or evidence was incomplete.
- An unexpectedly broad plan should be fixed by adding an authoritative mapping,
  not by suppressing fallback.
- To roll back, stop using the new planner commands and use the existing direct
  Playwright, Node, Cargo, or exhaustive commands.

The initial incident fixture is intentionally non-qualifying: it records the
23.231-second frontend/live gate and the cold Rust run that was killed after a
71-second compile while browser-heavy work was active. It is a baseline for the
resource problem, not evidence that focused verification is already safe.

## Initial dogfood results

On the first sequential warm-machine comparison, the 11 smoke and visual-system
tests passed with both profiles. Playwright's reported wall time fell from 16.3
seconds at one worker to 9.8 seconds at two workers: a 1.66x speedup and 39.88%
wall-time reduction. The two-worker command is therefore checked into the
focused `browser-ui` lane, not the global Playwright configuration.

This is a single observation, not a p95 or efficiency qualification. CPU time,
peak RSS, bandwidth, and click-to-settle stages were not retained, so the result
does not justify increasing concurrency for broader or stateful browser lanes.
The exact receipt is
`scripts/codevetter-verification/fixtures/browser-parallelism-initial-2026-08-07.json`.

Parallelism alone did not meet the product threshold. The representative warm
UI path now combines a persistent Vite/Chromium runtime, checked capability
selection, three fresh isolated contexts, and deterministic interaction
conditions. All ten serial warm samples passed while the dirty worktree forced
the broad three-scenario fallback. Receipt p50 was 1.116 seconds and p95 was
1.122 seconds, 14.5x faster than the 16.3-second Playwright baseline. Ten exact
`pnpm verify changed` samples had a 1.512-second p50 and conservative
1.671-second p95 versus the 16.746-second observed baseline, a 10.02x p95
improvement.

This is a scoped dogfood result, not yet a general product claim. Focused
selection still needs selected-versus-exhaustive application-verdict
qualification. The checked fixture is
`scripts/codevetter-verification/fixtures/warm-ui-tenfold-initial-2026-08-07.json`.

## Research queue

- Compare the checked selector with Playwright's
  [`--only-changed`](https://playwright.dev/docs/ci#fail-fast) dependency-graph
  heuristic. Playwright warns that it may miss tests, so it is useful as an
  additive signal rather than exhaustive truth.
- Evaluate dynamic file and runtime dependency histories against the exact
  patch corpus. Regression-test-selection research provides a stronger safety
  model than caller counts alone, but CodeVetter must still prove verdict
  agreement on its own corpus.
- Spike protocol-level DOM snapshots as a cheaper supplemental structural
  assertion. Chrome's
  [`DOMSnapshot.captureSnapshot`](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/#method-captureSnapshot)
  remains experimental and cannot replace visible behavior, actionability, or
  accessibility evidence.
- Do not reuse one mutable E2E browser context merely for speed. Playwright
  describes context reuse as best-effort and discouraged for E2E; CodeVetter
  keeps fresh contexts unless a future experiment proves equivalent isolation.
