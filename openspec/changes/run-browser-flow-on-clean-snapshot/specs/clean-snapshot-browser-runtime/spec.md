## Purpose

Provide exact local browser-flow evidence from committed application source without executing ignored environment files or modifying the developer checkout.

## ADDED Requirements

### Requirement: Exact clean source eligibility
The system SHALL offer clean-snapshot browser execution only when the authoritative repository has one exact current Git revision, an unchanged source fingerprint, and no tracked, staged, unstaged, or untracked source changes. It SHALL materialize only eligible Git-tracked files from that revision, SHALL structurally omit paths classified as sensitive without reading or extracting their contents, and SHALL reject unsupported Git objects, oversized trees, or identity drift.

#### Scenario: Clean repository is eligible
- **WHEN** a statically qualified browser flow belongs to a clean repository whose revision and source fingerprint remain unchanged
- **THEN** the system may materialize that exact committed tree for local execution

#### Scenario: Dirty repository is refused
- **WHEN** the authoritative repository contains a source change that is not represented by the committed revision
- **THEN** the system refuses clean-snapshot execution instead of profiling a different source state

### Requirement: Environment-file exclusion
The system SHALL NOT read, inspect the contents of, copy, or execute ignored environment files from the developer checkout. The materialized source tree SHALL contain only eligible Git-tracked files and SHALL pass the existing runtime environment-file safety check before startup.

#### Scenario: Ignored environment file exists
- **WHEN** the original checkout contains an ignored loadable environment file and the committed tree does not contain it
- **THEN** the isolated tree may run without reading or copying that ignored file

#### Scenario: Tracked sensitive file exists
- **WHEN** the committed tree contains a path classified as sensitive
- **THEN** the archive excludes that path without reading or extracting its contents and records only a bounded path-count and filename-digest attestation

### Requirement: Verified local dependency reuse
The system SHALL reuse only already-installed dependency directories that resolve within the authoritative repository's dependency tree. It SHALL reject direct workspace-source links, unexpected destination paths, dependency identity drift, and missing runtime executables. It SHALL NOT install packages or access a remote registry.

#### Scenario: Safe installed dependencies are available
- **WHEN** the exact browser target has an installed dependency ancestor with no direct workspace-source links
- **THEN** the system grafts that dependency directory into the isolated tree and records a bounded dependency attestation

#### Scenario: Dependency graft is unsafe
- **WHEN** a dependency path escapes repository dependencies or contains a direct workspace-source link
- **THEN** the system refuses execution without launching the application or browser

### Requirement: Dual-root execution evidence
The system SHALL keep the authoritative repository as the source of revision identity and durable evidence, while using the isolated tree as the only application and test source execution root. Receipts SHALL disclose clean-snapshot mode and a path-free source/dependency attestation. They SHALL preserve the existing observed, inferred, and unverified evidence boundaries.

#### Scenario: Browser flow succeeds from snapshot
- **WHEN** the owned local server and exact Playwright flow complete successfully from the isolated tree
- **THEN** the durable result is stored under the authoritative repository and is bound to its unchanged revision and source fingerprint

#### Scenario: Authoritative source changes during capture
- **WHEN** the authoritative revision or source fingerprint changes before completion
- **THEN** the system fails the result and authorizes no browser conclusion

### Requirement: Owned cleanup and failure containment
The system SHALL stop every owned process, verify the materialized tree and dependency grafts remained unchanged, and remove its owned temporary tree after execution. Cleanup or immutability failure SHALL be terminal and SHALL leave the developer checkout unchanged.

#### Scenario: Normal completion
- **WHEN** browser capture completes and the isolated tree is unchanged
- **THEN** the system stops owned processes, removes the isolated tree, and records successful cleanup

#### Scenario: Cleanup cannot be verified
- **WHEN** an owned process, dependency graft, or temporary tree cannot be verified or removed
- **THEN** the system reports a terminal operational failure rather than presenting the measurement as valid
