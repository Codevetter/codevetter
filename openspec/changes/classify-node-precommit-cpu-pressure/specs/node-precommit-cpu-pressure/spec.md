## ADDED Requirements

### Requirement: Node request capture records bounded process CPU deltas

The runtime MUST record only non-negative process CPU deltas for the pre-commit
and whole-request intervals and MUST NOT retain absolute counters or request
values.

#### Scenario: Complete non-overlapping request

- **WHEN** one admitted Node request reaches commitment and finish without
  another admitted request overlapping it
- **THEN** evidence contains complete preparation and request CPU durations
- **AND** absolute CPU counters are absent

#### Scenario: Overlapping pre-commit interval

- **WHEN** another admitted request overlaps a request before its first response
  commitment
- **THEN** that observation retains a non-zero bounded pre-commit overlap count
- **AND** it receives no pre-commit CPU classification authority

#### Scenario: Overlap begins after commitment

- **WHEN** another admitted request begins only after the measured request has
  committed
- **THEN** whole-request CPU remains overlap-contaminated
- **AND** the earlier pre-commit CPU interval can remain classifiable

### Requirement: CPU evidence preserves request behavior and fails closed

The runtime MUST preserve response method receivers, arguments, returns,
exceptions, and lifecycle behavior while rejecting malformed or inconsistent
CPU evidence.

#### Scenario: CPU snapshot is unavailable or malformed

- **WHEN** any required CPU boundary cannot be observed or normalized
- **THEN** the request exposes explicit incomplete CPU evidence
- **AND** no CPU-pressure classification is emitted

### Requirement: Diagnosis uses a closed non-causal classification

The diagnosis MUST classify a material complete non-overlapping pre-commit
interval with fixed CPU-to-wall thresholds and MUST keep the result source-null,
low-confidence, and edit-ineligible.

#### Scenario: CPU-heavy interval

- **WHEN** process CPU is at least half of a pre-commit interval of at least 5 ms
- **THEN** diagnosis reports `high_process_cpu`
- **AND** it does not claim exclusive request CPU or a source cause

#### Scenario: Low observed CPU interval

- **WHEN** process CPU is at most one fifth of a pre-commit interval of at least
  5 ms
- **THEN** diagnosis reports `low_observed_process_cpu`
- **AND** it does not claim I/O or async waiting as the cause

#### Scenario: Mixed interval

- **WHEN** the ratio falls between the fixed high and low thresholds
- **THEN** diagnosis reports `mixed_process_cpu`
- **AND** the finding remains edit-ineligible
