## ADDED Requirements

### Requirement: Work recommends a bounded agent team from the stated outcome

Work SHALL derive a deterministic local recommendation of no more than three agent roles from the user's bounded task text and selected repository context without starting a provider or making a model or network request.

#### Scenario: User describes an ordinary code change

- **WHEN** the user enters an outcome that requires implementation but contains no explicit independent investigation, review, or verification signal
- **THEN** Work recommends one implementation agent
- **AND** explains why that role is sufficient

#### Scenario: Task signals independent verification

- **WHEN** the outcome explicitly includes testing, browser behavior, regression risk, release safety, or proof
- **THEN** Work adds a verification or review role appropriate to the detected signal
- **AND** identifies the task signal that caused the recommendation

#### Scenario: Task signals exceed the team cap

- **WHEN** more specialist signals match than the bounded recommendation can include
- **THEN** explicit safety, release, proof, and verification obligations take precedence over lower-risk advisory roles
- **AND** the explanation does not claim that an omitted role was selected

#### Scenario: Recommendation is computed

- **WHEN** Work updates the recommended team
- **THEN** it performs no provider launch, repository scan, model call, or network request
- **AND** presents the result as a recommendation rather than proven necessity

### Requirement: User confirms every agent before launch

Work MUST let the user inspect, include or exclude optional roles, select a supported provider, and see the permission mode for each included role before any team process starts. A recommended team MUST contain at most one workspace-write role; every non-implementation role MUST default to read-only.

#### Scenario: User accepts a multi-agent recommendation

- **WHEN** the user confirms two or more included current-phase roles
- **THEN** Work launches one owned provider session per included current-phase role with distinct role-scoped prompts
- **AND** assigns the sessions one shared bounded team identity
- **AND** grants workspace-write only to the implementation role
- **AND** focuses the primary role without hiding the other launches

#### Scenario: User wants one agent

- **WHEN** the user excludes every optional role
- **THEN** Work launches only the required primary role
- **AND** preserves ordinary single-conversation behavior

#### Scenario: User reviews specialist permissions

- **WHEN** Work recommends investigation, product-UX, review, or verification roles
- **THEN** the confirmation identifies those roles as read-only
- **AND** launching the team cannot silently upgrade them to workspace-write

#### Scenario: Review or verification requires a completed change

- **WHEN** Work recommends a post-implementation review or verification role
- **THEN** the role remains visibly queued during the initial launch
- **AND** it is not represented as running in Work or Agent Island
- **AND** it starts only after a separate explicit user action

#### Scenario: Work restarts with a queued specialist

- **WHEN** an implementation session and its queued post-implementation role were saved before the app or Work surface restarted
- **THEN** Work restores the queued role, provider, repository, instructions, and original team identity
- **AND** starts no provider for the queued role until a separate explicit user action

#### Scenario: Team starts from a Board item

- **WHEN** a confirmed team is seeded from one existing work item
- **THEN** only the primary implementation session attaches as that work item's provider session
- **AND** specialist sessions retain team identity without overwriting the Board attachment

#### Scenario: One team member fails to launch

- **WHEN** one provider process fails while another team member starts successfully
- **THEN** Work preserves the successful session
- **AND** shows the failed role with provider-specific recovery
- **AND** does not claim that the whole team is running successfully

#### Scenario: Team repository is unresolved

- **WHEN** two or more current-phase roles are included and the working directory is empty, home-relative, missing, or not an available verified repository
- **THEN** Work blocks the team launch with a concise repository-selection action
- **AND** starts no provider process

#### Scenario: User submits confirmation twice

- **WHEN** a team launch is already in flight and the user repeats Enter or activates confirmation again
- **THEN** Work ignores the repeated submission
- **AND** creates at most one session per confirmed role

### Requirement: Recommended agents retain an understandable purpose

Every recommended and launched agent SHALL have a concise role label, plain-language reason, and role-scoped instructions that keep its responsibility distinct from other team members.

#### Scenario: Team is shown before launch

- **WHEN** Work displays the recommendation
- **THEN** each role states what it will do and why it was recommended
- **AND** the UI does not expose hidden reasoning or fabricate repository evidence

#### Scenario: Team sessions are running

- **WHEN** multiple recommended agents have been launched
- **THEN** Work identifies each session by role, provider, repository, and runtime state
- **AND** attention remains attributable to the exact session that produced it

#### Scenario: Legacy workspace has no team identity

- **WHEN** Work restores saved terminals created before team metadata existed
- **THEN** those terminals remain valid unteamed conversations
- **AND** Work does not fabricate queued roles or team membership
