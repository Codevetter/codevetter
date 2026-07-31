## Context

CodeVetter currently ships two native sidecars with intentionally different
contracts:

- `codevetter` executes T-Rex verification and persists the canonical receipt.
- `codevetter-mcp` exposes repository-scoped history and graph reads and is
  forbidden from running commands or writing product data.

Putting T-Rex directly into `codevetter-mcp` would make its advertised
read-only boundary false. The release workflow also checks that the CLI file is
present in the app bundle, but it does not execute that final binary to prove
its version/help surface.

## Goals / Non-Goals

**Goals:**

- Preserve the current history MCP's strict read-only contract.
- Specify a future equivalent MCP execution entrypoint precisely enough to
  implement without inventing scope later.
- Qualify the actual prepared and bundled CLI binaries automatically.
- Keep all checks shell-free inside the qualification script.

**Non-Goals:**

- Implement or bundle the future verification MCP server now.
- Publish a release or claim a real preview smoke happened.
- Add SARIF, authenticated journeys, repository cloning, dependency
  installation, or target mutations.

## Decisions

### Keep verification MCP separate

A future `codevetter-verify-mcp` process will own one explicit
`verify_change_preview` tool. It will not be added to `codevetter-mcp`.

The process will start with one fixed, canonical repository scope supplied by
an owner-controlled configuration. Tool input will accept exactly one
canonical PR URL or bounded Git range plus one credential-free HTTP(S) preview
URL. It will call the same T-Rex execution service as Tauri and the CLI.

The output will be the canonical receipt on every completed run. Invalid
input, operational failure, or incomplete evidence will remain a schema-valid
`no_confidence` result rather than an MCP-only success shape.

### Name the local write honestly

The verification process is read-only toward the target repository and
preview, but it writes a local canonical receipt. Its future enablement must
therefore be separate from history-MCP access and clearly labeled as local
verification execution. Enabling history reads alone can never authorize it.

### Qualify binaries, not source claims

`verify-cli-release.mjs` accepts an optional explicit binary path. Without one,
it resolves the host-target sidecar prepared by the existing build script. It
checks:

- non-empty executable file;
- exact `codevetter <tauri-version>` output;
- documented `trex` usage and required flags in `--help`;
- both Tauri bundle configs still declare `binaries/codevetter`.

CI runs the check after preparing the debug sidecar. The release workflow runs
it after Tauri builds the final `.app`, pointing at the bundled executable.

## Risks / Trade-offs

- The new automated gate does not prove a live preview journey. Issue #52 must
  retain that operator-owned release qualification item.
- A future second MCP binary increases packaging cost. No binary is added until
  the execution authorization, protocol tests, and receipt failure envelope
  are implemented.

## Migration Plan

No data migration. The script and workflow checks are additive. Removing the
new checks reverts qualification behavior without changing runtime artifacts.
