## Why

T-Rex already owns CodeVetter's testing surface, repository selection, pull
request watcher, sandbox concepts, warm verification, differential evidence,
and Synthetic QA. The missing product path is a direct run: select an existing
repository, provide a PR or commit range plus its deployed preview, and let
T-Rex test the changed behavior without configuring a watcher, route, goal,
loop, or runner.

## What Changes

- Add a primary T-Rex direct-run card with three normal-path inputs: the
  already-selected repository, a GitHub PR URL or local `base..head` range, and
  one HTTP(S) candidate preview URL.
- Resolve PR and range targets into an exact base SHA, head SHA, ordered commit
  identity, and bounded changed-path set without changing the operator's
  checkout.
- Derive a bounded set of candidate routes from changed repository paths and
  always include a generic root smoke journey.
- Run the existing built-in Synthetic QA Playwright runner against the supplied
  preview under the remote read-only policy.
- Inspect explicit revision headers returned by the preview and classify
  preview identity as `verified`, `claimed`, or `mismatch`. A claimed preview
  can expose failures but cannot prove that the PR passed.
- Emit and persist one versioned T-Rex receipt containing source identity,
  preview identity, planned routes, journey evidence, limitations, timing, and
  a deterministic `passed_with_limits`, `failed`, or `no_confidence` verdict.
- Expose the same workflow through a bundled `codevetter trex` CLI with
  human-readable and canonical JSON output, deterministic exit codes, and the
  current directory as the default repository.
- Package the CLI beside the macOS application and safely register a per-user
  `~/.local/bin/codevetter` launcher when an installed app starts, without
  overwriting an existing command or editing shell configuration.
- Keep the existing watcher, warm verification, differential verification, and
  scenario compiler working unchanged.
- Defer application-only testing, arbitrary repository cloning, dependency
  installation, automatic local application startup, authenticated preview
  mutation, base-preview comparison, MCP entry points, and autonomous scenario
  expansion.

## Capabilities

### New Capabilities

- `automatic-change-verification`: Defines the first T-Rex change-plus-preview
  workflow, exact source and preview identity, deterministic route selection,
  remote-safe execution, receipt persistence, and honest verdict contract.

### Modified Capabilities

- `staged-change-verification`: Allows a qualifying T-Rex change-preview receipt
  to contribute executable evidence only when its source and preview identities
  are exact and every required journey completed.

## Impact

- Adds a focused panel to the existing `/trex` Testing route.
- Adds typed Tauri IPC for direct-run execution and recent receipt retrieval.
- Adds one bundled Rust CLI adapter over the same source, journey, verdict, and
  persistence service used by Tauri.
- Adds one Rust orchestration module and one additive local SQLite table.
- Reuses the current GitHub CLI authentication, local Git change resolution,
  Synthetic QA Playwright runner, artifact retention, and existing design
  system.
- Adds no production dependency, hosted service, deployment, release, Sentry,
  observability integration, automatic fix, or production configuration.
- The installed-app launcher is user-scoped and collision-safe. It does not
  modify `.zshrc`, `.bashrc`, `/etc`, or an existing `codevetter` command.
- The broader application tester and `build-agent-task-corpus-runner` remain
  later qualification and expansion work.
