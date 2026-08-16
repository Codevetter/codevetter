## MODIFIED Requirements

### Requirement: Usage totals are partitioned by evidence tier
The system SHALL report current-source `ccusage` totals, legacy CodeVetter estimates, unsupported-provider telemetry, and unavailable data as separate non-overlapping tiers and SHALL NOT merge those tiers into a single transcript-backed total.

#### Scenario: Historical sources are missing
- **WHEN** indexed sessions no longer have readable source evidence
- **THEN** their preserved estimates are shown separately from the `ccusage` current-source total and are not described as reconstructed by `ccusage`

#### Scenario: All detected sources are readable
- **WHEN** the bundled engine successfully reports every detected supported source in scope
- **THEN** the current-source total may be presented without a sidecar-error warning while retaining `ccusage` provenance

#### Scenario: Provider exposes quota but no supported transcript usage
- **WHEN** CodeVetter can read an account quota or provider ledger for a source that `ccusage` does not support
- **THEN** that telemetry remains outside the transcript-backed total and keeps its own source and window label

### Requirement: Coverage is a first-class result
Every transcript-backed aggregation SHALL include the accounting engine version, generation timestamp, requested report window and timezone, detected supported agents, source freshness, and retained upstream fallback or pricing-completeness indicators.

#### Scenario: Source changes after report generation
- **WHEN** a configured usage source has newer complete data than the displayed snapshot
- **THEN** the result is marked stale without presenting the cached snapshot as current

#### Scenario: Accounting execution fails
- **WHEN** the bundled engine cannot produce a valid report
- **THEN** the result exposes an unavailable state and failure category without falling back to an unproven database aggregate

### Requirement: Evidence tiers reconcile
The system SHALL ensure that a stable session identity contributes to at most one of the current-source or legacy-estimated tiers in a snapshot and SHALL reject a complete presentation when tier totals or the normalized `ccusage` snapshot do not reconcile.

#### Scenario: Recovered session exists in current and legacy data
- **WHEN** `ccusage` reports a session whose stable identity also has a preserved legacy estimate
- **THEN** the current-source row supersedes the estimate and the two values are not summed

#### Scenario: Visible breakdown differs from snapshot total
- **WHEN** normalized agent, model, or session rows do not sum to the corresponding `ccusage` snapshot total within the documented numeric tolerance
- **THEN** the snapshot fails qualification and is not presented as complete

