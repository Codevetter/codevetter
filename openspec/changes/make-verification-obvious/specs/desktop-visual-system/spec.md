## MODIFIED Requirements

### Requirement: Navigation is consolidated and accessible

The desktop shell SHALL use one compact fixed navigation surface with Usage,
Repo Unpack, Work, Board, Review, and Testing as product destinations and
Settings as a separated utility. The shell SHALL present checking an
agent-authored change as its strongest persistent action without removing or
renaming the existing routes. On desktop-width windows, the navigation surface
SHALL retain compact CodeVetter CPU and RAM telemetry with expanded process
details on demand; background sampling MUST pause while the window is hidden.
Navigation animation MUST NOT resize or reposition the main content, and
keyboard shortcuts and persistent route mounting MUST remain functional.

#### Scenario: User navigates with the keyboard

- **WHEN** the user activates an existing `g` sequence or focuses and activates a navigation destination
- **THEN** the correct persistent route becomes visible, `aria-current` identifies it, focus remains visible, and previously visited route state is not reset

#### Scenario: User starts from the persistent verification action

- **WHEN** the user activates the shell's primary change-checking action
- **THEN** CodeVetter opens the existing Review route at its change-selection state
- **AND** explains that executable evidence is completed through the verification workflow

#### Scenario: User opens Board with a shortcut

- **WHEN** the user enters the Board navigation shortcut
- **THEN** the application opens the persistent Board route
- **AND** live Work conversations remain mounted and recoverable

## ADDED Requirements

### Requirement: The broad workbench exposes one coherent verification path

CodeVetter SHALL retain the existing broad workbench while presenting one
recognizable sequence from repository context and agent-authored change through
review findings, executable evidence, limitations, and a shipping decision.
Home, onboarding, navigation descriptions, Review, Testing, and the command
palette MUST use consistent language for this sequence. Model-generated
findings MUST be identified as leads rather than executable proof.

#### Scenario: User arrives on Home

- **WHEN** the Usage route is the active arrival state
- **THEN** a verification spotlight appears before usage telemetry with one primary action to check a change
- **AND** the spotlight names the evidence-to-decision outcome without claiming that unrun checks passed

#### Scenario: First-time user completes onboarding

- **WHEN** a user reads the welcome and tour steps
- **THEN** onboarding explains how Repo Unpack, Review, and Testing contribute to one shipping decision
- **AND** does not describe CodeVetter only as an AI companion or generic code reviewer

#### Scenario: Review has no executable evidence yet

- **WHEN** review findings exist but no qualifying runtime check has completed
- **THEN** the result hierarchy labels the runtime evidence as missing or unverified
- **AND** presents running or inspecting executable checks as the next action

### Requirement: Verification outcomes lead before secondary diagnostics

On a completed or partial verification result, the desktop viewer SHALL present
the verdict, evidence strength, failed or unverified checks, limitations, and
next safe action before graphs, historical context, audience simulation,
exports, or other secondary diagnostics. Written labels MUST communicate every
semantic state without relying on color.

#### Scenario: Verification evidence is incomplete

- **WHEN** one or more required checks are missing, blocked, stale, or failed
- **THEN** the primary result region states that condition before secondary evidence panels
- **AND** does not collapse the outcome into a generic success treatment

#### Scenario: Secondary evidence is available

- **WHEN** graphs, history, synthetic QA, or export tools are available for the result
- **THEN** they remain reachable through secondary disclosure without preceding the outcome and next action
