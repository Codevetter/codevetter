## ADDED Requirements

### Requirement: Public benchmark cases carry immutable real-PR provenance
Every case promoted to the real agent-PR benchmark SHALL pin public repository
identity, pull-request URL, base and head revisions, diff fixture, public or
license status, hand-labeled ground truth, adjudicator, exclusions, and
timestamps.

#### Scenario: Case is missing a pinned head revision
- **WHEN** curation validation encounters a moving or incomplete pull-request fixture
- **THEN** the case remains dogfood or draft
- **AND** cannot contribute to public benchmark counts

### Requirement: Named comparators and impact fields remain source-qualified
Comparator artifacts SHALL record reviewer, version or tier, capture method,
exact output, elapsed time, available token/cost data, unverified-fix count, and
exclusions. Missing values MUST remain missing rather than estimated silently.

#### Scenario: CodeRabbit access is unavailable
- **WHEN** the named free-tier comparator has no captured artifact
- **THEN** the scorecard reports the slot unfilled with capture instructions
- **AND** the public claim gate remains closed

#### Scenario: Impact data is consistently available
- **WHEN** every included reviewer artifact records compatible time, cost, and unverified-fix fields
- **THEN** the scorecard includes those comparisons with definitions
- **AND** otherwise omits the aggregate impact comparison

### Requirement: Rich artifact previews are bounded and inert
X-Ray and QA previews SHALL be loaded only through evidence-owned canonical
paths with allowlisted content types, byte and dimension limits, redaction, and
non-executable rendering.

#### Scenario: User opens a screenshot preview
- **WHEN** a selected evidence record owns a local image within the configured bounds
- **THEN** CodeVetter renders the bounded image with source and truncation context
- **AND** makes no external request

#### Scenario: Artifact is HTML or outside its evidence root
- **WHEN** a preview candidate is executable, path-traversing, oversized, or not owned by the evidence record
- **THEN** preview is blocked with a category-only explanation
- **AND** no candidate bytes execute in the webview

### Requirement: External claims fail closed on corpus readiness
Public benchmark or gallery promotion MUST require the declared minimum number
of independently adjudicated real agent-generated pull requests and all
mandatory provenance and comparator slots.

#### Scenario: Synthetic cases pass but real corpus is incomplete
- **WHEN** the existing synthetic benchmark is green and fewer than the required real cases are ready
- **THEN** internal results remain available
- **AND** external catch-rate claims remain unauthorized
