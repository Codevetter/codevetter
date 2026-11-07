---
title: Surfaces and navigation
description: The native verification workbench and its shared CLI and MCP contracts.
sidebar:
  order: 2
---

# Surfaces and navigation

The native app uses one persistent macOS split-view shell.
Every page shares the same header, content width, spacing scale, evidence
language, loading/empty/error treatment, and keyboard-sized click targets.

| Section | Native source | Primary result |
|---|---|---|
| Explore | `NavigatorWorkspaceView.swift` | Read-only Git source, fuzzy file search, indexed search, declarations, history, and integrated Unpack. |
| Review | `NavigatorWorkspaceView.swift`, `PremiumWorkbench.swift` | Pinned GitHub/local diffs and exact source links, alongside the existing executable verification and handoff receipts. |
| Testing | `PremiumTestingView.swift` plus focused testing views | Preview, changed verification, scenarios, differential runs, warm verification, and opt-in PR watchers. |
| Performance | `PremiumPerformanceView.swift` | Exact local workload, baseline/candidate measurements, limits, cleanup, and optimization verdict. |
| Runs | `PremiumInvocationRunsView.swift`, `PremiumWorkbench.swift` | Explicit skill invocation history and integrity inspection; saved verification receipts remain separate. |
| Settings | `PremiumSettingsView.swift` | Accounts, agents, MCP, rubrics, memories, history roots, updater/about, and other configuration. |

The app source lives in
`apps/macos/CodeVetterPackage/Sources/CodeVetterFeature/`. `ContentView.swift`
owns navigation; `PremiumPageHeader.swift` and `EvidenceStyle.swift` own the
shared page grammar.

## Synchronized interfaces

The native UI uses the bundled `codevetter` executable. Humans and agents can
call the same CLI directly, while `codevetter-mcp` publishes bounded read-only
projections. Rust-owned schema versions and semantics are shared across all
three; the SwiftUI client does not reimplement verdicts.

Typical entry point:

```bash
codevetter check --range main...HEAD \
  --task "Describe the expected behavior" \
  --json
```

Supporting commands cover scope resolution, T-Rex testing, performance,
differential verification, scenario compilation, Repo Unpack,
settings, rubrics, memories, MCP readiness, X-Ray export, and isolated fix
attempts. Run `codevetter --help` for the exact current contract.

MCP remains read-only: it can inspect evidence and prepare bounded review
context, but it cannot start a review, execute tests, approve a fix, alter
settings, or publish anything.

## Advisory ordering and optional feedback

Testing scope plans carry `check_priority` ordinal points and source-backed
factors. Relevance and exact target selection dominate this tie-breaker before
the 12-target cap. Reads are bounded; missing source and downstream reach stay
explicit. Dirty or mismatched-head checkouts disable content priority.
Performance ordering is unchanged. Priority is scheduling advice, never a
correctness verdict, defect probability, or approval. Preflight and saved checks
preserve the selected plan and candidate in `correctness_selection`; an explicit
target retains explicit selection authority.

Attach caller-reported outcomes to an existing persisted local-check run:

```bash
codevetter outcomes --operation record --repo /absolute/repo --run-id <run-id> \
  --event-id incident-42 --kind incident --group-id production-42 \
  --reason "Regression reproduced" --evidence-ref "issue:42" --json
codevetter outcomes --operation list --repo /absolute/repo --run-id <run-id> --json
codevetter outcomes --operation summary --repo /absolute/repo --run-id <run-id> --json
```

`revert` can share the incident's `--group-id` so the adverse event counts once.
`confirmed_safe` requires `--basis`; `human_override` requires
`--action accept|reject|defer` and is counted separately. Every record requires a
bounded reason, evidence reference, and unique event ID. Identical retries are
idempotent; conflicting retries fail. At most 1,000 events attach to one run.
The append-only ledger binds the exact stored receipt digest, repository,
full base/head, source mode, and source input. Replaced receipts fail closed.
Labels never rewrite the canonical receipt, change approval, or train a model.
`verification_get_receipt` exposes a bounded caller-reported summary, record
count, and receipt digest as a separate read-only MCP sibling; use CLI `list`
for full records. Unavailable feedback leaves the receipt readable.

Optional wording uses an explicitly selected local OpenAI-compatible endpoint:

```bash
codevetter explain --repo /absolute/repo --run-id <run-id> \
  --endpoint http://127.0.0.1:1234/v1 --model local-model --json
```

Only completed, ready reviews and canonical source-qualified final findings
are eligible. The request contains opaque IDs and original title, description,
and suggestion text. Paths, anchors, severity, and other receipt metadata are
not added to the payload. Literal HTTP loopback, the exact `/v1` path, no proxy,
no redirects, bounded bytes, and a 15-second total deadline constrain one
request without retries. Invalid model output or network failure preserves
original wording. `wording_verified` is always false. Provider-reported tokens
and actual duration are separate from unknown cost; no savings are claimed.
These optional CLI operations add no native controls or MCP execution authority.

