## ADDED Requirements

### Requirement: Native island presents trusted lifecycle changes without stealing control

Agent Island SHALL distinguish user-owned expansion from automatic lifecycle presentation, SHALL automatically present only new bounded trusted events, and MUST NOT activate CodeVetter or take keyboard focus for automatic presentation.

#### Scenario: Confirmed attention arrives while the island is collapsed

- **WHEN** a non-preview snapshot introduces a new confirmed needs-help event identity
- **THEN** Agent Island expands with that session prioritized
- **AND** remains expanded until the event resolves, changes, or the user explicitly collapses it
- **AND** does not activate CodeVetter or move keyboard focus

#### Scenario: Completion or failure arrives while the island is collapsed

- **WHEN** a non-preview snapshot introduces a new completed or failed event identity
- **THEN** Agent Island expands with the trusted session state visible
- **AND** schedules a bounded automatic collapse
- **AND** does not claim that another teammate completed or failed

#### Scenario: User is inspecting an automatic presentation

- **WHEN** the pointer enters an automatically presented informational island
- **THEN** pending automatic collapse is cancelled
- **AND** pointer exit schedules a fresh bounded collapse delay

#### Scenario: User opened the island manually

- **WHEN** the island is user-expanded and a later lifecycle snapshot arrives
- **THEN** the surface remains user-expanded
- **AND** automatic presentation does not replace, collapse, or steal focus from it

#### Scenario: Automatic attention event resolves

- **WHEN** the exact event behind automatic attention is absent, replaced, or no longer needs help
- **THEN** Agent Island returns to its collapsed state unless a new trusted event warrants presentation
- **AND** no provider action is sent

#### Scenario: Snapshot is repeated or is a preview

- **WHEN** Agent Island receives an unchanged event identity or a preview snapshot
- **THEN** it does not automatically expand
- **AND** no automatic collapse timer is created

### Requirement: Collapsed island summarizes the current team

The collapsed Agent Island SHALL expose a bounded, glanceable summary of the highest-priority current sessions without revealing prompts, terminal output, paths, commands, model responses, outcome text, or opaque team identifiers.

#### Scenario: Up to three sessions are current

- **WHEN** one to three sessions are visible
- **THEN** the collapsed pill shows one compact role-or-provider marker per session in trusted priority and recency order
- **AND** each marker communicates lifecycle state without requiring colour for accessibility

#### Scenario: More than three sessions are current

- **WHEN** more than three sessions are visible
- **THEN** the collapsed pill shows the first three markers and one bounded remaining count
- **AND** expansion exposes the existing full grouped session list

#### Scenario: A teammate needs attention

- **WHEN** one current session has confirmed needs-help state
- **THEN** its marker is ordered ahead of ordinary working and completed markers
- **AND** the collapsed accessibility summary identifies the exact role or provider, project, and state
