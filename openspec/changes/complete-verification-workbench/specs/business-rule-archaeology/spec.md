## ADDED Requirements

### Requirement: Each release records the largest available archaeology scale gate
Archaeology release qualification SHALL run the largest available checked
eligible corpus or fixture and record exact corpus identity, files, lines,
facts, rules, correctness, resource, parity, cancellation, cleanup, and query
measurements. The receipt MUST distinguish observed support from larger target
claims.

#### Scenario: Exact target corpus is unavailable
- **WHEN** no eligible 18-million-line or 100,000-rule corpus is available
- **THEN** the release records the largest passing available gate
- **AND** explicitly reports the larger claim unsupported

#### Scenario: Larger corpus fails a required threshold
- **WHEN** the run exceeds a correctness, privacy, resource, parity, cancellation, or cleanup threshold
- **THEN** the supported scale remains the prior largest passing gate
- **AND** the failed receipt identifies the limiting threshold without publishing source content
