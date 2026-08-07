## ADDED Requirements

### Requirement: Qualified blast-radius evidence is additive
Changed-capability selection SHALL accept bounded current blast-radius and test-impact evidence with exact source identity, rank, and provenance, but that evidence MUST only add or prioritize scenarios and MUST NOT remove explicit mappings, mandatory smoke, or required fallback.

#### Scenario: Current blast radius identifies an additional caller capability
- **WHEN** current complete graph or coverage evidence connects a changed symbol to a scenario outside the explicit path mapping
- **THEN** the verifier adds that scenario and records the exact impact edge and evidence identity

#### Scenario: Blast-radius evidence is stale or incomplete
- **WHEN** blast-radius or test-impact evidence does not match the exact source identity or reports truncation
- **THEN** the verifier ignores its narrowing claims and widens selection according to the configured fallback policy

