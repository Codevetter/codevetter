## ADDED Requirements

### Requirement: Session retention is measured and plan-first
CodeVetter SHALL calculate a deterministic dry-run retention plan for
`session_message_archive` and its FTS projection using configurable age and
size limits, reporting candidate sessions, rows, bytes, reasons, and projected
post-cleanup totals without mutating data.

#### Scenario: User previews cleanup
- **WHEN** the configured history exceeds an age or size limit
- **THEN** CodeVetter returns the exact removable and protected sets with estimated reclaimed bytes
- **AND** leaves the archive, FTS index, and source transcripts unchanged

### Requirement: Referenced and pinned history is preserved
Retention MUST protect sessions pinned by the user or referenced by active Work
or Board items, reviews, QA, intent closure, X-Ray, or persisted history
evidence.

#### Scenario: Old session supports a review
- **WHEN** an otherwise expired session is referenced by persisted review evidence
- **THEN** the plan marks it protected with the referencing evidence identity
- **AND** apply does not delete any of its archived messages

### Requirement: Cleanup and compaction are explicit and auditable
Applying a retention plan SHALL revalidate its identity, remove base and FTS
rows transactionally, record an append-only receipt, and expose database
checkpoint or compaction as a separate explicit operation. It MUST NOT delete
provider-owned source transcripts.

#### Scenario: Data changes after preview
- **WHEN** the archive or protection set changes after a dry-run plan is created
- **THEN** apply rejects the stale plan
- **AND** requires a newly reviewed plan

#### Scenario: User applies a current plan
- **WHEN** the current plan is explicitly confirmed
- **THEN** matching archive and FTS rows are removed atomically
- **AND** the receipt records rows, sessions, bytes, policy, and preserved references
