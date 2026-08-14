## Purpose

Partition a correlated Node HTTP response into coarse server-side production
intervals so agents can narrow unexplained request latency without collecting
payload data or claiming network, source, or exclusive-time causation.

## ADDED Requirements

### Requirement: Response API boundary capture
For each admitted correlated Node server request, CodeVetter SHALL observe the
first response commitment call, first body-production call when present,
`response.end` call, and `finish` event as request-relative timing boundaries.
Instrumentation MUST preserve original method arguments, return values,
exceptions, receiver identity, and event behavior.

#### Scenario: Implicit headers and streamed body
- **WHEN** a handler first calls `write` and later calls `end`
- **THEN** the first `write` establishes both commitment and body-production boundaries while `end` and `finish` remain ordered separately

#### Scenario: Explicit headers and empty body
- **WHEN** a handler calls `writeHead` and later calls `end` without body content
- **THEN** commitment and end boundaries are retained while first body production remains unavailable

#### Scenario: End supplies the first body
- **WHEN** a handler calls `end` with a body argument before any write
- **THEN** the same call establishes commitment, first body production, and end boundaries

### Requirement: Bounded private-data-free projection
Public response-boundary evidence MUST contain only non-negative rounded request
offsets and derived interval durations. It MUST NOT retain method arguments,
headers, body values, body sizes, trailers, callbacks, sockets, object identity,
or source locations.

#### Scenario: Sensitive response data crosses instrumented calls
- **WHEN** headers or body arguments contain credentials or application values
- **THEN** the retained event and diagnosis contain none of those values

#### Scenario: Boundary order is malformed or incomplete
- **WHEN** an end or finish offset precedes commitment, exceeds request duration, or a required boundary is absent
- **THEN** normalization rejects the malformed values or exposes an explicit incomplete state without deriving negative time

### Requirement: Response interval partition
For a complete request, CodeVetter SHALL derive server preparation from request
start to first commitment, response emission from first commitment to the end
call, and finish tail from the end call to `finish`. These intervals MUST sum to
the request duration subject only to recorded rounding and MUST NOT alter
supported child-operation accounting.

#### Scenario: Complete ordered boundaries
- **WHEN** commitment, end, and finish are observed in valid order
- **THEN** the request exposes all three derived intervals and marks the partition complete

#### Scenario: Missing end observation
- **WHEN** the response finishes without an observed instrumented end call
- **THEN** the partition remains incomplete and no dominant interval is inferred

### Requirement: Deterministic dominant-interval diagnosis
CodeVetter SHALL classify a complete dynamic response as
`response_preparation`, `response_emission`, `response_finalization`, or
`no_material_dominant_interval`. A dominant interval MUST be at least 5
milliseconds and at least 50 percent of request duration. Ties MUST resolve in
request order.

#### Scenario: Preparation dominates
- **WHEN** time before first commitment crosses both thresholds and is the earliest longest interval
- **THEN** diagnosis reports response preparation as an observed dominant interval

#### Scenario: Streaming or production dominates
- **WHEN** time from first commitment through the end call crosses both thresholds and is longest
- **THEN** diagnosis reports response emission without claiming exclusive computation or network transfer

#### Scenario: Finish tail dominates
- **WHEN** time from end call to finish crosses both thresholds and is longest
- **THEN** diagnosis reports response finalization without claiming socket or client causation

### Requirement: Response timing has no edit authority
A dominant response interval finding MUST remain source-null,
low-confidence, and edit-ineligible from a single capture. It MUST NOT be called
network TTFB, framework compilation, application CPU, backpressure cause, or a
verified optimization target.

#### Scenario: Exact correctness fails
- **WHEN** the Playwright assertion fails or times out after response evidence is retained
- **THEN** CodeVetter may preserve the observation but authorizes no source edit or performance claim
