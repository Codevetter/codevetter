---
name: codevetter-evaluate
description: Evaluate whether CodeVetter adds value to coding agents when asked for usefulness, ROI, with-versus-without comparisons, review catch rate, testing effectiveness, or performance-verification outcomes. Separate product value from usage and fixture qualification.
---

# CodeVetter Value Evaluation

Use this skill to answer whether CodeVetter's review, testing and performance flows improve agent outcomes enough to justify their overhead. A candid negative or inconclusive result is useful. Do not expand into a general usage dashboard.

## Establish the evidence level

Inspect the requested repository, exact task, available canonical receipts and comparator evidence. Use the shared [invocation recorder](scripts/invoke.py) for CodeVetter commands; it saves local invocation identity and canonical JSON, never assigns benefit credit. Read [the evaluation protocol](references/value-protocol.md) for actual with/without experiments or dashboard interpretation.

```bash
python3 <skill-directory>/scripts/invoke.py --skill codevetter-evaluate --repo <repo> -- runs --limit 100 --json
python3 <skill-directory>/scripts/invoke.py --list --repo <repo> --limit 50
```

The run list is bounded; do not treat its latest 100 records as a complete lifetime count. The recorder's list is paginated with `--offset` and reports its total matching invocation count. It covers commands run through these skills, not all historical CLI, MCP, desktop or repository-test activity.

Reuse an opaque `--task-id` for related calls and pass the originating `--agent` as described in the [use-and-log loop](references/usage-loop.md). Filter by task, skill, state or usefulness. Use `--show <invocation-id> --pointer <JSON-pointer>` for surgical, hash-checked receipt access; omit `--pointer` for source/execution context and assessment history. Missing legacy context remains unknown.

## Close the feedback loop

The user authorizes automatic use of matching review, testing and performance skills and logging how they help or do not help. Follow the [use-and-log loop](references/usage-loop.md): complete an authorized relevant flow, assess every invocation, and include a plain contribution/lack-of-contribution sentence in the task handoff. Do not require a controlled experiment before collecting agent-reported usefulness; keep those observations separate from independently demonstrated benefit.

Use `scripts/invoke.py --assess <id> --outcome <outcome> --reason <code> --summary <explanation> --evidence-pointer <pointer>` to append an assessment. `helped` requires nonempty hash-bound canonical evidence. The list projection includes the latest assessment and retains all revisions locally. No assessment leaves `unassessed`, making an incomplete logging loop visible.

## Reuse CodeVetter's existing scorers

When working in the CodeVetter checkout, read only the relevant canonical procedure:

- Review: `docs/development/benchmark.md`, `scripts/run-catch-rate-benchmark.mjs` and `scripts/run-cross-review-benchmark.mjs`. Rescoring saved output is offline; fresh cross-review runs invoke providers. `--agent cross` comparisons test review strategy, not CodeVetter-versus-plain-agent productivity. Keyword matching is provisional until independently adjudicated.
- Testing / agent outcomes: `docs/development/agent-task-corpus.md` and the `corpus:plan`, `corpus:run`, `corpus:evaluate` commands. Qualification establishes repeatable baseline failure/known-good success. It does not establish a benefit to agents. Respect the runner's exact plan and paid-approval boundaries.
- Performance: `docs/development/performance.md` and the paired performance-verification receipt. Separate a measured workload outcome from the causal effect of CodeVetter on producing it.

Choose existing scorer contracts before adding a new scorer. Missing comparator, task binding, outcomes or cost remains missing; incomplete and failed attempts belong in the denominator with their original status.

## Report and decide

Report separately: observed invocations; reproduced runtime failures; independently adjudicated review defects/false positives/misses; acceptance outcomes; qualified paired performance verdicts; incremental with/without result; wall time and measured cost. Fixture qualification and historical source evidence are labeled explicitly. No fixture score counts as a real-user win.

Lead with a plain statement of what CodeVetter caught or verified, what changed because of it, and the measured overhead. Put the current demonstrated benefit and missing comparison before implementation or dashboard details. Do not require the owner to review visual directions to understand value.

Recommend keep, narrow/change, or stop based on the evidence and predeclared decision rule. Where value is inconclusive, name the smallest experiment that can resolve it. Never sum findings, green tests, scans and plans into a benefit count; never equate use with value.
