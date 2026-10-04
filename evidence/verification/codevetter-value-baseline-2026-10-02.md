# CodeVetter value baseline — 2026-10-02

## Decision

Incremental improvement to coding-agent task outcomes is **not established** by
this pass. Keep review, testing and performance skills selectively discoverable;
start automatic use with inspection/planning. Do not make dual review, browser
execution or performance diagnosis a universal post-change hook.

This is an evaluation-readiness and usability pass, not a new agent-quality
benchmark. No provider calls, foreground automation, production workloads,
commit, deployment or release ran.

## Plain-language value

| Flow | Useful evidence so far | Investment decision |
| --- | --- | --- |
| Performance | A historical Calorie trial selected a timed flow and verified an algorithmic improvement. At the largest stress input it saved about 1.041 ms per operation. Today's evaluator workload produced no actionable diagnosis after 14.7 s. | Use it selectively on representative, explicitly timed workloads. Do not assume a user-visible or agent-productivity benefit. |
| Review | In the historical synthetic set, dual review caught one extra low-severity label over Codex but added 53 findings and about 88 s per case. | Keep dual review opt-in. A real CodeVetter-versus-plain-agent comparison is still missing. |
| Testing | The current seeded bug fails twice and its known-good repair passes twice. | The oracle works. Whether CodeVetter catches failures ordinary agent testing misses remains unproven. |

The product earns a place when it catches a mistake the agent would otherwise
miss, verifies a repair the agent could not substantiate, or establishes a
useful performance change at acceptable overhead. Routine invocations and
passing fixtures do not demonstrate any of those incremental benefits.

## Current installed route

The inspected installed CLI is `codevetter 1.15.0`, reached by the user-level
launcher. The checkout HEAD was `e0d7dffb01977f2f53abafbe1471470084983835` and
was dirty before this work (`docs/seo-sprint.md`). The skill changes are also
uncommitted. Review preflight's clean-source refusal is expected and does not
constitute a review of the new skills.

Invoking performance through the launcher failed with:

```text
The packaged local performance runtime is unavailable
```

