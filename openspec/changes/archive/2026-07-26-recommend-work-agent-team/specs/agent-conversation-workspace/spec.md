## MODIFIED Requirements

### Requirement: Work opens as a focused conversation without replacing Usage

The application SHALL keep Usage as its initial/default surface, and the Work route SHALL always open the focused Conversation workspace while Board remains a separate primary destination.

#### Scenario: Open the application during qualification

- **WHEN** the user launches CodeVetter before Work has passed its promotion gate
- **THEN** the application opens Usage
- **AND** Work remains directly available from primary navigation

#### Scenario: Open Work for the first time

- **WHEN** the user opens Work without prior workspace state
- **THEN** the application shows an unselected outcome-first start canvas with one clear recommendation and confirmation flow
- **AND** raw terminal panes, orchestration graphs, and automatic launch controls do not dominate the initial view

#### Scenario: Open Work with existing conversations

- **WHEN** saved, indexed, or reattached live conversations are available without an explicit target
- **THEN** the application exposes them in a collapsible run navigator organized by attention and recency
- **AND** selects none of them automatically
- **AND** shows the new-work start canvas

#### Scenario: Open Work from an explicit target

- **WHEN** the user selects a conversation, follows an attention action, resumes history, or opens a Board handoff
- **THEN** the application shows the targeted active-run or seeded start flow
- **AND** does not show a Conversation / Board mode switch

## ADDED Requirements

### Requirement: Run navigation prioritizes current operational need

Work SHALL organize the run navigator into Needs attention, Active, and Recent groups and SHALL distinguish live owned sessions from read-only indexed history.

#### Scenario: A live agent needs input

- **WHEN** a confirmed question, permission request, failure, or disconnection is current
- **THEN** its run appears in Needs attention ahead of ordinary active and recent entries
- **AND** its role, provider, state, and repository remain visible

#### Scenario: User opens indexed history

- **WHEN** the user selects a Recent indexed conversation
- **THEN** Work opens the existing read-only preview
- **AND** does not start, resume, or mutate a provider process

#### Scenario: User needs more canvas space

- **WHEN** the user collapses the run navigator
- **THEN** the focused start or conversation canvas expands
- **AND** a labelled control remains available to reopen navigation and expose the current attention count
