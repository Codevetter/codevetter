## Purpose

Provide bounded same-runtime request timing that lets an agent distinguish an
initial Next route outlier from repeated route latency without inventing
framework, source, production, or optimization claims.

## ADDED Requirements

### Requirement: Exact route preflight sequence
For an owned config-disabled Next runtime with one statically qualified local
GET route, CodeVetter SHALL issue exactly two sequential body-free preflight
requests within the existing bounded warmup deadline. It MUST NOT follow
redirects or retain response bodies, URLs, headers, route values, or content.

#### Scenario: Two successful preflight requests
- **WHEN** both requests reach the exact qualified loopback route within the deadline
- **THEN** the runtime records two ordered durations and status classes with a complete inventory

#### Scenario: Preflight cannot complete
- **WHEN** either request times out, redirects, fails transport, or the exact static route is unavailable
- **THEN** the runtime records a closed failed or unavailable state and does not authorize timing comparison

### Requirement: Closed bounded preflight evidence
The public runtime evidence MUST contain only state, inventory completeness,
request ordinal, rounded duration, and status class for at most two requests.
Vite, existing unowned listeners, unsupported runtimes, and unrelated requests
MUST NOT gain preflight timing authority.

#### Scenario: Private response data is present
- **WHEN** a preflight response contains headers, body content, a query, or application values
- **THEN** none of those values appear in the retained runtime or browser evidence

#### Scenario: Runtime is not owned Next
- **WHEN** the browser flow uses Vite or an existing attested listener
- **THEN** preflight evidence is explicitly not applicable or unavailable rather than fabricated

### Requirement: Compatible browser request comparison
CodeVetter SHALL compare preflight timing only with one uniquely correlated
browser server request for the same GET route and compatible status class. It
MUST expose one of `first_preflight_outlier`, `browser_request_outlier`,
`repeated_high_latency`, `no_material_outlier`, or `insufficient_evidence`
using fixed absolute and relative thresholds.

#### Scenario: First request is materially slower
- **WHEN** the first preflight is at least 100 milliseconds and twice the second preflight while the browser request is not a material outlier over the second
- **THEN** the comparison classifies `first_preflight_outlier`

#### Scenario: Repeated route remains expensive
- **WHEN** the second preflight and compatible browser request are each at least 100 milliseconds without either being a two-times outlier over the other
- **THEN** the comparison classifies `repeated_high_latency`

#### Scenario: Browser request is materially slower
- **WHEN** the compatible browser server request is at least 100 milliseconds and twice the second preflight
- **THEN** the comparison classifies `browser_request_outlier`

#### Scenario: Evidence cannot be compared
- **WHEN** the preflight inventory is incomplete, status classes differ, the server request is ambiguous, or the exact route does not match
- **THEN** the comparison classifies `insufficient_evidence` and produces no optimization authority

### Requirement: Evidence and inference stay separate
A material preflight comparison MAY produce a deterministic diagnostic finding,
but the finding MUST remain source-null and edit-ineligible. It MUST describe
the classification as observed timing and MUST NOT call it compilation,
exclusive server work, production behavior, or a verified bottleneck cause.

#### Scenario: Initial request outlier is observed
- **WHEN** a complete compatible comparison classifies `first_preflight_outlier`
- **THEN** the diagnosis reports that the first local request was slower and explicitly withholds a compilation or source-cause claim

#### Scenario: Browser flow correctness fails
- **WHEN** the existing exact Playwright assertion fails or times out
- **THEN** preflight evidence may remain diagnostic but cannot authorize an edit or optimization claim
