## Purpose

Lets an agent execute a diagnosed browser-server next probe later through a
small integrity-checked product operation instead of reconstructing full trace
evidence manually.

## ADDED Requirements

### Requirement: Inspect one exact durable probe

CodeVetter SHALL inspect one validated Playwright capture by capture identity
and SHALL resolve the exact next probe and server request recorded by the
diagnosis.

#### Scenario: Matching probe inspection

- **WHEN** an agent supplies a capture identity and the probe name retained by its diagnosis
- **THEN** CodeVetter returns that probe, its exact server-request ordinal, and bounded relevant evidence

#### Scenario: Stale or mismatched probe

- **WHEN** the supplied probe name does not exactly match the durable diagnosis
- **THEN** CodeVetter rejects the inspection instead of interpreting a different probe

### Requirement: Verify durable evidence before projection

CodeVetter SHALL validate the capture receipt, result path containment, byte
count, content digest, compact-diagnosis match, and current source snapshot
before returning probe evidence.

#### Scenario: Tampered result

- **WHEN** the durable result bytes no longer match the receipt
- **THEN** CodeVetter returns no probe inspection

#### Scenario: Source snapshot drift

- **WHEN** the repository source snapshot differs from the captured snapshot
- **THEN** the inspection is marked stale and cannot present source candidates as current

### Requirement: Expose equivalent CLI and MCP operations

CodeVetter SHALL expose the same closed read-only probe inspection through its
repository CLI and runtime MCP.

#### Scenario: Agent invokes MCP operation

- **WHEN** an MCP client calls the browser-probe inspector with valid arguments
- **THEN** it receives the same normalized result as the repository CLI operation

### Requirement: Fail closed outside supported durable captures

The inspector SHALL reject unsafe capture identities, missing or failed
diagnoses without a next probe, missing request ordinals, unsupported probe
families, ambiguous requests, and extra arguments.

#### Scenario: Unsafe capture identity

- **WHEN** the caller supplies a traversal, absolute path, or unbounded capture identity
- **THEN** CodeVetter rejects it before reading a durable artifact

