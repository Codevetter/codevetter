---
name: codevetter-local-verification
description: Verify whether a coding agent completed a local software task using CodeVetter's packaged CLI, executable checks, and portable evidence. Use when CodeVetter is already installed and the user asks for an evidence-backed verdict on one exact PR or Git range.
---

# CodeVetter local verification

Use CodeVetter to answer a bounded question: did one coding-agent change satisfy
its stated task, and what executable evidence supports the answer?

## Before running

- Confirm the local `codevetter` binary is available with `codevetter --version`.
- Do not install an npm package named `codevetter`; no official npm package is
  currently published.
- Work from a clean local checkout at the exact change head. Do not push, merge,
  deploy, install project dependencies, or edit the repository as part of a
  verification run.
- Preserve the user's task wording. If the acceptance boundary is unclear,
  report the ambiguity instead of silently choosing an easier interpretation.

## Run one bounded check

Use exactly one pull request or Git range and request the canonical JSON receipt:

```bash
codevetter check \
  --repo /absolute/path/to/repository \
  --range main...HEAD \
  --task "Describe the expected behavior" \
  --json
```

Use `--pr <canonical GitHub PR URL>` instead of `--range` when the user supplies
a pull request. Add explicit test or performance targets only when the target
is already known and reproducible; otherwise let CodeVetter report the best
qualified local evidence it can discover.

## Interpret the receipt

- Treat `pass`, `fail`, and `unverified` as distinct outcomes.
- A pass applies only to the recorded task, revision, environment, and checks.
- Do not replace missing, skipped, stale, or irrelevant evidence with model
  confidence.
- Keep review findings separate from execution results. Findings are leads;
  task-relevant executable checks establish the verdict boundary.
- Report the exact source identity, checks that ran, failures, limitations, and
  next action. Preserve the machine-readable receipt for later comparison.

## Local MCP boundary

CodeVetter also packages a read-only stdio MCP sidecar for repository graph,
history, prior-review, and preparation evidence. Enable it only through
**Settings → Agent MCP** and copy the machine-specific configuration shown by
the app. The MCP sidecar does not execute verification, modify the repository,
or expose a hosted HTTP service.

Product truth and evidence formats: https://codevetter.com/llms.txt