Running the same plan through the resolved application binary succeeded. The
packaged runtime exists. The shared skill recorder now canonicalizes the
executable before launch; its regression test covers the launcher path. The
installed app is unchanged. Direct launcher behavior remains a product bug;
[#348](https://github.com/Codevetter/codevetter/issues/348) records the gap.

## Current smoke evidence

| Operation | Observed result | What it proves |
| --- | --- | --- |
| Testing scope discovery | Ready, portfolio capped at 12 candidates; uncovered paths retained | Installed deterministic target-discovery path operates. Relevance still needs inspection. |
| Review preflight | Exit 2: clean immutable checkout required | Dirty source fails closed; no provider review or new-change correctness was assessed. |
| Performance plan through launcher | Exit 2: runtime unavailable | A launcher/resource-resolution usability failure. |
| Performance plan through skill recorder after repair | Admitted for bounded local zero-egress execution | The installed runtime is usable through canonical binary resolution. |
| Performance diagnosis | Runtime completed; diagnosis `no_confidence` | Profile capture works but did not establish an actionable hotspot. |
| Corpus readiness | 30/30 qualified tasks, 8 categories, API/browser and Node/TypeScript lanes | Evaluation corpus is structurally ready. |
| `preserve-explicit-false` qualification | Intended failure twice; known-good pass twice; cleanup complete | The synthetic acceptance oracle is repeatable. No coding agent took part. |

The performance workload was
`scripts/agent-task-corpus/evaluate-receipts.test.mjs`, target SHA-256
`ea8b68742f5b3327f0c2ecc5db798aaa22f0d550b0724ce3fa9d515469a6d4db`.
It ran on Darwin arm64 with Node v24.21.0. The configured sample policy was
three measurements and one warmup; the engine additionally ran metric and
independent profile passes. Canonical engine duration was **14,721 ms**.
Measurement wall times were 1,447–1,606 ms, median 1,581 ms, p95 1,606 ms.
Those are supervised workload samples, not an independent direct-run comparator.

The diagnosis returned `insufficient_source_evidence`: independent V8 profiles
disagreed on their leading application candidate. The result also disclosed
collection bounds. No optimization or speedup was claimed. Owned process-tree
sampling peaked at 244,875,264 bytes (about 233.5 MiB), but periodic 75 ms samples
may miss short-lived peaks. This workload is an evaluator contract suite, not a
representative application performance bottleneck.

Exact local invocation identities and receipt hashes:

```json
[
  {
    "invocation_id": "b587b87c-db99-4960-8cf8-65554e949abe",
    "skill": "codevetter-testing",
    "command": "scope",
    "operation": null,
    "state": "completed",
    "duration_ms": 165,
    "exit_code": 0,
    "receipt_sha256": "e086435134e768530628dcca536a5c7cd4359c82d1fecd755cb5cd6d9a6148e2",
    "assessment": "unassessed"
  },
  {
    "invocation_id": "f94cd5c6-a73c-4407-8c02-e1ff5a3aadec",
    "skill": "codevetter-performance",
    "command": "performance",
    "operation": "plan",
    "state": "failed",
    "duration_ms": 58,
    "exit_code": 2,
    "receipt_sha256": null,
    "assessment": "unassessed"
  },
  {
    "invocation_id": "b8de8313-08da-48fb-b892-5a9e8f4c291b",
    "skill": "codevetter-review",
    "command": "check",
    "operation": "preflight",
    "state": "failed",
    "duration_ms": 56,
    "exit_code": 2,
    "receipt_sha256": null,
    "assessment": "unassessed"
  },
  {
    "invocation_id": "c8500e48-069f-4671-83b5-0606e86ddde5",
    "skill": "codevetter-performance",
    "command": "performance",
    "operation": "plan",
    "state": "completed",
    "duration_ms": 162,
    "exit_code": 0,
    "receipt_sha256": "10852e6039ef521fbc0b2f4b05127cebcc1de732d761c65c325d3d432effe677",
    "assessment": "unassessed"
  },
  {
    "invocation_id": "840e8277-6447-4a03-9864-ba14cd12c9d6",
    "skill": "codevetter-performance",
    "command": "performance",
    "operation": "diagnose",
    "state": "completed",
    "duration_ms": 14756,
    "exit_code": 0,
    "receipt_sha256": "afa99cb0c29108349f48c714077ef5b64181d37259a3e12c8018c3fba558325c",
    "assessment": "unassessed"
  }
]
```

Private canonical receipts live beneath the CodeVetter skill-invocation app-data
folder. The synthetic testing qualification is retained locally at
`artifacts/skillification/testing-qualification.json`. These records are marked
`unassessed`; they are not counted as agent wins. The first failed smoke
records predate structured error classification; later failures use fixed safe
blocker codes without retaining raw stderr in metadata.

## Historical evidence relevant to investment

### Review

The human-reviewed September 2
[cross-review summary](cross-review-benchmark-2026-09-02.json) uses 27 synthetic
single-file cases and 29 defect labels. Codex caught 28/29 with 46 findings,
60.9% strict precision and 99.1 s mean review time. Dual review caught 29/29
with 99 findings, 29.3% strict precision and 187.5 s mean review time. Its one
additional caught label was low-severity dead code.

That comparison supports keeping dual review optional. Both strategies used
CodeVetter's pipeline; it is not a CodeVetter-versus-plain-agent ablation.
Provider usage was absent, and strict defect-only scoring penalized findings
outside the narrow labeled ground truth. Do not convert the comparison into
real-PR quality, productivity or cost claims.

### Performance

The historical [Calorie stress trial](../performance/calorie-exercise-guidance-2026-08-10.md)
reports a qualified paired algorithmic improvement at 35,000 history entries:
1.203 → 0.162 ms/op, a reduction of about 1.041 ms/op. The large relative gain
was useful measurement evidence, but typical user scale and visible latency
were unverified. There was no matched agent-without-CodeVetter arm.

The [Web Playables trial](../performance/old-local-projects-results-2026-08-09.md)
reports a paired workload improvement and an appropriately withheld shipping
recommendation at its limited sample floor. These historical records were read
from the checkout, not rerun against the current products.

### Testing

The owned synthetic corpus gives a repeatable hidden-check foundation for a
real with/without experiment. Its current qualification is not evidence that
CodeVetter improves a coding agent's repair rate over ordinary repository tests.

## Next resolving experiment

Use the same coding agent, version, task, immutable source, repository tools,
runtime and total time/attempt budget in independent fresh workspaces. Add only
one CodeVetter flow to the treatment arm. Include clean and bug-bearing cases,
randomized arm order, repeats and an A/A control. Keep all failed and blocked
attempts, and independently adjudicate review labels.

Primary outcomes: unique real defects caught with noise/misses, hidden
acceptance success after repair, and correctness-preserving paired performance
outcomes. Report extra tool/agent latency and measured cost. Predeclare a
keep/narrow/stop rule before new provider execution. The maintained
[evaluation protocol](../../skills/codevetter-evaluate/references/value-protocol.md)
owns these criteria.

## Delivery state

Four repo-owned skills have explicit implicit-invocation policy and non-overwriting
user-level links. The recorder's 13 contract tests pass, all four skill
validators pass, and independent forward-testing found no demonstrated
incremental agent benefit. It did find unrelated generated target candidates,
a retired QA preview preset and a duplicate-operation guard gap; selection
guidance and guard tests now cover these observed failures.

The native value dashboard remains unimplemented. The owner asked for a plain
explanation of value before further visual work. Its planned content is this evidence and future controlled
comparisons, with drill-down to every recorded skill invocation. It must not
substitute invocation counts for measured benefit.

## Automatic feedback follow-up

The owner explicitly requested automatic skill use with logging of help and
lack of help. Matching skills now require agents to complete the relevant
authorized flow and append a usefulness assessment before task handoff;
a controlled experiment is not a prerequisite to collecting these reports.

The logger supports evidence-bound `helped`, `did_not_help`, `inconclusive`
and `blocked` reports, labeled `agent_reported` and not independently verified.
The originating invocation/receipt remains unchanged; listing projects the
latest appended report. Measured time is retained and unknown cost stays null.

Three actual smoke records now have closing feedback: admitted plan
`c8500e48-069f-4671-83b5-0606e86ddde5` helped establish the bounded execution
route; diagnosis `840e8277-6447-4a03-9864-ba14cd12c9d6` did not identify an
actionable hotspot after 14.7 seconds; review preflight
`b8de8313-08da-48fb-b892-5a9e8f4c291b` was blocked by dirty source. These are
specific operational observations, not three independently proven agent wins.

## Detailed logging follow-up

New recordings include opaque task/parent IDs, originating agent, Git HEAD and
dirty-state disclosure, executable/recorder hashes, platform/runtime and
supervision bounds. Context collection overhead is measured separately; dirty
contents and raw arguments are excluded. Filtered lists retain matching totals;
detail inspection includes assessment history and checks receipt hashes. A JSON
pointer can retrieve only the needed canonical field. Legacy context stays unknown.

Actual task `b338c9f9-1a6d-43cc-81d0-362764fbbe9f` contains failed attempt
`939bb681-a1ef-4245-ad42-9281219c86ee` and linked retry
`16d79306-8e0c-4f63-aa48-c8cc1c8e49b3`. The first exposed an overly restrictive
recorder schema guard: scope uses numeric schema versions. It remains recorded
and assessed as blocked; the guard now accepts bounded numeric/string versions.
The retry retained canonical receipt SHA-256
`c7628fddb534fa2a67241cccefd3b28ddb570e8ca5fc1812e12cdbbcf0442f5a` and is assessed
`did_not_help`: discovery suggested unrelated Node targets for Python recorder
tests. No discovered candidate was executed. Focused unittest qualification is
separate from CodeVetter activity or benefit.

Hash-checked field access also reloaded the earlier diagnosis's `/result/verdict`
as `no_confidence`. Thirty-six logger tests cover these contracts, including
numeric scope schema compatibility. No new agent-productivity benefit is inferred.
Qualification also reproduced a macOS process-group signalling denial that
could leave a run marked `running`. Owned-process fallback now preserves
terminal metadata and discloses the supervision limitation; its focused
regression and 30 bounded-output repetitions passed.
