---
title: T-Rex change and preview verification
description: Run bounded browser verification for an exact pull request or commit range against an existing preview.
sidebar:
  order: 4
---

# T-Rex change and preview verification

T-Rex can take an exact source change and an already-deployed preview, run
bounded browser checks, and return a durable evidence receipt. This is the first
direct-run workflow for reducing the time spent manually testing routine
changes.

The workflow is intentionally narrow:

1. Select a repository that already exists locally in CodeVetter.
2. Identify the change with a GitHub pull-request URL or a Git commit range.
3. Provide an existing HTTP(S) preview URL.
4. Run the deterministic generic page-smoke journey on a bounded route plan.
5. Inspect the verdict, preview identity, limitations, and captured artifacts.

The existing watcher, warm-verification, differential-verification, and
scenario-compilation tools remain available below the direct-run card.

## Supported change targets

### GitHub pull request

Use a canonical URL such as:

```text
https://github.com/acme/widget/pull/42
```

The URL must identify the same repository as the selected local checkout.
CodeVetter uses read-only GitHub CLI API calls to resolve the pull request's
base revision, head revision, commits, and changed paths. It does not check out
the pull request or mutate the repository.

### Local commit range

Use a bounded two-dot or three-dot range:

```text
main..feature/account-page
main...feature/account-page
```

CodeVetter resolves both endpoints through Git and records their exact commit
SHAs. Git commands are passed as argument arrays and never through a shell. The
working tree and current branch are not changed.

## Preview identity

The preview URL must use HTTP or HTTPS and cannot contain embedded credentials.
CodeVetter follows a bounded redirect chain and inspects these response headers:

- `x-commit-sha`
- `x-git-commit`
- `x-git-sha`
- `x-vercel-git-commit-sha`
- `x-codevetter-revision`

Preview identity has three states:

| State | Meaning | Execution behavior |
|---|---|---|
| Verified | A revision header matches the resolved change head. | Run the route plan. |
| Claimed | No supported revision header was exposed. | Run, but retain an explicit identity limitation. |
| Mismatch | A revision header identifies another revision. | Stop before browser execution and return no confidence. |

`Claimed` is useful evidence, but it is not proof that the supplied deployment
contains the selected change.

## Route and journey bounds

The root route is always included. T-Rex derives a small additional route plan
from conventional TypeScript and Node page paths. Dynamic routes that require
unknown parameters are reported as limitations instead of guessed. Both source
collection and route execution have hard bounds so an unexpectedly large
change cannot create an unbounded local run.

Each selected route reuses the built-in `generic-page-smoke` Synthetic QA loop
in remote, read-only mode. The receipt preserves the route, pass/fail state,
notes, final URL, page title, console errors, screenshots, artifacts, duration,
and runner identity produced by that loop.

## Verdict semantics

The verdict is aggregated from runtime evidence without asking another model
to judge the result:

- **Passed with limits** — every executed journey passed; the receipt still
  names identity, route, and coverage limitations.
- **Failed** — at least one executed journey failed. Failure evidence and
  artifact paths remain in the receipt.
- **No confidence** — T-Rex could not safely claim it tested the requested
  change, such as when the preview revision mismatches or no route could run.

Recent receipts are stored locally and can be reopened from the Testing page.
They include the resolved source identities, preview identity evidence, route
plan, journey evidence, limitations, verdict, duration, and run timestamp.

## Command line

The bundled CLI runs the same source resolution, preview identity, route plan,
browser journey, verdict, persistence, and receipt service as the Testing page.
Run it from the repository being tested:

```bash
codevetter trex \
  --pr https://github.com/acme/widget/pull/42 \
  --preview https://widget-pr-42.example.com
```

Or test a local range:

```bash
codevetter trex \
  --range main..HEAD \
  --preview https://widget-preview.example.com
```

Use `--repo /path/to/repository` when the current directory is not the target.
Use `--json` to print only the canonical receipt JSON for another tool.

| Exit | Meaning |
|---|---|
| `0` | Every selected journey passed with the receipt's stated limitations. |
| `1` | At least one browser journey produced executable failure evidence. |
| `2` | The run had no confidence, invalid input, or an operational failure. |

Pull-request mode requires an installed and authenticated GitHub CLI. Release
builds use the existing native Chrome driver and therefore require Google
Chrome to be installed. The desktop app does not need to remain open during a
CLI run.

### Installed command

The macOS app bundles the CLI and creates `~/.local/bin/codevetter` on its first
installed-app launch. It never overwrites another file or symlink and never
edits shell startup files. If that directory is not already on the terminal
PATH, add it explicitly:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

`pnpm tauri:dev` does not register a launcher. To remove the installed launcher,
first confirm it targets the CodeVetter app with
`readlink "$HOME/.local/bin/codevetter"`, then run
`unlink "$HOME/.local/bin/codevetter"`. Removing the launcher does not delete
the app or its local receipts.

## Safety boundary

This slice is read-only. It does not install dependencies, execute repository
scripts, mutate the target application, authenticate into the preview, or send
write actions through the browser.

The following remain deferred:

- standalone applications supplied without an existing selected repository;
- arbitrary repository cloning or remote workspace provisioning;
- dependency installation and application boot orchestration;
- authenticated or state-mutating browser journeys;
- base-preview versus head-preview comparison;
- model-authored or richer autonomous journeys;
- observability and Sentry-log correlation.

Those capabilities can build on the same source, preview-identity, journey, and
receipt contracts after the direct path proves reliable.

An MCP execution projection is designed but not implemented. It deliberately
uses a future, separately enabled process because the existing history MCP must
remain strictly read-only. See
[T-Rex MCP projection](../architecture/trex-mcp-projection.md).
