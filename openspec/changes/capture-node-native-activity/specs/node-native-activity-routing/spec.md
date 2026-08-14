## Purpose

Defines deterministic routing from exact other-thread CPU and compatible native
activity intervals while preserving the distinction between observed activity
and unproven CPU attribution.

## ADDED Requirements

### Requirement: Route compatible libuv threadpool activity

The router SHALL select a libuv threadpool activity probe when exact other-thread
CPU is material and a compatible complete trace contains at least 5 ms of
allowlisted threadpool execution overlap.

#### Scenario: Dominant allowlisted threadpool class

- **WHEN** multiple threadpool mechanism classes cross the floor
- **THEN** the router selects the class with greatest unioned overlap using a fixed tie-break order

### Requirement: Preserve activity-versus-CPU distinction

The router SHALL NOT subtract trace activity milliseconds from CPU, divide them
by CPU, or claim that overlapping activity caused the measured other-thread CPU.

#### Scenario: Threadpool activity and residual CPU coexist

- **WHEN** exact other-thread CPU and threadpool execution are both observed
- **THEN** the diagnosis states only that the intervals overlap and requests a mechanism-specific inspection

### Requirement: Request better evidence when native activity is absent or unsafe

The router SHALL distinguish zero observed allowlisted activity from unsupported,
incomplete, contaminated, or incompatible native activity evidence.

#### Scenario: Complete zero activity

- **WHEN** the exact other-thread residual is material and the complete compatible trace reports no allowlisted activity
- **THEN** the router requests deeper V8-background or native-thread sampling

#### Scenario: Unsafe activity evidence

- **WHEN** native activity evidence is unsupported, incomplete, contaminated, or interval-incompatible
- **THEN** the router requests the corresponding recapture rather than treating activity as zero

### Requirement: Preserve zero edit authority

Every native-activity route SHALL remain source-null, low-confidence,
edit-ineligible, and unable to override failed correctness.

#### Scenario: Failed flow with threadpool activity

- **WHEN** a failed exact browser flow retains compatible libuv activity
- **THEN** its durable compact diagnosis may preserve the next probe but cannot authorize an optimization

