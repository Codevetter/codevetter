## Purpose

Make a bundled, locally executed `ccusage` report the single maintained source for CodeVetter's supported coding-agent token and cost totals.

## ADDED Requirements

### Requirement: Local usage comes from the bundled accounting engine
The system SHALL derive transcript-backed usage for every `ccusage`-supported source from the pinned `ccusage` executable bundled with the application and SHALL NOT require a separately installed package runner or CLI.

#### Scenario: Packaged application loads usage
- **WHEN** a user opens the Usage surface in a supported CodeVetter build
- **THEN** the application runs its bundled accounting engine and returns a normalized local report without invoking Node, Bun, `npx`, or a user-installed `ccusage`

#### Scenario: Bundled engine is unavailable
- **WHEN** the executable is missing, incompatible, times out, exits unsuccessfully, or emits invalid JSON
- **THEN** transcript-backed totals are marked unavailable with an actionable local error and no legacy CodeVetter count is substituted

### Requirement: One report snapshot backs every visible breakdown
The system SHALL derive aggregate periods, agent splits, model splits, and session totals from one internally consistent `ccusage` report snapshot for a refresh cycle.

#### Scenario: User changes usage breakdowns
- **WHEN** a user switches among daily, weekly, monthly, agent, model, and session views without requesting a refresh
- **THEN** every view reconciles to the same snapshot totals and generation timestamp

#### Scenario: Concurrent consumers request usage
- **WHEN** multiple Usage components request overlapping report data concurrently
- **THEN** the system coalesces them onto one accounting run rather than scanning the same transcript corpus independently

### Requirement: Accounting remains local and read-only
The system SHALL run usage accounting locally, SHALL treat agent data roots as read-only inputs, and SHALL use packaged offline pricing data during normal report generation.

#### Scenario: Report generation succeeds offline
- **WHEN** supported local transcripts and the bundled accounting engine are present but the network is unavailable
- **THEN** the report is generated without transmitting transcript content or requiring a pricing-network request

### Requirement: Report provenance is visible
Every normalized usage snapshot SHALL identify the `ccusage` version, report generation time, requested timezone and window, detected agents, and any upstream fallback or incomplete-pricing indicators retained by the JSON contract.

#### Scenario: Upstream model fallback is used
- **WHEN** `ccusage` marks a model row as fallback-priced or reports no price for a model
- **THEN** CodeVetter preserves that state and does not present the associated cost as fully priced

### Requirement: Upstream changes are gated before adoption
The packaged `ccusage` version SHALL be pinned, and any version change SHALL pass JSON contract tests and retained-corpus qualification before it can change production totals.

#### Scenario: Dependency update changes report shape or totals
- **WHEN** a candidate `ccusage` version fails schema validation or exceeds the approved retained-corpus variance
- **THEN** the update is rejected and the currently pinned version remains the production engine

