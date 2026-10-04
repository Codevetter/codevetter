---
name: codevetter-review
description: Review coding-agent changes with CodeVetter when asked to review a diff or PR, check task acceptance, or detect defects. Plan exact source and executable checks before provider-backed review.
---

# CodeVetter Review

Use this skill to review an agent-authored change against the task that motivated it. Use the installed `codevetter` CLI; do not replace its review or verdict logic with a model assessment.

## Automatic use

Load this skill for a matching coding-agent review without waiting for the user to name CodeVetter. Run the relevant check within the task's authorized scope, then complete the [use-and-log loop](../codevetter-evaluate/references/usage-loop.md). Do not leave a runnable requested check at preflight only.

## Start with the exact task

Read the target repository's instructions and identify the requested change, intended behavior, and acceptance criteria. Inspect `codevetter --version` and `codevetter --help` once; missing CLI is unavailable, not an implicit install. Resolve a supplied PR or Git range without checkout, commit or fetch. An uncommitted change is inspectable but is not a substitute for the engine's clean committed-source contract.

Run the shared [invocation recorder](../codevetter-evaluate/scripts/invoke.py) with `--skill codevetter-review --repo <repo> --` before the CLI arguments. It records telemetry only, not benefit claims. Use `--json` on every recorded command.

```text
check --range <base..head> --task <intended-behavior> --preflight --json
scope --consumer testing --change <base..head> --json
```

Preflight validates source and targets without model or project execution. Bind a relevant existing test with `--test-adapter <adapter> --test-target <relative-path>` and, where useful, `--test-name <exact-name>`. Add `--spec <relative-markdown>` and `--requirement <id>` only when acceptance requirements exist. Preserve uncovered requirements explicitly.

## Execute and assess

When the requested review authorizes the selected configured provider and project checks, run the same `check` input without `--preflight` and with an explicit `--agent claude|codex|gemini`. Keep `cross` opt-in: the repository's prior synthetic comparison found substantial latency and finding burden for one additional low-severity label. Do not switch executors silently or interpret implicit skill selection as provider approval.

Read each runtime stage, source qualification, manifest coverage, finding identity and limitation. A source-qualified review finding is a lead; a passing review does not prove correctness. Do not turn failed or absent checks into a pass. Return the exact change identity, unique actionable findings, executable evidence, missing coverage, receipt reference and next check. Do not execute an isolated fix, publish X-Ray, or post a GitHub status as part of ordinary review.

## Measure usefulness

For a value comparison, use [codevetter-evaluate](../codevetter-evaluate/SKILL.md). Count independently adjudicated true/false findings and misses on the same change; keep review noise and elapsed/cost overhead visible. Number of findings is not value.

## Close the usefulness log

Before handing the task back, assess each recorded invocation as `helped`, `did_not_help`, `inconclusive` or `blocked` through the [closing log](../codevetter-evaluate/references/usage-loop.md). Explain the concrete contribution or lack of it, cite receipt pointers, and preserve the added runtime. This is agent-reported usefulness, not independently established productivity. Log negative and blocked results as reliably as positive ones.
