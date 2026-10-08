---
title: Agent workflow skills
description: Selective CodeVetter review, testing and performance skills, local invocation evidence, and product-value evaluation.
---

# Agent workflow skills

CodeVetter provides three execution-oriented skills and one evaluation skill.
Agents use the matching skill automatically when the task fits, complete the
relevant authorized flow, and log whether it helped before handing the task
back. A runnable requested check should proceed beyond discovery/planning.
Selection does not authorize every execution mode in the skill.

| Skill | Use it for |
| --- | --- |
| [codevetter-review](https://github.com/Codevetter/codevetter/blob/main/skills/codevetter-review/SKILL.md) | Exact agent change, acceptance binding, preflight and qualified review evidence. |
| [codevetter-testing](https://github.com/Codevetter/codevetter/blob/main/skills/codevetter-testing/SKILL.md) | Failure reproduction and changed browser/API behavior with explicit coverage. |
| [codevetter-performance](https://github.com/Codevetter/codevetter/blob/main/skills/codevetter-performance/SKILL.md) | Workload planning, bounded diagnosis and paired optimization verification. |
| [codevetter-evaluate](https://github.com/Codevetter/codevetter/blob/main/skills/codevetter-evaluate/SKILL.md) | Whether these flows improve agent outcomes enough to justify their overhead. |

The tracked sources live in `skills/`. The CodeVetter plugin bundles these
same sources and their recorder; it is the preferred distribution path.
Standalone user-level installation uses
links to those sources; an existing unrelated skill must never be overwritten.
Install them with `pnpm skills:install`; `--destination` on the underlying
script can select an isolated skill directory. The installer checks every
collision before creating links and refuses to replace unrelated state.
A new Codex session may be needed for its skill inventory to discover the
installation. The current conversation can load the source files explicitly.
The `agents/openai.yaml` files keep implicit invocation enabled.

## CodeVetter plugin

Build a new local marketplace package, without overwriting an existing one:

```bash
pnpm plugin:build --output artifacts/codevetter-plugin-local
codex plugin marketplace add ./artifacts/codevetter-plugin-local
codex plugin add codevetter@codevetter-local --json
```

The builder copies an explicit public file allowlist into
`plugins/codevetter` inside that output directory. It includes portable and
Codex compatibility manifests, four skills, recorder dependencies and a local
stdio MCP bridge. It omits tests, caches, private artifacts, repository code
and dependency directories. Sources must be regular files, never symlinks.
`package-receipt.json` binds each packaged file to its SHA-256.
Keep the marketplace directory for refreshes. For an update, increment both
manifest versions together and build a new directory. Codex refuses to add
the same marketplace name from a different source: remove its registration
with `codex plugin marketplace remove codevetter-local`, register the new
directory, then run the install command again. This does not delete the old
package or the invocation ledger. Do not overwrite a qualified package.

The local plugin requires Python 3 and the installed CodeVetter CLI; it does
not bundle the desktop application or install dependencies. No provider key
or remote server is needed for its MCP tools. Local stdio is for compatible
local clients, not a hosted ChatGPT connector or public directory submission.
The install command uses Codex's plugin manager rather than editing settings.
Start a new session after installation to discover its tools and skills.
Implicit selection remains host/model behavior and must be evaluated on real
tasks; package qualification alone does not prove automatic selection.

The bridge exposes `discover_targets`, `plan_performance`,
`list_invocations`, `inspect_invocation` and `assess_invocation`.
Discovery and planning launch only those fixed CLI operations, with a
60-second recorder timeout; project/runtime/provider execution remains in the
existing authorized skill flows. There is no arbitrary command, executable,
ledger override or lifecycle hook in the tool input schema. Planning targets
must stay within the supplied repository. The local bridge serializes calls;
long execution and background jobs are deliberately not exposed through it.

CLI attempts use the existing recorder and ledger, including launch failures
and negative assessments. Ledger inspection and assessment do not fabricate
new verification runs. Existing standalone installation and receipts remain
compatible. When both skill sources are visible, follow one workflow and run
each command once; do not count the two installation paths as two invocations.
Use the shared [use-and-log procedure](https://github.com/Codevetter/codevetter/blob/main/skills/codevetter-evaluate/references/usage-loop.md)
for transport selection and closing feedback.

## Invocation evidence

The shared [recorder](https://github.com/Codevetter/codevetter/blob/main/skills/codevetter-evaluate/scripts/invoke.py)
launches the existing installed CLI without a shell. It resolves a launcher
symlink to the executable before launching, so bundled runtime resource lookup
works. It does not patch the installed application or change its permissions.

Example, run from the target repository:

```bash
python3 <skill-directory>/../codevetter-evaluate/scripts/invoke.py \
  --skill codevetter-performance --repo "$PWD" -- \
  performance --operation plan --adapter node-test \
  --target <repository-relative-test> --json
```

The recorder stores private per-invocation metadata and canonical JSON in
`~/Library/Application Support/CodeVetter/skill-invocations/` on macOS, or
`~/.local/share/codevetter/skill-invocations/` elsewhere. `--ledger-dir` selects
an isolated destination for qualification. It stores no argument values or
raw stderr in the summary index; fixed allowlisted blocker codes explain
recognized failures. Full canonical receipts remain local evidence.
The CLI's existing receipt redaction remains authoritative.

Records include originating skill, repository, command/operation, timestamps,
wall duration, wrapper and CLI exit status, state, receipt path and SHA-256.
Failed launch, timeout, interruption, invalid output and completed attempts
remain separate states. Benefit assessment starts as `unassessed`.
New records add opaque task and parent invocation IDs, an explicitly supplied
originating agent, receipt schema identity, and execution context. Context
includes Git HEAD and dirty-state disclosure before/after, CLI executable and
recorder-source hashes, platform, architecture, Python version, capture bound
and outer timeout. Context collection duration is measured separately from
supervised CLI duration; both contribute overhead. Dirty contents are not
captured, so dirty-state observations cannot establish exact source identity.
Unknown or absent historical context stays unknown; it is not backfilled.

Generate a task UUID once and reuse recorder flags `--task-id <uuid> --agent
codex` across the task. Link dependent calls using `--parent-id <invocation-id>`;
the parent must belong to the same repository and task. Keep retries as separate
invocations. Full task prompts and private labels never become correlation IDs.

```bash
python3 <evaluate-skill-directory>/scripts/invoke.py \
  --list --repo "$PWD" --offset 0 --limit 50
```

The list reports total matching records and supports pagination. It covers
skill-mediated commands only. Direct CLI calls, desktop runs, MCP inspection
and ordinary repository tests are not fabricated as skill invocations.
Unreadable metadata is disclosed separately. A crashed recorder may leave a
`running` record; it does not become a successful terminal invocation.

The recorder has a 2 MiB receipt capture bound and a default 20-minute outer
timeout. Engine workload timeouts remain independently enforced. Incomplete
or oversized output is not retained as a canonical receipt. Cleanup and
workspace mutations use their separately authorized product flows.
If process-group signalling is denied, the recorder signals its owned CLI
process and discloses that fallback in `supervision_warnings`; descendant
termination is not inferred from that fallback. Terminal metadata is retained.

## Surgical evidence access

Filter the list by `--task-id`, `--skill`, `--state`, or `--assessment-filter`.
`total` counts matching records before pagination, including failed attempts
and unassessed records where they match. Unreadable metadata stays explicit.

```bash
python3 <evaluate-skill-directory>/scripts/invoke.py \
  --list --task-id <task-uuid> --skill codevetter-performance \
  --assessment-filter did_not_help --offset 0 --limit 50

python3 <evaluate-skill-directory>/scripts/invoke.py \
  --show <invocation-id>

python3 <evaluate-skill-directory>/scripts/invoke.py \
  --show <invocation-id> --pointer /result/diagnosis
```

Full detail includes the original invocation, canonical receipt and retained
assessment revisions, newest first. Field inspection returns only the requested
receipt field, pointer and receipt identity. JSON pointer escaping and array
indices are supported; empty values remain inspectable. Both modes check saved
receipt bytes against the originating SHA-256 before returning evidence. Changed,
missing or symlinked evidence fails explicitly. A run that never captured a
receipt remains inspectable as metadata with `receipt_integrity: not_recorded`.

Integrity establishes which recorded bytes were read, not whether an agent's
usefulness claim is correct. The list is a lightweight projection; use detail
inspection when verifying evidence integrity. Raw command argument values,
environment variables and raw stderr remain excluded. Unknown operation names
are summarized as `unrecognized` rather than retaining arbitrary values.

## Closing the usefulness log

Every recorded invocation needs a closing assessment: `helped`, `did_not_help`,
`inconclusive`, or `blocked`. Explain what it contributed, what the agent did
with the result, or why it added no useful result. The maintained
[use-and-log procedure](https://github.com/Codevetter/codevetter/blob/main/skills/codevetter-evaluate/references/usage-loop.md)
owns the exact command and outcome meanings.

```bash
python3 <evaluate-skill-directory>/scripts/invoke.py \
  --assess <invocation-id> --outcome did_not_help \
  --reason unactionable_result \
  --summary 'The diagnosis did not identify an actionable source hotspot.' \
  --evidence-pointer /result/diagnosis
```

Positive reports require nonempty evidence pointers into a hash-matching
canonical receipt. Failed checks can provide useful reproduction evidence;
unavailable, interrupted, timed-out and output-limited runs cannot be reported
as helped. Operational blockers without receipts can still be logged. Empty
explanations and unresolved/changed evidence are rejected.

Assessments append without modifying originating receipts or previous
assessments. Listing projects the latest assessment and retains unassessed
records, making missing feedback visible. Entries retain measured invocation
duration and explicitly unavailable cost. They are `agent_reported`, with
`independently_verified: false`; they are feedback from actual use, not an
independently established productivity result. Never count all positive
observations as unique task wins.

## Selective use

Review starts with exact task/source preflight and target discovery. Provider
execution remains explicit; dual review stays opt-in. Testing keeps the
project's existing runner and reports uncovered acceptance behavior. Installed
CodeVetter has no standalone `test` subcommand. Performance starts with an
exact workload plan and requires qualified paired evidence for speedup claims.

Browser execution that can launch apps or take focus follows the repository's
fresh idle-screen authorization rule. Watchers can post statuses; they are not
part of ordinary implicit testing. These skills do not introduce new provider,
MCP, publishing, deployment, cleanup or secret-reading authority.

## Evaluate the value

The [evaluation protocol](https://github.com/Codevetter/codevetter/blob/main/skills/codevetter-evaluate/references/value-protocol.md)
compares the same agent with and without one CodeVetter flow under matched
source, task, runtime and total attempt/time budgets. It uses independently
adjudicated review outcomes, hidden acceptance checks and canonical paired
performance verdicts. Keep false positives, missed bugs, unavailable evidence,
extra elapsed time and measured cost visible.

An invocation is activity. A test receipt is evidence for a check. A measured
workload speedup is a code outcome. Improved agent productivity requires a
controlled task-level comparison. These facts must remain separate in the
planned Runs dashboard.

[Issue #348](https://github.com/Codevetter/codevetter/issues/348) owns the
skillification and value-dashboard work. The dashboard is not implemented; the owner requested plain evidence of value
before further visual work. The usefulness log operates without a dashboard. Current evidence and
limits are recorded in the
[value baseline](https://github.com/Codevetter/codevetter/blob/main/evidence/verification/codevetter-value-baseline-2026-10-02.md).
The completed [Fleet performance trial](https://github.com/Codevetter/codevetter/blob/main/evidence/performance/fleet-performance-skill-trial-2026-10-02.md)
records all 43 project outcomes, including blockers and a disputed source
recommendation. The [testing-speed study](https://github.com/Codevetter/codevetter/blob/main/evidence/performance/testing-speed-study-2026-10-02.md)
prioritizes measured experiments; neither report establishes agent productivity.

## Qualification

```bash
pnpm test:agent-skills
pnpm test:agent-plugin
python3 -m unittest discover \
  -s skills/codevetter-evaluate/scripts -p 'test_*.py'
```

Recorder contracts cover concurrent identity, pagination, failed launch,
failed receipts, invalid output, timeout, interruption, private-file modes,
argument exclusion, launcher resolution and protected cleanup boundaries.
Detail contracts cover task/parent correlation, filtered pagination, source
changes, executable identity, legacy unknowns, assessment revisions, empty and
escaped pointer fields, and rejection of changed or unsafe evidence.
The skill-creator validator checks each skill's metadata and scaffold state.
These gates do not establish product value or general automatic-selection
accuracy. Live planning smoke uses the installed CLI and retains both failed
and successful invocations.
