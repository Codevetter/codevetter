## Why

CodeVetter is intentionally a broad evidence workbench, but its differentiated
verification workflow is difficult to discover: Usage is the default view,
Review and Testing appear as separate destinations, onboarding describes an AI
coding companion, and the strongest executable evidence arrives late. The next
UI pass should make the path from an agent-authored change to a shipping
decision unmistakable without removing the workbench's existing capabilities.

## What Changes

- Add one persistent, high-attention entry point for checking a change, while
  preserving Usage, Repo Unpack, Work, Board, Review, Testing, and Settings.
- Clarify the relationship between Review and Testing: review findings are
  leads, executable checks are evidence, and neither an unrun check nor a model
  opinion is presented as verified.
- Reframe the Home arrival state and onboarding around the workbench sequence:
  understand the repository, inspect the change, run evidence, and decide
  whether to ship.
- Improve page titles, navigation descriptions, primary actions, and result
  hierarchy so verdict, evidence strength, limitations, and next action are
  noticeable before secondary graphs and diagnostics.
- Dogfood the resulting workflow on three real agent-authored CodeVetter
  changes whose outcomes control an actual merge, release, or experiment
  decision. Synthetic corpus fixtures remain contract evidence only.
- Keep routes, the `Command-K` command palette, native shortcuts, persistent
  mounting, underlying workflows, and the incumbent ink-and-amber visual
  system compatible.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `desktop-visual-system`: Make verification the strongest action and clearest
  cross-surface workflow within the existing seven-destination workbench.

## Impact

- Primarily affects the desktop shell, Home arrival state, onboarding, Review
  setup/result hierarchy, Testing labels, and command-palette copy.
- Updates product-surface documentation to explain the broad workbench and its
  verification center without changing CLI, MCP, receipt, database, or Tauri
  contracts.
- Uses existing components, routes, tokens, and dependencies; no new production
  dependency or hosted service is required.
- Produces three private dogfood verification packets and a decision ledger.
  Public claims, benchmark promotion, publishing, releases, and provider runs
  remain separately gated.
