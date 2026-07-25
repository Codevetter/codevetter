# Agent PR X-Ray Specification

## Purpose

Define deterministic, public-safe verification packets exported from completed
local CodeVetter reviews.

## Requirements

### Requirement: Review-derived X-Ray generation
CodeVetter SHALL generate an Agent PR X-Ray only from a completed local review and its persisted verification evidence.

#### Scenario: Eligible review is exported
- **WHEN** a user requests an X-Ray from a completed review with a public pull-request identity
- **THEN** CodeVetter builds the packet from the persisted review, verification stages, findings, and evidence references
- **AND** does not rerun an LLM merely to produce export prose

#### Scenario: Review is incomplete
- **WHEN** a user requests an X-Ray before the review has a stable outcome
- **THEN** CodeVetter blocks public export
- **AND** identifies which required review or verification state is missing

### Requirement: Verification packet contents
The X-Ray SHALL report changed behavior, trusted impact paths, checks run, verified claims, missing proof, unresolved risks, and an aggregate outcome without presenting an unrun stage as passed.

#### Scenario: Verification contains mixed outcomes
- **WHEN** review passes but an executable check fails or is not run
- **THEN** the X-Ray preserves each stage outcome
- **AND** the aggregate result does not claim the change is verified

#### Scenario: Evidence is not applicable
- **WHEN** a verification stage has a recorded not-applicable waiver and reason
- **THEN** the X-Ray shows the waiver and reason
- **AND** does not label that stage passed

### Requirement: Deterministic portable formats
CodeVetter SHALL render the same versioned X-Ray payload as Markdown, machine-readable JSON, and self-contained static HTML without network-dependent application code.

#### Scenario: Formats are generated from one payload
- **WHEN** a user exports more than one format for the same review revision
- **THEN** every format contains the same outcome, findings, evidence identities, omissions, and schema version

#### Scenario: Artifact is opened offline
- **WHEN** the static HTML is opened without CodeVetter or a network connection
- **THEN** the report content remains readable
- **AND** unavailable external links do not prevent the report from rendering

### Requirement: Fail-closed public sanitization
CodeVetter MUST exclude secrets, provider prompts, model credentials, private repository content, local absolute paths, user identifiers, and unapproved raw code from a public X-Ray.

#### Scenario: Sensitive content is detected
- **WHEN** the sanitizer detects a secret pattern, private path, or disallowed payload field
- **THEN** export is blocked until the content is removed or safely redacted
- **AND** the report identifies the affected category without echoing the sensitive value

#### Scenario: Public source excerpt is included
- **WHEN** a reviewed finding needs a code excerpt from a public pull request
- **THEN** the export includes only the bounded approved excerpt and public source locator
- **AND** records that the excerpt was intentionally included

### Requirement: Explicit source provenance
Every exported finding and verified claim SHALL reference its review source, file/line or public diff locator when available, and the check or evidence record that supports its status.

#### Scenario: Claim lacks supporting evidence
- **WHEN** an export candidate claim has no supporting evidence reference
- **THEN** the claim is placed in missing proof or omitted
- **AND** it is not labeled verified

### Requirement: Reviewed proof corpus
The project SHALL distinguish dogfood, reviewed-public, and benchmark-ground-truth X-Rays and MUST NOT use unreviewed cases for catch-rate marketing claims.

#### Scenario: Dogfood artifact is generated
- **WHEN** an X-Ray is exported from a fleet pull request but has not been adjudicated
- **THEN** it is labeled dogfood
- **AND** cannot contribute to a published catch-rate metric

#### Scenario: Benchmark case is promoted
- **WHEN** a public case has independent ground-truth labels and adjudicated CodeVetter outcomes
- **THEN** it can be promoted to benchmark-ground-truth
- **AND** its successes, misses, and exclusions remain visible

### Requirement: Static public examples
The initial public gallery SHALL publish reviewed static X-Ray artifacts and metadata without accepting repository uploads or performing server-side analysis.

#### Scenario: Visitor opens an example
- **WHEN** a visitor selects a reviewed public example
- **THEN** the landing surface serves the static artifact and its review status
- **AND** routes interested users to the CodeVetter desktop workflow

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
