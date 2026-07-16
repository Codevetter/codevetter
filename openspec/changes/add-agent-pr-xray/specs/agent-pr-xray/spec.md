## ADDED Requirements

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
