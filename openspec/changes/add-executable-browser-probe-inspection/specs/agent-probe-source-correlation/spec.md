## Purpose

Provides bounded source candidates relevant to an exact diagnosed probe while
preserving evidence boundaries and withholding causal or edit authority.

## ADDED Requirements

### Requirement: Correlate only captured compatible evidence

CodeVetter SHALL derive source candidates only from the exact retained request's
main-thread profile, Worker profiles, async-resource callsites, or statically
resolved route source according to a closed probe-family mapping.

#### Scenario: Libuv crypto probe

- **WHEN** the durable probe selects libuv threadpool crypto activity
- **THEN** CodeVetter returns only bounded worker-pool async callsites retained on that exact request as non-causal candidates

#### Scenario: Main-thread repository probe

- **WHEN** the durable probe selects repository-scoped main-thread work
- **THEN** CodeVetter returns bounded repository candidates already present in the compatible request CPU profile

#### Scenario: No compatible source

- **WHEN** the exact request contains no source evidence compatible with the probe family
- **THEN** CodeVetter returns an empty candidate inventory and a specific missing-evidence action

#### Scenario: Incomplete async or framework inventory

- **WHEN** the durable probe requires complete async and framework inventories
- **THEN** CodeVetter returns the exact request context, no source candidate, and a same-flow recapture action

### Requirement: Preserve observation and authority boundaries

Every inspection SHALL distinguish captured evidence from the inspection's
non-causal correlation and SHALL remain unable to authorize an edit or override
failed correctness.

#### Scenario: Source candidate exists on a failed flow

- **WHEN** a failed browser flow has one compatible source candidate
- **THEN** the result labels it a candidate, keeps confidence low, keeps edit eligibility false, and requires a correctness-passing recapture before optimization

### Requirement: Bound and redact the public projection

The inspector SHALL return at most eight repository-contained candidates and
SHALL exclude raw profiles, trace events, absolute paths, application values,
headers, bodies, environment data, and private runtime identities.

#### Scenario: Private source observer data

- **WHEN** retained private evidence contains raw samples, event identity, or runtime arguments
- **THEN** none of those fields appear in the inspection result
