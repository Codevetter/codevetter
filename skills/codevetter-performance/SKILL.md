---
name: codevetter-performance
description: Measure or investigate performance with CodeVetter when asked to profile an agent change, investigate a slowdown, benchmark a workload, or verify an optimization. Require same-workload paired evidence for improvement claims.
---

# CodeVetter Performance

Use this skill for bounded local workload measurements and supported optimization claims. CodeVetter owns workload admission, samples, warmups, cleanup, comparisons and verdicts; do not recreate its grader.

## Automatic use

Load this skill when the coding-agent task calls for performance investigation or optimization verification, without waiting for the user to name CodeVetter. Complete the relevant authorized flow and its [use-and-log loop](../codevetter-evaluate/references/usage-loop.md); do not stop at discovery if the requested workload can run.

## Identify the workload

Read repository instructions and the existing benchmark or performance-sensitive test. Inspect `codevetter --version` and `codevetter --help` once. Use the shared [recorder](../codevetter-evaluate/scripts/invoke.py) with `--skill codevetter-performance --repo <repo> --` followed by one appropriate discovery command:

```text
scope --consumer performance --flow <behavior> --json
scope --consumer performance --change <base..head> --json
```

Select a contained existing target, supported adapter (`node-test`, `node-script`, `vitest`, `playwright`, `go-bench`) and exact workload name where needed. Plan before execution:

```text
performance --operation plan --adapter <adapter> --target <relative-path> --json
```

Target discovery and a successful plan are not performance results.

Inspect the selected file and verify that it exercises the requested behavior before execution. Reject generated/dependency targets (`.build/checkouts`, `node_modules`, vendored snapshots and build outputs), unrelated high-confidence matches, and stale legacy preview presets. Discovery confidence is a heuristic, not relevance proof; obtain the current preview from the user or repository evidence.

## Measure and compare

When local workload execution is authorized, use `performance --operation diagnose` with the exact planned adapter/target. Keep sample/warmup/timeout bounds explicit. Use `--samples 3 --warmups 1 --timeout-ms 30000` as an example, not a calibrated policy for every workload. Browser workloads require fresh foreground authorization when they can launch apps or take focus. Do not send production load or install missing prerequisites implicitly.

For an optimization, provide a clean baseline checkout and the same workload:

```text
performance --operation verify-paired --adapter <adapter> --target <relative-path> --baseline-repo <clean-baseline> --samples 3 --warmups 1 --timeout-ms 30000 --json
```

Use `performance --operation inspect --subject-run-id <recorded-id> --json` to reload recorded runtime evidence. Preserve engine rejection, no-confidence and regression classifications; exit zero or a faster wall-clock sample alone is not improvement proof. Record hardware/runtime, exact revisions, workload identity, sample distributions, cleanup, process-tree resource coverage and all limitations. Periodic RSS sampling can miss peaks. Confirm correctness separately before recommending the candidate.

## Judge the benefit

An exact-workload speedup is a measured code outcome. It does not establish that CodeVetter improved agent productivity. Use [codevetter-evaluate](../codevetter-evaluate/SKILL.md) to compare the agent's outcome with and without CodeVetter evidence, including extra elapsed time, finding burden and available cost. Never invent developer time saved.

## Close the usefulness log

Before handing the task back, assess each recorded invocation as `helped`, `did_not_help`, `inconclusive` or `blocked` through the [closing log](../codevetter-evaluate/references/usage-loop.md). Explain the concrete contribution or lack of it, cite receipt pointers, and preserve the added runtime. This is agent-reported usefulness, not independently established productivity. Log negative and blocked results as reliably as positive ones.
