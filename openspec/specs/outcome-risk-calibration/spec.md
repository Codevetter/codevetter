# Outcome risk calibration Specification

## Purpose

Define versioned local correlations between comparable repository movements
and later qualified outcomes without creating findings or proof.

## Requirements

### Requirement: Calibration joins comparable repository evidence to later outcomes
CodeVetter SHALL derive versioned calibration observations only from comparable
repository snapshots and exact-repository review, QA, procedure, and bug outcome
records with explicit time windows, feature definitions, outcome definitions,
and exclusions.

#### Scenario: Comparable history has enough outcomes
- **WHEN** a repository has enough compatible snapshot deltas followed by qualified outcomes
- **THEN** CodeVetter computes deterministic direction, support, rate, and confidence summaries
- **AND** every summary links to its contributing local records

#### Scenario: Evidence identities are incompatible
- **WHEN** graph schema, repository scope, time order, or outcome identity cannot be reconciled
- **THEN** CodeVetter excludes the observation with a visible reason
- **AND** does not silently combine it with compatible evidence

### Requirement: Calibration guidance remains honest and non-authoritative
Calibration MUST report sample size, window, support threshold, uncertainty,
missing evidence, and status as `insufficient`, `descriptive`, or `qualified`.
It MUST NOT create a finding, change severity, or upgrade verification.

#### Scenario: Sample support is below the declared threshold
- **WHEN** a metric movement has too few independent qualified outcomes
- **THEN** the UI labels the relationship insufficient
- **AND** offers evidence collection rather than a risk conclusion

#### Scenario: Qualified movement correlates with failures
- **WHEN** a movement passes the declared support and confidence gates
- **THEN** Repo Unpacked may recommend a bounded inspection or verification action
- **AND** labels the result as outcome correlation rather than causation
