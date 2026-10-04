# Automatic use and the closing usefulness log

For a task matching review, testing or performance, invoke the matching skill without waiting for the user to mention CodeVetter. Proceed through the relevant existing execution flow within the task's authorization; do not stop at a plan when the requested check can run. Reuse the configured executor and existing targets. Skill selection still does not authorize a new provider purchase, foreground automation, publishing or a watcher status update.

Choose one useful bounded flow rather than running every tool after every edit. Use exact source/task targets and retain failures. When a runtime cannot run, log the blocker rather than silently omitting CodeVetter or stopping all independent work.

Run CodeVetter through `scripts/invoke.py` in the evaluate skill directory. Generate one opaque task UUID for this task (for example, `python3 -c 'import uuid; print(uuid.uuid4())'`) and reuse it with recorder flags `--task-id <uuid> --agent <codex|claude|gemini|other>`, before the `--` separator. Do not use the prompt or a private task title as an identifier. For a follow-up call based on a preceding result, add `--parent-id <preceding-invocation-id>` in the same repository/task. A retry is a new invocation; retain its predecessor and assessment rather than overwriting it.

The recorder automatically captures Git HEAD/dirty disclosure before and after execution, CLI and recorder fingerprints, platform/runtime identity and supervision limits. Dirty file contents are not captured; the engine's canonical source qualification still determines whether a result maps to immutable source. Context collection time is recorded separately from supervised CLI duration. Unknown source, cost, or historical context must stay unknown.

Each invocation prints its identity to stderr. Inspect its canonical result and finish with an assessment before handing the task back:

```bash
python3 <evaluate-skill-directory>/scripts/invoke.py \
  --assess <invocation-id> \
  --outcome <helped|did_not_help|inconclusive|blocked> \
  --reason <reason-code> \
  --summary '<what it changed or failed to add>' \
  --evidence-pointer <pointer-into-the-canonical-receipt>
```

`--evidence-pointer` is repeatable and must resolve to nonempty data in the saved receipt. `helped` requires such evidence. Failed runtime results can still help by reproducing a bug; a complete failed check is different from an unavailable or interrupted execution. Operational blockers without a receipt can be assessed without a pointer. Changed receipt bytes reject assessment. Revisions append to the assessment history rather than altering the originating receipt.

| Outcome | Meaning | Example explanation |
| --- | --- | --- |
| `helped` | The agent observed a concrete useful contribution to this task | “The runtime reproduced the reported failure and supplied the exact failing assertion for the repair.” |
| `did_not_help` | It ran but added no useful result for this task | “The diagnosis took 14.7 seconds and did not identify an actionable source hotspot.” |
| `inconclusive` | Evidence is insufficient to judge usefulness | “The preview passed smoke checks, but its revision was only claimed and the requested acceptance flow was not covered.” |
| `blocked` | The useful flow could not execute | “Review could not run because the checkout is dirty; no defect assessment was produced.” |

Reason codes: `bug_caught`, `missing_test_found`, `fix_verified`, `performance_measured`, `regression_detected`, `unsupported_claim_rejected`, `target_discovered`, `duplicate_information`, `noise`, `unactionable_result`, `setup_blocked`, `incomplete_evidence`, `other`.

The explanation must say what CodeVetter contributed and what the agent did with it, or why it provided no useful contribution. For discovery, log whether the selected target was actually relevant. For review, distinguish a useful lead from an independently verified defect. For testing, distinguish a reproduced failure from a verified fix. For performance, preserve the engine's actual diagnosis/comparison verdict. Do not call a plan, clean exit or number of findings a task win.

Each assessment is explicitly `agent_reported` and `independently_verified: false`. This is the feedback needed to start learning from real use; independent adjudication and controlled experiments are a separate evidence level. Record measured duration automatically and leave cost unavailable when the engine did not expose it. Do not invent “time saved,” prevented incidents, or a with/without result.

Do not put credentials, prompts, raw provider output or full source excerpts into the explanation. A short task-specific sentence plus receipt pointers is enough. Return that sentence to the user with the actual result; they should not need to open a dashboard to understand whether this invocation helped.

For follow-up diagnosis, use `--list --task-id <uuid>` to find the task's invocations; `--skill`, `--state`, and `--assessment-filter` narrow that list without changing pagination totals. `--show <invocation-id>` returns the retained receipt, context and assessment history. Add `--pointer /result/<field>` to return only that canonical evidence field after checking its receipt hash. Read [agent skill operations](../../../docs/development/agent-skills.md) for examples and coverage limits.
