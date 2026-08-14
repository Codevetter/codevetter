## Why

CodeVetter currently rejects otherwise static local Playwright flows when a
config assigns a literal loopback URL to an immutable constant before
referencing it from `use.baseURL`. This blocks
safe owned-runtime profiling in real products such as RolePatch even though no
config evaluation or environment read is necessary.

## What Changes

- Resolve a bounded set of immutable Playwright config constants when
  their value is a supported literal or a supported environment fallback to a
  literal.
- Reuse those constants only in the existing closed `baseURL` field; declared
  server-family inference continues to use the existing static config and
  package-script rules.
- Preserve fail-closed behavior for mutation, interpolation, calls, property
  chains, cycles, remote URLs, ambiguous declarations, and environment-only
  values.
- Prove that qualification remains read-only and never evaluates the config,
  reads an environment value, or executes a repository command.

## Capabilities

### New Capabilities

- `static-playwright-config-qualification`: Qualify closed constant-backed
  local Playwright runtime declarations without evaluating project code.

### Modified Capabilities

None.

## Impact

The change is limited to the runtime qualification parser, its closed
qualification tests, and local performance documentation. It adds no
dependency, MCP tool, command surface, production behavior, or cloud access.
