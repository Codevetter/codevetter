## Why

The direct T-Rex CLI is implemented and bundled, but issue #52 still lacks two
delivery contracts: an explicit answer for how agent clients may eventually
invoke the same workflow without weakening the read-only history MCP, and one
automated release check that proves the shipped CLI binary matches its
documented/versioned surface.

## What Changes

- Define the future T-Rex verification MCP as a separate, explicitly enabled
  execution capability instead of adding a write-producing tool to the
  existing read-only history MCP sidecar.
- Document its fixed repository scope, exact input/output contract,
  target-read-only boundary, local receipt write, and fail-closed states.
- Add a reusable CLI qualification script that validates a prepared or bundled
  binary, exact version/help contract, executable state, and Tauri bundle
  declarations.
- Run that qualification in pull-request CI and against the final macOS app
  bundle in the release workflow.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `automatic-change-verification`: adds the MCP projection boundary and
  automated CLI release-artifact qualification.

## Impact

- Changes docs, one Node qualification script, package scripts, CI, and release
  workflow checks.
- Does not expose a new MCP tool, run a preview, publish a release, mutate a
  target repository, or change the canonical T-Rex receipt.
- The real external preview smoke and an actual release remain operator-owned
  follow-ups on issue #52.
