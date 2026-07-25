## ADDED Requirements

### Requirement: Conversation can start or attach to a managed run
Work SHALL let the user select a discovered provider profile and explicitly
start or attach to a managed run while preserving the focused conversation
interface and honest provider evidence.

#### Scenario: User starts managed Codex work
- **WHEN** the user selects Codex, an available local profile, a repository, and a prepared work item
- **THEN** Work displays the managed run plan before launch
- **AND** starts the provider only after explicit confirmation

#### Scenario: User attaches an existing managed run
- **WHEN** a current managed run already owns the selected provider process and worktree
- **THEN** Work focuses that run without launching a duplicate process
- **AND** keeps lifecycle, direct output, and checkpoint evidence distinctly labeled

### Requirement: Managed execution does not become a terminal cockpit
Work MUST keep goal, conversation, attention, checkpoints, and next action
primary. Raw terminal layout, multi-pane arrangement, and hidden reasoning SHALL
NOT become the default managed-run interface.

#### Scenario: Managed run executes a check hook
- **WHEN** the check produces bounded output and a checkpoint
- **THEN** Work shows the checkpoint summary and link to full evidence
- **AND** does not replace the conversation with an embedded terminal grid
