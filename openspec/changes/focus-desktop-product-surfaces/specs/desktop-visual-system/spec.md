## MODIFIED Requirements

### Requirement: Primary surfaces share one visual system

CodeVetter SHALL render Usage, Repo Unpack, Review, Testing, Performance, and Settings through one semantic dark surface system with shared background, panel, border, text, status, focus, radius, and spacing tokens. Amber SHALL be the only routine selection and primary-action accent; semantic warning, danger, and success colors MAY communicate state but MUST NOT decorate navigation categories.

#### Scenario: User moves between retained surfaces

- **WHEN** the user navigates across all five product destinations and Settings
- **THEN** the shell, page hierarchy, controls, panels, status treatments, and spacing read as one product without route-specific accent palettes

### Requirement: Navigation is consolidated and accessible

The desktop shell SHALL use one compact fixed rail with Usage, Repo Unpack, Review, Testing, and Performance as product pillars and Settings as a separated utility. On desktop-width windows, the rail SHALL retain compact CodeVetter CPU and RAM telemetry with expanded process details on demand; background sampling MUST pause while the window is hidden. Navigation animation MUST NOT resize or reposition the main content, and persistent route mounting MUST remain functional for retained product surfaces. The rail and command search SHALL NOT display per-destination mnemonic codes.

#### Scenario: User activates a navigation destination

- **WHEN** the user focuses and activates a navigation destination or chooses it from command search
- **THEN** the correct persistent route becomes visible, `aria-current` identifies it, focus remains visible, and previously visited retained-route state is not reset

#### Scenario: Navigation renders without shortcut clutter

- **WHEN** the fixed rail and command search render
- **THEN** destination names remain readable without `G H`, `G F`, or similar mnemonic badges

#### Scenario: User follows a discontinued route

- **WHEN** the user opens `/agents` or `/board`
- **THEN** CodeVetter redirects to Usage without loading Work or Board as a hidden product mode

### Requirement: Feature behavior survives hierarchy refinement

The redesign MUST preserve retained routes, URL parameters, Tauri/browser guards, data loading, commands, review and fix flows, graph/history interactions, scenario compilation, settings persistence, command palette, updater behavior, and existing Work/Board local records. It SHALL remove Work and Board from product presentation and MAY leave their backend lifecycle implementation dormant until a later orphan audit proves safe deletion.

#### Scenario: Retained browser regression suite runs

- **WHEN** focused navigation, Review, Repo, Testing, Performance, Usage, and Settings browser tests run against the revised shell
- **THEN** their behavioral assertions pass and discontinued route tests assert explicit redirects rather than hidden legacy surfaces
