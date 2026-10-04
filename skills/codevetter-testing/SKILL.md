---
name: codevetter-testing
description: Verify coding-agent changes with CodeVetter when reproducing a bug, testing changed browser or API behavior, or checking a proposed fix against acceptance criteria. Preserve exact source, target and runtime evidence.
---

# CodeVetter Testing

Use this skill to connect a task and exact agent change to executable test evidence. Keep the repository's existing test runner and CodeVetter's canonical receipt semantics.

## Automatic use

Load this skill when the coding-agent task calls for runtime verification, failure reproduction or fix validation, without waiting for the user to name CodeVetter. Complete the relevant authorized flow and its [use-and-log loop](../codevetter-evaluate/references/usage-loop.md); do not stop at discovery if the requested workload can run.

## Select the smallest relevant check

Read repository instructions and existing test/config files. Inspect `codevetter --version` and `codevetter --help` once. Discover targets without execution through the shared [recorder](../codevetter-evaluate/scripts/invoke.py): `--skill codevetter-testing --repo <repo> --` followed by:

```text
scope --consumer testing --change <base..head> --json
scope --consumer testing --flow <behavior> --json
qa --operation inspect --json
```

Use either change or flow discovery as appropriate, not both by default. Discovery is candidate coverage, not passing evidence. Name the exact test, acceptance criterion, source revision and expected result. Preserve missing coverage.

Inspect the selected file and verify that it exercises the requested behavior before execution. Reject generated/dependency targets (`.build/checkouts`, `node_modules`, vendored snapshots and build outputs), unrelated high-confidence matches, and stale legacy preview presets. Discovery confidence is a heuristic, not relevance proof; obtain the current preview from the user or repository evidence.

## Choose the existing execution lane

- Existing unit/API test: run the repo's smallest relevant command. When an integrated review is requested, bind that target into `codevetter check --preflight`, then execute the same check with an explicitly selected provider. The installed CLI has no standalone `codevetter test` command; do not invent one or invoke performance diagnosis as a correctness verdict.
- Existing deployed preview: `trex --range <base..head> --preview <url> --json` runs bounded generic smoke journeys. Preview must be supplied and authorized; preserve claimed versus verified deployment identity. A smoke pass does not verify the task's full behavior.
- Repository-owned browser verification: inspect `warm --operation status` or prepare `differential --operation prepare --reference <revision> --candidate <kind>` before starting anything. These flows need the repository-owned verify entry point and supported lockfile. Use current help/source contracts for operation-specific fields rather than guessing.
- Scenario authoring: use `scenario --operation inspect` first; generation creates candidates. Acceptance and cleanup are separate explicit actions.

Record each CodeVetter command through the shared recorder with `--json`. Ordinary repository test commands retain their native reports; do not relabel them as CodeVetter invocations.

For native CodeVetter development use `pnpm test:native:background`. Local browser or native execution that can launch apps or take focus requires fresh idle-screen authorization under CodeVetter's AGENTS.md. Do not start preview browsers, watchers, daemons, installs, or foreground automation on implicit invocation alone. Watcher polling can post statuses and is outside the ordinary testing flow.

## Report the result

Separate reproduced failure, passing acceptance check, operational failure, stale source, and unavailable runtime. Link the canonical receipt and native test report, retaining reruns and artifacts. A fix claim needs a failing-before/passing-after check against the same acceptance contract; a green build is insufficient. For incremental value versus plain testing, follow [codevetter-evaluate](../codevetter-evaluate/SKILL.md).

## Close the usefulness log

Before handing the task back, assess each recorded invocation as `helped`, `did_not_help`, `inconclusive` or `blocked` through the [closing log](../codevetter-evaluate/references/usage-loop.md). Explain the concrete contribution or lack of it, cite receipt pointers, and preserve the added runtime. This is agent-reported usefulness, not independently established productivity. Log negative and blocked results as reliably as positive ones.
