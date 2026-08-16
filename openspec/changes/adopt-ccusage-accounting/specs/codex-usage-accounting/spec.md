## MODIFIED Requirements

### Requirement: Existing data is repaired reproducibly
The system SHALL reproduce current Codex session and calendar totals by rerunning the pinned `ccusage` engine over the configured readable Codex roots. Repeating a report against an unchanged corpus and configuration SHALL produce the same normalized totals, while prior CodeVetter-derived rows SHALL NOT be used to alter the `ccusage` result.

#### Scenario: Accounting runs twice
- **WHEN** the same pinned engine scans the same unchanged transcript corpus, timezone, and configuration twice
- **THEN** normalized session, period, token-class, model, and cost totals are identical

#### Scenario: Historical source is unavailable
- **WHEN** an indexed Codex session no longer has readable source transcript evidence
- **THEN** it contributes nothing to the `ccusage`-derived current-source total and any preserved CodeVetter estimate remains separately labeled as legacy rather than repaired

#### Scenario: Stored totals disagree with the accounting engine
- **WHEN** a prior CodeVetter session or observation total differs from the current pinned `ccusage` result
- **THEN** the `ccusage` result is authoritative for supported current-source usage and the disagreement is retained only as qualification or migration evidence

### Requirement: Accounting exclusions are inspectable
The system SHALL expose the accounting engine version, detected Codex roots, report timestamp, source freshness, upstream fallback-model indicators, and execution errors sufficient to understand what supports a Codex total. The system SHALL NOT claim event-level verification or exclusion detail that the `ccusage` report does not provide.

#### Scenario: User inspects stale usage
- **WHEN** a configured Codex source changes after the currently displayed report was generated
- **THEN** the report is marked stale and a refresh produces a new atomic snapshot

#### Scenario: Upstream output lacks exclusion detail
- **WHEN** `ccusage` returns totals without a per-event disposition for skipped or inherited rows
- **THEN** CodeVetter identifies the result as `ccusage`-derived and does not relabel it as a CodeVetter-verified observation ledger

### Requirement: Historical recovery preserves provenance
Historical recovery SHALL pass configured Codex homes and explicit user import roots to the bundled accounting engine without merging duplicate CodeVetter-derived token rows into its result. Legacy stored totals MAY remain visible only as a separate estimate when their source evidence cannot be recovered.

#### Scenario: Missing source is recovered from an imported home
- **WHEN** a readable session with the same stable identity is found under an additional configured Codex root
- **THEN** the next `ccusage` snapshot includes it once and supersedes the legacy estimate for that identity

#### Scenario: Source remains unavailable
- **WHEN** no configured root contains readable evidence for a preserved historical row
- **THEN** that row remains visible only in the separate legacy-estimated tier and is not added to the `ccusage` total

