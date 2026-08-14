---
title: T-Rex MCP projection
description: The authorization and receipt contract for a future agent-triggered change-preview verifier.
sidebar:
  order: 8
---

# T-Rex MCP projection

This document fixes the architecture for exposing the direct T-Rex
change-preview workflow to an MCP client. It is a design contract, not a claim
that the execution tool ships today.

The current [`codevetter-mcp`](./mcp-sidecar.md) server remains a strictly
read-only history and graph interface. It does not run T-Rex, launch a browser,
or write a verification receipt.

## Why the boundary is separate

The three existing product paths do not have identical authority:

| Surface | May execute verification | May write local receipt | May mutate target |
| --- | --- | --- | --- |
| Desktop T-Rex | Yes | Yes | No |
| `codevetter trex` CLI | Yes | Yes | No |
| `codevetter-mcp` | No | No | No |

Calling the current MCP server "read-only" while adding a tool that launches a
browser and persists a receipt would make its contract misleading. A future
verification projection therefore uses a separate process and permission.

## Process identity

The planned binary is `codevetter-verify-mcp`. It will not replace or extend
`codevetter-mcp`.

Starting the process will require an owner-controlled, explicit verification
enablement for one repository. Enabling history MCP access alone will never
authorize verification execution.

The process receives one canonical repository scope at startup. The tool does
not accept arbitrary repository paths, clone repositories, or switch scope
between calls.

## Tool contract

The first tool is planned as:

```text
verify_change_preview
```

Its closed input shape is:

```json
{
  "source": {
    "kind": "pull_request",
    "value": "https://github.com/acme/widget/pull/42"
  },
  "preview_url": "https://widget-pr-42.example.com"
}
```

`source.kind` is exactly `pull_request` or `range`. The value is exactly one
canonical PR URL or bounded two-dot/three-dot Git range. `preview_url` is one
credential-free HTTP(S) URL.

The tool does not accept:

- a repository path;
- a shell command, test command, or dependency installer;
- cookies, credentials, headers, or browser storage;
- a model, prompt, route, click plan, or mutation request;
- a second source or preview.

## Shared execution authority

The MCP adapter will call the same `execute_trex_preview` service used by Tauri
and the CLI. It must not reimplement source resolution, preview identity,
route selection, browser execution, aggregation, persistence, or verdicts.

The shared service retains the current guarantees:

- source resolution is exact, bounded, shell-free, and checkout-read-only;
- preview identity is verified, claimed, or mismatched from headers;
- routes are deterministic and bounded;
- browser work is unauthenticated navigation and observation only;
- no model chooses actions or verdicts;
- the canonical receipt remains authoritative.

## Output contract

A completed tool call returns the versioned `TrexPreviewReceipt` without an
MCP-specific verdict overlay. The receipt preserves:

- exact base/head identities and changed paths;
- preview URL and identity evidence;
- selected routes and reasons;
- journey evidence and artifacts;
- limitations, duration, and run time;
- `passed_with_limits`, `failed`, or `no_confidence`.

Invalid input, preview mismatch, incomplete evidence, persistence failure, and
cleanup failure remain `no_confidence`. The MCP adapter must not translate an
operationally incomplete run into a successful result because the protocol
call itself completed.

Protocol/framing errors may use MCP errors. Verification outcomes must use the
canonical receipt shape so CLI, desktop, and MCP consumers do not diverge.

## Performance-laboratory consumption

The local performance engine may consume an explicitly exported canonical T-Rex
receipt through its read-only CLI/internal correctness qualifier. That
low-level adapter is intentionally not exposed as another performance MCP tool.
It does not call T-Rex, read the desktop SQLite database, or gain browser or
preview authority. The normalized projection omits preview URLs, machine paths,
artifacts, output, and all T-Rex timing.

This join happens only after commit. The T-Rex base must equal the performance
experiment's sealed revision, its head and verified preview revision must equal
the current clean HEAD, changed paths must remain inside the sealed source
boundary, and the exact requested browser flow must pass. A prior accepted local
experiment is mandatory. T-Rex therefore adds shipping smoke confidence but
never substitutes for the project-verification receipt that gated the dirty
local optimization.

## Write boundary

T-Rex is read-only toward the target repository and preview. It does write one
local canonical receipt to CodeVetter's application data.

The future settings copy and MCP tool metadata must say "local verification
execution," not simply "read-only." The process will record bounded access
metadata without prompt, profile, credential, or page content.

## Authorization lifecycle

Before implementation, the feature must define:

1. a separate per-repository verification enablement;
2. how a client discovers and launches the dedicated binary;
3. how enablement is revoked while a process is running;
4. bounded concurrent-run ownership and cancellation;
5. receipt/audit retention;
6. protocol and end-to-end tests proving the history MCP cannot execute it.

No verification MCP binary should be bundled until those lifecycle behaviors
are implemented and qualified.

## Explicit exclusions

The projection does not authorize:

- authenticated or state-mutating journeys;
- repository cloning or dependency installation;
- local application startup or arbitrary command execution;
- base-versus-head preview comparison;
- observability, logs, or Sentry ingestion;
- SARIF as the authoritative receipt;
- autonomous scheduling or repeated background verification.

Those require separate evidence and product decisions.

## Qualification before shipping

Implementation must prove all of the following:

- tool schema rejects unknown fields and ambiguous source selectors;
- repository scope cannot be changed by tool input;
- the target checkout remains unchanged;
- preview credentials and non-HTTP(S) URLs fail before execution;
- completed results round-trip through the canonical receipt;
- failures remain explicit and schema-valid;
- disabling verification revokes new runs;
- `codevetter-mcp` still exposes no execution tool;
- packaged protocol tests pass without the desktop UI.

Until then, the supported machine interface is
[`codevetter trex --json`](../product/trex-change-preview.md#command-line).
