## Why

CodeVetter currently refuses to start an owned Next.js browser runtime when a developer checkout contains ignored loadable environment files. That default is safe, but it prevents exact, local performance evidence for otherwise clean React applications such as RolePatch.

CodeVetter needs a private execution mode that profiles the exact committed source in a clean, isolated Git snapshot, reuses only verified local dependencies, and never reads or copies the original checkout's environment files.

## What Changes

- Materialize the exact current clean Git revision in a CodeVetter-owned temporary worktree.
- Verify and graft existing local package dependencies without installing packages or exposing the original source tree to the runtime.
- Run the existing owned Next.js and Playwright flow capture against the clean snapshot.
- Bind every receipt to the source revision, source fingerprint, snapshot mode, and a dependency-graft attestation.
- Structurally omit tracked paths classified as sensitive without reading or extracting their contents, and attest only their count and filename digest.
- Refuse the mode for dirty repositories, unsafe dependency links, snapshot drift, cleanup failures, or any missing containment guarantee.
- Remove the owned worktree after capture and leave the developer checkout unchanged.
- Keep the capability private to the performance lab; no new MCP tool or production dependency is introduced.

## Capabilities

### New Capabilities

- `clean-snapshot-browser-runtime`: Safely execute an exact local browser flow from an isolated committed-source snapshot while reusing verified installed dependencies.

### Modified Capabilities

- None.

## Impact

- Affects runtime qualification, owned Next.js startup, Playwright capture, performance-lab evidence, tests, and performance documentation.
- Uses existing Git, Node.js, and Playwright primitives only; no package installation, network access, production configuration, or public tool expansion.
- The original checkout remains authoritative for qualification but is never executed by this mode.
