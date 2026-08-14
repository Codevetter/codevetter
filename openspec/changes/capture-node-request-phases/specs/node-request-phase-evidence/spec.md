## Purpose

Defines bounded framework-emitted phase evidence that helps an agent break one
exact owned local Node request into meaningful runtime steps without application
instrumentation or unsupported source attribution.

## ADDED Requirements

### Requirement: Phase capture is exact and closed
The system SHALL retain only allowlisted framework phase observations emitted
inside the matching active captured request of a CodeVetter-owned local Node
runtime.

#### Scenario: Owned dynamic request emits a supported phase
- **WHEN** an allowlisted framework phase completes under the exact capture-scoped dynamic request context
- **THEN** CodeVetter retains its closed phase category, start offset, duration, and request parent

#### Scenario: Static resource or unrelated request emits a phase
- **WHEN** a phase occurs outside the matching dynamic request context, after its response completed, or under a generated static-resource route
- **THEN** CodeVetter does not admit it into the request phase inventory

#### Scenario: Framework emits an unknown phase name
- **WHEN** a runtime version emits a performance measure outside the closed allowlist
- **THEN** CodeVetter ignores it rather than retaining the arbitrary name or inventing a category

### Requirement: Phase evidence is bounded and non-additive
The system SHALL expose a bounded ordered request-phase inventory with explicit
completeness and interval-union evidence without summing nested or overlapping
phases.

#### Scenario: Several supported phases complete
- **WHEN** one request retains supported phase observations within the inventory bound
- **THEN** CodeVetter returns them in temporal order with bounded start offsets and durations plus their covered interval union

#### Scenario: Supported phases overlap or nest
- **WHEN** two retained phase intervals overlap
- **THEN** CodeVetter reports their union once and does not add both durations or subtract them from independent child-operation accounting

#### Scenario: Phase inventory exceeds its bound
- **WHEN** one request produces more supported phase observations than the public inventory permits or the underlying stream is incomplete
- **THEN** CodeVetter retains a bounded representative inventory and marks it incomplete

### Requirement: Material framework phase is agent-visible but not edit authority
The system SHALL deterministically identify a materially dominant retained
framework phase while keeping source mutation and optimization claims closed.

#### Scenario: One phase dominates a request
- **WHEN** a complete retained phase crosses the fixed absolute-duration and parent-share thresholds
- **THEN** CodeVetter reports the observed phase and duration as a framework-phase finding with no source and an exact paired verification requirement

#### Scenario: Phase evidence is small or unavailable
- **WHEN** no retained phase crosses materiality or the framework exposes none of the allowlisted measures
- **THEN** CodeVetter reports ran-with-no-finding or unavailable detector coverage instead of fabricating a bottleneck

#### Scenario: Agent interprets a phase finding
- **WHEN** a material phase finding is returned
- **THEN** CodeVetter states that the phase can include framework and application work and MUST NOT claim exclusive time, source causation, safe edit authority, production impact, or an optimization

### Requirement: Phase capture preserves privacy and compatibility
The system SHALL retain no arbitrary measure names, span attributes, route
values, application values, environment values, or raw framework telemetry.

#### Scenario: Framework phase carries additional runtime data
- **WHEN** the underlying measure or trace implementation exposes attributes, marks, detail, errors, or application values
- **THEN** CodeVetter retains only the closed phase category and bounded timing fields

#### Scenario: Framework version does not emit supported measures
- **WHEN** an otherwise supported owned request completes without the closed phase signals
- **THEN** existing server, CPU, async, browser, correctness, and cleanup evidence remains valid while phase evidence is explicitly unavailable
