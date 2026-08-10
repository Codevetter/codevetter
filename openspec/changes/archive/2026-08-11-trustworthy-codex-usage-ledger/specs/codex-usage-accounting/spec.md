## ADDED Requirements

### Requirement: Monetary values state their pricing semantics
Codex monetary values SHALL be labeled API-equivalent estimates rather than actual subscription spend and SHALL expose pricing completeness separately from token completeness.

#### Scenario: Service tier is absent
- **WHEN** retained evidence identifies token counts and model but not the request service tier needed for exact list pricing
- **THEN** the system reports an explicitly bounded estimate or marks pricing incomplete instead of claiming an exact dollar value

#### Scenario: Model is unpriced
- **WHEN** accepted usage references a model without a pinned rate
- **THEN** tokens remain verified while cost is reported as unpriced and excluded from any complete-cost claim

### Requirement: Historical recovery preserves provenance
The historical backfill SHALL attempt configured Codex homes and explicit user imports, SHALL fingerprint recovered sources, and SHALL retain legacy stored totals as estimated when source evidence cannot be recovered.

#### Scenario: Missing source is recovered from an imported home
- **WHEN** a source with matching stable session identity is found under an additional configured root
- **THEN** the session is replayed into verified observations and its prior legacy estimate is superseded without double counting

#### Scenario: Source remains unavailable
- **WHEN** no matching readable evidence can be recovered
- **THEN** the preserved historical row remains visible only in the legacy estimated tier

### Requirement: Quota and compute remain distinct
Provider rate-limit windows and transcript-derived token or cost totals SHALL be labeled and stored as different metric families.

#### Scenario: Subscription window resets
- **WHEN** a provider quota percentage drops because its rolling window resets
- **THEN** historical compute totals remain unchanged and the UI does not describe quota consumption as token spend