## Agent usage ownership

The general agent-usage dashboard and provider allowance checks have moved to
ContextDaddy. CodeVetter no longer exposes a Usage workspace or general
`codevetter usage`/`codevetter quota` commands. Token and cost evidence attached
to an individual verification run remains in its receipt and Runs ledger.
CodeVetter's History settings and `history-roots` command are retained for its
existing local evidence archive and are not a general usage dashboard.

If you used `codevetter usage` or `codevetter quota` in a script, move that
workflow to ContextDaddy's app. ContextDaddy has no equivalent CodeVetter CLI
command; these retired commands now return a migration message instead of a
usage or quota receipt.

## Interaction policy

### Review and Explore navigation

After opening a local repository in Review, the comparison bar exposes
**Review branch** and **Compare against** using local and available remote-tracking
refs. **Local changes** initially shows the worktree against HEAD; choosing two
branches and **Show diff** resolves their merge-base/head without checkout or fetch.
Pending selections cannot start a review. Refresh preserves the applied selection;
opening another repository clears the previous comparison and verification plan.

**Review change…** opens the existing setup with the exact displayed commit pair,
review instructions, reviewer choice, **Plan**, and **Run review & checks**. The
range is read-only there; **Change comparison** returns to the browser. Plan does
not execute repository code. Executable verification still requires a clean
checkout at the selected head: uncommitted changes remain inspectable, not silently
converted into a different review range. Imported PR/commit comparisons stay pinned;
repository/file URLs without a base remain source-only. The local repair is tracked
in [#285](https://github.com/Codevetter/codevetter/issues/285), not yet released.

The landing surface accepts public GitHub repository, PR, commit, branch, and
file URLs, or a local repository. The Rust navigator pins commits and blobs;
PRs use their merge base. Source opens before background indexing. `Cmd+P`
finds files, `Shift+Cmd+F` searches indexed text, and `Shift+Cmd+O` lists
JavaScript/TypeScript declarations. The source plane renders visible rows from
bounded Rust windows. Unified and split diffs retain old/new line numbers;
full-source and base/head views share the same pinned identity.

Unpack is available beside source. Its deterministic map links repository
instructions, architecture documents, manifests, entry points, and imports to
their files. Existing reports at the matching revision add subsystem claims,
workspace modules, and decision sources. Imported text snapshots can be handed
to the existing Unpack scan without executing repository code. Coverage
exclusions remain explicit. Findings and recorded runtime stack locations open
inside CodeVetter at the receipt revision, never through the default editor.

The navigator has a separate in-process library boundary; verification remains
on the existing CLI/receipt boundary. See
[the navigator implementation](../../crates/codevetter-navigator/src/lib.rs)
and [tracking issue #285](https://github.com/Codevetter/codevetter/issues/285).
Double-click, F12, and the source context menu use bundled TypeScript 7.0.2
semantic definitions; Shift+F12 finds references. Left/right arrows move the
symbol position and up/down arrows move source lines. Rust runs the native LSP
worker against separate base/head source snapshots with admitted compiler
configuration, including path aliases. Its macOS sandbox denies outside reads,
writes, subprocesses other than the worker itself, and network access. It never
installs dependencies or runs repository code. External packages and unsupported
languages remain outside semantic coverage; file browsing and literal search
continue independently. The declaration list remains syntax-backed.
Text indexing and semantic snapshots are bounded to 32 MiB, individual
indexed files to 2 MiB, and source reads to 64 MiB; excluded content is never
reported as indexed. Git history is limited by available fetched history.
Refreshing explicitly replaces a local source snapshot; a drifted local diff
is rejected. In-process benchmark timings do not establish keyboard-to-pixel
latency or foreground interaction qualification.

### Verification policy

Repository selection is shared across Explore, Review, Testing, Performance,
and Settings. Choosing a different repository clears repository-specific setup,
including preview URLs, comparison inputs, and performance targets; browsing
opens the new source when resumed. Reselecting the same folder preserves setup.
Unpack details beside source require both the repository and revision to match.

Testing can copy the applied Review comparison; pending branch selections are
not accepted. Browser execution still requires an explicit preview URL and
fresh confirmation. Performance exposes target discovery before manual workload
fields. Saved-result links select the originating run, or explain when it is
outside the latest 50 saved runs. Settings refreshes the currently selected
section's data.

- Review findings are leads until executable evidence supports a verdict.
- Watchers are opt-in and app-lifetime bounded; they do not run while the app
  is closed and each execution session requires consent.
- Destructive cleanup, fix execution, and authority changes are explicit,
  separately confirmed operations.
- Missing usage, provider quota, or runtime data remains visibly unavailable.
- Settings is one coherent destination with subsections, not a collection of
  unrelated top-level pages.

The retired React routes and Tauri WebView are historical implementation
details. Do not restore them as parallel product surfaces.
