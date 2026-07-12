# Conversation Reconstruction

## Purpose

Define safe reconstruction of bounded non-command intent context around verification events.

## Requirements

### Requirement: Command anchors include bounded surrounding conversation
The system SHALL reconstruct a chronological, bounded window of non-command user, assistant, and result messages around an archived command anchor while retaining session, message-index, source-path, and source-line references.

#### Scenario: Archived context surrounds a command
- **WHEN** a Review history command signal has a matching archived session and source line
- **THEN** the signal includes capped conversation items before and after the command with roles, kinds, text, positions, and evidence anchors

#### Scenario: Archive context is unavailable
- **WHEN** a command signal has no matching archive rows or stable session/source anchor
- **THEN** existing command evidence remains usable and the system does not invent surrounding conversation

### Requirement: Conversation reconstruction remains private and bounded
The system MUST keep reconstruction local, MUST redact secret-like values, and MUST enforce item/text bounds before conversation data enters Review UI or proof output.

#### Scenario: Context contains secret-like assignment
- **WHEN** an archived surrounding message contains a credential, token, password, or authorization assignment shape
- **THEN** the derived conversation item replaces the sensitive excerpt with an explicit redaction marker while retaining its non-sensitive source anchor

#### Scenario: Long conversation surrounds a command
- **WHEN** more archived messages exist than the configured before/after limits
- **THEN** the result returns only the bounded window and marks its bounds without reading the full transcript into the primary UI contract

### Requirement: Verification replay packets preserve conversational intent
The system SHALL attach reconstructed non-command context to timeline replay packets, timeline-segment handoffs, and reviewer proof in chronological order without presenting conversation as executable evidence.

#### Scenario: Timeline groups adjacent command events
- **WHEN** multiple command anchors from one session form a replay packet
- **THEN** the packet interleaves bounded human/assistant context with command outcomes and retains a jump target to the source session

#### Scenario: Reviewer copies proof
- **WHEN** proof includes a conversation-backed replay packet
- **THEN** the export labels conversation as intent context and distinguishes it from passed/failed command or QA evidence
