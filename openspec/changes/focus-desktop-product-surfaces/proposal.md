## Why

CodeVetter should concentrate on the evidence workflows it can uniquely own instead of competing with GitHub, Linear, or official coding-agent clients for generic task management and build orchestration. The local performance engine is already a differentiated product capability, but today it is visible only through CLI/MCP and marketing pages rather than as an operable desktop surface.

## What Changes

- **BREAKING** Remove Work and Board from primary navigation, command search, onboarding, keyboard navigation, and persistent product routes.
- Redirect legacy `/agents` and `/board` URLs to a stable retained surface without deleting historical local data.
- Establish five desktop product surfaces: Usage, Repo Unpack, Review, Testing, and Performance; keep Settings as a separated utility.
- Add a first-class `/performance` workbench that selects a local repository and exact supported flow, previews the bounded zero-egress execution plan, runs the existing profiler/campaign operations, and renders measurements, bottleneck evidence, limitations, candidate decisions, and paired proof.
- Define a shared Testing and Performance intake contract for the three scopes users actually bring: a function or flow described in human language, a pull request/change, or the entire codebase. CodeVetter resolves that intent into an explicit executable plan before running anything.
- Remove visible per-destination shortcut codes and the custom `g` navigation chords; command search and ordinary accessible navigation remain.
- Keep observed measurements, deterministic inferences, and unverified hypotheses visibly distinct in the UI.
- Preserve CLI/MCP as the automation contract for external coding agents; the desktop surface becomes the human-readable control and evidence view, not a replacement coding-agent client.
- Retain Work/Board storage and backend lifecycle code initially so removal is reversible and migration-safe; reap code only after route and dependency audits prove it orphaned.

## Capabilities

### New Capabilities

- `desktop-performance-workbench`: Operable local Performance surface for bounded planning, profiling, campaign progress, and evidence-backed before/after verification.

### Modified Capabilities

- `desktop-visual-system`: Replace Work and Board in the primary shell with Performance while preserving accessible navigation, persistent retained routes, and the established visual system.
- `local-work-board`: Remove Board as a primary product surface while preserving existing local records from destructive migration.
- `agent-panel`: Remove Work from primary product presentation while leaving provider process history and backend data intact during the compatibility period.
- `runtime-performance-capsules`: Expose existing exact-scope performance evidence through a typed local desktop bridge without weakening containment, redaction, or outcome semantics.
- `flow-optimization-campaigns`: Present campaign planning and one-next-action state in the desktop while preserving CLI/MCP authority and bounded local execution.

## Impact

- Desktop shell: sidebar, command palette, shortcuts, onboarding, persistent routes, route redirects, visual-system tests, and product-surface documentation.
- Testing and Performance scope intake: a follow-up resolver from human intent, PR identity, or whole-repository selection to exact runnable flows and declared coverage.
- Desktop runtime: a typed Tauri bridge to existing repository-owned performance operations, with no new production dependency and no generic shell-command input.
- New Performance page and focused state components for plan, run, findings, limitations, campaign status, and paired verification.
- Existing Work/Board local SQLite data and backend commands remain untouched in this change; removal of proven-orphaned implementation is a separately reviewable cleanup.
- The landing-page performance explainer and dated case studies remain proof/discovery surfaces and do not become the execution backend.
