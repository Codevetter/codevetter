## Purpose

Defines bounded request-correlated CPU evidence that partitions one Node process
between its current request-handling thread and every other thread in that same
process without exposing absolute counters or machine identity.

## ADDED Requirements

### Requirement: Capture current-thread CPU on the selected request interval

The runtime SHALL snapshot supported process-wide and current-thread CPU counters
at request admission, first response commitment, and request finish, and SHALL
retain only bounded deltas for the selected local request.

#### Scenario: Supported isolated request

- **WHEN** a selected Node request completes on a runtime exposing current-thread CPU counters
- **THEN** the evidence reports main-thread CPU deltas for the pre-commit and whole-request intervals beside the existing process CPU deltas

#### Scenario: Unsupported runtime

- **WHEN** the runtime does not expose current-thread CPU counters
- **THEN** process CPU evidence remains usable and the thread partition reports unsupported rather than zero

### Requirement: Publish a closed same-process CPU partition

The normalizer SHALL derive main-thread and other-thread CPU totals from compatible
counter intervals, SHALL keep child-process CPU outside this partition, and SHALL
reject or mark inconsistent any partition where current-thread CPU exceeds the
enclosing process CPU interval beyond the fixed tolerance.

#### Scenario: Valid partition

- **WHEN** process CPU is greater than or equal to current-thread CPU for a compatible interval
- **THEN** other-thread CPU equals the nonnegative difference and the two public parts reconcile to process CPU within rounding tolerance

#### Scenario: Inconsistent partition

- **WHEN** current-thread CPU exceeds the enclosing process CPU interval beyond tolerance or required counters are malformed
- **THEN** thread attribution is marked inconsistent and no residual CPU amount or ratio is published

### Requirement: Keep thread evidence private and bounded

The evidence SHALL NOT retain absolute CPU counters, thread IDs, process IDs,
machine paths, request values, headers, bodies, environment data, or child-process
identity, and SHALL explicitly identify measurement support, completeness, and
observer effect.

#### Scenario: Public projection

- **WHEN** raw thread deltas are normalized into browser-server evidence
- **THEN** only rounded interval CPU totals, ratios, state, and fixed provenance are exposed

