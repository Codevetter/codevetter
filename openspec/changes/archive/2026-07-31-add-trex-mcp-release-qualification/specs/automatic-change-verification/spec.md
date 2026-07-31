## ADDED Requirements

### Requirement: Verification MCP does not weaken history MCP

CodeVetter SHALL keep future agent-triggered T-Rex execution separate from the
existing repository history MCP. Enabling read-only history MCP access MUST NOT
authorize preview execution or local receipt writes.

#### Scenario: History MCP is enabled

- **WHEN** an MCP client can read an explicitly enabled repository's history
- **THEN** it cannot start T-Rex, write a receipt, or obtain a verification
  execution capability from that server

#### Scenario: Verification MCP is designed

- **WHEN** CodeVetter exposes T-Rex through MCP in a future change
- **THEN** a separate explicitly enabled process fixes one repository scope,
  accepts exactly one PR or range plus one credential-free preview URL, calls
  the canonical T-Rex service, and returns its versioned receipt

### Requirement: Prepared and bundled CLI artifacts are contract-qualified

CodeVetter SHALL automatically execute a qualification check against the
prepared CLI in pull-request CI and the final bundled CLI during macOS release
builds. The check SHALL fail if the artifact is missing, empty, non-executable,
version-mismatched, missing its documented T-Rex flags, or absent from either
Tauri bundle declaration.

#### Scenario: Pull request prepares the CLI

- **WHEN** CI builds the host-target CLI sidecar
- **THEN** the qualification script executes that binary and verifies its
  exact version, help surface, and bundle declarations

#### Scenario: Release app is bundled

- **WHEN** Tauri produces the final macOS application bundle
- **THEN** release qualification executes the CLI inside that bundle before
  artifact publication continues

#### Scenario: CLI contract drifts

- **WHEN** the binary version/help output or bundle declarations no longer
  match the tracked contract
- **THEN** qualification fails with the exact missing or mismatched evidence
