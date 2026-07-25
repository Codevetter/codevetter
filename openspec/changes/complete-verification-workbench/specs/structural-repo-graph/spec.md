## ADDED Requirements

### Requirement: Graph guidance can incorporate qualified local outcome calibration
Repo Unpacked SHALL present qualified outcome-risk calibration alongside graph
metrics with support, uncertainty, time window, outcome definitions, and links
to contributing records. Calibration MUST NOT alter canonical graph facts.

#### Scenario: A graph movement has qualified outcome support
- **WHEN** the local calibration contract marks the movement qualified
- **THEN** Repo Unpacked shows the relationship and a bounded next verification action
- **AND** keeps the canonical metric, correlation, and observed outcomes visually distinct

### Requirement: Public graph snapshots are versioned, sanitized, and opt-in
CodeVetter SHALL export an explicit local package containing sanitized versioned
graph metadata, static SVG or PNG, and Markdown link metadata from one exact
snapshot. It MUST NOT publish or upload the package automatically.

#### Scenario: User exports a public graph package
- **WHEN** the selected snapshot passes path, label, secret, size, and provenance checks
- **THEN** CodeVetter writes one deterministic package with shared publication identity
- **AND** reports omitted private or unsupported fields

#### Scenario: User has not approved export
- **WHEN** graph indexing or Repo Unpacked completes
- **THEN** no public image, repository upload, or hosted explorer is created
