## ADDED Requirements

### Requirement: Native island preserves bounded team purpose

Agent Island SHALL display optional role and team context supplied by the Rust-owned terminal lifecycle without gaining recommendation, repository, transcript, provider-settings, or process-launch authority.

#### Scenario: Recommended team sessions are active

- **WHEN** Work launches sessions with bounded role and team metadata
- **THEN** Agent Island identifies each session's role alongside its provider, project, and runtime state
- **AND** groups and prioritizes sessions using existing trusted lifecycle state

#### Scenario: Multiple teams run in one project

- **WHEN** sessions with different team identities are active in the same project
- **THEN** Agent Island visually distinguishes the teams without exposing opaque identifiers or outcome text
- **AND** each Open action still targets the exact selected terminal session

#### Scenario: Legacy session has no team metadata

- **WHEN** a live or decoded session omits role or team fields
- **THEN** Agent Island renders the existing provider, project, status, and action presentation
- **AND** does not fabricate a role or team relationship

#### Scenario: Maximum bounded session snapshot is emitted

- **WHEN** Rust serializes the supported maximum live sessions with maximum bounded role and team metadata
- **THEN** the complete native envelope remains within the existing 64 KiB protocol limit
- **AND** no lifecycle or capability field is truncated into a different meaning

#### Scenario: User opens a team member

- **WHEN** the user activates Open for a role-labelled island item
- **THEN** CodeVetter focuses the exact matching Work conversation
- **AND** does not start, stop, resume, or switch another team member

#### Scenario: Native helper receives team metadata

- **WHEN** Rust emits a native snapshot containing role and team fields
- **THEN** the helper uses them only for bounded presentation and accessibility
- **AND** recommendations and launch confirmation remain exclusively in Work

### Requirement: Native island is a glanceable agent control surface

Agent Island SHALL present the existing trusted lifecycle as a compact collapsed summary and an expanded team/session-card surface in which confirmed human attention outranks ordinary progress, completion remains calm, and exact jump-back is always clear.

#### Scenario: Agents are working normally

- **WHEN** one or more team sessions are active without confirmed attention
- **THEN** the collapsed surface shows a bounded working summary without exposing prompts or terminal output
- **AND** expansion shows role, provider, project, runtime state, and recency as scannable session cards

#### Scenario: Confirmed question or permission is pending

- **WHEN** Rust supplies a current confirmed event with safe reply or decision capabilities
- **THEN** the expanded surface promotes that event and its allowed actions above ordinary progress
- **AND** ambiguous output-derived attention remains focus-only

#### Scenario: Team member completes

- **WHEN** a session reaches a confirmed completed state
- **THEN** Agent Island shows a calm completion treatment and exact Open action
- **AND** does not imply that queued, failed, or still-running teammates also completed
