## Purpose

Attribute Codex usage to the work performed by each lineage while excluding copied parent history, duplicate emissions, and ambiguous ownership.

## ADDED Requirements

### Requirement: Fork baselines resolve from the parent timeline
For a session with explicit parent identity, the system SHALL resolve the parent's accepted cumulative usage at or before the fork timestamp and subtract that inherited baseline from the child lineage.

#### Scenario: Parent source covers the fork timestamp
- **WHEN** a child declares a parent and the parent ledger contains a complete checkpoint at or beyond the fork time
- **THEN** copied parent usage contributes zero child usage and only child-owned growth is accepted

#### Scenario: Parent coverage is insufficient
- **WHEN** the parent evidence cannot establish a cumulative baseline at the fork time
- **THEN** ambiguous child usage is excluded, the session is classified ambiguous, and the system does not claim complete coverage

### Requirement: Interleaved lineages cannot create gap recounting
After any cumulative component falls below its monotonic watermark, the system SHALL latch interleaved mode and SHALL cap accepted growth by both contained cumulative growth and the per-event delta when present.

#### Scenario: Smaller lineage follows a larger lineage
- **WHEN** an event's cumulative totals fall below the established watermark
- **THEN** the system accepts no gap-sized delta and never lowers the watermark

### Requirement: Market-oracle parity gates release
The production Codex scanner SHALL reconcile token classes and calendar totals with the pinned CodexBar reference scanner for an approved retained corpus, except for documented semantic differences with explicit expected deltas.

#### Scenario: Real-corpus totals diverge
- **WHEN** verified input, cached input, output, reasoning, or daily totals differ beyond zero-token exact equality on the parity corpus
- **THEN** qualification fails and the accounting change cannot be released

### Requirement: Copied upstream logic remains attributable
Any substantial logic or fixtures adapted from an external implementation SHALL retain the applicable license notice and pinned upstream revision.

#### Scenario: CodexBar lineage fixture is vendored
- **WHEN** an upstream-derived fixture or algorithm is added
- **THEN** its source revision and MIT attribution are recorded beside the artifact

