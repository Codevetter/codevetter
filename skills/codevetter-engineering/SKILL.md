---
name: codevetter-engineering
description: Apply CodeVetter engineering standards when implementing or fixing product code, shared tooling, or delivery workflows. Select focused tests for small changes, independent review for crucial changes, and measured performance checks when relevant.
---

# CodeVetter Engineering

Use this entry point automatically for coding work. CodeVetter owns engineering
verification, testing, review and performance policy; repository runners remain
the execution tools. Load only the specialist skill needed for the current task.
Read this once per task, then revisit when its scope or risk changes.

## Choose by consequences

Read the repository instructions, intended behavior, actual callers and relevant
tests before editing. Identify what must remain true and the plausible failure
the check must detect. Preserve one owner for each business rule/state transition
and prefer the existing implementation over parallel abstractions.

| Change | Required path |
| --- | --- |
| Small, reversible, bounded change with limited failure impact | Focused repository checks and inspection of the changed behavior. No automatic model review or profiling. |
| Crucial workflow or uncertain material impact | Focused checks, changed-boundary runtime verification, then an independent review through CodeVetter before merge/release or claiming completion. |
| Performance-sensitive change, reported slowdown, or optimization claim | The relevant path above plus an existing representative performance budget/benchmark; use CodeVetter paired verification for improvement claims. |

Choose the consequence/risk path first, then add performance verification.
Performance checks never replace independent review: optimizing a payment
calculation is crucial and requires both, even when existing tests pass.

Crucial includes authorization/tenant boundaries, payments or financial results,
private data/security, durable saves and migrations, deletion/cleanup/recovery,
concurrent state or retry/idempotency behavior with material consequences,
signing/upgrades/deployment controls, shared agent/engineering policy, and changes
to a product's promised core workflow. Classify the changed behavior, not a filename
or line count. A one-line permission change is crucial. Pure copy/formatting in
a sensitive file is not automatically a behavior change. State the reason briefly.

## Focused verification

Use [testing](../codevetter-testing/SKILL.md) for substantive behavior changes,
failure reproduction and fix validation. Existing exact tests can be selected
directly; discovery is useful when the target is unknown, not a mandatory extra
operation. Run the smallest relevant check first and widen for shared contracts,
fixtures, configuration or dependencies. Keep required repository/CI checks.

For a substantive bug fix, reproduce failure before the repair and pass the same
acceptance check afterward when practical. Assert the observable result and the
relevant failure boundary, not just HTTP 200, element existence, a mock call or a
snapshot. Include relevant edge cases such as explicit false/zero, stale replies,
duplicates, interrupted writes, retries and permission denial. Do not mock away
the boundary under test. Report when before/after reproduction could not run.
Do not add tests for trivial reversible edits just to increase a test count.

Exercise the changed CLI/API/browser/installed-package boundary when applicable;
inspect rendered UI for visual changes. Build/unit success does not replace it.
Retain native test reports; ordinary repository tests are not CodeVetter runs.

## Automatic independent review for crucial changes

Use [review](../codevetter-review/SKILL.md) on the exact clean committed change:

| Implementation author | Independent executor |
| --- | --- |
| Codex | `--agent claude` |
| Claude / Claude Code | `--agent codex` |
| Another coding agent | An available configured Claude or Codex executor distinct from the implementation author |

On the owner's machine this review through the already configured local agent
CLIs is standing-authorized for crucial work. Start it automatically; do not ask
again. Elsewhere follow that operator's authority. This does not authorize buying
API capacity, provisioning credentials, publishing, or changing providers.
Use one independent executor, not `--agent cross` by default.

Bind the task, base/head and relevant executable target; run preflight, then the
same `check` with the selected executor. Read runtime evidence and every actionable
finding. Fix confirmed defects, rerun affected checks, and obtain review evidence
covering material fixes and the final source identity. Keep rejected findings with
a concise evidence-based reason. Missing executors or failed/blocked reviews stay
explicit; continue independent work, but do not call crucial verification complete.
Bound retries; stop repeating the same operational failure without new evidence.

For example, a Codex-authored Node change uses the recorder at the installed
skill root (replace placeholders with the inspected repository and test):

```text
python3 <skills>/codevetter-evaluate/scripts/invoke.py --skill codevetter-review --repo <repo> --task-id <uuid> --agent codex -- check --range <base..head> --task <intended-behavior> --test-adapter node-test --test-target <relative-test> --skip-performance --preflight --json
```

Execute the same input without `--preflight`, adding `--agent claude` **after**
`--`. The recorder's `--agent codex` identifies the author; the CLI's
`--agent claude` selects the reviewer. Reuse the task UUID, link the follow-up
with recorder `--parent-id <preflight-invocation-id>`, and assess both attempts.
Use `--skip-performance` for tests-plus-review work; omit it only when a relevant
performance workload is selected. Check installed help first. An older CLI
without the option is a capability gap, not permission to invent a flag or run
an unrelated discovered performance target. A skipped stage is not passing
performance evidence; inspect correctness/review stages and retain that limit.

**Reviewers do not recursively request reviewers.** When invoked as an independent
reviewer, audit the supplied change and return findings/evidence only. This author
workflow does not apply to the review task itself. Do not edit the author's source,
launch another `codevetter check`, or delegate another model review.
CodeVetter sets `CODEVETTER_REVIEWER` on its review workers and refuses nested
checks/reviews while that marker is present. Do not clear it to bypass the guard.

## Performance when relevant

Use [performance](../codevetter-performance/SKILL.md) for a slowdown, a material
performance-sensitive change or an optimization claim. Trace the actual executed
path. Select a representative workload and acceptance budget before optimizing;
preserve correctness, compare matching baseline/candidate conditions and disclose
startup cost, host load and uncertainty. Do not substitute repeated diagnosis for
ordinary correctness checks or benchmark a branch the workload never executes.

For Fleet product readiness, consult the existing SaaS Maker product checklist's
performance criteria: representative devices/routes/data, loading, interaction,
layout stability and comparable workloads. Use applicable native/CLI/API budgets
for those products. The checklist guides scope; CodeVetter owns execution and
evidence. Do not copy the checklist, run it in full for every edit, or create a
second performance system. Missing baselines remain gaps, not proof of a gain.

## Finish with evidence

Follow the specialist skill's invocation recorder and closing usefulness log.
Record each actual CodeVetter invocation once; native tests retain native reports.
Report changed behavior, checks/runtime exercised, independent review when
required, measured performance when applicable, and remaining gaps. A finding,
receipt, green CI or agent-reported `helped` is not proof of whole-product
correctness or improved agent productivity.
